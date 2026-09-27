//! Liquidity sizing helpers mirroring the TypeScript SDK's `liquidity.ts`.
use anchor_lang::prelude::*;
use ruint::aliases::U320;

use crate::*;

/// Liquidity for depositing at most `max_token_x`/`max_token_y` into
/// `[tick_lower_id, tick_upper_id)` at the current price. The budgets are
/// pool-side amounts: for a Token-2022 transfer-fee mint pass what the pool
/// receives (`calculate_transfer_fee_excluded_amount`), since `add_liquidity`
/// compares its fee-inclusive `max_amount_*` against the deposit plus fee.
pub fn get_liquidity_from_amounts(
    max_token_x: u64,
    max_token_y: u64,
    tick_lower_id: i32,
    tick_upper_id: i32,
    tick_current_id: i32,
    current_sqrt_price: u128,
) -> Result<u128> {
    let sqrt_price_lower = get_sqrt_price_from_tick_id(tick_lower_id);
    let sqrt_price_upper = get_sqrt_price_from_tick_id(tick_upper_id);

    let liquidity = if tick_current_id < tick_lower_id {
        get_liquidity_from_amount_x(sqrt_price_lower, sqrt_price_upper, max_token_x)?
    } else if tick_current_id < tick_upper_id {
        let liquidity_x =
            get_liquidity_from_amount_x(current_sqrt_price, sqrt_price_upper, max_token_x)?;
        let liquidity_y =
            get_liquidity_from_amount_y(sqrt_price_lower, current_sqrt_price, max_token_y)?;
        match (liquidity_x, liquidity_y) {
            (Some(x), Some(y)) => Some(x.min(y)),
            (x, y) => x.or(y),
        }
    } else {
        get_liquidity_from_amount_y(sqrt_price_lower, sqrt_price_upper, max_token_y)?
    };

    let liquidity = liquidity.unwrap_or(U320::ZERO);
    if liquidity.is_zero() {
        // the program rejects zero per-position liquidity with LiquidityIsZero
        return Err(PoolError::LiquidityIsZero.into());
    }
    Ok(try_cast(liquidity)?)
}

/// Token amounts a liquidity delta represents in `[tick_lower_id,
/// tick_upper_id)` at the current price. `round_up` matches deposits
/// (`true`) vs withdrawals (`false`).
pub fn get_amounts_from_liquidity(
    liquidity: u128,
    tick_lower_id: i32,
    tick_upper_id: i32,
    tick_current_id: i32,
    current_sqrt_price: u128,
    round_up: bool,
) -> Result<(u64, u64)> {
    let sqrt_price_lower = get_sqrt_price_from_tick_id(tick_lower_id);
    let sqrt_price_upper = get_sqrt_price_from_tick_id(tick_upper_id);
    let round = if round_up {
        Rounding::Up
    } else {
        Rounding::Down
    };

    if tick_current_id < tick_lower_id {
        Ok((
            get_delta_amount_x(sqrt_price_lower, sqrt_price_upper, liquidity, round)?,
            0,
        ))
    } else if tick_current_id >= tick_upper_id {
        Ok((
            0,
            get_delta_amount_y(sqrt_price_lower, sqrt_price_upper, liquidity, round)?,
        ))
    } else {
        Ok((
            get_delta_amount_x(current_sqrt_price, sqrt_price_upper, liquidity, round)?,
            get_delta_amount_y(sqrt_price_lower, current_sqrt_price, liquidity, round)?,
        ))
    }
}

/// The `bitmap` argument for the modify-liquidity instructions: one bit per
/// position index inside the position array.
pub fn liquidity_bitmap(position_indexes: &[usize]) -> Result<u64> {
    let mut bitmap = 0u64;
    for &index in position_indexes {
        if index >= 64 || bitmap & (1u64 << index) != 0 {
            return Err(PoolError::InvalidParameters.into());
        }
        bitmap |= 1u64 << index;
    }
    Ok(bitmap)
}
