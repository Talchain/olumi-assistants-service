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
  type UiDirectiveModelSectionIdLiteral,
  type UiDirectiveVerbLiteral,
} from '@talchain/schemas/boundary';

// ROADMAP 2.640 — the remedy mapping's KEY SPACE is the readiness projection's
// own item taxonomy, imported as a type so the mapping cannot drift from it
// (see REMEDY_SECTION_BY_OPEN_ITEM_KIND: a new kind becomes a type error).
import type { ReadinessOpenItem } from '../routing/readiness-summary.js';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  liveLensExecutorAvailability,
  type GraphNodeLookup,
  type GraphNodeRef,
} from './phase3-blocks.js';
import { selectLens, type LensId } from './lens-selector.js';
import type { JudgementSignals } from './judgement-signals.js';
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

/**
 * ROADMAP 2.640 / UI-DIRECTIVE-0.38-DESIGN §3.4 — the SECOND authoring path,
 * and the first non-ladder producer this service has ever had.
 *
 * ⚠ The paragraph above says the stamp is "`ladder` — never `gate`, never
 * `composer`". That was true of every directive CEE emitted until this row and
 * is now true only of the LADDER builders. `gate` is emitted by exactly one
 * function — `buildGateRemedySectionDirective` — and `composer` still has no
 * producer. The enum value was reserved for this path when 0.39.0 shipped
 * (`UiDirectiveGestureSource`: "`gate` — the advice-gate deterministic
 * per-class mapping (§3.4)"), so this fills a designed, previously-unbuilt
 * contract slot rather than widening the wire.
 *
 * Why the distinction is load-bearing rather than cosmetic: a ladder directive
 * rides a HANDLER FACT (the user did something and the gesture follows the
 * result), whereas a gate directive rides a QUESTION the user asked that CEE
 * answered deterministically without a fact. A capture that cannot tell those
 * apart cannot tell whether a gesture followed an action or an enquiry, and
 * telemetry counts them separately for exactly that reason.
 */
