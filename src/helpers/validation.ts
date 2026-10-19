import BN from "bn.js";
import { MAX_BASIS_POINT, MAX_TICK_SPACING } from "../constants";
import { PoolError } from "../errors";
import { I32_MAX, I32_MIN, U64_MAX, U128_MAX } from "../math/safe_math";

export function assertTickSpacing(tickSpacing: number): void {
  if (
    !Number.isInteger(tickSpacing) ||
    tickSpacing <= 0 ||
    tickSpacing > MAX_TICK_SPACING
  ) {
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

export function assertU8(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw PoolError.invalidParameters(`${name} must be a u8`);
  }
}

export function assertU16(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw PoolError.invalidParameters(`${name} must be a u16`);
  }
}

export function assertI32(value: number, name: string): void {
  if (!Number.isInteger(value) || value < I32_MIN || value > I32_MAX) {
    throw PoolError.invalidParameters(`${name} must be an i32`);
  }
}

export function assertU64(value: BN, name: string): void {
  if (value.isNeg() || value.gt(U64_MAX)) {
    throw PoolError.invalidParameters(`${name} must be a u64`);
  }
}

export function assertU128(value: BN, name: string): void {
  if (value.isNeg() || value.gt(U128_MAX)) {
    throw PoolError.invalidParameters(`${name} must be a u128`);
  }
}

export function assertOptionalU16(value: number | null, name: string): void {
  if (value !== null) {
    assertU16(value, name);
  }
}

export function assertBps(bps: number, name: string): void {
  if (!Number.isInteger(bps) || bps < 1 || bps > MAX_BASIS_POINT) {
    throw PoolError.invalidParameters(`${name} must be in 1..=MAX_BASIS_POINT`);
  }
}
