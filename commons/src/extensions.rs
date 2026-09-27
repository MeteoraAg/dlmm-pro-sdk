//! Methods from the program's state impls, attached to the `declare_program!`
//! generated account/types structs. Signatures taking `AccountLoader` on-chain
//! take parsed references here.
use anchor_lang::prelude::*;
use num_integer::Integer;
use ruint::aliases::{U1024, U512};
use std::ops::{BitAnd, Shl, Shr};

use crate::*;

const DOUBLE_MAX_BASIS_POINT: u128 = 20_000;

/// Whether `tick_array_index` falls outside the pool account's inline tick
/// array bitmap, so the pool needs a [`TickArrayBitmapExtension`] account.
pub fn overflows_default_tick_array_bitmap(tick_array_index: i32) -> bool {
    let (min_bitmap_index, max_bitmap_index) = Pool::bitmap_range();
    tick_array_index < min_bitmap_index || tick_array_index > max_bitmap_index
}

impl Pool {
    pub fn space(extension_bytes: u8) -> usize {
        let mut base_space = POOL_INIT_SPACE;
        if is_support_extension(extension_bytes, PoolExtension::LiquidityMining) {
            base_space += POOL_REWARD_INIT_SPACE;
        }
        if is_support_extension(extension_bytes, PoolExtension::ActivationAccess) {
            base_space += POOL_ACTIVATION_INIT_SPACE;
        }
        base_space
    }

    pub fn update_dynamic_fee_pre_swap(&mut self, current_timestamp: u64) -> Result<()> {
        if self.fee_config.dynamic_fee.is_dynamic_fee_enable() {
            let mut variable_fee = self.variable_fee;
            variable_fee.update_references(
                self.sqrt_price,
                current_timestamp,
                &self.fee_config.dynamic_fee,
            )?;
            variable_fee
                .update_volatility_accumulator(self.sqrt_price, &self.fee_config.dynamic_fee);
            self.variable_fee = variable_fee;
        }
        Ok(())
    }

    pub fn is_overflow_default_tick_array_bitmap(&self, tick_array_index: i32) -> bool {
        overflows_default_tick_array_bitmap(tick_array_index)
    }

    pub fn bitmap_range() -> (i32, i32) {
        (-BITMAP_SIZE, BITMAP_SIZE - 1)
    }

    pub fn is_bitmap_extension_initialized(&self) -> bool {
        self.is_bitmap_extension_initialized == 1
    }

    // return OK(None) if no more bits
    pub fn get_non_zero_liquidity_next_index(
        &self,
        swap_for_y: bool,
        from_tick_index: i32,
        tick_array_bitmap_extension: Option<&TickArrayBitmapExtension>,
    ) -> Result<Option<i32>> {
        if self.is_overflow_default_tick_array_bitmap(from_tick_index) {
            if self.is_bitmap_extension_initialized() {
                let (tick_array_index, is_non_zero_liquidity_flag) =
                    Pool::get_non_zero_liquidity_tick_array_index_extensions(
                        swap_for_y,
                        from_tick_index,
                        tick_array_bitmap_extension,
                    )?;
                if is_non_zero_liquidity_flag {
                    Ok(Some(tick_array_index))
                } else if !self.is_overflow_default_tick_array_bitmap(tick_array_index) {
                    self.get_non_zero_liquidity_tick_array_index_from_internal_to_extension(
                        swap_for_y,
                        tick_array_index,
                        tick_array_bitmap_extension,
                    )
                } else {
                    Ok(None)
                }
            } else {
                // No external liquidity exists; resume at the internal boundary
                // when the swap is moving toward it.
                let (min_internal_tick_array_index, max_internal_tick_array_index) =
                    Pool::bitmap_range();

                if swap_for_y && from_tick_index > max_internal_tick_array_index
                    || !swap_for_y && from_tick_index < min_internal_tick_array_index
                {
                    self.get_non_zero_liquidity_tick_array_index_from_internal_to_extension(
                        swap_for_y,
                        if swap_for_y {
                            max_internal_tick_array_index
                        } else {
                            min_internal_tick_array_index
                        },
                        tick_array_bitmap_extension,
                    )
                } else {
                    Ok(None)
                }
            }
        } else {
            self.get_non_zero_liquidity_tick_array_index_from_internal_to_extension(
                swap_for_y,
                from_tick_index,
                tick_array_bitmap_extension,
            )
        }
    }

