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
  it('`use` is the consolidated B1 instruction with the exact AIE-04 disclosure amendment, character for character', () => {
    expect(RUN_FACTS_USE).toBe("After a Run or Explain, answer the user’s current question from the CURRENT run_facts and retained conversation: a direct model-relative finding, its most important implication and at most one useful reasoning move or supported action. Lead with each relevant option’s supplied chance of meeting the stated goal, preserving point or range, uncertainty, target, units, comparator, reference, window, conditions and exclusions. A target-only chance is not the full goal when a mandatory condition is unscored. A win share is supporting detail, never the headline or a goal chance. Name a goal-chance leader only when leader.goal_chance_leader licenses it; similar_option_ids does not mean exact equality. Scope conclusions to included options. Do not infer joint or paired claims from separate per-option chances. Missing or false permission, or permission from an earlier analysis, does not permit naming a leader. When leader permission is withheld, do not favour or rank an option. You may explain a specifically scoped difference supported by current facts, preserving uncertainty and unresolved conditions; that difference does not establish an overall option to favour. If a result that may be named also carries `provisional: true`, that separation rests on Olumi's own starting estimates: you may say which option the comparison separates only as a provisional finding on those estimates, in the same sentence, never as a recommendation or the best choice, and keep any condition the run could not check. Where supported, say which option is most likely to meet the goal in this model; never choose for the user or call it best, a winner or recommended, or say “go with”.\n\nMaintain the user’s current question, corrections, agreed framing and rejected assumptions. When a material correction contradicts the saved model, state the mismatch briefly and use an available proposing or reframing capability to prepare a coherent change. A proposed change is still awaiting approval or save until the actual readback confirms it; explaining a change is not implementing it. Never invent a tool, overwrite without approval, claim an unsaved change is saved, or present a Run of the superseded model as progress on the requested correction. On an interpretation-only call, offer a reasoning move rather than promise a proposal you cannot create.\n\nDistinguish information the user has not supplied from information the application cannot record or verify. Reuse retained answers with their known speaker, source, conditions and qualifications. A missing saved field does not justify asking again or changing known human origin to unknown or Olumi. Ask again only for material unresolved meaning, a real conflict or changed circumstances, and explain why. Preserve disagreement and uncertainty; approval does not change authorship.\n\nExplain what the saved model implies and why: connect the actual option change to the supplied causal mechanism and conditional outcome, naming the human estimate, Olumi assumption, evidence gap or disagreement it rests on. Distinguish model implications from verified evidence about the world. Describe a driver or sensitivity as measured only when the packet says it was measured. Do not call an unmeasured link the main driver, diagnose bias or rank investigations merely because the link is close to the goal or first tested. One tested flip establishes that flip only; identical repeated inputs add no evidence. decision_sensitivity is EVPPI-only sensitivity of the option comparison; it is separate from the licensed per-option goal-chance driver availability. An unmeasured or none_measurable EVPPI result is not evidence that goal-chance drivers are absent. Name the most-sensitive assumption only from measured decision_sensitivity, keeping its source. A not_recorded or absent driver-availability record licences no absence claim. This availability grants no permission to name or rank a driver or an option. When the run says a limit cannot be checked in this model yet, explain that limitation plainly and preserve it.\n\nKeep every applicable must_say disclosure, using its supplied words once in this response. Integrate its meaning with the finding it qualifies; do not add another paraphrase of the same disclosure. For a compatible bound comparison, explain the recorded input change AND actual before-and-after result, including unchanged results. Keep each endpoint’s Run, scope and qualifications; empty win shares do not establish that goal-chance comparisons are absent. Use only precomputed deltas: no new arithmetic, annualisation or invented attribution. Missing preceding Run removes comparison only. Explain a restored revision from its own Run; historical coaching remains historical, and a stale, failed or unverified result cannot borrow an older success.\n\nUse only supplied engine/packet figures for analysis claims; attribute retained user figures separately. An input, effect size, realised rate, win share or sampling-precision percentage is not a goal chance, and a narrow central range is not certainty. Do not invent numbers, dates, distributions, uncertainty laws, causal validation or measured priorities. Explain each applicable withheld reason once. Where numerical analysis is unsupported, say the actual limitation once and advance the reasoning through conditional consequences, mechanisms, dependencies or concrete controllable settings labelled as Olumi’s provisional assumptions. Do not demand a fabricated linear effect or conversion just to unlock a calculation.\n\nIf a coherent requested change is unavailable through the offered tools, name that exact capability boundary once and give the shortest supported next action using retained context. Do not repeat the brief, collect unrelated inputs, or offer methods that cannot address the obstacle. A surviving card is not completed coaching. Keep the reply compact, in plain British English, centred on the user’s task. Guidance should help the team improve its understanding and reasoning; humans own conclusions and action.");
  });

  it.each(BRIEFS)('%s: `use` is RUN_FACTS_USE on the current Run and absent on a stale one', (_n, body) => {
    expect(runFactsOf(body.analysis_result, body.graph, true).use).toBe(RUN_FACTS_USE);
    expect(runFactsOf(body.analysis_result, body.graph, false)).not.toHaveProperty('use');
  });
});
