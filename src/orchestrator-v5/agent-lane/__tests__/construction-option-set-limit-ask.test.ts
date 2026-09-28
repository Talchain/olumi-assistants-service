/**
 * ⭐ A LIMIT ON A QUANTITY THE OPTIONS SET AT OLUMI'S FIGURES IS ASKED — ONE ASK PER LIMIT, NAMING THOSE FIGURES AND
 * TODAY'S LEVEL WHEN IT IS OLUMI'S (DL ruling #72 5865003207 §1; MG finding 5864956818, scope note 5865054192; the
 * sentence's one producer for Runtime's per-limit row, seam 5865068147).
 *
 * Served journey C (DL run `pj-20260928T063347Z`, `fixtures/served-journey-c-budget-limit-063347Z.json`): "at most
 * £30,000" on Total investment. "Features and Pro price" and "Additional advertising" SET it at Olumi's £20,000
 * (`cee_hypothesis`: the brief's "£20k" was the budget, not either option's spend); "Carry on as now" holds today's level,
 * Olumi's £0 (`cee_inference`). The limit was checked only against Olumi's figures (`estimate_only / level_olumi_estimate`)
 * and the final reply said it "was not checkable"; #2205's ask is silent on a quantity an option sets.
 *
 * The verdict is `scored` only on the user's OWN level of the quantity (`collectLimitLevelOwners`) AND the leader's own
 * setting (`collectLeaderEstimatedTargetIds`), so the one ask asks for both halves; the rows below bind that answering it
 * moves both inputs. Non-blocking: the ask is never written to the model, and admission is identical with or without it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { limitCheckAsks, limitedLevelAsks, optionSetLimitAsks } from '../limited-level-ask.js';
import {
  collectLeaderEstimatedTargetIds, collectLimitLevelOwners, readRatifiedConstraints,
} from '../../../orchestrator/context/constraint-feasibility.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(
  readFileSync(new URL('./fixtures/served-journey-c-budget-limit-063347Z.json', import.meta.url), 'utf8'),
) as { c02: Json; c10: Json };
const clone = <T>(x: T): T => structuredClone(x);
const LIMIT = 'agent-lane:total_investment:<=';
const CHURN = 'agent-lane:monthly_churn:<=';

const C10_ASK = 'What is "Total investment" today, and what would it be under "Features and Pro price" and "Additional advertising"? '
  + 'Your limit (at most £30,000 over 6 months) can only be checked against Olumi\'s figures (£0 over 6 months today, and '
  + '£20,000 over 6 months each under those options), not figures you gave, until you give yours.';

/** The served C10 graph with one option's (or the node's) figure made the user's own. */
function answered(g: Json, which: { today?: boolean; options?: readonly string[] }): Json {
  const out = clone(g);
  for (const n of out.nodes as Json[]) {
    if (which.today === true && n.id === 'total_investment') n.observed_state = { ...n.observed_state, source: 'user_override' };
    if (n.kind === 'option' && (which.options ?? []).includes(n.id) && n.interventions?.total_investment !== undefined) {
      n.interventions.total_investment = { ...n.interventions.total_investment, source: 'user_specified' };
    }
  }
  return out;
}
const OLUMI_SET = ['features_and_pro_price', 'additional_advertising'];

describe('RED — served journey C: ONE ask on the limit, naming Olumi\'s figures and today\'s level', () => {
  it('⭐ the final Run\'s graph (C10, £30,000): one typed ask, Olumi\'s two £20,000 figures with their unit, and today\'s £0', () => {
    expect(optionSetLimitAsks(SERVED.c10)).toEqual([{
      kind: 'option_set_limit_level', node_id: 'total_investment', quantity: 'Total investment', constraint_ids: [LIMIT],
      assumed: [
        { option: 'Features and Pro price', value: 20000, unit: 'GBP over 6 months' },
        { option: 'Additional advertising', value: 20000, unit: 'GBP over 6 months' },
      ],
      today: { value: 0, unit: 'GBP over 6 months' },
      question: C10_ASK,
    }]);
  });

  it('⭐ the build\'s graph (C02, £20,000): the same one ask, on the limit as it then stood', () => {
    const [ask] = optionSetLimitAsks(SERVED.c02);
    expect(ask!.question).toContain('Your limit (at most £20,000 over 6 months)');
    expect(ask!.constraint_ids).toEqual([LIMIT]);
  });

  it('⭐ ONE producer, per limit: `limitCheckAsks` joins each limit to its one sentence (Runtime quotes `question` verbatim)', () => {
    const rows = limitCheckAsks(SERVED.c10);
    expect(rows.map((r) => [r.constraint_id, r.kind])).toEqual([[CHURN, 'limited_quantity_level'], [LIMIT, 'option_set_limit_level']]);
    expect(rows.find((r) => r.constraint_id === LIMIT)!.question).toBe(C10_ASK);
    expect(rows.find((r) => r.constraint_id === CHURN)!.question).toBe(limitedLevelAsks(SERVED.c10)[0]!.question);
  });
});

