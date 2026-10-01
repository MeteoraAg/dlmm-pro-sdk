import {
  MAX_LIQUIDITY_WEIGHT,
  MAX_TICK_ID,
  MIN_TICK_ID,
  POSITION_MAX_RANGE,
} from "../constants";
import { PoolError, PoolErrorCode } from "../errors";
import { isUsableTickId } from "../helpers/tick_array";
import type { LiquidityRange } from "./shape";

export type RangeCheck = {
  ranges: number;
  vertical: number;
  horizontal: number;
};

type Atom = {
  tickLowerId: number;
  tickUpperId: number;
  weight: number;
  ticks: number;
};

type Fit = {
  cost: number;
  balance: number;
  separation: number;
  reach: number;
};

type Fitted = {
  atoms: Atom[];
  cost: number[];
  balance: number[];
  separation: number[];
  reach: number[];
  previous: number[][];
  piece: (
    start: number,
    end: number,
  ) => { weight: number; cost: number; uniform: boolean };
};

const UNCHANGED = {
  separation: Number.POSITIVE_INFINITY,
  reach: 0,
};

export function checkRanges(
  ranges: LiquidityRange[],
  tickSpacing: number,
): RangeCheck {
  const ordered = orderRanges(ranges, tickSpacing);
  if (ordered.length > POSITION_MAX_RANGE) {
    throw new PoolError(
      PoolErrorCode.InvalidParameters,
      `position supports at most ${POSITION_MAX_RANGE} ranges`,
    );
  }
  let vertical = 0;
  for (const range of ordered) {
    if (range.tickUpperId - range.tickLowerId === tickSpacing) {
      vertical += 1;
    }
  }
  return {
    ranges: ordered.length,
    vertical,
    horizontal: ordered.length - vertical,
  };
}

export function compressRanges(
  ranges: LiquidityRange[],
  tickSpacing: number,
  currentTickId: number,
  maxRanges: number = POSITION_MAX_RANGE,
): LiquidityRange[] {
  if (
    !Number.isInteger(currentTickId) ||
    currentTickId < MIN_TICK_ID ||
    currentTickId > MAX_TICK_ID ||
    !Number.isInteger(maxRanges) ||
    maxRanges < 1 ||
    maxRanges > POSITION_MAX_RANGE
  ) {
    throw PoolError.invalidParameters();
  }
  const ordered = orderRanges(ranges, tickSpacing);
  if (ordered.length <= maxRanges) {
    return ordered;
  }

  const islands = contiguous(ordered);
  if (islands.length > maxRanges) {
    throw new PoolError(
      PoolErrorCode.InvalidParameters,
      `cannot fit into ${maxRanges} ranges`,
    );
  }

  const fitted = islands.map((island) =>
    fitIsland(toAtoms(island, tickSpacing), maxRanges, currentTickId),
  );
  const counts = segmentCounts(fitted, maxRanges);
  const compressed: LiquidityRange[] = [];
  for (let i = 0; i < fitted.length; i++) {
    compressed.push(...rebuild(fitted[i], counts[i]));
  }
  return compressed;
}

function orderRanges(
  ranges: LiquidityRange[],
  tickSpacing: number,
): LiquidityRange[] {
  if (ranges.length === 0) {
    throw PoolError.invalidParameters();
  }
  const ordered = ranges.map((range) => ({
    tickLowerId: range.tickLowerId,
    tickUpperId: range.tickUpperId,
    weight: range.weight,
  }));
  ordered.sort(
    (a, b) => a.tickLowerId - b.tickLowerId || a.tickUpperId - b.tickUpperId,
  );
  for (let i = 0; i < ordered.length; i++) {
    const range = ordered[i];
    const ticks = range.tickUpperId - range.tickLowerId;
    if (
      ticks <= 0 ||
      ticks % tickSpacing !== 0 ||
      !isUsableTickId(range.tickLowerId, tickSpacing) ||
      !isUsableTickId(range.tickUpperId, tickSpacing) ||
      !Number.isInteger(range.weight) ||
      range.weight < 1 ||
      range.weight > MAX_LIQUIDITY_WEIGHT
    ) {
      throw PoolError.invalidParameters();
    }
    if (i > 0 && range.tickLowerId < ordered[i - 1].tickUpperId) {
      throw PoolError.invalidParameters();
    }
  }
  return ordered;
}

