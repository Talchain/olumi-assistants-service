# V5 testing audit — CEE service

Branch: `claude/v5-testing-audit-and-improvements` (from `origin/staging`).
Scope: read-only audit plus minimal P0 additions. No prompt changes, no PLoT/ISL changes, no CI workflow edits. Local commits only.

## 1. Phase 0 — command and gate inventory

| Command | Scope | Network/secrets | Tier | Blocking |
| --- | --- | --- | --- | --- |
| `pnpm test` | Vitest unit + integration; excludes live, e2e, staging, benchmarks | none | 1/2 | CI gate |
| `pnpm test:ci` | `lint && typecheck && test` | none | 2 | CI gate |
| `pnpm preflight` | `lint && typecheck && test && openapi:check` | none | 2 | local pre-merge |
| `pnpm test:live` | `adversarial.test.ts` + `golden-briefs-runner.test.ts` | `ANTHROPIC_API_KEY` | 4 | optional |
| `pnpm test:e2e` | Playwright | varies | 3 | manual |
| `pnpm test:sse:core` / `:chaos` | SSE parity, redis chaos | redis | 1/2 | optional |
| `pnpm test:cee:telemetry` / `:calibration` | hero-journey telemetry, calibration workflow | none | 2 | optional |
| `pnpm test:staging` | `RUN_STAGING_SMOKE=1` + `CEE_BASE_URL` + `CEE_API_KEY` | yes, network | 3 | manual |
| `pnpm benchmark:stability` | edge stability benchmarks | none | 4 | nightly |
| Pre-commit hooks | none detected | — | — | — |
| CI (`.github/workflows/ci.yml`) | `unit-tests` (lint/typecheck/test/coverage), `security` (npm audit), optional `live-tests` if secret set | partial | 2 | yes |

Coverage thresholds (v8 provider): lines/functions/statements 90%, branches 85%; aggregate, no per-file granularity.

## 2. Test directory layout

`tests/` (≈720 files): integration/ (≈154), unit/ (≈301), contract/ (≈17), validation/ (≈7), benchmarks/ (≈20), staging/ (≈12), perf/ (≈8), helpers/, fixtures/, e2e/ (4 — likely stale), chaos/.
`src/**/__tests__/` (≈126 files), heaviest under `src/orchestrator-v5/` (96).

About 51 files contain `.skip` or `.todo`. Coverage gates pass; skipped suites are mostly chaos, staging-only, and adversarial-LLM.

## 3. V5 coverage matrix

