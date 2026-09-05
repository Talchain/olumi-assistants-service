/**
 * ROADMAP 2.1361 — the witnessed flat refusal, and the two questions under it.
 *
 * ── WHERE THE CORPUS COMES FROM (it is NOT from this author's head) ────────
 * CLAUDE.md trap 22: a corpus drawn from the author's head cannot see the
 * class the author did not imagine, and a full mutant kill-rate against it is
 * a perfect score on the wrong exam. Every sentence below is sourced:
 *
 *   WITNESSED  — the five messages from the real deployed session, 4 Sep 2026.
 *   ROADMAP    — the six sentences ROADMAP 2.1361's independent lane measured
 *                (three it proved misroute, three it proved the obvious fix
 *                would drop). Neither list was written here.
 *   REPO       — sentences lifted from `routing/__tests__/mutation-warrant.
 *                test.ts`'s hand-written NEGATIVE and CONSTRAINT corpora,
 *                written by another lane for another purpose.
 *
 * ── EVERY CASE HAS ITS OPPOSITE-DIRECTION TWIN ────────────────────────────
 * One predicate guarding two opposite harms needs two parameters, never one
 * window (trap 22b). The two harms here are:
 *   DROP — we call a real instruction a deliberation and stop asking for the
 *          value the user was about to give.
 *   INVENT — we call a deliberation an instruction and write, or offer, a
 *          number nobody asked for.
 * Every deliberative case below is paired with an imperative twin carrying the
 * SAME verb, and both directions are asserted.
 */

import { describe, expect, it } from 'vitest';

