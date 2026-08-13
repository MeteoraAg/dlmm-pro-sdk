import {
  array,
  i32,
  i64,
  i128,
  publicKey,
  struct,
  u8,
  u64,
  u128,
  type Layout,
} from "@coral-xyz/borsh";
import { NUM_REWARDS, NUMBER_OF_ACTIVATION_MODES } from "../constants";

const bytes = (length: number, property?: string) =>
  array(u8(), length, property);

const z192 = (property?: string) => struct([bytes(24, "inner")], property);

export const POOL_REWARD_INFO_LAYOUT = struct([
  publicKey("mint"),
  publicKey("vault"),
  publicKey("authority"),
  u128("emissionPerSecond"),
  u64("openTime"),
  u64("endTime"),
  u64("lastUpdateTime"),
  u64("cumulativeSecondsWithEmptyLiquidityReward"),
  z192("rewardGrowthGlobal"),
  u8("rewardTokenFlag"),
  bytes(7),
]);

export const POOL_REWARD_LAYOUT = struct([
  array(POOL_REWARD_INFO_LAYOUT, NUM_REWARDS, "rewards"),
]);

export const POOL_ACTIVATION_INFO_LAYOUT = struct([
  u8("activationMode"),
  bytes(15, "data"),
]);

export const POOL_ACTIVATION_LAYOUT = struct([
  publicKey("whitelistedSwap"),
  publicKey("whitelistedAddLiquidity"),
  publicKey("whitelistedRemoveLiquidity"),
  array(POOL_ACTIVATION_INFO_LAYOUT, NUMBER_OF_ACTIVATION_MODES, "activations"),
]);

const POSITION_FIELDS: Layout<unknown>[] = [
  u128("unlockedLiquidity"),
  u128("permanentLockedLiquidity"),
  u128("vestingLiquidity"),
  u128("releasedVestingLiquidity"),
  z192("feeGrowthCheckpointX"),
  z192("feeGrowthCheckpointY"),
  u64("feePendingX"),
  u64("feePendingY"),
  i32("tickLowerId"),
  i32("tickUpperId"),
  bytes(8),
];

export const POSITION_LAYOUT = struct(POSITION_FIELDS);

export const POSITION_REWARD_INFO_LAYOUT = struct([
  z192("growthInsideCheckpoint"),
  u64("pendingAmount"),
]);

export const POSITION_WITH_REWARD_LAYOUT = struct([
  ...POSITION_FIELDS,
  array(POSITION_REWARD_INFO_LAYOUT, NUM_REWARDS, "rewards"),
]);

const TICK_FIELDS: Layout<unknown>[] = [
  u128("sqrtPrice"),
  i128("liquidityNet"),
  u128("liquidityGross"),
  z192("feeGrowthOutsideX"),
  z192("feeGrowthOutsideY"),
  u64("refCount"),
  i32("tickId"),
  bytes(3),
  u8("limitOrderAskSide"),
  u64("openOrderAmount"),
  u64("totalProcessingOrderAmount"),
  u64("processedOrderRemainingAmount"),
  u64("orderAge"),
  u64("fulfilledOrderAmountX"),
  u64("fulfilledOrderAmountY"),
  u64("limitOrderFeeAskSide"),
  u64("limitOrderFeeBidSide"),
];

export const TICK_LAYOUT = struct(TICK_FIELDS);

export const TICK_WITH_REWARD_LAYOUT = struct([
  ...TICK_FIELDS,
  array(z192(), NUM_REWARDS, "rewardGrowthsOutside"),
]);

export const LIMIT_ORDER_DATA_LAYOUT = struct([
  u64("amount"),
  u64("age"),
  i32("tickId"),
  u8("isAsk"),
  bytes(3),
]);

export const OBSERVATION_LAYOUT = struct([
  u64("lastUpdatedTimestamp"),
  i64("tickCumulative"),
]);