| Area | Files | Asserts | Gap | Would have caught a recent failure? |
| --- | --- | --- | --- | --- |
| draft_graph | `cee.draft-graph*.test.ts` (14), `draft-graph*.test.ts` (5) | empty graph, coefficients, coaching, causal claims, fail-closed | live LLM regression beyond fixtures | partial — fixture-only |
| `/orchestrate/v2/turn` | `orchestrate-v2-*.test.ts` (8), `golden-path-v2-e2e.test.ts` | activation, a1/a2, preflight, deterministic | multi-turn state across handlers | partial |
| `/proxy/v5/turn` | `src/routes/__tests__/proxy-v5-turn.test.ts`, `tests/integration/proxy-v5-preflight.test.ts` | route handler, origin allowlist, OPTIONS preflight, app.inject() forwarding, service-key non-leak | non-JSON upstream body, internal-handler timeout, OPTIONS-empty-body hash regression | **no** — the OPTIONS 500 (commit c73d1469) and Edge timeout were caught manually, not by tests |
| CORS / preflight | `cors.test.ts`, `cee.preflight-*.test.ts` (3), `proxy-v5-preflight.test.ts`, `slice-b-preflight.test.ts` | origins, methods, headers | response-hashing on empty body | partly — OPTIONS 500 slipped |
| response_hash / finaliser | `response-finaliser*.test.ts` (3) | idempotence, cleanliness sweep, schema | end-to-end hash integrity on OPTIONS / empty body | no for the OPTIONS 500 |
| analysis_ready / run_analysis | `cee.analysis-ready*.test.ts` (8), `analysis-ready*.test.ts` (3) | contract blockers, pricing, enrichment | live PLoT envelope variance | partial |
| PLoT payload / numeric format | `plot-invalid-numeric.test.ts`, `cil-phase2-analysis-ready.test.ts` | numeric format | PLoT envelope validation, display-safe projection | partial |
| explain_results joint precondition | `src/orchestrator-v5/tools/handlers/__tests__/explain-results.test.ts` (extended on `claude/p0-v5-golden-path-integration`, commit 9d3136ac) | `success && current` joint precondition + clarification path | none material once P0 lands | yes (after P0 lands) |
| handler preconditions (D1) | `set-factor-value*.test.ts`, `add-constraint*.test.ts`, `adjust-edge-strength*.test.ts` | unit + integration routing | rejection envelope semantics, recovery | partial |
| display-safe projection (prose-scoped) | `cee.display-value.test.ts`, `display-value-and-provenance.test.ts`, `v5.route-with-tool-use.display-graph.test.ts`, `tests/contract/v5-golden-path-acceptance.test.ts`, `tools/v5-journey-replay/forbidden-terms.ts` | `display_value`, prose forbidden-terms wordlist | none widely material; wordlist drift risk | yes |
| prose sanitiser (Track 2A detect-only) | `turn-executor-prose-sanitation.test.ts`, `chip-prose-sanitiser.test.ts`, `prose-sanitation-corpus.test.ts` | corpus-driven detect-only | live drift across model changes | yes |
| A4 add-risk clarification | `add-constraint*.test.ts`, `add-constraint-risk-forwarding.test.ts` | handler routing, constraint forwarding within turn | multi-turn carryover and A5 interaction | partial |
| A5 deterministic enforcement | `cee.deterministic-sweep*.test.ts` (3), `deterministic-value-update.test.ts` | inbound budget rescale, value-update routing | end-to-end bridge-chain repair | no for bridge-chain regressions |
| edit_graph rejection / repair | `edit-graph-dispatch*.test.ts` (4), `route-v2-edit-graph*.test.ts` (2) | orphan-option replay, add-risk e2e | rejection envelope canonical shape, repair-loop iterations | partial |
| goal_constraints forwarding (multi-turn) | none | — | full gap | **no** |
| graph persistence / staleness | `phase1.5-staleness.test.ts`, `brief-persistence-composed-roundtrip.test.ts`, `turn-executor-state-trust.test.ts` (commit f316ec9f, P0 branch) | staleness prefix, stale-after-mutation | cache invalidation, freshness selector parity with UI | partial |
| evidence / debug bundle | `evidence-pack.test.ts`, `cee.evidence*.test.ts`, `extract-evidence-gaps.test.ts` | structure, DSK integration | proxy/source classification round-trip | partial |
| golden-path replay | `tests/contract/v5-golden-path-acceptance.test.ts` (P0 branch, commit c2075068), `tests/validation/golden-briefs-runner.test.ts` | acceptance gate, forbidden-terms list, brief replay | turn-by-turn UI consequence assertions | yes within prose surface |
| prompt benchmark | `prompt-sensitivity.*`, `matching.*`, `cqe.bench.ts` | unit benchmarks | live LLM regression with cache-hit metrics, v194/v195 baseline | no |
| ID / model-language leakage | `proposal-language-guard.test.ts`, `id-leak*.test.ts`, `model-routing.test.ts` + golden-path forbidden-terms wordlist | proposal language, ID leak guards | prose vs structured-payload scoping is not separately enforced | partial |
| proxy timeout / non-JSON | none | — | full gap | **no** |
| latency SLA | `extract-quantities.timeout.test.ts` (unit), `edge-stability.bench.test.ts` (nightly), perf baseline (informational) | unit-level timeouts only | no blocking gate, no per-stage SLA, no draft/direct-answer 40–50 s ceiling | no |

## 4. Phase 0 — concurrent P0 workstream overlap

CEE branches inspected (read-only `git log` and `git diff --name-only` against staging):

| Branch | Last commit | Coverage relevant to this workstream |
| --- | --- | --- |
| `claude/p0-v5-golden-path-integration` | 08a608b7 | `tests/contract/v5-golden-path-acceptance.test.ts`, `tools/v5-journey-replay/forbidden-terms.ts`, extended `explain-results.test.ts` (joint success+currentness), `turn-executor-state-trust.test.ts` (stateful multi-turn freshness), `turn-executor-deterministic-value-update.test.ts`, `tests/integration/orchestrate-v2-deterministic-value-update.test.ts` |
| `claude/v5-d1-golden-path-closure` | — | D1 handler closure already merged into staging |
| `claude/v5-analysis-ready-contract` | — | analysis-ready field coverage already merged |
| `claude/v5-coaching-pipeline` | — | coaching tests already merged |
| `audit/draft-graph-pipeline-2026-05-01` | — | draft-graph pipeline audit notes; no test additions for this workstream |

### Disposition for each P0 in the plan

