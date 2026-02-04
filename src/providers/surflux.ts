import { getReadApiKey, getStreamApiKeyForPool, parsePool } from "../env.js";
import { SurfluxClient } from "../http.js";
import type { DeeptradeNetwork } from "../deepbook-config.js";
import type {
  DataProvider,
  MarginPoolsRequest,
  NormalizedOrderbook,
  OrderbookLevel,
  TradesStreamConnection,
  TradesStreamRequest,
} from "./types.js";

export type SurfluxStreamKind = "deepbook" | "deepbook-margin";

export interface SurfluxProviderOptions {
  network: DeeptradeNetwork;
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

interface SurfluxMarginPool {
  margin_pool_id?: unknown;
}

interface SurfluxRegisteredDeepbookPool {
  base_margin_pool_id?: unknown;
  quote_margin_pool_id?: unknown;
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
  readonly network: DeeptradeNetwork;
  private readonly restBaseUrl: string;
  private readonly streamBaseUrl: string;
  private readonly client: SurfluxClient;

  constructor(options: SurfluxProviderOptions) {
    this.network = options.network;
    this.restBaseUrl = options.restBaseUrl.replace(/\/+$/, "");
    this.streamBaseUrl = options.streamBaseUrl.replace(/\/+$/, "");
    this.client = new SurfluxClient({
      baseUrl: this.restBaseUrl,
      apiKey: getReadApiKey(),
    });
  }

  async getSpotPools(): Promise<unknown> {
    return this.client.getJson("/deepbook/get_pools");
  }

  async getMarginPools(request?: MarginPoolsRequest): Promise<unknown> {
    const marginPools = await this.client.getJson("/deepbook-margin/pools");
    if (!request?.registered) {
      return marginPools;
    }

    const registered = await this.client.getJson("/deepbook-margin/registered-deepbook-pools");
    if (!Array.isArray(marginPools) || !Array.isArray(registered)) {
      throw new Error("Invalid Surflux response: expected arrays for margin pools filter.");
    }

    const registeredIds = this.collectRegisteredMarginPoolIds(registered);
    return marginPools.filter((pool) => {
      const poolId = this.readMarginPoolId(pool as SurfluxMarginPool);
      return poolId ? registeredIds.has(poolId) : false;
    });
  }

  async getPools(): Promise<unknown> {
    const [spotPools, marginPools] = await Promise.all([
      this.getSpotPools(),
      this.getMarginPools(),
    ]);

    return {
      spotPools,
      marginPools,
    };
  }

  private collectRegisteredMarginPoolIds(
    registered: SurfluxRegisteredDeepbookPool[],
  ): Set<string> {
    const ids = new Set<string>();
    for (const entry of registered) {
      const baseId = this.readOptionalString(entry.base_margin_pool_id);
      const quoteId = this.readOptionalString(entry.quote_margin_pool_id);
      if (baseId) ids.add(baseId);
      if (quoteId) ids.add(quoteId);
    }
    return ids;
  }

  private readMarginPoolId(pool: SurfluxMarginPool): string | null {
    return this.readOptionalString(pool.margin_pool_id);
  }

  private readOptionalString(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
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
