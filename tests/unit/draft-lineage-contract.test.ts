import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureDraftLineage, draftRequestIdentity } from '../../src/cee/draft/records/lineage.js';
import { buildDraftRecordsSidecar } from '../../src/cee/draft/records/sidecar.js';
import { projectDraftRecords } from '../../src/cee/draft/records/seam.js';
import { buildLLMRawTrace, clearLLMOutputStore, getLLMOutput } from '../../src/cee/llm-output-store.js';
import { buildLlmMetadataProjection } from '../../src/cee/unified-pipeline/llm-metadata-projection.js';
import { adminLLMOutputRoutes } from '../../src/routes/admin.v1.llm-output.js';

vi.mock('../../src/middleware/admin-auth.js', () => ({
  verifyAdminKey: (request: { headers: Record<string, string> }, reply: { code: (status: number) => { send: (body: unknown) => void } }) => {
    if (request.headers['x-admin-key'] === 'allowed-test-key') return true;
    reply.code(403).send({ error: 'forbidden' });
    return false;
  },
}));

const brief = 'Grow revenue while keeping monthly churn under 4%.';
const records = {
  stated_items: [
    { kind: 'goal', source_quote: 'Grow revenue' },
    { kind: 'constraint', source_quote: 'keeping monthly churn under 4%', value: 4, unit: '%', direction: 'ceiling', applies_to_claim: 0 },
  ],
  claims: [
    { claim_kind: 'factor', label: 'Subscriber Churn Rate' },
    { claim_kind: 'causal_link', label: 'churn affects revenue', from_claim: 0, to_stated: 0, effect: 'negative' },
    { claim_kind: 'causal_link', label: 'unresolved detail', from_claim: 99, to_stated: 0, effect: 'negative' },
  ],
};
const requestBody = { model: 'test-model', system: [{ type: 'text', text: 'base' }, { type: 'text', text: 'records' }], messages: [{ role: 'user', content: brief }], max_tokens: 1000, output_config: { format: { schema: { type: 'object' } } } };
const rawText = JSON.stringify(records);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

function fixture() {
  const seam = projectDraftRecords(records, brief);
  if (!seam.ok) throw new Error(seam.reason);
  const selected = structuredClone(seam.records);
  selected.claims.push({ claim_kind: 'risk', label: 'A completion addition' });
  const selectedSeam = projectDraftRecords(selected, brief);
  if (!selectedSeam.ok) throw new Error(selectedSeam.reason);
  const sidecar = buildDraftRecordsSidecar({ records: selected, projection: selectedSeam.projection, instructionSha256: 'instruction', grammarSha256: 'grammar' });
  const receipt = captureDraftLineage({
    code_sha: 'code-sha',
    prompt: { base_prompt_hash: 'base', base_prompt_version: 'v202', instruction_sha256: 'instruction', grammar_sha256: 'grammar' },
    draft_request: draftRequestIdentity(requestBody),
    providerText: rawText, decodedInput: records, salvagedFromTruncation: false,
    initial_records: seam.records, selected_records: selected,
    completion: { attempted: true, kept: true, request: draftRequestIdentity({ model: 'test-model', messages: [{ role: 'user', content: 'complete' }] }), output_text: '{"claims":[{"claim_kind":"risk","label":"A completion addition"}]}' },
    projection: { graph: selectedSeam.projection.graph, bindings: sidecar.bindings, refusals: selectedSeam.projection.dropped, constraints: selectedSeam.projection.goalConstraints, constraint_carriage: 'diagnostic_only_not_forwarded_to_pipeline' },
  });
  return { receipt, seam: selectedSeam, selected };
}

