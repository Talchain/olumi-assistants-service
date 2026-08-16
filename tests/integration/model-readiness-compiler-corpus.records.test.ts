/**
 * Bounded Model Compiler + Readiness acceptance corpus.
 *
 * These are typed-record replays, not hand-built V3 payloads. Each case crosses
 * the model-facing record seam and the shared terminal V3/readiness authority.
 * The acceptance split is deliberately binary: the resulting model is either
 * runnable, or it exposes a small set of typed blockers whose endpoints and
 * recovery actions exist in the same graph.
 *
 * The temporal pricing case is the scientific refusal control. Two prices at
 * two times are a trajectory, not one scalar intervention. The compiler must
 * leave that option value-empty and the existing configure flow must ask the
 * human for a value instead of manufacturing one.
 */
import { describe, expect, it } from 'vitest';

import type { DraftRecordSet } from '../../src/cee/draft/records/grammar.js';
import { projectDraftRecords } from '../../src/cee/draft/records/seam.js';
import {
  transformResponseToV3,
  type V3DraftGraphResponse,
} from '../../src/cee/transforms/schema-v3.js';
import type { V1DraftGraphResponse } from '../../src/cee/transforms/schema-v2.js';
import {
  composeConfigureOptionClarifyResponse,
  CONFIGURE_OPTION_EXAMPLE_VALUE,
} from '../../src/orchestrator-v5/compose/configure-option-clarify-response.js';
import { buildConfigureOptionChipMessage } from '../../src/orchestrator-v5/configure-option-chip-text.js';
import { shouldInterceptBeforeEditLane } from '../../src/orchestrator-v5/routing/configure-option-clarify.js';
import {
  carriesConfigureOptionValuePayload,
  detectConfigureOptionIntent,
  projectOptionLabels,
} from '../../src/orchestrator-v5/routing/configure-option-intent.js';

interface CorpusCase {
  readonly name: string;
  readonly brief: string;
  readonly records: DraftRecordSet;
  readonly expectedStatus: 'ready' | 'needs_user_input';
}