function contiguous(ranges: LiquidityRange[]): LiquidityRange[][] {
  const islands: LiquidityRange[][] = [[ranges[0]]];
  for (let i = 1; i < ranges.length; i++) {
    const island = islands[islands.length - 1];
    const previous = island[island.length - 1];
    if (ranges[i].tickLowerId === previous.tickUpperId) {
      island.push(ranges[i]);
    } else {
      islands.push([ranges[i]]);
    }
  }
  return islands;
}

function toAtoms(ranges: LiquidityRange[], tickSpacing: number): Atom[] {
  return ranges.map((range) => ({
    tickLowerId: range.tickLowerId,
    tickUpperId: range.tickUpperId,
    weight: range.weight,
    ticks: (range.tickUpperId - range.tickLowerId) / tickSpacing,
  }));
}

function fitIsland(
  atoms: Atom[],
  maxRanges: number,
  currentTickId: number,
): Fitted {
  const n = atoms.length;
  const maxK = Math.min(n, maxRanges);
  const tickPrefix = [0];
  const sumPrefix = [0];
  const squarePrefix = [0];
  for (const atom of atoms) {
    tickPrefix.push(tickPrefix[tickPrefix.length - 1] + atom.ticks);
    sumPrefix.push(sumPrefix[sumPrefix.length - 1] + atom.ticks * atom.weight);
    squarePrefix.push(
      squarePrefix[squarePrefix.length - 1] +
        atom.ticks * atom.weight * atom.weight,
    );
  }

  const piece = (start: number, end: number) => {
    const ticks = tickPrefix[end] - tickPrefix[start];
    const sum = sumPrefix[end] - sumPrefix[start];
    const square = squarePrefix[end] - squarePrefix[start];
    const mean = sum / ticks;
    let low = Math.floor(mean);
    let high = Math.ceil(mean);
    if (low < 1) low = 1;
    if (high < 1) high = 1;
    if (low > MAX_LIQUIDITY_WEIGHT) low = MAX_LIQUIDITY_WEIGHT;
    if (high > MAX_LIQUIDITY_WEIGHT) high = MAX_LIQUIDITY_WEIGHT;
    const error = (weight: number) =>
      square - 2 * weight * sum + weight * weight * ticks;
    const weight = low === high || error(low) <= error(high) ? low : high;
    return {
      weight,
      cost: square - (sum * sum) / ticks,
      uniform: square * ticks === sum * sum,
    };
  };

  const gaps = atoms.map((atom) => tickGap(atom, currentTickId));
  const gapIndex = createGapIndex();
  const cost = Array.from({ length: n + 1 }, () =>
    Array<number>(maxK + 1).fill(Number.POSITIVE_INFINITY),
  );
  const balance = Array.from({ length: n + 1 }, () =>
    Array<number>(maxK + 1).fill(Number.POSITIVE_INFINITY),
  );
  const separation = Array.from({ length: n + 1 }, () =>
    Array<number>(maxK + 1).fill(Number.NEGATIVE_INFINITY),
  );
  const reach = Array.from({ length: n + 1 }, () =>
    Array<number>(maxK + 1).fill(Number.NEGATIVE_INFINITY),
  );
  const previous = Array.from({ length: n + 1 }, () =>
    Array<number>(maxK + 1).fill(-1),
  );
  cost[0][0] = 0;
  balance[0][0] = 0;
  separation[0][0] = Number.POSITIVE_INFINITY;
  reach[0][0] = 0;
  for (let end = 1; end <= n; end++) {
    gapIndex.reset();
    const limit = Math.min(end, maxK);
    for (let start = end - 1; start >= 0; start--) {
      gapIndex.add(atoms[start].weight, gaps[start]);
      const scored = piece(start, end);
      const moved = scored.uniform ? UNCHANGED : gapIndex.except(scored.weight);
      for (let k = 1; k <= limit && k - 1 <= start; k++) {
        if (cost[start][k - 1] === Number.POSITIVE_INFINITY) {
          continue;
        }
        const nextCost = cost[start][k - 1] + scored.cost;
        const nextBalance =
          balance[start][k - 1] + (end - start) * (end - start);
        const nextSeparation = Math.min(
          separation[start][k - 1],
          moved.separation,
        );
        const nextReach = reach[start][k - 1] + moved.reach;
        if (
          !betterFit(
            nextCost,
            nextBalance,
            nextSeparation,
            nextReach,
            cost[end][k],
            balance[end][k],
            separation[end][k],
            reach[end][k],
          )
        ) {
          continue;
        }
        cost[end][k] = nextCost;
        balance[end][k] = nextBalance;
        separation[end][k] = nextSeparation;
        reach[end][k] = nextReach;
        previous[end][k] = start;
      }
    }
  }

  return {
    atoms,
    cost: cost[n],
    balance: balance[n],
    separation: separation[n],
    reach: reach[n],
    previous,
    piece,
  };
}

