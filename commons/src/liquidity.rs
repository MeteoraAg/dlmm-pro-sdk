use anchor_lang::prelude::*;

use crate::*;

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
}
