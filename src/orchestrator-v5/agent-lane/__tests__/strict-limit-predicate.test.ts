import { describe, expect, it } from 'vitest';
import * as limitWords from '../limit-operator-words.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

type Operator = '<' | '<=' | '>' | '>=';
type Predicate = (level: number, operator: Operator, threshold: number) => boolean | 'at_threshold';
// Namespace lookup makes the missing shared predicate a RED assertion at the bound staging HEAD.
const predicate = (): Predicate => {
  expect(limitWords).toHaveProperty('meetsLimit');
  return (limitWords as unknown as { meetsLimit: Predicate }).meetsLimit;
};

describe('R6: one limit predicate, with the existing relative tie tolerance', () => {
  for (const [operator, below, at, above] of [
    ['<', true, 'at_threshold', false], ['<=', true, true, false],
    ['>', false, 'at_threshold', true], ['>=', false, true, true],
  ] as const) {
    it.each([[3.9, below], [4, at], [4.1, above]] as const)(`${operator} 4 at level %s`, (level, expected) => {
      expect(predicate()(level, operator, 4)).toBe(expected);
    });
  }
  it('tolerance: a float round-trip at the threshold is a tie for strict and inclusive operators', () => {
    expect(predicate()(4 + 2e-9, '<', 4)).toBe('at_threshold');
    expect(predicate()(4 + 2e-9, '<=', 4)).toBe(true);
    expect(predicate()(4 + 8e-9, '<=', 4)).toBe(false);
    expect(predicate()(0.04 - 5e-10, '<', 0.04)).toBe('at_threshold');
  });
  it('nonfinite inputs never establish that a limit is met', () => {
    for (const operator of ['<', '<=', '>', '>='] as const) {
      expect(predicate()(NaN, operator, 4)).toBe(false);
      expect(predicate()(4, operator, Infinity)).toBe(false);
    }
  });
});

const LIMIT_ID = 'agent-lane:monthly_churn_rate:<=';
async function modelLimit(level: number | undefined, operatorAsStated?: '<', frame = 'level', raw = level) {
  const graph = {
    nodes: [
      { id: 'goal_mrr', kind: 'goal', label: 'MRR' },
      { id: 'monthly_churn_rate', kind: 'factor', label: 'Monthly churn rate', scale_frame: 100,
        ...(level === undefined ? {} : { observed_state: { value: level / 100, raw_value: raw, unit: '%', source: 'user_override' } }) },
    ], edges: [],
    goal_constraints: [{ constraint_id: LIMIT_ID, node_id: 'monthly_churn_rate', label: 'Monthly churn rate',
      operator: '<=', ...(operatorAsStated === undefined ? {} : { operator_as_stated: operatorAsStated }),
      value: 4, unit: '%', value_frame: frame, provenance: 'explicit' }],
  };
  const dispatch: InternalDispatch = async () => ({ status: 200, json: { graph, graph_hash: 'h-strict' } });
  const result = await createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState({
    scenario_id: '632b92b9-82df-4a46-933f-3a64e49004bd', authenticated_user_id: null, request_id: 'strict-test',
  });
  expect(result.limits).toHaveLength(1);
  if (!Array.isArray(result.limits)) throw new Error('the model view did not carry limits');
  return result.limits[0] as Record<string, unknown>;
}

describe('R2/R4/R5: the reply reads a computed fact for the stored strict churn limit', () => {
  it('R2: keeping monthly churn UNDER 4% at today = 4% is at_threshold (not met)', async () => {
    const limit = await modelLimit(4, '<');
    expect(limit).toMatchObject({ operator: '<=', operator_as_stated: '<', today_within_limit: 'at_threshold' });
    expect(limit.today_within_limit_instruction).toMatch(/at_threshold.*does not meet/);
    expect(limit.today_within_limit_instruction).toMatch(/do no arithmetic/i);
  });
  it('R4: at most 4% includes today = 4%', async () => {
    expect(await modelLimit(4)).toMatchObject({ operator: '<=', today_within_limit: true });
  });
  it.each([[3.9, true], [4.1, false]] as const)('R5: under 4%% at today = %s agrees with the shared predicate', async (level, expected) => {
    expect((await modelLimit(level, '<')).today_within_limit).toBe(expected);
  });
  it('the reply uses the same normalized tolerance as analysis', async () => {
    expect((await modelLimit(4 - 5e-8, '<')).today_within_limit).toBe('at_threshold');
  });
  it('no current level, a change frame, or an unproven frame supplies no today fact', async () => {
    expect(await modelLimit(undefined, '<')).not.toHaveProperty('today_within_limit');
    expect(await modelLimit(4, '<', 'change_rel')).not.toHaveProperty('today_within_limit');
    expect(await modelLimit(4, '<', 'level', 40)).not.toHaveProperty('today_within_limit');
  });
});
