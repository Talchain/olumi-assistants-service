/**
 * ⭐ RECOVERY BATCH B (SYS3 TRACE L6), DL condition 2: "the Run's numbers don't move". A level the user stated as a range
 * is stored with that range (`observed_state.range`); the range changes no compute, so the analysis request PLoT receives
 * is IDENTICAL, byte for byte, with and without it. Through the real `run_analysis` handler with a mocked PLoT client.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot, type ScenarioReader } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';

const happyFixture = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8')) as V2RunResponseEnvelope;
const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const REQUEST_ID = 'req-stated-level-range';
const SENTENCE = "If we think of our development team's monthly capacity, currently they spend between 20% and 30% of their time on non-development tasks (e.g., meetings, admin, and other distractions that are not writing code).";

/** Paul's hiring model, with his 25 % non-development time (his figure) linked to productivity, with or without his range. */
function persistedGraph(range: boolean) {
  return GraphV3.parse({
    nodes: [
      { id: 'goal_productivity', kind: 'goal', label: 'productivity' },
      { id: 'opt_lead', kind: 'option', label: 'Hire a Tech lead', interventions: { fac_leads: 0.2 } },
      { id: 'opt_devs', kind: 'option', label: 'Hire two developers', interventions: { fac_leads: 0 } },
      { id: 'fac_leads', kind: 'factor', label: 'Additional Tech leads hired', category: 'controllable', observed_state: { value: 0, raw_value: 0, cap: 5, unit: 'people', source: 'brief_extraction' } },
      { id: 'fac_non_development_time', kind: 'factor', label: 'Non-development time', category: 'external',
        observed_state: { value: 0.25, raw_value: 25, cap: 100, declared_scale: 'unit_interval', unit: '%', source: 'user_override',
          ...(range ? { range: { low: 20, high: 30, meaning: 'min_max', source: 'user_override', source_quote: SENTENCE } } : {}) } },
    ],
    edges: [
      { from: 'fac_leads', to: 'goal_productivity', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'fac_non_development_time', to: 'goal_productivity', strength: { mean: -0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
    ],
  });
}

function makeInvocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO_ID, request_id: REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({ scenario_id: SCENARIO_ID, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
  } as HandlerInvocation;
}

/** The exact body PLoT receives, through the real handler. */
async function sent(range: boolean): Promise<Record<string, unknown>> {
  const graph = persistedGraph(range);
  const snapshot: RunAnalysisScenarioSnapshot = {
    graph,
    options: [
      { id: 'opt_lead', option_id: 'opt_lead', label: 'Hire a Tech lead', interventions: { fac_leads: 0.2 } },
      { id: 'opt_devs', option_id: 'opt_devs', label: 'Hire two developers', interventions: { fac_leads: 0 } },
    ],
    goal_node_id: 'goal_productivity',
    goal_constraints: [],
    rawPersistedGraph: graph,
  };
  const scenarioReader: ScenarioReader = vi.fn(() => Promise.resolve(snapshot));
  let captured: Record<string, unknown> | undefined;
  const run = vi.fn((payload: Record<string, unknown>) => {
    captured = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    return Promise.resolve(JSON.parse(JSON.stringify(happyFixture)) as V2RunResponseEnvelope);
  });
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  await createRunAnalysisHandler({ plotClient, scenarioReader })(makeInvocation());
  expect(run).toHaveBeenCalledOnce();
  return captured!;
}
const sha = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');

describe('L6: a stated range changes no analysis request', () => {
  it('RED: the same model with and without Paul\'s 20–30 % range sends PLoT the identical body (sha256)', async () => {
    const [without, withRange] = [await sent(false), await sent(true)];
    expect(JSON.stringify(withRange)).not.toContain('source_quote');
    expect(sha(withRange)).toBe(sha(without));
  });

  it('CONTROL: the range IS on the stored graph the run read (the strip is on the wire copy only)', () => {
    expect((persistedGraph(true).nodes.find((n) => n.id === 'fac_non_development_time') as { observed_state?: { range?: unknown } }).observed_state?.range)
      .toEqual({ low: 20, high: 30, meaning: 'min_max', source: 'user_override', source_quote: SENTENCE });
  });
});
