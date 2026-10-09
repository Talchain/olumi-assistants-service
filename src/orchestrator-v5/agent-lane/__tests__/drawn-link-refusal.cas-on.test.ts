import { createHash } from 'node:crypto';
import { __setUseAppendV6ForTest } from '../../append-v6-flag.js';
import { narrateWriteOutcome, PARTIAL_WRITE_MESSAGES } from '../write-outcome.js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { OrchestratorTurnPayloadSchema, type SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { GraphStaleWriteError } from '../../session/store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { buildD1Fixture } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyStructuralAddEdge } from '../../system-events/structural-add-edge.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import type { AgentToolContext } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';

const SID = '22222222-2222-4222-8222-222222222222';
const PRESS = 'agent-drawn-link:f-budget>g-revenue';
const pair = { from: 'f-budget', to: 'g-revenue' };
const ctx: AgentToolContext = { scenario_id: SID, authenticated_user_id: null, request_id: 'drawn', user_turn_text: '', drawn_link: { ...pair, press_id: PRESS } };
const args = { from_label: 'f-budget', to_label: 'g-revenue', direction: 'negative' as const, strength: 'strong' as const, rationale: 'Capacity affects the outcome.', reason: 'Extra cost reduces the funds available.' };

function world(followUp = true, wrongStamp = false, beforeFollowUp?: (g: GraphV3T) => void, framingRace = false) {
  let revision = 7;
  const snapshots: Array<{ graph: GraphV3T; revision: number }> = [];
  let graph = buildD1Fixture();
  graph.edges = graph.edges.filter(e => e.from !== pair.from || e.to !== pair.to);
  const proposals = new ProposalStore();
  const events: SystemEventTurnPayload[] = [];
  const commits: CommitOptionLevelsInput[] = [];
  const rows: { id: string; write: SessionTurnWrite }[] = [];
  const store = createMockSessionStore({
    loadGraph: async () => structuredClone(graph),
    loadGraphAndBriefText: async () => {
      const snapshot = { graph: structuredClone(graph), revision };
      snapshots.push(snapshot);
      if (framingRace && snapshots.length === 1) revision += 1; // framing changes after A/r8 was captured; a reread sees r9
      return { ...snapshot, briefText: null };
    },
    readExistingScenario: async () => ({ userId: null, graph: structuredClone(graph), briefText: null, analysisInvalidatedAt: null }),
    readAnalysisInvalidatedAt: async () => null,
    append: async w => {
      if (w.expectedRevision !== revision) throw new GraphStaleWriteError('revision conflict', {
        conflict_category: 'revision_conflict', cause: { code: 'OLRV1', details: JSON.stringify({ expected: w.expectedRevision, current: revision }) },
  });
      revision += 1;
      const id = `drawn-row-${rows.length}`; rows.push({ id, write: JSON.parse(JSON.stringify(w)) }); if (w.graph !== undefined) graph = JSON.parse(JSON.stringify(w.graph)); return { id }; },
    readRecent: async () => rows.map(({ id, write }) => makeSessionTurnRow({ id, scenario_id: write.scenario_id, turn_id: write.turn_id, request_hash: write.request_hash })),
    readFactsWithTurnFor: async ids => rows.filter(row => ids.includes(row.id)).flatMap(({ id, write }) => write.handler_facts.map(fact => ({ turn_id: id, fact_created_at: '2026-10-07T00:00:00.000Z', fact }))),
  });
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(graph), graph_hash: computeAnalysisAffectingGraphHash(graph) } };
    const payload = OrchestratorTurnPayloadSchema.parse(body) as SystemEventTurnPayload;
    if (payload.event.kind !== 'structural_add_edge') throw new Error('Unexpected event');
    events.push(payload);
    const out = applyStructuralAddEdge({ payload, event: payload.event, requestId: 'drawn', persistedGraph: graph });
    if (out.kind !== 'mutated') throw new Error(JSON.stringify(out));
    graph = JSON.parse(JSON.stringify(out.mutatedGraph));
    revision += 1; // first structural save
    return { status: 200, json: { assistant_text: 'Connected.', graph_hash: computeAnalysisAffectingGraphHash(graph),
      model_version_receipt: { schema: 'model_version_mutation_receipt.v1', scenario_id: SID, mutation_id: SID,
        version_id: SID, sequence: 1, graph: structuredClone(graph), full_hash: 'a'.repeat(64),
        hash_algorithm: 'sha256', identity_projection_version: 'identity.v1', identity_normaliser_version: '1',
        graph_schema_version: 'graph_v3', analysis_affecting_hash: 'b'.repeat(64), actor: { kind: 'unknown' },
        creation: { kind: 'committed_mutation' }, source_turn_id: payload.turn_id, lineage: { kind: 'unknown' },
        undo_version_id: null, event_id: 'first-link-save' },
    } };

  };
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    commits.push(input);
    beforeFollowUp?.(graph);
    if (!followUp) return { status: 'refused', reason: 'unavailable' };
    const out = await executeOptionInterventionBatch({ scenarioId: input.scenario_id, turnId: input.turn_id,
      requestId: 'drawn', requestHash: input.turn_id, stage: 'frame', freshness: 'fresh', hasExistingAnalysis: false,
      expectedGraphHash: input.base_graph_hash, targets: [],
      linkStrengths: input.link_strengths!.map(l => ({ ...l, adopted: l.author === 'model_proposed' })),
    }, store);
    if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
    if (out.kind !== 'committed') throw new Error(JSON.stringify(out));
    if (wrongStamp) graph.edges.find(e => e.from === pair.from && e.to === pair.to)!.provenance!.source = 'user_specified';
    return { status: 'committed', graph_hash: out.analysisGraphHash, receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
  };
  return { snapshots, revision: () => revision, graph: () => structuredClone(graph), edge: () => graph.edges.find(e => e.from === pair.from && e.to === pair.to), events, commits, proposals,
    caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels }) };
}


beforeEach(() => __setUseAppendV6ForTest(true));
afterEach(() => __setUseAppendV6ForTest(true));
it('drawn-link save2 returned refusal retains link receipt with exact partial words', async () => {
  const w = world(false);
  const p = await w.caps.proposeModelChange(ctx, args);
  const result = await w.caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
  const words = 'The link was saved, but its accepted estimate detail could not be saved. Check the saved link and try accepting its estimate again.';
  expect(result).toMatchObject({ ok: false, mutated: true, applied: false, outcome: 'link_saved_estimate_refused',
    receipts: [expect.objectContaining({ version: 1, version_id: SID })] });
  expect(w.edge()).toBeDefined();
  expect(w.commits).toHaveLength(1);
  expect(w.events).toHaveLength(1);
  const specific = 'The link was added, but Olumi could not confirm its strength as the accepted Olumi estimate. Check the saved model before continuing.';
  expect(result.detail).toBe(`${specific} ${words}`);
  expect(narrateWriteOutcome('Nothing was saved. Useful reasoning.', [{ name: 'authorise_change' }], [result])).toMatchObject({ text: 'Useful reasoning.', status: `${specific} ${words}` });
  expect(createHash('sha256').update(PARTIAL_WRITE_MESSAGES.link_saved_estimate_refused).digest('hex')).toBe("d9824f74f9c334ae7e09a2527ea9e6a2d8909db82024616acd7010583c08e916");
});
