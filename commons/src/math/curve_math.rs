use crate::down_scale_ceil;
use crate::try_cast;
use crate::PoolError;
use crate::SafeMath;
use anchor_lang::prelude::*;
use ruint::aliases::U256;
use ruint::aliases::U320;

/// Round up, down
#[derive(PartialEq, Clone, Copy)]
pub enum Rounding {
    /// Rounding up
    Up,
    /// Rounding down
    Down,
}
/// Gets the delta amount_x for given liquidity and price range
///
/// # Formula
///
/// * `Δx = L * (1 / √P_lower - 1 / √P_upper)`
/// * i.e. `L * (√P_upper - √P_lower) / (√P_upper * √P_lower)`
pub fn get_delta_amount_x_unchecked(
    lower_sqrt_price: u128,
    upper_sqrt_price: u128,
    liquidity: u128,
    round: Rounding,
) -> Result<U320> {
    // L = unscaled integer (u128)
    // denominator = √P_upper * √P_lower = Q128.128 (u128 * u128, fits U256)
    // numerator = L * (√P_upper - √P_lower) = unscaled integer * Q64.64 = Q64.64
    // Q.128 / Q.64 = garbage, we want an unscaled integer out, so upscale the numerator:
    // numerator = (L << 64) * (√P_upper - √P_lower) = Q64.64 * Q64.64 = Q128.128
    // With u128 inputs that product runs to just under 2^320, and it already passes 2^256
    // at the protocol's own per-tick liquidity cap, so the whole expression needs U320.
    // amount_x = numerator / denominator = Q128.128 / Q128.128 = unscaled integer
    require!(lower_sqrt_price > 0, PoolError::MathOverflow);
    let numerator_1: U320 = U320::from(liquidity) << 64;
    let numerator_2 = U320::from(upper_sqrt_price.safe_sub(lower_sqrt_price)?);
    let prod = numerator_1.safe_mul(numerator_2)?;
    let denominator = U320::from(lower_sqrt_price).safe_mul(U320::from(upper_sqrt_price))?;

    let result = match round {
        Rounding::Up => prod.div_ceil(denominator),
        Rounding::Down => prod.safe_div(denominator)?,
    };
    Ok(result)
}
pub fn get_delta_amount_x(
    lower_sqrt_price: u128,
    upper_sqrt_price: u128,
    liquidity: u128,
    round: Rounding,
) -> Result<u64> {
    let result =
        get_delta_amount_x_unchecked(lower_sqrt_price, upper_sqrt_price, liquidity, round)?;
    Ok(try_cast(result)?)
}

/// Gets the delta amount_y for given liquidity and price range
/// Δy = L * (√P_upper - √P_lower)
pub fn get_delta_amount_y_unchecked(
    lower_sqrt_price: u128,
    upper_sqrt_price: u128,
    liquidity: u128,
    round: Rounding,
) -> Result<U256> {
    // L = unscaled integer (u128)
    // delta_sqrt_price = √P_upper - √P_lower = Q64.64 (u128)
    // prod = unscaled integer * Q64.64 = Q64.64 (u128 * u128, so U256: U192 overflows at
    // the per-tick liquidity cap, and over the full price range even at tick spacing 1)
    // We want output as unscaled integer, therefore
    // result = prod >> 64;
    let liquidity = U256::from(liquidity);
    let delta_sqrt_price = U256::from(upper_sqrt_price.safe_sub(lower_sqrt_price)?);
    let prod = liquidity.safe_mul(delta_sqrt_price)?;

    let result = match round {
        Rounding::Up => down_scale_ceil(prod, 64),
        Rounding::Down => {
            let result = prod >> 64;
            result
        }
    };
    Ok(result)
}

pub fn get_delta_amount_y(
    lower_sqrt_price: u128,
    upper_sqrt_price: u128,
    liquidity: u128,
    round: Rounding,
) -> Result<u64> {
    let result =
        get_delta_amount_y_unchecked(lower_sqrt_price, upper_sqrt_price, liquidity, round)?;
    Ok(try_cast(result)?)
}

/// Gets the next sqrt price given an input amount of token X or token Y
/// Throws if price or liquidity are 0, or if the next price overflow q64.64
pub fn get_next_sqrt_price_from_input(
    sqrt_price: u128,
    liquidity: u128,
    amount_in: u64,
    swap_for_y: bool,
) -> Result<u128> {
    if amount_in == 0 {
        return Ok(sqrt_price);
    }

    // round to make sure that we don't pass the target price
    if swap_for_y {
        get_next_sqrt_price_from_amount_in_x_rounding_up(sqrt_price, liquidity, amount_in)
    } else {
        get_next_sqrt_price_from_amount_in_y_rounding_down(sqrt_price, liquidity, amount_in)
    }
}