describe('answering the ask moves the verdict\'s own inputs (the served proof, at the unit seam)', () => {
  const ratified = readRatifiedConstraints(SERVED.c10);
  it('PRECONDITION: both limits are ratified; today\'s level is Olumi\'s and the leader\'s £20,000 is Olumi\'s', () => {
    expect(ratified.map((c) => c.constraint_id).sort()).toEqual([LIMIT, CHURN].sort());
    expect(collectLimitLevelOwners(SERVED.c10, ratified).userBaselineIds.has(LIMIT)).toBe(false);
    expect(collectLeaderEstimatedTargetIds(SERVED.c10, ratified, 'features_and_pro_price').has(LIMIT)).toBe(true);
  });

  it('⭐ with today\'s level and the options\' spends the user\'s, both inputs move — and the ask is gone', () => {
    const g = answered(SERVED.c10, { today: true, options: OLUMI_SET });
    expect(collectLimitLevelOwners(g, ratified).userBaselineIds.has(LIMIT)).toBe(true);
    expect(collectLeaderEstimatedTargetIds(g, ratified, 'features_and_pro_price').has(LIMIT)).toBe(false);
    expect(optionSetLimitAsks(g)).toEqual([]);
  });

  it('a spend-only answer leaves today\'s level Olumi\'s, so the verdict cannot move: why the ONE ask asks for both halves up front', () => {
    const g = answered(SERVED.c10, { options: OLUMI_SET });
    expect(collectLimitLevelOwners(g, ratified).userBaselineIds.has(LIMIT)).toBe(false);
    // Named residual: with no option at Olumi's figure left, this ruling's trigger is gone, and #2205's ask skips a
    // quantity an option sets — so a spend-only answer leaves no ask for today's level. The ask up front is the mitigation.
    expect(optionSetLimitAsks(g)).toEqual([]);
  });
});

describe('the DL\'s conditions — each a RED row', () => {
  it('MUTANT PAIR: every option\'s figure the user\'s → no ask (with today\'s level still Olumi\'s, it is not this ask\'s trigger)', () => {
    expect(optionSetLimitAsks(answered(SERVED.c10, { options: OLUMI_SET }))).toEqual([]);
    expect(optionSetLimitAsks(answered(SERVED.c10, { options: ['features_and_pro_price'] }))).toHaveLength(1);
  });

  it('today\'s level the user\'s, the spends Olumi\'s → the ask names only Olumi\'s figures', () => {
    const [ask] = optionSetLimitAsks(answered(SERVED.c10, { today: true }));
    expect(ask).not.toHaveProperty('today');
    expect(ask!.question).toBe('What would "Total investment" be under "Features and Pro price" and "Additional advertising"? '
      + 'Your limit (at most £30,000 over 6 months) can only be checked against Olumi\'s assumed £20,000 over 6 months each '
      + 'under those options, not figures you gave, until you give yours.');
  });

  it('two DIFFERENT Olumi figures are each named with its option', () => {
    const g = clone(SERVED.c10);
    const adv = (g.nodes as Json[]).find((n) => n.id === 'additional_advertising')!;
    adv.interventions.total_investment = { ...adv.interventions.total_investment, raw_value: 15000, value: 0.3 };
    expect(optionSetLimitAsks(g)[0]!.question).toContain(
      '£20,000 over 6 months under "Features and Pro price" and £15,000 over 6 months under "Additional advertising"');
  });

  it('no level today at all → it says so, and still names Olumi\'s figures', () => {
    const g = clone(SERVED.c10);
    delete (g.nodes as Json[]).find((n) => n.id === 'total_investment')!.observed_state;
    const [ask] = optionSetLimitAsks(g);
    expect(ask!.today).toBeNull();
    expect(ask!.question).toContain('the model has no level for today, and Olumi assumed £20,000 over 6 months each under those options.');
  });

  it('a DELTA limit needs no level of its own → no ask', () => {
    const g = clone(SERVED.c10);
    g.goal_constraints = (g.goal_constraints as Json[]).map((c) => (c.constraint_id === LIMIT ? { ...c, value_frame: 'delta' } : c));
    expect(optionSetLimitAsks(g)).toEqual([]);
  });

  it('an Olumi figure with no level to say is never named; with none left there is no ask', () => {
    const g = clone(SERVED.c10);
    for (const id of OLUMI_SET) delete (g.nodes as Json[]).find((n) => n.id === id)!.interventions.total_investment.raw_value;
    expect(optionSetLimitAsks(g)).toEqual([]);
  });
});

describe('NON-BLOCKING — the ask is never written to the model, and admission is identical with or without it', () => {
  it('the run authority says the same thing about the served C10 graph whether or not the ask exists', () => {
    const withAsk = SERVED.c10;
    const withoutAsk = answered(SERVED.c10, { options: OLUMI_SET });
    expect(optionSetLimitAsks(withAsk)).toHaveLength(1);
    expect(optionSetLimitAsks(withoutAsk)).toHaveLength(0);
    const a = resolveRunAdmission(withAsk);
    const b = resolveRunAdmission(withoutAsk);
    expect(a.willProceed).toBe(b.willProceed);
    expect(a.assessment.blockingIssues.map((i) => i.code).sort()).toEqual(b.assessment.blockingIssues.map((i) => i.code).sort());
  });

  it('computing the ask never touches the graph it reads', () => {
    const g = clone(SERVED.c10);
    const before = JSON.stringify(g);
    limitCheckAsks(g);
    expect(JSON.stringify(g)).toBe(before);
  });
});
