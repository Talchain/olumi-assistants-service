/**
 * ⭐ THE FIRST `opportunity_cost` EXERCISE THE PRODUCT EVER EMITS — ROADMAP 2.1299,
 * the first unblocked slice of the Frame-stage sequence.
 *
 * It makes explicit what committing to one option costs in forgone alternatives,
 * and it invents nothing: every option it names is a node the persisted draft
 * graph actually carries, named by that node's own id and the user's own label.
 *
 * ⭐ ZERO SCHEMA CHANGE, ZERO UI CHANGE — derived at the bytes, not assumed:
 *   - `ExerciseBlockSchema` (@talchain/schemas 0.46.0, `boundary/blocks.js:823`)
 *     already declares `exercise_kind: z.enum([... 'opportunity_cost' ...])`.
 *     Census at CEE staging `2ceb65f9`: ZERO emitters of that member in `src/`,
 *     against `pre_mortem` 33 / `consider_opposite` 8 / `devils_advocacy` 6 /
 *     `outside_view` 3 — a contrast control, so the zero is real and not probe
 *     blindness.
 *   - The DEPLOYED UI renderer is kind-AGNOSTIC. `V5ExerciseBlock.tsx` (DGAI
 *     staging `6a7e07bb`, verified against all 82 deployed `/assets/*.js`
 *     chunks) carries ZERO `exercise_kind` literals: the value is a pass-through
 *     `data-exercise-kind` attribute, and the UI adapter narrows it with
 *     `nonEmptyString(raw.exercise_kind)` — NOT to the enum. The card renders no
 *     title at all; each present prose field is a BARE paragraph with no heading.
 *
 * ⚠ WHAT THAT KIND-AGNOSTICISM COSTS, stated because it decides the copy: with
 * no heading and no kind-derived label, the prose is the ONLY thing that tells
 * the user what this card is. So the copy must be self-explaining — it cannot
 * lean on a caption that does not exist. And the UI adapter FAILS CLOSED: a
 * block carrying none of the six optional prose fields is dropped as
 * `malformed_phase3_block_suppressed`. The risk here is not an empty shell; it
 * is total invisibility. Hence `counter_case` is always populated or the block
 * is never built.
 *
 * ── THE SCIENCE, AND THE PART OF IT WE DO NOT CLAIM ─────────────────────────
 * DSK-T-004 "Opportunity cost neglect" → DSK-P-004 "Opportunity cost prompting
 * exercise" (`data/dsk/v1.json`, bundle v1.0.0), both `evidence_strength:
 * "medium"`.
 *
 * ⚠ THE DISPATCH BRIEF'S FRAMING OF THIS EVIDENCE IS NOT WHAT THE BUNDLE SAYS,
 * and the copy follows the bundle. The brief cited "Frederick et al. 2009
 * (d = 0.45–0.85)" and "explicit prompting measurably improves choice quality".
 * DSK-T-004's own `evidence_pack` says the Maguire, Persson & Tinghog 2023
 * meta-analysis (39 experiments, N = 14,005) found the effect **robust but far
 * smaller — d = 0.22** — and states in terms: "The original Frederick et al.
 * studies appear to be outliers that inflated the initial effect size estimate",
 * plus "Primary evidence comes from consumer choice studies, not organisational
 * decision-making." So the defensible claim is that making opportunity costs
 * salient SHIFTS how people weigh alternatives, not that it improves decision
 * quality — and this card therefore promises the user no improvement. Citing the
 * outlier figure over the meta-analysis would be a grounding badge over a number
 * the bundle itself withdraws, which is the #830 defect wearing a new hat.
 *
 * ── SELECTION IS THE PRODUCER'S, NOT OURS (P7) ──────────────────────────────
 * Every gate below is DSK-TR-004's, read from the bundle rather than invented.
 * Its `observable_signal` states the PoC heuristic verbatim: "fire if
 * option_count >= 3 from graph structure AND conversation history for this stage
 * contains none of: 'opportunity cost', 'trade-off', 'giving up', 'instead of',
 * 'alternative use', 'what else could', 'other options'". Its
 * `negative_conditions` supply the rest: not for binary go/no-go (the `>= 3`
 * floor already excludes those), not when the user has already weighed the
 * alternatives, not twice for one decision in one stage.
 *
 * ⚠ SCOPE OF THE KEYWORD SCAN, stated narrowly because the bundle says
 * "conversation history" and this path has no such thing. On the draft turn the
 * only user text in hand is the brief the drafter drafted from, so THAT is what
 * is scanned. This is a strictly smaller instrument than the bundle describes: a
 * trade-off discussed in a later turn is not visible to it. It is not widened
 * speculatively here — the draft turn is the only stage this builder runs in.
 *
 * ── WHY THIS DOES NOT NAME A LEADING OPTION ─────────────────────────────────
 * DSK-P-004's step 1 asks what is given up by committing to "[winning option]".
 * On the draft turn there IS no winning option: no analysis has run, so no
 * ranking exists, and naming one would be a leader claim made without the
 * permission seam that governs them (`compose/leading-option-egress-guard.ts`).
 * The card states the structural truth instead, which needs no leader and is
 * true of every option set: whatever goes to one of these cannot also go to the
 * others. Same protocol, honest at this stage.
 *
 * ── WHY IT ASKS FOR NOTHING IT CANNOT ACCEPT (P8) ───────────────────────────
 * DSK-P-004's step 3 offers "If you do want to add any alternatives, we can
 * include them in the model." THAT PROMISE IS DELIBERATELY OMITTED, and the card
 * carries NO chip and NO suggested action. Adding an option is a STRUCTURAL
 * mutation, which graph management HOLDS — so a chip inviting one would
 * terminate in a held proposal, which is precisely the live defect ROADMAP
 * 2.1288 recorded on the ideation widening card (chip enabled, CEE refuses,
 * taking it costs the user their Run affordance). What the card DOES ask for is
 * the protocol's own `expected_outputs[0]`, "explicit acknowledgement of
 * opportunity costs" — a statement, whose acceptance path is the ordinary
 * conversation turn that already absorbs free text. Statement-only is the honest
 * shape here, not a reduced one.
 */

