//! State types that live in the dynamic tail of program accounts.
//!
//! `declare_program!` only generates the fixed account headers (`Pool` is 544
//! bytes, `TickArray` 56, ...). Everything stored after `8 + INIT_SPACE` is
//! defined here, ported 1:1 from the program source so byte layouts match.
use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};
use num_enum::{IntoPrimitive, TryFromPrimitive};
use ruint::aliases::{U192, U256, U320};

use crate::*;

pub use crate::dlmm_pro::accounts::{
    DynamicConfig, LimitOrder, Operator, Oracle, Pool, PositionArray, StaticConfig, TickArray,
    TickArrayBitmapExtension,
};
/// `TokenBadge` is no longer a dlmm-pro account: it is owned by the external
/// access-registry program (see [`crate::pda::ACCESS_REGISTRY_ID`]). The IDL
/// still carries its layout as a type because pool creation takes optional
/// token badge accounts.
pub use crate::dlmm_pro::types::TokenBadge;
pub use crate::dlmm_pro::types::{
    BaseFeeConfig, DynamicFeeConfig, FeeConfig, PoolPartner, PositionVesting, VariableFee,
};

pub const POOL_INIT_SPACE: usize = 544;
pub const TICK_ARRAY_INIT_SPACE: usize = 56;
pub const ORACLE_INIT_SPACE: usize = 48;
pub const LIMIT_ORDER_INIT_SPACE: usize = 104;
pub const POSITION_ARRAY_INIT_SPACE: usize = 104;
pub const TICK_ARRAY_BITMAP_EXTENSION_INIT_SPACE: usize = 800;

/// Little-endian u16 stored without alignment requirements.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Pod, Zeroable)]
pub struct Z16 {
    pub inner: [u8; 2],
}

impl From<Z16> for u16 {
    fn from(f: Z16) -> Self {
        u16::from_le_bytes(f.inner)
    }
}

/// Little-endian u32 stored without alignment requirements.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Pod, Zeroable)]
pub struct Z32 {
    pub inner: [u8; 4],
}

impl From<Z32> for u32 {
    fn from(f: Z32) -> Self {
        u32::from_le_bytes(f.inner)
    }
}

/// Little-endian 5-byte unsigned integer, widened to u64.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Pod, Zeroable)]
pub struct Z40 {
    pub inner: [u8; 5],
}

impl From<Z40> for u64 {
    fn from(f: Z40) -> Self {
        let mut padded = [0u8; 8];
        padded[..5].copy_from_slice(&f.inner);
        u64::from_le_bytes(padded)
    }
}

/// Little-endian u64 stored without alignment requirements.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Pod, Zeroable)]
pub struct Z64 {
    pub inner: [u8; 8],
}

impl From<Z64> for u64 {
    fn from(f: Z64) -> Self {
        u64::from_le_bytes(f.inner)
    }
}

/// collect fee mode
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, IntoPrimitive, TryFromPrimitive)]
pub enum CollectFeeMode {
    /// Both token, in this mode only out token is collected
    OutputToken,
    /// Only token Y
    OnlyY,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, IntoPrimitive, TryFromPrimitive)]
pub enum PoolType {
    Static,
    Dynamic,
    LaunchPool,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, IntoPrimitive, TryFromPrimitive)]
pub enum PoolExtension {
    LiquidityMining,
    ActivationAccess,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, IntoPrimitive, TryFromPrimitive)]
pub enum PoolStatus {
    Swap,
    AddLiquidity,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, IntoPrimitive, TryFromPrimitive)]
pub enum TokenProgramFlags {
    TokenProgram,
    TokenProgram2022,
}

pub fn is_support_extension(extension_bytes: u8, extension: PoolExtension) -> bool {
    extension_bytes & (1u8 << u8::from(extension)) != 0
}

