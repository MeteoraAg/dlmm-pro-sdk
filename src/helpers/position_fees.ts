import BN from "bn.js";
import { safeAdd, tryCastU64, U64_MAX, U128_MAX } from "../math/safe_math";
import type { DecodedPosition, DecodedTick } from "../types";

const U128_MODULUS = U128_MAX.addn(1);

function wrappingSubU128(lhs: BN, rhs: BN): BN {
  return lhs.sub(rhs).umod(U128_MODULUS);
}

export type TickFeeGrowth = Pick<
  DecodedTick,
  "liquidityGross" | "feeGrowthOutsideX" | "feeGrowthOutsideY"
>;

export type FeeGrowthInside = {
  feeGrowthInsideX: BN;
  feeGrowthInsideY: BN;
};

export type PendingFees = {
  feeX: BN;
  feeY: BN;
};

export function positionTotalLiquidity(position: DecodedPosition): BN {
  return position.unlockedLiquidity
    .add(position.permanentLockedLiquidity)
    .add(position.vestingLiquidity);
}

/**
 * Q64.64 fee growth per unit of liquidity accrued inside a tick range. Values
 * wrap at 2^128 like the program's counters, and an empty tick counts all
 * growth as below it (lower) or none as above it (upper).
 */
export function getFeeGrowthInside(args: {
  tickCurrentId: number;
  tickLower: TickFeeGrowth;
  tickLowerId: number;
  tickUpper: TickFeeGrowth;
  tickUpperId: number;
  feeGrowthGlobalX: BN;
  feeGrowthGlobalY: BN;
}): FeeGrowthInside {
  const { tickLower, tickUpper, feeGrowthGlobalX, feeGrowthGlobalY } = args;

  let belowX: BN;
  let belowY: BN;
  if (tickLower.liquidityGross.isZero()) {
    belowX = feeGrowthGlobalX;
    belowY = feeGrowthGlobalY;
  } else if (args.tickCurrentId < args.tickLowerId) {
    belowX = wrappingSubU128(feeGrowthGlobalX, tickLower.feeGrowthOutsideX);
    belowY = wrappingSubU128(feeGrowthGlobalY, tickLower.feeGrowthOutsideY);
  } else {
    belowX = tickLower.feeGrowthOutsideX;
    belowY = tickLower.feeGrowthOutsideY;
  }

  let aboveX: BN;
  let aboveY: BN;
  if (tickUpper.liquidityGross.isZero()) {
    aboveX = new BN(0);
    aboveY = new BN(0);
  } else if (args.tickCurrentId < args.tickUpperId) {
    aboveX = tickUpper.feeGrowthOutsideX;
    aboveY = tickUpper.feeGrowthOutsideY;
  } else {
    aboveX = wrappingSubU128(feeGrowthGlobalX, tickUpper.feeGrowthOutsideX);
    aboveY = wrappingSubU128(feeGrowthGlobalY, tickUpper.feeGrowthOutsideY);
  }

  return {
    feeGrowthInsideX: wrappingSubU128(
      wrappingSubU128(feeGrowthGlobalX, belowX),
      aboveX,
    ),
    feeGrowthInsideY: wrappingSubU128(
      wrappingSubU128(feeGrowthGlobalY, belowY),
      aboveY,
    ),
  };
}

/**
 * Fees a refresh would leave pending on one position slot: the amount already
 * pending plus `liquidity * (growthInside - checkpoint) >> 64`. A slot without
 * liquidity is not updated by the program, so only its pending amount counts.
 */
export function getPendingFees(
  position: DecodedPosition,
  feeGrowthInside: FeeGrowthInside,
): PendingFees {
  const liquidity = positionTotalLiquidity(position);
  if (liquidity.isZero()) {
    return { feeX: position.feePendingX, feeY: position.feePendingY };
  }
  const deltaX = liquidity
    .mul(
      wrappingSubU128(
        feeGrowthInside.feeGrowthInsideX,
        position.feeGrowthCheckpointX,
      ),
    )
    .shrn(64);
  const deltaY = liquidity
    .mul(
      wrappingSubU128(
        feeGrowthInside.feeGrowthInsideY,
        position.feeGrowthCheckpointY,
      ),
    )
    .shrn(64);
  return {
    feeX: safeAdd(position.feePendingX, tryCastU64(deltaX), U64_MAX),
    feeY: safeAdd(position.feePendingY, tryCastU64(deltaY), U64_MAX),
  };
}
