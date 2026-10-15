//! Token-2022 helpers: transfer-fee math (quotes must account for it) and
//! transfer-hook remaining accounts (swaps must pass them).
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_lang::solana_program::pubkey::Pubkey;
use anchor_spl::token_2022::spl_token_2022::{
    self,
    extension::{
        transfer_fee::{TransferFee, TransferFeeConfig, MAX_FEE_BASIS_POINTS},
        transfer_hook, BaseStateWithExtensions, StateWithExtensions,
    },
};
use spl_transfer_hook_interface::offchain::{
    add_extra_account_metas_for_execute, AccountDataResult, AccountFetchError,
};
use std::future::Future;

use crate::PoolError;

#[derive(Debug, Clone, Copy)]
pub struct TransferHookContext {
    pub source: Pubkey,
    pub destination: Pubkey,
    pub authority: Pubkey,
    pub amount: u64,
}

#[derive(Debug, Clone, Copy)]
pub struct TransferFeeIncludedAmount {
    pub amount: u64,
    pub transfer_fee: u64,
}

#[derive(Debug, Clone, Copy)]
pub struct TransferFeeExcludedAmount {
    pub amount: u64,
    pub transfer_fee: u64,
}

/// The transfer fee schedule active at `epoch`, if the mint has one.
/// `mint_data` is the raw mint account data (legacy SPL mints return `None`).
pub fn get_epoch_transfer_fee(mint_data: &[u8], epoch: u64) -> Result<Option<TransferFee>> {
    let mint = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(mint_data)
        .map_err(|_| PoolError::InvalidAccount)?;
    if let Ok(transfer_fee_config) = mint.get_extension::<TransferFeeConfig>() {
        return Ok(Some(*transfer_fee_config.get_epoch_fee(epoch)));
    }
    Ok(None)
}

pub fn calculate_transfer_fee_excluded_amount(
    mint_data: &[u8],
    epoch: u64,
    transfer_fee_included_amount: u64,
) -> Result<TransferFeeExcludedAmount> {
    if let Some(epoch_transfer_fee) = get_epoch_transfer_fee(mint_data, epoch)? {
        let transfer_fee = epoch_transfer_fee
            .calculate_fee(transfer_fee_included_amount)
            .ok_or(PoolError::MathOverflow)?;
        let transfer_fee_excluded_amount = transfer_fee_included_amount
            .checked_sub(transfer_fee)
            .ok_or(PoolError::MathOverflow)?;
        return Ok(TransferFeeExcludedAmount {
            amount: transfer_fee_excluded_amount,
            transfer_fee,
        });
    }

    Ok(TransferFeeExcludedAmount {
        amount: transfer_fee_included_amount,
        transfer_fee: 0,
    })
}

pub fn calculate_transfer_fee_included_amount(
    mint_data: &[u8],
    epoch: u64,
    transfer_fee_excluded_amount: u64,
) -> Result<TransferFeeIncludedAmount> {
    if transfer_fee_excluded_amount == 0 {
        return Ok(TransferFeeIncludedAmount {
            amount: 0,
            transfer_fee: 0,
        });
    }

    if let Some(epoch_transfer_fee) = get_epoch_transfer_fee(mint_data, epoch)? {
        let transfer_fee: u64 =
            if u16::from(epoch_transfer_fee.transfer_fee_basis_points) == MAX_FEE_BASIS_POINTS {
                // edge-case: if transfer fee rate is 100%, SPL's inverse fee is 0;
                // use maximum_fee like the program does.
                u64::from(epoch_transfer_fee.maximum_fee)
            } else {
                epoch_transfer_fee
                    .calculate_inverse_fee(transfer_fee_excluded_amount)
                    .ok_or(PoolError::MathOverflow)?
            };

        let transfer_fee_included_amount = transfer_fee_excluded_amount
            .checked_add(transfer_fee)
            .ok_or(PoolError::MathOverflow)?;

        let transfer_fee_verification = epoch_transfer_fee
            .calculate_fee(transfer_fee_included_amount)
            .ok_or(PoolError::MathOverflow)?;
        if transfer_fee != transfer_fee_verification {
            return Err(PoolError::MathOverflow.into());
        }

        return Ok(TransferFeeIncludedAmount {
            amount: transfer_fee_included_amount,
            transfer_fee,
        });
    }

    Ok(TransferFeeIncludedAmount {
        amount: transfer_fee_excluded_amount,
        transfer_fee: 0,
    })
}

