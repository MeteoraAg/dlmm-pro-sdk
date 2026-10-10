import type { Mint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  ActivationBondingCurveHandler,
  getActivationHandler,
} from "../activation";
import {
  HOST_FEE_BPS,
  LIMIT_ORDER_PROTOCOL_FEE_BPS,
  MAX_BASIS_POINT,
  MM_LAUNCH_POOL_PROTOCOL_FEE_BPS,
  MM_PROTOCOL_FEE_BPS,
} from "../constants";
import { PoolError } from "../errors";
import { isSupportExtension } from "../helpers/codec";
import { tickIndexFromId } from "../helpers/tick_array";
import {
  calculateSharedAmounts,
  getTotalTradingFeeNumerator,
  isDynamicFeeEnabled,
  safeAdd,
  safeSub,
  tickIdFromSqrtPrice,
  tryCastActivationType,
  tryCastCollectFeeMode,
  tryCastU128,
  U64_MAX,
  updateReferences,
  updateVolatilityAccumulator,
  type WorkingVariableFee,
} from "../math";
import {
  ActivationType,
  CollectFeeMode,
  PoolExtension,
  PoolStatus,
  PoolType,
  Rounding,
  TokenProgramFlags,
  type DecodedPoolActivation,
  type DecodedTick,
  type FeeSetting,
  type Pool,
  type TickArrayBitmapExtension,
} from "../types";
import { getNonZeroLiquidityNextIndex } from "./bitmap_traversal";
import {
  applySwapResultToTick,
  getPendingLimitOrderAmount,
  getSwapResultExactIn,
  isNonZeroLiquidity,
  type SwapStepResult,
} from "./swap_step";
import { calculateTransferFeeExcludedAmount } from "./transfer_fee";

export * from "./bitmap_traversal";
export * from "./swap_step";
export * from "./transfer_fee";

export type QuoteTickArray = {
  pool: PublicKey;
  tickIndex: number;
  ticks: DecodedTick[];
};

export type QuoteExactInParams = {
  poolAddress: PublicKey;
  pool: Pool;
  /**
   * Pool activation extension (from `decodePoolExtensionsFromData`); required
   * to gate pre-activation swaps when the pool has the ActivationAccess
   * extension, ignored otherwise.
   */
  poolActivation?: DecodedPoolActivation | null;
  /**
   * Parsed tick arrays ordered for the traversal like the swap instruction's
   * remaining accounts: descending indices when `swapForY`, ascending
   * otherwise (see `tickArraysForSwap`).
   */
  tickArrays: QuoteTickArray[];
  bitmapExtension?: TickArrayBitmapExtension | null;
  /** Input amount before the input mint's transfer fee. */
  inputAmount: BN;
  swapForY: boolean;
  hasReferral: boolean;
  /**
   * The swapping wallet; only used to honor the whitelisted-swap bypass
   * during pre-activation.
   */
  swapper?: PublicKey | null;
  currentSlot: BN;
  currentTimestamp: BN;
  epoch: bigint;
  /**
   * Unpacked input mint (`unpackMint`), required to model Token-2022
   * transfer fees. `null` skips transfer-fee handling (correct for legacy
   * SPL mints).
   */
  inputMint?: Mint | null;
  /** Unpacked output mint; same contract as `inputMint`. */
  outputMint?: Mint | null;
};

export type QuoteExactInResult = {
  /** Pool-side consumed input (after the input mint's transfer fee). */
  consumedInAmount: BN;
  /**
   * Input the pool could not consume: liquidity ran out inside the provided
   * tick arrays. The on-chain swap fails with `NotConsumingFullAmountIn`
   * when this is non-zero.
   */
  amountLeft: BN;
  /** Pool-side output (before the output mint's transfer fee). */
  outAmount: BN;
  /**
   * What the user actually receives after the output transfer fee — the
   * value the program compares against `minimumOutputAmount`.
   */
  transferFeeExcludedOutAmount: BN;
  mmFee: BN;
  limitOrderFee: BN;
  protocolFee: BN;
  hostFee: BN;
  partnerFee: BN;
  nextSqrtPrice: BN;
  nextTickId: number;
  nextLiquidity: BN;
  /** Indexes of the tick arrays the traversal touched, in traversal order. */
  consumedTickArrayIndexes: number[];
  /**
   * Activation slots after this quote. Empty when the pool has no activation
   * extension. `reachedTarget` is set only when `amountLeft` is zero: a
   * partial swap reverts on-chain before `is_reach_target` is written.
   */
  postSwapActivations: QuoteActivationSlot[];
};

