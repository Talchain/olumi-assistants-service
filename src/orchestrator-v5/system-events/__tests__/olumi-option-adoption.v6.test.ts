import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({
  loadPersistedGraphStrict: vi.fn(),
  loadPersistedScenarioStateStrict: vi.fn(),
  loadMostRecentPendingActionsIntegrityStrict: vi.fn(),
  commitDirectAnswer: vi.fn(),
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../build-turn-context.js')>()),
  loadPersistedGraphStrict: mocks.loadPersistedGraphStrict,
  loadPersistedScenarioStateStrict: mocks.loadPersistedScenarioStateStrict,
  loadMostRecentPendingActionsIntegrityStrict: mocks.loadMostRecentPendingActionsIntegrityStrict,
}));
vi.mock('../../commit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../commit.js')>()),
  commitDirectAnswer: mocks.commitDirectAnswer,
}));
// B8: the turn-fence claim the wrapper makes before the door writes (the store enforces the slot at commit).
vi.mock('../../session/index.js', () => ({ getSessionStore: () => ({ claimTurnFence: async (scenarioId: string, turnId: string) => ({ scenarioId, turnId, generation: 7 }) }) }));

import { computeExpectedGraphCasHashes } from '../../context/graph-cas-conflict.js';
import { modelVersionMutationReceiptFromResponse, toModelVersionMutationReceiptV1 } from '../../model-management/mutation-receipt.js';
import { applyOlumiOptionAdoption, commitOlumiOptionAdoptionInProcess } from '../olumi-option-adoption.js';
import { TurnFenceRejectedError } from '../../session/turn-fence.js';
import { runFencedInProcessWrite } from '../../../orchestrator/turn-fence-prehandler.js';
import { __setUseAppendV6ForTest } from '../../session/supabase-store.js';


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
  beforeEach(() => __setUseAppendV6ForTest(true));
  afterEach(() => __setUseAppendV6ForTest(false));

  it('changes participation and freshness while preserving identity, edges, and Olumi levels', () => {
    const before = graph();
    const snapshot = structuredClone(before);
    const applied = applyOlumiOptionAdoption(before, input(before));
    expect(applied.kind, JSON.stringify(applied)).toBe('mutated');
    if (applied.kind !== 'mutated') return;
    expect(before).toEqual(snapshot);
    const adopted = (applied.graph.nodes as unknown[]).find((n) => (n as { id?: string }).id === 'suggested') as Record<string, unknown>;
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
    expect((applied.graph.nodes as unknown[]).find((n) => (n as { id?: string }).id === 'raise_price_to_54'))
      .toMatchObject({ proposed_by: 'olumi', analysis_participation: 'included',
        interventions: option.interventions });
  });
});

