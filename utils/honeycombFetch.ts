export class HoneycombApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly endpoint: string,
    public readonly statusCode: number,
    public readonly statusText: string,
    public readonly responseBody: string,
  ) {
    super(
      `Honeycomb API error: ${method} ${endpoint} returned ${statusCode} ${statusText}: ${responseBody}`,
    );
    this.name = "HoneycombApiError";
  }
}

interface HoneycombFetchOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  apiKey: string;
  baseUrl: string;
  endpoint: string;
  body?: unknown;
}

export async function honeycombFetch<T = any>(
  options: HoneycombFetchOptions,
): Promise<T> {
  const { method, apiKey, baseUrl, endpoint, body } = options;
  const url = `${baseUrl}${endpoint}`;

  const headers: Record<string, string> = {
    "X-Honeycomb-Team": apiKey,
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(
      `Honeycomb API request failed: ${method} ${endpoint}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    const responseBody = await response.text();
    throw new HoneycombApiError(
      method,
      endpoint,
      response.status,
      response.statusText,
      responseBody,
    );
  }

  // Some endpoints (DELETE, 202) return no body
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}