const CASES: readonly CorpusCase[] = [
  {
    name: 'messy hiring brief with three genuinely quantified routes',
    brief: [
      'We need to improve reliable feature delivery before the November launch, but I am worried about coordination drag.',
      'Compare hiring one technical lead, adding two permanent developers, or using a contractor bridge for six months.',
      'Keep the current team is not a serious option because the launch date is fixed.',
    ].join(' '),
    records: {
      stated_items: [
        { kind: 'goal', source_quote: 'improve reliable feature delivery before the November launch' },
        { kind: 'option', source_quote: 'hiring one technical lead' },
        { kind: 'option', source_quote: 'adding two permanent developers' },
        { kind: 'option', source_quote: 'using a contractor bridge for six months' },
        { kind: 'constraint', source_quote: 'the launch date is fixed' },
      ],
      claims: [
        { claim_kind: 'factor', label: 'Delivery Capacity', basis: [0], category: 'controllable' },
        { claim_kind: 'outcome', label: 'Reliable Feature Throughput', basis: [0] },
        { claim_kind: 'risk', label: 'Coordination Drag', basis: [0] },
        { claim_kind: 'causal_link', label: 'lead sets capacity', from_stated: 1, to_claim: 0, effect: 'positive', sets_to: 0.72 },
        { claim_kind: 'causal_link', label: 'developers set capacity', from_stated: 2, to_claim: 0, effect: 'positive', sets_to: 0.88 },
        { claim_kind: 'causal_link', label: 'contractor bridge sets capacity', from_stated: 3, to_claim: 0, effect: 'positive', sets_to: 0.61 },
        { claim_kind: 'causal_link', label: 'capacity changes throughput', from_claim: 0, to_claim: 1, effect: 'positive' },
        { claim_kind: 'causal_link', label: 'throughput reaches launch goal', from_claim: 1, to_stated: 0, effect: 'positive' },
        { claim_kind: 'causal_link', label: 'coordination threatens launch', from_claim: 2, to_stated: 0, effect: 'negative' },
        { claim_kind: 'causal_link', label: 'date constrains launch', from_stated: 4, to_stated: 0, effect: 'negative' },
      ],
    },
    expectedStatus: 'ready',
  },
  {
    name: 'messy CRM brief with two levers per route',
    brief: [
      'Our sales team is split: HubSpot is familiar, Salesforce has depth, and a lighter CRM could reduce admin.',
      'Compare staying with HubSpot, moving to Salesforce, or adopting Pipedrive.',
      'We need better qualified-pipeline conversion without creating a painful migration for 30 people.',
    ].join(' '),
    records: {
      stated_items: [
        { kind: 'goal', source_quote: 'better qualified-pipeline conversion' },
        { kind: 'option', source_quote: 'staying with HubSpot', is_baseline: true },
        { kind: 'option', source_quote: 'moving to Salesforce' },
        { kind: 'option', source_quote: 'adopting Pipedrive' },
        { kind: 'constraint', source_quote: 'without creating a painful migration for 30 people' },
      ],
      claims: [
        { claim_kind: 'factor', label: 'Workflow Fit', basis: [0], category: 'controllable' },
        { claim_kind: 'factor', label: 'Automation Depth', basis: [0], category: 'controllable' },
        { claim_kind: 'outcome', label: 'Qualified Pipeline Conversion', basis: [0] },
        { claim_kind: 'risk', label: 'Migration Disruption', basis: [4] },
        { claim_kind: 'causal_link', label: 'HubSpot sets workflow fit', from_stated: 1, to_claim: 0, effect: 'positive', sets_to: 0.76 },
        { claim_kind: 'causal_link', label: 'HubSpot sets automation', from_stated: 1, to_claim: 1, effect: 'positive', sets_to: 0.58 },
        { claim_kind: 'causal_link', label: 'Salesforce sets workflow fit', from_stated: 2, to_claim: 0, effect: 'positive', sets_to: 0.62 },
        { claim_kind: 'causal_link', label: 'Salesforce sets automation', from_stated: 2, to_claim: 1, effect: 'positive', sets_to: 0.91 },
        { claim_kind: 'causal_link', label: 'Pipedrive sets workflow fit', from_stated: 3, to_claim: 0, effect: 'positive', sets_to: 0.83 },
        { claim_kind: 'causal_link', label: 'Pipedrive sets automation', from_stated: 3, to_claim: 1, effect: 'positive', sets_to: 0.67 },
        { claim_kind: 'causal_link', label: 'workflow changes conversion', from_claim: 0, to_claim: 2, effect: 'positive' },
        { claim_kind: 'causal_link', label: 'automation changes conversion', from_claim: 1, to_claim: 2, effect: 'positive' },
        { claim_kind: 'causal_link', label: 'conversion reaches goal', from_claim: 2, to_stated: 0, effect: 'positive' },
        { claim_kind: 'causal_link', label: 'migration threatens goal', from_claim: 3, to_stated: 0, effect: 'negative' },
        { claim_kind: 'causal_link', label: 'migration limit threatens goal', from_stated: 4, to_stated: 0, effect: 'negative' },
      ],
    },
    expectedStatus: 'ready',
  },
  {
    name: 'temporal price trajectory stays unresolved',
    brief: [
      'We charge £49 today and need to improve annual recurring revenue without a churn shock.',
      'Compare raising the price to £59 immediately, keeping the price at £49, or charging £49 now and £59 in Q2.',
      'The phased route may be easier to communicate, but do not turn two stages into one made-up price.',
    ].join(' '),
    records: {
      stated_items: [
        { kind: 'goal', source_quote: 'improve annual recurring revenue without a churn shock' },
        { kind: 'option', source_quote: 'raising the price to £59 immediately' },
        { kind: 'option', source_quote: 'keeping the price at £49', is_baseline: true },
        { kind: 'option', source_quote: 'charging £49 now and £59 in Q2' },
      ],
      claims: [
        { claim_kind: 'factor', label: 'Monthly Subscription Price', basis: [0], category: 'controllable' },
        { claim_kind: 'outcome', label: 'Annual Recurring Revenue', basis: [0] },
        { claim_kind: 'risk', label: 'Customer Churn Shock', basis: [0] },
        { claim_kind: 'causal_link', label: 'immediate rise sets price', from_stated: 1, to_claim: 0, effect: 'positive', sets_to: 59 },
        { claim_kind: 'causal_link', label: 'hold sets price', from_stated: 2, to_claim: 0, effect: 'positive', sets_to: 49 },
        // Intentionally connected but value-empty. Two time-indexed values are
        // not permission to collapse the route into one scalar intervention.
        { claim_kind: 'causal_link', label: 'phased rise changes price over time', from_stated: 3, to_claim: 0, effect: 'positive' },
        { claim_kind: 'causal_link', label: 'price changes recurring revenue', from_claim: 0, to_claim: 1, effect: 'positive' },
        { claim_kind: 'causal_link', label: 'revenue reaches goal', from_claim: 1, to_stated: 0, effect: 'positive' },
        { claim_kind: 'causal_link', label: 'churn threatens goal', from_claim: 2, to_stated: 0, effect: 'negative' },
      ],
    },
    expectedStatus: 'needs_user_input',
  },
];

