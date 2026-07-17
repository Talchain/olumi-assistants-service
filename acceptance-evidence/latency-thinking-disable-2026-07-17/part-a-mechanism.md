# PART A — the flag-dark mechanism + byte-identical proof + gates

## The trace (producer → wire)

The coach/routing turn is the V5 orchestrator's ORIENT step:

```
route-v2 → orchestrator-v5/turn-executor → routing/route-with-tool-use.ts
  → adapter.chatWithTools(firstCallArgs, …)              (non-streaming)
    → adapters/llm/anthropic.ts :: chatWithToolsAnthropic
      → apiClient.messages.create(createParams)          (Anthropic wire)
```

Before this change, `firstCallArgs` omitted `thinking` entirely, and the adapter's
`createParams` only ever added `thinking` when `type==='enabled'` — so on Sonnet 5 the
routing turn ran with **adaptive thinking on by default** (~26s median). The measurement
spike's own root-cause note is in the code: `route-with-tool-use.ts` lines 57-59 name
"disable adaptive thinking on the routing call for Sonnet 5 … see the PR follow-up."

## The change (3 prod files + 2 test files)

| File | Change |
|---|---|
| `src/config/index.ts` | New feature flag `coachThinkingDisabled` ← `CEE_COACH_THINKING_DISABLED`, `booleanString.default(false)`. |
| `src/orchestrator-v5/routing/route-with-tool-use.ts` | When `config.features.coachThinkingDisabled`, spread `thinking:{type:'disabled'}` onto `firstCallArgs`. Propagates to the max_tokens-retry and REPAIR_ONCE calls (both reuse `firstCallArgs`). |
| `src/adapters/llm/anthropic.ts` | `chatWithToolsAnthropic` now HONORS `args.thinking?.type==='disabled'` → sends `{thinking:{type:'disabled'}}` (previously dropped it). Telemetry `thinking` field gains a `'disabled'` value. Mirrors the pre-existing `chatWithAnthropic` (chat path) handling. |
| `tests/unit/anthropic.thinking.test.ts` | Updated the pinned "disabled" case: the tools path now TRANSMITS `{type:'disabled'}` (was: dropped). Added a byte-identical "absent → no thinking field" case. |
| `src/orchestrator-v5/routing/__tests__/route-with-tool-use-coach-thinking-disabled.test.ts` | NEW. Flag OFF → no `thinking` on the adapter call; flag ON → `{type:'disabled'}` on initial + retry calls. |

## Why the adapter edit is byte-identical for every existing caller

The adapter change only activates on `args.thinking?.type === 'disabled'`. Audited every
production caller of the tools path:
- `orchestrator/turn-handler.ts` passes `thinking` only when `orchestratorEnabled` (i.e.
  `{type:'enabled',…}`), else nothing — never `'disabled'`.
- `cee/dual-draft/m2-review.ts` passes `{type:'disabled'}` but on the **chat** path
  (`chatWithAnthropic`), which already handled it — not the tools path.
- No other prod caller passes `thinking` to `chatWithToolsAnthropic`.

So today, the ONLY caller that reaches the new branch is the coach turn under
`CEE_COACH_THINKING_DISABLED=on`. Flag off ⇒ `args.thinking` undefined ⇒ `{}` spread ⇒
identical wire bytes as before.

## Byte-identical PROVEN (test + mutation-check)

- Routing OFF test asserts `'thinking' in args === false` (no key at all), not merely
  `undefined`.
- Adapter "absent" test asserts `'thinking' in body === false`.
- **Mutation-checked both mechanisms** (isolated clone, reverted in place, restored):
  - Revert adapter honor-disabled → `tests/unit/anthropic.thinking.test.ts` "transmits
    disabled" goes RED (1 failed); the byte-identical-absent case stays green.
  - Revert routing flag wiring (`config.features…` → `false`) → both flag-ON routing
    tests go RED (2 failed); the flag-OFF test stays green.
  - Both restored; full re-run GREEN (33/33 across the two files).

## Gates (all green on this branch)

| Gate | Result |
|---|---|
| `pnpm test:required` | 1116 files, **20979 passed / 0 failed** / 99 skipped / 13 todo, exit 0 |
| `tsc -p tsconfig.build.json --noEmit` | **0 errors**, exit 0 (openapi:generate + schemas-resolution ran; `@talchain/schemas@0.16.0` from vendored tgz) |
| eslint (touched files) | clean, exit 0 |
| forbidden-boundary ratchet (`scripts/check-forbidden-boundary-patterns.sh`) | warnOnInvalid 0 · as-unknown-as 94 · science-fallback 16 — all **== baseline** |
| typecheck ratchet (`scripts/ci/typecheck-ratchet.sh`) | within baseline (462 errors, exit 0) |
| frozen telemetry registry (`tests/utils/telemetry-events.test.ts`) | green — no new TelemetryEvents member added (only a log-field value string) |

Note: the typecheck ratchet reported drift *shrank* by one file
(`integration-precondition-fail-chip.test.ts`, unrelated to this change) — a pre-existing
baseline staleness, not caused here; gate still passes.
