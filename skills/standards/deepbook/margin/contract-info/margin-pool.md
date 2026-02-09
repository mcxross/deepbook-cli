The `MarginPool` is a shared object that manages liquidity for a specific asset, enabling lenders to supply assets and margin traders to borrow them. Each margin pool tracks supply and borrow positions, accrues interest over time, and enforces risk parameters to maintain system health.

Margin pools use a shares-based accounting system where suppliers receive shares representing their proportion of the total supply. Interest accrues continuously, increasing the value of these shares over time. Borrowers can only borrow from pools that have enabled their specific DeepBook trading pool.

## API

Following are the different public functions that the `MarginPool` exposes.

<summary>Mint a `SupplierCap`</summary>

Create a new `SupplierCap` that can be used to supply and withdraw from margin pools. One `SupplierCap` can be used across multiple margin pools.

<summary>Supply liquidity</summary>

Supply assets to the margin pool to earn interest. Returns the total supply shares owned by the supplier after this operation.

<summary>Withdraw liquidity</summary>

Withdraw supplied assets from the margin pool. You can specify an exact amount or withdraw all available shares.

<summary>Read endpoints</summary>

## Events

<summary>`MarginPoolCreated`</summary>

Emitted when a new margin pool is created.

<summary>`DeepbookPoolUpdated`</summary>

Emitted when a DeepBook pool is enabled or disabled for lending.

<summary>`InterestParamsUpdated`</summary>

Emitted when interest rate parameters are updated.

<summary>`MarginPoolConfigUpdated`</summary>

Emitted when margin pool configuration is updated.

<summary>`SupplierCapMinted`</summary>

Emitted when a new supplier cap is minted.

<summary>`AssetSupplied`</summary>

Emitted when assets are supplied to a margin pool.

<summary>`AssetWithdrawn`</summary>

Emitted when assets are withdrawn from a margin pool.

<summary>`MaintainerFeesWithdrawn`</summary>

Emitted when maintainer fees are withdrawn.

<summary>`ProtocolFeesWithdrawn`</summary>

Emitted when protocol fees are withdrawn.

<summary>`ProtocolFeesIncreased`</summary>

Emitted when protocol fees are accrued from interest payments.

## Related links