import { AppBlock, events } from "@slflows/sdk/v1";

export const subscribeToTriggerV1: AppBlock = {
  name: "Subscribe to Trigger",
  description:
    "Subscribe to Honeycomb trigger events and alerts. Use the recipient created by app configuration to receive trigger notifications.",
  category: "Triggers",
  config: {
    triggerId: {
      name: "Trigger ID",
      description:
        "Specific trigger ID to listen to (optional - if not provided, listens to all triggers)",
      type: "string",
      required: false,
    },
  },

  async onInternalMessage({ message }) {
    if (message.body.type === "trigger_fired") {
      await events.emit(message.body.data);
    }
  },

  outputs: {
    default: {
      name: "Trigger Event",
      description: "Honeycomb trigger event data",
      default: true,
      type: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Trigger ID",
          },
          name: {
            type: "string",
            description: "Name of the trigger",
          },
          description: {
            type: "string",
            description: "Description of the trigger",
          },
          threshold: {
            type: "object",
            description: "Threshold configuration that was exceeded",
            properties: {
              op: { type: "string" },
              value: { type: "number" },
              exceeded_limit: { type: "number" },
            },
          },
          query_result_url: {
            type: "string",
            description: "URL to the query result that triggered the alert",
          },
          result_groups: {
            type: "array",
            description: "Groups of results that triggered the alert",
          },
          status: {
            type: "string",
            description: "Trigger status (e.g., 'triggered', 'resolved')",
          },
        },
      },
    },
  },
};
