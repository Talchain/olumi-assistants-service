# V5/CEE post-draft coaching + terminology quick-fix

**Lane:** standalone V5/CEE quick-fix. NOT V6, NOT Wave 2, NOT Track S, NOT value-scale.
Disjoint from PR-A #270 / PR-D #271 / PR-C #272 / PR-B / Q2 / #259.
**Root-cause verification:** 2026-06-13. **Implementation:** 2026-06-14.
**Branch:** `claude/elastic-mahavira-579c1d`.

This lane implements the verified minimal fixes for two V6 Pass-1 audit findings,
treating the audit findings as **hypotheses**. One ("strengthen_items 100% silent
coaching loss") was verified as a **phantom** caused by a stale comment + audit
inference; the other (band-terminology leak) was **real**.

---

## 1. Root-cause summary

### Finding 1 — `strengthen_items` post-draft coaching loss → NOT REPRODUCED (phantom)

The audit hypothesised a `typeof item === 'string'` filter that "100% silently
dropped" object-shaped `strengthen_items`. Verification (read + triple-checked,
incl. one adversarial pass) found **no such filter anywhere in `src/`**:

- A full-repo grep for a whole-element string filter
  (`.(filter|map|forEach|some|every)(… typeof x === 'string')`) returns only an
  unrelated **edge** mapper (`src/orchestrator/turn-handler.ts:1254`). Every
  `typeof … === 'string'` near coaching is a correct **object-field** guard
  (`item.label`, `item.detail`, `first !== 'object'`) that *keeps* objects.
- The canonical shape is an **object** `{id, label, detail, action_type, bias_category?}`,
  zod-required at the V3 boundary (`src/schemas/cee-v3.ts:489`, `src/schemas/assist.ts:197`).
- Object-shaped items **survive end-to-end**:
  - Producer `extractStrengthenItems` (`src/orchestrator/tools/draft-graph.ts:701`) keeps objects.
  - **V5 served narrative:** `src/orchestrator-v5/handlers/draft-graph-dispatch.ts:177`
    → `buildPostDraftNarrative` → `pickStrengthenAssumption`
    (`src/orchestrator-v5/coaching/post-draft-narrative.ts:669`) reads
    `items[0].detail/.label` → "Assumption to check: …" bullet (+ one
    "Worth a look:" extra from a second item).
  - V4 wire: `narrowCoachingForResponse` + `convertStrengthenToGuidance`.
- **Why the audit fired:** a **stale comment** at
  `src/orchestrator-v5/handlers/draft-graph-dispatch.ts:23-25` still claimed
  `strengthen_items` "remain V4-only surface" — superseded by the
  `buildPostDraftNarrative` wiring ~150 lines below. The comment, read literally,
  reads as a total coaching loss; it is not.
- **Sibling-filter check (clean, no defect):** the string-only filters on
  `widening_log.elements_added` / `…_excluded` are contract-correct — those fields
  are `string[]` by schema (`src/orchestrator/types.ts:214-217`). `bias_signals`
  use an object guard — correct, they are objects by schema. No sibling
  shape-assumption defect exists.

→ No correctness bug. Smallest safe action: **regression tests that lock the
object-shaped survival contract** + **correct the stale comment**.

### Finding 2 — robustness/band terminology leak → REAL (one live VALUE site)

- The SSOT mapper already exists: `describeRobustnessBand`
  (`src/orchestrator-v5/coaching/robustness-honesty.ts:115`) →
  `highly_stable`→"very stable", `stable`→"stable", `moderate`→"fairly stable",
  `fragile`→"fragile", else `null`. Documented "Single source of truth — do NOT
  duplicate."
- **Live VALUE leak (1 site):** `src/orchestrator-v5/format/format-analysis-for-context.ts:137-138`
  passed the **raw** canonical band into the LLM-facing `DisplaySafeAnalysis.robustness_band`,
  which becomes `display_analysis` in the ContextPack and is **`JSON.stringify`'d
  into the prompt** (`src/orchestrator-v5/routing/route-with-tool-use.ts:760-763`).
  Sonnet could echo `highly_stable` verbatim. The global egress guard does **not**
  list band tokens (and must not be edited in this lane), so the fix must be at source.
- **Safe to fix here:** the deterministic composers (`explanation-fallback.ts`,
  `post-analysis-advice-gate.ts`, `chip-generator.ts`, `run-comparison-gate.ts`)
  read the **preserved raw** `ContextPackAnalysis` / `AnalysisProjectionSummary`,
  **not** `DisplaySafeAnalysis`. Mapping inside `formatAnalysisForContext` does not
  touch their enum switches. `robustness_band` is always canonical, so the SSOT is
  lossless over all real values.
