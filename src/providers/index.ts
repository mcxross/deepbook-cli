import { SurfluxProvider } from "./surflux.js";
import type { DataProvider } from "./types.js";
import type { DeeptradeNetwork } from "../deepbook-config.js";

export const SUPPORTED_PROVIDERS = ["surflux"] as const;
export type ProviderName = (typeof SUPPORTED_PROVIDERS)[number];

export interface ProviderFactoryOptions {
  providerName: string;
  network: DeeptradeNetwork;
  restBaseUrl: string;
  streamBaseUrl: string;
}

export function createProvider(options: ProviderFactoryOptions): DataProvider {
  const normalizedName = options.providerName.trim().toLowerCase();

  switch (normalizedName) {
    case "surflux":
      return new SurfluxProvider({
        network: options.network,
        restBaseUrl: options.restBaseUrl,
        streamBaseUrl: options.streamBaseUrl,
      });
    default:
      throw new Error(
        `Unknown provider "${options.providerName}". Supported providers: ${SUPPORTED_PROVIDERS.join(", ")}`,
      );
  }
}