pub fn add_liquidity_delta(liquidity: u128, delta: i128) -> Result<u128> {
    if delta == 0 {
        return Ok(liquidity);
    }
    let final_liquidity = if delta > 0 {
        liquidity.safe_add(delta.safe_cast()?)?
    } else {
        liquidity.safe_sub(delta.unsigned_abs())?
    };
    Ok(final_liquidity)
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
pub struct Tick {
    // market making fields
    pub sqrt_price: u128, // cached price for calculation
    pub liquidity_net: i128,
    pub liquidity_gross: u128,
    pub fee_growth_outside_x: u128, // fee per unit of liquidity, Q64.64 number
    pub fee_growth_outside_y: u128, // fee per unit of liquidity, Q64.64 number
    // number of position and limit order references
    pub ref_count: u64,
    // global fields
    pub tick_id: i32,
    pub _padding_0: [u8; 3],
    /// limit order fields
    pub limit_order_ask_side: u8,
    pub open_order_amount: u64,
    pub total_processing_order_amount: u64,
    pub processed_order_remaining_amount: u64,
    pub order_age: u64,
    pub fulfilled_order_amount_x: u64,
    pub fulfilled_order_amount_y: u64,
    pub limit_order_fee_ask_side: u64,
    pub limit_order_fee_bid_side: u64,
}

impl Default for Tick {
    fn default() -> Self {
        Zeroable::zeroed()
    }
}

pub const TICK_INIT_SPACE: usize = 160;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
pub struct TickWithReward {
    pub inner: Tick,
    // total_reward << 64 / liquidity
    pub reward_growths_outside: [u128; NUM_REWARDS],
}

impl Default for TickWithReward {
    fn default() -> Self {
        Zeroable::zeroed()
    }
}

pub const TICK_WITH_REWARD_INIT_SPACE: usize = 192;

/// Stores the state relevant for tracking liquidity mining rewards
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
pub struct PoolRewardInfo {
    /// Reward token mint.
    pub mint: Pubkey,
    /// Reward vault token account.
    pub vault: Pubkey,
    /// Authority account that allows to set emission of rewards
    pub authority: Pubkey,
    /// emission per second
    pub emission_per_second: u128, // Q64.64
    /// Reward open time
    pub open_time: u64,
    /// Reward end time
    pub end_time: u64,
    /// The last time reward states were updated.
    pub last_update_time: u64,
    /// Accumulated seconds when the farm distributed rewards but the pool liquidity was zero.
    /// These rewards can be withdrawn using withdraw_ineligible_rewards
    pub cumulative_seconds_with_empty_liquidity_reward: u64,
    /// Reward growth global
    pub reward_growth_global: u128, // reward per unit of liquidity, Q64.64 number
    /// reward token flag
    pub reward_token_flag: u8,
    /// padding
    pub _padding_0: [u8; 15],
}

impl PoolRewardInfo {
    pub fn is_initialized(&self) -> bool {
        self.mint.ne(&Pubkey::default())
    }
}

pub const POOL_REWARD_INFO_INIT_SPACE: usize = 176;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
pub struct PoolReward {
    pub rewards: [PoolRewardInfo; NUM_REWARDS],
}

pub const POOL_REWARD_INIT_SPACE: usize = 352;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct PoolActivationInfo {
    pub activation_mode: u8,
    pub data: [u8; 15],
}

pub const POOL_ACTIVATION_INFO_INIT_SPACE: usize = 16;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
pub struct PoolActivation {
    pub whitelisted_swap: Pubkey,          // like alpha-vault
    pub whitelisted_add_liquidity: Pubkey, // like operator to setup pool liquidity
    pub whitelisted_remove_liquidity: Pubkey,
    pub activations: [PoolActivationInfo; NUMBER_OF_ACTIVATION_MODES],
}

pub const POOL_ACTIVATION_INIT_SPACE: usize = 128;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct Observation {
    pub last_updated_timestamp: u64,
    pub tick_cumulative: i64,
}

impl Observation {
    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.last_updated_timestamp == 0
    }
}

