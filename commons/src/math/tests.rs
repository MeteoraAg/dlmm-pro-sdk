use crate::*;

#[test]
fn tick_math_exact_bit_values() {
    let conditions: &[(i32, u128, u128)] = &[
        (0, 18446744073709551616, 18446744073709551616),
        (1, 18447666387855959850, 18445821805675392311),
        (2, 18448588748116922571, 18444899583751176498),
        (4, 18450433606991734263, 18443055278223354162),
        (8, 18454123878217468680, 18439367220385604838),
        (16, 18461506635090006701, 18431993317065449817),
        (32, 18476281010653910144, 18417254355718160513),
        (64, 18505865242158250041, 18387811781193591352),
        (128, 18565175891880433522, 18329067761203520168),
        (256, 18684368066214940582, 18212142134806087854),
        (512, 18925053041275764671, 17980523815641551639),
        (1024, 19415764168677886926, 17526086738831147013),
        (2048, 20435687552633177494, 16651378430235024244),
        (4096, 22639080592224303007, 15030750278693429944),
        (8192, 27784196929998399742, 12247334978882834399),
        (16384, 41848122137994986128, 8131365268884726200),
        (32768, 94936283578220370716, 3584323654723342297),
        (65536, 488590176327622479860, 696457651847595233),
        (131072, 12941056668319229769860, 26294789957452057),
    ];
    for &(tick_id, positive, negative) in conditions {
        assert_eq!(get_sqrt_price_from_tick_id(tick_id), positive);
        assert_eq!(get_sqrt_price_from_tick_id(-tick_id), negative);
    }
}

#[test]
fn tick_math_boundaries() {
    assert_eq!(get_sqrt_price_from_tick_id(MIN_TICK_ID), MIN_SQRT_PRICE);
    assert_eq!(get_sqrt_price_from_tick_id(MAX_TICK_ID), MAX_SQRT_PRICE);
    assert_eq!(
        tick_id_from_sqrt_price(MIN_SQRT_PRICE + 1).unwrap(),
        MIN_TICK_ID
    );
    assert_eq!(
        tick_id_from_sqrt_price(MAX_SQRT_PRICE - 1).unwrap(),
        MAX_TICK_ID - 1
    );
    assert!(tick_id_from_sqrt_price(MIN_SQRT_PRICE - 1).is_err());
    assert!(tick_id_from_sqrt_price(MAX_SQRT_PRICE + 1).is_err());
}

#[test]
fn tick_math_zero_tick_boundary() {
    // sqrt_price = 2^64 is the Q64.64 representation of 1.0 = price at tick 0.
    let zero_tick_price: u128 = 1u128 << 64;
    assert_eq!(tick_id_from_sqrt_price(zero_tick_price + 1).unwrap(), 0);
    assert_eq!(tick_id_from_sqrt_price(zero_tick_price - 1).unwrap(), -1);
}

#[test]
fn tick_math_roundtrip_sampled() {
    let mut t = MIN_TICK_ID;
    while t <= MAX_TICK_ID {
        let sqrt_price = get_sqrt_price_from_tick_id(t);
        assert_eq!(tick_id_from_sqrt_price(sqrt_price).unwrap(), t);
        t += 997;
    }
}

#[test]
fn fee_in_period_edges() {
    assert_eq!(get_fee_in_period(1_000_000, 0, 100).unwrap(), 1_000_000);
    assert_eq!(get_fee_in_period(1_000_000, 100, 0).unwrap(), 1_000_000);
    // one period of 1% reduction
    assert_eq!(get_fee_in_period(1_000_000, 100, 1).unwrap(), 990_000);
}

#[test]
fn shared_amounts_rounding() {
    let (up, rest) = calculate_shared_amounts(10, 1, 3, Rounding::Up).unwrap();
    assert_eq!((up, rest), (4, 6));
    let (down, rest) = calculate_shared_amounts(10, 1, 3, Rounding::Down).unwrap();
    assert_eq!((down, rest), (3, 7));
    assert_eq!(
        calculate_shared_amounts(10, 0, 3, Rounding::Down).unwrap(),
        (0, 10)
    );
}

#[test]
fn split_fees_gives_the_whole_fee_to_the_protocol_when_nothing_was_filled() {
    let fee_setting = FeeSetting {
        fees_on_input: false,
        fees_on_token_x: true,
        has_referral: false,
        has_partner: false,
        mm_protocol_fee_bps: 1_000,
        limit_order_protocol_fee_bps: 5_000,
        partner_fee_bps: 0,
    };
    let filled_amount_result = FilledAmountResult {
        amount_in: 101,
        amount_left: 0,
        out_amount: 0,
        mm_amount_in: 101,
        mm_amount_out: 0,
        processed_order_amount_out: 0,
        open_order_amount_out: 0,
        next_sqrt_price: MIN_SQRT_PRICE,
    };

    let split = split_fees(101, &fee_setting, &filled_amount_result).unwrap();
    assert_eq!(split.protocol_fee_on_mm_fee, 101);
    assert_eq!(split.mm_fee, 0);
    assert_eq!(split.limit_order_fee, 0);
    assert_eq!(split.protocol_fee_on_limit_order_fee, 0);
}

#[test]
fn included_excluded_fee_roundtrip() {
    let numerator = 10_000_000; // 1%
    assert_eq!(
        get_included_fee_amount(numerator, 990_001).unwrap(),
        (1_000_002, 10_001)
    );
    assert_eq!(
        get_excluded_fee_amount(numerator, 1_000_002).unwrap(),
        (990_001, 10_001)
    );
}

#[test]
fn tick_index_from_tick_id_matches_program() {
    let cases: &[(i32, u16, i32)] = &[
        (-1, 2, -1),
        (-257, 2, -2),
        (-2, 2, -1),
        (-129, 1, -2),
        (-256, 2, -1),
        (-512, 2, -2),
        (-128, 1, -1),
        (-1, 1, -1),
        (0, 2, 0),
        (255, 2, 0),
        (256, 2, 1),
        (127, 1, 0),
        (128, 1, 1),
    ];
    for &(tick_id, tick_spacing, expected) in cases {
        assert_eq!(
            TickArray::get_tick_index_from_tick_id(tick_id, tick_spacing).unwrap(),
            expected,
            "tick_id={tick_id} tick_spacing={tick_spacing}"
        );
    }
}
