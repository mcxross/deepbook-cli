import {
  FLOAT_SCALAR,
  Order,
  VecSet,
  mainnetCoins,
  mainnetMarginPools,
  mainnetPackageIds,
  mainnetPools,
  testnetCoins,
  testnetMarginPools,
  testnetPackageIds,
  testnetPools,
} from "@mysten/deepbook-v3";
import { bcs } from "@mysten/sui/bcs";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { Transaction, coinWithBalance, type TransactionArgument } from "@mysten/sui/transactions";
import type { TradingRuntime } from "./trading.js";

function getManagerKey(runtime: TradingRuntime): string {
  if (!runtime.balanceManagerKey) {
    throw new Error(
      'Balance manager is not configured in runtime. Pass --manager or let the CLI auto-discover one with "deepbook manager ls".',
    );
  }

  return runtime.balanceManagerKey;
}

function getMarginManagerKey(runtime: TradingRuntime): string {
  if (!runtime.marginManagerKey) {
    throw new Error(
      "Margin manager is not configured in runtime. Pass --margin-manager and pool key.",
    );
  }

  return runtime.marginManagerKey;
}

function toBigIntSafe(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string") return BigInt(value);
  return 0n;
}

function normalizeBigIntValues<T>(value: T): T {
  if (typeof value === "bigint") {
    return String(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeBigIntValues(item)) as T;
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      next[key] = normalizeBigIntValues(item);
    }
    return next as T;
  }
  return value;
}

function bytesAt(
  returnValues: Array<[number[], string]>,
  index: number,
): Uint8Array {
  return new Uint8Array(returnValues[index][0]);
}

function decodeReturnedBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return new Uint8Array(value);
  }

  // Some RPC surfaces return BCS bytes as base64.
  if (typeof value === "string" && value.trim()) {
    try {
      return new Uint8Array(Buffer.from(value, "base64"));
    } catch {
      return null;
    }
  }

  return null;
}

function formatAddressFromBytes(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

function toNormalizedAddressOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  try {
    return normalizeSuiAddress(value);
  } catch {
    return undefined;
  }
}

interface MarginNetworkConfig {
  deepbookPackageId: string;
  marginPackageId: string;
  marginRegistryId: string;
  poolAddress: string;
  baseCoinKey: string;
  quoteCoinKey: string;
  baseCoinType: string;
  quoteCoinType: string;
  basePriceInfoObjectId: string;
  quotePriceInfoObjectId: string;
  baseScalar: number;
  quoteScalar: number;
  deepCoinType: string;
  deepScalar: number;
  baseMarginPoolAddress?: string;
  quoteMarginPoolAddress?: string;
}

function getMarginPackageConfig(runtime: TradingRuntime): {
  deepbookPackageId: string;
  marginPackageId: string;
  marginRegistryId: string;
} {
  const packageIds = runtime.network === "mainnet" ? mainnetPackageIds : testnetPackageIds;
  return {
    deepbookPackageId: packageIds.DEEPBOOK_PACKAGE_ID,
    marginPackageId: packageIds.MARGIN_PACKAGE_ID,
    marginRegistryId: packageIds.MARGIN_REGISTRY_ID,
  };
}

function getMarginNetworkConfig(runtime: TradingRuntime, poolKey: string): MarginNetworkConfig {
  const isMainnet = runtime.network === "mainnet";
  const packageIds = getMarginPackageConfig(runtime);
  const pools = isMainnet ? mainnetPools : testnetPools;
  const coins = isMainnet ? mainnetCoins : testnetCoins;
  const marginPools = (isMainnet ? mainnetMarginPools : testnetMarginPools) as Record<
    string,
    { address: string }
  >;

  const pool = pools[poolKey];
  if (!pool) {
    throw new Error(`Unknown pool key "${poolKey}" for network ${runtime.network}.`);
  }

  const baseCoin = coins[pool.baseCoin];
  const quoteCoin = coins[pool.quoteCoin];
  if (!baseCoin || !quoteCoin) {
    throw new Error(`Missing coin metadata for pool "${poolKey}".`);
  }
  if (!baseCoin.priceInfoObjectId || !quoteCoin.priceInfoObjectId) {
    throw new Error(`Missing price feed object IDs for pool "${poolKey}".`);
  }
  const deepCoin = coins.DEEP;
  if (!deepCoin) {
    throw new Error(`Missing DEEP coin metadata for network ${runtime.network}.`);
  }

  const baseMarginPoolAddress = marginPools[pool.baseCoin]?.address;
  const quoteMarginPoolAddress = marginPools[pool.quoteCoin]?.address;

  return {
    deepbookPackageId: packageIds.deepbookPackageId,
    marginPackageId: packageIds.marginPackageId,
    marginRegistryId: packageIds.marginRegistryId,
    poolAddress: pool.address,
    baseCoinKey: pool.baseCoin,
    quoteCoinKey: pool.quoteCoin,
    baseCoinType: baseCoin.type,
    quoteCoinType: quoteCoin.type,
    basePriceInfoObjectId: baseCoin.priceInfoObjectId,
    quotePriceInfoObjectId: quoteCoin.priceInfoObjectId,
    baseScalar: baseCoin.scalar,
    quoteScalar: quoteCoin.scalar,
    deepCoinType: deepCoin.type,
    deepScalar: deepCoin.scalar,
    baseMarginPoolAddress,
    quoteMarginPoolAddress,
  };
}

export async function queryPoolMidPrice(runtime: TradingRuntime, poolKey: string): Promise<number> {
  const network = getMarginNetworkConfig(runtime, poolKey);
  const transaction = new Transaction();
  transaction.moveCall({
    target: `${network.deepbookPackageId}::pool::mid_price`,
    arguments: [transaction.object(network.poolAddress), transaction.object.clock()],
    typeArguments: [network.baseCoinType, network.quoteCoinType],
  });

  const res = await runtime.suiClient.devInspectTransactionBlock({
    sender: runtime.address,
    transactionBlock: transaction,
  });

  const rawBytes = res.results?.[0]?.returnValues?.[0]?.[0];
  if (!Array.isArray(rawBytes)) {
    throw new Error(`Unable to fetch mid price for ${poolKey}.`);
  }

  const rawMidPrice = Number(bcs.U64.parse(new Uint8Array(rawBytes)));
  const adjustedMidPrice = (rawMidPrice * network.baseScalar) / network.quoteScalar / FLOAT_SCALAR;
  if (!Number.isFinite(adjustedMidPrice) || adjustedMidPrice <= 0) {
    throw new Error(`Invalid mid price for ${poolKey}.`);
  }

  return adjustedMidPrice;
}

function decodeMarginManagerIds(bytes: number[]): string[] {
  const parsed = VecSet(bcs.Address).parse(new Uint8Array(bytes));
  if (!parsed || !Array.isArray(parsed.contents)) {
    return [];
  }

  return parsed.contents.map((id) => String(id));
}

function normalizeTypeSignature(input: string | null | undefined): string {
  return (input ?? "").replace(/\s+/g, "").toLowerCase();
}

function marginManagerTypeMatchesPool(
  managerType: string | null | undefined,
  expectedBaseType: string,
  expectedQuoteType: string,
): boolean {
  const normalized = normalizeTypeSignature(managerType);
  const expected = normalizeTypeSignature(
    `::margin_manager::MarginManager<${expectedBaseType},${expectedQuoteType}>`,
  );
  return normalized.includes(expected);
}