1. **Proxy non-JSON / timeout / OPTIONS empty-body** — not covered. **Implement.** Item carried as `tests/integration/proxy-v5-non-json-and-timeout.test.ts` design captured in §6 below; deferred from this turn's commit because it requires coordinated work on the response-finaliser module and is not safe under the local-commits-only budget remaining. Tracked as P0/Wave-2.
2. **Goal-constraint forwarding (multi-turn)** — not covered. The existing two-turn replay path is `turn-executor-state-trust.test.ts` (stale-after-mutation), which doesn't carry `goal_constraints`. **Deferred to P1** — implementing requires either an extension to that harness or a new replay scaffold; not safe to bolt onto the harness without duplicating its assumptions in this turn.
3. **explain_results joint precondition (`success && current`)** — **already covered** on `claude/p0-v5-golden-path-integration` (commit 9d3136ac). No duplication here; reference only.
4. **Egress display-safe (prose-scoped)** — **already covered** by `tests/contract/v5-golden-path-acceptance.test.ts` plus `tools/v5-journey-replay/forbidden-terms.ts` on the same P0 branch (commit c2075068). Reference only. Forbidden-terms wordlist is the single source — keep co-located.
5. **Hiring-prompt staging smoke through `/proxy/v5/turn`** — not covered. The existing `tests/staging/golden-path-staging.test.ts` calls `CEE_BASE_URL` directly with `X-Olumi-Assist-Key`, which does **not** exercise the browser proxy bypass that production uses. **Implement** as `tests/staging/proxy-v5-hiring-prompt.smoke.test.ts`.

Net new files this branch lands: **one test plus this audit report**.

## 5. Phase 1 — quality classification

Test classification (product / contract / component / staging / benchmark) for the most load-bearing files:

| File | Classification | Note |
| --- | --- | --- |
| `tests/contract/v5-golden-path-acceptance.test.ts` | contract + product | the strongest current product gate; protect via wordlist co-location |
| `src/routes/__tests__/proxy-v5-turn.test.ts` | contract | route registration, origin, headers; gap: non-JSON / timeout / OPTIONS empty-body |
| `tests/integration/proxy-v5-preflight.test.ts` | contract | OPTIONS preflight; OPTIONS-empty-body + hashing untested |
| `tests/integration/orchestrate-v2-*.test.ts` | contract | broad activation surface |
| `src/orchestrator-v5/tools/handlers/__tests__/explain-results.test.ts` | product (after P0) | joint success+currentness precondition |
| `src/orchestrator-v5/__tests__/turn-executor-state-trust.test.ts` | product | stale-after-mutation freshness |
| `tests/staging/golden-path-staging.test.ts` | staging-smoke | direct CEE base URL — not the proxy path |
| `tests/contract/v5-egress-display-safe.contract.test.ts` (proposed) | contract + product | overlaps with golden-path-acceptance — **not added** |
| `cee.draft-graph*.test.ts` | component (fixture-bounded) | light product coverage; depends on benchmarks for live regressions |
| `prompt-sensitivity.unit.test.ts`, `cqe.bench.ts` | benchmark | informational only |

Headline: the V5 weakness is not test volume but the absence of (a) deployed-transport product gates and (b) cross-turn state-shape contract tests for goal_constraints. Once `claude/p0-v5-golden-path-integration` lands, prose-surface display-safe and explain_results-precondition are well covered; transport and multi-turn goal-constraint coverage remain the priority.

## 6. Phase 2 — target tier model

| Tier | Trigger | Command | Blocking | Budget |
| --- | --- | --- | --- | --- |
| 1 Local focused | every change | `pnpm exec tsc -p tsconfig.build.json --noEmit` + `pnpm vitest run <touched>` + lint touched | dev-only | < 60 s |
| 2 Pre-merge | local before push | `pnpm preflight` (lint + typecheck + test + openapi:check) | yes | < 8 min |
| 3 Deployed-path smoke | post-staging-deploy or explicit | `RUN_STAGING_SMOKE=1 CEE_PROXY_BASE_URL=… CEE_PROXY_ORIGIN=… pnpm test:staging` (covers both existing direct test and the new proxy smoke; both self-skip without env) | manual | < 3 min |
| 4 Prompt/graph benchmark | prompt or model change / nightly | `pnpm benchmark:stability`; consider extending with leakage and repair-count regression in a follow-up | informational | nightly |

## 7. Phase 3 — recommendations

### P0 — must hold for V5 PoC

| # | Test | Status | Catches |
| --- | --- | --- | --- |
| 1 | proxy non-JSON / internal-handler timeout / OPTIONS empty-body | deferred to Wave 2 (design captured below) | OPTIONS 500 regression; non-JSON upstream rendered as opaque; service-key echo |
| 2 | goal_constraints forwarding (multi-turn) | deferred to P1 | silent loss of constraints between turns |
| 3 | explain_results joint precondition | covered by P0 branch — reference only | confident explanation without valid current analysis |
| 4 | prose-surface display-safe | covered by golden-path-acceptance — reference only | internal ID / repair-vocabulary leakage in prose |
| 5 | `/proxy/v5/turn` hiring-prompt staging smoke | **added in this branch** | Netlify Edge timeout regressions; route-resolution regressions; secret-leak on the real deployed proxy path |

