use crate::*;
use anchor_lang::prelude::*;
const LOG_B_2_X32: i128 = 59543866431248;
const BIT_PRECISION: u32 = 14;
const LOG_B_P_ERR_MARGIN_LOWER_X64: i128 = 184467440737095516;
const LOG_B_P_ERR_MARGIN_UPPER_X64: i128 = 15793534762490258745;

// find T to satisfy: get_sqrt_price_from_tick_id(T) ≤ p < get_sqrt_price_from_tick_id(T+1)
pub fn tick_id_from_sqrt_price(sqrt_price: u128) -> Result<i32> {
    require!(
        (MIN_SQRT_PRICE..=MAX_SQRT_PRICE).contains(&sqrt_price),
        PoolError::InvalidParameters
    );

    let msb: u32 = 128 - sqrt_price.leading_zeros() - 1;
    let log2p_integer_x32 = (msb as i128 - 64) << 32;

    let mut bit: i128 = 0x8000_0000_0000_0000;
    let mut precision = 0u32;
    let mut log2p_fraction_x64: i128 = 0;

    let mut r = if msb >= 64 {
        sqrt_price >> (msb - 63)
    } else {
        sqrt_price << (63 - msb)
    };

    while bit > 0 && precision < BIT_PRECISION {
        r = r.wrapping_mul(r); // safe: r < 2^64 after normalize → r² < 2^128
        let is_r_more_than_two = (r >> 127) as u32; // 0 or 1
        r >>= 63 + is_r_more_than_two;
        log2p_fraction_x64 += bit * (is_r_more_than_two as i128);
        bit >>= 1;
        precision += 1;
    }

    let log2p_fraction_x32 = log2p_fraction_x64 >> 32;
    let log2p_x32 = log2p_integer_x32 + log2p_fraction_x32;
    let logbp_x64 = log2p_x32 * LOG_B_2_X32;

    let tick_low = i32::try_from((logbp_x64 - LOG_B_P_ERR_MARGIN_LOWER_X64) >> 64)
        .map_err(|_| PoolError::TypeCastFailed)?;
    let tick_high = i32::try_from((logbp_x64 + LOG_B_P_ERR_MARGIN_UPPER_X64) >> 64)
        .map_err(|_| PoolError::TypeCastFailed)?;

    Ok(if tick_low == tick_high {
        tick_low
    } else {
        let actual_high_price = get_sqrt_price_from_tick_id(tick_high);
        if actual_high_price <= sqrt_price {
            tick_high
        } else {
            tick_low
        }
    })
}

pub fn get_sqrt_price_from_tick_id(tick_id: i32) -> u128 {
    if tick_id >= 0 {
        get_sqrt_price_positive_tick(tick_id)
    } else {
        get_sqrt_price_negative_tick(tick_id)
    }
}

