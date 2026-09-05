/**
 * UNSUPPORTED OPTION LINK — gate wiring.
 *
 * The classifier and its copy are pinned by
 * `unsupported-option-link-hold-ask.test.ts`. This file pins the only thing
 * that makes them reach a user: that `evaluateEditGraphMutations` composes
 * the unsupported-link ask INSTEAD of the generic hold ask when the held
 * batch carries an `option -> risk` link, and composes the generic ask
 * byte-identically when it does not.
 *
 * `add_node` / `add_edge` are unconditionally `held` STRUCTURAL_APPLY_HELD
 * (graph-management/referee.ts:383-389), so the captured batch always
 * reaches the `governing === 'held'` branch where the ask is built.
 *
 * RED-first: on the pre-fix base the captured batch produces the GENERIC
 * ask, which names the two links without saying they will be discarded.
 */

import { describe, expect, it } from 'vitest';

import {
  evaluateEditGraphMutations,
  type EditGmEvaluationInput,
} from '../edit-graph-referee-gate.js';
import { GM_UNSUPPORTED_LINK_HELD_ASSISTANT_TEXT } from '../unsupported-option-link.js';

const OPT_LEAD = 'opt-tech-lead';
const OPT_DEVS = 'opt-two-devs';
const FAC_VELOCITY = 'fac-velocity';
const GOAL_BOOST = 'goal-boost-productivity';
const DEC_ROOT = 'dec-root';
const RISK_SPEND = 'risk-spend-no-launch';

const LABEL_RISK = 'Spend on resources without hitting launch date';

const GRAPH = {
  nodes: [
    { id: DEC_ROOT, kind: 'decision', label: 'How to hit the launch date' },
    { id: OPT_LEAD, kind: 'option', label: 'Hire a Tech Lead' },
    { id: OPT_DEVS, kind: 'option', label: 'Two Developers' },
    { id: FAC_VELOCITY, kind: 'factor', label: 'Delivery velocity', category: 'controllable' },
    { id: GOAL_BOOST, kind: 'goal', label: 'Boost Productivity' },
  ],
  edges: [
    { from: DEC_ROOT, to: OPT_LEAD },
    { from: DEC_ROOT, to: OPT_DEVS },
    { from: OPT_LEAD, to: FAC_VELOCITY },
    { from: OPT_DEVS, to: FAC_VELOCITY },
    { from: FAC_VELOCITY, to: GOAL_BOOST },
  ],
};

const HASH = 'sha256:0000000000000000000000000000000000000000000000000000000000000001';

function evaluate(operations: readonly unknown[]): ReturnType<typeof evaluateEditGraphMutations> {
  const input: EditGmEvaluationInput = {
    mode: 'live',
    operations: operations as EditGmEvaluationInput['operations'],
    currentGraph: GRAPH,
    currentGraphHash: HASH,
    baseGraphHash: HASH,
    freshness: 'none',
    scenarioId: 'scn-unsupported-link',
    turnId: 'turn-1',
    requestId: 'req-1',
  };
  return evaluateEditGraphMutations(input);
}

const CAPTURED_OPS = [
  {
    op: 'add_node',
    path: RISK_SPEND,
    value: { id: RISK_SPEND, kind: 'risk', label: LABEL_RISK },
  },
  { op: 'add_edge', path: `${OPT_LEAD}->${RISK_SPEND}`, value: { from: OPT_LEAD, to: RISK_SPEND } },
  { op: 'add_edge', path: `${OPT_DEVS}->${RISK_SPEND}`, value: { from: OPT_DEVS, to: RISK_SPEND } },
  { op: 'add_edge', path: `${RISK_SPEND}->${GOAL_BOOST}`, value: { from: RISK_SPEND, to: GOAL_BOOST } },
];

/** The supported shape, minus any unsupported link. */
const LEGAL_OPS = [
  {
    op: 'add_node',
    path: 'fac-new',
    value: { id: 'fac-new', kind: 'factor', label: 'Team capacity', category: 'controllable' },
  },
  { op: 'add_edge', path: `${OPT_LEAD}->fac-new`, value: { from: OPT_LEAD, to: 'fac-new' } },
];

describe('evaluateEditGraphMutations — unsupported option link ask', () => {
  it('the captured batch is HELD and its ask states the links will not reach the result', () => {
    const decision = evaluate(CAPTURED_OPS);
    expect(decision.governing).toBe('held');
    expect(decision.blockApply).toBe(true);
    const text = decision.assistantText ?? '';
    expect(text).toContain('would sit in the model without reaching the result');
    expect(text).toContain('An option reaches a risk through a factor.');
    // The risk the user asked for is still named, and a yes is still offered.
    expect(text).toContain(LABEL_RISK);
    expect(text).toContain('reply yes to add it exactly as described');
  });

  it('a held batch with NO unsupported link keeps the generic ask, byte-identical', () => {
    const decision = evaluate(LEGAL_OPS);
    expect(decision.governing).toBe('held');
    const text = decision.assistantText ?? '';
    expect(text).toContain("I'm holding these changes rather than applying them straight away");
    expect(text).toContain('Nothing in the model moves until you confirm.');
    // None of the unsupported-link copy appears.
    expect(text).not.toContain('without reaching the result');
    expect(text).not.toContain('through a factor.');
    expect(text).not.toBe(GM_UNSUPPORTED_LINK_HELD_ASSISTANT_TEXT);
  });

  it('a mixed batch (legal + unsupported) still raises the unsupported-link ask', () => {
    const decision = evaluate([...LEGAL_OPS, ...CAPTURED_OPS]);
    expect(decision.governing).toBe('held');
    const text = decision.assistantText ?? '';
    expect(text).toContain('would sit in the model without reaching the result');
    // ...and the legal factor link is NOT named as a problem.
    expect(text).not.toContain('Team capacity would sit in the model');
  });

  it('the hold still carries a pending and a chip, so a confirm is still possible', () => {
    const decision = evaluate(CAPTURED_OPS);
    expect(decision.pendingActions).not.toBeNull();
    expect(decision.pendingActions).toHaveLength(1);
    expect(decision.suggestedActions).not.toBeNull();
    expect(decision.suggestedActions).toHaveLength(1);
  });
});
