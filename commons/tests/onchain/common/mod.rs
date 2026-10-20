//! Shared LiteSVM setup for the quote, fee and reward parity tests.
use std::sync::atomic::{AtomicU64, Ordering};

use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::pubkey::Pubkey;
use anchor_lang::system_program;
use anchor_lang::{AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas};
use anchor_spl::associated_token;
use anchor_spl::token_2022::spl_token_2022::{
    self, extension::transfer_fee::instruction::initialize_transfer_fee_config,
    extension::ExtensionType, instruction::initialize_mint2, instruction::mint_to,
    state::Mint as MintState,
};
use dlmm_pro_commons::dlmm_pro::client::{accounts, args};
use dlmm_pro_commons::dlmm_pro::events::EvtSwap;
use dlmm_pro_commons::dlmm_pro::types;
use dlmm_pro_commons::*;
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use litesvm_token::spl_token::state::Account as SplTokenAccount;
use litesvm_token::{get_spl_account, CreateAssociatedTokenAccount, CreateMint};
use ruint::aliases::{U192, U320};
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
pub const SQRT_PRICE_ONE: u128 = 1 << 64;
pub const TICK_SPACING: u16 = 1;

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

/// Send `ixs` and return the transaction metadata on success. The blockhash
/// is rotated afterwards so an identical transaction is not rejected as a
/// duplicate.
fn try_send(
    svm: &mut LiteSVM,
    ixs: &[Instruction],
    payer: &Keypair,
    signers: &[&Keypair],
) -> Result<TransactionMetadata, Box<FailedTransactionMetadata>> {
    let tx = Transaction::new_signed_with_payer(
        ixs,
        Some(&payer.pubkey()),
        signers,
        svm.latest_blockhash(),
    );
    let result = svm.send_transaction(tx);
    svm.expire_blockhash();
    result.map_err(Box::new)
}

pub fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) {
    expect_sent(try_send(svm, ixs, payer, signers));
}

fn expect_sent(
    result: Result<TransactionMetadata, Box<FailedTransactionMetadata>>,
) -> TransactionMetadata {
    result.unwrap_or_else(|failed| {
        panic!(
            "transaction failed: {}\n{:#?}",
            failed.err, failed.meta.logs
        )
    })
}

/// Token-2022 associated token account that holds a position or limit order NFT.
fn nft_ata(owner: Pubkey, nft_mint: Pubkey) -> Pubkey {
    associated_token::get_associated_token_address_with_program_id(
        &owner,
        &nft_mint,
        &anchor_spl::token_2022::ID,
    )
}

/// Liquidity for depositing at most `max_token_x`/`max_token_y` into
/// `[tick_lower_id, tick_upper_id)` at the current price. The budgets are
/// pool-side amounts: for a Token-2022 transfer-fee mint pass what the pool
/// receives (`calculate_transfer_fee_excluded_amount`), since `add_liquidity`
/// compares its fee-inclusive `max_amount_*` against the deposit plus fee.
fn get_liquidity_from_amounts(
    max_token_x: u64,
    max_token_y: u64,
    tick_lower_id: i32,
    tick_upper_id: i32,
    tick_current_id: i32,
    current_sqrt_price: u128,
) -> anchor_lang::Result<u128> {
    let sqrt_price_lower = get_sqrt_price_from_tick_id(tick_lower_id);
    let sqrt_price_upper = get_sqrt_price_from_tick_id(tick_upper_id);

    let liquidity = if tick_current_id < tick_lower_id {
        get_liquidity_from_amount_x(sqrt_price_lower, sqrt_price_upper, max_token_x)?
    } else if tick_current_id < tick_upper_id {
        let liquidity_x =
            get_liquidity_from_amount_x(current_sqrt_price, sqrt_price_upper, max_token_x)?;
        let liquidity_y =
            get_liquidity_from_amount_y(sqrt_price_lower, current_sqrt_price, max_token_y)?;
        match (liquidity_x, liquidity_y) {
            (Some(x), Some(y)) => Some(x.min(y)),
            (x, y) => x.or(y),
        }
    } else {
        get_liquidity_from_amount_y(sqrt_price_lower, sqrt_price_upper, max_token_y)?
    };

    Ok(try_cast(liquidity.unwrap_or(U320::ZERO))?)
}

