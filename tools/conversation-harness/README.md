# Conversation-Quality Root-Cause Harness v0 (ROADMAP 1.70)

Automated conversation-quality testing that **localizes AI-experience failures to
layer**: drive a scripted journey against a real CEE, persist every capture layer
per turn (wire envelope, diagnostic trace, DB ground truth), score
property-based dims, and report *which layer* a failing dim implicates — with
`UNMEASURABLE` as a first-class verdict for layers v0 does not capture.

**Provenance:** re-homed from the proven `orchestrator-prompt-workstream/`
on-disk harness (`candidates/` A/B arms + `fixed-graph-harness/` frozen-graph
determinism, both live-proven 2026-07). The re-home closes the single-copy
risk; `legacy/` keeps the proven shell drivers byte-adjusted.

**Sibling tools (no overlap):**
- `tools/golden-journey-harness` — drives the core UI journey and classifies
  failures into six *components*.
- `tools/orchestrator-eval` — offline, CI-able regression gate for the
  orchestrator *prompt* (single-call adapter, no pipeline).
- **this tool** — live full-pipeline *conversation* dims + capture-layer
  localization (the integration counterpart both of the above cite).

## Architecture: dual mode

| | Hermetic arm (primary) | Staging mode |
|---|---|---|
| CEE | local server from this checkout (`arm/boot-arm.sh`) | `https://cee-staging.onrender.com` |
| Prompts | local FILE store (`arm/pms-file-shim.mjs` — **zero PMS writes**) | staging PMS (whatever is served) |
| Sessions / PLoT / ISL | staging (per sourced env files) | staging |
| Trace | `CEE_DIAGNOSTIC_TRACE_ENABLED=true` freely | whatever staging serves |
| When | default for all harness work | one smoke turn to validate the client, pre-promotion smokes |

The shim is the load-bearing trick: it hides `SUPABASE_URL`/service-role during
config import (store factory picks `file`), restores them before `listen()`
(sessions still use staging Supabase). No repo change, no PMS write.

## Directory map

```
runner.mjs               v0 journey runner (persistence, L0 hooks, manifest,
                         conditional consent turns, concurrent duplicates)
prompt-eval.sh           turnkey prompt A/B (1.70 v1): build baseline + candidate
                         stores, boot both arms, drive N paired reruns, verdict
l0-snapshot.mjs          L0 DB ground-truth snapshot (turns/facts/graph-sha/brief/decision_records)
config-manifest.mjs      per-run config snapshot (served prompt sent_hash, deploy SHAs, flags)
scorer/dims.ts           v0 property-based dims (pure, self-tested)
scorer/prompt-dims.ts    prompt-quality dims (1.70 v1): comparable scalars for A/B
scorer/score-run.ts      per-run scorer — imports PRODUCTION guards from src/ (never copies)
scorer/ab-verdict.ts     A/B verdict (1.70 v1): baseline vs candidate deltas + call
                         (RANKING — use on the ITERATION partition only)
scorer/holdout.ts        deterministic seeded iteration/holdout split + structural
                         isolation (Wave1-L3) — see "Promotion gate" below
scorer/gate-dims.ts      G1-G7 promotion gate dims with explicit floors (Wave1-L3)
scorer/promotion-verdict.ts  THE promotion entrypoint (Wave1-L3): candidate vs
                         baseline on the HOLDOUT -> machine-readable pass/fail
scorer/unsupported-claim-adapter.ts  G5's checker — imports the PRODUCTION
                         coaching-output-postcheck (never copies its patterns)
scorer/llm-judge.ts      OPT-IN rubric LLM-judge (1.70 v1): specificity/actionability/
                         depth/no-filler, N reruns, mean+variance delta (live model)
scorer/localize.ts       localization reporter v0
journeys/                journey-v2 + frozen journeys (proven) + scenarios s1–s5 (new)
fixtures/                frozen-graph.json + frozen-brief.txt (deterministic analysed state)
arm/                     hermetic-arm boot: boot-arm.sh, pms-file-shim.mjs, build-stores.py,
                         make-candidate-store.mjs (A/B swap primitive — pure JSON patch)
staging/                 seed-frozen-scenario.py, delete-scenarios.py (reserved-id denylist)
legacy/                  proven run-arm.sh / run-frozen-arm.sh (path-adjusted, reference)
__tests__/               scorer self-tests (*.harness-test.ts — see Gates)
runs/                    run dirs (gitignored; runs/sample-redacted/ documents the format)
```

## Run-dir format (v0)

