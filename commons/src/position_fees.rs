//! Pending swap-fee math for positions, mirroring the TypeScript SDK's
//! `position_fees.ts` and the program's `position_utils`.
use anchor_lang::prelude::*;
use ruint::aliases::U256;

use crate::*;

/// Q64.64 fee growth per unit of liquidity accrued inside a tick range. Values
/// wrap at 2^128 like the program's counters, and an empty tick counts all
/// growth as below it (lower) or none as above it (upper).
pub fn fee_growths_inside(
    tick_current_id: i32,
    tick_lower: &Tick,
    tick_lower_id: i32,
    tick_upper: &Tick,
    tick_upper_id: i32,
    fee_growth_global_x: u128,
    fee_growth_global_y: u128,
) -> (u128, u128) {
    let (below_x, below_y) = if tick_lower.liquidity_gross == 0 {
        (fee_growth_global_x, fee_growth_global_y)
    } else if tick_current_id < tick_lower_id {
        (
            fee_growth_global_x.wrapping_sub(tick_lower.fee_growth_outside_x),
            fee_growth_global_y.wrapping_sub(tick_lower.fee_growth_outside_y),
        )
    } else {
        (
            tick_lower.fee_growth_outside_x,
            tick_lower.fee_growth_outside_y,
        )
    };

    let (above_x, above_y) = if tick_upper.liquidity_gross == 0 {
        (0, 0)
    } else if tick_current_id < tick_upper_id {
        (
            tick_upper.fee_growth_outside_x,
            tick_upper.fee_growth_outside_y,
        )
    } else {
        (
            fee_growth_global_x.wrapping_sub(tick_upper.fee_growth_outside_x),
            fee_growth_global_y.wrapping_sub(tick_upper.fee_growth_outside_y),
        )
    };

    (
        fee_growth_global_x
            .wrapping_sub(below_x)
            .wrapping_sub(above_x),
        fee_growth_global_y
            .wrapping_sub(below_y)
            .wrapping_sub(above_y),
    )
}

/// Fees a refresh would leave pending on one position slot: the amount already
/// pending plus `liquidity * (growth_inside - checkpoint) >> 64`. A slot without
/// liquidity is not updated by the program, so only its pending amount counts.
pub fn pending_fees(
    position: &Position,
    fee_growth_inside_x: u128,
    fee_growth_inside_y: u128,
) -> Result<(u64, u64)> {
    let liquidity = position.total_liquidity()?;
    if liquidity == 0 {
        return Ok((position.fee_pending_x, position.fee_pending_y));
    }
    let delta = |growth_inside: u128, checkpoint: u128| -> Result<u64> {
        let growth_delta = growth_inside.wrapping_sub(checkpoint);
        let fee_delta = (U256::from(liquidity) * U256::from(growth_delta)) >> 64;
        Ok(try_cast(fee_delta)?)
    };
    Ok((
        position.fee_pending_x.safe_add(delta(
            fee_growth_inside_x,
            position.fee_growth_checkpoint_x,
        )?)?,
        position.fee_pending_y.safe_add(delta(
            fee_growth_inside_y,
            position.fee_growth_checkpoint_y,
        )?)?,
    ))
}

/// Totals `claim_fee` would transfer after refreshing the slots in `bitmap`:
/// refreshed slots accrue growth since their checkpoint, the rest contribute
/// what is already pending. `ticks` must contain both endpoints of every
/// refreshed slot that holds liquidity.
pub fn claimable_fees(
    pool: &Pool,
    positions: &[Position],
    bitmap: u64,
    ticks: &[Tick],
) -> Result<(u64, u64)> {
    require!(
        bitmap != 0 && bitmap.unbounded_shr(positions.len() as u32) == 0,
        PoolError::InvalidParameters
    );
    let tick = |tick_id: i32| -> Result<&Tick> {
        ticks
            .iter()
            .find(|tick| tick.tick_id == tick_id)
            .ok_or_else(|| PoolError::CannotFindTickFromId.into())
    };

    let mut fee_x = 0u64;
    let mut fee_y = 0u64;
    for (index, position) in positions.iter().enumerate() {
        let refreshed = bitmap & (1u64 << index) != 0 && position.total_liquidity()? != 0;
        let (slot_x, slot_y) = if refreshed {
            let (inside_x, inside_y) = fee_growths_inside(
                pool.tick_current_id,
                tick(position.tick_lower_id)?,
                position.tick_lower_id,
                tick(position.tick_upper_id)?,
                position.tick_upper_id,
                pool.fee_growth_global_x,
                pool.fee_growth_global_y,
            );
            pending_fees(position, inside_x, inside_y)?
        } else {
            (position.fee_pending_x, position.fee_pending_y)
        };
        fee_x = fee_x.safe_add(slot_x)?;
        fee_y = fee_y.safe_add(slot_y)?;
    }
    Ok((fee_x, fee_y))
}