/// `time_delta * emission_per_second >> 64`.
fn calculate_reward_amount(time_delta: u64, emission_per_second: u128) -> anchor_lang::Result<u64> {
    Ok(down_scale_ceil(
        U192::from(time_delta).safe_mul(U192::from(emission_per_second))?,
        64,
    )
    .safe_cast()?)
}

fn writable_metas(addresses: &[Pubkey]) -> Vec<AccountMeta> {
    addresses
        .iter()
        .map(|address| AccountMeta::new(*address, false))
        .collect()
}

/// The tick arrays holding both endpoints of every range.
fn range_tick_arrays(pool: Pubkey, ranges: &[types::TickRange]) -> Vec<Pubkey> {
    let tick_ids: Vec<i32> = ranges
        .iter()
        .flat_map(|range| [range.tick_lower_id, range.tick_upper_id])
        .collect();
    tick_arrays_for_tick_ids(pool, &tick_ids, TICK_SPACING).unwrap()
}

/// The swapper's (input, output) token accounts for a swap direction.
fn swapper_token_accounts(market: &Market, swap_for_y: bool) -> (Pubkey, Pubkey) {
    if swap_for_y {
        (market.swapper_token_x, market.swapper_token_y)
    } else {
        (market.swapper_token_y, market.swapper_token_x)
    }
}

