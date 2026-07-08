# orchestrator-eval

The durable regression gate for the CEE orchestrator prompt. Both prompt
workstreams' #1 recommendation was: **no orchestrator prompt should ship to
staging without an A/B run.** This is the foundation slice of that gate — a
small, honest chassis that catches a real, previously-shipped defect, plus the
seams a fuller eval plugs into.

## What it does (foundation)

For each fixture it:

1. **Runs the fixture's raw analysis through the REAL production assembly**
   (`src/orchestrator-v5/format/format-analysis-for-context.ts`). This is the
   exact stage the goal-fit fix lives in — it keeps `win_probability` and
   `target_fit` as two distinct percent vocabularies. The eval uses the runtime
   formatter itself, not a re-specified copy, so it cannot drift from what the
   prompt is actually grounded on.
2. **Scores each candidate response deterministically** on five dimensions:
   - `no_forbidden_terms` — the runtime's `findForbiddenMatches` (forbidden
     user-facing phrases + raw-id / graph-hash / dev-phrase leaks).
   - `no_mutation_language` — the runtime's `containsMutationLanguage` (prose
     that reads as an unbacked graph mutation).
   - `no_goal_fit_conflation` — this pack's worked assertion: the leading
     option's **win %** must not be narrated as the chance of **meeting the
     target**. NOTE: the detector currently reads the fixture's RAW
     `ContextPackAnalysis` numbers (win% vs target-fit%), not the assembled
     formatter output — a deliberate first-slice simplification; grounding the
     detector in the assembled string is a documented follow-up.
   - `no_held_science_vocabulary` (**D5**, eval assertion) — this pack's own
     narrow check for raw metric tokens (sensitivity/robustness/elasticity/
     EVPI/VOI/fragile-edge) or a raw score decimal surfacing where the
     terminology map requires plain-language framing only. **Not** a
     production-guard re-export — see the D5 section below for why.
   - `no_false_success_claim` (**D6**) — the runtime's `findSuccessClaimHit`
     (the mutation-receipt honesty class: "done / updated / applied" claimed
     before any confirmation exists).
3. **Checks each verdict against the fixture's `expected` map** and exits
   non-zero on any disagreement.

Dimensions 1, 2, and 5 **import the production forbidden-phrase /
mutation-language / success-claim constants** (via `src/guards.ts`, which
re-exports `findForbiddenMatches` from the `tools/v5-journey-replay` helper
that itself imports the runtime `FORBIDDEN_USER_FACING_PHRASES`,
`containsMutationLanguage` directly from `src/orchestrator-v5/routing`, and
`findSuccessClaimHit` directly from
`src/orchestrator-v5/compose/forbidden-user-facing-phrases.ts`). So the gate
scores against the SAME phrase lists the runtime enforces (not a re-specified
copy), which is the point: a prompt cannot pass the eval on a forbidden phrase
the runtime would strip. A re-specified copy would drift — the older
`tools/graph-evaluator` orchestrator-scorer (which carries its own
`BANNED_TERMS` array) shows exactly that failure mode. Dimensions 3 (D3) and 4
(D5) are this pack's own worked eval-assertions — see below for why D5 could
not follow the same wholesale-import pattern as 1/2/5.

## The worked defect: win% ≠ target-fit

`fixtures/goal-fit-conflation.json` reproduces staging scenario **90385279** (a
bug fixed twice): the leading option **wins 89%** of the time but has only a
**29%** modelled probability of meeting the target. House doctrine: producers
own meaning, the UI renders only — `win_probability` ("beats the alternatives")
is not `target_fit` ("meets your target").

The fixture ships four recorded candidate responses:

| candidate | expected | why |
|---|---|---|
| `good` | PASS | 89% is the win probability; 29% is the target-fit — kept apart. |
| `good_terse` | PASS | compound sentence, each number bound to its own claim. |
| `regression` | FAIL | "89% chance of reaching your target" — the exact defect. |
| `regression_subtle` | FAIL | "89% likely to meet your target" — same conflation, no "chance". |

If a future edit regresses the production formatter (drops `target_fit` or the
`TARGET_FIT_DEFINITION` disclosure), the assembly-fidelity test fails; if a
candidate prompt starts conflating the two numbers, the gate fails it.

## D5 — held-science vocabulary / D6 — false-success claim (rubric expansion)

Per `orchestrator-prompt-workstream/eval-contribution/RUBRIC-EXPANSION-SPEC.md`,
both dimensions were planned as pure-text, cheap, offline checks that reuse
production detector code wholesale. D6 landed exactly to that plan; D5 did not
survive contact with the orchestrator's own terminology map — see below.

