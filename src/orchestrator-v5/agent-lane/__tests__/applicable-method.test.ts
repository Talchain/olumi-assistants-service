/**
 * ⭐ The Agent can ask Olumi's deterministic method gate which reasoning technique the
 * latest analysis calls for, and why (applicable-method.ts).
 *
 * ⛔ NOT HAND-WRITTEN FACTS. `served-run-analysis-fact.json` is the newest completed
 * `run_analysis` fact persisted in `v5_handler_facts` for a served OpenAI-route witness
 * scenario (74f8c4cb, 23 Sep 09:03Z, the witness user's own); `-refused.json` is the
 * refused run on served 553254d (d99f3ca9, the #1710 goal regression). Both are the
 * row's `payload` column; `hydrate` rejoins its `noop` column and strict-parses it,
 * exactly as `readScenarioRunAnalysisFactsFor` does. Neither carries an email or user id.
 *
 * The one DERIVED fact (`firmerRerun`) is the #1731 reviewer's B1 case, built from the
 * served fact by changing ONLY the fields the review lists: the win probabilities
 * (leader 0.78), robustness `high` and its near-tie gap, factor confidence 0.9,
 * confidence tier `strong`, a new hash and timestamp.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { HandlerFactSchema, type HandlerFact, type RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { applicableMethod, APPLICABLE_METHOD_FACT_WINDOW, METHOD_OPENING_GUIDANCE, type RunAnalysisFactPage } from '../runtime/applicable-method.js';
import { AGENT_TOOLS, MUTATION_TOOLS, dispatchTool, toolsFor } from '../runtime/agent-tools.js';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { runAgentTurn } from '../runtime/agent-loop.js';
import { ProposalStore } from '../proposal.js';
import { rankInterventions } from '../../compose/lens-selector.js';
import { derivePreviousAnalysisLens } from '../../compose/lens-history.js';
import { liveLensExecutorAvailability } from '../../compose/phase3-blocks.js';
import { loadVerifiedDskBundle } from '../../compose/dsk-bundle-record.js';
import { SessionReadError } from '../../session/store.js';
import type { DSKProtocol } from '../../../dsk/types.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;
/** The store's hydration: `payload` + its own `noop` column, strict-parsed. */
const hydrate = (payload: Record<string, unknown>) => HandlerFactSchema.parse({ ...payload, noop: false }) as RunAnalysisHandlerFact;
const SERVED = hydrate(fixture('served-run-analysis-fact.json'));
const REFUSED = hydrate(fixture('served-run-analysis-fact-refused.json'));

type Enr = {
  option_comparison: { option_id: string; option_label: string; win_probability: number }[];
  robustness: { level: string; near_tie: { gap: number } };
  factor_sensitivity: { confidence: number }[];
  confidence_tier: string;
  factor_evppi: { status: string; evppi: number }[];
};
type Res = { enrichment: Enr; leading_option_id: string; win_probabilities: Record<string, number>; graph_hash_at_run: string; computed_at: string };
const res = (f: HandlerFact) => f.result as unknown as Res;

/** The reviewer's firmer rerun, derived from the served fact (see header). */
function firmerRerun(served: RunAnalysisHandlerFact): RunAnalysisHandlerFact {
  const f = structuredClone(served);
  const r = res(f);
  const e = r.enrichment;
  const others = e.option_comparison.filter((o) => o.option_id !== r.leading_option_id);
  const othersTotal = others.reduce((a, o) => a + o.win_probability, 0);
  for (const o of e.option_comparison) {
    o.win_probability = o.option_id === r.leading_option_id ? 0.78 : (o.win_probability * 0.22) / othersTotal;
    r.win_probabilities[o.option_label] = o.win_probability;
  }
  e.robustness.level = 'high';
  e.robustness.near_tie.gap = 0.78 - Math.max(...others.map((o) => o.win_probability));
  for (const s of e.factor_sensitivity) s.confidence = 0.9;
  e.confidence_tier = 'strong';
  r.graph_hash_at_run = 'f1e2d3c4b5a69788';
  r.computed_at = '2026-09-23T09:20:00.000Z';
  return HandlerFactSchema.parse(f) as RunAnalysisHandlerFact;
}
const RERUN = firmerRerun(SERVED);

