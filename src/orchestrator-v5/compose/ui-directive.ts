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

import {
  liveLensExecutorAvailability,
  type GraphNodeLookup,
  type GraphNodeRef,
} from './phase3-blocks.js';
import { selectLens, type LensId } from './lens-selector.js';
import { mayNameLeadingOptionForFact } from './withheld-claim-projection.js';
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
    source: LADDER_SOURCE,
  };

  const parsed = UiDirectiveBlockSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * 0.39.0 `source` provenance. EVERY row in this file is deterministic,
 * fact-derived and CEE-authored, so every directive this module mints is
 * `ladder` — never `gate`, never `composer`. Stamped so a capture, the UI and
 * telemetry can distinguish a deterministic gesture from an LLM-proposed one;
 * before this, CEE stamped nothing and no capture could tell them apart, which
 * is the precondition for ever trusting a composer slot.
 *
 * ⚠ This is an ADDITIVE wire change: the emitted block gains a key. The exact
 * key-set pin in `__tests__/ui-directive-emit.test.ts` is updated in the same
 * commit — that pin exists to catch ACCIDENTAL field additions, and this one is
 * deliberate.
 */
const LADDER_SOURCE = 'ladder' as const;

// ============================================================================
// Wave-4 δ2 — the focus / open_inspector emit policy (ROADMAP 1.202), extended
// by Lane 2 (P3 UI agency, schemas 0.32.0) with the PANEL rows 5–6.
// "The AI points at the graph — and opens the surface it is talking about."
// A deterministic ladder over the fact class + entity kind — ZERO LLM
// authorship of verb/target. At most ONE directive per turn (the caller's
// `uiDirectiveEmitted` latch enforces N=1). Every drop is telemetered
// (reason-tagged) so a suppression is never a silent no-op.
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
//   5 · explain_results, ANSWERED (`precondition_unmet` false) → open_panel @
//       ui_target {kind:'tab', id:'results'} — the explanation opens the
//       results surface it explains. GATE IS precondition_unmet, NOT `noop`:
//       the live handler stamps noop:true on EVERY explain fact (it is a
//       no-op handler — explain-results.ts:124/215), so a noop gate would be
//       dead on arrival.
//   6 · explain_from_structure + ≥1 CONTESTED edge in the turn's persisted
//       graph (edges[].validation.status === 'contested', the two-pass
//       validation verdict the Model tab's relationships section renders) →
//       open_section @ ui_target {kind:'model_section', id:'relationships'}.
//       Zero contested / absent / malformed graph → suppressed — never open a
//       section with nothing remarkable.
//   (A compare_options row was considered and WITHDRAWN: no V5 handler
//   produces a compare_options fact — see the tools/handlers registry — so
//   the row could never fire; a wired gesture nothing can trigger is the
//   guarantee-theatre class.)
//
// Starvation analysis for the new rows: they are keyed to fact classes the
// existing four rows never consume (explain_* facts return null today), so
// rows 1–4 keep their gestures byte-identically; cross-fact contention stays
// governed by the caller's existing first-emit-wins latch, and explain facts
// never co-occur with run_analysis on a live turn (one handler per turn).
// ============================================================================

/** Reason tags for a suppressed directive — closed set, no user text. */
type UiDirectiveSuppressReason =
  | 'noop'
  | 'no_recommendation'
  | 'target_unresolved'
  | 'lens_subject_unresolved'
  | 'precondition_unmet'
  | 'no_flip_factor'
  /**
   * §2.1 row 6 (Lane 2, P3): explain_from_structure fired but the persisted
   * graph carries no contested edge (or is absent/malformed — fail-closed
   * collapses those to the same suppression: nothing remarkable to open).
   */
  | 'no_contested_edges'
  /**
   * T1 claim safety (ROADMAP 1.218): the turn's constraint verdict withholds
   * the leading-option claim, so the row-3 winner HIGHLIGHT is not emitted.
   * Distinct from `no_recommendation` on purpose — there IS a leader here and
   * we are declining to point at it, which is a different operational fact
   * from "the analysis produced none".
   */
  | 'leading_option_claim_withheld'
  /**
   * §2.1 row 7: the turn composed no card carrying a DISPATCHABLE entity
   * reference, so there is nothing the assistant is demonstrably discussing to
   * point at. Fail-closed — never point at nothing.
   */
  | 'no_discussed_entity';

function suppressDirective(factType: string, reason: UiDirectiveSuppressReason): null {
  emit(TelemetryEvents.V5UiDirectiveSuppressed, { fact_type: factType, reason });
  return null;
}

