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
import {
  isValueUpdatePhrasing,
  shouldSuppressEditDispatchForValueUpdate,
} from '../../../orchestrator/routing/value-update-gate.js';
import {
  EDIT_GRAPH_NEGATIVE_REGEX,
  EDIT_GRAPH_POSITIVE_REGEX,
} from '../../../orchestrator/routing/edit-graph-intent-regex.js';

// ── The graph the witnessed session had on screen ──────────────────────────
//
// ⭐⭐ THESE FIXTURES ARE AT THE REAL NODE SHAPE, AND THE FIRST VERSION OF THIS
// SPEC WAS NOT. It wrote `unit` and `raw_value` at the node's TOP LEVEL, where
// no graph node has ever carried them, so `isUnitlessFactor` returned true for
// every real node and the measured branch was unreachable in production while
// this suite stayed green. A self-authored fixture outside the producer's
// output domain proves nothing (CLAUDE.md trap 16, inverse form).
//
// PROVEN, with a contrast control at the same level, over the 491 graph nodes
// in every `*.json` under `src/` (44 files, 44 parsed, 32 node-bearing):
//   node.unit       (top level) ...   0 / 491
//   node.raw_value  (top level) ...   0 / 491
//   node.label      (top level) ... 491 / 491   <- CONTRAST: the probe SEES this level
//   node.observed_state.unit ......  23
//   node.observed_state.raw_value .  26
// `NodeV3Schema` (@talchain/schemas 0.50.0, dist/graph.js:256) declares
// `observed_state` and NOT `unit`; `ObservedStateSchema` (dist/graph.js:139)
// declares `unit`. `raw_value` is not in the published schema at all and rides
// `.passthrough()`. The colliding names belong to `DisplayValueInput`
// (cee/factor-extraction/display-value.ts:30-36) — the same module this
// composer imports `qualitativeBand` from.
const UNITLESS_FACTOR: UnappliedEditNode = {
  id: 'fac_tco',
  kind: 'factor',
  label: 'Team coordination overhead',
  // PROVABLY 0-1: a value inside the unit interval and no unit/raw/cap beside
  // it. This is the ONLY class entitled to the "0-1 scale" sentence.
  observed_state: { value: 0.3 },
};
const MEASURED_FACTOR: UnappliedEditNode = {
  id: 'fac_spend',
  kind: 'factor',
  label: 'Marketing spend',
  // £500k, normalised to 0.5 against a 1m cap — the real persisted shape.
  observed_state: { value: 0.5, raw_value: 500000, unit: '£', cap: 1000000 },
};
/**
 * ⚠ A MEASURED FACTOR WITH NO CAP — AND THE MUTANT THAT FORCED IT INTO
 * EXISTENCE. `MEASURED_FACTOR` above carries a `cap`, which is realistic, and
 * `cap` is itself sufficient to classify a factor measured. So the mutant that
 * reverts the UNIT path to the node's top level left the flagship £ assertion
 * GREEN — the cap alone still carried it. The headline harm was being asserted
 * against a fixture that could not see the headline defect.
 *
 * This fixture removes the cap, so the £ claim binds to the `observed_state.unit`
 * path itself and the revert mutant bites the assertion it is named for.
 */
const MEASURED_NO_CAP: UnappliedEditNode = {
  id: 'fac_ship',
  kind: 'factor',
  label: 'Shipping cost',
  observed_state: { value: 0.4, raw_value: 400, unit: '$' },
};

/**
 * ⚠ CAP BUT NO UNIT AND NO RAW — 1 of the 491, and it survived the first
 * mutant kit unasserted. A cap means the 0-1 number is a NORMALISATION of a
 * user-scale magnitude, so the user's word is about that magnitude and not
 * about the normalised number. Nothing pinned that until the survivor showed
 * it: a surviving mutant is a claim either way, and the only settlement is a
 * discriminating fixture.
 */
const CAPPED_FACTOR: UnappliedEditNode = {
  id: 'fac_headcount',
  kind: 'factor',
  label: 'Engineering headcount',
  observed_state: { value: 0.5, cap: 40 },
};

/**
 * ⭐ THE DOMINANT REAL CLASS, AND IT HAD NO FIXTURE AT ALL: 403 of those 491
 * nodes (82%) carry NO `observed_state`, so nothing in the payload says what
 * scale they are on. Absence is UNDECLARED, never "unitless" — the module must
 * not claim a 0-1 scale nor offer a number for these.
 */
