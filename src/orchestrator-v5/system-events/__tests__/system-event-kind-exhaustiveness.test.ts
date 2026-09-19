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

  it('the declared mutating set is exactly the server-side writers', () => {
    const mutating = Object.entries(SYSTEM_EVENT_HANDLING)
      .filter(([, handling]) => handling === 'mutating')
      .map(([kind]) => kind);
    // Pinned deliberately narrow. Anything that writes `scenarios.graph` moves
    // `graph_hash` and invalidates the user's analysis, so a kind joining this
    // set must be a conscious act with a RED to justify it. Train C adds
    // edge_strength_edit deliberately; dispatch still resolves it back onto
    // the reader-only floor unless the boot-validated CAS capability is in
    // enforce mode.
    //
    // 2026-08-17 P0 L-22 — `structural_delete` joins, and this RED is the
    // justification the comment above asks for. It is the first member that
    // REMOVES rather than sets a value, and it had to become mutating because
    // the alternative IS the defect: as `'ack_and_commit'` it commits a turn row
    // and writes no graph, so the next turn reloads a graph that still holds the
    // deleted option and re-adds it ("it keeps adding the option that I deleted
    // back"). Unlike edge_strength_edit it is NOT resolved back to a reader
    // floor under CAS off/shadow — that gate is a rollout device, and applying
    // it here would ship this P0 fix dark; see the long note in
    // `dispatchStructuralDelete`. Its own stale gate (`base_graph_hash`) and its
    // committed-bytes readback are what make the write safe, and both run
    // regardless of RPC mode.
    //
    // 2026-08-31 — `structural_add` and `structural_rename` join, and the same
    // justification applies to both: as `'reader_only_refusal'` each told the
    // user, truthfully, that the version could not apply a canvas gesture, and
    // that sentence becomes false the instant a writer exists. Both carry their
    // own stale gate plus a gate the analysis hash provably CANNOT replace —
    // `expected_label` for the rename (the hash does not cover `label`), and the
    // id-collision check for the add (a colliding id is already in the very
    // graph the user was looking at). Neither is resolved back to a reader floor
    // under CAS off/shadow, for the reason `structural_delete` records.
    //
    // 2026-09-08 (schemas 0.54.0) — `option_intervention_edit` joins, and this
    // is the conscious act with its justification, as the note above requires.
    //
    // It could not be `'ack_and_commit'` for the reason `structural_delete`
    // records, in the value direction rather than the removal one: an ack
    // commits a turn row and writes NO graph, so the effect value the user set
    // would be gone on the next reload — a number they watched vanish.
    //
    // It could not be `'reader_only_refusal'` either. That posture tells the
    // user, truthfully, that this version cannot apply the gesture; the
    // sentence becomes false the instant a writer exists, and one does — the
    // writer released in #1279, reached here through its public route.
    //
    // ⚠ ITS SAFETY IS NOT INHERITED FROM THIS ROW. `base_graph_hash` is
    // recomputed by the writer from the graph it loaded and refused on
    // mismatch; the effect value is verified in the committed bytes before
    // anything is called committed; and — unlike `structural_rename` — it needs
    // no `expected` twin, because an intervention IS inside the
    // analysis-affecting projection, so a concurrent write to the same cell
    // moves the hash the gate already checks. Not resolved back to a reader
    // floor under CAS off/shadow, for the reason `structural_delete` records.
    //
    // ⚠ ORDER IS THE MAP'S INSERTION ORDER, not alphabetical, and is asserted
    // as such — `.map()` over `Object.entries` preserves it.
    //
    // 2026-09-11 (schemas 0.50.0 member, writer landed now) — `structural_add_edge`
    // joins, and this is its conscious act with the justification this comment
    // demands. It could not stay `'reader_only_refusal'` for the reason both
    // structural siblings record: that posture tells the user, truthfully, that
    // this version cannot apply the gesture, and the sentence becomes false the
    // instant a writer exists. It could not be `'ack_and_commit'` for the reason
    // `structural_delete` records — an ack writes a turn row and NO graph, so the
    // connection survives until the next reload and then vanishes.
    //
    // ⭐ IT CARRIES FOUR USER-FACING GESTURES, not one: draw-a-link, the five
    // "Add connected …" affordances, duplicate, and paste. The last three are
    // gestures users already perform and already believe work.
    //
    // ⚠ ITS SAFETY IS NOT INHERITED FROM THIS ROW either. It needs no `expected`
    // twin — unlike `structural_rename`, every edge field the hash projection
    // reads is analysis-affecting, so `base_graph_hash` genuinely covers it — and
    // it carries two gates the hash cannot replace: endpoint resolution (a
    // dangling edge is what the contract forbids) and the duplicate check (the
    // edge is already in the very graph the user was looking at, so the hash is
    // perfectly fresh and the add is still destructive).
    expect(mutating).toEqual([
      'factor_value_edit',
      'edge_strength_edit',
      'structural_delete',
      'structural_add',
      'structural_add_edge',
      'structural_rename',
      'option_intervention_edit',
    ]);
  });

  it('declares exactly the 0.50.0 direct-edit kinds reader-only, and no writer kind', () => {
    const readerOnly = Object.entries(SYSTEM_EVENT_HANDLING)
      .filter(([, handling]) => handling === 'reader_only_refusal')
      .map(([kind]) => kind)
      .sort();
    // Runtime activation is intentionally stricter than this declaration:
    // edge_strength_edit still executes the deployed reader refusal under CAS
    // off/shadow. Reverting Train C restores the explicit map entry as well.
    //
    // ⚠ THIS ASSERTION WAS `toEqual([])`, AND THAT WAS A SNAPSHOT, NOT A RULE.
    // It was written the moment Train C moved `edge_strength_edit` OUT of this
    // set, so an empty set meant "Train C is in effect" — a control pinned to
    // whatever was current, which decays into a constraint the first time
    // "current" changes. It changed at the 0.50.0 pin: the contract added
    // `structural_add`, `structural_add_edge` and `structural_rename`, CEE can
    // parse all three and has a writer for none, and `reader_only_refusal` is
    // the posture the contract mandates for exactly that state ("Reader-first
    // adoption is mandatory"). An empty set is no longer the healthy reading.
    //
    // Kept EXACT rather than widened, so it still REDs if the set GROWS (a kind
    // silently parked as reader-only instead of getting a writer) or SHRINKS (a
    // writer landed and this pin was not revisited).
    // ⚠ `structural_rename` LEFT THIS SET when its writer landed. That is the
    // exact transition the note above says must RED rather than pass silently,
    // and it did: this assertion is the reason the dead refusal copy and the
    // dead chat-route entry were deleted in the same change instead of being
    // left behind to read as live.
    // ⚠ `structural_add` LEFT THIS SET when its writer landed, exactly as
    // `structural_rename` did before it. `structural_add_edge` is the last kind
    // still genuinely reader-only.
    // ⚠ `structural_add_edge` LEFT THIS SET when its writer landed, exactly as
    // `structural_rename` and `structural_add` did before it — and it was the
    // LAST member, so the set is now empty. That is the transition the note above
    // says must RED rather than pass silently, and it did.
    //
    // ⛔ EMPTY IS THE HEALTHY READING TODAY AND WILL NOT ALWAYS BE. The note at
    // the top of this case records that `toEqual([])` was once a snapshot that
    // decayed into a false constraint. It is asserted again here for the OPPOSITE
    // reason: every declared kind now has a writer or a defined non-writer
    // posture, and the next contract version that adds a kind CEE cannot write
    // must land reader-first — which REDs here, by name, so it gets a writer or
    // an adjudicated refusal instead of being parked.
    expect(readerOnly).toEqual([]);
    // The ORIGINAL intent of this case, named so it cannot be lost by a future
    // edit to the list above: no kind that has a server-side writer may be
    // DECLARED reader-only. Train C regressing would fail here specifically.
    expect(readerOnly).not.toContain('edge_strength_edit');
    expect(readerOnly).not.toContain('structural_delete');
    expect(readerOnly).not.toContain('factor_value_edit');
    expect(readerOnly).not.toContain('structural_rename');
    expect(readerOnly).not.toContain('structural_add');
  });

  it('client-only kinds are exactly the ones that commit nothing', () => {
    const clientOnly = Object.entries(SYSTEM_EVENT_HANDLING)
      .filter(([, handling]) => handling === 'client_only')
      .map(([kind]) => kind)
      .sort();
    expect(clientOnly).toEqual(['redo', 'selection_change', 'undo']);
  });
});
