import BN from "bn.js";
import {
  LIMIT_ORDER_MAX_TICK,
  MAX_BASIS_POINT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
} from "../constants";
import { PoolError } from "../errors";
import { safeMul, U64_MAX } from "../math/safe_math";
import type { RelativeTick } from "../types";
import type { LiquidityColumn, LiquidityShape } from "./shape";
import { alignTickDown } from "./weights";

export type LimitOrderSide = "bid" | "ask";

/**
 * Build the `relativeTick` sqrt-price slippage bounds for
 * `OpenLimitOrderParameters` from the pool sqrt price the ticks were computed
 * against. `maxSlippageBps` applies to the sqrt price (a price slippage of
 * `s` bps is roughly `s / 2` bps on the sqrt price); the bounds are clamped
 * to the program's valid sqrt-price range.
 */
export function relativeTickFromSlippage(args: {
  currentSqrtPrice: BN;
  maxSlippageBps: number;
}): RelativeTick {
  if (
    !Number.isInteger(args.maxSlippageBps) ||
    args.maxSlippageBps < 0 ||
    args.maxSlippageBps >= MAX_BASIS_POINT
  ) {
    throw PoolError.invalidParameters();
  }
  if (
    args.currentSqrtPrice.lt(MIN_SQRT_PRICE) ||
    args.currentSqrtPrice.gt(MAX_SQRT_PRICE)
  ) {
    throw PoolError.invalidParameters();
  }
  const delta = args.currentSqrtPrice
    .mul(new BN(args.maxSlippageBps))
    .div(new BN(MAX_BASIS_POINT));
  return {
    minSqrtPrice: BN.max(args.currentSqrtPrice.sub(delta), MIN_SQRT_PRICE),
    maxSqrtPrice: BN.min(args.currentSqrtPrice.add(delta), MAX_SQRT_PRICE),
  };
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
