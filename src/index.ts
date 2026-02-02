#!/usr/bin/env node

import { Command } from "commander";
import { loadLocalEnvFile } from "./load-env.js";
import { createProvider, SUPPORTED_PROVIDERS } from "./providers/index.js";
import type { DataProvider } from "./providers/types.js";
import { printResult, printStreamEvent, type OutputOptions } from "./output.js";
import { connectSSE } from "./sse.js";
import {
  clearScreen,
  hideCursor,
  renderOrderbookWatch,
  showCursor,
} from "./watch/orderbook.js";

interface GlobalOptions extends OutputOptions {
  provider: string;
  baseUrl: string;
  streamBaseUrl: string;
}

interface StreamTradesOptions {
  kind: string;
  reconnect: boolean;
  reconnectDelayMs: string;
}

interface OrderbookOptions {
  depth: string;
  watch?: boolean;
  intervalMs: string;
}

function getGlobals(command: Command): GlobalOptions {
  return command.optsWithGlobals() as GlobalOptions;
}

function parsePositiveInteger(value: string, field: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return parsed;
}

function createDataProvider(command: Command): DataProvider {
  const globals = getGlobals(command);
  return createProvider({
    providerName: globals.provider,
    restBaseUrl: globals.baseUrl,
    streamBaseUrl: globals.streamBaseUrl,
  });
}

