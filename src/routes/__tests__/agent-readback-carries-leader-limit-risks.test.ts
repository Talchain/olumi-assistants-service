/**
 * The Agent lane's read-back carries the selected run's leader-limit risks to the turn (R&C PR-8's carrier;
 * Canonical 5843920234 emits `analysis_leader_limit_risks` on the graph read, from the SAME fact and gates as
 * `analysis_constraint_verdict_state`). Only `null` or an array is carried; the card checks every element.
 */
import { describe, expect, it, vi } from 'vitest';
import { readBackState } from '../agent-v1-turn.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';

vi.mock('../../utils/telemetry.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/telemetry.js')>()),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

const SCENARIO = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const GRAPH = { nodes: [{ id: 'goal', kind: 'goal', label: 'Synthetic goal', goal_threshold: 0.7 }], edges: [] };
const HASH = computeAnalysisAffectingGraphHash(GRAPH as never)!;
const dispatchWith = (json: Record<string, unknown>) =>
  vi.fn(async () => ({ status: 200, json: { graph: GRAPH, graph_hash: HASH, ...json } }));

describe('readBackState carries analysis_leader_limit_risks as leaderLimitRisks', () => {
  it('⭐ an array reaches the turn verbatim, beside the verdict state', async () => {
    const risks = [{ constraint_id: 'agent-lane:monthly_churn:<=', probability: 0.62 }];
    const state = await readBackState(dispatchWith({ analysis_leader_limit_risks: risks, analysis_constraint_verdict_state: 'evaluated_feasible' }) as never, SCENARIO);
    expect(state.leaderLimitRisks).toEqual(risks);
    expect(state.constraintVerdictState).toBe('evaluated_feasible');
  });
  it('[] (nothing at risk) and null (no body) are carried as they are', async () => {
    expect((await readBackState(dispatchWith({ analysis_leader_limit_risks: [] }) as never, SCENARIO)).leaderLimitRisks).toEqual([]);
    expect((await readBackState(dispatchWith({ analysis_leader_limit_risks: null }) as never, SCENARIO)).leaderLimitRisks).toBeNull();
  });
  it('an absent key or a non-array value carries nothing', async () => {
    for (const json of [{}, { analysis_leader_limit_risks: 'x' }, { analysis_leader_limit_risks: { constraint_id: 'a' } }, { analysis_leader_limit_risks: 0.6 }]) {
      expect((await readBackState(dispatchWith(json) as never, SCENARIO)).leaderLimitRisks, JSON.stringify(json)).toBeUndefined();
    }
  });
});
