import type { IdlAccounts, IdlTypes } from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";
import type BN from "bn.js";
import type { DlmmPro } from "./idl/dlmm_pro";

// onchain account states
export type Pool = IdlAccounts<DlmmPro>["pool"];
export type StaticConfig = IdlAccounts<DlmmPro>["staticConfig"];
export type DynamicConfig = IdlAccounts<DlmmPro>["dynamicConfig"];
export type PositionArray = IdlAccounts<DlmmPro>["positionArray"];
export type LimitOrder = IdlAccounts<DlmmPro>["limitOrder"];
export type TickArray = IdlAccounts<DlmmPro>["tickArray"];
export type TickArrayBitmapExtension =
  IdlAccounts<DlmmPro>["tickArrayBitmapExtension"];
export type Operator = IdlAccounts<DlmmPro>["operator"];
export type TokenBadge = IdlAccounts<DlmmPro>["tokenBadge"];
export type Oracle = IdlAccounts<DlmmPro>["oracle"];

// embedded state types used inside accounts
export type FeeConfig = IdlTypes<DlmmPro>["feeConfig"];
export type BaseFeeConfig = IdlTypes<DlmmPro>["baseFeeConfig"];
export type DynamicFeeConfig = IdlTypes<DlmmPro>["dynamicFeeConfig"];
export type VariableFee = IdlTypes<DlmmPro>["variableFee"];
export type PoolPartner = IdlTypes<DlmmPro>["poolPartner"];
export type PositionVesting = IdlTypes<DlmmPro>["positionVesting"];
export type Z192 = IdlTypes<DlmmPro>["z192"];

export type DecodedPoolRewardInfo = {
  mint: PublicKey;
  vault: PublicKey;
  authority: PublicKey;
  emissionPerSecond: BN;
  openTime: BN;
  endTime: BN;
  lastUpdateTime: BN;
  cumulativeSecondsWithEmptyLiquidityReward: BN;
  rewardGrowthGlobal: Z192;
  rewardTokenFlag: number;
};

export type DecodedPoolActivationInfo = {
  activationMode: number;
  data: number[];
};

export type DecodedPoolActivation = {
  whitelistedSwap: PublicKey;
  whitelistedAddLiquidity: PublicKey;
  whitelistedRemoveLiquidity: PublicKey;
  activations: DecodedPoolActivationInfo[];
};

export type DecodedPoolExtensions = {
  extensions: number;
  hasLiquidityMining: boolean;
  hasActivationAccess: boolean;
  rewards?: DecodedPoolRewardInfo[];
  activation?: DecodedPoolActivation;
};

export type DecodedPosition = {
  unlockedLiquidity: BN;
  permanentLockedLiquidity: BN;
  vestingLiquidity: BN;
  releasedVestingLiquidity: BN;
  feeGrowthCheckpointX: Z192;
  feeGrowthCheckpointY: Z192;
  feePendingX: BN;
  feePendingY: BN;
  tickLowerId: number;
  tickUpperId: number;
};

export type DecodedPositionRewardInfo = {
  growthInsideCheckpoint: Z192;
  pendingAmount: BN;
};

export type DecodedPositionWithReward = DecodedPosition & {
  rewards: DecodedPositionRewardInfo[];
};

export type DecodePositionsOpts = {
  withReward?: boolean;
};

export type DecodedTick = {
  sqrtPrice: BN;
  liquidityNet: BN;
  liquidityGross: BN;
  feeGrowthOutsideX: Z192;
  feeGrowthOutsideY: Z192;
  refCount: BN;
  tickId: number;
  limitOrderAskSide: number;
  openOrderAmount: BN;
  totalProcessingOrderAmount: BN;
  processedOrderRemainingAmount: BN;
  orderAge: BN;
  fulfilledOrderAmountX: BN;
  fulfilledOrderAmountY: BN;
  limitOrderFeeAskSide: BN;
  limitOrderFeeBidSide: BN;
};

export type DecodedTickWithReward = DecodedTick & {
  rewardGrowthsOutside: Z192[];
};

export type DecodeTicksOpts = {
  withReward: boolean;
};

export type DecodedLimitOrderData = {
  amount: BN;
  age: BN;
  tickId: number;
  isAsk: number;
};

export type DecodedObservation = {
  lastUpdatedTimestamp: BN;
  tickCumulative: BN;
};

export enum Rounding {
  Up,
  Down,
}

export enum TokenProgramFlags {
  TokenProgram = 0,
  TokenProgram2022 = 1,
}

export enum CollectFeeMode {
  OutputToken = 0,
  OnlyY = 1,
}

export enum BaseFeeMode {
  Fixed = 0,
  TimeSchedulerLinear = 1,
  TimeSchedulerExponential = 2,
  MarketCapSchedulerLinear = 3,
  MarketCapSchedulerExponential = 4,
}

export enum ActivationType {
  Slot = 0,
  Timestamp = 1,
}

export enum ActivationMode {
  Open = 0,
  BondingCurve = 1,
  TimeBased = 2,
}

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