/// Gets the next sqrt price √P' given a delta of token_x
///
/// Always round up because
/// 1. In the exact output case, token_x supply decreases leading to price increase.
/// Move price up so that exact output is met.
/// 2. In the exact input case, token_x supply increases leading to price decrease.
/// Do not round down to minimize price impact. We only need to meet input
/// change and not guarantee exact output.
///
/// Use function for exact input or exact output swaps for token_x
///
/// # Formula
///
/// * `√P' = √P * L / (L + Δx * √P)`
/// * If Δx * √P overflows, use alternate form `√P' = L / (L/√P + Δx)`
///
/// # Proof
///
/// For constant L,
///
///  L = x * √P
///  x' = x + Δa
///  x' * √P' = x * √P
///  (x + Δx) * √P' = x * √P
///  √P' = (x * √P) / (x + Δx)
///  x = L/√P
///  √P' = √P * L / (L + Δx * √P)
///
fn get_next_sqrt_price_from_amount_in_x_rounding_up(
    sqrt_price: u128,
    liquidity: u128,
    amount: u64,
) -> Result<u128> {
    // L = unscaled integer
    // denominator = (L + Δx * √P) = unscaled integer + unscaled integer * Q64.64 = unscaled integer + Q64.64 = garbage, therefore we make it same scale unit
    // denominator = (L << 64) + Δx * √P = Q64.64 + Q64.64 = Q64.64 ((u128 << 64) + u64 * u128 = U320)
    // numerator = L * √P = unscaled integer * Q64.64 = Q64.64 (u128 * u128 = U256)
    // But, next_sqrt_price is in Q64.64 scale, therefore we upscale numerator to Q128.128
    // numerator = (L << 64) * √P = Q64.64 * Q64.64 = Q128.128 ((u128 << 64) * u128 = U320)
    // result = numerator / denominator = Q128.128 / Q64.64 = Q64.64
    let sqrt_price = U320::from(sqrt_price);
    let liquidity: U320 = U320::from(liquidity) << 64;

    let product = U320::from(amount).safe_mul(sqrt_price)?;
    let denominator = liquidity.safe_add(U320::from(product))?;
    let result = liquidity.safe_mul(sqrt_price)?.div_ceil(denominator);
    // safe cast because √P' <= √P < u128::MAX
    Ok(try_cast(result)?)
}

/// Gets the next sqrt price given a delta of token_y
///
/// Always round down because
/// 1. In the exact output case, token_y supply decreases leading to price decrease.
/// Move price down by rounding down so that exact output of token_a is met.
/// 2. In the exact input case, token_y supply increases leading to price increase.
/// Do not round down to minimize price impact. We only need to meet input
/// change and not guarantee exact output for token_x.
///
///
/// # Formula
///
/// * `√P' = √P + Δy / L`
///
fn get_next_sqrt_price_from_amount_in_y_rounding_down(
    sqrt_price: u128,
    liquidity: u128,
    amount: u64,
) -> Result<u128> {
    // L = unscaled integer
    // Δy / L = unscaled integer / unscaled integer = unscaled integer
    // √P + Δy / L = Q64.64 + (unscaled integer / unscaled integer) = garbage
    // Therefore, we upscale Δy to Q64.64
    // √P + (Δy << 64) / L = Q64.64 + (Q64.64 / unscaled integer) = Q64.64 + Q64.64 = Q64.64 (u128 + u128 = U256)
    let quotient = (u128::from(amount) << 64).safe_div(liquidity)?;
    // However, we next_sqrt_price is capped at u128::MAX, saturating_add is enough
    Ok(sqrt_price.saturating_add(quotient))
}

/// Gets the liquidity for a given amount_x and price range.
///
/// Inverse of [`get_delta_amount_x`].
///
/// # Formula
///
/// From `Δx = L * (√P_upper - √P_lower) / (√P_lower * √P_upper)`:
///
/// * `L = Δx * (√P_lower * √P_upper) / (√P_upper - √P_lower)`
/// return NONE if √P_upper <= √P_lower, indicate no X side
pub fn get_liquidity_from_amount_x(
    lower_sqrt_price: u128,
    upper_sqrt_price: u128,
    amount_x: u64,
) -> Result<Option<U320>> {
    if lower_sqrt_price >= upper_sqrt_price {
        // no x side
        return Ok(None);
    }

    // L = unscaled integer
    // numerator = Δx * (√P_lower * √P_upper) = unscaled integer * (Q64.64 * Q64.64) = Q128.128 (u64 * u128 * u128 = U320)
    // denominator = (√P_upper - √P_lower) = Q64.64 - Q64.64 = Q64.64 (u128 - u128 = u128)
    // result = numerator / denominator = Q128.128 / Q64.64 = Q64.64 (U320 / u128 = U320)
    // We want to return unscaled integer, therefore we downscale result Q64.64 >> 64

    let prod = U320::from(amount_x)
        .safe_mul(U320::from(lower_sqrt_price))?
        .safe_mul(U320::from(upper_sqrt_price))?;
    let denominator = U320::from(upper_sqrt_price.safe_sub(lower_sqrt_price)?);
    let result = prod.safe_div(denominator)? >> 64;
    Ok(Some(result))
}

/// Gets the liquidity for a given amount_y and price range.
///
/// Inverse of [`get_delta_amount_y`].
///
/// # Formula
///
/// From `Δy = L * (√P_upper - √P_lower) / 2^64`:
///
/// * `L = (Δy << 64) / (√P_upper - √P_lower)`
/// return NONE if √P_upper <= √P_lower, indicate no Y side
pub fn get_liquidity_from_amount_y(
    lower_sqrt_price: u128,
    upper_sqrt_price: u128,
    amount_y: u64,
) -> Result<Option<U320>> {
    if lower_sqrt_price >= upper_sqrt_price {
        // no y side
        return Ok(None);
    }
    // L = unscaled integer
    // denominator = √P_upper - √P_lower = Q64.64 (u128)
    // numerator = Δy = unscaled integer (u64)
    // result = numerator / denominator = unscaled integer / Q64.64 = garbage
    // Therefore, we upscale numerator
    // numerator = Δy << 64 = Q64.64 (u128)
    // result = numerator / denominator = Q64.64 / Q64.64 = unscaled integer (u128 / u128 = u128)

    let delta_sqrt_price = upper_sqrt_price.safe_sub(lower_sqrt_price)?;
    let prod = u128::from(amount_y) << 64;
    let result = prod.safe_div(delta_sqrt_price)?;
    Ok(Some(U320::from(result)))
}
