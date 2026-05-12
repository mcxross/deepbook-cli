import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/clients/http-client.js";
import { PredictClient } from "../src/predict/PredictClient.js";

const BASE_URL = "https://predict.example";
const PREDICT_ID = "0xpredict/id";
const ORACLE_ID = "0xoracle/id";
const MANAGER_ID = "0xmanager/id";

function createClient(): PredictClient {
  return new PredictClient(new HttpClient({ baseUrl: BASE_URL }));
}

function mockJsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
  } as unknown as Response;
}

function expectLastFetchUrl(path: string): void {
  const fetchMock = vi.mocked(fetch);
  const [url] = fetchMock.mock.calls.at(-1) ?? [];
  expect(url).toBe(`${BASE_URL}${path}`);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse({})));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PredictClient documented endpoints", () => {
  it("loads server status", async () => {
    await createClient().status();

    expectLastFetchUrl("/status");
  });

  it("loads Predict object state from /predicts/:id/state", async () => {
    await createClient().getPredictState(PREDICT_ID);

    expectLastFetchUrl("/predicts/0xpredict%2Fid/state");
  });

  it("loads Predict oracles and quote assets from /predicts/:id", async () => {
    const client = createClient();

    await client.getOracles(PREDICT_ID);
    expectLastFetchUrl("/predicts/0xpredict%2Fid/oracles");

    await client.getQuoteAssets(PREDICT_ID);
    expectLastFetchUrl("/predicts/0xpredict%2Fid/quote-assets");
  });

  it("loads oracle state, prices, SVI, and ask bounds from /oracles/:id", async () => {
    const client = createClient();

    await client.getOracleState(ORACLE_ID);
    expectLastFetchUrl("/oracles/0xoracle%2Fid/state");

    await client.getOracleAskBounds(ORACLE_ID);
    expectLastFetchUrl("/oracles/0xoracle%2Fid/ask-bounds");

    await client.getPriceHistory(ORACLE_ID, { limit: 2, cursor: "abc" });
    expectLastFetchUrl("/oracles/0xoracle%2Fid/prices?limit=2&cursor=abc");

    await client.getLatestPrice(ORACLE_ID);
    expectLastFetchUrl("/oracles/0xoracle%2Fid/prices/latest");

    await client.getSviHistory(ORACLE_ID, { limit: 3 });
    expectLastFetchUrl("/oracles/0xoracle%2Fid/svi?limit=3");

    await client.getLatestSvi(ORACLE_ID);
    expectLastFetchUrl("/oracles/0xoracle%2Fid/svi/latest");
  });

  it("loads vault endpoints with range queries", async () => {
    const client = createClient();

    await client.getVaultSummary(PREDICT_ID);
    expectLastFetchUrl("/predicts/0xpredict%2Fid/vault/summary");

    await client.getVaultPerformance(PREDICT_ID, { range: "30D" });
    expectLastFetchUrl(
      "/predicts/0xpredict%2Fid/vault/performance?range=30D",
    );
  });

  it("loads LP, manager, and history endpoints with page queries", async () => {
    const client = createClient();

    await client.getSupplyHistory({ limit: 10 });
    expectLastFetchUrl("/lp/supplies?limit=10");

    await client.getWithdrawalHistory({ cursor: "next" });
    expectLastFetchUrl("/lp/withdrawals?cursor=next");

    await client.getManagers({ limit: 5 });
    expectLastFetchUrl("/managers?limit=5");

    await client.getManagerSummary(MANAGER_ID);
    expectLastFetchUrl("/managers/0xmanager%2Fid/summary");

    await client.getManagerPositionsSummary(MANAGER_ID);
    expectLastFetchUrl("/managers/0xmanager%2Fid/positions/summary");

    await client.getManagerPnl(MANAGER_ID, { range: "ALL" });
    expectLastFetchUrl("/managers/0xmanager%2Fid/pnl?range=ALL");

    await client.getMintHistory({ limit: 1 });
    expectLastFetchUrl("/positions/minted?limit=1");

    await client.getRedeemHistory({ limit: 1 });
    expectLastFetchUrl("/positions/redeemed?limit=1");

    await client.getRangeMintHistory({ limit: 1 });
    expectLastFetchUrl("/ranges/minted?limit=1");

    await client.getRangeRedeemHistory({ limit: 1 });
    expectLastFetchUrl("/ranges/redeemed?limit=1");

    await client.getTradeHistory(ORACLE_ID, { limit: 2 });
    expectLastFetchUrl("/trades/0xoracle%2Fid?limit=2");
  });
});
