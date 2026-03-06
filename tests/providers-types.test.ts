import { describe, expect, it } from "vitest";
import {
  COMMON_OHLCV_TIMEFRAMES,
  EXTENDED_OHLCV_TIMEFRAMES,
  extendProviderOhlcvTimeframes,
  parseProviderOhlcvTimeframe,
} from "../src/providers/types.js";

describe("OHLCV timeframe parsing", () => {
  const supported = extendProviderOhlcvTimeframes(
    COMMON_OHLCV_TIMEFRAMES,
    EXTENDED_OHLCV_TIMEFRAMES,
  );

  it("accepts provider-supported timeframes", () => {
    for (const timeframe of supported) {
      expect(parseProviderOhlcvTimeframe("other", supported, timeframe)).toBe(
        timeframe,
      );
    }
  });

  it("trims valid values", () => {
    expect(parseProviderOhlcvTimeframe("other", supported, " 1Y ")).toBe("1Y");
  });

  it("lets a provider extend the shared union with additional values", () => {
    expect(supported).toEqual([
      "1m",
      "5m",
      "15m",
      "1h",
      "4h",
      "1d",
      "3D",
      "1W",
      "1M",
      "1Y",
    ]);
  });

  it("rejects unsupported values for the selected provider", () => {
    expect(() => parseProviderOhlcvTimeframe("other", supported, "30m")).toThrow(
      /provider "other".*1m, 5m, 15m, 1h, 4h, 1d, 3D, 1W, 1M, 1Y/i,
    );
  });
});