    pub fn get_non_zero_liquidity_tick_array_index_from_internal_to_extension(
        &self,
        swap_for_y: bool,
        from_array_index: i32,
        tick_array_bitmap_extension: Option<&TickArrayBitmapExtension>,
    ) -> Result<Option<i32>> {
        let (tick_array_index, is_non_zero_liquidity_flag) =
            self.get_non_zero_liquidity_tick_array_index_internal(swap_for_y, from_array_index)?;

        if is_non_zero_liquidity_flag {
            Ok(Some(tick_array_index))
        } else if self.is_bitmap_extension_initialized() {
            let (tick_array_index, is_non_zero_liquidity_flag) =
                Pool::get_non_zero_liquidity_tick_array_index_extensions(
                    swap_for_y,
                    tick_array_index,
                    tick_array_bitmap_extension,
                )?;
            if is_non_zero_liquidity_flag {
                Ok(Some(tick_array_index))
            } else {
                Ok(None)
            }
        } else {
            Ok(None)
        }
    }

    fn get_tick_array_offset(tick_array_index: i32) -> usize {
        (tick_array_index + BITMAP_SIZE) as usize
    }

    fn get_non_zero_liquidity_tick_array_index_extensions(
        swap_for_y: bool,
        from_tick_index: i32,
        tick_array_bitmap_extension: Option<&TickArrayBitmapExtension>,
    ) -> Result<(i32, bool)> {
        match tick_array_bitmap_extension {
            Some(bitmap_ext) => {
                bitmap_ext.get_non_zero_liquidity_tick_array_index(swap_for_y, from_tick_index)
            }
            None => Err(PoolError::BitmapExtensionAccountIsNotProvided.into()),
        }
    }

    pub fn get_non_zero_liquidity_tick_array_index_internal(
        &self,
        swap_for_y: bool,
        from_tick_index: i32,
    ) -> Result<(i32, bool)> {
        let tick_array_bitmap = U1024::from_limbs(self.tick_array_bitmap);
        let array_offset: usize = Self::get_tick_array_offset(from_tick_index);
        let (min_bitmap_id, max_bitmap_id) = Pool::bitmap_range();
        if swap_for_y {
            let bitmap_range: usize = try_cast(max_bitmap_id.safe_sub(min_bitmap_id)?)?;
            let offset_bit_map = tick_array_bitmap.shl(bitmap_range.safe_sub(array_offset)?);

            if offset_bit_map.eq(&U1024::ZERO) {
                Ok((min_bitmap_id.safe_sub(1)?, false))
            } else {
                let next_bit = offset_bit_map.leading_zeros();
                Ok((from_tick_index.safe_sub(try_cast(next_bit)?)?, true))
            }
        } else {
            let offset_bit_map = tick_array_bitmap.shr(array_offset);
            if offset_bit_map.eq(&U1024::ZERO) {
                Ok((max_bitmap_id.safe_add(1)?, false))
            } else {
                let next_bit = offset_bit_map.trailing_zeros();
                Ok((from_tick_index.safe_add(try_cast(next_bit)?)?, true))
            }
        }
    }

    pub fn get_total_trading_fee_numerator(&self, current_point: u64) -> Result<u64> {
        self.fee_config.get_total_trading_fee_numerator(
            current_point,
            self.activation_point,
            self.init_sqrt_price,
            self.sqrt_price,
            &self.variable_fee,
        )
    }

