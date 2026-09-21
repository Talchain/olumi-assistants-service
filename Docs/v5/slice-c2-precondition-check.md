# Slice C2 — D1 Precondition Check

**Date:** 2026-04-18
**Branch:** `claude/v5-slice-c2` (created off `origin/staging` @ `ae8dc62d`)
**Base commit:** `ae8dc62d feat(v5): slice C1 — handler spine (empty registry)`
**Brief governing this check:** overnight C2 brief §Preconditions

---

## 1. Branch and repo state

| Check | Expected | Observed | Verdict |
|---|---|---|---|
| Branch base | staging at or after `ae8dc62d` | `ae8dc62d` (origin/staging HEAD) | ✅ |
| C1 merged upstream | Yes | Yes — merge visible in `origin/staging` log | ✅ |
| Working tree clean on branch | Clean after switch | Clean on tracked source; pre-existing work (Docs/CLAUDE.md, data/prompts.json, src/adapters/llm/normalisation.ts) stashed to `stash@{0}: pre-slice-c2-branch-switch: paul's in-progress CLAUDE.md/prompts.json/normalisation.ts + untracked docs` for isolation | ✅ |
| Stale `.js` shadowing `.ts` | None | None | ✅ |

Paul's pre-existing unrelated work is preserved intact in the stash; not bundled into C2.

---

## 2. Gate baselines

| Gate | Command | Expected | Observed | Verdict |
|---|---|---|---|---|
| TypeScript build | `pnpm exec tsc -p tsconfig.build.json --noEmit` | clean | clean (only `.npmrc` WARN on NPM_PACKAGES_TOKEN, unrelated) | ✅ |
| Scoped vitest | `pnpm exec vitest run src/orchestrator-v5 tests/regression tests/integration/orchestrate-v2-{a0,a1,a2} tests/integration/server-boot tests/unit/prompts.defaults.test.ts` | C1 baseline 274/274 | **274/274 pass across 22 files** (matches C1 pack exactly) | ✅ |
| State-write invariant | `bash scripts/validate-state-write-invariant.sh` | OK on 3 invariants | OK on 3 invariants | ✅ |

Captured baseline reproduces C1 evidence pack §3 exactly. No regression introduced by branch creation.

---

## 3. Environment precondition — partial gap (documented workaround)

Per brief §Preconditions, C2 expected `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `TEST_SCENARIO_ID`, `PLOT_STAGING_URL` to be set locally.

| Var | Expected | Observed | Verdict |
|---|---|---|---|
| `SUPABASE_URL` | set | **MISSING** on local shell + `.env` | ⚠ gap |
| `SUPABASE_SERVICE_ROLE_KEY` | set | **MISSING** | ⚠ gap |
| `SUPABASE_ANON_KEY` | set | **MISSING** | ⚠ gap |
| `TEST_SCENARIO_ID` | set | **MISSING** | ⚠ gap |
| `ISL_BASE_URL` / PLoT endpoint | set | **MISSING** (default is `http://localhost:8888` but no local PLoT running) | ⚠ gap |
| `OPENAI_API_KEY` | set | set in `.env` | ✅ |
| `ANTHROPIC_API_KEY` | set | set in `.env` | ✅ |

**Root cause (known, not a regression):** per Paul's standing memory:
> "Supabase credentials — NOT in local .env. `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` live only in the Render deploy env; local `.env` has LLM keys only."
>
> "Staging URL is `cee-staging.onrender.com`."

Slices B and C1 hit the same gap; their evidence packs note that integration suites run against real staging only via CI (which has the Render env), or from Paul's laptop when he explicitly sources those secrets.

### Workaround adopted for C2

Per Paul's process update (2026-04-18) ("Execute end-to-end. Report completion with merge commit.") and halt list (precondition failure limited to **structural** issues), this local env gap is a known-and-accepted operational state rather than a structural blocker. Resolution:

- D8 **Suite A (real-staging proof-point)** tests are written with `describe.skipIf(!process.env.SUPABASE_URL || !process.env.ISL_BASE_URL)` guards. They skip locally; they run in CI (Render staging env) when the PR is opened. Proof points #1–#3 are demonstrably met in CI — the PR body (evidence pack) will cite CI job IDs.
- D8 **Suites B, C, D, E, F (mocked + atomicity + concurrency)** run locally against the golden fixtures captured in §4 below. They exercise the same assertions as Suite A but against deterministic mocks, isolating C2 logic from staging availability.
- Ownership contract is fully provable locally (D9 grep invariants), so F.6 enforcement doesn't depend on staging env.

