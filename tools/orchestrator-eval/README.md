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
for each arm, then a ranking (pass-count desc, then fewest substance-failed
turns, then fewest flagged `raw_unparsed` turns, then fewest failed
dimensions). The substance-failed key — turns that answered EMPTY, counted
fail-closed so an unparseable or errored turn is an empty turn — sits
directly after pass-count so that, among arms passing equally many turns,
emptiness can never win a tie by failing FEWER dimensions than a
substantive-but-flawed answer; it deliberately does NOT sit above pass-count,
because substance failure already fails the turn (it is priced into
pass-count) and an arm that actually passes turns must not lose to one that
never does. The flagged-turn key sits ahead of failed-dimensions so a flagged
arm can never break a tie past an unflagged one — a flagged turn never ranks
above an unflagged honest one. Every ranking key is pinned by
`__tests__/candidate-ranking.test.ts`: deleting or reordering any key turns a
named test RED.
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
│   ├── candidate-run.ts         # SEAM-1: produce → extract → score → rank (+ ROUTING_ADAPTER)
│   ├── tasks.ts                 # the task keys (routing | decision_review)
│   ├── task-adapter.ts          # the per-task seam: request / mock / extract+score
│   └── decision-review/         # the decision_review task (see below)
│       ├── types.ts             # fixture types, grounded on the PRODUCTION input types
│       ├── assemble.ts          # REAL assembly via production buildDecisionReviewUserMessage
│       ├── served-contract.ts   # the served prompt's own bans + tone table, PARSED
│       ├── scorer.ts            # 19 deterministic dimensions
│       ├── run.ts               # load → assemble → score → agree (+ named-dimension pins)
│       └── adapter.ts           # the EvalTaskAdapter implementation
├── decision-review-cli.ts       # decision_review fixture regression (pnpm eval:decision-review)
├── reports/                     # committed baseline runs
└── __tests__/
    ├── orchestrator-eval.test.ts
    ├── candidate-eval.test.ts   # gate/cap/zero-network(+positive control)/mock-pipeline
    ├── decision-review-scorer.test.ts        # RED-first, one NAMED dimension at a time
    ├── decision-review-anti-vacuity.test.ts  # floor + positive control + scanned>0 per dim
    ├── decision-review-contract-drift.test.ts# derived-vs-frozen-v14-floor drift guard
    ├── decision-review-assembly.test.ts      # byte-identity with the runtime assembler
    └── decision-review-candidates.test.ts    # SEAM-1 guarantees INHERITED by the new task
