import { tavily } from "@tavily/core";

export interface SearchOptions {
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
}

export function tavilyConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

/** Web search via Tavily. Returns result URLs in rank order. */
export async function searchUrls(query: string, options: SearchOptions = {}): Promise<string[]> {
  const client = tavily({
    apiKey: process.env.TAVILY_API_KEY,
    // Only for pointing tests at a mock server; unset in production.
    apiBaseURL: process.env.TAVILY_API_BASE_URL,
  });
  const response = await client.search(query, {
    searchDepth: "basic",
    maxResults: options.maxResults ?? 10,
    includeDomains: options.includeDomains,
    excludeDomains: options.excludeDomains,
    timeout: 15, // seconds
  });
  return response.results.map((r) => r.url);
}
