# CEE — olumi-assistants-service

Conversational orchestration engine. Drafts the decision graph + coaching from
conversation and orchestrates analysis. Node / TS, **pnpm**, SSE.
Platform map + cross-cutting hazards: repo-parent `CLAUDE.md`. Global git/verify
practice: `~/.claude/CLAUDE.md`.

## Service specifics

- **Live orchestration path is `/orchestrate/v2/turn`. v1 is dead — returns 410.** Don't wire anything to v1.
- **`node_modules` is git-tracked here** — this is why `git status` shows hundreds of dirty files. Normal. Never `git add -A`; stage only your intended source changes.
- Stale `.js` files co-located with `.ts` in `src/` shadow the source (Node resolves `.js`). Check first when debugging weird behaviour:
  `find src -name '*.js' -exec sh -c 'test -f "${1%.js}.ts" && echo "STALE: $1"' _ {} \;`

## Schema & type safety (CEE's signature rule)

- **Before writing any literal default, enum string, or type assertion, find the Zod
  schema or TS enum that validates the field** and confirm the value is a valid member.
  Don't invent values from memory or brief. If no schema exists for the field, flag it
  before proceeding.
- Crossing a service boundary (CEE → PLoT → ISL) means **schema-version skew** applies —
  a value valid in the producer can be invalid or dropped at the consumer. Trace
  producer → validator → consumer and check each repo's `@talchain/schemas` pin. See parent map.

## Commands

```bash
pnpm dev
pnpm typecheck:src   # tsc -p tsconfig.build.json --noEmit — THE source gate
pnpm lint            # eslint .
pnpm test            # full vitest suite (Tier 3 only)
```

> **Use `pnpm typecheck:src`, not `pnpm typecheck` / `tsc --noEmit`.** Plain typecheck
> uses `tsconfig.json`, which includes `tests/**` and surfaces hundreds of *pre-existing*
> test-file type errors — it cannot tell you whether *you* broke something. The pre-push
> hook checks `tsconfig.build.json`; Tier 1 must match it.

## Testing tiers

- **Tier 1 (after every change, before saying "done"):** `pnpm typecheck:src` + `pnpm exec vitest run --changed --bail=1`. If `--changed` finds no related tests, typecheck alone is enough.
- **Tier 2 (before commit):** `pnpm typecheck:src` + `pnpm lint`.
- **Tier 3 (only when pushing to staging):** the pre-push hook runs the gate automatically. Don't run the full `pnpm test` after every change — it's wasteful; CI is the authoritative gate.

## Deploy

- Push to `staging` by default; **never `main` without explicit confirmation.**
- Gate: `bash scripts/validate-prepush.sh` (runs on `git push` via the hook — branch guard, `tsconfig.build` typecheck, lint of changed files, smoke tests, stale-`.js`, dep audit). First-time setup: `bash scripts/install-hooks.sh`.

## Working rules (shared doctrine, condensed)

- **Data-flow tracing before any cross-boundary fix:** origin → every transform/adapter (with paths) → consumer → alternate paths (direct vs PLoT-wrapped error, V2 vs V3 adapter). Fix *all* affected layers, not the first one found. Note: PLoT forwards the edge `from` unchanged; ISL's inbound Pydantic model aliases it to `from_` (ISL `src/models/robustness_v2.py`). The translation lives in ISL, not PLoT.
- **Code-review feedback:** read every item first, judge each independently (valid / already-handled / based on a misunderstanding), state your reasoning, don't change correct code to appease.
