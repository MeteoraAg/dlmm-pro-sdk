import { LiquiditySide, type LiquidityShape, type TickWeight } from "../../src";

const CHART_WIDTH = 80;
const CHART_HEIGHT = 12;
const MAX_BAR_WIDTH = 4;

/**
 * Prints column weights as a bar chart when `DLMM_CHARTS=1`, which
 * `pnpm test:charts` sets. Columns past `CHART_WIDTH` share a bar as tall as
 * the heaviest of them, and `^` marks the column holding the current tick.
 */
export function debugLiquidityChart(
  caption: string,
  input: LiquidityShape | TickWeight[],
): void {
  if (process.env.DLMM_CHARTS !== "1") {
    return;
  }
  const columns = Array.isArray(input) ? input : input.columns;
  const barCount = Math.min(columns.length, CHART_WIDTH);
  const barWidth = Math.min(Math.floor(CHART_WIDTH / barCount), MAX_BAR_WIDTH);
  const barOf = (index: number) =>
    Math.floor((index * barCount) / columns.length);

  const bars = new Array<number>(barCount).fill(0);
  columns.forEach((column, index) => {
    bars[barOf(index)] = Math.max(bars[barOf(index)], column.weight);
  });
  const peak = Math.max(...bars);
  const rows = Math.min(peak, CHART_HEIGHT);

  const lines = [caption];
  for (let row = rows; row >= 1; row--) {
    const label = Math.round((row * peak) / rows);
    const rowFloor = ((row - 1) * peak) / rows;
    const cells = bars.map((weight) =>
      (weight > rowFloor ? "#" : " ").repeat(barWidth),
    );
    lines.push(`${String(label).padStart(3)} | ${cells.join("")}`.trimEnd());
  }

  const footer = [
    `ticks ${columns[0].tickId}..${columns[columns.length - 1].tickId}`,
    `columns ${columns.length}`,
  ];
  if (!Array.isArray(input)) {
    const active = input.columns.findIndex(
      (column) => column.side === LiquiditySide.Active,
    );
    if (active !== -1) {
      lines.push(`    | ${" ".repeat(barOf(active) * barWidth)}^`);
    }
    footer.push(
      `current tick ${input.currentTickId}`,
      `spacing ${input.tickSpacing}`,
      `ranges ${input.ranges.length}`,
    );
  }
  lines.push(`      ${footer.join(" | ")}`);
  console.log(`${lines.join("\n")}\n`);
}