export type QuoteActivationSlot = {
  activationMode: number;
  /** Bonding-curve flag. False for open and time-based slots. */
  isReachTarget: boolean;
  /** True when this quote is what flips the bonding-curve flag on. */
  reachedTarget: boolean;
};

type SwapFinalResult = {
  userPayAmount: BN;
  userReceiveAmount: BN;
  amountLeft: BN;
  mmFee: BN;
  limitOrderFee: BN;
  protocolFeeOnMmFee: BN;
  protocolFeeOnLimitOrderFee: BN;
};

export function isPoolStatusEnabled(
  poolStatus: number,
  status: PoolStatus,
): boolean {
  return (poolStatus & (1 << status)) === 0;
}

export function getFeeSetting(
  pool: Pool,
  swapForY: boolean,
  hasReferral: boolean,
): FeeSetting {
  const collectFeeMode = tryCastCollectFeeMode(pool.collectFeeMode);

  let feesOnInput: boolean;
  let feesOnTokenX: boolean;
  if (collectFeeMode === CollectFeeMode.OutputToken) {
    [feesOnInput, feesOnTokenX] = swapForY ? [false, false] : [false, true];
  } else {
    // Fees are always collected in token Y.
    [feesOnInput, feesOnTokenX] = swapForY ? [false, false] : [true, false];
  }

  const isLaunchPool = pool.poolType === PoolType.LaunchPool;
  return {
    feesOnInput,
    feesOnTokenX,
    hasReferral,
    hasPartner: !pool.poolPartner.partner.equals(PublicKey.default),
    mmProtocolFeeBps: isLaunchPool
      ? MM_LAUNCH_POOL_PROTOCOL_FEE_BPS
      : MM_PROTOCOL_FEE_BPS,
    limitOrderProtocolFeeBps: LIMIT_ORDER_PROTOCOL_FEE_BPS,
    partnerFeeBps: pool.partnerFeeBps,
  };
}

export function getCurrentPoint(
  activationType: number,
  currentSlot: BN,
  currentTimestamp: BN,
): BN {
  let type: ActivationType;
  try {
    type = tryCastActivationType(activationType);
  } catch {
    throw PoolError.invalidActivationType();
  }
  return type === ActivationType.Slot ? currentSlot : currentTimestamp;
}

export function validatePoolCanSwap(
  pool: Pool,
  poolActivation: DecodedPoolActivation | null | undefined,
  swapper: PublicKey | null | undefined,
  currentPoint: BN,
): void {
  if (!isPoolStatusEnabled(pool.poolStatus, PoolStatus.Swap)) {
    throw PoolError.invalidActivationAccess();
  }
  if (!isSupportExtension(pool.extensions, PoolExtension.ActivationAccess)) {
    return;
  }
  if (!poolActivation) {
    throw PoolError.invalidParameters();
  }
  const isWhitelisted =
    !!swapper && poolActivation.whitelistedSwap.equals(swapper);
  if (isWhitelisted) {
    return;
  }
  for (const info of poolActivation.activations) {
    const handler = getActivationHandler({
      activationMode: info.activationMode,
      data: info.data,
    });
    if (!handler.canSwap(currentPoint)) {
      throw PoolError.invalidActivationAccess();
    }
  }
}

function applyStepToFinalResult(
  finalResult: SwapFinalResult,
  step: SwapStepResult,
): void {
  finalResult.userPayAmount = safeAdd(
    finalResult.userPayAmount,
    step.includedFeeAmountIn,
    U64_MAX,
  );
  finalResult.userReceiveAmount = safeAdd(
    finalResult.userReceiveAmount,
    step.excludedFeeOutAmount,
    U64_MAX,
  );
  finalResult.amountLeft = safeSub(
    finalResult.amountLeft,
    step.includedFeeAmountIn,
    U64_MAX,
  );
  finalResult.mmFee = safeAdd(finalResult.mmFee, step.mmFee, U64_MAX);
  finalResult.limitOrderFee = safeAdd(
    finalResult.limitOrderFee,
    step.limitOrderFee,
    U64_MAX,
  );
  finalResult.protocolFeeOnMmFee = safeAdd(
    finalResult.protocolFeeOnMmFee,
    step.protocolFeeOnMmFee,
    U64_MAX,
  );
  finalResult.protocolFeeOnLimitOrderFee = safeAdd(
    finalResult.protocolFeeOnLimitOrderFee,
    step.protocolFeeOnLimitOrderFee,
    U64_MAX,
  );
}