function segmentCounts(fitted: Fitted[], maxRanges: number): number[] {
  const groups = fitted.length;
  const total = fitted.reduce((sum, island) => sum + island.atoms.length, 0);
  const budget = Math.min(maxRanges, total);
  const cost = Array.from({ length: groups + 1 }, () =>
    Array<number>(budget + 1).fill(Number.POSITIVE_INFINITY),
  );
  const balance = Array.from({ length: groups + 1 }, () =>
    Array<number>(budget + 1).fill(Number.POSITIVE_INFINITY),
  );
  const separation = Array.from({ length: groups + 1 }, () =>
    Array<number>(budget + 1).fill(Number.NEGATIVE_INFINITY),
  );
  const reach = Array.from({ length: groups + 1 }, () =>
    Array<number>(budget + 1).fill(Number.NEGATIVE_INFINITY),
  );
  const take = Array.from({ length: groups + 1 }, () =>
    Array<number>(budget + 1).fill(0),
  );
  cost[0][0] = 0;
  balance[0][0] = 0;
  separation[0][0] = Number.POSITIVE_INFINITY;
  reach[0][0] = 0;
  for (let group = 0; group < groups; group++) {
    const maxK = Math.min(fitted[group].atoms.length, budget);
    for (let used = 0; used <= budget; used++) {
      if (cost[group][used] === Number.POSITIVE_INFINITY) {
        continue;
      }
      for (let k = 1; k <= maxK && used + k <= budget; k++) {
        const next = {
          cost: cost[group][used] + fitted[group].cost[k],
          balance: balance[group][used] + fitted[group].balance[k],
          separation: Math.min(
            separation[group][used],
            fitted[group].separation[k],
          ),
          reach: reach[group][used] + fitted[group].reach[k],
        };
        const usedSegments = used + k;
        if (
          !betterFit(
            next.cost,
            next.balance,
            next.separation,
            next.reach,
            cost[group + 1][usedSegments],
            balance[group + 1][usedSegments],
            separation[group + 1][usedSegments],
            reach[group + 1][usedSegments],
          )
        ) {
          continue;
        }
        cost[group + 1][usedSegments] = next.cost;
        balance[group + 1][usedSegments] = next.balance;
        separation[group + 1][usedSegments] = next.separation;
        reach[group + 1][usedSegments] = next.reach;
        take[group + 1][usedSegments] = k;
      }
    }
  }

  let bestSegments = -1;
  let best: Fit = {
    cost: Number.POSITIVE_INFINITY,
    balance: Number.POSITIVE_INFINITY,
    separation: Number.NEGATIVE_INFINITY,
    reach: Number.NEGATIVE_INFINITY,
  };
  for (let segments = groups; segments <= budget; segments++) {
    const next = {
      cost: cost[groups][segments],
      balance: balance[groups][segments],
      separation: separation[groups][segments],
      reach: reach[groups][segments],
    };
    if (
      !betterFit(
        next.cost,
        next.balance,
        next.separation,
        next.reach,
        best.cost,
        best.balance,
        best.separation,
        best.reach,
      )
    ) {
      continue;
    }
    best = next;
    bestSegments = segments;
  }
  if (bestSegments < 0) {
    throw PoolError.invalidParameters();
  }

  const counts = Array<number>(groups);
  for (let group = groups; group > 0; group--) {
    counts[group - 1] = take[group][bestSegments];
    bestSegments -= counts[group - 1];
  }
  return counts;
}

