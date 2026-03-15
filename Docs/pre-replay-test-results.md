# Pre-Replay Test Results

**Date:** 2026-03-14
**Branch:** staging
**Routing under test:** Orchestrator gpt-4.1 + cf-v16, Draft gpt-4o + v177, Edit gpt-4.1 + v3, Decision review gpt-4.1 + v13

---

## Step 1: Multi-turn Golden Paths (mock-based)

**Command:** `pnpm exec vitest run tests/integration/multi-turn-golden-paths.test.ts`

| Scenario | Turns | Result |
|---|---|---|
| A: Hiring Decision | 8 | PASS |
| B: Pricing Strategy | 6 | PASS |
| C: Recovery/Re-draft | 5 | PASS |

**Result: 3/3 passed** (all scenarios complete, 25ms total test time)

Note: The test file contains 3 stateful multi-turn scenarios (not 19 individual tests). Each scenario is a single `it()` block with sequential `executePipeline()` calls and 7-point per-turn assertions (mode, tool, stage, _route_metadata, deterministic_answer_tier, context references, loop prevention).

---

## Step 2: Staging Integration (live endpoints)

**Command:** `RUN_STAGING_SMOKE=1 PLOT_BASE_URL=https://cee-staging.onrender.com CEE_API_KEY=<key> pnpm exec vitest run --config vitest.staging.config.ts tests/staging/golden-path-staging.test.ts`

**Environment note:** Tests route through `PLOT_BASE_URL` (PLoT proxy path). The brief provided `CEE_BASE_URL` — used as `PLOT_BASE_URL` since the staging test requires PLoT routing.

### Per-step results

| Step | HTTP | Elapsed (run 1 / run 2) | Result | Issue |
|---|---|---|---|---|
| 1: Draft | 200 | 5,492ms / 19,030ms | **FAIL** | Run 1: empty blocks (no graph_patch). Run 2: graph_patch present but node count extraction = 0 (operations-format patch, not materialised nodes array) |
| 2: Edit | 200 | 3,023ms / 1,339ms | **FAIL** | `pending_proposal` returned instead of `applied_changes`. LLM proposes change but doesn't auto-apply. |
| 3: Analyse | 200 | 9,112ms / 2,558ms | **FAIL** | Run 1: `selected_tool=edit_graph` (wrong tool). Run 2: `selected_tool=null` — model says "not ready for analysis" (options lack intervention config). |
| 4: Explain | 200 | 4,095ms / 2,575ms | **PASS** | Grounded answer referencing winner. |

### Routing metadata

`_route_metadata` fields could not be fully extracted from the test diagnostic output (response bodies are truncated in assertion messages). The body snippets confirm:
- All steps returned HTTP 200
- `stage_indicator` is populated (frame → ideate → evaluate flow)
- `turn_plan` shows `selected_tool` per step

### Failure analysis

1. **Step 1 (Draft):** The LLM produces a framing/clarifying response on the first turn rather than immediately drafting a graph. When it does draft (run 2), the `graph_patch` block uses `operations` format (`add_node` ops) rather than a materialised `full_graph`. The test's node-count extraction assumes `data.full_graph.nodes[]` but the response uses `data.operations[]`. **Root cause:** Test assertion logic doesn't handle operations-format patches. Secondarily, the new prompt (v177) may be more conservative about immediate drafting.

2. **Step 2 (Edit):** The new edit routing (gpt-4.1 + v3) returns `pending_proposal` (a confirmation flow) rather than auto-applying the edit. The test expects `applied_changes` to be present directly. **Root cause:** New prompt version introduces a confirmation step for edits. Test needs updating to handle proposal flow, or the staging brief should include a confirmation follow-up turn.

3. **Step 3 (Analyse):** The model correctly identifies that the graph doesn't have configured interventions (options don't have `interventions` mapped to factors). Without interventions, `run_analysis` prerequisites fail. **Root cause:** The draft graph from Step 1 doesn't include fully configured intervention data, so analysis is not runnable. This is a test setup issue — the draft brief needs to produce a graph with complete intervention config, or the test needs to inject a fully configured graph.

### SLA compliance (where tests ran)

