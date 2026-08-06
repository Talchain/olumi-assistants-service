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
import { describe, it, expect } from 'vitest';

import { ExerciseBlockSchema } from '@talchain/schemas/boundary';

import {
  OUTSIDE_VIEW_COUNTER_CASE,
  OUTSIDE_VIEW_DSK_PROTOCOL_ID,
  REFERENCE_CLASS_SOURCE_HANDLER,
  buildOutsideViewExerciseBlock,
} from '../reference-class-block.js';
import { createConfirmedReferenceClass } from '../reference-class-elicitation.js';
import { buildReferenceClassDisclosure } from '../reference-class-disclosure.js';

const CREATED_AT = '2026-08-06T12:00:00.000Z';

function elicitationFixture(overrides: { k?: number; n?: number; caveat?: string } = {}) {
  return createConfirmedReferenceClass({
    parsed: {
      class_description: "product launches like this I've seen",
      outcome_description: 'hit their first-year target',
      observed_k: overrides.k ?? 3,
      observed_n: overrides.n ?? 7,
      ...(overrides.caveat !== undefined ? { comparability_caveats: overrides.caveat } : {}),
    },
    session_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    stated_at: CREATED_AT,
  });
}

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

  it('parses under the STRICT schema and carries the disclosure as reference_class', () => {
    const elicitation = elicitationFixture();
    const block = buildOutsideViewExerciseBlock(elicitation, { created_at: CREATED_AT });
    expect(block).not.toBeNull();
    expect(ExerciseBlockSchema.safeParse(block).success).toBe(true);
    expect(block!.type).toBe('exercise');
    expect(block!.exercise_kind).toBe('outside_view');
    expect(block!.source_handler).toBe(REFERENCE_CLASS_SOURCE_HANDLER);
    expect(block!.freshness).toBe('fresh');
    // BYTE-EQUALITY with the single disclosure builder — the card cannot
    // carry a second, drifting rendering of the same numbers.
    expect(block!.reference_class).toBe(buildReferenceClassDisclosure(elicitation));
    expect(block!.counter_case).toBe(OUTSIDE_VIEW_COUNTER_CASE);
  });

  it('⭐ I4 ON THE CARD ITSELF — the block never ships a point without its band', () => {
    // ⚠ WHY THIS EXISTS, and it is the sharpest lesson from this lane's own
    // mutant kit. The byte-equality assertion above binds the card to
    // `buildReferenceClassDisclosure` — which means it agrees with that
    // builder WHATEVER the builder says. The M3 mutant (delete the interval)
    // REDded the disclosure suite and the pre-route suite and left this file
    // entirely GREEN: a card carrying a bare "central estimate 44%" with no
    // band would have shipped past a full block suite (CLAUDE.md trap 13b —
    // a guard whose evidence comes from itself).
    //
    // So the I4 property is asserted HERE INDEPENDENTLY, against the wire
    // string, with no reference to the builder that produced it.
    const block = buildOutsideViewExerciseBlock(elicitationFixture(), { created_at: CREATED_AT });
    expect(block!.reference_class).toMatch(/central estimate \d+%/);
    expect(block!.reference_class).toMatch(
      /middle half of the evidence sits between \d+% and \d+%/,
    );
  });

  it('I4 holds on the CARD for every count pair, independently of the builder', () => {
    for (let n = 1; n <= 12; n += 1) {
      for (let k = 0; k <= n; k += 1) {
        const block = buildOutsideViewExerciseBlock(elicitationFixture({ k, n }), {
          created_at: CREATED_AT,
        });
        expect(block, `dropped at K=${k} N=${n}`).not.toBeNull();
        expect(block!.reference_class, `K=${k} N=${n}`).toMatch(
          /middle half of the evidence sits between \d+% and \d+%/,
        );
      }
    }
  });

  it('carries DSK-P-002 provenance, with the TITLE read from the bundle, not typed here', () => {
    const block = buildOutsideViewExerciseBlock(elicitationFixture(), { created_at: CREATED_AT });
    expect(block!.dsk_provenance).toBeDefined();
    expect(block!.dsk_provenance!.protocol_id).toBe(OUTSIDE_VIEW_DSK_PROTOCOL_ID);
    expect(block!.dsk_provenance!.protocol_id).toBe('DSK-P-002');
    // The bundle's own record for DSK-P-002.
    expect(block!.dsk_provenance!.protocol_title).toBe('Outside view exercise');
    expect(block!.dsk_provenance!.evidence_strength).toBe('strong');
  });

  it('⭐ FAIL-CLOSED target_refs — v1 never names an element the class does not demonstrably inform', () => {
    const block = buildOutsideViewExerciseBlock(elicitationFixture(), { created_at: CREATED_AT });
    expect(block!.target_refs).toEqual([]);
  });

  it('the block_id is a deterministic UUID: same object, same id; different counts, different id', () => {
    const a = buildOutsideViewExerciseBlock(elicitationFixture(), { created_at: CREATED_AT });
    const b = buildOutsideViewExerciseBlock(elicitationFixture(), { created_at: CREATED_AT });
    const other = buildOutsideViewExerciseBlock(elicitationFixture({ k: 4 }), {
      created_at: CREATED_AT,
    });
    expect(a!.block_id).toBe(b!.block_id);
    expect(a!.block_id).not.toBe(other!.block_id);
    expect(a!.block_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('⭐ THE PROSE GUARD ADMITS THE NUMBERS — the open design question, settled by execution', () => {
    // The first NUMBER-BEARING exercise body the product emits. The Phase-3
    // guard bans LEADING raw decimals (`0.44`); the disclosure quotes whole
    // percentage points precisely so it does not trip it. Swept across every
    // count pair rather than spot-checked.
    for (let n = 1; n <= 20; n += 1) {
      for (let k = 0; k <= n; k += 1) {
        const block = buildOutsideViewExerciseBlock(elicitationFixture({ k, n }), {
          created_at: CREATED_AT,
        });
        expect(block, `dropped at K=${k} N=${n}`).not.toBeNull();
        expect(block!.reference_class).not.toMatch(/(?:^|[\s(=,])(?:0\.\d|\.\d)/);
      }
    }
  });

  it('every visible string is the user\'s or a fixed instruction — no interpolated ids or labels', () => {
    const block = buildOutsideViewExerciseBlock(elicitationFixture(), { created_at: CREATED_AT });
    // The fixed instruction interpolates nothing at all.
    expect(OUTSIDE_VIEW_COUNTER_CASE).not.toMatch(/\$\{|\bfac_|\bopt_|\bcon_|\bout_/);
    // The disclosure interpolates only the user's own words and derived
    // percentages — never the session id.
    expect(block!.reference_class).not.toContain('ffffffff-ffff-4fff-8fff-ffffffffffff');
  });

  it('carries the caveat verbatim into the card when the user gave one', () => {
    const block = buildOutsideViewExerciseBlock(
      elicitationFixture({ caveat: 'though the market was very different back then' }),
      { created_at: CREATED_AT },
    );
    expect(block!.reference_class).toContain('though the market was very different back then');
  });

  it('⭐ FAIL-CLOSED on unsafe prose — a drop costs the card, never the turn', () => {
    // Positive control first (trap 13): the guard must be able to see a
    // CLEAN block pass, or "it dropped" proves nothing.
    expect(buildOutsideViewExerciseBlock(elicitationFixture(), { created_at: CREATED_AT })).not.toBeNull();
    // A class description carrying a banned denial phrase drops the block.
    const unsafe = createConfirmedReferenceClass({
      parsed: {
        class_description: 'launches where nothing changed',
        outcome_description: 'succeeded',
        observed_k: 1,
        observed_n: 3,
      },
      session_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      stated_at: CREATED_AT,
    });
    expect(buildOutsideViewExerciseBlock(unsafe, { created_at: CREATED_AT })).toBeNull();
  });

  it('drops rather than ships when created_at is not a valid datetime', () => {
    expect(
      buildOutsideViewExerciseBlock(elicitationFixture(), { created_at: 'not-a-timestamp' }),
    ).toBeNull();
  });
});
