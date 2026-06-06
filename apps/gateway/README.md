# Signal Room Agent Gateway

Small Node/TypeScript side-effect process for Signal Room agent work.

## Commands

- `pnpm --dir apps/gateway build`
- `pnpm --dir apps/gateway smoke`
- `pnpm --dir apps/gateway health`
- `pnpm --dir apps/gateway dev`

The gateway loads `~/.ai.env` if present. It reports only variable names and presence booleans, never secret values.

`research` uses Exa when `EXA_API_KEY` is present:

```sh
pnpm --dir apps/gateway build
node apps/gateway/dist/index.js research --query "SpacetimeDB realtime collaboration research"
```

Without `EXA_API_KEY`, or with `--mock`, the Exa wrapper returns a deterministic mock source.
