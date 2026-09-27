//! Shared LiteSVM setup for quote-vs-execution tests.
use std::sync::atomic::{AtomicU64, Ordering};

use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::pubkey::Pubkey;
use anchor_lang::{InstructionData, ToAccountMetas};
use anchor_spl::token_2022::spl_token_2022::{
    extension::transfer_fee::instruction::initialize_transfer_fee_config, extension::ExtensionType,
    instruction::initialize_mint2, instruction::mint_to, state::Mint as MintState,
};
use dlmm_pro_commons::dlmm_pro::client::{accounts, args};
use dlmm_pro_commons::dlmm_pro::types;
use dlmm_pro_commons::*;
use litesvm::types::FailedTransactionMetadata;
use litesvm::LiteSVM;
use litesvm_token::spl_token::state::Account as SplTokenAccount;
use litesvm_token::{get_spl_account, CreateAssociatedTokenAccount, CreateMint};
use solana_clock::Clock;
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;

fn program_so_path() -> String {
    std::env::var("DLMM_PRO_SO_PATH").unwrap_or_else(|_| {
        concat!(env!("CARGO_MANIFEST_DIR"), "/../tests/fixtures/dlmm_pro.so").to_string()
    })
}

fn access_registry_so_path() -> String {
    std::env::var("ACCESS_REGISTRY_SO_PATH").unwrap_or_else(|_| {
        concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../tests/fixtures/access_registry.so"
        )
        .to_string()
    })
}

pub const MEMO_PROGRAM_ID: Pubkey =
    anchor_lang::pubkey!("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
pub const SYSTEM_PROGRAM_ID: Pubkey = anchor_lang::pubkey!("11111111111111111111111111111111");
pub const TOKEN_2022_PROGRAM_ID: Pubkey =
    anchor_lang::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    anchor_lang::pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const SQRT_PRICE_ONE: u128 = 1 << 64;

fn next_config_index() -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

pub struct Market {
    pub svm: LiteSVM,
    pub operator: Keypair,
    pub payer: Keypair,
    pub lp: Keypair,
    pub swapper: Keypair,
    pub token_x_mint: Pubkey,
    pub token_y_mint: Pubkey,
    pub token_x_program: Pubkey,
    pub lp_token_x: Pubkey,
    pub lp_token_y: Pubkey,
    pub swapper_token_x: Pubkey,
    pub swapper_token_y: Pubkey,
}

/// Send `ixs` and return the program logs on success. The blockhash is
/// rotated afterwards so an identical transaction is not rejected as a
/// duplicate.
pub fn try_send(
    svm: &mut LiteSVM,
    ixs: &[Instruction],
    payer: &Keypair,
    signers: &[&Keypair],
) -> Result<Vec<String>, Box<FailedTransactionMetadata>> {
    let tx = Transaction::new_signed_with_payer(
        ixs,
        Some(&payer.pubkey()),
        signers,
        svm.latest_blockhash(),
    );
    let result = svm.send_transaction(tx);
    svm.expire_blockhash();
    result.map(|meta| meta.logs).map_err(Box::new)
}

pub fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) {
    if let Err(failed) = try_send(svm, ixs, payer, signers) {
        panic!(
            "transaction failed: {}\n{:#?}",
            failed.err, failed.meta.logs
        );
    }
}

fn funded_keypair(svm: &mut LiteSVM) -> Keypair {
    let keypair = Keypair::new();
    svm.airdrop(&keypair.pubkey(), 1_000_000_000_000).unwrap();
    keypair
}

pub fn create_funded_market() -> Market {
    create_funded_market_inner(false)
}

pub fn create_funded_market_with_transfer_fee_x() -> Market {
    create_funded_market_inner(true)
}

