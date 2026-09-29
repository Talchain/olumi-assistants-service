/**
 * The canonical writer's base-admissibility check, in ONE place (moved out of the option-level writer, DL 5897757819):
 * the writer and the confirm card both read it, so the card is never offered on a base the writer would refuse. This module
 * writes nothing and imports no writer (the consent manifest pins the writer's only consumer to `dispatch.ts`).
 */
import { isDeepStrictEqual } from 'node:util';
import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { assertIngressGraphNumericBounds, floorGraphSigmaForCompute } from '../../validators/numeric-bounds.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { normaliseAbsenceOnly, projectGraphForPersistence } from '../persisted-graph-projection.js';

export type EditableGraph = GraphV3T & Record<string, unknown>;

// Same check-only sigma projection used by commit and model-version receipts.
// This narrows the raw object; it NEVER returns the floored/parsed copy.
export function isEditableGraph(value: unknown): value is EditableGraph {
  const ingress = GraphStateIngressSchema.safeParse(value);
  return ingress.success && assertIngressGraphNumericBounds(ingress.data).ok
    && GraphV3.passthrough().safeParse(floorGraphSigmaForCompute(value).graph).success;
}

/**
 * ⭐ THE IDENTITY CONFIRMATION'S BASE CHECK, SHARED WITH THE CARD (DL 5897757819; R3 served witness 8826224, run o): the
 * writer refuses any identity commit on a base that fails this — e.g. a stated link with |β| > 1 fails
 * `assertIngressGraphNumericBounds` ("strength.mean must be a number within [-1, 1]") — so the card is withheld on exactly
 * this predicate instead of offering a Yes that cannot be written ("Not saved: none of it was applied").
 */
export function identityConfirmBaseIsWritable(before: unknown): before is EditableGraph {
  return isEditableGraph(before) && isDeepStrictEqual(projectGraphForPersistence(before), normaliseAbsenceOnly(before));
}
