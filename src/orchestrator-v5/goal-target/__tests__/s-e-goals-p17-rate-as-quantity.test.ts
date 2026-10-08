/**
 * ⭐ S-E GOALS P17: a population rate written as a probability is a QUANTITY (Science ruling (b),
 * `inflight/science-393023-goals-rulings-20261007.md`). Rows are not the author's:
 *  · QUANTITY and CHANCE twins: the ruling's own rows, verbatim;
 *  · "churn probability": CEE's served drafter prompt names it as a unit example (`src/prompts/defaults-v19.ts:140`);
 *  · SERVED chance goals: every distinct (label, unit) goal pair whose unit names a chance, across the 109 captured
 *    staging/prod JSON files under `output/` (aggregate read, 7 Oct 21:5xZ). Each one must stay a chance.
 */
import { describe, expect, it, vi } from 'vitest';
import { readRateAsQuantity } from '../rate-as-quantity.js';
import * as rateClassifier from '../rate-as-quantity.js';
import { goalKindOf, rateUnitInPercent } from '../goal-kind.js';
import { readStatedGoalLevel } from '../../agent-lane/goal-current-level.js';
import { withholdGoalFiguresForChanceGoal } from '../../tools/handlers/run-analysis.js';
import { actionFactsOf } from '../../agent-lane/actions/state.js';
import { actionBarOf } from '../../agent-lane/actions/rank.js';
import { decidePress } from '../../agent-lane/actions/handlers.js';
import { placeholderGoalWarning, placeholderAskWords } from '../../agent-lane/goal-certainty.js';
import { decisionInputLines } from '../../agent-lane/decision-input-ask.js';
import { createAgentCapabilities, projectModelContext, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { modelGapOf } from '../../agent-lane/method-turn/widen-turn.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH } from '../../../orchestrator/context/option-result-source.js';
import { composeGoalTargetQuestion } from '../decide-goal-target-ask.js';

// Register every expected-chance corpus row for the fail-safe invariant below; keep the original table assertions too.
const chanceCorpus: { label?: string; goal_threshold_unit: string }[] = [];
const chanceTexts = <T extends readonly (string | readonly [string, number])[]>(rows: T): T => {
  chanceCorpus.push(...rows.map((row) => ({ goal_threshold_unit: typeof row === 'string' ? row : row[0] })));
  return rows;
};
const chanceGoals = <T extends readonly (readonly [string, string])[]>(rows: T): T => {
  chanceCorpus.push(...rows.map(([label, unit]) => ({ label, goal_threshold_unit: unit })));
  return rows;
};

// Independent review @ f4c458ad: verbatim one-off label/unit pairs, including the served probability (%) shape.
const REVIEW_CHANCE_ROWS = [
  ['T01', 'Probability of on-time delivery', '%'],
  ['T02', 'Chance we hit the Q3 launch', '%'],
  ['T11', 'Probability of on-time launch per current plan', '%'],
  ['T12', 'Q3 launch', '% probability of on-time launch per current plan'],
  ['T13', 'Probability of hitting every milestone', '%'],
  ['T14', 'Milestones', '% chance of hitting every milestone'],
  ['T15', 'Probability of delivering each milestone on time', '%'],
  ['T16', 'Delivery', '% probability of delivering each milestone on time'],
  ['T17', 'Chance the launch slips a month', '%'],
  ['T18', 'Launch', '% chance of the launch slipping a month'],
  ['T19', 'Chance the Q3 launch slips a month', 'probability (%)'],
  ['T20', 'Probability we close the Acme deal a quarter early', 'probability (%)'],
  ['T21', 'Probability our biggest customer churns', '%'],
  ['T22', 'Likelihood of regulatory approval per Gartner', '%'],
  ['T26', 'Chance the Acme contract renews', 'probability (%)'],
  ['T27', 'Success rate of the Q3 launch', 'probability (%)'],
  ['T28', 'Odds of shipping the platform by Q3', '%'],
  ['T30', 'On-time feature-launch probability', '%'],
  ['T32', 'Chance of winning the tender per bid team', '%'],
  ['T33', 'Probability the hire works out', '%'],
  ['U01', 'Probability our biggest customer churns', 'probability (%)'],
  ['U02', 'Probability the Acme lead converts', 'probability (%)'],
  ['U04', 'Probability the launch is delayed more than a month', 'probability (%)'],
  ['U05', 'Probability the launch is delayed more than a month', '%'],
  ['U06', 'Chance the migration takes a year', 'probability (%)'],
  ['U07', 'Likelihood the board approves the budget', '%'],
  ['U14', 'Probability we ship a week late', 'probability (%)'],
  ['U15', 'Probability the Q3 launch slips', 'probability (%)'],
  ['U16', 'Ship by Q3', '% chance the launch slips a quarter'],
  ['U17', 'Ship by Q3', '% probability of shipping a quarter late'],
] as const;

describe('independent review: user-terms safety', () => {
  it('INVARIANT: a one-off chance never becomes a level', () => {
    for (const [id, label, unit] of REVIEW_CHANCE_ROWS) {
      expect.soft(goalKindOf({ label, goal_threshold_unit: unit }), `${id}: ${label} measured in ${unit}`)
        .toBe('chance_of_event');
    }
  });

  it.each(REVIEW_CHANCE_ROWS)('%s CHANCE: %s measured in %s', (_id, label, unit) => {
    expect(goalKindOf({ label, goal_threshold_unit: unit })).toBe('chance_of_event');
  });
  it.each([
    ['T03', 'Monthly churn probability', '%'],
    ['T04', 'Customer churn probability per month', '%'],
    ['T06', 'Defect rate per release', '%'],
    ['T07', 'Likelihood a deal closes per quarter', '%'],
    ['T09', 'Uptime', '%'],
    ['T10', 'Market share', '%'],
    ['T23', 'Annual probability of a data breach', '%'], // Ruled level: annual hazard marker (rule 1).
    ['T24', 'Trial conversion probability', '%'],
    ['T29', 'Monthly churn rate', '%'],
    ['T34', 'Monthly churn', 'probability (%)'],
    ['T35', 'Probability the Acme deal closes', '% per quarter'],
    ['U03', 'Key account retention', 'probability (%)'], // Ruled level: population retention (rule 2).
    ['U08', 'Monthly probability of hitting target', '%'],
    ['U09', 'Probability a visitor converts', '%'],
    ['U10', 'Win rate', 'probability (%)'], // DL P2-D: nominal rate head, no one-off event.
    ['U11', 'Probability of churn', '%'],
    ['U12', 'Chance of a security incident a year', '%'], // Ruled level: annual hazard, not an event duration.
  ] as const)('%s LEVEL: %s measured in %s', (_id, label, unit) => {
    expect(goalKindOf({ label, goal_threshold_unit: unit })).toBe('level');
  });
  it.each([
    ['T08', 'Win probability per pitch', '%'], // Ambiguous: nominal event + per-noun; safe-direction rate withholding.
    ['T25', 'Probability a visitor signs up', '%'], // Ambiguous population act: keep the existing safe-direction miss.
    ['T31', 'Probability of on-time delivery for each release', '%'], // Ambiguous: rate or one-off chance; fail safe.
    ['U13', 'Probability of on-time delivery per project', '%'], // Ambiguous: rate or one-off chance; fail safe.
  ] as const)('%s AMBIGUOUS, fail-safe CHANCE: %s measured in %s', (_id, label, unit) => {
    expect(goalKindOf({ label, goal_threshold_unit: unit })).toBe('chance_of_event');
  });
  it('T05 pre-existing vocabulary gap: Risk of a data breach this year measured in %', () => {
    // Reviewer Expected=chance, but BASE and HEAD read level: "risk" is outside CHANCE_WORD and this fix's scope.
    expect(goalKindOf({ label: 'Risk of a data breach this year', goal_threshold_unit: '%' })).toBe('level');
  });
  it('a generic singular and possessive plural still describe population rates', () => {
    for (const label of ['Probability a customer churns', 'Probability our customers churn',
      'Probability my customers churn', 'Probability their customers churn', 'Probability your customers churn']) {
      expect(goalKindOf({ label, goal_threshold_unit: 'probability (%)' }), label).toBe('level');
    }
  });
  it('Win rate is a quantity under rule 1; the Q3 launch is an event even when called a success rate', () => {
    expect(readRateAsQuantity('Win rate')).toEqual({ kind: 'quantity', rule: 1 });
    expect(readRateAsQuantity('Success rate of the Q3 launch')).toEqual({ kind: 'chance', rule: 3 });
  });
});

describe('Science (b) rows: a rate is a quantity, a one-off event stays a chance', () => {
  it.each([
    ['churn probability', 2],
    ['monthly churn probability', 1],
    ['probability a customer churns each month', 1], // "each month": rule 1 comes first (buddy r1 P2)
    ['conversion probability per visitor', 1],
    ['the chance a trial user converts', 2],
  ] as const)('QUANTITY: %s (rule %i)', (text, rule) => {
    expect(readRateAsQuantity(text)).toEqual({ kind: 'quantity', rule });
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: text })).toBe('level');
  });
  it.each(chanceTexts([
    ['probability we hit the launch date', 3],
    ['chance of winning the Acme contract', 3],
    ['probability the hire works out', 3],
  ] as const))('CHANCE twin: %s (rule %i)', (text, rule) => {
    expect(readRateAsQuantity(text)).toEqual({ kind: 'chance', rule });
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: text })).toBe('chance_of_event');
  });
  it('rule 4: nothing to read keeps today’s fail-closed chance; "within a month" is a window, not a rate', () => {
    expect(readRateAsQuantity('probability (%)')).toEqual({ kind: 'chance', rule: 4 });
    expect(readRateAsQuantity('probability the migration finishes within a month')).toEqual({ kind: 'chance', rule: 3 });
    expect(readRateAsQuantity('probability the migration finishes, 3% a month')).toEqual({ kind: 'quantity', rule: 1 });
  });
  it('bounded: text over 400 characters is not read (rule 4), whatever it says', () => {
    expect(readRateAsQuantity(`churn probability${' '.repeat(400)}`)).toEqual({ kind: 'chance', rule: 4 });
    expect(readRateAsQuantity(`churn probability${' '.repeat(300)}`)).toEqual({ kind: 'quantity', rule: 2 });
  });
});

