/**
 * WIRE through the real `run_analysis` handler: the sent inputs preserve every Olumi-authored value
 * (A6 `olumi-authored-disclosure-undercounts`), without reintroducing S4's retired stock summary paragraph.
 *
 * The graph is the SERVED journey-A run-2 graph (CEE 523e18d, scenario 1ceb77d8; scrubbed fixture shared with
 * `coaching/__tests__/olumi-authored-disclosure-counts-all.test.ts`), and the stubbed PLoT response carries that
 * run's own engine warnings verbatim (code + field). Served, that run said "I supplied 6"; through this handler it
 * carried 22 — 6 baselines, 4 option levels and 12 link strengths. Those count/source controls stay. (The engine's 0.0 for the competitor risk rides
 * in those warnings; this sentence does not count it — Tier-3, see `inferred-value-disclosure.ts`.)
 *
 * Status ladder: TESTED. Stubbed PLoT + stubbed scenario reader is not a wire witness.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../run-analysis.js';
import { isAllowedRunAnalysisAssistantText } from '../../../coaching/analysis-result-headline.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { deriveOlumiAuthoredValues } from '../../../coaching/inferred-value-disclosure.js';

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

async function summaryFor(f: Fixture, warnings: readonly Rec[], goalId = 'mrr') {
  const snapshot: RunAnalysisScenarioSnapshot = {
    graph: f.graph,
    options: f.graph.nodes.filter((n) => n.kind === 'option'),
    goal_node_id: goalId,
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
  const sent = vi.mocked(plotClient.run).mock.calls[0]![0] as Record<string, unknown>;
  const options = sent.options as Rec[];
  const ids = new Set(options.map(o => String(o.option_id ?? o.id)));
  return { summary: fact.result.summary ?? '', values: deriveOlumiAuthoredValues(sent.graph, ids) };
}

const sentence = (n: number): string =>
  ` I supplied ${n} of the values behind this, because your brief did not state them. They are mine rather than yours.` +
  ' Changing any of them changes what this model implies.';

describe('WIRE — every Olumi value is retained in the sent inputs without the retired stock summary', () => {
  it('the served A12 inputs retain 22 values (6 baselines, 4 option levels, 12 links), and the summary survives egress', async () => {
    const f = load();
    const { summary, values } = await summaryFor(f, f.response.inference_warnings);
    expect(values).toHaveLength(22);
    expect(values.filter(v => v.kind === 'factor_baseline')).toHaveLength(6);
    expect(values.filter(v => v.kind === 'option_level')).toHaveLength(4);
    expect(values.filter(v => v.kind === 'link_strength')).toHaveLength(12);
    expect(summary).not.toContain(sentence(22));
    expect(summary).not.toContain('I supplied 6 of the values');
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  });

  it('CONTRAST — the sent £54 level stated by the user leaves 21 Olumi values: the count follows the author', async () => {
    const f = load();
    const option = f.graph.nodes.find((n) => n.id === 'raise_pro_to_54_at_release');
    (option?.interventions as Record<string, Rec>).pro_plan_price.source = 'user_specified';
    const { summary, values } = await summaryFor(f, f.response.inference_warnings);
    expect(values).toHaveLength(21);
    expect(values).not.toContainEqual({ kind: 'option_level', option_id: 'raise_pro_to_54_at_release', factor_id: 'pro_plan_price' });
    expect(summary).not.toContain(sentence(21));
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  });
});

/** The served capacity read (e2e c0998b2e, capacity/reads/01-02-range.json), verbatim. */
const CAPACITY = resolve(dirname(fileURLToPath(import.meta.url)), '../../../coaching/__tests__/fixtures/served-capacity-e2e-c0998b2e-graph.json');
const capacity = (): Fixture => ({ ...(JSON.parse(readFileSync(CAPACITY, 'utf8')) as { graph: Fixture['graph'] }), response: { inference_warnings: [] } });
const ONE = ' I supplied the value behind this, because your brief did not state it. It is mine rather than yours.';

describe('WIRE — a value on an option the Run left out is not "behind this" (capacity e2e c0998b2e, judge row 7)', () => {
  it('capacity sends 1 Olumi value, excluding the unsent part-time option’s level and the user’s unconfirmed setting', async () => {
    const f = capacity();
    // PRECONDITION (the capture): the part-time option is Olumi's suggestion and its level is Olumi's; the one Olumi
    // starting value is the specialist capacity; the user's unconfirmed setting is stamped as such, never Olumi's.
    const partTime = f.graph.nodes.find((n) => n.id === 'add_part_time_specialist')!;
    expect(partTime.proposed_by).toBe('olumi');
    expect((partTime.interventions as Record<string, Rec>).additional_specialists.source).toBe('cee_hypothesis');
    expect((f.graph.nodes.find((n) => n.id === 'additional_specialists')!.observed_state as Rec).user_material_unverified).toBe(true);
    const { summary, values } = await summaryFor(f, [], 'weekly_support_capacity');
    expect(values).toHaveLength(1);
    expect(values).not.toContainEqual({ kind: 'option_level', option_id: 'add_part_time_specialist', factor_id: 'additional_specialists' });
    expect(summary).not.toContain(ONE);
    expect(summary).not.toMatch(/I supplied \d+ of the values/);
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  });

  it('CONTRAST: the user-added option is sent, so its Olumi level is included among 2 values', async () => {
    const f = capacity();
    const partTime = f.graph.nodes.find((n) => n.id === 'add_part_time_specialist')!;
    delete partTime.proposed_by;
    partTime.provenance = 'from_brief';
    const { summary, values } = await summaryFor(f, [], 'weekly_support_capacity');
    expect(values).toHaveLength(2);
    expect(values).toContainEqual({ kind: 'option_level', option_id: 'add_part_time_specialist', factor_id: 'additional_specialists' });
    expect(summary).not.toContain(sentence(2));
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  });
});