import { ExerciseBlockSchema, type ExerciseBlock } from '@talchain/schemas/boundary';

import { deriveIntakeOptionReconciliation } from '../../orchestrator/context/intake-option-reconciliation.js';
import type { GraphV3T } from '../../orchestrator/types.js';
import { deterministicBlockId } from '../compose/block-id.js';
import { resolveDskProtocolProvenance } from '../compose/dsk-protocol-record.js';
import { findForbiddenPhraseHit, RAW_DECIMAL_RE } from '../compose/forbidden-user-facing-phrases.js';
import { log } from '../../utils/telemetry.js';

/**
 * DSK-P-004 "Opportunity cost prompting exercise" — the protocol this card
 * performs.
 *
 * The ID is written here; the TITLE and EVIDENCE STRENGTH are read from the
 * hash-verified bundle by `resolveDskProtocolProvenance`, never typed. That
 * asymmetry is CEE #830's lesson: a title written in this file could drift from
 * the science it names and nothing would notice.
 *
 * ⚠ AND IT IS THE **PROTOCOL** RESOLVER, not the claim resolver the dispatch
 * brief named. `ExerciseBlock.dsk_provenance` is `DskProtocolProvenanceSchema`,
 * whose `protocol_id` is `/^DSK-P-\d{3}$/`; `resolveDskClaimProvenance('DSK-T-004')`
 * would return a CLAIM triple that this field cannot carry, and
 * `resolveDskProtocolProvenance('DSK-T-004')` returns null by design. Either
 * mistake costs the badge silently.
 */
export const OPPORTUNITY_COST_DSK_PROTOCOL_ID = 'DSK-P-004';

export const OPPORTUNITY_COST_SOURCE_HANDLER = 'draft_opportunity_cost';

/**
 * DSK-TR-004's stated PoC threshold: `option_count >= 3`. At or above this the
 * card may speak; below it the set is a binary (or single) choice, which the
 * bundle's own `negative_conditions` exclude because opportunity costs are
 * "inherently salient" there.
 */
