/**
 * ⭐ THE FIRST `outside_view` EXERCISE THE PRODUCT EVER EMITS — and it
 * fabricates nothing: every number in it is the user's, or derived from the
 * user's by one named rule.
 *
 * ROADMAP 2.688 slice 1. Design:
 * `parallel-briefs/BASE-RATE-ELICITED-DESIGN-2026-08-08.md` §4.2.
 *
 * ⭐ ZERO SCHEMA CHANGE, ZERO UI CHANGE — verified at the bytes, not assumed:
 *   - `ExerciseBlockSchema` (@talchain/schemas 0.37.0, `boundary/blocks.js`)
 *     already declares `exercise_kind: z.enum([... 'outside_view' ...])` and
 *     `reference_class: z.string().min(1).optional()`.
 *   - The UI renders `reference_class` as a bare paragraph, testid
 *     `v5-exercise-reference-class` (`src/v5/blocks/V5ExerciseBlock.tsx`,
 *     DGAI staging `a81121d1`), and `mapV5Blocks.ts` carries the field
 *     through with no content-presence drop for the exercise arm.
 * The gap was never the display slot. It was that nothing computed content
 * honest enough to put in it.
 *
 * ⚠ WHY THIS BUILDER DOES NOT REUSE `phase3-blocks.ts`'s `commonMetadata`.
 * That helper is bound to the ANALYSIS path: it stamps
 * `source_handler: 'decision_review_enricher'` and REQUIRES
 * `graph_hash_at_generation`. Neither is true here — this exercise is
 * produced by an elicitation pre-route, not by the review enricher, and it
 * is graph-agnostic (the schema's own comment sanctions exactly that:
 * "graph_hash_at_generation OPTIONAL (some exercises are graph-agnostic)").
 * Claiming the enricher as the source handler would be a false provenance
 * stamp on a block whose entire point is honest provenance. What IS reused,
 * rather than re-implemented, is everything that could drift: the strict
 * schema (`ExerciseBlockSchema`), the deterministic id derivation
 * (`deterministicBlockId`), the attested DSK record lookup
 * (`resolveDskProtocolProvenance`), and the canonical banned-phrase scan
 * (`findForbiddenPhraseHit`).
 */

import { ExerciseBlockSchema, type ExerciseBlock } from '@talchain/schemas/boundary';
import { deterministicBlockId } from '../compose/block-id.js';
import { resolveDskProtocolProvenance } from '../compose/dsk-protocol-record.js';
import {
  findForbiddenPhraseHit,
  RAW_DECIMAL_RE,
} from '../compose/forbidden-user-facing-phrases.js';
import { log } from '../../utils/telemetry.js';
import { buildReferenceClassDisclosure } from './reference-class-disclosure.js';
import type { ReferenceClassElicitation } from './reference-class-elicitation.js';

/**
 * DSK-P-002 "Outside view exercise" — the protocol this card performs.
 *
 * The ID is written here; the TITLE and EVIDENCE STRENGTH are read from the
 * bundle by `resolveDskProtocolProvenance`, never typed. That asymmetry is
 * deliberate and is CEE #830's lesson: a title written in this file could
 * drift from the science it names and nothing would notice. Resolution is
 * fail-closed — an unverifiable bundle costs the badge, never the card.
 */
export const OUTSIDE_VIEW_DSK_PROTOCOL_ID = 'DSK-P-002';

export const REFERENCE_CLASS_SOURCE_HANDLER = 'reference_class_elicitation';

/**
 * The exercise instruction. FIXED, deterministic, prose-guard-clean copy —
 * the same class as `CONSIDER_OPPOSITE_COUNTER_CASE` / the DSK slice-1
 * companions, and derived from DSK-P-002's own step 2 ("How does your
 * current plan compare to that base rate?") and step 3 (whether to adjust
 * factor values). No label, number, or id is ever interpolated into it: the
 * card's specificity comes from `reference_class`, which is the user's own
 * words and their own counts.
 */
export const OUTSIDE_VIEW_COUNTER_CASE =
  'Now compare your current plan against that base rate. If your plan implies a better outcome than the group you just described, name what is different about this case that justifies the gap — and if you cannot name it, treat the base rate as the better starting point.';