// Performs the exponential conversion with Q64.64 precision
fn get_sqrt_price_positive_tick(tick: i32) -> u128 {
    let mut ratio: u128 = if tick & 1 != 0 {
        79232123823359799118286999567
    } else {
        79228162514264337593543950336
    };

    if tick & 0x2 != 0 {
        ratio = mul_shift_96(ratio, 79236085330515764027303304731);
    }
    if tick < 0x4 {
        return ratio >> 32;
    }
    if tick & 0x4 != 0 {
        ratio = mul_shift_96(ratio, 79244008939048815603706035061);
    }
    if tick < 0x8 {
        return ratio >> 32;
    }
    if tick & 0x8 != 0 {
        ratio = mul_shift_96(ratio, 79259858533276714757314932305);
    }
    if tick < 0x10 {
        return ratio >> 32;
    }
    if tick & 0x10 != 0 {
        ratio = mul_shift_96(ratio, 79291567232598584799939703904);
    }
    if tick < 0x20 {
        return ratio >> 32;
    }
    if tick & 0x20 != 0 {
        ratio = mul_shift_96(ratio, 79355022692464371645785046466);
    }
    if tick < 0x40 {
        return ratio >> 32;
    }
    if tick & 0x40 != 0 {
        ratio = mul_shift_96(ratio, 79482085999252804386437311141);
    }
    if tick < 0x80 {
        return ratio >> 32;
    }
    if tick & 0x80 != 0 {
        ratio = mul_shift_96(ratio, 79736823300114093921829183326);
    }
    if tick < 0x100 {
        return ratio >> 32;
    }
    if tick & 0x100 != 0 {
        ratio = mul_shift_96(ratio, 80248749790819932309965073892);
    }
    if tick < 0x200 {
        return ratio >> 32;
    }
    if tick & 0x200 != 0 {
        ratio = mul_shift_96(ratio, 81282483887344747381513967011);
    }
    if tick < 0x400 {
        return ratio >> 32;
    }
    if tick & 0x400 != 0 {
        ratio = mul_shift_96(ratio, 83390072131320151908154831281);
    }
    if tick < 0x800 {
        return ratio >> 32;
    }
    if tick & 0x800 != 0 {
        ratio = mul_shift_96(ratio, 87770609709833776024991924138);
    }
    if tick < 0x1000 {
        return ratio >> 32;
    }
    if tick & 0x1000 != 0 {
        ratio = mul_shift_96(ratio, 97234110755111693312479820773);
    }
    if tick < 0x2000 {
        return ratio >> 32;
    }
    if tick & 0x2000 != 0 {
        ratio = mul_shift_96(ratio, 119332217159966728226237229890);
    }
    if tick < 0x4000 {
        return ratio >> 32;
    }
    if tick & 0x4000 != 0 {
        ratio = mul_shift_96(ratio, 179736315981702064433883588727);
    }
    if tick < 0x8000 {
        return ratio >> 32;
    }
    if tick & 0x8000 != 0 {
        ratio = mul_shift_96(ratio, 407748233172238350107850275304);
    }
    if tick < 0x10000 {
        return ratio >> 32;
    }
    if tick & 0x10000 != 0 {
        ratio = mul_shift_96(ratio, 2098478828474011932436660412517);
    }
    if tick < 0x20000 {
        return ratio >> 32;
    }
    if tick & 0x20000 != 0 {
        ratio = mul_shift_96(ratio, 55581415166113811149459800483533);
    }
    if tick < 0x40000 {
        return ratio >> 32;
    }
    if tick & 0x40000 != 0 {
        ratio = mul_shift_96(ratio, 38992368544603139932233054999993551);
    }

    ratio >> 32
}

