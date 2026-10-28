use anchor_lang::prelude::*;

use crate::{PoolError, MAX_BASIS_POINT};

use super::safe_math::SafeMath;
const MAX_EXPONENTIAL: u32 = 0x80000; // 524288
const SCALE_OFFSET: u32 = 64;
const Q64: u128 = 1u128 << 64;

// cliff_fee_numerator * (1-reduction_factor/10_000)^passed_period
pub fn get_fee_in_period(
    cliff_fee_numerator: u64,
    reduction_factor: u64,
    passed_period: u16,
) -> Result<u64> {
    if reduction_factor == 0 {
        return Ok(cliff_fee_numerator);
    }
    // Make reduction_factor into Q64x64, and divided by MAX_BASIS_POINT. If reduction_factor = 1, we get 0.0001 in Q64x64
    let bps = (u128::from(reduction_factor) << SCALE_OFFSET).safe_div(MAX_BASIS_POINT.into())?;
    let base = Q64.safe_sub(bps)?;
    let result = pow(base, passed_period.into()).ok_or_else(|| PoolError::MathOverflow)?;

    let fee = result
        .safe_mul(cliff_fee_numerator.into())?
        .unbounded_shr(SCALE_OFFSET);

    let fee_numerator = u64::try_from(fee).map_err(|_| PoolError::TypeCastFailed)?;
    Ok(fee_numerator)
}

// Trader joe also use 2 ^ N - 1 instead of 2 ^ N for reciprocal https://github.com/lfj-gg/joe-v2/blob/067c6ccf5b8ff1526d03fa3e4c65ec45d01c1f73/src/libraries/math/Uint128x128Math.sol#L114
// Therefore, there's some drift in approximation whenever there's invert
// Invert happen whenever base > 1 << 64 or exp < 0
// Currently, pow is only used in fn get_fee_in_period, where 0 < base < Q64 and passed_period >= 0
fn pow(base: u128, exp: i32) -> Option<u128> {
    // https://doc.rust-lang.org/std/primitive.i32.html#method.abs
    // The absolute value of i32::MIN cannot be represented as an i32, and attempting to calculate it will cause an overflow.
    if exp == i32::MIN {
        return None;
    }

    // If exponent is negative. We will invert the result later by 1 / base^exp.abs()
    let mut invert = exp.is_negative();

    // When exponential is 0, result will always be 1
    if exp == 0 {
        return Some(Q64);
    }

    // Make the exponential positive. Which will compute the result later by 1 / base^exp
    let exp: u32 = if invert { exp.abs() as u32 } else { exp as u32 };

    // No point to continue the calculation as it will overflow the maximum value Q64.64 can support
    if exp >= MAX_EXPONENTIAL {
        return None;
    }

    let mut squared_base = base;
    let mut result = Q64;

    // When multiply the base twice, the number of bits double from 128 -> 256, which overflow.
    // The trick here is to inverse the calculation, which make the upper 64 bits (number bits) to be 0s.
    // For example:
    // let base = 1.001, exp = 5
    // let neg = 1 / (1.001 ^ 5)
    // Inverse the neg: 1 / neg
    // By using a calculator, you will find out that 1.001^5 == 1 / (1 / 1.001^5)
    if squared_base >= result {
        // This inverse the base: 1 / base
        squared_base = u128::MAX.checked_div(squared_base)?;
        // If exponent is negative, the above already inverted the result. Therefore, at the end of the function, we do not need to invert again.
        invert = !invert;
    }

    // The following code is equivalent to looping through each binary value of the exponential.
    // As explained at MAX_EXPONENTIAL, 19 exponential bits are enough to cover the full supported exponent range (beyond it, Q64.64 overflows).
    // Therefore, there will be 19 if statements, which similar to the following pseudo code.
    /*
        let mut result = 1;
        while exponential > 0 {
            if exponential & 1 > 0 {
                result *= base;
            }
            base *= base;
            exponential >>= 1;
        }
    */

    // From right to left
    // squared_base = 1 * base^1
    // 1st bit is 1
    if exp & 0x1 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    // squared_base = base^2
    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    // 2nd bit is 1
    if exp & 0x2 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    // Example:
    // If the base is 1.001, exponential is 3. Binary form of 3 is ..0011. The last two set bits fulfill the above 2 bitwise condition.
    // The result will be 1 * base^1 * base^2 == base^3. The process continues until reach the 20th bit

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x4 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x8 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x10 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x20 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x40 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x80 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x100 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x200 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x400 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x800 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x1000 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x2000 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x4000 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x8000 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x10000 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x20000 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x40000 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    // Stop here as the next is the 20th bit, which is MAX_EXPONENTIAL and already rejected above
    if result == 0 {
        return None;
    }

    if invert {
        result = u128::MAX.checked_div(result)?;
    }

    Some(result)
}
