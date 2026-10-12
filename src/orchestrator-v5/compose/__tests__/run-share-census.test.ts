/**
 * ⭐ RECOVERY BATCH E (DL ruling (ii), 12 Oct, refining ruling A to Paul's #87): THE CEE WIN-SHARE CENSUS, OVER THE RUN'S
 * RESULT SURFACES. No result surface states an option's share of runs: the analysis_result summary, and the reply of a turn
 * that ran (assistant_text, its shape, its chips) on the Agent and non-Agent paths. The REASONING surfaces keep it as
 * supporting detail (tipping points, the advice gate, constraint disclosure, the decision review): a negative row proves the
 * tipping-point answer still renders. Every filtered body still passes the strict response schema.
 *
 * Envelopes:
 *   · score run 4 capacity step 3, the served Agent body (CEE a770ce49), whole: it carried "88% of runs of this model";
 *   · a constructed Run in which every option carries a win share, through the REAL run_analysis handler (its
 *     assistant_text and fact) and the one analysis_result builder;
 *   · every other CEE emitter of the class, from its own function or constant: the close-call sentence, the lens bodies,
 *     the objective-contradiction arms, the eliminated-options tail, the re-run coaching line, the decision review's
 *     crowning sentence, the explanation fallback's standing lines.
 * Each is shown to match BEFORE the exit (so the census sees the class), then to have no match after the one exit function
 * both routes call (`withoutRunShareTextAtEgress`; the route rows are in `route-v2-run-share-exit.test.ts` and
 * `agent-add-factor-door-seam.test.ts` (s)). CONTRAST: the licensed chance line still renders, word for word.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { buildAnalysisResultBlock } from '../../compose.js';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import { RUN_RESULT_TEMPLATE, RUN_SHARE_CENSUS, statesRunShare, withoutRunShareSentences, withoutRunShareTextAtEgress } from '../run-share-text.js';
import { RUN_ANALYSIS_LOCKED_TEMPLATES } from '../../coaching/analysis-result-headline.js';
import { closenessLead } from '../../coaching/robustness-honesty.js';
import { BODY_BY_RATIONALE } from '../lens-selector.js';
import { composeObjectiveContradictionDisclosure } from '../../coaching/objective-contradiction.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../tools/registry.js';

type Rec = Record<string, any>;
const SERVED: Rec = JSON.parse(readFileSync(new URL('./fixtures/run4-capacity-turn3-response-body.json', import.meta.url), 'utf8'));
const HAPPY: Rec = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/plot/v2-run-golden-happy.json', import.meta.url), 'utf8'));
const CHANCE_LINE = '‘Add one specialist’: about 36% chance of meeting your goal, in this model, using Olumi\'s estimates for 3 relationships (see Check estimates).';

/** Every string a body ships, with its path; the user's model bytes (`draft_graph`, `graph`) are theirs, not CEE's. */
function strings(value: unknown, path = '$', out: [string, string][] = []): [string, string][] {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (k !== 'draft_graph' && k !== 'graph') strings(v, `${path}.${k}`, out);
  }
  return out;
}
const censusHits = (body: unknown): string[] => strings(body).filter(([, s]) => RUN_SHARE_CENSUS.test(s)).map(([p]) => p);
/** The census over the RESULT surfaces only: every analysis_result summary, and a Run turn's reply, shape and chips. */
const RESULT_SURFACE = /^\$\.(?:assistant_text|_answer_shape\b.*|suggested_actions\[\d+\]\.label|blocks\[\d+\]\.summary)$/;
const resultSurfaceHits = (body: Rec): string[] => censusHits(body).filter((p) => RESULT_SURFACE.test(p)
  && (!p.startsWith('$.blocks') || body.blocks[Number(/\[(\d+)\]/.exec(p)![1])].type === 'analysis_result'));
