use anchor_lang::prelude::*;
use ruint::aliases::{U192, U256};
use std::cmp::min;

use crate::*;

/// The growth and empty-liquidity seconds a refresh adds to a slot.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct NextRewardInfo {
    pub reward_growth_global: u128,
    pub cumulative_seconds_with_empty_liquidity_reward: u64,
}

fn next_reward_info_for_slot(
    reward: &PoolRewardInfo,
    liquidity: u128,
    current_timestamp: u64,
) -> Result<NextRewardInfo> {
    let unchanged = NextRewardInfo {
        reward_growth_global: reward.reward_growth_global,
        cumulative_seconds_with_empty_liquidity_reward: 0,
    };
    if !reward.is_initialized()
        || current_timestamp < reward.open_time
        || reward.last_update_time == reward.end_time
    {
        return Ok(unchanged);
    }

    let time_delta = min(current_timestamp, reward.end_time).safe_sub(reward.last_update_time)?;

    if liquidity == 0 {
        return Ok(NextRewardInfo {
            reward_growth_global: reward.reward_growth_global,
            cumulative_seconds_with_empty_liquidity_reward: time_delta,
        });
    }

    let reward_growth_delta: u128 = try_cast(
        U192::from(time_delta)
            .safe_mul(U192::from(reward.emission_per_second))?
            .safe_div(U192::from(liquidity))?,
    )?;

    Ok(NextRewardInfo {
        reward_growth_global: reward_growth_delta.wrapping_add(reward.reward_growth_global),
        cumulative_seconds_with_empty_liquidity_reward: 0,
    })
}

/// `PoolReward::get_next_rewards_info` at `current_timestamp`, where
/// `liquidity` is the pool's active liquidity.
pub fn next_rewards_info(
    pool_reward: &PoolReward,
    liquidity: u128,
    current_timestamp: u64,
) -> Result<[NextRewardInfo; NUM_REWARDS]> {
    let mut next = [NextRewardInfo::default(); NUM_REWARDS];
    for (index, reward) in pool_reward.rewards.iter().enumerate() {
        next[index] = next_reward_info_for_slot(reward, liquidity, current_timestamp)?;
    }
    Ok(next)
}

/// Q64.64 reward growth per unit of liquidity inside a tick range. Values
/// wrap at 2^128, and an empty tick counts all growth as below it (lower) or
/// none as above it (upper).
pub fn next_reward_growths_inside(
    tick_current_id: i32,
    tick_lower: &TickWithReward,
    tick_lower_id: i32,
    tick_upper: &TickWithReward,
    tick_upper_id: i32,
    reward_infos: &[NextRewardInfo; NUM_REWARDS],
) -> [u128; NUM_REWARDS] {
    let mut reward_growths_inside = [0; NUM_REWARDS];

    for (index, reward_update) in reward_infos.iter().enumerate() {
        let reward_growths_below = if tick_lower.inner.liquidity_gross == 0 {
            reward_update.reward_growth_global
        } else if tick_current_id < tick_lower_id {
            reward_update
                .reward_growth_global
                .wrapping_sub(tick_lower.reward_growths_outside[index])
        } else {
            tick_lower.reward_growths_outside[index]
        };

        let reward_growths_above = if tick_upper.inner.liquidity_gross == 0 {
            0
        } else if tick_current_id < tick_upper_id {
            tick_upper.reward_growths_outside[index]
        } else {
            reward_update
                .reward_growth_global
                .wrapping_sub(tick_upper.reward_growths_outside[index])
        };

        reward_growths_inside[index] = reward_update
            .reward_growth_global
            .wrapping_sub(reward_growths_below)
            .wrapping_sub(reward_growths_above);
    }

    reward_growths_inside
}

/// Pending amounts a refresh leaves on one slot, from the reward block of
/// `next_position_modify_liquidity_update`: a delta above `u64::MAX` is
/// capped and the sum saturates.
pub fn pending_rewards(
    position: &PositionWithReward,
    reward_growths_inside: &[u128; NUM_REWARDS],
) -> Result<[u64; NUM_REWARDS]> {
    let liquidity = position.inner.total_liquidity()?;
    let mut pending = position.rewards.map(|reward| reward.pending_amount);
    for (index, amount) in pending.iter_mut().enumerate() {
        let reward_growth_delta = reward_growths_inside[index]
            .wrapping_sub(position.rewards[index].growth_inside_checkpoint);
        let amount_owed_delta_u256 =
            U256::from(liquidity).safe_mul(U256::from(reward_growth_delta))? >> 64;
        let amount_owed_delta: u64 = if amount_owed_delta_u256 > U256::from(u64::MAX) {
            u64::MAX
        } else {
            try_cast(amount_owed_delta_u256)?
        };
        *amount = amount.saturating_add(amount_owed_delta);
    }
    Ok(pending)
}

