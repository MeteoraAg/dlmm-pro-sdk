import BN from "bn.js";
import { getBaseFeeNumerator } from "../base_fee";
import { MAX_BASIS_POINT, MAX_FEE_NUMERATOR } from "../constants";
import { PoolError } from "../errors";
import type { DynamicFeeConfig, FeeConfig } from "../types";
import { U64_MAX, U128_MAX, safeDiv, safeMul, tryCastU32 } from "./safe_math";

const DOUBLE_MAX_BASIS_POINT = new BN(MAX_BASIS_POINT * 2);
const V_FEE_ROUNDING = new BN("99999999999");
const V_FEE_SCALE = new BN("100000000000");

/** Mutable copy of the pool's `variableFee` state used while quoting. */
export type WorkingVariableFee = {
  sqrtPriceReference: BN;
  lastUpdateTimestamp: BN;
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

export function updateReferences(
  variableFee: WorkingVariableFee,
  sqrtPriceCurrent: BN,
  currentTimestamp: BN,
  dynamicFeeConfig: DynamicFeeConfig,
): void {
  let elapsed = currentTimestamp.sub(variableFee.lastUpdateTimestamp);
  if (elapsed.isNeg()) {
    elapsed = new BN(0);
  }
  if (elapsed.gte(new BN(dynamicFeeConfig.filterPeriod))) {
    variableFee.sqrtPriceReference = sqrtPriceCurrent.clone();
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
}

export function updateVolatilityAccumulator(
  variableFee: WorkingVariableFee,
  sqrtPrice: BN,
  dynamicFeeConfig: DynamicFeeConfig,
): void {
  const deltaTick = getDeltaTick(sqrtPrice, variableFee.sqrtPriceReference);

  let volatilityAccumulator = deltaTick
    .mul(new BN(MAX_BASIS_POINT))
    .add(new BN(variableFee.volatilityReference));
  if (volatilityAccumulator.gt(U128_MAX)) {
    volatilityAccumulator = U128_MAX;
  }

  if (
    volatilityAccumulator.gt(new BN(dynamicFeeConfig.maxVolatilityAccumulator))
  ) {
    variableFee.volatilityAccumulator =
      dynamicFeeConfig.maxVolatilityAccumulator;
  } else {
    variableFee.volatilityAccumulator = volatilityAccumulator.toNumber();
  }
}

export function getDynamicFeeNumerator(
  dynamicFeeConfig: DynamicFeeConfig,
  variableFee: WorkingVariableFee,
): BN {
  if (!isDynamicFeeEnabled(dynamicFeeConfig)) {
    return new BN(0);
  }
  const volatilityAccumulator = new BN(variableFee.volatilityAccumulator);
  const variableFeeControl = new BN(dynamicFeeConfig.variableFeeControl);

  const squareVfaTick = volatilityAccumulator.mul(volatilityAccumulator);

  // vol_acc is Δtick × MAX_BASIS_POINT, so vol_acc² × vfc lives in (bps² × bps) ≈ 1e12-1e16.
  // FEE_DENOMINATOR = 1e9, so divide by 1e11 and ceil so any non-zero v_fee maps to ≥ 1.
  const vFee = variableFeeControl.mul(squareVfaTick);

  const scaledVFee = vFee.add(V_FEE_ROUNDING).div(V_FEE_SCALE);
  return scaledVFee.gt(U64_MAX) ? U64_MAX.clone() : scaledVFee;
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

  let totalFeeNumerator = baseFeeNumerator.add(dynamicFeeNumerator);
  if (totalFeeNumerator.gt(U64_MAX)) {
    totalFeeNumerator = U64_MAX.clone();
  }

  return totalFeeNumerator.gt(MAX_FEE_NUMERATOR)
    ? MAX_FEE_NUMERATOR.clone()
    : totalFeeNumerator;
}
