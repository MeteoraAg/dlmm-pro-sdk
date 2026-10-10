import BN from "bn.js";
import {
  LimitOrderDelegatePermission,
  PositionDelegatePermission,
} from "../types";
import { PoolError } from "../errors";

const POSITION_DELEGATE_PERMISSION_COUNT =
  PositionDelegatePermission.UpdatePositionRange + 1;
const LIMIT_ORDER_DELEGATE_PERMISSION_COUNT =
  LimitOrderDelegatePermission.CancelLimitOrder + 1;

/** `u128` bitmask of program permission variants. Duplicate flags are ignored. */
export function permissionBitmask(
  flags: readonly number[],
  variantCount: number,
): BN {
  let mask = new BN(0);
  for (const flag of flags) {
    if (!Number.isInteger(flag) || flag < 0 || flag >= variantCount) {
      throw PoolError.invalidPermission();
    }
    mask = mask.or(new BN(1).shln(flag));
  }
  return mask;
}

/** `(1 << variantCount) - 1`, the program's `bitmask_max`. */
export function bitmaskMax(variantCount: number): BN {
  if (
    !Number.isInteger(variantCount) ||
    variantCount < 0 ||
    variantCount > 128
  ) {
    throw PoolError.invalidParameters();
  }
  if (variantCount === 128) {
    return new BN(1).shln(128).subn(1);
  }
  return new BN(1).shln(variantCount).subn(1);
}

function delegateMask(flags: readonly number[], variantCount: number): number {
  for (const flag of flags) {
    if (!Number.isInteger(flag) || flag < 0 || flag >= variantCount) {
      throw PoolError.invalidPermission();
    }
  }
  return flags.reduce((mask, flag) => mask | (1 << flag), 0);
}

/** `u32` bitmask for `updatePositionDelegatePermission`. */
export function positionDelegatePermissionMask(
  permissions: readonly PositionDelegatePermission[],
): number {
  return delegateMask(permissions, POSITION_DELEGATE_PERMISSION_COUNT);
}

/** `u32` bitmask for `updateLimitOrderDelegatePermission`. */
export function limitOrderDelegatePermissionMask(
  permissions: readonly LimitOrderDelegatePermission[],
): number {
  return delegateMask(permissions, LIMIT_ORDER_DELEGATE_PERMISSION_COUNT);
}
