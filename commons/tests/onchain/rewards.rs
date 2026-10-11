//! Reward parity: compute what a refresh and claim, or an ineligible
//! withdrawal, would transfer from pool, position and tick state, then run the
//! instructions and compare.

use crate::common::*;
use dlmm_pro_commons::*;

const ONE: u128 = 1 << 64;

fn positions_with_rewards(array: &DynamicPositionArray) -> Vec<PositionWithReward> {
    match &array.positions {
        Positions::WithReward(positions) => positions.clone(),
        Positions::Base(_) => panic!("pool without rewards"),
    }
}

fn ticks_with_rewards(arrays: &[DynamicTickArray]) -> Vec<TickWithReward> {
    arrays
        .iter()
        .flat_map(|array| match &array.ticks {
            Ticks::WithReward(ticks) => ticks.clone(),
            Ticks::Base(_) => panic!("pool without rewards"),
        })
        .collect()
}

#[test]
fn claimable_rewards_match_onchain_claim() {
    let mut market = create_funded_market();
    let pool = initialize_mining_pool(&mut market);
    let ranges = seed_ranges();
    let seeded = seed_liquidity(&mut market, pool, &ranges, None, &SEED_DEPOSITS);
    let reward = initialize_reward(&mut market, pool, 0);
    let open_time = unix_timestamp(&market.svm);
    set_reward_emission(
        &mut market,
        pool,
        &reward,
        0,
        Some(open_time),
        open_time + MIN_REWARD_DURATION + 1_000,
        ONE,
    );

    // Refresh only the second slot so the first keeps its original checkpoint.
    advance_unix_timestamp(&mut market.svm, 600);
    refresh_and_claim_reward(&mut market, pool, &seeded, &ranges[1..], 1 << 1, &reward, 0);
    advance_unix_timestamp(&mut market.svm, 300);

    let pool_state = load_pool(&market, pool);
    let pool_reward = pool_state.pool_reward.unwrap();
    let positions =
        positions_with_rewards(&load_position_array(&market, &pool_state, seeded.position));
    let ticks = ticks_with_rewards(&load_tick_arrays(&market, pool, &pool_state, &ranges));
    let now = unix_timestamp(&market.svm);

    let bitmap = liquidity_bitmap(&[0]).unwrap();
    let expected = claimable_rewards(
        &pool_state.pool,
        &pool_reward,
        &positions,
        bitmap,
        &ticks,
        0,
        now,
    )
    .unwrap();
    assert!(expected > 0);
    let next = next_rewards_info(&pool_reward, pool_state.pool.liquidity, now).unwrap();

    let before = token_amount(&market.svm, &reward.lp_token);
    refresh_and_claim_reward(&mut market, pool, &seeded, &ranges[..1], bitmap, &reward, 0);
    assert_eq!(
        token_amount(&market.svm, &reward.lp_token) - before,
        expected
    );
    let synced = load_pool(&market, pool).pool_reward.unwrap().rewards[0];
    assert_eq!(synced.reward_growth_global, next[0].reward_growth_global);
    assert_eq!(synced.last_update_time, now);

    advance_unix_timestamp(&mut market.svm, 200);
    let pool_state = load_pool(&market, pool);
    let positions =
        positions_with_rewards(&load_position_array(&market, &pool_state, seeded.position));
    let ticks = ticks_with_rewards(&load_tick_arrays(&market, pool, &pool_state, &ranges));
    let bitmap = liquidity_bitmap(&[0, 1]).unwrap();
    let expected = claimable_rewards(
        &pool_state.pool,
        &pool_state.pool_reward.unwrap(),
        &positions,
        bitmap,
        &ticks,
        0,
        unix_timestamp(&market.svm),
    )
    .unwrap();

    let before = token_amount(&market.svm, &reward.lp_token);
    refresh_and_claim_reward(&mut market, pool, &seeded, &ranges, bitmap, &reward, 0);
    assert_eq!(
        token_amount(&market.svm, &reward.lp_token) - before,
        expected
    );
    for position in
        positions_with_rewards(&load_position_array(&market, &pool_state, seeded.position))
    {
        assert_eq!(position.rewards[0].pending_amount, 0);
    }
}

#[test]
fn ineligible_reward_matches_onchain_withdraw() {
    let mut market = create_funded_market();
    let pool = initialize_mining_pool(&mut market);
    let ranges = seed_ranges();
    let seeded = seed_liquidity(&mut market, pool, &ranges, None, &[(0, 10_000, 10_000)]);
    let reward = initialize_reward(&mut market, pool, 0);
    let open_time = unix_timestamp(&market.svm);
    let end_time = open_time + MIN_REWARD_DURATION + 100;
    set_reward_emission(
        &mut market,
        pool,
        &reward,
        0,
        Some(open_time),
        end_time,
        ONE,
    );

    advance_unix_timestamp(&mut market.svm, 100);
    remove_liquidity_by_bps(&mut market, pool, &seeded, &ranges, MAX_BASIS_POINT, None);
    let drained_at = unix_timestamp(&market.svm);
    assert_eq!(load_pool(&market, pool).pool.liquidity, 0);

    set_unix_timestamp(&mut market.svm, (end_time + 1) as i64);
    let pool_state = load_pool(&market, pool);
    let reward_info = pool_state.pool_reward.unwrap().rewards[0];
    let expected = ineligible_reward_amount(
        &reward_info,
        pool_state.pool.liquidity,
        unix_timestamp(&market.svm),
    )
    .unwrap();
    assert_eq!(expected, end_time - drained_at);

    let before = token_amount(&market.svm, &reward.funder_token);
    withdraw_ineligible_rewards(&mut market, pool, &reward, 0);
    assert_eq!(
        token_amount(&market.svm, &reward.funder_token) - before,
        expected
    );
    let reward_info = load_pool(&market, pool).pool_reward.unwrap().rewards[0];
    assert_eq!(
        reward_info.cumulative_seconds_with_empty_liquidity_reward,
        0
    );
    assert_eq!(reward_info.last_update_time, end_time);
}
