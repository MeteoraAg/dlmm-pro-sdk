import BN from "bn.js";
import { MAX_BASIS_POINT, MAX_TICK_SPACING } from "../constants";
import { PoolError } from "../errors";
import {
  I32_MAX,
  I32_MIN,
  isUnsigned,
  U64_MAX,
  U128_MAX,
} from "../math/safe_math";

export function isIntegerIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function assertTickSpacing(tickSpacing: number): void {
  if (!isIntegerIn(tickSpacing, 1, MAX_TICK_SPACING)) {
    throw PoolError.invalidParameters(
      "tickSpacing must be an integer in 1..=MAX_TICK_SPACING",
    );
  }
}

export function assertZeroPadding(padding: number[]): void {
  if (padding.some((byte) => byte !== 0)) {
    throw PoolError.invalidParameters("padding must be zero");
  }
}

export function assertU16(value: number, name: string): void {
  if (!isIntegerIn(value, 0, 0xffff)) {
    throw PoolError.invalidParameters(`${name} must be a u16`);
  }
}

export function assertNonZeroU16(value: number, name: string): void {
  if (!isIntegerIn(value, 1, 0xffff)) {
    throw PoolError.invalidParameters(`${name} must be a non-zero u16`);
  }
}

export function assertU24(value: number, name: string): void {
  if (!isIntegerIn(value, 0, 0xffffff)) {
    throw PoolError.invalidParameters(`${name} must be a u24`);
  }
}

export function assertI32(value: number, name: string): void {
  if (!isIntegerIn(value, I32_MIN, I32_MAX)) {
    throw PoolError.invalidParameters(`${name} must be an i32`);
  }
}

export function assertU64(value: BN, name: string): void {
  if (!isUnsigned(value, U64_MAX)) {
    throw PoolError.invalidParameters(`${name} must be a u64`);
  }
}

export function assertU128(value: BN, name: string): void {
  if (!isUnsigned(value, U128_MAX)) {
    throw PoolError.invalidParameters(`${name} must be a u128`);
  }
}

export function assertOptionalU16(value: number | null, name: string): void {
  if (value !== null) {
    assertU16(value, name);
  }
}

export function assertBps(bps: number, name: string): void {
  if (!isIntegerIn(bps, 1, MAX_BASIS_POINT)) {
    throw PoolError.invalidParameters(`${name} must be in 1..=MAX_BASIS_POINT`);
  }
}