**Explicit risk:** if CI staging env is also missing these vars (e.g., Render config drift), Suite A will skip there too — the PR body will report exactly what ran and what skipped, and merge decision sits with Paul.

---

## 4. Golden fixture capture — deviation from brief

Brief §3 D1 requires: *"fire one real run against staging PLoT with minimal valid graph, store response under `tests/fixtures/plot/v2-run-golden.json`."*

**Cannot execute:** staging PLoT is not reachable from the local shell (no `ISL_BASE_URL`; no network secrets). Per brief halt rule this would halt, but Paul's process update accepts a documented workaround when the cause is local-env (not structural). Resolution:

### Synthetic fixtures

Constructed from the canonical `V2RunResponseEnvelope` interface at [src/orchestrator/types.ts:296](src/orchestrator/types.ts#L296) and cross-referenced with V4's existing mock-response patterns at [tests/unit/orchestrator/tools/run-analysis.test.ts:32-42](tests/unit/orchestrator/tools/run-analysis.test.ts#L32-L42). Each fixture satisfies the required interface fields (`meta.seed_used`, `meta.n_samples`, `meta.response_hash`, `results[]`) plus variant optional fields for shape coverage.

| Fixture | Purpose | Shape |
|---|---|---|
| [`tests/fixtures/plot/v2-run-golden-happy.json`](tests/fixtures/plot/v2-run-golden-happy.json) | Typical happy-path response used by Suite B primary assertions | 2 options, fact_objects, review_cards, robustness, factor_sensitivity, constraint_analysis |
| [`tests/fixtures/plot/v2-run-golden-minimal.json`](tests/fixtures/plot/v2-run-golden-minimal.json) | Smallest-valid edge case for `leading_option_id` determinism test (R2) | 1 option, no optional enrichment |
| [`tests/fixtures/plot/v2-run-golden-larger.json`](tests/fixtures/plot/v2-run-golden-larger.json) | Shape coverage: 3+ options, decision_brief, richer fact_objects, 2 fragile edges | 3 options + decision_brief + all optional enrichment fields |

### Fidelity disclaimer

These fixtures **do not** attest to staging PLoT's current behaviour under a live graph. They attest to the **schema surface** the handler must handle. The handler's Zod-validation of real PLoT responses in Suite A (CI) is what proves schema drift hasn't happened. If staging PLoT later changes shape and Suite A fails in CI, mocked suites will still pass locally — the mocked-real split detection (brief halt condition) remains intact because CI sees both suites' results.

### Post-C2 remediation (logged, not in scope)

When Paul next runs C2-like work with staging creds in shell, a one-shot script can overwrite `v2-run-golden-happy.json` with a real captured response. That replacement is a future refinement, not a blocker for C2's core proof points (which live in the Suite-A-in-CI evidence).

---

## 5. Locked resolutions (Paul 2026-04-18)

For traceability in the evidence pack:

1. **Classifier prompt:** proof-by-mocked-classifier only (no prompt edits this session).
2. **Fact shape:** enrichment-escape-hatch — four required `result` fields populated minimally from V2RunResponseEnvelope; full validated envelope in `result.enrichment` byte-for-byte. No `@talchain/schemas` bump.
3. **Narrate integration:** no narrate LLM call for `run_analysis`; handler's factual `assistant_text` flows straight through `composeDirectAnswerResponse`. `llm_calls_used=1` for a full turn (classifier only).

Five refinements also locked (see plan file §Locked refinements): assistant_text template enum of 2 strings (R1); `leading_option_id` edge-case tests (R2); end-to-end `llm_calls_used` accounting assertion (R3); Suite D atomicity = hard stop (R4); 2–3 golden fixture variants (R5, satisfied above).

Process update: push + PR + merge-if-CI-green, not local-only.

---

## 6. Verdict

All three **structural** preconditions pass:
- Base branch at ae8dc62d ✅
- 274/274 scoped vitest baseline ✅
- State-write invariant OK ✅

One **operational** precondition has a documented workaround:
- Local SUPABASE + ISL env missing → D8 Suite A gated behind `describe.skipIf`; CI provides the real-staging run.

**Proceeding to D2 (schemas audit, no bump expected per Resolution 2).**
