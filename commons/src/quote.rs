//! Off-chain swap quotes: a pure port of the program's `ix_swap` loop over
//! parsed account state. [`quote_exact_in`] matches the on-chain `swap`
//! instruction for the same inputs, including dynamic fee, MM liquidity,
//! in-tick limit orders, collect-fee mode, and token-2022 transfer fees.
use anchor_lang::prelude::*;
use std::cmp::{max, min};

use crate::*;

#[derive(Debug, Clone, Copy)]
pub struct QuoteExactInParams<'a> {
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
    pub current_slot: u64,
    pub current_timestamp: u64,
    pub epoch: u64,
    /// Raw input mint account data, required to model token-2022 transfer
    /// fees. `None` skips transfer-fee handling (correct for legacy mints).
    pub input_mint_data: Option<&'a [u8]>,
    /// Raw output mint account data; same contract as `input_mint_data`.
    pub output_mint_data: Option<&'a [u8]>,
    /// When set, must equal the pool's input mint. `None` skips the check
    /// because mint account bytes do not carry the account address.
    pub input_mint: Option<Pubkey>,
    /// When set, must equal the pool's output mint.
    pub output_mint: Option<Pubkey>,
}

/// One activation slot after the quote, matching what `ix_swap` would persist
/// when the swap consumes its full input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QuoteActivationSlot {
    pub activation_mode: u8,
    /// Bonding-curve `is_reach_target`. Always false for open and time-based slots.
    pub is_reach_target: bool,
    /// True when this quote is what flips the bonding-curve flag on.
    pub reached_target: bool,
}

