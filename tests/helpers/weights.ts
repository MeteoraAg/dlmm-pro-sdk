import type { TickWeight } from "../../src";

/** `weights[i]` at `minTickId + i * tickSpacing`. */
export function gridWeights(
  minTickId: number,
  tickSpacing: number,
  weights: number[],
): TickWeight[] {
  return weights.map((weight, index) => ({
    tickId: minTickId + index * tickSpacing,
    weight,
  }));
}
