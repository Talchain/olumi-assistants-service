/**
 * The system-event kind vocabulary is DERIVED here, never mirrored.
 *
 * ⚠ WHY THIS FILE EXISTS. `dispatch.ts` carried, for as long as it existed, the
 * comment: "Typed against `SystemEventKindLiteral` so adding a new kind to the
 * schema without updating this list is a compile-time error (not a silent
 * runtime miss)." It was attached to a `ReadonlySet<SystemEventKindLiteral>`,
 * and **it was false**: a `Set` with three members satisfies `ReadonlySet<X>`
 * however many members `X` has. Nothing went red, ever.
 *
 * That is not hypothetical. It is exactly how `factor_value_edit` arrives — a
 * new kind lands in the vendored schema, no gate fires, and the dispatch falls
 * through to the generic silent acknowledgement. The P0 this whole change fixes
 * (an inspector edit that never reached the analysis) is that failure with one
 * more step in front of it. A guard that reads as a guarantee and never executes
 * is this estate's dominant defect class; this was one of them.
 *
 * TWO INDEPENDENT GUARDS now, because they fail in different situations:
 *
 *   1. COMPILE TIME — `SYSTEM_EVENT_HANDLING` is a `Record` keyed by the union,
 *      so TypeScript requires an entry per member. Re-vendoring a schemas
 *      release that adds a kind fails `pnpm typecheck` until someone says what
 *      the new kind does. (Verified by mutation: deleting one entry produces a
 *      TS error. A `Set` in the same position produces nothing.)
 *
 *   2. RUN TIME, HERE — derived from `SystemEventKind.options`, the schema's own
 *      vocabulary. This catches what the compiler cannot: a cast, or an enum
 *      that has drifted from the discriminated union it is supposed to mirror.
 *
 * Neither guard is a list a human must remember to sync. Both read the source
 * of truth.
 */
import { describe, it, expect } from 'vitest';

import { SystemEventKind, SystemEventSchema } from '@talchain/schemas/boundary';

import { SYSTEM_EVENT_HANDLING } from '../dispatch.js';

describe('system-event kind exhaustiveness — derived from the schema, not mirrored', () => {
  it('every kind the SCHEMA declares has a declared handling', () => {
    const declared = [...SystemEventKind.options].sort();
    const handled = Object.keys(SYSTEM_EVENT_HANDLING).sort();
    expect(
      handled,
      'A kind exists in @talchain/schemas that dispatch.ts does not handle. It would fall ' +
        'through to the generic silent acknowledgement — the exact failure mode that let an ' +
        'inspector value edit never reach the analysis. Add it to SYSTEM_EVENT_HANDLING and ' +
        'say what it does.',
    ).toEqual(declared);
  });

  it('the kind enum has not drifted from the discriminated union it mirrors', () => {
    // `SystemEventKind` (a convenience enum) and `SystemEventSchema` (the actual
    // union) are two hand-kept surfaces in the contract package. If they ever
    // disagree, the guard above would be derived from the WRONG source and would
    // pass while missing a real union member. Check the union directly.
    const unionKinds = SystemEventSchema.options
      .map((member) => (member as unknown as { shape: { kind: { value: string } } }).shape.kind.value)
      .sort();
    expect(unionKinds).toEqual([...SystemEventKind.options].sort());
  });

  it('the mutating set is exactly { factor_value_edit } — a graph write is never incidental', () => {
    const mutating = Object.entries(SYSTEM_EVENT_HANDLING)
      .filter(([, handling]) => handling === 'mutating')
      .map(([kind]) => kind);
    // Pinned deliberately narrow. Anything that writes `scenarios.graph` moves
    // `graph_hash` and invalidates the user's analysis, so a second kind joining
    // this set must be a conscious act with a RED to justify it.
    expect(mutating).toEqual(['factor_value_edit']);
  });

  it('the reader-only refusal set is exactly { edge_strength_edit } — parsing is not mutation permission', () => {
    const readerOnly = Object.entries(SYSTEM_EVENT_HANDLING)
      .filter(([, handling]) => handling === 'reader_only_refusal')
      .map(([kind]) => kind);
    // Mutation control: changing this entry to ack_and_commit, fact_and_commit
    // or mutating REDs here. The later writer train must change this assertion
    // consciously; reverting that train restores this safe floor.
    expect(readerOnly).toEqual(['edge_strength_edit']);
  });

  it('client-only kinds are exactly the ones that commit nothing', () => {
    const clientOnly = Object.entries(SYSTEM_EVENT_HANDLING)
      .filter(([, handling]) => handling === 'client_only')
      .map(([kind]) => kind)
      .sort();
    expect(clientOnly).toEqual(['redo', 'selection_change', 'undo']);
  });
});
