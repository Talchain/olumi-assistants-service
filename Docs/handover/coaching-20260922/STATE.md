# AI Coaching / Core Correctness — lane state

**Updated 22 Sep 2026 ~19:05Z · STATE: active, blocked on ONE published verdict**

## Scope, as assigned by release control 18:12Z and accepted

> **AI COACHING — No new OpenAI implementation ownership. Continue staging-health /
> shared deterministic work only unless explicitly handed a shared-boundary repair.**

## ⛔ THE ONE THING BLOCKING EVERYTHING

**#1692 @ `bf0ef4888c06a85e317f8e4b40b58803c7cebefd`** — required CI **green**,
`behind=0`, MERGEABLE, all checks settled. Removes the dead `adjacency`+`reaches`
duplicate in `admit-model.ts`.

**Blocked solely on a published exact-head verdict.** The premerge guard refuses
any merge without one — *"no PUBLISHED approving verdict bound to bf0ef488"* —
regardless of risk class. **Do not route around the guard.**

### What it unblocks

```
e0db97c2  failure   ← staging head
4df4af95  failure   ← SERVED BUILD
a1e35b40  failure
59c90069  failure   ← breakage introduced
877ae800  success   ← last green
```

Four consecutive merges into a red required check; the served build is red; and
**#1691 is red purely by inheritance** (its failing run annotates
`admit-model.ts:828 'reaches' is assigned a value but never used`).

⚠ **CI compiles the MERGE of a branch with its base, not the branch tip.** I
checked a branch file, found the defect absent and wrongly concluded #1691's red
was its own. The run's **annotations** are the authority.

## What is DONE — merged, deployed, witnessed

**#1686, #1679, #1685, #1688.** Conventional spine: **all six behavioural
criteria PASS**, re-witnessed on served `9fe6d0b` at 27 PASS / 4 FAIL — so the
four agent-lane merges did **not** break the conventional route.

`witness/spine.mjs` (33 assertions) · `witness/replay-vs-conflict.mjs`
(11 PASS / 0 FAIL, validated against a 6/5 baseline on the unfixed build).

## Handed over — complete, NOT this lane's to land

- **#1691** receipt-on-creation. Head moved to `d9b4ffe6…` (OpenAI Architecture).
  ⚠ Property the next owner must not lose: it is **deliberately not
  unconditional** — this route accepts graphs `PersistedGraphV3` rejects, where
  the carrier skips and registration succeeds with **no** version. Own control.
- **`analysis_ready` disclosure** — implemented, gated, two mutants killed,
  199 files / 4541 passed. Branch held locally, **not opened**. Offered.

## Not this lane's call

`PROXY_V5_TARGET=agent` is live: a user cannot edit their model, and no
`analysis_ready`/`analysis_result` reaches their client. The refusal **is**
truthful, so criterion 7 turns on whether that is an **accepted** safe refusal
for this phase, or one variable is unset. No config has been changed by me.

## Settled — do NOT re-derive
- The RPC decides `creation_kind` (`CASE WHEN NOT v_has_versions THEN 'initial'`)
  and **requires** `committed_mutation` from callers. All 3,162 scenario-first
  versions are `initial`.
- `assessCanonicalAnalysisReadiness(graph)` is **pure** — no I/O.
  `deriveAnalysisFreshness` needs `priorFacts`, i.e. a DB read.
- `factor_value_edit` HAS a receipt-bearing carrier; guest 0 is the known skip.
- CEE reads **no `category`** on the value write path.
- ⛔ A turn row is **not** an orchestrator/agent discriminator — use `_agent`.
- **The witness has been wrong six times, always optimistically.** Latest: a
  creation arm that built no graph reported FAIL; it now reports NOT MEASURED.
