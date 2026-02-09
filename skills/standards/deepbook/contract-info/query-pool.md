The `Pool` shared object represents a market, such as a SUI/USDC market. That `Pool` is the only one representing that unique pairing (SUI/USDC) and the pairing is the only member of that particular `Pool`. See [DeepBookV3 Design](../design.md#pool) to learn more about the structure of pools.

To perform trades, you pass a `BalanceManager` and `TradeProof` into the relevant `Pool`. Unlike `Pool`s, `BalanceManager` shared objects can contain any type of token, such that the same `BalanceManager` can access multiple `Pool`s to interact with many different trade pairings. See [BalanceManager](./balance-manager.md) to learn more.

## API

DeepBookV3 exposes a set of endpoints that can be used to query any pool.

<summary>Check whitelist status</summary>

Accessor to check whether the pool is whitelisted.

<summary>Check quote quantity against base (DEEP fees)</summary>

Dry run to determine the quote quantity out for a given base quantity. Uses DEEP as fee.

<summary>Check base quantity against quote (DEEP fees)</summary>

Dry run to determine the base quantity out for a given quote quantity. Uses DEEP as fee.

<summary>Check quote quantity against base (input token fees)</summary>

Dry run to determine the quote quantity out for a given base quantity. Uses input token as fee.

<summary>Check base quantity against quote (input token fees)</summary>

Dry run to determine the base quantity out for a given quote quantity. Uses input token as fee.

<summary>Check quote quantity against quote or base</summary>

Dry run to determine the quantity out for a given base or quote quantity. Only one out of base or quote quantity should be non-zero. Returns the (`base_quantity_out`, `quote_quantity_out`, `deep_quantity_required`).

<summary>Check fee required</summary>

Returns the DEEP required for an order if it's a taker or maker given quantity and price (`deep_required_taker`, `deep_required_maker`).

<summary>Retrieve mid price for a pool</summary>

Returns the mid price of the pool.

<summary>Retrieve order IDs</summary>

Returns the `order_id` for all open orders for the `balance_manager` in the pool.

<summary>Retrieve prices and quantities for an order book</summary>

Returns vectors holding the prices (`price_vec`) and quantities (`quantity_vec`) for the level2 order book. The `price_low` and `price_high` are inclusive, all orders within the range are returned. `is_bid` is `true` for bids and `false` for asks.

Returns vectors holding the prices (`price_vec`) and quantities (`quantity_vec`) for the level2 order book. `ticks` are the maximum number of ticks to return starting from best bid and best ask. (`bid_price`, `bid_quantity`, `ask_price`, `ask_quantity`) are returned as four vectors. The price vectors are sorted in descending order for bids and ascending order for asks.

<summary>Retrieve balances</summary>

Get all balances held in this pool.

<summary>Retrieve pool ID</summary>

Get the ID of the pool given the asset types.

<summary>Retrieve order information</summary>

Returns the `Order` struct using the order ID.

Returns a vector of `Order` structs using a vector of order IDs.

Returns a vector of `Order` structs for all orders that belong to a `BalanceManager` in the pool.

<summary>Retrieve locked balance</summary>

Returns the locked balance for a `BalanceManager` in the pool (`base_quantity`, `quote_quantity`, `deep_quantity`).

<summary>Retrieve pool parameters</summary>

Returns the trade parameters for the pool (`taker_fee`, `maker_fee`, `stake_required`).

Returns the trade parameters for the next epoch for the currently leading proposal of the pool (`taker_fee`, `maker_fee`, `stake_required`).

Returns the quorum needed to pass proposal in the current epoch.

Returns the book parameters for the pool (`tick_size`, `lot_size`, `min_size`).

Returns the `OrderDeepPrice` struct for the pool, which determines the conversion for DEEP fees.

<summary>Retrieve reverse quantity calculations</summary>

Dry run to determine the base quantity needed to receive a given quote quantity out.

Dry run to determine the quote quantity needed to receive a given base quantity out.

<summary>Pre-trade validation</summary>

Check if a limit order can be placed with the given parameters. Returns `true` if the order can be placed, `false` otherwise.

Check if a market order can be placed with the given parameters. Returns `true` if the order can be placed, `false` otherwise.

Validate limit order parameters and return detailed error information if invalid.

Validate market order parameters and return detailed error information if invalid.

<summary>Pool status</summary>

Check if the pool is a stable pool (uses stable curve pricing).

Check if the pool is registered in the registry.

<summary>Account queries</summary>

Check if an account exists for a `BalanceManager` in the pool.

Get the `Account` struct for a `BalanceManager` in the pool.

## Related links