describe('the goal’s label is read with its unit (the drafter often writes the subject only in the label)', () => {
  it.each([
    ['Monthly churn', 'probability (%)'],
    ['Customer churn', '% probability'],
    ['Trial-to-paid conversion', 'probability (0–1)'],
  ])('QUANTITY: %s measured in %s', (label, unit) => {
    expect(goalKindOf({ kind: 'goal', label, goal_threshold_unit: unit })).toBe('level');
  });
  // SERVED: every distinct goal pair from the captured corpus (counts in comments).
  it.each(chanceGoals([
    ['ship the new platform by Q3', 'probability of shipping by Q3 (%)'], // 17
    ['Ship the new platform by Q3', 'probability (%)'], // 14
    ['ship the new platform by Q3', 'probability (%)'], // 11
    ['New platform shipment by Q3', 'probability (%)'], // 8
    ['ship the new platform', 'probability of shipment by Q3 (%)'], // 8
    ['ship the new platform', '% probability of shipping by Q3'], // 7
    ['ship the new platform', 'probability of shipping by Q3 (%)'], // 7
    ['ship the new platform by Q3', '% likelihood of shipping by Q3'], // 6
    ['ship the new platform by Q3', '% probability'], // 2
    ['ship the new platform by Q3', '% likelihood'], // 1
    ['ship the new platform by Q3', '% likelihood of shipment'], // 1
    ['meet our next feature-launch deadline', '% on-time probability'], // 1 (Paul's 6582edbc shape)
    ['New platform shipped by Q3', 'probability (0–1)'], // 1
  ] as const))('SERVED CHANCE stays a chance: %s measured in %s', (label, unit) => {
    expect(goalKindOf({ kind: 'goal', label, goal_threshold_unit: unit })).toBe('chance_of_event');
  });
});

