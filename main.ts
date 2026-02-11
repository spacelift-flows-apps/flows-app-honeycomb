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
            webhook_url: `${input.app.http.url}/webhook`,
            webhook_secret: webhookSecret,
          },
        },
      });

      const recipientId = recipientResult.id;
      await kv.app.set({ key: "webhook_recipient_id", value: recipientId });

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
        return {
          newStatus: "drained",
        };
      }

      try {
        await honeycombFetch({
          method: "DELETE",
          apiKey,
          baseUrl,
          endpoint: `/1/recipients/${recipientId}`,
        });
      } catch (error) {
        // Treat 404 as success since the recipient is already gone
        if (error instanceof HoneycombApiError && error.statusCode === 404) {
          // Already deleted, no action needed
        } else {
          throw error;
        }
      }

      await kv.app.delete(["webhook_recipient_id"]);
      await kv.app.delete(["webhook_secret"]);
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
      // Validate the webhook secret from the Honeycomb header
      const requestedSecret =
        input.request.headers?.["X-Honeycomb-Webhook-Token"];
      console.log(requestedSecret);
      const storedSecretPair = await kv.app.get("webhook_secret");
      const storedSecret = storedSecretPair?.value;

      if (
        !requestedSecret ||
        !storedSecret ||
        requestedSecret !== storedSecret
      ) {
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
        // Find blocks subscribed to trigger events
        const entityList = await blocks.list({
          typeIds: ["subscribeToTriggerV1"],
        });

        const matchingEntityIds = entityList.blocks
          .filter((entity) => {
            // If block has no trigger_id filter, match all events
            if (!entity.config.triggerId) {
              return true;
            }

            // If block has a filter, only match if payload has a matching id
            const triggerId = payload.id as string;
            return triggerId && entity.config.triggerId === triggerId;
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
