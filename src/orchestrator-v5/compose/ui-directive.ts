/**
 * ui_directive block builder — ROADMAP 2.27 / seamlessness R4 (CEE half,
 * slice 1). UNCONDITIONAL since #539 deleted CEE_UI_DIRECTIVE_EMIT
 * (Paul's 19 Jul no-dark-launch ruling; was live `true` on staging);
 * invoked at the single call site in compose.ts::buildBlocksFromFacts —
 * this builder is pure.
 *
 * ONE deterministic emission, ZERO LLM authorship: on a successful
 * CURRENT-TURN run_analysis fact, point the UI at the analysis's
 * recommended option with verb `highlight` and a single typed TargetRef.
 * Only schema-required fields are populated — no free-text `note` (nothing
 * for the egress scrubber to scrub; zero hallucination surface) and no
 * `duration_ms` in this slice.
 *
 * Fail-closed (returns null, never a partial block):
 *   - `noop: true` fact (analysis did not actually run);
 *   - `leading_option_id` null/absent (no recommendation);
 *   - recommended id unresolvable in `enrichment.graph.nodes[]` OR the
 *     persisted-snapshot fallback (see buildGraphNodeLookup — the live
 *     PLoT envelope carries no `graph` key, so in production the
 *     fallback is the only real source) — the Phase-3 §0.1 invariant
 *     applies: NEVER fall back to id-as-label;
 *   - recommended id resolves to a non-option node kind (defensive: a
 *     `leading_option_id` that names a factor/goal is upstream corruption,
 *     not something to point the UI at);
 *   - final safeParse against the strict boundary UiDirectiveBlockSchema
 *     fails (validate-before-emit, same discipline as phase3-blocks.ts —
 *     drop the block, never weaken the schema).
 *
 * Stale-analysis and fallback-recovery suppression live at the call site:
 * compose.ts only invokes this inside the current-turn run_analysis branch
 * with a verified `graph_hash_at_run` (the same gate the fresh Phase-3
 * blocks use); prior-fact lifecycle rebuilds and recovery composers never
 * reach this builder.
 */

import {
  UiDirectiveBlockSchema,
  type OlumiResponse,
  type UiDirectiveBlock,
  type UiDirectiveVerbLiteral,
} from '@talchain/schemas/boundary';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import type { GraphNodeLookup, GraphNodeRef } from './phase3-blocks.js';
import { selectLens, whatIfSuggestionExecutorAvailable } from './lens-selector.js';
import { config } from '../../config/index.js';
import { emit, TelemetryEvents } from '../../utils/telemetry.js';

/**
 * Build the single recommended-option `ui_directive` block for a
 * current-turn run_analysis fact, or null when any fail-closed condition
 * holds. Deterministic: no LLM input, no clock, no randomness.
 *
 * `lookup` is the graph-node lookup the compose call site already built
 * for this fact's Phase 3 blocks (review F2: one build per fact, shared
 * between the Phase 3 rebuild and this builder). It carries the
 * hash-gated persisted-snapshot fallback where the caller allowed it —
 * in production that fallback is the only source that can resolve the
 * option target, since the PLoT /v2/run envelope carries no `graph` key.
 */
