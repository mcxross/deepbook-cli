import {
  buildCancelOrderTransaction,
  buildLimitOrderTransaction,
} from "../trade-operations.js";
import {
  assertCanPlaceLimitOrder,
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
  sleep,
  type GridSide,
  type SpotSide,
  type StrategyLog,
} from "./common.js";

export interface SpotGridParams {
  poolKey: string;
  side: GridSide;
  upperPrice: number;
  lowerPrice: number;
  grids: number;
  totalSize: number;
  intervalSec: number;
  maxRuntimeSec: number;
  trailingStopPct?: number;
  orderType: number;
  payWithDeep: boolean;
  selfMatchingOption: number;
  dryRun: boolean;
}

export interface SpotGridResult {
  fills: number;
  estimatedPnl: number;
  activeOrders: number;
  runtimeSec: number;
}

interface GridLineState {
  price: number;
  side: SpotSide;
  size: number;
  orderId?: string;
}

function setDifference(after: Set<string>, before: Set<string>): string[] {
  const diff: string[] = [];
  for (const id of after) {
    if (!before.has(id)) {
      diff.push(id);
    }
  }
  return diff;
}

async function listSpotOpenOrderIds(
  runtime: TradingRuntime,
  poolKey: string,
): Promise<Set<string>> {
  if (!runtime.balanceManagerKey) {
    throw new Error("Spot strategy runtime requires a balance manager.");
  }

  const ids = await runtime.deepBookClient.accountOpenOrders(
    poolKey,
    runtime.balanceManagerKey,
  );
  return new Set(ids.map((id) => String(id)));
}

async function placeGridLimitOrder(
  runtime: TradingRuntime,
  line: GridLineState,
  params: SpotGridParams,
): Promise<{ orderId?: string; result: unknown }> {
  const expireTimestamp = Date.now() + 24 * 60 * 60 * 1000;
  await assertCanPlaceLimitOrder(runtime, {
    poolKey: params.poolKey,
    price: line.price,
    quantity: line.size,
    isBid: line.side === "buy",
    payWithDeep: params.payWithDeep,
    expireTimestamp,
  });

  const before = params.dryRun
    ? undefined
    : await listSpotOpenOrderIds(runtime, params.poolKey);

  const transaction = buildLimitOrderTransaction(runtime, {
    poolKey: params.poolKey,
    clientOrderId: generateClientOrderId(),
    price: line.price,
    quantity: line.size,
    isBid: line.side === "buy",
    orderType: params.orderType,
    selfMatchingOption: params.selfMatchingOption,
    payWithDeep: params.payWithDeep,
    expiration: expireTimestamp,
  });
  const result = await executeOrDryRunTransaction(
    runtime,
    transaction,
    params.dryRun,
  );

  if (!before) {
    return { result };
  }

  const after = await listSpotOpenOrderIds(runtime, params.poolKey);
  const created = setDifference(after, before);

  return {
    orderId: created.length > 0 ? created[0] : undefined,
    result,
  };
}

async function cancelSpotOrder(
  runtime: TradingRuntime,
  poolKey: string,
  orderId: string,
): Promise<void> {
  const tx = buildCancelOrderTransaction(runtime, { poolKey, orderId });
  await executeOrDryRunTransaction(runtime, tx, false);
}

function deriveGridLineSide(
  mode: GridSide,
  linePrice: number,
  currentPrice: number,
): SpotSide {
  if (mode === "long") {
    return "buy";
  }
  if (mode === "short") {
    return "sell";
  }
  return linePrice < currentPrice ? "buy" : "sell";
}