export interface LimitOrderOperationInput {
  poolKey: string;
  clientOrderId: string;
  price: number;
  quantity: number;
  isBid: boolean;
  orderType: number;
  selfMatchingOption: number;
  payWithDeep: boolean;
  expiration?: number;
}

export function buildLimitOrderTransaction(
  runtime: TradingRuntime,
  input: LimitOrderOperationInput,
): Transaction {
  const transaction = new Transaction();

  transaction.add(
    runtime.deepBookClient.deepBook.placeLimitOrder({
      poolKey: input.poolKey,
      balanceManagerKey: getManagerKey(runtime),
      clientOrderId: input.clientOrderId,
      price: input.price,
      quantity: input.quantity,
      isBid: input.isBid,
      orderType: input.orderType,
      selfMatchingOption: input.selfMatchingOption,
      payWithDeep: input.payWithDeep,
      ...(input.expiration ? { expiration: input.expiration } : {}),
    }),
  );

  return transaction;
}

export interface MarketOrderOperationInput {
  poolKey: string;
  clientOrderId: string;
  quantity: number;
  isBid: boolean;
  selfMatchingOption: number;
  payWithDeep: boolean;
}

export function buildMarketOrderTransaction(
  runtime: TradingRuntime,
  input: MarketOrderOperationInput,
): Transaction {
  const transaction = new Transaction();

  transaction.add(
    runtime.deepBookClient.deepBook.placeMarketOrder({
      poolKey: input.poolKey,
      balanceManagerKey: getManagerKey(runtime),
      clientOrderId: input.clientOrderId,
      quantity: input.quantity,
      isBid: input.isBid,
      selfMatchingOption: input.selfMatchingOption,
      payWithDeep: input.payWithDeep,
    }),
  );

  return transaction;
}

export interface MarginLimitOrderOperationInput extends LimitOrderOperationInput {
  reduceOnly: boolean;
  collateralBaseAmount?: number;
  collateralQuoteAmount?: number;
  feeBufferBaseAmount?: number;
  feeBufferQuoteAmount?: number;
  feeBufferDeepAmount?: number;
  borrowBaseAmount?: number;
  borrowQuoteAmount?: number;
}

export function buildMarginLimitOrderTransaction(
  runtime: TradingRuntime,
  input: MarginLimitOrderOperationInput,
): Transaction {
  const transaction = new Transaction();
  const marginManagerKey = getMarginManagerKey(runtime);
  const marginManagerId = runtime.marginManagerId;
  const network = getMarginNetworkConfig(runtime, input.poolKey);
  const collateralBaseAmount = input.collateralBaseAmount ?? 0;
  const collateralQuoteAmount = input.collateralQuoteAmount ?? 0;
  const feeBufferBaseAmount = input.feeBufferBaseAmount ?? 0;
  const feeBufferQuoteAmount = input.feeBufferQuoteAmount ?? 0;
  const feeBufferDeepAmount = input.feeBufferDeepAmount ?? 0;
  const borrowBaseAmount = input.borrowBaseAmount ?? 0;
  const borrowQuoteAmount = input.borrowQuoteAmount ?? 0;
  const totalBaseDepositAmount = collateralBaseAmount + feeBufferBaseAmount;
  const totalQuoteDepositAmount = collateralQuoteAmount + feeBufferQuoteAmount;

  if (totalBaseDepositAmount > 0) {
    if (!marginManagerId) {
      throw new Error("Margin manager ID is required for collateral deposits.");
    }
    addMarginDepositMoveCall(
      transaction,
      transaction.object(marginManagerId),
      network,
      network.baseCoinType,
      toRawAmount(totalBaseDepositAmount, network.baseScalar, "base collateral"),
    );
  }

  if (totalQuoteDepositAmount > 0) {
    if (!marginManagerId) {
      throw new Error("Margin manager ID is required for collateral deposits.");
    }
    addMarginDepositMoveCall(
      transaction,
      transaction.object(marginManagerId),
      network,
      network.quoteCoinType,
      toRawAmount(totalQuoteDepositAmount, network.quoteScalar, "quote collateral"),
    );
  }

  if (feeBufferDeepAmount > 0) {
    if (!marginManagerId) {
      throw new Error("Margin manager ID is required for DEEP fee-buffer deposits.");
    }
    addMarginDepositMoveCall(
      transaction,
      transaction.object(marginManagerId),
      network,
      network.deepCoinType,
      toRawAmount(feeBufferDeepAmount, network.deepScalar, "DEEP fee buffer"),
    );
  }

  if (borrowBaseAmount > 0) {
    if (input.isBid) {
      throw new Error("Borrowing base for leverage is only supported for sell-side margin orders.");
    }
    if (input.reduceOnly) {
      throw new Error("Cannot borrow additional base for a reduce-only margin order.");
    }

    transaction.add(runtime.deepBookClient.marginManager.borrowBase(marginManagerKey, borrowBaseAmount));
  }

  if (borrowQuoteAmount > 0) {
    if (!input.isBid) {
      throw new Error("Borrowing quote for leverage is only supported for buy-side margin orders.");
    }
    if (input.reduceOnly) {
      throw new Error("Cannot borrow additional quote for a reduce-only margin order.");
    }

    transaction.add(runtime.deepBookClient.marginManager.borrowQuote(marginManagerKey, borrowQuoteAmount));
  }

  const plugin = input.reduceOnly
    ? runtime.deepBookClient.poolProxy.placeReduceOnlyLimitOrder({
        poolKey: input.poolKey,
        marginManagerKey,
        clientOrderId: input.clientOrderId,
        price: input.price,
        quantity: input.quantity,
        isBid: input.isBid,
        orderType: input.orderType,
        selfMatchingOption: input.selfMatchingOption,
        payWithDeep: input.payWithDeep,
        ...(input.expiration ? { expiration: input.expiration } : {}),
      })
    : runtime.deepBookClient.poolProxy.placeLimitOrder({
        poolKey: input.poolKey,
        marginManagerKey,
        clientOrderId: input.clientOrderId,
        price: input.price,
        quantity: input.quantity,
        isBid: input.isBid,
        orderType: input.orderType,
        selfMatchingOption: input.selfMatchingOption,
        payWithDeep: input.payWithDeep,
        ...(input.expiration ? { expiration: input.expiration } : {}),
      });

  transaction.add(plugin);
  return transaction;
}

export interface MarginSpotOrderOperationInput extends MarketOrderOperationInput {
  reduceOnly: boolean;
  collateralBaseAmount?: number;
  collateralQuoteAmount?: number;
  feeBufferBaseAmount?: number;
  feeBufferQuoteAmount?: number;
  feeBufferDeepAmount?: number;
  borrowBaseAmount?: number;
  borrowQuoteAmount?: number;
}

