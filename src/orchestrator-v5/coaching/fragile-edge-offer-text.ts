/**
 * ROADMAP 2.1024 — the fragile-edge offer's TEXT and its COMPOSABILITY test,
 * extracted to a PURE LEAF so the selector can ask the question before it makes
 * the lens eligible.
 *
 * ── WHY THIS FILE EXISTS AT ALL (the defect it closes) ───────────────────────
 * `phase3-blocks.ts::buildFragileEdgeOffer` fails CLOSED — correctly — when the
 * offer cannot be composed from this run's producer-authored endpoint labels: a
 * naming sentence longer than the body cap, or an acceptance prompt that trips
 * `route-v2`'s edit-intent gates (the veto set is ordinary strategic vocabulary
 * — `flip`, `why`, `compare`, `describe`, `explain`, `show me`, `tell me` — so
 * "Why Customers Churn" or "Flip Risk Threshold" is enough).
 *
 * What was WRONG is what happened next: the lens had already WON the single
 * proactive slot, so `buildLensSurface` dropped **the entire coaching card** and
 * the turn shipped no intervention at all. A run with six other live triggers
 * went silent because the seventh could not be phrased. Worse, it went silent
 * QUIETLY: `buildLensSurface` returned before `v5.capability.lens_suggestion_emitted`
 * fired, while the earlier `v5.capability.fragile_edge_selection` event reported
 * `refusal_reason: null` — the one alarm that did fire said nothing was wrong.
 *
 * The fix is not a better failure path; it is asking the question EARLIER.
 * Composability is a property of the CANDIDATE, so it belongs with the trigger
 * and the executor check, in the selector's eligibility stage: an offer that
 * cannot be composed never becomes eligible, and the slot passes to the next
 * intervention by the ordinary rules. `buildFragileEdgeOffer`'s own fail-closed
 * stays exactly where it is, as an unreachable-through-`selectLens` backstop —
 * a lens id and its payload travelling as two fields is precisely the pairing a
 * future refactor can break.
 *
 * ── WHY IT IS A LEAF ─────────────────────────────────────────────────────────
 * `selectLens` is a PURE, TOTAL function of `(fact, options)` and must stay one:
 * `compose/lens-history.ts` REPLAYS it over prior facts to derive
 * `previousAnalysisLens`, so any impurity forks the history. `phase3-blocks.ts`
 * imports config, telemetry and the block schemas, so the selector cannot import
 * it (and it would be a cycle besides). This module imports NOTHING but the two
 * route regexes, which are themselves a deliberate pure extraction
 * (`orchestrator/routing/edit-graph-intent-regex.ts`, whose own header says it
 * exists so "the product's OWN copy can be tested against the gates it must pass
 * — without importing the whole route module (and its config / telemetry /
 * Supabase side effects)").
 *
 * ⚠ THE SAME REGEX OBJECTS THE ROUTE USES ARE IMPORTED — never a re-declared
 * copy, which is the hand-maintained-mirror defect (CLAUDE.md trap 12) and would
 * drift silently the first time the veto set is edited.
 *
 * ⚠ AND THE GATE IS EVALUATED ON THE ACTUAL STRING, at composition time, on every
 * run. Asserting the gates in a test is NOT this check: the fixture labels are
 * the lane's own, and a corpus from the author's head cannot see the class the
 * author did not imagine (trap 22). The labels are PRODUCER data.
 */

import {
  EDIT_GRAPH_NEGATIVE_REGEX,
  EDIT_GRAPH_POSITIVE_REGEX,
} from '../../orchestrator/routing/edit-graph-intent-regex.js';

/**
 * The coaching block body cap. SINGLE-SOURCED here rather than duplicated:
 * `compose/phase3-blocks.ts` imports it as its `BODY_MAX`, so the length gate
 * the selector applies and the truncation the block mint applies cannot drift
 * apart. Two copies of this number is the mirror class, and the failure mode is
 * silent (a card that names half a relationship).
 */
export const COACHING_BLOCK_BODY_MAX = 300;

/**
 * The contract cap for `action_prompt` (`PHASE3_ACTION_PROMPT_MAX`, schemas
 * 0.31.0). SINGLE-SOURCED here for the same reason {@link COACHING_BLOCK_BODY_MAX}
 * is: `phase3-blocks.ts` TRUNCATES to this number, and a composability gate that
 * used a different one would let a truncation re-cut a word into — or out of —
 * a veto token, silently changing which route the shipped prompt takes. Two
 * copies of this number is the mirror class and the failure is silent.
 *
 * The fragile-edge prompt cannot reach it (the naming guard bounds the combined
 * label length to 224, so that prompt is at most 278 — pinned by test). The
 * judgement-lens prompts CAN: their naming sentences are shorter, so they admit
 * longer labels, and `judgement-offer-text.ts` gates on this explicitly.
 */
export const COACHING_ACTION_PROMPT_MAX = 300;

/** The label the acceptance chip carries. Producer-authored, fixed. */
export const FRAGILE_EDGE_ACTION_LABEL = 'Adjust this relationship';

/**
 * The sentence that NAMES the relationship. It LEADS the body, and the lens's
 * generic tail follows — because the body is truncated at
 * {@link COACHING_BLOCK_BODY_MAX} and a naming sentence placed last is the first
 * thing truncation eats (measured: the naming-last ordering silently dropped the
 * second endpoint label on the live capture, so the card named half a
 * relationship).
 */
export function composeFragileEdgeNaming(fromLabel: string, toLabel: string): string {
  return `On this run the link from ${fromLabel} to ${toLabel} is one relationship the robustness check flagged as fragile.`;
}

