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
2. **Scores each candidate response deterministically** on six dimensions:
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
   - `substance_present` — non-empty, non-whitespace prose. The five checks
     above are all ABSENCE checks, which an EMPTY answer passes vacuously —
     without this floor, ranking (SEAM-1) literally rewards emptiness, and
     empty `answer_text` is the live prompt-defect class measured pre-v42.2g
     (0/6 populated). An empty answer is a failed turn, not a clean one.
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
pnpm eval:orchestrator             # run the chassis over every fixture (offline, deterministic)
pnpm eval:orchestrator:test        # run the vitest suite (assembly fidelity + gate + guard wiring + SEAM-1)
pnpm eval:orchestrator:candidates  # rank prompt CANDIDATES (SEAM-1) — see "Candidate A/B" below
pnpm eval:orchestrator:typecheck   # tool-local tsc (tools/ is outside tsconfig.build.json's scope)
```

All are **offline by default** — no paid LLM call without the explicit
double opt-in described under "Candidate A/B".

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

## Candidate A/B (SEAM-1, wired) — rank prompt CANDIDATES, not recordings

`pnpm eval:orchestrator` scores RECORDED fixture responses; it structurally
cannot evaluate a prompt candidate. **SEAM-1 closes that gap**: a candidate
PROMPT produces responses at run time and the produced text is scored by the
SAME deterministic dimensions (plus the extraction contract, below), so two
candidates become RANKABLE on identical scenarios.

```bash
pnpm eval:orchestrator:candidates -- --prompt <label>=<ref> [--prompt <label>=<ref> ...] \
    [--live --model <id>] [--max-turns <n>] [--fixtures-dir <path>] [--out report.json]
```

Candidate refs:

| ref | meaning | network |
|---|---|---|
| `<path>` | file containing the FULL candidate prompt text | live mode only |
| `pms:<version>` | that version of the PMS `routing` task, resolved through the repo's own prompt store (`getCompiled('routing', {}, {version})` — needs the store backend env) | live mode only |
| `mock:<label>` | offline plumbing proof: plays back the fixture's recorded candidate with that label through the full produce → extract → score → rank pipeline | none |

### The coach-arm A/B (the use case this seam exists for)

To rank a coach-arm candidate prompt against the served baseline on the
checked-in scenario pack:

```bash
# 1. Put the candidate prompt text in a file (or use its PMS version ref).
# 2. Double opt-in + explicit model (see "Live-mode safety" below):
export ORCHESTRATOR_EVAL_LIVE_CANDIDATES=1
pnpm eval:orchestrator:candidates -- \
  --prompt baseline=pms:115 \
  --prompt coach-arm=/path/to/coach-arm-candidate.txt \
  --live --model <the model the orchestrator actually serves> \
  --out coach-arm-ab.json
