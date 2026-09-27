//! Remaining-accounts assembly for instructions that take
//! `RemainingAccountsInfo` (transfer-hook slices first, then tick arrays).
use anchor_lang::prelude::Result;
use anchor_lang::solana_program::instruction::AccountMeta;

pub use crate::dlmm_pro::types::{AccountsType, RemainingAccountsInfo, RemainingAccountsSlice};
use crate::PoolError;

#[derive(Debug, Default, Clone)]
pub struct TransferHookAccounts {
    pub transfer_hook_x: Vec<AccountMeta>,
    pub transfer_hook_y: Vec<AccountMeta>,
    pub transfer_hook_referral: Vec<AccountMeta>,
    pub transfer_hook_reward: Vec<AccountMeta>,
}

/// Slice types accepted by `swap` and `cancel_limit_order`.
pub const SWAP_ACCOUNTS_TYPES: [AccountsType; 3] = [
    AccountsType::TransferHookX,
    AccountsType::TransferHookY,
    AccountsType::TransferHookReferral,
];
/// Slice types accepted by the liquidity and fee-claim instructions.
pub const LIQUIDITY_ACCOUNTS_TYPES: [AccountsType; 2] =
    [AccountsType::TransferHookX, AccountsType::TransferHookY];
/// Slice types accepted by the reward instructions.
pub const REWARD_ACCOUNTS_TYPES: [AccountsType; 1] = [AccountsType::TransferHookReward];

/// Build `(RemainingAccountsInfo, remaining accounts)` from transfer-hook
/// account lists. `allowed` is the target instruction's slice-type list; the
/// program rejects any other slice type with `InvalidRemainingAccountSlice`,
/// so a non-empty list of a disallowed type fails here instead of on-chain.
/// Tick arrays (when an instruction needs them) are appended after these
/// accounts and are not described by a slice.
pub fn remaining_accounts_from_hooks(
    hooks: &TransferHookAccounts,
    allowed: &[AccountsType],
) -> Result<(RemainingAccountsInfo, Vec<AccountMeta>)> {
    let mut slices = vec![];
    let mut remaining_accounts = vec![];

    let mut push = |accounts: &[AccountMeta], accounts_type: AccountsType| -> Result<()> {
        if accounts.is_empty() {
            return Ok(());
        }
        // `AccountsType` from `declare_program!` is a data-less enum without `PartialEq`.
        let accepted = allowed.iter().any(|allowed| {
            std::mem::discriminant(allowed) == std::mem::discriminant(&accounts_type)
        });
        if !accepted {
            return Err(PoolError::InvalidRemainingAccountSlice.into());
        }
        let length =
            u8::try_from(accounts.len()).map_err(|_| PoolError::InvalidRemainingAccountSlice)?;
        slices.push(RemainingAccountsSlice {
            accounts_type,
            length,
        });
        remaining_accounts.extend_from_slice(accounts);
        Ok(())
    };

    push(&hooks.transfer_hook_x, AccountsType::TransferHookX)?;
    push(&hooks.transfer_hook_y, AccountsType::TransferHookY)?;
    push(
        &hooks.transfer_hook_referral,
        AccountsType::TransferHookReferral,
    )?;
    push(
        &hooks.transfer_hook_reward,
        AccountsType::TransferHookReward,
    )?;

    Ok((RemainingAccountsInfo { slices }, remaining_accounts))
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::solana_program::pubkey::Pubkey;

    fn accounts(length: usize) -> Vec<AccountMeta> {
        (0..length)
            .map(|_| AccountMeta::new_readonly(Pubkey::new_unique(), false))
            .collect()
    }

    #[test]
    fn accepts_u8_max_hook_slice() {
        let hooks = TransferHookAccounts {
            transfer_hook_x: accounts(u8::MAX as usize),
            ..Default::default()
        };
        let (info, metas) =
            remaining_accounts_from_hooks(&hooks, &LIQUIDITY_ACCOUNTS_TYPES).unwrap();
        assert_eq!(info.slices[0].length, u8::MAX);
        assert_eq!(metas.len(), u8::MAX as usize);
    }

    #[test]
    fn rejects_oversized_hook_slice() {
        let hooks = TransferHookAccounts {
            transfer_hook_x: accounts(u8::MAX as usize + 1),
            ..Default::default()
        };
        assert!(remaining_accounts_from_hooks(&hooks, &LIQUIDITY_ACCOUNTS_TYPES).is_err());
    }

    #[test]
    fn rejects_slice_types_the_instruction_does_not_accept() {
        let hooks = TransferHookAccounts {
            transfer_hook_x: accounts(1),
            transfer_hook_reward: accounts(1),
            ..Default::default()
        };
        assert!(remaining_accounts_from_hooks(&hooks, &SWAP_ACCOUNTS_TYPES).is_err());
        assert!(remaining_accounts_from_hooks(&hooks, &REWARD_ACCOUNTS_TYPES).is_err());

        let (info, metas) = remaining_accounts_from_hooks(
            &TransferHookAccounts {
                transfer_hook_reward: accounts(2),
                ..Default::default()
            },
            &REWARD_ACCOUNTS_TYPES,
        )
        .unwrap();
        assert_eq!(info.slices.len(), 1);
        assert_eq!(metas.len(), 2);
    }

    #[test]
    fn ignores_empty_lists_of_disallowed_types() {
        let hooks = TransferHookAccounts {
            transfer_hook_y: accounts(3),
            ..Default::default()
        };
        let (info, metas) =
            remaining_accounts_from_hooks(&hooks, &LIQUIDITY_ACCOUNTS_TYPES).unwrap();
        assert_eq!(info.slices.len(), 1);
        assert_eq!(metas.len(), 3);
    }
}