#[derive(Debug, Default, Clone)]
pub struct QuoteExactInResult {
    /// Pool-side consumed input (after the input mint's transfer fee).
    pub consumed_in_amount: u64,
    /// Input the pool could not consume: liquidity ran out inside the
    /// provided tick arrays. The on-chain swap fails with
    /// `NotConsumingFullAmountIn` when this is non-zero.
    pub amount_left: u64,
    /// Pool-side output (before the output mint's transfer fee).
    pub out_amount: u64,
    /// What the user actually receives after the output transfer fee — this
    /// is the value the program compares against `minimum_output_amount`.
    pub transfer_fee_excluded_out_amount: u64,
    pub mm_fee: u64,
    pub limit_order_fee: u64,
    pub protocol_fee: u64,
    pub host_fee: u64,
    pub partner_fee: u64,
    pub next_sqrt_price: u128,
    pub next_tick_id: i32,
    pub next_liquidity: u128,
    /// Indexes of the tick arrays the traversal touched, in traversal order.
    pub consumed_tick_array_indexes: Vec<i32>,
    /// Post-swap activation slots. Empty when the pool has no activation
    /// extension. `reached_target` is set only when `amount_left` is zero,
    /// because a partial swap reverts before the program writes the flag.
    pub post_swap_activations: Vec<QuoteActivationSlot>,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SwapFinalResult {
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
pub struct SwapProtocolFeeSharingResult {
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

fn is_next_tick_id(tick_id: i32, tick_current_id: i32, swap_for_y: bool) -> bool {
    if swap_for_y {
        tick_current_id >= tick_id
    } else {
        tick_current_id < tick_id
    }
}

/// Whether the pool allows swapping right now for `swapper` — the off-chain
/// equivalent of the program's `validate_pool_can_swap`.
pub fn validate_pool_can_swap(
    pool: &DynamicPool,
    swapper: Option<&Pubkey>,
    current_point: u64,
) -> Result<()> {
    if !pool.pool.is_enable_status(PoolStatus::Swap) {
        return Err(PoolError::InvalidActivationAccess.into());
    }
    if let Some(pool_activation) = &pool.pool_activation {
        let is_whitelisted = swapper
            .map(|swapper| pool_activation.whitelisted_swap.eq(swapper))
            .unwrap_or(false);
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
            u128::from(swap_step_result.mm_fee)
                .safe_shl(64)?
                .safe_div(*current_liquidity)?,
        );
    }

    tick.apply_swap_result(swap_for_y, &swap_step_result)?;

    if swap_step_result.next_sqrt_price != tick.sqrt_price {
        // Preserve tick_current_id when no price movement occurs after a
        // downward cross; sqrt_price alone does not record the crossed side.
        if swap_step_result.next_sqrt_price != *current_sqrt_price {
            *current_sqrt_price = swap_step_result.next_sqrt_price;
            let next_tick_id = tick_id_from_sqrt_price(swap_step_result.next_sqrt_price)?;
            if swap_for_y {
                *current_tick_id = max(next_tick_id, tick.tick_id);
            } else {
                *current_tick_id = min(next_tick_id, tick.tick_id.safe_sub(1)?);
            }
        }
    } else if swap_final_result.amount_left == 0 && tick.get_pending_limit_order_amount()? > 0 {
        // Keep the boundary current while limit-order liquidity remains.
        *current_sqrt_price = tick.sqrt_price;
        *current_tick_id = if swap_for_y {
            tick.tick_id
        } else {
            tick.tick_id.safe_sub(1)?
        };
    } else {
        *current_sqrt_price = tick.sqrt_price;

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
/// The traversal, fee math and rounding mirror the on-chain swap loop.
/// When [`QuoteExactInResult::amount_left`] is zero, the amounts equal what
/// `swap` produces, and [`QuoteExactInResult::post_swap_activations`] is the
/// activation extension `ix_swap` writes after the loop. A partial quote
/// leaves `reached_target` false because the program reverts before that write.
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
        current_slot,
        current_timestamp,
        epoch,
        input_mint_data,
        output_mint_data,
        input_mint,
        output_mint,
    } = params;

    if input_amount == 0 {
        return Err(PoolError::AmountIsZero.into());
    }
    if bitmap_extension
        .map(|extension| extension.pool != pool_address)
        .unwrap_or(false)
    {
        return Err(PoolError::InvalidAccount.into());
    }

    let mut pool = dynamic_pool.pool;
    let input_token_flag = if swap_for_y {
        pool.token_x_flag
    } else {
        pool.token_y_flag
    };
    let output_token_flag = if swap_for_y {
        pool.token_y_flag
    } else {
        pool.token_x_flag
    };
    let token_2022_flag: u8 = TokenProgramFlags::TokenProgram2022.into();
    if (input_token_flag == token_2022_flag && input_mint_data.is_none())
        || (output_token_flag == token_2022_flag && output_mint_data.is_none())
    {
        return Err(PoolError::InvalidParameters.into());
    }
    let input_mint_address = if swap_for_y {
        pool.token_x_mint
    } else {
        pool.token_y_mint
    };
    let output_mint_address = if swap_for_y {
        pool.token_y_mint
    } else {
        pool.token_x_mint
    };
    if input_mint.is_some_and(|mint| mint != input_mint_address)
        || output_mint.is_some_and(|mint| mint != output_mint_address)
    {
        return Err(PoolError::InvalidParameters.into());
    }
    let current_point = get_current_point(pool.activation_type, current_slot, current_timestamp)?;
    validate_pool_can_swap(dynamic_pool, swapper.as_ref(), current_point)?;

    let fee_setting = pool.get_fee_setting(swap_for_y, has_referral)?;

    let transfer_fee_excluded_input_amount = match input_mint_data {
        Some(mint_data) => {
            calculate_transfer_fee_excluded_amount(mint_data, epoch, input_amount)?.amount
        }
        None => input_amount,
    };

    // load all tick arrays from current active id
    let mut current_tick_index =
        TickArray::get_tick_index_from_tick_id(pool.tick_current_id, pool.tick_spacing)?;
    current_tick_index = pool
        .get_non_zero_liquidity_next_index(swap_for_y, current_tick_index, bitmap_extension)?
        .ok_or(PoolError::LiquidityIsZero)?;

    let mut traversal: Vec<(i32, Vec<Tick>)> = vec![];
    let mut tick_arrays_iter = tick_arrays.iter().peekable();
    while let Some(tick_array) = tick_arrays_iter.next() {
        if tick_array.fixed.tick_index != current_tick_index {
            continue;
        }
        // Like the program, only arrays the traversal reaches are bound to the pool.
        if tick_array.fixed.pool != pool_address {
            return Err(PoolError::InvalidTickArray.into());
        }
        traversal.push((tick_array.fixed.tick_index, tick_array.ticks.base_ticks()));

        // No next index is needed after the last supplied TickArray.
        if tick_arrays_iter.peek().is_none() {
            break;
        }

        let next_from = if swap_for_y {
            current_tick_index.safe_sub(1)?
        } else {
            current_tick_index.safe_add(1)?
        };

        if let Some(idx) =
            pool.get_non_zero_liquidity_next_index(swap_for_y, next_from, bitmap_extension)?
        {
            current_tick_index = idx;
        } else {
            // no more liquidity
            break;
        }
    }

    let mut swap_final_result = SwapFinalResult {
        amount_left: transfer_fee_excluded_input_amount,
        ..Default::default()
    };

    // loop to swap
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
    // The fee rate is fixed for the whole swap: the program reads it once, from
    // the pool's pre-swap sqrt price, before entering the tick loop.
    let trading_fee_numerator = pool.get_total_trading_fee_numerator(current_point)?;

    let cached_tick_current_id = pool.tick_current_id;
    let mut consumed_tick_array_indexes = vec![];
    'outer: for (tick_array_index, ticks) in traversal.iter_mut() {
        consumed_tick_array_indexes.push(*tick_array_index);

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

    let init_sqrt_price = dynamic_pool.pool.init_sqrt_price;
    let post_swap_activations = match &dynamic_pool.pool_activation {
        Some(activation) if swap_final_result.amount_left == 0 => {
            quote_activation_slots(activation, init_sqrt_price, current_sqrt_price, true)?
        }
        Some(activation) => {
            quote_activation_slots(activation, init_sqrt_price, current_sqrt_price, false)?
        }
        None => vec![],
    };

    let transfer_fee_excluded_out_amount = match output_mint_data {
        Some(mint_data) => {
            calculate_transfer_fee_excluded_amount(
                mint_data,
                epoch,
                swap_final_result.user_receive_amount,
            )?
            .amount
        }
        None => swap_final_result.user_receive_amount,
    };

    Ok(QuoteExactInResult {
        consumed_in_amount: swap_final_result.user_pay_amount,
        amount_left: swap_final_result.amount_left,
        out_amount: swap_final_result.user_receive_amount,
        transfer_fee_excluded_out_amount,
        mm_fee: swap_final_result.mm_fee,
        limit_order_fee: swap_final_result.limit_order_fee,
        protocol_fee: protocol_fee_sharing_result.protocol_fee,
        host_fee: protocol_fee_sharing_result.host_fee,
        partner_fee: protocol_fee_sharing_result.partner_fee,
        next_sqrt_price: current_sqrt_price,
        next_tick_id: current_tick_id,
        next_liquidity: current_liquidity,
        consumed_tick_array_indexes,
        post_swap_activations,
    })
}

fn quote_activation_slots(
    activation: &PoolActivation,
    init_sqrt_price: u128,
    next_sqrt_price: u128,
    commit: bool,
) -> Result<Vec<QuoteActivationSlot>> {
    let mut activation = *activation;
    let mut slots = Vec::with_capacity(activation.activations.len());
    for info in activation.activations.iter_mut() {
        let before = bonding_curve_is_reach_target(info)?;
        if commit {
            apply_activation_post_swap(info, init_sqrt_price, next_sqrt_price)?;
        }
        let after = bonding_curve_is_reach_target(info)?;
        slots.push(QuoteActivationSlot {
            activation_mode: info.activation_mode,
            is_reach_target: after,
            reached_target: commit && !before && after,
        });
    }
    Ok(slots)
}