const BLOCKER_TYPES = new Set([
  'missing_value',
  'ambiguous_value',
  'missing_connection',
  'constraint_dropped',
]);
const BLOCKER_ACTIONS = new Set([
  'add_value',
  'confirm_value',
  'add_edge',
  'review_constraint',
]);

function compile(recordCase: CorpusCase): V3DraftGraphResponse {
  const seam = projectDraftRecords(recordCase.records, recordCase.brief);
  expect(seam.ok, `${recordCase.name}: typed-record seam rejected corpus case`).toBe(true);
  if (!seam.ok) throw new Error(seam.reason);

  return transformResponseToV3(
    {
      graph: seam.projection.graph,
      quality: { overall: 8, structure: 8, coverage: 8, structural_proxy: 8 },
      trace: { request_id: `readiness-corpus-${recordCase.name}`, correlation_id: 'typed-record-replay' },
    } as unknown as V1DraftGraphResponse,
    { brief: recordCase.brief, requestId: `readiness-corpus-${recordCase.name}` },
  );
}

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

describe('typed-record Model Compiler + Readiness corpus', () => {
  for (const recordCase of CASES) {
    it(`${recordCase.name}: is runnable or carries a small typed recovery`, () => {
      const compiled = compile(recordCase);
      const readiness = compiled.analysis_ready;
      expect(readiness, `${recordCase.name}: terminal readiness absent`).toBeDefined();
      if (!readiness) return;

      const nodeById = new Map(compiled.nodes.map((node) => [node.id, node]));
      const endpointPairs = new Set(compiled.edges.map((edge) => `${edge.from}::${edge.to}`));
      expect(compiled.nodes.some((node) => node.kind === 'goal')).toBe(true);
      expect(compiled.nodes.filter((node) => node.kind === 'option').length).toBeGreaterThanOrEqual(2);
      expect(compiled.nodes.some((node) => node.kind === 'risk')).toBe(true);
      expect(compiled.nodes.some((node) => node.kind === 'outcome')).toBe(true);
      for (const edge of compiled.edges) {
        expect(nodeById.has(edge.from), `${recordCase.name}: missing edge source ${edge.from}`).toBe(true);
        expect(nodeById.has(edge.to), `${recordCase.name}: missing edge target ${edge.to}`).toBe(true);
      }

      expect(readiness.status).toBe(recordCase.expectedStatus);
      if (readiness.status === 'ready') {
        expect(readiness.blockers ?? []).toHaveLength(0);
        for (const option of readiness.options) {
          expect(option.status, option.label).toBe('ready');
          expect(Object.keys(option.interventions).length, option.label).toBeGreaterThan(0);
        }
        return;
      }

      const blockers = readiness.blockers ?? [];
      expect(blockers.length, `${recordCase.name}: non-ready output has no typed recovery`).toBeGreaterThan(0);
      expect(blockers.length, `${recordCase.name}: recovery is a backlog, not a next step`).toBeLessThanOrEqual(3);
      for (const blocker of blockers) {
        expect(BLOCKER_TYPES.has(blocker.blocker_type)).toBe(true);
        expect(BLOCKER_ACTIONS.has(blocker.suggested_action)).toBe(true);
        expect(blocker.factor_label.trim().length).toBeGreaterThan(0);
        expect(nodeById.get(blocker.factor_id)?.kind).toBe('factor');
        if (blocker.option_id) {
          expect(nodeById.get(blocker.option_id)?.kind).toBe('option');
          expect(endpointPairs.has(`${blocker.option_id}::${blocker.factor_id}`)).toBe(true);
          expect(blocker.option_label?.trim().length).toBeGreaterThan(0);
        }
      }
    });
  }

  it('temporal route receives no fabricated scalar and enters the human configure flow', () => {
    const compiled = compile(CASES[2]);
    const temporalLabel = 'charging £49 now and £59 in Q2';
    const temporalNode = compiled.nodes.find(
      (node) => node.kind === 'option' && node.label === temporalLabel,
    );
    const temporalOption = compiled.options.find((option) => option.label === temporalLabel);
    const temporalAnalysisOption = compiled.analysis_ready?.options.find(
      (option) => option.label === temporalLabel,
    );

    expect(temporalNode).toBeDefined();
    expect(temporalOption).toBeDefined();
    expect(temporalAnalysisOption).toBeDefined();
    expect(Object.keys(
      (record(temporalNode ?? {}).interventions as Record<string, unknown> | undefined) ?? {},
    )).toHaveLength(0);
    expect(Object.keys(temporalOption?.interventions ?? {})).toHaveLength(0);
    expect(Object.keys(temporalAnalysisOption?.interventions ?? {})).toHaveLength(0);
    expect(compiled.analysis_ready?.blockers).toHaveLength(1);
    expect(compiled.analysis_ready?.blockers?.[0]).toMatchObject({
      option_id: temporalNode?.id,
      option_label: temporalLabel,
      factor_label: 'Monthly Subscription Price',
      blocker_type: 'missing_value',
      suggested_action: 'add_value',
    });

    const message = buildConfigureOptionChipMessage(temporalLabel);
    const optionLabels = projectOptionLabels(compiled.nodes);
    const detection = detectConfigureOptionIntent(message, optionLabels);
    expect(carriesConfigureOptionValuePayload(message)).toBe(false);
    expect(detection.matched).toBe(true);

    const intercept = shouldInterceptBeforeEditLane({
      message,
      detection,
      graph: { nodes: compiled.nodes, edges: compiled.edges },
    });
    expect(intercept.matched).toBe(true);
    if (!intercept.matched) return;
    expect(intercept.optionId).toBe(temporalNode?.id);
    expect(intercept.factorLabels).toEqual(['Monthly Subscription Price']);

    const response = composeConfigureOptionClarifyResponse({
      optionLabel: intercept.optionLabel,
      factorLabels: intercept.factorLabels,
      stage: 'analyse',
    });
    // ⚠ WAS `toContain('<0-1>')` (row 2.1235 / NEW-5). That placeholder reached
    // real user copy — a strategic user was asked to hand-expand a template
    // inside a command string — so the value slot now carries a concrete
    // number. Derived from the exported constant, never transcribed, and pinned
    // against the CLASS so any future `<...>` slot REDs here.
    expect(response.assistant_text).toContain(CONFIGURE_OPTION_EXAMPLE_VALUE);
    expect(response.assistant_text).not.toMatch(/<[^>]{1,20}>/);
    expect(response.assistant_text).toContain(temporalLabel);
    expect(response.assistant_text).toContain('Monthly Subscription Price');
    expect(response.suggested_actions).toEqual([]);
    expect(response.assistant_text).not.toMatch(/(?:effect|value)[^.!?]{0,30}\b(?:49|59)\b/i);
  });
});
