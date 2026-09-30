/**
 * ⛔ THE PROVISIONAL CAVEAT NAMES THE ADMISSION'S OWN CAUSE, re-read every turn (Canvas #13, traced MG #75 5912728111;
 * words AIQ 5912754596).
 *
 * The caveat was one constant: "These figures are provisional: every estimate behind them is machine-authored and
 * unconfirmed." It was appended whenever the mode was `quantified_provisional`, but that mode has more than one cause
 * (`semanticVerdictCause`). On Paul's run, after his own 0.55 and 0.3 were in the model, the cause was
 * `user_stated_not_material`, and six consecutive replies still told him every estimate was machine-authored.
 *
 * Every verdict here is the REAL admission (`resolveAnalysisAdmission`) on one served capture, so the caveat reads the
 * producer's own `reasons[]`, not a hand-written payload.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OlumiResponseSchema, type OlumiResponse } from '@talchain/schemas/boundary';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';

import { buildAnalysisResultBlock } from '../../compose.js';

import { resolveAnalysisAdmission } from '../../admission/analysis-admission.js';
import { dropRankingSentences } from '../../agent-lane/withheld-leader-fail-closed.js';
import { enforceLeadingOptionClaimsAtWire } from '../leading-option-wire-enforcement.js';

/** Paul's own served MRR draft (`cbd15f83`, CEE `bdd43f4`): his £49 is the level two options change. */
const PAUL_DRAFT = 'src/orchestrator-v5/coaching/__tests__/fixtures/cbd15f83-bdd43f4-paul.draft-graph.json';
const paulDraft = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify((JSON.parse(readFileSync(PAUL_DRAFT, 'utf8')) as { graph: unknown }).graph)) as Record<string, unknown>;
const nodeOf = (graph: Record<string, unknown>, id: string): Record<string, any> => {
  const found = (graph.nodes as Record<string, unknown>[]).find((n) => n.id === id);
  if (!found) throw new Error(`fixture drift: ${id} is absent from ${PAUL_DRAFT}`);
  return found;
};

/**
 * One conversation, three turns. On turn 3 the draft is exactly as served; turns 1–2 have the user's £49 and 29.5% as
 * Olumi's own estimates. The user's 0.3 sits on a RISK, which never reaches the ordering (PLoT sends no parameter
 * uncertainty for a risk; `analysis-admission.test.ts` "the same for a RISK").
 */
function allOlumi(): Record<string, unknown> {
  const g = paulDraft();
  nodeOf(g, 'pro_plan_price').observed_state.source = 'cee_inference';
  nodeOf(g, 'raise_to_59_at_release').interventions.pro_plan_price.source = 'cee_hypothesis';
  return g;
}
function userSetOffPath(): Record<string, unknown> {
  const g = allOlumi();
  nodeOf(g, 'price_sensitivity').observed_state = { value: 0.3, source: 'user' };
  return g;
}
function userSetOnPath(): Record<string, unknown> {
  const g = paulDraft();
  nodeOf(g, 'price_sensitivity').observed_state = { value: 0.3, source: 'user' };
  return g;
}
const readinessOf = (graph: Record<string, unknown>) => ({ analysis_admission: resolveAnalysisAdmission(graph) });

const TODAY = 'These figures are provisional: every estimate behind them is machine-authored and unconfirmed.';
const AIQ_NOT_MATERIAL =
  'Your own estimates are in the model, but none of them sits on the path that decides this comparison, so these figures are still provisional.';
const NEUTRAL = 'These figures are provisional.';
const SECOND = 'A share of runs in which an option fitted your goal better than the others is not the chance of reaching your target.';

const ANSWER = 'Adopt RudderStack fitted your goal better in 55% of runs, Adopt Segment in 36%.';
/** The REAL block producer, from a schema-parsed run fact (the idiom of separable-provisional-composed-response). */
const runBlock = () => buildAnalysisResultBlock(RunAnalysisHandlerFactSchema.parse({
  fact_type: 'run_analysis',
  fact_version: 1,
  noop: false,
  result: {
    scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    graph_hash_at_run: 'e6aceffe33a51baf',
    computed_at: '2026-09-30T14:00:00.000Z',
    leading_option_id: 'option-a',
    summary: ANSWER,
    win_probabilities: { 'option-a': 0.55, 'option-b': 0.36 },
    constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
  },
}));
function envelope(): OlumiResponse {
  return OlumiResponseSchema.parse({
    response_version: 2,
    assistant_text: ANSWER,
    blocks: [runBlock()],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'analyse',
  });
}
function turn(analysisReady: unknown): { text: string; summary: string } {
  const out = enforceLeadingOptionClaimsAtWire(envelope(), {
    requestId: 'provisional-caveat-cause',
    exitPath: 'run_analysis',
    graph: undefined,
    mayNameLeadingOption: true,
    separationEstablished: true,
    analysisReady,
  }).response;
  const block = out.blocks.find((b) => (b as { type?: unknown }).type === 'analysis_result') as { summary: string };
  return { text: String(out.assistant_text), summary: block.summary };
}