function getOutputOptions(command: Command): OutputOptions {
  const globals = getGlobals(command);
  return { json: globals.json };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  loadLocalEnvFile(".env");

  const program = new Command();

  program
    .name("deepbook")
    .description("DeepBook CLI")
    .option("--json", "Output JSON")
    .option(
      "--provider <name>",
      `Data provider (${SUPPORTED_PROVIDERS.join(", ")})`,
      process.env.DEEP_PROVIDER ?? "surflux",
    )
    .option(
      "--base-url <url>",
      "Provider REST API base URL",
      process.env.SURFLUX_BASE_URL ?? "https://api.surflux.dev",
    )
    .option(
      "--stream-base-url <url>",
      "Provider stream base URL",
      process.env.SURFLUX_STREAM_BASE_URL ?? "https://flux.surflux.dev",
    )
    .showHelpAfterError();

  program
    .command("providers")
    .description("List supported data providers")
    .action(async function (this: Command) {
      printResult(SUPPORTED_PROVIDERS, getOutputOptions(this));
    });

  program
    .command("pools")
    .description("Get DeepBook pools")
    .action(async function (this: Command) {
      const provider = createDataProvider(this);
      const output = getOutputOptions(this);
      const data = await provider.getPools();
      printResult(data, output);
    });

  program
    .command("orderbook")
    .alias("book")
    .description("Get order book depth for a pool")
    .argument("<pool>", "Pool name, e.g. SUI_USDC")
    .option("--depth <n>", "Depth level to query", "20")
    .option("-w, --watch", "Watch mode - refresh repeatedly")
    .option("--interval-ms <ms>", "Refresh interval in milliseconds", "1000")
    .action(async function (this: Command, poolInput: string, options: OrderbookOptions) {
      const provider = createDataProvider(this);
      const output = getOutputOptions(this);
      const depth = parsePositiveInteger(options.depth, "depth");
      const intervalMs = parsePositiveInteger(options.intervalMs, "interval-ms");

      if (!options.watch) {
        const data = await provider.getOrderbook(poolInput, depth);
        printResult(data, output);
        return;
      }

      const controller = new AbortController();
      const stop = () => {
        controller.abort();
      };

      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);

      if (!output.json) {
        hideCursor();
      }

      try {
        while (!controller.signal.aborted) {
          try {
            const raw = await provider.getOrderbook(poolInput, depth);
            const normalized = provider.normalizeOrderbook(raw);

            if (output.json) {
              console.log(
                JSON.stringify({
                  timestamp: new Date().toISOString(),
                  provider: provider.name,
                  pool: poolInput,
                  orderbook: normalized,
                }),
              );
            } else {
              clearScreen();
              console.log(renderOrderbookWatch(poolInput, normalized, provider.name));
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (output.json) {
              console.log(
                JSON.stringify({
                  timestamp: new Date().toISOString(),
                  provider: provider.name,
                  pool: poolInput,
                  error: message,
                }),
              );
            } else {
              clearScreen();
              console.error(`Error: ${message}`);
              console.error(`Retrying in ${intervalMs}ms...`);
            }
          }

          if (!controller.signal.aborted) {
            await sleep(intervalMs);
          }
        }
      } finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        if (!output.json) {
          showCursor();
        }
      }
    });

  program
    .command("trades")
    .description("Get recent trades for a pool")
    .argument("<pool>", "Pool name, e.g. SUI_USDC")
    .option("--limit <n>", "Number of trades to fetch", "100")
    .action(async function (this: Command, poolInput: string, options: { limit: string }) {
      const provider = createDataProvider(this);
      const output = getOutputOptions(this);
      const limit = parsePositiveInteger(options.limit, "limit");

      const data = await provider.getTrades(poolInput, limit);
      printResult(data, output);
    });

  program
    .command("ohlcv")
    .description("Get OHLCV candles for a pool")
    .argument("<pool>", "Pool name, e.g. SUI_USDC")
    .option("--timeframe <value>", "Timeframe (for example 1m, 5m, 1h)", "5m")
    .option("--limit <n>", "Number of candles to fetch", "100")
    .action(async function (
      this: Command,
      poolInput: string,
      options: { timeframe: string; limit: string },
    ) {
      const provider = createDataProvider(this);
      const output = getOutputOptions(this);
      const limit = parsePositiveInteger(options.limit, "limit");

      const data = await provider.getOhlcv(poolInput, options.timeframe, limit);
      printResult(data, output);
    });

  const stream = program.command("stream").description("Read DeepBook streams over SSE");

  stream
    .command("trades")
    .description("Stream live trades for a pool")
    .argument("<pool>", "Pool name, e.g. SUI_USDC")
    .option("--kind <value>", "Provider-specific stream namespace/kind", "deepbook")
    .option("--no-reconnect", "Disable reconnect attempts")
    .option("--reconnect-delay-ms <ms>", "Delay before reconnecting (milliseconds)", "1000")
    .action(async function (this: Command, poolInput: string, options: StreamTradesOptions) {
      const provider = createDataProvider(this);
      const output = getOutputOptions(this);
      const reconnectDelayMs = parsePositiveInteger(options.reconnectDelayMs, "reconnect-delay-ms");
      const streamConnection = provider.createTradesStreamConnection({
        poolInput,
        kind: options.kind,
      });

      const controller = new AbortController();
      const stop = () => {
        controller.abort();
      };

      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);

      try {
        while (!controller.signal.aborted) {
          try {
            await connectSSE({
              url: streamConnection.url,
              signal: controller.signal,
              headers: streamConnection.headers,
              onEvent: (event) => {
                let parsedPayload: unknown = event.data;
                try {
                  parsedPayload = JSON.parse(event.data);
                } catch {
                  // Keep plain text payload if it is not JSON.
                }

                printStreamEvent(event.event, parsedPayload, output, streamConnection.poolLabel);
              },
            });
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            if (error.name === "AbortError" || controller.signal.aborted) {
              break;
            }

            if (!options.reconnect) {
              throw error;
            }

            if (!output.json) {
              console.error(`Stream error: ${error.message}`);
              console.error(`Reconnecting in ${reconnectDelayMs}ms...`);
            }
          }

          if (!options.reconnect || controller.signal.aborted) {
            break;
          }

          await sleep(reconnectDelayMs);
        }
      } finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
      }
    });

  await program.parseAsync(process.argv);
}

run().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