describe('outside-corpus unsafe direction: a chance label with a bare percent unit', () => {
  it.each([
    ['On-time feature-launch probability', 'chance_of_event'], // RED before: a one-off chance was read as a level.
    ['Monthly churn probability', 'level'], // Science (b): rule 1 precedes rule 2 and either chance rule.
    ['Monthly churn', 'level'], // No chance word: today's quantity reading is unchanged.
    ['Conversion probability per visitor', 'level'], // Science (b): rule 1.
  ] as const)('%s measured in a bare percent → %s', (label, kind) => {
    expect(goalKindOf({ label, goal_threshold_unit: '%' })).toBe(kind);
  });
  it('the shared chance-word and bare-percent vocabularies keep their boundaries and quantity frames', () => {
    for (const word of ['probability', 'chance', 'likelihood', 'odds']) {
      for (const unit of ['%', 'percent', 'per cent', 'pct', 'percentage']) {
        expect(goalKindOf({ label: `On-time feature-launch ${word}`, goal_threshold_unit: unit })).toBe('chance_of_event');
      }
    }
    for (const unit of ['percentage points', '% of launch done', '% per month', '£', 'percentile']) {
      expect(goalKindOf({ label: 'On-time feature-launch probability', goal_threshold_unit: unit })).toBe('level');
    }
    for (const goal_threshold_frame of ['change_abs', 'change_rel']) {
      for (const label of ['Monthly churn probability', 'Monthly churn', 'Conversion probability per visitor']) {
        expect(goalKindOf({ label, goal_threshold_unit: '%', goal_threshold_frame })).toBe('change');
      }
    }
    expect(goalKindOf({ label: 'Launch unlikelihoodish', goal_threshold_unit: '%' })).toBe('level');
    expect(goalKindOf({ label: `churn probability ${'x'.repeat(1_000_000)}`, goal_threshold_unit: '%' })).toBe('chance_of_event');
  });

  // Every reader listed in #2780's body, including the action state's indirect ranker and press dispatcher.
  it.each(['Monthly churn probability', 'Monthly churn', 'Conversion probability per visitor'])(
    'all PR-body readers keep the bare-percent quantity paths: %s', async (label) => {
      const goal = { id: 'g', kind: 'goal', label, goal_threshold_unit: '%', goal_threshold_frame: 'level' };
      const graph = { goal_node_id: 'g', nodes: [goal,
        { id: 'f', kind: 'factor', label: 'Driver', observed_state: { value: 0.1, raw_value: 10, cap: 100, unit: '%', source: 'user_override' } },
        { id: 'a', kind: 'option', label: 'Change driver' }],
      edges: [{ from: 'f', to: 'g', strength: { mean: 0.5, std: 0.1 }, defaulted: true,
        provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } }] };
      const facts = actionFactsOf({ scenarioId: 'p17-control', graph, analysisReady: { status: 'ready', may_run: true } });
      expect(facts.goalKind).toBe('level');
      const bar = actionBarOf(facts);
      expect(bar.priority.map(o => o.action_id)).toContain('set_goal');
      expect(bar.priority.map(o => o.action_id)).not.toContain('set_deadline');
      const reply = decidePress({ id: 'act:frame_brief' }, facts, bar);
      expect(reply.kind).toBe('reply');
      if (reply.kind === 'reply') expect(reply.reply.text).toContain(composeGoalTargetQuestion());

      const links = [{ from: 'f', to: 'g' }];
      const warning = placeholderGoalWarning(graph, [{ option_id: 'a', links }], GOAL_FIGURES_PLACEHOLDER_PATH);
      expect(warning.first_ask).toEqual(expect.objectContaining({ kind: 'goal_level', node_id: 'g' }));
      expect(warning.acceptable_links).toEqual(links);
      expect(placeholderAskWords(graph, links)?.first).toEqual(expect.objectContaining({ kind: 'goal_level', node_id: 'g' }));
      expect(decisionInputLines(graph, { builtOrRan: true, awaitingApproval: false, restingText: '', questionsToggle: false })
        .join(' ')).toContain("I'll propose it as your target.");
      expect(modelGapOf(graph)).toEqual(expect.objectContaining({ kind: 'goal_target_missing', goal_id: 'g' }));
      expect(projectModelContext({ nodes: graph.nodes, edges: graph.edges, raw: graph, analysis_state: undefined })
        .goal).not.toHaveProperty('measured_as');
      const envelope = { option_comparison: [{ option_id: 'a', probability_of_goal: 0.4 }], inference_warnings: [] };
      expect(withholdGoalFiguresForChanceGoal(envelope, graph)).toBe(envelope);

      const before = JSON.stringify(graph);
      const dispatch: InternalDispatch = async (path) => {
        if (!path.endsWith('/graph')) throw new Error(`Unexpected write: ${path}`);
        return { status: 200, json: { graph, graph_hash: 'p17-control' } };
      };
      const caps = createAgentCapabilities(dispatch, new ProposalStore(), undefined, 'full');
      const text = `${label} should stay at most 3%.`;
      const ctx = { scenario_id: 'p17-control', authenticated_user_id: null, request_id: 'p17', user_text: text, user_turn_text: text };
      const target = await caps.proposeGoalTarget!(ctx, { constraint_type: 'at_most', value: 3, unit: '%', rationale: text });
      expect(target).toEqual(expect.objectContaining({ ok: true, mutated: false }));
      const today = `${label} is 5% today.`;
      const level = await caps.proposeGoalCurrentLevel!({ ...ctx, user_text: today, user_turn_text: today },
        { goal_label: label, value: 5, unit: '%', user_stated: true });
      expect(level).toEqual(expect.objectContaining({ ok: true, mutated: false }));
      expect(JSON.stringify(graph)).toBe(before);
    });
});