- **Dead/gated, NOT in scope:** four V4-deterministic sites also interpolate the
  raw band (incl. `src/orchestrator/deterministic/actions/explain-result.ts:58`
  → `capitaliseFirst(robustness_band)` → "Highly_stable."). All under
  `CEE_PIPELINE_V4_ENABLED` (false → 410); unreachable on V5 → routed.

---

## 2. Minimal fix summary

1. **Band VALUE mapping at source** (`format-analysis-for-context.ts`): the canonical
   band enum is mapped to its plain-language phrase via the SSOT
   `describeRobustnessBand` before entering the LLM-facing projection; unmapped/
   unknown bands are omitted (no leak, no fabrication). Sonnet now sees
   `robustness_band: "very stable"`, never `"highly_stable"`. No mapping logic
   duplicated. The deterministic composers are unaffected (they read the raw slot).
2. **Stale-comment correction** (`draft-graph-dispatch.ts`): the "we drop
   strengthen_items / V4-only surface" comment now states that the raw object-shaped
   `strengthen_items` ARE consumed by `buildPostDraftNarrative`; only the *structured*
   V4 wire field / guidance chips remain V4-only. Prevents the next audit from
   re-raising the phantom.

No graph-mutation / persistence / analysis / schema / prompt / PMS / egress-list /
value-scale / PLoT / ISL changes.

---

## 3. Changed files

| File | Change |
|------|--------|
| `src/orchestrator-v5/format/format-analysis-for-context.ts` | Map band VALUE via SSOT `describeRobustnessBand` (+ import, + field doc). |
| `src/orchestrator-v5/handlers/draft-graph-dispatch.ts` | Correct stale "strengthen_items V4-only" comment. |
| `src/orchestrator-v5/format/__tests__/format-analysis-for-context.test.ts` | Replace verbatim-passthrough test with SSOT-mapping + no-raw-token regression tests; fix full-analysis expectation. |
| `src/orchestrator-v5/coaching/__tests__/post-draft-narrative.test.ts` | New "shape robustness (lane lock)" block: object survival + string/invalid/null graceful handling; sibling-filter conclusion documented inline. |
| `src/orchestrator-v5/context/__tests__/context-pack-assembler.test.ts` | Update `display_analysis.robustness_band` assertion to the mapped phrase; assert raw is preserved on `analysis`; add no-raw-band-token boundary invariant. |

(No changes to `package.json` / `pnpm-lock.yaml`. A local `pnpm install` was run only
to restore an incomplete vendored dependency — `suffix-thumb`, a `compromise`
transitive — so the assembler suite could load; the resulting `node_modules` churn is
NOT committed.)

---

## 4. Tests run and results

Runner: `node <main-checkout vitest.mjs> run <files>` from the worktree (the worktree
`.bin/vitest` shim was stale).

| Suite | Result |
|-------|--------|
| `format-analysis-for-context.test.ts` | **20 passed** (incl. new band-map + no-`highly_stable`-leak + unknown-omit) |
| `post-draft-narrative.test.ts` | **106 passed** (incl. new shape-robustness lane lock) |
| `context-pack-assembler.test.ts` | **47 passed** (incl. updated display/raw band assertions + no-token invariant) |
| `robustness-honesty.test.ts` | **31 passed** |
| `post-analysis-advice-gate.test.ts` | **245 passed** (composer reading raw band — not regressed) |
| `explanation-fallback.test.ts` | passed (composer reading raw band — not regressed) |
| `projection-summaries.test.ts` | passed (raw projection preserved) |
| `raw-robustness-gate-integration.test.ts` | passed |
| `tests/unit/draft-coaching-narrow.test.ts` | passed |
| `tests/unit/boundary.coaching-preservation.test.ts` | **6 passed** |

Composer/coaching regression batch (advice-gate + explanation-fallback +
projection-summaries + raw-robustness + draft-coaching-narrow + boundary): **308 passed**.

**Typecheck:** `tsc --noEmit` reports **zero errors in all 5 touched files**. The
project-wide pre-existing errors are environmental (`src/generated/openapi.d.ts` not
generated in the worktree; unrelated `any`-param strictness) and exist on the base.

---

## 5. Expanded leak-scan results

Scanned: served composers (`orchestrator-v5/coaching`, `tools/handlers`, `routing`),
the LLM/display context path (`format/`, `context/`), touched test fixtures, and the
available baseline harness (`~/draft-graph-audit-2026-06-11/`, `~/.claude/plans/lane-v6-*`).

