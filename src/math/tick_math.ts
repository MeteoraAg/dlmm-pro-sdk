import BN from "bn.js";
import { MAX_SQRT_PRICE, MIN_SQRT_PRICE } from "../constants";
import { PoolError } from "../errors";
import {
  safeMul,
  toBigInt,
  tryCastI32,
  U128_MAX,
  U128_MAX_BIGINT,
} from "./safe_math";

const LOG_B_2_X32 = 59543866431248n;
const BIT_PRECISION = 14;
const LOG_B_P_ERR_MARGIN_LOWER_X64 = 184467440737095516n;
const LOG_B_P_ERR_MARGIN_UPPER_X64 = 15793534762490258745n;

// find T to satisfy: getSqrtPriceFromTickId(T) ≤ p < getSqrtPriceFromTickId(T+1)
export function tickIdFromSqrtPrice(sqrtPrice: BN): number {
  if (sqrtPrice.lt(MIN_SQRT_PRICE) || sqrtPrice.gt(MAX_SQRT_PRICE)) {
    throw PoolError.invalidParameters();
  }

  const sqrtPriceU128 = toBigInt(sqrtPrice);
  const msb = sqrtPrice.bitLength() - 1;
  const log2pIntegerX32 = (BigInt(msb) - 64n) << 32n;

  let bit = 0x8000_0000_0000_0000n;
  let precision = 0;
  let log2pFractionX64 = 0n;

  let r =
    msb >= 64
      ? sqrtPriceU128 >> BigInt(msb - 63)
      : (sqrtPriceU128 << BigInt(63 - msb)) & U128_MAX_BIGINT;

  while (bit > 0n && precision < BIT_PRECISION) {
    r = (r * r) & U128_MAX_BIGINT;
    const isRMoreThanTwo = Number(r >> 127n);
    r >>= BigInt(63 + isRMoreThanTwo);
    log2pFractionX64 += bit * BigInt(isRMoreThanTwo);
    bit >>= 1n;
    precision += 1;
  }

  const log2pFractionX32 = log2pFractionX64 >> 32n;
  const log2pX32 = log2pIntegerX32 + log2pFractionX32;
  const logbpX64 = log2pX32 * LOG_B_2_X32;

  const tickLow = tryCastI32((logbpX64 - LOG_B_P_ERR_MARGIN_LOWER_X64) >> 64n);
  const tickHigh = tryCastI32((logbpX64 + LOG_B_P_ERR_MARGIN_UPPER_X64) >> 64n);

  if (tickLow === tickHigh) {
    return tickLow;
  }

  const actualHighPrice = getSqrtPriceFromTickId(tickHigh);
  if (actualHighPrice.lte(sqrtPrice)) {
    return tickHigh;
  }
  return tickLow;
}

export function getSqrtPriceFromTickId(tickId: number): BN {
  if (tickId >= 0) {
    return getSqrtPricePositiveTick(tickId);
  }
  return getSqrtPriceNegativeTick(tickId);
}

function getSqrtPricePositiveTick(tick: number): BN {
  let ratio =
    tick & 1
      ? new BN("79232123823359799118286999567")
      : new BN("79228162514264337593543950336");

  if (tick & 0x2) {
    ratio = mulShift96(ratio, new BN("79236085330515764027303304731"));
  }
  if (tick < 0x4) {
    return ratio.shrn(32);
  }
  if (tick & 0x4) {
    ratio = mulShift96(ratio, new BN("79244008939048815603706035061"));
  }
  if (tick < 0x8) {
    return ratio.shrn(32);
  }
  if (tick & 0x8) {
    ratio = mulShift96(ratio, new BN("79259858533276714757314932305"));
  }
  if (tick < 0x10) {
    return ratio.shrn(32);
  }
  if (tick & 0x10) {
    ratio = mulShift96(ratio, new BN("79291567232598584799939703904"));
  }
  if (tick < 0x20) {
    return ratio.shrn(32);
  }
  if (tick & 0x20) {
    ratio = mulShift96(ratio, new BN("79355022692464371645785046466"));
  }
  if (tick < 0x40) {
    return ratio.shrn(32);
  }
  if (tick & 0x40) {
    ratio = mulShift96(ratio, new BN("79482085999252804386437311141"));
  }
  if (tick < 0x80) {
    return ratio.shrn(32);
  }
  if (tick & 0x80) {
    ratio = mulShift96(ratio, new BN("79736823300114093921829183326"));
  }
  if (tick < 0x100) {
    return ratio.shrn(32);
  }
  if (tick & 0x100) {
    ratio = mulShift96(ratio, new BN("80248749790819932309965073892"));
  }
  if (tick < 0x200) {
    return ratio.shrn(32);
  }
  if (tick & 0x200) {
    ratio = mulShift96(ratio, new BN("81282483887344747381513967011"));
  }
  if (tick < 0x400) {
    return ratio.shrn(32);
  }
  if (tick & 0x400) {
    ratio = mulShift96(ratio, new BN("83390072131320151908154831281"));
  }
  if (tick < 0x800) {
    return ratio.shrn(32);
  }
  if (tick & 0x800) {
    ratio = mulShift96(ratio, new BN("87770609709833776024991924138"));
  }
  if (tick < 0x1000) {
    return ratio.shrn(32);
  }
  if (tick & 0x1000) {
    ratio = mulShift96(ratio, new BN("97234110755111693312479820773"));
  }
  if (tick < 0x2000) {
    return ratio.shrn(32);
  }
  if (tick & 0x2000) {
    ratio = mulShift96(ratio, new BN("119332217159966728226237229890"));
  }
  if (tick < 0x4000) {
    return ratio.shrn(32);
  }
  if (tick & 0x4000) {
    ratio = mulShift96(ratio, new BN("179736315981702064433883588727"));
  }
  if (tick < 0x8000) {
    return ratio.shrn(32);
  }
  if (tick & 0x8000) {
    ratio = mulShift96(ratio, new BN("407748233172238350107850275304"));
  }
  if (tick < 0x10000) {
    return ratio.shrn(32);
  }
  if (tick & 0x10000) {
    ratio = mulShift96(ratio, new BN("2098478828474011932436660412517"));
  }
  if (tick < 0x20000) {
    return ratio.shrn(32);
  }
  if (tick & 0x20000) {
    ratio = mulShift96(ratio, new BN("55581415166113811149459800483533"));
  }
  if (tick < 0x40000) {
    return ratio.shrn(32);
  }
  if (tick & 0x40000) {
    ratio = mulShift96(ratio, new BN("38992368544603139932233054999993551"));
  }

  return ratio.shrn(32);
}

