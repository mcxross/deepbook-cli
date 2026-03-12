# deepbook-cli

DeepBook CLI.

- Read + stream market data via pluggable providers (default: Surflux)
- Execute DeepBook on-chain trades and balance-manager operations from the same `deepbook`/`db` binary

## Install

```bash
npm install -g deepbook-cli
```

# Usage

```bash
deepbook --help
```

## Configuration

`deepbook` and `db` global config is stored in `~/.deepbook/config.json` (created on first run)

## Strategy Commands

`deepbook run` includes client-side strategy loops built for DeepBook execution:

- `deepbook run twap <pool> <buy|sell> <size> <duration>`
- `deepbook run dca <pool> <buy|sell> <amount> <interval>`
- `deepbook run grid <pool> --upper <price> --lower <price> [options]`
- `deepbook run trailing-stop <pool> --trail <pct> [options]`
- `deepbook run cross-pool-spread <poolA> <poolB> [options]`

## AGENTS AND SKILLS

You can find skills for this CLI [here](https://github.com/mcxross/skills)

## License

Apache License 2.0