pub const OBSERVATION_INIT_SPACE: usize = 16;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct LimitOrderData {
    pub amount: u64,
    pub age: u64,
    pub tick_id: i32,
    pub is_ask: u8,
    pub _padding_1: [u8; 3],
}

impl LimitOrderData {
    pub fn is_ask(&self) -> bool {
        self.is_ask != 0
    }

    pub fn is_empty(&self) -> bool {
        self.amount == 0 && self.age == 0
    }
}

pub const LIMIT_ORDER_DATA_INIT_SPACE: usize = 24;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
pub struct Position {
    /// unlock liquidity
    pub unlocked_liquidity: u128,
    /// permanent locked liquidity
    pub permanent_locked_liquidity: u128,
    /// vesting liquidity
    pub vesting_liquidity: u128,
    /// total release vesting liquidity
    pub released_vesting_liquidity: u128,
    /// fee per unit of liquidity checkpoint, Q64.64 number
    pub fee_growth_checkpoint_x: u128,
    /// fee per unit of liquidity checkpoint, Q64.64 number
    pub fee_growth_checkpoint_y: u128,
    pub fee_pending_x: u64,
    pub fee_pending_y: u64,
    pub tick_lower_id: i32,
    pub tick_upper_id: i32,
    pub _padding_0: u64,
}

impl Position {
    pub fn total_liquidity(&self) -> Result<u128> {
        let total_liquidity = self
            .permanent_locked_liquidity
            .safe_add(self.unlocked_liquidity)?
            .safe_add(self.vesting_liquidity)?;
        Ok(total_liquidity)
    }
}

