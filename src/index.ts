#!/usr/bin/env node

import { Command } from "commander";
import { mainnetCoins, testnetCoins } from "@mysten/deepbook-v3";
import { readFileSync } from "node:fs";
import { createProvider, SUPPORTED_PROVIDERS } from "./providers/index.js";
import type { DataProvider } from "./providers/types.js";
import { printResult, printStreamEvent, type OutputOptions } from "./output.js";
import {
  clearScreen,
  hideCursor,
  renderOrderbookWatch,
  showCursor,
} from "./watch/orderbook.js";
import {
  assertCanPlaceLimitOrder,
  assertCanPlaceMarketOrder,
  createTradingRuntime,
  executeOrDryRunTransaction,
  generateClientOrderId,
  parseOrderSide,
  parseOrderType,
  parseSelfMatchingOption,
} from "./trading.js";
import {
  buildMarginCloseTransaction,
  buildCancelOrderTransaction,
  buildCreateManagerTransaction,
  buildDepositTransaction,
  buildLimitOrderTransaction,
  buildMarginLimitOrderTransaction,
  buildMarginDepositTransaction,
  buildMarginDepositTransactionWithNewManager,
  buildMarginLimitOrderTransactionWithNewManager,
  buildMarginSpotOrderTransactionWithNewManager,
  buildMarginSpotOrderTransaction,
  buildMarketOrderTransaction,
  buildSwapBaseForQuoteTransaction,
  buildSwapQuoteForBaseTransaction,
  buildMarginWithdrawTransaction,
  findMarginManagerIdForPool,
  getMarginStateAmounts,
  queryBalanceManagerIdsForOwner,
  queryMarginManagerIdsForOwner,
  buildWithdrawTransaction,
  queryManagerBalance,
  queryPoolMidPrice,
  queryPoolBookParams,
  queryMarginPosition,
  isMarginManagerCompatibleWithPool,
} from "./trade-operations.js";
import {
  ensureDeeptradeConfig,
  importDeeptradePrivateKey,
  listDeeptradeAccounts,
  parseDeeptradeNetwork,
  readDeeptradeConfig,
  resolveActiveDeeptradeAccount,
  resolveDefaultAddress,
  resolveDefaultPrivateKey,
  resolveDefaultTradeCap,
  resolveProviderName,
  resolveRpcUrl,
  resolveProviderRestBaseUrl,
  resolveProviderStreamBaseUrl,
  setDeeptradeActiveAccount,
  setDeeptradeAddress,
  setDeeptradeNetwork,
  setDeeptradeProvider,
  setDeeptradeRpcUrl,
  setDeeptradeTradeCap,
  setSurfluxBaseUrl,
  setSurfluxReadApiKey,
  setSurfluxStreamApiKey,
  setSurfluxStreamBaseUrl,
} from "./deepbook-config.js";

interface GlobalOptions extends OutputOptions {
  provider: string;
  baseUrl?: string;
  streamBaseUrl?: string;
  network: string;
  rpcUrl?: string;
  privateKey?: string;
  address?: string;
  manager?: string;
  tradeCap?: string;
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

interface SpotOrderOptions {
  manager?: string;
  quantity: string;
  price?: string;
  clientOrderId?: string;
  expiration?: string;
  orderType: string;
  selfMatch: string;
  payWithDeep: boolean;
  dryRun: boolean;
}

interface SpotLimitOptions {
  manager?: string;
  cancel?: string;
  side?: string;
  price?: string;
  quantity?: string;
  clientOrderId?: string;
  expiration?: string;
  orderType: string;
  selfMatch: string;
  payWithDeep: boolean;
  dryRun: boolean;
}

interface MarginLimitOptions {
  marginManager?: string;
  side: string;
  price: string;
  quantity: string;
  leverage: string;
  clientOrderId?: string;
  expiration?: string;
  orderType: string;
  selfMatch: string;
  payWithDeep: boolean;
  reduceOnly: boolean;
  dryRun: boolean;
}

interface MarginSpotOptions {
  marginManager?: string;
  side: string;
  quantity: string;
  leverage: string;
  clientOrderId?: string;
  selfMatch: string;
  payWithDeep: boolean;
  reduceOnly: boolean;
  dryRun: boolean;
}

interface MarginDepositOptions {
  marginManager?: string;
  coin: string;
  amount: string;
  dryRun: boolean;
}

interface MarginPositionOptions {
  marginManager?: string;
}

interface MarginPoolsOptions {
  registered?: boolean;
}

interface MarginCloseOptions {
  marginManager?: string;
  side?: string;
  quantity?: string;
  full: boolean;
  repay: boolean;
  withdraw: boolean;
  reduceOnly?: boolean;
  nonReduceOnly?: boolean;
  selfMatch: string;
  payWithDeep: boolean;
  dryRun: boolean;
}

interface TradeSwapOptions {
  amount: string;
  minOut: string;
  deepAmount: string;
  dryRun: boolean;
}

interface ManagerTxOptions {
  manager?: string;
  coin: string;
  amount: string;
  recipient?: string;
  dryRun: boolean;
}

interface AccountBalanceOptions {
  coin?: string;
}

function resolveCliVersion(): string {
  try {
    const packageJsonPath = new URL("../package.json", import.meta.url);
    const packageJsonRaw = readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(packageJsonRaw) as { version?: string };
    const version = parsed.version?.trim();
    if (version) {
      return version;
    }
  } catch {
    // ignore and use fallback
  }

  return "0.0.0";
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

function parsePositiveNumber(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive number.`);
  }
  return parsed;
}

function parseLeverage(value: string): number {
  const normalized = value.trim().toLowerCase().replace(/^x/, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Leverage must be >= 1. Received "${value}".`);
  }
  return parsed;
}

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

function quantizeDown(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value;
  }
  const units = Math.floor(value / step + 1e-9);
  return Number((units * step).toFixed(12));
}

function quantizeUp(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value;
  }
  const units = Math.ceil(value / step - 1e-9);
  return Number((units * step).toFixed(12));
}

function isStepAligned(value: number, step: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return false;
  }
  const units = Math.round(value / step);
  return Math.abs(value - units * step) <= Math.max(step * 1e-8, 1e-12);
}

