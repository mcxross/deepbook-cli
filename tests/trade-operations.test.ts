import { describe, expect, it, vi } from "vitest";
import { VecSet, mainnetCoins, mainnetPools } from "@mysten/deepbook-v3";
import { bcs } from "@mysten/sui/bcs";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";
import {
  buildCancelOrderTransaction,
  buildMarginCloseTransaction,
  buildCreateManagerTransaction,
  buildDepositTransaction,
  buildLimitOrderTransaction,
  buildMarginLimitOrderTransaction,
  buildMarginLimitOrderTransactionWithNewManager,
  buildMarginSpotOrderTransaction,
  buildMarginSpotOrderTransactionWithNewManager,
  buildMarginWithdrawTransaction,
  buildMarketOrderTransaction,
  buildSwapBaseForQuoteTransaction,
  buildSwapQuoteForBaseTransaction,
  buildWithdrawTransaction,
  findMarginManagerIdForPool,
  queryBalanceManagerIdsForOwner,
  queryManagerBalance,
  queryMarginManagerIdsForOwner,
  queryMarginPosition,
} from "../src/trade-operations.js";

function noOpPlugin() {
  return (_tx: Transaction) => undefined;
}

function objectPlugin(objectId: string) {
  return (tx: Transaction) => tx.object(objectId);
}

function createRuntime(overrides?: Record<string, unknown>) {
  const devInspectTransactionBlock = vi.fn().mockResolvedValue({
    results: [
      {
        returnValues: [
          [
            Array.from(
              VecSet(bcs.Address)
                .serialize({ contents: ["0x1"] })
                .toBytes(),
            ),
            "0x2::vec_set::VecSet<0x2::object::ID>",
          ],
        ],
      },
    ],
  });
  const multiGetObjects = vi.fn().mockResolvedValue([
    {
      data: {
        objectId: "0x1",
        type: `0xdead::margin_manager::MarginManager<${mainnetCoins[mainnetPools.SUI_USDC.baseCoin].type}, ${mainnetCoins[mainnetPools.SUI_USDC.quoteCoin].type}>`,
      },
    },
  ]);

  return {
    network: "mainnet",
    address: "0xabc",
    balanceManagerKey: "ACTIVE",
    balanceManagerId: "0x1111111111111111111111111111111111111111111111111111111111111111",
    marginManagerKey: "ACTIVE_MARGIN",
    marginManagerId: "0x2222222222222222222222222222222222222222222222222222222222222222",
    suiClient: {
      devInspectTransactionBlock,
      multiGetObjects,
    },
    deepBookClient: {
      deepBook: {
        placeLimitOrder: vi.fn().mockReturnValue(noOpPlugin()),
        placeMarketOrder: vi.fn().mockReturnValue(noOpPlugin()),
        cancelOrder: vi.fn().mockReturnValue(noOpPlugin()),
        swapExactBaseForQuote: vi.fn().mockReturnValue(noOpPlugin()),
        swapExactQuoteForBase: vi.fn().mockReturnValue(noOpPlugin()),
        getBalanceManagerIds: vi.fn().mockReturnValue(noOpPlugin()),
      },
      poolProxy: {
        placeLimitOrder: vi.fn().mockReturnValue(noOpPlugin()),
        placeMarketOrder: vi.fn().mockReturnValue(noOpPlugin()),
        placeReduceOnlyLimitOrder: vi.fn().mockReturnValue(noOpPlugin()),
        placeReduceOnlyMarketOrder: vi.fn().mockReturnValue(noOpPlugin()),
      },
      balanceManager: {
        createAndShareBalanceManager: vi.fn().mockReturnValue(noOpPlugin()),
        depositIntoManager: vi.fn().mockReturnValue(noOpPlugin()),
        withdrawFromManager: vi.fn().mockReturnValue(noOpPlugin()),
        checkManagerBalance: vi.fn().mockReturnValue(noOpPlugin()),
      },
      marginManager: {
        depositBase: vi.fn().mockReturnValue(noOpPlugin()),
        depositQuote: vi.fn().mockReturnValue(noOpPlugin()),
        borrowBase: vi.fn().mockReturnValue(noOpPlugin()),
        borrowQuote: vi.fn().mockReturnValue(noOpPlugin()),
        repayBase: vi.fn().mockReturnValue(noOpPlugin()),
        repayQuote: vi.fn().mockReturnValue(noOpPlugin()),
        withdrawBase: vi.fn().mockReturnValue(objectPlugin("0x3")),
        withdrawQuote: vi.fn().mockReturnValue(objectPlugin("0x4")),
        newMarginManagerWithInitializer: vi.fn().mockImplementation((poolKey: string) => {
          return (tx: Transaction) => ({
            manager: tx.object("0x1"),
            initializer: tx.object("0x2"),
            poolKey,
          });
        }),
        shareMarginManager: vi.fn().mockReturnValue(noOpPlugin()),
      },
      getMarginManagerState: vi.fn().mockResolvedValue({
        riskRatio: 1.7,
        baseAsset: "10",
        quoteAsset: "100",
      }),
      getMarginAccountOrderDetails: vi.fn().mockResolvedValue([
        {
          order_id: 1n,
          client_order_id: 2n,
          quantity: 300n,
          filled_quantity: 50n,
          status: 1,
          expire_timestamp: 999n,
        },
      ]),
    },
    ...overrides,
  } as any;
}

