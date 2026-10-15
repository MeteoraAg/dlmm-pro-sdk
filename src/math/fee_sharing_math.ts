import BN from "bn.js";
import { FEE_DENOMINATOR, MAX_BASIS_POINT } from "../constants";
import { Rounding } from "../types";
import {
  divCeil,
  safeDiv,
  safeMul,
  safeSub,
  tryCastU64,
  U64_MAX,
  U128_MAX,
} from "./safe_math";

export type FeeSetting = {
  feesOnInput: boolean;
  feesOnTokenX: boolean;
  hasReferral: boolean;
  hasPartner: boolean;
  mmProtocolFeeBps: number;
  limitOrderProtocolFeeBps: number;
  partnerFeeBps: number;
};

export type SplitFees = {
  mmFee: BN;
  limitOrderFee: BN;
  protocolFeeOnLimitOrderFee: BN;
  protocolFeeOnMmFee: BN;
};

export type FilledAmountResult = {
  amountIn: BN;
  amountLeft: BN;
  outAmount: BN;
  mmAmountIn: BN;
  mmAmountOut: BN;
  processedOrderAmountOut: BN;
  openOrderAmountOut: BN;
  nextSqrtPrice: BN;
};

export function calculateSharedAmounts(
  amount: BN,
  numerator: BN,
  denominator: BN,
  rounding: Rounding,
): [BN, BN] {
  if (numerator.isZero()) {
    return [new BN(0), amount];
  }
  if (amount.isZero()) {
    return [new BN(0), new BN(0)];
  }

  const prod = safeMul(amount, numerator, U128_MAX);

  const firstAmount =
    rounding === Rounding.Up
      ? tryCastU64(divCeil(prod, denominator))
      : tryCastU64(safeDiv(prod, denominator, U128_MAX));

  const secondAmount = safeSub(amount, firstAmount, U64_MAX);
  return [firstAmount, secondAmount];
}

export function getExcludedFeeAmount(
  tradeFeeNumerator: BN,
  includedFeeAmount: BN,
): [BN, BN] {
  const prod = safeMul(includedFeeAmount, tradeFeeNumerator, U128_MAX);
  const tradingFee = tryCastU64(divCeil(prod, FEE_DENOMINATOR));
  const excludedFeeAmount = safeSub(includedFeeAmount, tradingFee, U64_MAX);
  return [excludedFeeAmount, tradingFee];
}

export function getIncludedFeeAmount(
  tradeFeeNumerator: BN,
  excludedFeeAmount: BN,
): [BN, BN] {
  const includedFeeAmount = tryCastU64(
    divCeil(
      safeMul(excludedFeeAmount, FEE_DENOMINATOR, U128_MAX),
      safeSub(FEE_DENOMINATOR, tradeFeeNumerator, U64_MAX),
    ),
  );
  const feeAmount = safeSub(includedFeeAmount, excludedFeeAmount, U64_MAX);
  return [includedFeeAmount, feeAmount];
}

export function splitFees(
  tradingFee: BN,
  feeSetting: FeeSetting,
  filledAmountResult: FilledAmountResult,
): SplitFees {
  const [mmShare, totalShare] = feeSetting.feesOnInput
    ? [filledAmountResult.mmAmountIn, filledAmountResult.amountIn]
    : [filledAmountResult.mmAmountOut, filledAmountResult.outAmount];

  // A fee numerator high enough to consume the whole input leaves no filled
  // amount to share against, so the protocol takes the fee outright.
  if (totalShare.isZero()) {
    return {
      mmFee: new BN(0),
      limitOrderFee: new BN(0),
      protocolFeeOnLimitOrderFee: new BN(0),
      protocolFeeOnMmFee: tradingFee,
    };
  }

  const [totalMmFee, totalLimitOrderFee] = calculateSharedAmounts(
    tradingFee,
    mmShare,
    totalShare,
    Rounding.Up,
  );

  const [protocolFeeOnMmFee, mmFee] = calculateSharedAmounts(
    totalMmFee,
    new BN(feeSetting.mmProtocolFeeBps),
    new BN(MAX_BASIS_POINT),
    Rounding.Down,
  );

  const [protocolFeeOnLimitOrderFee, limitOrderFee] = calculateSharedAmounts(
    totalLimitOrderFee,
    new BN(feeSetting.limitOrderProtocolFeeBps),
    new BN(MAX_BASIS_POINT),
    Rounding.Down,
  );

  return {
    mmFee,
    limitOrderFee,
    protocolFeeOnLimitOrderFee,
    protocolFeeOnMmFee,
  };
}
