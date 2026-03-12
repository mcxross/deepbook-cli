import {
  buildMarginCloseTransaction,
  buildMarginSpotOrderTransaction,
  buildMarginSpotOrderTransactionWithNewManager,
  findMarginManagerIdForPool,
  getMarginStateAmounts,
  queryMarginPosition,
  queryPoolBookParams,
  queryPoolMidPrice,
} from "../trade-operations.js";
import {
  executeOrDryRunTransaction,
  generateClientOrderId,
  type TradingRuntime,
} from "../trading.js";
import {
  createSignalState,
  elapsedSeconds,
  quantizeDown,
  sleep,
  type StrategyLog,
} from "./common.js";

const MARGIN_FEE_BUFFER_BPS = 50;
const MIN_MARGIN_BASE_FEE_BUFFER = 0.01;
const MIN_MARGIN_QUOTE_FEE_BUFFER = 0.1;
const MIN_MARGIN_DEEP_FEE_BUFFER = 0.1;

function estimateMarginFeeBuffer(amount: number, minimum: number): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    return minimum;
  }

  return Math.max((amount * MARGIN_FEE_BUFFER_BPS) / 10_000, minimum);
}

export type SpreadDirection = "shortA_longB" | "longA_shortB";

export interface CrossPoolSpreadLeg {
  poolKey: string;
  quantity: number;
  runtime: TradingRuntime;
  marginManagerId?: string;
  createdInTransaction: boolean;
}

export interface CrossPoolSpreadParams {
  entryThresholdPct: number;
  closeThresholdPct: number;
  stopLossThresholdPct?: number;
  intervalSec: number;
  maxRuntimeSec: number;
  leverage: number;
  selfMatchingOption: number;
  payWithDeep: boolean;
  dryRun: boolean;
}

export interface CrossPoolSpreadTick {
  priceA: number;
  priceB: number;
  ratio: number;
  spreadPct: number;
}

export interface CrossPoolSpreadResult {
  baselineRatio: number;
  runtimeSec: number;
  cycles: number;
  entries: number;
  exits: number;
  activePosition: {
    direction: SpreadDirection;
    entrySpreadPct: number;
    openSeconds: number;
  } | null;
  lastTick: CrossPoolSpreadTick | null;
  lastOpenResult: unknown;
  lastCloseResult: unknown;
  marginManagerA: string | null;
  marginManagerB: string | null;
}

export interface CrossPoolSpreadRunnerOptions {
  log?: StrategyLog;
  onLegManagerCreated?: (input: {
    poolKey: string;
    managerId: string;
    previousRuntime: TradingRuntime;
  }) => Promise<TradingRuntime>;
}

interface ActiveSpreadPosition {
  direction: SpreadDirection;
  entrySpreadPct: number;
  openedAt: number;
}

interface ClosePlan {
  quantity?: number;
  isBid?: boolean;
  repayBaseDebt: boolean;
  repayQuoteDebt: boolean;
  feeBufferBaseAmount?: number;
  feeBufferQuoteAmount?: number;
  feeBufferDeepAmount?: number;
}

function logSpread(log: StrategyLog, message: string): void {
  log(`[SPREAD] ${message}`);
}

async function resolveClosePlan(
  leg: CrossPoolSpreadLeg,
  payWithDeep: boolean,
): Promise<ClosePlan | null> {
  const [position, bookParams] = await Promise.all([
    queryMarginPosition(leg.runtime),
    queryPoolBookParams(leg.runtime, leg.poolKey),
  ]);
  const amounts = getMarginStateAmounts(
    leg.runtime,
    leg.poolKey,
    position.managerState,
  );

  const netBase = amounts.baseAsset - amounts.baseDebt;
  const rawCloseQuantity = Math.abs(netBase);
  const quantizedCloseQuantity = quantizeDown(rawCloseQuantity, bookParams.lotSize);
  const hasCloseQuantity =
    quantizedCloseQuantity >= bookParams.minSize && quantizedCloseQuantity > 0;
  const repayBaseDebt = amounts.baseDebt > 0;
  const repayQuoteDebt = amounts.quoteDebt > 0;

  if (!hasCloseQuantity && !repayBaseDebt && !repayQuoteDebt) {
    return null;
  }

  if (!hasCloseQuantity) {
    return { repayBaseDebt, repayQuoteDebt };
  }

  const closeIsBid = netBase < 0;
  const midPrice = closeIsBid
    ? await queryPoolMidPrice(leg.runtime, leg.poolKey)
    : null;
  const feeBufferBaseAmount =
    payWithDeep || closeIsBid
      ? 0
      : estimateMarginFeeBuffer(
          quantizedCloseQuantity,
          MIN_MARGIN_BASE_FEE_BUFFER,
        );
  const feeBufferQuoteAmount =
    payWithDeep || !closeIsBid || !midPrice
      ? 0
      : estimateMarginFeeBuffer(
          quantizedCloseQuantity * midPrice,
          MIN_MARGIN_QUOTE_FEE_BUFFER,
        );
  const feeBufferDeepAmount = payWithDeep
    ? Math.max(MIN_MARGIN_DEEP_FEE_BUFFER, quantizedCloseQuantity * 0.01)
    : 0;

  return {
    quantity: quantizedCloseQuantity,
    isBid: closeIsBid,
    repayBaseDebt,
    repayQuoteDebt,
    ...(feeBufferBaseAmount > 0 ? { feeBufferBaseAmount } : {}),
    ...(feeBufferQuoteAmount > 0 ? { feeBufferQuoteAmount } : {}),
    ...(feeBufferDeepAmount > 0 ? { feeBufferDeepAmount } : {}),
  };
}

