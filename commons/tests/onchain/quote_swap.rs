//! Quote-vs-execution parity: set up a pool in LiteSVM with the real program
//! binary, quote with `quote_exact_in`, execute the `swap` instruction, and
//! assert the quote matches what the program did.

use crate::common::*;
use anchor_lang::solana_program::pubkey::Pubkey;
use dlmm_pro_commons::dlmm_pro::types;
use dlmm_pro_commons::*;

const EXTENSION_TICK: i32 = 65536;
const EXTENSION_SEED_DEPOSITS: [(usize, u64, u64); 2] =
    [(0, 10_000_000, 10_000_000), (1, 0, 200_000_000)];

fn seeded_extension_pool() -> (Market, Pubkey) {
    let mut market = create_funded_market();
    let pool = initialize_static_pool(
        &mut market,
        None,
        get_sqrt_price_from_tick_id(EXTENSION_TICK),
    );
    // Pool init creates the bitmap extension: the initial tick overflows the
    // pool's inline bitmap.
    seed_liquidity(
        &mut market,
        pool,
        &extension_seed_ranges(EXTENSION_TICK),
        Some(derive_tick_array_bitmap_extension(pool)),
        &EXTENSION_SEED_DEPOSITS,
    );
    (market, pool)
}

#[test]
fn quote_exact_in_matches_onchain_swap_across_tick_arrays() {
    let mut market = create_funded_market();
    let pool = initialize_static_pool(&mut market, None, SQRT_PRICE_ONE);
    seed_liquidity(&mut market, pool, &seed_ranges(), None, &SEED_DEPOSITS);

    assert_quote_matches_execution(&mut market, pool, 50_000, true);
    assert_quote_matches_execution(&mut market, pool, 30_000, false);
    assert_quote_matches_execution(&mut market, pool, 1_234, true);
}

#[test]
fn quote_rejects_tick_arrays_from_another_pool() {
    let mut market = create_funded_market();
    let pool = initialize_static_pool(&mut market, None, SQRT_PRICE_ONE);
    seed_liquidity(&mut market, pool, &seed_ranges(), None, &SEED_DEPOSITS);

    assert_eq!(
        quote_with_wrong_tick_array_pool(&market, pool, 1_000).unwrap_err(),
        PoolError::InvalidTickArray.into()
    );
    assert_eq!(
        quote_with_unreached_foreign_tick_array(&market, pool, 1_000)
            .unwrap()
            .out_amount,
        quote_result(&market, pool, 1_000, true).unwrap().out_amount
    );
}

#[test]
fn quote_exact_in_matches_onchain_swap_with_dynamic_fee() {
    let mut market = create_funded_market();
    let pool = initialize_static_pool(
        &mut market,
        Some(types::DynamicFeeParameters {
            max_volatility_accumulator: 350_000,
            variable_fee_control: 2_000_000,
            filter_period: 30,
            decay_period: 600,
            reduction_factor: 5_000,
        }),
        SQRT_PRICE_ONE,
    );
    seed_liquidity(&mut market, pool, &seed_ranges(), None, &SEED_DEPOSITS);

    assert_quote_matches_execution(&mut market, pool, 50_000, true);
    assert_quote_matches_execution(&mut market, pool, 20_000, true);
    assert_quote_matches_execution(&mut market, pool, 40_000, false);
}

#[test]
fn quote_exact_in_matches_onchain_swap_with_transfer_fee() {
    let mut market = create_funded_market_with_transfer_fee_x();
    let pool = initialize_static_pool(&mut market, None, SQRT_PRICE_ONE);
    seed_liquidity(&mut market, pool, &seed_ranges(), None, &SEED_DEPOSITS);

    assert_quote_matches_execution(&mut market, pool, 50_000, true);
    assert_quote_matches_execution(&mut market, pool, 30_000, false);
}

#[test]
fn swap_accepts_referral_equal_to_output_token_account() {
    let mut market = create_funded_market();
    let pool = initialize_static_pool(&mut market, None, SQRT_PRICE_ONE);
    seed_liquidity(&mut market, pool, &seed_ranges(), None, &SEED_DEPOSITS);

    // `referral` is `mut` with Anchor's `dup`, so it may be the output token
    // account. The host fee is paid into that account.
    let quoted = quote(&market, pool, 50_000, true);
    let out_account = market.swapper_token_y;
    let before = token_amount(&market.svm, &out_account);
    execute_swap(
        &mut market,
        pool,
        50_000,
        true,
        &quoted.tick_arrays,
        quoted.bitmap_extension,
        Some(out_account),
    );
    assert!(token_amount(&market.svm, &out_account) > before);
}

