import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../run-analysis.js';
import { GOAL_INDEX_WEIGHTS_ASSUMED } from '../../../goal-target/index-goal-weights-note.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

type Rec = Record<string, unknown>;
interface Fixture {
  readonly graph: { readonly nodes: Rec[]; readonly edges: Rec[] };
  readonly response: { readonly inference_warnings: Rec[] };
}

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../coaching/__tests__/fixtures/served-a12-disclosure-undercount-523e18d.json',
);
const load = (): Fixture => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;

const SCENARIO_ID = '1ceb77d8-4352-4485-aadf-6e30ad429062';
const REQUEST_ID = 'req-olumi-authored-disclosure-wiring';

function plotResponse(graph: Fixture['graph'], warnings: readonly Rec[]): V2RunResponseEnvelope {
  const options = graph.nodes.filter((n) => n.kind === 'option');
  const share = 1 / options.length;
  const body = {
    meta: { seed_used: 1, n_samples: 1000, response_hash: 'olumi-authored-disclosure' },
    response_hash: 'olumi-authored-disclosure',
    analysis_status: 'computed',
    option_comparison: options.map((o) => ({
      option_id: o.id, option_label: String(o.id), win_probability: share, status: 'computed',
    })),
    inference_warnings: warnings,
  };
  return JSON.parse(JSON.stringify(body)) as V2RunResponseEnvelope;
}

async function enrichmentFor(f: Fixture, warnings: readonly Rec[]): Promise<Rec> {
  const snapshot: RunAnalysisScenarioSnapshot = {
    graph: f.graph,
    options: f.graph.nodes.filter((n) => n.kind === 'option'),
    goal_node_id: 'mrr',
    rawPersistedGraph: f.graph,
  };
  const plotClient: PLoTClient = {
    run: vi.fn(() => Promise.resolve(plotResponse(f.graph, warnings))),
    validatePatch: vi.fn(),
  };
  const invocation: HandlerInvocation = {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'Run analysis.' }],
      session_id: SCENARIO_ID,
      request_id: REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
      // The sibling wiring harness's context, verbatim: the handler reads none of the CEE-internal fields this literal
      // omits (freshness, facts-with-turn), so the boundary cast stays here, in the test.
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({
      turn_id: 't1', scenario_id: SCENARIO_ID, message: 'Run analysis.', turn_class: 'decide', stage: 'analyse',
    }),
    requestId: REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
  };
  const outcome = await createRunAnalysisHandler({ plotClient, scenarioReader: () => Promise.resolve(snapshot) })(
    invocation,
  );
  expect(plotClient.run).toHaveBeenCalledOnce();
  const fact = outcome.handler_facts[0];
  if (fact === undefined || fact.fact_type !== 'run_analysis') throw new Error('expected a run_analysis fact');
  return fact.result.enrichment as Rec;
}

const NOTE = "How much each of ‘A’ and ‘B’ counts towards ‘Shared progress’ is Olumi's assumption, not your stated priority. Set them to match what matters to you.";
function indexFixture(): Fixture {
  const f = load();
  const goal = f.graph.nodes.find((n) => n.id === 'mrr')!;
  goal.label = 'Shared progress';
  delete goal.goal_threshold_unit;
  delete (goal.observed_state as Rec).unit;
  f.graph.nodes.push({ id: 'A', kind: 'outcome', label: 'A' }, { id: 'B', kind: 'outcome', label: 'B' });
  const retained = f.graph.edges.filter((e) => e.to !== 'mrr');
  f.graph.edges.splice(0, f.graph.edges.length, ...retained);
  f.graph.edges.push(...['A', 'B'].map((from) => ({ from, to: 'mrr', strength: { mean: 0.5, std: 0.1 },
    provenance: { magnitude: 'olumi_estimate' } })));
  return f;
}
describe('index weights note on the real Run handler fact', () => {
  it('the analysed index graph writes the typed info record into validated persisted enrichment', async () => {
    const e = await enrichmentFor(indexFixture(), []);
    const notes = (e.inference_warnings as Rec[]).filter((w) => w.code === GOAL_INDEX_WEIGHTS_ASSUMED);
    expect(notes).toEqual([{ code: GOAL_INDEX_WEIGHTS_ASSUMED, severity: 'info', message: NOTE, goal_id: 'mrr',
      links: [{ from: 'A', to: 'mrr' }, { from: 'B', to: 'mrr' }] }]);
  });
  it('the same graph with a unit writes no index weights note', async () => {
    const f = indexFixture();
    f.graph.nodes.find((n) => n.id === 'mrr')!.goal_threshold_unit = 'hours';
    const e = await enrichmentFor(f, []);
    expect((e.inference_warnings as Rec[]).some((w) => w.code === GOAL_INDEX_WEIGHTS_ASSUMED)).toBe(false);
  });
});
