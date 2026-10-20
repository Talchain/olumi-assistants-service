/** L26: replay the recorded drafter/postimage through B's verifier and the REAL registration route. No provider calls. */
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { withScenarioRevision } from '../../../../../tests/utils/revision-store-double.js';
import { injectAsCeeWriter } from '../../../../../tests/utils/inject-as-cee-writer.js';
import capture from './fixtures/l26-live-save-8d44ed05.json';

const { storeRef } = vi.hoisted(() => ({ storeRef: { value: {} as object } }));
vi.mock('../../../../config/index.js', async (original) => {
  const actual = await original<typeof import('../../../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
vi.mock('../../../session/index.js', async (original) => ({
  ...await original<Record<string, unknown>>(), getSessionStore: () => withScenarioRevision(storeRef.value),
}));
vi.mock('../../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

import registerRoute from '../../../../routes/assist.v1.scenario-graph-register.js';
import { buildModel, type DraftDeps } from '../draft-tool.js';
import { approvedGraphHeld } from '../../../agent-lane/runtime/draft-replacement.js';
import { candidateToGraph } from '../candidate-to-graph.js';
import { computeGraphIdentityHash } from '../../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHashSha256 } from '../../../context/graph-hash.js';

type Rec = Record<string, any>;
const live: Rec = capture;

describe('L26 own saved draft truth', () => {
  it.each(['saved', 'missing-receipt', 'changed-postimage'] as const)('recorded live shape through the real register: %s', async (fault) => {
    const recordedAt = live.read.graph.nodes.find((n: Rec) => 'user_statements' in n)?.user_statements?.[0]?.recorded_at;
    expect(recordedAt).toBe('2026-10-20T09:19:39.958Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(recordedAt!));
    let saved: Rec | null = null;
    let ack: Rec = {};
    const append = vi.fn(async (write: Rec) => {
      saved = structuredClone(write.graph);
      return { id: 'turn-1', modelVersionReceipt: {
        ...write.modelVersion, version_id: 'v_1', version_number: 1, creation_kind: 'initial',
      } };
    });
    storeRef.value = {
      append, loadGraph: async () => saved,
      ensureScenarioExists: async () => ({ user_id: null }), getScenarioOwner: async () => null,
      scenarioExists: async () => true, readCommittedTurn: async () => null,
      readMostRecentPendingActions: async () => [],
    };
    const app = Fastify();
    let readCount = 0;
    try {
      await registerRoute(app);
      await app.ready();
      const dispatch: DraftDeps['dispatch'] = async (path, body) => {
        if (path.endsWith('/graph')) {
          readCount += 1;
          const postimage = saved !== null && fault === 'changed-postimage'
            ? { ...saved, nodes: saved.nodes.map((n: Rec, i: number) => i === 0 ? { ...n, label: 'Unrelated saved framing' } : n) } : saved;
          return { status: 200, json: saved === null
          ? { graph: null, graph_present: false }
          : { ...live.read, graph: postimage, graph_identity_hash: computeGraphIdentityHash(postimage as never),
            graph_hash: computeAnalysisAffectingGraphHashSha256(postimage as never)!.slice(0, 16) } };
        }
        const response = await injectAsCeeWriter(app, { method: 'POST', url: path, payload: body as Rec });
        ack = response.json();
        expect(response.statusCode).toBe(200);
        expect(ack.graph_identity_hash).toEqual(live.read.graph_identity_hash);
        expect(ack.graph_hash).toBe(live.read.graph_hash);
        expect(ack.model_version).toMatchObject({ version_id: 'v_1', version_number: 1, creation_kind: 'initial',
          graph_identity_hash: live.read.graph_identity_hash.value, analysis_affecting_hash: computeAnalysisAffectingGraphHashSha256(saved as never) });
        if (fault === 'missing-receipt') delete ack.model_version;
        return { status: response.statusCode, json: ack };
      };
      const out = await buildModel({ dispatch, callStructured: async () => ({ text: JSON.stringify(live.draft), status: 'completed' }) },
        { scenario_id: live.scenario_id, verified_user_messages: [live.brief], user_turn_text: live.brief }, { brief: live.brief });
      const converted = candidateToGraph(live.draft, { words: live.brief, recorded_at: recordedAt! });
      expect('refused' in converted).toBe(false);
      if ('refused' in converted) throw new Error(converted.refused);
      expect(approvedGraphHeld(converted.graph, live.read.graph)).toBe(true);
      expect(saved).toEqual(live.read.graph);
      expect(out).toMatchObject(fault === 'saved'
        ? { status: 'ok', mutated: true, data: { save_outcome: 'VERIFIED_SAVED' } }
        : { status: 'unavailable', reason: 'not_verified', write: 'unknown', data: { save_outcome: 'UNKNOWN' } });
      expect(readCount).toBe(2);
      expect(append).toHaveBeenCalledTimes(1);
    } finally { await app.close(); vi.useRealTimers(); }
  });
});
