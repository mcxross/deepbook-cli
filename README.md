# deepbook-cli

Command-line tools for working with DeepBook on Sui.

## Installation

Install globally:

```bash
npm install -g deepbook-cli
```

Check the installed binary:

```bash
deepbook --version
deepbook --help
```

The package exposes both binaries:

```bash
deepbook --help
db --help
```

For local development:

```bash
pnpm install
pnpm build
node dist/index.js --help
```

## Predict

DeepBook Predict is a DeepBook-adjacent prediction-market protocol on Sui. In this CLI, Predict support is currently
read-only: it wraps the public Predict server endpoints with typed client responses and exposes them through
`deepbook predict ...`.

By default, Predict commands use the current Sui Testnet deployment:

```bash
deepbook predict info
```

Useful Predict reads:

```bash
deepbook predict status
deepbook predict state
deepbook predict quote-assets
deepbook predict oracles
deepbook predict vault summary
deepbook predict vault performance --range ALL
deepbook predict lp supplies --limit 10
deepbook predict lp withdrawals --limit 10
deepbook predict managers --limit 10
```

Oracle-specific reads require an oracle object ID:

```bash
deepbook predict oracle state <oracleId>
deepbook predict oracle ask-bounds <oracleId>
deepbook predict oracle prices <oracleId> --limit 20
deepbook predict oracle price-latest <oracleId>
deepbook predict oracle svi <oracleId> --limit 20
deepbook predict oracle svi-latest <oracleId>
deepbook predict history trades <oracleId> --limit 20
```

Manager-specific Predict reads require a Predict manager object ID:

```bash
deepbook predict manager summary <managerId>
deepbook predict manager positions <managerId>
deepbook predict manager pnl <managerId> --range ALL
```

Historical Predict event reads:

```bash
deepbook predict history positions-minted --limit 20
deepbook predict history positions-redeemed --limit 20
deepbook predict history ranges-minted --limit 20
deepbook predict history ranges-redeemed --limit 20
```

Override the default Predict server or Predict object when working against another deployment:

```bash
deepbook --predict-url https://predict-server.testnet.mystenlabs.com predict status
deepbook --predict-id <predictObjectId> predict state
```

## Margin

Margin commands execute DeepBook margin trades through typed margin manager objects. A margin manager is pair-specific: a manager for `DEEP_USDC` is not valid for `DEEP_SUI`.

Discover margin pools and compatible managers:

```bash
deepbook margin pools
deepbook margin pools --registered
deepbook margin managers
```

Deposit collateral or a fee asset:

```bash
deepbook margin deposit DEEP_USDC --coin QUOTE --amount 100 --dry-run
deepbook margin deposit DEEP_USDC --coin QUOTE --amount 100
```

Place margin market and limit orders:

```bash
deepbook margin market DEEP_USDC --side buy --quantity 10 --leverage 2 --dry-run
deepbook margin market DEEP_USDC --side buy --quantity 10 --leverage 2

deepbook margin limit DEEP_USDC --side sell --price 0.20 --quantity 10 --leverage 2 --dry-run
deepbook margin limit DEEP_USDC --side sell --price 0.20 --quantity 10 --leverage 2
```

Inspect and close positions:

```bash
deepbook margin position DEEP_USDC
deepbook margin close DEEP_USDC --full --dry-run
deepbook margin close DEEP_USDC --full --withdraw
```

Margin safety defaults:

- If `--margin-manager` is omitted, the CLI auto-selects a compatible manager or creates one in the transaction when supported.
- If `--margin-manager` is provided, it must match the signer and the pool pair.
- Use `--dry-run` before broadcasting.
- Use `--reduce-only` when you want close orders to reduce exposure only.
- Use `--no-pay-with-deep` if you do not want fees paid with DEEP.

## Spot

Spot commands execute DeepBook spot orders through DeepBook balance managers.

List spot pools:

```bash
deepbook spot pools
```

Create or discover a balance manager:

```bash
deepbook manager ls
deepbook manager create
```

Fund the manager:

```bash
deepbook manager deposit --coin SUI --amount 1 --manager <managerId> --dry-run
deepbook manager deposit --coin SUI --amount 1 --manager <managerId>
deepbook manager balance --coin SUI --manager <managerId>
```

Place market-style spot orders by omitting `--price`:

```bash
deepbook spot buy DEEP_SUI --quantity 10 --manager <managerId> --dry-run
deepbook spot buy DEEP_SUI --quantity 10 --manager <managerId>

deepbook spot sell DEEP_SUI --quantity 10 --manager <managerId> --dry-run
deepbook spot sell DEEP_SUI --quantity 10 --manager <managerId>
```

Place or cancel limit orders:

```bash
deepbook spot limit DEEP_SUI --side buy --price 0.01 --quantity 10 --manager <managerId> --dry-run
deepbook spot limit DEEP_SUI --side buy --price 0.01 --quantity 10 --manager <managerId>

deepbook spot limit DEEP_SUI --cancel <orderId> --manager <managerId> --dry-run
deepbook spot limit DEEP_SUI --cancel <orderId> --manager <managerId>
```

Withdraw funds from a balance manager:

```bash
deepbook manager withdraw --coin DEEP --amount 10 --manager <managerId> --dry-run
deepbook manager withdraw --coin DEEP --amount 10 --manager <managerId>
```

Spot vs swap:

- `deepbook spot buy/sell/limit` places DeepBook order-book orders and uses a balance manager.
- `deepbook swap quote-for-base` and `deepbook swap base-for-quote` execute direct pool swaps with exact-input semantics.

## What This CLI Is

DeepBook is Sui's on-chain central limit order book. `deepbook-cli` is an operator and agent interface for DeepBook: it combines provider-backed reads, Sui RPC access, and DeepBook SDK transaction builders in one binary.

The CLI has three main surfaces:

- Read data: pools, order books, trades, OHLCV candles, SSE streams, and DeepBook Predict read endpoints.
- Execute spot trades: DeepBook spot market/limit orders using balance managers.
- Execute margin trades: DeepBook margin orders using typed margin managers.

The read layer is intentionally provider-aware. Market data commands use the configured provider, currently Surflux by default. On-chain commands use Sui RPC plus DeepBook package metadata from `@mysten/deepbook-v3`. Predict commands use the public Predict server by default and do not submit transactions.

## Configuration

The CLI stores global config in:

```text
~/.deepbook/config.json
```

It is created on first run. Configuration is shared by `deepbook` and `db`.

Common setup:

```bash
deepbook config show
deepbook config set-network mainnet
deepbook config set-provider surflux
deepbook config set-rpc-url mainnet https://fullnode.mainnet.sui.io:443
deepbook account import default
deepbook account details
```

Global flags can override config for one command:

```bash
deepbook --json pools
deepbook --network testnet pools
deepbook --rpc-url <suiRpcUrl> account balance
deepbook --private-key <suiprivkey...> --address <address> manager ls
```

Provider configuration:

```bash
deepbook config set-provider-base-url mainnet <restUrl>
deepbook config set-provider-stream-base-url mainnet <streamUrl>
deepbook config set-read-key
deepbook config set-stream-key SUI_USDC
```

Private keys can be passed interactively or through stdin:

```bash
deepbook account import trader --stdin
deepbook account use trader
```

## Market Data

Provider-backed reads use the configured data provider. The default provider is Surflux.

```bash
deepbook providers
deepbook pools
deepbook orderbook SUI_USDC --depth 20
deepbook book SUI_USDC --depth 20 --watch
deepbook trades SUI_USDC --limit 100
deepbook ohlcv SUI_USDC --timeframe 5m --limit 100
deepbook stream trades SUI_USDC
```

Use `--json` for machine-readable output:

```bash
deepbook --json orderbook SUI_USDC --depth 10
```

## Strategies

`deepbook run` contains client-side strategy loops that build on the same DeepBook execution paths:

```bash
deepbook run twap <pool> <buy|sell> <size> <duration>
deepbook run dca <pool> <buy|sell> <amount> <interval>
deepbook run grid <pool> --upper <price> --lower <price> --size <value>
deepbook run trailing-stop <pool> --trail <pct>
deepbook run cross-pool-spread <poolA> <poolB> --entry <value> --close <value>
```

Run strategy commands with `--dry-run` first when supported.

## Safety Notes

- Prefer `--dry-run` before state-changing commands.
- Never paste private keys into logs, shell history, or shared transcripts.
- Confirm `--network`, `--rpc-url`, pool key, manager ID, and coin key before broadcasting.
- SUI deposit paths split gas from deposit/collateral automatically where needed.
- Predict commands are read-only in this CLI version.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

The package currently declares Node.js `>=22`.

## Agents And Skills

Skills for this CLI are available at:

https://github.com/mcxross/skills

## License

Apache License 2.0
