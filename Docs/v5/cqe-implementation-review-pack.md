# CQE Implementation Review Pack

**Brief:** cqe-implementation-v1.1
**Date completed:** 20 April 2026
**Branches:** `claude/v5-cqe-investigation` in both repos (local, uncommitted to remote)
**Status:** Ready for Paul review. No push. No staging deploy.
**Revision:** rev2 (2026-04-20, post-ChatGPT review). Original rev1 shipped the CQE implementation; rev2 incorporates ChatGPT review Tiers A (brief-compliance), B (evidence), and C (polish). Tier D (design-doc amendments) closed per Paul's direction; CQE Design v1.2 to follow.

---

## 1. Phase-by-phase summary

| Phase | Scope | Commit |
|---|---|---|
| 0 | Schemas package: `QuantityExtractionResult` + `ParameterOperator` in `@talchain/schemas/orchestrator`; bump 0.5.1 → 0.6.0; build; pack | `olumi-schemas` 3412b76 |
| 1 | CEE vendor bump: tarball into `vendor/`; `package.json:69` pin; runtime deps `compromise` + `compromise-numbers`; dev dep `fast-check`; `pnpm install` | CEE 533d879b |
| 2 | CQE module (6 files) under `src/orchestrator-v5/context/cqe/`; `parsed_quantities` field on `ContextPack`; wire into `assembleContextPack()`; 68 fixtures; unit + property + integration tests; 5-case bench | CEE e56c14e2 |
| 3 | Telemetry: `cqe.extraction` event in `TelemetryEvents` enum + Datadog routing case; 10 CQE fields on `RoutingLogInput`/`RoutingLog`; `buildRoutingLog()` projection updates; `turn-executor.ts` ORIENT step threads `CqeExtractionSummary` into both surfaces | CEE 7d9ee8c6 |
| Rev2 | Tier A-C review corrections (ChatGPT review): removed unsafe casts, split P11 into anchored sub-patterns, added per-pattern timeout telemetry + dedicated test, strict fixture equality, full-chain integration test, explicit p95 evidence, outer-catch warning, bench naming fix | CEE 78a15586 |

## 2. Schema-freeze precheck result

Performed before Phase 0 per brief §5.0. Schema identical across spec v3.2 §11.1, CQE Design v1.1 §3, investigation proposal. No drift. Evidence: `Docs/v5/cqe-schema-precheck.md`. No `inference_basis` occurrences anywhere in v1.1 design corpus or new code.

## 3. Files changed

### `olumi-schemas` repo (commit 3412b76)

| File | Change |
|---|---|
| `package.json` | version 0.5.1 → 0.6.0 |
| `src/orchestrator/index.ts` | re-export `ParameterOperatorSchema`, `QuantityExtractionResultSchema`, types |
| `src/orchestrator/quantity-extraction.ts` | new (Zod schema + type aliases per spec v3.2 §11.1) |

### CEE repo (commits 533d879b, e56c14e2, 7d9ee8c6)

