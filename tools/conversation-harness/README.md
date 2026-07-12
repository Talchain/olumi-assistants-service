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
l0-snapshot.mjs          L0 DB ground-truth snapshot (turns/facts/graph-sha/brief/decision_records)
config-manifest.mjs      per-run config snapshot (served prompt sent_hash, deploy SHAs, flags)
scorer/dims.ts           property-based dims (pure, self-tested)
scorer/score-run.ts      per-run scorer — imports PRODUCTION guards from src/ (never copies)
scorer/localize.ts       localization reporter v0
journeys/                journey-v2 + frozen journeys (proven) + scenarios s1–s5 (new)
fixtures/                frozen-graph.json + frozen-brief.txt (deterministic analysed state)
arm/                     hermetic-arm boot: boot-arm.sh, pms-file-shim.mjs, build-stores.py
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
  their own config — deliberately NOT wired into the required gate in this PR:
  ```bash
  pnpm exec vitest run --config tools/conversation-harness/vitest.config.ts
  ```

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
