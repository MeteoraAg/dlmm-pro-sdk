//! Off-chain swap quotes: a pure port of the program's `ix_swap` loop over
//! parsed account state. [`quote_exact_in`] matches the on-chain `swap`
//! instruction for the same inputs, including dynamic fee, MM liquidity,
//! in-tick limit orders, collect-fee mode, and token-2022 transfer fees.
use anchor_lang::prelude::*;
use std::cmp::{max, min};

use crate::*;

#[derive(Debug, Clone, Copy)]
pub struct QuoteExactInParams<'a> {
    /// The pool account's address; reached tick arrays and the bitmap extension must belong to it.
    pub pool_address: Pubkey,
    pub pool: &'a DynamicPool,
    /// Parsed tick arrays, ordered for the traversal like the swap
    /// instruction's remaining accounts: descending indices when
    /// `swap_for_y`, ascending otherwise (see [`tick_arrays_for_swap`]).
    pub tick_arrays: &'a [DynamicTickArray],
    pub bitmap_extension: Option<&'a TickArrayBitmapExtension>,
    /// Input amount before the input mint's transfer fee.
    pub input_amount: u64,
    pub swap_for_y: bool,
    pub has_referral: bool,
    /// The swapping wallet; only used to honor the whitelisted-swap bypass
    /// during pre-activation.
    pub swapper: Option<Pubkey>,
    pub clock: &'a Clock,
    /// Raw input mint account data, legacy SPL or Token-2022.
    pub input_mint_data: &'a [u8],
    /// Raw output mint account data, legacy SPL or Token-2022.
    pub output_mint_data: &'a [u8],
}

#[derive(Debug, Default, Clone)]
pub struct QuoteExactInResult {
    /// Input the pool takes, after `transfer_fee_in`.
    pub consumed_in_amount: u64,
    /// Input the pool could not consume: liquidity ran out inside the
    /// provided tick arrays. The on-chain swap fails with
    /// `NotConsumingFullAmountIn` when this is non-zero.
    pub amount_left: u64,
    /// Output the pool sends, before `transfer_fee_out`.
    pub out_amount: u64,
    /// What the user receives, `EvtSwap.amount_out`. The program compares it
    /// against `minimum_output_amount`.
    pub transfer_fee_excluded_out_amount: u64,
    /// Input mint transfer fee on `input_amount`, as `EvtSwap.transfer_fee_in`.
    pub transfer_fee_in: u64,
    /// Output mint transfer fee on `out_amount`, as `EvtSwap.transfer_fee_out`.
    pub transfer_fee_out: u64,
    pub mm_fee: u64,
    pub limit_order_fee: u64,
    pub protocol_fee: u64,
    pub host_fee: u64,
    pub partner_fee: u64,
    pub next_sqrt_price: u128,
    pub next_tick_id: i32,
    pub next_liquidity: u128,
}

#[derive(Debug, Default, Clone, Copy)]
struct SwapFinalResult {
    // user amounts
    pub user_pay_amount: u64,
    pub user_receive_amount: u64,
    pub amount_left: u64,
    // fees amounts
    pub mm_fee: u64,
    pub limit_order_fee: u64,
    pub protocol_fee_on_mm_fee: u64,
    pub protocol_fee_on_limit_order_fee: u64,
}

#[derive(Debug, Default, Clone, Copy)]
struct SwapProtocolFeeSharingResult {
    pub protocol_fee: u64,
    pub host_fee: u64,
    pub partner_fee: u64,
}

impl SwapFinalResult {
    pub fn apply_swap_result(&mut self, swap_step_result: &SwapStepResult) -> Result<()> {
        let SwapStepResult {
            included_fee_amount_in,
            excluded_fee_out_amount,
            mm_fee,
            protocol_fee_on_limit_order_fee,
            limit_order_fee,
            protocol_fee_on_mm_fee,
            next_sqrt_price: _,
            processed_order_amount_out: _,
            open_order_amount_out: _,
        } = *swap_step_result;

        self.user_pay_amount = self.user_pay_amount.safe_add(included_fee_amount_in)?;
        self.user_receive_amount = self.user_receive_amount.safe_add(excluded_fee_out_amount)?;
        self.amount_left = self.amount_left.safe_sub(included_fee_amount_in)?;

        self.mm_fee = self.mm_fee.safe_add(mm_fee)?;

        self.limit_order_fee = self.limit_order_fee.safe_add(limit_order_fee)?;

        self.protocol_fee_on_mm_fee = self
            .protocol_fee_on_mm_fee
            .safe_add(protocol_fee_on_mm_fee)?;
        self.protocol_fee_on_limit_order_fee = self
            .protocol_fee_on_limit_order_fee
            .safe_add(protocol_fee_on_limit_order_fee)?;

        Ok(())
    }

