import type { IdlAccounts, IdlTypes } from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";
import type BN from "bn.js";
import type { AccessRegistry } from "./idl/access-registry/access_registry";
import type { DlmmPro } from "./idl/dlmm-pro/dlmm_pro";

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
export type Oracle = IdlAccounts<DlmmPro>["oracle"];

// The fields tick-array bitmap traversal reads from the pool and its extension.
export type PoolBitmapState = Pick<
  Pool,
  | "tickCurrentId"
  | "tickSpacing"
  | "tickArrayBitmap"
  | "isBitmapExtensionInitialized"
>;
export type BitmapExtensionState = Pick<
  TickArrayBitmapExtension,
  "positiveBitmap" | "negativeBitmap"
>;

// TokenBadge and the operator registry are owned by the external
// access-registry program, not dlmm-pro.
export type TokenBadge = IdlAccounts<AccessRegistry>["tokenBadge"];
export type AccessRegistryOperator = IdlAccounts<AccessRegistry>["operator"];

// embedded state types used inside accounts
export type TickRange = IdlTypes<DlmmPro>["tickRange"];
export type RemainingAccountsInfo = IdlTypes<DlmmPro>["remainingAccountsInfo"];
export type RemainingAccountsSlice =
  IdlTypes<DlmmPro>["remainingAccountsSlice"];
export type OpenPositionParameters =
  IdlTypes<DlmmPro>["openPositionParameters"];
export type AddLiquidityParameters =
  IdlTypes<DlmmPro>["addLiquidityParameters"];
export type AddLiquidityByWeightParameters =
  IdlTypes<DlmmPro>["addLiquidityByWeightParameters"];
export type AddLiquidityImbalanceParameters =
  IdlTypes<DlmmPro>["addLiquidityImbalanceParameters"];
export type AddLiquidityImbalanceSlippage =
  IdlTypes<DlmmPro>["addLiquidityImbalanceSlippage"];
export type SqrtPriceSlippage = IdlTypes<DlmmPro>["sqrtPriceSlippage"];
export type RemoveLiquidityParameters =
  IdlTypes<DlmmPro>["removeLiquidityParameters"];
export type RemoveLiquidityByBpsParameters =
  IdlTypes<DlmmPro>["removeLiquidityByBpsParameters"];
export type RemovePositionParameters =
  IdlTypes<DlmmPro>["removePositionParameters"];
export type SwapParameters = IdlTypes<DlmmPro>["swapParameters"];
export type StaticConfigParameters =
  IdlTypes<DlmmPro>["staticConfigParameters"];
export type DynamicConfigParameters =
  IdlTypes<DlmmPro>["dynamicConfigParameters"];
export type OpenLimitOrderParameters =
  IdlTypes<DlmmPro>["openLimitOrderParameters"];
export type CancelLimitOrderParameters =
  IdlTypes<DlmmPro>["cancelLimitOrderParameters"];
export type ClaimPartnerFeeParameters =
  IdlTypes<DlmmPro>["claimPartnerFeeParameters"];
export type TickLimitOrderAmount = IdlTypes<DlmmPro>["tickLimitOrderAmount"];
export type RelativeTick = IdlTypes<DlmmPro>["relativeTick"];
export type SetRewardEmissionParameters =
  IdlTypes<DlmmPro>["setRewardEmissionParameters"];
export type LockVestingPositionParameters =
  IdlTypes<DlmmPro>["lockVestingPositionParameters"];
export type LockPermanentPositionParameters =
  IdlTypes<DlmmPro>["lockPermanentPositionParameters"];

export type FeeConfig = IdlTypes<DlmmPro>["feeConfig"];
export type BaseFeeConfig = IdlTypes<DlmmPro>["baseFeeConfig"];
export type BaseFeeConfigParameters =
  IdlTypes<DlmmPro>["baseFeeConfigParameters"];
export type DynamicFeeConfig = IdlTypes<DlmmPro>["dynamicFeeConfig"];
export type DynamicFeeParameters = IdlTypes<DlmmPro>["dynamicFeeParameters"];
export type PoolFeeParameters = IdlTypes<DlmmPro>["poolFeeParameters"];
export type PoolActivationInfoParameters =
  IdlTypes<DlmmPro>["poolActivationInfoParameters"];
export type PoolActivationParameters =
  IdlTypes<DlmmPro>["poolActivationParameters"];
export type InitializePoolWithDynamicParameters =
  IdlTypes<DlmmPro>["initializePoolWithDynamicParameters"];
export type VariableFee = IdlTypes<DlmmPro>["variableFee"];
export type PoolPartner = IdlTypes<DlmmPro>["poolPartner"];
export type PositionVesting = IdlTypes<DlmmPro>["positionVesting"];

export type DecodedPoolRewardInfo = {
  mint: PublicKey;
  vault: PublicKey;
  authority: PublicKey;
  emissionPerSecond: BN;
  openTime: BN;
  endTime: BN;
  lastUpdateTime: BN;
  cumulativeSecondsWithEmptyLiquidityReward: BN;
  rewardGrowthGlobal: BN;
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
  feeGrowthCheckpointX: BN;
  feeGrowthCheckpointY: BN;
  feePendingX: BN;
  feePendingY: BN;
  tickLowerId: number;
  tickUpperId: number;
};

export type DecodedPositionRewardInfo = {
  growthInsideCheckpoint: BN;
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
  feeGrowthOutsideX: BN;
  feeGrowthOutsideY: BN;
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
  rewardGrowthsOutside: BN[];
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

export enum PoolType {
  Static = 0,
  Dynamic = 1,
  LaunchPool = 2,
}

export enum PoolStatus {
  Swap = 0,
  AddLiquidity = 1,
}

export enum StrategyType {
  Spot = 0,
  Curve = 1,
  BidAsk = 2,
  Custom = 3,
}

export enum LiquiditySide {
  Bid = 0,
  Ask = 1,
  Active = 2,
}

export enum DynamicConfigPermission {
  CreatePoolWithoutMintValidation = 0,
}

export enum OperatorPermission {
  CreateConfigKey = 0,
  RemoveConfigKey = 1,
  SetPoolStatus = 2,
  InitializeReward = 3,
  UpdateRewardAuthority = 4,
  UpdatePartnerFee = 5,
}

export enum AccessRegistryOperatorPermission {
  CreateTokenBadge = 0,
  CloseTokenBadge = 1,
}

export enum PositionDelegatePermission {
  AddLiquidity = 0,
  RemoveLiquidity = 1,
  RemoveLiquidityToOwner = 2,
  ClaimFee = 3,
  ClaimFeeToOwner = 4,
  ClaimReward = 5,
  ClaimRewardToOwner = 6,
  LockLiquidity = 7,
  UpdatePositionRange = 8,
}

export enum LimitOrderDelegatePermission {
  CancelLimitOrder = 0,
  CancelLimitOrderToOwner = 1,
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