describe('Codex buddy r1 (#2780 @ 7ddad08b): event timing and everyday words never make a one-off event a rate', () => {
  it.each(chanceGoals([
    ['Launch a month from now', 'probability (%)'],
    ['Probability we win the open tender', 'probability (%)'],
    ['Return the deposit by Friday', 'probability (%)'],
    ['Default supplier delivers on time', 'probability (%)'],
  ] as const))('CHANCE: %s measured in %s', (label, unit) => {
    expect(goalKindOf({ kind: 'goal', label, goal_threshold_unit: unit })).toBe('chance_of_event');
  });
  it.each([
    ['probability of purchase each month', 1],
    ['default probability', 2],
    ['probability of default', 2],
    ['probability a customer returns', 2],
    ['the chance a visitor clicks through', 2],
  ] as const)('QUANTITY: %s (rule %i)', (text, rule) => {
    expect(readRateAsQuantity(text)).toEqual({ kind: 'quantity', rule });
  });
  it('a million-character label is bounded before the classifier reads each segment', () => {
    const read = vi.spyOn(rateClassifier, 'readRateAsQuantity');
    try {
      expect(goalKindOf({ kind: 'goal', label: `churn ${'x'.repeat(1_000_000)}`, goal_threshold_unit: 'probability (%)' })).toBe('chance_of_event');
      expect(read.mock.calls.map(([text]) => text.length)).toEqual([15, 401]);
    } finally {
      read.mockRestore();
    }
  });
});