export function buildMarginSpotOrderTransaction(
  runtime: TradingRuntime,
  input: MarginSpotOrderOperationInput,
): Transaction {
  const transaction = new Transaction();
  const marginManagerKey = getMarginManagerKey(runtime);
  const marginManagerId = runtime.marginManagerId;
  const network = getMarginNetworkConfig(runtime, input.poolKey);
  const collateralBaseAmount = input.collateralBaseAmount ?? 0;
  const collateralQuoteAmount = input.collateralQuoteAmount ?? 0;
  const feeBufferBaseAmount = input.feeBufferBaseAmount ?? 0;
  const feeBufferQuoteAmount = input.feeBufferQuoteAmount ?? 0;
  const feeBufferDeepAmount = input.feeBufferDeepAmount ?? 0;
  const borrowBaseAmount = input.borrowBaseAmount ?? 0;
  const borrowQuoteAmount = input.borrowQuoteAmount ?? 0;
  const totalBaseDepositAmount = collateralBaseAmount + feeBufferBaseAmount;
  const totalQuoteDepositAmount = collateralQuoteAmount + feeBufferQuoteAmount;

  if (totalBaseDepositAmount > 0) {
    if (!marginManagerId) {
      throw new Error("Margin manager ID is required for collateral deposits.");
    }
    addMarginDepositMoveCall(
      transaction,
      transaction.object(marginManagerId),
      network,
      network.baseCoinType,
      toRawAmount(totalBaseDepositAmount, network.baseScalar, "base collateral"),
    );
  }

  if (totalQuoteDepositAmount > 0) {
    if (!marginManagerId) {
      throw new Error("Margin manager ID is required for collateral deposits.");
    }
    addMarginDepositMoveCall(
      transaction,
      transaction.object(marginManagerId),
      network,
      network.quoteCoinType,
      toRawAmount(totalQuoteDepositAmount, network.quoteScalar, "quote collateral"),
    );
  }

  if (feeBufferDeepAmount > 0) {
    if (!marginManagerId) {
      throw new Error("Margin manager ID is required for DEEP fee-buffer deposits.");
    }
    addMarginDepositMoveCall(
      transaction,
      transaction.object(marginManagerId),
      network,
      network.deepCoinType,
      toRawAmount(feeBufferDeepAmount, network.deepScalar, "DEEP fee buffer"),
    );
  }

  if (borrowBaseAmount > 0) {
    if (input.isBid) {
      throw new Error("Borrowing base for leverage is only supported for sell-side margin orders.");
    }
    if (input.reduceOnly) {
      throw new Error("Cannot borrow additional base for a reduce-only margin order.");
    }

    transaction.add(runtime.deepBookClient.marginManager.borrowBase(marginManagerKey, borrowBaseAmount));
  }

  if (borrowQuoteAmount > 0) {
    if (!input.isBid) {
      throw new Error("Borrowing quote for leverage is only supported for buy-side margin orders.");
    }
    if (input.reduceOnly) {
      throw new Error("Cannot borrow additional quote for a reduce-only margin order.");
    }

    transaction.add(runtime.deepBookClient.marginManager.borrowQuote(marginManagerKey, borrowQuoteAmount));
  }

  const plugin = input.reduceOnly
    ? runtime.deepBookClient.poolProxy.placeReduceOnlyMarketOrder({
        poolKey: input.poolKey,
        marginManagerKey,
        clientOrderId: input.clientOrderId,
        quantity: input.quantity,
        isBid: input.isBid,
        selfMatchingOption: input.selfMatchingOption,
        payWithDeep: input.payWithDeep,
      })
    : runtime.deepBookClient.poolProxy.placeMarketOrder({
        poolKey: input.poolKey,
        marginManagerKey,
        clientOrderId: input.clientOrderId,
        quantity: input.quantity,
        isBid: input.isBid,
        selfMatchingOption: input.selfMatchingOption,
        payWithDeep: input.payWithDeep,
      });

  transaction.add(plugin);
  return transaction;
}

function addNewMarginManager(
  runtime: TradingRuntime,
  transaction: Transaction,
  poolKey: string,
): {
  manager: TransactionArgument;
  initializer: TransactionArgument;
} {
  const created = runtime.deepBookClient.marginManager.newMarginManagerWithInitializer(poolKey)(
    transaction,
  ) as unknown as {
    manager: TransactionArgument;
    initializer: TransactionArgument;
  };

  if (!created?.manager || !created?.initializer) {
    throw new Error("Failed to initialize margin manager transaction objects.");
  }

  return created;
}

function toRawAmount(amount: number, scalar: number, field: string): bigint {
  const raw = BigInt(Math.round(amount * scalar));
  if (raw <= 0n) {
    throw new Error(`${field} must be greater than zero.`);
  }
  return raw;
}

function isSuiCoinType(coinType: string): boolean {
  return coinType.trim().toLowerCase().endsWith("::sui::sui");
}

function createCoinForRawAmount(
  transaction: Transaction,
  coinType: string,
  rawAmount: bigint,
): TransactionArgument {
  if (isSuiCoinType(coinType)) {
    return transaction.splitCoins(transaction.gas, [transaction.pure.u64(rawAmount)]);
  }

  return transaction.add(
    coinWithBalance({
      type: coinType,
      balance: rawAmount,
    }),
  );
}

function addMarginDepositMoveCall(
  transaction: Transaction,
  manager: TransactionArgument,
  network: MarginNetworkConfig,
  depositCoinType: string,
  depositRawAmount: bigint,
): void {
  const depositCoin = createCoinForRawAmount(transaction, depositCoinType, depositRawAmount);
  transaction.moveCall({
    target: `${network.marginPackageId}::margin_manager::deposit`,
    arguments: [
      manager,
      transaction.object(network.marginRegistryId),
      transaction.object(network.basePriceInfoObjectId),
      transaction.object(network.quotePriceInfoObjectId),
      depositCoin,
      transaction.object.clock(),
    ],
    typeArguments: [network.baseCoinType, network.quoteCoinType, depositCoinType],
  });
}

interface MarginDepositCoin {
  coinType: string;
  scalar: number;
}

function resolveMarginDepositCoin(
  runtime: TradingRuntime,
  poolKey: string,
  coinInput: string,
): MarginDepositCoin {
  const network = getMarginNetworkConfig(runtime, poolKey);
  const normalizedInput = coinInput.trim();
  const upperInput = normalizedInput.toUpperCase();

  if (upperInput === "BASE" || upperInput === network.baseCoinKey.toUpperCase()) {
    return {
      coinType: network.baseCoinType,
      scalar: network.baseScalar,
    };
  }

  if (upperInput === "QUOTE" || upperInput === network.quoteCoinKey.toUpperCase()) {
    return {
      coinType: network.quoteCoinType,
      scalar: network.quoteScalar,
    };
  }

  if (upperInput === "DEEP") {
    return {
      coinType: network.deepCoinType,
      scalar: network.deepScalar,
    };
  }

  if (normalizedInput === network.baseCoinType) {
    return {
      coinType: network.baseCoinType,
      scalar: network.baseScalar,
    };
  }

  if (normalizedInput === network.quoteCoinType) {
    return {
      coinType: network.quoteCoinType,
      scalar: network.quoteScalar,
    };
  }

  if (normalizedInput === network.deepCoinType) {
    return {
      coinType: network.deepCoinType,
      scalar: network.deepScalar,
    };
  }

  throw new Error(
    `Unsupported margin deposit coin "${coinInput}" for ${poolKey}. Use BASE, QUOTE, DEEP, or pool coin keys ${network.baseCoinKey}/${network.quoteCoinKey}.`,
  );
}

export interface MarginDepositOperationInput {
  poolKey: string;
  coin: string;
  amount: number;
}

export function buildMarginDepositTransaction(
  runtime: TradingRuntime,
  input: MarginDepositOperationInput,
): Transaction {
  if (!runtime.marginManagerId) {
    throw new Error("Margin manager ID is required for margin deposits.");
  }

  const network = getMarginNetworkConfig(runtime, input.poolKey);
  const coin = resolveMarginDepositCoin(runtime, input.poolKey, input.coin);
  const transaction = new Transaction();

  addMarginDepositMoveCall(
    transaction,
    transaction.object(runtime.marginManagerId),
    network,
    coin.coinType,
    toRawAmount(input.amount, coin.scalar, "margin deposit amount"),
  );

  return transaction;
}

