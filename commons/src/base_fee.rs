//! Base fee handlers ported from the program's `base_fee` module. The raw
//! `BaseFeeConfig { base_fee_mode, data }` bytes are reinterpreted into the
//! mode-specific pod layout, exactly as on-chain.
use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};
use num_enum::{IntoPrimitive, TryFromPrimitive};
use ruint::aliases::U256;

use crate::*;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, IntoPrimitive, TryFromPrimitive)]
// https://www.desmos.com/calculator/oxdndn2xdx
pub enum BaseFeeMode {
    // fee = cliff_fee_numerator
    Fixed,
    // fee = cliff_fee_numerator - passed_period * reduction_factor
    // passed_period = (current_point - activation_point) / period_frequency
    TimeSchedulerLinear,
    // fee = cliff_fee_numerator * (1-reduction_factor/10_000)^passed_period
    TimeSchedulerExponential,
    // fee = cliff_fee_numerator - passed_period * reduction_factor
    // passed_period = changed_price / sqrt_price_step_bps
    // passed_period = (current_sqrt_price - init_sqrt_price) * 10_000 / init_sqrt_price / sqrt_price_step_bps
    MarketCapSchedulerLinear,
    // fee = cliff_fee_numerator * (1-reduction_factor/10_000)^passed_period
    MarketCapSchedulerExponential,
}