const GATE_SOURCE = 'gate' as const;

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
//   2a· run_analysis + a SURVIVING lens block whose OWN first target_ref is an
//       EDGE → open_inspector @ that edge (PR2 COMPLETE LOOP, L3). SUPERSEDES
//       row 3 for the three relationship lenses; can never contend with row 2,
//       which is structurally unreachable for them. See the builder's comment.
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
  | 'no_discussed_entity'
  /**
   * ROADMAP 2.640 / §3.4 — the readiness gate's TOP blocking item does not map
   * to one of the five Model-tab section ids, so there is no surface to open.
   *
   * This is the fail-closed arm and it fires on REAL, COMMON inputs, not just
   * on malformed ones: `goal_threshold_missing` has no section (the five ids
   * are options/factors/relationships/risks/modelcard — there is no goal
   * section), and `option_needs_mapping` is deliberately unmapped pending a
   * derivation of where an option-to-factor connection is actually created.
   *
   * Opening the WRONG section is worse than opening none: the gesture is an
   * implicit claim that the remedy lives there, and a user sent to a surface
   * where they cannot act learns the assistant's gestures are unreliable. This
   * suppression keeps the answer's PROSE (which already names the blocker) and
   * declines only the gesture.
   */
  | 'remedy_surface_unmapped';

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
  // Defaulted to the ladder so every EXISTING call site keeps its exact bytes
  // (this parameter is additive; the row-5/row-6 builders below pass nothing).
  // Only the gate-remedy builder overrides it.
  source: typeof LADDER_SOURCE | typeof GATE_SOURCE = LADDER_SOURCE,
): UiDirectiveBlock | null {
  const candidate: UiDirectiveBlock = {
    type: 'ui_directive',
    verb,
    targets: [],
    ui_target: uiTarget,
    source,
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
function findSurvivingLensBlock(
  freshBlocks: OlumiResponse['blocks'],
): OlumiResponse['blocks'][number] | undefined {
  return freshBlocks.find(
    (b) =>
      b.type === 'coaching' &&
      b.source === 'deterministic_signal' &&
      b.coaching_kind === 'strengthen',
  );
}

function hasSurvivingLensBlock(freshBlocks: OlumiResponse['blocks']): boolean {
  return findSurvivingLensBlock(freshBlocks) !== undefined;
}

/**
 * §2.1 ROW 2a (PR2 COMPLETE LOOP, L3) — THE CARD POINTS AT WHAT IT NAMES.
 *
 * THE GAP THIS CLOSES, derived at this tip rather than assumed. Every lens that
 * points at a RELATIONSHIP — `fragile_edge_resolution` and the two judgement
 * lenses — sets `subjectFactorId: null` in its evaluator
 * (`lens-selector.ts::evaluateFragileEdgeResolution` / the two judgement
 * evaluators), so `selection.subjectRef` is ABSENT and row 2's factor `focus` is
 * STRUCTURALLY UNREACHABLE for them. They fall through to row 3, and the user
 * reading *"the two drafting passes disagreed about the link from A to B"* is
 * shown a `highlight` on the LEADING OPTION — or, on a withheld turn, nothing at
 * all. The one card class that most needs "point at what I name" is the one the
 * ladder never covered.
 *
 * (The design predicted row 2 "targets a FACTOR and cannot collide on kind".
 * True, and weaker than the measured position: this row displaces ROW 3 for
 * these lenses and can never contend with row 2.)
 *
 * VERB — `open_inspector`, NOT `focus`. It selects WITHOUT moving the camera
 * (`applyV5State.ts`: `selectEdgeWithoutHistory`), and the user is mid-sentence
 * in the card; yanking the viewport out from under them is the opposite of "act
 * where the reasoning is". No new verb, no new schema field, no UI change.
 *
 * TARGET — the SURVIVING CARD'S OWN `target_refs[0]`, never a re-derivation from
 * `selection.judgementEdge`. One derivation, two read points (the rule ROADMAP
 * 2.211 already applies to `selectLens`, and the route row 7 established): the
 * ref has already been resolved against the graph and has passed the block's own
 * strict parse, so this row CANNOT point at an entity that does not exist and
 * CANNOT disagree with the card the user is reading. Composing the id here from
 * `${fromId}→${toId}` would be a second spelling of one identity — the
 * `generateGraphHash`-twins shape.
 *
 * GATE — it reads the SURVIVING block list, so it inherits the σ/prose gate
 * unchanged: a lens block that σ dropped is not in `freshBlocks`, and the
 * directive drops with it. Never a "look here" at a card that did not ship.
 *
 * CLAIM SAFETY — deliberately NOT gated on `mayNameLeadingOptionForFact`. An
 * EDGE target names no option and asserts no leader, which is the same scoping
 * row 3's own comment sets out for row 2's factor `focus` and row 7 applies to
 * factor/edge refs. A withheld turn keeps its pointer.
 *
 * Fail-closed: a lens block whose first ref is missing, malformed or not an edge
 * returns null and the ladder continues to rows 2/3 exactly as before.
 */
function buildLensEdgeInspectorDirective(
  freshBlocks: OlumiResponse['blocks'],
): UiDirectiveBlock | null {
  const lensBlock = findSurvivingLensBlock(freshBlocks);
  if (lensBlock === undefined) return null;
  const ref = readTargetRefs(lensBlock)[0];
  if (ref === undefined || ref.kind !== 'edge') return null;
  return directiveFromRef('open_inspector', ref);
}

/** §2.1 rows 2 + 3 — lens focus (supersedes) or the v1 winner-highlight floor. */
function buildRunAnalysisDirective(
  fact: RunAnalysisHandlerFact,
  lookup: GraphNodeLookup,
  freshBlocks: OlumiResponse['blocks'],
  previousAnalysisLens?: LensId | null,
  judgementSignals?: JudgementSignals,
): UiDirectiveBlock | null {
  if (fact.noop) return suppressDirective('run_analysis', 'noop');

  // Row 2a (PR2 COMPLETE LOOP, L3) — an EDGE lens points at its own edge. Placed
  // FIRST inside the run_analysis rows because it is strictly more specific than
  // both of them: it fires only when the surviving card already carries an edge
  // ref, and on exactly those turns rows 2 and 3 were pointing somewhere else
  // (row 2 is unreachable for every edge lens — see the builder's own comment —
  // and row 3 points at the leader, which the card is not about). It cannot
  // displace rows 1/4/5/6: those key off different fact classes entirely.
  const edgeInspector = buildLensEdgeInspectorDirective(freshBlocks);
  if (edgeInspector !== null) return emitDirective('run_analysis', edgeInspector);

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
      // ROADMAP 2.692 slice 2 — spread-if-present so the options object stays
      // byte-identical for unthreaded callers.
      ...(judgementSignals !== undefined ? { judgementSignals } : {}),
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

// ============================================================================
// ROADMAP 2.640 / UI-DIRECTIVE-0.38-DESIGN §3.4 — THE GATE-CLOSE REMEDY ROW.
//
// The capability, in one sentence: when a user asks why their model will not
// run and CEE answers deterministically, the assistant also OPENS the section
// where the blocker is fixed, instead of only describing it.
//
// This is not a ladder row. It rides no handler fact — it rides the
// post-analysis advice gate's `readiness` class, which composes its answer from
// `summariseReadiness` (routing/readiness-summary.ts) with zero LLM calls. The
// gesture is therefore as deterministic as the prose it accompanies.
//
// ⚠ THE MAPPING IS DERIVED FROM BOTH PRODUCERS' BYTES, NOT FROM THIS LANE'S
// READING (trap 13c: an expectation written from the author's model of a field
// is a perfect score on the wrong exam). Each row below cites the producer
// semantics on the CEE side AND the surface semantics on the UI side, and any
// kind whose remedy surface could not be settled at the bytes is UNMAPPED
// rather than guessed.
// ============================================================================

/**
 * Telemetry's `fact_type` dimension is a free-form string on this event, and
 * every existing emitter passes a real handler fact type. A gate directive has
 * NO fact, so it passes this explicit sentinel rather than an empty string or a
 * borrowed fact name — a dashboard that cannot separate gate gestures from
 * fact-driven ones would silently merge two different populations.
 */
const GATE_REMEDY_FACT_TAG = 'advice_gate_readiness';

/**
 * `ReadinessOpenItem['kind']` → the Model-tab section id whose surface the
 * remedy lives on, or `null` to emit no gesture.
 *
 * ⚠ TOTALITY IS DELIBERATE, AND IT IS THE POINT OF THE `null`s. This is a
 * `Record` over the CLOSED kind union, so adding a fifth kind to
 * `ReadinessOpenItem` is a TYPE ERROR here rather than a silent fall-through to
 * "no gesture". A hand-maintained subset that quietly stopped covering a new
 * kind is precisely the drift class this estate keeps paying for (trap 12); an
 * exhaustive record cannot go short without the compiler saying so.
 *
 * Producer semantics (CEE) — routing/readiness-summary.ts:67–96, and the status
 * enum's own doc comment at schemas/analysis-ready.ts:58–64.
 * Surface semantics (UI) — the five section ids are rendered by
 * ModelTabBody.tsx:780–845, one component per id.
 */
export const REMEDY_SECTION_BY_OPEN_ITEM_KIND: Record<
  ReadinessOpenItem['kind'],
  UiDirectiveModelSectionIdLiteral | null
> = {
  /**
   * "you need at least 2 options before the analysis can compare them"
   * (readiness-summary.ts:67–72). The remedy is to add an option, and options
   * are rendered by `OptionsSection` — `makeSectionProps('options')`,
   * ModelTabBody.tsx:785, fed `optionNodes={grouped.option}`.
   */
  too_few_options: 'options',

  /**
   * "X is connected to factors but has no numeric values set"
   * (readiness-summary.ts:81–87), whose status the schema defines as "Has raw
   * values (categorical/boolean) awaiting numeric encoding"
   * (analysis-ready.ts:62). The values in question are the OPTION's
   * interventions, and `OptionsSection`'s own header states it renders "one row
   * per intervention: Factor label | baseline ... → target value (EDITABLE)"
   * (OptionsSection.tsx:2–7). So the surface that opens is the surface the
   * number is typed into.
   */
  option_needs_encoding: 'options',

  /**
   * ⛔ DELIBERATELY UNMAPPED — "X isn't connected to any factors yet"
   * (readiness-summary.ts:75–80).
   *
   * The remedy is to CREATE an option-to-factor connection, and this lane could
   * not settle at the bytes whether a user creates that in `RelationshipsSection`
   * (which renders `edges={causalEdges}`, and is where ContestedSection.tsx:96
   * and PreAnalysisPanel.tsx:2304 both send edge work) or in `OptionsSection`
   * (which renders the intervention rows that ARE an option's factor links).
   * The two are different surfaces and only one is right.
   *
   * A directive is an implicit claim that the remedy lives where it points, so
   * an unsettled row emits nothing and the user still gets the prose. Rowed for
   * derivation; mapping it is a one-line change once the surface is settled.
   */
  option_needs_mapping: null,

  /**
   * ⛔ DELIBERATELY UNMAPPED — "the goal node doesn't have a measurable success
   * threshold set" (readiness-summary.ts:90–96).
   *
   * There is NO goal section: the contract's five ids are options, factors,
   * relationships, risks, modelcard (schemas 0.39.0 `UiDirectiveModelSectionId`,
   * blocks.d.ts:1857). This row is not a gap in the mapping — it is the honest
   * answer that the remedy surface does not exist in the enum, and it is why
   * the builder must be able to decline.
   */
  goal_threshold_missing: null,
};

/**
 * ROADMAP 2.640 §3.4 row 1 — build the readiness gate's remedy gesture.
 *
 * `openItemKind` is the kind of the TOP blocking item, i.e. `open_items[0]`.
 * "Top" is the PRODUCER's own ordering, not a re-ranking by this module:
 * `summariseReadiness` pushes too-few-options first, then per-option items in
 * option order, then the goal threshold (readiness-summary.ts:65–98). Choosing
 * the first item is what makes the gesture agree with the FIRST thing the prose
 * tells the user to fix; re-sorting here would let the sentence and the gesture
 * disagree about which blocker matters most, which is the two-authorities
 * defect (trap 21) waiting to happen.
 *
 * Returns `null` (telemetered) when the kind has no mapped surface, or when the
 * built block fails strict boundary validation — never a partially-formed
 * gesture. At most one directive is produced per call, and the gate path calls
 * this at most once per turn (N=1 across the turn: a gate turn short-circuits
 * before any ladder builder runs, because the ladder rides handler facts and a
 * gate turn has none).
 */
export function buildGateRemedySectionDirective(
  openItemKind: ReadinessOpenItem['kind'],
): UiDirectiveBlock | null {
  const sectionId = REMEDY_SECTION_BY_OPEN_ITEM_KIND[openItemKind];
  if (sectionId === null) {
    return suppressDirective(GATE_REMEDY_FACT_TAG, 'remedy_surface_unmapped');
  }
  const block = directiveFromUiTarget(
    'open_section',
    { kind: 'model_section', id: sectionId },
    GATE_SOURCE,
  );
  if (block === null) return suppressDirective(GATE_REMEDY_FACT_TAG, 'target_unresolved');
  return emitDirective(GATE_REMEDY_FACT_TAG, block);
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
  // ROADMAP 2.692 slice 2 — the SAME judgement feed compose handed the lens
  // surface, so this module's second `selectLens` derivation of the turn
  // cannot disagree with the card about which lens won (the trap-12/16 rule
  // this file already states for `previousAnalysisLens`).
  judgementSignals?: JudgementSignals,
): UiDirectiveBlock | null {
  switch (fact.fact_type) {
    case 'run_analysis':
      return buildRunAnalysisDirective(fact, lookup, freshBlocks, previousAnalysisLens, judgementSignals);
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
