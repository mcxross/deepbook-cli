import {
  SurfluxClient,
  type OrderbookResponse,
  type OrderbookLevel as SurfluxSdkOrderbookLevel,
  type SurfluxStreamKind,
} from "@mcxross/surflux";
import { getReadApiKey, getStreamApiKeys } from "../env.js";
import type { DeeptradeNetwork } from "../deepbook-config.js";
import {
  COMMON_OHLCV_TIMEFRAMES,
  parseProviderOhlcvTimeframe,
} from "./types.js";
import type {
  CommonOhlcvTimeframe,
  DataProvider,
  MarginPoolsRequest,
  NormalizedOrderbook,
  OrderbookLevel,
  TradesStreamEvent,
  TradesStreamOptions,
  TradesStreamRequest,
  TradesSubscription,
} from "./types.js";

export interface SurfluxProviderOptions {
  network: DeeptradeNetwork;
  restBaseUrl: string;
  streamBaseUrl: string;
}

interface SurfluxMarginPool {
  margin_pool_id?: unknown;
}

interface SurfluxRegisteredDeepbookPool {
  base_margin_pool_id?: unknown;
  quote_margin_pool_id?: unknown;
}

export const SUPPORTED_SURFLUX_OHLCV_TIMEFRAMES = COMMON_OHLCV_TIMEFRAMES;
export type SurfluxOhlcvTimeframe = CommonOhlcvTimeframe;
const DEFAULT_SURFLUX_OHLCV_TIMEFRAME: SurfluxOhlcvTimeframe = "5m";

function parseStreamKind(value?: string): SurfluxStreamKind {
  const normalized = (value ?? "deepbook").trim();
  if (normalized === "deepbook" || normalized === "deepbook-margin") {
    return normalized;
  }
  throw new Error(
    `Invalid stream kind "${value}". Supported for surflux: "deepbook", "deepbook-margin".`,
  );
}

function resolveSurfluxOhlcvTimeframe(value?: string): SurfluxOhlcvTimeframe {
  return parseProviderOhlcvTimeframe(
    "surflux",
    SUPPORTED_SURFLUX_OHLCV_TIMEFRAMES,
    value ?? DEFAULT_SURFLUX_OHLCV_TIMEFRAME,
  );
}

export class SurfluxProvider implements DataProvider<SurfluxOhlcvTimeframe> {
  readonly name = "surflux";
  readonly supportedOhlcvTimeframes = SUPPORTED_SURFLUX_OHLCV_TIMEFRAMES;
  readonly defaultOhlcvTimeframe = DEFAULT_SURFLUX_OHLCV_TIMEFRAME;
  readonly network: DeeptradeNetwork;
  private readonly client: SurfluxClient;

  constructor(options: SurfluxProviderOptions) {
    this.network = options.network;
    this.client = new SurfluxClient({
      network: options.network,
      restApiKey: getReadApiKey(),
      sseApiKeys: getStreamApiKeys(),
      restBaseUrl: options.restBaseUrl.replace(/\/+$/, ""),
      streamBaseUrl: options.streamBaseUrl.replace(/\/+$/, ""),
    });
  }

  async getSpotPools(): Promise<unknown> {
    return this.client.getSpotPools();
  }

  async getMarginPools(request?: MarginPoolsRequest): Promise<unknown> {
    const marginPools = await this.client.getMarginPools();
    if (!request?.registered) {
      return marginPools;
    }

    // The SDK exposes the registered-pairs endpoint, but the CLI needs the original
    // filtered margin-pools list shape, so we still compose that behavior locally.
    const registered = await this.client.getRegisteredMarginPools();
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
    return this.client.getOrderbook(poolInput, { limit: depth });
  }

  normalizeOrderbook(raw: unknown): NormalizedOrderbook {
    const response = raw as OrderbookResponse;
    return {
      bids: this.normalizeLevels(response.bids, "bids"),
      asks: this.normalizeLevels(response.asks, "asks"),
    };
  }

  async getTrades(poolInput: string, limit: number): Promise<unknown> {
    return this.client.getTrades(poolInput, { limit });
  }

  resolveOhlcvTimeframe(value?: string): SurfluxOhlcvTimeframe {
    return resolveSurfluxOhlcvTimeframe(value);
  }

  async getOhlcv(
    poolInput: string,
    timeframe: SurfluxOhlcvTimeframe,
    limit: number,
  ): Promise<unknown> {
    return this.client.getOhlcv(poolInput, resolveSurfluxOhlcvTimeframe(timeframe), {
      limit,
    });
  }

  subscribeTrades(
    request: TradesStreamRequest,
    onEvent: (event: TradesStreamEvent) => void,
    options: TradesStreamOptions = {},
  ): TradesSubscription {
    const kind = parseStreamKind(request.kind);
    return this.client.subscribeTrades(request.poolInput, onEvent, {
      kind,
      reconnect: options.reconnect,
      reconnectDelayMs: options.reconnectDelayMs,
      onError: options.onError,
    });
  }

  private normalizeLevels(input: unknown, fieldName: string): OrderbookLevel[] {
    if (!Array.isArray(input)) {
      throw new Error(`Invalid surflux orderbook payload: ${fieldName} is not an array.`);
    }

    return input.map((level, index) =>
      this.normalizeLevel(level as SurfluxSdkOrderbookLevel, fieldName, index),
    );
  }

  private normalizeLevel(
    level: SurfluxSdkOrderbookLevel,
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