    pub fn is_support_liquidity_mining(&self) -> bool {
        is_support_extension(self.extensions, PoolExtension::LiquidityMining)
    }
    pub fn is_support_activation_access(&self) -> bool {
        is_support_extension(self.extensions, PoolExtension::ActivationAccess)
    }
    pub fn has_partner(&self) -> bool {
        self.pool_partner.partner.ne(&Pubkey::default())
    }

    pub fn is_launch_pool(&self) -> bool {
        self.pool_type == u8::from(PoolType::LaunchPool)
    }

    pub fn mm_protocol_fee_bps(&self) -> u16 {
        if self.is_launch_pool() {
            MM_LAUNCH_POOL_PROTOCOL_FEE_BPS
        } else {
            MM_PROTOCOL_FEE_BPS
        }
    }

    pub fn get_fee_setting(&self, swap_for_y: bool, has_referral: bool) -> Result<FeeSetting> {
        let collect_fee_mode = try_cast(self.collect_fee_mode)?;

        let (fees_on_input, fees_on_token_x) = match (collect_fee_mode, swap_for_y) {
            // When collecting fees on input token
            (CollectFeeMode::OutputToken, true) => (false, false),
            (CollectFeeMode::OutputToken, false) => (false, true),

            // When collecting fees on token Y
            (CollectFeeMode::OnlyY, true) => (false, false),
            (CollectFeeMode::OnlyY, false) => (true, false),
        };

        Ok(FeeSetting {
            fees_on_input,
            fees_on_token_x,
            has_referral,
            has_partner: self.has_partner(),
            mm_protocol_fee_bps: self.mm_protocol_fee_bps(),
            limit_order_protocol_fee_bps: LIMIT_ORDER_PROTOCOL_FEE_BPS,
            partner_fee_bps: self.partner_fee_bps,
        })
    }

    pub fn is_enable_status(&self, status: PoolStatus) -> bool {
        let result: u16 = self.pool_status.bitand(1u16 << u8::from(status));
        result == 0
    }
}

impl DynamicFeeConfig {
    pub fn is_dynamic_fee_enable(&self) -> bool {
        self.initialized != 0
    }

    pub fn get_current_trading_fee_numerator(&self, variable_fee: &VariableFee) -> u64 {
        if !self.is_dynamic_fee_enable() {
            return 0;
        }
        let volatility_accumulator: u128 = variable_fee.volatility_accumulator.into();
        let variable_fee_control: u128 = self.variable_fee_control.into();

        let square_vfa_tick = volatility_accumulator.saturating_mul(volatility_accumulator);

        // vol_acc is Δtick × MAX_BASIS_POINT, so vol_acc² × vfc lives in (bps² × bps) ≈ 1e12-1e16.
        // FEE_DENOMINATOR = 1e9, so divide by 1e11 and ceil so any non-zero v_fee maps to ≥ 1.
        let v_fee = variable_fee_control.saturating_mul(square_vfa_tick);

        let scaled_v_fee = v_fee
            .saturating_add(99_999_999_999)
            .saturating_div(100_000_000_000);
        if scaled_v_fee > u128::from(u64::MAX) {
            u64::MAX
        } else {
            scaled_v_fee as u64
        }
    }
}

impl VariableFee {
    pub fn update_references(
        &mut self,
        sqrt_price_current: u128,
        current_timestamp: u64,
        dynamic_fee_config: &DynamicFeeConfig,
    ) -> Result<()> {
        let elapsed = current_timestamp.saturating_sub(self.last_update_timestamp);
        // Not high frequency trade
        if elapsed >= dynamic_fee_config.filter_period.into() {
            // Update sqrt of last transaction
            self.sqrt_price_reference = sqrt_price_current;
            // filter period < t < decay_period. Decay time window.
            if elapsed < dynamic_fee_config.decay_period.into() {
                let volatility_reference = u64::from(self.volatility_accumulator)
                    .safe_mul(dynamic_fee_config.reduction_factor.into())?
                    .safe_div(MAX_BASIS_POINT.into())?;

                self.volatility_reference = try_cast(volatility_reference)?;
            }
            // Out of decay time window
            else {
                self.volatility_reference = 0;
            }
        }
        Ok(())
    }