| File | Change |
|---|---|
| `package.json` | vendor pin update; +compromise, +compromise-numbers, +fast-check |
| `pnpm-lock.yaml` | regenerated |
| `vendor/talchain-schemas-0.6.0.tgz` | new tarball |
| `Docs/v5/cqe-schema-precheck.md` | new (§5.0 artifact) |
| `Docs/v5/cqe-test-baseline.md` | new (Gate 9 baseline snapshot) |
| `Docs/v5/cqe-dependency-audit.md` | new (Gate 11 evidence) |
| `Docs/v5/cqe-implementation-review-pack.md` | new (this document) |
| `src/orchestrator-v5/context/cqe/pre-normalise.ts` | new |
| `src/orchestrator-v5/context/cqe/word-numbers.ts` | new |
| `src/orchestrator-v5/context/cqe/rules.ts` | new (13 patterns + P7 continuation) |
| `src/orchestrator-v5/context/cqe/compromise-backstop.ts` | new |
| `src/orchestrator-v5/context/cqe/compromise-numbers.d.ts` | new (ambient shim) |
| `src/orchestrator-v5/context/cqe/post-filters.ts` | new |
| `src/orchestrator-v5/context/cqe/extract-quantities.ts` | new (orchestrator) |
| `src/orchestrator-v5/context/cqe/__tests__/extract-quantities.test.ts` | new (72 tests) |
| `src/orchestrator-v5/context/cqe/__tests__/extract-quantities.property.test.ts` | new (3 property tests) |
| `src/orchestrator-v5/context/context-pack-assembler.ts` | add `parsed_quantities` field, wire `runExtraction()`, new `assembleContextPackWithSummary()` export |
| `src/orchestrator-v5/turn-executor.ts` | switch to `assembleContextPackWithSummary()`, emit `cqe.extraction`, thread summary into routing log |
| `src/orchestrator-v5/routing/routing-log.ts` | +10 CQE fields on `RoutingLogInput` and `RoutingLog`; `buildRoutingLog()` projection both branches |
| `src/utils/telemetry.ts` | `CqeExtraction: "cqe.extraction"` in enum; Datadog switch case |
| `tests/fixtures/cqe-fixtures.ts` | new (68 cases) |
| `tests/integration/cqe-end-to-end.test.ts` | new (4 tests) |
| `tests/benchmarks/cqe.bench.ts` | new (5-case matrix) |
| `tests/benchmarks/cqe-results.md` | new (bench evidence) |

## 4. Tests added

| Location | Count | Purpose |
|---|---|---|
| `src/orchestrator-v5/context/cqe/__tests__/extract-quantities.test.ts` | 72 | 68 fixtures from CQE Design v1.1 §8 plus 4 meta tests (fixture count assertion, defensive runtime contract, summary shape, message-too-long flag). **Rev2:** strict deep-equality enforced (exact count + positional ordering). |
| `src/orchestrator-v5/context/cqe/__tests__/extract-quantities.property.test.ts` | 3 | `fast-check` properties: no-throw on arbitrary strings, no-throw on adversarial unicode, output schema shape stability |
| `src/orchestrator-v5/context/cqe/__tests__/extract-quantities.timeout.test.ts` | 3 | **Rev2 (Gate 5):** circuit-breaker fires per-pattern with `pattern_id` telemetry; no partial spans recorded; later rules run on unmasked text; compromise still runs; global return is non-empty |
| `tests/integration/cqe-end-to-end.test.ts` | 5 | End-to-end through `assembleContextPack()` for quantity-bearing and quantity-free messages; `JSON.stringify` preserves `value_origin`; non-action turn path. **Rev2:** full-chain test through `routeWithToolUse()` with mock adapter that captures the Sonnet-facing user message and asserts `value_origin` survives. |
| `tests/benchmarks/cqe.bench.ts` | 5 | Idle, multi-pattern, adversarial, 2000-char, compromise-only (vitest bench; p75/p99/p999) |
| `tests/benchmarks/cqe-p95-bench.ts` | 5 | **Rev2:** explicit-p95 harness (N=400-2000 samples), emits p50/p75/p95/p99/p999 + breach tolerance vs target |

**Total new: 83 tests + 10 benchmarks.** All pass.

## 5. Benchmark results

Full detail in `tests/benchmarks/cqe-results.md`. Rev2 adds explicit p95 numbers via the new `cqe-p95-bench.ts` harness.

| # | Case | **p95** | Target | Breach | Pass |
|---|---|---|---|---|---|
| 1 | Idle path (no numbers) | **0.120 ms** | <1ms | -88.0% | ✓ |
| 2 | Multi-pattern realistic | **0.163 ms** | <5ms | -96.7% | ✓ |
| 3 | Adversarial backtracking | **0.432 ms** | <50ms (timeout cap) | -99.1% | ✓ |
| 4 | 2000-char cap boundary | **0.475 ms** | <20ms | -97.6% | ✓ |
| 5 | Compromise-only fallback | **0.304 ms** | <10ms | -97.0% | ✓ |

All five cases meet their proposal §8.2 p95 targets with ≥88% headroom. Worst case is Case 4 at 47.5% of its 20ms budget; everything else is under 10% of its budget.

## 6. Dependency audit

