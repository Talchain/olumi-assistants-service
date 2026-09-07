/**
 * DERIVE the accepted `structure_query.kind` literals from the enforcing Zod
 * union itself.
 *
 * ⭐ WHY THIS EXISTS. Two separate guards used to hand-list the kinds — the tool
 * advert's enum test and the "no other kind produces dependency evidence" test.
 * Both were hand-maintained mirrors of a union that changes, and both stayed
 * GREEN when a fifth arm was added. This estate's dominant defect is exactly
 * that: a list a human must remember to sync, whose drift reads as green.
 *
 * ⚠ Two arms of the union are `ZodEffects` (they carry a `.refine`), not
 * `ZodObject`, so a naive `.shape` read returns `undefined` for them and the
 * derivation silently short-changes itself. Unwrapping is not optional, and the
 * callers assert a plausible minimum count so a blind read cannot pass as a
 * match between two short lists.
 */
import { StructureQuerySchema } from '../types.js';

export function deriveStructureQueryKinds(): readonly string[] {
  return (StructureQuerySchema.options as readonly unknown[]).map((option) => {
    let node = option as { _def: Record<string, unknown> };
    while ((node._def as { typeName?: string }).typeName === 'ZodEffects') {
      node = (node._def as { schema: { _def: Record<string, unknown> } }).schema;
    }
    const shape = (node._def as { shape: () => Record<string, { _def: { value: string } }> }).shape();
    return shape.kind!._def.value;
  });
}