/// What `claim_reward(reward_index)` transfers once every slot holding
/// liquidity is refreshed at `current_timestamp`. `ticks` must contain both
/// endpoints of those slots.
pub fn claimable_rewards(
    pool: &Pool,
    pool_reward: &PoolReward,
    positions: &[PositionWithReward],
    ticks: &[TickWithReward],
    reward_index: usize,
    current_timestamp: u64,
) -> Result<u64> {
    require!(reward_index < NUM_REWARDS, PoolError::InvalidRewardIndex);
    let next = next_rewards_info(pool_reward, pool.liquidity, current_timestamp)?;
    let tick = |tick_id: i32| -> Result<&TickWithReward> {
        ticks
            .iter()
            .find(|tick| tick.inner.tick_id == tick_id)
            .ok_or_else(|| PoolError::CannotFindTickFromId.into())
    };

    let mut total = 0u64;
    for position in positions {
        // The refresh skips slots without liquidity.
        let amount = if position.inner.total_liquidity()? == 0 {
            position.rewards[reward_index].pending_amount
        } else {
            let tick_lower_id = position.inner.tick_lower_id;
            let tick_upper_id = position.inner.tick_upper_id;
            let growths = next_reward_growths_inside(
                pool.tick_current_id,
                tick(tick_lower_id)?,
                tick_lower_id,
                tick(tick_upper_id)?,
                tick_upper_id,
                &next,
            );
            pending_rewards(position, &growths)?[reward_index]
        };
        total = total.safe_add(amount)?;
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytemuck::Zeroable;

    fn reward(open: u64, end: u64, last_update: u64) -> PoolRewardInfo {
        PoolRewardInfo {
            mint: Pubkey::new_unique(),
            emission_per_second: 3 << 64,
            open_time: open,
            end_time: end,
            last_update_time: last_update,
            reward_growth_global: 7,
            ..PoolRewardInfo::zeroed()
        }
    }

    #[test]
    fn next_reward_info_for_slot_covers_every_branch() {
        let liquidity = 1u128 << 64;
        let uninitialized = PoolRewardInfo::zeroed();
        assert_eq!(
            next_reward_info_for_slot(&uninitialized, liquidity, 50).unwrap(),
            NextRewardInfo::default()
        );
        let before_open = reward(100, 200, 100);
        assert_eq!(
            next_reward_info_for_slot(&before_open, liquidity, 99).unwrap(),
            NextRewardInfo {
                reward_growth_global: 7,
                cumulative_seconds_with_empty_liquidity_reward: 0,
            }
        );
        let finished = reward(100, 200, 200);
        assert_eq!(
            next_reward_info_for_slot(&finished, liquidity, 300).unwrap(),
            NextRewardInfo {
                reward_growth_global: 7,
                cumulative_seconds_with_empty_liquidity_reward: 0,
            }
        );
        let empty = reward(100, 200, 120);
        assert_eq!(
            next_reward_info_for_slot(&empty, 0, 300).unwrap(),
            NextRewardInfo {
                reward_growth_global: 7,
                cumulative_seconds_with_empty_liquidity_reward: 80,
            }
        );
        let active = reward(100, 200, 120);
        assert_eq!(
            next_reward_info_for_slot(&active, liquidity, 150).unwrap(),
            NextRewardInfo {
                reward_growth_global: 7 + 30 * 3,
                cumulative_seconds_with_empty_liquidity_reward: 0,
            }
        );
        let wrapping = PoolRewardInfo {
            reward_growth_global: u128::MAX,
            ..reward(100, 200, 120)
        };
        assert_eq!(
            next_reward_info_for_slot(&wrapping, liquidity, 121)
                .unwrap()
                .reward_growth_global,
            2
        );
    }

    #[test]
    fn pending_rewards_cap_the_delta_and_saturate() {
        let position = PositionWithReward {
            inner: Position {
                unlocked_liquidity: 1 << 70,
                tick_upper_id: 1,
                ..Position::zeroed()
            },
            rewards: [
                PositionRewardInfo {
                    growth_inside_checkpoint: 5,
                    pending_amount: u64::MAX - 1,
                    ..PositionRewardInfo::zeroed()
                },
                PositionRewardInfo {
                    growth_inside_checkpoint: 0,
                    pending_amount: 1,
                    ..PositionRewardInfo::zeroed()
                },
            ],
        };
        assert_eq!(
            pending_rewards(&position, &[5 + (1 << 64), u128::MAX]).unwrap(),
            [u64::MAX, u64::MAX]
        );
        let empty = PositionWithReward {
            inner: Position {
                unlocked_liquidity: 0,
                ..position.inner
            },
            ..position
        };
        assert_eq!(
            pending_rewards(&empty, &[u128::MAX; NUM_REWARDS]).unwrap(),
            [u64::MAX - 1, 1]
        );
    }

    #[test]
    fn claimable_rewards_rejects_an_out_of_range_reward_index() {
        let position = PositionWithReward::zeroed();
        assert_eq!(
            claimable_rewards(
                &Pool::zeroed(),
                &PoolReward::zeroed(),
                &[position],
                &[],
                NUM_REWARDS,
                0,
            ),
            Err(PoolError::InvalidRewardIndex.into())
        );
    }
}
