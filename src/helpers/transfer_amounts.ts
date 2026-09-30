import type { Mint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { LIMIT_ORDER_REFERRAL_FEE_BPS, MAX_BASIS_POINT } from "../constants";
import { PoolError } from "../errors";
import {
  calculateSharedAmounts,
  downScaleCeil,
  getLiquidityFromAmountX,
  getLiquidityFromAmountY,
  safeAdd,
  safeDiv,
  safeMul,
  safeSub,
  tryCastU64,
  tryCastU128,
  U64_MAX,
  U128_MAX,
  U192_MAX,
  U256_MAX,
  wrappingAdd,
  wrappingSub,
} from "../math";
import { getSqrtPriceFromTickId } from "../math/tick_math";
import {
  calculateTransferFeeExcludedAmount,
  calculateTransferFeeIncludedAmount,
} from "../quote/transfer_fee";
import { tickGetAmountIn } from "../quote/swap_step";
import type {
  DecodedLimitOrderData,
  DecodedPoolRewardInfo,
  DecodedPosition,
  DecodedPositionWithReward,
  DecodedTick,
  DecodedTickWithReward,
  PositionVesting,
} from "../types";
import { CollectFeeMode, Rounding } from "../types";
import { getAmountsFromLiquidity } from "./liquidity";
import { positionTotalLiquidity } from "./position_fees";

const BASIS = new BN(MAX_BASIS_POINT);

export function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= load());
}

function mulDivU192(amount: BN, numerator: BN, denominator: BN): BN {
  return tryCastU128(
    safeDiv(safeMul(amount, numerator, U192_MAX), denominator, U192_MAX),
  );
}

export function ticksById(
  groups: { ticks: DecodedTick[] }[],
): Map<number, DecodedTick> {
  const ticks = new Map<number, DecodedTick>();
  for (const group of groups) {
    for (const tick of group.ticks) {
      ticks.set(tick.tickId, tick);
    }
  }
  return ticks;
}

export function requireTick(
  ticks: Map<number, DecodedTick>,
  tickId: number,
): DecodedTick {
  const tick = ticks.get(tickId);
  if (!tick) {
    throw PoolError.cannotFindTickFromId();
  }
  return tick;
}

export function sumTokenDeltas(args: {
  tickCurrentId: number;
  currentSqrtPrice: BN;
  ranges: { tickLowerId: number; tickUpperId: number; liquidity: BN }[];
}): { amountX: BN; amountY: BN } {
  let amountX = new BN(0);
  let amountY = new BN(0);
  for (const range of args.ranges) {
    const delta = getAmountsFromLiquidity({
      tickCurrentId: args.tickCurrentId,
      currentSqrtPrice: args.currentSqrtPrice,
      tickLowerId: range.tickLowerId,
      tickUpperId: range.tickUpperId,
      liquidity: range.liquidity,
    });
    amountX = safeAdd(amountX, delta.amountX, U64_MAX);
    amountY = safeAdd(amountY, delta.amountY, U64_MAX);
  }
  return { amountX, amountY };
}

/** Pool-side amount plus its Token-2022 fee, or `ExceededSlippage` when that exceeds `maxAmount`. */
export function cappedTransferFeeIncludedAmount(
  mint: Mint | null,
  epoch: bigint,
  poolSideAmount: BN,
  maxAmount: BN,
): BN {
  if (poolSideAmount.isZero()) {
    return new BN(0);
  }
  const included = calculateTransferFeeIncludedAmount(
    mint,
    epoch,
    poolSideAmount,
  ).amount;
  if (included.gt(maxAmount)) {
    throw PoolError.exceededSlippage();
  }
  return included;
}

