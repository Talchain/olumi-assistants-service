/**
 * ⛔ THE AGENT NEVER STATES A CHANCE OF REACHING THE GOAL THE RUN WITHHELD (MG's PLoT #416; AIQ 5886183999; DL 5885276225).
 *
 * PLoT #416 @ b1d32385 withholds `probability_of_goal` on every option when a declared identity on the goal's path was not
 * evaluated, and adds ONE warning built by its `goalIdentityWithheldMessage` — the exact shape and words below. The model
 * already received the run's enrichment, but no rule said what to say about the missing chance (code-read, 29 Sep): the
 * run result now carries `goal_chance` with the sentence and the rule.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { goalChanceWithheldForAgent, GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED } from '../goal-chance-withheld.js';
import { pruneSupersededToolOutputs } from '../history-store.js';

type Json = Record<string, any>;
const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400d1', authenticated_user_id: null, request_id: 'r' };
// PLoT #416's own words for Paul's MRR identity (goalIdentityWithheldMessage: product → " × ").
const PLOT_WORDS = "Not shown. 'MRR' depends on Pro plan price × Pro paying subscribers, but this run couldn't calculate it that way, "
  + 'so the figures for each option would be wrong.';
const WITHHELD_WARNING = { code: GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED, message: PLOT_WORDS, severity: 'warning', node_ids: ['mrr'] };
const GRAPH = { nodes: [{ id: 'goal_mrr', kind: 'goal', label: 'MRR' }], edges: [] };
const WITHHELD_ROWS = [{ option_id: 'raise_price', option_label: 'Raise price to £59' }, { option_id: 'hold_price', option_label: 'Hold price' }];
const SHOWN_ROWS = WITHHELD_ROWS.map((o, i) => ({ ...o, probability_of_goal: i === 0 ? 0.62 : 0.41 }));

function world(enrichment: Json, leader = { permitted: false, withheld_reason: 'constraint_verdict_withheld' }) {
  const state = { run_state: { kind: 'complete_current' }, leader_claim: leader };
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: GRAPH, graph_hash: 'h1', analysis_state: state } };
    if (path === '/orchestrate/v2/turn') {
      return { status: 200, json: { assistant_text: '', analysis_state: state, analysis_ready: { status: 'ready' },
        blocks: [{ type: 'analysis_result', summary: 's', enrichment }] } };
    }
    throw new Error(`unexpected dispatch ${path}`);
  };
  return createAgentCapabilities(d, new ProposalStore());
}

describe('run_analysis carries the run\'s withheld goal chance, with the sentence and the rule', () => {
  it('RED (PLoT #416\'s shape): every option withheld → `goal_chance` says why, in AIQ\'s words, and forbids any chance', async () => {
    const r = await world({ option_comparison: WITHHELD_ROWS, inference_warnings: [WITHHELD_WARNING] }).runAnalysis(ctx, { reason: 'Run it.' }) as Json;
    expect(r.goal_chance, JSON.stringify(Object.keys(r))).toEqual(expect.objectContaining({ withheld: true, node_ids: ['mrr'] }));
    // The reply's opening, then PLoT's reason verbatim (its UI-slot "Not shown." is not a sentence in a reply).
    expect(r.goal_chance.say).toBe("This run doesn’t show how often each option reaches the goal’s target. 'MRR' depends on Pro plan price × Pro paying "
      + "subscribers, but this run couldn't calculate it that way, so the figures for each option would be wrong.");
    expect(r.goal_chance.note).toMatch(/Never state, estimate, rank or compare a chance/);
    expect(r.goal_chance.note).toMatch(/estimated value for the goal itself/); // AIQ 5886183999: the means are the same class
  });

  it('CONTROL (Paul\'s evaluated MRR): no warning, chances present → no `goal_chance`, the run reads as today', async () => {
    const r = await world({ option_comparison: SHOWN_ROWS, inference_warnings: [] }, { permitted: true } as never).runAnalysis(ctx, { reason: 'Run it.' }) as Json;
    expect(r.ran).toBe(true);
    expect(r).not.toHaveProperty('goal_chance');
  });

  it('the TYPED code decides, never the words: other warnings → nothing; the code with no words → still withheld (fail closed)', () => {
    expect(goalChanceWithheldForAgent({ enrichment: { inference_warnings: [{ code: 'IDENTITY_NOT_EVALUATED', message: PLOT_WORDS }] } })).toBeUndefined();
    const bare = goalChanceWithheldForAgent({ enrichment: { inference_warnings: [{ code: GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED }] } });
    expect(bare).toEqual(expect.objectContaining({ withheld: true, say: 'This run doesn’t show how often each option reaches the goal’s target.', node_ids: [] }));
    // A chance beside the code is still withheld: the code is the run's decision.
    expect(goalChanceWithheldForAgent({ enrichment: { option_comparison: SHOWN_ROWS, inference_warnings: [WITHHELD_WARNING] } })?.withheld).toBe(true);
  });

  it('a KEPT withheld run (its warnings moved to the result\'s top) is read the same way', () => {
    expect(goalChanceWithheldForAgent({ summary: 's', inference_warnings: [WITHHELD_WARNING] })?.node_ids).toEqual(['mrr']);
  });

  it('LATER TURNS keep the rule only while the selected Run is confirmed current', async () => {
    const r = await world({ option_comparison: WITHHELD_ROWS, inference_warnings: [WITHHELD_WARNING] }).runAnalysis(ctx, { reason: 'Run it.' }) as Json;
    expect(r.claim_permissions?.leader_may_be_named).not.toBe(true); // precondition: the WITHHELD projection is the one used
    const stamp = 'aaaaaaaaaaaaaaaa';
    const computed_at = '2026-09-29T13:07:48.159Z';
    const run = { ...r, result: { ...r.result, computed_against_hash: stamp },
      run_identity: { scenario_id: ctx.scenario_id, graph_hash_at_run: stamp, computed_at } };
    const selectedRaw = { type: 'analysis_result', summary: 's', computed_against_hash: stamp,
      enrichment: { option_comparison: WITHHELD_ROWS, inference_warnings: [WITHHELD_WARNING] } };
    const history = [
      { type: 'function_call', call_id: 'c1', name: 'run_analysis', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c1', output: JSON.stringify(run) },
    ];
    const output = (items: readonly unknown[]) => JSON.parse((items[1] as { output: string }).output) as Json;
    const selected = { scenarioId: ctx.scenario_id,
      analysisState: { run_state: { kind: 'complete_current', computed_at },
        leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } },
      analysisReady: { status: 'ready' }, analysisResult: selectedRaw, graph: GRAPH };
    const current = pruneSupersededToolOutputs(history, [], selected);
    expect(output(current).goal_chance).toEqual(r.goal_chance);
    const changedVerdict = pruneSupersededToolOutputs(history, [], { ...selected,
      analysisState: { ...selected.analysisState,
        leader_claim: { permitted: false, withheld_reason: 'olumi_option_provisional' } } });
    expect(output(changedVerdict).stale).toBe(true);
    expect(output(changedVerdict).goal_chance).toBeUndefined();
    const unconfirmed = pruneSupersededToolOutputs(history);
    expect(output(unconfirmed).stale).toBe(true);
    expect(output(unconfirmed).goal_chance).toBeUndefined();
  });
});
