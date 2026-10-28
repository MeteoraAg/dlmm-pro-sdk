//! Remaining-accounts assembly for instructions that take
//! `RemainingAccountsInfo` (transfer-hook slices first, then tick arrays).
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_lang::Result;

use crate::PoolError;

pub use crate::dlmm_pro::types::{AccountsType, RemainingAccountsInfo, RemainingAccountsSlice};

#[derive(Debug, Default, Clone)]
pub struct TransferHookAccounts {
    pub transfer_hook_x: Vec<AccountMeta>,
    pub transfer_hook_y: Vec<AccountMeta>,
    pub transfer_hook_referral: Vec<AccountMeta>,
    pub transfer_hook_reward: Vec<AccountMeta>,
}

/// Build `(RemainingAccountsInfo, remaining accounts)` from transfer-hook
/// account lists, one slice per non-empty list. Fill only the lists the target
/// instruction accepts. Tick arrays, when an instruction needs them, go after
/// these accounts and are not described by a slice.
pub fn remaining_accounts_from_hooks(
    hooks: &TransferHookAccounts,
) -> Result<(RemainingAccountsInfo, Vec<AccountMeta>)> {
    let mut slices = vec![];
    let mut remaining_accounts = vec![];
    for (accounts, accounts_type) in [
        (&hooks.transfer_hook_x, AccountsType::TransferHookX),
        (&hooks.transfer_hook_y, AccountsType::TransferHookY),
        (
            &hooks.transfer_hook_referral,
            AccountsType::TransferHookReferral,
        ),
        (
            &hooks.transfer_hook_reward,
            AccountsType::TransferHookReward,
        ),
    ] {
        if accounts.is_empty() {
            continue;
        }
        slices.push(RemainingAccountsSlice {
            accounts_type,
            length: u8::try_from(accounts.len())
                .map_err(|_| PoolError::InvalidRemainingAccountSlice)?,
        });
        remaining_accounts.extend_from_slice(accounts);
    }
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
    fn one_slice_per_non_empty_list_in_account_order() {
        let hooks = TransferHookAccounts {
            transfer_hook_y: accounts(2),
            transfer_hook_reward: accounts(1),
            ..Default::default()
        };
        let (info, metas) = remaining_accounts_from_hooks(&hooks).unwrap();
        assert!(matches!(
            info.slices[..],
            [
                RemainingAccountsSlice {
                    accounts_type: AccountsType::TransferHookY,
                    length: 2,
                },
                RemainingAccountsSlice {
                    accounts_type: AccountsType::TransferHookReward,
                    length: 1,
                },
            ]
        ));
        assert_eq!(
            metas,
            [hooks.transfer_hook_y, hooks.transfer_hook_reward].concat()
        );
    }
}
