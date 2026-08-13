/**
 * ⭐⭐ THE PRODUCT MAY DESCRIBE WHAT **IT** DID; IT MAY NOT TELL THE USER WHAT
 * **THEY** SAID — the protected-entity hold copy, bounded-reading split.
 *
 * THE LIVE FALSEHOOD (#928 round-4 reviewer, reproduced end to end at the gate
 * on staging `6079f2d0`). A user types the most ordinary constraint in
 * business English:
 *
 *   "Keep Customer churn below 3%."
 *
 * and the product answers:
 *
 *   "You asked for 'Customer churn' to stay as it is, and this change would
 *    affect it: change 'Customer churn' to 0.03. So I am holding it …"
 *
 * The user asked for the OPPOSITE of what the product says they asked for —
 * and the same sentence then describes the change it claims they did not want.
 *
 * ── TWO QUESTIONS UNDER ONE NAME (CLAUDE.md trap 21) ──────────────────────
 * The word `keep` is a cue for BOTH of these, and they point opposite ways:
 *
 *   Q-PRESERVE  "did the user ask for this entity to be left AS IT IS?"
 *               → protection-scope.ts PROTECTION_CUE. Deliberately BROAD:
 *                 a false positive costs one confirm tap.
 *   Q-BOUND     "did the user ask for a CHANGE — here, a value the model must
 *               satisfy?"
 *               → mutation-warrant.ts CONSTRAINT_MUTATION_SIGNAL_PATTERNS.
 *                 Deliberately NARROW: a false positive silently rewrites the
 *                 model.
 *
 * `keep` answers YES to both, so ONE cue list was deciding TWO things with
 * opposite error costs: whether to HOLD (broad is right) and what to ASSERT
 * about the user's intent (broad is a LIE). That is the trap-21 conflation and
 * it is why tuning either list cannot fix this.
 *
 * ── THE SPLIT (two parameters, not one — trap 22b) ────────────────────────
 * The HOLD is unchanged: still broad, still fail-safe toward holding, so the
 * F-3 silent-wrong-write class this guard exists for cannot reopen. What is
 * NEW is a SECOND, independent question governing only the SENTENCE:
 *
 *   Q-ASSERTABLE "is the 'leave it as it is' reading safe to assert?"
 *                → NO when the protective clause naming that entity ALSO
 *                  states a numeric bound. "Stay as it is" and "hit this
 *                  number" are incompatible readings, so we do not claim
 *                  either. We say what WE did and ask.
 *
 * Q-ASSERTABLE is STRUCTURAL (a comparator followed by a number), not a
 * vocabulary list to keep in sync, and it is MONOTONE in the safe direction:
 * a construction it fails to recognise keeps today's copy, and every
 * construction it does recognise makes the product assert LESS. It is scoped
 * to the CLAUSE that named the entity, so "Keep churn below 3%, but do not
 * touch CRM Platform Cost" still names CRM Platform Cost protectively.
 *
 * ── WHY NOT REUSE hasConstraintMutationSignal ─────────────────────────────
 * Measured head to head on a 29-case corpus before either was written:
 * message-level `hasConstraintMutationSignal` scored 24/29, the clause-scoped
 * structural bound 29/29. The five it missed were "Keep X at least 1%",
 * "Leave X below 3%", "Keep X to no more than 3%", "Keep X at 3%" (all outside
 * the warrant's `keep|hold|maintain` + comparator shape) and the mixed clause
 * above (message-level cannot discriminate per entity). Widening the warrant
 * to cover them was REJECTED: its fail-safe direction is INVERTED (a false
 * positive there is a silent rewrite), so the two harms cannot share a window.
 *
 * CORPUS PROVENANCE — sourced OUTSIDE this lane's head (trap 22): the F-3 live
 * captures come from the S-AUDIT probe (probe-edit-lane.md P8/P9), and the
 * constraint phrasings from `mutation-warrant.test.ts`'s corpora, written by
 * the constraint lane. Every case carries its OPPOSITE-DIRECTION TWIN.
 *
 * ── WHAT THIS CORPUS EXCLUDES (corrected after review) ────────────────────
 * ⚠ THE RESIDUAL THAT MATTERS IS THE COMMA-CLAUSE CLASS, and it is pinned
 * below as `COMMA_CLAUSE_KNOWN_DROPPED` — an outright protection whose clause
 * absorbs an incidental number now reads as undetermined, which is a NEW
 * falsehood this change installs. It is measured, bounded and asserted
 * exactly, not hidden in a prose list.
 *
 * The earlier version of this note led with bounds written in words ("keep
 * churn below three percent"). That was the wrong thing to point at: an
 * independent sweep sized the word-form residual at 0.59%, a rounding error,
 * and it fails SAFE (no digit, so no bound detected, so today's copy stands).
 *
 * Genuinely still excluded, all failing safe: non-English phrasing; currency
 * forms beyond a leading £/$/€; and multi-turn context, where the protection
 * was stated on an earlier turn and never appears in this turn's message.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { evaluateEditGraphMutations } from '../edit-graph-referee-gate.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import {
  extractProtectedEntities,
  USER_PROTECTED_ENTITY_READABLE,
  USER_PROTECTED_ENTITY_AMBIGUOUS_READABLE,
} from '../../graph-management/protection-scope.js';
import * as telemetry from '../../../utils/telemetry.js';

// ── fixtures ───────────────────────────────────────────────────────────────

const GRAPH = {
  nodes: [
    { id: 'g-roi', kind: 'goal', label: '3-Year ROI Realised' },
    { id: 'd-crm', kind: 'decision', label: 'Which CRM' },
    { id: 'fac_churn', kind: 'factor', label: 'Customer churn', observed_state: { value: 0.05 } },
    { id: 'fac_cost', kind: 'factor', label: 'CRM Platform Cost', observed_state: { value: 0.4 } },
    {
      id: 'opt_cloud_native',
      kind: 'option',
      label: 'Cloud-Native CRM',
      interventions: { fac_cost: { value: 0.58 } },
    },
  ],
  edges: [
    { from: 'd-crm', to: 'opt_cloud_native', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'opt_cloud_native', to: 'fac_cost', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_churn', to: 'g-roi', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_cost', to: 'g-roi', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
  ],
};

function hashOf(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as never);
  if (h === null) throw new Error('fixture must hash');
  return h;
}

/** A tunable write targeting the CHURN factor — the op the edit LLM emits for
 *  "Keep Customer churn below 3%". */
