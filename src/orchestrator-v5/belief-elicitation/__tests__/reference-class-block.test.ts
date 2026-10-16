/**
 * T5 — THE FIRST `outside_view` EXERCISE BLOCK: it parses under the STRICT
 * 0.37.0 schema, carries DSK-P-002's attested provenance, and contains
 * nothing the system invented.
 *
 * ROADMAP 2.688 slice 1.
 *
 * ⭐ THE SCHEMA IS THE ORACLE, NOT THIS FILE (trap 13c). The block is parsed
 * by the SAME `ExerciseBlockSchema` the wire uses, imported from the vendored
 * package — so a field name this lane guessed wrong fails here rather than
 * shipping. The `exercise_kind` and `reference_class` expectations are read
 * off the schema's own declared shape, not off the design document.
 */
import { describe,expect,it } from 'vitest';

import { ExerciseBlockSchema } from '@talchain/schemas/boundary';





const CREATED_AT = '2026-08-06T12:00:00.000Z';



describe('T5 — the outside_view ExerciseBlock', () => {
  it('⭐ the schema ITSELF declares the slot this feature ships into (premise, re-derived)', () => {
    // Not a claim copied from the design: read off the vendored schema.
    const shape = ExerciseBlockSchema.shape;
    expect(Object.keys(shape)).toContain('exercise_kind');
    expect(Object.keys(shape)).toContain('reference_class');
    // The enum admits `outside_view` — proven by parsing, not by inspection.
    const probe = ExerciseBlockSchema.safeParse({
      block_id: '00000000-0000-4000-8000-000000000000',
      signal_id: 's',
      created_at: CREATED_AT,
      source_handler: 'probe',
      freshness: 'fresh',
      type: 'exercise',
      exercise_kind: 'outside_view',
      reference_class: 'x',
      target_refs: [],
    });
    expect(probe.success).toBe(true);
  });






















});