export function liquidityTransferAmounts(args: {
  tickCurrentId: number;
  currentSqrtPrice: BN;
  ranges: { tickLowerId: number; tickUpperId: number; liquidity: BN }[];
  withdraw: boolean;
  mintX?: Mint | null;
  mintY?: Mint | null;
  epoch?: bigint;
  maxAmountX?: BN;
  maxAmountY?: BN;
}): { amountX: BN; amountY: BN } {
  const ranges = args.withdraw
    ? args.ranges.map((range) => ({
        ...range,
        liquidity: range.liquidity.neg(),
      }))
    : args.ranges;
  const deltas = sumTokenDeltas({
    tickCurrentId: args.tickCurrentId,
    currentSqrtPrice: args.currentSqrtPrice,
    ranges,
  });
  if (args.withdraw) {
    return deltas;
  }
  return {
    amountX: cappedTransferFeeIncludedAmount(
      args.mintX ?? null,
      args.epoch ?? 0n,
      deltas.amountX,
      args.maxAmountX ?? new BN(0),
    ),
    amountY: cappedTransferFeeIncludedAmount(
      args.mintY ?? null,
      args.epoch ?? 0n,
      deltas.amountY,
      args.maxAmountY ?? new BN(0),
    ),
  };
}

export function imbalanceTransferAmounts(args: {
  maxAmountX: BN | null;
  maxAmountY: BN | null;
  availableX: BN;
  availableY: BN;
  mintX: Mint | null;
  mintY: Mint | null;
  epoch: bigint;
  tickCurrentId: number;
  currentSqrtPrice: BN;
  tickLowerId: number;
  tickUpperId: number;
  minLiquidity: BN | null;
}): { amountX: BN; amountY: BN } {
  const sqrtLower = getSqrtPriceFromTickId(args.tickLowerId);
  const sqrtUpper = getSqrtPriceFromTickId(args.tickUpperId);
  const liquidityX = liquidityFromBudget(
    args.maxAmountX,
    args.availableX,
    args.mintX,
    args.epoch,
    BN.max(sqrtLower, args.currentSqrtPrice),
    BN.max(sqrtUpper, args.currentSqrtPrice),
    true,
  );
  const liquidityY = liquidityFromBudget(
    args.maxAmountY,
    args.availableY,
    args.mintY,
    args.epoch,
    BN.min(sqrtLower, args.currentSqrtPrice),
    BN.min(sqrtUpper, args.currentSqrtPrice),
    false,
  );
  const selected =
    liquidityX !== null && liquidityY !== null
      ? BN.min(liquidityX, liquidityY)
      : (liquidityX ?? liquidityY);
  if (selected === null) {
    throw PoolError.amountIsZero();
  }
  const liquidity = tryCastU128(selected);
  if (args.minLiquidity !== null && liquidity.lt(args.minLiquidity)) {
    throw PoolError.exceededSlippage();
  }
  return liquidityTransferAmounts({
    tickCurrentId: args.tickCurrentId,
    currentSqrtPrice: args.currentSqrtPrice,
    ranges: [
      {
        tickLowerId: args.tickLowerId,
        tickUpperId: args.tickUpperId,
        liquidity,
      },
    ],
    withdraw: false,
    mintX: args.mintX,
    mintY: args.mintY,
    epoch: args.epoch,
    maxAmountX: args.maxAmountX ?? new BN(0),
    maxAmountY: args.maxAmountY ?? new BN(0),
  });
}

function liquidityFromBudget(
  maxAmount: BN | null,
  available: BN,
  mint: Mint | null,
  epoch: bigint,
  lowerSqrtPrice: BN,
  upperSqrtPrice: BN,
  isTokenX: boolean,
): BN | null {
  if (maxAmount === null) {
    return null;
  }
  const budget = maxAmount.lt(available) ? maxAmount : available;
  const excluded = calculateTransferFeeExcludedAmount(
    mint,
    epoch,
    budget,
  ).amount;
  return isTokenX
    ? getLiquidityFromAmountX(lowerSqrtPrice, upperSqrtPrice, excluded)
    : getLiquidityFromAmountY(lowerSqrtPrice, upperSqrtPrice, excluded);
}

export function bpsWithdrawLiquidity(unlocked: BN, bps: number): BN {
  return mulDivU192(unlocked, new BN(bps), BASIS);
}

