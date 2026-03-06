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

export interface DataProvider {
  readonly name: string;
  getSpotPools(): Promise<unknown>;
  getMarginPools(request?: MarginPoolsRequest): Promise<unknown>;
  getPools(): Promise<unknown>;
  getOrderbook(poolInput: string, depth: number): Promise<unknown>;
  normalizeOrderbook(raw: unknown): NormalizedOrderbook;
  getTrades(poolInput: string, limit: number): Promise<unknown>;
  getOhlcv(poolInput: string, timeframe: string, limit: number): Promise<unknown>;
  subscribeTrades(
    request: TradesStreamRequest,
    onEvent: (event: TradesStreamEvent) => void,
    options?: TradesStreamOptions,
  ): TradesSubscription;
}
