/**
 * ⭐ ELICITED REFERENCE-CLASS BASE RATES — the module barrel.
 *
 * ROADMAP 2.688 slice 1 (+ its guard 2.722). Design:
 * `parallel-briefs/BASE-RATE-ELICITED-DESIGN-2026-08-08.md`.
 *
 * WHAT THIS IS. A user says "of the 7 product launches like this I've seen,
 * 3 hit their first-year target". The system recognises that
 * DETERMINISTICALLY (before any model call), shows back what it understood
 * with the arithmetic done honestly — a Beta posterior, central estimate WITH
 * its middle-half band, the class named in the user's own words — and
 * changes nothing until the user confirms.
 *
 * ⭐⭐ WHAT IT DELIBERATELY DOES NOT DO, in v1:
 *   - It does NOT write to the graph. There is nowhere honest to put a
 *     distribution on the turn path: `GRAPH_MUTATING_HANDLER_IDS` is
 *     {set_factor_value, add_constraint, adjust_edge_strength};
 *     `set-factor-value` writes a POINT `observed_state.{value, raw_value}`;
 *     `ObservedStateSchema.std` is declared by the schemas package as "a pure
 *     uncertainty tunable with a human setter and NO AI ACCESS"; and
 *     `PriorSchema {distribution, range_min, range_max}` is reachable only
 *     through `edit_graph`, which does not run inside `runTurnExecutor`
 *     (ROADMAP 2.628a). The display-and-carry shape is FORCED by that wall,
 *     not chosen for caution.
 *   - It does NOT reach compute. Nothing here is sent to ISL, blended into an
 *     estimate, or read by any analysis payload builder. That hop waits on the
 *     same unruled beta-blend question the range->distribution spec parks
 *     (§6.4: blend arithmetic between a human reading and the model's estimate
 *     is underdetermined). One gate, two waiting features — they ride the same
 *     future ruling. `__tests__/no-compute-effect.test.ts` proves the absence
 *     from a COMPLETE import manifest rather than asserting it.
 *   - It does NOT widen beyond the posterior. No comparability discount, no
 *     optimism correction. Those need a constant nobody has ruled, and a
 *     silent one would be an invented number wearing a method card.
 */

export {
  PRIOR_ALPHA,
  PRIOR_BETA,
  RATIFIED_COVERAGE,
  REFERENCE_CLASS_METHOD_VERSION,
  betaQuantile,
  deriveReferenceClassPosterior,
  formatPosteriorPercent,
  regularizedIncompleteBeta,
  type ReferenceClassPosterior,
} from './beta-posterior.js';

export {
  REFERENCE_CLASS_CONFIRM_PREFIX,
  isReferenceClassCollapseHazard,
  recogniseReferenceClass,
  type ParsedReferenceClass,
  type ReferenceClassClarifyReason,
  type ReferenceClassRecognition,
} from './reference-class-grammar.js';

export {
  createConfirmedReferenceClass,
  posteriorFor,
  type ReferenceClassElicitation,
  type ReferenceClassProvenance,
  type ReferenceClassTargetRef,
} from './reference-class-elicitation.js';

export {
  NOTHING_CHANGED_SENTENCE,
  NO_MODEL_EFFECT_SENTENCE,
  buildReferenceClassConfirmMessage,
  buildReferenceClassCorrectMessage,
  buildReferenceClassDisclosure,
  buildReferenceClassPreviewText,
  buildReferenceClassRecordedText,
  buildReferenceClassReply,
  type ReferenceClassReply,
} from './reference-class-disclosure.js';

export {
  OUTSIDE_VIEW_COUNTER_CASE,
  OUTSIDE_VIEW_DSK_PROTOCOL_ID,
  REFERENCE_CLASS_SOURCE_HANDLER,
  buildOutsideViewExerciseBlock,
  type ReferenceClassBlockCtx,
} from './reference-class-block.js';
