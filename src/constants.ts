import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import AccessRegistryIDL from "./idl/access-registry/access_registry.json";
import DlmmProIDL from "./idl/dlmm-pro/dlmm_pro.json";
import { NATIVE_MINT } from "@solana/spl-token";

function idlConstant(name: string): string {
  const constant = DlmmProIDL.constants.find((c) => c.name === name);
  if (!constant) {
    throw new Error(`IDL constant not found: ${name}`);
  }
  return constant.value;
}

export const DLMM_PRO_PROGRAM_ID = new PublicKey(DlmmProIDL.address);
export const ACCESS_REGISTRY_PROGRAM_ID = new PublicKey(
  AccessRegistryIDL.address,
);
export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);
export const WHITELISTED_QUOTE_MINTS: readonly PublicKey[] = [
  NATIVE_MINT,
  USDC_MINT,
];

// PDA seed prefixes
export const OPERATOR_PREFIX = "operator";
export const STATIC_CONFIG_PREFIX = "s_config";
export const DYNAMIC_CONFIG_PREFIX = "d_config";
// Seed under ACCESS_REGISTRY_PROGRAM_ID, not the dlmm-pro program
export const TOKEN_BADGE_PREFIX = "token_badge";
export const POOL_PREFIX = "pool";
export const LAUNCH_POOL_PREFIX = "l_pool";
export const POOL_AUTHORITY_PREFIX = "pool_auth";
export const RESERVE_PREFIX = "reserve";
export const TICK_ARRAY_BITMAP_EXTENSION_PREFIX = "bitmap";
export const ORACLE_PREFIX = "oracle";
export const TICK_ARRAY_PREFIX = "tick_array";
export const POSITION_PREFIX = "position";
export const LIMIT_ORDER_PREFIX = "limit_order";
export const REWARD_VAULT_PREFIX = "reward";
export const PROTOCOL_FEE_AUTHORITY_PREFIX = "protocol_fee_authority";
export const PROTOCOL_FEE_PROGRAM_ID = new PublicKey(
  "pFee3tb7qh5z53jRF4PbLwmNd148Q8ypLNZbqsMeinA",
);

/** `OperatorPermission::VARIANT_COUNT` in the program. */
export const OPERATOR_PERMISSION_COUNT = 6;
/** `DynamicConfigPermission::VARIANT_COUNT` in the program. */
export const DYNAMIC_CONFIG_PERMISSION_COUNT = 1;
/** `PoolStatus::VARIANT_COUNT` in the program. */
export const POOL_STATUS_COUNT = 2;
/** access-registry `OperatorPermission::VARIANT_COUNT`. */
export const ACCESS_REGISTRY_OPERATOR_PERMISSION_COUNT = 2;

export const BITMAP_SIZE = Number(idlConstant("BITMAP_SIZE"));
export const MAX_TICKS_PER_ARRAY = Number(
  idlConstant("MAX_TICKS_PER_ARRAY_U64"),
);
export const NUM_REWARDS = Number(idlConstant("NUM_REWARDS_U64"));
/** The only reward slot the pool creator may initialize and re-assign; the rest are operator-managed. */
export const CREATOR_REWARD_INDEX = 0;
export const MAX_TICK_SPACING = Number(idlConstant("MAX_TICK_SPACING"));
export const MAX_BASIS_POINT = Number(idlConstant("MAX_BASIS_POINT"));
export const FEE_DENOMINATOR = new BN(idlConstant("FEE_DENOMINATOR"));
export const HOST_FEE_BPS = Number(idlConstant("HOST_FEE_BPS"));
export const MM_PROTOCOL_FEE_BPS = Number(idlConstant("MM_PROTOCOL_FEE_BPS"));
export const MM_LAUNCH_POOL_PROTOCOL_FEE_BPS = Number(
  idlConstant("MM_LAUNCH_POOL_PROTOCOL_FEE_BPS"),
);
export const LIMIT_ORDER_PROTOCOL_FEE_BPS = Number(
  idlConstant("LIMIT_ORDER_PROTOCOL_FEE_BPS"),
);
export const LIMIT_ORDER_REFERRAL_FEE_BPS = Number(
  idlConstant("LIMIT_ORDER_REFERRAL_FEE_BPS"),
);
export const LIMIT_ORDER_MAX_TICK = Number(
  idlConstant("LIMIT_ORDER_MAX_TICK_U64"),
);
export const MAX_FEE_NUMERATOR = new BN(idlConstant("MAX_FEE_NUMERATOR"));
export const MIN_FEE_NUMERATOR = new BN(idlConstant("MIN_FEE_NUMERATOR"));
export const MAX_PARTNER_FEE_BPS = Number(idlConstant("MAX_PARTNER_FEE_BPS"));
export const MIN_REWARD_DURATION = new BN(idlConstant("MIN_REWARD_DURATION"));
export const MAX_REWARD_DURATION = new BN(idlConstant("MAX_REWARD_DURATION"));
export const MAX_REWARD_START_DELAY = new BN(
  idlConstant("MAX_REWARD_START_DELAY"),
);
export const POSITION_MAX_RANGE = Number(idlConstant("POSITION_MAX_RANGE_U64"));
export const MIN_SQRT_PRICE = new BN(idlConstant("MIN_SQRT_PRICE"));
export const MAX_SQRT_PRICE = new BN(idlConstant("MAX_SQRT_PRICE"));
export const MAX_LIQUIDITY_WEIGHT = 255;

// Not in the IDL; must match programs/dlmm-pro/src/constants.rs
export const NUMBER_OF_ACTIVATION_MODES = 2;
// Not in the IDL; must match PoolExtension::VARIANT_COUNT in programs/dlmm-pro/src/state/pool/mod.rs
export const POOL_EXTENSION_VARIANT_COUNT = 2;
// Not in the IDL; must match programs/dlmm-pro/src/activation/activation_time_based.rs
export const MAX_TIME_BUFFER = 2_592_000; // 30 days in seconds
export const MAX_SLOT_BUFFER = 6_480_000; // MAX_TIME_BUFFER * 1000 / 400
// Not in the IDL; must match programs/dlmm-pro/src/constants.rs
export const MAX_TICK_ID = 443636;
export const MIN_TICK_ID = -443636;
// Not in the IDL; must match programs/dlmm-pro/src/constants.rs
export const MIN_DELTA_TICK_FOR_DYNAMIC_FEE_UPDATE = new BN(4);
// Not in the IDL; must match programs/dlmm-pro/src/constants.rs
export const MAX_VESTING_DURATION = new BN(86400 * 365 * 10);

export enum PoolExtension {
  LiquidityMining = 0,
  ActivationAccess = 1,
}