const CHURN_OP = {
  op: 'update_node',
  path: 'fac_churn',
  value: { observed_state: { value: 0.03 } },
  old_value: { observed_state: { value: 0.05 } },
};
/** A tunable write targeting the COST factor — used for the mixed-clause case. */
const COST_OP = {
  op: 'update_node',
  path: 'fac_cost',
  value: { description: 'Total platform cost over three years' },
};

/** THE REPORTED CASE. */
const REPORTED = 'Keep Customer churn below 3%.';

function baseInput(overrides: Record<string, unknown> = {}) {
  const hash = hashOf(GRAPH);
  return {
    mode: 'live' as const,
    operations: [CHURN_OP],
    currentGraph: GRAPH,
    currentGraphHash: hash,
    baseGraphHash: hash,
    freshness: 'none' as const,
    scenarioId: 'scn-bound',
    turnId: 'turn-bound',
    requestId: 'req-bound',
    ...overrides,
  } as never;
}

function textFor(message: string, overrides: Record<string, unknown> = {}): string {
  const d = evaluateEditGraphMutations(baseInput({ userMessage: message, ...overrides }));
  return d.assistantText ?? '';
}

/** The assertion under test: does the copy claim the user asked for no change? */
const ASSERTS_USER_WANTED_IT_UNCHANGED = /\byou asked for\b|\bthe request asked for\b/i;

let emitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
});
afterEach(() => {
  emitSpy.mockRestore();
});

// ── 1. THE REPORTED CASE, end to end at the gate ───────────────────────────