Full detail in `Docs/v5/cqe-dependency-audit.md`. Summary:

| Package | Version | Licence | Vulns | Node compat |
|---|---|---|---|---|
| compromise | 14.15.0 | MIT | 0 | ≥12.0.0 ✓ |
| compromise-numbers | 1.4.0 | MIT | 0 | ≥12.0.0 ✓ |
| fast-check (dev) | 3.23.2 | MIT | 0 | ≥8.0.0 ✓ |

**Gate 11 passes.** No blocking concerns.

## 7. Test baseline comparison

Pre-CQE (Docs/v5/cqe-test-baseline.md):
- 11 failed files, 38 failed tests, 647 passed files, 11817 passed tests

Post-CQE:
- 11 failed files, 38 failed tests, 650 passed files (+3), 11896 passed tests (+79)

**Zero regressions.** The +3 files and +79 tests are exactly the CQE additions. Every pre-existing failure is identical.

## 8. Semantic correctness table

8 representative phrases across the major pattern categories, exact extractor output vs fixture expectation.

| Input | Extracted (key fields) | Expected per fixtures | Match |
|---|---|---|---|
| `"set X to 0.9"` | value: 0.9, operator: set, direction: set, value_origin: literal | same | ✓ |
| `"Set speed to 0.9 and cost to 50000"` | [{value: 0.9, operator: set}, {value: 50000, operator: set}] | same | ✓ |
| `"a few options"` | value: null, approximate: true, value_origin: lexical_quantifier | same | ✓ |
| `"£1.5m budget"` | value: 1500000, unit: GBP, value_origin: suffix_expansion | same | ✓ |
| `"from £50k to £70k"` | value: 70000, range_min: 50000, range_max: 70000, operator: set, direction: up, unit: GBP | same | ✓ |
| `"reduce by a third"` | value: 0.333, operator: decrement, direction: down, value_origin: word_fraction | same | ✓ |
| `"increase by 5 percentage points"` | value: 5, unit: percentage_points, operator: increment, direction: up | same | ✓ |
| `"set the offset to -5"` | value: -5, operator: set, direction: set | same | ✓ |

## 9. Telemetry shipped

**Required (all shipped):**

| Field | Routing log | Event |
|---|---|---|
| duration_ms | ✓ | ✓ |
| timeout | ✓ | ✓ |
| result_count | ✓ | ✓ |
| cqe_match_count | ✓ | ✓ |
| compromise_match_count | ✓ | ✓ |
| word_range_missed | ✓ | ✓ |

**Nice-to-have (also shipped, per §7.2 split):**

| Field | Routing log | Event |
|---|---|---|
| message_length | ✓ | ✓ |
| patterns_matched | ✓ | deliberately excluded (cardinality) |
| message_too_long | ✓ | (event routing omits; emit payload carries it) |
| ambiguous_phrasing_detected | ✓ | (event routing omits; emit payload carries it) |

All 10 CQE fields land in the routing log. The Datadog routing case emits 7 high-signal fields; the other 3 are available on the emit payload but not routed to Datadog metrics (per proposal §7.2 rationale).

## 10. Divergences from brief

Three documented, none silent:

1. **Fixture E03** (`"The team grew by roughly half over the year"`). CQE Design §8.3 table abbreviated says `"0.5 multiply approximate"`. CQE Design §4.2 P5 rule says `operator: decrement/increment`. Our implementation follows §4.2 (operator: increment) and the fixture asserts only the fields consistent between the two (value, direction, approximate, value_origin). Note recorded in the fixture `notes` field.
2. **Fixture Q01** (`"Set churn to 5% and what's the impact?"`). CQE Design §8.9 table entry says `direction: down`. §4.3 verb-inference rule says "set" → `direction: set`. Our implementation follows §4.3; the fixture's `direction` expectation corrected to `set`. Design-doc inconsistency flagged.
3. **Fixture A03** (`"set churn to roughly 5% to 7%"`). Design §8.10 expects P2 to claim `5% to 7%` as a range before P12 claims `set churn to 5%`. Our execution order runs P12 before P2 to protect more-common shapes (`bring down to 4 months`). PoC limitation documented in fixture notes; a future rule-ordering revision could recover the range semantic.

