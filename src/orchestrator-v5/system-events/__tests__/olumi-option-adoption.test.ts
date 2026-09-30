import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({
  loadPersistedGraphStrict: vi.fn(),
  loadMostRecentPendingActionsIntegrityStrict: vi.fn(),
  commitDirectAnswer: vi.fn(),
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../build-turn-context.js')>()),
  loadPersistedGraphStrict: mocks.loadPersistedGraphStrict,
  loadMostRecentPendingActionsIntegrityStrict: mocks.loadMostRecentPendingActionsIntegrityStrict,
}));
vi.mock('../../commit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../commit.js')>()),
  commitDirectAnswer: mocks.commitDirectAnswer,
}));

import { computeExpectedGraphCasHashes } from '../../context/graph-cas-conflict.js';
import { modelVersionMutationReceiptFromResponse, toModelVersionMutationReceiptV1 } from '../../model-management/mutation-receipt.js';
import { applyOlumiOptionAdoption, commitOlumiOptionAdoptionInProcess } from '../olumi-option-adoption.js';

const graph = () => ({
  nodes: [
    { id: 'decision', kind: 'decision', label: 'Which price?' },
    { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.49, source: 'brief_extraction' } },
    { id: 'keep', kind: 'option', label: 'Keep £49', interventions: { price: { value: 0.49, source: 'brief_extraction' } } },
    { id: 'raise', kind: 'option', label: 'Raise to £59', interventions: { price: { value: 0.59, source: 'brief_extraction' } } },
    { id: 'suggested', kind: 'option', label: 'Raise to £54', proposed_by: 'olumi',
      interventions: { price: { value: 0.54, source: 'cee_hypothesis' } } },
  ],
  edges: [
    { from: 'decision', to: 'keep', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'decision', to: 'raise', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'decision', to: 'suggested', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'suggested', to: 'price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
  ],
});

const input = (g: ReturnType<typeof graph>) => {
  const hashes = computeExpectedGraphCasHashes(g);
  return {
    option_id: 'suggested',
    expected_label: 'Raise to £54',
    expected_interventions: { price: { value: 0.54, source: 'cee_hypothesis' } },
    base_graph_hash: hashes.expectedGraphAnalysisHash!,
    expected_graph_identity_hash: hashes.expectedGraphIdentityHash!,
  };
};

describe('pressing an Olumi option into the comparison', () => {
  it('changes participation and freshness while preserving identity, edges, and Olumi levels', () => {
    const before = graph();
    const snapshot = structuredClone(before);
    const applied = applyOlumiOptionAdoption(before, input(before));
    expect(applied.kind, JSON.stringify(applied)).toBe('mutated');
    if (applied.kind !== 'mutated') return;
    expect(before).toEqual(snapshot);
    const adopted = applied.graph.nodes.find((n: unknown) => (n as { id?: string }).id === 'suggested') as Record<string, unknown>;
    expect(adopted).toMatchObject({ proposed_by: 'olumi', analysis_participation: 'included',
      interventions: { price: { value: 0.54, source: 'cee_hypothesis' } } });
    expect(applied.graph.edges).toEqual(before.edges);
    expect(applied.graph.nodes).toHaveLength(before.nodes.length);
    expect(applied.graph_hash).not.toBe(input(before).base_graph_hash);
  });

  it('refuses a changed reading and a moved base before any mutation', () => {
    const before = graph();
    expect(applyOlumiOptionAdoption(before, { ...input(before), expected_label: 'Another £54' }).kind).toBe('stale');
    expect(applyOlumiOptionAdoption(before, { ...input(before), base_graph_hash: '0'.repeat(16) }).kind).toBe('stale');
    expect(before.nodes.find((n) => n.id === 'suggested')).not.toHaveProperty('analysis_participation');
  });

  it('accepts the stored pricing graph shape with the existing £54 suggestion', () => {
    const fixture = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/served-c96fc4bb-registered-graph-77afc7b.json', import.meta.url), 'utf8')) as {
      graph: { nodes: Array<Record<string, unknown>> };
    };
    const before = fixture.graph;
    const option = before.nodes.find((n) => n.id === 'raise_price_to_54')!;
    const cas = computeExpectedGraphCasHashes(before);
    const applied = applyOlumiOptionAdoption(before, {
      option_id: 'raise_price_to_54', expected_label: String(option.label),
      expected_interventions: option.interventions as Record<string, unknown>,
      base_graph_hash: cas.expectedGraphAnalysisHash!,
      expected_graph_identity_hash: cas.expectedGraphIdentityHash!,
    });
    expect(applied.kind, JSON.stringify(applied)).toBe('mutated');
    if (applied.kind !== 'mutated') return;
    expect(applied.graph.nodes.find((n: unknown) => (n as { id?: string }).id === 'raise_price_to_54'))
      .toMatchObject({ proposed_by: 'olumi', analysis_participation: 'included',
        interventions: option.interventions });
  });
});