fn create_funded_market_inner(transfer_fee_x: bool) -> Market {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(dlmm_pro::ID, program_so_path())
        .expect("dlmm_pro.so fixture must exist (dlmm-pro main 9590139, --features local)");
    // Owns TokenBadge, which `OnlyY` pool creation requires for non-whitelisted quote mints.
    svm.add_program_from_file(ACCESS_REGISTRY_ID, access_registry_so_path())
        .expect("access_registry.so fixture (built with --features local) must exist");

    // LiteSVM's clock starts at unix_timestamp 0; a real cluster never runs
    // there and the dynamic-fee reference update assumes elapsed time since
    // the epoch exceeds the filter period.
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = 1_755_000_000;
    svm.set_sysvar(&clock);

    let admin = funded_keypair(&mut svm);
    let operator = funded_keypair(&mut svm);
    let payer = funded_keypair(&mut svm);
    let lp = funded_keypair(&mut svm);
    let swapper = funded_keypair(&mut svm);

    let create_operator = Instruction {
        program_id: dlmm_pro::ID,
        accounts: accounts::CreateOperatorAccount {
            operator: derive_operator(operator.pubkey()),
            whitelisted_address: operator.pubkey(),
            signer: admin.pubkey(),
            payer: admin.pubkey(),
            system_program: SYSTEM_PROGRAM_ID,
            event_authority: derive_event_authority(),
            program: dlmm_pro::ID,
        }
        .to_account_metas(None),
        data: args::CreateOperatorAccount { permission: 1 }.data(),
    };
    send(&mut svm, &[create_operator], &admin, &[&admin]);

    let (token_x_mint, token_x_program) = if transfer_fee_x {
        (
            create_transfer_fee_mint(&mut svm, &payer),
            TOKEN_2022_PROGRAM_ID,
        )
    } else {
        (
            CreateMint::new(&mut svm, &payer)
                .decimals(6)
                .send()
                .unwrap(),
            litesvm_token::TOKEN_ID,
        )
    };
    let token_y_mint = CreateMint::new(&mut svm, &payer)
        .decimals(6)
        .send()
        .unwrap();

    let make_ata =
        |svm: &mut LiteSVM, mint: &Pubkey, owner: &Pubkey, token_program: &Pubkey| -> Pubkey {
            let ata = CreateAssociatedTokenAccount::new(svm, &payer, mint)
                .owner(owner)
                .token_program_id(token_program)
                .send()
                .unwrap();
            let mint_to_ix = mint_to(
                token_program,
                mint,
                &ata,
                &payer.pubkey(),
                &[],
                1_000_000_000_000,
            )
            .unwrap();
            send(svm, &[mint_to_ix], &payer, &[&payer]);
            ata
        };

    let lp_token_x = make_ata(&mut svm, &token_x_mint, &lp.pubkey(), &token_x_program);
    let lp_token_y = make_ata(
        &mut svm,
        &token_y_mint,
        &lp.pubkey(),
        &litesvm_token::TOKEN_ID,
    );
    let swapper_token_x = make_ata(&mut svm, &token_x_mint, &swapper.pubkey(), &token_x_program);
    let swapper_token_y = make_ata(
        &mut svm,
        &token_y_mint,
        &swapper.pubkey(),
        &litesvm_token::TOKEN_ID,
    );

    Market {
        svm,
        operator,
        payer,
        lp,
        swapper,
        token_x_mint,
        token_y_mint,
        token_x_program,
        lp_token_x,
        lp_token_y,
        swapper_token_x,
        swapper_token_y,
    }
}

