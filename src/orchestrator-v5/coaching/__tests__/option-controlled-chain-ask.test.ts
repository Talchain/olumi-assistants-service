/**
 * ⭐⭐⭐ THE PERSON'S CAUSAL CLAIM ENDS AT A FACTOR THE OPTIONS SET THEMSELVES.
 *
 * Measured 19 Sep, scenario `26b908ee`: the person described founder capacity →
 * time on fundraising → capital raised, the product drew it, and every option
 * ALSO sets Capital Raised directly (`zero_reason: "intervention_override"`).
 * The 19:23 reply offered to collect the missing option→time effects and never
 * mentioned the direct sets — so the person was invited to spend effort without
 * the one fact bearing on whether it was worth spending.
 *
 * ⚠ The fact already reaches the MODEL (`format-analysis-for-context.ts` carries
 * "every option sets its own value for this"). It is not guaranteed to reach the
 * PERSON, and on the captured turn it did not. These tests pin the deterministic
 * half.
 */
import { describe, it, expect } from 'vitest';
import {
  findOptionControlledChain,
  composeOptionControlledChainAsk,
  buildOptionControlledChainActions,
} from '../option-controlled-chain-ask.js';
import type { FactorInvestigationSignal } from '../../context/factor-investigation-licence.js';

const sig = (id: string, verdict: string): FactorInvestigationSignal =>
  ({
    factor_id: id,
    factor_label: id,
    verdict,
    heuristic_basis: false,
    evpi_percentage_points: null,
  }) as unknown as FactorInvestigationSignal;

const NODES = [
  { id: 'cap', label: 'Founder Capacity' },
  { id: 'time', label: 'Time Spent on Fundraising' },
  { id: 'capital', label: 'Capital Raised' },
];
/** The captured chain: capacity → time → capital. */
const EDGES = [
  { from: 'cap', to: 'time' },
  { from: 'time', to: 'capital' },
];
const INVESTIGATION = [sig('capital', 'option_controlled'), sig('time', 'informative')];

describe('a causal claim that ends at an option-controlled factor', () => {
  it('⭐ THE CAPTURED CASE: one authored edge to an option-controlled factor is found', () => {
    const f = findOptionControlledChain('time', NODES, EDGES, INVESTIGATION);
    expect(f).not.toBeNull();
    expect(f!.subjectLabel).toBe('Time Spent on Fundraising');
    expect(f!.controlledLabel).toBe('Capital Raised');
  });

  /**
   * ⛔⛔ THE SCOPE CORE REQUIRED IN THE COPY AND THE ACCEPTANCE CLAIM.
   * This reads ONE authored edge. `cap` reaches `capital` only via `time`, and
   * this module does not walk — so it finds nothing from `cap`, and must not
   * pretend to have established the two-edge journey.
   */
  it('⛔ does NOT compose a multi-hop path — two edges away finds nothing', () => {
    expect(findOptionControlledChain('cap', NODES, EDGES, INVESTIGATION)).toBeNull();
  });

  it('⛔ direction is respected — an edge INTO the subject is a different sentence', () => {
    // `capital` has no outgoing edge, so nothing is found from it even though
    // it is itself option-controlled.
    expect(findOptionControlledChain('capital', NODES, EDGES, INVESTIGATION)).toBeNull();
  });

  it('⛔ ambiguity refuses rather than guessing which link to name', () => {
    const twoControlled = [
      sig('capital', 'option_controlled'),
      sig('other', 'option_controlled'),
    ];
    const nodes = [...NODES, { id: 'other', label: 'Other Pinned Thing' }];
    const edges = [...EDGES, { from: 'time', to: 'other' }];
    expect(findOptionControlledChain('time', nodes, edges, twoControlled)).toBeNull();
  });

  it('⛔ a non-option-controlled neighbour is not a finding', () => {
    // `time` is `informative`, so `cap`→`time` must not fire.
    const onlyTimeInformative = [sig('time', 'informative')];
    expect(findOptionControlledChain('cap', NODES, EDGES, onlyTimeInformative)).toBeNull();
  });

  it('fails closed on every missing input', () => {
    expect(findOptionControlledChain(null, NODES, EDGES, INVESTIGATION)).toBeNull();
    expect(findOptionControlledChain('time', null, EDGES, INVESTIGATION)).toBeNull();
    expect(findOptionControlledChain('time', NODES, null, INVESTIGATION)).toBeNull();
    expect(findOptionControlledChain('time', NODES, EDGES, [])).toBeNull();
  });
});

describe('the sentence claims only what was read', () => {
  const finding = findOptionControlledChain('time', NODES, EDGES, INVESTIGATION)!;
  const text = composeOptionControlledChainAsk(finding);

  it('names the link, relays the producer verdict, and asks', () => {
    expect(text).toContain('Time Spent on Fundraising');
    expect(text).toContain('Capital Raised');
    expect(text).toMatch(/every option sets its own value/i);
    expect(text.trimEnd().endsWith('?')).toBe(true);
  });

  /**
   * ⛔⛔ THE THREE CLAIMS CORE WITHDREW FROM MY OWN EARLIER DRAFT. Each is
   * asserted as an ABSENCE because each is the tempting, confident sentence.
   */
  it('⛔ never says the comparison is inert, wasted, or unchanged', () => {
    expect(text).not.toMatch(/inert|no effect|wast|pointless|will not change|won.t change/i);
  });

  it('⛔ never claims outcomes would be identical, or that all options are the same', () => {
    expect(text).not.toMatch(/identical|all four|every option would|same outcome/i);
  });

  it('⛔ never invents a quantity or a level', () => {
    expect(text).not.toMatch(/\b\d+(\.\d+)?%?\b/);
  });
});

describe('the answer is retained through the EXISTING interface', () => {
  const finding = findOptionControlledChain('time', NODES, EDGES, INVESTIGATION)!;
  const actions = buildOptionControlledChainActions(finding);

  it('⭐ both chips name BOTH factors, so the answer binds to the exact pair', () => {
    expect(actions).toHaveLength(2);
    for (const a of actions) {
      expect(a.prompt).toContain('Capital Raised');
    }
    expect(actions[0]!.prompt).toContain('Time Spent on Fundraising');
  });

  it('⭐ both answers are offered and neither is recommended', () => {
    expect(actions[0]!.label).toMatch(/follow from/i);
    expect(actions[1]!.label).toMatch(/keep/i);
    // No chip may tell the person which is better.
    for (const a of actions) {
      expect(a.label).not.toMatch(/should|better|recommend|best/i);
      expect(a.prompt).not.toMatch(/should|better|recommend|best/i);
    }
  });

  it('⛔ the change chip promises no outcome', () => {
    expect(actions[0]!.prompt).not.toMatch(/will|then the|result|comparison|lead/i);
  });
});
