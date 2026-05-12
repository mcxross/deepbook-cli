import type { QueryValue } from "../clients/http-client.js";

type PredictQueryParams = Record<string, QueryValue>;

export interface PageQuery extends PredictQueryParams {
  limit?: number;
  cursor?: string;
}

export const PREDICT_RANGE_VALUES = ["1D", "7D", "30D", "90D", "ALL"] as const;

export type PredictRange = (typeof PREDICT_RANGE_VALUES)[number];

export interface RangeQuery extends PredictQueryParams {
  range?: PredictRange;
}

export interface PredictEventMetadata {
  event_digest: string;
  digest: string;
  sender: string;
  checkpoint: number;
  checkpoint_timestamp_ms: number;
  tx_index: number;
  event_index: number;
  package: string;
}

export interface PredictPipelineStatus {
  pipeline: string;
  checkpoint_hi_inclusive: number;
  timestamp_ms_hi_inclusive: number;
  epoch_hi_inclusive: number;
  checkpoint_lag: number;
  time_lag_ms: number;
  time_lag_seconds: number;
  latest_onchain_checkpoint: number;
  is_backfill: boolean;
}

export interface PredictStatus {
  status: string;
  latest_onchain_checkpoint: number;
  current_time_ms: number;
  earliest_checkpoint: number;
  max_lag_pipeline: string | null;
  max_checkpoint_lag: number;
  max_time_lag_seconds: number;
  pipelines: PredictPipelineStatus[];
}

export interface PredictState {
  predict_id: string;
  pricing: unknown | null;
  risk: unknown | null;
  trading_paused: boolean | null;
  quote_assets: string[];
}

export type PredictOracleStatus = "pending" | "active" | "settled" | string;

export interface PredictOracle {
  predict_id: string;
  oracle_id: string;
  oracle_cap_id: string;
  underlying_asset: string;
  expiry: number;
  min_strike: number;
  tick_size: number;
  status: PredictOracleStatus;
  activated_at: number | null;
  settlement_price: number | null;
  settled_at: number | null;
  created_checkpoint: number;
}

export interface PredictOraclePriceUpdate extends PredictEventMetadata {
  oracle_id: string;
  spot: number;
  forward: number;
  onchain_timestamp: number;
}

export interface PredictOracleSviUpdate extends PredictEventMetadata {
  oracle_id: string;
  a: number;
  b: number;
  rho: number;
  rho_negative: boolean;
  m: number;
  m_negative: boolean;
  sigma: number;
  onchain_timestamp: number;
}

export interface PredictAskBounds {
  predict_id?: string;
  oracle_id?: string;
  min_ask_price: number;
  max_ask_price: number;
}

export interface PredictOracleState {
  oracle: PredictOracle;
  latest_price: PredictOraclePriceUpdate | null;
  latest_svi: PredictOracleSviUpdate | null;
  ask_bounds: PredictAskBounds | null;
}

export interface PredictVaultSummary {
  predict_id: string;
  quote_assets: string[];
  vault_balance: number;
  vault_value: number;
  total_mtm: number;
  total_max_payout: number;
  available_liquidity: number;
  available_withdrawal: number;
  plp_total_supply: number;
  plp_share_price: number;
  utilization: number;
  max_payout_utilization: number;
  net_deposits: number;
  total_supplied: number;
  total_withdrawn: number;
}

export interface PredictVaultPerformancePoint {
  timestamp_ms: number;
  share_price: number;
  vault_value: number;
  total_shares: number;
}

export interface PredictVaultPerformance {
  predict_id: string;
  range: PredictRange;
  points: PredictVaultPerformancePoint[];
}

export interface PredictLpSupplyEvent extends PredictEventMetadata {
  predict_id: string;
  supplier: string;
  quote_asset: string;
  amount: number;
  shares_minted: number;
}

export interface PredictLpWithdrawalEvent extends PredictEventMetadata {
  predict_id: string;
  withdrawer: string;
  quote_asset: string;
  amount: number;
  shares_burned: number;
}

export interface PredictManagerCreatedEvent extends PredictEventMetadata {
  manager_id: string;
  owner: string;
}

export interface PredictManagerBalance {
  quote_asset: string;
  balance: number;
}

export interface PredictManagerSummary {
  manager_id: string;
  owner: string;
  balances: PredictManagerBalance[];
  trading_balance: number;
  open_exposure: number;
  redeemable_value: number;
  realized_pnl: number;
  unrealized_pnl: number;
  account_value: number;
  open_positions: number;
  awaiting_settlement_positions: number;
}

export interface PredictManagerPositionSummary {
  [key: string]: unknown;
}

export interface PredictManagerPnlPoint {
  timestamp_ms: number;
  realized_pnl?: number;
  unrealized_pnl?: number;
  total_pnl?: number;
}

export interface PredictManagerPnl {
  manager_id: string;
  range: PredictRange;
  series_type: string;
  points: PredictManagerPnlPoint[];
  current_unrealized_pnl: number;
  current_total_pnl: number;
}

export interface PredictPositionMintedEvent extends PredictEventMetadata {
  predict_id: string;
  manager_id: string;
  trader: string;
  quote_asset: string;
  oracle_id: string;
  expiry: number;
  strike: number;
  is_up: boolean;
  quantity: number;
  cost: number;
  ask_price: number;
}

export interface PredictPositionRedeemedEvent extends PredictEventMetadata {
  predict_id: string;
  manager_id: string;
  owner: string;
  executor: string;
  quote_asset: string;
  oracle_id: string;
  expiry: number;
  strike: number;
  is_up: boolean;
  quantity: number;
  payout: number;
  bid_price: number;
  is_settled: boolean;
}

export interface PredictRangeMintedEvent extends PredictEventMetadata {
  predict_id: string;
  manager_id: string;
  trader: string;
  quote_asset: string;
  oracle_id: string;
  expiry: number;
  lower_strike: number;
  higher_strike: number;
  quantity: number;
  cost: number;
  ask_price: number;
}

export interface PredictRangeRedeemedEvent extends PredictEventMetadata {
  predict_id: string;
  manager_id: string;
  trader: string;
  quote_asset: string;
  oracle_id: string;
  expiry: number;
  lower_strike: number;
  higher_strike: number;
  quantity: number;
  payout: number;
  bid_price: number;
  is_settled: boolean;
}

export interface PredictTradeHistoryEvent extends Record<string, unknown> {
  oracle_id?: string;
}