/** A `readScenarioRunAnalysisFactsFor` double: newest first, like the store. */
const pageOf = (...facts: HandlerFact[]): RunAnalysisFactPage => ({
  facts: facts.map((fact, i) => ({ fact, fact_row_id: `row-${i}`, fact_created_at: res(fact).computed_at })),
  total_count: facts.length,
});
const readerOf = (...facts: HandlerFact[]) => vi.fn(async (_sid: string, _limit: number) => pageOf(...facts));

const AVAIL = liveLensExecutorAvailability();
/** The conventional route's derivation (`compose.ts` → `phase3-blocks.ts`), for the same facts. */
const conventional = (newest: RunAnalysisHandlerFact, prior: HandlerFact[]) =>
  rankInterventions(newest, { ...AVAIL, previousAnalysisLens: derivePreviousAnalysisLens(prior, AVAIL) });

type Method = { id: string; title: string; why: string; how_to_open: string; science: { protocol_id: string; evidence_strength: unknown; closing_questions: string[]; expected_outputs?: string[]; steps?: unknown } | null };
const methodOf = (r: Record<string, unknown>) => r.method as Method;

describe('the method gate, over real served facts', () => {
  it('vacuity: the fixtures are the served facts they claim to be, and the rerun is the reviewer’s', () => {
    expect(SERVED.fact_type).toBe('run_analysis');
    expect((SERVED.result as { enrichment?: { analysis_status?: string } }).enrichment?.analysis_status).not.toBe('refused');
    expect((REFUSED.result as { enrichment?: { analysis_status?: string } }).enrichment?.analysis_status).toBe('refused');
    const lead = res(RERUN).enrichment.option_comparison.find((o) => o.option_id === res(RERUN).leading_option_id);
    expect(lead?.win_probability).toBe(0.78);
    expect(res(RERUN).enrichment.confidence_tier).toBe('strong');
    expect(res(RERUN).graph_hash_at_run).not.toBe(res(SERVED).graph_hash_at_run);
  });

  it('RED: a completed served analysis yields the gate’s own method, title and reason', async () => {
    const r = await applicableMethod(readerOf(SERVED), 'scenario');
    expect(r.ok).toBe(true);
    expect(r.mutated).toBe(false);
    const m = methodOf(r);
    expect(m.id).toBe('pre_mortem');
    expect(m.title).toBe('Strengthen your model: run a quick pre-mortem');
    expect(m.why).toMatch(/assuming it went wrong and asking why/);
    // ⛔ The pre-mortem LENS predates the DSK bundle and carries no provenance —
    // it is never handed a protocol label it does not have.
    expect(m.science).toBeNull();
  });

  it('staleness (review non-blocking 2): the answer names the analysis it read', async () => {
    const r = await applicableMethod(readerOf(RERUN, SERVED), 'scenario');
    expect(r.analysis).toEqual({ graph_hash_at_run: 'f1e2d3c4b5a69788', computed_at: '2026-09-23T09:20:00.000Z' });
  });

  it('a refused analysis gives the gate nothing to select from → no method, and says not to invent one', async () => {
    const r = await applicableMethod(readerOf(REFUSED), 'scenario');
    expect(r.method).toBeNull();
    expect(String(r.why_none)).toMatch(/Do not propose one/);
  });

  it('no analysis yet → no method, and why', async () => {
    const r = await applicableMethod(readerOf(), 'scenario');
    expect(r.method).toBeNull();
    expect(String(r.why_none)).toMatch(/No analysis has run/);
  });

  it('no reader wired → the tool refuses rather than guessing', async () => {
    const r = await applicableMethod(undefined, 'scenario');
    expect(r).toEqual({ ok: false, mutated: false, refusal: 'method_gate_unavailable' });
  });

  it('reads the scenario-scoped page with the analysis-authority window', async () => {
    const read = readerOf(SERVED);
    await applicableMethod(read, 'scen-1');
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith('scen-1', APPLICABLE_METHOD_FACT_WINDOW);
  });
});

