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

  // ───── Graph-shape rejection (reviewer round-3 finding #2)
  it('rejects graph-shape language: nodes', () => {
    rejectsWith(
      gateAssumptionFragment,
      'the model lists seven nodes which is more than your team can manage',
      'graph_shape',
    );
  });

  it('rejects graph-shape language: edges', () => {
    rejectsWith(
      gateAssumptionFragment,
      'eight edges connect the cost factor to the delivery outcome each turn',
      'graph_shape',
    );
  });

  it('rejects graph-shape language: graph', () => {
    rejectsWith(
      gateAssumptionFragment,
      'the graph you produced may not match the underlying budget reality here',
      'graph_shape',
    );
  });

  // ───── Internal-id prefix coverage (reviewer round-3 finding #4)
  it('rejects full-word internal-id prefixes: factor_', () => {
    rejectsWith(
      gateAssumptionFragment,
      'factor_delivery_cost may understate the real overhead under stress conditions',
      'internal_id',
    );
  });

  it('rejects full-word internal-id prefixes: option_', () => {
    rejectsWith(
      gateAssumptionFragment,
      'option_launch_now compresses timelines too aggressively for the first quarter',
      'internal_id',
    );
  });

  it('rejects full-word internal-id prefixes: constraint_', () => {
    rejectsWith(
      gateAssumptionFragment,
      'constraint_budget_limit may need to flex if hiring runs hot in Q3 onwards',
      'internal_id',
    );
  });

  it('rejects full-word internal-id prefixes: decision_', () => {
    rejectsWith(
      gateAssumptionFragment,
      'decision_launch_path has not been re-validated since the last brief was edited',
      'internal_id',
    );
  });

  // ───── Premature-recommendation breadth (reviewer round-3 finding #3)
  it('rejects premature recommendation: best route', () => {
    rejectsWith(
      gateAssumptionFragment,
      'the best route here looks like hiring a senior tech lead before scaling up',
      'premature_recommendation',
    );
  });

  it('rejects premature recommendation: best path', () => {
    rejectsWith(
      gateAssumptionFragment,
      'the best path forward is to outsource delivery while keeping the lead in house',
      'premature_recommendation',
    );
  });

  it('rejects premature recommendation: you should choose', () => {
    rejectsWith(
      gateAssumptionFragment,
      'you should choose the partnership route given the synergy potential on the table',
      'premature_recommendation',
    );
  });

  it('rejects premature recommendation: I would choose', () => {
    rejectsWith(
      gateAssumptionFragment,
      'I would choose the build path here given the long-term margin profile of the team',
      'premature_recommendation',
    );
  });

  it('rejects premature recommendation: clear choice', () => {
    rejectsWith(
      gateAssumptionFragment,
      'this is a clear choice based on the cost profile of the alternative routes here',
      'premature_recommendation',
    );
  });

  it('rejects premature recommendation: strongest option', () => {
    rejectsWith(
      gateAssumptionFragment,
      'the strongest option here balances ramp risk against the speed-to-market upside',
      'premature_recommendation',
    );
  });

  it('rejects premature recommendation: most promising route', () => {
    rejectsWith(
      gateAssumptionFragment,
      'the most promising route is the partnership path given the deal terms in play',
      'premature_recommendation',
    );
  });

  // ───── Round-4: legitimate prefix-shaped domain compounds (per
  //               reviewer false-positive concern).
  //
  // The two-stage internal-id detection (broad candidate regex +
  // isSlugShapedEntityId confirmation) should NOT reject English
  // compounds that happen to start with a slug prefix. These are
  // commonly used domain terms — finance ("risk-adjusted"), scoping
  // ("out-of-scope"), economics ("option value"), planning
  // ("constraint-based"), statistics ("factor analysis").
  it('accepts a fragment containing risk_adjusted (legitimate finance compound)', () => {
    accepts(
      gateAssumptionFragment,
      'consider the risk_adjusted return profile across the routes before you commit',
    );
  });

  it('accepts a fragment containing out_of_scope (legitimate scoping phrase)', () => {
    accepts(
      gateAssumptionFragment,
      'the partner-only routes are out_of_scope for this phase of the rollout',
    );
  });

  it('accepts a fragment containing option_value (legitimate economics term)', () => {
    accepts(
      gateAssumptionFragment,
      'the option_value of waiting is non-trivial given current market timing',
    );
  });

  it('accepts a fragment containing constraint_based (legitimate planning compound)', () => {
    accepts(
      gateAssumptionFragment,
      'constraint_based planning may surface hidden trade-offs the brief omits',
    );
  });

  it('accepts a fragment containing factor_analysis (legitimate statistics compound)', () => {
    accepts(
      gateAssumptionFragment,
      'a factor_analysis on the driver set might highlight overlooked dependencies',
    );
  });

  it('still rejects IDs with digits (option_42)', () => {
    rejectsWith(
      gateAssumptionFragment,
      'option_42 is now the leading route in the comparison view across both teams',
      'internal_id',
    );
  });

  it('still rejects multi-segment IDs even when the prefix is ambiguous (decision_launch_now)', () => {
    // Multi-segment, first segment 'launch' length 6 ≥ 4 → confirmed ID
    // (the existing `decision_launch_path` test catches the same shape;
    // this variant pins that the heuristic depends on segment count
    // and length, not on the specific suffix word).
    rejectsWith(
      gateAssumptionFragment,
      'decision_launch_now has not been validated against the latest brief edits yet',
      'internal_id',
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

  it('accepts a response containing prefix-shaped domain compounds (risk_adjusted, option_value)', () => {
    // Both `risk_adjusted` (prefix=risk, single-segment suffix) and
    // `option_value` (prefix=option, single-segment suffix) are
    // English compounds. The two-stage gate uses
    // `isSlugShapedEntityId` to filter these out so legitimate
    // finance / economics vocabulary survives.
    const text =
      "I've built a decision model. The routes weigh option_value against risk_adjusted return, so one assumption worth checking is whether the longer time horizon is appropriate. Try running the analysis next to see how the options compare.";
    accepts(gateFullResponse, text);
  });

  // ───── Round-3 reviewer additions: graph-shape, breadth, markdown
  it('rejects a response with graph-shape language (nodes / edges)', () => {
    const text =
      "I've built a decision model with seven nodes and eight edges. The options weigh cost against risk. Next, run the analysis to validate the comparison across the routes.";
    rejectsWith(gateFullResponse, text, 'graph_shape');
  });

  it('rejects a response with bare "graph" wording', () => {
    const text =
      "I've built a graph for the launch decision. The options weigh delivery speed against quality risk in the routes. Next, run the analysis to compare the options.";
    rejectsWith(gateFullResponse, text, 'graph_shape');
  });

  it('rejects a response with "best route" premature recommendation', () => {
    const text =
      "I've built a decision model for the launch. The best route here is to hire a tech lead before scaling. Next, run the analysis to validate the assumptions across all options.";
    rejectsWith(gateFullResponse, text, 'premature_recommendation');
  });

  it('rejects a response with "you should choose" instruction', () => {
    const text =
      "I've built a decision model. You should choose the partnership path given the synergy potential and the risk profile in the comparison routes. Next, run the analysis to confirm.";
    rejectsWith(gateFullResponse, text, 'premature_recommendation');
  });

  it('rejects a response with full-word internal id (factor_*)', () => {
    const text =
      "I've built a decision model for the launch. The options weigh delivery speed against quality risk in factor_delivery_cost. Next, run the analysis to compare the options across routes.";
    rejectsWith(gateFullResponse, text, 'internal_id');
  });

  it('rejects a response with markdown bullets', () => {
    const text =
      "I've built a decision model. The options weigh delivery against risk:\n- Hire a tech lead\n- Hire two mid-weight developers\nNext, run the analysis to compare them and check the assumptions.";
    rejectsWith(gateFullResponse, text, 'markdown');
  });

  it('rejects a response with numbered-list formatting', () => {
    const text =
      "I've built a decision model. Consider the trade-offs:\n1. Cost\n2. Speed\n3. Quality\nNext, run the analysis to weigh the options against the routes.";
    rejectsWith(gateFullResponse, text, 'markdown');
  });

  it('rejects a response with markdown header formatting', () => {
    const text =
      "## Decision model\nI've built a model for the launch. The options weigh cost against risk in the routes. Next, run the analysis to compare them under the assumption set.";
    rejectsWith(gateFullResponse, text, 'markdown');
  });

  it('rejects a response longer than the tightened 800-char cap', () => {
    const text =
      "I've built a decision model for the launch. The options weigh delivery speed against quality risk in the routes. " +
      'a'.repeat(900) +
      ' Next, run the analysis to compare the options.';
    rejectsWith(gateFullResponse, text, 'too_long');
  });
});
