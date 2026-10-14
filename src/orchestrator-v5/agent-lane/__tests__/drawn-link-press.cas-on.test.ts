import { createHash } from 'node:crypto';
import { __setUseAppendV6ForTest } from '../../append-v6-flag.js';
import { narrateWriteOutcome } from '../write-outcome.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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


const CONFLICT_WORDS = 'The link was saved, but the scenario changed before its accepted estimate detail could be saved. Check the saved link and try accepting its estimate again.';
const CONFLICT_SHA256 = 'd8b3d2ba36e316f920bd383c7fc0f7a28d893c206b887a9acb866c660b7145d4';

beforeEach(() => __setUseAppendV6ForTest(true));
afterEach(() => __setUseAppendV6ForTest(true));

describe('CAS ON: drawn-link save 2 refusal copy', () => {
  it('revision refusal at save 2 gives the exact capability detail and write-outcome narrator line', async () => {
    const w = world(true, false, undefined, true);
    const p = await w.caps.proposeModelChange(ctx, args);
    const result = await w.caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    const line = narrateWriteOutcome('', [{ name: 'authorise_change' }], [result]).status;
    if (line === null) throw new Error('Write status missing from the narrator');
    expect(result).toMatchObject({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed',
      outcome: 'link_saved_estimate_not_saved', receipts: [expect.objectContaining({ version: 1, version_id: SID })] });
    expect(result.detail).toBe(CONFLICT_WORDS);
    expect(line).toBe(CONFLICT_WORDS);
    expect(createHash('sha256').update(result.detail as string).digest('hex')).toBe(CONFLICT_SHA256);
    expect(createHash('sha256').update(line).digest('hex')).toBe(CONFLICT_SHA256);
    expect(w.commits).toHaveLength(1);
    expect(w.events).toHaveLength(1);
    expect(w.edge()).toBeDefined();
    expect(w.edge()!.provenance?.reviewed_by_user).toBeUndefined();
    expect(w.snapshots.map(snapshot => snapshot.revision)).toEqual([8]);
    expect(w.revision()).toBe(9);
  });

  it('non-conflict not_confirmed failure at save 2 retains its exact existing words and excludes conflict copy', async () => {
    const w = world(true, false, () => { throw new Error('transport failed'); });
    const p = await w.caps.proposeModelChange(ctx, args);
    const result = await w.caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    const line = narrateWriteOutcome('', [{ name: 'authorise_change' }], [result]).status;
    expect(result).toMatchObject({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed' });
    expect(result.detail).toBe('The link was added, but recording its accepted Olumi estimate could not be confirmed. Check the saved model before continuing.');
    expect(line).toBe('The change was sent, but it could not be confirmed: Olumi could not read the model back afterwards. Ask me to check whether it was recorded.');
    expect(result.detail).not.toContain(CONFLICT_WORDS);
    expect(line).not.toContain(CONFLICT_WORDS);
    expect(w.commits).toHaveLength(1);
    expect(w.events).toHaveLength(1);
    expect(w.edge()).toBeDefined();
  });
});