/// Badge for token Y issued by the access-registry program. Commons has no
/// `declare_program!` for the registry, so the two instructions are encoded
/// from its IDL (`src/idl/access-registry/access_registry.json`).
pub fn create_token_badge_y(market: &mut Market) -> Pubkey {
    const CREATE_OPERATOR_ACCOUNT: [u8; 8] = [221, 64, 246, 149, 240, 153, 229, 163];
    const CREATE_TOKEN_BADGE: [u8; 8] = [88, 206, 0, 91, 60, 175, 151, 118];
    const CREATE_TOKEN_BADGE_PERMISSION: u128 = 1;

    let registry_operator = Pubkey::find_program_address(
        &[b"operator", market.operator.pubkey().as_ref()],
        &ACCESS_REGISTRY_ID,
    )
    .0;
    let create_operator = Instruction {
        program_id: ACCESS_REGISTRY_ID,
        accounts: vec![
            AccountMeta::new(registry_operator, false),
            AccountMeta::new_readonly(market.operator.pubkey(), false),
            AccountMeta::new_readonly(market.payer.pubkey(), true),
            AccountMeta::new(market.payer.pubkey(), true),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data: [
            &CREATE_OPERATOR_ACCOUNT[..],
            &CREATE_TOKEN_BADGE_PERMISSION.to_le_bytes(),
        ]
        .concat(),
    };
    let token_badge = derive_token_badge(market.token_y_mint);
    let create_badge = Instruction {
        program_id: ACCESS_REGISTRY_ID,
        accounts: vec![
            AccountMeta::new(token_badge, false),
            AccountMeta::new_readonly(market.token_y_mint, false),
            AccountMeta::new_readonly(registry_operator, false),
            AccountMeta::new_readonly(market.operator.pubkey(), true),
            AccountMeta::new(market.payer.pubkey(), true),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data: [&CREATE_TOKEN_BADGE[..], &[0u8]].concat(),
    };
    send(
        &mut market.svm,
        &[create_operator, create_badge],
        &market.payer,
        &[&market.payer, &market.operator],
    );
    token_badge
}

pub fn set_unix_timestamp(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar(&clock);
}

pub fn unix_timestamp(svm: &LiteSVM) -> u64 {
    let clock: Clock = svm.get_sysvar();
    clock.unix_timestamp as u64
}

fn create_transfer_fee_mint(svm: &mut LiteSVM, payer: &Keypair) -> Pubkey {
    let mint = Keypair::new();
    let space =
        ExtensionType::try_calculate_account_len::<MintState>(&[ExtensionType::TransferFeeConfig])
            .unwrap();
    let lamports = svm.minimum_balance_for_rent_exemption(space);
    let ixs = [
        solana_system_interface::instruction::create_account(
            &payer.pubkey(),
            &mint.pubkey(),
            lamports,
            space as u64,
            &TOKEN_2022_PROGRAM_ID,
        ),
        initialize_transfer_fee_config(
            &TOKEN_2022_PROGRAM_ID,
            &mint.pubkey(),
            Some(&payer.pubkey()),
            Some(&payer.pubkey()),
            100,
            1_000_000_000,
        )
        .unwrap(),
        initialize_mint2(
            &TOKEN_2022_PROGRAM_ID,
            &mint.pubkey(),
            &payer.pubkey(),
            None,
            6,
        )
        .unwrap(),
    ];
    send(svm, &ixs, payer, &[payer, &mint]);
    mint.pubkey()
}

/// The bitmap extension the pool-init instructions require: the program
/// initializes it in place when the initial tick overflows the inline bitmap.
fn bitmap_extension_for_init(
    pool: Pubkey,
    initial_sqrt_price: u128,
    tick_spacing: u16,
) -> Option<Pubkey> {
    let tick_id = tick_id_from_sqrt_price(initial_sqrt_price).unwrap();
    let tick_index = TickArray::get_tick_index_from_tick_id(tick_id, tick_spacing).unwrap();
    overflows_default_tick_array_bitmap(tick_index)
        .then(|| derive_tick_array_bitmap_extension(pool))
}

pub fn initialize_static_pool(
    market: &mut Market,
    dynamic_fee: Option<types::DynamicFeeParameters>,
    initial_sqrt_price: u128,
) -> Pubkey {
    initialize_static_pool_with_fee_mode(
        market,
        dynamic_fee,
        initial_sqrt_price,
        CollectFeeMode::OutputToken,
    )
}

pub fn initialize_static_pool_with_fee_mode(
    market: &mut Market,
    dynamic_fee: Option<types::DynamicFeeParameters>,
    initial_sqrt_price: u128,
    collect_fee_mode: CollectFeeMode,
) -> Pubkey {
    let token_badge_y =
        matches!(collect_fee_mode, CollectFeeMode::OnlyY).then(|| create_token_badge_y(market));
    let config_index = next_config_index();
    let config = derive_static_config(config_index);
    let create_config = Instruction {
        program_id: dlmm_pro::ID,
        accounts: accounts::CreateStaticConfig {
            config,
            operator: derive_operator(market.operator.pubkey()),
            signer: market.operator.pubkey(),
            payer: market.payer.pubkey(),
            system_program: SYSTEM_PROGRAM_ID,
            event_authority: derive_event_authority(),
            program: dlmm_pro::ID,
        }
        .to_account_metas(None),
        data: args::CreateStaticConfig {
            index: config_index,
            config_parameters: types::StaticConfigParameters {
                pool_fees: types::PoolFeeParameters {
                    base_fee_parameter: types::BaseFeeConfigParameters {
                        base_fee_mode: BaseFeeMode::Fixed.into(),
                        data: encode_fixed_base_fee_data(1_000_000),
                    },
                    dynamic_fee_parameter: dynamic_fee,
                },
                tick_spacing: 1,
                collect_fee_mode: collect_fee_mode.into(),
                activation_type: ActivationType::Timestamp.into(),
                extensions: 0,
                pool_creator_authority: Some(Pubkey::default()),
            },
        }
        .data(),
    };
    send(
        &mut market.svm,
        &[create_config],
        &market.payer,
        &[&market.payer, &market.operator],
    );

    let pool = derive_pool(config, market.token_x_mint, market.token_y_mint);
    let initialize_pool = Instruction {
        program_id: dlmm_pro::ID,
        accounts: accounts::InitializePoolWithStaticConfig {
            pool,
            token_x_mint: market.token_x_mint,
            token_y_mint: market.token_y_mint,
            config,
            tick_array_bitmap_extension: bitmap_extension_for_init(pool, initial_sqrt_price, 1),
            oracle: derive_oracle(pool),
            pool_authority: pool_authority::ID,
            reserve_x: derive_reserve(market.token_x_mint, pool),
            reserve_y: derive_reserve(market.token_y_mint, pool),
            token_badge_x: None,
            token_badge_y,
            creator: market.payer.pubkey(),
            payer: market.payer.pubkey(),
            pool_creator_authority: Pubkey::default(),
            token_x_program: market.token_x_program,
            token_y_program: litesvm_token::TOKEN_ID,
            system_program: SYSTEM_PROGRAM_ID,
            event_authority: derive_event_authority(),
            program: dlmm_pro::ID,
        }
        .to_account_metas(None),
        data: args::InitializePoolWithStaticConfig { initial_sqrt_price }.data(),
    };
    send(
        &mut market.svm,
        &[initialize_pool],
        &market.payer,
        &[&market.payer],
    );
    pool
}

fn encode_z40(value: u64) -> [u8; 5] {
    let bytes = value.to_le_bytes();
    bytes[..5].try_into().unwrap()
}

fn time_based_activation_data(swap_point: u64, add_point: u64, remove_point: u64) -> [u8; 15] {
    let mut data = [0u8; 15];
    data[0..5].copy_from_slice(&encode_z40(swap_point));
    data[5..10].copy_from_slice(&encode_z40(add_point));
    data[10..15].copy_from_slice(&encode_z40(remove_point));
    data
}

/// Time-based activation pool. Add-liquidity is already open; swap opens at `swap_point`.
pub fn initialize_time_gated_pool(market: &mut Market, swap_point: u64) -> Pubkey {
    initialize_dynamic_pool(market, 0, Some(swap_point))
}

/// Pool with partner fees: the dynamic config's creator authority (the payer)
/// becomes the pool partner.
pub fn initialize_partner_pool(market: &mut Market, partner_fee_bps: u16) -> Pubkey {
    initialize_dynamic_pool(market, partner_fee_bps, None)
}

fn initialize_dynamic_pool(
    market: &mut Market,
    partner_fee_bps: u16,
    swap_point: Option<u64>,
) -> Pubkey {
    let now = unix_timestamp(&market.svm);
    let config_index = next_config_index();
    let config = derive_dynamic_config(market.payer.pubkey(), config_index);
    let create_config = Instruction {
        program_id: dlmm_pro::ID,
        accounts: accounts::CreateDynamicConfig {
            config,
            operator: derive_operator(market.operator.pubkey()),
            signer: market.operator.pubkey(),
            payer: market.payer.pubkey(),
            system_program: SYSTEM_PROGRAM_ID,
            pool_creator_authority: market.payer.pubkey(),
            event_authority: derive_event_authority(),
            program: dlmm_pro::ID,
        }
        .to_account_metas(None),
        data: args::CreateDynamicConfig {
            index: config_index,
            config_parameters: types::DynamicConfigParameters {
                permission: 0,
                partner_fee_bps,
            },
        }
        .data(),
    };
    send(
        &mut market.svm,
        &[create_config],
        &market.payer,
        &[&market.payer, &market.operator],
    );

    let pool = derive_pool(config, market.token_x_mint, market.token_y_mint);
    let pool_activation = swap_point.map(|swap_point| types::PoolActivationParameters {
        whitelisted_swap: Pubkey::default(),
        whitelisted_add_liquidity: Pubkey::default(),
        whitelisted_remove_liquidity: Pubkey::default(),
        activations: [
            types::PoolActivationInfoParameters {
                activation_mode: ActivationMode::Open.into(),
                data: [0u8; 15],
            },
            types::PoolActivationInfoParameters {
                activation_mode: ActivationMode::TimeBased.into(),
                data: time_based_activation_data(swap_point, now, swap_point + 30),
            },
        ],
    });
    let extensions = if swap_point.is_some() {
        1 << u8::from(PoolExtension::ActivationAccess)
    } else {
        0
    };
    let initialize_pool = Instruction {
        program_id: dlmm_pro::ID,
        accounts: accounts::InitializePoolWithDynamicConfig {
            pool,
            token_x_mint: market.token_x_mint,
            token_y_mint: market.token_y_mint,
            config,
            tick_array_bitmap_extension: None,
            oracle: derive_oracle(pool),
            pool_authority: pool_authority::ID,
            reserve_x: derive_reserve(market.token_x_mint, pool),
            reserve_y: derive_reserve(market.token_y_mint, pool),
            token_badge_x: None,
            token_badge_y: None,
            creator: market.payer.pubkey(),
            payer: market.payer.pubkey(),
            pool_creator_authority: market.payer.pubkey(),
            token_x_program: market.token_x_program,
            token_y_program: litesvm_token::TOKEN_ID,
            system_program: SYSTEM_PROGRAM_ID,
            event_authority: derive_event_authority(),
            program: dlmm_pro::ID,
        }
        .to_account_metas(None),
        data: args::InitializePoolWithDynamicConfig {
            parameters: types::InitializePoolWithDynamicParameters {
                pool_fees: types::PoolFeeParameters {
                    base_fee_parameter: types::BaseFeeConfigParameters {
                        base_fee_mode: BaseFeeMode::Fixed.into(),
                        data: encode_fixed_base_fee_data(1_000_000),
                    },
                    dynamic_fee_parameter: None,
                },
                tick_spacing: 1,
                collect_fee_mode: CollectFeeMode::OutputToken.into(),
                initial_sqrt_price: SQRT_PRICE_ONE,
                activation_type: ActivationType::Timestamp.into(),
                activation_point: swap_point,
                extensions,
                pool_activation,
            },
        }
        .data(),
    };
    send(
        &mut market.svm,
        &[initialize_pool],
        &market.payer,
        &[&market.payer],
    );
    pool
}

pub const SEED_DEPOSITS: [(usize, u64, u64); 2] = [(0, 10_000, 10_000), (1, 0, 200_000)];

pub struct SeededPosition {
    pub position: Pubkey,
    pub nft_account: Pubkey,
}

pub fn seed_liquidity(
    market: &mut Market,
    pool: Pubkey,
    tick_ranges: &[types::TickRange],
    bitmap_extension: Option<Pubkey>,
    deposits: &[(usize, u64, u64)],
) -> SeededPosition {
    let tick_spacing = 1u16;
    let nft_mint = Keypair::new();
    let position = derive_position(nft_mint.pubkey());
    let nft_account = Pubkey::find_program_address(
        &[
            market.lp.pubkey().as_ref(),
            TOKEN_2022_PROGRAM_ID.as_ref(),
            nft_mint.pubkey().as_ref(),
        ],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0;

    let tick_array_metas: Vec<AccountMeta> =
        tick_array_remaining_accounts(pool, tick_ranges, tick_spacing).unwrap();

    let open_position = Instruction {
        program_id: dlmm_pro::ID,
        accounts: [
            accounts::OpenPosition {
                pool,
                pool_authority: pool_authority::ID,
                nft_mint: nft_mint.pubkey(),
                nft_account,
                position,
                owner: market.lp.pubkey(),
                payer: market.payer.pubkey(),
                token_program: TOKEN_2022_PROGRAM_ID,
                system_program: SYSTEM_PROGRAM_ID,
                associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
                event_authority: derive_event_authority(),
                program: dlmm_pro::ID,
            }
            .to_account_metas(None),
            tick_array_metas.clone(),
        ]
        .concat(),
        data: args::OpenPosition {
            parameters: types::OpenPositionParameters {
                tick_ranges: tick_ranges.to_vec(),
            },
        }
        .data(),
    };
    send(
        &mut market.svm,
        &[open_position],
        &market.payer,
        &[&market.payer, &nft_mint],
    );

    let pool_state =
        DynamicPool::deserialize(&market.svm.get_account(&pool).unwrap().data).unwrap();
    let token_x_mint_data = market.svm.get_account(&market.token_x_mint).unwrap().data;
    let epoch = market.svm.get_sysvar::<Clock>().epoch;

    let mut liquidities = vec![];
    let mut indexes = vec![];
    let mut max_amount_x = 0u64;
    let mut max_amount_y = 0u64;
    for &(position_index, max_x, max_y) in deposits {
        let range = &tick_ranges[position_index];
        liquidities.push(
            get_liquidity_from_amounts(
                max_x,
                max_y,
                range.tick_lower_id,
                range.tick_upper_id,
                pool_state.pool.tick_current_id,
                pool_state.pool.sqrt_price,
            )
            .unwrap(),
        );
        indexes.push(position_index);
        // `max_amount_*` are transfer-fee inclusive on-chain; token Y is a legacy mint.
        max_amount_x += calculate_transfer_fee_included_amount(&token_x_mint_data, epoch, max_x)
            .unwrap()
            .amount;
        max_amount_y += max_y;
    }

    let add_liquidity = Instruction {
        program_id: dlmm_pro::ID,
        accounts: [
            accounts::AddLiquidity {
                pool,
                position,
                nft_account,
                tick_array_bitmap_extension: bitmap_extension,
                user_token_x: market.lp_token_x,
                user_token_y: market.lp_token_y,
                reserve_x: derive_reserve(market.token_x_mint, pool),
                reserve_y: derive_reserve(market.token_y_mint, pool),
                token_x_mint: market.token_x_mint,
                token_y_mint: market.token_y_mint,
                signer: market.lp.pubkey(),
                token_x_program: market.token_x_program,
                token_y_program: litesvm_token::TOKEN_ID,
                event_authority: derive_event_authority(),
                program: dlmm_pro::ID,
            }
            .to_account_metas(None),
            tick_array_metas,
        ]
        .concat(),
        data: args::AddLiquidity {
            parameters: types::AddLiquidityParameters {
                max_amount_x,
                max_amount_y,
                expected_layout_version: None,
                bitmap: liquidity_bitmap(&indexes).unwrap(),
                liquidities,
            },
            remaining_account_info: types::RemainingAccountsInfo { slices: vec![] },
        }
        .data(),
    };
    send(&mut market.svm, &[add_liquidity], &market.lp, &[&market.lp]);
    SeededPosition {
        position,
        nft_account,
    }
}

pub fn open_ask_limit_order(market: &mut Market, pool: Pubkey, tick_id: i32, amount: u64) {
    let nft_mint = Keypair::new();
    let tick_arrays = tick_arrays_for_ranges(
        pool,
        &[types::TickRange {
            tick_lower_id: tick_id,
            tick_upper_id: tick_id,
        }],
        1,
    )
    .unwrap();
    let tick_array_metas: Vec<AccountMeta> = tick_arrays
        .iter()
        .map(|address| AccountMeta::new(*address, false))
        .collect();
    let nft_account = Pubkey::find_program_address(
        &[
            market.lp.pubkey().as_ref(),
            TOKEN_2022_PROGRAM_ID.as_ref(),
            nft_mint.pubkey().as_ref(),
        ],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0;

    let open = Instruction {
        program_id: dlmm_pro::ID,
        accounts: [
            accounts::OpenLimitOrder {
                pool,
                pool_authority: pool_authority::ID,
                nft_mint: nft_mint.pubkey(),
                nft_account,
                tick_array_bitmap_extension: None,
                reserve: derive_reserve(market.token_x_mint, pool),
                token_mint: market.token_x_mint,
                limit_order: derive_limit_order(nft_mint.pubkey()),
                user_token: market.lp_token_x,
                referral: None,
                payer: market.payer.pubkey(),
                owner: market.lp.pubkey(),
                token_program: market.token_x_program,
                token2022_program: TOKEN_2022_PROGRAM_ID,
                system_program: SYSTEM_PROGRAM_ID,
                associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
                event_authority: derive_event_authority(),
                program: dlmm_pro::ID,
            }
            .to_account_metas(None),
            tick_array_metas,
        ]
        .concat(),
        data: args::OpenLimitOrder {
            parameters: types::OpenLimitOrderParameters {
                is_ask_side: true,
                max_amount: u64::MAX,
                relative_tick: None,
                ticks: vec![types::TickLimitOrderAmount {
                    id: tick_id,
                    amount,
                }],
            },
            remaining_account_info: types::RemainingAccountsInfo { slices: vec![] },
        }
        .data(),
    };
    send(
        &mut market.svm,
        &[open],
        &market.payer,
        &[&market.payer, &market.lp, &nft_mint],
    );
}

pub fn token_amount(svm: &LiteSVM, address: &Pubkey) -> u64 {
    get_spl_account::<SplTokenAccount>(svm, address)
        .unwrap()
        .amount
}

pub struct QuoteInputs {
    pub quote: QuoteExactInResult,
    pub tick_arrays: Vec<Pubkey>,
    pub bitmap_extension: Option<Pubkey>,
}

/// Everything a quote needs, gathered from the LiteSVM state.
struct SwapQuoteContext {
    pool_address: Pubkey,
    pool_state: DynamicPool,
    tick_arrays: Vec<DynamicTickArray>,
    bitmap_extension: Option<TickArrayBitmapExtension>,
    tick_array_addresses: Vec<Pubkey>,
    bitmap_extension_address: Option<Pubkey>,
    input_mint_data: Vec<u8>,
    output_mint_data: Vec<u8>,
    clock: Clock,
}

impl SwapQuoteContext {
    fn params(
        &self,
        market: &Market,
        input_amount: u64,
        swap_for_y: bool,
        has_referral: bool,
    ) -> QuoteExactInParams<'_> {
        QuoteExactInParams {
            pool_address: self.pool_address,
            pool: &self.pool_state,
            tick_arrays: &self.tick_arrays,
            bitmap_extension: self.bitmap_extension.as_ref(),
            input_amount,
            swap_for_y,
            has_referral,
            swapper: Some(market.swapper.pubkey()),
            current_slot: self.clock.slot,
            current_timestamp: self.clock.unix_timestamp as u64,
            epoch: self.clock.epoch,
            input_mint_data: Some(&self.input_mint_data),
            output_mint_data: Some(&self.output_mint_data),
            input_mint: None,
            output_mint: None,
        }
    }
}

fn gather_swap_quote_context(
    market: &Market,
    pool: Pubkey,
    swap_for_y: bool,
) -> Result<SwapQuoteContext, anchor_lang::error::Error> {
    let svm = &market.svm;
    let pool_state = DynamicPool::deserialize(&svm.get_account(&pool).unwrap().data).unwrap();

    let bitmap_extension_address = derive_tick_array_bitmap_extension(pool);
    let bitmap_extension = if pool_state.pool.is_bitmap_extension_initialized() {
        let data = svm.get_account(&bitmap_extension_address).unwrap().data;
        Some(deserialize_anchor_pod_account::<TickArrayBitmapExtension>(&data).unwrap())
    } else {
        None
    };

    let selection = tick_arrays_for_swap(
        pool,
        &pool_state.pool,
        bitmap_extension.as_ref(),
        swap_for_y,
        3,
    )?;
    let tick_arrays: Vec<DynamicTickArray> = selection
        .tick_arrays
        .iter()
        .map(|address| {
            DynamicTickArray::deserialize(
                &svm.get_account(address).unwrap().data,
                pool_state.pool.is_support_liquidity_mining(),
            )
            .unwrap()
        })
        .collect();

    let (input_mint, output_mint) = if swap_for_y {
        (market.token_x_mint, market.token_y_mint)
    } else {
        (market.token_y_mint, market.token_x_mint)
    };
    let input_mint_data = svm.get_account(&input_mint).unwrap().data;
    let output_mint_data = svm.get_account(&output_mint).unwrap().data;

    Ok(SwapQuoteContext {
        pool_address: pool,
        pool_state,
        tick_arrays,
        bitmap_extension,
        tick_array_addresses: selection.tick_arrays,
        bitmap_extension_address: selection
            .requires_bitmap_extension
            .then_some(bitmap_extension_address),
        input_mint_data,
        output_mint_data,
        clock: svm.get_sysvar(),
    })
}

fn try_quote(
    market: &Market,
    pool: Pubkey,
    input_amount: u64,
    swap_for_y: bool,
    has_referral: bool,
) -> Result<QuoteInputs, anchor_lang::error::Error> {
    let context = gather_swap_quote_context(market, pool, swap_for_y)?;
    let quote = quote_exact_in(context.params(market, input_amount, swap_for_y, has_referral))?;

    Ok(QuoteInputs {
        quote,
        tick_arrays: context.tick_array_addresses,
        bitmap_extension: context.bitmap_extension_address,
    })
}

pub fn quote(market: &Market, pool: Pubkey, input_amount: u64, swap_for_y: bool) -> QuoteInputs {
    try_quote(market, pool, input_amount, swap_for_y, false).unwrap()
}

pub fn quote_result(
    market: &Market,
    pool: Pubkey,
    input_amount: u64,
    swap_for_y: bool,
) -> Result<QuoteExactInResult, anchor_lang::error::Error> {
    Ok(try_quote(market, pool, input_amount, swap_for_y, false)?.quote)
}

pub fn quote_with_wrong_tick_array_pool(
    market: &Market,
    pool: Pubkey,
    input_amount: u64,
) -> Result<QuoteExactInResult, anchor_lang::error::Error> {
    let mut context = gather_swap_quote_context(market, pool, true)?;
    context.tick_arrays[0].fixed.pool = Pubkey::new_unique();
    quote_exact_in(context.params(market, input_amount, true, false))
}

/// Quote with an extra tick array from another pool at an index the traversal
/// never visits, as the program only binds visited arrays to the pool.
pub fn quote_with_unreached_foreign_tick_array(
    market: &Market,
    pool: Pubkey,
    input_amount: u64,
) -> Result<QuoteExactInResult, anchor_lang::error::Error> {
    let mut context = gather_swap_quote_context(market, pool, true)?;
    let mut foreign = context.tick_arrays[0].clone();
    foreign.fixed.pool = Pubkey::new_unique();
    foreign.fixed.tick_index = 999;
    context.tick_arrays.push(foreign);
    quote_exact_in(context.params(market, input_amount, true, false))
}

fn swap_instruction(
    market: &Market,
    pool: Pubkey,
    input_amount: u64,
    swap_for_y: bool,
    tick_arrays: &[Pubkey],
    bitmap_extension: Option<Pubkey>,
    referral: Option<Pubkey>,
) -> Instruction {
    let (user_token_in, user_token_out) = if swap_for_y {
        (market.swapper_token_x, market.swapper_token_y)
    } else {
        (market.swapper_token_y, market.swapper_token_x)
    };
    Instruction {
        program_id: dlmm_pro::ID,
        accounts: [
            accounts::Swap {
                pool,
                pool_authority: pool_authority::ID,
                tick_array_bitmap_extension: bitmap_extension,
                reserve_x: derive_reserve(market.token_x_mint, pool),
                reserve_y: derive_reserve(market.token_y_mint, pool),
                user_token_in,
                user_token_out,
                referral,
                token_x_mint: market.token_x_mint,
                token_y_mint: market.token_y_mint,
                oracle: derive_oracle(pool),
                user: market.swapper.pubkey(),
                token_x_program: market.token_x_program,
                token_y_program: litesvm_token::TOKEN_ID,
                memo_program: MEMO_PROGRAM_ID,
                event_authority: derive_event_authority(),
                program: dlmm_pro::ID,
            }
            .to_account_metas(None),
            tick_arrays
                .iter()
                .map(|address| AccountMeta::new(*address, false))
                .collect(),
        ]
        .concat(),
        data: args::Swap {
            parameters: types::SwapParameters {
                input_amount,
                minimum_output_amount: 0,
            },
            remaining_accounts_info: types::RemainingAccountsInfo { slices: vec![] },
        }
        .data(),
    }
}

pub fn execute_swap(
    market: &mut Market,
    pool: Pubkey,
    input_amount: u64,
    swap_for_y: bool,
    tick_arrays: &[Pubkey],
    bitmap_extension: Option<Pubkey>,
    referral: Option<Pubkey>,
) {
    let swap = swap_instruction(
        market,
        pool,
        input_amount,
        swap_for_y,
        tick_arrays,
        bitmap_extension,
        referral,
    );
    send(
        &mut market.svm,
        &[swap],
        &market.swapper,
        &[&market.swapper],
    );
}

/// Execute the swap expecting the program to reject it, and return the logs.
pub fn execute_swap_expect_failure(
    market: &mut Market,
    pool: Pubkey,
    input_amount: u64,
    swap_for_y: bool,
    tick_arrays: &[Pubkey],
    bitmap_extension: Option<Pubkey>,
    referral: Option<Pubkey>,
) -> Vec<String> {
    let swap = swap_instruction(
        market,
        pool,
        input_amount,
        swap_for_y,
        tick_arrays,
        bitmap_extension,
        referral,
    );
    try_send(
        &mut market.svm,
        &[swap],
        &market.swapper,
        &[&market.swapper],
    )
    .expect_err("swap was expected to fail")
    .meta
    .logs
}

pub fn assert_quote_matches_execution(
    market: &mut Market,
    pool: Pubkey,
    input_amount: u64,
    swap_for_y: bool,
) -> QuoteExactInResult {
    assert_quote_matches_execution_with_referral(market, pool, input_amount, swap_for_y, None)
}

/// Quote, swap, and compare user transfers, pool price state and the fee
/// split (protocol, partner, host) against the quote. The referral, when
/// given, must be a token account of the mint the pool collects fees in.
pub fn assert_quote_matches_execution_with_referral(
    market: &mut Market,
    pool: Pubkey,
    input_amount: u64,
    swap_for_y: bool,
    referral: Option<Pubkey>,
) -> QuoteExactInResult {
    let QuoteInputs {
        quote,
        tick_arrays,
        bitmap_extension,
    } = try_quote(market, pool, input_amount, swap_for_y, referral.is_some()).unwrap();
    assert_eq!(quote.amount_left, 0, "test liquidity must cover the swap");
    assert!(quote.out_amount > 0);

    let (in_account, out_account) = if swap_for_y {
        (market.swapper_token_x, market.swapper_token_y)
    } else {
        (market.swapper_token_y, market.swapper_token_x)
    };
    let in_before = token_amount(&market.svm, &in_account);
    let out_before = token_amount(&market.svm, &out_account);
    let referral_before = referral.map(|account| token_amount(&market.svm, &account));
    let pool_before =
        DynamicPool::deserialize(&market.svm.get_account(&pool).unwrap().data).unwrap();
    let fees_on_token_x = pool_before
        .pool
        .get_fee_setting(swap_for_y, referral.is_some())
        .unwrap()
        .fees_on_token_x;

    execute_swap(
        market,
        pool,
        input_amount,
        swap_for_y,
        &tick_arrays,
        bitmap_extension,
        referral,
    );

    let paid = in_before - token_amount(&market.svm, &in_account);
    let received = token_amount(&market.svm, &out_account) - out_before;
    assert_eq!(paid, input_amount);
    assert_eq!(received, quote.transfer_fee_excluded_out_amount);

    let pool_after =
        DynamicPool::deserialize(&market.svm.get_account(&pool).unwrap().data).unwrap();
    assert_eq!(pool_after.pool.sqrt_price, quote.next_sqrt_price);
    assert_eq!(pool_after.pool.tick_current_id, quote.next_tick_id);
    assert_eq!(pool_after.pool.liquidity, quote.next_liquidity);

    let (before, after) = (&pool_before.pool, &pool_after.pool);
    let (protocol_delta_x, protocol_delta_y) = (
        after.protocol_fee_x - before.protocol_fee_x,
        after.protocol_fee_y - before.protocol_fee_y,
    );
    let (partner_delta_x, partner_delta_y) = (
        after.pool_partner.pending_fee_x - before.pool_partner.pending_fee_x,
        after.pool_partner.pending_fee_y - before.pool_partner.pending_fee_y,
    );
    let expected_protocol = if fees_on_token_x {
        (quote.protocol_fee, 0)
    } else {
        (0, quote.protocol_fee)
    };
    let expected_partner = if fees_on_token_x {
        (quote.partner_fee, 0)
    } else {
        (0, quote.partner_fee)
    };
    assert_eq!((protocol_delta_x, protocol_delta_y), expected_protocol);
    assert_eq!((partner_delta_x, partner_delta_y), expected_partner);
    if fees_on_token_x {
        assert_eq!(after.fee_growth_global_y, before.fee_growth_global_y);
    } else {
        assert_eq!(after.fee_growth_global_x, before.fee_growth_global_x);
    }

    match (referral, referral_before) {
        (Some(account), Some(referral_before)) => {
            // The host fee leaves the reserve as a transfer, so the referral
            // receives it net of that mint's transfer fee.
            let fee_mint = if fees_on_token_x {
                market.token_x_mint
            } else {
                market.token_y_mint
            };
            let fee_mint_data = market.svm.get_account(&fee_mint).unwrap().data;
            let epoch = market.svm.get_sysvar::<Clock>().epoch;
            let expected_host_fee =
                calculate_transfer_fee_excluded_amount(&fee_mint_data, epoch, quote.host_fee)
                    .unwrap()
                    .amount;
            assert!(quote.host_fee > 0, "swap too small to produce a host fee");
            assert_eq!(
                token_amount(&market.svm, &account) - referral_before,
                expected_host_fee
            );
        }
        _ => assert_eq!(quote.host_fee, 0),
    }
    quote
}

pub fn seed_ranges() -> [types::TickRange; 2] {
    [
        types::TickRange {
            tick_lower_id: -120,
            tick_upper_id: 120,
        },
        types::TickRange {
            tick_lower_id: -256,
            tick_upper_id: -128,
        },
    ]
}

pub fn extension_seed_ranges(center_tick: i32) -> [types::TickRange; 2] {
    [
        types::TickRange {
            tick_lower_id: center_tick - 120,
            tick_upper_id: center_tick + 120,
        },
        types::TickRange {
            tick_lower_id: center_tick - 256,
            tick_upper_id: center_tick - 128,
        },
    ]
}