    pub fn get_delta_tick(sqrt_price_a: u128, sqrt_price_b: u128) -> u128 {
        let (upper, lower) = if sqrt_price_a > sqrt_price_b {
            (sqrt_price_a, sqrt_price_b)
        } else {
            (sqrt_price_b, sqrt_price_a)
        };

        upper
            .saturating_mul(DOUBLE_MAX_BASIS_POINT)
            .saturating_div(lower)
            .saturating_sub(DOUBLE_MAX_BASIS_POINT)
    }

    pub fn update_volatility_accumulator(
        &mut self,
        sqrt_price: u128,
        dynamic_fee_config: &DynamicFeeConfig,
    ) {
        let delta_tick = Self::get_delta_tick(sqrt_price, self.sqrt_price_reference);

        let volatility_accumulator = delta_tick
            .saturating_mul(MAX_BASIS_POINT.into())
            .saturating_add(self.volatility_reference.into());

        if volatility_accumulator > dynamic_fee_config.max_volatility_accumulator.into() {
            self.volatility_accumulator = dynamic_fee_config.max_volatility_accumulator
        } else {
            self.volatility_accumulator = volatility_accumulator as u32;
        }
    }
}

impl FeeConfig {
    pub fn get_total_trading_fee_numerator(
        &self,
        current_point: u64,
        activation_point: u64,
        init_sqrt_price: u128,
        current_sqrt_price: u128,
        variable_fee: &VariableFee,
    ) -> Result<u64> {
        let base_fee_numerator = get_base_fee_numerator(
            &self.base_fee,
            current_point,
            activation_point,
            init_sqrt_price,
            current_sqrt_price,
        )?;

        let dynamic_fee_numerator = self
            .dynamic_fee
            .get_current_trading_fee_numerator(variable_fee);

        let total_fee_numerator = base_fee_numerator.saturating_add(dynamic_fee_numerator);

        if total_fee_numerator > MAX_FEE_NUMERATOR {
            Ok(MAX_FEE_NUMERATOR)
        } else {
            Ok(total_fee_numerator)
        }
    }
}

impl TickArray {
    pub fn space(tick_length: usize, is_support_liquidity_mining: bool) -> usize {
        8 + TICK_ARRAY_INIT_SPACE
            + Self::dynamic_data_space(tick_length, is_support_liquidity_mining)
    }

    pub fn dynamic_data_space(tick_length: usize, is_support_liquidity_mining: bool) -> usize {
        if is_support_liquidity_mining {
            TICK_WITH_REWARD_INIT_SPACE * tick_length
        } else {
            TICK_INIT_SPACE * tick_length
        }
    }

    pub fn get_tick_index_from_tick_id(tick_id: i32, tick_spacing: u16) -> Result<i32> {
        let (index, rem) = tick_id
            .div_euclid(tick_spacing.into())
            .div_rem(&(MAX_TICKS_PER_ARRAY as i32));

        if tick_id.is_negative() && rem != 0 {
            Ok(index.safe_sub(1)?)
        } else {
            Ok(index)
        }
    }

    pub fn is_usable_tick_id(tick_id: i32, tick_spacing: u16) -> bool {
        if !(MIN_TICK_ID..=MAX_TICK_ID).contains(&tick_id) {
            return false;
        }
        tick_id % (tick_spacing as i32) == 0
    }

    pub fn get_min_max_tick_id_from_tick_index(
        tick_index: i32,
        tick_spacing: u16,
    ) -> Result<(i32, i32)> {
        let min_tick_id_without_spacing = tick_index.safe_mul(MAX_TICKS_PER_ARRAY as i32)?;
        let max_tick_id_without_spacing = min_tick_id_without_spacing
            .safe_add(MAX_TICKS_PER_ARRAY as i32)?
            .safe_sub(1)?;

        let min_tick_id = min_tick_id_without_spacing.safe_mul(tick_spacing as i32)?;
        let max_tick_id = max_tick_id_without_spacing.safe_mul(tick_spacing as i32)?;

        Ok((min_tick_id, max_tick_id))
    }
}

