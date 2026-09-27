import BN from "bn.js";
import type {
  LimitOrderDelegatePermission,
  PositionDelegatePermission,
} from "../types";
import { PositionDelegatePermission as PositionPermission } from "../types";
import { PoolError } from "../errors";

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

/** `u32` bitmask for the position and limit-order delegate instructions. */
export function delegatePermissionMask(
  permissions: readonly (
    PositionDelegatePermission | LimitOrderDelegatePermission
  )[],
): number {
  for (const flag of permissions) {
    if (
      !Number.isInteger(flag) ||
      flag < 0 ||
      flag > PositionPermission.UpdatePositionRange
    ) {
      throw PoolError.invalidPermission();
    }
  }
  return permissions.reduce((mask, flag) => mask | (1 << flag), 0);
}