function parseNonNegativeNumber(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${field} must be a non-negative number.`);
  }
  return parsed;
}

function parseExpirationTimestamp(value: string, field: string): number {
  const parsed = parsePositiveInteger(value, field);
  // DeepBook expects millisecond timestamps; accept second-based input for convenience.
  if (parsed < 1_000_000_000_000) {
    return parsed * 1000;
  }
  return parsed;
}

function createDataProvider(command: Command): DataProvider {
  const globals = getGlobals(command);
  const { config } = readDeeptradeConfig();
  const network = parseDeeptradeNetwork(globals.network);
  const providerName = resolveProviderName(globals.provider, config);
  return createProvider({
    providerName,
    network,
    restBaseUrl: resolveProviderRestBaseUrl(network, config, globals.baseUrl),
    streamBaseUrl: resolveProviderStreamBaseUrl(
      network,
      config,
      globals.streamBaseUrl,
    ),
  });
}

function getOutputOptions(command: Command): OutputOptions {
  const globals = getGlobals(command);
  return { json: globals.json };
}

async function resolveManagerId(
  command: Command,
  localManagerId?: string,
): Promise<string> {
  const globals = getGlobals(command);
  const managerId = (localManagerId ?? globals.manager)?.trim();

  if (managerId) {
    return managerId;
  }

  const runtime = createOnchainRuntime(command);
  const managerIds = await queryBalanceManagerIdsForOwner(
    runtime,
    runtime.address,
  );

  if (managerIds.length === 1) {
    return managerIds[0];
  }

  if (managerIds.length === 0) {
    throw new Error(
      'No balance manager found for this address. Pass --manager <object-id> or create one with "deepbook manager create".',
    );
  }

  throw new Error(
    `Multiple balance managers found (${managerIds.length}). Pass --manager <object-id> to select one, or run "deepbook manager ls".`,
  );
}

function resolveMarginManagerId(input: string | undefined): string | undefined {
  const marginManagerId = input?.trim();
  return marginManagerId || undefined;
}

function createMarginRuntime(
  command: Command,
  poolKey: string,
  marginManagerId: string,
) {
  return createOnchainRuntime(command, {
    marginManagerId,
    marginPoolKey: poolKey,
  });
}

async function resolveMarginRuntime(
  command: Command,
  poolKey: string,
  explicitMarginManagerId?: string,
): Promise<{
  runtime: ReturnType<typeof createOnchainRuntime>;
  marginManagerId?: string;
  createdInTransaction: boolean;
}> {
  const managerFromOption = resolveMarginManagerId(explicitMarginManagerId);
  if (managerFromOption) {
    const baseRuntime = createOnchainRuntime(command);
    const managerMatchesPool = await isMarginManagerCompatibleWithPool(
      baseRuntime,
      poolKey,
      managerFromOption,
      baseRuntime.address,
    );
    if (managerMatchesPool) {
      return {
        runtime: createMarginRuntime(command, poolKey, managerFromOption),
        marginManagerId: managerFromOption,
        createdInTransaction: false,
      };
    }

    throw new Error(
      `Provided --margin-manager ${managerFromOption} is not compatible with pool ${poolKey} for signer ${baseRuntime.address}. Pass a manager for this pool, or omit --margin-manager to auto-select/create one.`,
    );
  }

  const baseRuntime = createOnchainRuntime(command);
  const existingManagerId = await findMarginManagerIdForPool(
    baseRuntime,
    poolKey,
  );
  if (existingManagerId) {
    return {
      runtime: createMarginRuntime(command, poolKey, existingManagerId),
      marginManagerId: existingManagerId,
      createdInTransaction: false,
    };
  }

  return {
    runtime: baseRuntime,
    createdInTransaction: true,
  };
}

function createOnchainRuntime(
  command: Command,
  options?: {
    managerId?: string;
    marginManagerId?: string;
    marginPoolKey?: string;
  },
) {
  const globals = getGlobals(command);
  const { config } = readDeeptradeConfig();
  const network = parseDeeptradeNetwork(globals.network);
  const rpcUrl = resolveRpcUrl(network, globals.rpcUrl, config);

  return createTradingRuntime({
    network,
    rpcUrl,
    privateKey: resolveDefaultPrivateKey(config, globals.privateKey),
    address: resolveDefaultAddress(config, globals.address),
    balanceManagerId: options?.managerId,
    tradeCap: resolveDefaultTradeCap(config, globals.tradeCap),
    marginManagerId: options?.marginManagerId,
    marginPoolKey: options?.marginPoolKey,
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readAllFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

async function readSecretFromArgOrStdin(
  argValue: string | undefined,
  useStdin: boolean | undefined,
  label: string,
): Promise<string> {
  if (useStdin && argValue) {
    throw new Error(`Provide either [${label}] or --stdin, not both.`);
  }

  let value = argValue?.trim() ?? "";
  if (useStdin) {
    value = await readAllFromStdin();
  }

  if (!value) {
    throw new Error(`Missing ${label}. Pass [${label}] or use --stdin.`);
  }

  return value;
}

function resolveCoinTypeForNetwork(
  network: "mainnet" | "testnet",
  coinInput?: string,
): string | undefined {
  const raw = coinInput?.trim();
  if (!raw) {
    return undefined;
  }

  if (raw.includes("::")) {
    return raw;
  }

  const lookup = raw.toUpperCase();
  const coins = network === "mainnet" ? mainnetCoins : testnetCoins;
  const coin = (coins as Record<string, { type: string }>)[lookup];
  if (!coin) {
    throw new Error(
      `Unknown coin "${raw}" for ${network}. Pass a known key like SUI/USDC/DEEP or a full coin type.`,
    );
  }

  return coin.type;
}

function parseSwapInput(options: TradeSwapOptions): {
  amount: number;
  minOut: number;
  deepAmount: number;
} {
  return {
    amount: parsePositiveNumber(options.amount, "amount"),
    minOut: parseNonNegativeNumber(options.minOut, "min-out"),
    deepAmount: parseNonNegativeNumber(options.deepAmount, "deep-amount"),
  };
}

async function runSwapBaseForQuote(
  command: Command,
  poolKey: string,
  options: TradeSwapOptions,
): Promise<void> {
  const runtime = createOnchainRuntime(command);
  const parsed = parseSwapInput(options);
  const transaction = buildSwapBaseForQuoteTransaction(runtime, {
    poolKey,
    amount: parsed.amount,
    minOut: parsed.minOut,
    deepAmount: parsed.deepAmount,
  });

  const result = await executeOrDryRunTransaction(
    runtime,
    transaction,
    options.dryRun,
  );
  printResult(
    {
      execution: {
        kind: "swap",
        direction: "base-for-quote",
        poolKey,
        amount: parsed.amount,
        minOut: parsed.minOut,
        deepAmount: parsed.deepAmount,
      },
      result,
    },
    getOutputOptions(command),
  );
}

async function runSwapQuoteForBase(
  command: Command,
  poolKey: string,
  options: TradeSwapOptions,
): Promise<void> {
  const runtime = createOnchainRuntime(command);
  const parsed = parseSwapInput(options);
  const transaction = buildSwapQuoteForBaseTransaction(runtime, {
    poolKey,
    amount: parsed.amount,
    minOut: parsed.minOut,
    deepAmount: parsed.deepAmount,
  });

  const result = await executeOrDryRunTransaction(
    runtime,
    transaction,
    options.dryRun,
  );
  printResult(
    {
      execution: {
        kind: "swap",
        direction: "quote-for-base",
        poolKey,
        amount: parsed.amount,
        minOut: parsed.minOut,
        deepAmount: parsed.deepAmount,
      },
      result,
    },
    getOutputOptions(command),
  );
}

async function run(): Promise<void> {
  const { config } = ensureDeeptradeConfig();
  const defaultNetwork = config.network;
  const defaultProvider = resolveProviderName(undefined, config);
  const defaultAddress = resolveDefaultAddress(config);
  const defaultTradeCap = resolveDefaultTradeCap(config);

  const program = new Command();

  program
    .name("deepbook")
    .version(resolveCliVersion())
    .description("DeepBook CLI")
    .option("--json", "Output JSON")
    .option(
      "--provider <name>",
      `Data provider (${SUPPORTED_PROVIDERS.join(", ")})`,
      defaultProvider,
    )
    .option(
      "--base-url <url>",
      "Provider REST API base URL (defaults by network)",
    )
    .option(
      "--stream-base-url <url>",
      "Provider stream base URL (defaults by network)",
    )
    .option(
      "--network <name>",
      "Global network for both provider + on-chain operations (mainnet|testnet)",
      defaultNetwork,
    )
    .option(
      "--rpc-url <url>",
      "Sui JSON-RPC URL override for selected network alias",
    )
    .option(
      "--private-key <suiprivkey>",
      "Sui private key for signing (overrides stored key)",
    )
    .option(
      "--address <address>",
      "Sui address override for on-chain commands",
      defaultAddress,
    )
    .option(
      "--manager <id>",
      "DeepBook balance manager object ID (auto-discovered if omitted)",
    )
    .option(
      "--trade-cap <id>",
      "Optional DeepBook trade cap object ID",
      defaultTradeCap,
    )
    .showHelpAfterError();

  const configCommand = program
    .command("config")
    .description("Manage ~/.deepbook configuration");

  configCommand
    .command("show")
    .description("Show current configuration (private key hidden by default)")
    .option("--show-private-key", "Include private key in output")
    .action(async function (
      this: Command,
      options: { showPrivateKey?: boolean },
    ) {
      const current = readDeeptradeConfig();
      const activeProvider = resolveProviderName(undefined, current.config);
      const activeAccount = resolveActiveDeeptradeAccount(current.config);
      const accounts = listDeeptradeAccounts(current.config);
      const payload: Record<string, unknown> = {
        path: current.paths.configPath,
        network: current.config.network,
        provider: current.config.provider,
        activeProvider,
        hasPrivateKey: Boolean(activeAccount?.privateKey),
        activeAccountAlias: activeAccount?.alias ?? null,
        activeAccountAddress: activeAccount?.address ?? null,
        accountAliases: accounts.map((account) => account.alias),
        accountCount: accounts.length,
        address: current.config.address ?? null,
        tradeCap: current.config.tradeCap ?? null,
        rpcUrls: current.config.rpcUrls ?? {},
        activeRpcUrl: resolveRpcUrl(
          current.config.network,
          undefined,
          current.config,
        ),
        providerBaseUrls: current.config.providers?.surflux?.baseUrls ?? {},
        providerStreamBaseUrls:
          current.config.providers?.surflux?.streamBaseUrls ?? {},
        hasReadApiKey: Boolean(current.config.providers?.surflux?.readApiKey),
        streamKeyPools: Object.keys(
          current.config.providers?.surflux?.streamApiKeys ?? {},
        ).sort((a, b) => a.localeCompare(b)),
      };

      if (options.showPrivateKey) {
        payload.privateKey = activeAccount?.privateKey ?? null;
      }

      printResult(payload, getOutputOptions(this));
    });

  configCommand
    .command("set-network")
    .description("Set default network for provider + on-chain operations")
    .argument("<network>", "mainnet|testnet")
    .action(async function (this: Command, networkInput: string) {
      const updated = setDeeptradeNetwork(networkInput);
      printResult(
        {
          path: updated.paths.configPath,
          network: updated.config.network,
        },
        getOutputOptions(this),
      );
    });

  configCommand
    .command("set-provider")
    .description("Set global default provider")
    .argument("<provider>", SUPPORTED_PROVIDERS.join("|"))
    .action(async function (this: Command, providerInput: string) {
      const updated = setDeeptradeProvider(providerInput);
      printResult(
        {
          path: updated.paths.configPath,
          provider: updated.config.provider,
        },
        getOutputOptions(this),
      );
    });

  configCommand
    .command("set-rpc-url")
    .description("Set RPC URL for a network alias (mainnet|testnet)")
    .argument("<network>", "mainnet|testnet")
    .argument("<url>", "RPC URL to use for this network alias")
    .action(async function (
      this: Command,
      networkInput: string,
      rpcUrlInput: string,
    ) {
      const updated = setDeeptradeRpcUrl(networkInput, rpcUrlInput);
      const network = parseDeeptradeNetwork(networkInput);
      printResult(
        {
          path: updated.paths.configPath,
          network,
          rpcUrl: updated.config.rpcUrls?.[network] ?? null,
        },
        getOutputOptions(this),
      );
    });

  configCommand
    .command("set-address")
    .description("Set default on-chain address")
    .argument("<address>", "Sui address")
    .action(async function (this: Command, addressInput: string) {
      const updated = setDeeptradeAddress(addressInput);
      printResult(
        {
          path: updated.paths.configPath,
          address: updated.config.address ?? null,
        },
        getOutputOptions(this),
      );
    });

  configCommand
    .command("set-trade-cap")
    .description("Set default DeepBook trade cap object ID")
    .argument("<id>", "Object ID")
    .action(async function (this: Command, tradeCapInput: string) {
      const updated = setDeeptradeTradeCap(tradeCapInput);
      printResult(
        {
          path: updated.paths.configPath,
          tradeCap: updated.config.tradeCap ?? null,
        },
        getOutputOptions(this),
      );
    });

  configCommand
    .command("set-read-key")
    .description("Set global Surflux read API key")
    .argument("[apiKey]", "Surflux read API key")
    .option("--stdin", "Read API key from stdin")
    .action(async function (
      this: Command,
      apiKeyArg: string | undefined,
      options: { stdin?: boolean },
    ) {
      const apiKey = await readSecretFromArgOrStdin(
        apiKeyArg,
        options.stdin,
        "apiKey",
      );
      const updated = setSurfluxReadApiKey(apiKey);
      printResult(
        {
          path: updated.paths.configPath,
          hasReadApiKey: Boolean(updated.config.providers?.surflux?.readApiKey),
        },
        getOutputOptions(this),
      );
    });

  configCommand
    .command("set-stream-key")
    .description("Set global Surflux stream API key for a pool")
    .argument("<pool>", "Pool name, e.g. SUI_USDC")
    .argument("[apiKey]", "Surflux stream API key")
    .option("--stdin", "Read API key from stdin")
    .action(async function (
      this: Command,
      poolInput: string,
      apiKeyArg: string | undefined,
      options: { stdin?: boolean },
    ) {
      const apiKey = await readSecretFromArgOrStdin(
        apiKeyArg,
        options.stdin,
        "apiKey",
      );
      const updated = setSurfluxStreamApiKey(poolInput, apiKey);
      printResult(
        {
          path: updated.paths.configPath,
          pool: updated.poolName,
          hasStreamKey: true,
        },
        getOutputOptions(this),
      );
    });

  configCommand
    .command("set-provider-base-url")
    .description("Set global provider REST base URL alias by network")
    .argument("<network>", "mainnet|testnet")
    .argument("<url>", "REST base URL")
    .action(async function (
      this: Command,
      networkInput: string,
      urlInput: string,
    ) {
      const updated = setSurfluxBaseUrl(networkInput, urlInput);
      const network = parseDeeptradeNetwork(networkInput);
      printResult(
        {
          path: updated.paths.configPath,
          network,
          baseUrl:
            updated.config.providers?.surflux?.baseUrls?.[network] ?? null,
        },
        getOutputOptions(this),
      );
    });

  configCommand
    .command("set-provider-stream-base-url")
    .description("Set global provider stream base URL alias by network")
    .argument("<network>", "mainnet|testnet")
    .argument("<url>", "Stream base URL")
    .action(async function (
      this: Command,
      networkInput: string,
      urlInput: string,
    ) {
      const updated = setSurfluxStreamBaseUrl(networkInput, urlInput);
      const network = parseDeeptradeNetwork(networkInput);
      printResult(
        {
          path: updated.paths.configPath,
          network,
          streamBaseUrl:
            updated.config.providers?.surflux?.streamBaseUrls?.[network] ??
            null,
        },
        getOutputOptions(this),
      );
    });

  configCommand
    .command("import-key")
    .description("Import a Sui private key into ~/.deepbook/config.json")
    .argument("[privateKey]", "Sui bech32 private key (suiprivkey...)")
    .option(
      "--alias <name>",
      'Account alias (default: active alias or "default")',
    )
    .option("--stdin", "Read private key from stdin")
    .option("--no-activate", "Import key but keep current active account")
    .action(async function (
      this: Command,
      privateKeyArg: string | undefined,
      options: { alias?: string; stdin?: boolean; activate?: boolean },
    ) {
      const privateKey = await readSecretFromArgOrStdin(
        privateKeyArg,
        options.stdin,
        "privateKey",
      );
      const updated = importDeeptradePrivateKey(
        privateKey,
        undefined,
        options.alias,
        options.activate ?? true,
      );
      printResult(
        {
          path: updated.paths.configPath,
          network: updated.config.network,
          alias: updated.alias,
          address: updated.address,
          activeAccountAlias:
            resolveActiveDeeptradeAccount(updated.config)?.alias ?? null,
          hasPrivateKey: Boolean(
            resolveActiveDeeptradeAccount(updated.config)?.privateKey,
          ),
        },
        getOutputOptions(this),
      );
    });

  const account = program
    .command("account")
    .description("Manage local wallet accounts");

  account
    .command("details")
    .description("Show active account alias and derived address")
    .action(async function (this: Command) {
      const current = readDeeptradeConfig();
      const active = resolveActiveDeeptradeAccount(current.config);
      if (!active) {
        throw new Error(
          'No active account found. Import one with "deepbook account import <alias> [privateKey]".',
        );
      }

      printResult(
        {
          path: current.paths.configPath,
          alias: active.alias,
          address: active.address,
        },
        getOutputOptions(this),
      );
    });

  account
    .command("list")
    .description("List configured account aliases")
    .action(async function (this: Command) {
      const current = readDeeptradeConfig();
      const active = resolveActiveDeeptradeAccount(current.config);
      const accounts = listDeeptradeAccounts(current.config);
      printResult(
        {
          path: current.paths.configPath,
          activeAlias: active?.alias ?? null,
          accounts,
        },
        getOutputOptions(this),
      );
    });

  account
    .command("balance")
    .description("Show wallet balances (all coins, or a specific coin)")
    .option(
      "--coin <keyOrType>",
      "Coin key (e.g. SUI, USDC, DEEP) or full coin type",
    )
    .action(async function (this: Command, options: AccountBalanceOptions) {
      const runtime = createOnchainRuntime(this);
      const coinType = resolveCoinTypeForNetwork(runtime.network, options.coin);

      if (coinType) {
        const balance = await runtime.suiClient.getBalance({
          owner: runtime.address,
          coinType,
        });
        printResult(
          {
            network: runtime.network,
            address: runtime.address,
            coinType,
            balance,
          },
          getOutputOptions(this),
        );
        return;
      }

      const balances = await runtime.suiClient.getAllBalances({
        owner: runtime.address,
      });
      printResult(
        {
          network: runtime.network,
          address: runtime.address,
          balances,
        },
        getOutputOptions(this),
      );
    });

  account
    .command("import")
    .description("Import a private key under an alias")
    .argument("<alias>", "Account alias")
    .argument("[privateKey]", "Sui bech32 private key (suiprivkey...)")
    .option("--stdin", "Read private key from stdin")
    .option("--no-activate", "Import key but keep current active account")
    .action(async function (
      this: Command,
      aliasInput: string,
      privateKeyArg: string | undefined,
      options: { stdin?: boolean; activate?: boolean },
    ) {
      const privateKey = await readSecretFromArgOrStdin(
        privateKeyArg,
        options.stdin,
        "privateKey",
      );
      const updated = importDeeptradePrivateKey(
        privateKey,
        undefined,
        aliasInput,
        options.activate ?? true,
      );

      printResult(
        {
          path: updated.paths.configPath,
          alias: updated.alias,
          address: updated.address,
          activeAlias:
            resolveActiveDeeptradeAccount(updated.config)?.alias ?? null,
          activated:
            resolveActiveDeeptradeAccount(updated.config)?.alias ===
            updated.alias,
        },
        getOutputOptions(this),
      );
    });

  account
    .command("use")
    .description("Switch active account alias")
    .argument("<alias>", "Account alias")
    .action(async function (this: Command, aliasInput: string) {
      const updated = setDeeptradeActiveAccount(aliasInput);
      printResult(
        {
          path: updated.paths.configPath,
          alias: updated.alias,
          address: updated.address,
        },
        getOutputOptions(this),
      );
    });

  program
    .command("providers")
    .description("List supported data providers")
    .action(async function (this: Command) {
      printResult(SUPPORTED_PROVIDERS, getOutputOptions(this));
    });

  program
    .command("pools")
    .description("Get all DeepBook pools (spot + margin)")
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
    .action(async function (
      this: Command,
      poolInput: string,
      options: OrderbookOptions,
    ) {
      const provider = createDataProvider(this);
      const output = getOutputOptions(this);
      const depth = parsePositiveInteger(options.depth, "depth");
      const intervalMs = parsePositiveInteger(
        options.intervalMs,
        "interval-ms",
      );

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
              console.log(
                renderOrderbookWatch(poolInput, normalized, provider.name),
              );
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
    .action(async function (
      this: Command,
      poolInput: string,
      options: { limit: string },
    ) {
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

  const stream = program
    .command("stream")
    .description("Read DeepBook streams over SSE");

  stream
    .command("trades")
    .description("Stream live trades for a pool")
    .argument("<pool>", "Pool name, e.g. SUI_USDC")
    .option(
      "--kind <value>",
      "Provider-specific stream namespace/kind",
      "deepbook",
    )
    .option("--no-reconnect", "Disable reconnect attempts")
    .option(
      "--reconnect-delay-ms <ms>",
      "Delay before reconnecting (milliseconds)",
      "1000",
    )
    .action(async function (
      this: Command,
      poolInput: string,
      options: StreamTradesOptions,
    ) {
      const provider = createDataProvider(this);
      const output = getOutputOptions(this);
      const reconnectDelayMs = parsePositiveInteger(
        options.reconnectDelayMs,
        "reconnect-delay-ms",
      );
      await new Promise<void>((resolve, reject) => {
        let finished = false;
        let subscription:
          | ReturnType<typeof provider.subscribeTrades>
          | undefined;

        const finish = (error?: Error) => {
          if (finished) {
            return;
          }

          finished = true;
          process.off("SIGINT", stop);
          process.off("SIGTERM", stop);
          if (error) {
            reject(error);
            return;
          }

          resolve();
        };

        const stop = () => {
          subscription?.stop();
          finish();
        };

        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);

        subscription = provider.subscribeTrades(
          {
            poolInput,
            kind: options.kind,
          },
          (event) => {
            printStreamEvent(
              event.event,
              event.data,
              output,
              event.pool,
            );
          },
          {
            reconnect: options.reconnect,
            reconnectDelayMs,
            onError: (error) => {
              if (error.name === "AbortError" || finished) {
                return;
              }

              if (!output.json) {
                console.error(`Stream error: ${error.message}`);
                if (options.reconnect) {
                  console.error(`Reconnecting in ${reconnectDelayMs}ms...`);
                }
              }

              if (!options.reconnect) {
                subscription?.stop();
                finish(error);
              }
            },
          },
        );
      });
    });

  const swap = program
    .command("swap")
    .description("Execute direct pool swaps on-chain");
  const spot = program
    .command("spot")
    .description("Execute Pool order operations using a balance manager");

  const registerSwapBaseForQuoteCommand = (
    parent: Command,
    commandName: string,
    description: string,
  ) => {
    parent
      .command(commandName)
      .description(description)
      .argument("<pool>", "DeepBook pool key, e.g. SUI_USDC")
      .requiredOption("--amount <value>", "Base amount")
      .option("--min-out <value>", "Minimum quote out", "0")
      .option("--deep-amount <value>", "DEEP amount to use", "0")
      .option("--dry-run", "Build and simulate without broadcasting")
      .action(async function (
        this: Command,
        poolKey: string,
        options: TradeSwapOptions,
      ) {
        await runSwapBaseForQuote(this, poolKey, options);
      });
  };

  const registerSwapQuoteForBaseCommand = (
    parent: Command,
    commandName: string,
    description: string,
  ) => {
    parent
      .command(commandName)
      .description(description)
      .argument("<pool>", "DeepBook pool key, e.g. SUI_USDC")
      .requiredOption("--amount <value>", "Quote amount")
      .option("--min-out <value>", "Minimum base out", "0")
      .option("--deep-amount <value>", "DEEP amount to use", "0")
      .option("--dry-run", "Build and simulate without broadcasting")
      .action(async function (
        this: Command,
        poolKey: string,
        options: TradeSwapOptions,
      ) {
        await runSwapQuoteForBase(this, poolKey, options);
      });
  };

  registerSwapBaseForQuoteCommand(
    swap,
    "base-for-quote",
    "Direct swap: exact base input for quote output (pool swap)",
  );
  registerSwapQuoteForBaseCommand(
    swap,
    "quote-for-base",
    "Direct swap: exact quote input for base output (pool swap)",
  );

  spot
    .command("pools")
    .description("Get DeepBook spot pools")
    .action(async function (this: Command) {
      const provider = createDataProvider(this);
      const output = getOutputOptions(this);
      const data = await provider.getSpotPools();
      printResult(data, output);
    });

  const registerSpotSideCommand = (side: "buy" | "sell") => {
    spot
      .command(side)
      .description(
        side === "buy"
          ? "Place a spot buy order (market by default, limit with --price)"
          : "Place a spot sell order (market by default, limit with --price)",
      )
      .argument("<pool>", "DeepBook pool key, e.g. SUI_USDC")
      .option("--manager <id>", "Balance manager object ID")
      .requiredOption("--quantity <value>", "Base quantity")
      .option("--price <value>", "Limit price (omit for market order)")
      .option("--client-order-id <id>", "Client order id (u64 string)")
      .option(
        "--expiration <unix-ms>",
        "Order expiration timestamp in unix ms (seconds also accepted and auto-converted)",
      )
      .option("--order-type <value>", "none|ioc|fok|post-only", "none")
      .option(
        "--self-match <value>",
        "allow|cancel-taker|cancel-maker",
        "allow",
      )
      .option("--no-pay-with-deep", "Do not pay fees with DEEP")
      .option("--dry-run", "Build and simulate without broadcasting")
      .action(async function (
        this: Command,
        poolKey: string,
        options: SpotOrderOptions,
      ) {
        const managerId = await resolveManagerId(this, options.manager);
        const runtime = createOnchainRuntime(this, { managerId });
        const output = getOutputOptions(this);
        const clientOrderId = (
          options.clientOrderId?.trim() || generateClientOrderId()
        ).trim();
        const isBid = side === "buy";
        const quantity = parsePositiveNumber(options.quantity, "quantity");
        const hasLimitPrice = Boolean(options.price?.trim());

        if (!hasLimitPrice && options.expiration) {
          throw new Error("--expiration requires --price (limit order mode).");
        }

        if (hasLimitPrice) {
          const expiration = options.expiration
            ? parseExpirationTimestamp(options.expiration, "expiration")
            : undefined;
          const price = parsePositiveNumber(options.price ?? "", "price");
          await assertCanPlaceLimitOrder(runtime, {
            poolKey,
            price,
            quantity,
            isBid,
            payWithDeep: options.payWithDeep,
            expireTimestamp: expiration ?? Date.now() + 24 * 60 * 60 * 1000,
          });
          const transaction = buildLimitOrderTransaction(runtime, {
            poolKey,
            clientOrderId,
            price,
            quantity,
            isBid,
            orderType: parseOrderType(options.orderType),
            selfMatchingOption: parseSelfMatchingOption(options.selfMatch),
            payWithDeep: options.payWithDeep,
            ...(expiration ? { expiration } : {}),
          });
          const result = await executeOrDryRunTransaction(
            runtime,
            transaction,
            options.dryRun,
          );
          printResult(
            {
              execution: {
                kind: "spot",
                type: "limit",
                side,
                poolKey,
                quantity,
                price,
                managerId,
              },
              result,
            },
            output,
          );
          return;
        }

        await assertCanPlaceMarketOrder(runtime, {
          poolKey,
          quantity,
          isBid,
          payWithDeep: options.payWithDeep,
        });
        const transaction = buildMarketOrderTransaction(runtime, {
          poolKey,
          clientOrderId,
          quantity,
          isBid,
          selfMatchingOption: parseSelfMatchingOption(options.selfMatch),
          payWithDeep: options.payWithDeep,
        });
        const result = await executeOrDryRunTransaction(
          runtime,
          transaction,
          options.dryRun,
        );
        printResult(
          {
            execution: {
              kind: "spot",
              type: "market",
              side,
              poolKey,
              quantity,
              managerId,
            },
            result,
          },
          output,
        );
      });
  };

  registerSpotSideCommand("buy");
  registerSpotSideCommand("sell");

  spot
    .command("limit")
    .description("Place a spot limit order or cancel one via --cancel")
    .argument("<pool>", "DeepBook pool key, e.g. SUI_USDC")
    .option("--manager <id>", "Balance manager object ID")
    .option("--cancel <id>", "Cancel order ID (u128 string) instead of placing")
    .option("--side <value>", "buy|sell")
    .option("--price <value>", "Limit price")
    .option("--quantity <value>", "Base quantity")
    .option("--client-order-id <id>", "Client order id (u64 string)")
    .option(
      "--expiration <unix-ms>",
      "Order expiration timestamp in unix ms (seconds also accepted and auto-converted)",
    )
    .option("--order-type <value>", "none|ioc|fok|post-only", "none")
    .option("--self-match <value>", "allow|cancel-taker|cancel-maker", "allow")
    .option("--no-pay-with-deep", "Do not pay fees with DEEP")
    .option("--dry-run", "Build and simulate without broadcasting")
    .action(async function (
      this: Command,
      poolKey: string,
      options: SpotLimitOptions,
    ) {
      const managerId = await resolveManagerId(this, options.manager);
      const runtime = createOnchainRuntime(this, { managerId });
      const output = getOutputOptions(this);

      if (options.cancel?.trim()) {
        const orderId = options.cancel.trim();
        const transaction = buildCancelOrderTransaction(runtime, {
          poolKey,
          orderId,
        });

        const result = await executeOrDryRunTransaction(
          runtime,
          transaction,
          options.dryRun,
        );
        printResult(
          {
            execution: {
              kind: "spot",
              type: "cancel",
              poolKey,
              orderId,
              managerId,
            },
            result,
          },
          output,
        );
        return;
      }

      if (!options.side?.trim()) {
        throw new Error("--side is required unless --cancel is provided.");
      }
      if (!options.price?.trim()) {
        throw new Error("--price is required unless --cancel is provided.");
      }
      if (!options.quantity?.trim()) {
        throw new Error("--quantity is required unless --cancel is provided.");
      }

      const expiration = options.expiration
        ? parseExpirationTimestamp(options.expiration, "expiration")
        : undefined;
      const clientOrderId = (
        options.clientOrderId?.trim() || generateClientOrderId()
      ).trim();
      const quantity = parsePositiveNumber(options.quantity, "quantity");
      const price = parsePositiveNumber(options.price, "price");
      const isBid = parseOrderSide(options.side);

      await assertCanPlaceLimitOrder(runtime, {
        poolKey,
        price,
        quantity,
        isBid,
        payWithDeep: options.payWithDeep,
        expireTimestamp: expiration ?? Date.now() + 24 * 60 * 60 * 1000,
      });

      const transaction = buildLimitOrderTransaction(runtime, {
        poolKey,
        clientOrderId,
        price,
        quantity,
        isBid,
        orderType: parseOrderType(options.orderType),
        selfMatchingOption: parseSelfMatchingOption(options.selfMatch),
        payWithDeep: options.payWithDeep,
        ...(expiration ? { expiration } : {}),
      });

      const result = await executeOrDryRunTransaction(
        runtime,
        transaction,
        options.dryRun,
      );
      printResult(
        {
          execution: {
            kind: "spot",
            type: "limit",
            side: isBid ? "buy" : "sell",
            poolKey,
            quantity,
            price,
            managerId,
          },
          result,
        },
        output,
      );
    });

  const margin = program
    .command("margin")
    .description("Execute DeepBook margin trades using a margin manager");

  margin
    .command("pools")
    .description("Get DeepBook margin pools")
    .option(
      "--registered",
      "Only include margin pools that are registered to DeepBook margin trading pairs",
    )
    .action(async function (this: Command, options: MarginPoolsOptions) {
      const provider = createDataProvider(this);
      const output = getOutputOptions(this);
      const data = await provider.getMarginPools({
        registered: options.registered,
      });
      printResult(data, output);
    });

  margin
    .command("managers")
    .description("List margin manager IDs for your address")
    .action(async function (this: Command) {
      const runtime = createOnchainRuntime(this);
      const marginManagers = await queryMarginManagerIdsForOwner(
        runtime,
        runtime.address,
      );
      printResult(
        {
          network: runtime.network,
          address: runtime.address,
          marginManagers,
        },
        getOutputOptions(this),
      );
    });

  margin
    .command("deposit")
    .description(
      "Deposit collateral/fee asset into a margin manager (BASE|QUOTE|DEEP or pool coin key)",
    )
    .argument("<pool>", "DeepBook pool key, e.g. SUI_USDC")
    .option(
      "--margin-manager <id>",
      "Margin manager object ID (auto-discovered if omitted)",
    )
    .requiredOption("--coin <value>", "BASE|QUOTE|DEEP or pool coin key")
    .requiredOption("--amount <value>", "Amount to deposit")
    .option("--dry-run", "Build and simulate without broadcasting")
    .action(async function (
      this: Command,
      poolKey: string,
      options: MarginDepositOptions,
    ) {
      const resolved = await resolveMarginRuntime(
        this,
        poolKey,
        options.marginManager,
      );
      const amount = parsePositiveNumber(options.amount, "amount");
      const transaction = resolved.createdInTransaction
        ? buildMarginDepositTransactionWithNewManager(resolved.runtime, {
            poolKey,
            coin: options.coin,
            amount,
          })
        : buildMarginDepositTransaction(resolved.runtime, {
            poolKey,
            coin: options.coin,
            amount,
          });

      const result = await executeOrDryRunTransaction(
        resolved.runtime,
        transaction,
        options.dryRun,
      );
      const marginManagerId =
        resolved.marginManagerId ??
        (!options.dryRun
          ? await findMarginManagerIdForPool(resolved.runtime, poolKey)
          : undefined);
      printResult(
        {
          poolKey,
          coin: options.coin,
          amount,
          marginManagerId: marginManagerId ?? null,
          createdMarginManager:
            resolved.createdInTransaction && !resolved.marginManagerId,
          result,
        },
        getOutputOptions(this),
      );
    });

  margin
    .command("market")
    .description("Place a margin market order")
    .argument("<pool>", "DeepBook pool key, e.g. SUI_USDC")
    .option(
      "--margin-manager <id>",
      "Margin manager object ID (auto-discovered if omitted)",
    )
    .requiredOption("--side <value>", "buy|sell")
    .requiredOption("--quantity <value>", "Base quantity")
    .option(
      "--leverage <value>",
      "Leverage multiplier (for example 1, 2, x3)",
      "1",
    )
    .option("--client-order-id <id>", "Client order id (u64 string)")
    .option("--self-match <value>", "allow|cancel-taker|cancel-maker", "allow")
    .option("--no-pay-with-deep", "Do not pay fees with DEEP")
    .option("--reduce-only", "Place reduce-only market order")
    .option("--dry-run", "Build and simulate without broadcasting")
    .action(async function (
      this: Command,
      poolKey: string,
      options: MarginSpotOptions,
    ) {
      const resolved = await resolveMarginRuntime(
        this,
        poolKey,
        options.marginManager,
      );
      const output = getOutputOptions(this);
      const clientOrderId = (
        options.clientOrderId?.trim() || generateClientOrderId()
      ).trim();
      const isBid = parseOrderSide(options.side);
      const leverage = parseLeverage(options.leverage);
      const quantity = parsePositiveNumber(options.quantity, "quantity");
      const requiresMidPrice = isBid;
      const midPrice = requiresMidPrice
        ? await queryPoolMidPrice(resolved.runtime, poolKey)
        : null;
      if (requiresMidPrice && (!midPrice || !Number.isFinite(midPrice) || midPrice <= 0)) {
        throw new Error(
          `Unable to compute pricing for ${poolKey}: invalid mid price.`,
        );
      }

      const collateralBaseQuantity = !isBid ? quantity : 0;
      const collateralQuoteQuantity =
        isBid && midPrice
          ? (quantity * midPrice) / leverage
          : 0;
      const borrowBaseAmount = !isBid ? quantity * (leverage - 1) : 0;
      const borrowQuoteAmount =
        isBid && midPrice
          ? quantity * midPrice - collateralQuoteQuantity
          : 0;
      const orderQuantity = !isBid ? quantity * leverage : quantity;
      const feeBufferBaseAmount =
        options.payWithDeep || isBid
          ? 0
          : estimateMarginFeeBuffer(orderQuantity, MIN_MARGIN_BASE_FEE_BUFFER);
      const feeBufferQuoteAmount =
        options.payWithDeep || !isBid || !midPrice
          ? 0
          : estimateMarginFeeBuffer(
              orderQuantity * midPrice,
              MIN_MARGIN_QUOTE_FEE_BUFFER,
            );
      const feeBufferDeepAmount = options.payWithDeep
        ? Math.max(MIN_MARGIN_DEEP_FEE_BUFFER, orderQuantity * 0.01)
        : 0;

      const orderInput = {
        poolKey,
        clientOrderId,
        quantity: orderQuantity,
        isBid,
        selfMatchingOption: parseSelfMatchingOption(options.selfMatch),
        payWithDeep: options.payWithDeep,
        reduceOnly: options.reduceOnly,
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
      const transaction = resolved.createdInTransaction
        ? buildMarginSpotOrderTransactionWithNewManager(
            resolved.runtime,
            orderInput,
          )
        : buildMarginSpotOrderTransaction(resolved.runtime, orderInput);

      const result = await executeOrDryRunTransaction(
        resolved.runtime,
        transaction,
        options.dryRun,
      );
      const marginManagerId =
        resolved.marginManagerId ??
        (!options.dryRun
          ? await findMarginManagerIdForPool(resolved.runtime, poolKey)
          : undefined);
      const position = marginManagerId
        ? await queryMarginPosition(
            createMarginRuntime(this, poolKey, marginManagerId),
          )
        : null;

      printResult(
        {
          leverage,
          collateralBaseQuantity: collateralBaseQuantity || null,
          collateralQuoteQuantity: collateralQuoteQuantity || null,
          feeBufferBaseAmount: feeBufferBaseAmount || null,
          feeBufferQuoteAmount: feeBufferQuoteAmount || null,
          feeBufferDeepAmount: feeBufferDeepAmount || null,
          borrowBaseAmount: borrowBaseAmount || null,
          borrowQuoteAmount: borrowQuoteAmount || null,
          midPrice,
          orderQuantity,
          marginManagerId: marginManagerId ?? null,
          createdMarginManager:
            resolved.createdInTransaction && !resolved.marginManagerId,
          result,
          position,
        },
        output,
      );
    });

  margin
    .command("limit")
    .description("Place a margin limit order")
    .argument("<pool>", "DeepBook pool key, e.g. SUI_USDC")
    .option(
      "--margin-manager <id>",
      "Margin manager object ID (auto-discovered if omitted)",
    )
    .requiredOption("--side <value>", "buy|sell")
    .requiredOption("--price <value>", "Limit price")
    .requiredOption("--quantity <value>", "Base quantity")
    .option(
      "--leverage <value>",
      "Leverage multiplier (for example 1, 2, x3)",
      "1",
    )
    .option("--client-order-id <id>", "Client order id (u64 string)")
    .option(
      "--expiration <unix-ms>",
      "Order expiration timestamp in unix ms (seconds also accepted and auto-converted)",
    )
    .option("--order-type <value>", "none|ioc|fok|post-only", "none")
    .option("--self-match <value>", "allow|cancel-taker|cancel-maker", "allow")
    .option("--no-pay-with-deep", "Do not pay fees with DEEP")
    .option("--reduce-only", "Place reduce-only limit order")
    .option("--dry-run", "Build and simulate without broadcasting")
    .action(async function (
      this: Command,
      poolKey: string,
      options: MarginLimitOptions,
    ) {
      const resolved = await resolveMarginRuntime(
        this,
        poolKey,
        options.marginManager,
      );
      const output = getOutputOptions(this);
      const expiration = options.expiration
        ? parseExpirationTimestamp(options.expiration, "expiration")
        : undefined;
      const clientOrderId = (
        options.clientOrderId?.trim() || generateClientOrderId()
      ).trim();
      const isBid = parseOrderSide(options.side);
      const leverage = parseLeverage(options.leverage);
      const quantity = parsePositiveNumber(options.quantity, "quantity");
      const price = parsePositiveNumber(options.price, "price");

      const collateralBaseQuantity = !isBid ? quantity : 0;
      const collateralQuoteQuantity =
        isBid
          ? (quantity * price) / leverage
          : 0;
      const borrowBaseAmount = !isBid ? quantity * (leverage - 1) : 0;
      const borrowQuoteAmount =
        isBid
          ? quantity * price - collateralQuoteQuantity
          : 0;
      const orderQuantity = !isBid ? quantity * leverage : quantity;
      const feeBufferBaseAmount =
        options.payWithDeep || isBid
          ? 0
          : estimateMarginFeeBuffer(orderQuantity, MIN_MARGIN_BASE_FEE_BUFFER);
      const feeBufferQuoteAmount =
        options.payWithDeep || !isBid
          ? 0
          : estimateMarginFeeBuffer(
              orderQuantity * price,
              MIN_MARGIN_QUOTE_FEE_BUFFER,
            );
      const feeBufferDeepAmount = options.payWithDeep
        ? Math.max(MIN_MARGIN_DEEP_FEE_BUFFER, orderQuantity * 0.01)
        : 0;

      const orderInput = {
        poolKey,
        clientOrderId,
        price,
        quantity: orderQuantity,
        isBid,
        orderType: parseOrderType(options.orderType),
        selfMatchingOption: parseSelfMatchingOption(options.selfMatch),
        payWithDeep: options.payWithDeep,
        reduceOnly: options.reduceOnly,
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
        ...(expiration ? { expiration } : {}),
      };
      const transaction = resolved.createdInTransaction
        ? buildMarginLimitOrderTransactionWithNewManager(
            resolved.runtime,
            orderInput,
          )
        : buildMarginLimitOrderTransaction(resolved.runtime, orderInput);

      const result = await executeOrDryRunTransaction(
        resolved.runtime,
        transaction,
        options.dryRun,
      );
      const marginManagerId =
        resolved.marginManagerId ??
        (!options.dryRun
          ? await findMarginManagerIdForPool(resolved.runtime, poolKey)
          : undefined);
      const position = marginManagerId
        ? await queryMarginPosition(
            createMarginRuntime(this, poolKey, marginManagerId),
          )
        : null;

      printResult(
        {
          leverage,
          collateralBaseQuantity: collateralBaseQuantity || null,
          collateralQuoteQuantity: collateralQuoteQuantity || null,
          feeBufferBaseAmount: feeBufferBaseAmount || null,
          feeBufferQuoteAmount: feeBufferQuoteAmount || null,
          feeBufferDeepAmount: feeBufferDeepAmount || null,
          borrowBaseAmount: borrowBaseAmount || null,
          borrowQuoteAmount: borrowQuoteAmount || null,
          midPrice: null,
          orderQuantity,
          marginManagerId: marginManagerId ?? null,
          createdMarginManager:
            resolved.createdInTransaction && !resolved.marginManagerId,
          result,
          position,
        },
        output,
      );
    });

  margin
    .command("position")
    .description("Show current margin position and open orders")
    .argument("<pool>", "DeepBook pool key, e.g. SUI_USDC")
    .option(
      "--margin-manager <id>",
      "Margin manager object ID (auto-discovered if omitted)",
    )
    .action(async function (
      this: Command,
      poolKey: string,
      options: MarginPositionOptions,
    ) {
      const explicit = resolveMarginManagerId(options.marginManager);
      const runtimeForLookup = createOnchainRuntime(this);
      const marginManagerId =
        explicit ??
        (await findMarginManagerIdForPool(runtimeForLookup, poolKey));
      if (!marginManagerId) {
        throw new Error(
          "No margin manager found for this pool. Place a margin order first or pass --margin-manager <id>.",
        );
      }

      const runtime = createMarginRuntime(this, poolKey, marginManagerId);
      const position = await queryMarginPosition(runtime);
      printResult({ marginManagerId, ...position }, getOutputOptions(this));
    });

  margin
    .command("close")
    .description(
      "Close a margin position (supports full close, reduce-only, repay, and withdraw)",
    )
    .argument("<pool>", "DeepBook pool key, e.g. SUI_USDC")
    .option(
      "--margin-manager <id>",
      "Margin manager object ID (auto-discovered if omitted)",
    )
    .option("--side <value>", "buy|sell (optional with --full)")
    .option("--quantity <value>", "Base quantity (optional with --full)")
    .option(
      "--full",
      "Auto-close the full position based on current debt/asset state",
    )
    .option("--no-repay", "Skip debt repayment")
    .option("--withdraw", "Withdraw remaining margin assets after close/repay")
    .option("--reduce-only", "Force reduce-only close order mode")
    .option("--non-reduce-only", "Use non-reduce-only order mode")
    .option("--self-match <value>", "allow|cancel-taker|cancel-maker", "allow")
    .option("--no-pay-with-deep", "Do not pay fees with DEEP")
    .option("--dry-run", "Build and simulate without broadcasting")
    .action(async function (
      this: Command,
      poolKey: string,
      options: MarginCloseOptions,
    ) {
      const explicit = resolveMarginManagerId(options.marginManager);
      const runtimeForLookup = createOnchainRuntime(this);
      const marginManagerId =
        explicit ??
        (await findMarginManagerIdForPool(runtimeForLookup, poolKey));
      if (!marginManagerId) {
        throw new Error(
          "No margin manager found for this pool. Place a margin order first or pass --margin-manager <id>.",
        );
      }

      const runtime = createMarginRuntime(this, poolKey, marginManagerId);
      const output = getOutputOptions(this);
      const positionBefore = await queryMarginPosition(runtime);
      const amountsBefore = getMarginStateAmounts(
        runtime,
        poolKey,
        positionBefore.managerState,
      );

      if (options.reduceOnly && options.nonReduceOnly) {
        throw new Error(
          "Use either --reduce-only or --non-reduce-only, not both.",
        );
      }
      let reduceOnly = options.nonReduceOnly ? false : true;

      let closeIsBid: boolean | undefined;
      let closeQuantity: number | undefined;
      let closeQuantityAdjustedReason: string | null = null;

      if (options.full) {
        if (options.quantity) {
          throw new Error("Do not pass --quantity with --full.");
        }

        if (options.side) {
          closeIsBid = parseOrderSide(options.side);
          closeQuantity = closeIsBid
            ? amountsBefore.baseDebt
            : amountsBefore.baseAsset;
          if (!Number.isFinite(closeQuantity) || closeQuantity <= 0) {
            throw new Error(
              closeIsBid
                ? "Cannot infer --full buy quantity: no base debt to cover."
                : "Cannot infer --full sell quantity: no base asset to sell.",
            );
          }
        } else if (
          amountsBefore.baseDebtRaw > 0n &&
          amountsBefore.quoteDebtRaw > 0n
        ) {
          throw new Error(
            "Both base and quote debt are non-zero. Pass --side with --full to choose close direction.",
          );
        } else if (amountsBefore.baseDebtRaw > 0n) {
          closeIsBid = true;
          closeQuantity = amountsBefore.baseDebt;
        } else if (amountsBefore.quoteDebtRaw > 0n) {
          closeIsBid = false;
          closeQuantity = amountsBefore.baseAsset;
          if (!Number.isFinite(closeQuantity) || closeQuantity <= 0) {
            throw new Error(
              "Cannot infer --full sell quantity: quote debt exists but base asset is zero.",
            );
          }
        }
      } else {
        if (!options.side) {
          throw new Error("Missing --side. Use buy|sell, or pass --full.");
        }
        if (!options.quantity) {
          throw new Error(
            "Missing --quantity. Pass a positive base quantity, or use --full.",
          );
        }
        closeIsBid = parseOrderSide(options.side);
        closeQuantity = parsePositiveNumber(options.quantity, "quantity");
      }

      const repayBaseDebt = options.repay && amountsBefore.baseDebtRaw > 0n;
      const repayQuoteDebt = options.repay && amountsBefore.quoteDebtRaw > 0n;
      const shouldPlaceCloseOrder =
        typeof closeIsBid === "boolean" && Number(closeQuantity) > 0;

      if (shouldPlaceCloseOrder && closeQuantity) {
        const bookParams = await queryPoolBookParams(runtime, poolKey);
        const lotSize = bookParams.lotSize;
        const minSize = bookParams.minSize;

        if (options.full) {
          if (reduceOnly) {
            const floored = quantizeDown(closeQuantity, lotSize);
            const canUseReduceOnlyQty =
              floored >= minSize && isStepAligned(floored, lotSize);
            const fullyCoversTarget = floored + lotSize * 1e-9 >= closeQuantity;

            if (canUseReduceOnlyQty && fullyCoversTarget) {
              closeQuantity = floored;
            } else if (options.reduceOnly) {
              if (!canUseReduceOnlyQty) {
                throw new Error(
                  `Cannot auto-close with --full --reduce-only: inferred quantity ${closeQuantity} is below min-size/lot-size constraints (min=${minSize}, lot=${lotSize}). Use --non-reduce-only or pass an explicit valid --quantity.`,
                );
              }
              closeQuantity = floored;
              closeQuantityAdjustedReason =
                "Reduced close quantity to nearest lot-size multiple due --reduce-only.";
            } else {
              reduceOnly = false;
              closeQuantity = quantizeUp(Math.max(closeQuantity, minSize), lotSize);
              closeQuantityAdjustedReason =
                "Switched to non-reduce-only and rounded quantity up to satisfy lot-size/min-size for full close.";
            }
          } else {
            closeQuantity = quantizeUp(Math.max(closeQuantity, minSize), lotSize);
          }
        } else if (!isStepAligned(closeQuantity, lotSize) || closeQuantity < minSize) {
          throw new Error(
            `Invalid close quantity ${closeQuantity}. Quantity must be >= ${minSize} and aligned to lot size ${lotSize} for ${poolKey}.`,
          );
        }
      }

      const shouldSendCloseTx =
        shouldPlaceCloseOrder || repayBaseDebt || repayQuoteDebt;

      if (!shouldSendCloseTx && !options.withdraw) {
        throw new Error(
          "Nothing to do: no close order and no debt repayment needed. Pass --withdraw to withdraw assets.",
        );
      }

      let closeFeeBufferBaseAmount = 0;
      let closeFeeBufferQuoteAmount = 0;
      let closeFeeBufferDeepAmount = 0;
      if (shouldPlaceCloseOrder && closeQuantity) {
        const orderQuantity = closeQuantity;
        closeFeeBufferBaseAmount =
          options.payWithDeep || closeIsBid
            ? 0
            : estimateMarginFeeBuffer(orderQuantity, MIN_MARGIN_BASE_FEE_BUFFER);
        closeFeeBufferQuoteAmount =
          options.payWithDeep || !closeIsBid
            ? 0
            : estimateMarginFeeBuffer(
                orderQuantity * (amountsBefore.quoteAsset > 0
                  ? amountsBefore.quoteDebt / amountsBefore.baseAsset
                  : Number(positionBefore.managerState.currentPrice) / 1e6),
                MIN_MARGIN_QUOTE_FEE_BUFFER,
              );
        closeFeeBufferDeepAmount = options.payWithDeep
          ? Math.max(MIN_MARGIN_DEEP_FEE_BUFFER, orderQuantity * 0.01)
          : 0;
      }

      const closeClientOrderId = generateClientOrderId();
      const closeResult = shouldSendCloseTx
        ? await executeOrDryRunTransaction(
            runtime,
            buildMarginCloseTransaction(runtime, {
              poolKey,
              clientOrderId: closeClientOrderId,
              quantity: shouldPlaceCloseOrder ? closeQuantity : undefined,
              isBid: shouldPlaceCloseOrder ? closeIsBid : undefined,
              reduceOnly,
              selfMatchingOption: parseSelfMatchingOption(options.selfMatch),
              payWithDeep: options.payWithDeep,
              repayBaseDebt,
              repayQuoteDebt,
              ...(closeFeeBufferBaseAmount > 0 ? { feeBufferBaseAmount: closeFeeBufferBaseAmount } : {}),
              ...(closeFeeBufferQuoteAmount > 0 ? { feeBufferQuoteAmount: closeFeeBufferQuoteAmount } : {}),
              ...(closeFeeBufferDeepAmount > 0 ? { feeBufferDeepAmount: closeFeeBufferDeepAmount } : {}),
            }),
            options.dryRun,
          )
        : null;

      let withdrawResult: unknown = null;
      let withdrawBaseAmount: number | null = null;
      let withdrawQuoteAmount: number | null = null;
      let positionAfterClose: Awaited<
        ReturnType<typeof queryMarginPosition>
      > | null = null;
      let positionFinal: Awaited<
        ReturnType<typeof queryMarginPosition>
      > | null = null;

      if (!options.dryRun) {
        positionAfterClose = await queryMarginPosition(runtime);

        if (options.withdraw) {
          const postCloseAmounts = getMarginStateAmounts(
            runtime,
            poolKey,
            positionAfterClose.managerState,
          );
          withdrawBaseAmount =
            postCloseAmounts.baseAsset > 0 ? postCloseAmounts.baseAsset : null;
          withdrawQuoteAmount =
            postCloseAmounts.quoteAsset > 0
              ? postCloseAmounts.quoteAsset
              : null;

          if (withdrawBaseAmount || withdrawQuoteAmount) {
            withdrawResult = await executeOrDryRunTransaction(
              runtime,
              buildMarginWithdrawTransaction(runtime, {
                ...(withdrawBaseAmount
                  ? { baseAmount: withdrawBaseAmount }
                  : {}),
                ...(withdrawQuoteAmount
                  ? { quoteAmount: withdrawQuoteAmount }
                  : {}),
              }),
              false,
            );
          }
        }

        positionFinal = await queryMarginPosition(runtime);
      }

      printResult(
        {
          marginManagerId,
          poolKey,
          reduceOnly,
          full: options.full,
          repay: options.repay,
          withdraw: options.withdraw,
          closeOrder: shouldPlaceCloseOrder
            ? {
                side: closeIsBid ? "buy" : "sell",
                quantity: closeQuantity,
                clientOrderId: closeClientOrderId,
                adjusted: closeQuantityAdjustedReason ? true : false,
                adjustmentReason: closeQuantityAdjustedReason,
              }
            : null,
          repaid: {
            baseDebt: repayBaseDebt,
            quoteDebt: repayQuoteDebt,
          },
          withdrawAmounts: options.withdraw
            ? {
                baseAmount: withdrawBaseAmount,
                quoteAmount: withdrawQuoteAmount,
              }
            : null,
          result: closeResult,
          withdrawResult,
          positionBefore,
          positionAfterClose: options.dryRun ? null : positionAfterClose,
          positionFinal: options.dryRun ? null : positionFinal,
        },
        output,
      );
    });

  const manager = program
    .command("manager")
    .description("Manage DeepBook balance managers");

  manager
    .command("ls")
    .description("List DeepBook balance manager IDs for your address")
    .action(async function (this: Command) {
      const runtime = createOnchainRuntime(this);
      const managers = await queryBalanceManagerIdsForOwner(
        runtime,
        runtime.address,
      );
      printResult(
        {
          network: runtime.network,
          address: runtime.address,
          managers,
        },
        getOutputOptions(this),
      );
    });

  manager
    .command("create")
    .description("Create and share a new DeepBook balance manager")
    .option("--dry-run", "Build and simulate without broadcasting")
    .action(async function (this: Command, options: { dryRun: boolean }) {
      const runtime = createOnchainRuntime(this);
      const transaction = buildCreateManagerTransaction(runtime);
      const result = await executeOrDryRunTransaction(
        runtime,
        transaction,
        options.dryRun,
      );
      printResult(result, getOutputOptions(this));
    });

  manager
    .command("deposit")
    .description("Deposit funds into a balance manager")
    .option("--manager <id>", "Balance manager object ID")
    .requiredOption("--coin <key>", "Coin key (e.g. SUI, USDC, DEEP)")
    .requiredOption("--amount <value>", "Amount to deposit")
    .option("--dry-run", "Build and simulate without broadcasting")
    .action(async function (this: Command, options: ManagerTxOptions) {
      const managerId = await resolveManagerId(this, options.manager);
      const runtime = createOnchainRuntime(this, { managerId });
      const transaction = buildDepositTransaction(runtime, {
        coin: options.coin,
        amount: parsePositiveNumber(options.amount, "amount"),
      });

      const result = await executeOrDryRunTransaction(
        runtime,
        transaction,
        options.dryRun,
      );
      printResult(result, getOutputOptions(this));
    });

  manager
    .command("withdraw")
    .description("Withdraw funds from a balance manager")
    .option("--manager <id>", "Balance manager object ID")
    .requiredOption("--coin <key>", "Coin key (e.g. SUI, USDC, DEEP)")
    .requiredOption("--amount <value>", "Amount to withdraw")
    .option(
      "--recipient <address>",
      "Recipient address (defaults to signer address)",
    )
    .option("--dry-run", "Build and simulate without broadcasting")
    .action(async function (this: Command, options: ManagerTxOptions) {
      const managerId = await resolveManagerId(this, options.manager);
      const runtime = createOnchainRuntime(this, { managerId });
      const recipient = options.recipient?.trim() || runtime.address;

      const transaction = buildWithdrawTransaction(runtime, {
        coin: options.coin,
        amount: parsePositiveNumber(options.amount, "amount"),
        recipient,
      });

      const result = await executeOrDryRunTransaction(
        runtime,
        transaction,
        options.dryRun,
      );
      printResult(result, getOutputOptions(this));
    });

  manager
    .command("balance")
    .description("Check a coin balance in a balance manager")
    .option("--manager <id>", "Balance manager object ID")
    .requiredOption("--coin <key>", "Coin key (e.g. SUI, USDC, DEEP)")
    .action(async function (
      this: Command,
      options: { manager?: string; coin: string },
    ) {
      const managerId = await resolveManagerId(this, options.manager);
      const runtime = createOnchainRuntime(this, { managerId });
      const balance = await queryManagerBalance(runtime, options.coin);
      printResult(balance, getOutputOptions(this));
    });

  await program.parseAsync(process.argv);
}

run().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