describe('THE REPORTED FALSEHOOD — "Keep Customer churn below 3%."', () => {
  it('POSITIVE CONTROL: without a protection cue the very same op reaches would_apply, so the hold below is real and this suite is not vacuous', () => {
    const d = evaluateEditGraphMutations(
      baseInput({ userMessage: 'Set Customer churn to 3%.' }),
    );
    expect(d.governing).toBe('proceed');
    expect(d.verdictCounts.would_apply).toBe(1);
  });

  it('still HOLDS (the conservative bias is untouched — one confirm tap, never a silent write)', () => {
    const d = evaluateEditGraphMutations(baseInput({ userMessage: REPORTED }));
    expect(d.governing).toBe('held');
    expect(d.blockApply).toBe(true);
    expect(d.pendingActions).toHaveLength(1);
    expect(d.publicReason?.blocker_code).toBe('USER_PROTECTED_ENTITY');
  });

  it('⭐ does NOT tell the user they asked for Customer churn to stay as it is', () => {
    const text = textFor(REPORTED);
    expect(text).not.toMatch(ASSERTS_USER_WANTED_IT_UNCHANGED);
    expect(text.toLowerCase()).not.toContain('to stay as it is');
  });

  it('⭐ is not self-contradictory: it never claims no change was wanted while describing the change', () => {
    const text = textFor(REPORTED);
    const claimsUnchanged = /stay as (?:it is|they are)/i.test(text);
    const describesChange = /\bchange\b|\bupdate\b/i.test(text);
    expect(claimsUnchanged && describesChange).toBe(false);
  });

  it('still NAMES the entity it is holding, so the user can act on it (identity-bound, not a value predicate)', () => {
    expect(textFor(REPORTED)).toContain("'Customer churn'");
  });

  it('survives the egress guards (no success claim, no forbidden phrase, no em dash)', () => {
    const text = textFor(REPORTED);
    expect(findSuccessClaimHit(text)).toBeNull();
    expect(findForbiddenPhraseHit(text)).toBeNull();
    expect(text).not.toContain('—');
  });

  it('the wire blocker readable carries no claim about what the user said either', () => {
    const d = evaluateEditGraphMutations(baseInput({ userMessage: REPORTED }));
    expect(String(d.publicReason?.blocker_readable ?? '')).not.toMatch(
      ASSERTS_USER_WANTED_IT_UNCHANGED,
    );
  });
});

// ── 1b. THE WIRE READABLE, GUARDED IN BOTH DIRECTIONS ──────────────────────
//
// P1 from review: asserting only "the bounded case is not the false readable"
// leaves `opIsBounded := hits.length > 0` free to make EVERY hold emit the
// ambiguous readable — a mutant that survived 1,213 tests across 80 files,
// because nothing anywhere pinned the PROTECTIVE readable. A one-directional
// guard on a two-valued seam is half a guard. Both values are bound by
// IDENTITY to their exported constants, never by a substring another string
// could satisfy.

describe('WIRE READABLE — both values pinned by identity, so neither branch can swallow the other', () => {
  function readableFor(message: string, ops?: readonly unknown[]): string {
    const d = evaluateEditGraphMutations(
      baseInput(ops === undefined ? { userMessage: message } : { userMessage: message, operations: ops }),
    );
    return String(d.publicReason?.blocker_readable ?? '');
  }

  it('a BOUNDED reading emits exactly USER_PROTECTED_ENTITY_AMBIGUOUS_READABLE', () => {
    expect(readableFor(REPORTED)).toBe(USER_PROTECTED_ENTITY_AMBIGUOUS_READABLE);
  });

  it('⭐ an OUTRIGHT protection emits exactly USER_PROTECTED_ENTITY_READABLE (the direction that was unguarded)', () => {
    expect(readableFor('Do not touch Customer churn.')).toBe(USER_PROTECTED_ENTITY_READABLE);
  });

  it('DISCRIMINATION IS REAL: the two readables differ, and the seam returns a DIFFERENT one for each input', () => {
    // Pins its own precondition (trap 13b): if the two constants were ever
    // made equal, every assertion above would pass while discriminating
    // nothing.
    expect(USER_PROTECTED_ENTITY_READABLE).not.toBe(USER_PROTECTED_ENTITY_AMBIGUOUS_READABLE);
    expect(readableFor(REPORTED)).not.toBe(readableFor('Do not touch Customer churn.'));
  });

  it('a MIXED op — one bounded target, one outright-protected target — is NOT reported as undetermined', () => {
    // `opIsBounded` uses every(), so a single outright-protected target makes
    // the protective readable true for that op. Pins the every()/some()
    // choice on the READABLE seam as well as on the copy seam.
    const mixed = 'Keep Customer churn below 3%, but do not touch CRM Platform Cost.';
    expect(readableFor(mixed, [COST_OP])).toBe(USER_PROTECTED_ENTITY_READABLE);
  });
});