describe('adoption commit receipt projection', () => {
  beforeEach(() => __setUseAppendV6ForTest(true));
  afterEach(() => __setUseAppendV6ForTest(false));

  beforeEach(() => {
    mocks.loadPersistedGraphStrict.mockReset();
    mocks.loadPersistedScenarioStateStrict.mockReset();
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
    let currentRevision = 23;
    mocks.loadPersistedScenarioStateStrict.mockImplementation(async () => ({ graph: before, briefText: null, revision: currentRevision }));
    mocks.loadPersistedGraphStrict.mockResolvedValueOnce(applied.graph);
    mocks.loadMostRecentPendingActionsIntegrityStrict.mockImplementation(async () => {
      // Advance the row after its graph/revision snapshot, before commit.
      currentRevision = 24;
      return [];
    });
    mocks.commitDirectAnswer.mockImplementation(async (_response, metadata) => {
      // The rival changes only the revision; the hash checks cannot detect it.
      expect(currentRevision).toBe(24);
      expect(metadata.expectedRevision).toBe(23);
      return {
      graphPersisted: true,
      thisAttemptWrote: true,
      persistedAnalysisGraphHash: applied.graph_hash,
      modelVersionReceipt: atomicReceipt,
      response: {
        response_version: 2, assistant_text: '', blocks: [], suggested_actions: [], insights: [], stage_indicator: 'frame',
        ...(attached ? { model_version_receipt: publicReceipt } : {}),
      },
      };
    });

    const result = await commitOlumiOptionAdoptionInProcess({
      scenario_id: scenarioId, turn_id: 'adopt-turn', ...request,
    }, 'test-request');
    expect(result.status).toBe('committed');
    expect(currentRevision).toBe(24);
    expect(mocks.loadPersistedScenarioStateStrict).toHaveBeenCalledOnce();
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

/**
 * ⛔ B8 (CODEX CR 5934133792 on #2456): a fence verdict through the REAL adoption door. The store refuses the write at
 * commit (`commitDirectAnswer` throws `TurnFenceRejectedError`), so NOTHING was written. The door used to swallow it as
 * `unconfirmed`, and the Agent then said "may have been saved" with `mutated: true`. It now reaches the fence wrapper with
 * the route's own mappings: a conflict is `stale`, an infrastructure refusal is the typed `refused`. Both are outcomes the
 * Agent reports as "nothing changed" (`agent-capabilities.ts`, the `res.status !== 'committed'` branch, `mutated: false`).
 */
describe('B8: a turn-fence verdict through the real adoption door', () => {
  beforeEach(() => __setUseAppendV6ForTest(true));
  afterEach(() => __setUseAppendV6ForTest(false));

  const SCENARIO = '550e8400-e29b-41d4-a716-446655440000';
  const STALE = { status: 'stale' as const };
  const REFUSED = (verdict: 'unclaimed' | 'unavailable') => ({ status: 'refused' as const, reason: `turn_fence_${verdict}` });
  const refusal = (verdict: 'superseded' | 'stopped' | 'unclaimed' | 'unavailable') =>
    new TurnFenceRejectedError(`fence ${verdict}`, { verdict, generation: 7, maxGeneration: 8 } as never);
  beforeEach(() => {
    mocks.loadPersistedGraphStrict.mockReset();
    mocks.loadPersistedScenarioStateStrict.mockReset();
    mocks.loadMostRecentPendingActionsIntegrityStrict.mockReset();
    mocks.commitDirectAnswer.mockReset();
  });
  const arm = (verdict: Parameters<typeof refusal>[0]) => {
    const before = graph();
    mocks.loadPersistedGraphStrict.mockResolvedValue(before);
    mocks.loadPersistedScenarioStateStrict.mockResolvedValue({ graph: before, briefText: null, revision: 23 });
    mocks.loadMostRecentPendingActionsIntegrityStrict.mockResolvedValue([]);
    mocks.commitDirectAnswer.mockRejectedValue(refusal(verdict));
    return { scenario_id: SCENARIO, turn_id: 'adopt-turn', ...input(before) };
  };

  it.each(['superseded', 'stopped', 'unclaimed', 'unavailable'] as const)('RED: the door lets a %s verdict out — never "unconfirmed"', async (verdict) => {
    await expect(commitOlumiOptionAdoptionInProcess(arm(verdict), 'test-request')).rejects.toBeInstanceOf(TurnFenceRejectedError);
    expect(mocks.commitDirectAnswer).toHaveBeenCalledTimes(1);
  });

  it.each(['superseded', 'stopped'] as const)('RED (door + wrapper, the route\'s mappings): %s → stale, nothing written', async (verdict) => {
    const req = arm(verdict);
    const out = await runFencedInProcessWrite(SCENARIO, 'adopt-turn', () => commitOlumiOptionAdoptionInProcess(req, 'test-request'), () => STALE, REFUSED);
    expect(out).toEqual(STALE);
  });

  it.each(['unclaimed', 'unavailable'] as const)('RED (door + wrapper): %s → the typed refusal, nothing written', async (verdict) => {
    const req = arm(verdict);
    const out = await runFencedInProcessWrite(SCENARIO, 'adopt-turn', () => commitOlumiOptionAdoptionInProcess(req, 'test-request'), () => STALE, REFUSED);
    expect(out).toEqual(REFUSED(verdict));
  });

  it('CONTROL: an ordinary commit failure is still "unconfirmed" (only fence verdicts changed)', async () => {
    const before = graph();
    mocks.loadPersistedGraphStrict.mockResolvedValue(before);
    mocks.loadPersistedScenarioStateStrict.mockResolvedValue({ graph: before, briefText: null, revision: 23 });
    mocks.loadMostRecentPendingActionsIntegrityStrict.mockResolvedValue([]);
    mocks.commitDirectAnswer.mockRejectedValue(new Error('network'));
    expect(await commitOlumiOptionAdoptionInProcess({ scenario_id: SCENARIO, turn_id: 'adopt-turn', ...input(before) }, 'test-request')).toEqual({ status: 'unconfirmed' });
  });
});
