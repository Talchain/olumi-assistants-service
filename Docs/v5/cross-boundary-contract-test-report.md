# Cross-Boundary Contract Test Report

**Date:** 2026-04-30
**Scope:** Test-only, risk-tier-C. No production source changes in either repo.
**Repos:**
- CEE: `olumi-assistants-service` (branch `claude/cross-boundary-contract-tests`, off `staging`)
- UI: `DecisionGuideAI` (branch `claude/cross-boundary-contract-tests`, off `staging`)

This report covers the cross-boundary contract verification work commissioned to catch the class of bug exemplified by the `draft_coaching` mismatch — features correctly implemented in CEE but invisible to the UI because of endpoint or field-name divergence.

---

## 1. Fixtures

All seven CEE fixtures live at `tests/fixtures/cross-service/`. Six of them are byte-identical copies in the UI repo at `tests/fixtures/cee-responses/` (decision-review is CEE-internal and not consumed by UI).

| File | Source | Endpoint | Build | Captured |
|---|---|---|---|---|
| `draft-graph.success.with-coaching-and-provenance.json` | `synthetic_with_coaching_overlay` | `/assist/v1/draft-graph` | `a555cf7` | 2026-04-30 |
| `draft-graph.success.no-coaching.json` | `staging` | `/assist/v1/draft-graph` | `a555cf7` | 2026-04-30 |
| `draft-graph.success.partial-coaching.json` | `synthetic_partial_overlay` | `/assist/v1/draft-graph` | `a555cf7` | 2026-04-30 |
| `v5-turn.explain-stale.json` | `synthetic` | `/orchestrate/v2/turn` | N/A | 2026-04-30 |
| `v5-turn.failure-with-recovery-chip.json` | `synthetic` | `/orchestrate/v2/turn` | N/A | 2026-04-30 |
| `v5-turn.explain-fresh.json` | `synthetic` | `/orchestrate/v2/turn` | N/A | 2026-04-30 |
| `decision-review.normalised.json` | `synthetic` | internal V5 enricher | N/A | 2026-04-30 |