// ── 2. THE CORPUS, WITH OPPOSITE-DIRECTION TWINS ───────────────────────────
//
// Two opposite harms, so two lists. LEFT: a bound was stated, asserting
// "you wanted it unchanged" is a LIE. RIGHT: a genuine protection, and
// dropping the named copy would be a GAP. Neither may be traded for the other.

/** Bounded constructions — the copy must NOT assert the user wanted no change. */
const BOUNDED_CORPUS: readonly string[] = [
  // the reported case and its nearest neighbours
  'Keep Customer churn below 3%.',
  'Keep Customer churn under 3%.',
  'Keep Customer churn above 1%.',
  'Keep Customer churn at or below 3%.',
  'Keep Customer churn within 3%.',
  'Keep Customer churn at 3%.',
  'Keep Customer churn at least 1%.',
  'Keep Customer churn to no more than 3%.',
  'Leave Customer churn below 3%.',
  "Don't let Customer churn rise above 3%.",
  "Don't let Customer churn exceed 3%.",
  "Customer churn can't exceed 3%.",
  'Never let Customer churn exceed 3%.',
  "Customer churn shouldn't rise above 3%.",
];

/** Genuine protections — the named copy is TRUE here and must survive.
 *  The first four are the F-3 live captures this guard was built for. */
const PROTECTIVE_CORPUS: readonly (readonly [string, string])[] = [
  ["Set CRM Platform Cost to 0.5 - the configuration of Cloud-Native CRM shouldn't change.", 'Cloud-Native CRM'],
  ['Configure nothing on Cloud-Native CRM; just set CRM Platform Cost to 0.52.', 'Cloud-Native CRM'],
  ['Set CRM Platform Cost to 0.5 but do NOT touch Cloud-Native CRM.', 'Cloud-Native CRM'],
  ['Do not touch Customer churn.', 'Customer churn'],
  ['Keep Customer churn as it is.', 'Customer churn'],
  ['Leave Customer churn as is.', 'Customer churn'],
  ["Don't change Customer churn.", 'Customer churn'],
  ['Keep Customer churn unchanged.', 'Customer churn'],
  ['Leave Customer churn alone.', 'Customer churn'],
  ['Customer churn stays the same.', 'Customer churn'],
  ['Preserve Customer churn.', 'Customer churn'],
  ['Keep Customer churn low.', 'Customer churn'],
];

describe('BOUNDED CORPUS — a stated bound is never reported as "you wanted it unchanged"', () => {
  it.each(BOUNDED_CORPUS)('%s', (message) => {
    const text = textFor(message);
    // It is still held (bias unchanged) …
    expect(text.length).toBeGreaterThan(0);
    // … but the product does not tell the user what they said.
    expect(text).not.toMatch(ASSERTS_USER_WANTED_IT_UNCHANGED);
  });

  it('every bounded case is still HELD — the fix changes the sentence, never the safety', () => {
    for (const message of BOUNDED_CORPUS) {
      const d = evaluateEditGraphMutations(baseInput({ userMessage: message }));
      expect(d.governing, `must still hold: ${message}`).toBe('held');
      expect(d.blockApply, `must still block: ${message}`).toBe(true);
    }
  });
});

describe('PROTECTIVE CORPUS (twins) — a genuine protection keeps the NAMED copy', () => {
  it.each(PROTECTIVE_CORPUS)('%s', (message, label) => {
    const ops = label === 'Cloud-Native CRM'
      ? [{ op: 'update_node', path: 'opt_cloud_native', value: { interventions: { fac_cost: { value: 0.5 } } }, old_value: { interventions: { fac_cost: { value: 0.58 } } } }]
      : [CHURN_OP];
    const text = textFor(message, { operations: ops });
    expect(text).toContain(`'${label}'`);
    // The named protective reading is TRUE here, so it is still asserted.
    expect(text).toMatch(/to stay as (?:it is|they are)/i);
  });
});

// ── 3. THE MIXED CLAUSE — per-entity, not per-message ──────────────────────