const RUN = { exitPath: 'census', runTurn: true } as const;
const REASONING = { exitPath: 'census', runTurn: false } as const;
/** The strict wire schema over the V5 envelope's own members (the Agent's sidecars are not V5 members). */
const V5_KEYS = ['response_version', 'assistant_text', 'blocks', 'suggested_actions', 'insights', 'stage_indicator'] as const;
const v5 = (body: Rec): Rec => Object.fromEntries(V5_KEYS.filter((k) => k in body).map((k) => [k, body[k]]));

describe('census 1 — score run 4 capacity step 3, the served Agent body', () => {
  it('BEFORE: the census sees the class (the analysis_result summary)', () => {
    expect(resultSurfaceHits(SERVED)).toContain('$.blocks[0].summary');
  });
  it('AFTER the exit (a Run turn): no result surface matches; the chance line and the structured win_probabilities are unchanged', () => {
    const out = withoutRunShareTextAtEgress(SERVED, RUN);
    expect(resultSurfaceHits(out)).toEqual([]);
    expect(out.assistant_text).toContain(CHANCE_LINE);
    expect(out.assistant_text.split(CHANCE_LINE)).toHaveLength(2);
    expect(out.blocks[0].win_probabilities).toEqual(SERVED.blocks[0].win_probabilities);
    expect(out.blocks[0].leading_option_id).toBe(SERVED.blocks[0].leading_option_id);
    expect(out.assistant_text).toBe(SERVED.assistant_text);
  });
  it('a body with no such sentence is returned by reference (the V5 route re-finalises only an edited body)', () => {
    const clean = withoutRunShareTextAtEgress(SERVED, RUN);
    expect(withoutRunShareTextAtEgress(clean, RUN)).toBe(clean);
  });
});