export function buildMarginDepositTransactionWithNewManager(
  runtime: TradingRuntime,
  input: MarginDepositOperationInput,
): Transaction {
  const transaction = new Transaction();
  const network = getMarginNetworkConfig(runtime, input.poolKey);
  const created = addNewMarginManager(runtime, transaction, input.poolKey);
  const coin = resolveMarginDepositCoin(runtime, input.poolKey, input.coin);

  addMarginDepositMoveCall(
    transaction,
    created.manager,
    network,
    coin.coinType,
    toRawAmount(input.amount, coin.scalar, "margin deposit amount"),
  );

  transaction.add(
    runtime.deepBookClient.marginManager.shareMarginManager(
      input.poolKey,
      created.manager,
      created.initializer,
    ),
  );

  return transaction;
}

export function buildMarginLimitOrderTransactionWithNewManager(
  runtime: TradingRuntime,
  input: MarginLimitOrderOperationInput,
): Transaction {
  const transaction = new Transaction();
  const network = getMarginNetworkConfig(runtime, input.poolKey);
  const created = addNewMarginManager(runtime, transaction, input.poolKey);
  const inputPrice = Math.round((input.price * FLOAT_SCALAR * network.quoteScalar) / network.baseScalar);
  const inputQuantity = Math.round(input.quantity * network.baseScalar);
  const collateralBaseAmount = input.collateralBaseAmount ?? 0;
  const collateralQuoteAmount = input.collateralQuoteAmount ?? 0;
  const feeBufferBaseAmount = input.feeBufferBaseAmount ?? 0;
  const feeBufferQuoteAmount = input.feeBufferQuoteAmount ?? 0;
  const feeBufferDeepAmount = input.feeBufferDeepAmount ?? 0;
  const borrowBaseAmount = input.borrowBaseAmount ?? 0;
  const borrowQuoteAmount = input.borrowQuoteAmount ?? 0;
  const totalBaseDepositAmount = collateralBaseAmount + feeBufferBaseAmount;
  const totalQuoteDepositAmount = collateralQuoteAmount + feeBufferQuoteAmount;

  if (totalBaseDepositAmount > 0) {
    addMarginDepositMoveCall(
      transaction,
      created.manager,
      network,
      network.baseCoinType,
      toRawAmount(totalBaseDepositAmount, network.baseScalar, "base collateral"),
    );
  }

  if (totalQuoteDepositAmount > 0) {
    addMarginDepositMoveCall(
      transaction,
      created.manager,
      network,
      network.quoteCoinType,
      toRawAmount(totalQuoteDepositAmount, network.quoteScalar, "quote collateral"),
    );
  }

  if (feeBufferDeepAmount > 0) {
    addMarginDepositMoveCall(
      transaction,
      created.manager,
      network,
      network.deepCoinType,
      toRawAmount(feeBufferDeepAmount, network.deepScalar, "DEEP fee buffer"),
    );
  }

  if (borrowBaseAmount > 0) {
    if (input.isBid) {
      throw new Error("Borrowing base for leverage is only supported for sell-side margin orders.");
    }
    if (input.reduceOnly) {
      throw new Error("Cannot borrow additional base for a reduce-only margin order.");
    }
    if (!network.baseMarginPoolAddress) {
      throw new Error(`Margin base pool is not configured for ${input.poolKey}.`);
    }

    transaction.moveCall({
      target: `${network.marginPackageId}::margin_manager::borrow_base`,
      arguments: [
        created.manager,
        transaction.object(network.marginRegistryId),
        transaction.object(network.baseMarginPoolAddress),
        transaction.object(network.basePriceInfoObjectId),
        transaction.object(network.quotePriceInfoObjectId),
        transaction.object(network.poolAddress),
        transaction.pure.u64(toRawAmount(borrowBaseAmount, network.baseScalar, "borrow amount")),
        transaction.object.clock(),
      ],
      typeArguments: [network.baseCoinType, network.quoteCoinType],
    });
  }

  if (borrowQuoteAmount > 0) {
    if (!input.isBid) {
      throw new Error("Borrowing quote for leverage is only supported for buy-side margin orders.");
    }
    if (input.reduceOnly) {
      throw new Error("Cannot borrow additional quote for a reduce-only margin order.");
    }
    if (!network.quoteMarginPoolAddress) {
      throw new Error(`Margin quote pool is not configured for ${input.poolKey}.`);
    }

    transaction.moveCall({
      target: `${network.marginPackageId}::margin_manager::borrow_quote`,
      arguments: [
        created.manager,
        transaction.object(network.marginRegistryId),
        transaction.object(network.quoteMarginPoolAddress),
        transaction.object(network.basePriceInfoObjectId),
        transaction.object(network.quotePriceInfoObjectId),
        transaction.object(network.poolAddress),
        transaction.pure.u64(toRawAmount(borrowQuoteAmount, network.quoteScalar, "borrow amount")),
        transaction.object.clock(),
      ],
      typeArguments: [network.baseCoinType, network.quoteCoinType],
    });
  }

  if (input.reduceOnly) {
    const marginPoolAddress = input.isBid ? network.baseMarginPoolAddress : network.quoteMarginPoolAddress;
    if (!marginPoolAddress) {
      throw new Error(`Margin pool not configured for reduce-only ${input.poolKey}.`);
    }

    const debtCoinType = input.isBid ? network.baseCoinType : network.quoteCoinType;
    transaction.moveCall({
      target: `${network.marginPackageId}::pool_proxy::place_reduce_only_limit_order`,
      arguments: [
        transaction.object(network.marginRegistryId),
        created.manager,
        transaction.object(network.poolAddress),
        transaction.object(marginPoolAddress),
        transaction.pure.u64(input.clientOrderId),
        transaction.pure.u8(input.orderType),
        transaction.pure.u8(input.selfMatchingOption),
        transaction.pure.u64(inputPrice),
        transaction.pure.u64(inputQuantity),
        transaction.pure.bool(input.isBid),
        transaction.pure.bool(input.payWithDeep),
        transaction.pure.u64(input.expiration ?? 18446744073709551615n),
        transaction.object.clock(),
      ],
      typeArguments: [network.baseCoinType, network.quoteCoinType, debtCoinType],
    });
  } else {
    transaction.moveCall({
      target: `${network.marginPackageId}::pool_proxy::place_limit_order`,
      arguments: [
        transaction.object(network.marginRegistryId),
        created.manager,
        transaction.object(network.poolAddress),
        transaction.pure.u64(input.clientOrderId),
        transaction.pure.u8(input.orderType),
        transaction.pure.u8(input.selfMatchingOption),
        transaction.pure.u64(inputPrice),
        transaction.pure.u64(inputQuantity),
        transaction.pure.bool(input.isBid),
        transaction.pure.bool(input.payWithDeep),
        transaction.pure.u64(input.expiration ?? 18446744073709551615n),
        transaction.object.clock(),
      ],
      typeArguments: [network.baseCoinType, network.quoteCoinType],
    });
  }

  transaction.add(
    runtime.deepBookClient.marginManager.shareMarginManager(
      input.poolKey,
      created.manager,
      created.initializer,
    ),
  );

  return transaction;
}

