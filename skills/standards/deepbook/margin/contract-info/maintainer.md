The maintainer module provides functions for managing margin pools, configuring interest rates, and controlling which DeepBook pools can access margin lending. These functions are restricted to maintainers with the appropriate capabilities.

## API

Following are the different maintainer functions that the `MarginPool` exposes.

<summary>Create a margin pool</summary>

Creates and registers a new margin pool for a specific asset. Only one margin pool can exist per asset type.

<summary>Enable or disable DeepBook pools</summary>

Control which DeepBook pools can borrow from this margin pool. Only margin managers associated with enabled pools can take loans.

<summary>Update pool parameters</summary>

Update interest rate parameters and margin pool configuration settings.

<summary>Withdraw fees</summary>

Withdraw accumulated maintainer and protocol fees from the margin pool.

## Events

<summary>`MaintainerCapUpdated`</summary>

Emitted when a maintainer capability is updated.

<summary>`PauseCapUpdated`</summary>

Emitted when a pause capability is updated.

<summary>`DeepbookPoolRegistered`</summary>

Emitted when a DeepBook pool is registered in the margin registry.

<summary>`DeepbookPoolUpdatedRegistry`</summary>

Emitted when a DeepBook pool's enabled status is updated in the registry.

<summary>`DeepbookPoolConfigUpdated`</summary>

Emitted when a DeepBook pool's configuration is updated in the registry.

## Related links