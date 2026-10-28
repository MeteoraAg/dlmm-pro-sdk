//! Reward parity: compute what a refresh and claim would transfer from pool,
//! position and tick state, then run the instructions and compare.

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
    let ranges = seed_ranges(0);
    let seeded = seed_liquidity(&mut market, pool, &ranges, None, &SEED_DEPOSITS);
    let reward = initialize_reward(&mut market, pool, 0);
    let open_time = unix_timestamp(&market.svm);
    set_reward_emission(
        &mut market,
        pool,
        &reward,
        0,
        open_time,
        open_time + MIN_REWARD_DURATION + 1_000,
        ONE,
    );

    // Refresh the first slot, so the claim below transfers both its pending
    // reward and the growth since that refresh.
    advance_unix_timestamp(&mut market.svm, 600);
    let refresh = refresh_fees_and_rewards_ix(&market, pool, &seeded, &ranges[..1], 1);
    send(&mut market.svm, &[refresh], &market.lp, &[&market.lp]);
    advance_unix_timestamp(&mut market.svm, 300);

    let pool_state = load_pool(&market, pool);
    let pool_reward = pool_state.pool_reward.unwrap();
    let positions =
        positions_with_rewards(&load_position_array(&market, &pool_state, seeded.position));
    assert!(positions[0].rewards[0].pending_amount > 0);
    let ticks = ticks_with_rewards(&load_tick_arrays(&market, pool, &pool_state, &ranges));
    let now = unix_timestamp(&market.svm);
    let expected =
        claimable_rewards(&pool_state.pool, &pool_reward, &positions, &ticks, 0, now).unwrap();
    let next = next_rewards_info(&pool_reward, pool_state.pool.liquidity, now).unwrap();

    let before = token_amount(&market.svm, &reward.lp_token);
    refresh_and_claim_reward(&mut market, pool, &seeded, &ranges, 0b11, &reward, 0);
    assert_eq!(
        token_amount(&market.svm, &reward.lp_token) - before,
        expected
    );
    let synced = load_pool(&market, pool).pool_reward.unwrap().rewards[0];
    assert_eq!(synced.reward_growth_global, next[0].reward_growth_global);
    assert_eq!(synced.last_update_time, now);
    for position in
        positions_with_rewards(&load_position_array(&market, &pool_state, seeded.position))
    {
        assert_eq!(position.rewards[0].pending_amount, 0);
    }
}
