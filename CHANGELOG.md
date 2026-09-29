# Changelog

## 0.1.0

First publishable TypeScript package for DLMM Pro IDL `0.1.0`.

- Rust commons ports activation initialize and post-swap updates, including the bonding-curve dead-pool check, and base-fee `validate`.
- `quoteExactIn` reports `postSwapActivations`. The bonding-curve flag flips only when the quote consumes the full input, matching the program, which writes the flag after a successful swap.
- `DlmmProClient.operator` builds operator, config, pool-status, partner-fee, and protocol-fee instructions. `accessRegistry` fetches token badges. Creating and closing badges is not part of this client.
- Swap, liquidity, claim, reward, and limit-order builders resolve Token-2022 transfer-hook accounts when the hook array is omitted. An explicit array, including an empty one, is sent as-is.
- The package no longer declares `typescript` as a peer dependency. The Rust crate stays `publish = false`.
- Swap accepts a referral token account equal to `userTokenOut`, matching `#[account(mut, dup)]` on main.
- Creator `initializeReward` rejects a non-whitelisted mint with a freeze authority unless a token badge is passed, and a non-creator signer fails with `InvalidPermission`.