| Step | SLA Budget | Actual | Within SLA? |
|---|---|---|---|
| 1: Draft | 120,000ms | 5,492–19,030ms | Yes |
| 2: Edit | 30,000ms | 1,339–3,023ms | Yes |
| 3: Analyse | 140,000ms | 2,558–9,112ms | Yes |
| 4: Explain | 30,000ms | 2,575–4,095ms | Yes |

All steps completed within SLA budgets (no timeout issues).

---

## Step 3: Capture Golden Baselines

### Requested run: `dg4-gpt4o-v2` (draft_graph)

**Command:** `npx tsx tools/graph-evaluator/scripts/capture-golden-responses.ts --run-id dg4-gpt4o-v2 --type draft_graph`

**Result: FAILED** — `ENOENT: no such file or directory, scandir .../fixtures/draft-graph`

The capture script requires fixtures in `tools/graph-evaluator/fixtures/{type}/` to re-score responses via `adapter.loadCases()`. The `draft-graph` fixture directory does not exist (only `decision-review`, `edit-graph`, `orchestrator`, `research` have fixtures). Draft graph briefs are loaded via a different mechanism in the CLI runner and are not stored in the fixtures directory.

### Alternative run: `2026-03-14_01-27-40_edit_graph_v2` (edit_graph)

**Command:** `npx tsx tools/graph-evaluator/scripts/capture-golden-responses.ts --run-id 2026-03-14_01-27-40_edit_graph_v2 --type edit_graph`

**Result: SUCCESS**

| Metric | Value |
|---|---|
| Entries captured | 12 |
| Model | gpt-4.1 |
| Prompt hash | sha256:2d6fcbc9d09...c973cc5 |
| Score range | 0.800 – 1.000 |
| Output directory | `tools/graph-evaluator/golden-responses/edit-graph/` |
| Manifest | `tools/graph-evaluator/golden-responses/edit-graph/manifest.json` |

All 12 edit_graph briefs captured with scores:

| Brief | Score |
|---|---|
| 01-add-factor | 0.850 |
| 02-remove-factor | 0.850 |
| 03-strengthen-edge | 0.800 |
| 04-forbidden-edge | 1.000 |
| 05-compound | 0.800 |
| 06-already-satisfied | 1.000 |
| 07-forbidden-refused | 1.000 |
| 08-cycle-creation | 0.900 |
| 09-update-node-label | 0.800 |
| 10-reduce-edge-strength | 0.800 |
| 11-change-factor-value | 0.800 |
| 12-flip-effect-direction | 0.800 |

---

## Overall Verdict

### BLOCKING ISSUES FOUND

| Category | Status | Blocking? |
|---|---|---|
| Mock-based multi-turn tests | 3/3 PASS | No |
| Staging draft (Step 1) | FAIL | Yes — new prompt may not produce immediate graph_patch; test node extraction doesn't handle operations format |
| Staging edit (Step 2) | FAIL | Yes — new edit prompt returns `pending_proposal` flow instead of direct `applied_changes` |
| Staging analyse (Step 3) | FAIL | Yes — graph from draft lacks intervention config; `run_analysis` prerequisites not met |
| Staging explain (Step 4) | PASS | No |
| Golden capture (draft_graph) | FAIL | Moderate — `fixtures/draft-graph/` directory missing; capture script can't re-score |
| Golden capture (edit_graph) | 12/12 captured | No |

### Required actions before manual replay

1. **Staging test adaptation:** Update `golden-path-staging.test.ts` to handle:
   - Operations-format `graph_patch` blocks (count nodes from `add_node` operations, not `full_graph.nodes[]`)
   - `pending_proposal` flow for edits (accept proposal in a follow-up turn, or assert on proposal structure instead of `applied_changes`)
   - Inject a fully-configured graph with interventions before the analyse step (or send interventions in the edit step)

2. **Draft graph fixtures:** Create `tools/graph-evaluator/fixtures/draft-graph/` with brief markdown files so the capture script can run for `draft_graph` type.

3. **Investigate draft routing:** The new prompt (gpt-4o + v177) appears more conservative — it frames/clarifies before drafting. Confirm this is intentional behaviour or a regression.
