import BN from "bn.js";
import { LIMIT_ORDER_MAX_TICK, MAX_TICK_SPACING } from "../constants";
import { PoolError } from "../errors";
import { alignTickDown } from "../helpers/tick_array";
import { I32_MAX, I32_MIN, safeAdd, safeMul, U64_MAX } from "../math/safe_math";
import type { RelativeTick } from "../types";
import type { LiquidityColumn, LiquidityShape } from "./shape";

export type LimitOrderSide = "bid" | "ask";

/**
 * `slippageTicks` is the room on each side of the spacing-aligned active tick
 * and must be a multiple of `tickSpacing`. The program accepts the order only
 * while that aligned tick is still inside the band.
 */
export function relativeTickFromSlippage(args: {
  currentTickId: number;
  tickSpacing: number;
  slippageTicks: number;
}): RelativeTick {
  if (
    !Number.isInteger(args.tickSpacing) ||
    args.tickSpacing <= 0 ||
    args.tickSpacing > MAX_TICK_SPACING ||
    !Number.isInteger(args.currentTickId) ||
    args.currentTickId < I32_MIN ||
    args.currentTickId > I32_MAX ||
    !Number.isInteger(args.slippageTicks) ||
    args.slippageTicks < 0 ||
    args.slippageTicks % args.tickSpacing !== 0
  ) {
    throw PoolError.invalidParameters();
  }

  const aligned = alignTickDown(args.currentTickId, args.tickSpacing);
  const spacingAlignedMinTickId = aligned - args.slippageTicks;
  const spacingAlignedMaxTickId = aligned + args.slippageTicks;
  if (spacingAlignedMinTickId < I32_MIN || spacingAlignedMaxTickId > I32_MAX) {
    throw PoolError.invalidParameters();
  }
  return { spacingAlignedMinTickId, spacingAlignedMaxTickId };
}

export type ShapeLimitOrderTick = {
  id: number;
  amount: BN;
};

export type ShapeLimitOrderTicks = {
  ticks: ShapeLimitOrderTick[];
  /** Sum of the tick amounts, the order's `maxAmount` before transfer fees. */
  amount: BN;
};

function columnMatchesSide(
  column: LiquidityColumn,
  side: LimitOrderSide,
  currentTickId: number,
  alignedCurrentTickId: number,
  includeActiveTick: boolean,
): boolean {
  if (column.weight <= 0) {
    return false;
  }
  if (side === "ask") {
    // the program requires ask ticks strictly greater than the raw current
    // tick (an ask at the active tick would be invisible to swap_for_x), so
    // the active column is never placeable on the ask side
    return column.tickId > currentTickId;
  }
  return includeActiveTick
    ? column.tickId <= alignedCurrentTickId
    : column.tickId < alignedCurrentTickId;
}

/**
 * Asks take the columns above the current tick; bids take those below the
 * spacing-aligned current tick, and `includeActiveTick` adds that tick to the
 * bids. With `relative`, `ticks[].id` is the offset from the spacing-aligned
 * current tick in `shape.tickSpacing` units, matching
 * `OpenLimitOrderParameters.relative_tick` when the shape uses the pool's tick
 * spacing.
 *
 * Pass exactly one of `unitAmount`, the amount per weight unit, or
 * `totalAmount`, a budget split by the side's weights. Each tick gets
 * `unitAmount × weight`; from a budget the unit is rounded down, so up to the
 * side's total weight minus one stays unspent.
 */
export function limitOrderTicksFromShape(args: {
  shape: LiquidityShape;
  side: LimitOrderSide;
  unitAmount?: BN;
  totalAmount?: BN;
  relative?: boolean;
  includeActiveTick?: boolean;
}): ShapeLimitOrderTicks {
  if (args.unitAmount !== undefined && args.totalAmount !== undefined) {
    throw PoolError.invalidParameters();
  }

  const { currentTickId, tickSpacing } = args.shape;
  const alignedCurrent = alignTickDown(currentTickId, tickSpacing);
  const columns = args.shape.columns.filter((column) =>
    columnMatchesSide(
      column,
      args.side,
      currentTickId,
      alignedCurrent,
      args.includeActiveTick ?? false,
    ),
  );

  if (columns.length === 0) {
    throw PoolError.invalidParameters();
  }
  if (columns.length > LIMIT_ORDER_MAX_TICK) {
    throw PoolError.invalidParameters();
  }

  const totalWeight = columns.reduce((sum, column) => sum + column.weight, 0);
  const unitAmount =
    args.unitAmount ?? args.totalAmount?.div(new BN(totalWeight));
  if (!unitAmount || unitAmount.lte(new BN(0))) {
    throw PoolError.invalidParameters();
  }

  const ticks: ShapeLimitOrderTick[] = [];
  let total = new BN(0);
  for (const column of columns) {
    const amount = safeMul(unitAmount, new BN(column.weight), U64_MAX);
    total = safeAdd(total, amount, U64_MAX);
    const id = args.relative
      ? (column.tickId - alignedCurrent) / tickSpacing
      : column.tickId;
    ticks.push({ id, amount });
  }
  return { ticks, amount: total };
}