/// Extra account metas a transfer of `mint` needs when the mint has a
/// transfer hook; empty for legacy SPL mints and Token-2022 mints without one.
/// `fetch_account_data` is the caller's RPC accessor; its errors are returned
/// as is.
pub async fn get_extra_account_metas_for_transfer_hook<F, Fut>(
    mint: Pubkey,
    mint_data: &[u8],
    context: TransferHookContext,
    fetch_account_data: F,
) -> std::result::Result<Vec<AccountMeta>, AccountFetchError>
where
    F: Fn(Pubkey) -> Fut,
    Fut: Future<Output = AccountDataResult>,
{
    let mint_state = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(mint_data)?;

    let Some(transfer_hook_program_id) = transfer_hook::get_program_id(&mint_state) else {
        return Ok(vec![]);
    };

    let mut transfer_ix = spl_token_2022::instruction::transfer_checked(
        &spl_token_2022::ID,
        &context.source,
        &mint,
        &context.destination,
        &context.authority,
        &[],
        context.amount,
        mint_state.base.decimals,
    )?;

    add_extra_account_metas_for_execute(
        &mut transfer_ix,
        &transfer_hook_program_id,
        &context.source,
        &mint,
        &context.destination,
        &context.authority,
        context.amount,
        fetch_account_data,
    )
    .await?;

    // Skip source, mint, destination, authority
    Ok(transfer_ix.accounts[4..].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_spl::token_2022::spl_token_2022::extension::BaseStateWithExtensionsMut;
    use anchor_spl::token_2022::spl_token_2022::{
        extension::{transfer_hook::TransferHook, ExtensionType, StateWithExtensionsMut},
        state::Mint,
    };
    use solana_program_pack::Pack;
    use spl_tlv_account_resolution::{
        account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
    };
    use spl_transfer_hook_interface::{
        get_extra_account_metas_address, instruction::ExecuteInstruction,
    };

    #[tokio::test]
    async fn resolves_pdas_with_the_transfer_context() {
        let hook_program = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let source = Pubkey::new_unique();
        let destination = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let amount = 100;

        let mint_size =
            ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::TransferHook])
                .unwrap();
        let mut mint_data = vec![0; mint_size];
        let mut mint_state =
            StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut mint_data).unwrap();
        mint_state.base = Mint {
            decimals: 6,
            is_initialized: true,
            ..Mint::default()
        };
        mint_state.pack_base();
        mint_state.init_account_type().unwrap();
        mint_state
            .init_extension::<TransferHook>(true)
            .unwrap()
            .program_id = Some(hook_program).try_into().unwrap();

        let extra_metas = [ExtraAccountMeta::new_with_seeds(
            &[
                Seed::AccountKey { index: 0 },
                Seed::AccountKey { index: 2 },
                Seed::AccountKey { index: 4 },
            ],
            false,
            true,
        )
        .unwrap()];
        let mut validation_data =
            vec![0; ExtraAccountMetaList::size_of(extra_metas.len()).unwrap()];
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut validation_data, &extra_metas)
            .unwrap();

        let expected = Pubkey::find_program_address(
            &[
                source.as_ref(),
                destination.as_ref(),
                get_extra_account_metas_address(&mint, &hook_program).as_ref(),
            ],
            &hook_program,
        )
        .0;
        let metas = get_extra_account_metas_for_transfer_hook(
            mint,
            &mint_data,
            TransferHookContext {
                source,
                destination,
                authority,
                amount,
            },
            move |_| {
                let data = validation_data.clone();
                async move { Ok(Some(data)) }
            },
        )
        .await
        .unwrap();

        assert_eq!(
            metas,
            vec![
                AccountMeta::new(expected, false),
                AccountMeta::new_readonly(hook_program, false),
                AccountMeta::new_readonly(
                    get_extra_account_metas_address(&mint, &hook_program),
                    false
                ),
            ]
        );
    }

    #[tokio::test]
    async fn a_legacy_mint_needs_no_hook_accounts() {
        let mut mint_data = vec![0; Mint::LEN];
        Mint {
            decimals: 6,
            is_initialized: true,
            ..Mint::default()
        }
        .pack_into_slice(&mut mint_data);

        let metas = get_extra_account_metas_for_transfer_hook(
            Pubkey::new_unique(),
            &mint_data,
            TransferHookContext {
                source: Pubkey::new_unique(),
                destination: Pubkey::new_unique(),
                authority: Pubkey::new_unique(),
                amount: 1,
            },
            |_| async { Ok(None) },
        )
        .await
        .unwrap();
        assert!(metas.is_empty());
    }
}
