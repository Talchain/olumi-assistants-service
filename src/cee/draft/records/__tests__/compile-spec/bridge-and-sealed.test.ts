import { writeFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { buildModelFromRecords, buildStrictDraftRecordsSchema, omitOptionalRecordNulls } from '../../../../../orchestrator-v5/agent-lane/runtime/build-model-from-records.js';
import { constructionOperationId, strictForTheDrafter, type CallStructuredModel } from '../../../../../orchestrator-v5/agent-lane/runtime/build-model.js';
import type { InternalDispatch } from '../../../../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { V_NEXT_DRAFT_RECORDS_INSTRUCTION as DRAFT_RECORDS_INSTRUCTION } from '../../instruction-vnext.js';
import { projectDraftRecords } from '../../seam.js';
import { projectGraphForPersistence } from '../../../../../orchestrator-v5/persisted-graph-projection.js';
import { assignEntityRefs } from '../../../../../orchestrator-v5/graph/entity-refs.js';
import { targetTestabilityOf } from '../../../../../orchestrator-v5/admission/target-testability.js';
import { resolveAnalysisAdmission } from '../../../../../orchestrator-v5/admission/analysis-admission.js';
import { GraphV3, type GraphV3T } from '../../../../../schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../../../../../orchestrator-v5/boundary/request-extensions.js';
import { deriveNotModelledManifest } from '../../../../context-integrity/not-modelled-manifest.js';
// The strict attach site now accepts v-next literals; legacy draws have their own replay rows.
import { BRIEF, sealedRecordsVNext as sealedRecords } from './sealed-fixture-vnext.js';

const SCENARIO = '11111111-1111-4111-8111-111111111111';
type RegisterBody = { graph: GraphV3T; brief_text: string; operation_id: string; expected_graph_identity_hash: null };
async function compile(records = sealedRecords(), heldNodes: unknown[] = []) {
  let registered: RegisterBody | undefined;
  const calls: string[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    calls.push(path);
    if (path.endsWith('/graph/register')) { registered = body as RegisterBody; return { status: 200, json: { model_version: 1 } }; }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: heldNodes, edges: [] } } };
    throw new Error(`unexpected offline dispatch ${path}`);
  };
  let request: Parameters<CallStructuredModel>[0] | undefined;
  const stub: CallStructuredModel = async req => { request = req; return { text: JSON.stringify(records), status: 'completed' }; };
  const result = await buildModelFromRecords(SCENARIO, BRIEF, dispatch, stub);
  return { result, registered, request, calls };
}

/** Independent path-product oracle over the PERSISTED coefficients, never sizeLink. */
function oracle(graph: GraphV3T, optionId: string): number {
  const goal = graph.nodes.find(node => node.kind === 'goal')!;
  const option = graph.nodes.find(node => node.id === optionId)!;
  const paths = (from: string, visited: Set<string>): number => {
    if (from === goal.id) return 1;
    if (visited.has(from)) throw new Error('oracle cycle');
    const next = new Set(visited).add(from);
    return graph.edges.filter(edge => edge.from === from && graph.nodes.find(node => node.id === edge.to)?.kind !== 'option')
      .reduce((sum, edge) => sum + edge.strength.mean * paths(edge.to, next), 0);
  };
  let delta = 0;
  for (const [factorId, intervention] of Object.entries(option.interventions ?? {})) {
    const factor = graph.nodes.find(node => node.id === factorId)!;
    const value = intervention as { value: number };
    delta += (value.value - (factor.observed_state?.value ?? 0)) * paths(factorId, new Set());
  }
  // The shared sizer stores six-significant-digit coefficients; settle GBP amounts to pennies.
  return Math.round((goal.observed_state!.baseline! + delta) * goal.goal_threshold_cap! * 100) / 100;
}

describe('Agent-route records bridge', () => {
  it('uses the same strictification and validates required nullable keys with local AJV', () => {
    const schema = buildStrictDraftRecordsSchema();
    expect(strictForTheDrafter(schema)).toEqual(schema);
    const walk = (node: unknown) => {
      if (node === null || typeof node !== 'object') return;
      const s = node as Record<string, unknown>;
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false);
        expect(s.required).toEqual(Object.keys(s.properties as object));
      }
      for (const value of Object.values(s)) { if (Array.isArray(value)) value.forEach(walk); else walk(value); }
    };
    walk(schema);
    const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
    const materialise = (value: unknown, node: Record<string, any>): unknown => {
      const shape = node.anyOf?.find((entry: any) => entry.type !== 'null') ?? node;
      if (Array.isArray(value)) return value.map(item => materialise(item, shape.items));
      if (!shape.properties || value === null || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(shape.properties).map(([key, child]) => [key,
        (key in value && (value as Record<string, unknown>)[key] !== undefined) ? materialise((value as Record<string, unknown>)[key], child as Record<string, any>) : null]));
    };
    const response = materialise(sealedRecords(), schema);
    expect(validate(response), JSON.stringify(validate.errors)).toBe(true);
    expect(omitOptionalRecordNulls(response)).toEqual(sealedRecords());
    const seam = projectDraftRecords(omitOptionalRecordNulls(response), BRIEF);
    expect(seam.ok).toBe(true);
    if (seam.ok) expect(seam.records).toEqual(sealedRecords());
    expect(validate({ stated_items: [{ kind: null, source_quote: '' }], claims: [] })).toBe(false);
  });
  it('asks for records, reuses the deterministic chain and registers with the same create-only operation', async () => {
    const { result, registered, request, calls } = await compile();
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: true, model_version: 1 });
    expect(request!.instructions).toBe(DRAFT_RECORDS_INSTRUCTION);
    expect(request!.schema).toEqual(buildStrictDraftRecordsSchema());
    expect(registered).toMatchObject({ brief_text: BRIEF, operation_id: constructionOperationId(SCENARIO, BRIEF), expected_graph_identity_hash: null });
    expect(calls).toEqual([`/assist/v1/scenarios/${SCENARIO}/graph`, `/assist/v1/scenarios/${SCENARIO}/graph/register`]);
    expect(GraphV3.safeParse(registered!.graph).success).toBe(true);
  });
  it('refuses a model another writer created before registration', async () => {
    const { result, registered } = await compile(sealedRecords(), [{ id: 'human-node' }]);
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'model_already_exists' });
    expect(registered).toBeUndefined();
  });
});