- `fixtures/false-success-claim.json` (**D6**) — pre-action orientation turn;
  `good` proposes the change pending confirmation ("I can propose that change
  once you confirm"); `regression` claims the mutation already happened ("I've
  updated the model with that factor") → FAIL. Imports the runtime's
  `findSuccessClaimHit` wholesale, per spec. **Deviation from the spec's
  literal proposed `good` text** ("I can propose adding that once you
  confirm"): "adding that" trips the *unrelated* `no_mutation_language` guard
  (D2) — `MUTATION_PATTERNS` matches `adding\s+(the|a|an|this|that|your)`.
  Reworded to keep the same pre-action intent without crossing a different
  dimension's line.

- `fixtures/held-science-vocabulary.json` (**D5**) — **design correction, not
  just a fixture reword.** The spec's plan was to import the runtime's
  `HELD_SCIENCE_VOCABULARY_PATTERN` wholesale (same rule as D1/D2/D6). Verified
  2026-07-08 (prompt-workstream co-owner finding, corroborated independently
  while building this fixture): that pattern bans `influence` and `vulnerable`
  — but the orchestrator's terminology map **mandates** exactly those words as
  the required plain-language replacement for driver/sensitivity prose ("has
  the biggest influence on the outcome", "the most vulnerable assumption").
  The runtime pattern was built for a different surface (Cap-1 safe-now /
  Cap-2A add-risk **rejection** copy, where the science words are banned
  outright with no substitute expected) — it is the wrong source of truth for
  this dimension; importing it wholesale would fail every terminology-map-
  compliant orchestrator response. D5 is therefore this pack's own
  eval-assertion (`src/held-science.ts`, same pattern as D3
  `goal-fit-conflation.ts`): a narrow raw-metric-token check
  (`sensitivity`/`robustness`/`elasticity`/`evpi`/`voi`/`fragile edge`) plus a
  raw-decimal-score check, scoped to what the terminology map actually
  forbids — naming the SCORE, not describing the EFFECT. The fixture's third
  candidate (`good_terminology_map_mandated_words`) uses `influence` and
  `vulnerable` directly and must PASS, proving the dimension does not
  re-introduce the production pattern's conflict.

Both fixtures are built to these wiring points (dimension name, detector
module, fixture shape) so the prompt-workstream co-owner's additional
fixtures for these dimensions (already staged at
`orchestrator-prompt-workstream/eval-contribution/fixtures-pending-D5-D6/`)
assert cleanly against this scorer — verified directly against both files
during this lane.

## Run it

```bash
pnpm eval:orchestrator        # run the chassis over every fixture (offline, deterministic)
pnpm eval:orchestrator:test   # run the vitest suite (assembly fidelity + gate + guard wiring)
```

Both are **offline** — no paid LLM call in the default path.

## Add a fixture

1. Create `fixtures/<name>.json`:
   - `id`, `description`, `user_message`.
   - `analysis` — a raw `ContextPackAnalysis` (see the type in
     `src/orchestrator-v5/context/context-pack-assembler.ts`). The chassis runs
     it through the production formatter.
   - `candidates[]` — each `{ label, note, source: "recorded", text }`.
   - `expected` — `{ "<label>": true | false }` (true = should pass the gate).
2. `pnpm eval:orchestrator:test`.

No code change is needed for a new fixture that reuses the existing dimensions.
A fixture that needs a new scenario-specific assertion adds it under `src/` and
wires it into `scorer.ts`.

## Where a live model / paid judge plugs in

The default path is deterministic and offline. Two seams (typed and documented
in `src/judge-seam.ts`) let a fuller eval go live **without changing the gate**:

- **Live candidate** — instead of reading `candidates[*].text`, produce the
  response from a real model at run time. Reuse
  `tools/graph-evaluator/src/providers/*` (openai/anthropic) and its
  `adapters/orchestrator.ts` request shaping. The produced text is scored by the
  same deterministic scorer.
- **Paid judge** — layer an LLM judge (reuse
  `tools/graph-evaluator/src/orchestrator-judge.ts`) on top for subjective
  quality signal. Off by default; the deterministic verdict always stands alone.

## Layout

```
tools/orchestrator-eval/
├── cli.ts                       # chassis entry (pnpm eval:orchestrator)
├── fixtures/
│   ├── goal-fit-conflation.json          # the worked defect (D3)
│   ├── goal-fit-values-withheld.json
│   ├── coach-mutation-language.json      # D2
│   ├── stale-and-recommendation-vocabulary.json
│   ├── held-science-vocabulary.json      # D5
│   └── false-success-claim.json          # D6
├── src/
│   ├── types.ts                 # fixture + result types
│   ├── assemble.ts              # REAL assembly via production formatAnalysisForContext
│   ├── guards.ts                # re-exports of PRODUCTION guards (never re-specified)
│   ├── goal-fit-conflation.ts   # the worked win%-vs-target-fit assertion (D3)
│   ├── held-science.ts          # the worked held-science eval-assertion (D5)
│   ├── scorer.ts                # deterministic scorer wrapper (5 dimensions)
│   ├── run.ts                   # the chassis: load → assemble → score → agree
│   └── judge-seam.ts            # live-model / paid-judge seams (documented)
└── __tests__/
    └── orchestrator-eval.test.ts
```

## Deliberately deferred (co-owned with the prompt workstream / "Brief I")

- **Full fixture set + R-sets** — the real corpus of orchestrator turns
  (framing, draft, explain, edit, post-analysis) and their regression sets.
- **Full prompt compose** — the foundation exercises the analysis-projection
  stage; wiring the whole context-pack → system-prompt compose is the next step.
- **Paid LLM judge** — the deterministic scorer is the floor; the judge is
  additive.
- **CI gate wiring** — this is NOT yet a blocking CI gate. Once the fixture set
  is real, wire it so no orchestrator prompt reaches staging without a green
  `pnpm eval:orchestrator`.