function emitDirective(factType: string, block: UiDirectiveBlock): UiDirectiveBlock {
  emit(TelemetryEvents.V5UiDirectiveEmitted, {
    fact_type: factType,
    verb: block.verb,
    // Graph verbs carry their target in targets[]; panel verbs (0.32.0) in
    // ui_target. One of the two is always present on an emitted block.
    target_kind: block.targets[0]?.kind ?? block.ui_target?.kind ?? null,
    // 0.39.0 gesture provenance, on the TELEMETRY as well as the wire — a
    // capture that can distinguish a deterministic gesture from an LLM-proposed
    // one is the precondition for ever trusting a composer slot, and telemetry
    // is where that distinction gets counted. Closed enum; no user text.
    source: block.source ?? null,
  });
  return block;
}

/** Build + strict-validate a single-target directive, or null on schema failure. */
function directiveFromRef(verb: UiDirectiveVerbLiteral, ref: GraphNodeRef): UiDirectiveBlock | null {
  const candidate: UiDirectiveBlock = {
    type: 'ui_directive',
    verb,
    targets: [{ id: ref.id, label: ref.label, kind: ref.kind }],
    source: LADDER_SOURCE,
  };
  const parsed = UiDirectiveBlockSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Build + strict-validate a PANEL directive (0.32.0 verbs), or null on schema
 * failure. `targets` is empty by contract — the target lives in `ui_target`
 * (the schema's cross-field rule enforces both halves; validate-before-emit
 * keeps this builder honest against it).
 */
function directiveFromUiTarget(
  verb: Extract<UiDirectiveVerbLiteral, 'open_panel' | 'open_section'>,
  uiTarget: NonNullable<UiDirectiveBlock['ui_target']>,
): UiDirectiveBlock | null {
  const candidate: UiDirectiveBlock = {
    type: 'ui_directive',
    verb,
    targets: [],
    ui_target: uiTarget,
    source: LADDER_SOURCE,
  };
  const parsed = UiDirectiveBlockSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * §2.1 row 6 derivation — count the persisted graph's CONTESTED edges (the
 * two-pass validation verdict: `edges[].validation.status === 'contested'`).
 * Fail-closed on every malformed shape: absent graph, non-array edges,
 * non-object edge/validation, any status other than the exact literal → 0.
 * Exported for direct unit coverage.
 */
export function countContestedEdges(graph: unknown): number {
  if (graph === null || typeof graph !== 'object') return 0;
  const edges = (graph as { edges?: unknown }).edges;
  if (!Array.isArray(edges)) return 0;
  let count = 0;
  for (const edge of edges) {
    if (edge === null || typeof edge !== 'object') continue;
    const validation = (edge as { validation?: unknown }).validation;
    if (validation === null || typeof validation !== 'object') continue;
    if ((validation as { status?: unknown }).status === 'contested') count += 1;
  }
  return count;
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
  previousAnalysisLens?: LensId | null,
): UiDirectiveBlock | null {
  if (fact.noop) return suppressDirective('run_analysis', 'noop');

  // Row 2 — the lens focus supersedes the winner highlight (D-53-1), gated on the
  // lens block's σ/prose survival AND a resolvable subject id.
  if (hasSurvivingLensBlock(freshBlocks)) {
    // ⚠ ROADMAP 2.211 — THIS IS THE SECOND `selectLens` DERIVATION OF ONE TURN,
    // and it MUST be handed the same `previousAnalysisLens` the block builder
    // got. Without it the tie-break applies at one call site and not the other:
    // the card would announce the pre-mortem lens while this directive told the
    // canvas to focus the flip-risk lens's factor — two derivations of one fact
    // disagreeing on one screen (CLAUDE.md trap 12/16). The executor injection
    // is shared for the same reason (`liveLensExecutorAvailability`).
    const selection = selectLens(fact, {
      ...liveLensExecutorAvailability(),
      previousAnalysisLens: previousAnalysisLens ?? null,
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
  //
  // T1 CLAIM SAFETY (ROADMAP 1.218 / A1 ruling on row 1.215). GATED, and note
  // which way round the live defect ran: the POST-#710 walk found the withheld
  // bodies shipping `highlight → <the leader>` on 5/5, while every PERMITTED
  // body shipped `focus → <a factor>` on 5/5. The one class of turn that must
  // not name a leader was the only class telling the canvas to point at it —
  // the inverse of the expected correlation, and not an accident: row 2's lens
  // `focus` supersedes this highlight, and the lens block is itself
  // leader-presuming, so layer 2 drops it on exactly these turns and the ladder
  // falls through to here.
  //
  // Scoped to row 3 deliberately. Row 2's `focus` targets a FACTOR and asserts
  // no leader; gating it too would cost the user their pointer on the turn they
  // most need one, which is the over-suppression half of the acceptance
  // criteria. Rows 1 and 4 (mutation / flip) never name a leader and are
  // untouched.
  //
  // HONEST SIZING, so nobody scores this as the fix. ⚠ CORRECTED 4 Aug 2026
  // (trap-14 — the previous sentence here had gone stale and was false): an
  // earlier render probe found `highlight` produced no styling at the
  // then-deployed UI tip, but highlight styling WORKS at the current tip (the
  // UI routes highlight targets into the applied-edit pulse — one 2s ring;
  // DGAI applyV5State.ts). The hygiene point stands on its own: a directive
  // that says "point at the leader" must not be emitted by the turn that just
  // declined to name one. The enrichment projection leak
  // (compose/withheld-claim-projection.ts) was the user-visible half.
  if (!mayNameLeadingOptionForFact(fact)) {
    return suppressDirective('run_analysis', 'leading_option_claim_withheld');
  }
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

/** §2.1 row 5 (Lane 2, P3) — an ANSWERED explain_results turn opens the
 *  results panel: `open_panel` @ {kind:'tab', id:'results'}. Gate is
 *  `precondition_unmet` (NOT `noop` — always true on explain facts, see the
 *  header). No auto-dock rides explain turns (auto-dock is driven by
 *  run/results-status transitions in the UI), so this is not redundant. */
function buildExplainResultsPanelDirective(
  fact: Extract<HandlerFact, { fact_type: 'explain_results' }>,
): UiDirectiveBlock | null {
  if (fact.result.precondition_unmet === true) {
    return suppressDirective('explain_results', 'precondition_unmet');
  }
  const block = directiveFromUiTarget('open_panel', { kind: 'tab', id: 'results' });
  if (block === null) return suppressDirective('explain_results', 'target_unresolved');
  return emitDirective('explain_results', block);
}

/** §2.1 row 6 (Lane 2, P3) — explain_from_structure with ≥1 contested edge in
 *  the turn's persisted graph opens the Model tab's relationships section:
 *  `open_section` @ {kind:'model_section', id:'relationships'} (the UI
 *  activates the diagnostics tab and auto-expands + scrolls the section).
 *  Fail-closed to `no_contested_edges` on zero/absent/malformed. */
function buildStructureContestedSectionDirective(
  fact: Extract<HandlerFact, { fact_type: 'explain_from_structure' }>,
  rawPersistedGraph: unknown,
): UiDirectiveBlock | null {
  if (countContestedEdges(rawPersistedGraph) === 0) {
    return suppressDirective(fact.fact_type, 'no_contested_edges');
  }
  const block = directiveFromUiTarget('open_section', {
    kind: 'model_section',
    id: 'relationships',
  });
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

// ============================================================================
// §2.1 ROW 7 — THE DISCUSSED-ENTITY TAIL. "The workspace follows the
// conversation." (P3 UI agency, component 3.)
//
// THE GAP THIS CLOSES: rows 1–6 are each keyed to a handler SIDE EFFECT — an
// applied mutation, a completed analysis, a flip query, an answered explain. So
// the assistant can point at what it just CHANGED or COMPUTED, and never at
// what it is merely TALKING ABOUT. When a card says "your gross margin floor is
// doing most of the work here", nothing on the canvas moves. That is precisely
// what "beside the canvas, not on it" feels like.
//
// ⭐ THE ENTITY-RESOLUTION ROUTE, and why it is not prose-matching. This row
// resolves NOTHING itself. It reuses an entity reference the composed cards
// ALREADY carry — the FIRST DISPATCHABLE ref, scanning blocks in order — a
// `TargetRef` that CEE resolved against the graph node lookup and that has
// already passed the block's own strict parse.
//
// ⚠ NOT `target_refs[0]`, which is what this comment said until 10 Aug 2026.
// The code has always skipped refs whose kind is outside
// ROW7_DISPATCHABLE_KINDS (and options on a withheld turn), so a card carrying
// `[goal, factor]` yields the FACTOR, not the goal. The code is the safer
// behaviour; the comment overstated how simple the rule is, which matters
// because "it is literally element zero" is the sentence a reader would use to
// conclude that ref ORDER cannot affect this row. It can, and it does.
//
// Consequences:
//   · it CANNOT point at an entity that does not exist (the ref came from the
//     graph lookup, which is closed over real nodes/edges);
//   · it CANNOT disagree with the card the user is reading, because it is the
//     same ref object — one derivation, two read points, the rule ROADMAP 2.211
//     already applies to `selectLens`;
//   · verb and target stay DETERMINISTIC and CEE-authored. Zero LLM authorship
//     of either, unchanged from rows 1–6.
//
// ⚠ DISCLOSURE ON REF PROVENANCE — NAMED, NOT CLOSED (ruling, 10 Aug 2026).
// `target_refs` CARRIES NO PROVENANCE STAMP. Most are derived structurally (a
// factor id → lookup: the evidence card, the lens subject, the flip-threshold
// row), but TWO coaching builders in phase3-blocks.ts populate theirs via
// `resolveProseEntityRefs`, which scans the card's own prose for graph node
// LABELS. A row-7 directive therefore INHERITS whatever confidence that matcher
// has. It is shipped and reviewed, with hard over-match rails — whole-phrase
// both-ends-bounded matching, a minimum label length, generic-token rejection,
// and a duplicate label resolving to NEITHER node — and it can only ever return
// ids that exist in the graph.
//
// ⭐ RESOLVED IN PART, 10 Aug 2026 (ROADMAP 2.1023). `resolveProseEntityRefs`
// used to return its refs in GRAPH LOOKUP order — the producer's node-array
// order, invisible to the reader — so this row could focus the incidental
// mention while the user read about the main subject ("your gross margin floor
// is doing most of the work, though team ramp time matters a little too" →
// focus @ Team ramp time, reproduced at the bytes). It now orders by FIRST
// MENTION IN THE PROSE, so the gesture follows the sentence. That is a pure
// reordering of the same set: this row's safety invariant is untouched — it
// still cannot point at anything the card does not already point at.
//
// Row 7 deliberately does NOT try to distinguish the two provenances. A
// hand-maintained list of "structural" builders would read correct on the day
// it was written and drift silently the first time someone adds a builder —
// the hand-maintained-mirror defect class. Stamping provenance ON `target_refs`
// is a contract change and is sequenced separately; it is NOT this lane's to
// invent. The gap is named here so the next reader inherits it.
//
// VERB: `focus` — bring into view. It asserts nothing about leadership (unlike
// `highlight`), which is what makes it safe as a discussion gesture.
//
// N=1: this is a strict TAIL. The caller reaches it only when the
// `uiDirectiveEmitted` latch is still unset, so a side-effect gesture ALWAYS
// wins and row 7 can never displace one. Rows 1–6 are byte-unchanged apart from
// the additive `source` stamp.
//
// ⚠ SCOPE — CURRENT-TURN FACTS ONLY. The caller invokes this BEFORE the
// prior-fact lifecycle rebuild and gates it on `facts.length > 0`, so row 7
// cannot fire on a turn the user did not initiate (a reload / session
// rehydration). A directive is a response to something the user JUST DID;
// moving their viewport otherwise is the workspace acting on its own
// initiative. See the call site in compose.ts for the full ruling.
// ============================================================================

/**
 * The `TargetRefKind`s row 7 will point at. DELIBERATELY NARROWER than the
 * boundary union, which also carries `goal`, `risk`, `constraint` and
 * `outcome`.
 *
 * Derived from what the shipped ladder DEMONSTRABLY dispatches, not from what
 * the schema permits: rows 2/4 point at `factor`, row 3 at `option`, and row 1
 * at whichever the graph lookup returns for a mutated target — which indexes
 * edges as `kind: 'edge'` (phase3-blocks.ts::populateGraphNodeLookup pass 2), so
 * `adjust_edge_strength` already ships edge targets. The four excluded kinds
 * have NO shipped precedent, and `constraint` is explicitly a known dead end
 * (the schema's own comment: "a schema-legal target with no renderer is a dead
 * end — the `constraint` TargetRefKind defect class, ROADMAP 2.457(b)").
 * Pointing at a target nothing renders is a gesture that silently does nothing.
 */
const ROW7_DISPATCHABLE_KINDS: ReadonlySet<string> = new Set(['factor', 'option', 'edge']);

/** Telemetry `fact_type` tag for row 7. Row 7 is not keyed to a handler fact —
 *  it is keyed to what the turn's cards discuss — so it needs its own tag, and
 *  the tag is the ONLY way to tell a row-7 gesture from a row-2 one: both emit
 *  `focus @ <factor>` and the block bytes are identical. */
const DISCUSSED_ENTITY_TAG = 'discussed_entity';

/** A block's `target_refs`, read defensively. Blocks that do not carry the
 *  field (graph_patch, text, analysis_result, the directive itself) yield []. */
function readTargetRefs(block: OlumiResponse['blocks'][number]): readonly GraphNodeRef[] {
  const refs = (block as { target_refs?: unknown }).target_refs;
  if (!Array.isArray(refs)) return [];
  const out: GraphNodeRef[] = [];
  for (const raw of refs) {
    if (raw === null || typeof raw !== 'object') continue;
    const { id, label, kind } = raw as { id?: unknown; label?: unknown; kind?: unknown };
    if (typeof id !== 'string' || id.length === 0) continue;
    if (typeof label !== 'string' || label.length === 0) continue;
    if (typeof kind !== 'string') continue;
    out.push({ id, label, kind } as GraphNodeRef);
  }
  return out;
}

/**
 * §2.1 row 7 — point at the entity this turn's cards DISCUSS.
 *
 * `blocks` is the turn's composed block list (the caller passes what it has
 * accumulated). `mayNameLeadingOption` is the turn's claim-safety verdict: when
 * FALSE, an `option` target is skipped — the withheld-claim gate must bite here
 * exactly as it does on row 3, because a directive that points at a leader the
 * product is not entitled to name is a trust defect wearing a UI gesture. A
 * FACTOR or EDGE target asserts no leader and stays permitted on those turns
 * (the same scoping row 3's comment sets out for row 2's `focus`).
 *
 * Fail-closed and telemetered on every path: no card carries a dispatchable ref
 * → `no_discussed_entity`; the only candidates were options on a withheld turn
 * → `leading_option_claim_withheld`; schema parse failure →
 * `target_unresolved`.
 */
export function buildDiscussedEntityUiDirective(
  blocks: readonly OlumiResponse['blocks'][number][],
  mayNameLeadingOption: boolean,
): UiDirectiveBlock | null {
  let withheldOptionSeen = false;

  for (const block of blocks) {
    for (const ref of readTargetRefs(block)) {
      if (!ROW7_DISPATCHABLE_KINDS.has(ref.kind)) continue;
      if (ref.kind === 'option' && !mayNameLeadingOption) {
        // Do not point at an option this turn may not name. Keep scanning: a
        // factor or edge later in the turn is still a legitimate target.
        withheldOptionSeen = true;
        continue;
      }
      const directive = directiveFromRef('focus', ref);
      if (directive === null) {
        return suppressDirective(DISCUSSED_ENTITY_TAG, 'target_unresolved');
      }
      return emitDirective(DISCUSSED_ENTITY_TAG, directive);
    }
  }

  return suppressDirective(
    DISCUSSED_ENTITY_TAG,
    withheldOptionSeen ? 'leading_option_claim_withheld' : 'no_discussed_entity',
  );
}

/**
 * The §2.1 emit ladder (wave-4 rows 1–4; Lane 2 P3 rows 5–6). Dispatches on
 * fact class; returns the SINGLE directive for this fact, or null
 * (fail-closed, telemetered). The caller gates every call behind the
 * `uiDirectiveEmitted` latch so at most one directive emits per turn (N=1).
 * `lookup` resolves the target label/kind (built from the enrichment/persisted
 * snapshot for run_analysis, or the persisted snapshot for mutation / flip
 * turns); `freshBlocks` is consulted only for the row-2 σ gate;
 * `rawPersistedGraph` only by row 6's contested-edge derivation (absent →
 * fail-closed suppression, never a throw). `add_constraint` (UI drops the
 * patch — fail-open avoided), `compare_options` (NO V5 producer exists — a row
 * would be unreachable), and `edit_graph` return null with no telemetry noise.
 */
export function buildFocusInspectorDirective(
  fact: HandlerFact,
  lookup: GraphNodeLookup,
  freshBlocks: OlumiResponse['blocks'],
  previousAnalysisLens?: LensId | null,
  rawPersistedGraph?: unknown,
): UiDirectiveBlock | null {
  switch (fact.fact_type) {
    case 'run_analysis':
      return buildRunAnalysisDirective(fact, lookup, freshBlocks, previousAnalysisLens);
    case 'set_factor_value':
    case 'adjust_edge_strength':
      return buildMutationInspectorDirective(fact, lookup);
    case 'what_would_flip':
      return buildFlipFocusDirective(fact, lookup);
    case 'explain_results':
      return buildExplainResultsPanelDirective(fact);
    case 'explain_from_structure':
      return buildStructureContestedSectionDirective(fact, rawPersistedGraph);
    default:
      // add_constraint (UI drops the patch — fail-open avoided), compare_options
      // (no V5 producer — unreachable), explain_result (deprecated literal,
      // historic rows only), edit_graph: no directive class.
      return null;
  }
}
