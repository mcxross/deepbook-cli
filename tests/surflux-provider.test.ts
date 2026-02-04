import { beforeEach, describe, expect, it, vi } from "vitest";
import { SurfluxProvider } from "../src/providers/surflux.js";

vi.mock("../src/env.js", async () => {
  const actual = await vi.importActual<typeof import("../src/env.js")>("../src/env.js");
  return {
    ...actual,
    getReadApiKey: () => "read-key",
    getStreamApiKeyForPool: (poolInput: string) => {
      const normalizedPoolName = poolInput.trim().toUpperCase().replace(/[\/-]/g, "_");
      return {
        poolName: normalizedPoolName,
        envVarName: `API_KEY_STREAM_${normalizedPoolName}`,
        apiKey: "stream-key",
      };
    },
  };
});

function createProvider(): SurfluxProvider {
  return new SurfluxProvider({
    network: "mainnet",
    restBaseUrl: "https://api.surflux.dev",
    streamBaseUrl: "https://flux.surflux.dev",
  });
}

describe("SurfluxProvider pools", () => {
  let provider: SurfluxProvider;
  let getJson: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = createProvider();
    getJson = vi.fn();
    (provider as { client: { getJson: ReturnType<typeof vi.fn> } }).client = { getJson };
  });

  it("loads all margin pools via /deepbook-margin/pools", async () => {
    const payload = [{ margin_pool_id: "0x1" }];
    getJson.mockResolvedValueOnce(payload);

    const result = await provider.getMarginPools();

    expect(getJson).toHaveBeenCalledTimes(1);
    expect(getJson).toHaveBeenCalledWith("/deepbook-margin/pools");
    expect(result).toEqual(payload);
  });

  it("filters margin pools by registered deepbook pools", async () => {
    const allMarginPools = [
      { margin_pool_id: "0x1", asset_type: "coin::A" },
      { margin_pool_id: "0x2", asset_type: "coin::B" },
      { margin_pool_id: "0x3", asset_type: "coin::C" },
    ];
    const registered = [
      { base_margin_pool_id: "0x1", quote_margin_pool_id: "0x3" },
      { base_margin_pool_id: "0x9", quote_margin_pool_id: "0x1" },
    ];

    getJson.mockResolvedValueOnce(allMarginPools);
    getJson.mockResolvedValueOnce(registered);

    const result = await provider.getMarginPools({ registered: true });

    expect(getJson).toHaveBeenNthCalledWith(1, "/deepbook-margin/pools");
    expect(getJson).toHaveBeenNthCalledWith(2, "/deepbook-margin/registered-deepbook-pools");
    expect(result).toEqual([
      { margin_pool_id: "0x1", asset_type: "coin::A" },
      { margin_pool_id: "0x3", asset_type: "coin::C" },
    ]);
  });

  it("throws if registered filter payloads are invalid", async () => {
    getJson.mockResolvedValueOnce({});
    getJson.mockResolvedValueOnce([]);

    await expect(provider.getMarginPools({ registered: true })).rejects.toThrow(
      /expected arrays/i,
    );
  });
});

describe("SurfluxProvider streams", () => {
  it("builds deepbook-margin stream URL", () => {
    const provider = createProvider();
    const connection = provider.createTradesStreamConnection({
      poolInput: "deep_sui",
      kind: "deepbook-margin",
    });

    expect(connection.poolLabel).toBe("DEEP_SUI");
    expect(connection.url).toBe(
      "https://flux.surflux.dev/deepbook-margin/DEEP_SUI/live-trades?api-key=stream-key",
    );
    expect(connection.headers).toEqual({
      Accept: "text/event-stream",
    });
  });
});
