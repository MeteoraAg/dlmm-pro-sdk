import { PoolError } from "../errors";
import type { TickRange } from "../types";
import type { LiquidityRange } from "./shape";
import type { TickWeight } from "./weights";

function runsAtLevel(
  weights: TickWeight[],
  level: number,
  tickSpacing: number,
): TickRange[] {
  const runs: TickRange[] = [];
  for (const entry of weights) {
    if (entry.weight < level) {
      continue;
    }
    const last = runs[runs.length - 1];
    if (last && last.tickUpperId === entry.tickId) {
      last.tickUpperId = entry.tickId + tickSpacing;
    } else {
      runs.push({
        tickLowerId: entry.tickId,
        tickUpperId: entry.tickId + tickSpacing,
      });
    }
  }
  return runs;
}

/**
 * Overlapping ranges whose weights add up, at every tick, to that tick's
 * weight: one range per run of ticks at or above each distinct weight level,
 * lowest level first. A run that is unchanged from the level below stays one
 * range and takes the extra weight.
 */
export function stackWeightLevels(
  weights: TickWeight[],
  tickSpacing: number,
): LiquidityRange[] {
  const ordered = [...weights].sort((a, b) => a.tickId - b.tickId);
  const levels = [
    ...new Set(
      ordered.filter((entry) => entry.weight > 0).map((entry) => entry.weight),
    ),
  ].sort((a, b) => a - b);
  if (levels.length === 0) {
    throw PoolError.invalidParameters();
  }

  const ranges: LiquidityRange[] = [];
  let previousRuns = new Map<string, LiquidityRange>();
  let previousLevel = 0;
  for (const level of levels) {
    const step = level - previousLevel;
    const runs = new Map<string, LiquidityRange>();
    for (const run of runsAtLevel(ordered, level, tickSpacing)) {
      const key = `${run.tickLowerId}:${run.tickUpperId}`;
      const unchanged = previousRuns.get(key);
      if (unchanged) {
        unchanged.weight += step;
        runs.set(key, unchanged);
      } else {
        const range = { ...run, weight: step };
        ranges.push(range);
        runs.set(key, range);
      }
    }
    previousRuns = runs;
    previousLevel = level;
  }
  return ranges;
}
