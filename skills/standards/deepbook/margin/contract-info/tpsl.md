The Take Profit Stop Loss (TPSL) module enables conditional orders that automatically execute when certain price conditions are met. This allows traders to set up automated trading strategies that protect against losses (stop loss) or lock in profits (take profit) without requiring constant monitoring.

## How TPSL works

1. **Create a condition:** Define whether the order should trigger when the price goes above or below a specified trigger price.
2. **Create a pending order:** Specify the order details (limit or market order) that will be placed when the condition is met.
3. **Add conditional order:** Combine the condition and pending order, and add them to your margin manager.
4. **Execution:** Anyone can call the permissionless `execute_conditional_orders` function to execute orders whose conditions are met. This is typically handled by keepers or bots monitoring the market.

Conditional orders are stored in sorted vectors for efficient execution:
- `trigger_below`: Orders that trigger when price falls below the trigger price (sorted high to low)
- `trigger_above`: Orders that trigger when price rises above the trigger price (sorted low to high)

## API

### Helper functions

Use these functions to create conditions and pending orders for conditional orders.

<summary>Create a condition</summary>

Create a new condition that specifies when the order should trigger.

<summary>Create a pending limit order</summary>

Create a pending limit order that will be placed when the condition is met. Order type must be `no_restriction` or `immediate_or_cancel`.

<summary>Create a pending market order</summary>

Create a pending market order that will be placed when the condition is met.

### Manage conditional orders

These functions are exposed on the `MarginManager` to manage conditional orders.

<summary>Add conditional order</summary>

Add a conditional order to the margin manager. The order will be placed when the condition is met. Validates that the trigger condition is valid relative to the current price.

<summary>Cancel conditional order</summary>

Cancel a specific conditional order by ID.

<summary>Cancel all conditional orders</summary>

Cancel all conditional orders for the margin manager.

<summary>Execute conditional orders</summary>

Execute conditional orders that have been triggered. This is a permissionless function that can be called by anyone (typically keepers or bots).

<summary>Read endpoints</summary>

## Events

<summary>`ConditionalOrderAdded`</summary>

Emitted when a conditional order is added to a margin manager.

<summary>`ConditionalOrderCancelled`</summary>

Emitted when a conditional order is cancelled.

<summary>`ConditionalOrderExecuted`</summary>

Emitted when a conditional order is executed.

<summary>`ConditionalOrderInsufficientFunds`</summary>

Emitted when a conditional order cannot be executed due to insufficient funds.

## Related links