/**
 * ⛔ A FACTOR ID IS DATA, NEVER VOCABULARY — ON THE PATH AS WELL AS IN THE PAYLOAD.
 *
 * MEASURED on served staging `3f412be1` (OpenAI Connected witness `c6b`, scenario
 * `de47c755…`, 24 Sep 01:47:59Z): an approved starting point wrote 4/4 factor values and
 * 0/3 option levels, so the pricing model could never run from the proposal the user
 * approved. The Render log: `v5.candidate_mutation.rejected`, `update_node_field`,
 * `PIPELINE_OWNED_FIELD`, for option `59_with_feature_release` → factor `pro_feature_value`.
 *
 * The writer's candidate addresses exactly `data/interventions/<factor_id>`, and the
 * referee's PATH screen substring-matched the marker `e_value` (meant for e-values) inside
 * `pro_featur·e_value`. A factor id that IS an owned word (`origin`) was refused by the
 * segment screen too. The PAYLOAD screen already knows the rule (`factor_map`: "its keys
 * are FACTOR IDS, not field names, so they are never screened as vocabulary"); the path
 * screen did not. The contract key AFTER the factor id (`…/<fid>/source`) stays screened,
 * so the provenance guard is unchanged.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { normaliseGraphNodeKindField } from '../../graph-registration/normalise-node-kind.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyOptionInterventionEdit, prepareOptionInterventionEdit } from '../option-intervention-edit.js';
import { parseEditGraphResponse } from '../../../orchestrator/tools/edit-graph.js';
import { validatePatchOperations } from '../../../orchestrator/patch-validation.js';
import { editOperationsToCandidateEnvelopes } from '../../graph-management/adapters/edit-graph-producer.js';
import { parseEnvelope } from '../../graph-management/parse-envelope.js';
import { checkFieldSafety } from '../../graph-management/field-safety.js';

const SCENARIO = '55555555-5555-4555-8555-555555555555';
const SIBLING = { pro_plan_price: { value: 0.295, source: 'brief_extraction' } };

/** The served pricing graph, with `factorId` present and linked from the option. */
function graphWith(factorId: string) {
  const g = JSON.parse(readFileSync(join(__dirname, '../../agent-lane/__tests__/fixtures/served-pricing-graph-c4a6cce.json'), 'utf8'));
  const opt = g.nodes.find((n: { id: string }) => n.id === 'raise_with_release');
  opt.interventions = structuredClone(SIBLING);
  if (!g.nodes.some((n: { id: string }) => n.id === factorId)) {
    g.nodes.push({ id: factorId, kind: 'factor', label: `Factor ${factorId}` });
    g.edges.push({ ...g.edges.find((e: { from: string; to: string }) => e.from === 'raise_with_release' && e.to === 'pro_plan_price'), from: 'raise_with_release', to: factorId });
    g.edges.push({ ...g.edges.find((e: { from: string; to: string }) => e.from === 'pro_plan_price' && e.to === 'perceived_pro_value'), from: factorId, to: 'perceived_pro_value' });
  }
  const n = normaliseGraphNodeKindField(g);
  if (!n.ok) throw new Error(n.reason);
  return projectGraphForPersistence(GraphStateIngressSchema.parse(n.graph), { scenarioId: SCENARIO, turnClass: 'direct_answer', source: 'graph_registration' });
}

function edit(factorId: string) {
  const g = graphWith(factorId);
  const hash = computeAnalysisAffectingGraphHash(g as never)!;
  return applyOptionInterventionEdit({
    persistedGraph: g, optionId: 'raise_with_release', factorId, modelValue: 0.4, expectedGraphHash: hash,
    scenarioId: SCENARIO, turnId: 'turn-t', requestId: 'req-t', freshness: 'none', hasExistingAnalysis: false,
  });
}

/** The REAL envelope the writer produces for this factor, parsed exactly as the referee sees it. */
function realEnvelope(factorId: string) {
  const g = graphWith(factorId);
  const hash = computeAnalysisAffectingGraphHash(g as never)!;
  const prep = prepareOptionInterventionEdit({ persistedGraph: g, optionId: 'raise_with_release', factorId, modelValue: 0.4, expectedGraphHash: hash });
  if (prep.kind !== 'prepared') throw new Error(`not prepared: ${JSON.stringify(prep)}`);
  const raw = parseEditGraphResponse(JSON.stringify({ operations: [prep.operation], removed_edges: [], warnings: [], coaching: null })).operations;
  const v = validatePatchOperations(raw, g as never);
  const [env] = editOperationsToCandidateEnvelopes(v.operations as never, { base_graph_hash: hash, scenario_id: SCENARIO, turn_id: 't', makeCandidateId: () => '00000000-0000-4000-8000-000000000001' });
  const parsed = parseEnvelope(env);
  if (!parsed.ok) throw new Error('envelope did not parse');
  return parsed.envelope;
}
const withField = (e: ReturnType<typeof realEnvelope>, field: string) =>
  ({ ...e, payload: { ...(e as { payload: Record<string, unknown> }).payload, field } }) as typeof e;

describe('an option level is writable whatever its factor is called', () => {
  it.each(['pro_feature_value', 'price_elasticity', 'customer_lifetime_value', 'origin'])(
    'RED: a level on factor `%s` is written, and the brief-stated sibling is untouched', (factorId) => {
      const res = edit(factorId);
      expect(res.kind, JSON.stringify(res)).toBe('candidate');
      const iv = (res as { graph: { nodes: { id: string; interventions?: Record<string, unknown> }[] } }).graph.nodes
        .find((n) => n.id === 'raise_with_release')!.interventions!;
      expect(iv['pro_plan_price'], 'the sibling, byte for byte, provenance included').toEqual(SIBLING.pro_plan_price);
      expect((iv[factorId] as { value?: unknown }).value).toBe(0.4);
    });

  it('CONTROL: an ordinary factor id was always writable (the defect is the id, not the write)', () => {
    expect(edit('price_change_timing').kind).toBe('candidate');
  });
});

describe('the referee still refuses everything it owns', () => {
  const env = realEnvelope('price_change_timing');
  it('the real envelope addresses exactly data/interventions/<factor_id>', () => {
    expect((env as { payload: { field: string } }).payload.field).toBe('data/interventions/price_change_timing');
    expect(checkFieldSafety(env)).toEqual({ ok: true });
  });
  it.each([
    ['a provenance stamp AFTER the factor id', 'data/interventions/pro_feature_value/source'],
    ['an owned root', 'data/origin'],
    ['an owned marker outside interventions', 'data/sensitivity_score'],
    ['a marker as a whole segment outside interventions', 'data/elasticity'],
    ['nested observed provenance', 'observed_state/provenance'],
  ])('CONTRAST: %s is still PIPELINE_OWNED_FIELD', (_l, field) => {
    expect(checkFieldSafety(withField(env, field))).toMatchObject({ ok: false, code: 'PIPELINE_OWNED_FIELD' });
  });
});