export async function runSpotGridStrategy(
  runtime: TradingRuntime,
  params: SpotGridParams,
  log: StrategyLog = () => {},
): Promise<SpotGridResult> {
  if (params.upperPrice <= params.lowerPrice) {
    throw new Error("upperPrice must be greater than lowerPrice.");
  }
  if (params.grids < 2) {
    throw new Error("Grid strategy requires at least 2 grid lines.");
  }

  const startedAt = Date.now();
  const signal = createSignalState();
  const step = (params.upperPrice - params.lowerPrice) / (params.grids - 1);
  const sizePerGrid = params.totalSize / params.grids;

  const currentMid = (await safeMidPrice(runtime, params.poolKey)) ??
    (params.upperPrice + params.lowerPrice) / 2;

  const lines: GridLineState[] = Array.from({ length: params.grids }, (_, index) => {
    const price = params.lowerPrice + step * index;
    return {
      price: round(price, 9),
      side: deriveGridLineSide(params.side, price, currentMid),
      size: sizePerGrid,
    };
  });

  let fills = 0;
  let estimatedPnl = 0;
  let peakPrice = currentMid;
  let troughPrice = currentMid;
  const activeOrderIds = new Set<string>();

  logStrategy(
    "GRID",
    `${params.poolKey} ${params.side} ${params.grids} grids | ${params.lowerPrice}..${params.upperPrice} | step ${step.toFixed(6)}`,
    log,
  );

  try {
    for (const line of lines) {
      try {
        const { orderId } = await placeGridLimitOrder(runtime, line, params);
        if (orderId) {
          line.orderId = orderId;
          activeOrderIds.add(orderId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logStrategy(
          "GRID",
          `initial order ${line.side} ${line.size}@${line.price} failed: ${message}`,
          log,
        );
      }
    }

    logStrategy(
      "GRID",
      `placed ${activeOrderIds.size}/${lines.length} resting orders`,
      log,
    );

    if (params.dryRun) {
      logStrategy("GRID", "dry-run mode: skipping monitoring loop", log);
      return {
        fills: 0,
        estimatedPnl: 0,
        activeOrders: 0,
        runtimeSec: elapsedSeconds(startedAt),
      };
    }

    while (signal.isRunning()) {
      await sleep(params.intervalSec * 1000);

      if (
        params.maxRuntimeSec > 0 &&
        Date.now() - startedAt >= params.maxRuntimeSec * 1000
      ) {
        logStrategy("GRID", "max runtime reached", log);
        break;
      }

      const openIds = await listSpotOpenOrderIds(runtime, params.poolKey);
      let cycleFills = 0;

      for (const line of lines) {
        const existingOrderId = line.orderId;
        if (!existingOrderId || openIds.has(existingOrderId)) {
          continue;
        }

        cycleFills++;
        fills++;
        line.orderId = undefined;
        activeOrderIds.delete(existingOrderId);

        const oldSide = line.side;
        const oldPrice = line.price;
        const nextSide: SpotSide = oldSide === "buy" ? "sell" : "buy";
        const nextPrice = oldSide === "buy" ? oldPrice + step : oldPrice - step;

        if (nextPrice < params.lowerPrice || nextPrice > params.upperPrice) {
          continue;
        }

        line.side = nextSide;
        line.price = round(nextPrice, 9);

        try {
          const { orderId } = await placeGridLimitOrder(runtime, line, params);
          if (orderId) {
            line.orderId = orderId;
            activeOrderIds.add(orderId);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logStrategy("GRID", `replace order failed at ${line.price}: ${message}`, log);
        }
      }

      if (cycleFills > 0) {
        estimatedPnl += cycleFills * step * sizePerGrid;
        logStrategy(
          "GRID",
          `${cycleFills} fill(s), total fills=${fills}, est pnl=${estimatedPnl.toFixed(6)}`,
          log,
        );
      }

      const cycleMid = await safeMidPrice(runtime, params.poolKey);
      if (cycleMid && params.trailingStopPct && params.trailingStopPct > 0) {
        if (params.side === "short") {
          troughPrice = cycleMid < troughPrice ? cycleMid : troughPrice;
          const rebound = ((cycleMid - troughPrice) / troughPrice) * 100;
          if (rebound >= params.trailingStopPct) {
            logStrategy(
              "GRID",
              `trailing stop hit (${rebound.toFixed(2)}% rebound from trough)`,
              log,
            );
            break;
          }
        } else {
          peakPrice = cycleMid > peakPrice ? cycleMid : peakPrice;
          const drawdown = ((peakPrice - cycleMid) / peakPrice) * 100;
          if (drawdown >= params.trailingStopPct) {
            logStrategy(
              "GRID",
              `trailing stop hit (${drawdown.toFixed(2)}% drawdown from peak)`,
              log,
            );
            break;
          }
        }
      }
    }
  } finally {
    signal.dispose();

    if (!params.dryRun && activeOrderIds.size > 0) {
      logStrategy("GRID", `cancelling ${activeOrderIds.size} remaining order(s)`, log);
      for (const orderId of activeOrderIds) {
        try {
          await cancelSpotOrder(runtime, params.poolKey, orderId);
        } catch {
          // best effort cancellation during shutdown
        }
      }
    }
  }

  const runtimeSec = elapsedSeconds(startedAt);
  logStrategy(
    "GRID",
    `done: ${fills} fills, est pnl=${estimatedPnl.toFixed(6)}, runtime=${runtimeSec}s`,
    log,
  );

  return {
    fills,
    estimatedPnl: round(estimatedPnl, 9),
    activeOrders: activeOrderIds.size,
    runtimeSec,
  };
}