    pub fn get_protocol_fee_sharing_result(
        &self,
        fee_setting: &FeeSetting,
    ) -> Result<SwapProtocolFeeSharingResult> {
        let mut protocol_fee = self
            .protocol_fee_on_mm_fee
            .safe_add(self.protocol_fee_on_limit_order_fee)?;
        let host_fee = if fee_setting.has_referral {
            let total_limit_order_fee = self
                .limit_order_fee
                .safe_add(self.protocol_fee_on_limit_order_fee)?;
            let (virtual_protocol_fee_on_limit_order_fee, _) = calculate_shared_amounts(
                total_limit_order_fee,
                fee_setting.mm_protocol_fee_bps.into(),
                MAX_BASIS_POINT.into(),
                Rounding::Down,
            )?;

            let protocol_fee_on_limit_order_fee =
                virtual_protocol_fee_on_limit_order_fee.min(self.protocol_fee_on_limit_order_fee);

            let total_protocol_fee =
                protocol_fee_on_limit_order_fee.safe_add(self.protocol_fee_on_mm_fee)?;

            let (host_fee, _) = calculate_shared_amounts(
                total_protocol_fee,
                HOST_FEE_BPS.into(),
                MAX_BASIS_POINT.into(),
                Rounding::Down,
            )?;
            // Subtract host from the FULL protocol fee (mm + full LO cut), not
            // from the host-capped base, so no protocol fee is silently dropped.
            protocol_fee = protocol_fee.safe_sub(host_fee)?;
            host_fee
        } else {
            0
        };

        let partner_fee = if fee_setting.has_partner && fee_setting.partner_fee_bps > 0 {
            let (partner_fee, remaining_protocol_fee) = calculate_shared_amounts(
                protocol_fee,
                fee_setting.partner_fee_bps.into(),
                MAX_BASIS_POINT.into(),
                Rounding::Down,
            )?;
            protocol_fee = remaining_protocol_fee;
            partner_fee
        } else {
            0
        };

        Ok(SwapProtocolFeeSharingResult {
            protocol_fee,
            host_fee,
            partner_fee,
        })
    }
}

// we only care for next tick
fn is_next_tick_id(tick_id: i32, tick_current_id: i32, swap_for_y: bool) -> bool {
    if swap_for_y {
        // when user swap for y, next tick id is always smaller than or equal tick_current_id
        // (tick_id + 1, tick_id], (tick_id, tick_id - 1], ...
        tick_current_id >= tick_id
    } else {
        // when user swap for x, next tick id is always greater than tick_current_id
        // [tick_id, tick_id + 1), [tick_id + 1, tick_id + 2), ...
        tick_current_id < tick_id
    }
}

