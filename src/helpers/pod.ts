import BN from "bn.js";
import { PoolError } from "../errors";
import { isUnsigned, U16_MAX, U32_MAX, U64_MAX } from "../math/safe_math";

function encodePodUint(
  value: BN | number,
  name: string,
  byteLength: number,
  max: BN,
): Buffer {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw PoolError.invalidParameters(`${name} must be a safe integer`);
  }
  const bn = BN.isBN(value) ? value : new BN(value);
  if (!isUnsigned(bn, max)) {
    throw PoolError.invalidParameters(`${name} must be a u${byteLength * 8}`);
  }
  return bn.toArrayLike(Buffer, "le", byteLength);
}

export function encodePodU64(value: BN | number, name: string): Buffer {
  return encodePodUint(value, name, 8, U64_MAX);
}

export function encodePodU32(value: BN | number, name: string): Buffer {
  return encodePodUint(value, name, 4, U32_MAX);
}

export function encodePodU16(value: BN | number, name: string): Buffer {
  return encodePodUint(value, name, 2, U16_MAX);
}

export function toPodBuffer(data: number[], length: number): Buffer {
  if (data.length !== length) {
    throw PoolError.invalidParameters(`data must have ${length} bytes`);
  }
  return Buffer.from(data);
}
