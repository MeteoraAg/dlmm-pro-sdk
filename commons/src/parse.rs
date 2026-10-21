//! Account parsers for the header + dynamic-tail layout the program uses.
//!
//! Every account is `8-byte discriminator || fixed header (INIT_SPACE bytes) ||
//! dynamic tail`. The tail element type of `Pool`, `TickArray` and
//! `PositionArray` depends on the pool's extension flags.
use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use bytemuck::AnyBitPattern;

use crate::*;

fn check_discriminator<T: Discriminator>(data: &[u8]) -> Result<()> {
    if !data.starts_with(T::DISCRIMINATOR) {
        return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorMismatch.into());
    }
    Ok(())
}

/// Decode an account's fixed header: strip the 8-byte discriminator and read
/// exactly `size_of::<T>()` bytes.
fn pod_read_unaligned_skip_disc<T: AnyBitPattern>(account_data: &[u8]) -> Result<T> {
    let size = std::mem::size_of::<T>();
    if account_data.len() < 8 + size {
        return Err(PoolError::InvalidAccount.into());
    }
    Ok(bytemuck::pod_read_unaligned(&account_data[8..8 + size]))
}

fn pod_read_seq<T: AnyBitPattern>(tail: &[u8]) -> Result<Vec<T>> {
    let stride = std::mem::size_of::<T>();
    if !tail.len().is_multiple_of(stride) {
        return Err(PoolError::InvalidAccount.into());
    }
    Ok(tail
        .chunks_exact(stride)
        .map(bytemuck::pod_read_unaligned)
        .collect())
}

/// Parsed `Pool` account: fixed header plus extension-gated tail segments.
#[derive(Debug, Clone, Copy)]
pub struct DynamicPool {
    pub pool: Pool,
    pub pool_reward: Option<PoolReward>,
    pub pool_activation: Option<PoolActivation>,
}

impl DynamicPool {
    pub fn deserialize(account_data: &[u8]) -> Result<Self> {
        check_discriminator::<Pool>(account_data)?;
        let pool: Pool = pod_read_unaligned_skip_disc(account_data)?;

        let mut offset = 8 + POOL_INIT_SPACE;
        let pool_reward = if pool.is_support_liquidity_mining() {
            let end = offset + POOL_REWARD_INIT_SPACE;
            let reward: PoolReward = bytemuck::pod_read_unaligned(
                account_data
                    .get(offset..end)
                    .ok_or(PoolError::InvalidAccount)?,
            );
            offset = end;
            Some(reward)
        } else {
            None
        };

        let pool_activation = if pool.is_support_activation_access() {
            let end = offset + POOL_ACTIVATION_INIT_SPACE;
            Some(bytemuck::pod_read_unaligned(
                account_data
                    .get(offset..end)
                    .ok_or(PoolError::InvalidAccount)?,
            ))
        } else {
            None
        };

        Ok(DynamicPool {
            pool,
            pool_reward,
            pool_activation,
        })
    }
}

/// Tick tail of a `TickArray` account, in the pool's tick layout.
#[derive(Debug, Clone)]
pub enum Ticks {
    Base(Vec<Tick>),
    WithReward(Vec<TickWithReward>),
}

impl Ticks {
    /// The base `Tick` view of every element, dropping reward growths.
    pub fn base_ticks(&self) -> Vec<Tick> {
        match self {
            Ticks::Base(ticks) => ticks.clone(),
            Ticks::WithReward(ticks) => ticks.iter().map(|t| t.inner).collect(),
        }
    }
}

/// Parsed `TickArray` account.
#[derive(Debug, Clone)]
pub struct DynamicTickArray {
    pub fixed: TickArray,
    pub ticks: Ticks,
}

impl DynamicTickArray {
    /// Parse the dynamic tail using the layout selected by the owning pool.
    pub fn deserialize(account_data: &[u8], pool: &Pool) -> Result<Self> {
        check_discriminator::<TickArray>(account_data)?;
        let fixed: TickArray = pod_read_unaligned_skip_disc(account_data)?;
        let tail = &account_data[8 + TICK_ARRAY_INIT_SPACE..];
        let ticks = if pool.is_support_liquidity_mining() {
            Ticks::WithReward(pod_read_seq(tail)?)
        } else {
            Ticks::Base(pod_read_seq(tail)?)
        };
        Ok(DynamicTickArray { fixed, ticks })
    }
}

/// Parsed `Oracle` account.
#[derive(Debug, Clone)]
pub struct DynamicOracle {
    pub fixed: Oracle,
    pub observations: Vec<Observation>,
}

impl DynamicOracle {
    pub fn deserialize(account_data: &[u8]) -> Result<Self> {
        check_discriminator::<Oracle>(account_data)?;
        let fixed: Oracle = pod_read_unaligned_skip_disc(account_data)?;
        let observations = pod_read_seq(&account_data[8 + ORACLE_INIT_SPACE..])?;
        Ok(DynamicOracle {
            fixed,
            observations,
        })
    }
}

/// Parsed `LimitOrder` account.
#[derive(Debug, Clone)]
pub struct DynamicLimitOrder {
    pub fixed: LimitOrder,
    pub orders: Vec<LimitOrderData>,
}

impl DynamicLimitOrder {
    pub fn deserialize(account_data: &[u8]) -> Result<Self> {
        check_discriminator::<LimitOrder>(account_data)?;
        let fixed: LimitOrder = pod_read_unaligned_skip_disc(account_data)?;
        let orders = pod_read_seq(&account_data[8 + LIMIT_ORDER_INIT_SPACE..])?;
        Ok(DynamicLimitOrder { fixed, orders })
    }
}

/// Position tail of a `PositionArray` account, in the pool's layout.
#[derive(Debug, Clone)]
pub enum Positions {
    Base(Vec<Position>),
    WithReward(Vec<PositionWithReward>),
}

impl Positions {
    pub fn base_positions(&self) -> Vec<Position> {
        match self {
            Positions::Base(positions) => positions.clone(),
            Positions::WithReward(positions) => positions.iter().map(|p| p.inner).collect(),
        }
    }
}

/// Parsed `PositionArray` account.
#[derive(Debug, Clone)]
pub struct DynamicPositionArray {
    pub fixed: PositionArray,
    pub positions: Positions,
}

impl DynamicPositionArray {
    /// Parse the dynamic tail using the layout selected by the owning pool.
    pub fn deserialize(account_data: &[u8], pool: &Pool) -> Result<Self> {
        check_discriminator::<PositionArray>(account_data)?;
        let fixed: PositionArray = pod_read_unaligned_skip_disc(account_data)?;
        let tail = &account_data[8 + POSITION_ARRAY_INIT_SPACE..];
        let positions = if pool.is_support_liquidity_mining() {
            Positions::WithReward(pod_read_seq(tail)?)
        } else {
            Positions::Base(pod_read_seq(tail)?)
        };
        Ok(DynamicPositionArray { fixed, positions })
    }
}

/// Parse a fixed-size zero-copy account (no dynamic tail).
pub fn deserialize_anchor_pod_account<T: AnyBitPattern + Discriminator>(
    account_data: &[u8],
) -> Result<T> {
    check_discriminator::<T>(account_data)?;
    pod_read_unaligned_skip_disc(account_data)
}