pub const POSITION_INIT_SPACE: usize = 128;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct PositionRewardInfo {
    pub growth_inside_checkpoint: u128, // reward per unit of liquidity, Q64.64 number
    pub pending_amount: u64,
    pub _padding_0: [u8; 8],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
pub struct PositionWithReward {
    pub inner: Position,
    pub rewards: [PositionRewardInfo; NUM_REWARDS],
}

pub const POSITION_WITH_REWARD_INIT_SPACE: usize = 192;

#[derive(Debug)]
pub enum LimitOrderStatus {
    NotFilled,
    PartialFilled,
    Fulfilled,
}

#[derive(Debug, Default, PartialEq, Clone, Copy)]
pub struct SwapStepResult {
    pub included_fee_amount_in: u64,
    pub excluded_fee_out_amount: u64,
    pub mm_fee: u64,
    pub protocol_fee_on_mm_fee: u64,
    pub protocol_fee_on_limit_order_fee: u64,
    pub limit_order_fee: u64,
    pub next_sqrt_price: u128,
    // limit order amount out
    pub processed_order_amount_out: u64,
    pub open_order_amount_out: u64,
}

impl SwapStepResult {
    pub fn get_fulfilled_order_amount(&self) -> Result<u64> {
        Ok(self
            .processed_order_amount_out
            .safe_add(self.open_order_amount_out)?)
    }
}

#[derive(Debug, Default, PartialEq, Clone, Copy)]
pub struct FilledAmountResult {
    pub amount_in: u64,
    pub amount_left: u64,
    pub out_amount: u64,
    pub mm_amount_in: u64,
    pub mm_amount_out: u64,
    pub processed_order_amount_out: u64,
    pub open_order_amount_out: u64,
    pub next_sqrt_price: u128,
}

struct LimitOrderSwapAmountFromInput {
    pub amount_in: u64,
    pub amount_left: u64,
    pub out_amount: u64,
}

struct MarketMakingSwapAmountFromInput {
    pub amount_in: u64,
    pub amount_left: u64,
    pub out_amount: u64,
    pub next_sqrt_price: u128,
}

impl Tick {
    pub fn is_non_zero_liquidity(&self) -> bool {
        !(self.liquidity_gross == 0
            && self.open_order_amount == 0
            && self.processed_order_remaining_amount == 0)
    }

    pub fn get_pending_limit_order_amount(&self) -> Result<u64> {
        Ok(self
            .open_order_amount
            .safe_add(self.processed_order_remaining_amount)?)
    }

    pub fn is_limit_order_ask_side(&self) -> bool {
        self.limit_order_ask_side == 1
    }

    pub fn get_limit_order_status(&self, age: u64) -> Result<LimitOrderStatus> {
        if age == self.order_age {
            Ok(LimitOrderStatus::NotFilled)
        } else if age.safe_add(1)? == self.order_age {
            Ok(LimitOrderStatus::PartialFilled)
        } else if age.safe_add(2)? <= self.order_age {
            Ok(LimitOrderStatus::Fulfilled)
        } else {
            Err(PoolError::UndeterminedError.into())
        }
    }

    pub fn get_amount_in(
        sqrt_price: u128,
        out_amount: u64,
        swap_for_y: bool,
        rounding: Rounding,
    ) -> Result<u64> {
        Ok(
            Self::get_amount_in_unchecked(sqrt_price, out_amount, swap_for_y, rounding)?
                .safe_cast()?,
        )
    }

    pub fn get_amount_in_unchecked(
        sqrt_price: u128,
        out_amount: u64,
        swap_for_y: bool,
        rounding: Rounding,
    ) -> Result<U192> {
        if swap_for_y {
            // (amount_y << 128) / price_x128
            let sqrt_price = U256::from(sqrt_price);
            let price = sqrt_price.safe_mul(sqrt_price)?;

            let prod = U256::from(out_amount).safe_shl(128)?;
            let amount = match rounding {
                Rounding::Up => prod.div_ceil(price),
                Rounding::Down => prod.safe_div(price)?,
            };
            Ok(amount.safe_cast()?)
        } else {
            // (price_x128 * amount_x) >> 128
            let sqrt_price = U256::from(sqrt_price);
            let price = U320::from(sqrt_price.safe_mul(sqrt_price)?);

            let prod = price.safe_mul(U320::from(out_amount))?;
            let amount = match rounding {
                Rounding::Up => down_scale_ceil(prod, 128),
                Rounding::Down => prod >> 128,
            };
            Ok(amount.safe_cast()?)
        }
    }

    pub fn get_amount_out(amount_in: u64, sqrt_price: u128, swap_for_y: bool) -> Result<u64> {
        if swap_for_y {
            // (price_x128 * amount_in) >> 128
            let sqrt_price = U256::from(sqrt_price);
            let price = U320::from(sqrt_price.safe_mul(sqrt_price)?);

            let prod = price.safe_mul(U320::from(amount_in))?;
            let out_amount: U320 = prod >> 128;
            Ok(out_amount.safe_cast()?)
        } else {
            // (amount_in << 128) / price_x128
            let sqrt_price = U256::from(sqrt_price);
            let price = sqrt_price.safe_mul(sqrt_price)?;

            let prod = U256::from(amount_in).safe_shl(128)?;
            let out_amount = prod.safe_div(price)?;
            Ok(out_amount.safe_cast()?)
        }
    }

    pub fn get_swap_result_exact_in(
        &self,
        input_amount: u64,
        trading_fee_numerator: u64,
        fee_setting: &FeeSetting,
        swap_for_y: bool,
        current_sqrt_price: u128,
        current_liquidity: u128,
    ) -> Result<SwapStepResult> {
        let mut actual_trading_fee = 0;
        let mut excluded_fee_input_amount = if fee_setting.fees_on_input {
            let (amount, trading_fee) =
                get_excluded_fee_amount(trading_fee_numerator, input_amount)?;
            actual_trading_fee = trading_fee;
            amount
        } else {
            input_amount
        };

        let filled_amount_result = self.get_filled_amount_result_exact_in(
            excluded_fee_input_amount,
            swap_for_y,
            current_sqrt_price,
            current_liquidity,
        )?;

        let amount_left = filled_amount_result.amount_left;
        let out_amount = filled_amount_result.out_amount;

        // if amount_left > 0 => re-calculate actual amount in, and actual fee
        let included_fee_amount_in = if amount_left > 0 {
            excluded_fee_input_amount = excluded_fee_input_amount.safe_sub(amount_left)?;
            if fee_setting.fees_on_input {
                let (included_fee_amount_in, trading_fee) =
                    get_included_fee_amount(trading_fee_numerator, excluded_fee_input_amount)?;
                actual_trading_fee = trading_fee;
                included_fee_amount_in
            } else {
                excluded_fee_input_amount
            }
        } else {
            input_amount
        };

        let excluded_fee_out_amount = if fee_setting.fees_on_input {
            out_amount
        } else {
            let (amount, trading_fee) = get_excluded_fee_amount(trading_fee_numerator, out_amount)?;
            actual_trading_fee = trading_fee;
            amount
        };

        let SplitFees {
            mm_fee,
            limit_order_fee,
            protocol_fee_on_mm_fee,
            protocol_fee_on_limit_order_fee,
        } = split_fees(actual_trading_fee, fee_setting, &filled_amount_result)?;

        Ok(SwapStepResult {
            next_sqrt_price: filled_amount_result.next_sqrt_price,
            included_fee_amount_in,
            excluded_fee_out_amount,
            mm_fee,
            protocol_fee_on_mm_fee,
            protocol_fee_on_limit_order_fee,
            limit_order_fee,
            processed_order_amount_out: filled_amount_result.processed_order_amount_out,
            open_order_amount_out: filled_amount_result.open_order_amount_out,
        })
    }

    pub fn get_filled_amount_result_exact_in(
        &self,
        amount_in: u64,
        swap_for_y: bool,
        current_sqrt_price: u128,
        current_liquidity: u128,
    ) -> Result<FilledAmountResult> {
        // calculate mm liquidity firstly
        let mm_result = self.calculate_filled_market_making_amount_exact_in(
            amount_in,
            swap_for_y,
            current_sqrt_price,
            self.sqrt_price,
            current_liquidity,
        )?;

        let mm_amount_in = mm_result.amount_in;
        let mm_amount_out = mm_result.out_amount;

        let mut processed_order_amount_in = 0;
        let mut processed_order_amount_out = 0;
        let mut open_order_amount_in = 0;
        let mut open_order_amount_out = 0;

        if mm_result.amount_left > 0 {
            let (open_order_amount, process_order_amount) =
                self.get_current_limit_order_amounts(swap_for_y)?;

            // additional condition to save CU, because most of tick would have empty limit order
            if open_order_amount != 0 || process_order_amount != 0 {
                // try to fill with process order amount firstly
                let result = self.calculate_filled_limit_order_amount_exact_in(
                    mm_result.amount_left,
                    process_order_amount,
                    swap_for_y,
                )?;

                processed_order_amount_in = result.amount_in;
                processed_order_amount_out = result.out_amount;
                // try to fill with open_order_amount
                if result.amount_left > 0 {
                    let result = self.calculate_filled_limit_order_amount_exact_in(
                        result.amount_left,
                        open_order_amount,
                        swap_for_y,
                    )?;
                    open_order_amount_in = result.amount_in;
                    open_order_amount_out = result.out_amount;
                }
            }
        }

        let total_amount_in = mm_amount_in
            .safe_add(processed_order_amount_in)?
            .safe_add(open_order_amount_in)?;
        let total_amount_out = mm_amount_out
            .safe_add(processed_order_amount_out)?
            .safe_add(open_order_amount_out)?;
        let amount_left = amount_in.safe_sub(total_amount_in)?;

        Ok(FilledAmountResult {
            next_sqrt_price: mm_result.next_sqrt_price,
            amount_in: total_amount_in,
            amount_left,
            out_amount: total_amount_out,
            mm_amount_in,
            mm_amount_out,
            processed_order_amount_out,
            open_order_amount_out,
        })
    }

    fn calculate_filled_limit_order_amount_exact_in(
        &self,
        amount_in: u64,
        total_out_amount: u64,
        swap_for_y: bool,
    ) -> Result<LimitOrderSwapAmountFromInput> {
        let total_amount_in = Tick::get_amount_in_unchecked(
            self.sqrt_price,
            total_out_amount,
            swap_for_y,
            Rounding::Up,
        )?;
        if U192::from(amount_in) >= total_amount_in {
            let total_amount_in = total_amount_in.safe_cast()?;
            Ok(LimitOrderSwapAmountFromInput {
                amount_in: total_amount_in,
                amount_left: amount_in.safe_sub(total_amount_in)?,
                out_amount: total_out_amount,
            })
        } else {
            let out_amount = Tick::get_amount_out(amount_in, self.sqrt_price, swap_for_y)?;
            Ok(LimitOrderSwapAmountFromInput {
                amount_in,
                amount_left: 0,
                out_amount,
            })
        }
    }

    fn calculate_filled_market_making_amount_exact_in(
        &self,
        amount_in: u64,
        swap_for_y: bool,
        current_sqrt_price: u128,
        next_sqrt_price: u128,
        current_liquidity: u128,
    ) -> Result<MarketMakingSwapAmountFromInput> {
        if current_liquidity == 0 || next_sqrt_price == current_sqrt_price {
            return Ok(MarketMakingSwapAmountFromInput {
                amount_in: 0,
                amount_left: amount_in,
                out_amount: 0,
                next_sqrt_price,
            });
        }

        let max_amount_in_unchecked = if swap_for_y {
            get_delta_amount_x_unchecked(
                next_sqrt_price,
                current_sqrt_price,
                current_liquidity,
                Rounding::Up,
            )?
        } else {
            let max_amount_y_in = get_delta_amount_y_unchecked(
                current_sqrt_price,
                next_sqrt_price,
                current_liquidity,
                Rounding::Up,
            )?;

            U320::from(max_amount_y_in)
        };

        let (actual_next_sqrt_price, actual_amount_in, amount_left) =
            if U320::from(amount_in) >= max_amount_in_unchecked {
                let max_amount_in: u64 = try_cast(max_amount_in_unchecked)?;
                (
                    next_sqrt_price,
                    max_amount_in,
                    amount_in.safe_sub(max_amount_in)?,
                )
            } else {
                let next_sqrt_price = get_next_sqrt_price_from_input(
                    current_sqrt_price,
                    current_liquidity,
                    amount_in,
                    swap_for_y,
                )?;

                (next_sqrt_price, amount_in, 0)
            };

        let out_amount = if swap_for_y {
            get_delta_amount_y(
                actual_next_sqrt_price,
                current_sqrt_price,
                current_liquidity,
                Rounding::Down,
            )?
        } else {
            get_delta_amount_x(
                current_sqrt_price,
                actual_next_sqrt_price,
                current_liquidity,
                Rounding::Down,
            )?
        };

        Ok(MarketMakingSwapAmountFromInput {
            amount_in: actual_amount_in,
            amount_left,
            out_amount,
            next_sqrt_price: actual_next_sqrt_price,
        })
    }

    // return open_order_amount and processed_order_amount
    fn get_current_limit_order_amounts(&self, swap_for_y: bool) -> Result<(u64, u64)> {
        let pending_limit_order_amount = self.get_pending_limit_order_amount()?;
        if pending_limit_order_amount == 0 {
            Ok((0, 0))
        } else {
            let is_ask = self.is_limit_order_ask_side();
            if swap_for_y ^ is_ask {
                Ok((
                    self.open_order_amount,
                    self.processed_order_remaining_amount,
                ))
            } else {
                Ok((0, 0))
            }
        }
    }

    pub fn apply_swap_result(
        &mut self,
        swap_for_y: bool,
        swap_result: &SwapStepResult,
    ) -> Result<()> {
        if swap_result.open_order_amount_out > 0 {
            self.total_processing_order_amount = self.open_order_amount;
            self.processed_order_remaining_amount = self
                .open_order_amount
                .safe_sub(swap_result.open_order_amount_out)?;
            self.open_order_amount = 0;
            self.order_age = self.order_age.safe_add(1)?;
        } else if swap_result.processed_order_amount_out > 0 {
            // update limit order liquidity
            self.processed_order_remaining_amount = self
                .processed_order_remaining_amount
                .safe_sub(swap_result.processed_order_amount_out)?;
        }

        let fulfilled_order_amount = swap_result.get_fulfilled_order_amount()?;
        if swap_for_y {
            // update fulfilled amount
            self.fulfilled_order_amount_y = self
                .fulfilled_order_amount_y
                .safe_add(fulfilled_order_amount)?;
            // update fees
            self.limit_order_fee_bid_side = self
                .limit_order_fee_bid_side
                .safe_add(swap_result.limit_order_fee)?;
        } else {
            self.fulfilled_order_amount_x = self
                .fulfilled_order_amount_x
                .safe_add(fulfilled_order_amount)?;

            self.limit_order_fee_ask_side = self
                .limit_order_fee_ask_side
                .safe_add(swap_result.limit_order_fee)?;
        }

        Ok(())
    }

    pub fn cross_update(
        &mut self,
        fee_growth_global_x: u128,
        fee_growth_global_y: u128,
    ) -> Result<()> {
        self.fee_growth_outside_x = fee_growth_global_x.wrapping_sub(self.fee_growth_outside_x);
        self.fee_growth_outside_y = fee_growth_global_y.wrapping_sub(self.fee_growth_outside_y);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::size_of;

    #[test]
    fn tail_struct_sizes_match_program_init_space() {
        assert_eq!(size_of::<Tick>(), TICK_INIT_SPACE);
        assert_eq!(size_of::<TickWithReward>(), TICK_WITH_REWARD_INIT_SPACE);
        assert_eq!(size_of::<PoolReward>(), POOL_REWARD_INIT_SPACE);
        assert_eq!(size_of::<PoolRewardInfo>(), POOL_REWARD_INFO_INIT_SPACE);
        assert_eq!(size_of::<PoolActivation>(), POOL_ACTIVATION_INIT_SPACE);
        assert_eq!(
            size_of::<PoolActivationInfo>(),
            POOL_ACTIVATION_INFO_INIT_SPACE
        );
        assert_eq!(size_of::<Observation>(), OBSERVATION_INIT_SPACE);
        assert_eq!(size_of::<LimitOrderData>(), LIMIT_ORDER_DATA_INIT_SPACE);
        assert_eq!(size_of::<Position>(), POSITION_INIT_SPACE);
        assert_eq!(
            size_of::<PositionWithReward>(),
            POSITION_WITH_REWARD_INIT_SPACE
        );
    }

    #[test]
    fn header_struct_sizes_match_program_init_space() {
        assert_eq!(size_of::<Pool>(), POOL_INIT_SPACE);
        assert_eq!(size_of::<TickArray>(), TICK_ARRAY_INIT_SPACE);
        assert_eq!(size_of::<Oracle>(), ORACLE_INIT_SPACE);
        assert_eq!(size_of::<LimitOrder>(), LIMIT_ORDER_INIT_SPACE);
        assert_eq!(size_of::<PositionArray>(), POSITION_ARRAY_INIT_SPACE);
        assert_eq!(
            size_of::<TickArrayBitmapExtension>(),
            TICK_ARRAY_BITMAP_EXTENSION_INIT_SPACE
        );
    }
}
