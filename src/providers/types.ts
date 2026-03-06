export interface TradesStreamRequest {
  poolInput: string;
  kind?: string;
}

export interface MarginPoolsRequest {
  registered?: boolean;
}

export interface OrderbookLevel {
  price: string;
  quantity: string;
  orderCount: number;
}

export interface NormalizedOrderbook {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
}

export interface TradesStreamEvent {
  event: string;
  data: unknown;
  id?: string;
  pool: string;
}

export interface TradesStreamOptions {
  reconnect?: boolean;
  reconnectDelayMs?: number;
  onError?: (error: Error) => void;
}

export interface TradesSubscription {
  stop(): void;
}

export const COMMON_OHLCV_TIMEFRAMES = [
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
] as const;

export type CommonOhlcvTimeframe = (typeof COMMON_OHLCV_TIMEFRAMES)[number];

export const EXTENDED_OHLCV_TIMEFRAMES = ["3D", "1W", "1M", "1Y"] as const;

export type ExtendedOhlcvTimeframe = (typeof EXTENDED_OHLCV_TIMEFRAMES)[number];
export type ExtendedProviderOhlcvTimeframe =
  | CommonOhlcvTimeframe
  | ExtendedOhlcvTimeframe;

export function extendProviderOhlcvTimeframes<
  const TBase extends readonly string[],
  const TExtra extends readonly string[],
>(base: TBase, extra: TExtra): readonly [...TBase, ...TExtra] {
  return [...base, ...extra] as readonly [...TBase, ...TExtra];
}

export function parseProviderOhlcvTimeframe<T extends string>(
  providerName: string,
  supportedTimeframes: readonly T[],
  value: string,
): T {
  const normalized = value.trim();
  if (supportedTimeframes.includes(normalized as T)) {
    return normalized as T;
  }

  throw new Error(
    `Invalid timeframe "${value}" for provider "${providerName}". Supported values: ${supportedTimeframes.join(", ")}.`,
  );
}

export interface DataProvider<TTimeframe extends string = string> {
  readonly name: string;
  readonly supportedOhlcvTimeframes: readonly TTimeframe[];
  readonly defaultOhlcvTimeframe: TTimeframe;
  resolveOhlcvTimeframe(value?: string): TTimeframe;
  getSpotPools(): Promise<unknown>;
  getMarginPools(request?: MarginPoolsRequest): Promise<unknown>;
  getPools(): Promise<unknown>;
  getOrderbook(poolInput: string, depth: number): Promise<unknown>;
  normalizeOrderbook(raw: unknown): NormalizedOrderbook;
  getTrades(poolInput: string, limit: number): Promise<unknown>;
  getOhlcv(poolInput: string, timeframe: TTimeframe, limit: number): Promise<unknown>;
  subscribeTrades(
    request: TradesStreamRequest,
    onEvent: (event: TradesStreamEvent) => void,
    options?: TradesStreamOptions,
  ): TradesSubscription;
}
