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

export interface SpotDcaParams {
  poolKey: string;
  side: SpotSide;
  amountPerOrder: number;
  intervalSec: number;
  totalOrders: number;
  priceLimit?: number;
  maxRuntimeSec: number;
  payWithDeep: boolean;
  selfMatchingOption: number;
  dryRun: boolean;
}

export interface SpotDcaResult {
  ordersPlaced: number;
  totalFilled: number;
  avgReferencePrice: number;
  errors: number;
  runtimeSec: number;
}

export async function runSpotDcaStrategy(
  runtime: TradingRuntime,
  params: SpotDcaParams,
  log: StrategyLog = () => {},
): Promise<SpotDcaResult> {
  const startedAt = Date.now();
  const signal = createSignalState();
  const isBid = params.side === "buy";

  let ordersPlaced = 0;
  let totalFilled = 0;
  let errors = 0;
  let referenceCost = 0;
  let avgReferencePrice = 0;

  const target =
    params.totalOrders > 0 ? `${params.totalOrders} orders` : "unlimited";
  logStrategy(
    "DCA",
    `${params.side.toUpperCase()} ${params.amountPerOrder} ${params.poolKey} every ${params.intervalSec}s (${target})`,
    log,
  );

  try {
    while (signal.isRunning()) {
      if (params.totalOrders > 0 && ordersPlaced >= params.totalOrders) {
        logStrategy("DCA", "target order count reached", log);
        break;
      }

      if (
        params.maxRuntimeSec > 0 &&
        Date.now() - startedAt >= params.maxRuntimeSec * 1000
      ) {
        logStrategy("DCA", "max runtime reached", log);
        break;
      }

      const midPrice = await safeMidPrice(runtime, params.poolKey);
      if (params.priceLimit && midPrice) {
        if (isBid && midPrice > params.priceLimit) {
          logStrategy(
            "DCA",
            `mid price ${midPrice.toFixed(6)} > limit ${params.priceLimit}; skipping`,
            log,
          );
          await sleep(params.intervalSec * 1000);
          continue;
        }
        if (!isBid && midPrice < params.priceLimit) {
          logStrategy(
            "DCA",
            `mid price ${midPrice.toFixed(6)} < limit ${params.priceLimit}; skipping`,
            log,
          );
          await sleep(params.intervalSec * 1000);
          continue;
        }
      }

      try {
        await assertCanPlaceMarketOrder(runtime, {
          poolKey: params.poolKey,
          quantity: params.amountPerOrder,
          isBid,
          payWithDeep: params.payWithDeep,
        });

        const transaction = buildMarketOrderTransaction(runtime, {
          poolKey: params.poolKey,
          clientOrderId: generateClientOrderId(),
          quantity: params.amountPerOrder,
          isBid,
          selfMatchingOption: params.selfMatchingOption,
          payWithDeep: params.payWithDeep,
        });
        await executeOrDryRunTransaction(runtime, transaction, params.dryRun);

        ordersPlaced++;
        totalFilled += params.amountPerOrder;
        if (midPrice && midPrice > 0) {
          referenceCost += params.amountPerOrder * midPrice;
          avgReferencePrice = referenceCost / totalFilled;
        }

        const progress =
          params.totalOrders > 0 ? ` (${ordersPlaced}/${params.totalOrders})` : "";
        logStrategy("DCA", `order #${ordersPlaced}${progress} executed`, log);
      } catch (error) {
        errors++;
        const message = error instanceof Error ? error.message : String(error);
        logStrategy("DCA", `order failed: ${message}`, log);
        if (errors > 10 && errors > ordersPlaced) {
          logStrategy("DCA", "stopping due to repeated errors", log);
          break;
        }
      }

      if (
        signal.isRunning() &&
        (params.totalOrders === 0 || ordersPlaced < params.totalOrders)
      ) {
        await sleep(params.intervalSec * 1000);
      }
    }
  } finally {
    signal.dispose();
  }

  const runtimeSec = elapsedSeconds(startedAt);
  logStrategy(
    "DCA",
    `done: ${ordersPlaced} orders, ${totalFilled.toFixed(6)} filled, ${errors} errors in ${runtimeSec}s`,
    log,
  );

  return {
    ordersPlaced,
    totalFilled: round(totalFilled, 9),
    avgReferencePrice: round(avgReferencePrice, 9),
    errors,
    runtimeSec,
  };
}
