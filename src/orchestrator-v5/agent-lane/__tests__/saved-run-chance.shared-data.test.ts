/**
 * W3 (DL #75 5902916137; AIQ 5902905975): the saved current Run's per-option goal chance reaches the Agent.
 *
 * Served signed-in witness on CEE `f074916` (scenario `520aab46`, cold re-sign-in): the Goal panel showed the £57
 * option at 25% while the Agent said its chance was "not confirmed in the saved result". The selected Run recorded
 * `probability_of_goal: 0.2469` and may name its leader; `saved_run_options` carried only the outcome range and the
 * 0/1 certainty decisions, and #2322 had removed the retained Run output that used to carry the rest.
 *
 * The fixture is that served cold read, trimmed to the read's analysis carriers (no brief text).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED } from '../goal-chance-withheld.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-w3-520aab46-cold-read-f074916.json', import.meta.url), 'utf8')) as Json;
const ctx = { scenario_id: '520aab46-9ed5-4819-9d7f-498d16603943', authenticated_user_id: null, request_id: 'saved-run-chance' };

async function canonicalState(read: Json): Promise<Json> {
  const dispatch: InternalDispatch = async (path) => path.endsWith('/graph') ? { status: 200, json: read } : { status: 500, json: {} };
  return createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState(ctx) as Promise<Json>;
}
const copy = (): Json => JSON.parse(JSON.stringify(SERVED)) as Json;
const rowsOf = (state: Json): Json[] => (state.analysis?.saved_run_options ?? []) as Json[];
const chanceOf = (state: Json, id: string): unknown => rowsOf(state).find((r) => r.option_id === id)?.probability_of_goal;

describe('W3: a saved current Run that may name its leader gives each option its recorded model chance', () => {
  it('the served fixture is the witnessed shape (positive control on the fixture itself)', () => {
    expect(SERVED.analysis_state.run_state.kind).toBe('complete_current');
    expect(SERVED.analysis_state.leader_claim.permitted).toBe(true);
    expect(SERVED.analysis_admission.permitted_analysis_mode).toBe('comparative_leader');
    const raw = SERVED.analysis_result.enrichment.option_comparison as Json[];
    expect(raw.find((r) => r.option_id === 'raise_to_59')?.probability_of_goal).toBe(0.2469);
  });

  it('served 520aab46: the £57 option carries 0.2469, beside its outcome range; exact zeros stay with goal_certainty only', async () => {
    const state = await canonicalState(copy());
    expect(chanceOf(state, 'raise_to_59')).toBe(0.2469);
    expect(rowsOf(state).find((r) => r.option_id === 'raise_to_59')?.outcome).toBeDefined();
    expect(chanceOf(state, 'keep_49_price')).toBeUndefined();
    expect(chanceOf(state, 'raise_to_54')).toBeUndefined();
    expect(state.analysis.goal_certainty.options.map((o: Json) => [o.option_id, o.probability_of_goal, o.earned]))
      .toEqual(expect.arrayContaining([['keep_49_price', 0, true], ['raise_to_54', 0, true]]));
  });

  it('a withheld leader keeps the standing drop of per-option chances', async () => {
    const read = copy();
    read.analysis_state.leader_claim = { permitted: false, withheld_reason: 'constraint_verdict_withheld' };
    const state = await canonicalState(read);
    expect(rowsOf(state).length).toBeGreaterThan(0);
    expect(rowsOf(state).some((r) => 'probability_of_goal' in r)).toBe(false);
  });

  it('no admission mode on the read is not permission (fail closed)', async () => {
    const read = copy();
    delete read.analysis_admission;
    const state = await canonicalState(read);
    expect(rowsOf(state).some((r) => 'probability_of_goal' in r)).toBe(false);
  });

  it('a Run whose goal figures PLoT #416 withheld gives the rule, and no chance or goal value', async () => {
    const read = copy();
    read.analysis_result.enrichment.inference_warnings = [
      { code: GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED, message: 'Not shown. MRR adds price and subscribers.', node_ids: ['goal'] },
    ];
    const state = await canonicalState(read);
    expect(state.analysis.goal_chance?.withheld).toBe(true);
    expect(rowsOf(state).some((r) => 'probability_of_goal' in r || 'outcome' in r)).toBe(false);
  });

  it('a stale Run gives no saved-Run chances at all', async () => {
    const read = copy();
    read.analysis_state.run_state.kind = 'complete_stale';
    const state = await canonicalState(read);
    expect(state.analysis.saved_run_options).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain('0.2469');
  });

  it('an exact 0 or 1 never travels as a row chance, only through its earned goal_certainty decision', async () => {
    const read = copy();
    for (const r of read.analysis_result.enrichment.option_comparison as Json[]) if (r.option_id === 'raise_to_59') r.probability_of_goal = 1;
    const state = await canonicalState(read);
    expect(chanceOf(state, 'raise_to_59')).toBeUndefined();
  });
});

describe('W3: the route says an interior chance is a recorded model chance (AIQ 5902935366)', () => {
  it('the saved-Run instruction reads a row chance as a model output, and keeps goal_certainty for exact 0/1 only', () => {
    // AGENT_INSTRUCTIONS is module-private; the line is read from the route source, as the estate's scanner tests do.
    const src = readFileSync(fileURLToPath(new URL('../../../routes/agent-v1-turn.ts', import.meta.url)), 'utf8');
    const lines = src.split('\n').filter((l) => l.includes('For a CURRENT saved Run'));
    expect(lines, 'control: exactly one saved-Run instruction line').toHaveLength(1);
    expect(lines[0]).toContain('recorded model chance, not a guarantee');
    expect(lines[0]).toContain('reaches the target in about N% of model runs');
    // AIQ 5903007662: the prompt is read by every journey, so its example carries no journey's figure.
    expect(lines[0]).not.toMatch(/\\u00a3\d|£\d|\b\d{2,3}(,\d{3})+\b|\b\d+% of model runs/);
    expect(lines[0]).toContain('For an exact 0 or 1, use only its projected goal_certainty');
    expect(lines[0]).not.toContain('For goal certainty, use only its projected goal_certainty');
  });
});