describe('review r1: subjects and denominators are read within each segment, in Science (b) order', () => {
  it.each(chanceTexts([
    'chance we meet the churn target by Friday',
    'probability the open tender succeeds',
    'probability that the conversion target succeeds',
    '% likelihood of reaching our MRR target',
    '% likelihood of reaching our ARR target',
    'chance we meet the monthly revenue target',
    'probability the annual tender succeeds',
    'probability the customer experiences churn',
    'probability the plan limits churn',
  ]))('an event remains a chance: %s', (text) => {
    expect(readRateAsQuantity(text)).toEqual({ kind: 'chance', rule: 3 });
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: text })).toBe('chance_of_event');
  });
  it('bare probability and a command label never form a population subject across segments', () => {
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: 'probability', label: 'Return the deposit by Friday' })).toBe('chance_of_event');
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: 'probability of', label: 'Return the deposit by Friday' })).toBe('chance_of_event');
  });
  it.each(chanceTexts(['probability of a plan to cut churn', 'probability of return of the deposit', 'probability of open tender success']))(
    'a population word in an event is not its subject: %s', (text) => {
      expect(readRateAsQuantity(text).kind).toBe('chance');
    });
  it('a denominator requires a noun', () => {
    expect(readRateAsQuantity('probability per')).toEqual({ kind: 'chance', rule: 4 });
  });
  it('a period adjective on an event’s metric does not govern the probability', () => {
    const text = 'probability monthly revenue reaches target';
    expect(readRateAsQuantity(text).kind).toBe('chance');
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: 'probability', label: text })).toBe('chance_of_event');
  });
  it.each(chanceGoals(['The supplier defaults', 'The tender opens', 'The supplier churns'].map((label) => [label, 'probability'] as const)))(
    'a label’s verb is not a population subject: %s', (label) => {
      expect(goalKindOf({ kind: 'goal', goal_threshold_unit: 'probability', label })).toBe('chance_of_event');
    });
  it('a population member’s act keeps rule 2 without a chance word in the label', () => {
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: 'probability', label: 'Customer defaults' })).toBe('level');
  });
  it.each([
    'probability of repayment per loan',
    'probability of a failed payment per transaction',
    'probability of repayment for each loan',
    'probability of a failed payment every transaction',
    'probability of breakage per shipment',
    'probability of rejection for each application',
  ])('any repeated denominator fires rule 1: %s', (text) => {
    expect(readRateAsQuantity(text)).toEqual({ kind: 'quantity', rule: 1 });
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: text })).toBe('level');
  });
  it.each(['churn probability', 'probability of churn', 'probability of customer churn'])('the population noun is the subject: %s', (text) => {
    expect(readRateAsQuantity(text)).toEqual({ kind: 'quantity', rule: 2 });
  });
  it.each(['monthly churn probability', 'annual churn probability', 'churn probability a month', 'probability of churn per month',
    'probability of average monthly customer churn'])(
    'a real period marker fires rule 1: %s', (text) => {
      expect(readRateAsQuantity(text)).toEqual({ kind: 'quantity', rule: 1 });
    });
  it('rule 1 wins over an event in another segment; rule 2 cannot borrow a member from another segment', () => {
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: 'probability per loan', label: 'the tender succeeds' })).toBe('level');
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: 'probability of the customer', label: 'Return the deposit by Friday' })).toBe('chance_of_event');
  });
});

