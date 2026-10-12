/**
 * ⭐ RECOVERY BATCH E (DL ruling, 12 Oct): THE CEE WIN-SHARE CENSUS. No CEE text a Run can emit states an option's share of
 * runs: assistant_text on the Agent and non-Agent paths, the analysis_result summary, notes, coaching and egress.
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
import { RUN_SHARE_CENSUS, statesRunShare, withoutRunShareSentences, withoutRunShareTextAtEgress } from '../run-share-text.js';
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

describe('census 1 — score run 4 capacity step 3, the served Agent body', () => {
  it('BEFORE: the census sees the class (the analysis_result summary)', () => {
    expect(censusHits(SERVED)).toContain('$.blocks[0].summary');
  });
  it('AFTER the exit: no CEE text matches; the chance line and the structured win_probabilities data are unchanged', () => {
    const out = withoutRunShareTextAtEgress(SERVED, { exitPath: 'census' });
    expect(censusHits(out)).toEqual([]);
    expect(out.assistant_text).toContain(CHANCE_LINE);
    expect(out.assistant_text.split(CHANCE_LINE)).toHaveLength(2);
    expect(out.blocks[0].win_probabilities).toEqual(SERVED.blocks[0].win_probabilities);
    expect(out.blocks[0].leading_option_id).toBe(SERVED.blocks[0].leading_option_id);
    expect(out.assistant_text).toBe(SERVED.assistant_text);
  });
  it('a body with no such sentence is returned by reference', () => {
    const clean = withoutRunShareTextAtEgress(SERVED, { exitPath: 'census' });
    expect(withoutRunShareTextAtEgress(clean, { exitPath: 'census' })).toBe(clean);
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
  it('AFTER: the V5 body (assistant_text + analysis_result block) has no match anywhere', async () => {
    const { text, fact } = await run();
    const body = { assistant_text: text, blocks: [buildAnalysisResultBlock(fact)] };
    expect(censusHits(body.blocks)).toEqual([]);
    expect(censusHits(withoutRunShareTextAtEgress(body, { exitPath: 'census' }))).toEqual([]);
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
  it('an assistant_text left empty is the existing locked template; a chip left without a label is dropped', () => {
    const out = withoutRunShareTextAtEgress({ assistant_text: 'Hold was supported by 70% of runs of this model.',
      suggested_actions: [{ id: 'a', label: 'Why did Hold come out on top?', message: 'x' }, { id: 'b', label: 'Check estimates', message: 'y' }] }, { exitPath: 'census' });
    expect(out.assistant_text).toBe('Ran analysis on your current scenario.');
    expect(out.suggested_actions.map((c: Rec) => c.id)).toEqual(['b']);
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
