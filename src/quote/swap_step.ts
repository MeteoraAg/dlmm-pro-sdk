import BN from "bn.js";
import {
  divCeil,
  downScaleCeil,
  getDeltaAmountX,
  getDeltaAmountXUnchecked,
  getDeltaAmountY,
  getDeltaAmountYUnchecked,
  getNextSqrtPriceFromInput,
  getExcludedFeeAmount,
  getIncludedFeeAmount,
  safeAdd,
  safeDiv,
  safeMul,
  safeShl,
  safeSub,
  splitFees,
  tryCastU64,
  U64_MAX,
  U256_MAX,
  U320_MAX,
} from "../math";
import {
  Rounding,
  type DecodedTick,
  type FeeSetting,
  type FilledAmountResult,
} from "../types";

export type SwapStepResult = {
  includedFeeAmountIn: BN;
  excludedFeeOutAmount: BN;
  mmFee: BN;
  protocolFeeOnMmFee: BN;
  protocolFeeOnLimitOrderFee: BN;
  limitOrderFee: BN;
  nextSqrtPrice: BN;
  processedOrderAmountOut: BN;
  openOrderAmountOut: BN;
};

type LimitOrderSwapAmountFromInput = {
  amountIn: BN;
  amountLeft: BN;
  outAmount: BN;
};

type MarketMakingSwapAmountFromInput = {
  amountIn: BN;
  amountLeft: BN;
  outAmount: BN;
  nextSqrtPrice: BN;
};

export function isNonZeroLiquidity(tick: DecodedTick): boolean {
  return !(
    tick.liquidityGross.isZero() &&
    tick.openOrderAmount.isZero() &&
    tick.processedOrderRemainingAmount.isZero()
  );
}

export function getPendingLimitOrderAmount(tick: DecodedTick): BN {
  return safeAdd(
    tick.openOrderAmount,
    tick.processedOrderRemainingAmount,
    U64_MAX,
  );
}

export function isLimitOrderAskSide(tick: DecodedTick): boolean {
  return tick.limitOrderAskSide === 1;
}

export function tickGetAmountIn(
  sqrtPrice: BN,
  outAmount: BN,
  swapForY: boolean,
  rounding: Rounding,
): BN {
  return tryCastU64(
    tickGetAmountInUnchecked(sqrtPrice, outAmount, swapForY, rounding),
  );
}

export function tickGetAmountInUnchecked(
  sqrtPrice: BN,
  outAmount: BN,
  swapForY: boolean,
  rounding: Rounding,
): BN {
  if (swapForY) {
    const price = safeMul(sqrtPrice, sqrtPrice, U256_MAX);
    const prod = safeShl(outAmount, 128, U256_MAX);
    return rounding === Rounding.Up
      ? divCeil(prod, price)
      : safeDiv(prod, price, U256_MAX);
  }
  const price = safeMul(sqrtPrice, sqrtPrice, U256_MAX);
  const prod = safeMul(price, outAmount, U320_MAX);
  return rounding === Rounding.Up ? downScaleCeil(prod, 128) : prod.shrn(128);
}

export function tickGetAmountOut(
  amountIn: BN,
  sqrtPrice: BN,
  swapForY: boolean,
): BN {
  if (swapForY) {
    const price = safeMul(sqrtPrice, sqrtPrice, U256_MAX);
    const prod = safeMul(price, amountIn, U320_MAX);
    return tryCastU64(prod.shrn(128));
  }
  const price = safeMul(sqrtPrice, sqrtPrice, U256_MAX);
  const prod = safeShl(amountIn, 128, U256_MAX);
  return tryCastU64(safeDiv(prod, price, U256_MAX));
}

function getCurrentLimitOrderAmounts(
  tick: DecodedTick,
  swapForY: boolean,
): [BN, BN] {
  const pendingLimitOrderAmount = getPendingLimitOrderAmount(tick);
  if (pendingLimitOrderAmount.isZero()) {
    return [new BN(0), new BN(0)];
  }
  const isAsk = isLimitOrderAskSide(tick);
  if (swapForY !== isAsk) {
    return [tick.openOrderAmount, tick.processedOrderRemainingAmount];
  }
  return [new BN(0), new BN(0)];
}

function calculateFilledLimitOrderAmountExactIn(
  tick: DecodedTick,
  amountIn: BN,
  totalOutAmount: BN,
  swapForY: boolean,
): LimitOrderSwapAmountFromInput {
  const totalAmountInUnchecked = tickGetAmountInUnchecked(
    tick.sqrtPrice,
    totalOutAmount,
    swapForY,
    Rounding.Up,
  );
  if (amountIn.gte(totalAmountInUnchecked)) {
    const totalAmountIn = tryCastU64(totalAmountInUnchecked);
    return {
      amountIn: totalAmountIn,
      amountLeft: safeSub(amountIn, totalAmountIn, U64_MAX),
      outAmount: totalOutAmount,
    };
  }
  return {
    amountIn,
    amountLeft: new BN(0),
    outAmount: tickGetAmountOut(amountIn, tick.sqrtPrice, swapForY),
  };
}

