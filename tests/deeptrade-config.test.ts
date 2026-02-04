import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  ensureDeeptradeConfig,
  getDeeptradePaths,
  getSurfluxReadApiKeyFromConfig,
  getSurfluxStreamApiKeyFromConfig,
  importDeeptradePrivateKey,
  listDeeptradeAccounts,
  parseDeeptradeAccountAlias,
  readDeeptradeConfig,
  resolveActiveDeeptradeAccount,
  resolveDefaultAddress,
  resolveDefaultPrivateKey,
  resolveDefaultTradeCap,
  resolveProviderName,
  resolveProviderRestBaseUrl,
  resolveProviderStreamBaseUrl,
  resolveRpcUrl,
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
  type DeeptradeConfig,
} from "../src/deepbook-config.js";

function withTempHome(testFn: (homeDir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "deeptrade-test-"));
  try {
    testFn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function clearEnvVar(name: string): void {
  delete process.env[name];
}

function clearAllConfigEnv(): void {
  clearEnvVar("SURFLUX_BASE_URL");
  clearEnvVar("SURFLUX_BASE_URL_MAINNET");
  clearEnvVar("SURFLUX_BASE_URL_TESTNET");
  clearEnvVar("SURFLUX_STREAM_BASE_URL");
  clearEnvVar("SURFLUX_STREAM_BASE_URL_MAINNET");
  clearEnvVar("SURFLUX_STREAM_BASE_URL_TESTNET");
  clearEnvVar("SUI_RPC_URL");
  clearEnvVar("SUI_RPC_URL_MAINNET");
  clearEnvVar("SUI_RPC_URL_TESTNET");
  clearEnvVar("DEEP_PROVIDER");
  clearEnvVar("DEEPBOOK_ADDRESS");
  clearEnvVar("DEEPBOOK_TRADE_CAP");
  clearEnvVar("SUI_PRIVATE_KEY");
}

function baseConfig(): DeeptradeConfig {
  return {
    version: 3,
    network: "mainnet",
    provider: "surflux",
  };
}

describe("deeptrade config", () => {
  afterEach(() => {
    clearAllConfigEnv();
  });

  it("creates ~/.deepbook config on first run", () => {
    withTempHome((homeDir) => {
      const { paths, config } = ensureDeeptradeConfig(homeDir);
      expect(paths.dirPath).toBe(getDeeptradePaths(homeDir).dirPath);
      expect(config.network).toBe("mainnet");
      expect(config.provider).toBe("surflux");

      const raw = readFileSync(paths.configPath, "utf-8");
      expect(raw).toContain('"network": "mainnet"');
      expect(raw).toContain('"provider": "surflux"');
    });
  });

  it("updates and persists global defaults", () => {
    withTempHome((homeDir) => {
      setDeeptradeNetwork("testnet", homeDir);
      setDeeptradeProvider("surflux", homeDir);
      setDeeptradeAddress("0xabc", homeDir);
      setDeeptradeTradeCap("0xcap", homeDir);
      setDeeptradeRpcUrl("testnet", "https://testnet-rpc.example", homeDir);

      const loaded = readDeeptradeConfig(homeDir);
      expect(loaded.config.network).toBe("testnet");
      expect(loaded.config.provider).toBe("surflux");
      expect(loaded.config.address).toBe("0xabc");
      expect(loaded.config.tradeCap).toBe("0xcap");
      expect(loaded.config.rpcUrls?.testnet).toBe("https://testnet-rpc.example");
    });
  });

  it("stores provider keys globally", () => {
    withTempHome((homeDir) => {
      const keypair = Ed25519Keypair.generate();
      const imported = importDeeptradePrivateKey(keypair.getSecretKey(), homeDir);
      setSurfluxReadApiKey("read-key", homeDir);
      const streamSaved = setSurfluxStreamApiKey("sui/usdc", "stream-key", homeDir);
      expect(streamSaved.poolName).toBe("SUI_USDC");
      expect(imported.alias).toBe("default");

      const loaded = readDeeptradeConfig(homeDir);
      expect(getSurfluxReadApiKeyFromConfig(loaded.config)).toBe("read-key");
      expect(getSurfluxStreamApiKeyFromConfig(loaded.config, "SUI_USDC").apiKey).toBe("stream-key");
      expect(resolveActiveDeeptradeAccount(loaded.config)?.address).toBe(keypair.toSuiAddress());
    });
  });

  it("supports account aliases and active account switching", () => {
    withTempHome((homeDir) => {
      const main = Ed25519Keypair.generate();
      const trader = Ed25519Keypair.generate();

      importDeeptradePrivateKey(main.getSecretKey(), homeDir, "main", true);
      importDeeptradePrivateKey(trader.getSecretKey(), homeDir, "trader", false);

      let loaded = readDeeptradeConfig(homeDir);
      expect(resolveActiveDeeptradeAccount(loaded.config)?.alias).toBe("main");
      expect(resolveDefaultAddress(loaded.config)).toBe(main.toSuiAddress());
      expect(resolveDefaultPrivateKey(loaded.config)).toBe(main.getSecretKey());

      setDeeptradeActiveAccount("trader", homeDir);
      loaded = readDeeptradeConfig(homeDir);
      expect(resolveActiveDeeptradeAccount(loaded.config)?.alias).toBe("trader");
      expect(resolveDefaultAddress(loaded.config)).toBe(trader.toSuiAddress());
      expect(resolveDefaultPrivateKey(loaded.config)).toBe(trader.getSecretKey());

      const accounts = listDeeptradeAccounts(loaded.config);
      expect(accounts.map((account) => account.alias)).toEqual(["main", "trader"]);
      expect(accounts.find((account) => account.alias === "trader")?.isActive).toBe(true);
    });
  });

  it("stores provider base urls by network", () => {
    withTempHome((homeDir) => {
      setSurfluxBaseUrl("mainnet", "https://mainnet-api.example", homeDir);
      setSurfluxBaseUrl("testnet", "https://testnet-api.example", homeDir);
      setSurfluxStreamBaseUrl("mainnet", "https://mainnet-stream.example", homeDir);
      setSurfluxStreamBaseUrl("testnet", "https://testnet-stream.example", homeDir);

      const loaded = readDeeptradeConfig(homeDir);
      expect(loaded.config.providers?.surflux?.baseUrls?.mainnet).toBe("https://mainnet-api.example");
      expect(loaded.config.providers?.surflux?.baseUrls?.testnet).toBe("https://testnet-api.example");
      expect(loaded.config.providers?.surflux?.streamBaseUrls?.mainnet).toBe(
        "https://mainnet-stream.example",
      );
      expect(loaded.config.providers?.surflux?.streamBaseUrls?.testnet).toBe(
        "https://testnet-stream.example",
      );
    });
  });

  it("rejects invalid private key import", () => {
    withTempHome((homeDir) => {
      expect(() => importDeeptradePrivateKey("not-a-key", homeDir)).toThrow();
    });
  });

  it("normalizes and validates account alias", () => {
    expect(parseDeeptradeAccountAlias("Main_Trader-1")).toBe("main_trader-1");
    expect(() => parseDeeptradeAccountAlias("contains space")).toThrow(/Invalid account alias/);
  });
});

describe("network-aware provider URL resolution", () => {
  afterEach(() => {
    clearAllConfigEnv();
  });

  it("prefers explicit URL overrides", () => {
    const config: DeeptradeConfig = {
      ...baseConfig(),
      providers: {
        surflux: {
          baseUrls: { mainnet: "https://cfg-mainnet-api.example" },
          streamBaseUrls: { testnet: "https://cfg-testnet-stream.example" },
        },
      },
    };

    expect(
      resolveProviderRestBaseUrl("mainnet", config, "https://explicit-mainnet-api.example"),
    ).toBe("https://explicit-mainnet-api.example");
    expect(
      resolveProviderStreamBaseUrl("testnet", config, "https://explicit-testnet-stream.example"),
    ).toBe("https://explicit-testnet-stream.example");
  });

  it("falls back to config aliases", () => {
    const config: DeeptradeConfig = {
      ...baseConfig(),
      providers: {
        surflux: {
          baseUrls: { mainnet: "https://cfg-mainnet-api.example" },
          streamBaseUrls: { testnet: "https://cfg-testnet-stream.example" },
        },
      },
    };

    expect(resolveProviderRestBaseUrl("mainnet", config)).toBe("https://cfg-mainnet-api.example");
    expect(resolveProviderStreamBaseUrl("testnet", config)).toBe("https://cfg-testnet-stream.example");
  });
});

describe("network-aware rpc and global defaults resolution", () => {
  afterEach(() => {
    clearAllConfigEnv();
  });

  it("resolves rpc with explicit > config > sdk default", () => {
    const config: DeeptradeConfig = {
      ...baseConfig(),
      rpcUrls: {
        mainnet: "https://cfg-mainnet-rpc.example",
      },
    };

    expect(resolveRpcUrl("mainnet", "https://explicit-rpc.example", config)).toBe(
      "https://explicit-rpc.example",
    );

    expect(resolveRpcUrl("mainnet", undefined, config)).toBe("https://cfg-mainnet-rpc.example");
  });

  it("resolves provider and on-chain defaults from config only", () => {
    const keypair = Ed25519Keypair.generate();
    const config: DeeptradeConfig = {
      ...baseConfig(),
      address: "0xlegacy-address",
      tradeCap: "0xtradecap-config",
      accounts: {
        main: {
          privateKey: keypair.getSecretKey(),
          address: keypair.toSuiAddress(),
        },
      },
      activeAccountAlias: "main",
    };

    expect(resolveProviderName(undefined, config)).toBe("surflux");
    expect(resolveDefaultAddress(config)).toBe(keypair.toSuiAddress());
    expect(resolveDefaultAddress(config, "0xexplicit")).toBe("0xexplicit");
    expect(resolveDefaultTradeCap(config)).toBe("0xtradecap-config");
    expect(resolveDefaultPrivateKey(config)).toBe(keypair.getSecretKey());

    process.env.DEEP_PROVIDER = "surflux";
    process.env.DEEPBOOK_ADDRESS = "0xenv";
    process.env.DEEPBOOK_TRADE_CAP = "0xenv-cap";
    process.env.SUI_PRIVATE_KEY = keypair.getSecretKey();

    expect(resolveProviderName(undefined, config)).toBe("surflux");
    expect(resolveDefaultAddress(config)).toBe(keypair.toSuiAddress());
    expect(resolveDefaultTradeCap(config)).toBe("0xtradecap-config");
    expect(resolveDefaultPrivateKey(config)).toBe(keypair.getSecretKey());
  });
});
