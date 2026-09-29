/**
 * ⛔ THE AGENT NEVER READS THE LIMITS-ONLY JOINT AS THE GOAL — first reply AND later turns (DL 5888327580; AIQ 5888295373).
 *
 * PLoT's `probability_of_joint_goal` is how often ALL the user's limits hold — never the goal's target. The Run persists
 * PLoT's bytes (handler ownership), so the Agent-facing projection is where it is renamed: the LIVE `run_analysis` result
 * (`analysisResultForAgent`) and, because history keeps THAT output, every later turn's kept copy.
 *
 * AIQ's served row 3 (Paul's MRR brief on 741eb64): "76% chance of BOTH £85k and churn < 5%" while the goal alone is 57% —
 * the joint (0.7591) is the churn limit only. Plus a real zero (P(goal) 0 present) and a withheld U (#416).
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { pruneSupersededToolOutputs } from '../history-store.js';
import { ALL_LIMITS_HOLD_NOTE } from '../decision-sensitivity.js';

type Json = Record<string, any>;
const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400e1', authenticated_user_id: null, request_id: 'r' };
const GRAPH = { nodes: [{ id: 'goal_mrr', kind: 'goal', label: 'MRR' }], edges: [] };
// The leader is permitted: the kept copy then keeps `result.enrichment` (the path the DL named).
const STATE = { run_state: { kind: 'complete_current', computed_at: '2026-09-29T10:20:00.000Z' }, leader_claim: { permitted: true } };
const READY_NAMED = { status: 'ready', analysis_admission: { admitted: true, permitted_analysis_mode: 'comparative_leader' } };

const ROW3 = [
  { option_id: 'raise_59', option_label: 'Raise to £59', win_probability: 0.6, probability_of_goal: 0.57, probability_of_joint_goal: 0.7591 },
  { option_id: 'raise_54', option_label: 'Raise to £54', win_probability: 0.3, probability_of_goal: 0, probability_of_joint_goal: 0.81 },
  { option_id: 'keep_49', option_label: 'Keep £49', win_probability: 0.1, probability_of_goal: 0, probability_of_joint_goal: 0.9 },
];
const BRIEF = { analysis_summary: { goal_fit: 0.7591, headline: 'x' } };

function world(enrichment: Json, state: Json = STATE) {
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: GRAPH, graph_hash: 'h1', analysis_state: state } };
    if (path === '/orchestrate/v2/turn') {
      return { status: 200, json: { assistant_text: '', analysis_state: state, analysis_ready: READY_NAMED,
        blocks: [{ type: 'analysis_result', summary: 's', computed_against_hash: 'a'.repeat(16), enrichment }] } };
    }
    throw new Error(`unexpected dispatch ${path}`);
  };
  return createAgentCapabilities(d, new ProposalStore());
}
const runOf = async (enrichment: Json, state?: Json): Promise<Json> => await world(enrichment, state).runAnalysis(ctx, { reason: 'Run it.' }) as Json;
const keptOf = (output: Json): Json => {
  const kept = pruneSupersededToolOutputs([
    { type: 'function_call', call_id: 'c1', name: 'run_analysis', arguments: '{}' },
    { type: 'function_call_output', call_id: 'c1', output: JSON.stringify(output) },
  ]) as Array<{ type: string; output?: string }>;
  return JSON.parse(kept.find((x) => x.type === 'function_call_output')!.output!) as Json;
};

describe('served row 3 (joint 0.7591 > P(goal) 0.57): the live result and the kept copy', () => {
  it('FIRST REPLY: P(goal) 0.57 stays the goal figure; the joint only as `all_limits_hold_probability`, with its note; no `goal_fit`', async () => {
    const r = await runOf({ option_comparison: ROW3, decision_brief: BRIEF });
    expect(r.claim_permissions.leader_may_be_named, 'precondition: a permitted Run').toBe(true);
    const rows = r.result.enrichment.option_comparison as Json[];
    expect(rows[0]).toEqual(expect.objectContaining({ probability_of_goal: 0.57, all_limits_hold_probability: 0.7591 }));
    expect(JSON.stringify(r)).not.toMatch(/probability_of_joint_goal|"goal_fit"/);
    expect(r.result.limits_note).toBe(ALL_LIMITS_HOLD_NOTE);
  });

  it('LATER TURNS: the kept copy of that permitted Run keeps the rename and the note — never the raw joint', async () => {
    const kept = keptOf(await runOf({ option_comparison: ROW3, decision_brief: BRIEF }));
    const rows = kept.result.enrichment.option_comparison as Json[];
    expect(rows[0].all_limits_hold_probability).toBe(0.7591);
    expect(JSON.stringify(kept)).not.toMatch(/probability_of_joint_goal|"goal_fit"/);
    expect(kept.result.limits_note).toBe(ALL_LIMITS_HOLD_NOTE);
  });

  it('a REAL ZERO: P(goal) 0 is present and stays the goal figure (0), beside its limits figure', async () => {
    const rows = (await runOf({ option_comparison: ROW3 })).result.enrichment.option_comparison as Json[];
    expect(rows[1]).toEqual(expect.objectContaining({ probability_of_goal: 0, all_limits_hold_probability: 0.81 }));
  });

  it('a WITHHELD U (#416): no P(goal) anywhere, the typed withhold survives, and the joint is still only a limits figure', async () => {
    const u = ROW3.map(({ probability_of_goal: _p, ...o }) => o);
    const warning = { code: 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', message: "Not shown. 'MRR' depends on price × subscribers, but this run couldn't calculate it that way.", node_ids: ['mrr'] };
    const r = await runOf({ option_comparison: u, inference_warnings: [warning] });
    expect(JSON.stringify(r.result)).not.toMatch(/probability_of_goal|probability_of_joint_goal/);
    expect((r.result.enrichment.option_comparison as Json[])[0].all_limits_hold_probability).toBe(0.7591);
    expect(r.goal_chance?.withheld).toBe(true);
    expect(JSON.stringify(keptOf(r))).not.toMatch(/probability_of_joint_goal/);
  });
});

// PR Review CR @ 0e1fd8c1: every option-result carrier `option-result-source.ts` reads, not only the current one.
const WITHHOLD = { code: 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', message: 'Not shown.', node_ids: ['mrr'] };
// A stale copy with a DISTINCT P(goal) (0.8317), a distinct stale win figure (0.6123) and the raw joint, in each legacy
// shape. Under the withhold the copy itself must be gone, not only its goal figures: 0.6123 is the discriminator.
const STALE = [
  { option_id: 'raise_59', label: 'Raise to £59', win_probability: 0.6123, probability_of_goal: 0.8317, probability_of_joint_goal: 0.7591 },
  { option_id: 'keep_49', label: 'Keep £49', win_probability: 0.3877, probability_of_goal: 0.1, probability_of_joint_goal: 0.9 },
];
const LEGACY_SHAPES: ReadonlyArray<readonly [string, Json]> = [
  ['results[]', { results: STALE }],
  ['results.options', { results: { option_comparison: [], options: STALE } }],
  ['results.option_results', { results: { option_results: STALE } }],
  ['decision_brief.options', { decision_brief: { headline: 'x', options: STALE } }],
];
const bothInputs = async (enrichment: Json): Promise<readonly [Json, Json]> => {
  const live = await runOf(enrichment);
  return [live, keptOf(live)];
};

describe('a withheld run (#416) with an EMPTY current carrier and a stale numeric copy: nothing reaches either Agent input', () => {
  for (const [shape, legacy] of LEGACY_SHAPES) {
    it(`${shape}: no withheld P(goal), no raw joint — live and kept`, async () => {
      const [live, kept] = await bothInputs({ option_comparison: [], inference_warnings: [WITHHOLD], ...legacy });
      expect(live.claim_permissions.leader_may_be_named, 'precondition: the permitted (kept-in-full) path').toBe(true);
      for (const [name, input] of [['live', live], ['kept', kept]] as const) {
        const text = JSON.stringify(input.result);
        expect(text, name).not.toMatch(/probability_of_goal|probability_of_joint_goal|0\.8317/);
        expect(text, `${name}: the stale copy itself is removed, not only its goal figures`).not.toMatch(/0\.6123/);
        expect(text, `${name}: the typed withhold itself survives`).toMatch(/GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED/);
      }
    });
  }

  it('a current row that still carried a P(goal) under the withhold loses it (fail closed); its limits figure is renamed', async () => {
    const [live, kept] = await bothInputs({ option_comparison: STALE, inference_warnings: [WITHHOLD] });
    for (const input of [live, kept]) {
      const rows = input.result.enrichment.option_comparison as Json[];
      expect(rows[0]).toEqual({ option_id: 'raise_59', label: 'Raise to £59', win_probability: 0.6123, all_limits_hold_probability: 0.7591 });
    }
  });
});

describe('CONTROL — no withhold: every legacy carrier is KEPT, its P(goal) intact and its joint renamed', () => {
  for (const [shape, legacy] of LEGACY_SHAPES) {
    it(`${shape}: P(goal) 0.8317 present; the joint only as all_limits_hold_probability`, async () => {
      const [live, kept] = await bothInputs({ option_comparison: ROW3, ...legacy });
      for (const input of [live, kept]) {
        const text = JSON.stringify(input.result);
        expect(text).toMatch(/"probability_of_goal":0\.8317/);
        expect(text, 'present control for the removal discriminator').toMatch(/0\.6123/);
        expect(text).not.toMatch(/probability_of_joint_goal/);
        expect(text).toMatch(/"all_limits_hold_probability":0\.7591/);
        expect(input.result.limits_note).toBe(ALL_LIMITS_HOLD_NOTE);
      }
    });
  }
});
