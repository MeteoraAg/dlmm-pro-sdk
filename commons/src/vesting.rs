use anchor_lang::prelude::*;
use ruint::aliases::U192;

use crate::*;

/// `PositionVestingUpdate`: what `process_refresh_vesting` applies to one slot.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PositionVestingUpdate {
    pub unlocked_liquidity_delta: u128,
    pub vesting_liquidity: u128,
    pub released_vesting_liquidity: u128,
}

impl PositionVesting {
    pub fn is_initialize(&self) -> bool {
        self.initialize == 1
    }

    fn cliff_unlock_liquidity(&self, total_vested_liquidity: u128) -> Result<u128> {
        let cliff_unlock_liquidity = U192::from(self.cliff_unlock_bps)
            .safe_mul(U192::from(total_vested_liquidity))?
            .safe_div(U192::from(MAX_BASIS_POINT))?;
        Ok(try_cast(cliff_unlock_liquidity)?)
    }

    pub fn get_max_unlocked_liquidity(
        &self,
        total_vested_liquidity: u128,
        current_point: u64,
    ) -> Result<u128> {
        if current_point < self.cliff_point {
            return Ok(0);
        }

        if self.period_frequency == 0 || self.bps_per_period == 0 {
            return self.cliff_unlock_liquidity(total_vested_liquidity);
        }

        let period = current_point
            .safe_sub(self.cliff_point)?
            .safe_div(self.period_frequency)?;

        let unlocked_liquidity = if period >= u64::from(self.number_of_period) {
            total_vested_liquidity
        } else {
            let elapsed_bps = period.safe_mul(self.bps_per_period.into())?;
            let total_elapsed_bps = u64::from(self.cliff_unlock_bps).safe_add(elapsed_bps)?;

            let unlocked_liquidity = U192::from(total_elapsed_bps)
                .safe_mul(U192::from(total_vested_liquidity))?
                .safe_div(U192::from(MAX_BASIS_POINT))?;
            try_cast(unlocked_liquidity)?
        };

        Ok(unlocked_liquidity)
    }

    pub fn get_position_vesting_update(
        &self,
        vesting_liquidity: u128,
        released_vesting_liquidity: u128,
        current_point: u64,
    ) -> Result<PositionVestingUpdate> {
        let total_vested_liquidity = vesting_liquidity.safe_add(released_vesting_liquidity)?;
        let max_unlocked_liquidity =
            self.get_max_unlocked_liquidity(total_vested_liquidity, current_point)?;
        let new_unlocked_liquidity = max_unlocked_liquidity.safe_sub(released_vesting_liquidity)?;
        let new_released_vesting_liquidity =
            released_vesting_liquidity.safe_add(new_unlocked_liquidity)?;
        let new_vesting_liquidity = vesting_liquidity.safe_sub(new_unlocked_liquidity)?;

        Ok(PositionVestingUpdate {
            unlocked_liquidity_delta: new_unlocked_liquidity,
            released_vesting_liquidity: new_released_vesting_liquidity,
            vesting_liquidity: new_vesting_liquidity,
        })
    }
}

/// Unlocked liquidity after `process_refresh_vesting` at `current_point`
/// (slot or unix timestamp, by the pool's activation type). This is what
/// `remove_liquidity_by_bps` applies `bps` to.
pub fn unlocked_liquidity_for_withdraw(
    position: &Position,
    vesting: &PositionVesting,
    current_point: u64,
) -> Result<u128> {
    if !vesting.is_initialize() {
        return Ok(position.unlocked_liquidity);
    }
    let update = vesting.get_position_vesting_update(
        position.vesting_liquidity,
        position.released_vesting_liquidity,
        current_point,
    )?;
    Ok(position
        .unlocked_liquidity
        .safe_add(update.unlocked_liquidity_delta)?)
}

/// `unlocked * bps / MAX_BASIS_POINT` in U192, as `get_removal_parameters` computes it.
pub fn bps_withdraw_liquidity(unlocked_liquidity: u128, bps: u16) -> Result<u128> {
    let withdraw_liquidity = U192::from(unlocked_liquidity)
        .safe_mul(U192::from(bps))?
        .safe_div(U192::from(MAX_BASIS_POINT))?;
    Ok(try_cast(withdraw_liquidity)?)
}