export const OPPORTUNITY_COST_OPTION_FLOOR = 3;

/**
 * DSK-TR-004's `observable_signal` keyword set, VERBATIM and in its order. A
 * hit means the user has already raised the trade-off, and the card stays
 * silent rather than lecturing them about their own point.
 *
 * ⚠ These are the bundle's seven, not a list of our own. If the bundle's
 * heuristic is later widened, this constant is what changes — and the spec
 * asserts each of the seven suppresses, so a silent truncation of this array
 * cannot pass.
 */
export const OPPORTUNITY_COST_PRIOR_DISCUSSION_MARKERS: readonly string[] = [
  'opportunity cost',
  'trade-off',
  'giving up',
  'instead of',
  'alternative use',
  'what else could',
  'other options',
];

/**
 * Character budget for the interpolated option-label clause. Over budget the
 * card falls back to the count-only sentence: a long option set costs the
 * card's SPECIFICITY, never its truth and never the card. Chosen to leave the
 * whole `counter_case` comfortably inside the wire's prose expectations while
 * admitting a realistic 3-5 option set with ordinary labels.
 */
export const OPPORTUNITY_COST_LABEL_BUDGET = 240;

/**
 * The fixed tail — the exercise instruction proper, derived from DSK-P-004's
 * step 1 ("what else could those same resources be used for? What are you
 * giving up?") and the acknowledgement half of its step 3, with step 3's
 * add-to-model promise removed (see the header's P8 note).
 *
 * FIXED and deterministic, the same class as `OUTSIDE_VIEW_COUNTER_CASE`. No
 * label, number or id is interpolated into it; the card's specificity comes
 * from the head sentence and from `target_refs`.
 */
export const OPPORTUNITY_COST_INSTRUCTION =
  ' Whatever time, budget and team capacity goes to one of them cannot also go to the others. Before analysing further, name what choosing each one would mean giving up — and if you have already weighed that and accepted it, say so rather than leaving it implicit.';

interface GraphOptionNode {
  readonly id: string;
  readonly label: string;
}

/**
 * The persisted option nodes, by IDENTITY. Reads `kind === 'option'` off the
 * graph's own nodes — the same structural predicate `countOptionNodes` uses in
 * the sibling widening builder — and keeps the node's id alongside its label so
 * every downstream reference binds to the object rather than to a string that
 * another node could also produce.
 */
export function readGraphOptionNodes(graph: GraphV3T | null | undefined): GraphOptionNode[] {
  const rawNodes = graph?.nodes;
  if (!Array.isArray(rawNodes)) return [];
  const out: GraphOptionNode[] = [];
  for (const node of rawNodes as readonly { id?: unknown; kind?: unknown; label?: unknown }[]) {
    if (node === null || typeof node !== 'object') continue;
    if (node.kind !== 'option') continue;
    const id = typeof node.id === 'string' ? node.id.trim() : '';
    const label = typeof node.label === 'string' ? node.label.trim() : '';
    if (id.length === 0 || label.length === 0) continue;
    out.push({ id, label });
  }
  return out;
}

/**
 * Has the user already raised the trade-off? DSK-TR-004's keyword scan, case
 * insensitive, over the brief the drafter drafted from.
 */
export function briefAlreadyWeighsTradeOffs(briefText: string | null | undefined): boolean {
  if (typeof briefText !== 'string' || briefText.length === 0) return false;
  const haystack = briefText.toLowerCase();
  return OPPORTUNITY_COST_PRIOR_DISCUSSION_MARKERS.some((m) => haystack.includes(m));
}

/**
 * Compose the single `counter_case` paragraph.
 *
 * Two forms, one shared tail. The named form quotes the user's OWN labels in
 * the graph's own node order; the count-only form is the over-budget fallback.
 * Both state the same thing and neither names anything the graph does not hold.
 */
export function composeOpportunityCostCounterCase(options: readonly GraphOptionNode[]): string {
  const count = options.length;
  const quoted = options.map((o) => `"${o.label}"`).join(', ');
  const head =
    quoted.length <= OPPORTUNITY_COST_LABEL_BUDGET
      ? `You have ${count} options in this model: ${quoted}.`
      : `You have ${count} options in this model.`;
  return head + OPPORTUNITY_COST_INSTRUCTION;
}