## 11. Gate status

| # | Gate | Status | Evidence |
|---|---|---|---|
| 1 | No routing prompt loader | ✓ | `grep -rE "loadPrompt\|readPromptFile\|promptTemplate\|loadRoutingPrompt" src/ --exclude-dir=node_modules` returns 0 results |
| 2 | `ContextPack` stays local | ✓ | `grep -r "ContextPack" ~/Documents/GitHub/olumi-schemas/src/` returns 0 hits. Interface remains in `src/orchestrator-v5/context/context-pack-assembler.ts` |
| 3 | P11 structural rewrite | ✓ (rev2) | `rules.ts` defines three anchored sub-patterns — `P11_WITH_UNITS_CURRENCY_REGEX`, `P11_WITH_UNITS_SUFFIX_REGEX`, `P11_WITHOUT_UNITS_REGEX` — with code-side merge in `rule_P11.apply()`. No single regex with optional per-side unit alternation. (rev1 initially had a single regex; rev2 split it per ChatGPT review.) |
| 4 | Regex safety per-pattern | ✓ | P1/P2/P5/P8/P12 use bounded alternation and anchored lookbehinds per proposal §3.3; P11 split as above |
| 5 | No partial-result fallback | ✓ (rev2) | Rev2 adds immediate per-pattern telemetry (`cqe.pattern_timeout` with `pattern_id`) at the moment the circuit breaker trips, plus `__testForceTimeoutPatterns` hook and `extract-quantities.timeout.test.ts` (3 tests) proving all 5 points of Gate 5: telemetry emits pattern_id, no partial spans, later rules continue, compromise runs, global return is non-empty. |
| 6 | F.6 compliance | ✓ | `grep -r "contextPack.graph\|ContextPack\["graph"\]" src/orchestrator-v5/context/cqe/ --include="*.ts" --exclude-dir=__tests__` returns 0 hits. No graph access in production CQE code. |
| 7 | 68 fixtures pass + strict equality (rev2) | ✓ | `pnpm exec vitest run src/orchestrator-v5/context/cqe/__tests__/extract-quantities.test.ts` → 72/72 tests pass under strict deep-equality (exact count + positional ordering). Rev2 tightened from ≥N count matching. |
| 8 | Benchmark thresholds (rev2: explicit p95) | ✓ | See §5 above; `tests/benchmarks/cqe-results.md` now publishes explicit p95 numbers with breach-tolerance % (worst case -88% below target). |
| 9 | CI passes | ✓ | `tsc -p tsconfig.build.json --noEmit` clean. Full vitest suite: 11 failed files / 38 failed tests / 11900 passed — identical failure count to baseline, +83 passed (all new CQE tests). telemetry-validation CI: event name registered, propagates to `dist/.../telemetry.js` VALID_EVENT_NAMES. |
| 10 | Liveness integration (rev2: full chain) | ✓ | Rev2's 5th integration test exercises `assembleContextPack() → routeWithToolUse() → adapter.chatWithTools()` with a mock adapter that captures the Sonnet-facing user message and asserts `value_origin` survives. |
| 11 | Dependency audit | ✓ | `Docs/v5/cqe-dependency-audit.md`; all three new deps MIT, zero vulns, node-compatible |
| 13 (§13) | No `as unknown` / `as any` bypasses | ✓ (rev2) | `grep -rE "as unknown\|as any" src/orchestrator-v5/context/cqe/*.ts` returns zero production hits (only a comment explaining the `isMatch` helper). Rev2 removed 8 bypass casts by introducing a typed filter guard. |

## 12. Next step

**Ready for Paul review and staging deploy authorisation.**

Local branches:
- CEE: `claude/v5-cqe-investigation` (3 commits ahead of `main`: vendor bump, CQE module, telemetry)
- olumi-schemas: `claude/v5-cqe-investigation` (1 commit ahead of `main`: 0.6.0 bump)

Awaiting your review before authorising any push or staging deploy. Staging replay per brief §12 deferred until deploy authorisation.

---

*No push. Local-only feature branches. Awaiting review.*