export function buildMarginSpotOrderTransactionWithNewManager(
  runtime: TradingRuntime,
  input: MarginSpotOrderOperationInput,
): Transaction {
  const transaction = new Transaction();
  const network = getMarginNetworkConfig(runtime, input.poolKey);
  const created = addNewMarginManager(runtime, transaction, input.poolKey);
  const inputQuantity = Math.round(input.quantity * network.baseScalar);
  const collateralBaseAmount = input.collateralBaseAmount ?? 0;
  const collateralQuoteAmount = input.collateralQuoteAmount ?? 0;
  const feeBufferBaseAmount = input.feeBufferBaseAmount ?? 0;
  const feeBufferQuoteAmount = input.feeBufferQuoteAmount ?? 0;
  const feeBufferDeepAmount = input.feeBufferDeepAmount ?? 0;
  const borrowBaseAmount = input.borrowBaseAmount ?? 0;
  const borrowQuoteAmount = input.borrowQuoteAmount ?? 0;
  const totalBaseDepositAmount = collateralBaseAmount + feeBufferBaseAmount;
  const totalQuoteDepositAmount = collateralQuoteAmount + feeBufferQuoteAmount;

  if (totalBaseDepositAmount > 0) {
    addMarginDepositMoveCall(
      transaction,
      created.manager,
      network,
      network.baseCoinType,
      toRawAmount(totalBaseDepositAmount, network.baseScalar, "base collateral"),
    );
  }

  if (totalQuoteDepositAmount > 0) {
    addMarginDepositMoveCall(
      transaction,
      created.manager,
      network,
      network.quoteCoinType,
      toRawAmount(totalQuoteDepositAmount, network.quoteScalar, "quote collateral"),
    );
  }

  if (feeBufferDeepAmount > 0) {
    addMarginDepositMoveCall(
      transaction,
      created.manager,
      network,
      network.deepCoinType,
      toRawAmount(feeBufferDeepAmount, network.deepScalar, "DEEP fee buffer"),
    );
  }

  if (borrowBaseAmount > 0) {
    if (input.isBid) {
      throw new Error("Borrowing base for leverage is only supported for sell-side margin orders.");
    }
    if (input.reduceOnly) {
      throw new Error("Cannot borrow additional base for a reduce-only margin order.");
    }
    if (!network.baseMarginPoolAddress) {
      throw new Error(`Margin base pool is not configured for ${input.poolKey}.`);
    }

    transaction.moveCall({
      target: `${network.marginPackageId}::margin_manager::borrow_base`,
      arguments: [
        created.manager,
        transaction.object(network.marginRegistryId),
        transaction.object(network.baseMarginPoolAddress),
        transaction.object(network.basePriceInfoObjectId),
        transaction.object(network.quotePriceInfoObjectId),
        transaction.object(network.poolAddress),
        transaction.pure.u64(toRawAmount(borrowBaseAmount, network.baseScalar, "borrow amount")),
        transaction.object.clock(),
      ],
      typeArguments: [network.baseCoinType, network.quoteCoinType],
    });
  }

  if (borrowQuoteAmount > 0) {
    if (!input.isBid) {
      throw new Error("Borrowing quote for leverage is only supported for buy-side margin orders.");
    }
    if (input.reduceOnly) {
      throw new Error("Cannot borrow additional quote for a reduce-only margin order.");
    }
    if (!network.quoteMarginPoolAddress) {
      throw new Error(`Margin quote pool is not configured for ${input.poolKey}.`);
    }

    transaction.moveCall({
      target: `${network.marginPackageId}::margin_manager::borrow_quote`,
      arguments: [
        created.manager,
        transaction.object(network.marginRegistryId),
        transaction.object(network.quoteMarginPoolAddress),
        transaction.object(network.basePriceInfoObjectId),
        transaction.object(network.quotePriceInfoObjectId),
        transaction.object(network.poolAddress),
        transaction.pure.u64(toRawAmount(borrowQuoteAmount, network.quoteScalar, "borrow amount")),
        transaction.object.clock(),
      ],
      typeArguments: [network.baseCoinType, network.quoteCoinType],
    });
  }

  if (input.reduceOnly) {
    const marginPoolAddress = input.isBid ? network.baseMarginPoolAddress : network.quoteMarginPoolAddress;
    if (!marginPoolAddress) {
      throw new Error(`Margin pool not configured for reduce-only ${input.poolKey}.`);
    }

    const debtCoinType = input.isBid ? network.baseCoinType : network.quoteCoinType;
    transaction.moveCall({
      target: `${network.marginPackageId}::pool_proxy::place_reduce_only_market_order`,
      arguments: [
        transaction.object(network.marginRegistryId),
        created.manager,
        transaction.object(network.poolAddress),
        transaction.object(marginPoolAddress),
        transaction.pure.u64(input.clientOrderId),
        transaction.pure.u8(input.selfMatchingOption),
        transaction.pure.u64(inputQuantity),
        transaction.pure.bool(input.isBid),
        transaction.pure.bool(input.payWithDeep),
        transaction.object.clock(),
      ],
      typeArguments: [network.baseCoinType, network.quoteCoinType, debtCoinType],
    });
  } else {
    transaction.moveCall({
      target: `${network.marginPackageId}::pool_proxy::place_market_order`,
      arguments: [
        transaction.object(network.marginRegistryId),
        created.manager,
        transaction.object(network.poolAddress),
        transaction.pure.u64(input.clientOrderId),
        transaction.pure.u8(input.selfMatchingOption),
        transaction.pure.u64(inputQuantity),
        transaction.pure.bool(input.isBid),
        transaction.pure.bool(input.payWithDeep),
        transaction.object.clock(),
      ],
      typeArguments: [network.baseCoinType, network.quoteCoinType],
    });
  }

  transaction.add(
    runtime.deepBookClient.marginManager.shareMarginManager(
      input.poolKey,
      created.manager,
      created.initializer,
    ),
  );

  return transaction;
}

export async function queryMarginManagerIdsForOwner(
  runtime: TradingRuntime,
  owner: string = runtime.address,
): Promise<string[]> {
  const network = getMarginPackageConfig(runtime);
  const transaction = new Transaction();
  transaction.moveCall({
    target: `${network.marginPackageId}::margin_registry::get_margin_manager_ids`,
    arguments: [transaction.object(network.marginRegistryId), transaction.pure.address(owner)],
    typeArguments: [],
  });

  const result = await runtime.suiClient.devInspectTransactionBlock({
    sender: runtime.address,
    transactionBlock: transaction,
  });

  const returnValues = result.results?.[0]?.returnValues;
  const raw = Array.isArray(returnValues) && Array.isArray(returnValues[0]) ? returnValues[0][0] : undefined;
  const bytes = decodeReturnedBytes(raw);
  if (!bytes) {
    return [];
  }

  return decodeMarginManagerIds(Array.from(bytes));
}

export async function queryBalanceManagerIdsForOwner(
  runtime: TradingRuntime,
  owner: string = runtime.address,
): Promise<string[]> {
  const normalizedOwner = normalizeSuiAddress(owner);
  const transaction = new Transaction();
  transaction.add(runtime.deepBookClient.deepBook.getBalanceManagerIds(normalizedOwner));

  const result = await runtime.suiClient.devInspectTransactionBlock({
    sender: runtime.address,
    transactionBlock: transaction,
  });

  const raw = result.results?.[0]?.returnValues?.[0]?.[0];
  const bytes = decodeReturnedBytes(raw);
  if (!bytes) {
    return [];
  }

  const registryIds = bcs.vector(bcs.Address).parse(bytes).map((id) => normalizeSuiAddress(String(id)));
  const eventIds = await queryBalanceManagerIdsFromCreationEvents(runtime, normalizedOwner);

  const merged = new Set<string>([...registryIds, ...eventIds]);
  return [...merged].sort((a, b) => a.localeCompare(b));
}

