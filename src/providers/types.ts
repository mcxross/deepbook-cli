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

export interface TradesStreamConnection {
  poolLabel: string;
  url: string;
  headers?: Record<string, string>;
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
  createTradesStreamConnection(request: TradesStreamRequest): TradesStreamConnection;
}
