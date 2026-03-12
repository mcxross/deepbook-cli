import {
  buildMarketOrderTransaction,
} from "../trade-operations.js";
import {
  assertCanPlaceMarketOrder,
  executeOrDryRunTransaction,
  generateClientOrderId,
  type TradingRuntime,
} from "../trading.js";
import {
  createSignalState,
  elapsedSeconds,
  logStrategy,
  round,
  safeMidPrice,
  type SpotSide,
  type StrategyLog,
  sleep,
} from "./common.js";

export interface SpotTwapParams {
  poolKey: string;
  side: SpotSide;
  totalSize: number;
  durationSec: number;
  slices?: number;
  payWithDeep: boolean;
  selfMatchingOption: number;
  dryRun: boolean;
}

export interface SpotTwapResult {
  filled: number;
  remaining: number;
  slicesDone: number;
  totalSlices: number;
  avgReferencePrice: number;
  errors: number;
  runtimeSec: number;
}

export async function runSpotTwapStrategy(
  runtime: TradingRuntime,
  params: SpotTwapParams,
  log: StrategyLog = () => {},
): Promise<SpotTwapResult> {
  const totalSlices =
    params.slices && params.slices > 0
      ? Math.floor(params.slices)
      : Math.max(Math.floor(params.durationSec / 30), 2);
  const sliceSize = params.totalSize / totalSlices;
  const intervalMs = (params.durationSec * 1000) / totalSlices;
  const isBid = params.side === "buy";
  const startedAt = Date.now();
  const signal = createSignalState();

  let filled = 0;
  let remaining = params.totalSize;
  let slicesDone = 0;
  let errors = 0;
  let referenceCost = 0;
  let avgReferencePrice = 0;

  logStrategy(
    "TWAP",
    `${params.side.toUpperCase()} ${params.totalSize} ${params.poolKey} over ${params.durationSec}s (${totalSlices} slices)`,
    log,
  );

  try {
    for (let i = 0; i < totalSlices && signal.isRunning(); i++) {
      if (i > 0) {
        await sleep(intervalMs);
      }

      const thisSlice = i === totalSlices - 1 ? remaining : sliceSize;
      if (thisSlice <= 0) {
        break;
      }

      try {
        const midPrice = await safeMidPrice(runtime, params.poolKey);
        await assertCanPlaceMarketOrder(runtime, {
          poolKey: params.poolKey,
          quantity: thisSlice,
          isBid,
          payWithDeep: params.payWithDeep,
        });

        const transaction = buildMarketOrderTransaction(runtime, {
          poolKey: params.poolKey,
          clientOrderId: generateClientOrderId(),
          quantity: thisSlice,
          isBid,
          selfMatchingOption: params.selfMatchingOption,
          payWithDeep: params.payWithDeep,
        });
        await executeOrDryRunTransaction(runtime, transaction, params.dryRun);

        slicesDone++;
        filled += thisSlice;
        remaining = Math.max(0, params.totalSize - filled);
        if (midPrice && midPrice > 0) {
          referenceCost += thisSlice * midPrice;
          avgReferencePrice = referenceCost / filled;
        }

        const pct = ((filled / params.totalSize) * 100).toFixed(1);
        logStrategy(
          "TWAP",
          `slice ${i + 1}/${totalSlices} filled ${filled.toFixed(6)}/${params.totalSize} (${pct}%)`,
          log,
        );
      } catch (error) {
        errors++;
        const message = error instanceof Error ? error.message : String(error);
        logStrategy("TWAP", `slice ${i + 1} failed: ${message}`, log);
        if (errors > totalSlices * 0.5) {
          logStrategy("TWAP", "aborting due to repeated errors", log);
          break;
        }
      }
    }
  } finally {
    signal.dispose();
  }

  const runtimeSec = elapsedSeconds(startedAt);
  logStrategy(
    "TWAP",
    `done: filled ${filled.toFixed(6)} with ${errors} errors in ${runtimeSec}s`,
    log,
  );

  return {
    filled: round(filled, 9),
    remaining: round(remaining, 9),
    slicesDone,
    totalSlices,
    avgReferencePrice: round(avgReferencePrice, 9),
    errors,
    runtimeSec,
  };
}
