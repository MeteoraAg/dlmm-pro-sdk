use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};
use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::*;

#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, IntoPrimitive, TryFromPrimitive)]
pub enum ActivationType {
    Slot,
    Timestamp,
}

#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, IntoPrimitive, TryFromPrimitive)]
pub enum ActivationMode {
    Open,         // all swap and modify liquidity are opened once pool is created
    BondingCurve, // add and remove liquidity open once the price reaches the target
    TimeBased,    // swap and modify liquidity is time based
}

pub fn get_current_point(activation_type: u8, clock: &Clock) -> Result<u64> {
    let activation_type =
        ActivationType::try_from(activation_type).map_err(|_| PoolError::InvalidActivationType)?;
    match activation_type {
        ActivationType::Slot => Ok(clock.slot),
        ActivationType::Timestamp => Ok(clock.unix_timestamp as u64),
    }
}

pub trait Activation {
    fn can_swap(&self, current_point: u64) -> Result<bool>;
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct PodAlignedActivationOpen {
    pub activation_mode: u8,
    pub _padding: [u8; 15],
}

impl Activation for PodAlignedActivationOpen {
    fn can_swap(&self, _current_point: u64) -> Result<bool> {
        Ok(true)
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

impl Activation for PodAlignedActivationBondingCurve {
    fn can_swap(&self, _current_point: u64) -> Result<bool> {
        Ok(true)
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
    fn can_swap(&self, current_point: u64) -> Result<bool> {
        Ok(current_point >= self.swap_point.into())
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