export function buildRecommendedOptionUiDirective(
  fact: RunAnalysisHandlerFact,
  lookup: GraphNodeLookup,
): UiDirectiveBlock | null {
  if (fact.noop) return null;

  const leadingOptionId = fact.result.leading_option_id;
  if (typeof leadingOptionId !== 'string' || leadingOptionId.length === 0) {
    return null;
  }

  const ref = lookup.get(leadingOptionId);
  if (ref === undefined || ref.kind !== 'option') return null;

  const candidate: UiDirectiveBlock = {
    type: 'ui_directive',
    verb: 'highlight',
    targets: [{ id: ref.id, label: ref.label, kind: 'option' }],
  };

  const parsed = UiDirectiveBlockSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

// ============================================================================
// Wave-4 δ2 — the focus / open_inspector emit policy (ROADMAP 1.202).
// "The AI points at the graph." A deterministic ladder over the fact class +
// entity kind — ZERO LLM authorship of verb/target. At most ONE directive per
// turn (the caller's `uiDirectiveEmitted` latch enforces N=1). Every drop is
// telemetered (reason-tagged) so a suppression is never a silent no-op.
//
// §2.1 trigger table:
//   1 · set_factor_value / adjust_edge_strength (applied) → open_inspector @ the
//       mutated node/edge (label resolved from the persisted-snapshot lookup —
//       the fact's `after` snapshot carries no label; add_constraint EXCLUDED).
//   2 · run_analysis + a SURVIVING lens block + a resolvable subject → focus @
//       the lens subject factor. SUPERSEDES the winner-highlight (D-53-1).
//   3 · run_analysis, no lens (or lens subject unresolved) → the v1 highlight @
//       the recommended option (unchanged — the regression-proof floor).
//   4 · what_would_flip (precondition met) → focus @ the first flip factor.
// ============================================================================

/** Reason tags for a suppressed directive — closed set, no user text. */
type UiDirectiveSuppressReason =
  | 'noop'
  | 'no_recommendation'
  | 'target_unresolved'
  | 'lens_subject_unresolved'
  | 'precondition_unmet'
  | 'no_flip_factor';

function suppressDirective(factType: string, reason: UiDirectiveSuppressReason): null {
  emit(TelemetryEvents.V5UiDirectiveSuppressed, { fact_type: factType, reason });
  return null;
}

function emitDirective(factType: string, block: UiDirectiveBlock): UiDirectiveBlock {
  emit(TelemetryEvents.V5UiDirectiveEmitted, {
    fact_type: factType,
    verb: block.verb,
    target_kind: block.targets[0]?.kind ?? null,
  });
  return block;
}

/** Build + strict-validate a single-target directive, or null on schema failure. */
function directiveFromRef(verb: UiDirectiveVerbLiteral, ref: GraphNodeRef): UiDirectiveBlock | null {
  const candidate: UiDirectiveBlock = {
    type: 'ui_directive',
    verb,
    targets: [{ id: ref.id, label: ref.label, kind: ref.kind }],
  };
  const parsed = UiDirectiveBlockSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Wave-3 σ COMPOSITION (§Q3): a `focus` on a lens subject may fire ONLY when the
 * lens's accompanying coaching block SURVIVED the prose/schema gate (and, when it
 * carries a value, wave-3 σ) — i.e. is present in `freshBlocks`. When σ later
 * drops a value-bearing lens block, this returns false and the paired directive
 * drops with it (no "look here" at a caged number). The lens block is the unique
 * `deterministic_signal` / `strengthen` coaching block.
 */
function hasSurvivingLensBlock(freshBlocks: OlumiResponse['blocks']): boolean {
  return freshBlocks.some(
    (b) =>
      b.type === 'coaching' &&
      b.source === 'deterministic_signal' &&
      b.coaching_kind === 'strengthen',
  );
}

/** §2.1 rows 2 + 3 — lens focus (supersedes) or the v1 winner-highlight floor. */
function buildRunAnalysisDirective(
  fact: RunAnalysisHandlerFact,
  lookup: GraphNodeLookup,
  freshBlocks: OlumiResponse['blocks'],
): UiDirectiveBlock | null {
  if (fact.noop) return suppressDirective('run_analysis', 'noop');

  // Row 2 — the lens focus supersedes the winner highlight (D-53-1), gated on the
  // lens block's σ/prose survival AND a resolvable subject id.
  if (hasSurvivingLensBlock(freshBlocks)) {
    const selection = selectLens(fact, {
      executorAvailable: {
        what_if_counterfactual: whatIfSuggestionExecutorAvailable(Boolean(config.isl.baseUrl)),
      },
    });
    const subjectRef = selection?.subjectRef;
    if (subjectRef !== undefined) {
      const ref = lookup.get(subjectRef.id);
      if (ref !== undefined && ref.kind === 'factor') {
        const block = directiveFromRef('focus', ref);
        if (block !== null) return emitDirective('run_analysis', block);
      }
      // Lens present + survived but the subject didn't resolve → fall through to
      // the v1 highlight (the safe floor), never to nothing.
    }
  }

  // Row 3 — the shipped v1 recommended-option highlight (byte-unchanged path when
  // no lens is active: this IS the regression-proof floor).
  const highlight = buildRecommendedOptionUiDirective(fact, lookup);
  if (highlight !== null) return emitDirective('run_analysis', highlight);
  return suppressDirective('run_analysis', 'no_recommendation');
}

/** §2.1 row 1 — open_inspector on the mutated factor node / edge. */
function buildMutationInspectorDirective(
  fact: Extract<HandlerFact, { fact_type: 'set_factor_value' | 'adjust_edge_strength' }>,
  lookup: GraphNodeLookup,
): UiDirectiveBlock | null {
  const { target_id, status } = fact.result;
  // Only an APPLIED mutation — a noop inspector would imply a change that didn't
  // happen (fail-closed).
  if (status !== 'applied') return suppressDirective(fact.fact_type, 'noop');
  if (typeof target_id !== 'string' || target_id.length === 0) {
    return suppressDirective(fact.fact_type, 'target_unresolved');
  }
  // The mutation fact's `after` snapshot carries no label; resolve the node's
  // label + kind from the persisted-snapshot lookup (labels are stable across
  // set_factor_value / adjust_edge_strength). Miss → fail-closed.
  const ref = lookup.get(target_id);
  if (ref === undefined) return suppressDirective(fact.fact_type, 'target_unresolved');
  const block = directiveFromRef('open_inspector', ref);
  if (block === null) return suppressDirective(fact.fact_type, 'target_unresolved');
  return emitDirective(fact.fact_type, block);
}

/** §2.1 row 4 — focus on the first flip factor (precondition met). */
function buildFlipFocusDirective(
  fact: Extract<HandlerFact, { fact_type: 'what_would_flip' }>,
  lookup: GraphNodeLookup,
): UiDirectiveBlock | null {
  if (fact.result.precondition_unmet) {
    return suppressDirective('what_would_flip', 'precondition_unmet');
  }
  const factorId = fact.result.flip_scenarios?.[0]?.factor_id;
  if (typeof factorId !== 'string' || factorId.length === 0) {
    return suppressDirective('what_would_flip', 'no_flip_factor');
  }
  const ref = lookup.get(factorId);
  if (ref === undefined || ref.kind !== 'factor') {
    return suppressDirective('what_would_flip', 'target_unresolved');
  }
  const block = directiveFromRef('focus', ref);
  if (block === null) return suppressDirective('what_would_flip', 'target_unresolved');
  return emitDirective('what_would_flip', block);
}

/**
 * The wave-4 §2.1 emit ladder. Dispatches on fact class; returns the SINGLE
 * directive for this fact, or null (fail-closed, telemetered). The caller gates
 * every call behind the `uiDirectiveEmitted` latch so at most one directive
 * emits per turn (N=1). `lookup` resolves the target label/kind (built from the
 * enrichment/persisted snapshot for run_analysis, or the persisted snapshot for
 * mutation / flip turns); `freshBlocks` is consulted only for the row-2 σ gate.
 * `add_constraint`, `compare_options`, `explain_*`, and `edit_graph` return null
 * (no directive class — §2.1 / §5) with no telemetry noise.
 */
export function buildFocusInspectorDirective(
  fact: HandlerFact,
  lookup: GraphNodeLookup,
  freshBlocks: OlumiResponse['blocks'],
): UiDirectiveBlock | null {
  switch (fact.fact_type) {
    case 'run_analysis':
      return buildRunAnalysisDirective(fact, lookup, freshBlocks);
    case 'set_factor_value':
    case 'adjust_edge_strength':
      return buildMutationInspectorDirective(fact, lookup);
    case 'what_would_flip':
      return buildFlipFocusDirective(fact, lookup);
    default:
      // add_constraint (UI drops the patch — fail-open avoided), compare_options
      // (many ids — diluted gesture), explain_*, edit_graph: no directive class.
      return null;
  }
}
