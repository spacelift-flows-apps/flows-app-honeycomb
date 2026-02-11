import {
  AppInput,
  http,
  defineApp,
  blocks,
  messaging,
  kv,
} from "@slflows/sdk/v1";
import { blocks as allBlocks } from "./blocks/index";
import { honeycombFetch, HoneycombApiError } from "./utils/honeycombFetch";

export const app = defineApp({
  name: "Honeycomb API",
  installationInstructions:
    "Honeycomb API integration for Flows\n\nTo install:\n1. Create a Honeycomb API key with the Manage Recipients permission enabled (required for webhook setup)\n2. Enable additional permissions based on the blocks you plan to use:\n   - Send Events: for the Create Events block\n   - Manage Queries and Columns + Run Queries: for the Run Query block\n3. Add your API key and configure the base URL if needed (defaults to https://api.honeycomb.io)\n4. Start using the blocks in your flows",

  blocks: allBlocks,

  config: {
    apiKey: {
      name: "API Key",
      description: "Your Honeycomb API key (X-Honeycomb-Team)",
      type: "string",
      required: true,
      sensitive: true,
    },
    baseUrl: {
      name: "Base URL",
      description: "Honeycomb API base URL",
      type: "string",
      required: false,
      default: "https://api.honeycomb.io",
    },
  },

  async onSync(input: AppInput) {
    const apiKey = input.app.config.apiKey as string;
    const baseUrl = input.app.config.baseUrl as string;

    try {
      // Validate API credentials
      await honeycombFetch({
        method: "GET",
        apiKey,
        baseUrl,
        endpoint: "/1/auth",
      });

      // Check if webhook recipient already exists
      const existingRecipientId = await kv.app.get("webhook_recipient_id");

      if (existingRecipientId?.value) {
        console.log(
          `Webhook recipient already exists: ${existingRecipientId.value}`,
        );
        return {
          newStatus: "ready" as const,
        };
      }

      // Generate and store webhook secret
      const webhookSecret = generateWebhookSecret();
      await kv.app.set({ key: "webhook_secret", value: webhookSecret });

      const recipientResult = await honeycombFetch<{ id: string }>({
        method: "POST",
        apiKey,
        baseUrl,
        endpoint: "/1/recipients",
        body: {
          type: "webhook",
          details: {
            webhook_name: `spacelift-flows-${crypto.randomUUID()}`,
            webhook_url: `${input.app.http.url}/webhook?secret=${webhookSecret}`,
            webhook_secret: webhookSecret,
          },
        },
      });

      const recipientId = recipientResult.id;
      console.log(
        `Webhook recipient created successfully with ID: ${recipientId}`,
      );

      await kv.app.set({ key: "webhook_recipient_id", value: recipientId });
      console.log(`Stored webhook recipient ID: ${recipientId}`);

      return {
        newStatus: "ready" as const,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      return {
        newStatus: "failed" as const,
        customStatusDescription: message,
      };
    }
  },

  onDrain: async (input: AppInput) => {
    const apiKey = input.app.config.apiKey as string;
    const baseUrl = input.app.config.baseUrl as string;

    try {
      const recipientIdPair = await kv.app.get("webhook_recipient_id");
      const recipientId = recipientIdPair?.value;

      if (!recipientId) {
        console.log(
          "No webhook recipient ID found in storage, skipping deletion",
        );
        return {
          newStatus: "drained",
        };
      }

      console.log(`Attempting to delete webhook recipient: ${recipientId}`);

      try {
        await honeycombFetch({
          method: "DELETE",
          apiKey,
          baseUrl,
          endpoint: `/1/recipients/${recipientId}`,
        });
        console.log(`Successfully deleted webhook recipient: ${recipientId}`);
      } catch (error) {
        // Treat 404 as success since the recipient is already gone
        if (error instanceof HoneycombApiError && error.statusCode === 404) {
          console.log(
            `Webhook recipient ${recipientId} not found (404) - treating as already deleted`,
          );
        } else {
          throw error;
        }
      }

      await kv.app.delete(["webhook_recipient_id"]);
      await kv.app.delete(["webhook_secret"]);
      console.log("Cleaned up stored webhook data");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      return {
        newStatus: "draining_failed" as const,
        customStatusDescription: message,
      };
    }

    return {
      newStatus: "drained",
    };
  },

  http: {
    onRequest: async (input: any) => {
      console.log("Received webhook from Honeycomb");

      // Validate the webhook secret from query parameters
      const requestedSecret = input.request.query?.secret;
      const storedSecretPair = await kv.app.get("webhook_secret");
      const storedSecret = storedSecretPair?.value;

      if (
        !requestedSecret ||
        !storedSecret ||
        requestedSecret !== storedSecret
      ) {
        console.log("Invalid webhook secret");
        await http.respond(input.request.requestId, {
          statusCode: 401,
          body: { error: "Unauthorized: Invalid webhook secret" },
        });
        return;
      }

      if (!input.request.body) {
        await http.respond(input.request.requestId, {
          statusCode: 400,
          body: { error: "Missing request body" },
        });
        return;
      }

      const payload = input.request.body;

      try {
        console.log("Extracted trigger data:", payload);

        // Find blocks subscribed to trigger events
        const entityList = await blocks.list({
          typeIds: ["subscribeToTriggerV1"],
        });

        const matchingEntityIds = entityList.blocks
          .filter((entity) => {
            // If block has no trigger_id filter, match all events
            if (!entity.config.trigger_id) {
              return true;
            }

            // If block has a filter, only match if payload has a matching id
            const triggerId = payload.id as string;
            return triggerId && entity.config.trigger_id === triggerId;
          })
          .map((entity) => entity.id);

        if (matchingEntityIds.length > 0) {
          await messaging.sendToBlocks({
            blockIds: matchingEntityIds,
            body: {
              type: "trigger_fired",
              data: payload,
            },
          });
        }

        await http.respond(input.request.requestId, {
          statusCode: 200,
          body: { success: true, matched_blocks: matchingEntityIds.length },
        });
      } catch (error) {
        console.error("Error processing Honeycomb webhook:", error);
        await http.respond(input.request.requestId, {
          statusCode: 500,
          body: { error: "Internal server error" },
        });
      }
    },
  },
});

function generateWebhookSecret(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return Array.from(randomBytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