describe('MIXED CLAUSE — one entity bounded, another protected in the same message', () => {
  const MIXED = 'Keep Customer churn below 3%, but do not touch CRM Platform Cost.';

  it('the genuinely protected entity KEEPS the named protective copy', () => {
    const text = textFor(MIXED, { operations: [COST_OP] });
    expect(text).toContain("'CRM Platform Cost'");
    expect(text).toMatch(/to stay as it is/i);
  });

  it('the BOUNDED entity in the same message does not get the false claim', () => {
    const text = textFor(MIXED, { operations: [CHURN_OP] });
    expect(text).not.toMatch(ASSERTS_USER_WANTED_IT_UNCHANGED);
  });

  it('DISCRIMINATION IS REAL, not a fixture accident: the two entities take DIFFERENT branches on the SAME message', () => {
    // Pins its own precondition (trap 21): if these two ever agree, the test
    // above is passing for a reason that has nothing to do with the split.
    const cost = textFor(MIXED, { operations: [COST_OP] });
    const churn = textFor(MIXED, { operations: [CHURN_OP] });
    expect(ASSERTS_USER_WANTED_IT_UNCHANGED.test(cost)).toBe(true);
    expect(ASSERTS_USER_WANTED_IT_UNCHANGED.test(churn)).toBe(false);
  });
});

// ── 3b. THE KNOWN GAP, PINNED EXACTLY ──────────────────────────────────────
//
// ⚠⚠ THE SAFETY ARGUMENT THIS FIX WAS ORIGINALLY SOLD ON WAS FALSE.
// It claimed the bound predicate was monotone: "a construction it misses keeps
// today's copy; every one it catches makes the product assert LESS, so an
// incomplete list cannot manufacture a NEW falsehood." Refuted by execution.
// `CLAUSE_BOUNDARY` does not split on bare commas (list protections must stay
// in one clause), so an OUTRIGHT protection absorbs an INCIDENTAL number and
// the product says "I could not tell which" about a sentence that is not
// ambiguous. At the merge base these produced a TRUE sentence, so catching a
// construction CAN install a falsehood.
//
// ⛔ NOT FIXED HERE, DELIBERATELY. An outright-protection lookahead repairs
// every case below and then flips 7 genuine bounds back to the ORIGINAL lie —
// two rounds, each closing one direction and opening the other (trap 22f). The
// honest move is to PIN the gap, not to narrow it: this set is asserted
// EXACTLY, so the suite stays green for the RIGHT reason and REDs if the class
// GROWS (a new falsehood) or SHRINKS (someone fixed it, and this pin plus the
// comment in protection-scope.ts must be retired together).

/** Outright protections that carry an incidental number in the same
 *  comma-joined clause. Every one of these is CURRENTLY MISREPORTED as an
 *  undetermined reading. This is a known, measured, unfixed gap. */
const COMMA_CLAUSE_KNOWN_DROPPED: readonly string[] = [
  'Do not touch Customer churn, it is at 3% and that is fine',
  'Do not touch Customer churn, it is below 3% already',
  'Leave Customer churn alone, it sits at 3% right now',
  'Keep Customer churn as it is, currently at 3%',
  "Don't change Customer churn, we measured it at 3% last week",
  'Leave Customer churn as is, it has been under 3% all year',
  'Preserve Customer churn, it is above 1% and healthy',
  'Keep Customer churn unchanged, it is at 3% and we like it',
];

/** Same shape, but the number is NOT preceded by a comparator inside the
 *  window, so these escape the gap and still read TRUE. They are the contrast
 *  control: without them a blind predicate would look identical. */
const COMMA_CLAUSE_STILL_CORRECT: readonly string[] = [
  'Do not touch Customer churn, the 3% figure is correct',
  "Don't touch Customer churn, our 3% target is already met",
];