describe('Sealed M1/M2 compile', () => {
  it('persists a testable, deterministic graph with the exact path-product figures and effects', async () => {
    const first = await compile(); const second = await compile();
    expect(first.result, JSON.stringify(first.result)).toMatchObject({ ok: true });
    expect(second.result).toMatchObject({ ok: true });
    expect(JSON.stringify(first.registered)).toBe(JSON.stringify(second.registered));
    const graph = assignEntityRefs(projectGraphForPersistence(first.registered!.graph, {
      scenarioId: SCENARIO, turnClass: 'direct_answer', source: 'graph_registration',
    }), null).graph;
    const secondStored = assignEntityRefs(projectGraphForPersistence(second.registered!.graph, {
      scenarioId: SCENARIO, turnClass: 'direct_answer', source: 'graph_registration',
    }), null).graph;
    expect(JSON.stringify(graph)).toBe(JSON.stringify(secondStored));
    const goal = graph.nodes.find(node => node.kind === 'goal')!;
    expect(goal).toMatchObject({ goal_direction: '>=', goal_horizon_months: 9, threshold_source: 'brief_extraction' });
    const starter = graph.nodes.find(node => node.kind === 'option' && node.source_quote === 'launch a starter tier at £49 a month')!;
    const subscriberFactor = graph.nodes.find(node => node.id === graph.edges.find(edge => edge.provenance?.source_quote === sealedRecords().stated_items[12]!.source_quote)!.from)!;
    expect(starter.interventions![subscriberFactor.id]).toMatchObject({ range: { low: 80, high: 250, meaning: 'min_max', source: 'brief_extraction', source_quote: sealedRecords().stated_items[11]!.source_quote } });
    writeFileSync('/private/tmp/mc-spike-sealed-graph.json', JSON.stringify({ graph, brief_text: BRIEF }, null, 2));
    writeFileSync('/private/tmp/mc-spike-sealed-with-manifest.json', JSON.stringify({ graph, brief_text: BRIEF, not_modelled: deriveNotModelledManifest(BRIEF, graph) }, null, 2));
    expect(GraphStateIngressSchema.safeParse(graph).success).toBe(true);
    const testability = targetTestabilityOf(graph);
    const admission = resolveAnalysisAdmission(graph);
    const figures = Object.fromEntries(graph.nodes.filter(node => node.kind === 'option').map(option => [option.source_quote, oracle(graph, option.id)]));
    const verdicts = { testability, admission, oracle: figures, determinism: JSON.stringify(first.registered) === JSON.stringify(second.registered) };
    writeFileSync('/private/tmp/mc-spike-sealed-verdicts.json', JSON.stringify(verdicts, null, 2));
    expect(testability).toMatchObject({ kind: 'testable' });
    expect(JSON.stringify(admission)).not.toContain('TARGET_NOT_TESTABLE');
    expect(figures).toEqual({ 'raise prices by 10%': 126000, 'launch a starter tier at £49 a month': 127350, 'keep pricing as it is': 120000 });
    // P2-0 (pass 2): the support-cost clause (13) sizes an outcome outside the gross-MRR goal, so the connectivity
    // prune now withdraws it with its £6 disclosed (vnext-rows P2-0); readiness no longer refuses the whole model.
    expect(admission.permitted_analysis_mode).not.toBe('none');
    expect(graph.edges.some(edge => edge.provenance?.source_quote === sealedRecords().stated_items[13]!.source_quote)).toBe(false);
    for (const index of [8, 9, 10, 12]) {
      const stated = sealedRecords().stated_items[index]!;
      const authority = stated.relationship!;
      const edge = graph.edges.find(edge => edge.provenance?.source_quote === stated.source_quote);
      expect(edge?.provenance).toMatchObject({ magnitude: 'user_stated', source_quote: stated.source_quote, natural_effect: {
        amount: authority.amount, amount_unit: sealedRecords().stated_items[authority.to_quantity]!.unit, per_source_change: 1, per_source_change_unit: sealedRecords().stated_items[authority.from_quantity]!.unit,
      } });
    }
  });
});
