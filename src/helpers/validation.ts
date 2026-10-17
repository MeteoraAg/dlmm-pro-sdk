import BN from "bn.js";
import { PoolError } from "../errors";
import { I32_MAX, I32_MIN, U64_MAX, U128_MAX } from "../math/safe_math";

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
  if (!Number.isInteger(value) || value < I32_MIN || value > I32_MAX) {
    throw PoolError.invalidParameters();
  }
}

export function assertU64(value: BN): void {
  if (value.isNeg() || value.gt(U64_MAX)) {
    throw PoolError.invalidParameters();
  }
}

export function assertU128(value: BN): void {
  if (value.isNeg() || value.gt(U128_MAX)) {
    throw PoolError.invalidParameters();
  }
}

export function assertOptionalU16(value: number | null): void {
  if (value !== null) {
    assertU16(value);
  }
}