const EXTENSION_BITMAP_SIZE: usize = 6;

impl TickArrayBitmapExtension {
    pub fn get_bitmap_offset(index: i32) -> Result<usize> {
        // index starts from 512 in positive side and -513 in negative side
        let offset = if index > 0 {
            index / BITMAP_SIZE - 1
        } else {
            -(index + 1) / BITMAP_SIZE - 1
        };
        Ok(offset as usize)
    }

    fn get_bitmap(&self, index: i32) -> Result<(usize, [u64; 8])> {
        let offset = Self::get_bitmap_offset(index)?;
        if index < 0 {
            Ok((offset, self.negative_bitmap[offset]))
        } else {
            Ok((offset, self.positive_bitmap[offset]))
        }
    }

    pub fn bitmap_range() -> (i32, i32) {
        (
            -BITMAP_SIZE * (EXTENSION_BITMAP_SIZE as i32 + 1),
            BITMAP_SIZE * (EXTENSION_BITMAP_SIZE as i32 + 1) - 1,
        )
    }

    pub fn tick_array_offset_in_bitmap(tick_array_index: i32) -> Result<usize> {
        if tick_array_index > 0 {
            Ok(tick_array_index.safe_rem(BITMAP_SIZE)? as usize)
        } else {
            Ok((-(tick_array_index + 1)).safe_rem(BITMAP_SIZE)? as usize)
        }
    }

    pub fn bit(&self, tick_array_index: i32) -> Result<bool> {
        let (_, bitmap) = self.get_bitmap(tick_array_index)?;
        let tick_array_offset_in_bitmap = Self::tick_array_offset_in_bitmap(tick_array_index)?;
        let bitmap = U512::from_limbs(bitmap);
        Ok(bitmap.bit(tick_array_offset_in_bitmap))
    }

    fn to_tick_array_index(
        offset: usize,
        tick_array_offset: usize,
        is_positive: bool,
    ) -> Result<i32> {
        let offset = offset as i32;
        let tick_array_offset = tick_array_offset as i32;
        if is_positive {
            Ok((offset + 1) * BITMAP_SIZE + tick_array_offset)
        } else {
            Ok(-((offset + 1) * BITMAP_SIZE + tick_array_offset) - 1)
        }
    }