async function placeCloseLeg(
  leg: CrossPoolSpreadLeg,
  params: CrossPoolSpreadParams,
): Promise<unknown> {
  const plan = await resolveClosePlan(leg, params.payWithDeep);
  if (!plan) {
    return { skipped: true, reason: "no-open-exposure" };
  }

  const transaction = buildMarginCloseTransaction(leg.runtime, {
    poolKey: leg.poolKey,
    clientOrderId: generateClientOrderId(),
    reduceOnly: true,
    selfMatchingOption: params.selfMatchingOption,
    payWithDeep: params.payWithDeep,
    repayBaseDebt: plan.repayBaseDebt,
    repayQuoteDebt: plan.repayQuoteDebt,
    ...(plan.quantity && typeof plan.isBid === "boolean"
      ? { quantity: plan.quantity, isBid: plan.isBid }
      : {}),
    ...(plan.feeBufferBaseAmount
      ? { feeBufferBaseAmount: plan.feeBufferBaseAmount }
      : {}),
    ...(plan.feeBufferQuoteAmount
      ? { feeBufferQuoteAmount: plan.feeBufferQuoteAmount }
      : {}),
    ...(plan.feeBufferDeepAmount
      ? { feeBufferDeepAmount: plan.feeBufferDeepAmount }
      : {}),
  });

  return executeOrDryRunTransaction(leg.runtime, transaction, params.dryRun);
}

async function maybeRefreshLegManager(
  leg: CrossPoolSpreadLeg,
  params: CrossPoolSpreadParams,
  options: CrossPoolSpreadRunnerOptions,
): Promise<void> {
  if (!leg.createdInTransaction || params.dryRun) {
    return;
  }

  const managerId = await findMarginManagerIdForPool(leg.runtime, leg.poolKey);
  if (!managerId) {
    throw new Error(
      `Unable to resolve newly created margin manager for ${leg.poolKey}.`,
    );
  }

  const updateRuntime = options.onLegManagerCreated;
  if (!updateRuntime) {
    throw new Error(
      `Strategy needs onLegManagerCreated callback to bind manager ${managerId} for ${leg.poolKey}.`,
    );
  }

  leg.runtime = await updateRuntime({
    poolKey: leg.poolKey,
    managerId,
    previousRuntime: leg.runtime,
  });
  leg.marginManagerId = managerId;
  leg.createdInTransaction = false;
}