describe("trade operations", () => {
  it("builds limit order transaction", () => {
    const runtime = createRuntime();
    const tx = buildLimitOrderTransaction(runtime, {
      poolKey: "SUI_USDC",
      clientOrderId: "1",
      price: 1.25,
      quantity: 10,
      isBid: true,
      orderType: 0,
      selfMatchingOption: 0,
      payWithDeep: true,
      expiration: 1700000000,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.deepBook.placeLimitOrder).toHaveBeenCalledWith({
      poolKey: "SUI_USDC",
      balanceManagerKey: "ACTIVE",
      clientOrderId: "1",
      price: 1.25,
      quantity: 10,
      isBid: true,
      orderType: 0,
      selfMatchingOption: 0,
      payWithDeep: true,
      expiration: 1700000000,
    });
  });

  it("builds market order transaction", () => {
    const runtime = createRuntime();
    const tx = buildMarketOrderTransaction(runtime, {
      poolKey: "SUI_USDC",
      clientOrderId: "2",
      quantity: 15,
      isBid: false,
      selfMatchingOption: 1,
      payWithDeep: false,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.deepBook.placeMarketOrder).toHaveBeenCalledWith({
      poolKey: "SUI_USDC",
      balanceManagerKey: "ACTIVE",
      clientOrderId: "2",
      quantity: 15,
      isBid: false,
      selfMatchingOption: 1,
      payWithDeep: false,
    });
  });

  it("builds margin limit transaction", () => {
    const runtime = createRuntime();
    const tx = buildMarginLimitOrderTransaction(runtime, {
      poolKey: "SUI_USDC",
      clientOrderId: "3",
      price: 1.4,
      quantity: 12,
      isBid: true,
      orderType: 0,
      selfMatchingOption: 0,
      payWithDeep: true,
      reduceOnly: false,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.poolProxy.placeLimitOrder).toHaveBeenCalledWith({
      poolKey: "SUI_USDC",
      marginManagerKey: "ACTIVE_MARGIN",
      clientOrderId: "3",
      price: 1.4,
      quantity: 12,
      isBid: true,
      orderType: 0,
      selfMatchingOption: 0,
      payWithDeep: true,
    });
  });

  it("builds margin spot reduce-only transaction", () => {
    const runtime = createRuntime();
    const tx = buildMarginSpotOrderTransaction(runtime, {
      poolKey: "SUI_USDC",
      clientOrderId: "4",
      quantity: 5,
      isBid: false,
      selfMatchingOption: 2,
      payWithDeep: false,
      reduceOnly: true,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.poolProxy.placeReduceOnlyMarketOrder).toHaveBeenCalledWith({
      poolKey: "SUI_USDC",
      marginManagerKey: "ACTIVE_MARGIN",
      clientOrderId: "4",
      quantity: 5,
      isBid: false,
      selfMatchingOption: 2,
      payWithDeep: false,
    });
  });

  it("borrows base before leveraged margin spot sell", () => {
    const runtime = createRuntime();
    const tx = buildMarginSpotOrderTransaction(runtime, {
      poolKey: "SUI_USDC",
      clientOrderId: "44",
      quantity: 15,
      isBid: false,
      selfMatchingOption: 0,
      payWithDeep: true,
      reduceOnly: false,
      borrowBaseAmount: 10,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.marginManager.borrowBase).toHaveBeenCalledWith("ACTIVE_MARGIN", 10);
  });

  it("borrows quote before leveraged margin spot buy", () => {
    const runtime = createRuntime();
    const tx = buildMarginSpotOrderTransaction(runtime, {
      poolKey: "SUI_USDC",
      clientOrderId: "45",
      quantity: 15,
      isBid: true,
      selfMatchingOption: 0,
      payWithDeep: false,
      reduceOnly: false,
      borrowQuoteAmount: 12,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.marginManager.borrowQuote).toHaveBeenCalledWith("ACTIVE_MARGIN", 12);
  });

  it("builds margin limit transaction and auto-creates manager when missing", () => {
    const runtime = createRuntime({ marginManagerKey: undefined });
    const tx = buildMarginLimitOrderTransactionWithNewManager(runtime, {
      poolKey: "SUI_USDC",
      clientOrderId: "5",
      price: 1.4,
      quantity: 12,
      isBid: false,
      orderType: 0,
      selfMatchingOption: 0,
      payWithDeep: true,
      reduceOnly: false,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.marginManager.newMarginManagerWithInitializer).toHaveBeenCalledWith(
      "SUI_USDC",
    );
    expect(runtime.deepBookClient.marginManager.shareMarginManager).toHaveBeenCalledTimes(1);
  });

  it("builds margin spot transaction and auto-creates manager when missing", () => {
    const runtime = createRuntime({ marginManagerKey: undefined });
    const tx = buildMarginSpotOrderTransactionWithNewManager(runtime, {
      poolKey: "SUI_USDC",
      clientOrderId: "6",
      quantity: 4,
      isBid: true,
      selfMatchingOption: 0,
      payWithDeep: true,
      reduceOnly: false,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.marginManager.newMarginManagerWithInitializer).toHaveBeenCalledWith(
      "SUI_USDC",
    );
    expect(runtime.deepBookClient.marginManager.shareMarginManager).toHaveBeenCalledTimes(1);
  });

  it("builds cancel order transaction", () => {
    const runtime = createRuntime();
    const tx = buildCancelOrderTransaction(runtime, {
      poolKey: "SUI_USDC",
      orderId: "100",
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.deepBook.cancelOrder).toHaveBeenCalledWith(
      "SUI_USDC",
      "ACTIVE",
      "100",
    );
  });

  it("builds base->quote swap transaction", () => {
    const runtime = createRuntime();
    const tx = buildSwapBaseForQuoteTransaction(runtime, {
      poolKey: "SUI_USDC",
      amount: 10,
      minOut: 8,
      deepAmount: 0.25,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.deepBook.swapExactBaseForQuote).toHaveBeenCalledWith({
      poolKey: "SUI_USDC",
      amount: 10,
      minOut: 8,
      deepAmount: 0.25,
    });
  });

  it("builds quote->base swap transaction", () => {
    const runtime = createRuntime();
    const tx = buildSwapQuoteForBaseTransaction(runtime, {
      poolKey: "SUI_USDC",
      amount: 10,
      minOut: 8,
      deepAmount: 0.5,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.deepBook.swapExactQuoteForBase).toHaveBeenCalledWith({
      poolKey: "SUI_USDC",
      amount: 10,
      minOut: 8,
      deepAmount: 0.5,
    });
  });

  it("builds manager create transaction", () => {
    const runtime = createRuntime();
    const tx = buildCreateManagerTransaction(runtime);

    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.balanceManager.createAndShareBalanceManager).toHaveBeenCalledTimes(1);
  });

  it("builds manager deposit transaction", () => {
    const runtime = createRuntime();
    const tx = buildDepositTransaction(runtime, {
      coin: "USDC",
      amount: 5,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.balanceManager.depositIntoManager).toHaveBeenCalledWith(
      "ACTIVE",
      "USDC",
      5,
    );
  });

  it("builds manager withdraw transaction", () => {
    const runtime = createRuntime();
    const tx = buildWithdrawTransaction(runtime, {
      coin: "SUI",
      amount: 3,
      recipient: "0xabc",
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.balanceManager.withdrawFromManager).toHaveBeenCalledWith(
      "ACTIVE",
      "SUI",
      3,
      "0xabc",
    );
  });

  it("builds manager SUI deposit transaction with split-coin command", () => {
    const runtime = createRuntime();
    const tx = buildDepositTransaction(runtime, {
      coin: "SUI",
      amount: 1,
    });

    const data = tx.getData();
    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.balanceManager.depositIntoManager).not.toHaveBeenCalled();
    expect(data.commands[0]?.$kind).toBe("SplitCoins");
    expect(data.commands.some((command) => command.$kind === "MoveCall")).toBe(true);
  });

  it("queries manager balance", async () => {
    const runtime = createRuntime({
      suiClient: {
        devInspectTransactionBlock: vi.fn().mockResolvedValue({
          results: [
            {
              returnValues: [
                [Array.from(bcs.U64.serialize(123000000000n).toBytes()), "u64"],
              ],
            },
          ],
        }),
      },
    });
    const result = await queryManagerBalance(runtime, "SUI");

    expect(runtime.deepBookClient.balanceManager.checkManagerBalance).toHaveBeenCalledWith(
      "ACTIVE",
      "SUI",
    );
    expect(result).toEqual({
      coinType: mainnetCoins.SUI.type,
      balance: 123,
      balanceRaw: "123000000000",
    });
  });

  it("queries margin position with open orders", async () => {
    const runtime = createRuntime();
    const result = await queryMarginPosition(runtime);

    expect(runtime.deepBookClient.getMarginManagerState).toHaveBeenCalledWith("ACTIVE_MARGIN");
    expect(runtime.deepBookClient.getMarginAccountOrderDetails).toHaveBeenCalledWith(
      "ACTIVE_MARGIN",
    );
    expect(result.openOrderCount).toBe(1);
    expect(result.openOrders[0]).toEqual({
      orderId: "1",
      clientOrderId: "2",
      quantityRaw: "300",
      filledQuantityRaw: "50",
      remainingQuantityRaw: "250",
      status: 1,
      expiresAt: "999",
    });
  });

  it("queries margin manager ids by owner", async () => {
    const runtime = createRuntime();
    const ids = await queryMarginManagerIdsForOwner(runtime, runtime.address);
    expect(runtime.suiClient.devInspectTransactionBlock).toHaveBeenCalledTimes(1);
    expect(ids).toEqual(["0x0000000000000000000000000000000000000000000000000000000000000001"]);
  });

  it("queries balance manager ids by owner", async () => {
    const runtime = createRuntime({
      suiClient: {
        devInspectTransactionBlock: vi.fn().mockResolvedValue({
          results: [
            {
              returnValues: [
                [
                  Array.from(
                    bcs.vector(bcs.Address).serialize(["0x1", "0x2"]).toBytes(),
                  ),
                  "vector<address>",
                ],
              ],
            },
          ],
        }),
      },
      deepBookClient: {
        deepBook: {
          getBalanceManagerIds: vi.fn().mockReturnValue(noOpPlugin()),
        },
      },
    });

    const ids = await queryBalanceManagerIdsForOwner(runtime, runtime.address);
    expect(runtime.deepBookClient.deepBook.getBalanceManagerIds).toHaveBeenCalledWith(
      normalizeSuiAddress(runtime.address),
    );
    expect(ids).toEqual([
      "0x0000000000000000000000000000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000000000000000000000000000002",
    ]);
  });

  it("unions registry and BalanceManagerEvent-based manager IDs", async () => {
    const runtime = createRuntime({
      address: "0xabc",
      suiClient: {
        devInspectTransactionBlock: vi.fn().mockResolvedValue({
          results: [
            {
              returnValues: [
                [
                  Array.from(
                    bcs.vector(bcs.Address).serialize(["0x1"]).toBytes(),
                  ),
                  "vector<address>",
                ],
              ],
            },
          ],
        }),
        queryTransactionBlocks: vi.fn().mockResolvedValue({
          data: [
            {
              events: [
                {
                  type: "0x1::balance_manager::BalanceManagerEvent",
                  parsedJson: {
                    owner: "0xabc",
                    balance_manager_id: "0x2",
                  },
                },
                {
                  type: "0x1::balance_manager::BalanceManagerEvent",
                  parsedJson: {
                    owner: "0xdef",
                    balance_manager_id: "0x3",
                  },
                },
              ],
            },
          ],
          hasNextPage: false,
          nextCursor: null,
        }),
      },
      deepBookClient: {
        deepBook: {
          getBalanceManagerIds: vi.fn().mockReturnValue(noOpPlugin()),
        },
      },
    });

    const ids = await queryBalanceManagerIdsForOwner(runtime, runtime.address);

    expect(runtime.suiClient.queryTransactionBlocks).toHaveBeenCalledTimes(1);
    expect(ids).toEqual([
      "0x0000000000000000000000000000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000000000000000000000000000002",
    ]);
  });

  it("finds margin manager id for a pool", async () => {
    const runtime = createRuntime();
    const id = await findMarginManagerIdForPool(runtime, "SUI_USDC", runtime.address);
    expect(runtime.suiClient.multiGetObjects).toHaveBeenCalledTimes(1);
    expect(id).toBe("0x1");
  });

  it("builds reduce-only margin close transaction and repays debts", () => {
    const runtime = createRuntime();
    const tx = buildMarginCloseTransaction(runtime, {
      poolKey: "SUI_USDC",
      clientOrderId: "55",
      quantity: 6,
      isBid: false,
      reduceOnly: true,
      selfMatchingOption: 0,
      payWithDeep: true,
      repayBaseDebt: true,
      repayQuoteDebt: true,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.poolProxy.placeReduceOnlyMarketOrder).toHaveBeenCalledWith({
      poolKey: "SUI_USDC",
      marginManagerKey: "ACTIVE_MARGIN",
      clientOrderId: "55",
      quantity: 6,
      isBid: false,
      selfMatchingOption: 0,
      payWithDeep: true,
    });
    expect(runtime.deepBookClient.marginManager.repayBase).toHaveBeenCalledWith("ACTIVE_MARGIN");
    expect(runtime.deepBookClient.marginManager.repayQuote).toHaveBeenCalledWith("ACTIVE_MARGIN");
  });

  it("builds non-reduce-only margin close transaction", () => {
    const runtime = createRuntime();
    const tx = buildMarginCloseTransaction(runtime, {
      poolKey: "SUI_USDC",
      clientOrderId: "56",
      quantity: 4,
      isBid: true,
      reduceOnly: false,
      selfMatchingOption: 1,
      payWithDeep: false,
      repayBaseDebt: false,
      repayQuoteDebt: false,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.poolProxy.placeMarketOrder).toHaveBeenCalledWith({
      poolKey: "SUI_USDC",
      marginManagerKey: "ACTIVE_MARGIN",
      clientOrderId: "56",
      quantity: 4,
      isBid: true,
      selfMatchingOption: 1,
      payWithDeep: false,
    });
  });

  it("builds margin withdraw transaction", () => {
    const runtime = createRuntime();
    const tx = buildMarginWithdrawTransaction(runtime, {
      baseAmount: 1.5,
      quoteAmount: 2.25,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(runtime.deepBookClient.marginManager.withdrawBase).toHaveBeenCalledWith("ACTIVE_MARGIN", 1.5);
    expect(runtime.deepBookClient.marginManager.withdrawQuote).toHaveBeenCalledWith("ACTIVE_MARGIN", 2.25);
  });

  it("requires balance manager for manager-scoped operations", () => {
    const runtime = createRuntime({ balanceManagerKey: undefined });

    expect(() =>
      buildLimitOrderTransaction(runtime, {
        poolKey: "SUI_USDC",
        clientOrderId: "1",
        price: 1,
        quantity: 1,
        isBid: true,
        orderType: 0,
        selfMatchingOption: 0,
        payWithDeep: true,
      }),
    ).toThrow(/Balance manager is not configured/);
  });

  it("requires margin manager for margin operations", async () => {
    const runtime = createRuntime({ marginManagerKey: undefined });

    expect(() =>
      buildMarginLimitOrderTransaction(runtime, {
        poolKey: "SUI_USDC",
        clientOrderId: "10",
        price: 1,
        quantity: 1,
        isBid: true,
        orderType: 0,
        selfMatchingOption: 0,
        payWithDeep: true,
        reduceOnly: false,
      }),
    ).toThrow(/Margin manager is not configured/);

    await expect(queryMarginPosition(runtime)).rejects.toThrow(/Margin manager is not configured/);
  });
});