function getProtocolFeeSharingResult(
  finalResult: SwapFinalResult,
  feeSetting: FeeSetting,
): { protocolFee: BN; hostFee: BN; partnerFee: BN } {
  let protocolFee = safeAdd(
    finalResult.protocolFeeOnMmFee,
    finalResult.protocolFeeOnLimitOrderFee,
    U64_MAX,
  );
  let hostFee = new BN(0);
  if (feeSetting.hasReferral) {
    const totalLimitOrderFee = safeAdd(
      finalResult.limitOrderFee,
      finalResult.protocolFeeOnLimitOrderFee,
      U64_MAX,
    );
    const [virtualProtocolFeeOnLimitOrderFee] = calculateSharedAmounts(
      totalLimitOrderFee,
      new BN(feeSetting.mmProtocolFeeBps),
      new BN(MAX_BASIS_POINT),
      Rounding.Down,
    );

    const protocolFeeOnLimitOrderFee = BN.min(
      virtualProtocolFeeOnLimitOrderFee,
      finalResult.protocolFeeOnLimitOrderFee,
    );

    const totalProtocolFee = safeAdd(
      protocolFeeOnLimitOrderFee,
      finalResult.protocolFeeOnMmFee,
      U64_MAX,
    );

    [hostFee] = calculateSharedAmounts(
      totalProtocolFee,
      new BN(HOST_FEE_BPS),
      new BN(MAX_BASIS_POINT),
      Rounding.Down,
    );
    // Subtract host from the FULL protocol fee (mm + full LO cut), not from
    // the host-capped base, so no protocol fee is silently dropped.
    protocolFee = safeSub(protocolFee, hostFee, U64_MAX);
  }

  let partnerFee = new BN(0);
  if (feeSetting.hasPartner && feeSetting.partnerFeeBps > 0) {
    const [fee, remainingProtocolFee] = calculateSharedAmounts(
      protocolFee,
      new BN(feeSetting.partnerFeeBps),
      new BN(MAX_BASIS_POINT),
      Rounding.Down,
    );
    partnerFee = fee;
    protocolFee = remainingProtocolFee;
  }

  return { protocolFee, hostFee, partnerFee };
}

function isNextTickId(
  swapForY: boolean,
  tickId: number,
  tickCurrentId: number,
): boolean {
  return swapForY ? tickCurrentId >= tickId : tickCurrentId < tickId;
}

/**
 * Nothing is persisted. When `amountLeft` is zero, the amounts match `swap`
 * for the same accounts and clock.
 */