/// The `bitmap` and `liquidities` `remove_liquidity_by_bps` derives from `bps`
/// after refreshing vesting at `current_point`. `None` selects every slot;
/// slots whose share rounds to zero are left out, as on chain.
pub fn bps_removal_parameters(
    positions: &[Position],
    vesting: &PositionVesting,
    current_point: u64,
    bps: u16,
    bitmap: Option<u64>,
) -> Result<(u64, Vec<u128>)> {
    require!(
        bps > 0 && bps <= MAX_BASIS_POINT,
        PoolError::InvalidParameters
    );
    if let Some(bitmap) = bitmap {
        require!(
            bitmap != 0 && bitmap.unbounded_shr(positions.len() as u32) == 0,
            PoolError::InvalidParameters
        );
    }

    let mut liquidities = vec![];
    let mut selected = 0u64;
    for (index, position) in positions.iter().enumerate() {
        if bitmap.is_some_and(|bitmap| bitmap & (1u64 << index) == 0) {
            continue;
        }
        let unlocked = unlocked_liquidity_for_withdraw(position, vesting, current_point)?;
        let withdraw_liquidity = bps_withdraw_liquidity(unlocked, bps)?;
        if withdraw_liquidity > 0 {
            liquidities.push(withdraw_liquidity);
            selected |= 1u64 << index;
        }
    }
    Ok((selected, liquidities))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schedule() -> PositionVesting {
        PositionVesting {
            cliff_point: 1_000,
            period_frequency: 100,
            cliff_unlock_bps: 2_000,
            bps_per_period: 1_000,
            number_of_period: 8,
            initialize: 1,
            _padding: 0,
        }
    }

    fn position(unlocked: u128, vesting: u128, released: u128) -> Position {
        Position {
            unlocked_liquidity: unlocked,
            permanent_locked_liquidity: 0,
            vesting_liquidity: vesting,
            released_vesting_liquidity: released,
            fee_growth_checkpoint_x: 0,
            fee_growth_checkpoint_y: 0,
            fee_pending_x: 0,
            fee_pending_y: 0,
            tick_lower_id: 0,
            tick_upper_id: 1,
            _padding_0: 0,
        }
    }

    #[test]
    fn max_unlocked_follows_the_cliff_and_periods() {
        let vesting = schedule();
        assert_eq!(vesting.get_max_unlocked_liquidity(10_000, 999).unwrap(), 0);
        assert_eq!(
            vesting.get_max_unlocked_liquidity(10_000, 1_000).unwrap(),
            2_000
        );
        assert_eq!(
            vesting.get_max_unlocked_liquidity(10_000, 1_299).unwrap(),
            4_000
        );
        assert_eq!(
            vesting.get_max_unlocked_liquidity(10_000, 1_800).unwrap(),
            10_000
        );
        assert_eq!(
            vesting
                .get_max_unlocked_liquidity(10_000, u64::MAX)
                .unwrap(),
            10_000
        );
    }

    #[test]
    fn cliff_only_schedule_unlocks_the_cliff_share() {
        let vesting = PositionVesting {
            period_frequency: 0,
            ..schedule()
        };
        assert_eq!(
            vesting.get_max_unlocked_liquidity(10_001, 5_000).unwrap(),
            2_000
        );
    }

    #[test]
    fn vesting_update_releases_the_difference_once() {
        let vesting = schedule();
        let update = vesting
            .get_position_vesting_update(8_000, 2_000, 1_250)
            .unwrap();
        assert_eq!(
            update,
            PositionVestingUpdate {
                unlocked_liquidity_delta: 2_000,
                vesting_liquidity: 6_000,
                released_vesting_liquidity: 4_000,
            }
        );
        assert_eq!(
            unlocked_liquidity_for_withdraw(&position(500, 8_000, 2_000), &vesting, 1_250).unwrap(),
            2_500
        );
        let unlocked = PositionVesting {
            initialize: 0,
            ..schedule()
        };
        assert_eq!(
            unlocked_liquidity_for_withdraw(&position(500, 8_000, 2_000), &unlocked, 1_250)
                .unwrap(),
            500
        );
    }

    #[test]
    fn bps_removal_skips_zero_shares_and_honours_the_bitmap() {
        let vesting = schedule();
        let positions = [
            position(10_000, 0, 0),
            position(1, 0, 0),
            position(0, 10_000, 0),
        ];
        assert_eq!(
            bps_removal_parameters(&positions, &vesting, 1_000, 5_000, None).unwrap(),
            (0b101, vec![5_000, 1_000])
        );
        assert_eq!(
            bps_removal_parameters(&positions, &vesting, 1_000, 5_000, Some(0b110)).unwrap(),
            (0b100, vec![1_000])
        );
        assert!(bps_removal_parameters(&positions, &vesting, 1_000, 0, None).is_err());
        assert!(bps_removal_parameters(&positions, &vesting, 1_000, 10_001, None).is_err());
        assert!(bps_removal_parameters(&positions, &vesting, 1_000, 1, Some(1 << 3)).is_err());
        assert_eq!(
            bps_withdraw_liquidity(u128::MAX, 10_000).unwrap(),
            u128::MAX
        );
    }
}
