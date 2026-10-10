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

pub const U24_MAX: u32 = 0xffffff;

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

    // If significant swaps are continuous for a long time, references are reset
    pub const MAX_REFERENCE_AGE: u64 = 3600; // 1 hour
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

pub mod slot_constants {
    // 1 slot = 250ms
    pub const MS_PER_SLOT: u64 = 250;
}
pub use slot_constants::*;

pub mod activation_constants {
    use super::*;
    pub const MAX_TIME_BUFFER: u64 = 2592000; // 1 month = 3600 * 24 * 30 seconds
    pub const MAX_SLOT_BUFFER: u64 = MAX_TIME_BUFFER * 1000 / MS_PER_SLOT;
}
pub use activation_constants::*;

pub mod vesting_constants {
    use super::*;
    pub const MAX_VESTING_DURATION: u64 = 86400 * 365 * 10; // 10 years
    pub const MAX_VESTING_DURATION_SLOT: u64 = MAX_VESTING_DURATION * 1000 / MS_PER_SLOT;
}
pub use vesting_constants::*;

pub mod token_constants {
    use super::*;

    pub const WHITELISTED_MINTS: [Pubkey; 2] = [
        Pubkey::from_str_const("So11111111111111111111111111111111111111112"),
        Pubkey::from_str_const("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    ];
}
pub use token_constants::*;

pub mod seeds {
    pub const OPERATOR_PREFIX: &[u8] = b"operator";
    pub const STATIC_CONFIG_PREFIX: &[u8] = b"s_config";
    pub const DYNAMIC_CONFIG_PREFIX: &[u8] = b"d_config";
    pub const POOL_PREFIX: &[u8] = b"pool";
    pub const LAUNCH_POOL_PREFIX: &[u8] = b"l_pool";
    pub const POOL_AUTHORITY_PREFIX: &[u8] = b"pool_auth";
    pub const RESERVE_PREFIX: &[u8] = b"reserve";
    pub const TICK_ARRAY_BITMAP_EXTENSION_PREFIX: &[u8] = b"bitmap";
    pub const ORACLE_PREFIX: &[u8] = b"oracle";
    pub const TICK_ARRAY_PREFIX: &[u8] = b"tick_array";
    pub const TICK_BITMAP_EXTENSION_PREFIX: &[u8] = b"tick_bitmap";
    pub const POSITION_PREFIX: &[u8] = b"position";
    pub const LIMIT_ORDER_PREFIX: &[u8] = b"limit_order";
    pub const REWARD_VAULT_PREFIX: &[u8] = b"reward";

    /// Seed of the external access-registry program's `TokenBadge` PDA
    /// (see `pda::ACCESS_REGISTRY_ID`), not a dlmm-pro seed.
    pub const TOKEN_BADGE_PREFIX: &[u8] = b"token_badge";
    /// Anchor's event-CPI authority seed; `#[event_cpi]` derives it, the
    /// program source never names it.
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