| Pattern | Result |
|---------|--------|
| `highly_stable` / `very_high` / `very_low` in served prose | **No leak.** Only a guard constant (`STABLE_ROBUSTNESS_BANDS` Set, `explanation-fallback.ts:58`) and design comments. The `format-analysis-for-context` VALUE vector is now closed. |
| literal "robustness band" in prose | **No leak.** Only docstrings explaining the SSOT mapping. |
| snake_case band labels / raw enum labels in served output | **No leak.** |
| internal ID prefixes (`fac_/opt_/risk_/out_/dec_/goal_/node_`) in served prose | **No leak.** Grep hits were `goal_label`/`label_from` *variable names* reading user labels, not leaked IDs. |
| `_meta` / `graph_hash` in served-copy builders | **None** (egress guard backstops anyway). |
| Baseline harness captures (multi-scenario) | Band tokens appear ONLY as structured **analysis state** (e.g. `"robustness_band": "moderate"`), **never** inside any `assistant_text`/narrative string. No served-output leak. |
| Sanity: new whole-element string filter introduced? | **None** — the only such filter remains the pre-existing unrelated edge-mapper. |

**Context-key class audit (user-requested):** the LLM is shown the ContextPack as
`JSON.stringify(llmFacing)`. Top-level keys: `version, scenario_id, stage, graph,
analysis, conversation, recent_changes, coaching, compound_detected,
compound_segments, compound_pattern_matched, …`; inside `analysis` (display):
`status, leading_option, runner_up, margin, robustness_band, top_drivers,
fragile_edges`. The standout internal-jargon, value-bearing key is **`robustness_band`**
(echoable as "robustness band"). The rest are either natural (`leading_option`,
`win_probability`, `margin`, `top_drivers`, `fragile_edges`) or ID/flag values
unlikely to surface as prose. → registered as a routed context-key-class follow-up.

---

## 6. `robustness_band` key-name issue — FIXED or ROUTED?

**ROUTED (context-contract follow-up).** Mapping the VALUE is necessary but not
sufficient: the LLM is still literally shown the **key** `robustness_band` in the
stringified ContextPack and could echo "robustness band".

- Acceptance option (a) — make the key user-safe in-lane without
  schema/prompt/PMS/context-contract changes — is **not provably safe here**. The
  LLM-facing key set is deliberately mirrored to the raw analysis field names "so
  prompt instructions referencing … analysis fields continue to resolve"
  (`route-with-tool-use.ts:748-750`). The routing prompt is **PMS-served**
  (`LOADED_PROMPT`); the repo fallback prompts contain zero `robustness_band`
  references, but the PMS-served prompt cannot be inspected or edited in this lane.
  Renaming the key therefore risks a silent prompt↔context desync that cannot be
  tested in-lane.
- Acceptance option (b) — route it — is taken. The VALUE leak (the worse,
  snake_case enum `highly_stable`) is closed in-lane; the KEY-name residual is
  documented and routed.

We explicitly do **not** claim closure from sampled outputs: the durable fact is that
the LLM is **still shown the internal key `robustness_band`**. Closing it requires a
context-contract change coordinated with the PMS routing prompt — out of this lane.

---

## 7. Boundary confirmations

No changes were made to: prompts / PMS; the global egress forbidden-phrase list;
value-scale egress; Track S value-scale; PLoT/ISL contracts; schema / OpenAPI /
migrations / persistence / Supabase writes; V6 benchmark work. No Codex was requested
or run. Not bundled with Wave 2, PR-A #270, PR-D #271, PR-C #272, PR-B, Q2, #259, or
Track S. No graph mutation, analysis execution, or persistence behaviour changed.

---

## 8. Routed follow-ups

1. **`robustness_band` key-name (context-contract).** Make the LLM-facing analysis
   key user-safe (e.g. `stability`), coordinated with the PMS routing prompt /
   LLM-facing context contract. Also audit the full llmFacing key set for other
   internal-jargon keys (the context-key class).
2. **V4-deterministic band-leak sites** (`explain-result.ts` `capitaliseFirst`,
   `explanation-templater.ts`, `llm-prompt.ts`, `prompt-builder-v2.ts`) — dead/gated
   (`CEE_PIPELINE_V4_ENABLED=false`); fix only if V4 is ever re-enabled.
3. **V5 structured strengthen_items surface.** V5 surfaces `strengthen_items` only as
   prose (assumption bullet + one extra), not as the structured V4 wire field /
   guidance chips. Surfacing them is a schema/composer change → coaching-surface lane.
4. **Band-map consolidation.** `run-comparison-gate.ts` keeps a local `bandPhrase`
   duplicating the SSOT intent — an existing tracked consolidation follow-up.
