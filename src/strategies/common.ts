import { queryPoolMidPrice } from "../trade-operations.js";
import type { TradingRuntime } from "../trading.js";

export type SpotSide = "buy" | "sell";
export type GridSide = "long" | "short" | "neutral";
export type StrategyLog = (message: string) => void;

export function elapsedSeconds(startedAt: number): number {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

export function round(value: number, digits: number = 9): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function quantizeDown(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value;
  }
  const units = Math.floor(value / step + 1e-9);
  return round(units * step, 12);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createSignalState() {
  let running = true;
  const stop = () => {
    running = false;
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  return {
    isRunning(): boolean {
      return running;
    },
    dispose(): void {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    },
  };
}

export async function safeMidPrice(
  runtime: TradingRuntime,
  poolKey: string,
): Promise<number | undefined> {
  try {
    return await queryPoolMidPrice(runtime, poolKey);
  } catch {
    return undefined;
  }
}

export function logStrategy(prefix: string, message: string, log: StrategyLog): void {
  log(`[${prefix}] ${message}`);
}