async function queryBalanceManagerIdsFromCreationEvents(
  runtime: TradingRuntime,
  owner: string,
): Promise<string[]> {
  const queryTxBlocks = (runtime.suiClient as { queryTransactionBlocks?: unknown }).queryTransactionBlocks;
  if (typeof queryTxBlocks !== "function") {
    return [];
  }

  const targetOwner = normalizeSuiAddress(owner);
  const result = new Set<string>();

  let cursor: string | null = null;
  for (let page = 0; page < 200; page += 1) {
    const response = (await runtime.suiClient.queryTransactionBlocks({
      filter: {
        FromAddress: targetOwner,
      },
      options: {
        showEvents: true,
      },
      cursor: cursor ?? undefined,
      limit: 50,
      order: "descending",
    })) as {
      data?: Array<{
        events?: Array<{ parsedJson?: Record<string, unknown>; type?: string }>;
      }>;
      hasNextPage?: boolean;
      nextCursor?: string | null;
    };

    for (const tx of response.data ?? []) {
      for (const event of tx.events ?? []) {
        if (!String(event.type ?? "").includes("::balance_manager::BalanceManagerEvent")) {
          continue;
        }

        const parsed = event.parsedJson ?? {};
        const eventOwner = toNormalizedAddressOrUndefined(parsed.owner);
        if (eventOwner !== targetOwner) {
          continue;
        }

        const managerId = toNormalizedAddressOrUndefined(parsed.balance_manager_id);
        if (managerId) {
          result.add(managerId);
        }
      }
    }

    if (!response.hasNextPage || !response.nextCursor) {
      break;
    }
    cursor = response.nextCursor;
  }

  return [...result];
}

export async function findMarginManagerIdForPool(
  runtime: TradingRuntime,
  poolKey: string,
  owner: string = runtime.address,
): Promise<string | undefined> {
  const managerIds = await queryMarginManagerIdsForOwner(runtime, owner);
  if (managerIds.length === 0) {
    return undefined;
  }

  const network = getMarginNetworkConfig(runtime, poolKey);
  const managers = await runtime.suiClient.multiGetObjects({
    ids: managerIds,
    options: { showType: true },
  });

  for (const manager of managers) {
    const managerId = manager.data?.objectId;
    const managerType = manager.data?.type;
    if (!managerId) continue;

    if (marginManagerTypeMatchesPool(managerType, network.baseCoinType, network.quoteCoinType)) {
      return managerId;
    }
  }

  return undefined;
}

export async function isMarginManagerCompatibleWithPool(
  runtime: TradingRuntime,
  poolKey: string,
  marginManagerId: string,
  owner: string = runtime.address,
): Promise<boolean> {
  const network = getMarginNetworkConfig(runtime, poolKey);
  const normalizedManagerId = normalizeSuiAddress(marginManagerId);
  const normalizedOwner = normalizeSuiAddress(owner);

  let response:
    | {
        data?: {
          type?: string | null;
          content?: {
            dataType?: string;
            fields?: Record<string, unknown>;
          } | null;
        } | null;
      }
    | undefined;
  try {
    response = (await runtime.suiClient.getObject({
      id: normalizedManagerId,
      options: {
        showType: true,
        showContent: true,
      },
    })) as {
      data?: {
        type?: string | null;
        content?: {
          dataType?: string;
          fields?: Record<string, unknown>;
        } | null;
      } | null;
    };
  } catch {
    return false;
  }

  const data = response?.data;
  if (!data) {
    return false;
  }

  if (!marginManagerTypeMatchesPool(data.type, network.baseCoinType, network.quoteCoinType)) {
    return false;
  }

  const fields =
    data.content?.dataType === "moveObject" && data.content.fields
      ? data.content.fields
      : undefined;
  if (!fields) {
    return false;
  }

  const managerOwner = toNormalizedAddressOrUndefined(fields.owner);
  if (managerOwner && managerOwner !== normalizedOwner) {
    return false;
  }

  const managerPoolId = toNormalizedAddressOrUndefined(fields.deepbook_pool);
  if (managerPoolId && managerPoolId !== normalizeSuiAddress(network.poolAddress)) {
    return false;
  }

  return true;
}

export interface CancelOrderOperationInput {
  poolKey: string;
  orderId: string;
}

export function buildCancelOrderTransaction(
  runtime: TradingRuntime,
  input: CancelOrderOperationInput,
): Transaction {
  const transaction = new Transaction();

  transaction.add(
    runtime.deepBookClient.deepBook.cancelOrder(
      input.poolKey,
      getManagerKey(runtime),
      input.orderId,
    ),
  );

  return transaction;
}

export interface SwapOperationInput {
  poolKey: string;
  amount: number;
  minOut: number;
  deepAmount: number;
}

export function buildSwapBaseForQuoteTransaction(
  runtime: TradingRuntime,
  input: SwapOperationInput,
): Transaction {
  const transaction = new Transaction();

  const swapResult = transaction.add(
    runtime.deepBookClient.deepBook.swapExactBaseForQuote({
      poolKey: input.poolKey,
      amount: input.amount,
      minOut: input.minOut,
      deepAmount: input.deepAmount,
    }),
  );

  if (Array.isArray(swapResult) && swapResult.length > 0) {
    transaction.transferObjects(swapResult, runtime.address);
  }

  return transaction;
}

export function buildSwapQuoteForBaseTransaction(
  runtime: TradingRuntime,
  input: SwapOperationInput,
): Transaction {
  const transaction = new Transaction();

  const swapResult = transaction.add(
    runtime.deepBookClient.deepBook.swapExactQuoteForBase({
      poolKey: input.poolKey,
      amount: input.amount,
      minOut: input.minOut,
      deepAmount: input.deepAmount,
    }),
  );

  if (Array.isArray(swapResult) && swapResult.length > 0) {
    transaction.transferObjects(swapResult, runtime.address);
  }

  return transaction;
}

export function buildCreateManagerTransaction(runtime: TradingRuntime): Transaction {
  const transaction = new Transaction();
  transaction.add(runtime.deepBookClient.balanceManager.createAndShareBalanceManager());
  return transaction;
}

export interface DepositOperationInput {
  coin: string;
  amount: number;
}

export function buildDepositTransaction(
  runtime: TradingRuntime,
  input: DepositOperationInput,
): Transaction {
  const transaction = new Transaction();
  const coinKey = input.coin.trim().toUpperCase();
  const coinConfig = (runtime.network === "mainnet" ? mainnetCoins : testnetCoins)[coinKey];
  const packageIds = runtime.network === "mainnet" ? mainnetPackageIds : testnetPackageIds;

  if (coinKey === "SUI") {
    if (!runtime.balanceManagerId) {
      throw new Error("Balance manager ID is required for SUI deposits.");
    }
    if (!coinConfig) {
      throw new Error(`Unknown coin key "${input.coin}".`);
    }

    const depositCoin = createCoinForRawAmount(
      transaction,
      coinConfig.type,
      toRawAmount(input.amount, coinConfig.scalar, "amount"),
    );
    transaction.moveCall({
      target: `${packageIds.DEEPBOOK_PACKAGE_ID}::balance_manager::deposit`,
      arguments: [transaction.object(runtime.balanceManagerId), depositCoin],
      typeArguments: [coinConfig.type],
    });
  } else {
    transaction.add(
      runtime.deepBookClient.balanceManager.depositIntoManager(
        getManagerKey(runtime),
        input.coin,
        input.amount,
      ),
    );
  }

  return transaction;
}