fn get_sqrt_price_negative_tick(tick: i32) -> u128 {
    let abs_tick = tick.unsigned_abs();

    let mut ratio: u128 = if abs_tick & 1 != 0 {
        18445821805675392311
    } else {
        18446744073709551616
    };

    if abs_tick & 0x2 != 0 {
        ratio = (ratio * 18444899583751176498) >> 64
    }
    if abs_tick < 0x4 {
        return ratio;
    }
    if abs_tick & 0x4 != 0 {
        ratio = (ratio * 18443055278223354162) >> 64
    }
    if abs_tick < 0x8 {
        return ratio;
    }
    if abs_tick & 0x8 != 0 {
        ratio = (ratio * 18439367220385604838) >> 64
    }
    if abs_tick < 0x10 {
        return ratio;
    }
    if abs_tick & 0x10 != 0 {
        ratio = (ratio * 18431993317065449817) >> 64
    }
    if abs_tick < 0x20 {
        return ratio;
    }
    if abs_tick & 0x20 != 0 {
        ratio = (ratio * 18417254355718160513) >> 64
    }
    if abs_tick < 0x40 {
        return ratio;
    }
    if abs_tick & 0x40 != 0 {
        ratio = (ratio * 18387811781193591352) >> 64
    }
    if abs_tick < 0x80 {
        return ratio;
    }
    if abs_tick & 0x80 != 0 {
        ratio = (ratio * 18329067761203520168) >> 64
    }
    if abs_tick < 0x100 {
        return ratio;
    }
    if abs_tick & 0x100 != 0 {
        ratio = (ratio * 18212142134806087854) >> 64
    }
    if abs_tick < 0x200 {
        return ratio;
    }
    if abs_tick & 0x200 != 0 {
        ratio = (ratio * 17980523815641551639) >> 64
    }
    if abs_tick < 0x400 {
        return ratio;
    }
    if abs_tick & 0x400 != 0 {
        ratio = (ratio * 17526086738831147013) >> 64
    }
    if abs_tick < 0x800 {
        return ratio;
    }
    if abs_tick & 0x800 != 0 {
        ratio = (ratio * 16651378430235024244) >> 64
    }
    if abs_tick < 0x1000 {
        return ratio;
    }
    if abs_tick & 0x1000 != 0 {
        ratio = (ratio * 15030750278693429944) >> 64
    }
    if abs_tick < 0x2000 {
        return ratio;
    }
    if abs_tick & 0x2000 != 0 {
        ratio = (ratio * 12247334978882834399) >> 64
    }
    if abs_tick < 0x4000 {
        return ratio;
    }
    if abs_tick & 0x4000 != 0 {
        ratio = (ratio * 8131365268884726200) >> 64
    }
    if abs_tick < 0x8000 {
        return ratio;
    }
    if abs_tick & 0x8000 != 0 {
        ratio = (ratio * 3584323654723342297) >> 64
    }
    if abs_tick < 0x10000 {
        return ratio;
    }
    if abs_tick & 0x10000 != 0 {
        ratio = (ratio * 696457651847595233) >> 64
    }
    if abs_tick < 0x20000 {
        return ratio;
    }
    if abs_tick & 0x20000 != 0 {
        ratio = (ratio * 26294789957452057) >> 64
    }
    if abs_tick < 0x40000 {
        return ratio;
    }
    if abs_tick & 0x40000 != 0 {
        ratio = (ratio * 37481735321082) >> 64
    }

    ratio
}

/// Computes (n0 × n1) >> 96.
///
/// Caller must ensure result fits in u128, i.e. n0 × n1 < 2^224. And no mid carry bit.
///
/// The carry out of the middle sum is not tracked, because the current system
/// boundary 0..=MAX_TICK_ID never produces one. Do not use this helper for any
/// value outside that boundary.
///
/// result_bit_width = product_bit_width - 96
/// 128 = product_bit_width - 96
/// product_bit_width = 128 + 96 = 224
///
/// In sqrt-price computation, this invariant holds because:
/// - n0 (ratio in Q96) < 2^110
/// - n1 (precomputed constants) < 2^115
/// - product < 2^(110 + 115) = 2^225, but with input range 0..=MAX_TICK_ID
///   product < 2^224, so result fits in u128.
#[inline]
fn mul_shift_96(n0: u128, n1: u128) -> u128 {
    // Decompose into 64-bit halves
    let a = (n0 >> 64) as u64; // n0_hi
    let b = n0 as u64; // n0_lo
    let c = (n1 >> 64) as u64; // n1_hi
    let d = n1 as u64; // n1_lo

    // Partial products (each < 2^128, no overflow)
    let bd = (b as u128) * (d as u128);
    let ad = (a as u128) * (d as u128);
    let bc = (b as u128) * (c as u128);
    let ac = (a as u128) * (c as u128);

    // Sum middle terms: mid = ad + bc + (bd >> 64). No carry tracking because 0..=MAX_TICK_ID doesn't produce any carry.
    let bd_hi = bd >> 64;
    let mid = ad.wrapping_add(bc).wrapping_add(bd_hi);

    // Full 256-bit product = ac × 2^128 + mid × 2^64 + (bd & 0xFFFF...)
    // After >> 96:
    //   ac × 2^32 + mid >> 32
    // (low 96 bits of bd discarded; bd_hi already merged into mid)

    let high = ac.wrapping_shl(32);
    let low = mid >> 32;

    high.wrapping_add(low)
}
