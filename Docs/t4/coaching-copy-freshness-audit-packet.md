# Coaching/result copy vs freshness policy — audit packet

**Date:** 2026-07-03 (T4 acceleration overnight lane, Payload 6)
**Verdict: PASS — no fixes shipped, deliberately.** The audit found the landed
freshness/persistence policy correctly implemented across every deterministic
copy surface checked, and each initially-proposed fix was either already covered
or gated out by the run's proof rules. Recording both halves so the "no PR"
outcome reads as evidence, not omission.

## What was audited (staging `f2998df02`)

Stale-as-current copy; "updated/applied" claims vs persistence; re-run offers
after mutation; held/refused wording; unconfirmed(`unknown`)/stale distinction —
across `chip-generator.ts` (post-mutation + stale-recovery + what-would-flip
rules), `phase3-blocks.ts` (stale-rerun block), `post-analysis-wrapper.ts`,
`analysis-result-headline.ts`, `edit-graph-dispatch.ts` no-op recovery +
fallback copy, `edit-rejection-text.ts`, `forbidden-user-facing-phrases.ts`
egress guard, `staleness-prefix.ts`.

**Compliant everywhere checked:** stale results are gated on the `stale`
verdict with the canonical §5a prefix; re-run offers fire on every
stale-post-mutation path; rejection copy is specific and actionable; `unknown`
freshness never triggers stale-recovery copy (and now fails closed in
run-comparison per #329); the false-success egress guard blocks
"applied/updated" claims on refused/no-op paths.

## Proposed fixes that did NOT survive scrutiny (and why)

1. **"Missing" post-analysis-wrapper freshness-branch unit test** — FALSE GAP.
   `tests/contract/post-analysis-wrapper.test.ts` already covers all four
   branches (fresh/stale/unknown/none), telemetry-noise policy, sanitisation,
   and the cross-turn limitation. The audit had only searched
   `src/**/__tests__/`.
2. **Copy softening at `edit-graph-dispatch.ts:874`** ("Applied edit. Graph now
   has N nodes and M edges.") — GATED OUT by the run amendment, correctly: the
   string is composed in `editResultToOlumiResponse` BEFORE the executor's
   `commitTurn` persists anything (the dispatch header itself says the applied
   graph persists later). Persistence is not provable at the emission point, so
   neither the old nor a reworded string can honestly claim state; a wording
   swap would cosmetically hide the real gap.
3. **JSDoc caller-contract notes** — already present where they matter
   (`post-analysis-wrapper.ts` documents "Does NOT re-derive freshness"); the
   headline builder is a pure helper of the run_analysis handler where
   freshness is definitionally fresh-at-run. Decorative; dropped.
4. **phase3-blocks stale/fresh assertions** — already exist
   (`phase3-lifecycle.test.ts:717` exactly-one-stale-rerun-block, `:830`
   no-stale-coaching-on-fresh, `:908` ban-list on stale copy; block freshness
   stamp pinned at `phase3-blocks.test.ts:1017`).

## Packet items for future slices (NOT implemented — touch held semantics)

1. **Persistence-proven success copy** (the real fix behind item 2): give
   `EditGraphResult` (or the commit path) a persistence-confirmed signal and
   gate "applied" copy on it — belongs with §3b mutation-apply doctrine
   (see `Docs/t4/slice4-readiness-packet.md` §4.1's post-apply bullet).
2. **Explicit `held` wire status** for valid-but-not-applied proposals — today
   no-op recovery covers it in copy only; a typed status arrives with the
   Slice 4 referee verdicts.
3. **Persisted `PostAnalysisCoachingFact`** — needs the `@talchain/schemas`
   bump documented in `post-analysis-wrapper.ts`; the pinned contract test will
   flip when it lands (by design).
