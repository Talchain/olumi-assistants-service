/**
 * Spec §4.2 — ONE authority for the reference-resolution decision.
 *
 * `resolveAnaphoricReferent` is the function BOTH consumers of the register
 * call: the no-op recovery layer (`decideNoOpRecovery`, "Update it.") and the
 * deterministic value pre-route ("Set it to 100000."). Two surfaces deciding
 * "what does `it` refer to?" with two predicates is this estate's signature
 * defect (CLAUDE.md trap 21); this module is where the decision lives, and
 * this spec pins it from both sides.
 *
 * Assertions bind by IDENTITY (the exact `ref`), never by a value predicate
 * another referent could satisfy.
 */

import { describe, expect, it } from 'vitest';

import {
  EDIT_CLARIFY_TARGET_KINDS,
  resolveAnaphoricReferent,
} from '../edit-clarify-response.js';
import { NodeKindV3 } from '../../../schemas/cee-v3.js';
import {
  RANK_ORDER,
  type TurnReferent,
  type TurnReferents,
} from '../../context/turn-referents.js';

const CLAIM_RANK = RANK_ORDER.indexOf('last_assistant_claim');
const SELECTION_RANK = RANK_ORDER.indexOf('user_selection');

function referent(
  ref: string,
  label: string,
  kind: TurnReferent['kind'] = 'factor',
  rank: number = CLAIM_RANK,
): TurnReferent {
  return {
    ref,
    kind,
    label,
    introduced_by: rank === SELECTION_RANK ? 'user_selection' : 'last_assistant_claim',
    introduced_at_turn: 4,
    recency_rank: rank,
  };
}

const SHI = referent('node:919d7f50', 'Sales Headcount Investment');
const MRR = referent('node:5a596708', 'MRR Growth', 'outcome');
const PRICE = referent('node:aa11', 'Price');
const OUTSOURCE = referent('node:opt1', 'Outsource', 'option');

function complete(...referents: TurnReferent[]): TurnReferents {
  return { referents, source: 'complete' };
}

describe('resolveAnaphoricReferent — exactly one eligible candidate at the top populated rank BINDS', () => {
  it('a lone factor binds, by identity', () => {
    const r = resolveAnaphoricReferent(complete(SHI));
    expect(r.outcome).toBe('bound');
    if (r.outcome === 'bound') expect(r.referent.ref).toBe('node:919d7f50');
  });

  it('a lone option binds too — eligibility is the composer\'s factor|option, not factor alone', () => {
    const r = resolveAnaphoricReferent(complete(OUTSOURCE));
    expect(r.outcome).toBe('bound');
    if (r.outcome === 'bound') expect(r.referent.ref).toBe('node:opt1');
  });

  it('PRECONDITION: the rank constants the fixtures use are distinct and ordered', () => {
    expect(SELECTION_RANK).toBeGreaterThanOrEqual(0);
    expect(CLAIM_RANK).toBeGreaterThan(SELECTION_RANK);
  });

  it('only the TOP populated rank is decided on: a rank-1 factor beats a rank-2 factor', () => {
    const selected = referent('node:sel', 'Selected Factor', 'factor', SELECTION_RANK);
    const r = resolveAnaphoricReferent(complete(SHI, selected));
    expect(r.outcome).toBe('bound');
    if (r.outcome === 'bound') expect(r.referent.ref).toBe('node:sel');
  });
});

describe('resolveAnaphoricReferent — more than one eligible candidate ASKS, and never picks', () => {
  it('two factors → ask_candidates carrying both, in register order', () => {
    const r = resolveAnaphoricReferent(complete(SHI, PRICE));
    expect(r.outcome).toBe('ask_candidates');
    if (r.outcome === 'ask_candidates') {
      expect(r.candidates.map((c) => c.ref)).toEqual(['node:919d7f50', 'node:aa11']);
    }
  });

  it('DISCRIMINATING TWIN: the same two, minus one, binds — so the ask is caused by the count', () => {
    expect(resolveAnaphoricReferent(complete(SHI, PRICE)).outcome).toBe('ask_candidates');
    expect(resolveAnaphoricReferent(complete(SHI)).outcome).toBe('bound');
  });
});

describe('resolveAnaphoricReferent — nothing eligible is UNRESOLVED (never a guess)', () => {
  it('a lone outcome is not bound', () => {
    expect(resolveAnaphoricReferent(complete(MRR)).outcome).toBe('unresolved');
  });

  it('every NodeKindV3 kind outside the composer\'s eligibility set is refused (the sweep is not vacuous)', () => {
    const ineligible = NodeKindV3.options.filter(
      (k) => !(EDIT_CLARIFY_TARGET_KINDS as readonly string[]).includes(k),
    );
    expect(ineligible.length).toBeGreaterThanOrEqual(3);
    for (const kind of ineligible) {
      const r = resolveAnaphoricReferent(complete(referent('node:x', 'X', kind)));
      expect(r.outcome, kind).toBe('unresolved');
    }
    // CONTRAST in the same sweep: every eligible kind binds.
    for (const kind of EDIT_CLARIFY_TARGET_KINDS) {
      expect(resolveAnaphoricReferent(complete(referent('node:y', 'Y', kind))).outcome, kind).toBe('bound');
    }
  });

  it('an ineligible candidate is FILTERED, not counted: factor + outcome binds the factor', () => {
    const r = resolveAnaphoricReferent(complete(SHI, MRR));
    expect(r.outcome).toBe('bound');
    if (r.outcome === 'bound') expect(r.referent.ref).toBe('node:919d7f50');
  });

  it('a DEGRADED source is never trusted, even with a lone factor — and the complete twin binds', () => {
    expect(resolveAnaphoricReferent({ referents: [SHI], source: 'degraded' }).outcome).toBe('unresolved');
    expect(resolveAnaphoricReferent({ referents: [SHI], source: 'complete' }).outcome).toBe('bound');
  });

  it('empty, null and undefined registers are unresolved', () => {
    expect(resolveAnaphoricReferent(complete()).outcome).toBe('unresolved');
    expect(resolveAnaphoricReferent(null).outcome).toBe('unresolved');
    expect(resolveAnaphoricReferent(undefined).outcome).toBe('unresolved');
  });
});