describe('percent scales use the existing unit readers without losing their denominators', () => {
  it.each(['probability (%) per month', 'probability (pct) per month', 'probability (per cent) per month', 'probability [0–100%] per month'])(
    '%s takes only the matching percent period', (unit) => {
      expect(rateUnitInPercent(unit, '% per month')).toBe('% per month');
      const goal = { label: 'Monthly churn', unit };
      expect(readStatedGoalLevel(5, '% per month', goal)).toEqual({ ok: true, raw: 5 });
      expect(readStatedGoalLevel(5, '% per year', goal)).toEqual(expect.objectContaining({ ok: false, refusal: 'unit_mismatch' }));
    });
  it('a per-unit percent denominator must also match', () => {
    const goal = { label: 'Repayment', unit: 'probability (%) per loan' };
    expect(readStatedGoalLevel(5, '% per loan', goal)).toEqual({ ok: true, raw: 5 });
    expect(readStatedGoalLevel(5, '% per transaction', goal)).toEqual(expect.objectContaining({ ok: false, refusal: 'unit_mismatch' }));
  });
  it.each(['probability (percentile) per month', 'probability (percentage points) per month', 'probability (0–1) per month'])(
    '%s does not invent a percent scale', (unit) => {
      expect(rateUnitInPercent(unit, '% per month')).toBeUndefined();
    });
});

describe('Codex buddy r2 (#2780 @ c0c84cfa): date offsets, subject-bound members, per-unit counts, plural click-throughs', () => {
  it.each([
    ['Launch a month after the funding round', 'probability (%)', 'chance_of_event'],
    ['Return the customer deposit by Friday', 'probability (%)', 'chance_of_event'],
    ['Visitor click-throughs', 'probability (%)', 'level'],
    ['Scoring chances created', 'chances the team creates per match', 'level'],
    ['Customer returns', 'probability (%)', 'level'],
  ])('%s measured in %s → %s', (label, unit, kind) => {
    expect(goalKindOf({ kind: 'goal', label, goal_threshold_unit: unit })).toBe(kind);
  });
});