export interface BuildDraftOpportunityCostBlocksParams {
  /**
   * Sole admission authority for a user-visible draft card, mirroring both
   * draft siblings: missing, unknown and every non-ready status fail closed.
   */
  readonly analysisReady?: { readonly status?: unknown } | null;
  /** The drafted graph. Supplies the option identities and the user's labels. */
  readonly graph: GraphV3T | null | undefined;
  /**
   * The text the pipeline actually drafted from (`effectiveBrief`), so the
   * keyword scan and the anti-collision reconciler read the same brief the
   * drafter did. NOT `payload.message` (the 2.972 defect).
   */
  readonly briefText: string | null | undefined;
  /** ISO-8601 timestamp with offset, stamped on the emitted block. */
  readonly createdAt: string;
}

/**
 * Build AT MOST ONE `opportunity_cost` ExerciseBlock. Returns `[]` when nothing
 * honest can be shown. Pure; never throws.
 *
 * FAIL-CLOSED GATES, in this order:
 *   1. `analysisReady.status !== 'ready'` → []
 *   2. option count below DSK-TR-004's floor of 3 → [] (this is also the
 *      bundle's binary-go/no-go exclusion: a 2-option set cannot clear it)
 *   3. the brief already weighs the trade-off → [] (DSK-TR-004's keyword scan)
 *   4. `deriveIntakeOptionReconciliation` is in `options_missing` → [] — the
 *      trap-21 anti-collision gate, and the reasoning is the widening card's
 *      verbatim: when an option the user NAMED is missing, the product is in a
 *      REPAIR state, and a card about what the remaining options cost would be
 *      the product changing the subject away from its own error. Worse here
 *      than there, in fact: this card's whole claim is that the set it names is
 *      the set the model holds.
 *   5. the shared prose gates (`findForbiddenPhraseHit`, `RAW_DECIMAL_RE`) → null
 *   6. the strict 0.46.0 `ExerciseBlockSchema` parse → null
 *
 * ⚠ Gate 5 scans INTERPOLATED USER LABELS, so a user who names an option
 * something the denial-phrase guard catches loses this card. That is the
 * correct direction: a dropped card costs an affordance, a shipped one costs
 * the truth of the egress guarantee.
 *
 * ⚠ ONE GATE IS NOT HERE, and its absence is deliberate: the precedence rule
 * against the widening card lives at the CALL SITE, not in this function. See
 * the note in `draft-graph-dispatch.ts`. Keeping it there makes the ordering
 * visible where both builders are invoked, instead of hiding a claim about the
 * sibling inside this module where nothing would reveal it.
 *
 * ⚠⚠ WHY GATE 4 DOES NOT CALL `readGraphOptionLabels(graph)`, WHICH IS WHAT THE
 * SIBLING WIDENING CARD PASSES. That helper reads `source.options`
 * (`intake-option-reconciliation.ts:423-428`); a `GraphV3T` is `{nodes, edges}`
 * and carries no `options` key, so for a graph of this shape it returns `[]` —
 * measured by execution, not inferred. And `deriveIntakeOptionReconciliation`
 * with an EMPTY label list returns `not_applicable` even for a brief that
 * returns `options_missing` when handed the same graph's three real labels
 * (also measured). So a gate written that way cannot reach `options_missing` on
 * a `{nodes, edges}` graph: it is a guard agreeing with itself (trap 13b).
 * This builder therefore passes the labels it has already derived from the
 * option NODES, which is the shape this path actually holds, and the spec pins
 * the precondition IN-TEST so the gate's discrimination cannot decay silently.
 *
 * ⚠ SCOPE OF THAT FINDING, stated narrowly because it concerns another lane's
 * file and is NOT repaired here: what is proven is the helper's return for a
 * `{nodes, edges}` graph and the reconciler's return for an empty list. What is
 * NOT proven is whether `result.graphOutput` carries an extra `options` key at
 * runtime — `GraphV3Schema` is `.passthrough()`, so it could, and that would
 * make the sibling's gate live. Settling it needs the draft pipeline's actual
 * output shape or a live capture. Reported, not fixed.
 */
