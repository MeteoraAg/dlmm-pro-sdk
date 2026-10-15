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

    Ok(try_cast(liquidity.unwrap_or(U320::ZERO))?)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn amounts_from_liquidity_follow_the_current_tick() {
        let liquidity = 1_000_000_000;
        let (lower, upper) = (-100, 100);
        let amounts = |tick_current_id: i32, round_up: bool| {
            get_amounts_from_liquidity(
                liquidity,
                lower,
                upper,
                tick_current_id,
                get_sqrt_price_from_tick_id(tick_current_id),
                round_up,
            )
            .unwrap()
        };
        // Exact amounts: 9_999_541.69 for the whole range, 4_987_272.07 per side from tick 0.
        assert_eq!(amounts(lower - 1, false), (9_999_541, 0));
        assert_eq!(amounts(upper, false), (0, 9_999_541));
        assert_eq!(amounts(0, false), (4_987_272, 4_987_272));
        assert_eq!(amounts(0, true), (4_987_273, 4_987_273));
    }

    #[test]
    fn no_amounts_give_zero_liquidity() {
        assert_eq!(
            get_liquidity_from_amounts(0, 0, -100, 100, 0, 1 << 64).unwrap(),
            0
        );
    }
}