describe('the provisional caveat says the admission’s own cause (Canvas #13)', () => {
  it('PRECONDITION: the three graphs really are the three cells', () => {
    const codes = (g: Record<string, unknown>) => resolveAnalysisAdmission(g).reasons
      .filter((r) => r.field === 'semantic_quality_sufficient').map((r) => r.code);
    expect(resolveAnalysisAdmission(allOlumi()).permitted_analysis_mode).toBe('quantified_provisional');
    expect(codes(allOlumi())).toEqual(['CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED']);
    expect(resolveAnalysisAdmission(userSetOffPath()).permitted_analysis_mode).toBe('quantified_provisional');
    expect(codes(userSetOffPath())).toEqual(['USER_STATED_PARAMETERS_NOT_MATERIAL']);
    expect(resolveAnalysisAdmission(userSetOnPath()).permitted_analysis_mode).toBe('comparative_leader');
  });

  it('row 1: an all-Olumi model keeps today’s words, on the answer and the summary', () => {
    const t = turn(readinessOf(allOlumi()));
    for (const surface of [t.text, t.summary]) expect(surface).toBe(`${TODAY} ${SECOND}\n\n${ANSWER}`);
  });

  it('RED row 2: after the user sets values off the decision’s path, nothing says “machine-authored”', () => {
    const t = turn(readinessOf(userSetOffPath()));
    for (const surface of [t.text, t.summary]) {
      expect(surface).toBe(`${AIQ_NOT_MATERIAL} ${SECOND}\n\n${ANSWER}`);
      expect(surface).not.toMatch(/machine-authored/);
    }
  });

  it('RED row 3: the cause is re-read every turn and never carried forward', () => {
    const conversation = [allOlumi(), userSetOffPath(), userSetOnPath()].map((g) => turn(readinessOf(g)));
    expect(conversation[0]!.text).toContain(TODAY);
    expect(conversation[1]!.text, 'turn 2 drops the authorship sentence').not.toMatch(/machine-authored/);
    // Once an estimate IS on the path, the admission licenses the comparison and no caveat is added at all.
    expect(conversation[2]!.text).toBe(ANSWER);
    expect(conversation[2]!.summary).toBe(ANSWER);
  });

  it('RED: with no cause on the payload, the caveat is neutral and never names an author', () => {
    const t = turn({ analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'quantified_provisional' } });
    expect(t.text).toBe(`${NEUTRAL} ${SECOND}\n\n${ANSWER}`);
    expect(t.text).not.toMatch(/machine-authored|your own estimates/i);
  });

  it('the neutral fallback quotes the admission’s own reason only for a cause that can make the mode provisional', () => {
    const payload = (code: string) => ({ analysis_admission: { permitted_analysis_mode: 'quantified_provisional', reasons: [
      { field: 'semantic_quality_sufficient', code, message: 'a payload’s own words are never quoted' }] } });
    expect(turn(payload('NO_COMPARISON_SUBSTRATE')).text).toBe(`${NEUTRAL} ` +
      `Nothing in this model connects the options to your goal, so there is no comparison to draw a leader from. ${SECOND}\n\n${ANSWER}`);
    // Inconsistent with the provisional mode (it makes the mode comparative_leader), so neutral alone.
    expect(turn(payload('CONFIDENCE_PARAMETERS_PARTLY_USER_STATED')).text).toBe(`${NEUTRAL} ${SECOND}\n\n${ANSWER}`);
    expect(turn(payload('SOMETHING_NEW')).text).toBe(`${NEUTRAL} ${SECOND}\n\n${ANSWER}`);
  });

  it('row 4 (control): the second sentence is unchanged whatever the cause', () => {
    for (const g of [allOlumi(), userSetOffPath()]) expect(turn(readinessOf(g)).text.includes(` ${SECOND}\n\n${ANSWER}`)).toBe(true);
  });

  it('idempotent: a caveated answer is not caveated twice', () => {
    const readiness = readinessOf(userSetOffPath());
    const once = turn(readiness).text;
    const again = enforceLeadingOptionClaimsAtWire({ ...envelope(), assistant_text: once } as OlumiResponse, {
      requestId: 'provisional-caveat-cause', exitPath: 'run_analysis', graph: undefined, mayNameLeadingOption: true, separationEstablished: true, analysisReady: readiness,
    }).response.assistant_text;
    expect(again).toBe(once);
  });

  it('the Agent lane keeps every cause’s caveat (server sentences are protected by identity)', () => {
    const caveatOf = (text: string) => `Kept.\n\n${text.slice(0, text.length - ANSWER.length).trim()}`;
    const neutral = turn({ analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'quantified_provisional' } }).text;
    for (const text of [turn(readinessOf(allOlumi())).text, turn(readinessOf(userSetOffPath())).text, neutral]) {
      expect(dropRankingSentences(caveatOf(text)).droppedSentences).toBe(0);
    }
  });
});