export function unlockedLiquidityForWithdraw(
  position: DecodedPosition,
  vesting: PositionVesting,
  currentPoint: BN,
): BN {
  if (vesting.initialize === 0) {
    return position.unlockedLiquidity;
  }
  const totalVested = safeAdd(
    position.vestingLiquidity,
    position.releasedVestingLiquidity,
    U128_MAX,
  );
  const maxUnlocked = maxUnlockedVestingLiquidity(
    vesting,
    totalVested,
    currentPoint,
  );
  const delta = safeSub(
    maxUnlocked,
    position.releasedVestingLiquidity,
    U128_MAX,
  );
  return safeAdd(position.unlockedLiquidity, delta, U128_MAX);
}

export function maxUnlockedVestingLiquidity(
  vesting: PositionVesting,
  totalVested: BN,
  currentPoint: BN,
): BN {
  if (currentPoint.lt(vesting.cliffPoint)) {
    return new BN(0);
  }
  if (vesting.periodFrequency.isZero() || vesting.bpsPerPeriod === 0) {
    return mulDivU192(new BN(vesting.cliffUnlockBps), totalVested, BASIS);
  }
  const period = safeDiv(
    safeSub(currentPoint, vesting.cliffPoint, U64_MAX),
    vesting.periodFrequency,
    U64_MAX,
  );
  if (period.gten(vesting.numberOfPeriod)) {
    return totalVested;
  }
  const elapsedBps = safeMul(period, new BN(vesting.bpsPerPeriod), U64_MAX);
  const totalBps = safeAdd(new BN(vesting.cliffUnlockBps), elapsedBps, U64_MAX);
  return mulDivU192(totalBps, totalVested, BASIS);
}

export function calculateRewardAmount(
  timeDelta: BN,
  emissionPerSecond: BN,
  rounding: Rounding,
): BN {
  tryCastU64(timeDelta);
  tryCastU128(emissionPerSecond);
  const prod = safeMul(timeDelta, emissionPerSecond, U192_MAX);
  const scaled =
    rounding === Rounding.Up ? downScaleCeil(prod, 64) : prod.shrn(64);
  return tryCastU64(scaled);
}

export type NextRewardUpdate = {
  rewardGrowthGlobal: BN;
  cumulativeSecondsDelta: BN;
};

export function nextRewardUpdates(args: {
  rewards: DecodedPoolRewardInfo[];
  liquidity: BN;
  currentTimestamp: BN;
}): NextRewardUpdate[] {
  return args.rewards.map((reward) => {
    const unchanged: NextRewardUpdate = {
      rewardGrowthGlobal: reward.rewardGrowthGlobal,
      cumulativeSecondsDelta: new BN(0),
    };
    if (
      reward.mint.equals(PublicKey.default) ||
      args.currentTimestamp.lt(reward.openTime) ||
      reward.lastUpdateTime.eq(reward.endTime)
    ) {
      return unchanged;
    }
    const timeDelta = safeSub(
      BN.min(args.currentTimestamp, reward.endTime),
      reward.lastUpdateTime,
      U64_MAX,
    );
    if (args.liquidity.isZero()) {
      return {
        rewardGrowthGlobal: reward.rewardGrowthGlobal,
        cumulativeSecondsDelta: timeDelta,
      };
    }
    const growthDelta = tryCastU128(
      safeDiv(
        safeMul(timeDelta, reward.emissionPerSecond, U192_MAX),
        args.liquidity,
        U192_MAX,
      ),
    );
    return {
      rewardGrowthGlobal: wrappingAdd(
        reward.rewardGrowthGlobal,
        growthDelta,
        U128_MAX,
      ),
      cumulativeSecondsDelta: new BN(0),
    };
  });
}

export function ineligibleRewardAmount(
  reward: DecodedPoolRewardInfo,
  liquidity: BN,
  currentTimestamp: BN,
): BN {
  const next = nextRewardUpdates({
    rewards: [reward],
    liquidity,
    currentTimestamp,
  })[0];
  const seconds = safeAdd(
    reward.cumulativeSecondsWithEmptyLiquidityReward,
    next.cumulativeSecondsDelta,
    U64_MAX,
  );
  return calculateRewardAmount(
    seconds,
    reward.emissionPerSecond,
    Rounding.Down,
  );
}