### Item 1 design (for the next branch that owns it)

`tests/integration/proxy-v5-non-json-and-timeout.test.ts`. Build a Fastify test app, register `proxyV5TurnRoute`, and stub the internal `/orchestrate/v2/turn` to: (a) reply with `text/plain` body; (b) exceed `BROWSER_PROXY_TIMEOUT_MS` (set to a short value in test); (c) be invoked via `OPTIONS` with empty body. Assert: proxy classifies source, returns structured 502/504, captures bounded raw body (≤ 4 KiB), service-key never appears in external response, response-finaliser tolerates empty OPTIONS body. Reuse the mock pattern in `src/routes/__tests__/proxy-v5-turn.test.ts` to stay aligned with `app.inject()`.

### P1

- multi-turn `goal_constraints` forwarding contract test once a clean two-turn harness is available (probably extending `turn-executor-state-trust` patterns).
- live LLM prompt eval harness with v194/v195 baselines and cache-hit metrics.
- end-to-end A5 bridge-chain repair test.
- per-stage latency thresholds (informational → blocking) once baselines stabilise; candidates are draft total, edit_graph total, routeWithToolUse total, response finalisation.

### P2

- prune Playwright e2e/ stale specs.
- consolidate `id-leak*.test.ts` into the prose-surface forbidden-terms wordlist to remove drift.
- per-file coverage thresholds for `src/orchestrator-v5/`, particularly `tools/handlers/`.

## 8. Golden-path coverage matrix (19-step PoC journey)

| Step | CEE-unit | CEE-int | Contract | Harness | Staging | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 brief in | — | ✓ orchestrate-v2 activation | — | golden-path-acceptance | golden-path-staging (direct base url) | proxy path now covered by new smoke |
| 2 transport | — | proxy-v5-turn unit | proxy-v5-preflight | — | new proxy smoke | non-JSON / timeout still gapped |
| 3 200 JSON | — | ✓ | ✓ | ✓ | ✓ | |
| 4 draft_graph present | ✓ draft-graph* | ✓ | ✓ | ✓ | ✓ | |
| 5 analysis_ready ready | ✓ | ✓ analysis-ready | ✓ | ✓ | ✓ | |
| 6 graph render | — | — | — | — | — | UI-side, see UI audit |
| 7 user runs analysis | — | ✓ | ✓ | — | ✓ via roundtrip test | |
| 8 PLoT response | — | ✓ | ✓ plot-invalid-numeric | — | ✓ | |
| 9 results displayed | — | — | — | — | — | UI-side |
| 10 post-analysis Q | — | ✓ explain-results | ✓ acceptance | ✓ | partial | |
| 11 explain_results gated | unit (P0 branch) | integration-explain-results-post-analysis | acceptance | ✓ | — | gates only land with P0 merge |
| 12 deterministic value update | unit (P0 branch) | orchestrate-v2-deterministic-value-update | — | ✓ | — | |
| 13 graph mutates / persists | unit | turn-executor-state-trust | — | ✓ | partial | |
| 14 analysis stale | unit | ✓ | — | ✓ | — | |
| 15 rerun chip clear | — | — | — | — | — | UI-side |
| 16 rerun refresh | — | ✓ | — | — | — | |
| 17 decision review | unit | ✓ | — | — | — | |
| 18 debug bundle | — | ✓ evidence-pack | — | — | — | UI-owned end-to-end |
| 19 no internal vocabulary | — | — | golden-path-acceptance + forbidden-terms | ✓ | — | wordlist must stay co-located |

## 9. Risks and constraints

- Local commits only. No push, no deploy, no env or secret rotation, no prompt edits, no PLoT/ISL changes.
- The forbidden-terms wordlist (`tools/v5-journey-replay/forbidden-terms.ts`) is the single source for prose-surface leakage; any new prose-scoped contract test must import it rather than re-declare to prevent drift.
- The `/proxy/v5/turn` smoke depends on `BROWSER_PROXY_ALLOWED_ORIGINS` containing the configured staging origin; environment-shape gaps will surface on first run and are reported, not auto-fixed.
- Hiring-prompt smoke uses bounded duration logging only — no payload bodies are echoed to test output.

## 10. Confirmation

This audit is read-only review plus one new test (`tests/staging/proxy-v5-hiring-prompt.smoke.test.ts`). Items 3–4 are referenced rather than re-implemented because they exist on `claude/p0-v5-golden-path-integration`. Items 1–2 are explicitly deferred and tracked here as Wave 2 / P1.