```

The report prints per-fixture PASS/FAIL with the failing dimension and detail
for each arm, then a ranking (pass-count desc, then fewest flagged
`raw_unparsed` turns, then fewest failed dimensions). The flagged-turn key
sits ahead of failed-dimensions so a flagged arm can never break a tie past
an unflagged one — a flagged turn never ranks above an unflagged honest one.
`--model` has **no default on purpose**: the eval must run the model the
orchestrator actually serves — check `CEE_MODEL_ORCHESTRATOR` on the target
environment. A tie is reported as a tie, not silently broken.

**Ranking ≠ shipping.** This tool ranks candidates; **uploading a prompt to
PMS, re-pinning `stagingVersion`, and reloading remain orchestrator+Paul-gated
decisions** (see UPLOAD-RUNBOOK-v42.2g.md for that separate, human-gated flow).

### Live-mode safety (OFF by default, fail-closed)

Live production requires **both** halves of a double opt-in — the env key
`ORCHESTRATOR_EVAL_LIVE_CANDIDATES=1` **and** the `--live` flag. Either alone
is refused with a reason naming the missing half. The default path makes
**zero network calls**: the test suite proves it with a fetch counter, and —
because an absence assertion is vacuous without a presence — a positive
control proves the same counter registers calls when the pipeline is opted in
(`__tests__/candidate-eval.test.ts`). The shipped mutation-check: delete the
env-key check in `src/live-gate.ts` and the zero-network test goes RED
(verified during this lane: the pipeline then constructs the real provider and
hits the instrumented fetch seam).

**Cost guard:** live turns per run (prompts × fixtures) are hard-capped at
`HARD_MAX_LIVE_TURNS_PER_RUN = 24` (`src/live-gate.ts`); `--max-turns` can
only LOWER the cap. A plan over the cap is refused before the first call —
never silently truncated, because a partial fixture set would bias the
ranking.

**Cost expectations:** each live turn sends the candidate prompt (a v42-scale
orchestrator prompt is roughly 10–15K tokens) plus a small turn context
(~1–2K tokens) and returns a short JSON response (≤16K token cap, typically a
few hundred). The coach-arm A/B (2 candidates × 6 fixtures = 12 turns) is
therefore on the order of ~200K input + ~10K output tokens — around a dollar
at current Sonnet/Opus-tier pricing, and bounded by the turn cap either way.

**Determinism:** the scorer is fully deterministic; live model output is not
(current Anthropic models accept no sampling parameters, so there is no seed
to pin). The JSON report records the model id and prompt refs so a run is
re-runnable and re-scorable; treat a single live ranking as one sample.

### Offline dry-run (zero paid calls — the plumbing proof)

```bash
pnpm eval:orchestrator:candidates -- --prompt good-arm=mock:good --prompt regression-arm=mock:regression
```

plays back each fixture's recorded `good` / `regression` candidates through
the full pipeline (v30.3 JSON envelope → extraction → scorer → ranking) and
ranks `good-arm > regression-arm` (6/6 vs 0/6). Exit code note: the run exits
non-zero because `stale-and-recommendation-vocabulary` has no candidate
labelled exactly `regression` (its regressions are `regression_stale` /
`regression_recommendation`), and a missing playback label surfaces as a
VISIBLE `model_error`, never a silent skip. A fully-green offline demo is the
single-arm run: `--prompt good-arm=mock:good` (exit 0). The CLI exits non-zero
whenever any turn was unscorable (`model_error`); the ranking itself is
advisory output, not a gate.

### Response contract + extraction

Requests are shaped per the seam's documented reuse of the graph-evaluator
orchestrator adapter: `system` = candidate prompt + `<TURN_CONTEXT>` carrying
the **assembled** analysis (production `formatAnalysisForContext` output — the
same projection stage the floor pack grounds on), `user` = the fixture's user
message + the v30.3 JSON-forcing suffix. The user-facing prose is extracted
from the `text` field of the JSON envelope; when the envelope does not parse,
the RAW output is scored and flagged `raw_unparsed` — visible, never silent,
and **scored**: a flagged turn fails the `extraction_contract` dimension (it
can never PASS), and its `substance_present` is forced to FAIL — fail-closed:
unextractable output counts as EMPTY, never as absent-from-scoring. A scored
dimension was chosen over a hard non-zero exit on any flagged turn because a
hard exit discards the whole run's ranking signal (live turns already paid
for) the moment one arm misbehaves, and an always-red exit trains operators
to ignore it; the scored dimension + the flagged-turn ranking key make the
same invariant structural where the ranking actually looks.
Eligible-actions shaping and the full context-pack → system-prompt compose
stay deferred (below), so rankings are comparable BETWEEN candidates run the
same way, not absolute predictions of staging behaviour.

## Where a paid judge plugs in (SEAM-2, still open)

- **Paid judge** — layer an LLM judge (reuse
  `tools/graph-evaluator/src/orchestrator-judge.ts`) on top for subjective
  quality signal. Off by default; the deterministic verdict always stands alone.
  Typed in `src/judge-seam.ts` (`PaidJudge`), still unwired.

## Layout

```
tools/orchestrator-eval/
├── cli.ts                       # chassis entry (pnpm eval:orchestrator)
├── candidate-cli.ts             # SEAM-1 candidate A/B entry (pnpm eval:orchestrator:candidates)
├── tsconfig.json                # tool-local typecheck (pnpm eval:orchestrator:typecheck)
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
│   ├── scorer.ts                # deterministic scorer wrapper (6 dimensions)
│   ├── run.ts                   # the chassis: load → assemble → score → agree
│   ├── judge-seam.ts            # seam docs: SEAM-1 wired ↓, SEAM-2 (paid judge) still open
│   ├── live-gate.ts             # SEAM-1: fail-closed double opt-in + hard turn cap
│   ├── prompt-source.ts         # SEAM-1: candidate refs (file | pms:<version> | mock:<label>)
│   └── candidate-run.ts         # SEAM-1: produce → extract → score → rank
└── __tests__/
    ├── orchestrator-eval.test.ts
    └── candidate-eval.test.ts   # gate/cap/zero-network(+positive control)/mock-pipeline
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