function calculateFilledMarketMakingAmountExactIn(
  amountIn: BN,
  swapForY: boolean,
  currentSqrtPrice: BN,
  nextSqrtPrice: BN,
  currentLiquidity: BN,
): MarketMakingSwapAmountFromInput {
  if (currentLiquidity.isZero() || nextSqrtPrice.eq(currentSqrtPrice)) {
    return {
      amountIn: new BN(0),
      amountLeft: amountIn,
      outAmount: new BN(0),
      nextSqrtPrice,
    };
  }

  const maxAmountInUnchecked = swapForY
    ? getDeltaAmountXUnchecked(
        nextSqrtPrice,
        currentSqrtPrice,
        currentLiquidity,
        Rounding.Up,
      )
    : getDeltaAmountYUnchecked(
        currentSqrtPrice,
        nextSqrtPrice,
        currentLiquidity,
        Rounding.Up,
      );

  let actualNextSqrtPrice: BN;
  let actualAmountIn: BN;
  let amountLeft: BN;
  if (amountIn.gte(maxAmountInUnchecked)) {
    const maxAmountIn = tryCastU64(maxAmountInUnchecked);
    actualNextSqrtPrice = nextSqrtPrice;
    actualAmountIn = maxAmountIn;
    amountLeft = safeSub(amountIn, maxAmountIn, U64_MAX);
  } else {
    actualNextSqrtPrice = getNextSqrtPriceFromInput(
      currentSqrtPrice,
      currentLiquidity,
      amountIn,
      swapForY,
    );
    actualAmountIn = amountIn;
    amountLeft = new BN(0);
  }

  const outAmount = swapForY
    ? getDeltaAmountY(
        actualNextSqrtPrice,
        currentSqrtPrice,
        currentLiquidity,
        Rounding.Down,
      )
    : getDeltaAmountX(
        currentSqrtPrice,
        actualNextSqrtPrice,
        currentLiquidity,
        Rounding.Down,
      );

  return {
    amountIn: actualAmountIn,
    amountLeft,
    outAmount,
    nextSqrtPrice: actualNextSqrtPrice,
  };
}

export function getFilledAmountResultExactIn(
  tick: DecodedTick,
  amountIn: BN,
  swapForY: boolean,
  currentSqrtPrice: BN,
  currentLiquidity: BN,
): FilledAmountResult {
  const mmResult = calculateFilledMarketMakingAmountExactIn(
    amountIn,
    swapForY,
    currentSqrtPrice,
    tick.sqrtPrice,
    currentLiquidity,
  );

  const mmAmountIn = mmResult.amountIn;
  const mmAmountOut = mmResult.outAmount;

  let processedOrderAmountIn = new BN(0);
  let processedOrderAmountOut = new BN(0);
  let openOrderAmountIn = new BN(0);
  let openOrderAmountOut = new BN(0);

  if (mmResult.amountLeft.gtn(0)) {
    const [openOrderAmount, processOrderAmount] = getCurrentLimitOrderAmounts(
      tick,
      swapForY,
    );

    if (!openOrderAmount.isZero() || !processOrderAmount.isZero()) {
      const result = calculateFilledLimitOrderAmountExactIn(
        tick,
        mmResult.amountLeft,
        processOrderAmount,
        swapForY,
      );

      processedOrderAmountIn = result.amountIn;
      processedOrderAmountOut = result.outAmount;
      if (result.amountLeft.gtn(0)) {
        const openResult = calculateFilledLimitOrderAmountExactIn(
          tick,
          result.amountLeft,
          openOrderAmount,
          swapForY,
        );
        openOrderAmountIn = openResult.amountIn;
        openOrderAmountOut = openResult.outAmount;
      }
    }
  }

  const totalAmountIn = safeAdd(
    safeAdd(mmAmountIn, processedOrderAmountIn, U64_MAX),
    openOrderAmountIn,
    U64_MAX,
  );
  const totalAmountOut = safeAdd(
    safeAdd(mmAmountOut, processedOrderAmountOut, U64_MAX),
    openOrderAmountOut,
    U64_MAX,
  );
  const amountLeft = safeSub(amountIn, totalAmountIn, U64_MAX);

  return {
    nextSqrtPrice: mmResult.nextSqrtPrice,
    amountIn: totalAmountIn,
    amountLeft,
    outAmount: totalAmountOut,
    mmAmountIn,
    mmAmountOut,
    processedOrderAmountOut,
    openOrderAmountOut,
  };
}

