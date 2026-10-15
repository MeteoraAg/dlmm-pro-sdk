//! PDA derivations matching the program's seeds.
use anchor_lang::solana_program::pubkey::Pubkey;
use std::cmp::{max, min};

use crate::constants::seeds::*;
use crate::dlmm_pro;

pub fn derive_event_authority() -> Pubkey {
    Pubkey::find_program_address(&[EVENT_AUTHORITY_PREFIX], &dlmm_pro::ID).0
}

pub fn derive_operator(whitelisted_address: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[OPERATOR_PREFIX, whitelisted_address.as_ref()],
        &dlmm_pro::ID,
    )
    .0
}

pub fn derive_static_config(index: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[STATIC_CONFIG_PREFIX, index.to_le_bytes().as_ref()],
        &dlmm_pro::ID,
    )
    .0
}

pub fn derive_dynamic_config(pool_creator_authority: Pubkey, index: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[
            DYNAMIC_CONFIG_PREFIX,
            pool_creator_authority.as_ref(),
            index.to_le_bytes().as_ref(),
        ],
        &dlmm_pro::ID,
    )
    .0
}

/// The access-registry program that owns `TokenBadge` accounts. Pool creation
/// validates the optional `token_badge_x`/`token_badge_y` accounts against
/// this program's PDAs.
pub const ACCESS_REGISTRY_ID: Pubkey =
    anchor_lang::pubkey!("regUFehW9oycnaV2auYyfqyYjKG1W1uLNT7rtUeemQr");

/// Token badge PDA under the access-registry program (see
/// [`ACCESS_REGISTRY_ID`]): `["token_badge", token_mint]`.
pub fn derive_token_badge(token_mint: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[TOKEN_BADGE_PREFIX, token_mint.as_ref()],
        &ACCESS_REGISTRY_ID,
    )
    .0
}

/// Static/dynamic config pool: `["pool", config, max(mintX,mintY), min(mintX,mintY)]`
pub fn derive_pool(config: Pubkey, token_x_mint: Pubkey, token_y_mint: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            POOL_PREFIX,
            config.as_ref(),
            max(token_x_mint, token_y_mint).as_ref(),
            min(token_x_mint, token_y_mint).as_ref(),
        ],
        &dlmm_pro::ID,
    )
    .0
}

/// Launch pool: `["l_pool", max(mintX,mintY), min(mintX,mintY)]`
pub fn derive_launch_pool(token_x_mint: Pubkey, token_y_mint: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            LAUNCH_POOL_PREFIX,
            max(token_x_mint, token_y_mint).as_ref(),
            min(token_x_mint, token_y_mint).as_ref(),
        ],
        &dlmm_pro::ID,
    )
    .0
}

pub fn derive_oracle(pool: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[ORACLE_PREFIX, pool.as_ref()], &dlmm_pro::ID).0
}

pub fn derive_reserve(mint: Pubkey, pool: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[RESERVE_PREFIX, mint.as_ref(), pool.as_ref()],
        &dlmm_pro::ID,
    )
    .0
}

pub fn derive_tick_array_bitmap_extension(pool: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[TICK_ARRAY_BITMAP_EXTENSION_PREFIX, pool.as_ref()],
        &dlmm_pro::ID,
    )
    .0
}

pub fn derive_tick_array(pool: Pubkey, tick_array_index: i32) -> Pubkey {
    Pubkey::find_program_address(
        &[
            TICK_ARRAY_PREFIX,
            pool.as_ref(),
            tick_array_index.to_le_bytes().as_ref(),
        ],
        &dlmm_pro::ID,
    )
    .0
}

pub fn derive_position(nft_mint: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[POSITION_PREFIX, nft_mint.as_ref()], &dlmm_pro::ID).0
}

pub fn derive_limit_order(nft_mint: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[LIMIT_ORDER_PREFIX, nft_mint.as_ref()], &dlmm_pro::ID).0
}

/// Reward vault PDA — `reward_index` is `u8` on-chain (`to_le_bytes()` = 1 byte)
pub fn derive_reward_vault(pool: Pubkey, reward_index: u8) -> Pubkey {
    Pubkey::find_program_address(
        &[REWARD_VAULT_PREFIX, pool.as_ref(), &[reward_index]],
        &dlmm_pro::ID,
    )
    .0
}
