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
    // numerator = (L << 64) * (√P_upper - √P_lower) = Q128.128
    // That product passes 2^256 at the per-tick liquidity cap, so it needs U320.
    require!(lower_sqrt_price > 0, PoolError::MathOverflow);
    let numerator_1: U320 = U320::from(liquidity).safe_shl(64)?;
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
    // u128 liquidity * Q64.64 delta overflows U192 at the per-tick liquidity cap.
    let liquidity = U256::from(liquidity);
    let delta_sqrt_price = U256::from(upper_sqrt_price.safe_sub(lower_sqrt_price)?);
    let prod = liquidity.safe_mul(delta_sqrt_price)?;

    let result = match round {
        Rounding::Up => down_scale_ceil(prod, 64),
        Rounding::Down => prod >> 64,
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

    if swap_for_y {
        get_next_sqrt_price_from_amount_in_x_rounding_up(sqrt_price, liquidity, amount_in)
    } else {
        get_next_sqrt_price_from_amount_in_y_rounding_down(sqrt_price, liquidity, amount_in)
    }
}

/// `√P' = √P * L / (L + Δx * √P)`, rounded up.
fn get_next_sqrt_price_from_amount_in_x_rounding_up(
    sqrt_price: u128,
    liquidity: u128,
    amount: u64,
) -> Result<u128> {
    let sqrt_price = U320::from(sqrt_price);
    let liquidity = U320::from(liquidity).safe_shl(64)?;

    let product = U320::from(amount).safe_mul(sqrt_price)?;
    let denominator = liquidity.safe_add(U320::from(product))?;
    let result = liquidity.safe_mul(sqrt_price)?.div_ceil(denominator);
    Ok(try_cast(result)?)
}

/// `√P' = √P + Δy / L`, rounded down.
fn get_next_sqrt_price_from_amount_in_y_rounding_down(
    sqrt_price: u128,
    liquidity: u128,
    amount: u64,
) -> Result<u128> {
    let quotient = u128::from(amount).safe_shl(64)?.safe_div(liquidity)?;
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
///
/// Returns `None` if √P_upper <= √P_lower (no X side).
pub fn get_liquidity_from_amount_x(
    lower_sqrt_price: u128,
    upper_sqrt_price: u128,
    amount_x: u64,
) -> Result<Option<U320>> {
    if lower_sqrt_price >= upper_sqrt_price {
        return Ok(None);
    }

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
///
/// Returns `None` if √P_upper <= √P_lower (no Y side).
pub fn get_liquidity_from_amount_y(
    lower_sqrt_price: u128,
    upper_sqrt_price: u128,
    amount_y: u64,
) -> Result<Option<U320>> {
    if lower_sqrt_price >= upper_sqrt_price {
        return Ok(None);
    }

    let delta_sqrt_price = upper_sqrt_price.safe_sub(lower_sqrt_price)?;
    let prod = u128::from(amount_y).safe_shl(64)?;
    let result = prod.safe_div(delta_sqrt_price)?;
    Ok(Some(U320::from(result)))
}