/** Compose the acceptance turn — the EXACT string the block ships. */
export function composeFragileEdgeActionPrompt(fromLabel: string, toLabel: string): string {
  return `Adjust the strength of the link from ${fromLabel} to ${toLabel} in my model.`;
}

/**
 * NAMING SENTENCE FIRST, THE LENS'S TAIL SECOND — the one composition rule, and
 * the one length gate, shared by all three offers.
 *
 * ⚠ ONE DEFINITION, THREE CALLERS EACH. `compose{FragileEdge,Override,
 * Disagreement}Body` were three byte-identical `${naming} ${base}` templates and
 * `is{...}OfferComposable` three byte-identical `naming.length <= CAP` tests, in
 * two files. Both rules are a PRODUCT decision with a measured cause — the
 * ordering because a naming sentence placed last is the first thing truncation
 * eats (it silently dropped an endpoint label on the live capture), the cap
 * because it is the body cap the block mint truncates at — so three copies of
 * each is the hand-maintained mirror class (CLAUDE.md trap 12) applied to
 * user-facing copy: fixing one and missing another ships two different rules
 * with nothing red. The three NAMING SENTENCES stay distinct; only the
 * assembly and the gate are shared.
 */
export function composeOfferBody(naming: string, base: string): string {
  return `${naming} ${base}`;
}

/** Does a naming sentence survive {@link COACHING_BLOCK_BODY_MAX} untruncated? */
export function namingFitsBodyCap(naming: string): boolean {
  return naming.length <= COACHING_BLOCK_BODY_MAX;
}

/** Naming sentence first, the lens's generic tail second. */
export function composeFragileEdgeBody(base: string, fromLabel: string, toLabel: string): string {
  return composeOfferBody(composeFragileEdgeNaming(fromLabel, toLabel), base);
}

/**
 * Can an offer for this relationship be composed AND dispatched?
 *
 * Three gates, in the order `buildFragileEdgeOffer` applies them, over the
 * PRODUCER-authored endpoint labels:
 *   1. the naming sentence alone must survive the body cap — otherwise
 *      truncation ships a card naming one endpoint and trailing off, which is
 *      worse than no offer because it still carries an action chip;
 *   2. the acceptance prompt must MATCH `EDIT_GRAPH_POSITIVE_REGEX`, or the turn
 *      never reaches the `edit_graph` dispatch and the chip is inert (2.770: no
 *      inert chips, ever);
 *   3. the acceptance prompt must NOT match `EDIT_GRAPH_NEGATIVE_REGEX`, the
 *      meta-question veto.
 *
 * Deliberately NOT included: `scanProse`. That guard lives on the whole composed
 * block (title + body + action fields) and is the block mint's own gate; it
 * needs the schema-validation context this leaf does not have. The consequence
 * is disclosed rather than hidden: a label that trips `scanProse` but clears all
 * three gates here still reaches `buildFragileEdgeOffer`'s neighbour
 * (`validateProseAndSchemaOrDrop`) and drops the block there — i.e. the residual
 * silent-turn window is narrowed to the prose-scanner class, not closed. Closing
 * it needs `scanProse` extracted to a leaf too, which is a separate change to a
 * guard with many readers and is NOT bundled here.
 */
export function isFragileEdgeOfferComposable(fromLabel: string, toLabel: string): boolean {
  if (!namingFitsBodyCap(composeFragileEdgeNaming(fromLabel, toLabel))) return false;
  return isEditGraphDispatchable(composeFragileEdgeActionPrompt(fromLabel, toLabel));
}

/**
 * Would `route-v2` read this message as an EDIT instruction?
 *
 * The two regex gates, in the order the route applies them, over the composed
 * message — extracted from {@link isFragileEdgeOfferComposable} unchanged so the
 * judgement-lens offer (`judgement-offer-text.ts`) asks the SAME question of the
 * SAME string rather than re-stating the pair. One definition, three callers.
 *
 * ⚠ THIS IS TWO CONJUNCTS OF FIVE, NOT THE WHOLE ROUTE. `route-v2.ts:4128`'s
 * `editVerbCandidate` is `positiveEditRegexHit && !negativeEditRegexHit &&
 * !valueUpdatePhrasingHit && !analyticalQuestionDetected && !stateQuerySuppressed`.
 * A `false` here is SUFFICIENT for "cannot dispatch"; a `true` here is
 * NECESSARY-NOT-SUFFICIENT.
 *
 * ⚠⚠ AND THE RESIDUE IS REAL, NOT THEORETICAL — this comment previously read
 * *"(the fragile-edge prompt clears the other three by shape)"* and that was
 * FALSE, refuted by rebuilding `editVerbCandidate` from the route's own imports
 * and running it over the committed live captures: on **2 of the 22 capture
 * label pairs** this predicate says yes and the route says no, via
 * `valueUpdatePhrasingHit` — the producer label *"Raise Group Operating Profit
 * by 8% Within 18 Months"* is itself value-update phrasing. Those turns are not
 * dead buttons and not wrong mutations: they are refused at the edge-phrasing
 * gate and fall to the generic LLM router, so the guarantee on them is
 * NON-DETERMINISTIC rather than absent. The exact divergent set is pinned in
 * `compose/__tests__/judgement-offer-action.test.ts` §6 and REDs if it grows OR
 * shrinks. Closing the three uncovered conjuncts is rowed separately.
 *
 * The asymmetry is also why the probe-side gate in `judgement-offer-text.ts`
 * asserts `isAnalyticalQuestion`: a prompt can carry a producer-authored edit
 * verb and still be un-dispatchable, and the measured corpus contains that class.
 */
export function isEditGraphDispatchable(message: string): boolean {
  if (!EDIT_GRAPH_POSITIVE_REGEX.test(message)) return false;
  if (EDIT_GRAPH_NEGATIVE_REGEX.test(message)) return false;
  return true;
}