describe('draft lineage uses the existing admin output store without changing product authority', () => {
  beforeEach(() => clearLLMOutputStore());

  it('distinguishes original decoded input, seam records, completion selection and named refusals', () => {
    const { receipt, seam, selected } = fixture();
    expect(receipt.provider_output.decoded_input).toEqual(records);
    expect(receipt.provider_output.text_sha256).toBe(hash(rawText));
    expect(receipt.initial_records.claims).toHaveLength(3);
    expect(receipt.selected_records.claims).toHaveLength(4);
    expect(receipt.projection.refusals).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'unresolved detail' })]));
    expect(receipt.projection.constraints).toHaveLength(1);
    expect(receipt.projection.constraints?.[0]).not.toHaveProperty('value_frame');
    expect(receipt.projection.graph).not.toHaveProperty('goal_constraints');
    selected.claims.length = 0;
    seam.projection.graph.nodes.length = 0;
    expect(receipt.selected_records.claims).toHaveLength(4);
    expect(receipt.projection.graph.nodes.length).toBeGreaterThan(0);
  });

  it('identity changes with appended instructions, attachments, grammar and retry parameters', () => {
    const base = draftRequestIdentity(requestBody);
    const changes = [
      { ...requestBody, system: [...requestBody.system, { type: 'text', text: 'changed instruction' }] },
      { ...requestBody, messages: [{ role: 'user', content: [brief, { type: 'document', source: 'attachment' }] }] },
      { ...requestBody, output_config: undefined },
      { ...requestBody, max_tokens: 500, temperature: 1 },
    ];
    for (const changed of changes) expect(draftRequestIdentity(changed).request_body_sha256).not.toBe(base.request_body_sha256);
    expect(base.system_sha256).toBe(hash(JSON.stringify(requestBody.system)));
    expect(base.messages_sha256).toBe(hash(JSON.stringify(requestBody.messages)));
  });

  it('stores a detached post-repair snapshot without claiming a saved canonical graph', () => {
    const { receipt } = fixture();
    const graph = { nodes: [{ id: 'post-repair' }], edges: [] };
    const trace = buildLLMRawTrace('lineage-run', rawText, graph, { draftLineage: { receipt, goalConstraints: [] } });
    const stored = getLLMOutput('lineage-run')!;
    expect(stored.draftLineage?.pipeline).toEqual({ boundary: 'post_repair_package_before_v3_and_persistence', snapshot_sha256: hash(JSON.stringify(graph)), goal_constraints: [], canonical_save: 'not_witnessed_here' });
    expect(stored.draftLineage?.adapter.projection.constraints).toHaveLength(1);
    graph.nodes.length = 0;
    receipt.selected_records.claims.length = 0;
    expect(stored.parsedJson).toEqual({ nodes: [{ id: 'post-repair' }], edges: [] });
    expect(stored.draftLineage?.adapter.selected_records.claims).toHaveLength(4);
    expect(trace).not.toHaveProperty('draft_lineage');
    expect(trace).not.toHaveProperty('draftLineage');
    expect(buildLlmMetadataProjection({ model: 'test-model', raw_draft_lineage: receipt }, undefined)).not.toHaveProperty('raw_draft_lineage');
    buildLLMRawTrace('lineage-run', 'later text', { nodes: [] }, { draftLineage: { receipt, goalConstraints: ['later'] } });
    expect(getLLMOutput('lineage-run')?.draftLineage?.pipeline.goal_constraints).toEqual([]);
    expect(getLLMOutput('lineage-run')?.rawText).toBe(rawText);
  });

  it('exposes lineage through the authenticated admin route only', async () => {
    const { receipt } = fixture();
    buildLLMRawTrace('admin-lineage', rawText, { nodes: [], edges: [] }, { draftLineage: { receipt, goalConstraints: [] } });
    const app = Fastify();
    await app.register(adminLLMOutputRoutes);
    try {
      const denied = await app.inject({ method: 'GET', url: '/admin/v1/llm-output/admin-lineage' });
      expect(denied.statusCode).toBe(403);
      expect(denied.body).not.toContain('draft_lineage');
      const allowed = await app.inject({ method: 'GET', url: '/admin/v1/llm-output/admin-lineage', headers: { 'x-admin-key': 'allowed-test-key' } });
      expect(allowed.statusCode).toBe(200);
      expect(allowed.json().draft_lineage.adapter.provider_output.decoded_input).toEqual(records);
      expect(allowed.json().draft_lineage.pipeline.canonical_save).toBe('not_witnessed_here');
    } finally { await app.close(); }
  });
});