    pub fn iter_bitmap(&self, start_index: i32, end_index: i32) -> Result<Option<i32>> {
        if start_index == end_index {
            if self.bit(start_index)? {
                return Ok(Some(start_index));
            } else {
                return Ok(None);
            }
        }
        let offset: usize = Self::get_bitmap_offset(start_index)?;
        let tick_array_offset = Self::tick_array_offset_in_bitmap(start_index)?;
        if start_index < 0 {
            // iter in negative_bitmap
            if start_index < end_index {
                for i in (0..=offset).rev() {
                    let mut bitmap = U512::from_limbs(self.negative_bitmap[i]);

                    if i == offset {
                        bitmap <<= BITMAP_SIZE as usize - tick_array_offset - 1;
                        if bitmap.eq(&U512::ZERO) {
                            continue;
                        }

                        let tick_array_offset_in_bitmap =
                            tick_array_offset - bitmap.leading_zeros();

                        return Ok(Some(TickArrayBitmapExtension::to_tick_array_index(
                            i,
                            tick_array_offset_in_bitmap,
                            false,
                        )?));
                    }
                    if bitmap.eq(&U512::ZERO) {
                        continue;
                    }
                    let tick_array_offset_in_bitmap =
                        BITMAP_SIZE as usize - bitmap.leading_zeros() - 1;
                    return Ok(Some(TickArrayBitmapExtension::to_tick_array_index(
                        i,
                        tick_array_offset_in_bitmap,
                        false,
                    )?));
                }
            } else {
                for i in offset..EXTENSION_BITMAP_SIZE {
                    let mut bitmap = U512::from_limbs(self.negative_bitmap[i]);
                    if i == offset {
                        bitmap >>= tick_array_offset;
                        if bitmap.eq(&U512::ZERO) {
                            continue;
                        }

                        let tick_array_offset_in_bitmap =
                            tick_array_offset + bitmap.trailing_zeros();

                        return Ok(Some(TickArrayBitmapExtension::to_tick_array_index(
                            i,
                            tick_array_offset_in_bitmap,
                            false,
                        )?));
                    }

                    if bitmap.eq(&U512::ZERO) {
                        continue;
                    }
                    let tick_array_offset_in_bitmap = bitmap.trailing_zeros();

                    return Ok(Some(TickArrayBitmapExtension::to_tick_array_index(
                        i,
                        tick_array_offset_in_bitmap,
                        false,
                    )?));
                }
            }
        } else {
            // iter in positive_bitmap
            if start_index < end_index {
                for i in offset..EXTENSION_BITMAP_SIZE {
                    let mut bitmap = U512::from_limbs(self.positive_bitmap[i]);
                    if i == offset {
                        bitmap >>= tick_array_offset;
                        if bitmap.eq(&U512::ZERO) {
                            continue;
                        }

                        let tick_array_offset_in_bitmap =
                            tick_array_offset + bitmap.trailing_zeros();
                        return Ok(Some(TickArrayBitmapExtension::to_tick_array_index(
                            i,
                            tick_array_offset_in_bitmap,
                            true,
                        )?));
                    }

                    if bitmap.eq(&U512::ZERO) {
                        continue;
                    }

                    let tick_array_offset_in_bitmap = bitmap.trailing_zeros();
                    return Ok(Some(TickArrayBitmapExtension::to_tick_array_index(
                        i,
                        tick_array_offset_in_bitmap,
                        true,
                    )?));
                }
            } else {
                for i in (0..=offset).rev() {
                    let mut bitmap = U512::from_limbs(self.positive_bitmap[i]);

                    if i == offset {
                        bitmap <<= BITMAP_SIZE as usize - tick_array_offset - 1;

                        if bitmap.eq(&U512::ZERO) {
                            continue;
                        }
                        let tick_array_offset_in_bitmap =
                            tick_array_offset - bitmap.leading_zeros();
                        return Ok(Some(TickArrayBitmapExtension::to_tick_array_index(
                            i,
                            tick_array_offset_in_bitmap,
                            true,
                        )?));
                    }

                    if bitmap.eq(&U512::ZERO) {
                        continue;
                    }
                    let tick_array_offset_in_bitmap =
                        BITMAP_SIZE as usize - bitmap.leading_zeros() - 1;
                    return Ok(Some(TickArrayBitmapExtension::to_tick_array_index(
                        i,
                        tick_array_offset_in_bitmap,
                        true,
                    )?));
                }
            }
        }
        Ok(None)
    }

    pub fn get_non_zero_liquidity_tick_array_index(
        &self,
        swap_for_y: bool,
        start_index: i32,
    ) -> Result<(i32, bool)> {
        let (min_bitmap_id, max_bit_map_id) = TickArrayBitmapExtension::bitmap_range();
        if start_index > 0 {
            if swap_for_y {
                match self.iter_bitmap(start_index, BITMAP_SIZE)? {
                    Some(value) => Ok((value, true)),
                    None => Ok((BITMAP_SIZE - 1, false)),
                }
            } else {
                match self.iter_bitmap(start_index, max_bit_map_id)? {
                    Some(value) => Ok((value, true)),
                    None => Ok((max_bit_map_id, false)),
                }
            }
        } else if swap_for_y {
            match self.iter_bitmap(start_index, min_bitmap_id)? {
                Some(value) => Ok((value, true)),
                None => Ok((min_bitmap_id, false)),
            }
        } else {
            match self.iter_bitmap(start_index, -BITMAP_SIZE - 1)? {
                Some(value) => Ok((value, true)),
                None => Ok((-BITMAP_SIZE, false)),
            }
        }
    }
}
