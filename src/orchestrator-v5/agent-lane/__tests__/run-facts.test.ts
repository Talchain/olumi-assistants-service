/**
 * ⭐ S7 STEP 1 — the ONE Run-facts packet (arch12/7; DL 15 Oct): every AI call after a Run reads `run_facts` in canonical state,
 * built once from the owners' readers, typed, with the AIE's exact disclosures as `must_say`. Through the REAL
 * `get_canonical_state` on two served reads: capacity post3010 (a level goal) and marketing 7f5659fd (reopen).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { runFactsOf, RUN_FACTS_USE } from '../run-facts.js';
import { goalChanceFactsForAgent } from '../../goal-target/goal-chance-range-agent.js';
import { decisionSensitivityOf } from '../decision-sensitivity.js';
import { projectCanonicalAnalysisView } from '../../../routes/canonical-analysis-view.js';

type Rec = Record<string, any>;
const ctx = { scenario_id: '11111111-1111-1111-1111-111111111111', authenticated_user_id: 'user-a', request_id: 'req-1' };
const BRIEFS: readonly [string, Rec][] = [
  ['capacity post3010', (JSON.parse(readFileSync('tests/fixtures/zero-spread/served-capacity-post3010-read01-20261014.json', 'utf8')) as Rec).body],
  ['marketing 7f5659fd', JSON.parse(readFileSync('tests/fixtures/reply-face-p2/marketing-7f5659fd-reopen.json', 'utf8')) as Rec],
];
const read = async (body: Rec): Promise<Rec> => {
  const caps = createAgentCapabilities((async () => ({ status: 200, json: structuredClone(body) })) as never, new ProposalStore());
  const r = (await dispatchTool('get_canonical_state', '{}', ctx, caps)) as Rec;
  expect(r.ok).toBe(true);
  return r;
};
const warningsOf = (result: Rec): Rec[] => [...(result.enrichment?.inference_warnings ?? []), ...(result.inference_warnings ?? [])];

describe('S7 step 1: ONE Run-facts packet in canonical state, built from the owners’ readers', () => {
  it.each(BRIEFS)('%s: run_facts is THIS current Run’s chances, typed withheld reasons, sensitivity and the AIE’s disclosures', async (_n, body) => {
    const r = await read(body);
    const facts = r.run_facts as Rec;
    expect(facts.current).toBe(true);
    // The chances are the licence's own facts (the same builder both Agent doors read), never a second derivation.
    expect(facts.chances).toEqual(goalChanceFactsForAgent(body.analysis_result, body.graph, true));
    // Every GOAL_FIGURES_* record, typed: its code and options, and nothing invented.
    const recorded = warningsOf(body.analysis_result).filter((w) => String(w.code).startsWith('GOAL_FIGURES_'));
    expect((facts.withheld as Rec[]).map((w) => [w.code, w.option_ids])).toEqual(recorded.map((w) => [w.code, w.option_ids ?? []]));
    expect(facts.sensitivity.measured).toBe(decisionSensitivityOf(body.analysis_result.enrichment).status === 'measured');
    expect(facts.must_say).toEqual(facts.chances.goal_chance_notes ?? []);
    // Contrast: the packet carries something on each served Run.
    expect(Object.keys(facts.chances).length + facts.withheld.length).toBeGreaterThan(0);
  });

  it('a Run that is not current gives no current facts (never read as this model’s result)', () => {
    const [, body] = BRIEFS[0]!;
    const stale = runFactsOf(body.analysis_result, body.graph, false);
    expect(stale).toMatchObject({ current: false, chances: {}, withheld: [], sensitivity: { measured: false }, must_say: [] });
    expect(stale.leader).toMatchObject({ option_id: null, goal_chance_leader: null, similar_option_ids: [] });
    // Exactly no chance facts on either served Run when stale; contrast: the same Run, current, carries them.
    let carried = 0;
    for (const [, x] of BRIEFS) {
      const s = runFactsOf(x.analysis_result, x.graph, false);
      expect(s.chances).toEqual({});
      expect(s.olumi_inputs).toBeUndefined();
      carried += Object.keys(runFactsOf(x.analysis_result, x.graph, true).chances).length;
    }
    expect(carried).toBeGreaterThan(0);
  });

  it('hiring post3000 (a third brief): the count of Olumi’s inputs is THIS Run’s licence census, and a stale Run carries none', () => {
    const fx = JSON.parse(readFileSync('tests/fixtures/hiring-shortfall/served-hiring-post3000-run-turn17-20261014.json', 'utf8')) as Rec;
    const result = { enrichment: { inference_warnings: [structuredClone(fx.served_licence)] } };
    const l = fx.served_licence as Rec;
    expect(runFactsOf(result, fx.graph, true).olumi_inputs).toEqual({ links: l.olumi_estimate_link_count,
      values: l.olumi_estimate_value_count, settings_by_option: l.olumi_estimate_settings_by_option });
    expect(l.olumi_estimate_link_count).toBeGreaterThan(0);
    expect(runFactsOf(result, fx.graph, false).olumi_inputs).toBeUndefined();
    // The licence's disclosures are said exactly, in order: the provisional label among them.
    expect(runFactsOf(result, fx.graph, true).must_say).toEqual(l.notes);
  });

  it('the user’s recorded statements ride in the packet, verbatim', () => {
    const [, body] = BRIEFS[0]!;
    const g = structuredClone(body.graph);
    const goal = (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
    const quote = 'We measure capacity as tickets closed per week.';
    goal.user_statements = [{ subject_key: `goal|${goal.id}|||measure`, field: 'measure', recorded_at: '2026-10-15T01:00:00Z',
      statements: [{ speaker: 'user', quote, source: quote, subject: { quantity: 'measure', node_id: goal.id }, form: 'describes', reading: 'olumi' }] }];
    expect(runFactsOf(body.analysis_result, g, true).user_statements).toEqual([{ node_id: goal.id, field: 'measure', said: [quote] }]);
  });

  it.each(BRIEFS)('%s: the AI and the UI read the SAME leader facts (UI Q3): a withheld licence names no leader', async (_n, body) => {
    const r = await read(body);
    const leader = (r.run_facts as Rec).leader as Rec;
    expect(leader.licence).toBe('withheld');
    expect(leader.option_id).toBeNull();
    const view = projectCanonicalAnalysisView({ revision: 1, graph: body.graph,
      runFact: { fact_type: 'run_analysis', fact_version: 1, noop: false, result: { scenario_id: 's1', summary: '', run_id: 'run-1' } } as never,
      analysisState: body.analysis_state, analysisReady: body.analysis_ready, currentResult: body.analysis_result } as never);
    expect(view.leader).toEqual(leader);
    expect(view.leader_licence).toBe(leader.licence);
  });

  it('a withheld licence never names the Run’s leading option, even when the result carries one', () => {
    const [, body] = BRIEFS[1]!;
    const result = { ...structuredClone(body.analysis_result), leading_option_id: 'opt-x' };
    expect(runFactsOf(result, body.graph, true, { analysisState: body.analysis_state, analysisReady: body.analysis_ready }).leader)
      .toMatchObject({ licence: 'withheld', option_id: null });
  });

  it('a permitted licence names the Run’s leading option; the goal-chance leader comes only from the licence’s own form', () => {
    const [, body] = BRIEFS[1]!;
    const result = { ...structuredClone(body.analysis_result), leading_option_id: 'opt-x' };
    const state = { ...structuredClone(body.analysis_state), leader_claim: { permitted: true, separation: 'separated' } };
    const ready = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } };
    const facts = runFactsOf(result, body.graph, true, { analysisState: state, analysisReady: ready });
    expect(facts.leader.licence).not.toBe('withheld');
    expect(facts.leader.option_id).toBe('opt-x');
    expect(facts.leader.licence).toBe('permitted');
    expect(runFactsOf(result, body.graph, false, { analysisState: state, analysisReady: ready }).leader.option_id).toBeNull();
  });
});


describe('S7 PR-B: the packet says how the AI uses it, only beside a current Run', () => {
  it('`use` is the AIE’s EXACT text (#94 6183364243), character for character', () => {
    expect(RUN_FACTS_USE).toBe("These are the selected Run's own facts, bound to its revision and Run identity. Give goal chances only where chances licenses them, preserving the actual option, target, unit/reference/window, conditions and uncertainty. Do not relabel a win share, input, effect or sampling precision as goal chance. Explain each applicable withheld reason once and retain every required scope, exclusion and assumption disclosure. Use the supplied must_say wording once where it applies; do not repeat the same reason elsewhere. Name the option most likely to meet the goal only when leader.goal_chance_leader positively licenses that meaning and identity; where leader.similar_option_ids applies, describe the licensed similarity without implying exact equality. Never call an option best, a winner or recommended, or choose for the user. Where comparison is given, explain the actual change and recorded result from it alone, including an unchanged result when supplied. State the actual measured mechanism or sensitivity only where licensed; graph proximity is not a driver. Reuse retained human statements with their source, qualifications and unresolved binding, and give at most one justified next reasoning step. Do not invent figures, dates, laws or missing facts. If required grounding or a valid reply cannot be retained, coaching is incomplete; do not borrow another Run or treat a surviving card as completed coaching.");
  });

  it.each(BRIEFS)('%s: `use` is RUN_FACTS_USE on the current Run and absent on a stale one', (_n, body) => {
    expect(runFactsOf(body.analysis_result, body.graph, true).use).toBe(RUN_FACTS_USE);
    expect(runFactsOf(body.analysis_result, body.graph, false)).not.toHaveProperty('use');
  });
});
