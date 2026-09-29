/**
 * #1231 — the DERIVED completeness guard for the ingress-authorship
 * classification.
 *
 * WHY THIS FILE EXISTS. The guard it backs was first written as
 * `source === 'chip_click'` — a hand-written subset of a FOUR-member contract
 * union — and was therefore dark on `'chip'`, the member the deployed UI
 * actually sends for a held-confirm chip. The classification is now exhaustive
 * over `TurnSourceLiteral`, so a fifth member is a TYPECHECK error at the map.
 * That is a compile-time property, and it is not enough on its own: the TYPE
 * and the RUNTIME enum can drift (a re-vendored `@talchain/schemas` whose
 * `TurnSource.options` gains a value the emitted `.d.ts` union does not, or a
 * map key kept alive by a widened `Record` index signature). This suite closes
 * that gap by comparing the map's keys against `TurnSource.options` AT RUNTIME.
 *
 * ⚠ THE EXPECTED CLASSIFICATION BELOW IS WRITTEN OUT BY HAND, DELIBERATELY.
 * Deriving it from the module under test would be a guard agreeing with itself
 * (trap 13b) — it would pass for any classification whatsoever. It is stated
 * here independently, with each verdict's evidence in the module's header, and
 * the completeness assertion is what stops it going short.
 */
import { describe, it, expect } from 'vitest';
import { TurnSource } from '@talchain/schemas/boundary';

import {
  TURN_SOURCE_AUTHORSHIP_MAP,
  TURN_SOURCE_MEMBERS,
  isFreshlyAuthoredTurnSource,
  isReplayedTurnSource,
  type TurnAuthorship,
} from '../turn-source-authorship.js';

// Stated independently of the module under test. If the contract gains a
// member, the completeness test below REDs until this list is adjudicated.
const EXPECTED: Record<string, TurnAuthorship> = {
  composer: 'freshly_authored',
  chip: 'replayed',
  chip_click: 'replayed',
  retry: 'replayed',
};

describe('turn-source authorship — derived from the contract, fails loud on widening', () => {
  it('classifies EXACTLY the members the contract declares — no more, no fewer', () => {
    // POSITIVE CONTROL: the probe can see members at all. A union that read
    // empty would make every assertion below vacuous.
    expect(TURN_SOURCE_MEMBERS.length).toBeGreaterThan(0);
    expect(TURN_SOURCE_MEMBERS.length).toBe(4);
    // The contract's own runtime member list — never a list written here.
    expect([...TurnSource.options].sort()).toEqual(
      ['chip', 'chip_click', 'composer', 'retry'],
    );
    // The map covers it exactly. A member added to the contract and NOT
    // classified REDs here even if the emitted type union has not caught up.
    expect(Object.keys(TURN_SOURCE_AUTHORSHIP_MAP).sort()).toEqual(
      [...TurnSource.options].sort(),
    );
    // ...and this suite's own hand-written expectation covers it too, so the
    // table below cannot silently stop testing a member.
    expect(Object.keys(EXPECTED).sort()).toEqual([...TurnSource.options].sort());
  });

  it.each(Object.entries(EXPECTED))(
    'source %s is classified %s',
    (source, authorship) => {
      expect(TURN_SOURCE_AUTHORSHIP_MAP[source as keyof typeof TURN_SOURCE_AUTHORSHIP_MAP])
        .toBe(authorship);
      expect(isFreshlyAuthoredTurnSource(source as never))
        .toBe(authorship === 'freshly_authored');
      expect(isReplayedTurnSource(source as never))
        .toBe(authorship === 'replayed');
    },
  );

  it('the two predicates are exact complements over the whole union', () => {
    for (const source of TurnSource.options) {
      expect(isFreshlyAuthoredTurnSource(source)).toBe(!isReplayedTurnSource(source));
    }
    // DISCRIMINATION PIN (trap 13b): a classifier that answered the same for
    // every member would satisfy the complement property above and tell us
    // nothing. Assert the partition is genuinely non-trivial in BOTH
    // directions — at least one member each side.
    const fresh = TurnSource.options.filter(isFreshlyAuthoredTurnSource);
    const replayed = TurnSource.options.filter(isReplayedTurnSource);
    expect(fresh.length).toBeGreaterThan(0);
    expect(replayed.length).toBeGreaterThan(0);
    expect(fresh).toEqual(['composer']);
  });
});