function rebuild(fitted: Fitted, segments: number): LiquidityRange[] {
  const starts: number[] = [];
  let end = fitted.atoms.length;
  let remaining = segments;
  while (remaining > 0) {
    const start = fitted.previous[end][remaining];
    if (start < 0) {
      throw PoolError.invalidParameters();
    }
    starts.push(start);
    end = start;
    remaining -= 1;
  }
  starts.reverse();

  const ranges: LiquidityRange[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const endIndex =
      i + 1 < starts.length ? starts[i + 1] : fitted.atoms.length;
    const weight = fitted.piece(start, endIndex).weight;
    const lower = fitted.atoms[start].tickLowerId;
    const upper = fitted.atoms[endIndex - 1].tickUpperId;
    const last = ranges[ranges.length - 1];
    if (last && last.tickUpperId === lower && last.weight === weight) {
      last.tickUpperId = upper;
    } else {
      ranges.push({ tickLowerId: lower, tickUpperId: upper, weight });
    }
  }
  return ranges;
}

function tickGap(atom: Atom, currentTickId: number): number {
  if (currentTickId < atom.tickLowerId) {
    return atom.tickLowerId - currentTickId;
  }
  if (currentTickId >= atom.tickUpperId) {
    return currentTickId - atom.tickUpperId + 1;
  }
  return 0;
}

const GAP_WEIGHTS = MAX_LIQUIDITY_WEIGHT + 1;

function createGapIndex() {
  const size = GAP_WEIGHTS;
  const tree = new Float64Array(size * 2);
  const weightSum = new Float64Array(size);
  let total = 0;
  const reset = () => {
    tree.fill(Number.POSITIVE_INFINITY);
    weightSum.fill(0);
    total = 0;
  };
  reset();
  return {
    reset,
    add(weight: number, gap: number) {
      weightSum[weight] += gap;
      total += gap;
      let node = size + weight;
      if (gap >= tree[node]) {
        return;
      }
      tree[node] = gap;
      for (node >>= 1; node > 0; node >>= 1) {
        const left = tree[node << 1];
        const right = tree[(node << 1) | 1];
        tree[node] = left < right ? left : right;
      }
    },
    except(weight: number) {
      return {
        separation: Math.min(
          rangeMin(tree, size, 1, weight - 1),
          rangeMin(tree, size, weight + 1, size - 1),
        ),
        reach: total - weightSum[weight],
      };
    },
  };
}

function rangeMin(
  tree: Float64Array,
  size: number,
  left: number,
  right: number,
): number {
  if (left > right) {
    return Number.POSITIVE_INFINITY;
  }
  let separation = Number.POSITIVE_INFINITY;
  let start = size + left;
  let end = size + right;
  while (start <= end) {
    if (start & 1) {
      if (tree[start] < separation) {
        separation = tree[start];
      }
      start += 1;
    }
    if ((end & 1) === 0) {
      if (tree[end] < separation) {
        separation = tree[end];
      }
      end -= 1;
    }
    start >>= 1;
    end >>= 1;
  }
  return separation;
}

function betterFit(
  nextCost: number,
  nextBalance: number,
  nextSeparation: number,
  nextReach: number,
  cost: number,
  balance: number,
  separation: number,
  reach: number,
): boolean {
  if (nextCost < cost - 1e-9) {
    return true;
  }
  if (nextCost > cost + 1e-9) {
    return false;
  }
  if (nextBalance !== balance) {
    return nextBalance < balance;
  }
  if (nextSeparation !== separation) {
    return nextSeparation > separation;
  }
  return nextReach > reach;
}