import {
  classifyUnappliedEditFrame,
  composeUnappliedEditReply,
  resolveUnappliedEditUnderstanding,
  type UnappliedEditNode,
} from '../unapplied-edit-reply.js';
import {
  findEditInternalsHit,
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../forbidden-user-facing-phrases.js';
import { qualitativeBand } from '../../../cee/factor-extraction/display-value.js';
import { isValueUpdatePhrasing } from '../../../orchestrator/routing/value-update-gate.js';
import { EDIT_GRAPH_POSITIVE_REGEX } from '../../../orchestrator/routing/edit-graph-intent-regex.js';

// ── The graph the witnessed session had on screen ──────────────────────────
const UNITLESS_FACTOR: UnappliedEditNode = {
  id: 'fac_tco',
  kind: 'factor',
  label: 'Team coordination overhead',
};
const MEASURED_FACTOR: UnappliedEditNode = {
  id: 'fac_spend',
  kind: 'factor',
  label: 'Marketing spend',
  unit: '£',
  raw_value: 50000,
};
const NODES: readonly UnappliedEditNode[] = [
  UNITLESS_FACTOR,
  MEASURED_FACTOR,
  { id: 'opt_lead', kind: 'option', label: 'Hire a Tech Lead' },
];

// ── WITNESSED (real deployed session, 4 Sep 2026) ──────────────────────────
const W1 = 'Change the uncertainty range for Team coordination overhead to low';
const W2 = 'Change the team coordination overhead to low.';
const W3 =
  'Do you think we should add the risk about spending money on the resource and still not hitting our launch date?';
const W4 = 'Do you agree that we should add this as a risk?';

describe('THE WITNESSED HARM — four messages, one sentence, two questions', () => {
  it('RED-first signature 1: the two EDITS are recognised as instructions that NAMED their object', () => {
    for (const m of [W1, W2]) {
      expect(classifyUnappliedEditFrame(m)).toBe('instruction');
      const u = resolveUnappliedEditUnderstanding(m, NODES);
      expect(u, `no understanding grounded for: ${m}`).not.toBeNull();
      expect(u!.node.id).toBe('fac_tco');
    }
  });

  it('RED-first signature 2: the two QUESTIONS are NOT instructions and get no edit-refusal', () => {
    for (const m of [W3, W4]) {
      expect(classifyUnappliedEditFrame(m)).toBe('deliberation');
      const reply = composeUnappliedEditReply({ message: m, nodes: NODES });
      expect(reply).not.toBeNull();
      // The defect, stated as an assertion: a user who asked a question must
      // not be told to name a factor, edge, option and value.
      expect(reply!.text).not.toMatch(/specific factor, edge, option, or value/i);
      expect(reply!.text).toMatch(/question/i);
    }
  });

  it('RED-first signature 3: a user who NAMED the object and the value is never told to name them', () => {
    for (const m of [W1, W2]) {
      const reply = composeUnappliedEditReply({ message: m, nodes: NODES })!;
      expect(reply.text).not.toMatch(/Tell me the specific factor, edge, option, or value/i);
      // It must say back what it understood, by the node's own label.
      expect(reply.text).toContain('Team coordination overhead');
    }
  });

  it('W1 says plainly that an uncertainty range is not editable — the current copy promises it is', () => {
    const u = resolveUnappliedEditUnderstanding(W1, NODES)!;
    expect(u.kind).toBe('unsupported_aspect');
    const reply = composeUnappliedEditReply({ message: W1, nodes: NODES })!;
    expect(reply.text).toMatch(/uncertainty range isn't something I can edit/i);
    // …and it must NOT promise to apply it directly.
    expect(reply.text).not.toMatch(/I'll apply it directly/i);
  });

  it('W2 states the band mapping and REFUSES to pick the number itself', () => {
    const u = resolveUnappliedEditUnderstanding(W2, NODES)!;
    expect(u.kind).toBe('level_on_unitless_factor');
    const reply = composeUnappliedEditReply({ message: W2, nodes: NODES })!;
    expect(reply.text).toMatch(/covers a range of values/i);
    expect(reply.text).toMatch(/never gave me/i);
    // The offers are proposals the user consents to by clicking, not a write.
    expect(reply.chips.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUESTION 1 — the corpus and its opposite-direction twins.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deliberative frames and their IMPERATIVE TWINS carrying the same verb.
 * Sources marked per row. The twin is what stops the frame gate widening into
 * a drop: every twin must classify as an instruction.
 */
const FRAME_TWINS: ReadonlyArray<{
  readonly source: string;
  readonly deliberation: string;
  readonly twin: string;
}> = [
  {
    source: 'WITNESSED',
    deliberation: W3,
    twin: 'Add the risk about spending money and still missing our launch date.',
  },
  { source: 'WITNESSED', deliberation: W4, twin: 'Add this as a risk.' },
  {
    source: 'ROADMAP 2.1361',
    deliberation: 'Do you think we should change the churn rate to 5%?',
    twin: "I'd like you to change the churn rate to 5%",
  },
  {
    source: 'ROADMAP 2.1361',
    deliberation: 'Should we increase the growth rate to 12%?',
    twin: 'We should increase the growth rate to 12%',
  },
  {
    source: 'ROADMAP 2.1361',
    deliberation: 'Is it worth removing the status quo option?',
    twin: 'Actually, remove the status quo option.',
  },
  {
    source: 'REPO mutation-warrant NEGATIVE corpus',
    deliberation: 'What should we update based on this?',
    twin: 'Tell me what to change.',
  },
  // ⚠ THESE TWO TWINS WERE CORRECTED BY THE POSITIVE CONTROL BELOW, and the
  // correction is the finding. The obvious twins — the repo's own constraint
  // imperatives `Cap spend at 50000.` and `Keep churn below 3%.` — carry NO
  // `EDIT_GRAPH_POSITIVE_REGEX` verb, so they can never reach this module at
  // all: they route by the value-update gate's constraint clause. Asserting
  // `instruction` about them would have been a fixture outside the producer's
  // output domain proving nothing (CLAUDE.md trap 16, inverse form). Swapped
  // for edit-verb-bearing imperatives that state the SAME bound.
  {
    source: 'REPO mutation-warrant CONSTRAINT corpus (twin re-verbed)',
    deliberation: 'Do you agree we should cap spend at 50000?',
    twin: 'Set the spend cap to 50000.',
  },
  {
    source: 'REPO mutation-warrant CONSTRAINT corpus (twin re-verbed)',
    deliberation: 'Does it make sense to keep churn below 3%?',
    twin: 'Reduce churn to below 3%.',
  },
];

describe('QUESTION 1 — instruction vs request-for-a-view, both directions', () => {
  it.each(FRAME_TWINS)(
    '[$source] the deliberation is a deliberation: $deliberation',
    ({ deliberation }) => {
      expect(classifyUnappliedEditFrame(deliberation)).toBe('deliberation');
    },
  );

  it.each(FRAME_TWINS)(
    '[$source] OPPOSITE-DIRECTION TWIN — the imperative is an instruction: $twin',
    ({ twin }) => {
      expect(classifyUnappliedEditFrame(twin)).toBe('instruction');
    },
  );

  it('POSITIVE CONTROL — the twins are genuinely EDIT-SHAPED, so the twin half is not vacuous', () => {
    // If the twins carried no edit verb they would never reach this module at
    // all and asserting `instruction` about them would prove nothing.
    // This control has already earned its place: it REJECTED two twins lifted
    // straight from the repo's constraint corpus, because a constraint
    // imperative carries no edit verb and therefore never reaches this module.
    // See the note on those rows.
    const nonEditTwins = FRAME_TWINS.filter(
      (t) => !EDIT_GRAPH_POSITIVE_REGEX.test(t.twin),
    );
    expect(nonEditTwins.map((t) => t.twin)).toEqual([]);
  });

  it('a QUESTION MARK alone is never the discriminator — that is the measured oscillation', () => {
    // "Can you change X to 5?" is an instruction wearing a question mark.
    // Treating punctuation as the signal is exactly the fifth regex round
    // ROADMAP 2.1361 ran in advance and proved oscillates.
    expect(classifyUnappliedEditFrame('Can you change the churn rate to 5%?')).toBe(
      'instruction',
    );
    expect(classifyUnappliedEditFrame('Could you remove the status quo option?')).toBe(
      'instruction',
    );
    expect(classifyUnappliedEditFrame('Change the churn rate to 5%?')).toBe('instruction');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUESTION 2 — what did we understand, and what may we offer.
// ═══════════════════════════════════════════════════════════════════════════

describe('QUESTION 2 — the understanding, and the coercion boundary', () => {
  it('a level word on a MEASURED factor is never inverted — there is no scale to invert', () => {
    const m = 'Change Marketing spend to low';
    const u = resolveUnappliedEditUnderstanding(m, NODES)!;
    expect(u.kind).toBe('level_on_measured_factor');
    const reply = composeUnappliedEditReply({ message: m, nodes: NODES })!;
    expect(reply.text).toMatch(/invent an amount/i);
    // ⭐ THE COERCION BOUNDARY: not one number is offered.
    expect(reply.chips).toEqual([]);
    expect(reply.text).not.toMatch(/\d/);
  });

  it('a named target with NO value bound offers NO number — an unbounded offer is coercion wearing a click', () => {
    const m = 'Change Team coordination overhead';
    const u = resolveUnappliedEditUnderstanding(m, NODES)!;
    expect(u.kind).toBe('named_target_no_value');
    const reply = composeUnappliedEditReply({ message: m, nodes: NODES })!;
    expect(reply.chips).toEqual([]);
    expect(reply.text).not.toMatch(/\d/);
  });

  it('DERIVED — every offered value round-trips through the product’s OWN banding rule', () => {
    // Not a copied band table (trap 12). If `qualitativeBand` moves, so do
    // these, and this assertion is what proves they moved together.
    for (const level of ['low', 'moderate', 'high', 'very high']) {
      const m = `Change Team coordination overhead to ${level}`;
      const u = resolveUnappliedEditUnderstanding(m, NODES);
      expect(u, level).not.toBeNull();
      if (u!.kind !== 'level_on_unitless_factor') throw new Error(`wrong kind for ${level}`);
      expect(u!.offers.length, `no offers for ${level}`).toBeGreaterThan(0);
      for (const v of u!.offers) {
        expect(qualitativeBand(v).toLowerCase(), `${v} is not ${level}`).toBe(level);
      }
    }
  });

  it('CORPUS — a hand-written check the derivation is structurally blind to: every band is reachable', () => {
    // trap 12d: a derived guard proves AGREEMENT and can never prove
    // COMPLETENESS. A band the synonym table cannot reach would satisfy the
    // derived assertion above vacuously by never being tested.
    const reached = new Set<string>();
    for (const word of ['low', 'medium', 'moderate', 'mid', 'high', 'very high']) {
      const u = resolveUnappliedEditUnderstanding(
        `Set Team coordination overhead to ${word}`,
        NODES,
      );
      if (u && u.kind === 'level_on_unitless_factor') reached.add(u.level);
    }
    expect([...reached].sort()).toEqual(['High', 'Low', 'Moderate', 'Very high']);
  });

  it('binding is by node IDENTITY — the LONGEST matching label wins, not any label that fits', () => {
    const overlapping: readonly UnappliedEditNode[] = [
      { id: 'fac_short', kind: 'factor', label: 'overhead' },
      UNITLESS_FACTOR,
    ];
    const u = resolveUnappliedEditUnderstanding(W2, overlapping)!;
    expect(u.node.id).toBe('fac_tco');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE OFFER MUST ROUTE. An advertised action that terminates in refusal is
// this estate's named defect class; the chip is checked against the REAL gate.
// ═══════════════════════════════════════════════════════════════════════════

describe('CHIP ROUTEABILITY — asserted by execution against the shipped gate', () => {
  it('every numeric offer chip satisfies isValueUpdatePhrasing, which is what routes it to set_factor_value', () => {
    const reply = composeUnappliedEditReply({ message: W2, nodes: NODES })!;
    expect(reply.chips.length).toBeGreaterThan(0);
    for (const c of reply.chips) {
      expect(isValueUpdatePhrasing(c.message), `does not route: ${c.message}`).toBe(true);
    }
  });

  it('POSITIVE CONTROL — the gate can say NO, so the assertion above is not vacuous', () => {
    expect(isValueUpdatePhrasing('Tell me the specific factor to change')).toBe(false);
  });

  it('W1 also reaches the value lane — the uncertainty ask still ends somewhere real', () => {
    const reply = composeUnappliedEditReply({ message: W1, nodes: NODES })!;
    expect(reply.chips.length).toBeGreaterThan(0);
    for (const c of reply.chips) {
      expect(isValueUpdatePhrasing(c.message)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EGRESS. Every string this module can emit is checked against the guards BY
// EXECUTION — the copy contract that misled PR #464 was checked by inspection.
// ═══════════════════════════════════════════════════════════════════════════

describe('EGRESS — no forbidden phrase, no success claim, no internals', () => {
  const ALL_MESSAGES = [
    W1,
    W2,
    W3,
    W4,
    'Change Marketing spend to low',
    'Change Team coordination overhead',
    'Set Team coordination overhead to very high',
    'Set Team coordination overhead to medium',
  ];

  it.each(ALL_MESSAGES)('composed copy passes all three guards: %s', (m) => {
    const reply = composeUnappliedEditReply({ message: m, nodes: NODES });
    expect(reply).not.toBeNull();
    const strings = [reply!.text, ...reply!.chips.map((c) => `${c.label} ${c.message}`)];
    for (const s of strings) {
      expect(findForbiddenPhraseHit(s), `forbidden phrase in: ${s}`).toBeNull();
      expect(findSuccessClaimHit(s), `success claim in: ${s}`).toBeNull();
      expect(findEditInternalsHit(s), `internals in: ${s}`).toBeNull();
    }
  });

  it('POSITIVE CONTROL — the guards do fire on text that breaches them', () => {
    expect(findForbiddenPhraseHit('No change was made to the model.')).not.toBeNull();
  });

  it('every branch says the turn wrote nothing — the one claim all four must share', () => {
    for (const m of ALL_MESSAGES) {
      const reply = composeUnappliedEditReply({ message: m, nodes: NODES })!;
      expect(reply.text.startsWith("I haven't changed anything from that.")).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// KNOWN-DROPPED — pinned EXACTLY, so the suite REDs if the set grows OR
// shrinks. A gap recorded in the suite is honest; an invisible one is how
// four rounds happened (trap 22f).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shapes this module knowingly does NOT improve. Each falls through to the
 * caller's existing generic copy — the status quo, not a regression.
 *
 * ⚠ THIS IS A CLOSED SET, ASSERTED EXACTLY. Adding a case here without
 * teaching the module, or teaching the module without removing the case,
 * both go RED.
 */
const KNOWN_DROPPED_CORPUS: readonly string[] = [
  // No graph label anywhere — nothing to name back, so the generic "tell me
  // the specific factor" copy is the CORRECT answer for these.
  'Change this',
  'Make it better',
  'Adjust something',
  // Names a node we do not hold (a label the user invented or misremembered).
  'Change the churn rate to 5%',
  // ROADMAP 2.1361's noun-direction cases: they misroute HERE too, but the
  // module cannot tell a noun from a verb any better than the router can, and
  // pretending otherwise is the fifth round. Recorded, not hidden.
  'How has the update changed the analysis?',
  'Did my edit affect the ranking?',
  'I am worried about the increase in churn.',
];

describe('KNOWN-DROPPED — the exact set, pinned in both directions', () => {
  it('the module grounds NOTHING for exactly these, and returns null so the caller keeps its copy', () => {
    const actuallyDropped = KNOWN_DROPPED_CORPUS.filter(
      (m) => composeUnappliedEditReply({ message: m, nodes: NODES }) === null,
    );
    expect(actuallyDropped).toEqual(KNOWN_DROPPED_CORPUS);
  });

  it('and NOTHING ELSE in the corpora above is dropped — the set does not silently grow', () => {
    const improved = [
      W1,
      W2,
      W3,
      W4,
      'Change Marketing spend to low',
      'Change Team coordination overhead',
    ];
    const silentlyDropped = improved.filter(
      (m) => composeUnappliedEditReply({ message: m, nodes: NODES }) === null,
    );
    expect(silentlyDropped).toEqual([]);
  });

  it('the two ROADMAP noun-direction cases are dropped for the RIGHT reason — no label, not a frame mistake', () => {
    // If one of these were dropped because the frame gate claimed it, the fix
    // would be a frame change, not a recorded gap. Prove which it is.
    for (const m of [
      'How has the update changed the analysis?',
      'Did my edit affect the ranking?',
    ]) {
      expect(classifyUnappliedEditFrame(m)).toBe('instruction');
      expect(resolveUnappliedEditUnderstanding(m, NODES)).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE STRUCTURAL CLAIM — the two questions are TWO. Merging them RED-s.
// ═══════════════════════════════════════════════════════════════════════════

describe('TWO QUESTIONS, NOT ONE — the property a merged predicate cannot have', () => {
  it('the two predicates DISAGREE on a real turn, so they cannot be one predicate', () => {
    // W4 is a deliberation that grounds NO understanding.
    expect(classifyUnappliedEditFrame(W4)).toBe('deliberation');
    expect(resolveUnappliedEditUnderstanding(W4, NODES)).toBeNull();
    // W2 is an instruction that grounds one.
    expect(classifyUnappliedEditFrame(W2)).toBe('instruction');
    expect(resolveUnappliedEditUnderstanding(W2, NODES)).not.toBeNull();
    // A single predicate answering both would have to give the same verdict
    // for at least one of these pairs. It does not, on either.
  });

  it('MERGE MUTANT — a composer that answers only Q2 loses the deliberation frame entirely', () => {
    // Simulate the merged predicate: understanding alone decides everything.
    const mergedW3 = resolveUnappliedEditUnderstanding(W3, NODES);
    const mergedW4 = resolveUnappliedEditUnderstanding(W4, NODES);
    // Both ground nothing, so a Q2-only composer returns the generic copy for
    // both — i.e. reproduces the witnessed harm exactly.
    expect(mergedW3).toBeNull();
    expect(mergedW4).toBeNull();
    // The real composer does not.
    expect(composeUnappliedEditReply({ message: W3, nodes: NODES })).not.toBeNull();
    expect(composeUnappliedEditReply({ message: W4, nodes: NODES })).not.toBeNull();
  });

  it('MERGE MUTANT — a composer that answers only Q1 mis-answers both edits', () => {
    // Q1 alone calls W1 and W2 'instruction' and has nothing more to say, so
    // it cannot name the factor back, cannot state the band, and cannot refuse
    // the uncertainty ask honestly. Those three are Q2's answers.
    expect(classifyUnappliedEditFrame(W1)).toBe(classifyUnappliedEditFrame(W2));
    const u1 = resolveUnappliedEditUnderstanding(W1, NODES)!;
    const u2 = resolveUnappliedEditUnderstanding(W2, NODES)!;
    expect(u1.kind).not.toBe(u2.kind);
  });
});