**Staging capture note (per brief correction #2):** the structural shape (nodes, edges, options, goal_node_id, provenance values) of fixture 1 was captured from a real call to `cee-staging.onrender.com/assist/v1/draft-graph` on build `a555cf7` (≥ `a555cf7b` per brief requirement) using the brief from the staging-v5 dossier. The LLM did not emit a `coaching` block on multiple staging calls (coaching emission is LLM-driven, not deterministically gated). A synthetic coaching overlay (summary, strengthen_items, widening_log, bias_signals) was added; one node and one edge were patched to `user_set` provenance so all three enum values are exercised. Fixture 2 is a verbatim staging response, demonstrating that coaching is correctly omitted when the LLM doesn't produce one. Full provenance documented in `tests/fixtures/cross-service/fixture-metadata.json`.

**Cross-repo sync command** (run after CEE fixtures land; verified byte-identical via `diff -r`):
```bash
cp ~/Documents/GitHub/olumi-assistants-service/tests/fixtures/cross-service/{draft-graph,v5-turn}*.json \
   ~/Documents/GitHub/DecisionGuideAI/tests/fixtures/cee-responses/
```

Byte-identity assertion (run on 2026-04-30):
```
$ diff -r .../cross-service/ .../cee-responses/
Only in cross-service: blocked-response.fixture*.json (pre-existing, unrelated)
Only in cross-service: decision-review.normalised.json (CEE-internal)
Only in cross-service: fixture-metadata.json (CEE-only)
```
No diff on the 6 shared fixtures.

---

## 2. Tests added

### CEE (`olumi-assistants-service`) — 40 brief-added tests
| File | Tests | Status |
|---|---|---|
| `tests/contract/fixtures-schema.test.ts` | 7 | pass |
| `tests/contract/endpoint-feature-matrix.test.ts` | 19 | 8 pass route-verified + 11 `not_route_verified` (V5 substitutes + Stage-5 sanitisation substitute) |
| `tests/contract/field-coverage-audit.test.ts` | 14 | pass (incl. path-level walk against explicit UI_CONSUMED_PATHS, passthrough-prefix exemption, classification structure check, drift-detection meta-test) |

Full CEE contract suite (incl. pre-existing `tests/contract/{ui-cee-contract,cross-service.blocked}.test.ts`): **68 passed | 21 skipped**.

### UI (`DecisionGuideAI`) — 29 brief-added tests
| File | Tests | Status |
|---|---|---|
| `tests/contracts/fixtures-schema.test.ts` | 7 | pass |
| `tests/contracts/cee-response-consumption.test.ts` | 22 | pass (incl. lifecycle test for "clears on new draft start", brief test 13) |

Full UI contract suite (incl. pre-existing `tests/contracts/{golden-path-fixture,response-envelope-contract,turn-request-contract}.test.ts`): **111 passed**.

---

## 3. Skipped route tests + substitutes

Per the brief's skip-and-substitute policy, V5 turn route-level tests were not implemented because booting `/orchestrate/v2/turn` against a real Fastify instance requires a Supabase session store, scenario row, LLM router, and ingress extension parsers — duplicating `tests/integration/orchestrate-v2.test.ts`'s plumbing without contract value.

| Brief test | Status | Substitute |
|---|---|---|
| 7. Failure response has recovery chips | `not_route_verified` | `[failure] buildFailureResponse emits a non-empty recovery chip + preserved error_code` |
| 8. Stale explanation has staleness prefix | `not_route_verified` | `[stale-prefix] applyStalenessPrefix prepends canonical caveat when staleness_reason is non-null` (+ idempotence + null-staleness) |
| 9. Stale explanation has rerun chip | `not_route_verified` | `[stale-fixture] explain-stale fixture: assistant_text carries canonical staleness prefix + run_analysis chip` |
| 10. Fresh explanation has no rerun chip | `not_route_verified` | `[fresh-fixture] explain-fresh fixture: no staleness prefix, no run_analysis chip` |
| 11. No raw entity IDs in user-facing fields | `not_route_verified` | `[egress-guard] sanitiseOlumiResponseForEgress scrubs entity-ID-shaped tokens` + `[egress-scan] all user-facing fixture strings are entity-ID clean (path-aware exclusions)` |
| 12. No forbidden terms in user-facing copy | `not_route_verified` | included in failure-fixture and egress-scan tests |
| 5. Mocked coaching containing fac_test_id is sanitised in the response | `not_route_verified` | `[stage-5 substitute] dirty coaching → narrow + sanitise produces no fac_/opt_ leaks` (composes `narrowCoachingForResponse` + per-string `sanitiseUserFacingText` exactly as Stage 5 does) |

The substitute primitives all share state with the route — the route's job is to call them in sequence — so substitute coverage is functionally equivalent for the field-shape contract this brief is testing.

---

## 4. Field-coverage audit (v1)

Audited the 10 critical cross-boundary fields the brief named:

```
coaching, strengthen_items, widening_log, bias_signals,
provenance, provenance_display,
suggested_actions, assistant_text, analysis_ready, blocks
```

The audit walks every produced JSON path in every fixture and, for paths whose leading segment is one of the 10 audited fields, requires the EXACT path to satisfy at least one of:
- the path is in `UI_CONSUMED_PATHS` (~50 leaf-level paths the adapter actually reads, sourced from `mapDraftCoachingFromResponse`, `adaptDraftResponse` v3-fast-path, `edgeProvenanceDisplayPatch`, `responseRouter`, and `useConversation.handleEnvelope`)
- the path falls under one of `UI_CONSUMED_PASSTHROUGH_PREFIXES` (`analysis_ready`, `blocks[].details`, `blocks[].enrichment`, `blocks[].options[].attributes`) — these subtrees are forwarded opaquely to downstream consumers (PLoT, ResultsPanel, telemetry); leaves under them ride along automatically
- the path (or its no-bracket variant) is explicitly classified in `field-coverage.allowlist.json`

Top-level head matching alone is NOT sufficient — a brand-new `coaching.unused_new_field` fails unless explicitly added to `UI_CONSUMED_PATHS` or the allowlist with justification. A negative test in the same file proves the audit catches that exact synthetic drift case.

Out-of-v1-scope paths (e.g. `_meta.*`, `trace.*`) are ignored at the audit level but each specific path is enumerated and justified in the allowlist for documentation completeness.

### P1 — UI expects, CEE doesn't produce
**None.** Every audited field consumed by the UI adapter has a CEE fixture that produces it. The audit's `UI_CONSUMED_FIELDS` map is curated from `DecisionGuideAI/src/{adapters/cee/client.ts, canvas/utils/draftIngestion.ts, v5/responseRouter.ts, canvas/conversation/useConversation.ts}`.

### P2 — produced but not consumed (observations only, do not fail)
| Field | Where produced | Status |
|---|---|---|
| (none in v1) | — | All audited fields are consumed by the UI |

### Observations beyond the v1 audited list
The CEE response carries several diagnostic / structural fields that the UI doesn't read but that are correctly classified in the allowlist (not P1, not P2 of v1 scope):
- `_meta.*`, `trace.*`, `answer_source`, `fallback_reason` — diagnostic, not user-facing.
- `nodes[*].id`, `edges[*].from`, `edges[*].to`, `bias_signals[*].target` — structural pointers, never rendered as text.
- `referenced_option_ids`, `option_id`, `factor_id`, etc. — machine routing.

---

## 5. P1 / P2 / P3 findings

### P1 — halt-and-report
**None.**

### P2 — produced but not consumed
**None.**

### P3 — copy ticket discrepancies
1. **Recovery chip label asymmetry.** Two distinct `run_analysis` chips exist:
   - **Stale-explanation rerun chip** (`src/orchestrator-v5/compose/chip-generator.ts:234`): `id: 'chip_action_rerun_analysis'`, **label: `"Rerun analysis"`**, `message: 'Rerun the analysis.'`. This is the chip the brief named.
   - **PLOT-failure recovery chip** (`src/orchestrator-v5/compose/recovery-chips.ts:225`): `id: 'chip_action_run_analysis_retry'`, **label: `"Run analysis again"`**, `message: 'Run the analysis.'`. Surfaces only on PLOT_HTTP_ERROR / PLOT_TIMEOUT failure paths.

   Tests assert `action_type === 'run_analysis'` as the primary contract; the labels are documented as a soft assertion. Worth normalising in a follow-up copy ticket but not a contract violation.

2. **UI test directory naming.** Brief said `tests/contract/` (singular); UI repo already had `tests/contracts/` (plural) with three pre-existing test files (`golden-path-fixture`, `response-envelope-contract`, `turn-request-contract`). New tests use the plural form to match existing convention. CEE keeps singular `tests/contract/`.

3. **`tests/fixtures/cee-responses/` newly created in UI.** No existing convention for cross-service fixtures in the UI repo (existing fixtures live under `src/__fixtures__/`, `src/test/fixtures/`, `src/canvas/utils/__tests__/fixtures/`). The new `tests/fixtures/cee-responses/` follows the brief's explicit path.

---

## 6. Tooling decisions

### Path-aware output safety scans (correction #5 enforced)
Exclusions are JSON paths, not field names. A `target` at `$.coaching.bias_signals[*].target` is excluded because it's a documented structural pointer. A `target` anywhere else would NOT be automatically safe. Same for `$.coaching.strengthen_items[*].id`, `$.coaching.widening_log[*].node_id`, `$.suggested_actions[*].id`, `$.blocks[*].error_code`.

### Confirmed-vs-unconfirmed entity-ID leaks
On the CEE side, the egress scan uses production `sanitiseUserFacingText` (from `src/orchestrator-v5/compose/output-safety.ts`), which applies confirmation heuristics: digit presence, ambiguous-prefix gate (`fac`/`opt` confirmed, multi-segment first-segment-too-short rejected, etc.). Only **confirmed** leaks fail the test — legitimate hyphenated English ("decision-relevant", "outcome-oriented") passes through.

On the UI side there is no sanitiser — every regex match is unconfirmed but visible — so the synthetic fixture's coaching summary was tightened to avoid the false-positive trigger. This kept the fixture realistic and identical across both repos.

### Fixture-schema test runs first
Both `fixtures-schema.test.ts` files (CEE + UI) run first via vitest's default alphabetical filename ordering. Fixture drift fails independently of behavioural tests, so a CEE schema bump that breaks fixture shape surfaces immediately.

### V5 route tests classified `not_route_verified`
Substitutes are direct unit tests of `applyStalenessPrefix`, `buildFailureResponse`, `sanitiseOlumiResponseForEgress`, plus fixture-shape assertions. The skip-and-substitute table (§3) names every brief test and its substitute.

### Render-layer coverage (UI side)
Brief tests 7-8 and 17-18 are JSON-level scans on adapter output rather than full RTL component renders. Rationale: the cross-boundary contract is the *shape* of what the adapter produces, and component-level rendering for `PreAnalysisPanel`, message bubbles, and chips is already covered in `src/canvas/components/pre-analysis/__tests__/*.spec.tsx` and adjacent component tests. Mounting those components in the contract-test layer would duplicate render-tree assertions without adding cross-boundary signal — the assertion that no `bias_signals[].target` ever appears in `bias_signals[].detail` (test 7) and no raw entity IDs appear in user-facing prose paths (tests 8, 17, 18) is enforceable on the JSON. If future render code introduces a new path that concatenates structural pointers into rendered text, the corresponding component test catches it.

### Stage-5 sanitisation substitute (brief test 5, `not_route_verified`)
The brief's *"Mocked coaching containing `fac_test_id` is sanitised in the response"* contract cannot be route-verified in this branch because the production chokepoint `sanitiseCoachingForDisplay` (`src/cee/unified-pipeline/stages/package.ts:105-135`) is module-private and the brief forbids production code changes. The substitute test composes the same primitives Stage 5 calls — `narrowCoachingForResponse` (exported, `src/orchestrator/draft-coaching.ts:113`) followed by per-string `sanitiseUserFacingText` (exported, `src/orchestrator-v5/compose/output-safety.ts:179`) — applied to a dirty input containing `fac_test_id` and `opt_test_id` in `summary`, `strengthen_items[].label`, `strengthen_items[].detail`, `widening_log[].label`, `widening_log[].reason`, and `bias_signals[].detail`. Asserts: every user-facing string in the output is leak-free; structural pointer `bias_signals[].target` is preserved verbatim. Classified `not_route_verified` and listed in §3 with the recommendation that this test be replaced with a route-verified equivalent if `sanitiseCoachingForDisplay` is exported in a future change.

---

## 7. UI dependency status

The UI coaching consumption code (`mapDraftCoachingFromResponse` at `src/adapters/cee/client.ts:99`, `setDraftCoaching` at `src/canvas/store.ts:3135`, `commitDraftCoachingToStore` at `src/canvas/utils/draftIngestion.ts:8`) was already merged on UI `staging` before UI commits started. The pre-flight gate (per correction #1) passed; UI work proceeded.

**Note (2026-04-30 sequencing):** during this session the UI repo's `claude/cross-boundary-contract-tests` branch was advanced past my commit `260b0b8f test(contract): CEE response fixtures + consumption + lifecycle` — Paul's parallel coaching consumption work landed as `ad78e0b5 feat(cee): consume coaching + provenance from /assist/v1/draft-graph` immediately after my commit, and the merge `70833cd5` brought both into `origin/staging`. My UI commit is therefore already merged into UI `staging`; CEE work remains on its own feature branch awaiting review.

---

## 8. Defects discovered

**None.**

No production behaviour gap was uncovered by the new tests. The audit confirms that as of build `a555cf7`, every field the UI adapter reads is produced by CEE on the endpoint the UI calls. The cross-boundary state is consistent.

---

## 9. Verification

### CEE
```bash
cd ~/Documents/GitHub/olumi-assistants-service
ls tests/fixtures/cross-service/*.json | grep -v fixture-metadata | wc -l
# 9 (7 brief fixtures + 2 pre-existing blocked-response)

pnpm exec vitest run tests/contract/   # 68 passed | 21 skipped (5 files)
pnpm exec tsc -p tsconfig.build.json --noEmit   # clean
git status --short | grep "^?? src/"            # empty
git diff --name-only origin/staging -- src/ | wc -l   # 0
```

### UI
```bash
cd ~/Documents/GitHub/DecisionGuideAI
ls tests/fixtures/cee-responses/*.json | wc -l  # 6
diff -r ~/Documents/GitHub/olumi-assistants-service/tests/fixtures/cross-service/ \
        tests/fixtures/cee-responses/ \
   | grep -v decision-review | grep -v fixture-metadata | grep -v blocked-response   # empty
pnpm exec vitest run tests/contracts/           # 111 passed (5 files)
git diff --name-only origin/staging -- src/ | wc -l   # 0
```

---

## 10. Recommended follow-ups

1. **(P3) Normalise the two `run_analysis` chip labels** — pick `"Rerun analysis"` or `"Run analysis again"` and use it in both `chip-generator.ts` and `recovery-chips.ts`.
2. **(future)** Capture a real-staging coaching block once the LLM emits one for an in-house bias-rich brief; replace the synthetic-overlay portion of fixture 1 with the verbatim staging payload.
3. **(future)** Extend the field-coverage audit beyond the v1 critical-10 list to include `analysis_ready.*` sub-fields, `validation_warnings`, `draft_warnings`, `goal_constraints`, and `rationales` once UI consumers stabilise.
4. **(future)** Add route-level V5 contract tests once a session-store + scenario-fixture harness lands (would replace the `not_route_verified` substitutes and close the integration gap).
