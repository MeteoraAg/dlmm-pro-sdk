import BN from "bn.js";
import { PoolError } from "../errors";
import { tryCastU64, tryCastU128 } from "../math/safe_math";

export function assertU8(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw PoolError.invalidParameters();
  }
}

export function assertU16(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw PoolError.invalidParameters();
  }
}

export function assertI32(value: number): void {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw PoolError.invalidParameters();
  }
}

export function assertU64(value: BN): void {
  tryCastU64(value);
}

export function assertU128(value: BN): void {
  tryCastU128(value);
}

export function assertOptionalU16(value: number | null): void {
  if (value !== null) {
    assertU16(value);
  }
}
