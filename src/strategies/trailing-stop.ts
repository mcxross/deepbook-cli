import {
  buildMarginCloseTransaction,
  getMarginStateAmounts,
  queryMarginPosition,
  queryPoolBookParams,
} from "../trade-operations.js";
import {
  executeOrDryRunTransaction,
  generateClientOrderId,
  type TradingRuntime,
} from "../trading.js";
import {
  createSignalState,
  elapsedSeconds,
  logStrategy,
  quantizeDown,
  round,
  safeMidPrice,
  sleep,
  type StrategyLog,
} from "./common.js";

export interface MarginTrailingStopParams {
  poolKey: string;
  trailPct: number;
  intervalSec: number;
  activationPrice?: number;
  payWithDeep: boolean;
  repay: boolean;
  selfMatchingOption: number;
  dryRun: boolean;
}

export interface MarginTrailingStopResult {
  triggered: boolean;
  reason: "triggered" | "cancelled" | "no_position";
  positionSide?: "long" | "short";
  peakPrice?: number;
  triggerPrice?: number;
  changePct?: number;
  closeQuantity?: number;
  closeResult?: unknown;
  runtimeSec: number;
}

interface MarginExposure {
  positionSide: "long" | "short";
  closeIsBid: boolean;
  closeQuantity: number;
}

async function resolveMarginExposure(
  runtime: TradingRuntime,
  poolKey: string,
): Promise<MarginExposure | null> {
  const [position, bookParams] = await Promise.all([
    queryMarginPosition(runtime),
    queryPoolBookParams(runtime, poolKey),
  ]);
  const amounts = getMarginStateAmounts(runtime, poolKey, position.managerState);
  const netBase = amounts.baseAsset - amounts.baseDebt;
  const closeQuantityRaw = Math.abs(netBase);
  const closeQuantity = quantizeDown(closeQuantityRaw, bookParams.lotSize);

  if (closeQuantity < bookParams.minSize || closeQuantity <= 0) {
    return null;
  }

  if (netBase > 0) {
    return {
      positionSide: "long",
      closeIsBid: false,
      closeQuantity,
    };
  }

  return {
    positionSide: "short",
    closeIsBid: true,
    closeQuantity,
  };
}

export async function runMarginTrailingStopStrategy(
  runtime: TradingRuntime,
  params: MarginTrailingStopParams,
  log: StrategyLog = () => {},
): Promise<MarginTrailingStopResult> {
  const startedAt = Date.now();
  const signal = createSignalState();

  const initialExposure = await resolveMarginExposure(runtime, params.poolKey);
  if (!initialExposure) {
    logStrategy(
      "TRAIL",
      `no active margin base exposure for ${params.poolKey}`,
      log,
    );
    signal.dispose();
    return {
      triggered: false,
      reason: "no_position",
      runtimeSec: 0,
    };
  }

  const positionSide = initialExposure.positionSide;
  let extremePrice = 0;
  let activated = !params.activationPrice;

  logStrategy(
    "TRAIL",
    `${params.poolKey} ${positionSide} | trail ${params.trailPct}%${
      params.activationPrice ? ` | activation ${params.activationPrice}` : ""
    }`,
    log,
  );

  try {
    while (signal.isRunning()) {
      const midPrice = await safeMidPrice(runtime, params.poolKey);
      if (!midPrice || midPrice <= 0) {
        await sleep(params.intervalSec * 1000);
        continue;
      }

      if (!activated && params.activationPrice) {
        if (positionSide === "long" && midPrice >= params.activationPrice) {
          activated = true;
          logStrategy(
            "TRAIL",
            `activated at ${midPrice.toFixed(6)} (>= ${params.activationPrice})`,
            log,
          );
        } else if (positionSide === "short" && midPrice <= params.activationPrice) {
          activated = true;
          logStrategy(
            "TRAIL",
            `activated at ${midPrice.toFixed(6)} (<= ${params.activationPrice})`,
            log,
          );
        } else {
          await sleep(params.intervalSec * 1000);
          continue;
        }
      }

      if (positionSide === "long") {
        extremePrice = Math.max(extremePrice, midPrice);
        const dropPct =
          extremePrice > 0 ? ((extremePrice - midPrice) / extremePrice) * 100 : 0;
        if (dropPct >= params.trailPct) {
          const fresh = await resolveMarginExposure(runtime, params.poolKey);
          if (!fresh) {
            return {
              triggered: false,
              reason: "no_position",
              runtimeSec: elapsedSeconds(startedAt),
            };
          }

          const transaction = buildMarginCloseTransaction(runtime, {
            poolKey: params.poolKey,
            clientOrderId: generateClientOrderId(),
            quantity: fresh.closeQuantity,
            isBid: fresh.closeIsBid,
            reduceOnly: true,
            selfMatchingOption: params.selfMatchingOption,
            payWithDeep: params.payWithDeep,
            repayBaseDebt: params.repay,
            repayQuoteDebt: params.repay,
          });
          const closeResult = await executeOrDryRunTransaction(
            runtime,
            transaction,
            params.dryRun,
          );

          return {
            triggered: true,
            reason: "triggered",
            positionSide,
            peakPrice: round(extremePrice, 9),
            triggerPrice: round(midPrice, 9),
            changePct: round(dropPct, 9),
            closeQuantity: fresh.closeQuantity,
            closeResult,
            runtimeSec: elapsedSeconds(startedAt),
          };
        }
      } else {
        extremePrice = extremePrice === 0 ? midPrice : Math.min(extremePrice, midPrice);
        const risePct =
          extremePrice > 0 ? ((midPrice - extremePrice) / extremePrice) * 100 : 0;
        if (risePct >= params.trailPct) {
          const fresh = await resolveMarginExposure(runtime, params.poolKey);
          if (!fresh) {
            return {
              triggered: false,
              reason: "no_position",
              runtimeSec: elapsedSeconds(startedAt),
            };
          }

          const transaction = buildMarginCloseTransaction(runtime, {
            poolKey: params.poolKey,
            clientOrderId: generateClientOrderId(),
            quantity: fresh.closeQuantity,
            isBid: fresh.closeIsBid,
            reduceOnly: true,
            selfMatchingOption: params.selfMatchingOption,
            payWithDeep: params.payWithDeep,
            repayBaseDebt: params.repay,
            repayQuoteDebt: params.repay,
          });
          const closeResult = await executeOrDryRunTransaction(
            runtime,
            transaction,
            params.dryRun,
          );

          return {
            triggered: true,
            reason: "triggered",
            positionSide,
            peakPrice: round(extremePrice, 9),
            triggerPrice: round(midPrice, 9),
            changePct: round(risePct, 9),
            closeQuantity: fresh.closeQuantity,
            closeResult,
            runtimeSec: elapsedSeconds(startedAt),
          };
        }
      }

      await sleep(params.intervalSec * 1000);
    }
  } finally {
    signal.dispose();
  }

  return {
    triggered: false,
    reason: "cancelled",
    positionSide,
    peakPrice: extremePrice > 0 ? round(extremePrice, 9) : undefined,
    runtimeSec: elapsedSeconds(startedAt),
  };
}
