export { runSpotTwapStrategy, type SpotTwapParams, type SpotTwapResult } from "./twap.js";
export { runSpotDcaStrategy, type SpotDcaParams, type SpotDcaResult } from "./dca.js";
export { runSpotGridStrategy, type SpotGridParams, type SpotGridResult } from "./grid.js";
export {
  runMarginTrailingStopStrategy,
  type MarginTrailingStopParams,
  type MarginTrailingStopResult,
} from "./trailing-stop.js";
export {
  runCrossPoolSpreadStrategy,
  type CrossPoolSpreadLeg,
  type CrossPoolSpreadParams,
  type CrossPoolSpreadResult,
  type CrossPoolSpreadTick,
  type SpreadDirection,
} from "./cross-pool-spread.js";
export { type StrategyLog, type SpotSide, type GridSide } from "./common.js";
