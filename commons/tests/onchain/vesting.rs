//! Vesting parity: compute the unlocked liquidity and the by-bps removal the
//! program would derive at a point in the schedule, then run
//! `remove_liquidity_by_bps` and compare the position deltas.

use crate::common::*;
use anchor_lang::solana_program::pubkey::Pubkey;
use dlmm_pro_commons::dlmm_pro::types;
use dlmm_pro_commons::*;

fn base_positions(market: &Market, pool_state: &DynamicPool, position: Pubkey) -> Vec<Position> {
    load_position_array(market, pool_state, position)
        .positions
        .base_positions()
}

#[test]
fn bps_removal_matches_onchain_vesting_unlock() {
    let mut market = create_funded_market();
    let pool = initialize_static_pool(&mut market, None, SQRT_PRICE_ONE);
    let ranges = seed_ranges();
    let seeded = seed_liquidity(&mut market, pool, &ranges, None, &SEED_DEPOSITS);

    // 20% at the cliff, then 10% per 100-second period over 8 periods.
    lock_vesting_position(
        &mut market,
        pool,
        &seeded,
        types::LockVestingPositionParameters {
            cliff_point: None,
            cliff_unlock_bps: 2_000,
            bps_per_period: 1_000,
            period_frequency: 100,
            number_of_period: 8,
            bps: 5_000,
            expected_layout_version: None,
        },
    );
    let pool_state = load_pool(&market, pool);
    let array = load_position_array(&market, &pool_state, seeded.position);
    let vesting = array.fixed.vesting;
    assert!(vesting.is_initialize());
    for position in array.positions.base_positions() {
        assert!(position.vesting_liquidity > 0);
        assert_eq!(position.released_vesting_liquidity, 0);
    }

    advance_unix_timestamp(&mut market.svm, 250);
    let now = unix_timestamp(&market.svm);
    let before = base_positions(&market, &pool_state, seeded.position);
    let (bitmap, liquidities) =
        bps_removal_parameters(&before, &vesting, now, 5_000, None).unwrap();
    assert_eq!(bitmap, 0b11);
    let unlocked: Vec<u128> = before
        .iter()
        .map(|position| unlocked_liquidity_for_withdraw(position, &vesting, now).unwrap())
        .collect();
    for (position, unlocked) in before.iter().zip(&unlocked) {
        assert!(*unlocked > position.unlocked_liquidity);
    }

    remove_liquidity_by_bps(&mut market, pool, &seeded, &ranges, 5_000, None);

    let after = base_positions(&market, &pool_state, seeded.position);
    for (index, (previous, current)) in before.iter().zip(&after).enumerate() {
        let removed = previous.total_liquidity().unwrap() - current.total_liquidity().unwrap();
        assert_eq!(removed, liquidities[index]);
        assert_eq!(current.unlocked_liquidity, unlocked[index] - removed);
        let update = vesting
            .get_position_vesting_update(
                previous.vesting_liquidity,
                previous.released_vesting_liquidity,
                now,
            )
            .unwrap();
        assert_eq!(current.vesting_liquidity, update.vesting_liquidity);
        assert_eq!(
            current.released_vesting_liquidity,
            update.released_vesting_liquidity
        );
    }

    // Past the last period everything vests; a one-slot bitmap only touches that slot.
    advance_unix_timestamp(&mut market.svm, 1_000);
    let now = unix_timestamp(&market.svm);
    let before = after;
    let (bitmap, liquidities) =
        bps_removal_parameters(&before, &vesting, now, MAX_BASIS_POINT, Some(1 << 1)).unwrap();
    assert_eq!(bitmap, 1 << 1);
    assert_eq!(
        liquidities,
        vec![before[1].unlocked_liquidity + before[1].vesting_liquidity]
    );

    remove_liquidity_by_bps(
        &mut market,
        pool,
        &seeded,
        &ranges,
        MAX_BASIS_POINT,
        Some(1 << 1),
    );
    let after = base_positions(&market, &pool_state, seeded.position);
    assert_eq!(after[1].total_liquidity().unwrap(), 0);
    assert_eq!(after[0].vesting_liquidity, 0);
    assert_eq!(
        after[0].unlocked_liquidity,
        before[0].unlocked_liquidity + before[0].vesting_liquidity
    );
}