describe('B1 — the contraindication input the conventional route supplies', () => {
  it('RED: after the served pre-mortem, the firmer rerun is NOT handed DSK-P-003 — it equals the conventional gate', async () => {
    const want = conventional(RERUN, [SERVED]);
    // Vacuity: the prior really is a pre-mortem, and the conventional gate really
    // contraindicates consider_opposite because of it.
    expect(derivePreviousAnalysisLens([SERVED], AVAIL)).toBe('pre_mortem');
    expect(want.ineligible).toContainEqual({ lens: 'consider_opposite', reason: 'contraindicated_after_previous' });
    expect(want.chosen?.lens).toBe('sensitivity_flip_risk'); // the reviewer's independent measurement

    const r = await applicableMethod(readerOf(RERUN, SERVED), 'scenario');
    const m = methodOf(r);
    expect(m.id).not.toBe('consider_opposite');
    expect(m.id).toBe(want.chosen!.lens);
    expect(m.science).toBeNull();
    expect(r.also_eligible).toEqual(want.candidates.filter((c) => c.lens !== want.chosen!.lens).map((c) => c.lens));
  });

  it('NEGATIVE CONTROL: the same rerun with no prior fact still gets consider_opposite + DSK-P-003', async () => {
    const r = await applicableMethod(readerOf(RERUN), 'scenario');
    const m = methodOf(r);
    expect(m.id).toBe('consider_opposite');
    expect(m.science?.protocol_id).toBe('DSK-P-003');
    expect(m.id).toBe(conventional(RERUN, []).chosen?.lens);
  });
});

describe('B2 — an optional read never breaks the turn', () => {
  const throwing = () => vi.fn(async () => {
    throw new SessionReadError('Scenario analysis-fact query failed', { code: 'analysis_fact_query_failed' });
  });
  const ctx = { scenario_id: 's', authenticated_user_id: null, request_id: 'r' } as never;

  it('RED: a store read that throws → dispatchTool resolves to the refusal', async () => {
    const caps = createAgentCapabilities((async () => ({ status: 200, json: {} })) as never, new ProposalStore(), undefined, 'full', undefined, throwing());
    const r = await dispatchTool('get_applicable_method', JSON.stringify({ reason: 'after the analysis' }), ctx, caps, 'full');
    expect(r).toEqual({ ok: false, mutated: false, refusal: 'method_gate_unavailable' });
  });

  it('RED: a whole Agent turn over that reader RESOLVES, with the refusal recorded', async () => {
    const caps = createAgentCapabilities((async () => ({ status: 200, json: {} })) as never, new ProposalStore(), undefined, 'full', undefined, throwing());
    let n = 0;
    const callModel = (async () => {
      n += 1;
      return n === 1
        ? { output: [{ type: 'function_call', name: 'get_applicable_method', arguments: JSON.stringify({ reason: 'after the analysis' }), call_id: 'c1' }] }
        : { output: [{ type: 'message', content: [{ type: 'output_text', text: 'The analysis stands as reported.' }] }] };
    }) as never;
    const turn = runAgentTurn({ ctx, history: [], message: 'What does that tell me?', instructions: 'go', maxOutputTokens: 256, mode: 'full' }, caps, callModel);
    await expect(turn).resolves.toBeDefined();
    const t = await turn;
    expect(t.stopped_reason).toBe('answered');
    expect(t.tool_calls).toEqual([{ name: 'get_applicable_method', ok: false, mutated: false, refusal: 'method_gate_unavailable' }]);
  });
});

