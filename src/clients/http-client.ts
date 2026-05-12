export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface HttpClientOptions {
    baseUrl: string;
    timeoutMs?: number;
    headers?: Record<string, string>;
}

export interface RequestOptions {
    query?: QueryParams;
    headers?: Record<string, string>;
    signal?: AbortSignal;
}

export class HttpError extends Error {
    constructor(
        readonly status: number,
        readonly statusText: string,
        readonly body: unknown
    ) {
        super(`HTTP ${status}: ${statusText}`);
        this.name = "HttpError";
    }
}

export class HttpClient {
    private readonly baseUrl: string;
    private readonly timeoutMs: number;
    private readonly headers: Record<string, string>;

    constructor(options: HttpClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, "");
        this.timeoutMs = options.timeoutMs ?? 15_000;
        this.headers = {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...options.headers,
        };
    }

    get<T>(path: string, options: RequestOptions = {}): Promise<T> {
        return this.request<T>("GET", path, undefined, options);
    }

    post<T>(
        path: string,
        body?: unknown,
        options: RequestOptions = {}
    ): Promise<T> {
        return this.request<T>("POST", path, body, options);
    }

    private async request<T>(
        method: string,
        path: string,
        body?: unknown,
        options: RequestOptions = {}
    ): Promise<T> {
        const timeoutController = new AbortController();
        const timeout = setTimeout(() => {
            timeoutController.abort();
        }, this.timeoutMs);

        const signal = options.signal ?? timeoutController.signal;

        try {
            const response = await fetch(this.url(path, options.query), {
                method,
                headers: {
                    ...this.headers,
                    ...options.headers,
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal,
            });

            const parsed = await this.parse(response);

            if (!response.ok) {
                throw new HttpError(response.status, response.statusText, parsed);
            }

            return parsed as T;
        } finally {
            clearTimeout(timeout);
        }
    }

    private url(path: string, query?: QueryParams): string {
        const cleanPath = path.startsWith("/") ? path : `/${path}`;
        const url = new URL(`${this.baseUrl}${cleanPath}`);

        for (const [key, value] of Object.entries(query ?? {})) {
            if (value !== undefined && value !== null) {
                url.searchParams.set(key, String(value));
            }
        }

        return url.toString();
    }

    private async parse(response: Response): Promise<unknown> {
        const text = await response.text();

        if (!text) return null;

        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }
}