function rewardGrowthOutside(tick: DecodedTick, rewardIndex: number): BN {
  const rewarded = tick as DecodedTickWithReward;
  const outside = rewarded.rewardGrowthsOutside?.[rewardIndex];
  if (!outside) {
    throw PoolError.invalidPoolType();
  }
  return outside;
}

export function rewardGrowthInside(args: {
  tickCurrentId: number;
  tickLower: DecodedTick;
  tickUpper: DecodedTick;
  rewardIndex: number;
  rewardGrowthGlobal: BN;
}): BN {
  const below = args.tickLower.liquidityGross.isZero()
    ? args.rewardGrowthGlobal
    : args.tickCurrentId < args.tickLower.tickId
      ? wrappingSub(
          args.rewardGrowthGlobal,
          rewardGrowthOutside(args.tickLower, args.rewardIndex),
          U128_MAX,
        )
      : rewardGrowthOutside(args.tickLower, args.rewardIndex);
  const above = args.tickUpper.liquidityGross.isZero()
    ? new BN(0)
    : args.tickCurrentId < args.tickUpper.tickId
      ? rewardGrowthOutside(args.tickUpper, args.rewardIndex)
      : wrappingSub(
          args.rewardGrowthGlobal,
          rewardGrowthOutside(args.tickUpper, args.rewardIndex),
          U128_MAX,
        );
  return wrappingSub(
    wrappingSub(args.rewardGrowthGlobal, below, U128_MAX),
    above,
    U128_MAX,
  );
}

function pendingRewardOwed(
  position: DecodedPositionWithReward,
  rewardIndex: number,
  growthInside: BN,
): BN {
  const info = position.rewards[rewardIndex];
  if (!info) {
    throw PoolError.invalidRewardIndex();
  }
  const liquidity = positionTotalLiquidity(position);
  const owed = safeMul(
    liquidity,
    wrappingSub(growthInside, info.growthInsideCheckpoint, U128_MAX),
    U256_MAX,
  ).shrn(64);
  const capped = owed.gt(U64_MAX) ? U64_MAX : owed;
  const sum = info.pendingAmount.add(capped);
  return sum.gt(U64_MAX) ? U64_MAX.clone() : sum;
}

export function claimableRewardAmount(args: {
  positions: DecodedPosition[];
  refreshed: ReadonlySet<number>;
  tickCurrentId: number;
  ticks: Map<number, DecodedTick>;
  rewardIndex: number;
  rewardGrowthGlobal: BN;
}): BN {
  let total = new BN(0);
  args.positions.forEach((position, index) => {
    const rewarded = position as DecodedPositionWithReward;
    const stored = rewarded.rewards?.[args.rewardIndex]?.pendingAmount;
    if (!stored) {
      throw PoolError.invalidPoolType();
    }
    const pending =
      args.refreshed.has(index) && !positionTotalLiquidity(position).isZero()
        ? pendingRewardOwed(
            rewarded,
            args.rewardIndex,
            rewardGrowthInside({
              tickCurrentId: args.tickCurrentId,
              tickLower: requireTick(args.ticks, position.tickLowerId),
              tickUpper: requireTick(args.ticks, position.tickUpperId),
              rewardIndex: args.rewardIndex,
              rewardGrowthGlobal: args.rewardGrowthGlobal,
            }),
          )
        : stored;
    total = safeAdd(total, pending, U64_MAX);
  });
  return total;
}

export type CancelLimitOrderTransfers = {
  amountX: BN;
  amountY: BN;
  referralFee: BN;
  referralOnX: boolean;
};