describe('B3 — the Agent opens with the exercise, never with its closing question', () => {
  const p003 = (loadVerifiedDskBundle()?.objects ?? []).find((o): o is DSKProtocol => o.type === 'protocol' && o.id === 'DSK-P-003');

  it('RED: a DSK-P-003 selection hands the bundle’s final step over as a CLOSING question, and opens elsewhere', async () => {
    expect(p003, 'the verified bundle carries DSK-P-003').toBeDefined();
    const finalStep = p003!.steps[p003!.steps.length - 1]!;
    expect(finalStep).toMatch(/recommendation/); // vacuity: the step this guards against

    const m = methodOf(await applicableMethod(readerOf(RERUN), 'scenario'));
    expect(m.science?.protocol_id).toBe('DSK-P-003');
    // No opening `steps` at all — the surviving step is a closing question.
    expect(m.science).not.toHaveProperty('steps');
    expect(m.science?.closing_questions).toContain(finalStep);
    expect(m.science?.expected_outputs).toEqual(p003!.expected_outputs);
    // M9: no leader-naming placeholder survives into anything the Agent may say.
    for (const q of m.science!.closing_questions) expect(q).not.toMatch(/\[[^\]]+\]/);
    // The opening guidance and the exercise it points at: not the final step, no verdict to endorse.
    for (const opening of [m.how_to_open, m.why]) {
      expect(opening).not.toBe(finalStep);
      expect(opening).not.toMatch(/recommendation/i);
    }
    expect(m.how_to_open).toBe(METHOD_OPENING_GUIDANCE);
    expect(m.how_to_open).toMatch(/closing_questions only at the end/);
  });

  it('NEGATIVE CONTROL: the pre-mortem still returns science:null', async () => {
    expect(methodOf(await applicableMethod(readerOf(SERVED), 'scenario')).science).toBeNull();
  });
});

describe('the tool surface', () => {
  it('is declared, read-only, and available in preview', () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toContain('get_applicable_method');
    expect(MUTATION_TOOLS).not.toContain('get_applicable_method');
    expect(toolsFor('preview').map((t) => t.name)).toContain('get_applicable_method');
  });

  it('RED (M4): dispatch reaches the gate through the real capabilities — and nothing is dispatched, built or proposed', async () => {
    const dispatch = vi.fn(async () => ({ status: 200, json: {} }));
    const callStructured = vi.fn();
    const proposals = new ProposalStore();
    const caps = createAgentCapabilities(dispatch as never, proposals, callStructured as never, 'full', undefined, readerOf(SERVED));
    const r = await dispatchTool('get_applicable_method', JSON.stringify({ reason: 'after the analysis' }), { scenario_id: 's', authenticated_user_id: null, request_id: 'r' } as never, caps, 'full');
    expect(methodOf(r).id).toBe('pre_mortem');
    expect(r.mutated).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(0);
    expect(callStructured).toHaveBeenCalledTimes(0);
    expect(proposals.size()).toBe(0);
  });

  it('RED (M7): the LIVE executor availability is applied — a resolved-EVPPI rerun never gets the replaced evpi lens', async () => {
    const v = structuredClone(RERUN);
    res(v).enrichment.factor_evppi[0]!.status = 'resolved';
    res(v).enrichment.factor_evppi[0]!.evppi = 0.01;
    // Contrast: without the live availability the same fact WOULD choose it.
    expect(rankInterventions(v).chosen?.lens).toBe('evpi_evidence_priority');
    const r = await applicableMethod(readerOf(v), 'scenario');
    expect(methodOf(r).id).not.toBe('evpi_evidence_priority');
    expect(methodOf(r).id).toBe(rankInterventions(v, AVAIL).chosen?.lens);
    expect(r.also_eligible).not.toContain('evpi_evidence_priority');
  });
});
