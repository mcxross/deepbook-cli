import {
  DeepBookClient,
  OrderType,
  SelfMatchingOptions,
  type BalanceManager,
  type MarginManager,
} from "@mysten/deepbook-v3";
import { decodeSuiPrivateKey, type Keypair } from "@mysten/sui/cryptography";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1Keypair } from "@mysten/sui/keypairs/secp256r1";
import { Transaction } from "@mysten/sui/transactions";
import {
  parseDeeptradeNetwork,
  type DeeptradeNetwork as DeepBookNetwork,
} from "./deepbook-config.js";

export const DEFAULT_BALANCE_MANAGER_KEY = "ACTIVE";
export const DEFAULT_MARGIN_MANAGER_KEY = "ACTIVE_MARGIN";

export interface TradingRuntimeOptions {
  network: string;
  rpcUrl?: string;
  privateKey?: string;
  address?: string;
  balanceManagerId?: string;
  tradeCap?: string;
  marginManagerId?: string;
  marginPoolKey?: string;
}

export interface TradingRuntime {
  network: DeepBookNetwork;
  rpcUrl: string;
  address: string;
  keypair?: Keypair;
  balanceManagerKey?: string;
  balanceManagerId?: string;
  marginManagerKey?: string;
  marginManagerId?: string;
  marginPoolKey?: string;
  suiClient: SuiJsonRpcClient;
  deepBookClient: DeepBookClient;
}

interface DryRunAbortError {
  module_id?: string;
  function?: string;
  error_code?: number;
}

interface DryRunEffectsStatus {
  status?: string;
  error?: string;
}

interface DryRunEffects {
  status?: DryRunEffectsStatus;
  abortError?: DryRunAbortError;
}

interface DryRunResultLike {
  effects?: DryRunEffects;
}

