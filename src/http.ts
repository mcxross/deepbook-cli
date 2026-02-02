export interface SurfluxClientOptions {
  baseUrl: string;
  apiKey: string;
}

export class SurfluxClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: SurfluxClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
  }

  async getJson(path: string, query?: Record<string, string | number | undefined>): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("api-key", this.apiKey);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const suffix = body ? `: ${body}` : "";
      throw new Error(`Request failed (${response.status} ${response.statusText})${suffix}`);
    }

    return response.json();
  }
}