```

## Tasks

The chassis is parameterised by a **task key** — the same string the runtime
passes to `getSystemPrompt(...)`, so a `pms:<version>` ref resolves the prompt
the runtime actually serves for that task.

| task | fixtures | request assembly | dimensions |
|---|---|---|---|
| `routing` (default) | `fixtures/` | candidate prompt + `<TURN_CONTEXT>` carrying the assembled analysis | 6 prose dimensions + extraction contract |
| `decision_review` | `fixtures/decision-review/` | candidate prompt as SYSTEM, production `buildDecisionReviewUserMessage` output as USER | 19 dimensions + extraction contract |

```bash
pnpm eval:decision-review                      # fixture regression, offline, zero LLM
pnpm eval:decision-review --verbose             # print every dimension, not just failures
pnpm eval:orchestrator:candidates -- --task decision_review --prompt A=mock:good --prompt B=mock:tone_breach
```

Everything else — the fail-closed double opt-in, the 24-turn hard cap, `mock:`
zero-network playback, fail-closed extraction, the ranking-key invariants — is
INHERITED by every task. That is the point of the adapter seam: a new task has
no code path in which to opt out of them, and
`__tests__/decision-review-candidates.test.ts` re-proves each one through the
new adapter rather than assuming the routing tests cover it.

## The `decision_review` pack

**Provenance discipline.** Each of the 19 dimensions declares where its rule
comes from, ranked by how hard it is to drift:

- **`production-guard` (7)** — the runtime's own exported functions, imported:
  `checkDecisionReviewContract` (#645 contract gate — coverage floor, R-CONT
  fabricated callbacks, entity grounding, the four tight count caps),
  `performShapeCheck`, `checkNumberGrounding`, and the composed
  `findForbiddenMatches`. These cannot disagree with staging because they ARE
  staging's code.
- **`served-prompt-derived` (5)** — PARSED out of
  `Prompts/canonical/decision_review.txt` at run time: the banned lexicon, the
  internal-vocabulary list, the raw-decimal rule, the dash ban, and the TONE
  ALIGNMENT table. The canonical export hashes to `b4f15305c2bb32e9`, which is
  the manifest's `live_served_hash_observed` for PMS v14 — so this is the served
  contract, not a proxy for it. `tools/graph-evaluator` retyped the same two
  lists as `BANNED_TERMS` / `TONE_RULES` constants in March 2026 and they have
  not been re-checked since; that is the drift this parse exists to avoid.
- **`eval-assertion` (7)** — this pack's own worked logic, with its reasoning and
  its LIMITS written at the definition site (`primary_risk_coherent` is
  explicitly a lexical proxy for a semantic rule; `infeasible_winner_disclosed`
  is explicitly not derivable from v14).

**The frozen floor.** A purely-derived rule has the opposite failure mode from a
mirror: pinned to "whatever is current", it becomes a tautology the moment
current changes. So the derived sets are paired with a permanently frozen v14
snapshot (`V14_BANNED_LEXICON_FLOOR`), asserted as a SUBSET of whatever the
prompt bans today. A term the prompt silently RETIRES turns
`decision-review-contract-drift.test.ts` red; a term it ADDS is reported, not
failed. Never "refresh" the floor to match a newer prompt — record the
retirement as a dated exception instead.

**Three states, not two.** A dimension that could not be evaluated — because the
input lacks the field it reads, or the served contract constrains nothing on this
run — is `not_applicable`. It is **excluded from the measured denominator** and
reported out of band. Every "N/M" this tool prints is `passed/measured`.

This is an amendment, and it changed a published number: the first baseline read
**18/19** on the live captures because three unevaluable dimensions were counted
as passes. It is **15/16 measured, 3 not applicable**. An unmeasured dimension
counting as a pass is the exact failure this pack exists to end, and it had
happened inside the pack.

**Anti-vacuity.** Most dimensions are ABSENCE checks, which an empty output
satisfies for free. Three structural defences:

- `substance_present` is a FLOOR a degenerate output must fail;
- every dimension reports `scanned` — **always the CONTENT it examined**, never
  the number of rules it applied. (An earlier draft let it mean either, and
  `no_banned_lexicon` reported `scanned: 10` — its parsed rule count — on an
  output with no prose at all. Ten rules times zero strings is zero checks. Rule
  counts now live in the `detail` string, where they inform without inflating.)
- a dimension that PASSES over a zero corpus is **demoted to `not_applicable`
  by construction**, in one place, so a new dimension inherits the rule by
  existing rather than by being remembered.

Together these mean a degenerate output reports `measured=5, NA=14, passed=0` —
visibly unmeasurable rather than mostly clean.

**Judge layer: deliberately NOT wired.** SEAM-2 stays closed. The rubric-judge
pattern already exists twice (`tools/conversation-harness/scorer/llm-judge.ts`,
`tools/graph-evaluator/src/orchestrator-judge.ts`), both opt-in and cost-capped,
and layering one here would have been cheap. It was left out because the
deterministic floor is what the baseline needed to be trustworthy, and a judge
whose scores nobody has calibrated against this pack would add a number without
adding a guarantee. `primary_risk_coherent` names the specific place a judge
would earn its keep: the semantic version of a rule this pack can only check
lexically.

## Known gaps in the `decision_review` pack (stated, not papered over)

- **DSK dimensions not revived.** `invokeDecisionReview` injects a
  `<SCIENCE_CLAIMS>` section built from the DSK registry through runtime config
  when the served prompt lacks one. Reproducing that would make the offline path
  depend on config state, so it is omitted — which means this pack scores the
  NON-DSK assembly, and the March pack's `dsk_fields_correct` dimension is
  consciously not carried over.
- **Product-knowledge currency is NOT measured.** The register's headline
  complaint about v14 is that it "predates held-proposals / goal-fit /
  calibrated-uncertainty". Those fields are absent from the prompt AND from
  `DecisionReviewInvokeInput`, so a fixture cannot carry them and a dimension
  cannot score them without a `src/` change. Flagged rather than faked.
- **Sub-field shapes below `performShapeCheck` are not asserted.** The runtime
  shape check is the contract this pack enforces; the prompt specifies more
  (character caps, technique tables, `brief_evidence` substring rules) that
  nothing here checks yet.
- **One unavoidable MIRROR of runtime state, made loud.** `countDescriptiveNumbers`
  reproduces `DESCRIPTIVE_FIELD_KEYS`, `NUMBER_PATTERN` and `PERCENTAGE_PATTERN`,
  all module-private in `src/cee/decision-review/shape-check.ts`, because
  `checkNumberGrounding` returns only warnings — a clean result is
  indistinguishable from "there were no numbers here", which is the vacuity
  `scanned` exists to expose. That is a hand-maintained mirror inside the
  anti-vacuity machinery. It cannot be fixed from here (exporting the constants
  is a `src/` change, outside this lane's file-set boundary), so
  `decision-review-runtime-mirror.test.ts` reads `shape-check.ts` **as text** at
  test time and asserts the copies match the source bytes. **The clean fix —
  export the three constants and import them — belongs to the next src-side
  decision_review lane.**
- **`ENTITY_ID_IN_PROSE_PATTERN` carries a hand-maintained prefix list**
  (derived 2026-07-31, no runtime constant exists to derive it from). A new
  entity kind will go undetected silently; the backstop and the second list to
  update are named at the definition site.

## Deliberately deferred (co-owned with the prompt workstream / "Brief I")

- **Full fixture set + R-sets** — the real corpus of orchestrator turns
  (framing, draft, explain, edit, post-analysis) and their regression sets.
- **Full prompt compose** — the foundation exercises the analysis-projection
  stage; wiring the whole context-pack → system-prompt compose is the next step.
- **Paid LLM judge** — the deterministic scorer is the floor; the judge is
  additive.
- **Paid judge inside this tool (SEAM-2)** — typed but unwired
  (`src/judge-seam.ts`, `NO_PAID_JUDGE`). The deterministic scorer is the floor
  and the gate never depends on a paid call; a rubric judge is additive. The
  `decision_review` pack deliberately did NOT wire it — see "Judge layer" below.

> **CORRECTED 2026-07-31.** This section used to close with *"CI gate wiring —
> this is NOT yet a blocking CI gate"*. **That was stale by twelve days.**
> `pnpm eval:orchestrator:test` has been a REQUIRED CI step since PR #532
> (`8f1667ae`, 19 Jul) — `.github/workflows/ci.yml:97`, inside the
> `Lint, TypeCheck, Unit Tests` job, deliberately placed BEFORE `test:required`
> so a prompt regression is the attributable signal rather than being shadowed.
> The note stayed wrong because nobody re-read the README when the wiring
> landed: a hand-maintained description of a gate is itself a mirror, and it
> drifted exactly the way mirrors do here.
