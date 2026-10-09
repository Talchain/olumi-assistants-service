import { narrateWriteOutcome } from '../write-outcome.js';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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
import type { ModelCallRequest } from '../runtime/agent-loop.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import type { AgentToolContext } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipsFor } from '../approval-chips.js';
import { EDGE_STRENGTH_MIDPOINTS, edgeBandStd } from '../../format/edge-strength-bands.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';

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

describe('drawn pair, held proposal, approval and exact stored authorship', () => {
  it('press forces exactly one propose_model_change for the host pair', async () => {
    const { drawnLinkPress } = await import('../drawn-link-press.js');
    const w = world();
    const model = vi.fn(async (req: ModelCallRequest) => {
      expect(req.tool_choice).toEqual({ type: 'function', name: 'propose_model_change' });
      expect((req.tools as { name: string }[]).map(t => t.name)).toEqual(['propose_model_change']);
      return { output: [{ type: 'function_call', name: 'propose_model_change', call_id: 'dl', arguments: JSON.stringify(args) }] };
    });
    const result = await drawnLinkPress(PRESS, { ctx, history: [], message: '', instructions: '', maxOutputTokens: 500 }, w.graph(), w.caps, model);
    expect(model).toHaveBeenCalledTimes(1);
    expect(result.tool_calls).toEqual([expect.objectContaining({ name: 'propose_model_change', ok: true })]);
    expect(w.proposals.get(w.proposals.outstanding(SID, null)[0]!.proposal_id)!.operations[0]!.path).toBe('f-budget::g-revenue');
    expect(result.assistant_text).toContain(args.reason);
    expect(w.events).toEqual([]);
  });
  it('unknown, missing or malformed ids refuse without a tool or model call', async () => {
    const { drawnLinkPress } = await import('../drawn-link-press.js');
    const w = world(); const model = vi.fn();
    for (const id of ['agent-drawn-link:missing>g-revenue', 'agent-drawn-link:>g-revenue', 'agent-drawn-link:f-budget>g-revenue>other', 'agent-drawn-link:f-budget>f-budget']) {
      const r = await drawnLinkPress(id, { ctx, history: [], message: '', instructions: '', maxOutputTokens: 500 }, w.graph(), w.caps, model);
      expect(r.tool_calls).toEqual([]); expect(r.assistant_text).toMatch(/could not|cannot/i);
    }
    expect(model).not.toHaveBeenCalled();
  });
  it('host-bound band admitted; identical ordinary-turn band refused', async () => {
    const w = world();
    expect((await w.caps.proposeModelChange({ ...ctx, drawn_link: undefined }, args)).refusal).toBe('strength_not_stated');
    expect((await w.caps.proposeModelChange(ctx, args)).ok).toBe(true);
  });
  it('the model cannot switch the drawn pair, even with a typed band', async () => {
    const w = world();
    const r = await w.caps.proposeModelChange({ ...ctx, user_turn_text: 'strong' }, { ...args, from_label: 'f-quality', to_label: 'f-budget' });
    expect(r.refusal).toBe('drawn_pair_mismatch'); expect(w.proposals.outstanding(SID, null)).toEqual([]);
  });
  it('approve writes midpoint and sign, then reads model_proposed + accepted with the band spread', async () => {
    const w = world(); const p = await w.caps.proposeModelChange(ctx, args);
    const r = await w.caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, applied: true, mutated: true });
    expect(w.events[0]!.event).toMatchObject({ kind: 'structural_add_edge', ...pair, magnitude: EDGE_STRENGTH_MIDPOINTS.strong, effect_direction: 'negative' });
    expect(w.commits).toHaveLength(1);
    expect(w.commits[0]!.link_strengths).toEqual([expect.objectContaining({ ...pair, author: 'model_proposed', band: 'strong', intent: 'set' })]);
    expect(w.edge()).toMatchObject({ ...pair, effect_direction: 'negative', strength: { mean: -0.55, std: edgeBandStd('strong') }, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm', band: 'strong' } } });
    expect(linkSizing(w.edge())).toBe('olumi_accepted');
    expect(String(r.follow_up)).toContain('Olumi');
  });
  it('framing bump during the second save retains the link receipt and states partial success', async () => {
    const w = world(true, false, undefined, true);
      const p = await w.caps.proposeModelChange(ctx, args);
    const result = await w.caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(result).toMatchObject({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed',
      receipts: [expect.objectContaining({ version: 1, version_id: SID })] });
    expect(result.detail).toBe('The link was saved, but the scenario changed before its accepted estimate detail could be saved. Check the saved link and try accepting its estimate again.');
    expect(narrateWriteOutcome('', [{ name: 'authorise_change' }], [result]).status).toBe(result.detail);
    expect(JSON.stringify(result)).not.toContain('nothing was saved');
    expect(w.edge()).toBeDefined();
    expect(w.edge()!.provenance?.reviewed_by_user).toBeUndefined();
    expect(w.snapshots.map(snapshot => snapshot.revision)).toEqual([8]);
    expect(w.snapshots[0]!.graph.edges.find(edge => edge.from === pair.from && edge.to === pair.to)).toBeDefined();
    expect(w.revision()).toBe(9);
  });
  it('ordinary typed band still commits through plain structural_add_edge as user_specified', async () => {
    const w = world(); const p = await w.caps.proposeModelChange({ ...ctx, drawn_link: undefined, user_turn_text: 'strong' }, args);
    const r = await w.caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r.ok).toBe(true); expect(w.commits).toEqual([]);
    expect(w.edge()!.provenance!.source).toBe('user_specified');
  });
  it('stored card shows one-line reason, canvas words and approve/change/decline; decline writes no edge', async () => {
    const { drawnLinkPress } = await import('../drawn-link-press.js');
    const w = world(); const p = await w.caps.proposeModelChange(ctx, args); const id = String(p.proposal_id);
    const chips = approvalChipsFor([{ name: 'propose_model_change', ok: true, mutated: false, proposal_id: id }], pid => ({ proposal: w.proposals.get(pid), result: p }));
    expect(chips.map(c => c.label)).toEqual(['Approve', 'Change something first', 'Decline']);
    expect(chips[0]!.detail).toBe(`Olumi’s estimate: ‘Marketing budget’ hurts ‘Revenue’, strong. ${args.reason}`);
    const model = vi.fn();
    const r = await drawnLinkPress(chips[2]!.id, { ctx, history: [], message: '', instructions: '', maxOutputTokens: 500 }, w.graph(), w.caps, model);
    expect(r.mutated).toBe(false); expect(model).not.toHaveBeenCalled(); expect(w.edge()).toBeUndefined();
    expect(w.proposals.outstanding(SID, null)).toEqual([]);
  });
  it('digits, multiline, markup, em dash, missing or overlong reason refuse', async () => {
    for (const reason of ['Costs rise by 2.', 'Costs\nrise.', '**Costs** rise.', 'Costs rise — funds fall.', '', 'x'.repeat(141), undefined]) {
      const w = world(); const p = await w.caps.proposeModelChange(ctx, { ...args, reason });
      expect(p.refusal, reason).toBe('invalid_reason'); expect(w.proposals.outstanding(SID, null)).toEqual([]);
    }
  });
  it('existing pair refuses already_present with no graph change', async () => {
    const w = world(); const p = await w.caps.proposeModelChange(ctx, args);
    await w.caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    const before = w.graph(); const r = await w.caps.proposeModelChange(ctx, args);
    expect(r.refusal).toBe('already_present'); expect(w.graph()).toEqual(before);
  });
  it('follow-up refusal or wrong provenance never reports the complete approval as applied', async () => {
    for (const w of [world(false), world(true, true)]) {
      const p = await w.caps.proposeModelChange(ctx, args);
      const r = await w.caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
      expect(r).toMatchObject({ ok: false, applied: false, mutated: true });
      expect(r.refusal).toMatch(/not_verified|not_confirmed/);
    }
  });
  it('the internal exception never overwrites a link changed since its structural read-back', async () => {
    const w = world(true, false, g => {
      g.edges.find(e => e.from === pair.from && e.to === pair.to)!.provenance!.reasoning = 'A later user edit.';
    });
    const p = await w.caps.proposeModelChange(ctx, args);
    const r = await w.caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r).toMatchObject({ ok: false, mutated: true, applied: false, refusal: 'not_verified' });
    expect(w.edge()!.provenance).toEqual({ source: 'user_specified', reasoning: 'A later user edit.' });
  });
  it('a failed second transport preserves the added-link fact and reports unconfirmed', async () => {
    const w = world(true, false, () => { throw new Error('transport failed'); });
    const p = await w.caps.proposeModelChange(ctx, args);
    const r = await w.caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r).toMatchObject({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed' });
    expect(w.edge()).toBeDefined();
  });
  it('several model calls in one response cannot propose or mutate anything', async () => {
    const { drawnLinkPress } = await import('../drawn-link-press.js');
    const w = world();
    const r = await drawnLinkPress(PRESS, { ctx, history: [], message: '', instructions: '', maxOutputTokens: 500 }, w.graph(), w.caps,
      async () => ({ output: ['one', 'two'].map(call_id => ({ type: 'function_call', name: 'propose_model_change', call_id, arguments: JSON.stringify(args) })) }));
    expect(r.tool_calls).toEqual([]); expect(w.proposals.outstanding(SID, null)).toEqual([]); expect(w.edge()).toBeUndefined();
  });
  it('all canonical bands, both directions, read back with their own midpoint and spread', async () => {
    for (const strength of ['weak', 'moderate', 'strong', 'very strong'] as const) {
      for (const direction of ['positive', 'negative'] as const) {
        const w = world(); const p = await w.caps.proposeModelChange(ctx, { ...args, strength, direction });
        const r = await w.caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
        expect(r.ok, JSON.stringify(r)).toBe(true);
        expect(w.edge()!.strength).toEqual({ mean: (direction === 'negative' ? -1 : 1) * EDGE_STRENGTH_MIDPOINTS[strength], std: edgeBandStd(strength) });
        expect(w.edge()!.provenance).toMatchObject({ source: 'cee_hypothesis', magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm', band: strength } });
      }
    }
  });
  it('route dispatches drawn presses before the generic loop', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(route).toContain('isDrawnLinkPress'); expect(route).toContain('await drawnLinkPress(');
    expect(route.indexOf('await drawnLinkPress(')).toBeLessThan(route.indexOf('result = await runAgentTurn('));
  });
});
