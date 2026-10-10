import BN from "bn.js";
import { LIMIT_ORDER_MAX_TICK, MAX_TICK_SPACING } from "../constants";
import { PoolError } from "../errors";
import { safeMul, U64_MAX } from "../math/safe_math";
import type { RelativeTick } from "../types";
import type { LiquidityColumn, LiquidityShape } from "./shape";
import { alignTickDown } from "./weights";

export type LimitOrderSide = "bid" | "ask";

const I32_MIN = -0x80000000;
const I32_MAX = 0x7fffffff;

// `slippageTicks` is the room on each side of the spacing-aligned active tick.
// It has to be a multiple of `tickSpacing`. The program accepts the order only
// while that aligned tick is still inside the band.
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
  resolvedTickIds: number[];
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
 * A tick holds one limit-order side at a time on-chain: a bid and an ask that
 * both include the active tick cannot coexist. With `relative`, `ticks[].id`
 * is the offset from the spacing-aligned current tick in pool tick-spacing
 * units, matching `OpenLimitOrderParameters.relative_tick`.
 */
export function limitOrderTicksFromShape(args: {
  shape: LiquidityShape;
  side: LimitOrderSide;
  unitAmount: BN;
  relative?: boolean;
  poolTickSpacing?: number;
  includeActiveTick?: boolean;
}): ShapeLimitOrderTicks {
  if (args.unitAmount.lte(new BN(0))) {
    throw PoolError.invalidParameters();
  }

  const poolTickSpacing = args.poolTickSpacing ?? args.shape.tickSpacing;
  if (poolTickSpacing <= 0) {
    throw PoolError.invalidParameters();
  }

  const currentTickId = args.shape.currentTickId;
  const alignedCurrent = alignTickDown(currentTickId, poolTickSpacing);
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

  const ticks: ShapeLimitOrderTick[] = [];
  const resolvedTickIds: number[] = [];

  for (const column of columns) {
    if (column.tickId % poolTickSpacing !== 0) {
      throw PoolError.invalidParameters();
    }

    const amount = safeMul(args.unitAmount, new BN(column.weight), U64_MAX);
    const resolvedTickId = column.tickId;
    const id = args.relative
      ? (resolvedTickId - alignedCurrent) / poolTickSpacing
      : resolvedTickId;

    ticks.push({ id, amount });
    resolvedTickIds.push(resolvedTickId);
  }

  return { ticks, resolvedTickIds };
}