export function buildDraftOpportunityCostBlocks(
  params: BuildDraftOpportunityCostBlocksParams,
): ExerciseBlock[] {
  const { analysisReady, graph, briefText, createdAt } = params;

  // Gate 1 — the siblings' own first gate.
  if (analysisReady?.status !== 'ready') return [];

  // Gate 2 — DSK-TR-004's floor. Also the binary-go/no-go exclusion.
  const options = readGraphOptionNodes(graph);
  if (options.length < OPPORTUNITY_COST_OPTION_FLOOR) return [];

  // Gate 3 — the user has already raised it.
  if (briefAlreadyWeighsTradeOffs(briefText)) return [];

  // Gate 4 — the trap-21 anti-collision gate. See the note above on why the
  // labels come from `options` and not from `readGraphOptionLabels(graph)`.
  if (deriveIntakeOptionReconciliation(briefText, options.map((o) => o.label)).state === 'options_missing') {
    return [];
  }

  const counterCase = composeOpportunityCostCounterCase(options);

  // Gate 5 — the shared content gates. One named field, so a hit is
  // attributable without guessing which string tripped it.
  const phraseHit = findForbiddenPhraseHit(counterCase);
  if (phraseHit !== null) {
    emitDrop('prose_guard_forbidden_phrase', 'counter_case');
    return [];
  }
  if (RAW_DECIMAL_RE.test(counterCase)) {
    emitDrop('prose_guard_raw_decimal', 'counter_case');
    return [];
  }

  /**
   * Keyed on the option SET's identity — the node ids, in graph order — so the
   * same draft re-stated across turns carries the same `block_id` and the UI
   * dedupes it, while a draft whose option set actually changed gets a new one.
   * This is what satisfies DSK-TR-004's "do not fire twice for this decision in
   * this stage" without a separate ledger to go stale.
   */
  const signalId = ['exercise:opportunity_cost', ...options.map((o) => o.id)].join(':');

  // Resolved from the hash-verified bundle, never hand-typed. `null` (unknown /
  // deprecated / not a protocol / unverifiable bundle) means the badge is
  // omitted, not faked — a missing badge is a lost affordance, a wrong badge is
  // a lie about science.
  const dskProvenance = resolveDskProtocolProvenance(OPPORTUNITY_COST_DSK_PROTOCOL_ID);

  const candidate = {
    block_id: deterministicBlockId(signalId),
    signal_id: signalId,
    created_at: createdAt,
    source_handler: OPPORTUNITY_COST_SOURCE_HANDLER,
    freshness: 'fresh' as const,
    type: 'exercise' as const,
    exercise_kind: 'opportunity_cost' as const,
    counter_case: counterCase,
    /**
     * The forgone alternatives, BY IDENTITY. `TargetRefKind` admits 'option',
     * and ids are permitted in this structured field precisely because they are
     * forbidden in the prose ones (`blocks.js:367-369`). The deployed renderer
     * shows these as pills under `aria-label="Referenced elements"`, deduped by
     * id — so this is the card's identity channel to the user, not just
     * machine metadata.
     */
    target_refs: options.map((o) => ({ id: o.id, label: o.label, kind: 'option' as const })),
    ...(dskProvenance !== null ? { dsk_provenance: dskProvenance } : {}),
  };

  const parsed = ExerciseBlockSchema.safeParse(candidate);
  if (!parsed.success) {
    emitDrop('schema_validation_failed', parsed.error.issues[0]?.path?.join('.') ?? undefined);
    return [];
  }
  return [parsed.data];
}

function emitDrop(reason: string, field?: string): void {
  log.warn(
    {
      event: 'v5.draft_opportunity_cost.block_dropped',
      block_type: 'exercise',
      block_kind: 'opportunity_cost',
      drop_reason: reason,
      field,
    },
    'V5 draft opportunity-cost exercise block dropped before egress',
  );
}
