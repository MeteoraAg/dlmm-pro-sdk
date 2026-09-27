//! Constants ported from the on-chain program.
use anchor_lang::solana_program::pubkey::Pubkey;

pub const BITMAP_SIZE: i32 = 512;
// Max & min tick index based on sqrt(1.0001) & max.min price of 2^64
pub const MAX_TICK_ID: i32 = 443636;
pub const MIN_TICK_ID: i32 = -443636;
pub const MIN_SQRT_PRICE: u128 = 4295048016;
pub const MAX_SQRT_PRICE: u128 = 79226673515401279992447579055;
pub const MAX_TICKS_PER_ARRAY: usize = 128;

pub const NUMBER_OF_ACTIVATION_MODES: usize = 2;
pub const MAX_TICK_SPACING: u16 = 256;
pub const MAX_BASIS_POINT: u16 = 10_000;

pub const MIN_ORACLE_OBSERVATION_LENGTH: usize = 1;

pub mod fee_constants {
    pub const MM_PROTOCOL_FEE_BPS: u16 = 1000; // 10%
    pub const MM_LAUNCH_POOL_PROTOCOL_FEE_BPS: u16 = 2000; // 20%
    pub const LIMIT_ORDER_PROTOCOL_FEE_BPS: u16 = 5000; // 50%

    pub const FEE_DENOMINATOR: u64 = 1_000_000_000;

    /// Host fee. 20%
    pub const HOST_FEE_BPS: u16 = 2_000;

    pub const MAX_PARTNER_FEE_BPS: u16 = 5_000; // 50%

    pub const MAX_FEE_NUMERATOR: u64 = 990_000_000; // 99%
    pub const MIN_FEE_NUMERATOR: u64 = 100_000; // 0.01%

    pub const MIN_DELTA_TICK_FOR_DYNAMIC_FEE_UPDATE: u128 = 4; // 4 bps
}
pub use fee_constants::*;

pub mod reward_constants {
    pub const NUM_REWARDS: usize = 2;
    pub const MIN_REWARD_DURATION: u64 = 86400; // 1 day
    pub const MAX_REWARD_DURATION: u64 = 31536000; // 1 year
    pub const MAX_REWARD_START_DELAY: u64 = 86400 * 30; // 30 days
}
pub use reward_constants::*;

pub mod oracle_constants {
    pub const MAX_OBSERVATION_LENGTH: usize = 500;
    pub const SAMPLE_LIFETIME: u64 = 15;
}
pub use oracle_constants::*;

pub mod position_constants {
    pub const POSITION_MAX_RANGE: usize = 45;
}
pub use position_constants::*;

pub mod limit_order_constants {
    pub const LIMIT_ORDER_MAX_TICK: usize = 25;
    pub const LIMIT_ORDER_REFERRAL_FEE_BPS: u16 = 2_000; // 20%
}
pub use limit_order_constants::*;

pub mod vesting_constants {
    pub const MAX_VESTING_DURATION: u64 = 86400 * 365 * 10; // 10 years
}
pub use vesting_constants::*;

pub mod seeds {
    pub const OPERATOR_PREFIX: &[u8] = b"operator";
    pub const STATIC_CONFIG_PREFIX: &[u8] = b"s_config";
    pub const DYNAMIC_CONFIG_PREFIX: &[u8] = b"d_config";
    /// Seed of the external access-registry program's `TokenBadge` PDA.
    /// This is no longer a dlmm-pro seed: token badges are owned by the
    /// access-registry program (see `pda::ACCESS_REGISTRY_ID`).
    pub const TOKEN_BADGE_PREFIX: &[u8] = b"token_badge";
    pub const POOL_PREFIX: &[u8] = b"pool";
    pub const LAUNCH_POOL_PREFIX: &[u8] = b"l_pool";
    pub const POOL_AUTHORITY_PREFIX: &[u8] = b"pool_auth";
    pub const RESERVE_PREFIX: &[u8] = b"reserve";
    pub const TICK_ARRAY_BITMAP_EXTENSION_PREFIX: &[u8] = b"bitmap";
    pub const ORACLE_PREFIX: &[u8] = b"oracle";
    pub const TICK_ARRAY_PREFIX: &[u8] = b"tick_array";
    pub const POSITION_PREFIX: &[u8] = b"position";
    pub const LIMIT_ORDER_PREFIX: &[u8] = b"limit_order";
    pub const REWARD_VAULT_PREFIX: &[u8] = b"reward";
    pub const EVENT_AUTHORITY_PREFIX: &[u8] = b"__event_authority";
}
pub use seeds::*;

use anchor_lang::derive_program_address;

pub mod pool_authority {
    use super::*;

    const POOL_AUTHORITY_AND_BUMP: ([u8; 32], u8) = derive_program_address(
        &[seeds::POOL_AUTHORITY_PREFIX],
        &crate::dlmm_pro::ID_CONST.to_bytes(),
    );

    pub const ID: Pubkey = Pubkey::new_from_array(POOL_AUTHORITY_AND_BUMP.0);
    pub const BUMP: u8 = POOL_AUTHORITY_AND_BUMP.1;
}
