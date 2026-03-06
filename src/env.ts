import {
  getSurfluxReadApiKeyFromConfig,
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

export function getStreamApiKeys(): Record<string, string> {
  const { config } = readDeeptradeConfig();
  const configured = config.providers?.surflux?.streamApiKeys ?? {};
  const result: Record<string, string> = {};

  for (const [poolName, apiKey] of Object.entries(configured)) {
    if (typeof apiKey !== "string") {
      continue;
    }

    const trimmed = apiKey.trim();
    if (trimmed) {
      result[poolName] = trimmed;
    }
  }

  return result;
}
