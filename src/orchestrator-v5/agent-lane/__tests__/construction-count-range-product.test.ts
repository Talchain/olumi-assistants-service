/** MC: the banked T1b point-count shape carries the user's range through construction, reload and the real Run wire. */
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { describe, expect, it, vi } from 'vitest';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3, NodeV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

const SCENARIO_ID = 'b63d8672-0000-4000-8000-0000000b63d8';
const WIN = 'The starter tier would win about 150 new subscribers, between 80 and 250.';
const BARE = 'The starter tier would win about 150 new subscribers.';
const T1B = 'We are a B2B software company with £120,000 monthly recurring revenue from 400 customers paying £300 a month. '
  + 'Decision: raise prices by 10%, launch a starter tier at £49 a month, or keep pricing as it is. Goal: reach at least '
  + '£126,000 monthly recurring revenue within 9 months. Facts: each 1% price rise adds £1,200 a month to monthly recurring '
  + 'revenue before churn. Each 1% price rise loses about 2 customers, between 1 and 4. Each lost customer removes £300 a '
  + `month of monthly recurring revenue. ${WIN} Each starter subscriber adds £49 a month to monthly recurring revenue. `
  + 'Each starter subscriber costs about £6 a month in support. Keeping pricing as it is adds nothing.';
const RANGE = { low: 80, high: 250, meaning: 'likely_range', source: 'brief_extraction', source_quote: WIN };
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
type Rec = Record<string, any>;
const set = (factor_label: string, value: number, unit: string, provenance = 'explicit') =>
  ({ factor_label, value, value_kind: 'absolute', unit, provenance });
const link = (from: string, to: string, direction = 'positive', amount: number | null = null, per: number | null = null, provenance = amount === null ? 'inferred' : 'explicit') =>
  ({ from, to, direction, provenance, effect_amount: amount, effect_per_source_change: per, effect_provenance: amount === null ? null : provenance });