export function getSwapResultExactIn(
  tick: DecodedTick,
  tradingFeeNumerator: BN,
  inputAmount: BN,
  feeSetting: FeeSetting,
  swapForY: boolean,
  currentSqrtPrice: BN,
  currentLiquidity: BN,
): SwapStepResult {
  let actualTradingFee = new BN(0);
  let excludedFeeInputAmount: BN;
  if (feeSetting.feesOnInput) {
    const [amount, tradingFee] = getExcludedFeeAmount(
      tradingFeeNumerator,
      inputAmount,
    );
    actualTradingFee = tradingFee;
    excludedFeeInputAmount = amount;
  } else {
    excludedFeeInputAmount = inputAmount;
  }

  const filledAmountResult = getFilledAmountResultExactIn(
    tick,
    excludedFeeInputAmount,
    swapForY,
    currentSqrtPrice,
    currentLiquidity,
  );

  const amountLeft = filledAmountResult.amountLeft;
  const outAmount = filledAmountResult.outAmount;

  let includedFeeAmountIn: BN;
  if (amountLeft.gtn(0)) {
    excludedFeeInputAmount = safeSub(
      excludedFeeInputAmount,
      amountLeft,
      U64_MAX,
    );
    if (feeSetting.feesOnInput) {
      const [amount, tradingFee] = getIncludedFeeAmount(
        tradingFeeNumerator,
        excludedFeeInputAmount,
      );
      actualTradingFee = tradingFee;
      includedFeeAmountIn = amount;
    } else {
      includedFeeAmountIn = excludedFeeInputAmount;
    }
  } else {
    includedFeeAmountIn = inputAmount;
  }

  let excludedFeeOutAmount: BN;
  if (feeSetting.feesOnInput) {
    excludedFeeOutAmount = outAmount;
  } else {
    const [amount, tradingFee] = getExcludedFeeAmount(
      tradingFeeNumerator,
      outAmount,
    );
    actualTradingFee = tradingFee;
    excludedFeeOutAmount = amount;
  }

  const {
    mmFee,
    limitOrderFee,
    protocolFeeOnMmFee,
    protocolFeeOnLimitOrderFee,
  } = splitFees(actualTradingFee, feeSetting, filledAmountResult);

  return {
    nextSqrtPrice: filledAmountResult.nextSqrtPrice,
    includedFeeAmountIn,
    excludedFeeOutAmount,
    mmFee,
    protocolFeeOnMmFee,
    protocolFeeOnLimitOrderFee,
    limitOrderFee,
    processedOrderAmountOut: filledAmountResult.processedOrderAmountOut,
    openOrderAmountOut: filledAmountResult.openOrderAmountOut,
  };
}

export function getFulfilledOrderAmount(swapResult: SwapStepResult): BN {
  return safeAdd(
    swapResult.processedOrderAmountOut,
    swapResult.openOrderAmountOut,
    U64_MAX,
  );
}

export function applySwapResultToTick(
  tick: DecodedTick,
  swapForY: boolean,
  swapResult: SwapStepResult,
): void {
  if (swapResult.openOrderAmountOut.gtn(0)) {
    tick.totalProcessingOrderAmount = tick.openOrderAmount;
    tick.processedOrderRemainingAmount = safeSub(
      tick.openOrderAmount,
      swapResult.openOrderAmountOut,
      U64_MAX,
    );
    tick.openOrderAmount = new BN(0);
    tick.orderAge = safeAdd(tick.orderAge, new BN(1), U64_MAX);
  } else if (swapResult.processedOrderAmountOut.gtn(0)) {
    tick.processedOrderRemainingAmount = safeSub(
      tick.processedOrderRemainingAmount,
      swapResult.processedOrderAmountOut,
      U64_MAX,
    );
  }

  const fulfilledOrderAmount = getFulfilledOrderAmount(swapResult);
  if (swapForY) {
    tick.fulfilledOrderAmountY = safeAdd(
      tick.fulfilledOrderAmountY,
      fulfilledOrderAmount,
      U64_MAX,
    );
    tick.limitOrderFeeBidSide = safeAdd(
      tick.limitOrderFeeBidSide,
      swapResult.limitOrderFee,
      U64_MAX,
    );
  } else {
    tick.fulfilledOrderAmountX = safeAdd(
      tick.fulfilledOrderAmountX,
      fulfilledOrderAmount,
      U64_MAX,
    );
    tick.limitOrderFeeAskSide = safeAdd(
      tick.limitOrderFeeAskSide,
      swapResult.limitOrderFee,
      U64_MAX,
    );
  }
}
