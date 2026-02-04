import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1Keypair } from "@mysten/sui/keypairs/secp256r1";

export type DeeptradeNetwork = "mainnet" | "testnet";
export type DeeptradeProvider = "surflux";

export interface DeeptradePaths {
  dirPath: string;
  configPath: string;
}

export interface DeeptradeAccount {
  privateKey: string;
  address: string;
}

interface SurfluxConfig {
  readApiKey?: string;
  streamApiKeys?: Record<string, string>;
  baseUrls?: Partial<Record<DeeptradeNetwork, string>>;
  streamBaseUrls?: Partial<Record<DeeptradeNetwork, string>>;
}

interface ProviderConfig {
  surflux?: SurfluxConfig;
}

export interface DeeptradeConfig {
  version: 3;
  network: DeeptradeNetwork;
  provider: DeeptradeProvider;
  // Legacy fields preserved for backward compatibility.
  privateKey?: string;
  address?: string;
  activeAccountAlias?: string;
  accounts?: Record<string, DeeptradeAccount>;
  tradeCap?: string;
  rpcUrls?: Partial<Record<DeeptradeNetwork, string>>;
  providers?: ProviderConfig;
}

const APP_DIR_NAME = ".deepbook";
const CONFIG_FILE_NAME = "config.json";
const DEFAULT_ACCOUNT_ALIAS = "default";
const ACCOUNT_ALIAS_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function trySetPermissions(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Best-effort permissions only.
  }
}

function trimString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeRpcUrls(value: unknown): Partial<Record<DeeptradeNetwork, string>> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const mainnet = trimString(raw.mainnet);
  const testnet = trimString(raw.testnet);
  const next: Partial<Record<DeeptradeNetwork, string>> = {};
  if (mainnet) next.mainnet = mainnet;
  if (testnet) next.testnet = testnet;
  return Object.keys(next).length > 0 ? next : undefined;
}

function sanitizeTickerPart(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) {
    throw new Error(`Invalid pool token: "${input}"`);
  }
  return cleaned;
}

function normalizePoolName(poolInput: string): string {
  const normalizedInput = poolInput.trim();
  if (!normalizedInput) {
    throw new Error("Pool cannot be empty. Expected format: BASE_QUOTE");
  }

  const rawParts = normalizedInput.split(/[_/\-]/).filter(Boolean);
  if (rawParts.length !== 2) {
    throw new Error(
      `Invalid pool "${poolInput}". Expected exactly two parts (BASE_QUOTE, BASE/QUOTE, or BASE-QUOTE).`,
    );
  }

  const base = sanitizeTickerPart(rawParts[0]);
  const quote = sanitizeTickerPart(rawParts[1]);
  return `${base}_${quote}`;
}