const UNKNOWN_SCALE_FACTOR: UnappliedEditNode = {
  id: 'fac_morale',
  kind: 'factor',
  label: 'Team morale',
};
const NODES: readonly UnappliedEditNode[] = [
  UNITLESS_FACTOR,
  MEASURED_FACTOR,
  MEASURED_NO_CAP,
  CAPPED_FACTOR,
  UNKNOWN_SCALE_FACTOR,
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

  it('⭐ F1 — a £-denominated factor is never told it is on a 0–1 scale, and is never offered 0.1', () => {
    // THE WITNESSED CONSEQUENCE OF THE WRONG FIELD PATH. With `unit` read at
    // the node's top level it is always absent, so a £500k factor was
    // classified unitless, told "On this factor's 0–1 scale…" — a false claim
    // about the user's own model — and handed a chip that writes 0.1 into it.
    // Both halves are asserted here because they are different harms: the
    // sentence is a lie, the chip is a corruption.
    // ⚠ BOTH measured shapes, and the second one is why. `Marketing spend`
    // carries a cap, and a cap ALONE classifies a factor measured — so this
    // assertion stayed green under the mutant that reverts the unit path.
    // `Shipping cost` has a unit and no cap, so the £-harm claim binds to the
    // `observed_state.unit` read itself.
    for (const label of ['Marketing spend', 'Shipping cost']) {
      const reply = composeUnappliedEditReply({
        message: `Change ${label} to low`,
        nodes: NODES,
      })!;
      expect(reply.text, label).not.toMatch(/0–1 scale/);
      expect(reply.text, label).not.toMatch(/covers a range of values/i);
      for (const c of reply.chips) {
        expect(c.message, `offered a bare number on a measured factor: ${c.message}`).not.toMatch(
          /\bto\s+0?\.\d/,
        );
      }
      expect(reply.chips, label).toEqual([]);
    }
  });

  it('⭐ a CAP alone makes a factor measured — the 0–1 number is a normalisation of a real magnitude', () => {
    // This case SURVIVED the first mutant kit: dropping `cap` from the
    // measured test left all 66 green. A surviving mutant is a claim either
    // way, and the only settlement is a discriminating fixture.
    const u = resolveUnappliedEditUnderstanding('Change Engineering headcount to low', NODES)!;
    expect(u.kind).toBe('level_on_measured_factor');
    const reply = composeUnappliedEditReply({
      message: 'Change Engineering headcount to low',
      nodes: NODES,
    })!;
    expect(reply.text).not.toMatch(/0–1 scale/);
    expect(reply.chips).toEqual([]);

    // CONTRAST — the same value with NO cap beside it IS a 0–1 factor and does
    // get the band offer. Without this the assertion above could be satisfied
    // by a module that simply refused everything.
    const uncapped: UnappliedEditNode = {
      id: 'fac_x',
      kind: 'factor',
      label: 'Engineering headcount',
      observed_state: { value: 0.5 },
    };
    expect(
      resolveUnappliedEditUnderstanding('Change Engineering headcount to low', [uncapped])!.kind,
    ).toBe('level_on_unitless_factor');
  });

  it('⭐ F1 — the measured branch is reachable AT THE REAL SHAPE, not only at a hand-written one', () => {
    // The bug was not that the branch was wrong; it was that nothing could
    // reach it. Bind the claim to the path a producer actually writes.
    const atRealShape: UnappliedEditNode = {
      id: 'n1',
      kind: 'factor',
      label: 'Server cost',
      observed_state: { value: 0.4, unit: '$', raw_value: 400 },
    };
    expect(
      resolveUnappliedEditUnderstanding('Change Server cost to high', [atRealShape])!.kind,
    ).toBe('level_on_measured_factor');

    // ⚠ AND THE HONEST OTHER HALF, WHICH CORRECTED THIS TEST. I first asserted
    // that the same fields at the TOP level yield 'unknown_scale' — i.e. that
    // the dead path is not read at all. That was wrong, and deliberately so:
    // `resolveFactorScale` keeps `node.unit` as a last-resort candidate
    // because the shipped resolver `buildFactorScaleMap`
    // (plot-intervention-scale.ts:419-422) does, and because the fallback is
    // FAIL-SAFE — a hit can only move a factor towards 'measured', i.e. fewer
    // numeric claims, never more. `raw_value` has no top-level fallback there,
    // and that asymmetry is preserved rather than tidied.
    const atLegacyPath = {
      id: 'n1',
      kind: 'factor',
      label: 'Server cost',
      unit: '$',
    } as unknown as UnappliedEditNode;
    expect(
      resolveUnappliedEditUnderstanding('Change Server cost to high', [atLegacyPath])!.kind,
    ).toBe('level_on_measured_factor');

    // THE DISCRIMINATION, then, is not top-level-vs-nested — it is DECLARED vs
    // UNDECLARED. A node with neither is the one that must not be claimed.
    const undeclared = { id: 'n1', kind: 'factor', label: 'Server cost' };
    expect(
      resolveUnappliedEditUnderstanding('Change Server cost to high', [undeclared])!.kind,
    ).toBe('level_on_unknown_scale');
  });

  it('⭐ THE DOMINANT CLASS — 82% of real nodes have no observed_state, and absence is not a 0–1 scale', () => {
    // Measured: 403 of 491 nodes in every graph fixture under src/ carry no
    // observed_state. Reading that absence as "unitless" is the same false
    // claim as F1, one class wider. Positive evidence licenses the claim.
    const m = 'Change Team morale to low';
    const u = resolveUnappliedEditUnderstanding(m, NODES)!;
    expect(u.kind).toBe('level_on_unknown_scale');
    const reply = composeUnappliedEditReply({ message: m, nodes: NODES })!;
    expect(reply.text).toContain('Team morale');
    expect(reply.text).not.toMatch(/0–1 scale/);
    expect(reply.text).not.toMatch(/\d/);
    expect(reply.chips).toEqual([]);
  });

  it('⭐ and the PROVABLY 0–1 factor still gets the band offer — the fix is not a blanket refusal', () => {
    // The opposite-direction twin of the two cases above. Without this, a fix
    // that refused everything would pass them both.
    const u = resolveUnappliedEditUnderstanding(W2, NODES)!;
    expect(u.kind).toBe('level_on_unitless_factor');
    const reply = composeUnappliedEditReply({ message: W2, nodes: NODES })!;
    expect(reply.text).toMatch(/0–1 scale/);
    expect(reply.chips.length).toBeGreaterThan(0);
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

  it('the DELIBERATION chips route to the two DIFFERENT lanes they promise — measured, not assumed', () => {
    // The deliberation branch offers two ways out, and they must land in
    // different places or one of them is an advertised action that terminates
    // in refusal. Asserted against the real dispatch predicate, and the two
    // expectations DIFFER — a blind probe can fake agreement, but it cannot
    // fake a discrimination it is not making.
    const reply = composeUnappliedEditReply({ message: W4, nodes: NODES })!;
    const byId = new Map(reply.chips.map((c) => [c.id, c.message]));
    const answer = byId.get('unapplied_edit_deliberation_answer')!;
    const proceed = byId.get('unapplied_edit_deliberation_proceed')!;
    expect(answer).toBeDefined();
    expect(proceed).toBeDefined();

    const dispatchesToEditLane = (m: string): boolean =>
      EDIT_GRAPH_POSITIVE_REGEX.test(m) && !EDIT_GRAPH_NEGATIVE_REGEX.test(m);

    // "give me your view" must NOT be claimed by the edit lane, or the user
    // asks a question twice and is refused twice.
    expect(dispatchesToEditLane(answer)).toBe(false);
    // "put it in the model" MUST be claimed by the edit lane, or the chip
    // promises a change and delivers a conversation.
    expect(dispatchesToEditLane(proceed)).toBe(true);
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
// ⭐ F2 — Q1 MUST NOT SHORT-CIRCUIT Q2. A message can be BOTH: a request for
// our view that ALSO names the object and the value. Answering only the frame
// discards a fully-resolved understanding and tells a user who named both that
// they named neither — the witnessed harm, mirrored inside its own fix.
//
// ⚠ Zero of the eight FRAME_TWINS deliberations ground an understanding, so
// none of them exercises this pairing. These cases exist because the corpus
// above structurally cannot see the defect (trap 22).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deliberative frame AND a grounded instruction in one message. Each is
 * paired with the bare deliberation carrying the same frame, so the two
 * branches are asserted to DIFFER — a probe that returned the same answer for
 * both would prove nothing about the pairing.
 */
const PAIRED_CASES: ReadonlyArray<{
  readonly paired: string;
  readonly bare: string;
  readonly node: string;
}> = [
  {
    paired: 'Do you agree? Change the team coordination overhead to low.',
    bare: W4,
    node: 'fac_tco',
  },
  {
    paired: 'Do you think we should change Team coordination overhead to low?',
    bare: 'Do you think we should add a risk?',
    node: 'fac_tco',
  },
  {
    paired: 'Should we set Team coordination overhead to high?',
    bare: 'Should we add a mitigation?',
    node: 'fac_tco',
  },
];

describe('F2 — a question that ALSO names the object and the value gets BOTH answers', () => {
  it.each(PAIRED_CASES)(
    'PRECONDITION — the pairing is real: $paired grounds an understanding AND reads as a deliberation',
    ({ paired, node }) => {
      // Pin the precondition IN-TEST. Without this the assertions below could
      // pass because the understanding silently stopped resolving.
      expect(classifyUnappliedEditFrame(paired)).toBe('deliberation');
      const u = resolveUnappliedEditUnderstanding(paired, NODES);
      expect(u, `nothing grounded for: ${paired}`).not.toBeNull();
      expect(u!.node.id).toBe(node);
    },
  );

  it.each(PAIRED_CASES)('the reply names back what we understood: $paired', ({ paired }) => {
    const reply = composeUnappliedEditReply({ message: paired, nodes: NODES })!;
    // It is still a question, so it must still answer the question…
    expect(reply.text).toMatch(/question/i);
    // …but it must NOT discard the object and the value the user gave us.
    expect(reply.text).toContain('Team coordination overhead');
  });

  it.each(PAIRED_CASES)(
    'DISCRIMINATION — the paired reply DIFFERS from the bare one: $paired',
    ({ paired, bare }) => {
      // The load-bearing half. If the composer answered the frame and stopped,
      // these two would be byte-identical — and sameness across inputs that
      // ought to differ is the tell.
      const pairedReply = composeUnappliedEditReply({ message: paired, nodes: NODES })!;
      const bareReply = composeUnappliedEditReply({ message: bare, nodes: NODES })!;
      expect(classifyUnappliedEditFrame(bare)).toBe('deliberation');
      expect(resolveUnappliedEditUnderstanding(bare, NODES)).toBeNull();
      expect(pairedReply.text).not.toBe(bareReply.text);
    },
  );

  it('a paired question still offers a way to ANSWER it — the frame is not simply dropped', () => {
    const reply = composeUnappliedEditReply({
      message: PAIRED_CASES[0].paired,
      nodes: NODES,
    })!;
    const ids = reply.chips.map((c) => c.id);
    expect(ids).toContain('unapplied_edit_deliberation_answer');
  });

  it('⭐ the paired PROCEED chip lands somewhere real — it must not advertise an action that refuses', () => {
    // Measured, then pinned. The paired branch mints a NEW chip shape
    // (`Change <label> to <level>.`) that the existing deliberation-chip test
    // does not cover, and the obvious failure mode is a LOOP: the chip
    // re-submits the very message that produced this no-op.
    //
    // It does not loop, and the two hops are asserted here so a future change
    // cannot quietly make it one:
    //   hop 1 — the chip is claimed by the edit lane (else it promises a
    //           change and delivers a conversation);
    //   hop 2 — that message resolves to the band branch, whose chips satisfy
    //           the REAL suppression predicate and therefore reach
    //           `set_factor_value`.
    const reply = composeUnappliedEditReply({
      message: PAIRED_CASES[0].paired,
      nodes: NODES,
    })!;
    const proceed = reply.chips.find((c) => c.id === 'unapplied_edit_deliberation_proceed')!;
    expect(proceed).toBeDefined();

    const dispatchesToEditLane = (m: string): boolean =>
      EDIT_GRAPH_POSITIVE_REGEX.test(m) && !EDIT_GRAPH_NEGATIVE_REGEX.test(m);
    expect(dispatchesToEditLane(proceed.message)).toBe(true);

    // …and the DISCRIMINATION: the other chip must NOT be claimed by the edit
    // lane, or the user asks a question twice and is refused twice. Two
    // expectations that DIFFER, so a blind probe cannot fake agreement.
    const answer = reply.chips.find((c) => c.id === 'unapplied_edit_deliberation_answer')!;
    expect(dispatchesToEditLane(answer.message)).toBe(false);

    // hop 2 — the next turn ends somewhere that can write.
    const next = composeUnappliedEditReply({ message: proceed.message, nodes: NODES })!;
    expect(next.chips.length).toBeGreaterThan(0);
    for (const c of next.chips) {
      expect(
        shouldSuppressEditDispatchForValueUpdate(c.message),
        `paired proceed chip dead-ends: ${c.message}`,
      ).toBe(true);
    }
  });

  it('OPPOSITE DIRECTION — a paired question never WRITES, and never claims we did', () => {
    // The frame gate's whole safety argument is that neither branch mutates.
    // Pairing adds a value-bearing chip to a question, so the twin harm is a
    // chip that reads as a confirmation. Assert the copy stays a refusal.
    for (const { paired } of PAIRED_CASES) {
      const reply = composeUnappliedEditReply({ message: paired, nodes: NODES })!;
      expect(reply.text.startsWith("I haven't changed anything from that.")).toBe(true);
      expect(findSuccessClaimHit(reply.text)).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ F3 — assert the REAL suppression predicate, not the weaker conjunct.
// `value-update-gate.ts:386-388` names `shouldSuppressEditDispatchForValueUpdate`
// (:411) as "Route-v2's ACTUAL suppression predicate"; `isValueUpdatePhrasing`
// (:382) is only one of its two conjuncts, and asserting it alone left the
// mixed value+structural case unmeasured.
// ═══════════════════════════════════════════════════════════════════════════

describe('F3 — chip routing asserted against the predicate that actually suppresses', () => {
  it('every numeric offer chip satisfies the REAL suppression predicate', () => {
    const reply = composeUnappliedEditReply({ message: W2, nodes: NODES })!;
    expect(reply.chips.length).toBeGreaterThan(0);
    for (const c of reply.chips) {
      expect(
        shouldSuppressEditDispatchForValueUpdate(c.message),
        `does not suppress edit dispatch: ${c.message}`,
      ).toBe(true);
    }
  });

  it('POSITIVE CONTROL — the real predicate can say NO, and says no for a DIFFERENT reason than the weak one', () => {
    // Two controls with DIFFERENT expected answers, so a blind probe cannot
    // fake agreement: the first fails both conjuncts, the second passes the
    // weak conjunct and fails only the real one.
    expect(shouldSuppressEditDispatchForValueUpdate('Tell me the specific factor')).toBe(false);
    // ⚠ THIS EXAMPLE WAS MEASURED, NOT ASSUMED, AND THE FIRST ONE I WROTE WAS
    // WRONG. I reached for the mixed message quoted in `value-update-gate.ts`'s
    // own header ("Set Support cost to 30 and add a new factor called Shipping
    // costs") — and BOTH predicates return false for it, because the weak
    // conjunct's regex was tightened after that comment was written. The
    // comment describes a historical state. Swept eight candidates to find one
    // that genuinely separates the two.
    const mixed = 'Update the churn rate to 5% and delete the status quo option';
    expect(isValueUpdatePhrasing(mixed)).toBe(true);
    expect(shouldSuppressEditDispatchForValueUpdate(mixed)).toBe(false);
  });

  it('a label containing a structural word does NOT break the chip — measured, not assumed', () => {
    // Enumerated as a suspected defect and DISPROVEN; kept as a regression
    // pin, because a future change to the decomposer could make it real.
    const andLabel: UnappliedEditNode = {
      id: 'fac_sm',
      kind: 'factor',
      label: 'Sales and marketing spend',
      observed_state: { value: 0.3 },
    };
    const reply = composeUnappliedEditReply({
      message: 'Change Sales and marketing spend to low',
      nodes: [andLabel],
    })!;
    expect(reply.chips.length).toBeGreaterThan(0);
    for (const c of reply.chips) {
      expect(shouldSuppressEditDispatchForValueUpdate(c.message)).toBe(true);
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
