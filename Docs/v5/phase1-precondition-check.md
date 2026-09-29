# V5 Phase 1 — Precondition check

**Date:** 2026-04-19
**Branch created:** `claude/v5-phase1-tool-use` (from `staging` @ `eca0c549`)
**Verdict:** **PROCEED** — environment limitations noted below are compatible with mocked-LLM Phase 1 work.

---

## 1. Git state

- Branch at dispatch: `staging`
- HEAD: `eca0c549` — feat(v5): slice C2 follow-up
- Working tree: untracked files only (docs, tools, tmp artefacts, `.claude/`, `node_modules/.bin` timestamp-only touches). No source file modifications.
- Last five commits confirmed:
  - `eca0c549` feat(v5): slice C2 follow-up — decouple handler errors + schema-seam test + placeholder-reader guard (#144)
  - `3ccca3d3` feat(v5): slice C2 — run_analysis handler (first real handler) (#143)
  - `ae8dc62d` feat(v5): slice C1 — handler spine (empty registry)
  - `08714098` v5 slice B: session persistence layer (#140)
  - `a08f651a` docs(v5): evidence pack §3.1 — surface SQL review's 3 non-blocking observations

Branch `claude/v5-phase1-tool-use` created and checked out.

## 2. Environment variables

| Var | Status |
|---|---|
| `SUPABASE_URL` | **NOT SET** |
| `SUPABASE_SERVICE_ROLE_KEY` | **NOT SET** |
| `TEST_SCENARIO_ID` | **NOT SET** |
| `ANTHROPIC_API_KEY` | **NOT SET** |

**Impact:** Tests dependent on real Supabase or Anthropic API (`tests/integration/slice-b-preflight.test.ts`, certain route-level tests) fail as they do pre-dispatch. Phase 1 unit + integration tests mock the LLM router seam (`vi.mock('src/adapters/llm/router.js')`) and the session store (`vi.mock('session/index.js')`), so absence of keys does not impede Phase 1 work. Observation — not a halt condition per brief §6.

## 3. Anthropic SDK support

- Version: `@anthropic-ai/sdk@0.68.0`
- `tools` parameter supported: **yes**. Existing helper `chatWithToolsAnthropic` at [src/adapters/llm/anthropic.ts:2558](src/adapters/llm/anthropic.ts#L2558). Accepts `tool_choice: 'auto' | 'any' | 'tool'` (line 2517). No SDK bump required.

## 4. Baseline capture

**Typecheck:** `pnpm exec tsc -p tsconfig.build.json --noEmit` passes silently (npmrc warnings only, cosmetic).

**Test run:** `pnpm exec vitest run src/orchestrator-v5 tests/regression tests/integration`

| Metric | Count |
|---|---|
| Test files total | 137 |
| Test files passed | 110 |
| Test files failed | 4 |
| Test files skipped | 23 |
| Tests total | 1305 |
| Tests passed | 1159 |
| Tests failed | 19 |
| Tests skipped | 127 |
| Duration | 18.89s |

**Pre-existing failure inventory (baseline — must match post-refactor):**

| File | Failures | Root cause |
|---|---|---|
| `tests/integration/slice-b-preflight.test.ts` | 1 (suite-level) | Missing `SUPABASE_URL` env. Environment dependency. |
| `tests/integration/orchestrate-v2.test.ts` | 1 | V5 flag-ON fixture returns `INTERNAL_ERROR` — environment-dependent (likely classifier LLM). |
| `tests/integration/orchestrator/route-v2-flag.test.ts` | 2 | HTTP 500 in V2 flag route — LLM adapter not configured. |
| `tests/integration/orchestrator/route.test.ts` | 15 | HTTP 500 / null turn_plan — LLM adapter / deterministic router not configured. |

All 19 failures appear environment-related, not code-related. Phase 1 acceptance criterion (§8 of brief): **delta ≥0 new tests**, **no new failures beyond baseline**, **skip count unchanged**.

**Baseline artefact:** `/tmp/pre-phase1-baseline.txt` (tail) + `/tmp/pre-phase1-baseline-full.txt` (full output).

## 5. Invariant scripts

| Script | Result |
|---|---|
| `scripts/validate-state-write-invariant.sh` | **PASS** |
| `scripts/validate-handler-ownership.sh` | **PASS** |

## 6. Conclusion

All precondition checks pass. Environment-dependent integration tests fail as pre-existing baseline; Phase 1 will not regress these further. Proceeding to D2 — context pack assembler.
