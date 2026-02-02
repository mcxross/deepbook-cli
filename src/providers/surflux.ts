import { getReadApiKey, getStreamApiKeyForPool, parsePool } from "../env.js";
import { SurfluxClient } from "../http.js";
import type {
  DataProvider,
  NormalizedOrderbook,
  OrderbookLevel,
  TradesStreamConnection,
  TradesStreamRequest,
} from "./types.js";

export type SurfluxStreamKind = "deepbook" | "deepbook-margin";

export interface SurfluxProviderOptions {
  restBaseUrl: string;
  streamBaseUrl: string;
}

interface SurfluxOrderbookLevel {
  price?: unknown;
  total_quantity?: unknown;
  order_count?: unknown;
}

interface SurfluxOrderbookResponse {
  bids?: unknown;
  asks?: unknown;
}

function parseStreamKind(value?: string): SurfluxStreamKind {
  const normalized = (value ?? "deepbook").trim();
  if (normalized === "deepbook" || normalized === "deepbook-margin") {
    return normalized;
  }
  throw new Error(
    `Invalid stream kind "${value}". Supported for surflux: "deepbook", "deepbook-margin".`,
  );
}

export class SurfluxProvider implements DataProvider {
  readonly name = "surflux";
  private readonly restBaseUrl: string;
  private readonly streamBaseUrl: string;
  private readonly client: SurfluxClient;

  constructor(options: SurfluxProviderOptions) {
    this.restBaseUrl = options.restBaseUrl.replace(/\/+$/, "");
    this.streamBaseUrl = options.streamBaseUrl.replace(/\/+$/, "");
    this.client = new SurfluxClient({
      baseUrl: this.restBaseUrl,
      apiKey: getReadApiKey(),
    });
  }

  async getPools(): Promise<unknown> {
    return this.client.getJson("/deepbook/get_pools");
  }

  async getOrderbook(poolInput: string, depth: number): Promise<unknown> {
    const { poolName } = parsePool(poolInput);
    return this.client.getJson(`/deepbook/${poolName}/order-book-depth`, { limit: depth });
  }

  normalizeOrderbook(raw: unknown): NormalizedOrderbook {
    const response = raw as SurfluxOrderbookResponse;
    return {
      bids: this.normalizeLevels(response.bids, "bids"),
      asks: this.normalizeLevels(response.asks, "asks"),
    };
  }

  async getTrades(poolInput: string, limit: number): Promise<unknown> {
    const { poolName } = parsePool(poolInput);
    return this.client.getJson(`/deepbook/${poolName}/trades`, { limit });
  }

  async getOhlcv(poolInput: string, timeframe: string, limit: number): Promise<unknown> {
    const { poolName } = parsePool(poolInput);
    return this.client.getJson(`/deepbook/${poolName}/ohlcv/${timeframe}`, { limit });
  }

  createTradesStreamConnection(request: TradesStreamRequest): TradesStreamConnection {
    const kind = parseStreamKind(request.kind);
    const { poolName, apiKey } = getStreamApiKeyForPool(request.poolInput);

    const streamUrl = new URL(`${this.streamBaseUrl}/${kind}/${poolName}/live-trades`);
    streamUrl.searchParams.set("api-key", apiKey);

    return {
      poolLabel: poolName,
      url: streamUrl.toString(),
      headers: {
        Accept: "text/event-stream",
      },
    };
  }

  private normalizeLevels(input: unknown, fieldName: string): OrderbookLevel[] {
    if (!Array.isArray(input)) {
      throw new Error(`Invalid surflux orderbook payload: ${fieldName} is not an array.`);
    }

    return input.map((level, index) => this.normalizeLevel(level as SurfluxOrderbookLevel, fieldName, index));
  }

  private normalizeLevel(
    level: SurfluxOrderbookLevel,
    fieldName: string,
    index: number,
  ): OrderbookLevel {
    const price = this.toRequiredString(level.price, `${fieldName}[${index}].price`);
    const quantity = this.toRequiredString(
      level.total_quantity,
      `${fieldName}[${index}].total_quantity`,
    );
    const orderCountRaw = this.toRequiredString(
      level.order_count,
      `${fieldName}[${index}].order_count`,
    );
    const orderCount = Number.parseInt(orderCountRaw, 10);
    if (!Number.isFinite(orderCount)) {
      throw new Error(
        `Invalid surflux orderbook payload: ${fieldName}[${index}].order_count is not a number.`,
      );
    }

    return {
      price,
      quantity,
      orderCount,
    };
  }

  private toRequiredString(value: unknown, path: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Invalid surflux orderbook payload: missing ${path}.`);
    }
    return value;
  }
}
