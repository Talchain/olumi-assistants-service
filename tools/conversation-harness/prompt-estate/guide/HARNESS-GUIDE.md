# A/B Harness + Eval-Pack Reuse Guide (handover to the orchestrator eval-pack lane)

**From:** orchestrator-prompt workstream · **2026-07-08** · **Purpose:** so the `tools/orchestrator-eval` foundation REUSES this workstream's live A/B harness, fixtures, rubric and regression data rather than rebuilding them. Everything referenced lives under `GitHub/orchestrator-prompt-workstream/`.

> **PMS UPLOAD (staging_version) — see [`UPLOAD-RUNBOOK-v42.2g.md`](UPLOAD-RUNBOOK-v42.2g.md).** Unambiguous, code-derived, path-verified (GET `/admin/prompts/orchestrator_default` → 401 = exists+auth-gated). Prompt id `orchestrator_default`; base `https://cee-staging.onrender.com`; `x-admin-key` auth; `POST …/versions` (create) → `PATCH …` `{stagingVersion:N}` (pin) → verify served `sent_hash`. Records a revert anchor first. The runbook is templated for v42.2g but the mechanism is general (swap the content file + changeNote for any future prompt).

## 1. Two complementary test surfaces — keep both

| | **Live A/B harness (this workstream, exists)** | **Offline eval pack (`tools/orchestrator-eval`, being built)** |
|---|---|---|
| Fidelity | FULL live pipeline (real CEE at the staging tip, staging models/flags, staging Supabase sessions) | Adapter mirroring `route-with-tool-use.ts` assembly; single LLM call, no pipeline |
| Speed / CI | Slow (~6 min/25-turn arm), needs a worktree; not CI-able | Fast, deterministic, CI-able; the standing regression gate |
| Best for | Integration truth: dispatch paths, guards firing, deterministic intercepts, goal-fit pack wiring | Per-turn prompt-behaviour scoring across many fixtures/regimes |
| Verdict | Keep for pre-promotion smokes | Build as the gate |

They are not redundant: the live harness caught things the offline adapter cannot (the goal-fit pack conflation only manifests through the real projection; the `staging_version` no-op; the truncation compose bug). Recommend the eval pack cites the live harness as the integration counterpart.

## 2. Where the live A/B harness lives (path, not a branch)

All in `orchestrator-prompt-workstream/candidates/` (on-disk, never a repo branch — it drives a throwaway CEE worktree):
- `run-arm.sh` — drives `journey-v2.json` sequentially against any CEE base URL on a fresh disposable scenario; `{FACTOR}` placeholder resolves from each run's own draft.
- `boot-arm.sh` — boots a local CEE arm from a fresh worktree with staging-parity env + the file prompt store (honours `WT=` for worktree location; `STORE=` for the arm's prompt JSON; `PORT=`).
- `pms-file-shim.mjs` — the load-bearing trick: hides `SUPABASE_URL`/service-role during config import (so the store factory picks `file`, not the Supabase PMS) then restores them before `listen()` (so session storage still uses staging Supabase). Without this you cannot serve a candidate without a staging PMS write.
- `build-stores.py` — mirrors all 23 staging PMS rows byte-exact (read-only REST) into an arm store, swapping only the orchestrator row. GOTCHA baked in: Postgres timestamps fail Zod `datetime()`, so it forces strict ISO-Z `createdAt`.
- `build-v42.2{a,b,d,e,f}.py` — reproducible candidate builders (exact-match edits, assert-once, size-window + style asserts).
- `score-run.ts` — the scorer (see §4).
- `compare-runs.py` — A/B diff table + key-text dump.
- `staging-parity.env` — 90 non-secret staging Render env vars (models, flags, max_tokens).
- Full step-by-step recipe: `HANDOVER-BRIEF-I.md §5` (worktree, boot, identity-verify, run, score, clean up).

## 3. Fixtures — reuse these directly

- **`candidates/journey-v2.json`** — the 25-turn journey (20 Phase-1 baseline turns verbatim + 5 probes P21–P25). Each turn is `{id, stage, message}`. Dispatch-path class per turn is in `DISPATCH-PATH-CLASSIFICATION.md` (critical: 5 of these never reach the LLM — do not score them as prompt behaviour; the LLM-owned turns are T06/T07/T09/T10/T11/T17/T18/T20 + P21–P25).
- **Captured rich payloads for offline-fixture reconstruction** (no request-side ContextPack is recoverable anywhere — confirmed; reconstruct via the production projection code over these): `baseline/raw/T01-draft.json` (14-node graph), `T05/T15/T07/T09.json` (~18–19 KB each, full enrichment). See `EVAL-PACK-DESIGN.md §4`.
- **The goal-fit regression fixture the orchestrator asked for** — the conflation is best reproduced from: (a) pre-#371 shape = provenance-only pack (`goal_fit: {scored_from: modelled_outcome_distribution}` with NO per-option values) → correct answer must NOT state per-option target-meeting frequencies; (b) post-#371 shape = per-option `goal_fit_probability` present → correct answer MUST use them, typed as target-fit not win-share. Live-verified numbers to assert against: win 0.817 vs target-fit 0.7495/0.8255 (re-probe R03/R06), and win 0.968 vs target-fit 0.904/0.660 (smoke). Raw payloads: `candidates/runs/staging-reprobe-v42.2f/R03.json`, `runs/staging-smoke-v42.2e/T05.json`. The pass condition: win% and target-fit% are named distinctly and neither is attributed to the other.

## 4. Rubric / scorer dimensions — the production-guard-backed metrics (ruling 9)

`score-run.ts` (and `scoring/score-baseline.ts`) import the PRODUCTION guard modules byte-exact and score, per turn:
- **Deterministic guard hits (any = fail):** `findForbiddenPhraseHit`, `findSuccessClaimHit`, `HELD_SCIENCE_VOCABULARY_PATTERN`, `containsMutationLanguage`, `containsStructuralSuccessClaim`, entity-ID leak. **Add `coaching-output-postcheck.ts` (`invented_mutation_success` / `unsupported_evidence_or_confidence_claim` classes)** — the extractions in `scoring/` predate it; the eval pack must import it or P1's "zero postcheck" metric is unmeasurable.
- **Shape:** bullets, bold lead-phrase spans, paragraph count, word count (budget ~130 on coaching turns), question-mark count (≤1).
- **Grounding:** graph-label hits (labels must exist in that run's own draft — reconstruct per-fixture), number grounding vs payload, generic-filler markers.
- **Chips:** count vs D3 doctrine (≤2 default / ≤3 coaching-explanation).

Note the identity-verification discipline the eval pack must copy: **trust `sent_hash` from `routing.prompt_snapshot.built` / `v5.routing.calling_anthropic`, never the `prompt_version` field** (it lied as "v40" until #374's telemetry fix; even at the current tip, verify by hash).

## 5. Co-owned next steps (per the settled ownership model)

- Fixture-set + rubric + R-set expansion is co-owned. Proposal: the eval pack starts from `journey-v2.json`'s LLM-owned turns + the goal-fit regression fixture above, adds the brief §12 cases 9–12 (starved-pack, guard-collision, goal-fit-with-basis, chip-discipline) from `EVAL-PACK-DESIGN.md §4`, and defers the LLM judge (rubric v2) to when P3 (signal-to-move map) needs semantic scoring.
- Regime W (widened context) is now LIVE (#369/#371 deployed) — build the widened-regime fixtures from the real merged projection code, not spec.
- This workstream will supply/curate fixtures and review rubric changes on request; the orchestrator owns the code + merge.