/// `owner`'s associated token account for `mint`, holding `amount` minted by
/// `payer`, the mint authority.
fn token_account_with(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint: &Pubkey,
    owner: &Pubkey,
    token_program: &Pubkey,
    amount: u64,
) -> Pubkey {
    let ata = CreateAssociatedTokenAccount::new(svm, payer, mint)
        .owner(owner)
        .token_program_id(token_program)
        .send()
        .unwrap();
    if amount > 0 {
        let mint_to_ix = mint_to(token_program, mint, &ata, &payer.pubkey(), &[], amount).unwrap();
        send(svm, &[mint_to_ix], payer, &[payer]);
    }
    ata
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
    let program_so = program_so_path();
    svm.add_program_from_file(dlmm_pro::ID, &program_so)
        .unwrap_or_else(|err| {
            panic!("cannot load {program_so} (dlmm-pro 0.1.0 4ac3a79, --features local): {err}")
        });
    // Owns TokenBadge, which `OnlyY` pool creation requires for non-whitelisted quote mints.
    let access_registry_so = access_registry_so_path();
    svm.add_program_from_file(ACCESS_REGISTRY_ID, &access_registry_so)
        .unwrap_or_else(|err| panic!("cannot load {access_registry_so} (--features local): {err}"));

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
            system_program: system_program::ID,
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
            spl_token_2022::ID,
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

    let balance = 1_000_000_000_000;
    let lp_token_x = token_account_with(
        &mut svm,
        &payer,
        &token_x_mint,
        &lp.pubkey(),
        &token_x_program,
        balance,
    );
    let lp_token_y = token_account_with(
        &mut svm,
        &payer,
        &token_y_mint,
        &lp.pubkey(),
        &litesvm_token::TOKEN_ID,
        balance,
    );
    let swapper_token_x = token_account_with(
        &mut svm,
        &payer,
        &token_x_mint,
        &swapper.pubkey(),
        &token_x_program,
        balance,
    );
    let swapper_token_y = token_account_with(
        &mut svm,
        &payer,
        &token_y_mint,
        &swapper.pubkey(),
        &litesvm_token::TOKEN_ID,
        balance,
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
fn create_token_badge_y(market: &mut Market) -> Pubkey {
    const CREATE_OPERATOR_ACCOUNT: [u8; 8] = [221, 64, 246, 149, 240, 153, 229, 163];
    const CREATE_TOKEN_BADGE: [u8; 8] = [88, 206, 0, 91, 60, 175, 151, 118];
    const CREATE_TOKEN_BADGE_PERMISSION: u128 = 1;

    let registry_operator = Pubkey::find_program_address(
        &[OPERATOR_PREFIX, market.operator.pubkey().as_ref()],
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
            AccountMeta::new_readonly(system_program::ID, false),
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
            AccountMeta::new_readonly(system_program::ID, false),
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

pub fn advance_unix_timestamp(svm: &mut LiteSVM, seconds: u64) {
    set_unix_timestamp(svm, (unix_timestamp(svm) + seconds) as i64);
}

pub fn unix_timestamp(svm: &LiteSVM) -> u64 {
    let clock: Clock = svm.get_sysvar();
    clock.unix_timestamp as u64
}

pub fn load_pool(market: &Market, pool: Pubkey) -> DynamicPool {
    DynamicPool::deserialize(&market.svm.get_account(&pool).unwrap().data).unwrap()
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
            &spl_token_2022::ID,
        ),
        initialize_transfer_fee_config(
            &spl_token_2022::ID,
            &mint.pubkey(),
            Some(&payer.pubkey()),
            Some(&payer.pubkey()),
            100,
            1_000_000_000,
        )
        .unwrap(),
        initialize_mint2(
            &spl_token_2022::ID,
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
/// initializes it in place when the initial tick overflows the internal bitmap.
fn bitmap_extension_for_init(pool: Pubkey, initial_sqrt_price: u128) -> Option<Pubkey> {
    let tick_id = tick_id_from_sqrt_price(initial_sqrt_price).unwrap();
    let tick_index = TickArray::get_tick_index_from_tick_id(tick_id, TICK_SPACING).unwrap();
    let (min_index, max_index) = Pool::bitmap_range();
    (!(min_index..=max_index).contains(&tick_index))
        .then(|| derive_tick_array_bitmap_extension(pool))
}

fn encode_fixed_base_fee_data(cliff_fee_numerator: u64) -> [u8; 31] {
    let mut data = [0u8; 31];
    data[..8].copy_from_slice(&cliff_fee_numerator.to_le_bytes());
    data
}

fn fixed_pool_fees(dynamic_fee: Option<types::DynamicFeeParameters>) -> types::PoolFeeParameters {
    types::PoolFeeParameters {
        base_fee_parameter: types::BaseFeeConfigParameters {
            base_fee_mode: BaseFeeMode::Fixed.into(),
            data: encode_fixed_base_fee_data(1_000_000),
        },
        dynamic_fee_parameter: dynamic_fee,
    }
}

pub fn initialize_static_pool(
    market: &mut Market,
    dynamic_fee: Option<types::DynamicFeeParameters>,
    initial_sqrt_price: u128,
) -> Pubkey {
    initialize_static_pool_with_options(
        market,
        dynamic_fee,
        initial_sqrt_price,
        CollectFeeMode::OutputToken,
        0,
    )
}

/// Static pool with the liquidity-mining extension, so positions and ticks
/// carry reward data.
pub fn initialize_mining_pool(market: &mut Market) -> Pubkey {
    initialize_static_pool_with_options(
        market,
        None,
        SQRT_PRICE_ONE,
        CollectFeeMode::OutputToken,
        1u8 << PoolExtension::LiquidityMining as u8,
    )
}

pub fn initialize_static_pool_with_options(
    market: &mut Market,
    dynamic_fee: Option<types::DynamicFeeParameters>,
    initial_sqrt_price: u128,
    collect_fee_mode: CollectFeeMode,
    extensions: u8,
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
            system_program: system_program::ID,
            event_authority: derive_event_authority(),
            program: dlmm_pro::ID,
        }
        .to_account_metas(None),
        data: args::CreateStaticConfig {
            index: config_index,
            config_parameters: types::StaticConfigParameters {
                pool_fees: fixed_pool_fees(dynamic_fee),
                tick_spacing: TICK_SPACING,
                collect_fee_mode: collect_fee_mode.into(),
                activation_type: ActivationType::Timestamp.into(),
                extensions,
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
            tick_array_bitmap_extension: bitmap_extension_for_init(pool, initial_sqrt_price),
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
            system_program: system_program::ID,
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
            system_program: system_program::ID,
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
            system_program: system_program::ID,
            event_authority: derive_event_authority(),
            program: dlmm_pro::ID,
        }
        .to_account_metas(None),
        data: args::InitializePoolWithDynamicConfig {
            parameters: types::InitializePoolWithDynamicParameters {
                pool_fees: fixed_pool_fees(None),
                tick_spacing: TICK_SPACING,
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
    let nft_mint = Keypair::new();
    let position = derive_position(nft_mint.pubkey());
    let nft_account = nft_ata(market.lp.pubkey(), nft_mint.pubkey());

    let tick_array_metas = writable_metas(&range_tick_arrays(pool, tick_ranges));

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
                token_program: spl_token_2022::ID,
                system_program: system_program::ID,
                associated_token_program: associated_token::ID,
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

    let pool_state = load_pool(market, pool);
    let token_x_mint_data = market.svm.get_account(&market.token_x_mint).unwrap().data;
    let epoch = market.svm.get_sysvar::<Clock>().epoch;

    let mut liquidities = vec![];
    let mut bitmap = 0u64;
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
        bitmap |= 1 << position_index;
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
                bitmap,
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
    let tick_array_metas =
        writable_metas(&tick_arrays_for_tick_ids(pool, &[tick_id], TICK_SPACING).unwrap());
    let nft_account = nft_ata(market.lp.pubkey(), nft_mint.pubkey());

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
                token2022_program: spl_token_2022::ID,
                system_program: system_program::ID,
                associated_token_program: associated_token::ID,
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

pub fn load_position_array(
    market: &Market,
    pool_state: &DynamicPool,
    position: Pubkey,
) -> DynamicPositionArray {
    DynamicPositionArray::deserialize(
        &market.svm.get_account(&position).unwrap().data,
        pool_state.pool.is_support_liquidity_mining(),
    )
    .unwrap()
}

pub fn base_positions(
    market: &Market,
    pool_state: &DynamicPool,
    position: Pubkey,
) -> Vec<Position> {
    load_position_array(market, pool_state, position)
        .positions
        .base_positions()
}

pub fn load_tick_arrays(
    market: &Market,
    pool: Pubkey,
    pool_state: &DynamicPool,
    ranges: &[types::TickRange],
) -> Vec<DynamicTickArray> {
    range_tick_arrays(pool, ranges)
        .iter()
        .map(|address| {
            DynamicTickArray::deserialize(
                &market.svm.get_account(address).unwrap().data,
                pool_state.pool.is_support_liquidity_mining(),
            )
            .unwrap()
        })
        .collect()
}

pub fn base_ticks(
    market: &Market,
    pool: Pubkey,
    pool_state: &DynamicPool,
    ranges: &[types::TickRange],
) -> Vec<Tick> {
    load_tick_arrays(market, pool, pool_state, ranges)
        .iter()
        .flat_map(|array| array.ticks.base_ticks())
        .collect()
}

pub fn refresh_fees_and_rewards_ix(
    market: &Market,
    pool: Pubkey,
    seeded: &SeededPosition,
    ranges: &[types::TickRange],
    bitmap: u64,
) -> Instruction {
    Instruction {
        program_id: dlmm_pro::ID,
        accounts: [
            accounts::RefreshFeesAndRewards {
                pool,
                position: seeded.position,
                nft_account: seeded.nft_account,
                signer: market.lp.pubkey(),
                event_authority: derive_event_authority(),
                program: dlmm_pro::ID,
            }
            .to_account_metas(None),
            writable_metas(&range_tick_arrays(pool, ranges)),
        ]
        .concat(),
        data: args::RefreshFeesAndRewards { bitmap }.data(),
    }
}

pub struct RewardSetup {
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub funder_token: Pubkey,
    pub lp_token: Pubkey,
}

/// Creator reward slot `index` on a mining pool: a legacy mint, the pool
/// creator (the market payer) as authority, a funded funder account and an
/// empty LP account.
pub fn initialize_reward(market: &mut Market, pool: Pubkey, index: u8) -> RewardSetup {
    let mint = CreateMint::new(&mut market.svm, &market.payer)
        .decimals(6)
        .send()
        .unwrap();
    let funder_token = token_account_with(
        &mut market.svm,
        &market.payer,
        &mint,
        &market.payer.pubkey(),
        &litesvm_token::TOKEN_ID,
        1_000_000_000_000,
    );
    let lp_token = token_account_with(
        &mut market.svm,
        &market.payer,
        &mint,
        &market.lp.pubkey(),
        &litesvm_token::TOKEN_ID,
        0,
    );
    let vault = derive_reward_vault(pool, index);
    let initialize = Instruction {
        program_id: dlmm_pro::ID,
        accounts: accounts::InitializeReward {
            pool,
            pool_authority: pool_authority::ID,
            reward_vault: vault,
            reward_mint: mint,
            token_badge: None,
            operator: None,
            signer: market.payer.pubkey(),
            payer: market.payer.pubkey(),
            reward_authority: market.payer.pubkey(),
            token_program: litesvm_token::TOKEN_ID,
            system_program: system_program::ID,
            event_authority: derive_event_authority(),
            program: dlmm_pro::ID,
        }
        .to_account_metas(None),
        data: args::InitializeReward { index }.data(),
    };
    send(
        &mut market.svm,
        &[initialize],
        &market.payer,
        &[&market.payer],
    );
    RewardSetup {
        mint,
        vault,
        funder_token,
        lp_token,
    }
}

pub fn set_reward_emission(
    market: &mut Market,
    pool: Pubkey,
    reward: &RewardSetup,
    index: u8,
    open_time: u64,
    end_time: u64,
    emission_per_second: u128,
) {
    let max_amount = calculate_reward_amount(end_time - open_time, emission_per_second).unwrap();
    let emit = Instruction {
        program_id: dlmm_pro::ID,
        accounts: accounts::SetRewardEmission {
            pool,
            reward_vault: reward.vault,
            reward_mint: reward.mint,
            funder_token_account: reward.funder_token,
            funder: market.payer.pubkey(),
            authority: market.payer.pubkey(),
            token_program: litesvm_token::TOKEN_ID,
            event_authority: derive_event_authority(),
            program: dlmm_pro::ID,
        }
        .to_account_metas(None),
        data: args::SetRewardEmission {
            parameters: types::SetRewardEmissionParameters {
                index,
                open_time: Some(open_time),
                end_time,
                emission_per_second,
                max_amount,
            },
            remaining_accounts_info: types::RemainingAccountsInfo { slices: vec![] },
        }
        .data(),
    };
    send(&mut market.svm, &[emit], &market.payer, &[&market.payer]);
}

pub fn refresh_and_claim_reward(
    market: &mut Market,
    pool: Pubkey,
    seeded: &SeededPosition,
    ranges: &[types::TickRange],
    bitmap: u64,
    reward: &RewardSetup,
    index: u8,
) {
    let refresh = refresh_fees_and_rewards_ix(market, pool, seeded, ranges, bitmap);
    let claim = Instruction {
        program_id: dlmm_pro::ID,
        accounts: accounts::ClaimReward {
            pool,
            pool_authority: pool_authority::ID,
            position: seeded.position,
            nft_account: seeded.nft_account,
            signer: market.lp.pubkey(),
            reward_vault: reward.vault,
            reward_mint: reward.mint,
            user_token_account: reward.lp_token,
            token_program: litesvm_token::TOKEN_ID,
            memo_program: MEMO_PROGRAM_ID,
            event_authority: derive_event_authority(),
            program: dlmm_pro::ID,
        }
        .to_account_metas(None),
        data: args::ClaimReward {
            reward_index: index,
            min_amount: 0,
            remaining_account_info: types::RemainingAccountsInfo { slices: vec![] },
        }
        .data(),
    };
    send(
        &mut market.svm,
        &[refresh, claim],
        &market.lp,
        &[&market.lp],
    );
}

pub struct QuoteInputs {
    pub quote: QuoteExactInResult,
    pub tick_arrays: Vec<Pubkey>,
    pub bitmap_extension: Option<Pubkey>,
}

fn try_quote(
    market: &Market,
    pool: Pubkey,
    input_amount: u64,
    swap_for_y: bool,
    has_referral: bool,
) -> Result<QuoteInputs, anchor_lang::error::Error> {
    let svm = &market.svm;
    let pool_state = load_pool(market, pool);

    let bitmap_extension_address = pool_state
        .pool
        .is_bitmap_extension_initialized()
        .then(|| derive_tick_array_bitmap_extension(pool));
    let bitmap_extension = bitmap_extension_address.map(|address| {
        let data = svm.get_account(&address).unwrap().data;
        deserialize_anchor_pod_account::<TickArrayBitmapExtension>(&data).unwrap()
    });

    let tick_array_addresses = tick_arrays_for_swap(
        pool,
        &pool_state.pool,
        bitmap_extension.as_ref(),
        swap_for_y,
        3,
    )?;
    let tick_arrays: Vec<DynamicTickArray> = tick_array_addresses
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
    let quote = quote_exact_in(QuoteExactInParams {
        pool_address: pool,
        pool: &pool_state,
        tick_arrays: &tick_arrays,
        bitmap_extension: bitmap_extension.as_ref(),
        input_amount,
        swap_for_y,
        has_referral,
        swapper: Some(market.swapper.pubkey()),
        clock: &svm.get_sysvar(),
        input_mint_data: &svm.get_account(&input_mint).unwrap().data,
        output_mint_data: &svm.get_account(&output_mint).unwrap().data,
    })?;

    Ok(QuoteInputs {
        quote,
        tick_arrays: tick_array_addresses,
        bitmap_extension: bitmap_extension_address,
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

fn try_execute_swap(
    market: &mut Market,
    pool: Pubkey,
    input_amount: u64,
    swap_for_y: bool,
    tick_arrays: &[Pubkey],
    bitmap_extension: Option<Pubkey>,
    referral: Option<Pubkey>,
) -> Result<TransactionMetadata, Box<FailedTransactionMetadata>> {
    let (user_token_in, user_token_out) = swapper_token_accounts(market, swap_for_y);
    let swap = Instruction {
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
            writable_metas(tick_arrays),
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
    };
    try_send(
        &mut market.svm,
        &[swap],
        &market.swapper,
        &[&market.swapper],
    )
}

/// Execute the swap and return the `EvtSwap` it emits.
pub fn execute_swap(
    market: &mut Market,
    pool: Pubkey,
    input_amount: u64,
    swap_for_y: bool,
    tick_arrays: &[Pubkey],
    bitmap_extension: Option<Pubkey>,
    referral: Option<Pubkey>,
) -> EvtSwap {
    let meta = expect_sent(try_execute_swap(
        market,
        pool,
        input_amount,
        swap_for_y,
        tick_arrays,
        bitmap_extension,
        referral,
    ));
    // `emit_cpi!` invokes the program with the event tag, the event
    // discriminator and the borsh-encoded event.
    let data = meta
        .inner_instructions
        .iter()
        .flatten()
        .find_map(|inner| {
            inner
                .instruction
                .data
                .strip_prefix(anchor_lang::event::EVENT_IX_TAG_LE)?
                .strip_prefix(EvtSwap::DISCRIMINATOR)
        })
        .expect("swap emits EvtSwap");
    EvtSwap::try_from_slice(data).unwrap()
}

/// Execute the swap expecting the program to reject it, and return the logs.
pub fn execute_swap_expect_failure(
    market: &mut Market,
    pool: Pubkey,
    input_amount: u64,
    swap_for_y: bool,
    tick_arrays: &[Pubkey],
    bitmap_extension: Option<Pubkey>,
) -> Vec<String> {
    try_execute_swap(
        market,
        pool,
        input_amount,
        swap_for_y,
        tick_arrays,
        bitmap_extension,
        None,
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

/// Quote, swap, and compare user transfers, `EvtSwap`, pool price state and
/// the fee split (protocol, partner, host) against the quote. The referral,
/// when given, must be a token account of the mint the pool collects fees in.
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

    let (in_account, out_account) = swapper_token_accounts(market, swap_for_y);
    let in_before = token_amount(&market.svm, &in_account);
    let out_before = token_amount(&market.svm, &out_account);
    let referral = referral.map(|account| (account, token_amount(&market.svm, &account)));
    let pool_before = load_pool(market, pool);
    let fee_setting = pool_before
        .pool
        .get_fee_setting(swap_for_y, referral.is_some())
        .unwrap();
    let fees_on_token_x = fee_setting.fees_on_token_x;

    let event = execute_swap(
        market,
        pool,
        input_amount,
        swap_for_y,
        &tick_arrays,
        bitmap_extension,
        referral.map(|(account, _)| account),
    );

    let paid = in_before - token_amount(&market.svm, &in_account);
    let received = token_amount(&market.svm, &out_account) - out_before;
    assert_eq!(paid, input_amount);
    assert_eq!(received, quote.transfer_fee_excluded_out_amount);

    assert_eq!(
        (event.amount_in, event.amount_left, event.amount_out),
        (input_amount, 0, quote.transfer_fee_excluded_out_amount)
    );
    assert_eq!(
        (event.transfer_fee_in, event.transfer_fee_out),
        (quote.transfer_fee_in, quote.transfer_fee_out)
    );
    assert_eq!(
        quote.consumed_in_amount + quote.transfer_fee_in,
        input_amount
    );
    assert_eq!(
        quote.out_amount,
        quote.transfer_fee_excluded_out_amount + quote.transfer_fee_out
    );
    assert_eq!(
        (event.fees_on_input, event.fees_on_token_x),
        (fee_setting.fees_on_input, fee_setting.fees_on_token_x)
    );
    assert_eq!(
        (
            event.mm_fee,
            event.protocol_fee,
            event.limit_order_fee,
            event.host_fee,
            event.partner_fee,
        ),
        (
            quote.mm_fee,
            quote.protocol_fee,
            quote.limit_order_fee,
            quote.host_fee,
            quote.partner_fee,
        )
    );

    let pool_after = load_pool(market, pool);
    assert_eq!(pool_after.pool.sqrt_price, quote.next_sqrt_price);
    assert_eq!(pool_after.pool.tick_current_id, quote.next_tick_id);
    assert_eq!(pool_after.pool.liquidity, quote.next_liquidity);

    let (before, after) = (&pool_before.pool, &pool_after.pool);
    let on_fee_side = |fee: u64| if fees_on_token_x { (fee, 0) } else { (0, fee) };
    assert_eq!(
        (
            after.protocol_fee_x - before.protocol_fee_x,
            after.protocol_fee_y - before.protocol_fee_y,
        ),
        on_fee_side(quote.protocol_fee)
    );
    assert_eq!(
        (
            after.pool_partner.pending_fee_x - before.pool_partner.pending_fee_x,
            after.pool_partner.pending_fee_y - before.pool_partner.pending_fee_y,
        ),
        on_fee_side(quote.partner_fee)
    );
    if fees_on_token_x {
        assert_eq!(after.fee_growth_global_y, before.fee_growth_global_y);
    } else {
        assert_eq!(after.fee_growth_global_x, before.fee_growth_global_x);
    }

    match referral {
        Some((account, referral_before)) => {
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
        None => assert_eq!(quote.host_fee, 0),
    }
    quote
}

pub fn seed_ranges(center_tick: i32) -> [types::TickRange; 2] {
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