function normalizeStreamApiKeys(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const next: Record<string, string> = {};

  for (const [poolKey, apiKeyValue] of Object.entries(raw)) {
    const apiKey = trimString(apiKeyValue);
    if (!apiKey) continue;
    const poolName = normalizePoolName(poolKey);
    next[poolName] = apiKey;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeSurfluxConfig(input: unknown): SurfluxConfig | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;

  const readApiKey = trimString(raw.readApiKey);
  const streamApiKeys = normalizeStreamApiKeys(raw.streamApiKeys);
  const baseUrls = normalizeRpcUrls(raw.baseUrls);
  const streamBaseUrls = normalizeRpcUrls(raw.streamBaseUrls);

  const next: SurfluxConfig = {
    ...(readApiKey ? { readApiKey } : {}),
    ...(streamApiKeys ? { streamApiKeys } : {}),
    ...(baseUrls ? { baseUrls } : {}),
    ...(streamBaseUrls ? { streamBaseUrls } : {}),
  };

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeProviders(input: unknown): ProviderConfig | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const surflux = normalizeSurfluxConfig(raw.surflux);
  if (!surflux) return undefined;
  return { surflux };
}

function normalizeProvider(input: unknown): DeeptradeProvider {
  const value = trimString(input) ?? "surflux";
  if (value === "surflux") return value;
  throw new Error(`Invalid provider "${value}". Supported providers: surflux.`);
}

function maybeNormalizeAccountAlias(input: string | undefined): string | undefined {
  if (!input) return undefined;

  try {
    return parseDeeptradeAccountAlias(input);
  } catch {
    return undefined;
  }
}

function deriveAddressUnchecked(privateKey: string): string {
  const parsed = decodeSuiPrivateKey(privateKey);

  switch (parsed.scheme) {
    case "ED25519":
      return Ed25519Keypair.fromSecretKey(parsed.secretKey).toSuiAddress();
    case "Secp256k1":
      return Secp256k1Keypair.fromSecretKey(parsed.secretKey).toSuiAddress();
    case "Secp256r1":
      return Secp256r1Keypair.fromSecretKey(parsed.secretKey).toSuiAddress();
    default:
      throw new Error(`Unsupported key scheme: ${parsed.scheme}`);
  }
}

function normalizeAccounts(input: unknown): Record<string, DeeptradeAccount> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const next: Record<string, DeeptradeAccount> = {};

  for (const [rawAlias, rawValue] of Object.entries(raw)) {
    const alias = maybeNormalizeAccountAlias(trimString(rawAlias));
    if (!alias || !rawValue || typeof rawValue !== "object") {
      continue;
    }

    const value = rawValue as Record<string, unknown>;
    const privateKey = trimString(value.privateKey);
    if (!privateKey) {
      continue;
    }

    const address = deriveAddressUnchecked(privateKey);
    next[alias] = {
      privateKey,
      address,
    };
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function pickActiveAccountAlias(
  accounts: Record<string, DeeptradeAccount>,
  preferredAlias?: string,
): string | undefined {
  const aliases = Object.keys(accounts);
  if (aliases.length === 0) return undefined;

  const preferred = maybeNormalizeAccountAlias(preferredAlias);
  if (preferred && accounts[preferred]) {
    return preferred;
  }

  if (accounts[DEFAULT_ACCOUNT_ALIAS]) {
    return DEFAULT_ACCOUNT_ALIAS;
  }

  return aliases.sort((a, b) => a.localeCompare(b))[0];
}

function getAccountsWithLegacyFallback(config: DeeptradeConfig): Record<string, DeeptradeAccount> {
  const accounts: Record<string, DeeptradeAccount> = {
    ...(config.accounts ?? {}),
  };

  if (Object.keys(accounts).length > 0) {
    return accounts;
  }

  const legacyPrivateKey = config.privateKey?.trim();
  if (!legacyPrivateKey) {
    return accounts;
  }

  return {
    [DEFAULT_ACCOUNT_ALIAS]: {
      privateKey: legacyPrivateKey,
      address: deriveAddressUnchecked(legacyPrivateKey),
    },
  };
}

export function parseDeeptradeAccountAlias(input: string): string {
  const alias = input.trim().toLowerCase();
  if (!alias) {
    throw new Error("Account alias cannot be empty.");
  }

  if (!ACCOUNT_ALIAS_REGEX.test(alias)) {
    throw new Error(
      `Invalid account alias "${input}". Use 1-64 chars: lowercase letters, numbers, dash, underscore.`,
    );
  }

  return alias;
}

export function deriveAddressFromPrivateKey(privateKeyInput: string): string {
  const privateKey = privateKeyInput.trim();
  if (!privateKey) {
    throw new Error("Private key cannot be empty.");
  }

  return deriveAddressUnchecked(privateKey);
}

export function resolveActiveDeeptradeAccount(config: DeeptradeConfig):
  | {
      alias: string;
      privateKey: string;
      address: string;
    }
  | undefined {
  const accounts = getAccountsWithLegacyFallback(config);
  const alias = pickActiveAccountAlias(accounts, config.activeAccountAlias);
  if (!alias) return undefined;

  const account = accounts[alias];
  return {
    alias,
    privateKey: account.privateKey,
    address: account.address,
  };
}

export function listDeeptradeAccounts(config: DeeptradeConfig): Array<{
  alias: string;
  address: string;
  isActive: boolean;
}> {
  const accounts = getAccountsWithLegacyFallback(config);
  const activeAlias = resolveActiveDeeptradeAccount(config)?.alias;

  return Object.entries(accounts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([alias, account]) => ({
      alias,
      address: account.address,
      isActive: alias === activeAlias,
    }));
}

export function parseDeeptradeNetwork(input: string): DeeptradeNetwork {
  const normalized = input.trim().toLowerCase();
  if (normalized === "mainnet" || normalized === "testnet") {
    return normalized;
  }

  throw new Error(`Invalid network "${input}". Supported values: mainnet, testnet.`);
}

export function parseDeeptradeProvider(input: string): DeeptradeProvider {
  const normalized = input.trim().toLowerCase();
  if (normalized === "surflux") {
    return normalized;
  }

  throw new Error(`Invalid provider "${input}". Supported values: surflux.`);
}

export function getDeeptradePaths(homeDir = homedir()): DeeptradePaths {
  const dirPath = join(homeDir, APP_DIR_NAME);
  return {
    dirPath,
    configPath: join(dirPath, CONFIG_FILE_NAME),
  };
}

function getDefaultConfig(): DeeptradeConfig {
  return {
    version: 3,
    network: "mainnet",
    provider: "surflux",
  };
}

function normalizeConfig(raw: unknown): DeeptradeConfig {
  if (!raw || typeof raw !== "object") {
    return getDefaultConfig();
  }

  const input = raw as Record<string, unknown>;
  const network = parseDeeptradeNetwork(String(input.network ?? "mainnet"));
  const provider = normalizeProvider(input.provider);
  const legacyPrivateKey = trimString(input.privateKey);
  const address = trimString(input.address);
  const tradeCap = trimString(input.tradeCap);
  const rpcUrls = normalizeRpcUrls(input.rpcUrls);
  const providers = normalizeProviders(input.providers);

  const nextAccounts = normalizeAccounts(input.accounts) ?? {};
  if (Object.keys(nextAccounts).length === 0 && legacyPrivateKey) {
    nextAccounts[DEFAULT_ACCOUNT_ALIAS] = {
      privateKey: legacyPrivateKey,
      address: deriveAddressUnchecked(legacyPrivateKey),
    };
  }

  const activeAccountAlias = pickActiveAccountAlias(
    nextAccounts,
    trimString(input.activeAccountAlias),
  );
  const activeAccount = activeAccountAlias ? nextAccounts[activeAccountAlias] : undefined;

  return {
    version: 3,
    network,
    provider,
    ...(activeAccountAlias ? { activeAccountAlias } : {}),
    ...(Object.keys(nextAccounts).length > 0 ? { accounts: nextAccounts } : {}),
    ...(activeAccount?.privateKey ? { privateKey: activeAccount.privateKey } : {}),
    ...(address ? { address } : {}),
    ...(tradeCap ? { tradeCap } : {}),
    ...(rpcUrls ? { rpcUrls } : {}),
    ...(providers ? { providers } : {}),
  };
}

function ensureDeeptradeDir(paths: DeeptradePaths): void {
  if (!existsSync(paths.dirPath)) {
    mkdirSync(paths.dirPath, { recursive: true });
  }

  trySetPermissions(paths.dirPath, 0o700);
}

export function ensureDeeptradeConfig(homeDir = homedir()): {
  paths: DeeptradePaths;
  config: DeeptradeConfig;
} {
  const paths = getDeeptradePaths(homeDir);
  ensureDeeptradeDir(paths);

  if (!existsSync(paths.configPath)) {
    const config = getDefaultConfig();
    writeFileSync(paths.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
    trySetPermissions(paths.configPath, 0o600);
    return { paths, config };
  }

  const content = readFileSync(paths.configPath, "utf-8");
  const parsed = normalizeConfig(JSON.parse(content));
  writeFileSync(paths.configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
  trySetPermissions(paths.configPath, 0o600);
  return { paths, config: parsed };
}

export function readDeeptradeConfig(homeDir = homedir()): {
  paths: DeeptradePaths;
  config: DeeptradeConfig;
} {
  return ensureDeeptradeConfig(homeDir);
}

export function writeDeeptradeConfig(config: DeeptradeConfig, homeDir = homedir()): {
  paths: DeeptradePaths;
  config: DeeptradeConfig;
} {
  const { paths } = ensureDeeptradeConfig(homeDir);
  const normalized = normalizeConfig(config);
  writeFileSync(paths.configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
  trySetPermissions(paths.configPath, 0o600);
  return { paths, config: normalized };
}

export function setDeeptradeNetwork(networkInput: string, homeDir = homedir()): {
  paths: DeeptradePaths;
  config: DeeptradeConfig;
} {
  const { config } = ensureDeeptradeConfig(homeDir);
  return writeDeeptradeConfig(
    {
      ...config,
      network: parseDeeptradeNetwork(networkInput),
    },
    homeDir,
  );
}

export function setDeeptradeProvider(providerInput: string, homeDir = homedir()): {
  paths: DeeptradePaths;
  config: DeeptradeConfig;
} {
  const { config } = ensureDeeptradeConfig(homeDir);
  return writeDeeptradeConfig(
    {
      ...config,
      provider: parseDeeptradeProvider(providerInput),
    },
    homeDir,
  );
}

export function setDeeptradeAddress(addressInput: string, homeDir = homedir()): {
  paths: DeeptradePaths;
  config: DeeptradeConfig;
} {
  const address = addressInput.trim();
  if (!address) {
    throw new Error("Address cannot be empty.");
  }

  const { config } = ensureDeeptradeConfig(homeDir);
  return writeDeeptradeConfig({ ...config, address }, homeDir);
}

export function setDeeptradeTradeCap(tradeCapInput: string, homeDir = homedir()): {
  paths: DeeptradePaths;
  config: DeeptradeConfig;
} {
  const tradeCap = tradeCapInput.trim();
  if (!tradeCap) {
    throw new Error("Trade cap cannot be empty.");
  }

  const { config } = ensureDeeptradeConfig(homeDir);
  return writeDeeptradeConfig({ ...config, tradeCap }, homeDir);
}

export function setDeeptradeActiveAccount(aliasInput: string, homeDir = homedir()): {
  paths: DeeptradePaths;
  config: DeeptradeConfig;
  alias: string;
  address: string;
} {
  const alias = parseDeeptradeAccountAlias(aliasInput);
  const { config } = ensureDeeptradeConfig(homeDir);
  const accounts = getAccountsWithLegacyFallback(config);
  const account = accounts[alias];

  if (!account) {
    throw new Error(`Unknown account alias "${alias}". Import it first with "deepbook account import".`);
  }

  const saved = writeDeeptradeConfig(
    {
      ...config,
      accounts,
      activeAccountAlias: alias,
    },
    homeDir,
  );

  return {
    ...saved,
    alias,
    address: account.address,
  };
}

export function importDeeptradePrivateKey(
  privateKeyInput: string,
  homeDir = homedir(),
  aliasInput?: string,
  activate = true,
): {
  paths: DeeptradePaths;
  config: DeeptradeConfig;
  alias: string;
  address: string;
} {
  const privateKey = privateKeyInput.trim();
  if (!privateKey) {
    throw new Error("Private key cannot be empty.");
  }

  const address = deriveAddressFromPrivateKey(privateKey);
  const { config } = ensureDeeptradeConfig(homeDir);
  const accounts = getAccountsWithLegacyFallback(config);
  const currentActiveAlias = resolveActiveDeeptradeAccount(config)?.alias;
  const alias = aliasInput
    ? parseDeeptradeAccountAlias(aliasInput)
    : currentActiveAlias ?? DEFAULT_ACCOUNT_ALIAS;

  const nextAccounts: Record<string, DeeptradeAccount> = {
    ...accounts,
    [alias]: {
      privateKey,
      address,
    },
  };

  const nextActiveAlias = activate ? alias : currentActiveAlias ?? alias;

  const saved = writeDeeptradeConfig(
    {
      ...config,
      accounts: nextAccounts,
      activeAccountAlias: nextActiveAlias,
    },
    homeDir,
  );

  return {
    ...saved,
    alias,
    address,
  };
}

export function setDeeptradeRpcUrl(
  networkInput: string,
  rpcUrlInput: string,
  homeDir = homedir(),
): {
  paths: DeeptradePaths;
  config: DeeptradeConfig;
} {
  const network = parseDeeptradeNetwork(networkInput);
  const rpcUrl = rpcUrlInput.trim();

  if (!rpcUrl) {
    throw new Error("RPC URL cannot be empty.");
  }

  new URL(rpcUrl);

  const { config } = ensureDeeptradeConfig(homeDir);
  const nextRpcUrls: Partial<Record<DeeptradeNetwork, string>> = {
    ...(config.rpcUrls ?? {}),
    [network]: rpcUrl,
  };

  return writeDeeptradeConfig(
    {
      ...config,
      rpcUrls: nextRpcUrls,
    },
    homeDir,
  );
}

export function setSurfluxReadApiKey(apiKeyInput: string, homeDir = homedir()): {
  paths: DeeptradePaths;
  config: DeeptradeConfig;
} {
  const apiKey = apiKeyInput.trim();
  if (!apiKey) {
    throw new Error("Read API key cannot be empty.");
  }

  const { config } = ensureDeeptradeConfig(homeDir);
  const surflux: SurfluxConfig = {
    ...(config.providers?.surflux ?? {}),
    readApiKey: apiKey,
  };

  return writeDeeptradeConfig(
    {
      ...config,
      providers: {
        ...(config.providers ?? {}),
        surflux,
      },
    },
    homeDir,
  );
}

export function setSurfluxStreamApiKey(
  poolInput: string,
  apiKeyInput: string,
  homeDir = homedir(),
): {
  paths: DeeptradePaths;
  config: DeeptradeConfig;
  poolName: string;
} {
  const poolName = normalizePoolName(poolInput);
  const apiKey = apiKeyInput.trim();
  if (!apiKey) {
    throw new Error("Stream API key cannot be empty.");
  }

  const { config } = ensureDeeptradeConfig(homeDir);
  const surflux: SurfluxConfig = {
    ...(config.providers?.surflux ?? {}),
    streamApiKeys: {
      ...(config.providers?.surflux?.streamApiKeys ?? {}),
      [poolName]: apiKey,
    },
  };

  const saved = writeDeeptradeConfig(
    {
      ...config,
      providers: {
        ...(config.providers ?? {}),
        surflux,
      },
    },
    homeDir,
  );

  return {
    ...saved,
    poolName,
  };
}

export function setSurfluxBaseUrl(
  networkInput: string,
  urlInput: string,
  homeDir = homedir(),
): {
  paths: DeeptradePaths;
  config: DeeptradeConfig;
  network: DeeptradeNetwork;
} {
  const network = parseDeeptradeNetwork(networkInput);
  const baseUrl = urlInput.trim();
  if (!baseUrl) {
    throw new Error("Provider base URL cannot be empty.");
  }

  new URL(baseUrl);

  const { config } = ensureDeeptradeConfig(homeDir);
  const surflux: SurfluxConfig = {
    ...(config.providers?.surflux ?? {}),
    baseUrls: {
      ...(config.providers?.surflux?.baseUrls ?? {}),
      [network]: baseUrl,
    },
  };

  const saved = writeDeeptradeConfig(
    {
      ...config,
      providers: {
        ...(config.providers ?? {}),
        surflux,
      },
    },
    homeDir,
  );

  return { ...saved, network };
}

export function setSurfluxStreamBaseUrl(
  networkInput: string,
  urlInput: string,
  homeDir = homedir(),
): {
  paths: DeeptradePaths;
  config: DeeptradeConfig;
  network: DeeptradeNetwork;
} {
  const network = parseDeeptradeNetwork(networkInput);
  const streamBaseUrl = urlInput.trim();
  if (!streamBaseUrl) {
    throw new Error("Provider stream base URL cannot be empty.");
  }

  new URL(streamBaseUrl);

  const { config } = ensureDeeptradeConfig(homeDir);
  const surflux: SurfluxConfig = {
    ...(config.providers?.surflux ?? {}),
    streamBaseUrls: {
      ...(config.providers?.surflux?.streamBaseUrls ?? {}),
      [network]: streamBaseUrl,
    },
  };

  const saved = writeDeeptradeConfig(
    {
      ...config,
      providers: {
        ...(config.providers ?? {}),
        surflux,
      },
    },
    homeDir,
  );

  return { ...saved, network };
}

function resolveWithConfigFallback(
  explicitValue: string | undefined,
  configValue: string | undefined,
  defaultValue: string,
): string {
  const explicit = explicitValue?.trim();
  if (explicit) return explicit;

  if (configValue?.trim()) return configValue.trim();
  return defaultValue;
}

export function resolveProviderName(
  explicitValue: string | undefined,
  config: DeeptradeConfig,
): DeeptradeProvider {
  const explicit = explicitValue?.trim();
  if (explicit) {
    return parseDeeptradeProvider(explicit);
  }

  return config.provider;
}

export function resolveProviderRestBaseUrl(
  network: DeeptradeNetwork,
  config: DeeptradeConfig,
  explicitValue?: string,
): string {
  return resolveWithConfigFallback(
    explicitValue,
    config.providers?.surflux?.baseUrls?.[network],
    "https://api.surflux.dev",
  );
}

export function resolveProviderStreamBaseUrl(
  network: DeeptradeNetwork,
  config: DeeptradeConfig,
  explicitValue?: string,
): string {
  return resolveWithConfigFallback(
    explicitValue,
    config.providers?.surflux?.streamBaseUrls?.[network],
    "https://flux.surflux.dev",
  );
}

export function resolveRpcUrl(
  network: DeeptradeNetwork,
  explicitValue: string | undefined,
  config: DeeptradeConfig,
): string {
  return resolveWithConfigFallback(explicitValue, config.rpcUrls?.[network], getJsonRpcFullnodeUrl(network));
}

export function getSurfluxReadApiKeyFromConfig(config: DeeptradeConfig): string | undefined {
  return config.providers?.surflux?.readApiKey?.trim() || undefined;
}

export function getSurfluxStreamApiKeyFromConfig(
  config: DeeptradeConfig,
  poolInput: string,
): {
  poolName: string;
  apiKey?: string;
} {
  const poolName = normalizePoolName(poolInput);
  return {
    poolName,
    apiKey: config.providers?.surflux?.streamApiKeys?.[poolName]?.trim() || undefined,
  };
}

export function resolveDefaultAddress(config: DeeptradeConfig, explicitValue?: string): string | undefined {
  const explicit = explicitValue?.trim();
  if (explicit) return explicit;

  const active = resolveActiveDeeptradeAccount(config);
  if (active?.address?.trim()) return active.address.trim();

  return config.address?.trim() || undefined;
}

export function resolveDefaultTradeCap(config: DeeptradeConfig, explicitValue?: string): string | undefined {
  const explicit = explicitValue?.trim();
  if (explicit) return explicit;
  return config.tradeCap?.trim() || undefined;
}

export function resolveDefaultPrivateKey(config: DeeptradeConfig, explicitValue?: string): string | undefined {
  const explicit = explicitValue?.trim();
  if (explicit) return explicit;

  const active = resolveActiveDeeptradeAccount(config);
  if (active?.privateKey?.trim()) return active.privateKey.trim();

  return config.privateKey?.trim() || undefined;
}
