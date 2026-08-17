import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import DlmmProIDL from "./idl/dlmm_pro.json";

function idlConstant(name: string): string {
  const constant = DlmmProIDL.constants.find((c) => c.name === name);
  if (!constant) {
    throw new Error(`IDL constant not found: ${name}`);
  }
  return constant.value;
}

export const DLMM_PRO_PROGRAM_ID = new PublicKey(DlmmProIDL.address);

// PDA seed prefixes
export const OPERATOR_PREFIX = "operator";
export const STATIC_CONFIG_PREFIX = "s_config";
export const DYNAMIC_CONFIG_PREFIX = "d_config";
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

export const BITMAP_SIZE = Number(idlConstant("BITMAP_SIZE"));
export const MAX_TICKS_PER_ARRAY = Number(
  idlConstant("MAX_TICKS_PER_ARRAY_U64"),
);
export const NUM_REWARDS = Number(idlConstant("NUM_REWARDS_U64"));
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
export const POSITION_MAX_RANGE = Number(idlConstant("POSITION_MAX_RANGE_U64"));

export const NUMBER_OF_ACTIVATION_MODES = 2;
export const MAX_TICK_ID = 443636;
export const MIN_TICK_ID = -443636;
export const MIN_SQRT_PRICE = new BN("4295048016");
export const MAX_SQRT_PRICE = new BN("79226673515401279992447579055");
export const MIN_DELTA_TICK_FOR_DYNAMIC_FEE_UPDATE = new BN(4);

export enum PoolExtension {
  LiquidityMining = 0,
  ActivationAccess = 1,
}
