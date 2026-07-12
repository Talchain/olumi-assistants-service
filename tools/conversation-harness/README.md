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
| D1 chip-no-repeat | chip id+label set Jaccard vs previous K=3 turns | pass/fail, flaky (N=3 majority) |
| D2 chip-presence-per-question-class | either/or + enumerated-choice regex on `assistant_text` → ≥2 `suggested_actions` on the SAME envelope | pass/fail, flaky |
| D3 question budget | `?` count per turn class | **BASELINE-LOG** until 2.47(b) lands budgets |
| D4 brevity (kept) | words vs ~130 budget on coach turns | advisory |
| D8 latency budgets | wall_clock_ms vs coach≤30s / edit≤25s / run_analysis≤25s / draft≤75s; slowest substages from trace | **ADVISORY** |
| D9 consent friction | consent turns + seconds from edit-intent to applied-in-DB (L0 graph-sha series) | **LOG** — the tunable-auto-apply lane is changing consent counts; measure, don't assume |
| D10-api re-click safety | duplicate run_analysis mid-flight → single fact-commit set via L0 diff (frozen graph ⇒ double-execution is payload-sha identical) | pass/fail |
| D11 production guards (kept) | forbidden phrases, success claims, held-science vocabulary, mutation language, structural success claims | pass/fail |

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
| PQ3 grounding | higher-better | coaching that cites specific numbers / named graph options vs generic prose | no |
| PQ4 chip-correctness | higher-better | chips present on either/or + enumerated question turns; identical-repeat penalty (details) | no |
| PQ5 guard-cleanliness | lower-better | forbidden phrase / success claim / held-science / mutation-language / structural-success hits (the imported `src/` guards) | **yes** |
| PQ6 coherence | lower-better | cross-surface contradiction: says "done" while a proposal is still held; claims a mutation then asks to apply; names a winner the analysis blocks contradict | **yes** |

A **gating** regression (PQ5 or PQ6) caps the overall verdict at *worse* no matter
how many other dims improved — introducing a forbidden phrase, or making the coach
name the wrong winner, is disqualifying. `score-run.ts` emits these as the
`prompt_dims` block of `scores.json`.

### Verdict + flakiness (`scorer/ab-verdict.ts`)

Reads the `prompt_dims` from each side's `scores.json`, diffs per dim, and writes
`ab-verdict.json` + `ab-verdict.md` with `better` / `worse` / `mixed` /
`no-change` / `inconclusive`. Live-model nondeterminism is handled explicitly:

- **N≥3 reruns per side.** Flaky dims (PQ1–PQ4, PQ6) aggregate by **median** across
  a side's runs; the stable dim (PQ5) by mean. One run per side is allowed but the
  artifact is stamped `low_confidence`.
- **Noise floor.** A dim is only called improved/regressed when
  `|candidate − baseline|` clears a per-dim threshold (recorded in the artifact);
  smaller moves are `flat`.
- **Gating + neutral** as above: PQ5/PQ6 regressions gate; PQ2 is reported, never
  scored.

### Turnkey command (hermetic arm)

```bash
cd tools/conversation-harness
# baseline store once (staging-mirror; needs .env.staging.local creds), then:
OLUMI_ASSIST_KEY=<assist key> ./prompt-eval.sh \
  --task decision_review \
  --candidate candidates/decision_review.v43.txt \
  --journey journeys/s3-option-question-probe.json \
  --reruns 3
# -> runs/ab-decision_review/ab-verdict.md  (per-dim deltas + overall call)
```

`prompt-eval.sh` does all six steps: build baseline store → derive candidate store
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

- `tsconfig.build.json` includes `src/**` only — this directory is outside the
  build/typecheck gate (verified).
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
- PQ6 coherence proxies are deliberately **conservative** (win-claim contradiction
  fires only when a lead sentence names exactly one option); it catches the clear
  cases and will miss subtly-hedged contradictions — expand as real misses appear.
- The prompt-eval pipeline (`score-run` → `ab-verdict`) is proven end-to-end on the
  redacted sample run; a **live hermetic-arm A/B** additionally needs
  `staging-parity.env` + a built store and was not run in the build lane.
