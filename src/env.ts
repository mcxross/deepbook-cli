const READ_API_KEY_ENV_CANDIDATES = [
  "SURFLUX_API_KEY",
  "API_KEY_READ",
  "API_KEY",
] as const;

export function getReadApiKey(): string {
  for (const envName of READ_API_KEY_ENV_CANDIDATES) {
    const value = process.env[envName]?.trim();
    if (value) return value;
  }

  throw new Error(
    `Missing read API key. Set one of: ${READ_API_KEY_ENV_CANDIDATES.join(", ")}.`,
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
  const apiKey = process.env[envVarName]?.trim();

  if (!apiKey) {
    throw new Error(
      `Missing stream API key for ${poolName}. Set ${envVarName}=<your-surflux-stream-key>.`,
    );
  }

  return { apiKey, envVarName, poolName };
}