describe('census 2 — a constructed Run, every option with a win share, through the real handler and the builder', () => {
  async function run(): Promise<{ text: string; fact: RunAnalysisHandlerFact }> {
    const plot = { run: vi.fn(async () => structuredClone(HAPPY) as V2RunResponseEnvelope), validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
    const handler = createRunAnalysisHandler({ plotClient: plot, scenarioReader: vi.fn(async () => ({
      graph: { nodes: [{ id: 'g', kind: 'goal' }], edges: [] },
      options: [{ id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { f: 1 } }, { id: 'opt_b', option_id: 'opt_b', label: 'B', interventions: { f: 0 } }],
      goal_node_id: 'g',
    })) as never });
    const outcome = await handler({
      context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: 'census',
        request_id: 'census', budgets: { turn_ms: 60_000, llm_narrate_ms: 30_000 }, prior_turns: [], prior_facts: [], persistedGraph: null },
      payload: makeMessagePayload({ turn_id: 't-census', scenario_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
      requestId: 'census', signal: new AbortController().signal, orientationText: '',
    } as unknown as HandlerInvocation);
    const fact = outcome.handler_facts[0] as RunAnalysisHandlerFact;
    return { text: String(outcome.assistant_text ?? ''), fact };
  }
  it('precondition: every option row carries a win share', () => {
    expect(HAPPY.results.every((r: Rec) => typeof r.win_probability === 'number')).toBe(true);
  });
  it('BEFORE: the handler\'s assistant_text and fact summary state the share (non-Agent path)', async () => {
    const { text, fact } = await run();
    expect(text).toMatch(RUN_SHARE_CENSUS);
    expect(String(fact.result.summary)).toMatch(RUN_SHARE_CENSUS);
  });
  it('AFTER: the builder\'s summary is clean, and the Run turn\'s whole V5 body has no result-surface match', async () => {
    const { text, fact } = await run();
    const body: Rec = { response_version: 2, assistant_text: text, blocks: [buildAnalysisResultBlock(fact)], suggested_actions: [], insights: [], stage_indicator: 'analyse' };
    expect(resultSurfaceHits({ blocks: body.blocks })).toEqual([]);
    expect(resultSurfaceHits(withoutRunShareTextAtEgress(body, RUN))).toEqual([]);
  });
});

describe('census 3 — every other CEE emitter of the class, before and after the exit', () => {
  const objective = composeObjectiveContradictionDisclosure(null, [
    { option_id: 'hold', option_label: 'Hold at £49', win_probability: 0.7, probability_of_goal: 0 },
    { option_id: 'raise', option_label: 'Raise to £59', win_probability: 0.3, probability_of_goal: 0.48 },
  ], true, 'goal_framed', { goalCertainty: [{ option_id: 'hold', probability_of_goal: 0, earned: true }] });
  const emitted: [string, string][] = [
    ['close call (robustness-honesty)', closenessLead({ leadingLabel: 'Hold', runnerLabel: 'Raise', tieReason: 'override', marginPp: 3 })!],
    ['lens: a moderate leader (lens-selector)', BODY_BY_RATIONALE.WIN_PROB_MODERATE],
    ['objective contradiction arm', objective],
    ['eliminated options tail (headline)', 'Hold was supported by 97% of runs of this model. 2 options are effectively eliminated (each supported by under 1% of runs).'],
    ['re-run coaching line (coaching-signals)', 'This re-run changed the outcome: Hold scored highest before, and Raise scores highest now. Ask what changed if you want the detail.'],
    ['decision review crowning sentence (winner-naming egress)', 'Hold was supported by 70% of runs of this model. Review the assumptions behind it.'],
    ['explanation fallback standing line', 'In this model, Hold was supported by 70% of runs. In this model, ‘Raise’ was supported by the next most runs (30%).'],
    ['tie headline', 'Hold was supported by only fractionally more runs of this model, so the options are effectively tied.'],
  ];
  it.each(emitted)('%s: the class is seen before, and gone after', (_name, text) => {
    expect(statesRunShare(text), text).toBe(true);
    const out = withoutRunShareSentences(text);
    expect(out, out).not.toMatch(RUN_SHARE_CENSUS);
    expect(statesRunShare(out), out).toBe(false);
  });
  it('the words that remain are kept byte for byte (no word added)', () => {
    expect(withoutRunShareSentences('Hold was supported by 97% of runs of this model. 2 options are effectively eliminated (each supported by under 1% of runs).')).toBe('');
    expect(withoutRunShareSentences(`${CHANCE_LINE}\n\n• In this model, 88% of runs supported ‘Add one specialist’.\n• Not shown yet; why is under More detail`))
      .toBe(`${CHANCE_LINE}\n\n• Not shown yet; why is under More detail`);
  });
  it('a Run turn whose reply was only a share of runs says the existing locked template (true: it ran); a chip stating one is dropped', () => {
    expect(RUN_ANALYSIS_LOCKED_TEMPLATES.has(RUN_RESULT_TEMPLATE)).toBe(true);
    const out = withoutRunShareTextAtEgress({ assistant_text: 'Hold was supported by 70% of runs of this model.',
      suggested_actions: [{ id: 'a', label: 'Why did Hold come out on top?', message: 'x' }, { id: 'b', label: 'Check estimates', message: 'y' }] }, RUN);
    expect(out.assistant_text).toBe(RUN_RESULT_TEMPLATE);
    expect(out.suggested_actions.map((c: Rec) => c.id)).toEqual(['b']);
  });
  it('the delta check\'s repro on a turn that did NOT run: "I cannot tell which option comes out ahead." ships unchanged — never emptied, never a Run claim', () => {
    const body = { assistant_text: 'I cannot tell which option comes out ahead.' };
    expect(withoutRunShareTextAtEgress(body, REASONING)).toBe(body);
  });
  it('CONTRAST: the licensed chance line and its licence words never match', () => {
    for (const text of [CHANCE_LINE,
      '‘Hire two developers’: about 99% chance of launching by 12 April 2027, in this model, using Olumi’s estimates of hiring time (2–4 months).',
      'Not shown. This run did not test your goal’s own target, so its results are not the chance of meeting it. Run the analysis again.']) {
      expect(statesRunShare(text), text).toBe(false);
      expect(withoutRunShareSentences(text)).toBe(text);
    }
  });
});

describe('ruling (ii): the REASONING surfaces keep the share of runs as supporting detail', () => {
  it('"What would change the result?": the tipping-point answer renders its content, byte for byte (by reference)', () => {
    const tipping = { response_version: 2, stage_indicator: 'analyse', insights: [], suggested_actions: [], blocks: [],
      assistant_text: '‘Offshore partner’ would still be supported by the most runs even if delivery risk\'s average effect doubled. '
        + '‘In-house team’ would be the first to be supported by the most runs if hiring time fell below about a quarter.' };
    expect(statesRunShare(tipping.assistant_text)).toBe(true);
    const out = withoutRunShareTextAtEgress(tipping, REASONING);
    expect(out).toBe(tipping);
    expect(out.assistant_text).toContain('would still be supported by the most runs');
  });
  it('a re-shown analysis_result block on a reasoning turn: its summary is still a result surface (cleaned); the reply is kept', () => {
    const body = { assistant_text: '‘Hold’ would still be supported by the most runs even if price fell.',
      blocks: [{ type: 'analysis_result', summary: 'Hold was supported by 70% of runs of this model. Margins are thin.' }] };
    const out = withoutRunShareTextAtEgress(body, REASONING);
    expect(out.assistant_text).toBe(body.assistant_text);
    expect((out.blocks[0] as Rec).summary).toBe('Margins are thin.');
  });
});

describe('every filtered body passes the strict response schema (never a required field emptied)', () => {
  const rows: [string, () => Promise<Rec> | Rec, typeof RUN | typeof REASONING][] = [
    ['score run 4 capacity step 3 (its V5 members)', () => v5(SERVED), RUN],
    ['the constructed all-options Run envelope', async () => {
      const plot = { run: vi.fn(async () => structuredClone(HAPPY) as V2RunResponseEnvelope), validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
      const handler = createRunAnalysisHandler({ plotClient: plot, scenarioReader: vi.fn(async () => ({
        graph: { nodes: [{ id: 'g', kind: 'goal' }], edges: [] },
        options: [{ id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { f: 1 } }, { id: 'opt_b', option_id: 'opt_b', label: 'B', interventions: { f: 0 } }],
        goal_node_id: 'g',
      })) as never });
      const outcome = await handler({
        context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: 'census',
          request_id: 'census', budgets: { turn_ms: 60_000, llm_narrate_ms: 30_000 }, prior_turns: [], prior_facts: [], persistedGraph: null },
        payload: makeMessagePayload({ turn_id: 't-census', scenario_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
        requestId: 'census', signal: new AbortController().signal, orientationText: '',
      } as unknown as HandlerInvocation);
      return { response_version: 2, assistant_text: String(outcome.assistant_text), insights: [], suggested_actions: [], stage_indicator: 'analyse',
        blocks: [buildAnalysisResultBlock(outcome.handler_facts[0] as RunAnalysisHandlerFact)] };
    }, RUN],
    ['"I cannot tell which option comes out ahead." alone, on a Run turn', () => ({ response_version: 2, insights: [], suggested_actions: [],
      stage_indicator: 'analyse', blocks: [], assistant_text: 'I cannot tell which option comes out ahead.' }), RUN],
    ['"I cannot tell which option comes out ahead." alone, on a reasoning turn', () => ({ response_version: 2, insights: [], suggested_actions: [],
      stage_indicator: 'analyse', blocks: [], assistant_text: 'I cannot tell which option comes out ahead.' }), REASONING],
  ];
  it.each(rows)('%s', async (_name, make, opts) => {
    const body = await make();
    expect(OlumiResponseSchema.safeParse(body).success, 'precondition: the body is schema-valid before').toBe(true);
    const out = withoutRunShareTextAtEgress(body, opts);
    const parsed = OlumiResponseSchema.safeParse(out);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    expect(String(out.assistant_text).trim()).not.toBe('');
    expect(resultSurfaceHits(opts.runTurn ? out : { blocks: out.blocks })).toEqual([]);
  });
});
