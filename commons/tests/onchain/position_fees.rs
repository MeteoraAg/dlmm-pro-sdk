//! Pending-fee parity: compute the claimable fees off-chain from pool, position
//! and tick state, then refresh and claim on-chain and compare the transfers.

use crate::common::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::pubkey::Pubkey;
use anchor_lang::{InstructionData, ToAccountMetas};
use dlmm_pro_commons::dlmm_pro::client::{accounts, args};
use dlmm_pro_commons::dlmm_pro::types;
use dlmm_pro_commons::*;
use solana_signer::Signer;

fn swap_both_ways(market: &mut Market, pool: Pubkey, amount: u64) {
    for swap_for_y in [true, false] {
        let inputs = quote(market, pool, amount, swap_for_y);
        execute_swap(
            market,
            pool,
            amount,
            swap_for_y,
            &inputs.tick_arrays,
            inputs.bitmap_extension,
            None,
        );
    }
}

fn refresh_and_claim(
    market: &mut Market,
    pool: Pubkey,
    seeded: &SeededPosition,
    ranges: &[types::TickRange],
    bitmap: u64,
) {
    let refresh = refresh_fees_and_rewards_ix(market, pool, seeded, ranges, bitmap);
    let claim = Instruction {
        program_id: dlmm_pro::ID,
        accounts: accounts::ClaimFee {
            pool,
            pool_authority: pool_authority::ID,
            position: seeded.position,
            nft_account: seeded.nft_account,
            signer: market.lp.pubkey(),
            reserve_x: derive_reserve(market.token_x_mint, pool),
            reserve_y: derive_reserve(market.token_y_mint, pool),
            user_token_x: market.lp_token_x,
            user_token_y: market.lp_token_y,
            token_x_mint: market.token_x_mint,
            token_y_mint: market.token_y_mint,
            token_x_program: market.token_x_program,
            token_y_program: litesvm_token::TOKEN_ID,
            memo_program: MEMO_PROGRAM_ID,
            event_authority: derive_event_authority(),
            program: dlmm_pro::ID,
        }
        .to_account_metas(None),
        data: args::ClaimFee {
            min_amount_x: 0,
            min_amount_y: 0,
            remaining_account_info: types::RemainingAccountsInfo { slices: vec![] },
        }
        .data(),
    };
    send(
        &mut market.svm,
        &[refresh, claim],
        &market.lp,
        &[&market.lp],
    );
}

#[test]
fn claimable_fees_match_onchain_claim() {
    let mut market = create_funded_market();
    let pool = initialize_static_pool(&mut market, None, SQRT_PRICE_ONE);
    let ranges = seed_ranges(0);
    // Fees earned before the position exists must not be attributed to it.
    seed_liquidity(&mut market, pool, &ranges, None, &SEED_DEPOSITS);
    swap_both_ways(&mut market, pool, 20_000);
    let seeded = seed_liquidity(&mut market, pool, &ranges, None, &SEED_DEPOSITS);
    swap_both_ways(&mut market, pool, 20_000);

    // Refresh the first slot, so the claim below transfers both its pending
    // fees and the growth since that refresh.
    let refresh = refresh_fees_and_rewards_ix(&market, pool, &seeded, &ranges[..1], 1);
    send(&mut market.svm, &[refresh], &market.lp, &[&market.lp]);
    swap_both_ways(&mut market, pool, 20_000);

    let pool_state = load_pool(&market, pool);
    let positions = base_positions(&market, &pool_state, seeded.position);
    assert!(positions[0].fee_pending_x > 0 && positions[0].fee_pending_y > 0);
    let ticks = base_ticks(&market, pool, &pool_state, &ranges);
    let (fee_x, fee_y) = claimable_fees(&pool_state.pool, &positions, &ticks).unwrap();

    let x_before = token_amount(&market.svm, &market.lp_token_x);
    let y_before = token_amount(&market.svm, &market.lp_token_y);
    refresh_and_claim(&mut market, pool, &seeded, &ranges, 0b11);
    assert_eq!(
        token_amount(&market.svm, &market.lp_token_x) - x_before,
        fee_x
    );
    assert_eq!(
        token_amount(&market.svm, &market.lp_token_y) - y_before,
        fee_y
    );
    for position in base_positions(&market, &pool_state, seeded.position) {
        assert_eq!((position.fee_pending_x, position.fee_pending_y), (0, 0));
    }
}
