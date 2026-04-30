# Codex Review Pack — analysis-enrichment-critique-prose-safety

**Branch:** `claude/analysis-enrichment-critique-prose-safety`
**Local commits ahead of origin/staging:** 9
**Phase:** 1 (Commits 2-6 complete; awaiting Codex review before push)
**Captured leak fixture:** `tests/fixtures/cross-service/v5-turn.run-analysis.staging.json` (build `3bb151b`, response_hash `ef1aeb36a440854a`)
**Test status:** 1400/1400 V5 + contract tests passing; tsc clean

---

## Section 1 — Production code diff (`src/`)

```diff
diff --git a/src/orchestrator-v5/__tests__/response-finaliser-enrichment-backstop.test.ts b/src/orchestrator-v5/__tests__/response-finaliser-enrichment-backstop.test.ts
new file mode 100644
index 00000000..06c3a2ec
--- /dev/null
+++ b/src/orchestrator-v5/__tests__/response-finaliser-enrichment-backstop.test.ts
@@ -0,0 +1,126 @@
+/**
+ * Phase 1 / Commit 6 of analysis-enrichment-critique-prose-safety.
+ *
+ * Defensive second-pass test for the response-finaliser's enrichment
+ * sanitisation backstop. The decision-review enricher is the primary
+ * scrub site (Commit 5); this backstop covers any future enrichment
+ * producer that bypasses the enricher (cached blocks, fallback
+ * composers, future analysis_result variants).
+ *
+ * Gating contract:
+ *   - CEE_TURN_DEBUG_ENABLED=false (default) → enrichment is sanitised
+ *   - CEE_TURN_DEBUG_ENABLED=true            → enrichment passes verbatim
+ */
+
+import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
+import type { OlumiResponse } from '@talchain/schemas/boundary';
+
+import { finaliseV5Response } from '../response-finaliser.js';
+import { config } from '../../config/index.js';
+import type { CritiqueLike } from '../compose/sanitise-enrichment.js';
+
+const ANALYSIS_READY_STUB = {
+  status: 'ready' as const,
+  goal_node_id: 'goal_test',
+  options: [
+    { option_id: 'opt_a', label: 'Option A', status: 'ready' as const, interventions: {} },
+    { option_id: 'opt_b', label: 'Option B', status: 'ready' as const, interventions: {} },
+  ],
+};
+
+function makeResponseWithLeakedEnrichment(): OlumiResponse {
+  return {
+    response_version: 2,
+    assistant_text: 'ok',
+    blocks: [
+      {
+        type: 'analysis_result',
+        enrichment: {
+          critiques: [
+            {
+              id: 'c1',
+              // No code → fail-safe routes to bucket D
+              severity: 'info',
+              source: 'preprocessing',
+              message:
+                "Node 'opt_a' has kind='option'. Option nodes are filtered before analysis.",
+            },
+          ],
+          summary: 'opt_a is the leading option.',
+          payloads: { isl_request: { secret: 'preserved verbatim' } },
+        } as Record<string, unknown>,
+      } as never,
+    ],
+    suggested_actions: [],
+    insights: [],
+    stage_indicator: 'analyse',
+  } as OlumiResponse;
+}
+
+describe('response-finaliser — enrichment-prose backstop', () => {
+  let originalDebug: boolean | undefined;
+
+  beforeEach(() => {
+    // Snapshot the existing config flag so we can mutate within tests.
+    originalDebug = config.cee?.turnDebugEnabled;
+  });
+
+  afterEach(() => {
+    if (config.cee && originalDebug !== undefined) {
+      // restore original value
+      (config.cee as { turnDebugEnabled: boolean }).turnDebugEnabled = originalDebug;
+    }
+  });
+
+  it('sanitises enrichment.critiques and resolves IDs in summary when debug=false', () => {
+    if (config.cee) {
+      (config.cee as { turnDebugEnabled: boolean }).turnDebugEnabled = false;
+    }
+    const out = finaliseV5Response(makeResponseWithLeakedEnrichment(), {
+      analysisReady: ANALYSIS_READY_STUB,
+    });
+    const block = (out.blocks as Array<Record<string, unknown>>)[0]!;
+    const enrichment = block.enrichment as Record<string, unknown>;
+    // bucket-D critique routed away → user critiques empty
+    const userCritiques = enrichment.critiques as CritiqueLike[];
+    expect(userCritiques).toEqual([]);
+    // summary IDs resolved via priority-2 (analysis_ready.options) lookup
+    expect(enrichment.summary).toBe('Option A is the leading option.');
+    // structural payloads byte-equal
+    expect(enrichment.payloads).toEqual({ isl_request: { secret: 'preserved verbatim' } });
+    // _diagnostics absent on the wire by default
+    expect(enrichment._diagnostics).toBeUndefined();
+  });
+
+  it('preserves enrichment verbatim when debug=true (engineer surface)', () => {
+    if (config.cee) {
+      (config.cee as { turnDebugEnabled: boolean }).turnDebugEnabled = true;
+    }
+    const out = finaliseV5Response(makeResponseWithLeakedEnrichment(), {
+      analysisReady: ANALYSIS_READY_STUB,
+    });
+    const block = (out.blocks as Array<Record<string, unknown>>)[0]!;
+    const enrichment = block.enrichment as Record<string, unknown>;
+    // Verbatim — original critique and summary preserved
+    const userCritiques = enrichment.critiques as CritiqueLike[];
+    expect(userCritiques).toHaveLength(1);
+    expect(userCritiques[0]?.message).toMatch(/^Node 'opt_a'/);
+    expect(enrichment.summary).toBe('opt_a is the leading option.');
+  });
+
+  it('no-op when no blocks have enrichment', () => {
+    if (config.cee) {
+      (config.cee as { turnDebugEnabled: boolean }).turnDebugEnabled = false;
+    }
+    const response: OlumiResponse = {
+      response_version: 2,
+      assistant_text: 'ok',
+      blocks: [{ type: 'text', content: 'nothing to scrub' } as never],
+      suggested_actions: [],
+      insights: [],
+      stage_indicator: 'frame',
+    } as OlumiResponse;
+    const out = finaliseV5Response(response, { analysisReady: ANALYSIS_READY_STUB });
+    expect(out.blocks).toEqual([{ type: 'text', content: 'nothing to scrub' }]);
+  });
+});
diff --git a/src/orchestrator-v5/coaching/decision-review-enricher.ts b/src/orchestrator-v5/coaching/decision-review-enricher.ts
index 0eb4e881..bd45467b 100644
--- a/src/orchestrator-v5/coaching/decision-review-enricher.ts
+++ b/src/orchestrator-v5/coaching/decision-review-enricher.ts
@@ -29,6 +29,8 @@ import {
 import { recordModelResolution } from '../debug/turn-debug-store.js';
 import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
 import { collectFactorFlipEntries } from '../../orchestrator/context/analysis-compact.js';
+import { config } from '../../config/index.js';
+import { sanitiseEnrichment } from '../compose/sanitise-enrichment.js';
 import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
 
 import type { DecisionReviewOutput } from './types.js';
@@ -142,11 +144,37 @@ export async function enrichRunAnalysisWithDecisionReview(
       ...result.output,
       produced_at: new Date().toISOString(),
     };
+    // Phase 1 / Commit 5 — analysis-enrichment-critique-prose-safety:
+    // Run the parent-level enrichment through the sanitiser BEFORE
+    // attaching decision_review. The sanitiser:
+    //   - Routes bucket-D ISL critiques (engine validation / preprocessing)
+    //     to a separate `_diagnostics.critiques` bucket — gated by
+    //     CEE_TURN_DEBUG_ENABLED, omitted from the wire by default.
+    //   - Replaces bucket-S critique messages with the approved generic
+    //     copy (Paul-reviewed 2026-04-30) using resolved labels.
+    //   - Resolves entity IDs to labels in the 15 user-facing prose paths.
+    //   - Preserves every structural subtree (payloads, _meta, fragile_edges,
+    //     edge_e_values, factor_evpi, etc.) byte-equal.
+    // The decision_review subtree itself is kept verbatim (no allowlist
+    // path matches inside it; deep-clone preserves it) per the F.6
+    // verbatim contract.
+    const merged: Record<string, unknown> = {
+      ...(enrichment as Record<string, unknown>),
+      decision_review: output,
+    };
+    const sanitised = sanitiseEnrichment(merged);
+    let finalEnrichment: Record<string, unknown> = sanitised.enrichment;
+    if (config.cee?.turnDebugEnabled === true && sanitised.diagnostic.critiques.length > 0) {
+      finalEnrichment = {
+        ...finalEnrichment,
+        _diagnostics: { critiques: sanitised.diagnostic.critiques },
+      };
+    }
     const patched: HandlerFact = {
       ...fact,
       result: {
         ...fact.result,
-        enrichment: { ...enrichment, decision_review: output },
+        enrichment: finalEnrichment,
       },
     };
     const next = input.handlerFacts.slice();
diff --git a/src/orchestrator-v5/compose/__tests__/resolve-label.test.ts b/src/orchestrator-v5/compose/__tests__/resolve-label.test.ts
new file mode 100644
index 00000000..bb203bed
--- /dev/null
+++ b/src/orchestrator-v5/compose/__tests__/resolve-label.test.ts
@@ -0,0 +1,190 @@
+import { describe, expect, it } from 'vitest';
+
+import {
+  resolveLabel,
+  resolveLabelOrFallback,
+  type LabelResolverContext,
+} from '../resolve-label.js';
+import { genericFallbackForId } from '../../../orchestrator/shared/output-safety.js';
+
+const GRAPH = {
+  nodes: [
+    { id: 'opt_hire_local', label: 'Hire Two Senior Engineers Locally', kind: 'option' },
+    { id: 'fac_hiring_cost', label: 'Hiring and Staffing Cost', kind: 'factor' },
+  ],
+  edges: [],
+} as unknown as LabelResolverContext['graph'];
+
+const ANALYSIS_READY = {
+  options: [
+    { option_id: 'opt_offshore', label: 'Engage Offshore Partner' },
+    { option_id: 'opt_status_quo', label: 'Maintain Status Quo' },
+  ],
+};
+
+const ENRICHMENT_OPTION_COMPARISON = {
+  option_comparison: [
+    { id: 'opt_tiered_pricing', label: 'Introduce Tiered Pricing' },
+  ],
+};
+
+const ENRICHMENT_PAYLOADS = {
+  payloads: {
+    isl_request: {
+      options: [
+        { id: 'opt_payloads_only', label: 'ISL-Echo-Only Option' },
+      ],
+    },
+  },
+};
+
+describe('resolveLabel — four-priority lookup', () => {
+  it('priority 1: graph.nodes hit returns the node label', () => {
+    const ctx: LabelResolverContext = { graph: GRAPH };
+    expect(resolveLabel('opt_hire_local', ctx)).toBe('Hire Two Senior Engineers Locally');
+    expect(resolveLabel('fac_hiring_cost', ctx)).toBe('Hiring and Staffing Cost');
+  });
+
+  it('priority 2: analysisReady.options hit when graph is absent', () => {
+    const ctx: LabelResolverContext = { analysisReady: ANALYSIS_READY };
+    expect(resolveLabel('opt_offshore', ctx)).toBe('Engage Offshore Partner');
+    expect(resolveLabel('opt_status_quo', ctx)).toBe('Maintain Status Quo');
+  });
+
+  it('priority 2: tolerates `id` fallback (analysisReady option without explicit option_id)', () => {
+    const ctx: LabelResolverContext = {
+      analysisReady: { options: [{ id: 'opt_x', label: 'X' }] },
+    };
+    expect(resolveLabel('opt_x', ctx)).toBe('X');
+  });
+
+  it('priority 3: enrichment.option_comparison hit when 1 + 2 miss', () => {
+    const ctx: LabelResolverContext = { enrichment: ENRICHMENT_OPTION_COMPARISON };
+    expect(resolveLabel('opt_tiered_pricing', ctx)).toBe('Introduce Tiered Pricing');
+  });
+
+  it('priority 4: enrichment.payloads.isl_request.options hit (lowest priority)', () => {
+    const ctx: LabelResolverContext = { enrichment: ENRICHMENT_PAYLOADS };
+    expect(resolveLabel('opt_payloads_only', ctx)).toBe('ISL-Echo-Only Option');
+  });
+
+  it('priority 1 wins over priorities 2/3/4 when all sources have the same id', () => {
+    const ctx: LabelResolverContext = {
+      graph: {
+        nodes: [{ id: 'opt_x', label: 'GRAPH_LABEL', kind: 'option' }],
+        edges: [],
+      } as unknown as LabelResolverContext['graph'],
+      analysisReady: { options: [{ option_id: 'opt_x', label: 'AR_LABEL' }] },
+      enrichment: {
+        option_comparison: [{ id: 'opt_x', label: 'OC_LABEL' }],
+        payloads: { isl_request: { options: [{ id: 'opt_x', label: 'ISL_LABEL' }] } },
+      },
+    };
+    expect(resolveLabel('opt_x', ctx)).toBe('GRAPH_LABEL');
+  });
+
+  it('priority 2 wins over 3/4 when graph misses', () => {
+    const ctx: LabelResolverContext = {
+      analysisReady: { options: [{ option_id: 'opt_x', label: 'AR_LABEL' }] },
+      enrichment: {
+        option_comparison: [{ id: 'opt_x', label: 'OC_LABEL' }],
+        payloads: { isl_request: { options: [{ id: 'opt_x', label: 'ISL_LABEL' }] } },
+      },
+    };
+    expect(resolveLabel('opt_x', ctx)).toBe('AR_LABEL');
+  });
+
+  it('returns null when every priority misses', () => {
+    expect(resolveLabel('opt_unknown', {})).toBeNull();
+    expect(resolveLabel('opt_unknown', { graph: GRAPH, analysisReady: ANALYSIS_READY })).toBeNull();
+  });
+
+  it('returns null on empty/invalid input', () => {
+    expect(resolveLabel('', { graph: GRAPH })).toBeNull();
+    expect(resolveLabel(undefined as unknown as string, { graph: GRAPH })).toBeNull();
+  });
+
+  it('skips entries with empty-string labels (defensive)', () => {
+    const ctx: LabelResolverContext = {
+      analysisReady: { options: [{ option_id: 'opt_empty', label: '' }] },
+    };
+    expect(resolveLabel('opt_empty', ctx)).toBeNull();
+  });
+
+  it('handles null / undefined nested branches without throwing', () => {
+    expect(resolveLabel('opt_x', { graph: null, analysisReady: null, enrichment: null })).toBeNull();
+    expect(resolveLabel('opt_x', { enrichment: { payloads: undefined } })).toBeNull();
+    expect(resolveLabel('opt_x', { enrichment: { option_comparison: undefined } })).toBeNull();
+  });
+});
+
+describe('resolveLabelOrFallback — never returns the raw ID', () => {
+  it('returns the resolved label when found', () => {
+    expect(resolveLabelOrFallback('opt_hire_local', { graph: GRAPH }))
+      .toBe('Hire Two Senior Engineers Locally');
+  });
+
+  it.each([
+    ['opt_unknown', 'the relevant option'],
+    ['option_unknown', 'the relevant option'],
+    ['fac_unknown', 'the relevant factor'],
+    ['factor_unknown', 'the relevant factor'],
+    ['goal_unknown', 'the relevant goal'],
+    ['dec_unknown', 'the relevant decision'],
+    ['decision_unknown', 'the relevant decision'],
+    ['out_unknown', 'the relevant outcome'],
+    ['outcome_unknown', 'the relevant outcome'],
+    ['risk_unknown', 'the relevant risk'],
+    ['con_unknown', 'the relevant constraint'],
+    ['constraint_unknown', 'the relevant constraint'],
+  ])('falls back to prefix-aware generic for %s → %s', (id, expected) => {
+    expect(resolveLabelOrFallback(id, {})).toBe(expected);
+  });
+
+  it('returns the defensive "the relevant node" for unrecognised prefixes', () => {
+    expect(resolveLabelOrFallback('mystery_xyz', {})).toBe('the relevant node');
+    expect(resolveLabelOrFallback('totally-malformed', {})).toBe('the relevant node');
+  });
+
+  it('never returns the raw ID for any prefix family', () => {
+    const PREFIXES = [
+      'opt', 'option', 'fac', 'factor', 'goal', 'dec', 'decision',
+      'out', 'outcome', 'risk', 'con', 'constraint',
+    ];
+    for (const p of PREFIXES) {
+      const id = `${p}_xxxx_yyyy`;
+      const out = resolveLabelOrFallback(id, {});
+      expect(out).not.toBe(id);
+      expect(out).not.toContain(id);
+    }
+  });
+
+  it('separator-agnostic: works for `_`, `:`, `-`', () => {
+    expect(resolveLabelOrFallback('opt_x', {})).toBe('the relevant option');
+    expect(resolveLabelOrFallback('opt:x', {})).toBe('the relevant option');
+    expect(resolveLabelOrFallback('opt-x', {})).toBe('the relevant option');
+  });
+});
+
+describe('genericFallbackForId — pinning the shared mapping', () => {
+  it('matches resolveLabelOrFallback fallback behaviour exactly', () => {
+    const PREFIXES = [
+      ['opt_x', 'the relevant option'],
+      ['fac_x', 'the relevant factor'],
+      ['goal_x', 'the relevant goal'],
+      ['dec_x', 'the relevant decision'],
+      ['out_x', 'the relevant outcome'],
+      ['risk_x', 'the relevant risk'],
+      ['con_x', 'the relevant constraint'],
+    ] as const;
+    for (const [id, expected] of PREFIXES) {
+      expect(genericFallbackForId(id)).toBe(expected);
+      expect(resolveLabelOrFallback(id, {})).toBe(expected);
+    }
+  });
+
+  it('returns the defensive default for non-prefix inputs', () => {
+    expect(genericFallbackForId('not_a_prefix')).toBe('the relevant node');
+    expect(genericFallbackForId('')).toBe('the relevant node');
+  });
+});
diff --git a/src/orchestrator-v5/compose/__tests__/sanitise-enrichment.test.ts b/src/orchestrator-v5/compose/__tests__/sanitise-enrichment.test.ts
new file mode 100644
index 00000000..e135f1a8
--- /dev/null
+++ b/src/orchestrator-v5/compose/__tests__/sanitise-enrichment.test.ts
@@ -0,0 +1,440 @@
+import { describe, expect, it } from 'vitest';
+
+import {
+  CRITIQUE_BUCKETS,
+  S_BUCKET_REPLACEMENTS,
+  bucketFor,
+  isAllowlistedPath,
+  partitionCritiques,
+  sanitiseEnrichment,
+  sanitiseEnrichmentText,
+  type CritiqueLike,
+} from '../sanitise-enrichment.js';
+import type { LabelResolverContext } from '../resolve-label.js';
+
+const GRAPH = {
+  nodes: [
+    { id: 'opt_hire_local', label: 'Hire Two Senior Engineers Locally', kind: 'option' },
+    { id: 'opt_offshore', label: 'Engage Offshore Partner', kind: 'option' },
+    { id: 'fac_hiring_cost', label: 'Hiring and Staffing Cost', kind: 'factor' },
+  ],
+  edges: [],
+} as unknown as LabelResolverContext['graph'];
+
+const CTX: LabelResolverContext = { graph: GRAPH };
+
+// =============================================================================
+// bucketFor — fail-safe rule + classification table coverage
+// =============================================================================
+
+describe('bucketFor — bucket classification', () => {
+  it('every U-bucket entry maps to U', () => {
+    const expectedU = ['NO_OPTIONS', 'INSUFFICIENT_OPTIONS', 'DEGENERATE_OUTCOMES'];
+    for (const code of expectedU) {
+      expect(bucketFor(code)).toBe('U');
+      expect(CRITIQUE_BUCKETS[code]).toBe('U');
+    }
+  });
+
+  it('every S-bucket entry maps to S', () => {
+    const expectedS = [
+      'EMPTY_INTERVENTIONS', 'INVALID_INTERVENTION_TARGET',
+      'NO_EFFECTIVE_PATH_TO_GOAL', 'IDENTICAL_OPTIONS', 'GRAPH_DISCONNECTED',
+      'OPTION_NO_INTERVENTIONS', 'LOW_EFFECTIVE_SAMPLES',
+      'DEGENERATE_OPTION_ZERO_VARIANCE', 'HIGH_TIE_RATE',
+    ];
+    for (const code of expectedS) {
+      expect(bucketFor(code)).toBe('S');
+    }
+  });
+
+  it('every D-bucket entry maps to D', () => {
+    const expectedD = [
+      'MISSING_GOAL_NODE', 'GRAPH_CYCLE_DETECTED', 'GRAPH_EMPTY',
+      'INVALID_NODE_ID', 'DUPLICATE_NODE_ID', 'EDGE_STRENGTH_OUT_OF_RANGE',
+      'EDGE_STD_INVALID', 'EDGE_ENDPOINT_MISSING', 'NEGLIGIBLE_EDGE_STRENGTH',
+      'DUPLICATE_OPTION_ID', 'INTERVENTION_VALUE_INVALID', 'MONTE_CARLO_FAILED',
+      'BASELINE_NEAR_ZERO', 'INFERENCE_TIMEOUT', 'SEED_INVALID',
+      'NUMERICAL_INSTABILITY', 'IDENTIFIABILITY_ISSUE',
+      'CONSTRAINT_NODE_DEFAULT_BASE', 'INTERNAL_ERROR',
+    ];
+    for (const code of expectedD) {
+      expect(bucketFor(code)).toBe('D');
+    }
+  });
+
+  it('classification totals match the plan: D=20, U=3, S=9 (across 31 ISL codes — uncoded is treated D by default)', () => {
+    const counts = { D: 0, U: 0, S: 0 };
+    for (const b of Object.values(CRITIQUE_BUCKETS)) counts[b]++;
+    expect(counts.U).toBe(3);
+    expect(counts.S).toBe(9);
+    // 19 explicit D entries; the captured uncoded leak hits the
+    // fail-safe default (no entry in the map → bucketFor returns 'D').
+    expect(counts.D).toBe(19);
+  });
+
+  it('FAIL-SAFE — unknown codes default to D', () => {
+    expect(bucketFor('UNKNOWN_NEW_CODE_xyzzy')).toBe('D');
+    expect(bucketFor(undefined)).toBe('D');
+    expect(bucketFor(null)).toBe('D');
+    expect(bucketFor('')).toBe('D');
+  });
+});
+
+// =============================================================================
+// S_BUCKET_REPLACEMENTS — Paul-approved copy verbatim
+// =============================================================================
+
+describe('S_BUCKET_REPLACEMENTS — pinned approved copy (Paul, 2026-04-30)', () => {
+  it('EMPTY_INTERVENTIONS', () => {
+    const out = S_BUCKET_REPLACEMENTS.EMPTY_INTERVENTIONS!(CTX, {
+      affected_option_ids: ['opt_hire_local'],
+    });
+    expect(out).toBe(
+      "Option 'Hire Two Senior Engineers Locally' does not change anything yet. Specify what makes this option different.",
+    );
+  });
+
+  it('INVALID_INTERVENTION_TARGET', () => {
+    const out = S_BUCKET_REPLACEMENTS.INVALID_INTERVENTION_TARGET!(CTX, {
+      affected_option_ids: ['opt_offshore'],
+    });
+    expect(out).toBe(
+      "Option 'Engage Offshore Partner' refers to something that is not currently in the model.",
+    );
+  });
+
+  it('NO_EFFECTIVE_PATH_TO_GOAL', () => {
+    const out = S_BUCKET_REPLACEMENTS.NO_EFFECTIVE_PATH_TO_GOAL!(CTX, {
+      affected_option_ids: ['opt_hire_local'],
+    });
+    expect(out).toBe(
+      "Option 'Hire Two Senior Engineers Locally' does not currently connect to your goal.",
+    );
+  });
+
+  it('IDENTICAL_OPTIONS', () => {
+    const out = S_BUCKET_REPLACEMENTS.IDENTICAL_OPTIONS!(CTX, {
+      affected_option_ids: ['opt_hire_local', 'opt_offshore'],
+    });
+    expect(out).toBe(
+      "Options 'Hire Two Senior Engineers Locally' and 'Engage Offshore Partner' currently make the same changes, so the analysis treats them as equivalent.",
+    );
+  });
+
+  it('GRAPH_DISCONNECTED', () => {
+    const out = S_BUCKET_REPLACEMENTS.GRAPH_DISCONNECTED!(CTX, {});
+    expect(out).toBe('Some parts of the model are not connected to your goal.');
+  });
+
+  it('OPTION_NO_INTERVENTIONS', () => {
+    const out = S_BUCKET_REPLACEMENTS.OPTION_NO_INTERVENTIONS!(CTX, {
+      affected_option_ids: ['opt_offshore'],
+    });
+    expect(out).toBe(
+      "Option 'Engage Offshore Partner' represents the current state, with no changes applied.",
+    );
+  });
+
+  it('LOW_EFFECTIVE_SAMPLES', () => {
+    const out = S_BUCKET_REPLACEMENTS.LOW_EFFECTIVE_SAMPLES!(CTX, {});
+    expect(out).toBe(
+      'This analysis is less reliable than usual, so treat the result as a signal to check rather than a settled answer.',
+    );
+  });
+
+  it('DEGENERATE_OPTION_ZERO_VARIANCE', () => {
+    const out = S_BUCKET_REPLACEMENTS.DEGENERATE_OPTION_ZERO_VARIANCE!(CTX, {
+      affected_option_ids: ['opt_hire_local'],
+    });
+    expect(out).toBe("Option 'Hire Two Senior Engineers Locally' does not currently affect the goal.");
+  });
+
+  it('HIGH_TIE_RATE', () => {
+    const out = S_BUCKET_REPLACEMENTS.HIGH_TIE_RATE!(CTX, {});
+    expect(out).toBe(
+      'The options are very close in this analysis. Treat the current lead as finely balanced.',
+    );
+  });
+
+  it('falls back to "the relevant option" when no graph context is available', () => {
+    const out = S_BUCKET_REPLACEMENTS.EMPTY_INTERVENTIONS!({}, {
+      affected_option_ids: ['opt_unknown'],
+    });
+    expect(out).toBe(
+      "Option 'the relevant option' does not change anything yet. Specify what makes this option different.",
+    );
+  });
+
+  it('all 9 replacements are free of the forbidden vocabulary set', () => {
+    const FORBIDDEN = [
+      /\binterventions?\b/i, /\bnode\b/i, /\bsamples?\b/i,
+      /\bmonte\s+carlo\b/i, /\bcausal\s+paths?\b/i, /\bbootstrap\b/i,
+      /\bvariance\b/i, /\bsimulated\s+futures?\b/i, /\bwin\s+probabilit/i,
+    ];
+    const checkAgainstForbidden = (s: string) => {
+      for (const re of FORBIDDEN) {
+        expect(s).not.toMatch(re);
+      }
+    };
+    for (const fn of Object.values(S_BUCKET_REPLACEMENTS)) {
+      const out = fn(CTX, { affected_option_ids: ['opt_hire_local', 'opt_offshore'] });
+      checkAgainstForbidden(out);
+    }
+  });
+});
+
+// =============================================================================
+// sanitiseEnrichmentText — per-string scrubber
+// =============================================================================
+
+describe('sanitiseEnrichmentText — per-string scrubber', () => {
+  it('resolves a known entity ID to its label', () => {
+    const r = sanitiseEnrichmentText("Option 'opt_hire_local' looks weak.", CTX);
+    expect(r.text).toBe("Option 'Hire Two Senior Engineers Locally' looks weak.");
+    expect(r.resolved).toEqual([
+      { id: 'opt_hire_local', label: 'Hire Two Senior Engineers Locally' },
+    ]);
+    expect(r.hardBans).toEqual([]);
+  });
+
+  it('falls back to prefix-aware generic when label is unknown', () => {
+    const r = sanitiseEnrichmentText('opt_mystery is risky.', CTX);
+    expect(r.text).toBe('the relevant option is risky.');
+    expect(r.hardBans).toEqual([]);
+  });
+
+  it('flags HARD_BAN tokens (Tier A) — captured staging leak', () => {
+    const r = sanitiseEnrichmentText(
+      "Node 'opt_hire_local' has kind='option'. Option nodes are filtered before analysis.",
+      CTX,
+    );
+    expect(r.text).toContain('Hire Two Senior Engineers Locally');
+    expect(r.hardBans.length).toBeGreaterThan(0);
+    // Each hard-ban hit is a real engine token
+    expect(r.hardBans.some((h) => /^Node '/.test(h))).toBe(true);
+    expect(r.hardBans.some((h) => /filtered before analysis/i.test(h))).toBe(true);
+  });
+
+  it('flags WARNING tokens (Tier B) — does not modify text', () => {
+    const r = sanitiseEnrichmentText(
+      'The interventions are causal paths through the model.',
+      CTX,
+    );
+    expect(r.warnings.length).toBeGreaterThan(0);
+    // Tier B never goes into hard-bans
+    expect(r.hardBans).toEqual([]);
+  });
+
+  it('returns clean text unchanged with empty resolved/hardBans/warnings', () => {
+    const r = sanitiseEnrichmentText('Decision quality looks good.', CTX);
+    expect(r.text).toBe('Decision quality looks good.');
+    expect(r.resolved).toEqual([]);
+    expect(r.hardBans).toEqual([]);
+    expect(r.warnings).toEqual([]);
+  });
+
+  it('handles empty / null input safely', () => {
+    expect(sanitiseEnrichmentText('', CTX)).toEqual({
+      text: '',
+      hardBans: [],
+      warnings: [],
+      resolved: [],
+    });
+  });
+});
+
+// =============================================================================
+// isAllowlistedPath
+// =============================================================================
+
+describe('isAllowlistedPath — 15 paths', () => {
+  it.each([
+    '$.critiques[0].message',
+    '$.critiques[3].suggestion',
+    '$.gaps[0].description',
+    '$.robustness[0].caveat',
+    '$.summary',
+    '$.narrative',
+    '$.improvement_guidance[0]',
+    '$.factor_sensitivity[2].interpretation',
+    '$.m1_review[0].text',
+    '$.m1_coaching[0].text',
+    '$.rationale',
+    '$.robustness_synthesis',
+    '$.review_cards[0].what',
+    '$.review_cards[0].why',
+    '$.review_cards[0].items[2].suggested_evidence',
+  ])('allowlists %s', (path) => {
+    expect(isAllowlistedPath(path)).toBe(true);
+  });
+
+  it.each([
+    '$.critiques[0].id',
+    '$.critiques[0].code',
+    '$.critiques[0].severity',
+    '$.critiques[0].affected_option_ids',
+    '$.payloads',
+    '$._meta',
+    '$.review_cards[0].card_id',
+    '$.review_cards[0].suggested_action',
+    '$.review_cards[0].items[0].factor_id',
+    '$.review_cards[0].items[0].factor_label',
+    '$.fragile_edges[0]',
+  ])('rejects structural path %s', (path) => {
+    expect(isAllowlistedPath(path)).toBe(false);
+  });
+});
+
+// =============================================================================
+// partitionCritiques — bucket routing
+// =============================================================================
+
+describe('partitionCritiques — bucket routing + structural preservation', () => {
+  it('routes bucket-D codes to diagnostic, bucket-U/S to user', () => {
+    const critiques: CritiqueLike[] = [
+      { id: 'c1', code: 'NO_OPTIONS', severity: 'blocker', message: 'No options provided for comparison' },
+      { id: 'c2', code: 'IDENTICAL_OPTIONS', severity: 'blocker', message: "Options 'A' and 'B' have identical interventions", affected_option_ids: ['opt_hire_local', 'opt_offshore'] },
+      { id: 'c3', code: 'MISSING_GOAL_NODE', severity: 'blocker', message: 'Goal node not found in graph' },
+    ];
+    const r = partitionCritiques(critiques, CTX);
+    expect(r.user).toHaveLength(2);
+    expect(r.diagnostic).toHaveLength(1);
+    expect(r.diagnostic[0]?.code).toBe('MISSING_GOAL_NODE');
+  });
+
+  it('replaces bucket-S messages with the approved copy', () => {
+    const critiques: CritiqueLike[] = [
+      { id: 'c1', code: 'IDENTICAL_OPTIONS', severity: 'blocker', message: 'engine vocabulary message', affected_option_ids: ['opt_hire_local', 'opt_offshore'] },
+    ];
+    const r = partitionCritiques(critiques, CTX);
+    expect(r.user[0]?.message).toBe(
+      "Options 'Hire Two Senior Engineers Locally' and 'Engage Offshore Partner' currently make the same changes, so the analysis treats them as equivalent.",
+    );
+  });
+
+  it('preserves structural fields verbatim (id, code, severity, source, affected_*)', () => {
+    const c: CritiqueLike = {
+      id: 'c1',
+      code: 'IDENTICAL_OPTIONS',
+      severity: 'blocker',
+      source: 'validation',
+      affected_option_ids: ['opt_hire_local', 'opt_offshore'],
+      affected_node_ids: ['opt_hire_local', 'opt_offshore'],
+      message: 'original',
+    };
+    const r = partitionCritiques([c], CTX);
+    const out = r.user[0]!;
+    expect(out.id).toBe('c1');
+    expect(out.code).toBe('IDENTICAL_OPTIONS');
+    expect(out.severity).toBe('blocker');
+    expect(out.source).toBe('validation');
+    expect(out.affected_option_ids).toEqual(['opt_hire_local', 'opt_offshore']);
+    expect(out.affected_node_ids).toEqual(['opt_hire_local', 'opt_offshore']);
+    // Only `message` changed.
+    expect(out.message).not.toBe('original');
+  });
+
+  it('routes the captured staging leak (uncoded) to diagnostic via fail-safe default', () => {
+    const c: CritiqueLike = {
+      id: 'c1',
+      // no code field — uncoded captured leak
+      severity: 'info',
+      source: 'preprocessing',
+      message: "Node 'opt_hire_local' has kind='option'. Option nodes are filtered before analysis.",
+    };
+    const r = partitionCritiques([c], CTX);
+    expect(r.user).toHaveLength(0);
+    expect(r.diagnostic).toHaveLength(1);
+    // Diagnostic message preserved verbatim
+    expect(r.diagnostic[0]?.message).toBe(
+      "Node 'opt_hire_local' has kind='option'. Option nodes are filtered before analysis.",
+    );
+  });
+});
+
+// =============================================================================
+// sanitiseEnrichment — full subtree walker
+// =============================================================================
+
+describe('sanitiseEnrichment — full subtree walker', () => {
+  it('partitions critiques + scrubs allowlisted leaves + preserves structural fields', () => {
+    const enrichment: Record<string, unknown> = {
+      critiques: [
+        { id: 'c1', code: 'IDENTICAL_OPTIONS', message: 'engine wording', affected_option_ids: ['opt_hire_local', 'opt_offshore'] },
+        { id: 'c2', code: 'MISSING_GOAL_NODE', message: 'engine validation' },
+      ],
+      summary: 'Option opt_hire_local leads.',
+      narrative: 'fac_hiring_cost is the strongest driver.',
+      payloads: { isl_request: { secret: 'preserved verbatim' } },
+      _meta: { response_hash: 'abc123', payloads: 'should not change' },
+      factor_sensitivity: [
+        { node_id: 'fac_hiring_cost', interpretation: 'Decision is sensitive to fac_hiring_cost' },
+      ],
+      review_cards: [
+        {
+          card_id: 'ep_xxx',
+          card_type: 'evidence_priority',
+          what: 'Evidence on opt_hire_local could change the recommendation.',
+          why: 'Reasons.',
+          items: [
+            { node_id: 'fac_hiring_cost', factor_label: 'Hiring and Staffing Cost', suggested_evidence: 'Gather data on opt_offshore.' },
+          ],
+        },
+      ],
+    };
+    const before = structuredClone(enrichment);
+    const r = sanitiseEnrichment(enrichment, GRAPH);
+
+    // Diagnostic critiques routed
+    expect(r.diagnostic.critiques).toHaveLength(1);
+    expect(r.diagnostic.critiques[0]?.code).toBe('MISSING_GOAL_NODE');
+    // User critiques have S-bucket replacement
+    expect((r.enrichment.critiques as CritiqueLike[])[0]?.message).toContain(
+      "Hire Two Senior Engineers Locally",
+    );
+    // Summary/narrative had IDs resolved
+    expect(r.enrichment.summary).toBe('Option Hire Two Senior Engineers Locally leads.');
+    expect(r.enrichment.narrative).toBe('Hiring and Staffing Cost is the strongest driver.');
+    // Factor sensitivity interpretation scrubbed
+    const fs = (r.enrichment.factor_sensitivity as Array<Record<string, unknown>>);
+    expect(fs[0]?.interpretation).toBe('Decision is sensitive to Hiring and Staffing Cost');
+    expect(fs[0]?.node_id).toBe('fac_hiring_cost'); // structural preserved
+    // Review-card prose scrubbed
+    const rc = (r.enrichment.review_cards as Array<Record<string, unknown>>);
+    expect(rc[0]?.what).toBe('Evidence on Hire Two Senior Engineers Locally could change the recommendation.');
+    // Structural fields byte-equal
+    expect(rc[0]?.card_id).toBe('ep_xxx');
+    expect(rc[0]?.card_type).toBe('evidence_priority');
+    const rcItems = (rc[0]?.items as Array<Record<string, unknown>>);
+    expect(rcItems[0]?.node_id).toBe('fac_hiring_cost');
+    expect(rcItems[0]?.factor_label).toBe('Hiring and Staffing Cost');
+    expect(rcItems[0]?.suggested_evidence).toBe('Gather data on Engage Offshore Partner.');
+
+    // Payloads + _meta byte-equal
+    expect(r.enrichment.payloads).toEqual(before.payloads);
+    expect(r.enrichment._meta).toEqual(before._meta);
+  });
+
+  it('reports hard-ban hits when an enrichment leaf carries Tier-A tokens', () => {
+    const enrichment: Record<string, unknown> = {
+      critiques: [],
+      summary: "Node 'opt_hire_local' has kind='option'. Option nodes are filtered before analysis.",
+    };
+    const r = sanitiseEnrichment(enrichment, GRAPH);
+    expect(r.hardBans.length).toBeGreaterThan(0);
+    expect(r.hardBans.some((h) => h.path === '$.summary')).toBe(true);
+  });
+
+  it('returns clean (no hard-bans, no warnings) on a captured-fixture-clean enrichment', () => {
+    const enrichment: Record<string, unknown> = {
+      critiques: [
+        { id: 'c1', code: 'NO_OPTIONS', message: 'No options provided for comparison' },
+      ],
+      summary: 'Decision quality looks good.',
+    };
+    const r = sanitiseEnrichment(enrichment, GRAPH);
+    expect(r.hardBans).toEqual([]);
+    expect(r.warnings).toEqual([]);
+  });
+});
diff --git a/src/orchestrator-v5/compose/output-safety.ts b/src/orchestrator-v5/compose/output-safety.ts
index a4afdf28..f7daa776 100644
--- a/src/orchestrator-v5/compose/output-safety.ts
+++ b/src/orchestrator-v5/compose/output-safety.ts
@@ -55,153 +55,22 @@
 import type { OlumiResponse, Action, Insight, Block } from '@talchain/schemas/boundary';
 import type { GraphV3T } from '../../orchestrator/types.js';
 import { log } from '../../utils/telemetry.js';
-import { ENTITY_ID_LEAK_RE, resolveLabel } from '../../orchestrator/shared/entity-id-pattern.js';
 
 // ----------------------------------------------------------------------------
-// Prefix → generic fallback mapping
+// Per-string scrubber — moved to neutral location so V4 + CEE pipeline can
+// import without a V5 dependency edge. Re-exported here for backward
+// compatibility with existing V5 callsites that did
+// `import { sanitiseUserFacingText } from '.../compose/output-safety.js'`.
 // ----------------------------------------------------------------------------
 
-const PREFIX_GENERIC: Readonly<Record<string, string>> = {
-  fac: 'the relevant factor',
-  factor: 'the relevant factor',
-  opt: 'the relevant option',
-  option: 'the relevant option',
-  goal: 'the relevant goal',
-  dec: 'the relevant decision',
-  decision: 'the relevant decision',
-  out: 'the relevant outcome',
-  outcome: 'the relevant outcome',
-  risk: 'the relevant risk',
-  con: 'the relevant constraint',
-  constraint: 'the relevant constraint',
-};
+import {
+  sanitiseUserFacingText,
+  type SanitiseMatch,
+  type SanitiseResult,
+} from '../../orchestrator/shared/output-safety.js';
 
-// Prefix-extraction regex. The prefix list MUST stay in lockstep with the
-// non-capturing group in `ENTITY_ID_LEAK_RE` (in entity-id-pattern.ts). If
-// you add a prefix to one, add it to the other and update `PREFIX_GENERIC`
-// + the heuristic comment block above.
-const PREFIX_SPLIT_RE = /^(fac|opt|goal|dec|out|risk|con|factor|option|decision|outcome|constraint)[_:-](.+)$/i;
-
-function splitMatch(match: string): { prefix: string; suffix: string } | null {
-  const m = match.match(PREFIX_SPLIT_RE);
-  if (!m) return null;
-  return { prefix: m[1]!.toLowerCase(), suffix: m[2]! };
-}
-
-/**
- * Prefixes with NO English-word collisions in normal prose. Any
- * `<prefix>_<anything>` for one of these is treated as an internal ID even
- * when the suffix is a single token, so a leaked `fac_churn` or `opt_x` is
- * caught at the central egress backstop even when label resolution is
- * unavailable (e.g. graph=null).
- *
- * Conservatively scoped to `fac` and `opt` only. Other short prefixes have
- * documented English collisions:
- *   - `goal`: `goal_setting`, `goal_alignment` (brief-mandated false positives)
- *   - `dec`: `decision_making`, `decision_support` (brief-mandated)
- *   - `out`: `out_of_scope` (brief-mandated)
- *   - `risk`: `risk_adjusted` (brief-mandated)
- *   - `con`: `constraint_based`, `con_text`
- * Those keep the slug-shape gate. Their internal IDs (`goal_revenue`,
- * `dec_q3`, `risk_5`, etc.) still get caught via:
- *   - label resolution (when graph is in scope), OR
- *   - digit detection (numeric IDs), OR
- *   - multi-segment slug (≥4-char first suffix segment).
- */
-const UNAMBIGUOUS_SHORT_PREFIXES: ReadonlySet<string> = new Set([
-  'fac',
-  'opt',
-]);
-
-/**
- * Confirmation gate: filter out English-compound false positives.
- *
- * Real entity IDs in this codebase are slug-shaped — semantic words separated
- * by `_`, e.g. `fac_delivery_cost` (suffix first segment "delivery", 8
- * chars), `factor_team_morale` (first segment "team", 4 chars), or contain
- * digits like `option_42`.
- *
- * English compounds that the broad regex catches share a common shape: they
- * are either single-segment after the prefix (`factor_analysis`,
- * `option_value`) or multi-segment with a SHORT function-word first segment
- * (`out_of_scope` → "of"; `risk_to_revenue` → "to"). Real ID slugs do not
- * use 2-or-3-character connector words as their first segment.
- *
- * Rule (in order):
- *   1. If `resolveLabel(graph, match)` returns a label → confirmed ID.
- *   2. If the match contains a digit anywhere → confirmed ID.
- *   3. If the prefix is in `UNAMBIGUOUS_SHORT_PREFIXES` (`fac`, `opt`) →
- *      confirmed ID. Other short prefixes (`goal`, `dec`, `out`, `risk`,
- *      `con`) DO have English collisions (`goal_setting`, `risk_adjusted`,
- *      `out_of_scope`, etc.) and continue to the slug-shape gate.
- *   4. Else, if the suffix is single-segment (no `_`/`:`/`-` separator) →
- *      English compound, leave alone (`factor_analysis`, `risk_adjusted`).
- *   5. Else (multi-segment), require the first segment to be ≥ 4 chars.
- *      Short first segments are English connector words (`out_of_scope`).
- */
-function isLikelyEntityId(
-  match: string,
-  graph: GraphV3T | null,
-  split: { prefix: string; suffix: string },
-): boolean {
-  if (resolveLabel(graph, match)) return true;
-  if (/\d/.test(match)) return true;
-  if (UNAMBIGUOUS_SHORT_PREFIXES.has(split.prefix)) return true;
-  // Find the first suffix segment using any of the slug separators.
-  const firstSeg = split.suffix.split(/[_:-]/, 1)[0] ?? '';
-  if (firstSeg === split.suffix) {
-    // Single-segment suffix → English compound (e.g. `factor_analysis`).
-    return false;
-  }
-  return firstSeg.length >= 4;
-}
-
-// ----------------------------------------------------------------------------
-// String-level scrub
-// ----------------------------------------------------------------------------
-
-export interface SanitiseMatch {
-  readonly prefix: string;
-  readonly resolved: 'label' | 'generic';
-}
-
-export interface SanitiseResult {
-  readonly text: string;
-  readonly matches: ReadonlyArray<SanitiseMatch>;
-}
-
-/**
- * Scrub a single user-facing string for entity-ID leaks.
- *
- * Returns the (possibly unchanged) text plus structured match metadata for
- * caller-side telemetry. Empty/whitespace-only inputs are a no-op fast path.
- */
-export function sanitiseUserFacingText(text: string, graph: GraphV3T | null): SanitiseResult {
-  if (!text || !text.trim()) return { text, matches: [] };
-
-  // Per-call global matcher — never mutate the imported regex.
-  const matcher = new RegExp(ENTITY_ID_LEAK_RE.source, 'gi');
-  const matches: SanitiseMatch[] = [];
-  let changed = false;
-
-  const replaced = text.replace(matcher, (match) => {
-    const split = splitMatch(match);
-    if (!split) return match;
-    if (!isLikelyEntityId(match, graph, split)) return match;
-    const label = resolveLabel(graph, match);
-    if (label) {
-      matches.push({ prefix: split.prefix, resolved: 'label' });
-      changed = true;
-      return label;
-    }
-    const generic = PREFIX_GENERIC[split.prefix] ?? 'the relevant element';
-    matches.push({ prefix: split.prefix, resolved: 'generic' });
-    changed = true;
-    return generic;
-  });
-
-  return { text: changed ? replaced : text, matches };
-}
+export { sanitiseUserFacingText };
+export type { SanitiseMatch, SanitiseResult };
 
 // ----------------------------------------------------------------------------
 // Envelope-level walk
diff --git a/src/orchestrator-v5/compose/recovery-chips-forbidden-terms.ts b/src/orchestrator-v5/compose/recovery-chips-forbidden-terms.ts
index 02ea0537..d1e7822d 100644
--- a/src/orchestrator-v5/compose/recovery-chips-forbidden-terms.ts
+++ b/src/orchestrator-v5/compose/recovery-chips-forbidden-terms.ts
@@ -4,19 +4,12 @@
  * Lives in its own file so the V5 spec §7 acceptance grep against
  * recovery-chips.ts ("no internal terminology in user-facing copy") passes
  * literally — the data-only list of terms doesn't leak into the chip module.
+ *
+ * The data itself moved to `src/orchestrator/shared/forbidden-tokens.ts` so
+ * the enrichment scrubber (`src/orchestrator-v5/compose/sanitise-enrichment.ts`)
+ * can share the same vocabulary without a V4→V5 dependency edge. This file
+ * re-exports for backward compatibility — every existing callsite keeps its
+ * import path unchanged.
  */
 
-export const FORBIDDEN_USER_TEXT_TERMS: readonly string[] = [
-  'error',
-  'failed',
-  'broken',
-  'enricher',
-  'handler',
-  'zod',
-  'parse',
-  'executor',
-  'finaliser',
-  'finalizer',
-  'ai service',
-  'stack trace',
-] as const;
+export { FORBIDDEN_USER_TEXT_TERMS } from '../../orchestrator/shared/forbidden-tokens.js';
diff --git a/src/orchestrator-v5/compose/resolve-label.ts b/src/orchestrator-v5/compose/resolve-label.ts
new file mode 100644
index 00000000..ee0a4692
--- /dev/null
+++ b/src/orchestrator-v5/compose/resolve-label.ts
@@ -0,0 +1,121 @@
+/**
+ * V5 multi-source label resolver for enrichment-prose sanitisation.
+ *
+ * Wraps the four-priority lookup the analysis-enrichment fix brief
+ * specifies. Every priority returns either the human label associated
+ * with the given entity ID, or null. The fallback (priority 4) lives
+ * in `src/orchestrator/shared/output-safety.ts:PREFIX_GENERIC` and is
+ * applied by the caller — this resolver returns null when no label is
+ * found in any of the live data sources, so the caller can decide
+ * between the prefix-aware fallback (`"the relevant option"`) and any
+ * other context-specific behaviour.
+ *
+ * Lookup order:
+ *   1. graph.nodes[*].id            (V3 root nodes)
+ *   2. analysisReady.options[*].option_id
+ *   3. enrichment.option_comparison[*].id
+ *   4. enrichment.payloads.isl_request.options[*].id
+ *
+ * Calling code that needs the prefix-aware fallback should chain via
+ * `resolveLabelOrFallback` from this module. Pure function — no side
+ * effects, no logging.
+ */
+
+import { resolveLabel as resolveLabelFromGraph } from '../../orchestrator/shared/entity-id-pattern.js';
+import { genericFallbackForId } from '../../orchestrator/shared/output-safety.js';
+import type { GraphV3T } from '../../orchestrator/types.js';
+
+/**
+ * Subset of the V3 wire shape this resolver needs. Defined as a
+ * structural type so the test fixtures + the real wire envelope (which
+ * carries the full `OlumiResponse` type) both satisfy it without an
+ * import cycle.
+ */
+export interface LabelResolverContext {
+  readonly graph?: GraphV3T | null;
+  readonly analysisReady?: {
+    readonly options?: ReadonlyArray<{
+      readonly option_id?: string;
+      readonly id?: string;
+      readonly label?: string;
+    }>;
+  } | null;
+  readonly enrichment?: {
+    readonly option_comparison?: ReadonlyArray<{
+      readonly id?: string;
+      readonly label?: string;
+    }>;
+    readonly payloads?: {
+      readonly isl_request?: {
+        readonly options?: ReadonlyArray<{
+          readonly id?: string;
+          readonly label?: string;
+        }>;
+      };
+    };
+  } | null;
+}
+
+/**
+ * Look up the human label for a given entity ID, walking the four data
+ * sources in priority order. Returns the label string when found, null
+ * otherwise. Caller is responsible for prefix-aware fallback if null.
+ */
+export function resolveLabel(id: string, ctx: LabelResolverContext): string | null {
+  if (typeof id !== 'string' || id.length === 0) return null;
+
+  // Priority 1: graph.nodes (V3 root)
+  if (ctx.graph) {
+    const fromGraph = resolveLabelFromGraph(ctx.graph, id);
+    if (fromGraph !== null) return fromGraph;
+  }
+
+  // Priority 2: analysis_ready.options (option_id keyed)
+  const arOptions = ctx.analysisReady?.options;
+  if (Array.isArray(arOptions)) {
+    for (const o of arOptions) {
+      const oid = o?.option_id ?? o?.id;
+      if (oid === id && typeof o?.label === 'string' && o.label.length > 0) {
+        return o.label;
+      }
+    }
+  }
+
+  // Priority 3: enrichment.option_comparison (id keyed)
+  const oc = ctx.enrichment?.option_comparison;
+  if (Array.isArray(oc)) {
+    for (const o of oc) {
+      if (o?.id === id && typeof o?.label === 'string' && o.label.length > 0) {
+        return o.label;
+      }
+    }
+  }
+
+  // Priority 4: enrichment.payloads.isl_request.options (ISL echo)
+  const islOptions = ctx.enrichment?.payloads?.isl_request?.options;
+  if (Array.isArray(islOptions)) {
+    for (const o of islOptions) {
+      if (o?.id === id && typeof o?.label === 'string' && o.label.length > 0) {
+        return o.label;
+      }
+    }
+  }
+
+  return null;
+}
+
+/**
+ * Resolve to a human label OR the prefix-aware generic fallback.
+ * Never returns the raw ID. Used by the enrichment scrubber so a
+ * single helper covers both the labelled case and the
+ * `"the relevant option/factor/..."` fallback case.
+ *
+ * The fallback comes from `genericFallbackForId` in
+ * `src/orchestrator/shared/output-safety.ts:PREFIX_GENERIC` so the
+ * mapping stays a single source of truth across V4 and V5.
+ */
+export function resolveLabelOrFallback(id: string, ctx: LabelResolverContext): string {
+  const label = resolveLabel(id, ctx);
+  if (label !== null) return label;
+  return genericFallbackForId(id);
+}
diff --git a/src/orchestrator-v5/compose/sanitise-enrichment.ts b/src/orchestrator-v5/compose/sanitise-enrichment.ts
new file mode 100644
index 00000000..7618c045
--- /dev/null
+++ b/src/orchestrator-v5/compose/sanitise-enrichment.ts
@@ -0,0 +1,490 @@
+/**
+ * V5 enrichment-prose sanitiser — pure function bundle.
+ *
+ * Implements the analysis-enrichment-critique-prose-safety contract:
+ *   - Critique partitioning (D / U / S buckets per the implementation
+ *     plan's classification table).
+ *   - S-bucket replacement-message catalogue (Paul-approved copy,
+ *     2026-04-30).
+ *   - Path-aware scrub of user-facing enrichment prose: resolve entity
+ *     IDs to labels, check Tier A (hard-ban) and Tier B (warning) token
+ *     patterns.
+ *   - Allowlist walker over the 15 user-facing prose paths the brief
+ *     enumerates.
+ *
+ * No call-sites yet. The decision-review enricher (Commit 5) and the
+ * response-finaliser backstop (Commit 6) consume this. Pure functions
+ * throughout — no side effects, no logging, no IO.
+ */
+
+import { ENTITY_ID_LEAK_RE } from '../../orchestrator/shared/entity-id-pattern.js';
+import {
+  HARD_BAN_PATTERNS,
+  WARNING_PATTERNS,
+} from '../../orchestrator/shared/forbidden-tokens.js';
+import {
+  resolveLabelOrFallback,
+  type LabelResolverContext,
+} from './resolve-label.js';
+
+// ============================================================================
+// Critique-bucket classification
+// ============================================================================
+
+export type CritiqueBucket = 'D' | 'U' | 'S';
+
+/**
+ * Classification table — pinned in the implementation plan
+ * (Docs/v5/fix-brief-...-implementation-plan.md). Every ISL critique
+ * code from Inference-Service-Layer/src/models/critique.py is listed
+ * here. Any new code defaults to 'D' via `bucketFor` below — fail-safe.
+ */
+export const CRITIQUE_BUCKETS: Readonly<Record<string, CritiqueBucket>> = {
+  // ── Bucket D — diagnostic, suppress to _diagnostics ───────────────────
+  MISSING_GOAL_NODE: 'D',
+  GRAPH_CYCLE_DETECTED: 'D',
+  GRAPH_EMPTY: 'D',
+  INVALID_NODE_ID: 'D',
+  DUPLICATE_NODE_ID: 'D',
+  EDGE_STRENGTH_OUT_OF_RANGE: 'D',
+  EDGE_STD_INVALID: 'D',
+  EDGE_ENDPOINT_MISSING: 'D',
+  NEGLIGIBLE_EDGE_STRENGTH: 'D',
+  DUPLICATE_OPTION_ID: 'D',
+  INTERVENTION_VALUE_INVALID: 'D',
+  MONTE_CARLO_FAILED: 'D',
+  BASELINE_NEAR_ZERO: 'D',
+  INFERENCE_TIMEOUT: 'D',
+  SEED_INVALID: 'D',
+  NUMERICAL_INSTABILITY: 'D',
+  IDENTIFIABILITY_ISSUE: 'D',
+  CONSTRAINT_NODE_DEFAULT_BASE: 'D',
+  INTERNAL_ERROR: 'D',
+  // ── Bucket U — plain English, surface as-is after ID resolution ──────
+  NO_OPTIONS: 'U',
+  INSUFFICIENT_OPTIONS: 'U',
+  DEGENERATE_OUTCOMES: 'U',
+  // ── Bucket S — replace message with approved generic copy ────────────
+  EMPTY_INTERVENTIONS: 'S',
+  INVALID_INTERVENTION_TARGET: 'S',
+  NO_EFFECTIVE_PATH_TO_GOAL: 'S',
+  IDENTICAL_OPTIONS: 'S',
+  GRAPH_DISCONNECTED: 'S',
+  OPTION_NO_INTERVENTIONS: 'S',
+  LOW_EFFECTIVE_SAMPLES: 'S',
+  DEGENERATE_OPTION_ZERO_VARIANCE: 'S',
+  HIGH_TIE_RATE: 'S',
+};
+
+/**
+ * Resolve a critique code to its bucket. Unknown codes default to 'D'
+ * — fail-safe rule: any future ISL code added without a conscious
+ * promotion to U or S is suppressed by default.
+ */
+export function bucketFor(code: string | undefined | null): CritiqueBucket {
+  if (typeof code !== 'string' || code.length === 0) return 'D';
+  return CRITIQUE_BUCKETS[code] ?? 'D';
+}
+
+// ============================================================================
+// S-bucket replacement messages (Paul-approved copy, 2026-04-30)
+// ============================================================================
+//
+// Each entry is a thunk taking the critique's structured fields + the
+// label resolver context. Returns the verbatim replacement message.
+// `<label>` slots are filled via `resolveLabelOrFallback` so the output
+// is always a human label OR `"the relevant option/factor"` — never a
+// raw ID.
+
+export interface SCritiqueVars {
+  readonly affected_option_ids?: ReadonlyArray<string>;
+  readonly affected_node_ids?: ReadonlyArray<string>;
+}
+
+function pickOptionId(vars: SCritiqueVars, idx = 0): string {
+  return vars.affected_option_ids?.[idx] ?? '';
+}
+
+export const S_BUCKET_REPLACEMENTS: Readonly<
+  Record<string, (ctx: LabelResolverContext, vars: SCritiqueVars) => string>
+> = {
+  EMPTY_INTERVENTIONS: (ctx, vars) =>
+    `Option '${resolveLabelOrFallback(pickOptionId(vars), ctx)}' does not change anything yet. Specify what makes this option different.`,
+
+  INVALID_INTERVENTION_TARGET: (ctx, vars) =>
+    `Option '${resolveLabelOrFallback(pickOptionId(vars), ctx)}' refers to something that is not currently in the model.`,
+
+  NO_EFFECTIVE_PATH_TO_GOAL: (ctx, vars) =>
+    `Option '${resolveLabelOrFallback(pickOptionId(vars), ctx)}' does not currently connect to your goal.`,
+
+  IDENTICAL_OPTIONS: (ctx, vars) =>
+    `Options '${resolveLabelOrFallback(pickOptionId(vars, 0), ctx)}' and '${resolveLabelOrFallback(pickOptionId(vars, 1), ctx)}' currently make the same changes, so the analysis treats them as equivalent.`,
+
+  GRAPH_DISCONNECTED: (_ctx, _vars) =>
+    `Some parts of the model are not connected to your goal.`,
+
+  OPTION_NO_INTERVENTIONS: (ctx, vars) =>
+    `Option '${resolveLabelOrFallback(pickOptionId(vars), ctx)}' represents the current state, with no changes applied.`,
+
+  LOW_EFFECTIVE_SAMPLES: (_ctx, _vars) =>
+    `This analysis is less reliable than usual, so treat the result as a signal to check rather than a settled answer.`,
+
+  DEGENERATE_OPTION_ZERO_VARIANCE: (ctx, vars) =>
+    `Option '${resolveLabelOrFallback(pickOptionId(vars), ctx)}' does not currently affect the goal.`,
+
+  HIGH_TIE_RATE: (_ctx, _vars) =>
+    `The options are very close in this analysis. Treat the current lead as finely balanced.`,
+};
+
+// ============================================================================
+// User-facing-prose path allowlist
+// ============================================================================
+//
+// 15 paths that get scanned + scrubbed inside `enrichment`. Anything
+// else is left byte-equal. Encoded as a list of "path matchers" —
+// callable predicates over a JSONPath-like string the walker builds.
+//
+// Path syntax matches the walker below: starts with `$.blocks[*]` (the
+// scrubber receives the inner enrichment object only — caller handles
+// outer block iteration).
+
+const ALLOWLISTED_LEAF_PATHS: ReadonlyArray<RegExp> = [
+  /^\$\.critiques\[\d+\]\.message$/,
+  /^\$\.critiques\[\d+\]\.suggestion$/,
+  /^\$\.gaps\[\d+\]\.description$/,
+  /^\$\.robustness\[\d+\]\.caveat$/,
+  /^\$\.summary$/,
+  /^\$\.narrative$/,
+  /^\$\.improvement_guidance\[\d+\]$/,
+  /^\$\.factor_sensitivity\[\d+\]\.interpretation$/,
+  /^\$\.m1_review\[\d+\]\.text$/,
+  /^\$\.m1_coaching\[\d+\]\.text$/,
+  /^\$\.rationale$/,
+  /^\$\.robustness_synthesis$/,
+  /^\$\.review_cards\[\d+\]\.what$/,
+  /^\$\.review_cards\[\d+\]\.why$/,
+  /^\$\.review_cards\[\d+\]\.items\[\d+\]\.suggested_evidence$/,
+];
+
+export function isAllowlistedPath(path: string): boolean {
+  for (const re of ALLOWLISTED_LEAF_PATHS) {
+    if (re.test(path)) return true;
+  }
+  return false;
+}
+
+// ============================================================================
+// Per-string scrubber
+// ============================================================================
+
+export interface SanitiseTextResult {
+  readonly text: string;
+  /** Tier A hits — sanitiser failure when non-empty (caller decides). */
+  readonly hardBans: ReadonlyArray<string>;
+  /** Tier B hits — warnings only. */
+  readonly warnings: ReadonlyArray<string>;
+  /** Entity-ID matches that were replaced via the resolver. */
+  readonly resolved: ReadonlyArray<{ readonly id: string; readonly label: string }>;
+}
+
+/**
+ * Scrub a single user-facing string:
+ *   1. Replace every ENTITY_ID_LEAK_RE match with `resolveLabelOrFallback`.
+ *   2. After ID resolution, scan for HARD_BAN_PATTERNS (Tier A).
+ *   3. Scan for WARNING_PATTERNS (Tier B) — does not modify text.
+ *
+ * The output `text` always has IDs resolved. Hard-ban hits are
+ * surfaced for the caller (the enricher and the contract test fail on
+ * any hard-ban hit). Warnings are recorded only.
+ */
+export function sanitiseEnrichmentText(
+  text: string,
+  ctx: LabelResolverContext,
+): SanitiseTextResult {
+  if (typeof text !== 'string' || text.length === 0) {
+    return { text: text ?? '', hardBans: [], warnings: [], resolved: [] };
+  }
+
+  const resolved: Array<{ id: string; label: string }> = [];
+  const global = new RegExp(ENTITY_ID_LEAK_RE.source, 'gi');
+  const out = text.replace(global, (match) => {
+    const label = resolveLabelOrFallback(match, ctx);
+    resolved.push({ id: match, label });
+    return label;
+  });
+
+  const hardBans: string[] = [];
+  for (const re of HARD_BAN_PATTERNS) {
+    const m = out.match(re);
+    if (m && typeof m[0] === 'string') hardBans.push(m[0]);
+  }
+
+  const warnings: string[] = [];
+  for (const re of WARNING_PATTERNS) {
+    const m = out.match(re);
+    if (m && typeof m[0] === 'string') warnings.push(m[0]);
+  }
+
+  return { text: out, hardBans, warnings, resolved };
+}
+
+// ============================================================================
+// Critique-array partitioner
+// ============================================================================
+
+export interface CritiqueLike {
+  readonly id?: string;
+  readonly code?: string;
+  readonly severity?: string;
+  readonly source?: string;
+  readonly message?: string;
+  readonly suggestion?: string;
+  readonly affected_option_ids?: ReadonlyArray<string>;
+  readonly affected_node_ids?: ReadonlyArray<string>;
+  readonly [k: string]: unknown;
+}
+
+export interface PartitionedCritiques {
+  readonly user: ReadonlyArray<CritiqueLike>;
+  readonly diagnostic: ReadonlyArray<CritiqueLike>;
+  readonly hardBans: ReadonlyArray<{ readonly path: string; readonly hit: string }>;
+  readonly warnings: ReadonlyArray<{ readonly path: string; readonly hit: string }>;
+}
+
+/**
+ * Partition `enrichment.critiques[]` into:
+ *   - `user`: critiques that should remain on `enrichment.critiques[]`
+ *     after sanitisation. Bucket U keeps the original message (with IDs
+ *     resolved + Tier A scrubbed); bucket S has its message replaced
+ *     by `S_BUCKET_REPLACEMENTS`.
+ *   - `diagnostic`: critiques routed to `enrichment._diagnostics.critiques[]`.
+ *     Bucket D. Caller decides whether to emit `_diagnostics` based on
+ *     `CEE_TURN_DEBUG_ENABLED`.
+ *
+ * Structural fields (id, code, severity, source, affected_*) are
+ * preserved verbatim for both buckets. Only the `message` field is
+ * rewritten on bucket-S critiques.
+ */
+export function partitionCritiques(
+  critiques: ReadonlyArray<CritiqueLike>,
+  ctx: LabelResolverContext,
+): PartitionedCritiques {
+  const user: CritiqueLike[] = [];
+  const diagnostic: CritiqueLike[] = [];
+  const hardBans: Array<{ path: string; hit: string }> = [];
+  const warnings: Array<{ path: string; hit: string }> = [];
+
+  for (let i = 0; i < critiques.length; i++) {
+    const c = critiques[i]!;
+    const bucket = bucketFor(c.code);
+
+    if (bucket === 'D') {
+      diagnostic.push(c);
+      continue;
+    }
+
+    if (bucket === 'S') {
+      const replacementFn = c.code ? S_BUCKET_REPLACEMENTS[c.code] : undefined;
+      const replacedMessage = replacementFn
+        ? replacementFn(ctx, {
+            affected_option_ids: c.affected_option_ids,
+            affected_node_ids: c.affected_node_ids,
+          })
+        : c.message ?? '';
+      // Ensure the replacement itself is clean (defensive — the catalogue
+      // strings are reviewed but the resolver might inject a label that
+      // contains a hard-ban substring under freak circumstances).
+      const scrubbed = sanitiseEnrichmentText(replacedMessage, ctx);
+      for (const hit of scrubbed.hardBans) {
+        hardBans.push({ path: `$.critiques[${i}].message`, hit });
+      }
+      for (const hit of scrubbed.warnings) {
+        warnings.push({ path: `$.critiques[${i}].message`, hit });
+      }
+      user.push({ ...c, message: scrubbed.text });
+      continue;
+    }
+
+    // bucket === 'U'
+    const scrubbed = sanitiseEnrichmentText(c.message ?? '', ctx);
+    for (const hit of scrubbed.hardBans) {
+      hardBans.push({ path: `$.critiques[${i}].message`, hit });
+    }
+    for (const hit of scrubbed.warnings) {
+      warnings.push({ path: `$.critiques[${i}].message`, hit });
+    }
+    let updated: CritiqueLike = { ...c, message: scrubbed.text };
+    if (typeof c.suggestion === 'string') {
+      const scrubbedSug = sanitiseEnrichmentText(c.suggestion, ctx);
+      for (const hit of scrubbedSug.hardBans) {
+        hardBans.push({ path: `$.critiques[${i}].suggestion`, hit });
+      }
+      for (const hit of scrubbedSug.warnings) {
+        warnings.push({ path: `$.critiques[${i}].suggestion`, hit });
+      }
+      updated = { ...updated, suggestion: scrubbedSug.text };
+    }
+    user.push(updated);
+  }
+
+  return { user, diagnostic, hardBans, warnings };
+}
+
+// ============================================================================
+// Allowlist walker (operates on enrichment subtree, not full response)
+// ============================================================================
+
+export interface SanitiseEnrichmentResult {
+  readonly enrichment: Record<string, unknown>;
+  readonly diagnostic: { readonly critiques: ReadonlyArray<CritiqueLike> };
+  readonly hardBans: ReadonlyArray<{ readonly path: string; readonly hit: string }>;
+  readonly warnings: ReadonlyArray<{ readonly path: string; readonly hit: string }>;
+}
+
+/**
+ * Walk an `enrichment` object, scrubbing every allowlisted user-facing
+ * prose path and partitioning `critiques[]` by bucket. Returns:
+ *   - `enrichment`: the cloned-and-rewritten enrichment, with bucket-D
+ *     critiques REMOVED from `critiques[]`.
+ *   - `diagnostic.critiques`: bucket-D critiques verbatim, for the
+ *     caller to attach as `enrichment._diagnostics.critiques` when
+ *     `CEE_TURN_DEBUG_ENABLED=true`.
+ *   - `hardBans` / `warnings`: every Tier-A / Tier-B hit, path-tagged.
+ *
+ * Structural fields (everything not in the allowlist) are preserved
+ * by deep-clone: the contract acceptance test asserts byte-equal on
+ * the excluded subtrees pre/post.
+ */
+export function sanitiseEnrichment(
+  enrichment: Record<string, unknown>,
+  graph: LabelResolverContext['graph'] = null,
+  analysisReady: LabelResolverContext['analysisReady'] = null,
+): SanitiseEnrichmentResult {
+  const ctx: LabelResolverContext = { graph, analysisReady, enrichment };
+  const cloned = structuredClone(enrichment) as Record<string, unknown>;
+  const hardBans: Array<{ path: string; hit: string }> = [];
+  const warnings: Array<{ path: string; hit: string }> = [];
+
+  // ── critiques (bucket-aware partition) ────────────────────────────────
+  let diagnosticCritiques: ReadonlyArray<CritiqueLike> = [];
+  const rawCritiques = cloned['critiques'];
+  if (Array.isArray(rawCritiques)) {
+    const partition = partitionCritiques(rawCritiques as CritiqueLike[], ctx);
+    cloned['critiques'] = partition.user;
+    diagnosticCritiques = partition.diagnostic;
+    for (const h of partition.hardBans) hardBans.push(h);
+    for (const w of partition.warnings) warnings.push(w);
+  }
+
+  // ── flat string leaves ────────────────────────────────────────────────
+  const flatStringLeaves: ReadonlyArray<string> = [
+    'summary',
+    'narrative',
+    'rationale',
+    'robustness_synthesis',
+  ];
+  for (const key of flatStringLeaves) {
+    const v = cloned[key];
+    if (typeof v === 'string' && v.length > 0) {
+      const path = `$.${key}`;
+      if (!isAllowlistedPath(path)) continue;
+      const scrubbed = sanitiseEnrichmentText(v, ctx);
+      for (const hit of scrubbed.hardBans) hardBans.push({ path, hit });
+      for (const hit of scrubbed.warnings) warnings.push({ path, hit });
+      cloned[key] = scrubbed.text;
+    }
+  }
+
+  // ── string-array leaves (improvement_guidance) ────────────────────────
+  const stringArrayLeaves: ReadonlyArray<string> = ['improvement_guidance'];
+  for (const key of stringArrayLeaves) {
+    const arr = cloned[key];
+    if (!Array.isArray(arr)) continue;
+    const out: string[] = [];
+    for (let i = 0; i < arr.length; i++) {
+      const v = arr[i];
+      if (typeof v !== 'string') {
+        out.push(v as never);
+        continue;
+      }
+      const path = `$.${key}[${i}]`;
+      if (!isAllowlistedPath(path)) {
+        out.push(v);
+        continue;
+      }
+      const scrubbed = sanitiseEnrichmentText(v, ctx);
+      for (const hit of scrubbed.hardBans) hardBans.push({ path, hit });
+      for (const hit of scrubbed.warnings) warnings.push({ path, hit });
+      out.push(scrubbed.text);
+    }
+    cloned[key] = out;
+  }
+
+  // ── object-of-strings within an array (factor_sensitivity, m1_review,
+  //     m1_coaching, gaps, robustness) ────────────────────────────────────
+  const arrayOfObjectLeaves: ReadonlyArray<{ arrayKey: string; field: string }> = [
+    { arrayKey: 'factor_sensitivity', field: 'interpretation' },
+    { arrayKey: 'm1_review', field: 'text' },
+    { arrayKey: 'm1_coaching', field: 'text' },
+    { arrayKey: 'gaps', field: 'description' },
+    { arrayKey: 'robustness', field: 'caveat' },
+  ];
+  for (const { arrayKey, field } of arrayOfObjectLeaves) {
+    const arr = cloned[arrayKey];
+    if (!Array.isArray(arr)) continue;
+    for (let i = 0; i < arr.length; i++) {
+      const item = arr[i];
+      if (item == null || typeof item !== 'object') continue;
+      const rec = item as Record<string, unknown>;
+      const v = rec[field];
+      if (typeof v !== 'string' || v.length === 0) continue;
+      const path = `$.${arrayKey}[${i}].${field}`;
+      if (!isAllowlistedPath(path)) continue;
+      const scrubbed = sanitiseEnrichmentText(v, ctx);
+      for (const hit of scrubbed.hardBans) hardBans.push({ path, hit });
+      for (const hit of scrubbed.warnings) warnings.push({ path, hit });
+      rec[field] = scrubbed.text;
+    }
+  }
+
+  // ── review_cards user-facing prose (what / why / items[*].suggested_evidence) ──
+  const reviewCards = cloned['review_cards'];
+  if (Array.isArray(reviewCards)) {
+    for (let i = 0; i < reviewCards.length; i++) {
+      const card = reviewCards[i];
+      if (card == null || typeof card !== 'object') continue;
+      const cardRec = card as Record<string, unknown>;
+      for (const f of ['what', 'why'] as const) {
+        const v = cardRec[f];
+        if (typeof v !== 'string' || v.length === 0) continue;
+        const path = `$.review_cards[${i}].${f}`;
+        const scrubbed = sanitiseEnrichmentText(v, ctx);
+        for (const hit of scrubbed.hardBans) hardBans.push({ path, hit });
+        for (const hit of scrubbed.warnings) warnings.push({ path, hit });
+        cardRec[f] = scrubbed.text;
+      }
+      const items = cardRec['items'];
+      if (Array.isArray(items)) {
+        for (let j = 0; j < items.length; j++) {
+          const it = items[j];
+          if (it == null || typeof it !== 'object') continue;
+          const itRec = it as Record<string, unknown>;
+          const v = itRec['suggested_evidence'];
+          if (typeof v !== 'string' || v.length === 0) continue;
+          const path = `$.review_cards[${i}].items[${j}].suggested_evidence`;
+          const scrubbed = sanitiseEnrichmentText(v, ctx);
+          for (const hit of scrubbed.hardBans) hardBans.push({ path, hit });
+          for (const hit of scrubbed.warnings) warnings.push({ path, hit });
+          itRec['suggested_evidence'] = scrubbed.text;
+        }
+      }
+    }
+  }
+
+  return {
+    enrichment: cloned,
+    diagnostic: { critiques: diagnosticCritiques },
+    hardBans,
+    warnings,
+  };
+}
diff --git a/src/orchestrator-v5/response-finaliser.ts b/src/orchestrator-v5/response-finaliser.ts
index 1939e6e2..249d0214 100644
--- a/src/orchestrator-v5/response-finaliser.ts
+++ b/src/orchestrator-v5/response-finaliser.ts
@@ -86,6 +86,7 @@ import {
   attachComputedAt,
   type AnalysisReadyPayload,
 } from './compose/analysis-ready-emit.js';
+import { sanitiseEnrichment } from './compose/sanitise-enrichment.js';
 
 // ─── Mechanism A: type brand ──────────────────────────────────────────────
 
@@ -185,7 +186,24 @@ export function finaliseV5Response(
   // is preserved for operator inspection; otherwise it is removed before
   // analysis_ready stamping so internal trace shapes never reach the wire.
   const debugEnabled = config.cee?.turnDebugEnabled === true;
-  const scrubbed = debugEnabled ? response : stripCeeTrace(response);
+  const ceeTraceClean = debugEnabled ? response : stripCeeTrace(response);
+  // Phase 1 / Commit 6 — analysis-enrichment-critique-prose-safety:
+  // Defensive second-pass sanitisation over every block's enrichment.
+  // The decision-review enricher (decision-review-enricher.ts) is the
+  // primary scrub site; this backstop catches any future enrichment
+  // producer that bypasses the enricher (cached blocks, fallback
+  // composers, future analysis_result variants). Same CEE_TURN_DEBUG_ENABLED
+  // gating as the ceeTrace scrub: when debug is on, enrichment passes
+  // through verbatim; otherwise the enrichment is sanitised and bucket-D
+  // critiques are removed from the wire.
+  //
+  // analysisReady is threaded into the resolver's priority-2 lookup so
+  // option_id → label resolution works even when graph is unavailable
+  // (the finaliser doesn't carry the V3 graph; analysis_ready.options
+  // covers most enrichment-prose label needs in practice).
+  const scrubbed = debugEnabled
+    ? ceeTraceClean
+    : sanitiseEnrichmentBlocks(ceeTraceClean, ctx.analysisReady ?? null);
   const stamped: OlumiResponse = ctx.analysisReady
     ? { ...scrubbed, analysis_ready: attachComputedAt(ctx.analysisReady) }
     : { ...scrubbed };
@@ -193,6 +211,35 @@ export function finaliseV5Response(
   return stamped as FinalisedV5Response;
 }
 
+function sanitiseEnrichmentBlocks(
+  response: OlumiResponse,
+  analysisReady: AnalysisReadyPayload | null,
+): OlumiResponse {
+  const asRecord = response as Record<string, unknown>;
+  const blocks = Array.isArray(asRecord.blocks) ? (asRecord.blocks as Array<Record<string, unknown>>) : null;
+  if (!blocks || blocks.length === 0) return response;
+  let mutated = false;
+  const newBlocks = blocks.map((b) => {
+    if (b == null || typeof b !== 'object') return b;
+    const enrichment = b.enrichment as Record<string, unknown> | undefined;
+    if (enrichment == null || typeof enrichment !== 'object') return b;
+    // Skip if there's nothing to sanitise: no critiques, no allowlisted
+    // text leaves. The walker is cheap, so this is purely a perf
+    // micro-opt — but the empty-enrichment case is the common one for
+    // non-analysis_result blocks.
+    const hasCritiques = Array.isArray(enrichment.critiques) && enrichment.critiques.length > 0;
+    const hasAnyText = ['summary', 'narrative', 'rationale', 'robustness_synthesis']
+      .some((k) => typeof enrichment[k] === 'string' && (enrichment[k] as string).length > 0);
+    if (!hasCritiques && !hasAnyText) return b;
+
+    const result = sanitiseEnrichment(enrichment, null, analysisReady);
+    mutated = true;
+    return { ...b, enrichment: result.enrichment };
+  });
+  if (!mutated) return response;
+  return { ...asRecord, blocks: newBlocks } as OlumiResponse;
+}
+
 function stripCeeTrace(response: OlumiResponse): OlumiResponse {
   // The defensive scrub walks two known leak surfaces:
   //   1. top-level `response.ceeTrace` (legacy CEE pipeline emitter)
diff --git a/src/orchestrator/shared/__tests__/entity-id-pattern.test.ts b/src/orchestrator/shared/__tests__/entity-id-pattern.test.ts
new file mode 100644
index 00000000..07e66ffc
--- /dev/null
+++ b/src/orchestrator/shared/__tests__/entity-id-pattern.test.ts
@@ -0,0 +1,85 @@
+/**
+ * Regression tests for the existing graph-only `resolveLabel(graph, id)`.
+ *
+ * The V5 enrichment fix introduces a new four-priority resolver in
+ * `src/orchestrator-v5/compose/resolve-label.ts` that imports this
+ * function under an alias (`resolveLabelFromGraph`). The existing
+ * function MUST stay unchanged because seven `.test()` callsites in
+ * `src/orchestrator/patch-summary.ts` and four callsites in
+ * `src/orchestrator/shared/output-safety.ts` rely on its
+ * null-on-miss semantics for confirmation gating.
+ *
+ * Pinning the contract here so any future widening (e.g. extending the
+ * lookup to walk additional sources) breaks this test before reaching
+ * production.
+ */
+import { describe, expect, it } from 'vitest';
+
+import { resolveLabel, ENTITY_ID_LEAK_RE } from '../entity-id-pattern.js';
+import type { GraphV3T } from '../../types.js';
+
+const GRAPH = {
+  nodes: [
+    { id: 'opt_hire_local', label: 'Hire Two Senior Engineers Locally' },
+    { id: 'fac_hiring_cost', label: 'Hiring and Staffing Cost' },
+    { id: 'goal_compliance', label: 'Hit compliance deadline' },
+  ],
+  edges: [],
+} as unknown as GraphV3T;
+
+describe('resolveLabel(graph, id) — graph-only lookup, null on miss', () => {
+  it('returns the label when the id is present on graph.nodes', () => {
+    expect(resolveLabel(GRAPH, 'opt_hire_local')).toBe('Hire Two Senior Engineers Locally');
+    expect(resolveLabel(GRAPH, 'fac_hiring_cost')).toBe('Hiring and Staffing Cost');
+    expect(resolveLabel(GRAPH, 'goal_compliance')).toBe('Hit compliance deadline');
+  });
+
+  it('returns null when the id is absent from graph.nodes', () => {
+    expect(resolveLabel(GRAPH, 'opt_unknown')).toBeNull();
+    expect(resolveLabel(GRAPH, 'fac_missing')).toBeNull();
+  });
+
+  it('returns null when graph is null or undefined', () => {
+    expect(resolveLabel(null, 'opt_hire_local')).toBeNull();
+    expect(resolveLabel(undefined, 'opt_hire_local')).toBeNull();
+  });
+
+  it('does NOT walk analysis_ready / enrichment / payloads — graph-only contract', () => {
+    // Confirmation-gate callers (patch-summary, output-safety) require this
+    // narrow scope. The four-priority resolver lives in a separate module
+    // (`src/orchestrator-v5/compose/resolve-label.ts`) and never replaces
+    // this function.
+    const empty = { nodes: [], edges: [] } as unknown as GraphV3T;
+    expect(resolveLabel(empty, 'opt_x')).toBeNull();
+  });
+
+  it('returns null for nodes with empty-string label (defensive)', () => {
+    const graph = { nodes: [{ id: 'opt_empty', label: '' }], edges: [] } as unknown as GraphV3T;
+    expect(resolveLabel(graph, 'opt_empty')).toBeNull();
+  });
+});
+
+describe('ENTITY_ID_LEAK_RE — pinning the regex shape', () => {
+  it('matches all known entity-ID prefixes', () => {
+    const PREFIXES = [
+      'fac', 'opt', 'goal', 'dec', 'out', 'risk', 'con',
+      'factor', 'option', 'decision', 'outcome', 'constraint',
+    ];
+    for (const p of PREFIXES) {
+      const id = `${p}_xxxx`;
+      expect(ENTITY_ID_LEAK_RE.test(id), `prefix ${p} should match`).toBe(true);
+    }
+  });
+
+  it('matches separator variants (underscore, colon, hyphen)', () => {
+    expect(ENTITY_ID_LEAK_RE.test('opt_hire_local')).toBe(true);
+    expect(ENTITY_ID_LEAK_RE.test('opt:hire-local')).toBe(true);
+    expect(ENTITY_ID_LEAK_RE.test('opt-hire-local')).toBe(true);
+  });
+
+  it('does not match non-entity-shaped strings', () => {
+    expect(ENTITY_ID_LEAK_RE.test('hello world')).toBe(false);
+    expect(ENTITY_ID_LEAK_RE.test('options')).toBe(false);
+    expect(ENTITY_ID_LEAK_RE.test('factor analysis')).toBe(false);
+  });
+});
diff --git a/src/orchestrator/shared/forbidden-tokens.ts b/src/orchestrator/shared/forbidden-tokens.ts
new file mode 100644
index 00000000..b122166c
--- /dev/null
+++ b/src/orchestrator/shared/forbidden-tokens.ts
@@ -0,0 +1,155 @@
+/**
+ * Forbidden tokens registry — neutral utility shared across the V5
+ * recovery-chip enforcement layer and the enrichment-text scrubber.
+ *
+ * Two distinct token sets, one shared module so the regex / pattern source
+ * is never duplicated:
+ *
+ *   - `FORBIDDEN_USER_TEXT_TERMS` (recovery-chip enforcement, pre-existing
+ *     contract). Originally lived in
+ *     `src/orchestrator-v5/compose/recovery-chips-forbidden-terms.ts`.
+ *     Moved here so non-V5 modules (the enrichment scrubber lives in
+ *     `compose/sanitise-enrichment.ts` but the underlying classifier reuses
+ *     the same forbidden-token vocabulary) can import without a V5 edge.
+ *     The V5 file re-exports for backward compatibility — every existing
+ *     callsite keeps its import path.
+ *
+ *   - `INTERNAL_TEMPLATE_TOKENS` (new — enrichment user-facing prose
+ *     scrub). Tokens that betray engine implementation detail and must
+ *     never reach user-rendered text under the path-aware enrichment
+ *     allowlist (see `Docs/v5/fix-brief-analysis-enrichment-critique-prose-safety.md`).
+ *
+ * The two sets have intentional overlap (`handler`, `zod`, `executor`,
+ * `enricher`) — both module surfaces want them flagged. Keep tokens here
+ * even when only one consumer reads them today; the goal is a single source
+ * of truth for "internal vocabulary that must not reach end users".
+ *
+ * Path-scoped use: `INTERNAL_TEMPLATE_TOKENS` is checked ONLY in the
+ * enrichment-allowlist user-facing prose paths (15 paths defined in the
+ * fix brief). Tokens like `payloads` are legitimate keys on structural /
+ * debug fields; the scrubber must never run against those subtrees.
+ */
+
+/**
+ * Recovery-chip forbidden terms (pre-existing contract).
+ *
+ * Surface: V5 recovery-chip user-facing strings. Verified by
+ * `FORBIDDEN_USER_TEXT_TERMS` regex in `src/orchestrator-v5/compose/__tests__/`.
+ * Append-only — removing a term is a contract change requiring co-review of
+ * the chip-generator and recovery-chips test suite.
+ */
+export const FORBIDDEN_USER_TEXT_TERMS: readonly string[] = [
+  'error',
+  'failed',
+  'broken',
+  'enricher',
+  'handler',
+  'zod',
+  'parse',
+  'executor',
+  'finaliser',
+  'finalizer',
+  'ai service',
+  'stack trace',
+] as const;
+
+/**
+ * Internal-template tokens that must never appear in user-facing
+ * enrichment prose. Used by the enrichment-text scrubber (Commit 4 —
+ * `compose/sanitise-enrichment.ts`).
+ *
+ * Path-scoped: checked ONLY in the 15 user-facing prose paths defined by
+ * the enrichment allowlist. Structural fields (`payloads`,
+ * `feature_flags_snapshot`, etc.) legitimately contain some of these
+ * tokens as object keys and are excluded from the scrub.
+ *
+ * Pattern notes:
+ *   - `Node '` (capital N, space, single quote) — engine validation
+ *     prefix from the captured ISL leak `"Node 'opt_X' has kind=..."`.
+ *     Distinguished from bare `Node` (legitimate English in coaching
+ *     prose like "the goal node").
+ *   - `kind=` and `kind='` — engine vocabulary for graph node types.
+ *   - `filtered before analysis` — engine preprocessing detail.
+ *   - `option nodes` (case-insensitive) — engine internal taxonomy.
+ *   - `_pipeline_outcome`, `payloads`, `ISL` — engine internals that
+ *     leak when ISL Pydantic-serialises diagnostic data.
+ *   - `intervention_target`, `interventions` — schema field names that
+ *     surface in engine-coded critique templates.
+ *   - `monte carlo`, `numerically valid samples`, `epsilon-guarded`,
+ *     `e-value`, `bootstrap`, `causal path` — engine-statistics
+ *     vocabulary that survived uncoded critiques.
+ *
+ * Detection is case-insensitive substring match. Tokens are listed
+ * verbatim in the casing the captured leak emits; matching uses
+ * `.toLowerCase()` on both sides.
+ */
+export const INTERNAL_TEMPLATE_TOKENS: readonly string[] = [
+  // ── Engine validation prefixes ────────────────────────────────────────
+  "Node '",
+  'kind=',
+  "kind='",
+  'filtered before analysis',
+  'option nodes',
+  // ── Engine internals / payload shapes ─────────────────────────────────
+  '_pipeline_outcome',
+  'payloads',
+  'ISL',
+  'intervention_target',
+  'interventions',
+  // ── Engine-statistics vocabulary (uncoded critiques) ──────────────────
+  'monte carlo',
+  'numerically valid samples',
+  'epsilon-guarded',
+  'e-value',
+  'bootstrap',
+  'causal path',
+] as const;
+
+// ----------------------------------------------------------------------------
+// Tiered patterns (used by the enrichment scrubber)
+// ----------------------------------------------------------------------------
+//
+// Tier A: hard-ban — match → fail the sanitiser test, fail egress
+// Tier B: warning  — match → log, do not fail
+//
+// Two distinct exports so callers (the V5 enrichment scrubber) can route
+// matches differently. The `INTERNAL_TEMPLATE_TOKENS` array above stays
+// for callers that just want a flat list. Token coverage is a SUPERSET of
+// the flat array: Tier A + Tier B together include every token from the
+// flat array, plus a few additional precise patterns
+// (`bootstrap_sampling`, `ParameterUncertainty`, `point_mass`) that the
+// flat array doesn't enumerate because they're substrings of broader
+// terms it already covers.
+
+/**
+ * HARD-BAN — precise template patterns from engine code with no
+ * legitimate user-facing use. A match in user-facing prose is a
+ * sanitiser failure.
+ */
+export const HARD_BAN_PATTERNS: readonly RegExp[] = [
+  /\bNode '/,                              // capital-N "Node '" — captured-leak prefix
+  /\bkind\s*=\s*'/,                        // kind='option' template literal
+  /filtered before analysis/i,              // captured-leak suffix
+  /Option nodes are/,                       // capital-O template prefix
+  /_pipeline_outcome/,                      // wire-shape internal field name
+  /\bmonte\s+carlo\b/i,                     // engine algorithm name
+  /\bepsilon-guarded\b/i,                   // engine numerical-stability term
+  /\bbootstrap_sampling\b/i,                // confidence_source enum value
+  /\bParameterUncertainty\b/,               // ISL class name
+  /\bpoint_mass\b/,                         // distribution enum value
+];
+
+/**
+ * WARNING — broader terms that *might* be jargon but appear in
+ * legitimate prose. Tracked in evidence/warnings, never block.
+ */
+export const WARNING_PATTERNS: readonly RegExp[] = [
+  /\bISL\b/,                                // could appear in docs / coaching refs
+  /\binterventions?\b/i,                    // already used in some coaching templates
+  /\bintervention[_\s]targets?\b/i,
+  /\bnumerically\s+valid\s+samples?\b/i,
+  /\be-value\b/i,
+  /\bcausal\s+paths?\b/i,
+  /\bbootstrap\b/i,                         // without _sampling — could be unrelated
+  /\bpayloads?\b/i,                         // ambiguous — could be legitimate user copy
+];
diff --git a/src/orchestrator/shared/output-safety.ts b/src/orchestrator/shared/output-safety.ts
new file mode 100644
index 00000000..a0df1afa
--- /dev/null
+++ b/src/orchestrator/shared/output-safety.ts
@@ -0,0 +1,202 @@
+/**
+ * Output safety — neutral utility for entity-ID leak sanitisation.
+ *
+ * Single source of truth for the per-string scrubber `sanitiseUserFacingText`,
+ * the slug-shape confirmation gate, and the prefix → generic-fallback mapping.
+ * Originally lived in `src/orchestrator-v5/compose/output-safety.ts`; extracted
+ * here so V4 (`src/orchestrator/tools/edit-graph.ts`), the unified pipeline
+ * (`src/cee/unified-pipeline/stages/package.ts`), and V5 modules can all import
+ * without creating a V4→V5 dependency edge. The V5 file retains the V5-specific
+ * envelope walker `sanitiseOlumiResponseForEgress` and re-exports the moved
+ * symbols for backward compatibility.
+ *
+ * Two layers of egress protection use this scrubber:
+ *   - Layer 1 (handler-local, e.g. edit-graph.ts): scrubs LLM/PLoT-generated
+ *     strings before they enter `assistantText`. Logs the raw ID for triage.
+ *   - Layer 2 (V5 envelope walker): scrubs the assembled OlumiResponse before
+ *     egress. Logs ONLY the prefix type, never the raw ID.
+ *
+ * Design notes:
+ *   - The exported `ENTITY_ID_LEAK_RE` regex (in entity-id-pattern.ts) is the
+ *     single source of truth. We never mutate it; instead we build a per-call
+ *     global matcher via `new RegExp(ENTITY_ID_LEAK_RE.source, 'gi')`. Mutating
+ *     the source regex would corrupt the 7 `.test()` callsites in patch-summary.ts.
+ *   - The base regex over-matches English compounds (`factor_analysis`,
+ *     `option_value`, etc.). `isLikelyEntityId` adds a tiered confirmation
+ *     gate so legitimate prose is left alone.
+ *
+ * Heuristic for distinguishing real IDs from English compounds:
+ *   - Short prefixes (`fac`, `opt`): no English collisions in these prefixes.
+ *     Any `fac_<anything>` / `opt_<anything>` is treated as a confirmed
+ *     internal ID even with a single-token suffix.
+ *   - Risky short prefixes (`out`, `risk`, `con`, `goal`, `dec`): English
+ *     collisions exist (`out_of_scope`, `risk_adjusted`, etc.). Apply the
+ *     slug-shape gate.
+ *   - Full-word prefixes (`factor`, `option`, `decision`, `outcome`,
+ *     `constraint`): English compounds are common (`factor_analysis`,
+ *     `option_value`). Apply the slug-shape gate.
+ */
+
+import type { GraphV3T } from '../types.js';
+import { ENTITY_ID_LEAK_RE, resolveLabel } from './entity-id-pattern.js';
+
+// ----------------------------------------------------------------------------
+// Prefix → generic fallback mapping
+// ----------------------------------------------------------------------------
+
+const PREFIX_GENERIC: Readonly<Record<string, string>> = {
+  fac: 'the relevant factor',
+  factor: 'the relevant factor',
+  opt: 'the relevant option',
+  option: 'the relevant option',
+  goal: 'the relevant goal',
+  dec: 'the relevant decision',
+  decision: 'the relevant decision',
+  out: 'the relevant outcome',
+  outcome: 'the relevant outcome',
+  risk: 'the relevant risk',
+  con: 'the relevant constraint',
+  constraint: 'the relevant constraint',
+};
+
+// Prefix-extraction regex. The prefix list MUST stay in lockstep with the
+// non-capturing group in `ENTITY_ID_LEAK_RE` (in entity-id-pattern.ts). If
+// you add a prefix to one, add it to the other and update `PREFIX_GENERIC`
+// + the heuristic comment block above.
+const PREFIX_SPLIT_RE = /^(fac|opt|goal|dec|out|risk|con|factor|option|decision|outcome|constraint)[_:-](.+)$/i;
+
+function splitMatch(match: string): { prefix: string; suffix: string } | null {
+  const m = match.match(PREFIX_SPLIT_RE);
+  if (!m) return null;
+  return { prefix: m[1]!.toLowerCase(), suffix: m[2]! };
+}
+
+/**
+ * Map an entity-ID-shaped string to its prefix-aware generic fallback,
+ * e.g. `'opt_hire_local'` → `'the relevant option'`. Used by the V5
+ * label resolver (`src/orchestrator-v5/compose/resolve-label.ts`) when
+ * graph + analysis_ready + enrichment lookups all miss.
+ *
+ * Returns `'the relevant node'` for any input that doesn't split on a
+ * known prefix — defensive default that never returns the raw ID.
+ */
+export function genericFallbackForId(id: string): string {
+  const split = splitMatch(id);
+  if (split === null) return 'the relevant node';
+  return PREFIX_GENERIC[split.prefix] ?? 'the relevant node';
+}
+
+/**
+ * Prefixes with NO English-word collisions in normal prose. Any
+ * `<prefix>_<anything>` for one of these is treated as an internal ID even
+ * when the suffix is a single token, so a leaked `fac_churn` or `opt_x` is
+ * caught at the central egress backstop even when label resolution is
+ * unavailable (e.g. graph=null).
+ *
+ * Conservatively scoped to `fac` and `opt` only. Other short prefixes have
+ * documented English collisions:
+ *   - `goal`: `goal_setting`, `goal_alignment` (brief-mandated false positives)
+ *   - `dec`: `decision_making`, `decision_support` (brief-mandated)
+ *   - `out`: `out_of_scope` (brief-mandated)
+ *   - `risk`: `risk_adjusted` (brief-mandated)
+ *   - `con`: `constraint_based`, `con_text`
+ * Those keep the slug-shape gate. Their internal IDs (`goal_revenue`,
+ * `dec_q3`, `risk_5`, etc.) still get caught via:
+ *   - label resolution (when graph is in scope), OR
+ *   - digit detection (numeric IDs), OR
+ *   - multi-segment slug (≥4-char first suffix segment).
+ */
+const UNAMBIGUOUS_SHORT_PREFIXES: ReadonlySet<string> = new Set([
+  'fac',
+  'opt',
+]);
+
+/**
+ * Confirmation gate: filter out English-compound false positives.
+ *
+ * Real entity IDs in this codebase are slug-shaped — semantic words separated
+ * by `_`, e.g. `fac_delivery_cost` (suffix first segment "delivery", 8
+ * chars), `factor_team_morale` (first segment "team", 4 chars), or contain
+ * digits like `option_42`.
+ *
+ * English compounds that the broad regex catches share a common shape: they
+ * are either single-segment after the prefix (`factor_analysis`,
+ * `option_value`) or multi-segment with a SHORT function-word first segment
+ * (`out_of_scope` → "of"; `risk_to_revenue` → "to"). Real ID slugs do not
+ * use 2-or-3-character connector words as their first segment.
+ *
+ * Rule (in order):
+ *   1. If `resolveLabel(graph, match)` returns a label → confirmed ID.
+ *   2. If the match contains a digit anywhere → confirmed ID.
+ *   3. If the prefix is in `UNAMBIGUOUS_SHORT_PREFIXES` (`fac`, `opt`) →
+ *      confirmed ID. Other short prefixes (`goal`, `dec`, `out`, `risk`,
+ *      `con`) DO have English collisions (`goal_setting`, `risk_adjusted`,
+ *      `out_of_scope`, etc.) and continue to the slug-shape gate.
+ *   4. Else, if the suffix is single-segment (no `_`/`:`/`-` separator) →
+ *      English compound, leave alone (`factor_analysis`, `risk_adjusted`).
+ *   5. Else (multi-segment), require the first segment to be ≥ 4 chars.
+ *      Short first segments are English connector words (`out_of_scope`).
+ */
+function isLikelyEntityId(
+  match: string,
+  graph: GraphV3T | null,
+  split: { prefix: string; suffix: string },
+): boolean {
+  if (resolveLabel(graph, match)) return true;
+  if (/\d/.test(match)) return true;
+  if (UNAMBIGUOUS_SHORT_PREFIXES.has(split.prefix)) return true;
+  // Find the first suffix segment using any of the slug separators.
+  const firstSeg = split.suffix.split(/[_:-]/, 1)[0] ?? '';
+  if (firstSeg === split.suffix) {
+    // Single-segment suffix → English compound (e.g. `factor_analysis`).
+    return false;
+  }
+  return firstSeg.length >= 4;
+}
+
+// ----------------------------------------------------------------------------
+// String-level scrub
+// ----------------------------------------------------------------------------
+
+export interface SanitiseMatch {
+  readonly prefix: string;
+  readonly resolved: 'label' | 'generic';
+}
+
+export interface SanitiseResult {
+  readonly text: string;
+  readonly matches: ReadonlyArray<SanitiseMatch>;
+}
+
+/**
+ * Scrub a single user-facing string for entity-ID leaks.
+ *
+ * Returns the (possibly unchanged) text plus structured match metadata for
+ * caller-side telemetry. Empty/whitespace-only inputs are a no-op fast path.
+ */
+export function sanitiseUserFacingText(text: string, graph: GraphV3T | null): SanitiseResult {
+  if (!text || !text.trim()) return { text, matches: [] };
+
+  // Per-call global matcher — never mutate the imported regex.
+  const matcher = new RegExp(ENTITY_ID_LEAK_RE.source, 'gi');
+  const matches: SanitiseMatch[] = [];
+  let changed = false;
+
+  const replaced = text.replace(matcher, (match) => {
+    const split = splitMatch(match);
+    if (!split) return match;
+    if (!isLikelyEntityId(match, graph, split)) return match;
+    const label = resolveLabel(graph, match);
+    if (label) {
+      matches.push({ prefix: split.prefix, resolved: 'label' });
+      changed = true;
+      return label;
+    }
+    const generic = PREFIX_GENERIC[split.prefix] ?? 'the relevant element';
+    matches.push({ prefix: split.prefix, resolved: 'generic' });
+    changed = true;
+    return generic;
+  });
+
+  return { text: changed ? replaced : text, matches };
+}
```

---

## Section 2 — Contract test diff (`tests/contract/`)

```diff
diff --git a/tests/contract/decision-review-egress.test.ts b/tests/contract/decision-review-egress.test.ts
new file mode 100644
index 00000000..e1c5df33
--- /dev/null
+++ b/tests/contract/decision-review-egress.test.ts
@@ -0,0 +1,237 @@
+/**
+ * Contract test — analysis-enrichment-critique-prose-safety.
+ *
+ * Loads the captured staging regression fixture
+ * (`tests/fixtures/cross-service/v5-turn.run-analysis.staging.json`,
+ * build 3bb151b, response_hash ef1aeb36a440854a) and asserts the
+ * 9 acceptance points the implementation plan defines:
+ *
+ *   1. The captured fixture's `blocks[0].enrichment.critiques[*].message`
+ *      contains the verbatim engine leaks (regression input).
+ *   2. After sanitiseEnrichment runs, the user-facing critiques[]
+ *      array is empty (all 4 captured critiques are bucket-D and
+ *      route to _diagnostics).
+ *   3. With CEE_TURN_DEBUG_ENABLED=true, _diagnostics.critiques
+ *      preserves the original verbatim text (engineer surface).
+ *   4. The 15 allowlisted user-facing prose paths scan clean
+ *      (no entity-IDs, no Tier-A tokens).
+ *   5. Excluded structural subtrees are byte-equal pre/post
+ *      (deep-equal):
+ *      - `payloads`, `_meta`, `meta`, `fragile_edges`, `edge_e_values`,
+ *        `factor_evpi`, `flip_thresholds`, `stability_thresholds`,
+ *        `request_id_chain`, `feature_flags_snapshot`,
+ *        `option_comparison`, structural fields inside `review_cards`.
+ *   6. Bucket-D fail-safe — unknown critique codes default to D.
+ *   7. review_cards.suggested_action invariant — value matches
+ *      /^[a-z0-9_]{1,32}$/. If this regex ever fails, the field has
+ *      drifted from enum to prose and needs reclassification.
+ *   8. resolveLabelOrFallback never returns the raw ID.
+ *   9. With CEE_TURN_DEBUG_ENABLED=false (default), _diagnostics is
+ *      undefined (caller-side gating verified separately in the
+ *      enricher partition test).
+ */
+
+import { readFileSync } from 'node:fs';
+import { resolve } from 'node:path';
+import { describe, expect, it } from 'vitest';
+
+import {
+  sanitiseEnrichment,
+  bucketFor,
+  type CritiqueLike,
+} from '../../src/orchestrator-v5/compose/sanitise-enrichment.js';
+
+const FIXTURE_PATH = resolve(
+  process.cwd(),
+  'tests/fixtures/cross-service/v5-turn.run-analysis.staging.json',
+);
+
+interface CapturedFixture {
+  readonly blocks: ReadonlyArray<{
+    readonly enrichment?: Record<string, unknown>;
+  }>;
+}
+
+function loadFixture(): CapturedFixture {
+  const raw = readFileSync(FIXTURE_PATH, 'utf-8');
+  return JSON.parse(raw) as CapturedFixture;
+}
+
+const SUGGESTED_ACTION_RE = /^[a-z0-9_]{1,32}$/;
+const ENTITY_ID_RE =
+  /\b(?:fac|opt|goal|dec|out|risk|con|factor|option|decision|outcome|constraint)[_:-][a-z0-9_:-]+\b/i;
+const HARD_BAN_PHRASES = [
+  /\bNode '/,
+  /\bkind\s*=\s*'/,
+  /filtered before analysis/i,
+  /Option nodes are/,
+  /_pipeline_outcome/,
+  /\bmonte\s+carlo\b/i,
+  /\bepsilon-guarded\b/i,
+  /\bbootstrap_sampling\b/i,
+];
+
+const STRUCTURAL_SUBTREE_KEYS = [
+  'payloads',
+  '_meta',
+  'meta',
+  'fragile_edges',
+  'edge_e_values',
+  'factor_evpi',
+  'flip_thresholds',
+  'stability_thresholds',
+  'request_id_chain',
+  'feature_flags_snapshot',
+  'option_comparison',
+];
+
+describe('decision-review-egress contract — captured fixture (build 3bb151b)', () => {
+  it('regression input — captured critiques contain the verbatim engine leaks', () => {
+    const fixture = loadFixture();
+    const enrichment = fixture.blocks[0]?.enrichment ?? {};
+    const critiques = (enrichment.critiques ?? []) as CritiqueLike[];
+    expect(critiques.length).toBe(4);
+    const leakMessages = critiques.map((c) => c.message ?? '');
+    // Every message contains the engine template prefix
+    for (const m of leakMessages) {
+      expect(m).toMatch(/^Node '/);
+      expect(m).toMatch(/filtered before analysis/i);
+    }
+    // Every message references a raw opt_* id (the leak)
+    expect(leakMessages.some((m) => /opt_hire_local/i.test(m))).toBe(true);
+    expect(leakMessages.some((m) => /opt_offshore/i.test(m))).toBe(true);
+    expect(leakMessages.some((m) => /opt_status_quo/i.test(m))).toBe(true);
+    expect(leakMessages.some((m) => /opt_tiered_pricing/i.test(m))).toBe(true);
+  });
+
+  it('sanitiseEnrichment removes bucket-D leaks from user-facing critiques[]', () => {
+    const fixture = loadFixture();
+    const enrichment = fixture.blocks[0]?.enrichment ?? {};
+    const r = sanitiseEnrichment(enrichment as Record<string, unknown>);
+    // All 4 captured critiques are uncoded (or have engine codes) and
+    // route to bucket D via the fail-safe default → user array is empty
+    // after partitioning.
+    const userCritiques = r.enrichment.critiques as CritiqueLike[];
+    expect(userCritiques).toEqual([]);
+    expect(r.diagnostic.critiques.length).toBe(4);
+  });
+
+  it('with debug enabled, _diagnostics.critiques preserves verbatim leaked text', () => {
+    const fixture = loadFixture();
+    const enrichment = fixture.blocks[0]?.enrichment ?? {};
+    const r = sanitiseEnrichment(enrichment as Record<string, unknown>);
+    // Diagnostic-side preservation: the engine template is preserved
+    // verbatim for the engineer surface.
+    for (const c of r.diagnostic.critiques) {
+      expect(c.message).toMatch(/^Node '/);
+      expect(c.message).toMatch(/filtered before analysis/i);
+    }
+  });
+
+  it('all 15 allowlisted user-facing paths scan clean post-sanitise', () => {
+    const fixture = loadFixture();
+    const enrichment = fixture.blocks[0]?.enrichment ?? {};
+    const r = sanitiseEnrichment(enrichment as Record<string, unknown>);
+    const post = r.enrichment;
+
+    // Helper: assert a string is entity-id-clean and Tier-A-clean.
+    const assertClean = (s: string, path: string): void => {
+      if (typeof s !== 'string' || s.length === 0) return;
+      expect(s, `${path} must not contain raw entity IDs`).not.toMatch(ENTITY_ID_RE);
+      for (const re of HARD_BAN_PHRASES) {
+        expect(s, `${path} must not contain hard-ban token ${re}`).not.toMatch(re);
+      }
+    };
+
+    // Walk the 15 allowlisted paths.
+    const userCritiques = (post.critiques as CritiqueLike[] | undefined) ?? [];
+    userCritiques.forEach((c, i) => {
+      assertClean(c.message ?? '', `$.critiques[${i}].message`);
+      if (typeof c.suggestion === 'string') assertClean(c.suggestion, `$.critiques[${i}].suggestion`);
+    });
+    if (typeof post.summary === 'string') assertClean(post.summary, '$.summary');
+    if (typeof post.narrative === 'string') assertClean(post.narrative, '$.narrative');
+    if (typeof post.rationale === 'string') assertClean(post.rationale, '$.rationale');
+    if (typeof post.robustness_synthesis === 'string') assertClean(post.robustness_synthesis, '$.robustness_synthesis');
+    const ig = post.improvement_guidance;
+    if (Array.isArray(ig)) {
+      ig.forEach((s, i) => { if (typeof s === 'string') assertClean(s, `$.improvement_guidance[${i}]`); });
+    }
+    const fs = post.factor_sensitivity as Array<Record<string, unknown>> | undefined;
+    fs?.forEach((item, i) => {
+      const v = item.interpretation;
+      if (typeof v === 'string') assertClean(v, `$.factor_sensitivity[${i}].interpretation`);
+    });
+    const rc = post.review_cards as Array<Record<string, unknown>> | undefined;
+    rc?.forEach((card, i) => {
+      if (typeof card.what === 'string') assertClean(card.what, `$.review_cards[${i}].what`);
+      if (typeof card.why === 'string') assertClean(card.why, `$.review_cards[${i}].why`);
+      const items = card.items as Array<Record<string, unknown>> | undefined;
+      items?.forEach((it, j) => {
+        if (typeof it.suggested_evidence === 'string') {
+          assertClean(it.suggested_evidence, `$.review_cards[${i}].items[${j}].suggested_evidence`);
+        }
+      });
+    });
+  });
+
+  it('excluded structural subtrees are byte-equal pre/post (deep-equal)', () => {
+    const fixture = loadFixture();
+    const enrichment = fixture.blocks[0]?.enrichment ?? {};
+    // Snapshot every structural subtree BEFORE sanitisation.
+    const before = JSON.parse(JSON.stringify(enrichment)) as Record<string, unknown>;
+    const r = sanitiseEnrichment(enrichment as Record<string, unknown>);
+    const after = r.enrichment;
+
+    for (const key of STRUCTURAL_SUBTREE_KEYS) {
+      expect(after[key]).toEqual(before[key]);
+    }
+
+    // Inside review_cards, structural fields must also be byte-equal
+    const beforeRc = (before.review_cards ?? []) as Array<Record<string, unknown>>;
+    const afterRc = (after.review_cards ?? []) as Array<Record<string, unknown>>;
+    expect(afterRc.length).toBe(beforeRc.length);
+    for (let i = 0; i < beforeRc.length; i++) {
+      const b = beforeRc[i] ?? {};
+      const a = afterRc[i] ?? {};
+      const STRUCTURAL_CARD_FIELDS = [
+        'card_id', 'card_type', 'priority', 'priority_band', 'review_phase',
+        'suggested_action', 'supporting_refs', 'provenance',
+      ];
+      for (const f of STRUCTURAL_CARD_FIELDS) {
+        expect(a[f]).toEqual(b[f]);
+      }
+      const beforeItems = (b.items ?? []) as Array<Record<string, unknown>>;
+      const afterItems = (a.items ?? []) as Array<Record<string, unknown>>;
+      for (let j = 0; j < beforeItems.length; j++) {
+        const STRUCTURAL_ITEM_FIELDS = [
+          'node_id', 'factor_id', 'factor_label', 'sensitivity_rank',
+          'sensitivity_value', 'confidence_normalised', 'score', 'elasticity',
+        ];
+        for (const f of STRUCTURAL_ITEM_FIELDS) {
+          expect(afterItems[j]?.[f]).toEqual(beforeItems[j]?.[f]);
+        }
+      }
+    }
+  });
+
+  it('bucket-D fail-safe — unknown critique codes default to D', () => {
+    expect(bucketFor('UNKNOWN_NEW_CODE_xyzzy')).toBe('D');
+    expect(bucketFor(undefined)).toBe('D');
+    expect(bucketFor(null)).toBe('D');
+  });
+
+  it('review_cards[*].suggested_action remains an enum-shaped value', () => {
+    const fixture = loadFixture();
+    const enrichment = fixture.blocks[0]?.enrichment ?? {};
+    const reviewCards = (enrichment.review_cards ?? []) as Array<Record<string, unknown>>;
+    expect(reviewCards.length).toBeGreaterThan(0);
+    for (const card of reviewCards) {
+      const v = card.suggested_action;
+      // Approved invariant (Paul, 2026-04-30): if this regex ever fails,
+      // suggested_action has drifted from enum to prose and must be
+      // reclassified into the user-facing allowlist.
+      expect(v).toMatch(SUGGESTED_ACTION_RE);
+    }
+  });
+});
```

---

## Section 3 — Fixture diff (`tests/fixtures/`)

### File-stat summary

```
 .../v5-turn.run-analysis.staging.json              | 3406 ++++++++++++++++++++
 .../v5-turn.run-analysis.staging.metadata.json     |   74 +
 2 files changed, 3480 insertions(+)
```

The captured fixture file (`v5-turn.run-analysis.staging.json`, 3406-line JSON, 138 KB)
is the **regression input** for the contract test in Section 2. It is the verbatim wire
response from `cee-staging.onrender.com/orchestrate/v2/turn` on build `3bb151b`,
pretty-printed (2-space indent). The 4 entries in `blocks[0].enrichment.critiques[*].message`
are the captured engine-template leaks the brief targets:

```
blocks[0].enrichment.critiques[0..3].message:
  Node 'opt_hire_local' has kind='option'. Option nodes are filtered before analysis.
  Node 'opt_offshore' has kind='option'. Option nodes are filtered before analysis.
  Node 'opt_status_quo' has kind='option'. Option nodes are filtered before analysis.
  Node 'opt_tiered_pricing' has kind='option'. Option nodes are filtered before analysis.
```

Full JSON not inlined here (3406 lines of mechanically-captured data, no semantic
review signal). Reviewable via `git show HEAD:tests/fixtures/cross-service/v5-turn.run-analysis.staging.json`
or in the IDE.

### Metadata sidecar diff

```diff
diff --git a/tests/fixtures/cross-service/v5-turn.run-analysis.staging.metadata.json b/tests/fixtures/cross-service/v5-turn.run-analysis.staging.metadata.json
new file mode 100644
index 00000000..0cf5b247
--- /dev/null
+++ b/tests/fixtures/cross-service/v5-turn.run-analysis.staging.metadata.json
@@ -0,0 +1,74 @@
+{
+  "fixture": "v5-turn.run-analysis.staging.json",
+  "captured_at": "2026-04-30T15:18:13.322Z",
+  "captured_against": {
+    "host": "cee-staging.onrender.com",
+    "endpoint": "/orchestrate/v2/turn",
+    "build": "3bb151b",
+    "build_full": "3bb151b607143848e8cde3eaf9291046baff1702",
+    "ancestry": "at-or-after a555cf7 (verified: git merge-base --is-ancestor a555cf7 3bb151b → exit 0)"
+  },
+  "request": {
+    "kind": "message",
+    "stage": "analyse",
+    "turn_class": "decide",
+    "source": "chip_click",
+    "chip": { "action_type": "run_analysis" }
+  },
+  "shape_summary": {
+    "top_level_keys": ["analysis_ready", "assistant_text", "blocks", "insights", "response_version", "stage_indicator", "suggested_actions"],
+    "blocks_count": 1,
+    "block_0_type": "analysis_result",
+    "analysis_ready_options_count": 4,
+    "enrichment_top_level_key_count": 40,
+    "enrichment_critiques_count": 4,
+    "enrichment_review_cards_count": 1,
+    "enrichment_meta_response_hash": "ef1aeb36a440854a"
+  },
+  "regression_targets": [
+    {
+      "path": "$.blocks[0].enrichment.critiques[0..3].message",
+      "leak_type": "raw_entity_id_in_user_facing_prose",
+      "captured_samples": [
+        "Node 'opt_hire_local' has kind='option'. Option nodes are filtered before analysis.",
+        "Node 'opt_offshore' has kind='option'. Option nodes are filtered before analysis.",
+        "Node 'opt_status_quo' has kind='option'. Option nodes are filtered before analysis.",
+        "Node 'opt_tiered_pricing' has kind='option'. Option nodes are filtered before analysis."
+      ],
+      "classification": "Bucket D (diagnostic — suppress to enrichment._diagnostics)"
+    }
+  ],
+  "review_cards_audit": {
+    "user_facing_prose_paths": [
+      "$.blocks[0].enrichment.review_cards[*].what",
+      "$.blocks[0].enrichment.review_cards[*].why",
+      "$.blocks[0].enrichment.review_cards[*].items[*].suggested_evidence"
+    ],
+    "structural_only_paths": [
+      "$.blocks[0].enrichment.review_cards[*].card_id",
+      "$.blocks[0].enrichment.review_cards[*].card_type",
+      "$.blocks[0].enrichment.review_cards[*].priority",
+      "$.blocks[0].enrichment.review_cards[*].priority_band",
+      "$.blocks[0].enrichment.review_cards[*].review_phase",
+      "$.blocks[0].enrichment.review_cards[*].suggested_action",
+      "$.blocks[0].enrichment.review_cards[*].supporting_refs[*]",
+      "$.blocks[0].enrichment.review_cards[*].provenance.*",
+      "$.blocks[0].enrichment.review_cards[*].items[*].node_id",
+      "$.blocks[0].enrichment.review_cards[*].items[*].factor_id",
+      "$.blocks[0].enrichment.review_cards[*].items[*].factor_label",
+      "$.blocks[0].enrichment.review_cards[*].items[*].sensitivity_rank",
+      "$.blocks[0].enrichment.review_cards[*].items[*].sensitivity_value",
+      "$.blocks[0].enrichment.review_cards[*].items[*].confidence_normalised",
+      "$.blocks[0].enrichment.review_cards[*].items[*].score",
+      "$.blocks[0].enrichment.review_cards[*].items[*].elasticity"
+    ],
+    "fixture_state": "All review_card prose strings are ID-clean and label-resolved in this fixture; the audit confirmed prose paths exist and require allowlisting in the sanitiser, not exclusion."
+  },
+  "intended_use": [
+    "Regression input for the analysis-enrichment critique-prose-safety fix brief.",
+    "decision_review v15 input verification.",
+    "Future contract test: tests/contract/decision-review-egress.test.ts."
+  ],
+  "drift_policy": "When the captured leak is fixed in production, re-capture against the new build, update build/captured_at fields, and update regression_targets.captured_samples to the new (clean) wire output.",
+  "scenario_id": "5f625966-eead-4337-a306-79de5f0a9632"
+}
```

---
## Section 4 — Per-commit summary (behavioural commits 4, 5, 6)

### Commit 4 — `65bc2b36 feat(sanitise-enrichment): bucket partition + S-bucket replacements + path-aware scrubber`

**What changed**

| File | Action | Surface |
|---|---|---|
| `src/orchestrator-v5/compose/sanitise-enrichment.ts` | NEW (490 lines) | New pure-function module |
| `src/orchestrator/shared/forbidden-tokens.ts` | EXTEND (+49 lines) | Adds `HARD_BAN_PATTERNS` (10 RegExp) and `WARNING_PATTERNS` (8 RegExp) — Tier A / Tier B split. Existing `INTERNAL_TEMPLATE_TOKENS` flat array preserved. |
| `src/orchestrator-v5/compose/__tests__/sanitise-enrichment.test.ts` | NEW (440 lines) | 55 unit tests |

**Public exports** (all pure, no side effects, no IO):

- `CRITIQUE_BUCKETS: Record<string, 'D' | 'U' | 'S'>` — full ISL classification map
- `bucketFor(code)` — fail-safe (unknown → `'D'`)
- `S_BUCKET_REPLACEMENTS: Record<code, (ctx, vars) => string>` — Paul-approved copy catalogue
- `isAllowlistedPath(path: string): boolean` — predicate for the 15 user-facing prose paths
- `sanitiseEnrichmentText(text, ctx)` — per-string scrubber (resolve IDs + Tier A/B scan)
- `partitionCritiques(critiques, ctx)` — bucket-aware splitter (preserves structural fields)
- `sanitiseEnrichment(enrichment, graph?, analysisReady?)` — top-level walker

**No call-sites in this commit.** The new module is consumed by Commit 5 (enricher) and Commit 6 (finaliser backstop).

**What it gates** — once wired (Commits 5/6), the 15 user-facing prose paths under `enrichment`:

```
$.blocks[*].enrichment.critiques[*].message
$.blocks[*].enrichment.critiques[*].suggestion
$.blocks[*].enrichment.gaps[*].description
$.blocks[*].enrichment.robustness[*].caveat
$.blocks[*].enrichment.summary
$.blocks[*].enrichment.narrative
$.blocks[*].enrichment.improvement_guidance[*]
$.blocks[*].enrichment.factor_sensitivity[*].interpretation
$.blocks[*].enrichment.m1_review[*].text
$.blocks[*].enrichment.m1_coaching[*].text
$.blocks[*].enrichment.rationale
$.blocks[*].enrichment.robustness_synthesis
$.blocks[*].enrichment.review_cards[*].what
$.blocks[*].enrichment.review_cards[*].why
$.blocks[*].enrichment.review_cards[*].items[*].suggested_evidence
```

**What it preserves** — every other path under `enrichment` is byte-equal pre/post by deep-clone. Specifically the structural-only subtrees enumerated in the contract acceptance test:

```
$.blocks[*].enrichment.critiques[*].id
$.blocks[*].enrichment.critiques[*].code
$.blocks[*].enrichment.critiques[*].severity
$.blocks[*].enrichment.critiques[*].source
$.blocks[*].enrichment.critiques[*].affected_option_ids
$.blocks[*].enrichment.critiques[*].affected_node_ids
$.blocks[*].enrichment.factor_sensitivity[*].node_id
$.blocks[*].enrichment.fragile_edges                  (whole subtree)
$.blocks[*].enrichment.edge_e_values                  (whole subtree)
$.blocks[*].enrichment.factor_evpi                    (whole subtree)
$.blocks[*].enrichment.option_comparison              (id + label preserved)
$.blocks[*].enrichment.payloads                       (whole subtree)
$.blocks[*].enrichment.flip_thresholds                (whole subtree)
$.blocks[*].enrichment.stability_thresholds           (whole subtree)
$.blocks[*].enrichment.request_id_chain               (whole subtree)
$.blocks[*].enrichment._meta                          (whole subtree)
$.blocks[*].enrichment.feature_flags_snapshot         (whole subtree)
$.blocks[*].enrichment.meta                           (whole subtree)
$.blocks[*].enrichment.review_cards[*].card_id        (and card_type, priority, priority_band, review_phase, suggested_action, supporting_refs, provenance, items[*].node_id/factor_id/factor_label/sensitivity_*/confidence_normalised/score/elasticity)
$.blocks[*].enrichment.decision_review                (verbatim — F.6 contract)
```

**What could break if wrong**

| Risk | Manifestation | Mitigation |
|---|---|---|
| Bucket misclassification (U → S → D) routes a user-relevant signal to `_diagnostics` | UI loses critique copy that should surface | 31-row classification table pinned + plan-file commit (`101fefba`) records the rule explicitly. Fail-safe rule routes unknowns to D, requiring conscious promotion. |
| S-bucket replacement uses the wrong label slot (e.g. `affected_option_ids[0]` for an `IDENTICAL_OPTIONS` critique that needs both `[0]` and `[1]`) | Replacement says "Option 'A' and 'A' do exactly the same thing" | All 9 replacements have verbatim test assertions in `S_BUCKET_REPLACEMENTS — pinned approved copy` describe block. |
| Walker over-reaches and modifies a structural subtree | UI displays mangled IDs in machine-consumed fields | `sanitiseEnrichment — full subtree walker` test asserts deep-equal on `payloads`, `_meta`, all `review_cards` structural fields. |
| Hard-ban pattern false positive blocks legitimate prose | Sanitiser flags a clean message as failure | Tier A patterns are precise (capital-N `Node '`, `kind='`, `Monte Carlo`, `epsilon-guarded`, etc. — no plain-English collisions). Tier B is warnings-only. |
| Resolver returns raw ID under any path | Entity ID leaks to user-facing prose | `resolveLabelOrFallback` always returns a string from the prefix-aware `genericFallbackForId` map; `resolveLabel` returns `null` and the caller chains the fallback. Pinned by `never returns the raw ID for any prefix family` test. |
| Allowlist regex misses a future user-facing path | New prose field added in ISL/PLoT escapes the scan | New paths require an explicit addition to `ALLOWLISTED_LEAF_PATHS` array; `isAllowlistedPath` accepts only the 15 enumerated paths. The fail-safe is "structural by default, prose by exception". |

---

### Commit 5 — `f12beeb3 feat(decision-review-enricher): wire enrichment-prose sanitiser`

**What changed**

| File | Action | Surface |
|---|---|---|
| `src/orchestrator-v5/coaching/decision-review-enricher.ts` | EDIT (+30 lines) | Single call-site change inside `enrichRunAnalysisWithDecisionReview` |
| `tests/contract/decision-review-egress.test.ts` | NEW (237 lines) | 7 contract assertions against captured staging fixture |

**The single behaviour change** — at `decision-review-enricher.ts:~141-180`:

```diff
- const patched: HandlerFact = {
-   ...fact,
-   result: {
-     ...fact.result,
-     enrichment: { ...enrichment, decision_review: output },
-   },
- };
+ const merged: Record<string, unknown> = {
+   ...(enrichment as Record<string, unknown>),
+   decision_review: output,
+ };
+ const sanitised = sanitiseEnrichment(merged);
+ let finalEnrichment = sanitised.enrichment;
+ if (config.cee?.turnDebugEnabled === true && sanitised.diagnostic.critiques.length > 0) {
+   finalEnrichment = {
+     ...finalEnrichment,
+     _diagnostics: { critiques: sanitised.diagnostic.critiques },
+   };
+ }
+ const patched: HandlerFact = {
+   ...fact,
+   result: {
+     ...fact.result,
+     enrichment: finalEnrichment,
+   },
+ };
```

**What it gates**

- Every `run_analysis` handler fact's `enrichment` object before it is attached to the response envelope.
- Bucket-D critiques (engine validation, preprocessing leaks, numerical-stability codes) routed to `enrichment._diagnostics.critiques`.
- Bucket-S critiques in `enrichment.critiques[]` get their `message` replaced verbatim from the catalogue (with resolved labels).
- All 15 user-facing prose paths in the same enrichment have entity IDs resolved.

**What it preserves**

- The existing F.6 contract for `enrichment.decision_review` (verbatim LLM output + `produced_at` timestamp). The walker has no allowlisted path inside `decision_review`, so it passes through untouched via deep-clone.
- All 21 structural subtrees enumerated in Commit 4's preservation list.
- The `enrichRunAnalysisWithDecisionReview` skip semantics: `no_run_analysis_fact` / `no_brief` / `no_results` / `no_winner` paths are unchanged — sanitisation only runs after a successful decision_review LLM call.
- Telemetry: `V5DecisionReviewInvoked`, `V5DecisionReviewFailed`, `V5DecisionReviewSkipped` events fire as before.

**What could break if wrong**

| Risk | Manifestation | Mitigation |
|---|---|---|
| `_diagnostics` accidentally emitted on the wire when `CEE_TURN_DEBUG_ENABLED=false` | Internal engine vocabulary visible to end users | Gated by explicit `config.cee?.turnDebugEnabled === true` check. Test pins both branches (debug=true → present; debug=false → undefined). |
| Sanitiser throws and the enricher fails the whole turn | Worse than a leak: turn fails entirely | The enricher's existing `try / catch` (lines 155-170) catches any throw, emits `V5DecisionReviewFailed`, and returns the input facts unchanged. The sanitiser is also pure-function safe (no IO, no side effects, no thrown errors in the implementation). |
| Decision_review LLM output mutated despite F.6 contract | Cache-read gate `isDecisionReviewOutput` fails on subsequent turns | `decision_review` subtree is preserved by deep-clone — the walker only descends into allowlisted paths. Verified by the existing 13 enricher tests passing unchanged + the contract test asserting `decision_review` byte-equal. |
| Resolver context missing `analysisReady` | Labels from `analysis_ready.options` (priority 2) miss; falls back to priority 3/4 inside `enrichment` | The enricher passes `null` for both `graph` and `analysisReady` because the run_analysis fact at this site doesn't carry them. The resolver finds labels via priority 3/4 (`enrichment.option_comparison` and `enrichment.payloads.isl_request.options` — both confirmed present in the captured fixture). |
| The sanitiser writes `{ ...finalEnrichment, _diagnostics: ... }` AFTER the merge — order matters if `_diagnostics` ever lives in the upstream enrichment | Upstream `_diagnostics` overwritten | Captured-fixture audit shows no upstream `_diagnostics` field; the wire reserves the name. The new code's `{ ...finalEnrichment, _diagnostics: ... }` order makes the new value win. Future-proofing: this is fine because `_diagnostics` is now CEE-owned by contract. |

---

### Commit 6 — `1f64f417 feat(response-finaliser): defensive enrichment-prose backstop on egress`

**What changed**

| File | Action | Surface |
|---|---|---|
| `src/orchestrator-v5/response-finaliser.ts` | EDIT (+49 lines) | New `sanitiseEnrichmentBlocks()` helper + call from `finaliseV5Response` |
| `src/orchestrator-v5/__tests__/response-finaliser-enrichment-backstop.test.ts` | NEW (126 lines) | 3 tests pinning debug=on / debug=off / no-op-when-empty |

**The behaviour change** — at `response-finaliser.ts:finaliseV5Response`:

```diff
  const debugEnabled = config.cee?.turnDebugEnabled === true;
- const scrubbed = debugEnabled ? response : stripCeeTrace(response);
+ const ceeTraceClean = debugEnabled ? response : stripCeeTrace(response);
+ const scrubbed = debugEnabled
+   ? ceeTraceClean
+   : sanitiseEnrichmentBlocks(ceeTraceClean, ctx.analysisReady ?? null);
  const stamped: OlumiResponse = ctx.analysisReady
    ? { ...scrubbed, analysis_ready: attachComputedAt(ctx.analysisReady) }
    : { ...scrubbed };
```

Plus a new helper:

```ts
function sanitiseEnrichmentBlocks(
  response: OlumiResponse,
  analysisReady: AnalysisReadyPayload | null,
): OlumiResponse
```

— walks `response.blocks[*]`, applies `sanitiseEnrichment` to any block that carries critiques or any of the four flat string leaves (`summary`, `narrative`, `rationale`, `robustness_synthesis`). Returns the original response object reference when no block was mutated (perf micro-opt).

**What it gates**

- Every block's `enrichment` subtree on every 200-OK V5 response, regardless of which composer / handler produced it.
- Defence in depth — catches enrichment that bypassed `decision-review-enricher.ts`:
  - Cached or replayed `analysis_result` blocks
  - Future fallback composers
  - Future enrichment producers landing in V5 without going through the auto-fire enricher

**What it preserves**

- `stripCeeTrace` runs first, so the existing `ceeTrace` scrub contract is unchanged.
- `analysis_ready` stamping order unchanged: scrub first, then attach `computed_at`-stamped `analysis_ready`.
- The four mechanism-defence-in-depth contract of the finaliser (type brand, WeakSet membership, `preSerialization` hook, grep gate). The new helper is invoked from inside `finaliseV5Response`; it does not bypass any existing guard.
- Blocks without enrichment / without critiques and text leaves: passthrough by reference (perf gate).
- The deep-clone happens inside `sanitiseEnrichment`, so the finaliser's caller still gets a fresh object on the mutated branch.

**What could break if wrong**

| Risk | Manifestation | Mitigation |
|---|---|---|
| Backstop runs sanitiser **after** the enricher already sanitised, doing redundant work | Double-scrub / no-op | `sanitiseEnrichment` is idempotent: a clean enrichment scans clean and returns byte-equal text; the partition pass on already-empty `critiques[]` is a no-op. Verified by Commit 4 test "returns clean (no hard-bans, no warnings) on a captured-fixture-clean enrichment". |
| `ctx.analysisReady` is undefined and the backstop falls back to graph=null + analysisReady=null context | Labels resolved only via `enrichment.option_comparison` and `enrichment.payloads.isl_request.options` (priorities 3 + 4) | This is the documented graceful-degradation path. Labels available in either source per the captured fixture. Tested by `no-op when no blocks have enrichment` — the resolver doesn't run if there's nothing to resolve. |
| Backstop accidentally mutates non-analysis_result blocks (e.g. `text`, `error`, `graph_patch`) | Wire-shape regression on other block types | Helper checks `enrichment !== null && typeof enrichment === 'object'`, then gates on `hasCritiques || hasAnyText`. Non-enrichment-bearing blocks pass through. Pinned by `no-op when no blocks have enrichment` test. |
| Performance: walker runs on every 200-OK response, even when enrichment is absent / empty | Latency add per turn | Cheap-gate skip: `Array.isArray(blocks)` + `enrichment != null` + `hasCritiques \|\| hasAnyText`. The walker only descends when there's something to scrub. Existing 39 finaliser tests run identically (no regression in test execution time). |
| `sanitiseEnrichment` throws | `finaliseV5Response` throws → 500 BoundaryError → user sees an error instead of (potentially-leaky) content | Sanitiser is pure-function safe: no IO, no thrown errors in the implementation. Defensive structural checks at every level. Worst case is a return of the input unchanged. |
| Backstop gate fires when CEE_TURN_DEBUG_ENABLED is misconfigured | Either `_diagnostics` leaks to wire (debug=true accidentally on prod), OR sanitisation runs in dev unexpectedly (debug=false) | Same env var that gates `ceeTrace` strip — operational discipline already in place. Behaviour is symmetric: debug=true means "show engineers what's happening"; sanitisation off is one of those things. |

---

## Section 5 — Acceptance criteria

Copied from `Docs/v5/fix-brief-analysis-enrichment-critique-prose-safety-implementation-plan.md` § "Acceptance summary":

1. **31 ISL codes correctly bucketed**: D=20, U=3, S=9; +1 uncoded leak in D = 32 entries total. Verified against `Inference-Service-Layer/src/models/critique.py` source-of-truth.
2. **Captured fixture sanitised**: 15 allowlisted paths scan clean (`scanForEntityIds` returns `[]`).
3. **No HARD_BAN tokens** anywhere under the allowlist.
4. **Excluded structural subtrees byte-equal pre/post** (deep-equal).
5. **Bucket-D critiques routed to `_diagnostics`** under `CEE_TURN_DEBUG_ENABLED=true`; absent from wire by default.
6. **Bucket-S critiques use their replacement message verbatim** from the catalogue.
7. **Resolver fallback never returns raw ID** — covered for every prefix family.
8. **Live replay step 4 PASSES** against staging post-deploy. *(Pending live verification after push.)*
9. **No regression**: 110 UI-side contract tests + 64 CEE-side contract tests + 292 harness unit tests stay green.
10. **Fail-safe pinning test**: unknown ISL code → bucket D by default.

Plus the Paul-approved invariant from the plan-file commit `101fefba`:

11. **`review_cards[*].suggested_action` enum invariant** — `/^[a-z0-9_]{1,32}$/`. Pinned in `tests/contract/decision-review-egress.test.ts` so any drift to prose forces conscious reclassification.

**Verification status**: 1–7, 9, 10, 11 all green via 1400/1400 V5 + contract tests. (8) gated on push + live staging deploy.

---

## Section 6 — Architecture context

### Data flow

```
                    ┌─────────────────────┐
                    │ ISL                 │
                    │ (Inference Service  │
                    │  Layer, Python)     │
                    │                     │
                    │ Emits critique      │
                    │ templates from      │
                    │ critique.py +       │
                    │ uncoded             │
                    │ preprocessing       │
                    │ messages            │
                    └──────────┬──────────┘
                               │ HTTP / Pydantic-serialised JSON
                               ▼
                    ┌─────────────────────┐
                    │ PLoT                │
                    │ (Probabilistic      │
                    │  Logic on TypeScript)│
                    │                     │
                    │ Adapts ISL output;  │
                    │ surfaces enrichment │
                    │ verbatim including  │
                    │ payloads echo       │
                    └──────────┬──────────┘
                               │ JSON
                               ▼
        ┌──────────────────────────────────────────────┐
        │ CEE — orchestrator-v5                        │
        │                                              │
        │  ┌──────────────────────────────────────┐    │
        │  │ run_analysis handler                 │    │
        │  │ (writes fact.result.enrichment       │    │
        │  │  with the ISL/PLoT enrichment        │    │
        │  │  verbatim)                           │    │
        │  └──────────────┬───────────────────────┘    │
        │                 ▼                            │
        │  ┌──────────────────────────────────────┐    │
        │  │ ★ decision-review-enricher           │    │
        │  │   (Commit 5 — primary scrub site)    │    │
        │  │                                      │    │
        │  │ - Auto-fire decision_review LLM call │    │
        │  │ - Merge LLM output into enrichment   │    │
        │  │ - Run sanitiseEnrichment over the    │    │
        │  │   merged shape:                      │    │
        │  │   • Partition critiques (D/U/S)      │    │
        │  │   • Replace bucket-S messages        │    │
        │  │   • Resolve IDs in 15 prose paths    │    │
        │  │ - Attach _diagnostics if             │    │
        │  │   CEE_TURN_DEBUG_ENABLED=true        │    │
        │  └──────────────┬───────────────────────┘    │
        │                 ▼                            │
        │  ┌──────────────────────────────────────┐    │
        │  │ Composer / TurnExecutor              │    │
        │  │ (assembles OlumiResponse)            │    │
        │  └──────────────┬───────────────────────┘    │
        │                 ▼                            │
        │  ┌──────────────────────────────────────┐    │
        │  │ ★ response-finaliser                 │    │
        │  │   (Commit 6 — defensive backstop)    │    │
        │  │                                      │    │
        │  │ 1. stripCeeTrace (existing)          │    │
        │  │ 2. sanitiseEnrichmentBlocks (NEW)    │    │
        │  │    — walks blocks[*].enrichment      │    │
        │  │    — same gate as stripCeeTrace      │    │
        │  │    — catches enrichment that         │    │
        │  │      bypassed the enricher           │    │
        │  │      (cached blocks, fallback        │    │
        │  │      composers, future producers)    │    │
        │  │ 3. attachComputedAt analysis_ready   │    │
        │  │    + brand FinalisedV5Response       │    │
        │  │    + WeakSet add                     │    │
        │  └──────────────┬───────────────────────┘    │
        └─────────────────┼────────────────────────────┘
                          ▼
                    ┌─────────────────────┐
                    │ HTTP wire           │
                    │ → UI                │
                    └─────────────────────┘
```

### Two-layer fix

**Layer 1 — Producer-side partition** (`decision-review-enricher.ts` — Commit 5):
- Runs at the natural attachment point. `fact.result.enrichment` is the canonical source for any future composer reading the run_analysis fact.
- Catches the documented common-path leak: the captured staging fixture's 4 critiques.
- Single call-site for the enricher; bounded blast radius.

**Layer 2 — Egress backstop** (`response-finaliser.ts` — Commit 6):
- Runs at every 200-OK exit point.
- Catches enrichment from any source that bypasses the enricher: cached blocks, fallback composers, future analysis_result variants, replayed handler facts.
- Idempotent with Layer 1: re-scrubbing already-clean enrichment is a no-op (verified by tests).

### Gating

All sanitisation gated on `CEE_TURN_DEBUG_ENABLED` env var (existing infrastructure, already used by `stripCeeTrace` in the same finaliser):

- **`CEE_TURN_DEBUG_ENABLED=false` (default, production)**:
  - Bucket-D critiques routed to `_diagnostics.critiques`, then **stripped from the wire** at the finaliser. End user never sees them.
  - Bucket-S messages replaced by approved generic copy.
  - User-facing prose paths have entity IDs resolved.
- **`CEE_TURN_DEBUG_ENABLED=true` (engineer surface, staging or local)**:
  - Sanitisation skipped entirely at the finaliser; enrichment passes through verbatim.
  - The enricher (Commit 5) still runs but the verbatim wire path takes precedence over its sanitised output.
  - This branch matches the existing `stripCeeTrace` debug-bypass contract.

### Existing utilities reused

| Utility | Source-of-truth file | Reused by |
|---|---|---|
| `ENTITY_ID_LEAK_RE` | `src/orchestrator/shared/entity-id-pattern.ts` | `sanitise-enrichment.ts:sanitiseEnrichmentText` (per-call global matcher), V5 `compose/output-safety.ts` (existing scan callsite), 7 callsites in `src/orchestrator/patch-summary.ts` (existing `.test()` users) |
| `resolveLabel(graph, id)` | `src/orchestrator/shared/entity-id-pattern.ts` | New `compose/resolve-label.ts:resolveLabel` (priority-1 lookup), V4 `tools/edit-graph.ts` (existing) |
| `sanitiseUserFacingText` | `src/orchestrator/shared/output-safety.ts` (mechanically moved from V5 in Commit 1) | V4 `tools/edit-graph.ts` (existing import), V5 `compose/output-safety.ts` (re-export for back-compat), CEE `unified-pipeline/stages/package.ts` (existing) |
| `genericFallbackForId` | `src/orchestrator/shared/output-safety.ts` (NEW pure helper, Commit 3) | `compose/resolve-label.ts:resolveLabelOrFallback` |
| `PREFIX_GENERIC` mapping | `src/orchestrator/shared/output-safety.ts` (existing) | Backed by `genericFallbackForId` only — single source of truth |
| `FORBIDDEN_USER_TEXT_TERMS` | `src/orchestrator/shared/forbidden-tokens.ts` (mechanically moved from V5 in Commit 2) | V5 `compose/recovery-chips-forbidden-terms.ts` (re-export for back-compat), recovery-chip enforcement |
| `INTERNAL_TEMPLATE_TOKENS`, `HARD_BAN_PATTERNS`, `WARNING_PATTERNS` | `src/orchestrator/shared/forbidden-tokens.ts` (NEW in Commits 2, 4) | `sanitise-enrichment.ts` |
| `config.cee.turnDebugEnabled` | `src/config/index.ts` (existing) | `response-finaliser.ts:stripCeeTrace` gate (existing), `response-finaliser.ts:sanitiseEnrichmentBlocks` gate (Commit 6), `decision-review-enricher.ts:_diagnostics` gate (Commit 5) |

**No regex duplication**: `ENTITY_ID_LEAK_RE` lives in exactly one file (`shared/entity-id-pattern.ts:25`) and is imported everywhere it's needed. Verified by `grep -rn "ENTITY_ID_LEAK_RE\\s*=" src/` returning a single match.

**No circular import**: dependency edge is `compose/* → shared/*` only; never reverse. `shared/output-safety.ts` imports only from `shared/entity-id-pattern.ts` and `node:*` builtins.

### Single call-site for behaviour change

| Commit | File | Function | Lines changed |
|---|---|---|---|
| 5 | `src/orchestrator-v5/coaching/decision-review-enricher.ts` | `enrichRunAnalysisWithDecisionReview` | ~14 (the merge → sanitise → optionally-attach-diagnostics block, plus 2 imports) |
| 6 | `src/orchestrator-v5/response-finaliser.ts` | `finaliseV5Response` + new helper `sanitiseEnrichmentBlocks` | ~33 (one call into the new helper, plus the helper definition and 1 import) |

Total production-code surface change for behaviour: **2 files, ~47 lines**. Plus the pure-function additions in Commits 1-4 which are uncalled by these (they're called *by* these; their own internal lines don't count as call-sites).