describe('DL-approved r2 class: a non-period denominator cannot turn an event clause into a quantity', () => {
  it.each(chanceTexts([
    'chance the launch slips per management', // RED before: unsafe level (r2 @ f79abcc6).
    'probability the open tender succeeds per bid',
    'probability a customer churns per transaction',
    'probability that a loan defaults per loan',
    'chance we meet the churn target for each bid',
    'likelihood the supplier fails every transaction',
    'chance the teams win per management',
    'chance the launch went wrong per management',
    'probability suppliers fail per management',
    'probability of success if the launch slips per management',
    // Safe-direction re-pin: with a nominal event, "per <noun>" cannot be distinguished from "per <according-to>".
    'chance of winning per bid',
  ]))('CHANCE (rule 3): %s', (text) => {
    expect(readRateAsQuantity(text)).toEqual({ kind: 'chance', rule: 3 });
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: text })).toBe('chance_of_event');
  });
  it.each([
    'probability a customer churns per month',
    'probability that a loan defaults per year',
    'chance the launch slips each month',
    'chance the launch slips for each year',
    'probability of repayment per loan',
    'probability of a failed payment per transaction',
    'probability of a breach per year',
    'conversion probability per visitor',
    'probability per loan applications',
    'chance per high risk loans',
  ])('QUANTITY (rule 1): %s', (text) => {
    expect(readRateAsQuantity(text)).toEqual({ kind: 'quantity', rule: 1 });
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: text })).toBe('level');
  });
  it('FAIL-SAFE: every corpus row expected to be a chance stays a chance', () => {
    const otherChanceRows = [
      { goal_threshold_unit: 'probability (%)' },
      { goal_threshold_unit: 'probability the migration finishes within a month' },
      { label: `churn ${'x'.repeat(1_000_000)}`, goal_threshold_unit: 'probability (%)' },
      { label: 'Return the deposit by Friday', goal_threshold_unit: 'probability' },
      { label: 'Return the deposit by Friday', goal_threshold_unit: 'probability of' },
      { goal_threshold_unit: 'probability per' },
      { label: 'probability monthly revenue reaches target', goal_threshold_unit: 'probability' },
      { label: 'Return the deposit by Friday', goal_threshold_unit: 'probability of the customer' },
      { label: 'Launch a month after the funding round', goal_threshold_unit: 'probability (%)' },
      { label: 'Return the customer deposit by Friday', goal_threshold_unit: 'probability (%)' },
    ];
    for (const goal of [...chanceCorpus, ...otherChanceRows]) {
      expect(readRateAsQuantity(goal.goal_threshold_unit).kind, goal.goal_threshold_unit).toBe('chance');
      expect(goalKindOf({ kind: 'goal', ...goal }), JSON.stringify(goal).slice(0, 200)).toBe('chance_of_event');
    }
    // This row asserts only the reader's bound; an over-long unit is not admitted by unitNamesAChance.
    expect(readRateAsQuantity(`churn probability${' '.repeat(400)}`).kind).toBe('chance');
  });
});

describe('the Run (run-analysis withhold seam): a rate goal keeps its figures; a served event goal still withholds them', () => {
  const envelope = () => ({ option_comparison: [{ option_id: 'a', probability_of_goal: 0.4, outcome: { mean: 2.5, p10: 1, p90: 4 } }], inference_warnings: [] });
  const graph = (label: string, unit: string) => ({ nodes: [{ id: 'g', kind: 'goal', label, goal_threshold_unit: unit }] });
  it('RED on staging: "Monthly churn" in "probability (%)" was withheld as a chance; now the envelope is returned as is', () => {
    const e = envelope();
    expect(withholdGoalFiguresForChanceGoal(e, graph('Monthly churn', 'probability (%)'))).toBe(e);
  });
  it('CONTROL: the served "ship the new platform by Q3" in "probability (%)" is still withheld for every option', () => {
    const out = withholdGoalFiguresForChanceGoal(envelope(), graph('ship the new platform by Q3', 'probability (%)')) as { option_comparison: { probability_of_goal?: number }[] };
    expect(out.option_comparison[0]?.probability_of_goal).toBeUndefined();
  });
});
