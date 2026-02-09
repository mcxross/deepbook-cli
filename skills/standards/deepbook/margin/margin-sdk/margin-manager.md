Managing margin accounts is essential for leveraged trading on DeepBook. The Margin Manager SDK provides functions for creating margin managers, depositing collateral, borrowing assets, and managing risk.

## Margin Manager functions

The DeepBook Margin SDK provides the following functions for managing margin accounts.

### `newMarginManager`

Use `newMarginManager` to create and share a new margin manager in one transaction. The call returns a function that takes a `Transaction` object.

**Parameters**

- `poolKey`: String that identifies the DeepBook pool.

### `newMarginManagerWithInitializer`

Use `newMarginManagerWithInitializer` to create a margin manager and return it with an initializer. You must call `shareMarginManager` afterward to share it. The call returns an object with `manager` and `initializer`.

**Parameters**

- `poolKey`: String that identifies the DeepBook pool.

### `shareMarginManager`

Use `shareMarginManager` to share a margin manager created with `newMarginManagerWithInitializer`. The call returns a function that takes a `Transaction` object.

**Parameters**

- `poolKey`: String that identifies the DeepBook pool.
- `manager`: `TransactionArgument` representing the margin manager.
- `initializer`: `TransactionArgument` representing the initializer.

### `depositBase`, `depositQuote`, `depositDeep`

Use these functions to deposit assets into a margin manager. The call returns a function that takes a `Transaction` object.

**Parameters**

- `managerKey`: String that identifies the margin manager.
- `amount`: Number representing the amount to deposit.

### `withdrawBase`, `withdrawQuote`, `withdrawDeep`

Use these functions to withdraw assets from a margin manager. Withdrawals are subject to risk ratio limits. The call returns a function that takes a `Transaction` object.

**Parameters**

- `managerKey`: String that identifies the margin manager.
- `amount`: Number representing the amount to withdraw.

### `borrowBase`, `borrowQuote`

Use these functions to borrow assets from margin pools. Borrowing is subject to risk ratio limits. The call returns a function that takes a `Transaction` object.

**Parameters**

- `managerKey`: String that identifies the margin manager.
- `amount`: Number representing the amount to borrow.

### `repayBase`, `repayQuote`

Use these functions to repay borrowed assets. If no amount is specified, it repays the maximum available balance up to the total debt. The call returns a function that takes a `Transaction` object.

**Parameters**

- `managerKey`: String that identifies the margin manager.
- `amount`: Optional number representing the amount to repay.

### `liquidate`

Use `liquidate` to liquidate an undercollateralized margin manager. The call returns a function that takes a `Transaction` object.

**Parameters**

- `managerAddress`: String representing the address of the margin manager to liquidate.
- `poolKey`: String that identifies the DeepBook pool.
- `debtIsBase`: Boolean indicating whether the debt is in the base asset.
- `repayCoin`: `TransactionArgument` representing the coin to use for repayment.

### `setMarginManagerReferral`

Use `setMarginManagerReferral` to set a pool-specific referral for the margin manager. The referral must be a `DeepBookPoolReferral` minted for the pool associated with the margin manager. The call returns a function that takes a `Transaction` object.

**Parameters**

- `managerKey`: String that identifies the margin manager.
- `referral`: String representing the referral ID.

### `unsetMarginManagerReferral`

Use `unsetMarginManagerReferral` to remove the referral association from a margin manager for a specific pool. The call returns a function that takes a `Transaction` object.

**Parameters**

- `managerKey`: String that identifies the margin manager.
- `poolKey`: String that identifies the DeepBook pool.

## Read-only functions

The following functions query margin manager state without modifying it.

### `riskRatio`

Query the risk ratio of the margin manager, which represents the ratio of assets to debt. Higher ratios indicate healthier positions.

### `owner`, `deepbookPool`, `marginPoolId`

Query basic margin manager information.

### `borrowedShares`, `borrowedBaseShares`, `borrowedQuoteShares`, `hasBaseDebt`

Query borrowed position information.

### `balanceManager`, `calculateAssets`, `calculateDebts`

Query balance and debt information.

## Examples

The following examples demonstrate common margin manager operations.

### Create a margin manager

```tsx
/**
 * @description Create a new margin manager
 * @param {string} poolKey The key to identify the pool
 * @returns A function that takes a Transaction object
 */
newMarginManager = (poolKey: string) => (tx: Transaction) => {};

// Example usage
createMarginManager = (tx: Transaction) => {
	const poolKey = 'SUI_DBUSDC';
	tx.add(this.marginContract.newMarginManager(poolKey));
};
```

### Deposit collateral

```tsx
// Example: Deposit 100 SUI as collateral
depositCollateral = (tx: Transaction) => {
	const managerKey = 'MARGIN_MANAGER_1';
	tx.add(this.marginContract.depositBase(managerKey, 100));
};
```

### Borrow assets

```tsx
// Example: Borrow 500 USDC
borrowFunds = (tx: Transaction) => {
	const managerKey = 'MARGIN_MANAGER_1';
	tx.add(this.marginContract.borrowQuote(managerKey, 500));
};
```

### Repay loan

```tsx
// Example: Repay all borrowed quote assets
repayLoan = (tx: Transaction) => {
	const managerKey = 'MARGIN_MANAGER_1';
	// No amount specified = repay all
	tx.add(this.marginContract.repayQuote(managerKey));
};
```

### Liquidate a position

```tsx
// Example: Liquidate an undercollateralized position
liquidatePosition = (tx: Transaction) => {
	const managerAddress = '0x...'; // Address of margin manager to liquidate
	const poolKey = 'SUI_DBUSDC';
	const debtIsBase = false; // Debt is in USDC (quote)
	const repayCoin = tx.splitCoins(tx.gas, [500 * 1_000_000]); // 500 USDC
	tx.add(this.marginContract.liquidate(managerAddress, poolKey, debtIsBase, repayCoin));
};
```

## Related links