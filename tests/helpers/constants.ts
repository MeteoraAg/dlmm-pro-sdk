import { Q64 } from "../../src";

export const SQRT_PRICE_ONE = Q64;
export const TOKEN_DECIMALS = 6;
export const MINT_AMOUNT = 10n ** 12n;

export const DEFAULT_TICK_RANGES = [{ tickLowerId: -128, tickUpperId: 128 }];

/** `OperatorPermission::VARIANT_COUNT` in the program. */
export const OPERATOR_PERMISSION_COUNT = 6;
/** `PoolStatus::VARIANT_COUNT` in the program. */
export const POOL_STATUS_COUNT = 2;
/** access-registry `OperatorPermission::VARIANT_COUNT`. */
export const ACCESS_REGISTRY_OPERATOR_PERMISSION_COUNT = 2;