#[test]
fn quote_fee_split_matches_onchain_with_partner_and_referral() {
    let mut market = create_funded_market_with_transfer_fee_x();
    let pool = initialize_partner_pool(&mut market, 2_500);
    seed_liquidity(&mut market, pool, &seed_ranges(), None, &SEED_DEPOSITS);

    // Fees are collected in the output token, so the referral holds that mint.
    let (referral_y, referral_x) = (market.lp_token_y, market.lp_token_x);
    let quote = assert_quote_matches_execution_with_referral(
        &mut market,
        pool,
        100_000,
        true,
        Some(referral_y),
    );
    assert!(quote.partner_fee > 0);
    let quote = assert_quote_matches_execution_with_referral(
        &mut market,
        pool,
        60_000,
        false,
        Some(referral_x),
    );
    assert!(quote.partner_fee > 0);
}

#[test]
fn quote_exact_in_matches_onchain_swap_with_fees_on_input() {
    let mut market = create_funded_market();
    let pool = initialize_static_pool_with_fee_mode(
        &mut market,
        None,
        SQRT_PRICE_ONE,
        CollectFeeMode::OnlyY,
    );
    seed_liquidity(&mut market, pool, &seed_ranges(), None, &SEED_DEPOSITS);

    // X -> Y takes the fee from the Y output, Y -> X from the Y input.
    assert_quote_matches_execution(&mut market, pool, 50_000, true);
    assert_quote_matches_execution(&mut market, pool, 30_000, false);
}

#[test]
fn quote_exact_in_matches_onchain_swap_with_limit_order() {
    let mut market = create_funded_market();
    let pool = initialize_static_pool(&mut market, None, SQRT_PRICE_ONE);
    seed_liquidity(&mut market, pool, &seed_ranges(), None, &SEED_DEPOSITS);
    open_ask_limit_order(&mut market, pool, 2, 100_000);

    // Y -> X walks into the ask at tick 2.
    let quote = assert_quote_matches_execution(&mut market, pool, 50_000, false);
    assert!(
        quote.limit_order_fee > 0,
        "swap must consume in-tick limit-order liquidity"
    );
}

#[test]
fn quote_exact_in_matches_onchain_swap_down_with_bitmap_extension() {
    let (mut market, pool) = seeded_extension_pool();
    let quoted = quote(&market, pool, 1_000, true);
    assert!(
        quoted.bitmap_extension.is_some(),
        "swap at an extension tick must pass the bitmap extension account"
    );
    assert_quote_matches_execution(&mut market, pool, 1_000, true);
}

#[test]
fn quote_exact_in_matches_onchain_swap_up_with_bitmap_extension() {
    let (mut market, pool) = seeded_extension_pool();
    // Price is ~700 Y per X at tick 65536, so the Y input must be large
    // enough that X out rounds to a non-zero amount.
    let quoted = quote(&market, pool, 1_000_000, false);
    assert!(quoted.bitmap_extension.is_some());
    assert_quote_matches_execution(&mut market, pool, 1_000_000, false);
}

#[test]
fn quote_exact_in_reports_amount_left_where_the_program_rejects_the_swap() {
    let mut market = create_funded_market();
    let pool = initialize_static_pool(&mut market, None, SQRT_PRICE_ONE);
    seed_liquidity(&mut market, pool, &seed_ranges(), None, &SEED_DEPOSITS);

    // More X than the seeded Y liquidity can absorb: the quote reports the
    // leftover, the program refuses to partially fill.
    let quoted = quote(&market, pool, 100_000_000, true);
    assert!(quoted.quote.amount_left > 0);

    let logs = execute_swap_expect_failure(
        &mut market,
        pool,
        100_000_000,
        true,
        &quoted.tick_arrays,
        quoted.bitmap_extension,
        None,
    );
    assert!(
        logs.iter()
            .any(|log| log.contains("NotConsumingFullAmountIn")),
        "expected NotConsumingFullAmountIn, got {logs:#?}"
    );
}

#[test]
fn quote_exact_in_respects_time_based_activation() {
    let mut market = create_funded_market();
    let now = unix_timestamp(&market.svm);
    let swap_point = now + 60;
    let pool = initialize_time_gated_pool(&mut market, swap_point);
    seed_liquidity(&mut market, pool, &seed_ranges(), None, &SEED_DEPOSITS);

    let err = quote_result(&market, pool, 1_000, true).unwrap_err();
    assert_eq!(err, PoolError::InvalidActivationAccess.into());

    set_unix_timestamp(&mut market.svm, swap_point as i64);
    assert_quote_matches_execution(&mut market, pool, 1_000, true);
}
