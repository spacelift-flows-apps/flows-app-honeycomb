import { AppBlock, events } from "@slflows/sdk/v1";

const MAX_POLL_DURATION_MS = 15_000;
const POLL_INTERVAL_MS = 500;

export const runQueryV1: AppBlock = {
  name: "Run Query",
  description:
    "Run an existing query by ID and poll for results. Takes a dataset slug and query ID, creates a query result, and polls until complete (max 15 seconds). Query data must be within the past 7 days.",
  category: "Queries",

  inputs: {
    default: {
      name: "Execute Query",
      description: "Run a Honeycomb query by ID and return results",
      config: {
        dataset_slug: {
          name: "Dataset Slug",
          description:
            "The slug of the dataset to query, or '__all__' for environment-wide queries",
          type: "string",
          required: true,
        },
        query_id: {
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
        const datasetSlug = config.dataset_slug as string;
        const queryId = config.query_id as string;

        // Step 1: Run the query asynchronously
        const runResponse = await fetch(
          `${baseUrl}/1/query_results/${datasetSlug}`,
          {
            method: "POST",
            headers: {
              "X-Honeycomb-Team": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ query_id: queryId }),
          },
        );

        if (!runResponse.ok) {
          const errorText = await runResponse.text();
          throw new Error(
            `Failed to run query: ${runResponse.status} ${runResponse.statusText} - ${errorText}`,
          );
        }

        const runResult = await runResponse.json();
        const queryResultId = runResult.id;

        // Step 2: Poll until complete or timeout (15 seconds)
        // Documentation confirms that queries cannot take longer
        // than 10 seconds to complete.
        const startTime = Date.now();

        while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
          const pollResponse = await fetch(
            `${baseUrl}/1/query_results/${datasetSlug}/${queryResultId}`,
            {
              method: "GET",
              headers: {
                "X-Honeycomb-Team": apiKey,
              },
            },
          );

          if (!pollResponse.ok) {
            const errorText = await pollResponse.text();
            throw new Error(
              `Failed to poll query result: ${pollResponse.status} ${pollResponse.statusText} - ${errorText}`,
            );
          }

          const pollResult = await pollResponse.json();

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