```
runs/<arm>/
  journey.json            copy of the journey (self-containment)
  scenario-id.txt         the scenario this run drove (cleanup reconciles by THIS id)
  manifest.json           config manifest (see below)
  run-log.txt             human-readable progress log (truncated at run start)
  turns/<TURN_ID>/
    request.json          exact POST payload sent
    wire.json             FULL response envelope
    trace.json            _diagnostic_trace when present on the envelope
    meta.json             started_at, wall_clock_ms, http_status, class hint,
                          edit_intent / only_if / skipped / duplicate_of
  turns/<TURN_ID>-dup/    the concurrent duplicate's captures (S5)
  l0/<seq>-<TURN_ID>.json L0 snapshots per turn boundary (+ 00-baseline), --l0 only
  scores.json / scores.md         scorer output (rows + dims)
  localization.json / localization.md  layer localization of failing dims
```

The scorer also reads the **legacy** flat layout (`<ID>.json` + `run-log.txt`)
so historical workstream runs remain scoreable.

## Dims (property-based — NEVER exact-text)

| Dim | What it measures | Verdict mode |
|---|---|---|
| D1 chip-no-repeat | SEMANTIC chip set (normalised label + action family — ids excluded, regenerated ids can't evade) Jaccard vs previous K=3 turns; fails on the FIRST unwanted repeat; repeated PURE consent sets (apply/cancel while held) are reported, not failed | pass/fail, flaky (N=3 majority) |
| D2 chip-presence-per-question-class | either/or + enumerated-choice regex on `assistant_text` → ≥2 `suggested_actions` on the SAME envelope **bound to the STATED alternatives** (each extracted alternative needs a chip with ≥1 shared content token; falls back to the count floor when alternatives aren't extractable) | pass/fail, flaky |
| D3 question budget | `?` count per turn class | **BASELINE-LOG** until 2.47(b) lands budgets |
| D4 brevity (kept) | words vs ~130 budget on coach turns | advisory |
| D8 latency budgets | wall_clock_ms vs coach≤30s / edit≤25s / run_analysis≤25s / draft≤75s; slowest substages from trace | **ADVISORY** |
| D9 consent friction | consent turns + seconds from edit-intent to applied-in-DB (L0 graph-sha series) | **LOG** — the tunable-auto-apply lane is changing consent counts; measure, don't assume |
| D10-api re-click safety | duplicate run_analysis mid-flight → single fact-commit set via L0 diff; payload shas are VOLATILE-NORMALISED (computed_at / request ids stripped before hashing) AND the window must add ≤1 analysis-class fact (count assertion — sha-divergent double executions can't evade) | pass/fail |
| D11 production guards (kept) | forbidden phrases, success claims, held-science vocabulary, mutation language, structural success claims — mutation/structural claims CONDITIONED on turn class + the L0 mutation oracle: a proven applied-edit receipt is excused (disclosed in details), a claim with no commit still fails. With NO L0 oracle (no `--l0`), an edit-flow receipt is excused ONLY when a `held_proposal` / apply-consent chip makes it legitimately ambiguous (and PQ6 re-catches it); a BARE unverifiable receipt FIRES (fail-closed) | pass/fail |

Guard modules are **imported from `src/`** (`compose/forbidden-user-facing-phrases.ts`,
`routing/mutation-language.ts`) — never copied; copies drift (the workstream's
`scoring/` extracts already had).

Flaky dims: run the same journey as 3 arms, then
`RERUN_DIRS=runs/a,runs/b,runs/c … score-run.ts` → majority verdict in
`scores-aggregate.json`.

## Localization v0 honesty rules

- v0 captures wire / trace / L0-db. **The display layer is never captured** —
  any failure that needs it is `UNMEASURABLE`, never green.
- Example (D2): chips absent in wire → composition-or-prompt (CEE side); chips
  present in wire → display-layer suspect, which v0 marks UNMEASURABLE.
- The full decision tree is v1 scope.

## How to run (hermetic arm, end-to-end)

```bash
# 0. one-time env: .env + .env.staging.local at the repo root (never committed),
#    and a real staging-parity.env next to this README (see "Staging parity").
cd tools/conversation-harness

# 1. build the prompt store (read-only staging PMS mirror; ~23 rows byte-exact)
python3 arm/build-stores.py                      # -> stores/staging-mirror.json

# 2. boot the arm (from the repo checkout; logs to arm.log)
STORE=$PWD/stores/staging-mirror.json PORT=3103 ./arm/boot-arm.sh $PWD/arm.log &
grep -m1 'file-PMS boot complete' <(tail -f $PWD/arm.log)   # wait for boot

# 3. seed a frozen scenario (guest, disposable) and capture the id
SCEN=$(python3 staging/seed-frozen-scenario.py --title-prefix harness_v0_)

# 4. run a scenario journey with L0 snapshots
OLUMI_ASSIST_KEY=<assist key> node runner.mjs \
  --journey journeys/s3-option-question-probe.json \
  --arm s3-demo --base http://localhost:3103 --scenario $SCEN --l0 \
  --flags-env staging-parity.env

# 5. score + localize
RUN_DIR=runs/s3-demo pnpm exec tsx scorer/score-run.ts
RUN_DIR=runs/s3-demo pnpm exec tsx scorer/localize.ts

# 6. clean up (dry-run first — reserved ids are hard-blocked)
python3 staging/delete-scenarios.py $SCEN
python3 staging/delete-scenarios.py --execute $SCEN
```

Scenario journeys: `s1` edit-tweak loop · `s2` add-factor multi-turn ·
`s3` option-question probe · `s4` post-draft framing (fresh scenario — omit
`--scenario`) · `s5` rapid re-click (`--l0` required for D10).

## Prompt A/B evaluation (ROADMAP 1.70 v1)

The instrument for finding a better prompt on **evidence**: swap ONE PMS prompt
candidate into the hermetic arm, drive a fixed scenario set against both the
current (baseline) prompt and the candidate on the **same** frozen graph / seed /
flags, score prompt-quality dims, and emit a per-dim baseline-vs-candidate
verdict artifact. It builds on the v0 substrate — same runner, same run-dir
capture, same production guards imported from `src/`. It writes ZERO to PMS and
promotes NOTHING; it produces the evidence the orchestrator promotes on.

### The swap (fair-A/B primitive)

`arm/make-candidate-store.mjs` derives a candidate store from an already-built
baseline (`stores/staging-mirror.json`) by a **pure JSON patch** — it replaces
exactly one task's served content with the candidate file and leaves every other
byte identical. That byte-identical baseline is the only fair basis for an A/B;
deriving the candidate by patch (rather than re-fetching staging) also needs no
Supabase creds and cannot drift mid-experiment. The task matches by store key OR
`taskId`, so `orchestrator_default`, `decision_review`, `clarify_brief`, … all
resolve. It prints the expected on-wire `prompt_hash` so you can confirm the
candidate is actually being served against the run `manifest.json` `sent_hash`.

### Prompt-quality dims (`scorer/prompt-dims.ts`)

Where the v0 dims answer "does this run pass?", these yield a **comparable scalar
with a direction** so `ab-verdict.ts` can diff baseline vs candidate. Same rule as
v0: property-based, NEVER exact-text. `value = null` = not measurable this run
(excluded from the call, never scored as good).

| Dim | Direction | Catches | Gating? |
|---|---|---|---|
| PQ1 brevity-density | lower-better | verbosity — mean coach-turn words (+ sentence length, bullet ratio) | no |
| PQ2 question-asking | **neutral** | question count / post-draft framing question (good for clarify, bad for terse coach — reported, not scored) | no |
| PQ3 grounding | higher-better | coaching whose claims **trace to the analysis payload** — a cited % must match a real win-% / percentile (±1); a fabricated number is not grounding (`traceableNumberFraction` in details is the fabrication detector) | no |
| PQ4 chip-correctness | higher-better | chips present on either/or + enumerated question turns; identical-repeat penalty (details) | no |
| PQ5 guard-cleanliness | lower-better | forbidden phrase / success claim / held-science / mutation-language / structural-success VIOLATIONS (the imported `src/` guards, turn-class + L0-outcome conditioned — a proven applied-edit receipt is excused, disclosed in `excusedReceipts`; with NO oracle a receipt is excused only when a `held_proposal`/apply-consent chip makes it ambiguous, else it FIRES fail-closed) | **yes** |
| PQ6 coherence | lower-better | cross-surface / cross-fragment contradiction: says "done" while a proposal is still held; claims a mutation then asks to apply; names a winner the blocks contradict; **a prose % attributed to an option that disagrees with that option's payload win-%** | **yes** |

A **gating** regression (PQ5 or PQ6) caps the overall verdict at *worse* no matter
how many other dims improved — introducing a forbidden phrase, or making the coach
name the wrong winner, is disqualifying. `score-run.ts` emits these as the
`prompt_dims` block of `scores.json`.

**PQ3 vs PQ6 — grounding vs attribution.** They are complementary and both
property-based: PQ3 asks *did this number come from the analysis at all* (lenient
— win-% **and** percentiles count as payload figures), PQ6 asks *is the number
correctly attributed* (strict — a win-% claim must match `win_probabilities`). A
coach that quotes `55%` when the payload has a `54%` percentile is grounded (PQ3)
but, if it attributes that `55%` to the leading option whose true win-% is `78%`,
PQ6 flags a `number-disagrees-with-payload` contradiction. PQ6's numeric check is
the **fragment-contradiction detector the decision_review DECOMPOSITION (B1)
needs** — when one call becomes four parallel fragments (headline / driver-bite /
fragility / calibration), a number a monolith kept implicitly consistent can
silently diverge; this dim catches it.

### LLM-judge (opt-in — `scorer/llm-judge.ts`)

Property dims can't judge *is the coaching actually better*. The LLM-judge scores
each coach turn on a rubric — **specificity, actionability, coaching_depth,
no_generic_filler** (1–5 each) — independently per side (no position bias), N≥3
times, and reports per-criterion + overall **mean and variance** deltas with a
better/worse/mixed call. A delta counts only if it clears the combined rerun
stdev (so a swing inside judge variance reads as flat). It makes **live model
calls** (default `claude-opus-4-8`), so it is **opt-in and not part of the default
hermetic pipeline**:

```bash
LLM_JUDGE=1 BASELINE_DIR=runs/base-1 CANDIDATE_DIR=runs/cand-1 \
  pnpm exec tsx scorer/llm-judge.ts   # -> runs/cand-1/llm-judge.json
```

The prompt-building, response parsing, and mean/variance aggregation are pure and
self-tested; only the thin model-call wrapper needs credentials (`ANTHROPIC_API_KEY`
or an `ant` profile).

**Grounding + pairing (judge-honesty fixes):** each judged message is scored WITH
the turn's own payload facts (options, win-%, leading option, HELD state —
rendered by `factsFromSurfaces` from the run's wire captures) threaded into the
judge prompt, so fabricated specificity is penalised instead of rewarded; and only
turns present on BOTH sides are judged (`pairTurns` — corresponding-turn pairing),
so an aborted side can't skew the comparison. `llm-judge.json` records
`paired_turns`, the unpaired leftovers, and `grounded_with_payload_facts`.

### Verdict + flakiness (`scorer/ab-verdict.ts`)

Reads the `prompt_dims` from each side's `scores.json`, diffs per dim, and writes
`ab-verdict.json` + `ab-verdict.md` with `better` / `worse` / `mixed` /
`no-change` / `inconclusive`. Live-model nondeterminism is handled explicitly:

- **N≥3 reruns per side.** Flaky quality dims (PQ1–PQ4, OPS-*) aggregate by **median**
  across a side's runs; the **safety** dims (PQ5 guard-cleanliness, PQ6 coherence)
  aggregate by **worst-run (any-hit / any-contradiction)** — a guard hit or a
  contradiction in even one rerun gates and is never averaged (or medianed) below
  the noise floor. The worst-run mode is derived from the dim's **own** safety
  semantics (and either side's `safety` flag), NOT solely the baseline template —
  so a REUSED pre-flag baseline artifact can't silently force median and disable
  the worst-run gate. One run per side is allowed but the artifact is stamped
  `low_confidence`.
- **Noise floor.** A dim is only called improved/regressed when
  `|candidate − baseline|` clears a per-dim threshold (recorded in the artifact);
  smaller moves are `flat`.
- **Gating + neutral** as above: PQ5/PQ6 regressions gate; PQ2 is reported, never
  scored.
- **OPS promotion criteria.** The verdict ALSO scores three lower-better ops dims
  derived from each run's own rows: `OPS-latency-median` (wall-clock ms),
  `OPS-cost-tokens` (total LLM tokens in+out), `OPS-fallback-rate` (fraction of
  turns whose trace shows fallback engagement). Null-honest: absent signals are
  excluded, never read as 0 — the B1 experiment showed a candidate can win on
  PQ dims while silently regressing all three.

### Turnkey command (hermetic arm)

```bash
cd tools/conversation-harness
# baseline store once (staging-mirror; needs .env.staging.local creds), then:
OLUMI_ASSIST_KEY=<assist key> ./prompt-eval.sh \
  --task decision_review \
  --candidate candidates/decision_review.v43.txt \
  --journey journeys/s3-option-question-probe.json \
  --reruns 3
# -> runs/eval-decision_review-<timestamp>-<pid>/ab-decision_review/ab-verdict.md
```

Each eval gets a UNIQUE `runs/eval-<task>-<timestamp>-<pid>/` tree (stale turn dirs
from a previous eval can never leak into scoring), and the baseline store is
age-gated: rebuilt when older than `BASELINE_MAX_AGE_HOURS` (default 24) or when
`--refresh-baseline` is passed, parse-verified, and its sha256 + mtime recorded in
`baseline-store.txt` beside the runs.

`prompt-eval.sh` does all six steps: refresh/verify baseline store → derive candidate store
→ boot both arms (`--base-port` / `--cand-port`) → drive `--reruns` paired journeys
(a fresh frozen scenario per side/rerun when the journey needs seeding) → score
each → verdict → clean up seeded scenarios. `clarify_brief` is A/B'd the same way
with a clarify-shaped journey (e.g. `s4-post-draft-framing.json`).

### Manual / step-by-step (same primitives)

```bash
python3 arm/build-stores.py --out stores/staging-mirror.json
node arm/make-candidate-store.mjs --baseline stores/staging-mirror.json \
  --task decision_review --candidate candidates/decision_review.v43.txt \
  --out stores/cand-decision_review.json
STORE=$PWD/stores/staging-mirror.json      PORT=3103 ./arm/boot-arm.sh $PWD/arm-base.log &
STORE=$PWD/stores/cand-decision_review.json PORT=3113 ./arm/boot-arm.sh $PWD/arm-cand.log &
# ... seed a scenario per side, run runner.mjs against :3103 and :3113, score each ...
BASELINE_DIRS=runs/base-1,runs/base-2,runs/base-3 \
CANDIDATE_DIRS=runs/cand-1,runs/cand-2,runs/cand-3 \
  pnpm exec tsx scorer/ab-verdict.ts
```

## Promotion gate: may this coach prompt ship? (Wave1-L3)

`ab-verdict.ts` answers *"is A better than B?"*. That is a **ranking**, and a
ranking cannot tell you whether the winner is good enough to put in front of a
user. The promotion gate answers the other question — *"does this clear the
floor?"* — and it is the thing that stands between a candidate prompt and the
founder's manual test.

### Doctrine: the holdout is a pass/fail FLOOR, never a ranking

The scenario set is split in two:

| partition | who reads it | what for |
|---|---|---|
| **iteration** (5 scenarios) | anyone, freely | tuning, staring at transcripts, `ab-verdict` ranking |
| **holdout** (3 scenarios) | `promotion-verdict.ts` only | one pass/fail floor check per candidate |

**The holdout answers exactly one question: is this candidate good enough to
ship?** It does *not* answer "which candidate is best". The moment you rank
candidates on the holdout you have begun tuning against it — pick the best of K
on the holdout and the holdout is now training data, and its floor no longer
generalises to anything.

Two consequences, both enforced in code rather than asked for politely:

- `computePromotionVerdict` takes **exactly one candidate**. There is no
  array-of-candidates form, so best-of-K on the holdout is not expressible.
- A **failed promotion is not a signal to iterate against**. Read the failing
  dimension *name*, go back to the iteration partition, and fix that class of
  problem there. Do not open the holdout transcripts. Every look costs you some
  of the floor's meaning, and nothing tells you when it is spent.

To compare candidates: `ab-verdict.ts` on the iteration partition. Bring the
winner here, once.

### Structural exclusion (code, not convention)

`openScenarioSet('iterate')` returns a `ScenarioSet` in which holdout scenarios
**do not exist**: absent from `ids()`, and `resolve(id)` / `load(id)` throw
`HoldoutIsolationError` rather than returning a path or bytes. The mode is fixed
at construction, the instance is frozen, and there is no setter, no override
flag and no env escape hatch. An iterate-mode run has no function available to
it that yields a holdout scenario — it cannot read one by accident, by loop, or
by a well-meaning refactor.

The exclusion is **symmetric**: `'holdout'` mode cannot read iteration
scenarios either, so a promotion run cannot pad its floor with scenarios the
prompt was tuned on. That is the leak everyone forgets.

### The split is hash-bucketed, not shuffled — deliberately

A scenario's partition is a pure function of `(seed, scenarioId)` **alone**:

```ts
partitionFor(id, seed) // -> 'iteration' | 'holdout'
```

It does not depend on which other scenarios exist. Adding, renaming or deleting
a scenario **cannot** move a different scenario across the boundary.

That property is the anti-gaming one. Under the obvious alternative
(seeded-shuffle-then-take-N) every scenario's partition depends on the whole
set — so anyone who overfits the prompt to a scenario, then finds it landed in
the holdout, can add a throwaway scenario, reshuffle, and walk it back into the
iteration partition. Hash-bucketing makes that impossible: the only ways to move
scenario X are to rename X (visible in the diff — exactly the review signal we
want) or to change the seed (which invalidates every prior verdict).

The price is that holdout **size** is approximate, not an exact N.
`assertSplitIntegrity` refuses a split too small to be a floor rather than
letting a 1-scenario "holdout" quietly pass a candidate.

**Changing `DEFAULT_SPLIT_SEED` re-partitions everything and invalidates every
previously-recorded verdict.** It is a breaking change to the evidence base, not
a tuning knob.

### The gate dimensions

Each is a scored dimension with an explicit floor. Aggregation across holdout
scenarios is **worst-case, not mean**: the holdout asks "does this ever fail?",
and the honest aggregator for that is the worst case. (A mean would also let you
lift a failing candidate over the floor by padding the holdout with easy
scenarios.)

| dim | direction | floor | measures |
|---|---|---|---|
| `G1-decision-advancement` | higher | ≥ 0.6 | fraction of turns that moved the decision (L0 oracle / newly-staged proposal / genuinely new affordance) |
| `G2-dispatch-accuracy` | higher | ≥ 0.9 | declared intent vs actual state effect, both directions |
| `G3-entity-resolution` | higher | ≥ 0.9 | named entity tied to canonical state via structured output |
| `G4-canonical-state-use` | higher | = 1.0 | every stated figure traceable to the turn's payload |
| `G5-unsupported-claim` | lower | = 0 | production coaching-postcheck violations |
| `G6-dead-end` | lower | ≤ 0.1 | turns leaving no next action |
| `G7-correction-burden` | lower | ≤ 0.5 | redundant re-asks per coach turn |
| `OPS-latency-median` | lower | non-inferiority | vs baseline, within existing `NOISE_THRESHOLD` |
| `OPS-cost-tokens` | lower | non-inferiority | vs baseline; **reuses** `ab-verdict.totalTokensFromRows` (F14) |

Latency and cost have no absolute floor — "2400ms" is only good or bad relative
to what we ship today — so they are gated as **non-inferiority vs the baseline**,
using `ab-verdict`'s existing per-dim noise thresholds so rerun jitter does not
block a good prompt.

**Cost reuses the F14 accounting; it does not reimplement it.** A run is
cost-unmeasurable if *any* cost-bearing turn is incomplete — a partial total is
not a comparable total, and the F14 bug (the *less-measured* arm ranking
*cheaper*) would be at its most expensive on the promotion path, the one path
where being wrong ships a prompt. There must be exactly one answer to "what did
this run cost, and is that answer trustworthy?"

### Anti-gaming: how each dimension resists a letter-vs-intent transcript

An adversarial reviewer will try to build a transcript that satisfies the letter
of each dimension while violating its intent. Three rules, obeyed by every dim:

1. **Score state, not prose.** No dimension is satisfied by the assistant
   *saying* it did something. Advancement and dispatch are read off the L0
   mutation oracle (the DB graph sha actually moved). `"I've updated your
   model"` advances nothing. Prose is scored only where prose is the artifact
   under test (G5), and there only negatively.
2. **Silence is not a pass.** The classic gaming move is an empty transcript: no
   numbers ⇒ no untraceable numbers ⇒ "perfect" grounding. So every ratio dim is
   **UNMEASURABLE (null)** when its denominator is empty, and the verdict
   **fails on null**. A silent transcript fails; it does not ace.
3. **Repetition is not progress.** Re-offering the same chip or re-asking the
   same question scores as a dead end / correction burden, never as an
   affordance. Grounded in an observed live defect (identical chip 6× in one
   conversation). Semantic chip keys are used, so regenerated chip ids cannot
   disguise a repeat.

Specific traps worth knowing about:

- **G3 does not accept the analysis payload as evidence of resolution.** The
  payload lists *every* option on every analysed turn, so accepting it would
  auto-resolve every entity on every analysed turn — a 1.000 that means nothing.
  Evidence must be something the system could only have produced *by* resolving
  the user's specific mention — in practice a chip that NAMES the entity. Prose
  echo is string handling, not resolution — it is exactly what a model does when
  it has *not* looked anything up. A bare `held_proposal` is **not** evidence
  either: it is a staging fact with no entity attached, so it certifies nothing
  about the mention on this turn. (It granted an unconditional pass until the
  review of this lane; that was the same entity-blind free pass G3 refuses for
  the payload. A held proposal concerning the named entity still scores, via the
  chip that offers it.)
- **G4 is scored per figure, not per turn**, so one turn inventing nine numbers
  cannot hide behind eight clean turns. Only the turn's *own* payload counts — a
  number that was canonical three turns ago is a staleness leak.
- **G4 reads the whole numeric literal, and compares it rounded.** The figure
  scanner parses integers, decimals and thousands-grouped figures, anchored on
  `%` or "percent" (`62.5%` → `62.5`, not `5`). Because `payloadPercentages` is
  built with `Math.round`, the stated figure is rounded through the *same*
  function before lookup — otherwise a faithful `62.5%` restating a canonical
  `0.625` (surfaced as `63`) would score 0. This tolerates restated precision,
  never an invented value.
- **G4's extractor fails closed BY CONSTRUCTION (round 6).** After five review
  rounds each found new invisible figure shapes, extraction moved to two-layer
  anchor accounting: a deliberately dumb Layer-1 detector finds *every*
  percent-anchor token (`%`, `％`, percent / per cent / per-cent /
  percentage point(s) / pp / pct — any case, hyphen/newline-separated), and
  every Layer-1 anchor must be consumed by exactly one Layer-2 outcome (a
  traced value or an explicit `unparseable`). An unconsumed anchor counts
  untraceable — so an unknown future phrasing *blocks* instead of vanishing.
  Percentage-point figures are a distinct unit and never trace against a `%`
  canonical. See the module doc in `scorer/figure-scanner.ts` for the full
  doctrine and the deliberate calibration costs.
- **G5 is a count, not a rate**, so padding a run with silent turns cannot
  dilute a violation.
- **G2 is symmetric** — "always mutate" fails the coach direction and "never
  mutate" fails the edit direction, so there is no trivially-safe policy.
- **The floors interlock.** A prompt that avoids numbers to dodge G4 must still
  clear G1 and G6 on its own merits; a prompt that asks nothing to dodge G7 is a
  dead end under G6. No single-dimension policy clears all of them.

### Fail-closed

Every path that is not an affirmative, fully-measured pass is a **BLOCK**:

| condition | outcome |
|---|---|
| any dim null (unmeasurable) on the candidate | BLOCK |
| no unsupported-claim checker wired | BLOCK ("we did not check" ≠ clean) |
| a holdout scenario missing from either side | BLOCK |
| candidate supplies non-holdout scenarios | BLOCK |
| cost-bearing turn incomplete (F14) | BLOCK, never "cheaper" |
| mode is not `'holdout'` | throws |
| split is degenerate | throws |

`promote` is only ever `true` when every floor was affirmatively cleared on
measured data. There is no "inconclusive ⇒ ship" edge.

### Running it

```bash
# each side is a dir of per-scenario run dirs: <side>/<scenario-id>/{turns,l0,journey.json,scores.json}
# score-run.ts must have been run on each (the OPS metrics read scores.json rows)
BASELINE_RUNS=runs/base CANDIDATE_RUNS=runs/cand \
  pnpm exec tsx tools/conversation-harness/scorer/promotion-verdict.ts
```

Writes `promotion-verdict.json` + `.md` to `PROMOTION_OUT` (default:
`CANDIDATE_RUNS`). **Exits 0 only on PROMOTE, 1 on BLOCK**, so CI cannot ignore
it. The holdout ids come from the split over the real `journeys/` dir opened in
`'holdout'` mode — the CLI has no flag to widen that, by design.

**PII:** the verdict artifact carries dim names, counts and turn ids only —
never factor labels, label-derived node ids, or decision values. G5 returns the
production violation *tag* (a closed telemetry-safe enum), never prose.

## Staging-mode discipline (when you must)

1. **Quiesce**: no open canvas tab on a harness scenario — a live UI tab
   resurrects deleted rows on the same id (proven hazard). Pure-API only.
2. **Manifest first**: capture `manifest.json` before the first turn (the
   runner does this) — `sent_hash` is the only trustworthy prompt identity.
3. **Audit prefix**: seed with `--title-prefix harness_v0_…`.
4. **Cleanup**: `staging/delete-scenarios.py` dry-run → `--execute`, reconciling
   by the **captured** scenario id (never by global counts). Reserved-prefix ids
   are hard-blocked by the script.

## Env files & secrets

| File | Where | Committed? |
|---|---|---|
| `.env`, `.env.staging.local` | repo root | never (repo .gitignore) |
| `staging-parity.env` | this dir | **never** — `.gitignore`d; commit only `staging-parity.env.example` (names only) |
| `stores/*.json` | this dir | never — mirrors served prompt content |
| `runs/*` | this dir | never — may embed staging payloads; only `runs/sample-redacted/` is committed |

To rebuild `staging-parity.env` values: copy a colleague's local copy, or read
the cee-staging Render env (Render API, paginate with `cursor`; >100 vars) and
keep **only** the non-secret flag/model keys listed in the example file.
Credentials are read from env files at runtime and are never printed by any
script here.

## Gates

- **Typecheck (Wave1-L3): `pnpm harness:typecheck`.** `tsconfig.build.json`
  includes `src/**` only, and the root `tsconfig.json` includes `src`, `tests`,
  `*.config.ts` and `sdk` — `tools/**` appears in NEITHER, and vitest runs this
  code through esbuild (types stripped, never checked). So until Wave1-L3 a type
  error in `scorer/` could not fail any gate. `tsconfig.json` in this directory
  closes that for the harness; it is verified by injecting a deliberate type
  error and confirming the new gate fails while both repo gates stay green.
  ```bash
  pnpm harness:typecheck   # tsc -p tools/conversation-harness/tsconfig.json --noEmit
  pnpm harness:test        # vitest run --config tools/conversation-harness/vitest.config.ts
  ```
  The rest of `tools/**` remains outside any typecheck gate — out of this lane's
  scope, but worth a lane of its own.
- `test:required` DOES collect `tools/**` test globs, so the self-tests are
  named `*.harness-test.ts` (not collected by `**/*.{test,spec}.*`) and run via
  their own config — deliberately NOT wired into the required gate:
  ```bash
  pnpm exec vitest run --config tools/conversation-harness/vitest.config.ts
  ```
- **Test-file naming is load-bearing — do NOT create `*.test.ts` / `*.spec.ts`
  under this directory.** The repo-root required gate (`vitest.required.config.ts`)
  collects the default `**/*.{test,spec}.*` glob and does **not** exclude
  `tools/conversation-harness/**` (unlike `tools/graph-evaluator/**`, which is
  package-excluded there). A stray `*.test.ts` here would be pulled into the
  product gate — where it would import `src/` guards and try to reach live
  services. This lane is path-restricted to `tools/conversation-harness/**`, so
  the convention is enforced from inside the harness rather than by editing the
  root config: `__tests__/no-stray-test-files.harness-test.ts` FAILS the local
  suite if any `*.test.ts` / `*.spec.ts` appears here. If a repo-root-gate test is
  ever genuinely wanted, add an explicit path exclusion to
  `vitest.required.config.ts` from a lane that owns the repo root.

## Residuals for v1

- Full localization decision tree (v0 ships single-hop rules + honest gaps).
- Display-layer capture (browser) — until then display verdicts are UNMEASURABLE.
- D3 pass/fail budgets once 2.47(b) ratifies them; D9 pass/fail once the
  tunable-auto-apply consent model settles.
- S6 scenario (partial in the ratified design; not specified in the v0 brief).
- S2's "competing newer offer" binding check is measured via L0 + wire reading,
  not yet asserted as a dim.
- Substage-timing shape in `_diagnostic_trace` is read defensively
  (`substage_timings` | `timings`); confirm the emitted key once a traced arm
  run is captured and pin it.

Prompt A/B (1.70 v1):
- The overall better/worse/mixed call is a **v1 heuristic** (gating dims +
  count-of-scored-dims); it is decision support for the orchestrator, not an
  auto-promoter. Per-dim deltas are the primary evidence.
- Noise thresholds in `ab-verdict.ts` (`NOISE_THRESHOLD`) are seeded from
  judgement, not yet from a measured rerun-spread distribution — tighten them
  once a few real N≥3 arm A/Bs are captured.
- PQ6 coherence proxies are deliberately **conservative** (win-claim + numeric
  contradiction fire only when a sentence names exactly one option); they catch the
  clear cases and will miss subtly-hedged contradictions — expand as real misses
  appear. The numeric tolerance (±3 pts on win-% attribution) is a starting value.
  - **False-WORSE hardening (review-driven):** PQ6(d) compares a prose % to the
    win-% only when the sentence signals a WIN/PROBABILITY claim (cue tested with
    the option's own name stripped, so an option named "Tech Lead"/"Best Plan"
    doesn't self-trigger) AND the % isn't a non-win payload figure (a cited
    percentile is grounded, not a wrong win-%). PQ6(c) lead-sentence matching is
    negation-aware ("X is NOT the best choice" no longer false-fires). *Residual:*
    a compound sentence that mixes a genuine win cue with a non-win % (e.g. "A wins
    the sprint, cutting cost 30%") can still be compared — sentence-level cues are
    a heuristic; tighten to clause scope if real misses appear.
- PQ3 grounding traceability includes percentiles in the payload figure set
  (lenient by design — see "grounding vs attribution" above); if fabrication
  detection needs to be sharper, restrict `payloadPercentages` to the win-% set.
  - **Non-% scope (review-driven):** `traceableNumberFraction` is a **%-only**
    fabrication detector. A non-% number (£100k, 3×) cannot be traced against the
    %-only payload surface, so when payload is present it no longer counts as
    grounding (`untraceableNonPctNumbers` in the per-turn details); **do not read a
    non-% figure as verified grounding.** True numeric tracing would need raw
    payload magnitudes surfaced in `TurnSurfaces` — a v1 extension.
- The **LLM-judge is opt-in and was NOT run live in this lane** (needs credentials
  + live calls); its pure logic is self-tested and it is not wired into the default
  `ab-verdict`. Wiring it into the verdict as an additional (non-gating) signal is a
  v1.1 follow-up.
- The prompt-eval pipeline (`score-run` → `ab-verdict`) is proven end-to-end on the
  redacted sample run (incl. the payload-traceable grounding + B1 numeric
  fragment-contradiction detector on real ISL payload); a **live hermetic-arm A/B**
  additionally needs `staging-parity.env` + a built store and was not run here.
