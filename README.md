# deepbook-cli

DeepBook CLI.

- Read + stream market data via pluggable providers (default: Surflux)
- Execute DeepBook on-chain trades and balance-manager operations from the same `deepbook` binary

## Install

```bash
npm install -g deepbook-cli
```

Or simply copy the SKILL.md file in [./skills] to your local [~/.claud/skills/deepbook] directory.

Run claude and it will automatically load the skills

## Configuration

`deepbook` is usable from any path without a local `.env`.
Persistent global config is stored in `~/.deepbook/config.json` (created on first run).

## AGENTS AND SKILLS

You can find skills for this CLI [here](https://github.com/mcxross/skills)