async function placeOpenLeg(
  leg: CrossPoolSpreadLeg,
  side: "buy" | "sell",
  params: CrossPoolSpreadParams,
  options: CrossPoolSpreadRunnerOptions,
): Promise<unknown> {
  const isBid = side === "buy";
  const midPrice = isBid ? await queryPoolMidPrice(leg.runtime, leg.poolKey) : null;
  if (isBid && (!midPrice || !Number.isFinite(midPrice) || midPrice <= 0)) {
    throw new Error(
      `Unable to compute quote collateral for ${leg.poolKey}: invalid mid price.`,
    );
  }

  const collateralBaseQuantity = !isBid ? leg.quantity : 0;
  const collateralQuoteQuantity =
    isBid && midPrice
      ? (leg.quantity * midPrice) / params.leverage
      : 0;
  const borrowBaseAmount = !isBid ? leg.quantity * (params.leverage - 1) : 0;
  const borrowQuoteAmount =
    isBid && midPrice
      ? leg.quantity * midPrice - collateralQuoteQuantity
      : 0;
  const orderQuantity = !isBid ? leg.quantity * params.leverage : leg.quantity;
  const feeBufferBaseAmount =
    params.payWithDeep || isBid
      ? 0
      : estimateMarginFeeBuffer(orderQuantity, MIN_MARGIN_BASE_FEE_BUFFER);
  const feeBufferQuoteAmount =
    params.payWithDeep || !isBid || !midPrice
      ? 0
      : estimateMarginFeeBuffer(
          orderQuantity * midPrice,
          MIN_MARGIN_QUOTE_FEE_BUFFER,
        );
  const feeBufferDeepAmount = params.payWithDeep
    ? Math.max(MIN_MARGIN_DEEP_FEE_BUFFER, orderQuantity * 0.01)
    : 0;

  const orderInput = {
    poolKey: leg.poolKey,
    clientOrderId: generateClientOrderId(),
    quantity: orderQuantity,
    isBid,
    selfMatchingOption: params.selfMatchingOption,
    payWithDeep: params.payWithDeep,
    reduceOnly: false,
    ...(collateralBaseQuantity > 0
      ? { collateralBaseAmount: collateralBaseQuantity }
      : {}),
    ...(collateralQuoteQuantity > 0
      ? { collateralQuoteAmount: collateralQuoteQuantity }
      : {}),
    ...(feeBufferBaseAmount > 0 ? { feeBufferBaseAmount } : {}),
    ...(feeBufferQuoteAmount > 0 ? { feeBufferQuoteAmount } : {}),
    ...(feeBufferDeepAmount > 0 ? { feeBufferDeepAmount } : {}),
    ...(borrowBaseAmount > 0 ? { borrowBaseAmount } : {}),
    ...(borrowQuoteAmount > 0 ? { borrowQuoteAmount } : {}),
  };
  const transaction = leg.createdInTransaction
    ? buildMarginSpotOrderTransactionWithNewManager(leg.runtime, orderInput)
    : buildMarginSpotOrderTransaction(leg.runtime, orderInput);

  const result = await executeOrDryRunTransaction(
    leg.runtime,
    transaction,
    params.dryRun,
  );
  await maybeRefreshLegManager(leg, params, options);
  return result;
}

async function readSpreadTick(
  legA: CrossPoolSpreadLeg,
  legB: CrossPoolSpreadLeg,
  baselineRatio: number,
): Promise<CrossPoolSpreadTick> {
  const [priceA, priceB] = await Promise.all([
    queryPoolMidPrice(legA.runtime, legA.poolKey),
    queryPoolMidPrice(legB.runtime, legB.poolKey),
  ]);

  if (!Number.isFinite(priceA) || priceA <= 0) {
    throw new Error(`Invalid mid price for ${legA.poolKey}.`);
  }
  if (!Number.isFinite(priceB) || priceB <= 0) {
    throw new Error(`Invalid mid price for ${legB.poolKey}.`);
  }

  const ratio = priceA / priceB;
  const spreadPct = ((ratio / baselineRatio) - 1) * 100;
  return { priceA, priceB, ratio, spreadPct };
}

