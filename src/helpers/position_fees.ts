import BN from "bn.js";
import {
  safeAdd,
  tryCastU64,
  U64_MAX,
  U128_MAX,
  wrappingSub,
} from "../math/safe_math";
import type { DecodedPosition, DecodedTick } from "../types";

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
  return safeAdd(
    safeAdd(
      position.permanentLockedLiquidity,
      position.unlockedLiquidity,
      U128_MAX,
    ),
    position.vestingLiquidity,
    U128_MAX,
  );
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
    belowX = wrappingSub(
      feeGrowthGlobalX,
      tickLower.feeGrowthOutsideX,
      U128_MAX,
    );
    belowY = wrappingSub(
      feeGrowthGlobalY,
      tickLower.feeGrowthOutsideY,
      U128_MAX,
    );
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
    aboveX = wrappingSub(
      feeGrowthGlobalX,
      tickUpper.feeGrowthOutsideX,
      U128_MAX,
    );
    aboveY = wrappingSub(
      feeGrowthGlobalY,
      tickUpper.feeGrowthOutsideY,
      U128_MAX,
    );
  }

  return {
    feeGrowthInsideX: wrappingSub(
      wrappingSub(feeGrowthGlobalX, belowX, U128_MAX),
      aboveX,
      U128_MAX,
    ),
    feeGrowthInsideY: wrappingSub(
      wrappingSub(feeGrowthGlobalY, belowY, U128_MAX),
      aboveY,
      U128_MAX,
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
      wrappingSub(
        feeGrowthInside.feeGrowthInsideX,
        position.feeGrowthCheckpointX,
        U128_MAX,
      ),
    )
    .shrn(64);
  const deltaY = liquidity
    .mul(
      wrappingSub(
        feeGrowthInside.feeGrowthInsideY,
        position.feeGrowthCheckpointY,
        U128_MAX,
      ),
    )
    .shrn(64);
  return {
    feeX: safeAdd(position.feePendingX, tryCastU64(deltaX), U64_MAX),
    feeY: safeAdd(position.feePendingY, tryCastU64(deltaY), U64_MAX),
  };
}