export function quoteExactIn(params: QuoteExactInParams): QuoteExactInResult {
  const {
    poolAddress,
    pool,
    poolActivation,
    tickArrays,
    bitmapExtension,
    inputAmount,
    swapForY,
    hasReferral,
    swapper,
    currentSlot,
    currentTimestamp,
    epoch,
    inputMint,
    outputMint,
  } = params;

  if (inputAmount.lten(0)) {
    throw PoolError.amountIsZero();
  }
  if (bitmapExtension && !bitmapExtension.pool.equals(poolAddress)) {
    throw PoolError.invalidAccount();
  }
  const inputTokenFlag = swapForY ? pool.tokenXFlag : pool.tokenYFlag;
  const outputTokenFlag = swapForY ? pool.tokenYFlag : pool.tokenXFlag;
  const inputMintAddress = swapForY ? pool.tokenXMint : pool.tokenYMint;
  const outputMintAddress = swapForY ? pool.tokenYMint : pool.tokenXMint;
  if (
    (inputTokenFlag === TokenProgramFlags.TokenProgram2022 && !inputMint) ||
    (outputTokenFlag === TokenProgramFlags.TokenProgram2022 && !outputMint) ||
    (inputMint && !inputMint.address.equals(inputMintAddress)) ||
    (outputMint && !outputMint.address.equals(outputMintAddress))
  ) {
    throw PoolError.invalidParameters();
  }

  const currentPoint = getCurrentPoint(
    pool.activationType,
    currentSlot,
    currentTimestamp,
  );
  validatePoolCanSwap(pool, poolActivation, swapper, currentPoint);

  const feeSetting = getFeeSetting(pool, swapForY, hasReferral);

  const transferFeeExcludedInputAmount = calculateTransferFeeExcludedAmount(
    inputMint,
    epoch,
    inputAmount,
  ).amount;

  let currentTickIndex = tickIndexFromId(pool.tickCurrentId, pool.tickSpacing);
  const firstIndex = getNonZeroLiquidityNextIndex(
    pool,
    swapForY,
    currentTickIndex,
    bitmapExtension,
  );
  if (firstIndex === null) {
    throw PoolError.liquidityIsZero();
  }
  currentTickIndex = firstIndex;

  const traversal: { tickIndex: number; ticks: DecodedTick[] }[] = [];
  for (let i = 0; i < tickArrays.length; i++) {
    const tickArray = tickArrays[i];
    if (tickArray.tickIndex !== currentTickIndex) {
      continue;
    }
    // Unreached arrays are not checked against the pool.
    if (!tickArray.pool.equals(poolAddress)) {
      throw PoolError.invalidTickArray();
    }
    traversal.push({
      tickIndex: tickArray.tickIndex,
      ticks: tickArray.ticks.map((tick) => ({ ...tick })),
    });

    if (i === tickArrays.length - 1) {
      break;
    }

    const nextFrom = swapForY ? currentTickIndex - 1 : currentTickIndex + 1;
    const nextIndex = getNonZeroLiquidityNextIndex(
      pool,
      swapForY,
      nextFrom,
      bitmapExtension,
    );
    if (nextIndex === null) {
      break;
    }
    currentTickIndex = nextIndex;
  }

  const finalResult: SwapFinalResult = {
    userPayAmount: new BN(0),
    userReceiveAmount: new BN(0),
    amountLeft: transferFeeExcludedInputAmount,
    mmFee: new BN(0),
    limitOrderFee: new BN(0),
    protocolFeeOnMmFee: new BN(0),
    protocolFeeOnLimitOrderFee: new BN(0),
  };

  let currentSqrtPrice = pool.sqrtPrice.clone();
  let currentTickId = pool.tickCurrentId;
  let currentLiquidity = tryCastU128(pool.liquidity.clone());

  const variableFee: WorkingVariableFee = {
    sqrtPriceReference: pool.variableFee.sqrtPriceReference.clone(),
    lastSignificantSwapTimestamp:
      pool.variableFee.lastSignificantSwapTimestamp.clone(),
    lastReferenceTimestamp: pool.variableFee.lastReferenceTimestamp.clone(),
    volatilityAccumulator: pool.variableFee.volatilityAccumulator,
    volatilityReference: pool.variableFee.volatilityReference,
  };

  if (isDynamicFeeEnabled(pool.feeConfig.dynamicFee)) {
    updateReferences(
      variableFee,
      pool.sqrtPrice,
      currentTimestamp,
      pool.feeConfig.dynamicFee,
    );
    updateVolatilityAccumulator(
      variableFee,
      pool.sqrtPrice,
      pool.feeConfig.dynamicFee,
    );
  }

  // The fee rate is fixed for the whole swap: the program reads it once, from
  // the pool's pre-swap sqrt price, before entering the tick loop.
  const tradingFeeNumerator = getTotalTradingFeeNumerator(
    pool.feeConfig,
    variableFee,
    currentPoint,
    pool.activationPoint,
    pool.initSqrtPrice,
    pool.sqrtPrice,
  );

  const cachedTickCurrentId = pool.tickCurrentId;
  const consumedTickArrayIndexes: number[] = [];

  const swapWithTick = (tick: DecodedTick): boolean => {
    const step = getSwapResultExactIn(
      tick,
      tradingFeeNumerator,
      finalResult.amountLeft,
      feeSetting,
      swapForY,
      currentSqrtPrice,
      currentLiquidity,
    );

    applyStepToFinalResult(finalResult, step);
    applySwapResultToTick(tick, swapForY, step);

    if (!step.nextSqrtPrice.eq(tick.sqrtPrice)) {
      // Preserve tickCurrentId when no price movement occurs after a downward
      // cross; the sqrt price alone does not record which side was crossed.
      if (!step.nextSqrtPrice.eq(currentSqrtPrice)) {
        currentSqrtPrice = step.nextSqrtPrice;
        const nextTickId = tickIdFromSqrtPrice(step.nextSqrtPrice);
        currentTickId = swapForY
          ? Math.max(nextTickId, tick.tickId)
          : Math.min(nextTickId, tick.tickId - 1);
      }
    } else if (
      finalResult.amountLeft.isZero() &&
      getPendingLimitOrderAmount(tick).gtn(0)
    ) {
      // MM liquidity reached the tick boundary and the input is fully
      // consumed, but this tick still has unfilled limit-order liquidity.
      // Do NOT cross: stop exactly at the boundary so a subsequent
      // same-direction swap revisits it.
      currentSqrtPrice = tick.sqrtPrice.clone();
      currentTickId = swapForY ? tick.tickId : tick.tickId - 1;
    } else {
      currentSqrtPrice = tick.sqrtPrice.clone();

      const signedLiquidityNet = swapForY
        ? tick.liquidityNet.neg()
        : tick.liquidityNet;
      currentTickId = swapForY ? tick.tickId - 1 : tick.tickId;
      currentLiquidity = tryCastU128(currentLiquidity.add(signedLiquidityNet));
    }

    return finalResult.amountLeft.isZero();
  };

  outer: for (const { tickIndex, ticks } of traversal) {
    consumedTickArrayIndexes.push(tickIndex);

    const orderedTicks = swapForY ? [...ticks].reverse() : ticks;
    for (const tick of orderedTicks) {
      if (!isNextTickId(swapForY, tick.tickId, cachedTickCurrentId)) {
        continue;
      }
      if (!isNonZeroLiquidity(tick)) {
        continue;
      }
      if (swapWithTick(tick)) {
        break outer;
      }
    }
  }

  const postSwapActivations =
    isSupportExtension(pool.extensions, PoolExtension.ActivationAccess) &&
    poolActivation
      ? quoteActivationSlots(
          poolActivation,
          pool.initSqrtPrice,
          currentSqrtPrice,
          finalResult.amountLeft.isZero(),
        )
      : [];

  const sharing = getProtocolFeeSharingResult(finalResult, feeSetting);

  const transferFeeExcludedOutAmount = calculateTransferFeeExcludedAmount(
    outputMint,
    epoch,
    finalResult.userReceiveAmount,
  ).amount;

  return {
    consumedInAmount: finalResult.userPayAmount,
    amountLeft: finalResult.amountLeft,
    outAmount: finalResult.userReceiveAmount,
    transferFeeExcludedOutAmount,
    mmFee: finalResult.mmFee,
    limitOrderFee: finalResult.limitOrderFee,
    protocolFee: sharing.protocolFee,
    hostFee: sharing.hostFee,
    partnerFee: sharing.partnerFee,
    nextSqrtPrice: currentSqrtPrice,
    nextTickId: currentTickId,
    nextLiquidity: currentLiquidity,
    consumedTickArrayIndexes,
    postSwapActivations,
  };
}

function quoteActivationSlots(
  poolActivation: DecodedPoolActivation,
  initSqrtPrice: BN,
  nextSqrtPrice: BN,
  commit: boolean,
): QuoteActivationSlot[] {
  return poolActivation.activations.map((info) => {
    const handler = getActivationHandler({
      activationMode: info.activationMode,
      data: [...info.data],
    });
    const before =
      handler instanceof ActivationBondingCurveHandler &&
      handler.isReachTarget();
    if (commit) {
      handler.updatePostSwap(initSqrtPrice, nextSqrtPrice);
    }
    const after =
      handler instanceof ActivationBondingCurveHandler &&
      handler.isReachTarget();
    return {
      activationMode: info.activationMode,
      isReachTarget: after,
      reachedTarget: commit && !before && after,
    };
  });
}
