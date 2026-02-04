import {
  getSurfluxReadApiKeyFromConfig,
  getSurfluxStreamApiKeyFromConfig,
  readDeeptradeConfig,
} from "./deepbook-config.js";

export function getReadApiKey(): string {
  const { config } = readDeeptradeConfig();
  const configKey = getSurfluxReadApiKeyFromConfig(config);
  if (configKey) return configKey;

  throw new Error(
    'Missing read API key. Configure via "deepbook config set-read-key".',
  );
}

function sanitizeTickerPart(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) {
    throw new Error(`Invalid pool token: "${input}"`);
  }
  return cleaned;
}

export interface PoolParts {
  poolName: string;
  base: string;
  quote: string;
}

export function parsePool(input: string): PoolParts {
  const normalizedInput = input.trim();
  if (!normalizedInput) {
    throw new Error("Pool cannot be empty. Expected format: BASE_QUOTE");
  }

  const rawParts = normalizedInput.split(/[_/\-]/).filter(Boolean);
  if (rawParts.length !== 2) {
    throw new Error(
      `Invalid pool "${input}". Expected exactly two parts (BASE_QUOTE, BASE/QUOTE, or BASE-QUOTE).`,
    );
  }

  const base = sanitizeTickerPart(rawParts[0]);
  const quote = sanitizeTickerPart(rawParts[1]);

  return {
    base,
    quote,
    poolName: `${base}_${quote}`,
  };
}

export function getStreamApiKeyForPool(poolInput: string): {
  apiKey: string;
  envVarName: string;
  poolName: string;
} {
  const { base, quote, poolName } = parsePool(poolInput);
  const envVarName = `API_KEY_STREAM_${base}_${quote}`;

  const { config } = readDeeptradeConfig();
  const fromConfig = getSurfluxStreamApiKeyFromConfig(config, poolName);
  if (fromConfig.apiKey) {
    return { apiKey: fromConfig.apiKey, envVarName, poolName };
  }

  throw new Error(
    `Missing stream API key for ${poolName}. Configure via "deepbook config set-stream-key ${poolName} <key>".`,
  );
}
