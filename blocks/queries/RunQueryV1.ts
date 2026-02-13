import { AppBlock, events } from "@slflows/sdk/v1";
import { honeycombFetch } from "../../utils/honeycombFetch";

const MAX_POLL_DURATION_MS = 15_000;
const POLL_INTERVAL_MS = 500;

export const runQueryV1: AppBlock = {
  name: "Run Query",
  description: `Run an existing query by ID and poll for results. Takes a dataset slug and query ID, creates a query result, and polls until complete (max 15 seconds). Query data must be within the past 7 days. Required enterprise plan.`,
  category: "Queries",

  inputs: {
    default: {
      name: "Execute Query",
      description: "Run a Honeycomb query by ID and return results",
      config: {
        datasetSlug: {
          name: "Dataset Slug",
          description:
            "The slug of the dataset to query, or '__all__' for environment-wide queries",
          type: "string",
          required: true,
        },
        queryId: {
          name: "Query ID",
          description: "The ID of an existing query to run",
          type: "string",
          required: true,
        },
      },
      onEvent: async (input) => {
        const apiKey = input.app.config.apiKey as string;
        const baseUrl = input.app.config.baseUrl as string;
        const config = input.event.inputConfig;
        const datasetSlug = config.datasetSlug as string;
        const queryId = config.queryId as string;

        // Step 1: Run the query asynchronously
        const runResult = await honeycombFetch<{ id: string }>({
          method: "POST",
          apiKey,
          baseUrl,
          endpoint: `/1/query_results/${datasetSlug}`,
          body: { query_id: queryId },
        });

        const queryResultId = runResult.id;

        // Step 2: Poll until complete or timeout (15 seconds)
        // Documentation confirms that queries cannot take longer
        // than 10 seconds to complete.
        const startTime = Date.now();

        while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
          const pollResult = await honeycombFetch<{ complete: boolean }>({
            method: "GET",
            apiKey,
            baseUrl,
            endpoint: `/1/query_results/${datasetSlug}/${queryResultId}`,
          });

          if (pollResult.complete) {
            await events.emit(pollResult);
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }

        throw new Error(
          `Query result polling timed out after ${MAX_POLL_DURATION_MS / 1000} seconds. Query ID: ${queryId}, Result ID: ${queryResultId}`,
        );
      },
    },
  },

  outputs: {
    default: {
      name: "Query Result",
      description: "The completed query result from Honeycomb",
      default: true,
      type: {
        type: "object",
        properties: {
          complete: {
            type: "boolean",
            description: "Whether the query has completed",
          },
          data: {
            type: "object",
            properties: {
              series: {
                type: "array",
                description: "Time series data points for graphing",
              },
              results: {
                type: "array",
                description: "Summary table rows with aggregated values",
              },
            },
          },
          id: {
            type: "string",
            description: "The query result ID",
          },
          links: {
            type: "object",
            properties: {
              graph_image_url: { type: "string" },
              query_url: { type: "string" },
            },
          },
          query: {
            type: "object",
            description: "The original query spec that was executed",
          },
        },
      },
    },
  },
};