export interface ReferenceClassBlockCtx {
  /** ISO 8601 with offset. */
  readonly created_at: string;
}

/**
 * Build the `outside_view` ExerciseBlock for a CONFIRMED reference class.
 *
 * FAIL-CLOSED at three gates, in this order:
 *   1. the canonical banned-phrase scan (`findForbiddenPhraseHit`),
 *   2. the leading-raw-decimal scan (`RAW_DECIMAL_RE`) — the disclosure
 *      quotes WHOLE percentage points precisely so it stays clean of this,
 *      and the check is here so a future copy edit that reintroduces `0.44`
 *      drops the block rather than shipping it,
 *   3. the strict 0.37.0 `ExerciseBlockSchema` parse.
 * A failure drops the block and logs structural metadata only — never the
 * user's prose. The turn still carries the disclosure in `assistant_text`,
 * so a dropped block costs the card, never the answer.
 */
export function buildOutsideViewExerciseBlock(
  elicitation: ReferenceClassElicitation,
  ctx: ReferenceClassBlockCtx,
): ExerciseBlock | null {
  const referenceClass = buildReferenceClassDisclosure(elicitation);
  const proseFields: readonly { readonly name: string; readonly value: string }[] = [
    { name: 'reference_class', value: referenceClass },
    { name: 'counter_case', value: OUTSIDE_VIEW_COUNTER_CASE },
  ];
  for (const field of proseFields) {
    const phraseHit = findForbiddenPhraseHit(field.value);
    if (phraseHit !== null) {
      emitDrop('prose_guard_forbidden_phrase', field.name);
      return null;
    }
    if (RAW_DECIMAL_RE.test(field.value)) {
      emitDrop('prose_guard_raw_decimal', field.name);
      return null;
    }
  }

  // Keyed on the object's IDENTITY (session + counts + the verbatim class),
  // so re-stating the same recorded class across turns carries the same
  // block_id and the UI dedupes it — and two DIFFERENT classes in one
  // session never collide.
  const signal_id = [
    'exercise:outside_view',
    elicitation.provenance.session_id,
    `${elicitation.observed_k}/${elicitation.observed_n}`,
    elicitation.class_description,
  ].join(':');

  const dskProvenance = resolveDskProtocolProvenance(OUTSIDE_VIEW_DSK_PROTOCOL_ID);

  const candidate = {
    block_id: deterministicBlockId(signal_id),
    signal_id,
    created_at: ctx.created_at,
    source_handler: REFERENCE_CLASS_SOURCE_HANDLER,
    freshness: 'fresh' as const,
    type: 'exercise' as const,
    exercise_kind: 'outside_view' as const,
    reference_class: referenceClass,
    counter_case: OUTSIDE_VIEW_COUNTER_CASE,
    // ⭐ ALWAYS EMPTY IN v1 — fail-closed, deliberately. Naming an element
    // the class does not demonstrably inform would be a fabricated link on
    // a card whose whole claim is that nothing on it was invented, and the
    // pre-route resolves no target: the user described a class of PAST
    // cases, which need not correspond to any node in this graph. The
    // object carries an optional identity-bound `target_ref` for the carry
    // slice, which has a graph lookup and can resolve one by identity; when
    // it does, this is where it lands. Until then the card renders on its
    // prose, exactly as the DSK slice-1 companions do on a lookup miss.
    target_refs: [],
    ...(dskProvenance !== null ? { dsk_provenance: dskProvenance } : {}),
  };

  const parsed = ExerciseBlockSchema.safeParse(candidate);
  if (!parsed.success) {
    emitDrop('schema_validation_failed', parsed.error.issues[0]?.path?.join('.') ?? undefined);
    return null;
  }
  return parsed.data;
}

function emitDrop(reason: string, field?: string): void {
  log.warn(
    {
      event: 'v5.reference_class.block_dropped',
      block_type: 'exercise',
      block_kind: 'outside_view',
      drop_reason: reason,
      field,
    },
    'V5 reference-class exercise block dropped before egress',
  );
}
