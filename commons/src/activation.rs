//! Activation gating ported from the program's `activation` module.
use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};
use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::*;

#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, IntoPrimitive, TryFromPrimitive)]
/// Type of the activation
pub enum ActivationType {
    Slot,
    Timestamp,
}

#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, IntoPrimitive, TryFromPrimitive)]
pub enum ActivationMode {
    Open,         // all swap and modify liquidity are opened once pool is created
    BondingCurve, // add liquidity is activated if token price reaches to a new milestone
    TimeBased,    // swap and modify liquidity is time based
}

/// Resolve the pool's "current point" from the activation type.
pub fn get_current_point(
    activation_type: u8,
    current_slot: u64,
    current_timestamp: u64,
) -> Result<u64> {
    let activation_type =
        ActivationType::try_from(activation_type).map_err(|_| PoolError::InvalidActivationType)?;
    match activation_type {
        ActivationType::Slot => Ok(current_slot),
        ActivationType::Timestamp => Ok(current_timestamp),
    }
}

/// One month of seconds, and the same window in slots at 400ms.
pub const MAX_TIME_BUFFER: u64 = 2_592_000;
pub const MAX_SLOT_BUFFER: u64 = 6_480_000;

pub trait Activation {
    fn validate_initialize(
        &self,
        activation_point: u64,
        current_point: u64,
        activation_type: u8,
        init_sqrt_price: u128,
        tick_spacing: u16,
        whitelisted_add_liquidity: &Pubkey,
    ) -> Result<()>;
    fn can_swap(&self, current_point: u64) -> Result<bool>;
    fn can_add_liquidity(&self, current_point: u64) -> Result<bool>;
    fn can_remove_liquidity(&self, current_point: u64) -> Result<bool>;
    fn update_post_swap(
        &mut self,
        initial_sqrt_price: u128,
        current_sqrt_price: u128,
    ) -> Result<()>;
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct PodAlignedActivationOpen {
    pub activation_mode: u8,
    pub _padding: [u8; 15],
}

impl Activation for PodAlignedActivationOpen {
    fn validate_initialize(
        &self,
        _activation_point: u64,
        _current_point: u64,
        _activation_type: u8,
        _init_sqrt_price: u128,
        _tick_spacing: u16,
        _whitelisted_add_liquidity: &Pubkey,
    ) -> Result<()> {
        require!(self._padding == [0u8; 15], PoolError::InvalidParameters);
        Ok(())
    }
    fn can_swap(&self, _current_point: u64) -> Result<bool> {
        Ok(true)
    }
    fn can_add_liquidity(&self, _current_point: u64) -> Result<bool> {
        Ok(true)
    }
    fn can_remove_liquidity(&self, _current_point: u64) -> Result<bool> {
        Ok(true)
    }
    fn update_post_swap(
        &mut self,
        _initial_sqrt_price: u128,
        _current_sqrt_price: u128,
    ) -> Result<()> {
        Ok(())
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct PodAlignedActivationBondingCurve {
    pub activation_mode: u8,
    pub is_reach_target: u8,
    pub _padding: [u8; 6],
    pub target_increase_bps: Z64,
}

impl PodAlignedActivationBondingCurve {
    pub fn is_reach_target(&self) -> bool {
        self.is_reach_target == 1
    }
}

impl Activation for PodAlignedActivationBondingCurve {
    fn validate_initialize(
        &self,
        _activation_point: u64,
        _current_point: u64,
        _activation_type: u8,
        init_sqrt_price: u128,
        tick_spacing: u16,
        whitelisted_add_liquidity: &Pubkey,
    ) -> Result<()> {
        require!(self.is_reach_target == 0, PoolError::InvalidParameters);
        require!(self._padding == [0u8; 6], PoolError::InvalidParameters);
        // Without a whitelisted depositor the pool can never be seeded, so it
        // can never reach the target price that opens public deposits.
        require!(
            whitelisted_add_liquidity != &Pubkey::default(),
            PoolError::InvalidParameters
        );

        let target_increase_bps: u64 = self.target_increase_bps.into();
        require!(
            target_increase_bps > u64::from(MAX_BASIS_POINT),
            PoolError::InvalidParameters
        );
        let target_sqrt_price = target_sqrt_price(init_sqrt_price, target_increase_bps)?;
        require!(tick_spacing > 0, PoolError::InvalidParameters);
        let aligned_max_tick_id = align_id_to_spacing(MAX_TICK_ID, tick_spacing)?;
        require!(
            target_sqrt_price <= get_sqrt_price_from_tick_id(aligned_max_tick_id),
            PoolError::InvalidParameters
        );
        Ok(())
    }
    fn can_swap(&self, _current_point: u64) -> Result<bool> {
        Ok(true)
    }
    fn can_add_liquidity(&self, _current_point: u64) -> Result<bool> {
        Ok(self.is_reach_target())
    }
    fn can_remove_liquidity(&self, _current_point: u64) -> Result<bool> {
        Ok(self.is_reach_target())
    }
    fn update_post_swap(
        &mut self,
        initial_sqrt_price: u128,
        current_sqrt_price: u128,
    ) -> Result<()> {
        if self.is_reach_target() {
            return Ok(());
        }
        let target_sqrt_price =
            target_sqrt_price(initial_sqrt_price, self.target_increase_bps.into())?;
        if current_sqrt_price >= target_sqrt_price {
            self.is_reach_target = 1;
        }
        Ok(())
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct PodAlignedActivationTimeBased {
    pub activation_mode: u8,
    pub swap_point: Z40,
    pub add_liquidity_point: Z40,
    pub remove_liquidity_point: Z40,
}

impl Activation for PodAlignedActivationTimeBased {
    fn validate_initialize(
        &self,
        activation_point: u64,
        current_point: u64,
        activation_type: u8,
        _init_sqrt_price: u128,
        _tick_spacing: u16,
        _whitelisted_add_liquidity: &Pubkey,
    ) -> Result<()> {
        let farthest_future = match ActivationType::try_from(activation_type)
            .map_err(|_| PoolError::InvalidActivationType)?
        {
            ActivationType::Slot => current_point.safe_add(MAX_SLOT_BUFFER)?,
            ActivationType::Timestamp => current_point.safe_add(MAX_TIME_BUFFER)?,
        };

        require!(
            activation_point == u64::from(self.swap_point),
            PoolError::InvalidParameters
        );
        require!(
            current_point <= self.swap_point.into()
                && current_point <= self.add_liquidity_point.into()
                && current_point <= self.remove_liquidity_point.into(),
            PoolError::InvalidParameters
        );
        require!(
            farthest_future >= self.swap_point.into()
                && farthest_future >= self.add_liquidity_point.into()
                && farthest_future >= self.remove_liquidity_point.into(),
            PoolError::InvalidParameters
        );
        Ok(())
    }
    fn can_swap(&self, current_point: u64) -> Result<bool> {
        Ok(current_point >= self.swap_point.into())
    }
    fn can_add_liquidity(&self, current_point: u64) -> Result<bool> {
        Ok(current_point >= self.add_liquidity_point.into())
    }
    fn can_remove_liquidity(&self, current_point: u64) -> Result<bool> {
        Ok(current_point >= self.remove_liquidity_point.into())
    }
    fn update_post_swap(
        &mut self,
        _initial_sqrt_price: u128,
        _current_sqrt_price: u128,
    ) -> Result<()> {
        Ok(())
    }
}

pub fn get_activation_access<F>(pool_activation_info: &PoolActivationInfo, f: F) -> Result<bool>
where
    F: Fn(&dyn Activation) -> Result<bool>,
{
    let activation_mode: ActivationMode = try_cast(pool_activation_info.activation_mode)
        .map_err(|_| PoolError::InvalidActivationAccess)?;

    match activation_mode {
        ActivationMode::Open => {
            let a: &PodAlignedActivationOpen = bytemuck::must_cast_ref(pool_activation_info);
            f(a)
        }
        ActivationMode::BondingCurve => {
            let a: &PodAlignedActivationBondingCurve =
                bytemuck::must_cast_ref(pool_activation_info);
            f(a)
        }
        ActivationMode::TimeBased => {
            let a: &PodAlignedActivationTimeBased = bytemuck::must_cast_ref(pool_activation_info);
            f(a)
        }
    }
}

/// Run `validate_initialize` for one activation slot. `get_activation_access`
/// only lends a shared reference, so this is the mutable-free entry point
/// pool creation uses.
pub fn validate_activation_initialize(
    pool_activation_info: &PoolActivationInfo,
    activation_point: u64,
    current_point: u64,
    activation_type: u8,
    init_sqrt_price: u128,
    tick_spacing: u16,
    whitelisted_add_liquidity: &Pubkey,
) -> Result<()> {
    get_activation_access(pool_activation_info, |activation| {
        activation.validate_initialize(
            activation_point,
            current_point,
            activation_type,
            init_sqrt_price,
            tick_spacing,
            whitelisted_add_liquidity,
        )?;
        Ok(true)
    })?;
    Ok(())
}

/// The four mode pairs the program accepts, plus the rule that a pool which
/// can swap at creation must set `activation_point` to the current point.
pub fn validate_activation_combination(
    activation_modes: [ActivationMode; NUMBER_OF_ACTIVATION_MODES],
    activation_point: u64,
    current_point: u64,
) -> Result<()> {
    require!(
        matches!(
            activation_modes,
            [ActivationMode::Open, ActivationMode::Open]
                | [ActivationMode::Open, ActivationMode::BondingCurve]
                | [ActivationMode::Open, ActivationMode::TimeBased]
                | [ActivationMode::BondingCurve, ActivationMode::TimeBased]
        ),
        PoolError::InvalidParameters
    );

    if !activation_modes.contains(&ActivationMode::TimeBased) {
        require!(
            activation_point == current_point,
            PoolError::InvalidParameters
        );
    }
    Ok(())
}

/// Same post-swap write as `ix_swap`: set `is_reach_target` when a bonding
/// curve's price crosses `init_sqrt_price * target_increase_bps / 10_000`.
/// Open and time-based slots are unchanged. Swap amounts do not depend on
/// this flag.
pub fn apply_activation_post_swap(
    pool_activation_info: &mut PoolActivationInfo,
    initial_sqrt_price: u128,
    current_sqrt_price: u128,
) -> Result<()> {
    let activation_mode: ActivationMode = try_cast(pool_activation_info.activation_mode)
        .map_err(|_| PoolError::InvalidActivationAccess)?;

    match activation_mode {
        ActivationMode::Open => {
            let activation: &mut PodAlignedActivationOpen =
                bytemuck::must_cast_mut(pool_activation_info);
            activation.update_post_swap(initial_sqrt_price, current_sqrt_price)
        }
        ActivationMode::BondingCurve => {
            let activation: &mut PodAlignedActivationBondingCurve =
                bytemuck::must_cast_mut(pool_activation_info);
            activation.update_post_swap(initial_sqrt_price, current_sqrt_price)
        }
        ActivationMode::TimeBased => {
            let activation: &mut PodAlignedActivationTimeBased =
                bytemuck::must_cast_mut(pool_activation_info);
            activation.update_post_swap(initial_sqrt_price, current_sqrt_price)
        }
    }
}

/// `true` only for a bonding-curve slot whose `is_reach_target` byte is 1.
pub fn bonding_curve_is_reach_target(pool_activation_info: &PoolActivationInfo) -> Result<bool> {
    let activation_mode: ActivationMode = try_cast(pool_activation_info.activation_mode)
        .map_err(|_| PoolError::InvalidActivationAccess)?;
    if activation_mode != ActivationMode::BondingCurve {
        return Ok(false);
    }
    let activation: &PodAlignedActivationBondingCurve =
        bytemuck::must_cast_ref(pool_activation_info);
    Ok(activation.is_reach_target())
}

fn target_sqrt_price(init_sqrt_price: u128, target_increase_bps: u64) -> Result<u128> {
    use ruint::aliases::U192;
    Ok(try_cast(
        U192::from(init_sqrt_price)
            .safe_mul(U192::from(target_increase_bps))?
            .safe_div(U192::from(MAX_BASIS_POINT))?,
    )?)
}

fn align_id_to_spacing(tick_id: i32, tick_spacing: u16) -> Result<i32> {
    let spacing = i32::from(tick_spacing);
    tick_id
        .div_euclid(spacing)
        .checked_mul(spacing)
        .ok_or_else(|| PoolError::MathOverflow.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bonding_curve(target_increase_bps: u64) -> PodAlignedActivationBondingCurve {
        let mut activation = PodAlignedActivationBondingCurve {
            activation_mode: ActivationMode::BondingCurve.into(),
            ..Default::default()
        };
        activation.target_increase_bps.inner = target_increase_bps.to_le_bytes();
        activation
    }

    #[test]
    fn bonding_curve_rejects_a_default_whitelisted_depositor() {
        let activation = bonding_curve(10_005);
        let err = activation
            .validate_initialize(
                0,
                0,
                ActivationType::Timestamp.into(),
                1 << 64,
                1,
                &Pubkey::default(),
            )
            .unwrap_err();
        assert_eq!(err, PoolError::InvalidParameters.into());
    }

    #[test]
    fn post_swap_sets_the_flag_when_price_crosses_the_target() {
        let mut info: PoolActivationInfo = bytemuck::must_cast(bonding_curve(20_000));
        apply_activation_post_swap(&mut info, 100, 199).unwrap();
        assert!(!bonding_curve_is_reach_target(&info).unwrap());
        apply_activation_post_swap(&mut info, 100, 200).unwrap();
        assert!(bonding_curve_is_reach_target(&info).unwrap());
        apply_activation_post_swap(&mut info, 100, 50).unwrap();
        assert!(bonding_curve_is_reach_target(&info).unwrap());
    }

    #[test]
    fn combination_requires_the_activation_point_when_swap_is_open() {
        validate_activation_combination([ActivationMode::Open, ActivationMode::BondingCurve], 5, 5)
            .unwrap();
        assert!(validate_activation_combination(
            [ActivationMode::Open, ActivationMode::BondingCurve],
            4,
            5,
        )
        .is_err());
        validate_activation_combination(
            [ActivationMode::BondingCurve, ActivationMode::TimeBased],
            4,
            5,
        )
        .unwrap();
    }
}