function normalizeOptionalValue(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseDeepBookNetwork(input: string): DeepBookNetwork {
  return parseDeeptradeNetwork(input);
}

function buildKeypair(privateKey: string): Keypair {
  const parsed = decodeSuiPrivateKey(privateKey);

  switch (parsed.scheme) {
    case "ED25519":
      return Ed25519Keypair.fromSecretKey(parsed.secretKey);
    case "Secp256k1":
      return Secp256k1Keypair.fromSecretKey(parsed.secretKey);
    case "Secp256r1":
      return Secp256r1Keypair.fromSecretKey(parsed.secretKey);
    default:
      throw new Error(`Unsupported key scheme: ${parsed.scheme}`);
  }
}

function buildBalanceManagers(
  balanceManagerId?: string,
  tradeCap?: string,
): Record<string, BalanceManager> | undefined {
  if (!balanceManagerId) {
    return undefined;
  }

  return {
    [DEFAULT_BALANCE_MANAGER_KEY]: {
      address: balanceManagerId,
      ...(tradeCap ? { tradeCap } : {}),
    },
  };
}

function buildMarginManagers(
  marginManagerIdInput?: string,
  marginPoolKeyInput?: string,
): Record<string, MarginManager> | undefined {
  const marginManagerId = normalizeOptionalValue(marginManagerIdInput);
  const marginPoolKey = normalizeOptionalValue(marginPoolKeyInput);

  if (!marginManagerId && !marginPoolKey) {
    return undefined;
  }

  if (!marginManagerId || !marginPoolKey) {
    throw new Error(
      "Margin runtime requires both margin manager ID and pool key. Pass --margin-manager and a pool key.",
    );
  }

  return {
    [DEFAULT_MARGIN_MANAGER_KEY]: {
      address: marginManagerId,
      poolKey: marginPoolKey,
    },
  };
}

export function createTradingRuntime(options: TradingRuntimeOptions): TradingRuntime {
  const network = parseDeepBookNetwork(options.network);
  const rpcUrl = normalizeOptionalValue(options.rpcUrl) ?? getJsonRpcFullnodeUrl(network);
  const privateKey = normalizeOptionalValue(options.privateKey);
  const keypair = privateKey ? buildKeypair(privateKey) : undefined;
  const address = normalizeOptionalValue(options.address) ?? keypair?.toSuiAddress();

  if (!address) {
    throw new Error(
      "Missing wallet identity. Import an account with \"deepbook account import <alias> [privateKey]\" or pass --private-key/--address.",
    );
  }

  const balanceManagerId = normalizeOptionalValue(options.balanceManagerId);
  const tradeCap = normalizeOptionalValue(options.tradeCap);
  const balanceManagers = buildBalanceManagers(balanceManagerId, tradeCap);
  const marginManagers = buildMarginManagers(options.marginManagerId, options.marginPoolKey);
  const marginManagerId = normalizeOptionalValue(options.marginManagerId);
  const marginPoolKey = normalizeOptionalValue(options.marginPoolKey);

  const suiClient = new SuiJsonRpcClient({
    network,
    url: rpcUrl,
  });

  const deepBookClient = new DeepBookClient({
    client: suiClient,
    network,
    address,
    balanceManagers,
    marginManagers,
  });

  return {
    network,
    rpcUrl,
    address,
    keypair,
    balanceManagerKey: balanceManagerId ? DEFAULT_BALANCE_MANAGER_KEY : undefined,
    balanceManagerId,
    marginManagerKey: marginManagers ? DEFAULT_MARGIN_MANAGER_KEY : undefined,
    marginManagerId,
    marginPoolKey,
    suiClient,
    deepBookClient,
  };
}

function parseAbortCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function decodeKnownAbortMessage(abort: DryRunAbortError | undefined): string | null {
  if (!abort?.module_id || !abort.function) {
    return null;
  }

  const moduleId = abort.module_id.toLowerCase();
  const fn = abort.function.toLowerCase();
  const code = parseAbortCode(abort.error_code);

  if (moduleId.endsWith("::balance_manager") && fn === "withdraw_with_proof" && code === 3) {
    return "Insufficient available balance in the balance manager for this order (including fees and reserved amounts).";
  }

  if (moduleId.endsWith("::order_info") && fn === "validate_inputs") {
    if (code === 1) {
      return "Order quantity is below the pool minimum size.";
    }
    if (code === 2) {
      return "Order quantity is not a valid lot-size multiple for this pool.";
    }
    if (code === 3) {
      return "Order expiration timestamp is invalid.";
    }
    if (code === 4) {
      return "Invalid order type for this order.";
    }
    if (code === 7) {
      return "Market orders cannot be post-only.";
    }
  }

  if (moduleId.endsWith("::margin_manager")) {
    switch (code) {
      case 2:
        return "Margin trading is not allowed for this pool.";
      case 3:
        return "Active signer is not the owner of this margin manager.";
      case 4:
        return "Margin manager cannot borrow from more than one margin pool at a time.";
      case 5:
        return "Margin manager pool type does not match the requested DeepBook pool.";
      case 7:
        return "Borrow would exceed allowed risk ratio.";
      case 8:
        return "Withdraw would exceed allowed risk ratio.";
      case 10:
        return "Margin manager references a different margin pool than the one used in this action.";
      case 15:
        return "Target pool is not enabled for margin trading.";
      case 17:
        return "Operation requires no outstanding debt on the margin manager.";
      default:
        return null;
    }
  }

  return null;
}

function formatDryRunFailure(result: DryRunResultLike): string | null {
  const status = result.effects?.status;
  if (status?.status !== "failure") {
    return null;
  }

  const abort = result.effects?.abortError;
  const known = decodeKnownAbortMessage(abort);
  const details = status.error ? ` ${status.error}` : "";
  if (known && abort?.module_id && abort?.function) {
    return `${known} [${abort.module_id}::${abort.function} code=${abort.error_code}]${details}`;
  }
  if (abort?.module_id && abort?.function) {
    return `Simulation failed at ${abort.module_id}::${abort.function} (code=${abort.error_code}).${details}`;
  }
  return `Simulation failed.${details}`;
}

export async function assertCanPlaceMarketOrder(
  runtime: TradingRuntime,
  input: {
    poolKey: string;
    quantity: number;
    isBid: boolean;
    payWithDeep: boolean;
  },
): Promise<void> {
  if (!runtime.balanceManagerKey) {
    throw new Error("Balance manager is required for market orders.");
  }

  let paramsOk: boolean;
  let canPlace: boolean;
  let bookParams: { minSize: number; lotSize: number };
  try {
    [paramsOk, canPlace, bookParams] = await Promise.all([
      runtime.deepBookClient.checkMarketOrderParams(input.poolKey, input.quantity),
      runtime.deepBookClient.canPlaceMarketOrder({
        poolKey: input.poolKey,
        balanceManagerKey: runtime.balanceManagerKey,
        quantity: input.quantity,
        isBid: input.isBid,
        payWithDeep: input.payWithDeep,
      }),
      runtime.deepBookClient.poolBookParams(input.poolKey),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Some SDK simulation helpers require sender to be set internally and can throw this.
    // In that case we skip preflight and rely on transaction dry-run/live failure decoding.
    if (/missing transaction sender/i.test(message)) {
      return;
    }
    throw new Error(`Unable to run market-order preflight checks: ${message}`);
  }

  if (!paramsOk) {
    throw new Error(
      `Invalid market quantity for ${input.poolKey}. Quantity must be >= ${bookParams.minSize} and a multiple of ${bookParams.lotSize}.`,
    );
  }

  if (!canPlace) {
    const side = input.isBid ? "buy" : "sell";
    throw new Error(
      `Cannot place market ${side} on ${input.poolKey}: insufficient available balance in manager (including fees/settled reservations) or insufficient liquidity.`,
    );
  }
}

export async function assertCanPlaceLimitOrder(
  runtime: TradingRuntime,
  input: {
    poolKey: string;
    price: number;
    quantity: number;
    isBid: boolean;
    payWithDeep: boolean;
    expireTimestamp: number;
  },
): Promise<void> {
  if (!runtime.balanceManagerKey) {
    throw new Error("Balance manager is required for limit orders.");
  }

  let paramsOk: boolean;
  let canPlace: boolean;
  let bookParams: { tickSize: number; lotSize: number; minSize: number };
  try {
    [paramsOk, canPlace, bookParams] = await Promise.all([
      runtime.deepBookClient.checkLimitOrderParams(
        input.poolKey,
        input.price,
        input.quantity,
        input.expireTimestamp,
      ),
      runtime.deepBookClient.canPlaceLimitOrder({
        poolKey: input.poolKey,
        balanceManagerKey: runtime.balanceManagerKey,
        price: input.price,
        quantity: input.quantity,
        isBid: input.isBid,
        payWithDeep: input.payWithDeep,
        expireTimestamp: input.expireTimestamp,
      }),
      runtime.deepBookClient.poolBookParams(input.poolKey),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/missing transaction sender/i.test(message)) {
      return;
    }
    throw new Error(`Unable to run limit-order preflight checks: ${message}`);
  }

  if (!paramsOk) {
    throw new Error(
      `Invalid limit order params for ${input.poolKey}. Price must align with tick size (${bookParams.tickSize}), and quantity must be >= ${bookParams.minSize} and a multiple of ${bookParams.lotSize}.`,
    );
  }

  if (!canPlace) {
    const side = input.isBid ? "buy" : "sell";
    throw new Error(
      `Cannot place limit ${side} on ${input.poolKey}: insufficient available balance in manager (including fees/settled reservations).`,
    );
  }
}

export async function executeOrDryRunTransaction(
  runtime: TradingRuntime,
  transaction: Transaction,
  dryRun: boolean,
): Promise<unknown> {
  if (dryRun) {
    transaction.setSenderIfNotSet(runtime.address);
    const bytes = await transaction.build({ client: runtime.suiClient });
    const result = (await runtime.suiClient.dryRunTransactionBlock({
      transactionBlock: bytes,
    })) as DryRunResultLike;
    const failure = formatDryRunFailure(result);
    if (failure) {
      throw new Error(failure);
    }
    return result;
  }

  if (!runtime.keypair) {
    throw new Error(
      "Missing signer. Import an account with \"deepbook account import\" or pass --private-key to execute transactions.",
    );
  }

  const result = (await runtime.suiClient.signAndExecuteTransaction({
    signer: runtime.keypair,
    transaction,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
      showBalanceChanges: true,
    },
  })) as DryRunResultLike;

  const failure = formatDryRunFailure(result);
  if (failure) {
    throw new Error(failure);
  }

  return result;
}

export function parseOrderSide(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  if (normalized === "buy" || normalized === "bid") {
    return true;
  }
  if (normalized === "sell" || normalized === "ask") {
    return false;
  }

  throw new Error(`Invalid side "${input}". Supported values: buy, sell, bid, ask.`);
}

export function parseOrderType(input: string): OrderType {
  const normalized = input.trim().toLowerCase();

  switch (normalized) {
    case "none":
    case "limit":
    case "no-restriction":
      return OrderType.NO_RESTRICTION;
    case "ioc":
    case "immediate-or-cancel":
      return OrderType.IMMEDIATE_OR_CANCEL;
    case "fok":
    case "fill-or-kill":
      return OrderType.FILL_OR_KILL;
    case "post-only":
    case "postonly":
      return OrderType.POST_ONLY;
    default:
      throw new Error(
        `Invalid order type "${input}". Supported values: none, ioc, fok, post-only.`,
      );
  }
}

export function parseSelfMatchingOption(input: string): SelfMatchingOptions {
  const normalized = input.trim().toLowerCase();

  switch (normalized) {
    case "allow":
    case "allowed":
    case "self-matching-allowed":
      return SelfMatchingOptions.SELF_MATCHING_ALLOWED;
    case "cancel-taker":
      return SelfMatchingOptions.CANCEL_TAKER;
    case "cancel-maker":
      return SelfMatchingOptions.CANCEL_MAKER;
    default:
      throw new Error(
        `Invalid self-match policy "${input}". Supported values: allow, cancel-taker, cancel-maker.`,
      );
  }
}

export function generateClientOrderId(): string {
  const timestamp = BigInt(Date.now());
  const randomSuffix = BigInt(Math.floor(Math.random() * 10_000));
  return (timestamp * 10_000n + randomSuffix).toString();
}