pub trait BaseFeeHandler {
    fn get_base_fee_numerator(
        &self,
        current_point: u64,
        activation_point: u64,
        init_sqrt_price: u128,
        current_sqrt_price: u128,
    ) -> Result<u64>;
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct PodAlignedFixedFee {
    pub base_fee_mode: u8,
    pub cliff_fee_numerator: Z64,
    pub _padding: [u8; 23],
}

impl BaseFeeHandler for PodAlignedFixedFee {
    fn get_base_fee_numerator(
        &self,
        _current_point: u64,
        _activation_point: u64,
        _init_sqrt_price: u128,
        _current_sqrt_price: u128,
    ) -> Result<u64> {
        Ok(self.cliff_fee_numerator.into())
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct PodAlignedFeeTimeScheduler {
    pub base_fee_mode: u8,
    pub cliff_fee_numerator: Z64,
    pub period_frequency: Z64,
    pub reduction_factor: Z64,
    pub number_of_period: Z16,
    pub _padding: [u8; 5],
}

impl PodAlignedFeeTimeScheduler {
    fn cliff_fee_numerator(&self) -> u64 {
        self.cliff_fee_numerator.into()
    }
    fn reduction_factor(&self) -> u64 {
        self.reduction_factor.into()
    }
    fn period_frequency(&self) -> u64 {
        self.period_frequency.into()
    }
    fn number_of_period(&self) -> u16 {
        self.number_of_period.into()
    }

    fn get_passed_period(&self, current_point: u64, activation_point: u64) -> Result<u16> {
        // it means alpha-vault is buying
        let period = if current_point < activation_point {
            self.number_of_period()
        } else {
            let period = current_point
                .safe_sub(activation_point)?
                .safe_div(self.period_frequency())?;
            if period > self.number_of_period().into() {
                self.number_of_period()
            } else {
                period.safe_cast()?
            }
        };
        Ok(period)
    }
}

pub struct FeeTimeSchedulerLinear<'a>(pub &'a PodAlignedFeeTimeScheduler);

impl<'a> FeeTimeSchedulerLinear<'a> {
    fn get_base_fee_numerator_by_period(&self, period: u16) -> Result<u64> {
        let fee_numerator = self
            .0
            .cliff_fee_numerator()
            .safe_sub(self.0.reduction_factor().safe_mul(period.into())?)?;
        Ok(fee_numerator)
    }
}

impl<'a> BaseFeeHandler for FeeTimeSchedulerLinear<'a> {
    fn get_base_fee_numerator(
        &self,
        current_point: u64,
        activation_point: u64,
        _init_sqrt_price: u128,
        _current_sqrt_price: u128,
    ) -> Result<u64> {
        let period = self.0.get_passed_period(current_point, activation_point)?;
        self.get_base_fee_numerator_by_period(period)
    }
}

pub struct FeeTimeSchedulerExponential<'a>(pub &'a PodAlignedFeeTimeScheduler);

impl<'a> FeeTimeSchedulerExponential<'a> {
    fn get_base_fee_numerator_by_period(&self, period: u16) -> Result<u64> {
        let fee_numerator = get_fee_in_period(
            self.0.cliff_fee_numerator(),
            self.0.reduction_factor(),
            period,
        )?;
        Ok(fee_numerator)
    }
}

impl<'a> BaseFeeHandler for FeeTimeSchedulerExponential<'a> {
    fn get_base_fee_numerator(
        &self,
        current_point: u64,
        activation_point: u64,
        _init_sqrt_price: u128,
        _current_sqrt_price: u128,
    ) -> Result<u64> {
        let period = self.0.get_passed_period(current_point, activation_point)?;
        self.get_base_fee_numerator_by_period(period)
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct PodAlignedFeeMarketCapScheduler {
    pub base_fee_mode: u8,
    pub cliff_fee_numerator: Z64,
    pub reduction_factor: Z64,
    pub sqrt_price_step_bps: Z32,
    pub scheduler_expiration_duration: Z32,
    pub number_of_period: Z16,
    pub _padding: [u8; 5],
}

impl PodAlignedFeeMarketCapScheduler {
    fn cliff_fee_numerator(&self) -> u64 {
        self.cliff_fee_numerator.into()
    }
    fn reduction_factor(&self) -> u64 {
        self.reduction_factor.into()
    }
    fn sqrt_price_step_bps(&self) -> u32 {
        self.sqrt_price_step_bps.into()
    }
    fn scheduler_expiration_duration(&self) -> u32 {
        self.scheduler_expiration_duration.into()
    }
    fn number_of_period(&self) -> u16 {
        self.number_of_period.into()
    }

    fn get_passed_period(
        &self,
        current_point: u64,
        activation_point: u64,
        init_sqrt_price: u128,
        current_sqrt_price: u128,
    ) -> Result<u16> {
        let scheduler_expiration_point =
            activation_point.safe_add(self.scheduler_expiration_duration().into())?;

        let period =
            if current_point > scheduler_expiration_point || current_point < activation_point {
                // Expired or alpha vault is buying
                self.number_of_period()
            } else if current_sqrt_price <= init_sqrt_price {
                0u16
            } else {
                let current_sqrt_price = U256::from(current_sqrt_price);
                let init_sqrt_price = U256::from(init_sqrt_price);
                let max_bps = U256::from(MAX_BASIS_POINT);
                let sqrt_price_step_bps = U256::from(self.sqrt_price_step_bps());
                let passed_period = current_sqrt_price
                    .safe_sub(init_sqrt_price)?
                    .safe_mul(max_bps)?
                    .safe_div(init_sqrt_price)?
                    .safe_div(sqrt_price_step_bps)?;

                if passed_period > U256::from(self.number_of_period()) {
                    self.number_of_period()
                } else {
                    // that should never return error
                    passed_period
                        .try_into()
                        .map_err(|_| PoolError::UndeterminedError)?
                }
            };
        Ok(period)
    }
}

pub struct FeeMarketCapSchedulerLinear<'a>(pub &'a PodAlignedFeeMarketCapScheduler);

impl<'a> FeeMarketCapSchedulerLinear<'a> {
    fn get_base_fee_numerator_by_period(&self, period: u16) -> Result<u64> {
        let fee_numerator = self
            .0
            .cliff_fee_numerator()
            .safe_sub(self.0.reduction_factor().safe_mul(period.into())?)?;
        Ok(fee_numerator)
    }
}

impl<'a> BaseFeeHandler for FeeMarketCapSchedulerLinear<'a> {
    fn get_base_fee_numerator(
        &self,
        current_point: u64,
        activation_point: u64,
        init_sqrt_price: u128,
        current_sqrt_price: u128,
    ) -> Result<u64> {
        let period = self.0.get_passed_period(
            current_point,
            activation_point,
            init_sqrt_price,
            current_sqrt_price,
        )?;
        self.get_base_fee_numerator_by_period(period)
    }
}

pub struct FeeMarketCapSchedulerExponential<'a>(pub &'a PodAlignedFeeMarketCapScheduler);

impl<'a> FeeMarketCapSchedulerExponential<'a> {
    fn get_base_fee_numerator_by_period(&self, period: u16) -> Result<u64> {
        let fee_numerator = get_fee_in_period(
            self.0.cliff_fee_numerator(),
            self.0.reduction_factor(),
            period,
        )?;
        Ok(fee_numerator)
    }
}

impl<'a> BaseFeeHandler for FeeMarketCapSchedulerExponential<'a> {
    fn get_base_fee_numerator(
        &self,
        current_point: u64,
        activation_point: u64,
        init_sqrt_price: u128,
        current_sqrt_price: u128,
    ) -> Result<u64> {
        let period = self.0.get_passed_period(
            current_point,
            activation_point,
            init_sqrt_price,
            current_sqrt_price,
        )?;
        self.get_base_fee_numerator_by_period(period)
    }
}

pub fn get_base_fee_numerator(
    base_fee: &BaseFeeConfig,
    current_point: u64,
    activation_point: u64,
    init_sqrt_price: u128,
    current_sqrt_price: u128,
) -> Result<u64> {
    let base_fee_mode: BaseFeeMode =
        try_cast(base_fee.base_fee_mode).map_err(|_| PoolError::InvalidBaseFeeMode)?;

    match base_fee_mode {
        BaseFeeMode::Fixed => {
            let b: &PodAlignedFixedFee = bytemuck::must_cast_ref(base_fee);
            b.get_base_fee_numerator(
                current_point,
                activation_point,
                init_sqrt_price,
                current_sqrt_price,
            )
        }
        BaseFeeMode::TimeSchedulerLinear => {
            let b: &PodAlignedFeeTimeScheduler = bytemuck::must_cast_ref(base_fee);
            FeeTimeSchedulerLinear(b).get_base_fee_numerator(
                current_point,
                activation_point,
                init_sqrt_price,
                current_sqrt_price,
            )
        }
        BaseFeeMode::TimeSchedulerExponential => {
            let b: &PodAlignedFeeTimeScheduler = bytemuck::must_cast_ref(base_fee);
            FeeTimeSchedulerExponential(b).get_base_fee_numerator(
                current_point,
                activation_point,
                init_sqrt_price,
                current_sqrt_price,
            )
        }
        BaseFeeMode::MarketCapSchedulerLinear => {
            let b: &PodAlignedFeeMarketCapScheduler = bytemuck::must_cast_ref(base_fee);
            FeeMarketCapSchedulerLinear(b).get_base_fee_numerator(
                current_point,
                activation_point,
                init_sqrt_price,
                current_sqrt_price,
            )
        }
        BaseFeeMode::MarketCapSchedulerExponential => {
            let b: &PodAlignedFeeMarketCapScheduler = bytemuck::must_cast_ref(base_fee);
            FeeMarketCapSchedulerExponential(b).get_base_fee_numerator(
                current_point,
                activation_point,
                init_sqrt_price,
                current_sqrt_price,
            )
        }
    }
}
