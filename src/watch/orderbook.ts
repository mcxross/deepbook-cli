import type { NormalizedOrderbook, OrderbookLevel } from "../providers/types.js";

interface RenderLevel extends OrderbookLevel {
  cumulative: number;
}

const COLOR_RESET = "\x1b[0m";
const COLOR_BID = "\x1b[32m";
const COLOR_ASK = "\x1b[31m";
const COLOR_MUTED = "\x1b[90m";
const COLOR_ACCENT = "\x1b[36m";

const PRICE_WIDTH = 12;
const QTY_WIDTH = 16;
const ORDER_WIDTH = 6;
const BAR_WIDTH = 20;

function toNum(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildCumulative(levels: OrderbookLevel[]): RenderLevel[] {
  let cumulative = 0;
  return levels.map((level) => {
    cumulative += toNum(level.quantity);
    return {
      ...level,
      cumulative,
    };
  });
}

function buildDepthBar(value: number, max: number): string {
  if (max <= 0 || value <= 0) return "";
  const filled = Math.max(1, Math.round((value / max) * BAR_WIDTH));
  return "#".repeat(Math.min(BAR_WIDTH, filled));
}

function formatRow(level: RenderLevel, color: string, maxDepth: number): string {
  const price = level.price.padEnd(PRICE_WIDTH);
  const qty = level.quantity.padStart(QTY_WIDTH);
  const orders = String(level.orderCount).padStart(ORDER_WIDTH);
  const bar = buildDepthBar(level.cumulative, maxDepth).padEnd(BAR_WIDTH);
  return `${color}${price}${COLOR_RESET} ${qty} ${COLOR_MUTED}${orders}${COLOR_RESET} ${color}${bar}${COLOR_RESET}`;
}

function computeSpread(asks: OrderbookLevel[], bids: OrderbookLevel[]): string {
  if (asks.length === 0 || bids.length === 0) return "n/a";
  const askBest = toNum(asks[0].price);
  const bidBest = toNum(bids[0].price);
  if (!Number.isFinite(askBest) || !Number.isFinite(bidBest)) return "n/a";
  return (askBest - bidBest).toString();
}

export function renderOrderbookWatch(
  pool: string,
  data: NormalizedOrderbook,
  providerName: string,
): string {
  const bidLevels = buildCumulative(data.bids);
  const askLevelsBestToFar = buildCumulative(data.asks);
  const askLevels = [...askLevelsBestToFar].reverse();

  const maxDepth = Math.max(
    askLevels.length > 0 ? askLevels[0].cumulative : 0,
    bidLevels.length > 0 ? bidLevels[bidLevels.length - 1].cumulative : 0,
  );

  const now = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const spread = computeSpread(data.asks, data.bids);

  const lines: string[] = [];
  lines.push(`${COLOR_ACCENT}${pool}${COLOR_RESET} orderbook (${providerName})`);
  lines.push(`${COLOR_MUTED}updated ${now} | spread ${spread}${COLOR_RESET}`);
  lines.push("");
  lines.push(
    `${"price".padEnd(PRICE_WIDTH)} ${"quantity".padStart(QTY_WIDTH)} ${"#".padStart(ORDER_WIDTH)} ${"depth".padEnd(BAR_WIDTH)}`,
  );

  if (askLevels.length === 0) {
    lines.push(`${COLOR_MUTED}no asks${COLOR_RESET}`);
  } else {
    for (const level of askLevels) {
      lines.push(formatRow(level, COLOR_ASK, maxDepth));
    }
  }

  lines.push(`${COLOR_MUTED}${"-".repeat(PRICE_WIDTH + QTY_WIDTH + ORDER_WIDTH + BAR_WIDTH + 3)}${COLOR_RESET}`);

  if (bidLevels.length === 0) {
    lines.push(`${COLOR_MUTED}no bids${COLOR_RESET}`);
  } else {
    for (const level of bidLevels) {
      lines.push(formatRow(level, COLOR_BID, maxDepth));
    }
  }

  lines.push("");
  lines.push(`${COLOR_MUTED}Press Ctrl+C to exit${COLOR_RESET}`);

  return lines.join("\n");
}

export function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

export function hideCursor(): void {
  process.stdout.write("\x1b[?25l");
}

export function showCursor(): void {
  process.stdout.write("\x1b[?25h");
}