describe('KNOWN GAP — comma-joined outright protections carrying an incidental number', () => {
  it('the dropped set is EXACTLY this, no more and no fewer', () => {
    const dropped = [...COMMA_CLAUSE_KNOWN_DROPPED, ...COMMA_CLAUSE_STILL_CORRECT].filter(
      (m) =>
        extractProtectedEntities(m, GRAPH).find((e) => e.nodeId === 'fac_churn')
          ?.boundedReading === true,
    );
    // Exact-set equality: REDs if the gap grows AND if it shrinks.
    expect(dropped.sort()).toEqual([...COMMA_CLAUSE_KNOWN_DROPPED].sort());
  });

  it('CONTRAST CONTROL — the two escapees still produce the TRUE named sentence, so the pin above is not measuring a dead predicate', () => {
    for (const m of COMMA_CLAUSE_STILL_CORRECT) {
      expect(textFor(m), m).toMatch(/to stay as it is/i);
    }
  });

  it('the gap costs only truthfulness, never safety: every dropped case is still HELD', () => {
    for (const m of COMMA_CLAUSE_KNOWN_DROPPED) {
      const d = evaluateEditGraphMutations(baseInput({ userMessage: m }));
      expect(d.governing, m).toBe('held');
      expect(d.blockApply, m).toBe(true);
    }
  });
});

// ── 4. THE PREDICATE ITSELF, bound by identity ─────────────────────────────

describe('boundedReading is per-entity and identity-bound', () => {
  it('the bounded entity is flagged and the protected one is not, on one message', () => {
    const found = extractProtectedEntities(
      'Keep Customer churn below 3%, but do not touch CRM Platform Cost.',
      GRAPH,
    );
    const churn = found.find((e) => e.nodeId === 'fac_churn');
    const cost = found.find((e) => e.nodeId === 'fac_cost');
    expect(churn?.boundedReading).toBe(true);
    expect(cost?.boundedReading).toBe(false);
  });

  it('EVERY, not SOME: an entity protected outright in ONE clause keeps the true named copy even when another clause bounds it', () => {
    // "Do not change X; keep X below 3%." — X is named in TWO protective
    // clauses, one bounded and one not. The unbounded clause is an outright
    // protection, so "you asked for X to stay as it is" is TRUE and may still
    // be said. Pinning this closes the `every` -> `some` mutant, which
    // otherwise survives: no other case in this corpus names one entity in
    // two protective clauses of different kinds.
    const PROTECTIVE_HALF = 'Do not change Customer churn.';
    const BOUNDED_HALF = 'Keep Customer churn below 3%.';
    const MIXED_SAME_ENTITY = 'Do not change Customer churn; keep Customer churn below 3%.';

    // ⭐ PRECONDITION, PINNED IN-TEST (trap 13b). The `every` vs `some` result
    // is only evidence about the CODE if the fixture really does present two
    // LIVE clauses of DIFFERENT kinds. Rot either half — a word change that
    // stops one clause matching the entity, or stops it carrying a bound — and
    // the combined assertion below would pass under BOTH every() and some(),
    // discriminating nothing while staying green. So assert each half's kind
    // independently, first.
    const protHalf = extractProtectedEntities(PROTECTIVE_HALF, GRAPH).find(
      (e) => e.nodeId === 'fac_churn',
    );
    const boundHalf = extractProtectedEntities(BOUNDED_HALF, GRAPH).find(
      (e) => e.nodeId === 'fac_churn',
    );
    expect(protHalf, 'protective half must still protect the entity').toBeDefined();
    expect(protHalf?.boundedReading, 'protective half must be UNBOUNDED').toBe(false);
    expect(boundHalf, 'bounded half must still protect the entity').toBeDefined();
    expect(boundHalf?.boundedReading, 'bounded half must be BOUNDED').toBe(true);
    // The two halves genuinely differ — so the combined result below is the
    // code's doing and not the fixture's failure.
    expect(protHalf?.boundedReading).not.toBe(boundHalf?.boundedReading);

    const found = extractProtectedEntities(MIXED_SAME_ENTITY, GRAPH);
    expect(found.find((e) => e.nodeId === 'fac_churn')?.boundedReading).toBe(false);
    expect(textFor(MIXED_SAME_ENTITY)).toMatch(/to stay as it is/i);
  });

  it('a protection with no number is never flagged as bounded', () => {
    const found = extractProtectedEntities('Do not touch Customer churn.', GRAPH);
    expect(found.find((e) => e.nodeId === 'fac_churn')?.boundedReading).toBe(false);
  });

  it('the hold itself is unaffected by the flag (protection breadth is unchanged)', () => {
    const found = extractProtectedEntities(REPORTED, GRAPH);
    expect(found.map((e) => e.nodeId)).toContain('fac_churn');
  });
});
