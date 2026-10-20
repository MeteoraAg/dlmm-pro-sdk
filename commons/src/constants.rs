use anchor_lang::derive_program_address;
use anchor_lang::solana_program::pubkey::Pubkey;

pub use crate::dlmm_pro::constants::*;

// Tick ids where 1.0001^tick_id reaches the max and min prices, 2^64 and 2^-64
pub const MAX_TICK_ID: i32 = 443636;
pub const MIN_TICK_ID: i32 = -443636;
pub const MAX_TICKS_PER_ARRAY: usize = MAX_TICKS_PER_ARRAY_U64 as usize;
pub const NUMBER_OF_ACTIVATION_MODES: usize = 2;
pub const NUM_REWARDS: usize = NUM_REWARDS_U64 as usize;
// If significant swaps are continuous for a long time, references are reset
pub const MAX_REFERENCE_AGE: u64 = 3600; // 1 hour

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
    pub const POSITION_PREFIX: &[u8] = b"position";
    pub const LIMIT_ORDER_PREFIX: &[u8] = b"limit_order";
    pub const REWARD_VAULT_PREFIX: &[u8] = b"reward";

    /// Seed of the access-registry program's `TokenBadge` PDA
    /// (see `pda::ACCESS_REGISTRY_ID`).
    pub const TOKEN_BADGE_PREFIX: &[u8] = b"token_badge";
    /// Anchor's event-CPI authority seed; `#[event_cpi]` derives it, the
    /// program source never names it.
    pub const EVENT_AUTHORITY_PREFIX: &[u8] = b"__event_authority";
}
pub use seeds::*;

pub mod pool_authority {
    use super::*;

    const POOL_AUTHORITY_AND_BUMP: ([u8; 32], u8) = derive_program_address(
        &[seeds::POOL_AUTHORITY_PREFIX],
        &crate::dlmm_pro::ID_CONST.to_bytes(),
    );

    pub const ID: Pubkey = Pubkey::new_from_array(POOL_AUTHORITY_AND_BUMP.0);
    pub const BUMP: u8 = POOL_AUTHORITY_AND_BUMP.1;
}
