import { HttpClient } from "../clients/http-client.js";
import type {
  PageQuery,
  PredictAskBounds,
  PredictLpSupplyEvent,
  PredictLpWithdrawalEvent,
  PredictManagerCreatedEvent,
  PredictManagerPnl,
  PredictManagerPositionSummary,
  PredictManagerSummary,
  PredictOracle,
  PredictOraclePriceUpdate,
  PredictOracleState,
  PredictOracleSviUpdate,
  PredictPositionMintedEvent,
  PredictPositionRedeemedEvent,
  PredictRangeMintedEvent,
  PredictRangeRedeemedEvent,
  PredictState,
  PredictStatus,
  PredictTradeHistoryEvent,
  PredictVaultPerformance,
  PredictVaultSummary,
  RangeQuery,
} from "./types.js";

export class PredictClient {
  constructor(private readonly http: HttpClient) {}

  status(): Promise<PredictStatus> {
    return this.http.get<PredictStatus>("/status");
  }

  getPredictState(predictId: string): Promise<PredictState> {
    return this.http.get<PredictState>(
      `/predicts/${encodeURIComponent(predictId)}/state`,
    );
  }

  getOracles(predictId: string): Promise<PredictOracle[]> {
    return this.http.get<PredictOracle[]>(
      `/predicts/${encodeURIComponent(predictId)}/oracles`,
    );
  }

  getOracleState(oracleId: string): Promise<PredictOracleState> {
    return this.http.get<PredictOracleState>(
      `/oracles/${encodeURIComponent(oracleId)}/state`,
    );
  }

  getQuoteAssets(predictId: string): Promise<string[]> {
    return this.http.get<string[]>(
      `/predicts/${encodeURIComponent(predictId)}/quote-assets`,
    );
  }

  getOracleAskBounds(oracleId: string): Promise<PredictAskBounds | null> {
    return this.http.get<PredictAskBounds | null>(
      `/oracles/${encodeURIComponent(oracleId)}/ask-bounds`,
    );
  }

  getVaultSummary(predictId: string): Promise<PredictVaultSummary> {
    return this.http.get<PredictVaultSummary>(
      `/predicts/${encodeURIComponent(predictId)}/vault/summary`,
    );
  }

  getVaultPerformance(
    predictId: string,
    query: RangeQuery = { range: "ALL" },
  ): Promise<PredictVaultPerformance> {
    return this.http.get<PredictVaultPerformance>(
      `/predicts/${encodeURIComponent(predictId)}/vault/performance`,
      { query },
    );
  }

  getSupplyHistory(query: PageQuery = {}): Promise<PredictLpSupplyEvent[]> {
    return this.http.get<PredictLpSupplyEvent[]>("/lp/supplies", { query });
  }

  getWithdrawalHistory(
    query: PageQuery = {},
  ): Promise<PredictLpWithdrawalEvent[]> {
    return this.http.get<PredictLpWithdrawalEvent[]>("/lp/withdrawals", {
      query,
    });
  }

  getManagers(query: PageQuery = {}): Promise<PredictManagerCreatedEvent[]> {
    return this.http.get<PredictManagerCreatedEvent[]>("/managers", { query });
  }

  getManagerSummary(managerId: string): Promise<PredictManagerSummary> {
    return this.http.get<PredictManagerSummary>(
      `/managers/${encodeURIComponent(managerId)}/summary`,
    );
  }

  getManagerPositionsSummary(
    managerId: string,
  ): Promise<PredictManagerPositionSummary[]> {
    return this.http.get<PredictManagerPositionSummary[]>(
      `/managers/${encodeURIComponent(managerId)}/positions/summary`,
    );
  }

  getManagerPnl(
    managerId: string,
    query: RangeQuery = { range: "ALL" },
  ): Promise<PredictManagerPnl> {
    return this.http.get<PredictManagerPnl>(
      `/managers/${encodeURIComponent(managerId)}/pnl`,
      { query },
    );
  }

  getPriceHistory(
    oracleId: string,
    query: PageQuery = {},
  ): Promise<PredictOraclePriceUpdate[]> {
    return this.http.get<PredictOraclePriceUpdate[]>(
      `/oracles/${encodeURIComponent(oracleId)}/prices`,
      { query },
    );
  }

  getLatestPrice(oracleId: string): Promise<PredictOraclePriceUpdate | null> {
    return this.http.get<PredictOraclePriceUpdate | null>(
      `/oracles/${encodeURIComponent(oracleId)}/prices/latest`,
    );
  }

  getSviHistory(
    oracleId: string,
    query: PageQuery = {},
  ): Promise<PredictOracleSviUpdate[]> {
    return this.http.get<PredictOracleSviUpdate[]>(
      `/oracles/${encodeURIComponent(oracleId)}/svi`,
      { query },
    );
  }

  getLatestSvi(oracleId: string): Promise<PredictOracleSviUpdate | null> {
    return this.http.get<PredictOracleSviUpdate | null>(
      `/oracles/${encodeURIComponent(oracleId)}/svi/latest`,
    );
  }

  getMintHistory(query: PageQuery = {}): Promise<PredictPositionMintedEvent[]> {
    return this.http.get<PredictPositionMintedEvent[]>("/positions/minted", {
      query,
    });
  }

  getRedeemHistory(
    query: PageQuery = {},
  ): Promise<PredictPositionRedeemedEvent[]> {
    return this.http.get<PredictPositionRedeemedEvent[]>("/positions/redeemed", {
      query,
    });
  }

  getRangeMintHistory(
    query: PageQuery = {},
  ): Promise<PredictRangeMintedEvent[]> {
    return this.http.get<PredictRangeMintedEvent[]>("/ranges/minted", {
      query,
    });
  }

  getRangeRedeemHistory(
    query: PageQuery = {},
  ): Promise<PredictRangeRedeemedEvent[]> {
    return this.http.get<PredictRangeRedeemedEvent[]>("/ranges/redeemed", {
      query,
    });
  }

  getTradeHistory(
    oracleId: string,
    query: PageQuery = {},
  ): Promise<PredictTradeHistoryEvent[]> {
    return this.http.get<PredictTradeHistoryEvent[]>(
      `/trades/${encodeURIComponent(oracleId)}`,
      { query },
    );
  }
}