describe('adoption commit receipt projection', () => {
  beforeEach(() => {
    mocks.loadPersistedGraphStrict.mockReset();
    mocks.loadMostRecentPendingActionsIntegrityStrict.mockReset();
    mocks.commitDirectAnswer.mockReset();
  });

  it.each([true, false])('returns only the attached public receipt (attached: %s)', async (attached) => {
    const scenarioId = '550e8400-e29b-41d4-a716-446655440000';
    const before = graph();
    const request = input(before);
    const applied = applyOlumiOptionAdoption(before, request);
    expect(applied.kind).toBe('mutated');
    if (applied.kind !== 'mutated') return;

    const atomicReceipt = {
      mutation_id: 'cb1dd25d-36c3-4beb-aadf-5a016b2bce25',
      version_id: 'c0813c01-1111-4111-8111-111111111111',
      version_number: 2,
      graph: applied.graph,
      graph_identity_hash: 'a'.repeat(64),
      analysis_affecting_hash: 'b'.repeat(64),
      hash_algorithm: 'sha256',
      identity_projection_version: 'identity.v1',
      identity_normaliser_version: '1',
      graph_schema_version: 'graph_v3',
      actor_kind: 'system' as const,
      authored_by: null,
      creation_kind: 'committed_mutation' as const,
      source_version_id: null,
      source_turn_id: 'adopt-turn',
      parent_version_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      root_version_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      undo_version_id: null,
      event_id: 'model_version_created_mutation_cb1dd25d-36c3-4beb-aadf-5a016b2bce25',
    };
    const publicReceipt = toModelVersionMutationReceiptV1(scenarioId, atomicReceipt);
    mocks.loadPersistedGraphStrict.mockResolvedValueOnce(before).mockResolvedValueOnce(applied.graph);
    mocks.loadMostRecentPendingActionsIntegrityStrict.mockResolvedValue([]);
    mocks.commitDirectAnswer.mockResolvedValue({
      graphPersisted: true,
      thisAttemptWrote: true,
      persistedAnalysisGraphHash: applied.graph_hash,
      modelVersionReceipt: atomicReceipt,
      response: {
        response_version: 2, assistant_text: '', blocks: [], suggested_actions: [], insights: [], stage_indicator: 'frame',
        ...(attached ? { model_version_receipt: publicReceipt } : {}),
      },
    });

    const result = await commitOlumiOptionAdoptionInProcess({
      scenario_id: scenarioId, turn_id: 'adopt-turn', ...request,
    }, 'test-request');
    expect(result.status).toBe('committed');
    expect(result).not.toHaveProperty('model_version_receipt.version_number');
    if (attached) {
      expect(result).toHaveProperty('model_version_receipt.sequence', 2);
      expect(modelVersionMutationReceiptFromResponse(result)?.version_id).toBe(atomicReceipt.version_id);
    } else {
      // A raw DB carrier alone cannot justify a public version claim.
      expect(result).not.toHaveProperty('model_version_receipt');
    }
  });
});