/** Banked draft 8 shape from construction-rate-count-product: Launch sets the count, rather than a switch feeding it. */
function pointCountDraft(): Rec {
  return {
    goal: { metric: 'monthly recurring revenue', operator: '>=', target_stated: true, frame: 'level', value: 126000, unit: 'GBP per month', horizon_months: 9,
      provenance: 'explicit', baseline_known: true, baseline_value: 120000, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Raise prices 10%', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set('Price rise', 10, '%')] },
      { label: 'Launch £49 starter tier', provenance: 'explicit', is_status_quo: null, changes: [], interventions:
        [set('Starter subscribers', 150, 'subscribers', 'ai_proposed'), set('Starter tier monthly price', 49, 'GBP per subscriber per month', 'ai_proposed')] },
      { label: 'Keep pricing as it is', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
    ],
    factors: [
      { label: 'Price rise', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
      { label: 'Starter subscribers', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 1000 },
      { label: 'Starter tier monthly price', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'GBP per subscriber per month', provenance: 'ai_proposed', plausible_max: 200 },
    ],
    risks: [],
    outcomes: [
      { label: 'Customers lost from price rise', provenance: 'inferred', unit: 'customers', plausible_max: 1000 },
      { label: 'Starter-tier MRR', provenance: 'inferred', unit: 'GBP per month', plausible_max: 50000 },
    ],
    links: [
      link('Price rise', 'monthly recurring revenue', 'positive', 1200, 1),
      link('Price rise', 'Customers lost from price rise', 'positive', 2, 1),
      link('Customers lost from price rise', 'monthly recurring revenue', 'negative', -300, 1),
      link('Starter tier monthly price', 'Starter-tier MRR'),
      link('Starter subscribers', 'Starter-tier MRR'),
      { ...link('Starter-tier MRR', 'monthly recurring revenue', 'positive', 1, 1, 'inferred'), definitional: true },
    ],
    identities: [], unknowns: [], decision_question: null,
  };
}

async function build(brief = T1B, wire = pointCountDraft(), schemaCheck = true) {
  if (schemaCheck) expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let registered: Rec | undefined;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: Rec }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief(SCENARIO_ID, brief, dispatch, call);
  expect(out.ok, JSON.stringify(out)).toBe(true);
  const graph = GraphV3.parse(JSON.parse(JSON.stringify(projectGraphForPersistence(registered!))));
  const node = (label: string) => NodeV3.parse(graph.nodes.find(n => n.label === label)!);
  const count = node('Starter subscribers');
  const option = node('Launch £49 starter tier');
  return { graph, node, count, option, cell: option.interventions![count.id]! };
}

describe('MC: a point-set count keeps its own quoted range before the price × count mint', () => {
  it('RED at base: banked shape persists raw 150 with 80–250 AND mints the product, as Olumi’s reading', async () => {
    const { cell, node, count } = await build();
    expect(cell).toMatchObject({ raw_value: 150, unit: 'subscribers' });
    expect(cell.range).toEqual(RANGE);
    expect(node('Starter-tier MRR').nonlinear_identity).toEqual({
      operation: 'product', factor_ids: [node('Starter tier monthly price').id, count.id], stated_in_brief: false,
    });
  });

  it.each([
    ['bare point, no subscriber range', BARE],
    ['range for another quantity with the same point', `${BARE} Support tickets would be about 150, between 80 and 250.`],
    ['another tier with the same count noun', `${BARE} The Pro tier would win about 150 new subscribers, between 80 and 250.`],
    ['another count noun in the same sentence', 'The starter tier would win about 150 new subscribers; support tickets would be between 80 and 250.'],
    ['another unit', 'The starter tier would win about 150 new subscribers, between 80 and 250 months.'],
    ['another count unit', 'The starter tier would win about 150 new subscribers, between 80 and 250 support tickets.'],
    ['exact count', 'The starter tier would win exactly 150 new subscribers.'],
    ['exact count beside a purported range', 'The starter tier would win exactly 150 new subscribers, between 80 and 250.'],
    ['explicit minimum and maximum', `Minimum and maximum counts: ${WIN}`],
    ['confidence interval, not a likely range', `Our 95% confidence interval: ${WIN}`],
    ['question, not a stated range', 'Would the starter tier win about 150 new subscribers, between 80 and 250?'],
    ['point outside the stated range', 'The starter tier would win about 150 new subscribers, between 180 and 250.'],
    ['ambiguous ranges', `${WIN} The starter tier would win about 150 new subscribers, between 100 and 200.`],
    ['exact count in another statement overrides a range', `${WIN} The starter tier would win exactly 150 new subscribers.`],
  ])('CONTROL: %s → no count range and no mint', async (_name, sentence) => {
    const { cell, node } = await build(T1B.replace(WIN, sentence));
    expect(cell.range).toBeUndefined();
    expect(node('Starter-tier MRR').nonlinear_identity).toBeUndefined();
  });

  it('CONTROL: an invented drafter range is stripped; it cannot license a bare-point mint', async () => {
    const wire = pointCountDraft();
    wire.options[1].interventions[0].range = RANGE;
    // Deliberately invalid drafter output probes the receipt boundary, rather than claiming this is schema-valid.
    expect(strict(wire)).toBe(false);
    const { cell, node } = await build(T1B.replace(WIN, BARE), wire, false);
    expect(cell.range).toBeUndefined();
    expect(node('Starter-tier MRR').nonlinear_identity).toBeUndefined();
  });

  it('CONTROL: a second option setting the count to a bare point still refuses the mint', async () => {
    const wire = pointCountDraft();
    wire.options[0].interventions.push(set('Starter subscribers', 200, 'subscribers', 'ai_proposed'));
    const { node } = await build(T1B, wire);
    expect(node('Starter-tier MRR').nonlinear_identity).toBeUndefined();
  });

  it('RED at base: the constructed cell reaches the real CEE→PLoT Run request in the schemas-0.66 carrier shape', async () => {
    const { graph, count, option } = await build();
    const options = graph.nodes.filter(n => n.kind === 'option').map(n => ({
      id: n.id, option_id: n.id, label: n.label, interventions: n.interventions ?? {},
    }));
    const snapshot: RunAnalysisScenarioSnapshot = {
      graph, options, goal_node_id: graph.nodes.find(n => n.kind === 'goal')!.id, rawPersistedGraph: graph,
    };
    let captured: Rec | undefined;
    const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8')) as V2RunResponseEnvelope;
    const run = vi.fn((payload: Rec) => { captured = payload; return Promise.resolve(structuredClone(happy)); });
    const invocation = {
      context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
        messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO_ID, request_id: 'req-mc-range',
        budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
      payload: makeMessagePayload({ scenario_id: SCENARIO_ID, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
      requestId: 'req-mc-range', signal: new AbortController().signal, orientationText: '',
    } as unknown as HandlerInvocation;
    await createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
      scenarioReader: async () => snapshot })(invocation);
    expect(run).toHaveBeenCalledOnce();
    const sent = (captured!.options as Rec[]).find(o => o.id === option.id)!;
    expect(sent.interventions[count.id]).toBe(150);
    expect(sent.intervention_ranges).toEqual({ [count.id]: { low: 80, high: 250, meaning: 'likely_range' } });
    expect((captured!.options as Rec[]).filter(o => o.id !== option.id).every(o => o.intervention_ranges === undefined)).toBe(true);
  });
});
