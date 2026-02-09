The DeepBook referral system allows users to earn fees by referring traders to the platform. Referrers can mint a `DeepBookPoolReferral` object for a specific pool, and traders can associate their `BalanceManager` with a referral. When traders with an associated referral execute trades, a portion of their trading fees is allocated to the referrer based on the referral multiplier.

## How referrals work

1. **Mint a referral:** Anyone can mint a `DeepBookPoolReferral` for a specific pool with a specified multiplier. The referral is permanently tied to the pool it was minted from and can only earn fees from trades in that pool.
2. **Set referral:** Traders associate their `BalanceManager` with a pool-specific referral using a `TradeCap`. Each `BalanceManager` can be associated with different referrals from different pools simultaneously.
3. **Earn fees:** When taker orders are executed by the balance manager in that pool, referral fees are automatically allocated based on the multiplier. Maker orders do not generate referral fees.
4. **Claim rewards:** Referrers can claim their accumulated fees in base, quote, and DEEP tokens.

## API

The following are the referral-related functions that DeepBook exposes.

<summary>Mint a referral</summary>

Mint a new `DeepBookPoolReferral` object for a specific pool with a specified multiplier. The multiplier determines the portion of trading fees allocated to the referrer. The multiplier must be a multiple of 0.1 (e.g., 0.1, 0.2, 0.3, ...) and cannot exceed 2.0. Returns the ID of the created referral.

<summary>Update referral multiplier</summary>

Update the multiplier for an existing pool referral. Only the referral owner can update the multiplier. The new multiplier must be a multiple of 0.1 and cannot exceed 2.0.

<summary>Claim referral rewards</summary>

Claim accumulated referral fees for a pool referral. Only the referral owner can claim rewards. Returns three `Coin` objects representing the accumulated fees in base asset, quote asset, and DEEP tokens.

<summary>Get referral balances</summary>

View the current accumulated balances for a pool referral without claiming them. Returns the amounts in base, quote, and DEEP tokens.

<summary>Get referral multiplier</summary>

Get the current multiplier for a pool referral.

## `BalanceManager` referral functions

These functions are available on the `BalanceManager` to associate or disassociate a referral.

<summary>Set referral</summary>

Associate a `BalanceManager` with a pool-specific referral. Requires a `TradeCap` to authorize the operation. Once set, all trades executed by this balance manager in the referral's pool will generate referral fees according to the referral's multiplier. Any previously set referral for the same pool is replaced.

<summary>Unset referral</summary>

Remove the referral association from a `BalanceManager` for a specific pool. Requires a `TradeCap` to authorize the operation. After unsetting, trades in that pool will no longer generate referral fees.

<summary>Get referral ID</summary>

Retrieve the referral ID currently associated with a `BalanceManager` for a specific pool, if any. Returns `Option<ID>` which is `none` if no referral is set for that pool.

<summary>Get referral owner</summary>

Get the owner address of a pool referral object.

<summary>Get referral pool ID</summary>

Get the pool ID associated with a pool referral object.

## Events

<summary>`DeepBookReferralCreatedEvent`</summary>

Emitted when a new referral is minted.

<summary>`DeepBookReferralSetEvent`</summary>

Emitted when a referral is set or unset on a balance manager.

<summary>`ReferralClaimed`</summary>

Emitted when a referral owner claims their accumulated fees.

<summary>`ReferralFeeEvent`</summary>

Emitted when referral fees are allocated during trade execution.

## Related links