import { BN } from "@coral-xyz/anchor";

export const SQRT_PRICE_ONE = new BN("18446744073709551616"); // 1 << 64
export const TOKEN_DECIMALS = 6;
export const MINT_AMOUNT = 10n ** 12n;
export const U64_MAX = new BN("18446744073709551615");

export const DEFAULT_TICK_SPACING = 1;
export const DEFAULT_TICK_RANGES = [{ tickLowerId: -128, tickUpperId: 128 }];

/** `OperatorPermission::VARIANT_COUNT` in the program. */
export const OPERATOR_PERMISSION_COUNT = 6;
/** `DynamicConfigPermission::VARIANT_COUNT` in the program. */
export const DYNAMIC_CONFIG_PERMISSION_COUNT = 1;
/** `PoolStatus::VARIANT_COUNT` in the program. */
export const POOL_STATUS_COUNT = 2;
/** access-registry `OperatorPermission::VARIANT_COUNT`. */
export const ACCESS_REGISTRY_OPERATOR_PERMISSION_COUNT = 2;
