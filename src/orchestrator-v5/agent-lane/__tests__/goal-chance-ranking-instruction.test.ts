/**
 * ⭐ D3 step 2, DL 0df0e1 ruling C (6 Oct): where each option's chance of meeting the goal reaches the model
 * (`saved_run_options[].probability_of_goal`, W3), so does the Run's own licence to compare them
 * (`analysis.goal_chance_licence`), and the model is told, typed, to compare only as that licence allows.
 * Fixture: the served W3 cold read (leader may be named), with CEE's licence record added the way run-analysis stores it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { GOAL_CHANCE_RANKING_INSTRUCTION } from '../../../routes/agent-v1-turn.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-w3-520aab46-cold-read-f074916.json', import.meta.url), 'utf8')) as Json;
const ctx = { scenario_id: '520aab46-9ed5-4819-9d7f-498d16603943', authenticated_user_id: null, request_id: 'goal-chance-ranking' };
const LICENCE = { code: 'GOAL_CHANCE_LICENSED', severity: 'info', message: 'licensed', form: 'similar',
  option_ids: ['keep_49_price', 'raise_to_54', 'raise_to_59'], pct_by_option: { keep_49_price: 44, raise_to_54: 48, raise_to_59: 25 },
  similar_option_ids: ['keep_49_price', 'raise_to_54'], target: { comparator: 'at_least', value: 20000, unit: '£' } };

async function canonicalState(read: Json): Promise<Json> {
  const dispatch: InternalDispatch = async (path) => path.endsWith('/graph') ? { status: 200, json: read } : { status: 500, json: {} };
  return createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState(ctx) as Promise<Json>;
}
const withLicence = (licence: Json | null): Json => {
  const read = JSON.parse(JSON.stringify(SERVED)) as Json;
  const e = read.analysis_result.enrichment;
  e.inference_warnings = [...(Array.isArray(e.inference_warnings) ? e.inference_warnings : []), ...(licence ? [licence] : [])];
  return read;
};

describe('ruling C: the model sees the Run\'s goal-chance licence beside the chances, and a typed rule', () => {
  it('a licensed Run: analysis.goal_chance_licence carries the form and ids (no percentages), beside the per-option chances', async () => {
    const state = await canonicalState(withLicence(LICENCE));
    expect(state.analysis.goal_chance_licence).toEqual({ form: 'similar', option_ids: LICENCE.option_ids,
      similar_option_ids: ['keep_49_price', 'raise_to_54'] });
    expect((state.analysis.saved_run_options as Json[]).some((r) => typeof r.probability_of_goal === 'number')).toBe(true);
  });

  it('CONTROL: no licence record on the Run → no goal_chance_licence (the rule then forbids any ranking by chance)', async () => {
    expect((await canonicalState(withLicence(null))).analysis).not.toHaveProperty('goal_chance_licence');
  });

  it('a withheld leader drops the chances (W3) — and the licence with them', async () => {
    const read = withLicence(LICENCE);
    read.analysis_state.leader_claim = { permitted: false, withheld_reason: 'constraint_verdict_withheld' };
    expect((await canonicalState(read)).analysis).not.toHaveProperty('goal_chance_licence');
  });

  it('the typed rule: the licence decides, "similar chances" below it, no ranking without it (c6 words)', () => {
    expect(GOAL_CHANCE_RANKING_INSTRUCTION).toContain('only as CURRENT MODEL STATE analysis.goal_chance_licence allows, never by your own reading of the figures');
    expect(GOAL_CHANCE_RANKING_INSTRUCTION).toContain('have similar chances of meeting the goal in this model; never say one is higher, ahead or more likely');
    expect(GOAL_CHANCE_RANKING_INSTRUCTION).toContain('or with no goal_chance_licence, give each option’s chance in its recorded order and never rank, order or single out options by it');
    expect(GOAL_CHANCE_RANKING_INSTRUCTION).not.toMatch(/\bbest\b|\bwinner\b|recommend/i);
  });
});
