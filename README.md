# deepbook-cli

DeepBook CLI with a pluggable data provider architecture.

## Install

```bash
npm install -g deepbook-cli
```

## API Keys

Create `deepbook-cli/.env` and set keys there (the CLI auto-loads `.env` from your current working directory).  
You can also set environment variables in your shell.

Default provider is `surflux`. For that provider, set one read key (used by all non-stream commands):

```bash
export SURFLUX_API_KEY=...
```

For streams, each pool must have its own key:

```bash
export API_KEY_STREAM_SUI_USDC=...
export API_KEY_STREAM_WAL_USDC=...
```

The naming format is:

```text
API_KEY_STREAM_<BASE>_<QUOTE>
```

## Providers

`deepbook` routes all reads/streams through a provider interface.

- Current provider: `surflux`
- Select provider with `--provider <name>` (or `DEEP_PROVIDER`)
- List providers with:

```bash
deepbook providers
```

## Usage

```bash
deepbook --help
deepbook providers
```

### Read commands

```bash
deepbook pools
deepbook orderbook SUI_USDC --depth 20
deepbook orderbook SUI_USDC --watch
deepbook trades SUI_USDC --limit 100
deepbook ohlcv SUI_USDC --timeframe 5m --limit 100
```

`orderbook --watch` supports `--interval-ms <ms>` (default `1000`).

### Stream commands (SSE)

```bash
deepbook stream trades SUI_USDC
deepbook stream trades SUI_USDC --json
deepbook stream trades SUI_USDC --kind deepbook-margin
```

## Global options

```bash
--json                 Output JSON
--provider <name>      Data provider (default: surflux)
--base-url <url>       REST base URL (default: https://api.surflux.dev)
--stream-base-url <url> Stream base URL (default: https://flux.surflux.dev)
```
