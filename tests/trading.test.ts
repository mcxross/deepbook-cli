import { describe, expect, it, vi } from "vitest";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { Transaction } from "@mysten/sui/transactions";
import {
  assertCanPlaceMarketOrder,
  createTradingRuntime,
  executeOrDryRunTransaction,
  generateClientOrderId,
  parseDeepBookNetwork,
  parseOrderSide,
  parseOrderType,
  parseSelfMatchingOption,
} from "../src/trading.js";

describe("trading helpers", () => {
  it("parses DeepBook network", () => {
    expect(parseDeepBookNetwork("mainnet")).toBe("mainnet");
    expect(parseDeepBookNetwork(" testnet ")).toBe("testnet");
    expect(() => parseDeepBookNetwork("devnet")).toThrow(/Invalid network/);
  });

  it("parses order side", () => {
    expect(parseOrderSide("buy")).toBe(true);
    expect(parseOrderSide("bid")).toBe(true);
    expect(parseOrderSide("sell")).toBe(false);
    expect(parseOrderSide("ask")).toBe(false);
    expect(() => parseOrderSide("hold")).toThrow(/Invalid side/);
  });

  it("parses order type", () => {
    expect(parseOrderType("none")).toBe(0);
    expect(parseOrderType("ioc")).toBe(1);
    expect(parseOrderType("fok")).toBe(2);
    expect(parseOrderType("post-only")).toBe(3);
    expect(() => parseOrderType("market")).toThrow(/Invalid order type/);
  });

  it("parses self matching policy", () => {
    expect(parseSelfMatchingOption("allow")).toBe(0);
    expect(parseSelfMatchingOption("cancel-taker")).toBe(1);
    expect(parseSelfMatchingOption("cancel-maker")).toBe(2);
    expect(() => parseSelfMatchingOption("none")).toThrow(/Invalid self-match policy/);
  });

  it("generates numeric client order id", () => {
    const value = generateClientOrderId();
    expect(value).toMatch(/^\d+$/);
  });

});

describe("createTradingRuntime", () => {
  it("creates runtime with explicit address", () => {
    const runtime = createTradingRuntime({
      network: "testnet",
      address: "0x1",
    });

    expect(runtime.network).toBe("testnet");
    expect(runtime.address).toBe("0x1");
    expect(runtime.keypair).toBeUndefined();
  });

  it("derives address from private key", () => {
    const keypair = Ed25519Keypair.generate();
    const runtime = createTradingRuntime({
      network: "testnet",
      privateKey: keypair.getSecretKey(),
    });

    expect(runtime.address).toBe(keypair.toSuiAddress());
    expect(runtime.keypair).toBeDefined();
  });

  it("requires either private key or address", () => {
    expect(() =>
      createTradingRuntime({
        network: "mainnet",
      }),
    ).toThrow(/Missing wallet identity/);
  });
});

describe("executeOrDryRunTransaction", () => {
  it("dry-runs transaction", async () => {
    const dryRunTransactionBlock = vi.fn().mockResolvedValue({ ok: true });
    const build = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const setSenderIfNotSet = vi.fn();

    const runtime = {
      address: "0xabc",
      suiClient: { dryRunTransactionBlock },
    } as any;

    const tx = {
      build,
      setSenderIfNotSet,
    } as unknown as Transaction;

    const result = await executeOrDryRunTransaction(runtime, tx, true);

    expect(setSenderIfNotSet).toHaveBeenCalledWith("0xabc");
    expect(build).toHaveBeenCalledWith({ client: runtime.suiClient });
    expect(dryRunTransactionBlock).toHaveBeenCalledWith({
      transactionBlock: new Uint8Array([1, 2, 3]),
    });
    expect(result).toEqual({ ok: true });
  });

  it("requires signer when executing", async () => {
    const runtime = {
      suiClient: {},
      keypair: undefined,
    } as any;

    await expect(
      executeOrDryRunTransaction(runtime, {} as Transaction, false),
    ).rejects.toThrow(/Missing signer/);
  });

  it("executes signed transaction", async () => {
    const signAndExecuteTransaction = vi.fn().mockResolvedValue({ digest: "0x123" });

    const runtime = {
      keypair: { fake: true },
      suiClient: { signAndExecuteTransaction },
    } as any;

    const tx = {} as Transaction;
    const result = await executeOrDryRunTransaction(runtime, tx, false);

    expect(signAndExecuteTransaction).toHaveBeenCalledTimes(1);
    expect(signAndExecuteTransaction).toHaveBeenCalledWith({
      signer: runtime.keypair,
      transaction: tx,
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
        showBalanceChanges: true,
      },
    });
    expect(result).toEqual({ digest: "0x123" });
  });

  it("throws decoded error for dry-run failures", async () => {
    const dryRunTransactionBlock = vi.fn().mockResolvedValue({
      effects: {
        status: {
          status: "failure",
          error: "MoveAbort ...",
        },
        abortError: {
          module_id: "0x2c8d::balance_manager",
          function: "withdraw_with_proof",
          error_code: 3,
        },
      },
    });
    const build = vi.fn().mockResolvedValue(new Uint8Array([1]));
    const setSenderIfNotSet = vi.fn();
    const runtime = {
      address: "0xabc",
      suiClient: { dryRunTransactionBlock },
    } as any;
    const tx = { build, setSenderIfNotSet } as unknown as Transaction;

    await expect(executeOrDryRunTransaction(runtime, tx, true)).rejects.toThrow(
      /Insufficient available balance in the balance manager/i,
    );
  });
});

describe("assertCanPlaceMarketOrder", () => {
  it("throws when market params are invalid", async () => {
    const runtime = {
      balanceManagerKey: "ACTIVE",
      deepBookClient: {
        checkMarketOrderParams: vi.fn().mockResolvedValue(false),
        canPlaceMarketOrder: vi.fn().mockResolvedValue(true),
        poolBookParams: vi.fn().mockResolvedValue({ minSize: 1, lotSize: 0.1 }),
      },
    } as any;

    await expect(
      assertCanPlaceMarketOrder(runtime, {
        poolKey: "SUI_USDC",
        quantity: 0.05,
        isBid: false,
        payWithDeep: true,
      }),
    ).rejects.toThrow(/Invalid market quantity/i);
  });

  it("throws when manager balance is insufficient", async () => {
    const runtime = {
      balanceManagerKey: "ACTIVE",
      deepBookClient: {
        checkMarketOrderParams: vi.fn().mockResolvedValue(true),
        canPlaceMarketOrder: vi.fn().mockResolvedValue(false),
        poolBookParams: vi.fn().mockResolvedValue({ minSize: 1, lotSize: 0.1 }),
      },
    } as any;

    await expect(
      assertCanPlaceMarketOrder(runtime, {
        poolKey: "SUI_USDC",
        quantity: 1,
        isBid: false,
        payWithDeep: true,
      }),
    ).rejects.toThrow(/insufficient available balance/i);
  });
});
