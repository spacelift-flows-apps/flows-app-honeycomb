import { AppBlock, events } from "@slflows/sdk/v1";
import { honeycombFetch } from "../../utils/honeycombFetch";

export const createEventV1: AppBlock = {
  name: "Create Events",
  description:
    "Send one or more events to a Honeycomb dataset using the batch API. Each event has a data object of key-value pairs, and optionally a timestamp and sample rate.",
  category: "Events",

  inputs: {
    default: {
      name: "Send Events",
      description: "Send a batch of events to Honeycomb",
      config: {
        datasetSlug: {
          name: "Dataset Slug",
          description: "The slug of the dataset to send events to",
          type: "string",
          required: true,
        },
        batch: {
          name: "Events",
          description:
            "Array of event objects. Each has 'data' (required, key-value pairs), optional 'time' (RFC3339 or Unix epoch), and optional 'samplerate' (integer, defaults to 1).",
          type: {
            type: "array",
            items: {
              type: "object",
              properties: {
                data: { type: "object" },
                time: { type: "string" },
                samplerate: { type: "number" },
              },
              required: ["data"],
            },
          },
          required: true,
        },
      },
      onEvent: async (input) => {
        const apiKey = input.app.config.apiKey as string;
        const baseUrl = input.app.config.baseUrl as string;
        const config = input.event.inputConfig;
        const datasetSlug = config.datasetSlug as string;

        const result = await honeycombFetch({
          method: "POST",
          apiKey,
          baseUrl,
          endpoint: `/1/batch/${datasetSlug}`,
          body: config.batch,
        });

        await events.emit(result);
      },
    },
  },

  outputs: {
    default: {
      name: "Result",
      description:
        "Array of status objects, one per event, indicating success or failure",
      default: true,
      type: {
        type: "array",
        items: {
          type: "object",
          properties: {
            status: { type: "number" },
            error: { type: "string" },
          },
        },
      },
    },
  },
};
