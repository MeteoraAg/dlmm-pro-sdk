import babar from "babar";
import type { LiquidityShape } from "../../src";

type ChartInput = LiquidityShape | { tickId: number; weight: number }[];

export function debugLiquidityChart(caption: string, input: ChartInput): void {
  if (process.env.DLMM_CHARTS !== "1") {
    return;
  }
  const isShape = !Array.isArray(input);
  const entries = isShape ? input.columns : input;
  const bars: [number, number][] = entries.map((entry) => [
    entry.tickId,
    entry.weight,
  ]);

  console.log(
    babar(bars, { caption, color: "ascii", width: 80, height: 12, minY: 0 }),
  );
  if (isShape) {
    console.log(
      `    current tick ${input.currentTickId} | spacing ${input.tickSpacing} | ${entries.length} columns | ${input.ranges.length} ranges\n`,
    );
  }
}
