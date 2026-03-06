import { beforeEach, describe, expect, it, vi } from "vitest";
import { SurfluxClient } from "@mcxross/surflux";
import { SurfluxProvider } from "../src/providers/surflux.js";

vi.mock("@mcxross/surflux", () => ({
  SurfluxClient: vi.fn(),
}));

vi.mock("../src/env.js", async () => {
  const actual = await vi.importActual<typeof import("../src/env.js")>("../src/env.js");
  return {
    ...actual,
    getReadApiKey: () => "read-key",
    getStreamApiKeys: () => ({
      DEEP_SUI: "stream-key",
    }),
  };
});

function createProvider(): SurfluxProvider {
  return new SurfluxProvider({
    network: "mainnet",
    restBaseUrl: "https://api.surflux.dev",
    streamBaseUrl: "https://flux.surflux.dev",
  });
}

let client: {
  getSpotPools: ReturnType<typeof vi.fn>;
  getMarginPools: ReturnType<typeof vi.fn>;
  getRegisteredMarginPools: ReturnType<typeof vi.fn>;
  getOrderbook: ReturnType<typeof vi.fn>;
  getTrades: ReturnType<typeof vi.fn>;
  getOhlcv: ReturnType<typeof vi.fn>;
  subscribeTrades: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  client = {
    getSpotPools: vi.fn(),
    getMarginPools: vi.fn(),
    getRegisteredMarginPools: vi.fn(),
    getOrderbook: vi.fn(),
    getTrades: vi.fn(),
    getOhlcv: vi.fn(),
    subscribeTrades: vi.fn(),
  };
  vi.mocked(SurfluxClient).mockImplementation(function SurfluxClientMock() {
    return client as unknown as SurfluxClient;
  } as unknown as typeof SurfluxClient);
});

describe("SurfluxProvider pools", () => {
  let provider: SurfluxProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  it("loads all margin pools via /deepbook-margin/pools", async () => {
    const payload = [{ margin_pool_id: "0x1" }];
    client.getMarginPools.mockResolvedValueOnce(payload);

    const result = await provider.getMarginPools();

    expect(client.getMarginPools).toHaveBeenCalledTimes(1);
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

    client.getMarginPools.mockResolvedValueOnce(allMarginPools);
    client.getRegisteredMarginPools.mockResolvedValueOnce(registered);

    const result = await provider.getMarginPools({ registered: true });

    expect(client.getMarginPools).toHaveBeenCalledTimes(1);
    expect(client.getRegisteredMarginPools).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      { margin_pool_id: "0x1", asset_type: "coin::A" },
      { margin_pool_id: "0x3", asset_type: "coin::C" },
    ]);
  });

  it("throws if registered filter payloads are invalid", async () => {
    client.getMarginPools.mockResolvedValueOnce({});
    client.getRegisteredMarginPools.mockResolvedValueOnce([]);

    await expect(provider.getMarginPools({ registered: true })).rejects.toThrow(
      /expected arrays/i,
    );
  });
});

describe("SurfluxProvider streams", () => {
  it("subscribes to deepbook-margin trades via SDK", () => {
    const provider = createProvider();
    const subscription = { stop: vi.fn() };
    const onEvent = vi.fn();
    client.subscribeTrades.mockReturnValue(subscription);

    const result = provider.subscribeTrades(
      {
        poolInput: "deep_sui",
        kind: "deepbook-margin",
      },
      onEvent,
      {
        reconnect: false,
        reconnectDelayMs: 2500,
      },
    );

    expect(client.subscribeTrades).toHaveBeenCalledWith("deep_sui", onEvent, {
      kind: "deepbook-margin",
      reconnect: false,
      reconnectDelayMs: 2500,
      onError: undefined,
    });
    expect(result).toBe(subscription);
  });
});
