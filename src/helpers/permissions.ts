import {
  LimitOrderDelegatePermission,
  PositionDelegatePermission,
} from "../types";
import { PoolError } from "../errors";

const POSITION_DELEGATE_PERMISSION_COUNT =
  PositionDelegatePermission.UpdatePositionRange + 1;
const LIMIT_ORDER_DELEGATE_PERMISSION_COUNT =
  LimitOrderDelegatePermission.CancelLimitOrder + 1;

/** The program's `bitmask_max` for position delegate permissions. */
export const MAX_POSITION_DELEGATE_PERMISSION =
  (1 << POSITION_DELEGATE_PERMISSION_COUNT) - 1;
/** The program's `bitmask_max` for limit-order delegate permissions. */
export const MAX_LIMIT_ORDER_DELEGATE_PERMISSION =
  (1 << LIMIT_ORDER_DELEGATE_PERMISSION_COUNT) - 1;

/** Bitmask of program permission variants. Duplicate flags are ignored. */
export function permissionBitmask(
  flags: readonly number[],
  variantCount: number,
): number {
  let mask = 0;
  for (const flag of flags) {
    if (!Number.isInteger(flag) || flag < 0 || flag >= variantCount) {
      throw PoolError.invalidPermission();
    }
    mask |= 1 << flag;
  }
  return mask;
}

/** `u32` bitmask for `updatePositionDelegatePermission`. */
export function positionDelegatePermissionMask(
  permissions: readonly PositionDelegatePermission[],
): number {
  return permissionBitmask(permissions, POSITION_DELEGATE_PERMISSION_COUNT);
}

/** `u32` bitmask for `updateLimitOrderDelegatePermission`. */
export function limitOrderDelegatePermissionMask(
  permissions: readonly LimitOrderDelegatePermission[],
): number {
  return permissionBitmask(permissions, LIMIT_ORDER_DELEGATE_PERMISSION_COUNT);
}