export async function runCrossPoolSpreadStrategy(
  legAInput: CrossPoolSpreadLeg,
  legBInput: CrossPoolSpreadLeg,
  params: CrossPoolSpreadParams,
  options: CrossPoolSpreadRunnerOptions = {},
): Promise<CrossPoolSpreadResult> {
  const log = options.log ?? (() => {});
  const legA: CrossPoolSpreadLeg = { ...legAInput };
  const legB: CrossPoolSpreadLeg = { ...legBInput };

  const baselinePrices = await Promise.all([
    queryPoolMidPrice(legA.runtime, legA.poolKey),
    queryPoolMidPrice(legB.runtime, legB.poolKey),
  ]);
  if (!Number.isFinite(baselinePrices[0]) || baselinePrices[0] <= 0) {
    throw new Error(`Invalid baseline price for ${legA.poolKey}.`);
  }
  if (!Number.isFinite(baselinePrices[1]) || baselinePrices[1] <= 0) {
    throw new Error(`Invalid baseline price for ${legB.poolKey}.`);
  }

  const baselineRatio = baselinePrices[0] / baselinePrices[1];
  let active: ActiveSpreadPosition | null = null;
  let cycles = 0;
  let entries = 0;
  let exits = 0;
  let lastTick: CrossPoolSpreadTick | null = null;
  let lastOpenResult: unknown = null;
  let lastCloseResult: unknown = null;
  const startedAt = Date.now();
  const signal = createSignalState();

  logSpread(
    log,
    `${legA.poolKey} vs ${legB.poolKey} | baselineRatio=${baselineRatio.toFixed(9)} | entry=${params.entryThresholdPct}% | close=${params.closeThresholdPct}%`,
  );

  const openSpreadPosition = async (
    direction: SpreadDirection,
  ): Promise<{ legAResult: unknown; legBResult: unknown }> => {
    const legASide = direction === "shortA_longB" ? "sell" : "buy";
    const legBSide = direction === "shortA_longB" ? "buy" : "sell";

    const legAResult = await placeOpenLeg(legA, legASide, params, options);
    try {
      const legBResult = await placeOpenLeg(legB, legBSide, params, options);
      return { legAResult, legBResult };
    } catch (error) {
      if (!params.dryRun) {
        try {
          await placeCloseLeg(legA, params);
        } catch {
          // best effort rollback when second leg fails
        }
      }
      throw error;
    }
  };

  const closeSpreadPosition = async (): Promise<{
    legAResult: unknown;
    legBResult: unknown;
  }> => {
    const [legAResult, legBResult] = await Promise.allSettled([
      placeCloseLeg(legA, params),
      placeCloseLeg(legB, params),
    ]);

    if (legAResult.status === "rejected" || legBResult.status === "rejected") {
      const errors = [
        legAResult.status === "rejected"
          ? `poolA close failed: ${
              legAResult.reason instanceof Error
                ? legAResult.reason.message
                : String(legAResult.reason)
            }`
          : null,
        legBResult.status === "rejected"
          ? `poolB close failed: ${
              legBResult.reason instanceof Error
                ? legBResult.reason.message
                : String(legBResult.reason)
            }`
          : null,
      ]
        .filter(Boolean)
        .join("; ");

      throw new Error(errors || "Failed to close spread position.");
    }

    return {
      legAResult: legAResult.value,
      legBResult: legBResult.value,
    };
  };

  try {
    while (signal.isRunning()) {
      if (
        params.maxRuntimeSec > 0 &&
        Date.now() - startedAt >= params.maxRuntimeSec * 1000
      ) {
        logSpread(log, "max runtime reached");
        break;
      }

      const tick = await readSpreadTick(legA, legB, baselineRatio);
      lastTick = tick;
      cycles += 1;

      if (
        cycles === 1 ||
        cycles % Math.max(1, Math.floor(30 / params.intervalSec)) === 0
      ) {
        logSpread(
          log,
          `spread=${tick.spreadPct.toFixed(4)}% | ratio=${tick.ratio.toFixed(9)} | ${legA.poolKey}=${tick.priceA.toFixed(6)} ${legB.poolKey}=${tick.priceB.toFixed(6)}`,
        );
      }

      if (!active) {
        let direction: SpreadDirection | null = null;
        if (tick.spreadPct >= params.entryThresholdPct) {
          direction = "shortA_longB";
        } else if (tick.spreadPct <= -params.entryThresholdPct) {
          direction = "longA_shortB";
        }

        if (direction) {
          logSpread(log, `ENTRY ${direction} at spread=${tick.spreadPct.toFixed(4)}%`);
          lastOpenResult = await openSpreadPosition(direction);
          active = {
            direction,
            entrySpreadPct: tick.spreadPct,
            openedAt: Date.now(),
          };
          entries += 1;

          if (params.dryRun) {
            logSpread(log, "dry-run completed after simulated entry");
            break;
          }
        }
      } else {
        const closeByReversion = Math.abs(tick.spreadPct) <= params.closeThresholdPct;
        const closeByStopLoss = params.stopLossThresholdPct
          ? active.direction === "shortA_longB"
            ? tick.spreadPct >= active.entrySpreadPct + params.stopLossThresholdPct
            : tick.spreadPct <= active.entrySpreadPct - params.stopLossThresholdPct
          : false;

        if (closeByReversion || closeByStopLoss) {
          const reason = closeByStopLoss ? "stop-loss" : "reversion";
          logSpread(log, `EXIT ${reason} at spread=${tick.spreadPct.toFixed(4)}%`);
          lastCloseResult = await closeSpreadPosition();
          active = null;
          exits += 1;

          if (params.dryRun) {
            break;
          }
        }
      }

      await sleep(params.intervalSec * 1000);
    }
  } finally {
    signal.dispose();
  }

  return {
    baselineRatio,
    runtimeSec: elapsedSeconds(startedAt),
    cycles,
    entries,
    exits,
    activePosition: active
      ? {
          direction: active.direction,
          entrySpreadPct: active.entrySpreadPct,
          openSeconds: Math.floor((Date.now() - active.openedAt) / 1000),
        }
      : null,
    lastTick,
    lastOpenResult,
    lastCloseResult,
    marginManagerA: legA.marginManagerId ?? null,
    marginManagerB: legB.marginManagerId ?? null,
  };
}