export interface WithdrawOperationInput {
  coin: string;
  amount: number;
  recipient: string;
}

export function buildWithdrawTransaction(
  runtime: TradingRuntime,
  input: WithdrawOperationInput,
): Transaction {
  const transaction = new Transaction();

  transaction.add(
    runtime.deepBookClient.balanceManager.withdrawFromManager(
      getManagerKey(runtime),
      input.coin,
      input.amount,
      input.recipient,
    ),
  );

  return transaction;
}

export interface MarginOpenOrderSummary {
  orderId: string;
  clientOrderId: string;
  quantityRaw: string;
  filledQuantityRaw: string;
  remainingQuantityRaw: string;
  status: number;
  expiresAt: string;
}

export interface MarginPositionSummary {
  managerState: Record<string, unknown>;
  openOrderCount: number;
  openOrders: MarginOpenOrderSummary[];
}

export interface MarginStateAmounts {
  baseAssetRaw: bigint;
  quoteAssetRaw: bigint;
  baseDebtRaw: bigint;
  quoteDebtRaw: bigint;
  baseAsset: number;
  quoteAsset: number;
  baseDebt: number;
  quoteDebt: number;
}

export interface PoolBookParamsSummary {
  tickSizeRaw: string;
  lotSizeRaw: string;
  minSizeRaw: string;
  lotSize: number;
  minSize: number;
}

export async function queryPoolBookParams(
  runtime: TradingRuntime,
  poolKey: string,
): Promise<PoolBookParamsSummary> {
  const network = getMarginNetworkConfig(runtime, poolKey);
  const transaction = new Transaction();
  transaction.moveCall({
    target: `${network.deepbookPackageId}::pool::pool_book_params`,
    arguments: [transaction.object(network.poolAddress)],
    typeArguments: [network.baseCoinType, network.quoteCoinType],
  });

  const result = await runtime.suiClient.devInspectTransactionBlock({
    sender: runtime.address,
    transactionBlock: transaction,
  });

  const returnValues = result.results?.[0]?.returnValues as
    | Array<[number[], string]>
    | undefined;
  if (!returnValues || returnValues.length < 3) {
    throw new Error(`Failed to fetch pool book params for ${poolKey}.`);
  }

  const tickSizeRaw = bcs.U64.parse(new Uint8Array(returnValues[0][0]));
  const lotSizeRaw = bcs.U64.parse(new Uint8Array(returnValues[1][0]));
  const minSizeRaw = bcs.U64.parse(new Uint8Array(returnValues[2][0]));

  return {
    tickSizeRaw: tickSizeRaw.toString(),
    lotSizeRaw: lotSizeRaw.toString(),
    minSizeRaw: minSizeRaw.toString(),
    lotSize: Number(lotSizeRaw) / network.baseScalar,
    minSize: Number(minSizeRaw) / network.baseScalar,
  };
}

export function getMarginStateAmounts(
  runtime: TradingRuntime,
  poolKey: string,
  managerState: Record<string, unknown>,
): MarginStateAmounts {
  const network = getMarginNetworkConfig(runtime, poolKey);
  const baseAssetRaw = toBigIntSafe(managerState.baseAsset);
  const quoteAssetRaw = toBigIntSafe(managerState.quoteAsset);
  const baseDebtRaw = toBigIntSafe(managerState.baseDebt);
  const quoteDebtRaw = toBigIntSafe(managerState.quoteDebt);

  return {
    baseAssetRaw,
    quoteAssetRaw,
    baseDebtRaw,
    quoteDebtRaw,
    baseAsset: Number(baseAssetRaw) / network.baseScalar,
    quoteAsset: Number(quoteAssetRaw) / network.quoteScalar,
    baseDebt: Number(baseDebtRaw) / network.baseScalar,
    quoteDebt: Number(quoteDebtRaw) / network.quoteScalar,
  };
}

export interface MarginCloseTransactionInput {
  poolKey: string;
  clientOrderId: string;
  quantity?: number;
  isBid?: boolean;
  reduceOnly: boolean;
  selfMatchingOption: number;
  payWithDeep: boolean;
  repayBaseDebt: boolean;
  repayQuoteDebt: boolean;
}

export function buildMarginCloseTransaction(
  runtime: TradingRuntime,
  input: MarginCloseTransactionInput,
): Transaction {
  const transaction = new Transaction();
  const marginManagerKey = getMarginManagerKey(runtime);

  if (input.quantity && input.quantity > 0) {
    if (typeof input.isBid !== "boolean") {
      throw new Error("Close order side is required when quantity is provided.");
    }

    const plugin = input.reduceOnly
      ? runtime.deepBookClient.poolProxy.placeReduceOnlyMarketOrder({
          poolKey: input.poolKey,
          marginManagerKey,
          clientOrderId: input.clientOrderId,
          quantity: input.quantity,
          isBid: input.isBid,
          selfMatchingOption: input.selfMatchingOption,
          payWithDeep: input.payWithDeep,
        })
      : runtime.deepBookClient.poolProxy.placeMarketOrder({
          poolKey: input.poolKey,
          marginManagerKey,
          clientOrderId: input.clientOrderId,
          quantity: input.quantity,
          isBid: input.isBid,
          selfMatchingOption: input.selfMatchingOption,
          payWithDeep: input.payWithDeep,
        });

    transaction.add(plugin);
  }

  if (input.repayQuoteDebt) {
    transaction.add(runtime.deepBookClient.marginManager.repayQuote(marginManagerKey));
  }

  if (input.repayBaseDebt) {
    transaction.add(runtime.deepBookClient.marginManager.repayBase(marginManagerKey));
  }

  return transaction;
}

export interface MarginWithdrawTransactionInput {
  baseAmount?: number;
  quoteAmount?: number;
}

export function buildMarginWithdrawTransaction(
  runtime: TradingRuntime,
  input: MarginWithdrawTransactionInput,
): Transaction {
  const transaction = new Transaction();
  const marginManagerKey = getMarginManagerKey(runtime);

  if (input.baseAmount && input.baseAmount > 0) {
    const baseCoin = transaction.add(
      runtime.deepBookClient.marginManager.withdrawBase(marginManagerKey, input.baseAmount),
    );
    transaction.transferObjects([baseCoin], runtime.address);
  }

  if (input.quoteAmount && input.quoteAmount > 0) {
    const quoteCoin = transaction.add(
      runtime.deepBookClient.marginManager.withdrawQuote(marginManagerKey, input.quoteAmount),
    );
    transaction.transferObjects([quoteCoin], runtime.address);
  }

  return transaction;
}