export function cancelLimitOrderTransfers(args: {
  collectFeeMode: number;
  orders: { tick: DecodedTick; order: DecodedLimitOrderData }[];
  referralEligible: boolean;
}): CancelLimitOrderTransfers {
  let withdrawX = new BN(0);
  let withdrawY = new BN(0);
  let feeX = new BN(0);
  let feeY = new BN(0);
  for (const { tick, order } of args.orders) {
    if (order.amount.isZero() && order.age.isZero()) {
      throw PoolError.cancelNonEmptyLimitOrder();
    }
    const result = cancelOneLimitOrder(tick, order, args.collectFeeMode);
    withdrawX = safeAdd(withdrawX, result.withdrawX, U64_MAX);
    withdrawY = safeAdd(withdrawY, result.withdrawY, U64_MAX);
    feeX = safeAdd(feeX, result.feeX, U64_MAX);
    feeY = safeAdd(feeY, result.feeY, U64_MAX);
  }
  if ((feeX.isZero() && feeY.isZero()) || !args.referralEligible) {
    return {
      amountX: safeAdd(withdrawX, feeX, U64_MAX),
      amountY: safeAdd(withdrawY, feeY, U64_MAX),
      referralFee: new BN(0),
      referralOnX: false,
    };
  }
  const share = new BN(LIMIT_ORDER_REFERRAL_FEE_BPS);
  const [referralX, ownerFeeX] = calculateSharedAmounts(
    feeX,
    share,
    BASIS,
    Rounding.Down,
  );
  const [referralY, ownerFeeY] = calculateSharedAmounts(
    feeY,
    share,
    BASIS,
    Rounding.Down,
  );
  return {
    amountX: safeAdd(withdrawX, ownerFeeX, U64_MAX),
    amountY: safeAdd(withdrawY, ownerFeeY, U64_MAX),
    referralFee: safeAdd(referralX, referralY, U64_MAX),
    referralOnX: feeX.gtn(0),
  };
}

function cancelOneLimitOrder(
  tick: DecodedTick,
  order: DecodedLimitOrderData,
  collectFeeMode: number,
): { withdrawX: BN; withdrawY: BN; feeX: BN; feeY: BN } {
  const status = limitOrderStatus(tick.orderAge, order.age);
  let fulfilled: BN;
  let unfilled: BN;
  if (status === "notFilled") {
    fulfilled = new BN(0);
    unfilled = order.amount;
  } else if (status === "fulfilled") {
    fulfilled = order.amount;
    unfilled = new BN(0);
  } else {
    [unfilled, fulfilled] = calculateSharedAmounts(
      order.amount,
      tick.processedOrderRemainingAmount,
      tick.totalProcessingOrderAmount,
      Rounding.Up,
    );
  }
  const isAsk = order.isAsk === 1;
  const swapped = fulfilled.isZero()
    ? new BN(0)
    : tickGetAmountIn(tick.sqrtPrice, fulfilled, !isAsk, Rounding.Down);
  const fee = limitOrderFee(tick, fulfilled, isAsk, collectFeeMode);
  return isAsk
    ? { withdrawX: unfilled, withdrawY: swapped, ...fee }
    : { withdrawX: swapped, withdrawY: unfilled, ...fee };
}

function limitOrderStatus(
  tickAge: BN,
  orderAge: BN,
): "notFilled" | "partial" | "fulfilled" {
  if (orderAge.eq(tickAge)) {
    return "notFilled";
  }
  if (orderAge.addn(1).eq(tickAge)) {
    return "partial";
  }
  if (orderAge.addn(2).lte(tickAge)) {
    return "fulfilled";
  }
  throw PoolError.undeterminedError();
}

function limitOrderFee(
  tick: DecodedTick,
  fulfilled: BN,
  isAsk: boolean,
  collectFeeMode: number,
): { feeX: BN; feeY: BN } {
  if (fulfilled.isZero()) {
    return { feeX: new BN(0), feeY: new BN(0) };
  }
  const [fee] = isAsk
    ? calculateSharedAmounts(
        tick.limitOrderFeeAskSide,
        fulfilled,
        tick.fulfilledOrderAmountX,
        Rounding.Down,
      )
    : calculateSharedAmounts(
        tick.limitOrderFeeBidSide,
        fulfilled,
        tick.fulfilledOrderAmountY,
        Rounding.Down,
      );
  if (collectFeeMode === CollectFeeMode.OnlyY) {
    return { feeX: new BN(0), feeY: fee };
  }
  return isAsk
    ? { feeX: fee, feeY: new BN(0) }
    : { feeX: new BN(0), feeY: fee };
}
