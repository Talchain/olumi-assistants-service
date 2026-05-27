import { describe, it, expect } from 'vitest';

import {
  gateAssumptionFragment,
  gateFullResponse,
  type GateRejectReason,
} from '../copy-quality-gate.js';

function rejectsWith(
  fn: (text: string) => { accept: boolean; rejectReason?: GateRejectReason },
  text: string,
  reason: GateRejectReason,
): void {
  const r = fn(text);
  expect(r.accept, `expected rejection of: ${text}`).toBe(false);
  expect(r.rejectReason).toBe(reason);
}

function accepts(
  fn: (text: string) => { accept: boolean },
  text: string,
): void {
  const r = fn(text);
  expect(r.accept, `expected acceptance of: ${text}`).toBe(true);
}

describe('gateAssumptionFragment', () => {
  it('accepts a clean declarative fragment', () => {
    accepts(
      gateAssumptionFragment,
      'extra developers may add coordination overhead rather than throughput',
    );
  });

  it('rejects an empty string', () => {
    rejectsWith(gateAssumptionFragment, '', 'empty');
  });

  it('rejects a whitespace-only string', () => {
    rejectsWith(gateAssumptionFragment, '   \t\n  ', 'empty');
  });

  it('rejects a too-short string', () => {
    rejectsWith(gateAssumptionFragment, 'abc', 'too_short');
  });

  it('rejects a too-long string', () => {
    rejectsWith(gateAssumptionFragment, 'a'.repeat(200), 'too_long');
  });

  it('rejects em dashes', () => {
    rejectsWith(
      gateAssumptionFragment,
      'team capacity may be a bottleneck — review headcount before commit',
      'em_dash',
    );
  });

  it('rejects en dashes', () => {
    rejectsWith(
      gateAssumptionFragment,
      'cost may overrun by 20–30% under stress scenarios with vendor risk',
      'em_dash',
    );
  });

  it('rejects internal-id prefix tokens (fac_)', () => {
    rejectsWith(
      gateAssumptionFragment,
      'check whether fac_cost reflects the real overhead burden',
      'internal_id',
    );
  });

  it('rejects internal-id prefix tokens (opt_)', () => {
    rejectsWith(
      gateAssumptionFragment,
      'opt_inhouse delivery assumptions may understate the risk',
      'internal_id',
    );
  });

  it('rejects schema terms (intervention)', () => {
    rejectsWith(
      gateAssumptionFragment,
      'the intervention modelled here assumes no behavioural shift',
      'schema_term',
    );
  });

  it('rejects schema terms (analysis_ready)', () => {
    rejectsWith(
      gateAssumptionFragment,
      'set analysis_ready before validating the model output',
      'schema_term',
    );
  });

  it('rejects schema terms (model_adjustment)', () => {
    rejectsWith(
      gateAssumptionFragment,
      'the model_adjustment to delivery capacity is significant',
      'schema_term',
    );
  });

  it('rejects premature recommendation language (recommend)', () => {
    rejectsWith(
      gateAssumptionFragment,
      'we recommend hiring a tech lead before scaling the team',
      'premature_recommendation',
    );
  });

  it('rejects premature recommendation language (winner)', () => {
    rejectsWith(
      gateAssumptionFragment,
      'option B is the winner on cost and delivery time combined',
      'premature_recommendation',
    );
  });

  it('rejects premature recommendation language (best option)', () => {
    rejectsWith(
      gateAssumptionFragment,
      'the best option appears to be hiring a senior lead first',
      'premature_recommendation',
    );
  });

  it('rejects question-shaped fragments', () => {
    rejectsWith(
      gateAssumptionFragment,
      'what if the delivery capacity falls below projection',
      'question_shaped',
    );
  });

  it('rejects trailing punctuation', () => {
    rejectsWith(
      gateAssumptionFragment,
      'extra developers may add coordination overhead rather than throughput.',
      'trailing_punctuation',
    );
  });

  it('rejects awkward / glyph-heavy fragments', () => {
    rejectsWith(gateAssumptionFragment, '!!! @#$ %%%% &&&', 'awkward_grammar');
  });

  it('accepts a fragment containing a legitimate user-facing snake-case label', () => {
    accepts(
      gateAssumptionFragment,
      'the go_to_market option assumes the partnership terms remain stable',
    );
  });

  it('accepts a fragment containing b2b_partnership', () => {
    accepts(
      gateAssumptionFragment,
      'the b2b_partnership path depends on closing the channel agreement first',
    );
  });
});

describe('gateFullResponse', () => {
  it('accepts a clean coaching paragraph that frames a decision, surfaces a trade-off, and gives a next step', () => {
    const text =
      "I've built a first decision model for your launch. The main routes weigh delivery speed against quality risk, and one assumption worth checking is whether the team can absorb extra coordination overhead. Next, run the analysis to see how the options compare under stress.";
    accepts(gateFullResponse, text);
  });

  it('rejects when there is no decision framing token', () => {
    const text =
      'There are some things worth checking. Capacity may be tight and the team may need more time. Try a stress test next.';
    rejectsWith(gateFullResponse, text, 'no_decision_framing');
  });

  it('rejects when there is no trade-off / gap / assumption token', () => {
    const text =
      "I've built a decision model for the launch. The options are A, B and C. The model is ready to explore. Run the analysis next when you are ready to proceed with the comparison flow.";
    rejectsWith(gateFullResponse, text, 'no_tradeoff_or_gap');
  });

  it('rejects when there is no next-step token', () => {
    const text =
      "I've built a decision model. The options weigh delivery speed against quality risk. One assumption is whether the team can absorb extra overhead in the coordination flow under load conditions.";
    rejectsWith(gateFullResponse, text, 'no_next_step');
  });

  it('rejects too-short responses', () => {
    rejectsWith(gateFullResponse, 'decision model trade-off run', 'too_short');
  });

  it('rejects too-long responses', () => {
    const text =
      "I've built a decision model. The options weigh delivery against risk. " +
      'a'.repeat(1300) +
      ' Next, run the analysis.';
    rejectsWith(gateFullResponse, text, 'too_long');
  });

  it('rejects responses with premature recommendation language', () => {
    const text =
      "I've built a decision model. The options weigh delivery speed against quality risk. We recommend hiring a tech lead given the timeline pressure. Next, run the analysis to validate.";
    rejectsWith(gateFullResponse, text, 'premature_recommendation');
  });

  it('rejects responses leaking internal IDs', () => {
    const text =
      "I've built a decision model for the launch. The options weigh delivery speed against quality risk in fac_cost. Next, run the analysis to validate the assumptions across all routes.";
    rejectsWith(gateFullResponse, text, 'internal_id');
  });

  it('rejects responses leaking schema terms', () => {
    const text =
      "I've built a decision model for the launch. The options weigh delivery speed against quality risk via intervention strategies. Next, run the analysis to validate options.";
    rejectsWith(gateFullResponse, text, 'schema_term');
  });

  it('rejects responses with em dashes', () => {
    const text =
      "I've built a decision model — the routes weigh delivery speed against quality risk, with assumptions to consider. Next, run the analysis to validate the options.";
    rejectsWith(gateFullResponse, text, 'em_dash');
  });

  it('accepts a response containing a legitimate user-facing snake-case label', () => {
    const text =
      "I've built a decision model for the launch. The routes compare go_to_market and b2b_partnership against the in-house build option, with capacity risk to consider as a key assumption. Next, run the analysis to see how the options compare.";
    accepts(gateFullResponse, text);
  });
});