/// The program's `validate_pool_can_swap` at `current_point`:
/// `InvalidActivationAccess` while swaps are paused or an activation slot
/// still blocks `swapper`.
pub fn validate_pool_can_swap(
    pool: &DynamicPool,
    swapper: Option<&Pubkey>,
    current_point: u64,
) -> Result<()> {
    if !pool.pool.is_enable_status(PoolStatus::Swap) {
        return Err(PoolError::InvalidActivationAccess.into());
    }
    if let Some(pool_activation) = &pool.pool_activation {
        let is_whitelisted =
            swapper.is_some_and(|swapper| pool_activation.whitelisted_swap.eq(swapper));
        if !is_whitelisted {
            for pool_activation in pool_activation.activations.iter() {
                if !get_activation_access(pool_activation, |a| a.can_swap(current_point))? {
                    return Err(PoolError::InvalidActivationAccess.into());
                }
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn swap_with_tick(
    swap_for_y: bool,
    trading_fee_numerator: u64,
    fee_setting: &FeeSetting,
    tick: &mut Tick,
    pool: &Pool,
    current_sqrt_price: &mut u128,
    current_tick_id: &mut i32,
    current_liquidity: &mut u128,
    current_fee_growth_global: &mut u128,
    swap_final_result: &mut SwapFinalResult,
) -> Result<bool> {
    let swap_step_result = tick.get_swap_result_exact_in(
        swap_final_result.amount_left,
        trading_fee_numerator,
        fee_setting,
        swap_for_y,
        *current_sqrt_price,
        *current_liquidity,
    )?;

    swap_final_result.apply_swap_result(&swap_step_result)?;

    if *current_liquidity != 0 {
        *current_fee_growth_global = (*current_fee_growth_global).wrapping_add(
            (u128::from(swap_step_result.mm_fee) << 64).safe_div(*current_liquidity)?,
        );
    }

    tick.apply_swap_result(swap_for_y, &swap_step_result)?;

    if swap_step_result.next_sqrt_price != tick.sqrt_price {
        // we don't cross tick, just update price and tick id, this happens when it's the final swap step
        // A downward cross in swap_for_y stores the boundary as:
        //     tick_current_id    = tick_id - 1
        //     current_sqrt_price = tick.sqrt_price  (== P(tick_id))
        //     current_liquidity  = below-range
        // The `- 1` is the ONLY record that the tick was crossed. sqrt_price cannot express it.
        // Now take a following swap_for_y whose input is too small to move the price.
        // The swap step returns next_sqrt_price == current_sqrt_price while still consuming the input.
        // It's going sync *current_tick_id = tick_id_from_sqrt_price(swap_step_result.next_sqrt_price)?;
        // Which update the tick_current_id = tick_id
        // The next swap_for_y crosses the SAME tick a second time going to deducts liquidity_net again
        if swap_step_result.next_sqrt_price != *current_sqrt_price {
            *current_sqrt_price = swap_step_result.next_sqrt_price;
            let next_tick_id = tick_id_from_sqrt_price(swap_step_result.next_sqrt_price)?;
            // ensure current_tick_id is not crossed:
            if swap_for_y {
                *current_tick_id = max(next_tick_id, tick.tick_id);
            } else {
                *current_tick_id = min(next_tick_id, tick.tick_id.safe_sub(1)?);
            }
        }
    } else if swap_final_result.amount_left == 0 && tick.get_pending_limit_order_amount()? > 0 {
        // MM liquidity reached the tick boundary and the input is fully consumed, but this
        // tick still has unfilled limit-order liquidity. Do NOT cross: stop exactly at the
        // boundary and keep this tick "current" so a subsequent same-direction swap revisits
        // it and fills the remaining limit orders instead of stranding them.
        //
        // The stored tick_current_id must keep the pool invariant
        // (liquidity == liquidity of range [tick_current_id, tick_current_id + 1)) and let
        // is_next_tick_id re-include this tick next time:
        // - swap_for_y: price sits at the lower edge of [tick_id, tick_id + 1); liquidity is
        //   unchanged (not crossed), so tick_current_id = tick_id.
        // - swap_for_x: price sits at the upper edge of [tick_id - 1, tick_id); liquidity is
        //   still the below-range (not crossed), so tick_current_id = tick_id - 1.
        // Update of current_sqrt_price can be side agnostic because bid order is guaranteed when swap_for_y, while ask order is guaranteed when swap_for_x.
        *current_sqrt_price = tick.sqrt_price;
        *current_tick_id = if swap_for_y {
            tick.tick_id
        } else {
            tick.tick_id.safe_sub(1)?
        };
    } else {
        // otherwise, we cross tick
        *current_sqrt_price = tick.sqrt_price;

        // - swap_for_y: current_tick_id is fallen in range [tick_id - 1, tick_id);
        // - swap_for_x: current_tick_id is fallen in range [tick_id, tick_id + 1);
        let (signed_liquidity_net, next_tick) = if swap_for_y {
            (-tick.liquidity_net, tick.tick_id.safe_sub(1)?)
        } else {
            (tick.liquidity_net, tick.tick_id)
        };

        *current_tick_id = next_tick;
        *current_liquidity = add_liquidity_delta(*current_liquidity, signed_liquidity_net)?;

        let (fee_growth_global_x, fee_growth_global_y) = if fee_setting.fees_on_token_x {
            (*current_fee_growth_global, pool.fee_growth_global_y)
        } else {
            (pool.fee_growth_global_x, *current_fee_growth_global)
        };

        tick.cross_update(fee_growth_global_x, fee_growth_global_y)?;
    }

    if swap_final_result.amount_left == 0 {
        return Ok(true);
    }

    Ok(false)
}

/// Quote an exact-in swap against parsed pool state.
///
/// The traversal, fee math and rounding mirror the on-chain swap loop. When
/// [`QuoteExactInResult::amount_left`] is zero, the amounts equal what `swap`
/// produces.
pub fn quote_exact_in(params: QuoteExactInParams<'_>) -> Result<QuoteExactInResult> {
    let QuoteExactInParams {
        pool_address,
        pool: dynamic_pool,
        tick_arrays,
        bitmap_extension,
        input_amount,
        swap_for_y,
        has_referral,
        swapper,
        clock,
        input_mint_data,
        output_mint_data,
    } = params;

    require!(input_amount > 0, PoolError::AmountIsZero);
    if let Some(bitmap_extension) = bitmap_extension {
        require!(
            bitmap_extension.pool == pool_address,
            PoolError::InvalidAccount
        );
    }

    let mut pool = dynamic_pool.pool;
    let current_point = get_current_point(pool.activation_type, clock)?;
    validate_pool_can_swap(dynamic_pool, swapper.as_ref(), current_point)?;

    let fee_setting = pool.get_fee_setting(swap_for_y, has_referral)?;

    let TransferFeeExcludedAmount {
        amount: transfer_fee_excluded_input_amount,
        transfer_fee: transfer_fee_in,
    } = calculate_transfer_fee_excluded_amount(input_mint_data, clock.epoch, input_amount)?;

    let current_timestamp: u64 = try_cast(clock.unix_timestamp)?;

    let mut current_tick_array_index =
        TickArray::get_tick_index_from_tick_id(pool.tick_current_id, pool.tick_spacing)?;
    current_tick_array_index = pool
        .get_non_zero_liquidity_next_index(swap_for_y, current_tick_array_index, bitmap_extension)?
        .ok_or(PoolError::LiquidityIsZero)?;

    let mut traversal: Vec<Vec<Tick>> = vec![];
    let mut tick_arrays_iter = tick_arrays.iter().peekable();
    while let Some(tick_array) = tick_arrays_iter.next() {
        if tick_array.fixed.tick_index != current_tick_array_index {
            continue;
        }
        require!(
            tick_array.fixed.pool == pool_address,
            PoolError::InvalidTickArray
        );
        traversal.push(tick_array.ticks.base_ticks());

        // No next index is needed after the last supplied TickArray.
        if tick_arrays_iter.peek().is_none() {
            break;
        }

        let next_from = if swap_for_y {
            current_tick_array_index.safe_sub(1)?
        } else {
            current_tick_array_index.safe_add(1)?
        };

        if let Some(idx) =
            pool.get_non_zero_liquidity_next_index(swap_for_y, next_from, bitmap_extension)?
        {
            current_tick_array_index = idx;
        } else {
            // no more liquidity
            break;
        }
    }

    let mut swap_final_result = SwapFinalResult {
        amount_left: transfer_fee_excluded_input_amount,
        ..Default::default()
    };

    let mut current_sqrt_price = pool.sqrt_price;
    let mut current_tick_id = pool.tick_current_id;
    let mut current_liquidity = pool.liquidity;

    let mut current_fee_growth_global = if fee_setting.fees_on_token_x {
        pool.fee_growth_global_x
    } else {
        pool.fee_growth_global_y
    };

    // Update decay of volatility accumulator
    pool.update_dynamic_fee_pre_swap(current_timestamp)?;
    let trading_fee_numerator = pool.get_total_trading_fee_numerator(current_point)?;

    let cached_tick_current_id = pool.tick_current_id;
    'outer: for ticks in traversal.iter_mut() {
        let mut process = |tick: &mut Tick| -> Result<bool> {
            if !is_next_tick_id(tick.tick_id, cached_tick_current_id, swap_for_y) {
                return Ok(false);
            }
            // skip if tick is zero liquidity
            if !tick.is_non_zero_liquidity() {
                return Ok(false);
            }
            swap_with_tick(
                swap_for_y,
                trading_fee_numerator,
                &fee_setting,
                tick,
                &pool,
                &mut current_sqrt_price,
                &mut current_tick_id,
                &mut current_liquidity,
                &mut current_fee_growth_global,
                &mut swap_final_result,
            )
        };

        if swap_for_y {
            for tick in ticks.iter_mut().rev() {
                if process(tick)? {
                    break 'outer;
                }
            }
        } else {
            for tick in ticks.iter_mut() {
                if process(tick)? {
                    break 'outer;
                }
            }
        }
    }

    let protocol_fee_sharing_result =
        swap_final_result.get_protocol_fee_sharing_result(&fee_setting)?;

    let TransferFeeExcludedAmount {
        amount: transfer_fee_excluded_out_amount,
        transfer_fee: transfer_fee_out,
    } = calculate_transfer_fee_excluded_amount(
        output_mint_data,
        clock.epoch,
        swap_final_result.user_receive_amount,
    )?;

    Ok(QuoteExactInResult {
        consumed_in_amount: swap_final_result.user_pay_amount,
        amount_left: swap_final_result.amount_left,
        out_amount: swap_final_result.user_receive_amount,
        transfer_fee_excluded_out_amount,
        transfer_fee_in,
        transfer_fee_out,
        mm_fee: swap_final_result.mm_fee,
        limit_order_fee: swap_final_result.limit_order_fee,
        protocol_fee: protocol_fee_sharing_result.protocol_fee,
        host_fee: protocol_fee_sharing_result.host_fee,
        partner_fee: protocol_fee_sharing_result.partner_fee,
        next_sqrt_price: current_sqrt_price,
        next_tick_id: current_tick_id,
        next_liquidity: current_liquidity,
    })
}
