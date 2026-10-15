import BN from "bn.js";
import { getBaseFeeNumerator } from "../base_fee";
import {
  MAX_BASIS_POINT,
  MAX_FEE_NUMERATOR,
  MAX_REFERENCE_AGE,
} from "../constants";
import { PoolError } from "../errors";
import type { DynamicFeeConfig, FeeConfig } from "../types";
import {
  U64_MAX,
  U128_MAX,
  safeDiv,
  safeMul,
  tryCastU32,
  tryCastU64,
} from "./safe_math";

const DOUBLE_MAX_BASIS_POINT = new BN(MAX_BASIS_POINT * 2);
const V_FEE_ROUNDING = new BN("99999999999");
const V_FEE_SCALE = new BN("100000000000");

export type WorkingVariableFee = {
  sqrtPriceReference: BN;
  lastSignificantSwapTimestamp: BN;
  lastReferenceTimestamp: BN;
  volatilityAccumulator: number;
  volatilityReference: number;
};

export function isDynamicFeeEnabled(config: DynamicFeeConfig): boolean {
  return config.initialized !== 0;
}

// On-chain approximation: Δtick = sqrt(Pmax) × 20,000 / sqrt(Pmin) − 20,000.
export function getDeltaTick(sqrtPriceA: BN, sqrtPriceB: BN): BN {
  const [upper, lower] = sqrtPriceA.gt(sqrtPriceB)
    ? [sqrtPriceA, sqrtPriceB]
    : [sqrtPriceB, sqrtPriceA];

  let prod = upper.mul(DOUBLE_MAX_BASIS_POINT);
  if (prod.gt(U128_MAX)) {
    prod = U128_MAX;
  }
  if (lower.isZero()) {
    throw PoolError.mathOverflow();
  }
  const deltaTick = prod.div(lower).sub(DOUBLE_MAX_BASIS_POINT);
  return deltaTick.isNeg() ? new BN(0) : deltaTick;
}

function saturatingElapsed(current: BN, previous: BN): BN {
  const elapsed = current.sub(previous);
  return elapsed.isNeg() ? new BN(0) : elapsed;
}

export function updateReferences(
  variableFee: WorkingVariableFee,
  sqrtPriceCurrent: BN,
  currentTimestamp: BN,
  dynamicFeeConfig: DynamicFeeConfig,
): void {
  const referenceAge = saturatingElapsed(
    currentTimestamp,
    variableFee.lastReferenceTimestamp,
  );
  if (referenceAge.gt(MAX_REFERENCE_AGE)) {
    variableFee.sqrtPriceReference = sqrtPriceCurrent.clone();
    variableFee.volatilityReference = 0;
    variableFee.lastReferenceTimestamp = currentTimestamp.clone();
    return;
  }

  const maxTimestamp = BN.max(
    variableFee.lastReferenceTimestamp,
    variableFee.lastSignificantSwapTimestamp,
  );
  const elapsed = saturatingElapsed(currentTimestamp, maxTimestamp);
  if (elapsed.lt(new BN(dynamicFeeConfig.filterPeriod))) {
    return;
  }

  variableFee.sqrtPriceReference = sqrtPriceCurrent.clone();
  variableFee.lastReferenceTimestamp = currentTimestamp.clone();
  if (elapsed.lt(new BN(dynamicFeeConfig.decayPeriod))) {
    const volatilityReference = safeDiv(
      safeMul(
        new BN(variableFee.volatilityAccumulator),
        new BN(dynamicFeeConfig.reductionFactor),
        U64_MAX,
      ),
      new BN(MAX_BASIS_POINT),
      U64_MAX,
    );
    variableFee.volatilityReference = tryCastU32(volatilityReference);
  } else {
    variableFee.volatilityReference = 0;
  }
}

export function updateVolatilityAccumulator(
  variableFee: WorkingVariableFee,
  sqrtPrice: BN,
  dynamicFeeConfig: DynamicFeeConfig,
): void {
  const deltaTick = getDeltaTick(sqrtPrice, variableFee.sqrtPriceReference);

  const volatilityAccumulator = deltaTick
    .mul(new BN(MAX_BASIS_POINT))
    .add(new BN(variableFee.volatilityReference));

  if (
    volatilityAccumulator.gt(new BN(dynamicFeeConfig.maxVolatilityAccumulator))
  ) {
    variableFee.volatilityAccumulator =
      dynamicFeeConfig.maxVolatilityAccumulator;
  } else {
    variableFee.volatilityAccumulator = volatilityAccumulator.toNumber();
  }
}

export function calculateTradingFeeNumerator(
  variableFeeControl: number,
  volatilityAccumulator: number,
): BN {
  const squareVfaTick = new BN(volatilityAccumulator).mul(
    new BN(volatilityAccumulator),
  );
  // Damm-v2's (vol_acc × bin_step)² × vfc / 1e11 with the fixed 1 bps price
  // step folded into Δtick; ceil so any non-zero fee is at least 1.
  const vFee = new BN(variableFeeControl).mul(squareVfaTick);
  return tryCastU64(vFee.add(V_FEE_ROUNDING).div(V_FEE_SCALE));
}

export function getDynamicFeeNumerator(
  dynamicFeeConfig: DynamicFeeConfig,
  variableFee: WorkingVariableFee,
): BN {
  if (!isDynamicFeeEnabled(dynamicFeeConfig)) {
    return new BN(0);
  }
  return calculateTradingFeeNumerator(
    dynamicFeeConfig.variableFeeControl,
    variableFee.volatilityAccumulator,
  );
}

export function getTotalTradingFeeNumerator(
  feeConfig: FeeConfig,
  variableFee: WorkingVariableFee,
  currentPoint: BN,
  activationPoint: BN,
  initSqrtPrice: BN,
  currentSqrtPrice: BN,
): BN {
  const baseFeeNumerator = getBaseFeeNumerator(
    feeConfig.baseFee,
    currentPoint,
    activationPoint,
    initSqrtPrice,
    currentSqrtPrice,
  );

  const dynamicFeeNumerator = getDynamicFeeNumerator(
    feeConfig.dynamicFee,
    variableFee,
  );

  return BN.min(
    baseFeeNumerator.add(dynamicFeeNumerator),
    MAX_FEE_NUMERATOR,
  ).clone();
}