export async function queryMarginPosition(runtime: TradingRuntime): Promise<MarginPositionSummary> {
  const marginManagerKey = getMarginManagerKey(runtime);
  if (runtime.marginManagerId && runtime.marginPoolKey) {
    const network = getMarginNetworkConfig(runtime, runtime.marginPoolKey);
    if (!network.baseMarginPoolAddress || !network.quoteMarginPoolAddress) {
      throw new Error(`Margin pools are not configured for ${runtime.marginPoolKey}.`);
    }

    const managerStateTx = new Transaction();
    managerStateTx.moveCall({
      target: `${network.marginPackageId}::margin_manager::manager_state`,
      arguments: [
        managerStateTx.object(runtime.marginManagerId),
        managerStateTx.object(network.marginRegistryId),
        managerStateTx.object(network.basePriceInfoObjectId),
        managerStateTx.object(network.quotePriceInfoObjectId),
        managerStateTx.object(network.poolAddress),
        managerStateTx.object(network.baseMarginPoolAddress),
        managerStateTx.object(network.quoteMarginPoolAddress),
        managerStateTx.object.clock(),
      ],
      typeArguments: [network.baseCoinType, network.quoteCoinType],
    });

    const ordersTx = new Transaction();
    ordersTx.add(
      runtime.deepBookClient.marginManager.getMarginAccountOrderDetails(
        runtime.marginPoolKey,
        runtime.marginManagerId,
      ),
    );

    const [managerStateRes, ordersRes] = await Promise.all([
      runtime.suiClient.devInspectTransactionBlock({
        sender: runtime.address,
        transactionBlock: managerStateTx,
      }),
      runtime.suiClient.devInspectTransactionBlock({
        sender: runtime.address,
        transactionBlock: ordersTx,
      }),
    ]);

    const returnValues = managerStateRes.results?.[0]?.returnValues as
      | Array<[number[], string]>
      | undefined;
    if (!returnValues || returnValues.length < 14) {
      throw new Error("Failed to decode margin manager state.");
    }

    const managerState = {
      managerId: formatAddressFromBytes(bytesAt(returnValues, 0)),
      deepbookPoolId: formatAddressFromBytes(bytesAt(returnValues, 1)),
      riskRatio: Number(bcs.U64.parse(bytesAt(returnValues, 2))) / FLOAT_SCALAR,
      baseAsset: bcs.U64.parse(bytesAt(returnValues, 3)).toString(),
      quoteAsset: bcs.U64.parse(bytesAt(returnValues, 4)).toString(),
      baseDebt: bcs.U64.parse(bytesAt(returnValues, 5)).toString(),
      quoteDebt: bcs.U64.parse(bytesAt(returnValues, 6)).toString(),
      basePythPrice: bcs.U64.parse(bytesAt(returnValues, 7)).toString(),
      basePythDecimals: Number(bcs.u8().parse(bytesAt(returnValues, 8))),
      quotePythPrice: bcs.U64.parse(bytesAt(returnValues, 9)).toString(),
      quotePythDecimals: Number(bcs.u8().parse(bytesAt(returnValues, 10))),
      currentPrice: BigInt(bcs.U64.parse(bytesAt(returnValues, 11))),
      lowestTriggerAbovePrice: BigInt(bcs.U64.parse(bytesAt(returnValues, 12))),
      highestTriggerBelowPrice: BigInt(bcs.U64.parse(bytesAt(returnValues, 13))),
    };

    let ordersRaw: Array<Record<string, unknown>> = [];
    try {
      const orderBytes = ordersRes.results?.[1]?.returnValues?.[0]?.[0] as number[] | undefined;
      if (Array.isArray(orderBytes)) {
        ordersRaw = bcs.vector(Order).parse(new Uint8Array(orderBytes)) as Array<Record<string, unknown>>;
      }
    } catch {
      ordersRaw = [];
    }

    const openOrders: MarginOpenOrderSummary[] = ordersRaw.map((order: Record<string, unknown>) => {
      const quantity = toBigIntSafe(order.quantity);
      const filledQuantity = toBigIntSafe(order.filled_quantity);
      const remaining = quantity > filledQuantity ? quantity - filledQuantity : 0n;

      return {
        orderId: toBigIntSafe(order.order_id).toString(),
        clientOrderId: toBigIntSafe(order.client_order_id).toString(),
        quantityRaw: quantity.toString(),
        filledQuantityRaw: filledQuantity.toString(),
        remainingQuantityRaw: remaining.toString(),
        status: Number(order.status ?? 0),
        expiresAt: toBigIntSafe(order.expire_timestamp).toString(),
      };
    });

    return {
      managerState: normalizeBigIntValues(managerState) as Record<string, unknown>,
      openOrderCount: openOrders.length,
      openOrders,
    };
  }

  const [managerState, ordersRaw] = await Promise.all([
    runtime.deepBookClient.getMarginManagerState(marginManagerKey),
    runtime.deepBookClient.getMarginAccountOrderDetails(marginManagerKey),
  ]);

  const openOrders: MarginOpenOrderSummary[] = (Array.isArray(ordersRaw) ? ordersRaw : []).map(
    (order: Record<string, unknown>) => {
      const quantity = toBigIntSafe(order.quantity);
      const filledQuantity = toBigIntSafe(order.filled_quantity);
      const remaining = quantity > filledQuantity ? quantity - filledQuantity : 0n;

      return {
        orderId: toBigIntSafe(order.order_id).toString(),
        clientOrderId: toBigIntSafe(order.client_order_id).toString(),
        quantityRaw: quantity.toString(),
        filledQuantityRaw: filledQuantity.toString(),
        remainingQuantityRaw: remaining.toString(),
        status: Number(order.status ?? 0),
        expiresAt: toBigIntSafe(order.expire_timestamp).toString(),
      };
    },
  );

  return {
    managerState: normalizeBigIntValues(managerState) as Record<string, unknown>,
    openOrderCount: openOrders.length,
    openOrders,
  };
}

export async function queryManagerBalance(
  runtime: TradingRuntime,
  coin: string,
): Promise<{ coinType: string; balance: number; balanceRaw: string }> {
  const coinKey = coin.trim().toUpperCase();
  const coinConfig = (runtime.network === "mainnet" ? mainnetCoins : testnetCoins)[coinKey];
  if (!coinConfig) {
    throw new Error(
      `Unknown coin key "${coin}". Use a configured key such as SUI, USDC, or DEEP.`,
    );
  }

  const transaction = new Transaction();
  transaction.add(runtime.deepBookClient.balanceManager.checkManagerBalance(getManagerKey(runtime), coinKey));

  const result = await runtime.suiClient.devInspectTransactionBlock({
    sender: runtime.address,
    transactionBlock: transaction,
  });

  if (result.error) {
    const errorText =
      typeof result.error === "string" ? result.error : JSON.stringify(result.error);
    if (errorText.includes("TypeMismatch")) {
      const managerHint = runtime.balanceManagerId
        ? ` (${runtime.balanceManagerId})`
        : "";
      throw new Error(
        `Manager object${managerHint} is not a DeepBook balance manager. ` +
          "If this is a margin manager, use `deepbook margin position <pool> --margin-manager <id>` instead.",
      );
    }

    throw new Error(
      `Failed to read manager balance: ${errorText}`,
    );
  }

  const raw = result.results
    ?.flatMap((entry) => entry.returnValues ?? [])
    .map((value) => value[0])
    .find((value) => Array.isArray(value));

  if (!Array.isArray(raw)) {
    throw new Error(
      "Failed to read manager balance. Ensure --manager points to a DeepBook balance manager object ID.",
    );
  }

  const balanceRaw = bcs.U64.parse(new Uint8Array(raw));
  const adjustedBalance = Number(balanceRaw) / coinConfig.scalar;

  return {
    coinType: coinConfig.type,
    balance: Number(adjustedBalance.toFixed(9)),
    balanceRaw: balanceRaw.toString(),
  };
}