function getSqrtPriceNegativeTick(tick: number): BN {
  const absTick = Math.abs(tick);

  let ratio =
    absTick & 1
      ? new BN("18445821805675392311")
      : new BN("18446744073709551616");

  if (absTick & 0x2) {
    ratio = safeMul(ratio, new BN("18444899583751176498"), U128_MAX).shrn(64);
  }
  if (absTick < 0x4) {
    return ratio;
  }
  if (absTick & 0x4) {
    ratio = safeMul(ratio, new BN("18443055278223354162"), U128_MAX).shrn(64);
  }
  if (absTick < 0x8) {
    return ratio;
  }
  if (absTick & 0x8) {
    ratio = safeMul(ratio, new BN("18439367220385604838"), U128_MAX).shrn(64);
  }
  if (absTick < 0x10) {
    return ratio;
  }
  if (absTick & 0x10) {
    ratio = safeMul(ratio, new BN("18431993317065449817"), U128_MAX).shrn(64);
  }
  if (absTick < 0x20) {
    return ratio;
  }
  if (absTick & 0x20) {
    ratio = safeMul(ratio, new BN("18417254355718160513"), U128_MAX).shrn(64);
  }
  if (absTick < 0x40) {
    return ratio;
  }
  if (absTick & 0x40) {
    ratio = safeMul(ratio, new BN("18387811781193591352"), U128_MAX).shrn(64);
  }
  if (absTick < 0x80) {
    return ratio;
  }
  if (absTick & 0x80) {
    ratio = safeMul(ratio, new BN("18329067761203520168"), U128_MAX).shrn(64);
  }
  if (absTick < 0x100) {
    return ratio;
  }
  if (absTick & 0x100) {
    ratio = safeMul(ratio, new BN("18212142134806087854"), U128_MAX).shrn(64);
  }
  if (absTick < 0x200) {
    return ratio;
  }
  if (absTick & 0x200) {
    ratio = safeMul(ratio, new BN("17980523815641551639"), U128_MAX).shrn(64);
  }
  if (absTick < 0x400) {
    return ratio;
  }
  if (absTick & 0x400) {
    ratio = safeMul(ratio, new BN("17526086738831147013"), U128_MAX).shrn(64);
  }
  if (absTick < 0x800) {
    return ratio;
  }
  if (absTick & 0x800) {
    ratio = safeMul(ratio, new BN("16651378430235024244"), U128_MAX).shrn(64);
  }
  if (absTick < 0x1000) {
    return ratio;
  }
  if (absTick & 0x1000) {
    ratio = safeMul(ratio, new BN("15030750278693429944"), U128_MAX).shrn(64);
  }
  if (absTick < 0x2000) {
    return ratio;
  }
  if (absTick & 0x2000) {
    ratio = safeMul(ratio, new BN("12247334978882834399"), U128_MAX).shrn(64);
  }
  if (absTick < 0x4000) {
    return ratio;
  }
  if (absTick & 0x4000) {
    ratio = safeMul(ratio, new BN("8131365268884726200"), U128_MAX).shrn(64);
  }
  if (absTick < 0x8000) {
    return ratio;
  }
  if (absTick & 0x8000) {
    ratio = safeMul(ratio, new BN("3584323654723342297"), U128_MAX).shrn(64);
  }
  if (absTick < 0x10000) {
    return ratio;
  }
  if (absTick & 0x10000) {
    ratio = safeMul(ratio, new BN("696457651847595233"), U128_MAX).shrn(64);
  }
  if (absTick < 0x20000) {
    return ratio;
  }
  if (absTick & 0x20000) {
    ratio = safeMul(ratio, new BN("26294789957452057"), U128_MAX).shrn(64);
  }
  if (absTick < 0x40000) {
    return ratio;
  }
  if (absTick & 0x40000) {
    ratio = safeMul(ratio, new BN("37481735321082"), U128_MAX).shrn(64);
  }

  return ratio;
}

// The program's u128 limb version wraps, but never for ticks in
// 0..=MAX_TICK_ID, so the exact product gives the same result there.
function mulShift96(n0: BN, n1: BN): BN {
  return n0.mul(n1).shrn(96);
}
