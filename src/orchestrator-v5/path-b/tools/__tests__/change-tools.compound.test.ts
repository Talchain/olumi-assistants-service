/**
 * GAP 2 — A COMPLETE CHANGE IS ONE COMMIT (DL ruling B, 19 Oct 2026: "Extend the DOOR"). A figure, Olumi's band for a link and a
 * rename (or a removal) proposed together are ONE proposal, applied by ONE door commit with its own receipt and the full
 * approved postimage read back. Each member is prepared as it would be alone (the renames and removals by the existing
 * proposers, carried literally); one refused member refuses the whole change before any write, never a first half. Every
 * other caller's link set stays ALONE (`link_strengths_not_alone`), byte for byte.
 * SYNTHETIC wording. Only the session store and the scenario's read routes are faked; the door and its writers are real.
 */
import { createHash } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { linkProvenanceOf, provenanceOf } from '../../../../cee/provenance/provenance-of.js';
import { graph as fixtureGraph, type Rec } from './fixtures.js';

const SCN = '5c5c5c5c-0000-4000-8000-000000000029';
type Receipt = { version_number: number; version_id: string; mutation_id: string; source_turn_id: string };
let persisted: unknown;
const rows = new Map<string, { id: string; write: Record<string, unknown>; receipt?: Receipt }>();

vi.mock('../../../session/index.js', () => ({
  getSessionStore: () => ({
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    readMostRecentPendingActions: async () => [],
    readFactsFor: async () => [],
    readRecent: async () => [...rows.values()].reverse().map((r) => ({
      id: r.id, scenario_id: r.write.scenario_id, turn_id: r.write.turn_id, turn_class: r.write.turn_class,
      handler_id: r.write.handler_id, request_hash: r.write.request_hash, response_emitted: r.write.response_emitted,
      llm_calls_used: r.write.llm_calls_used, duration_ms: r.write.duration_ms, assistant_message: null, created_at: '2026-10-19T12:00:00.000Z',
    })),
    readFactsWithTurnFor: async (ids: readonly string[]) => [...rows.values()].flatMap((r) => !ids.includes(r.id) ? []
      : ((r.write.handler_facts ?? []) as unknown[]).map((fact) => ({ turn_id: r.id, fact_created_at: '2026-10-19T12:00:00.000Z', fact }))),
    append: async (write: Record<string, unknown>) => {
      const key = `${String(write.scenario_id)}/${String(write.turn_id)}`;
      const existing = rows.get(key);
      if (existing !== undefined) return { id: existing.id, replayedPriorTurn: true };
      const id = `row-${rows.size + 1}`;
      const mv = write.modelVersion as { graph_identity_hash: string; analysis_affecting_hash: string } | undefined;
      const receipt = write.graph === undefined || mv === undefined ? undefined : {
        mutation_id: String(write.turn_id), version_id: `dddddddd-dddd-4ddd-8ddd-${String(rows.size + 2).padStart(12, '0')}`, version_number: rows.size + 2,
        graph_identity_hash: mv.graph_identity_hash, analysis_affecting_hash: mv.analysis_affecting_hash, hash_algorithm: 'sha256',
        identity_projection_version: 'v1', identity_normaliser_version: 'v1', graph_schema_version: 'graph.v3',
        actor_kind: 'unknown' as const, authored_by: null, creation_kind: 'committed_mutation' as const, source_version_id: null,
        source_turn_id: String(write.turn_id), parent_version_id: null, root_version_id: null, undo_version_id: null,
        graph: JSON.parse(JSON.stringify(write.graph)) as unknown, event_id: `event-${String(write.turn_id)}`,
      };
      rows.set(key, { id, write: JSON.parse(JSON.stringify(write)) as Record<string, unknown>, ...(receipt === undefined ? {} : { receipt }) });
      if (write.graph !== undefined) persisted = write.graph;
      return { id, ...(receipt === undefined ? {} : { modelVersionReceipt: receipt }) };
    },
    getScenarioOwner: async () => null,
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const identityOf = (g: unknown): string => createHash('sha256').update(JSON.stringify(g)).digest('hex');
const dispatch = vi.fn(async (path: string): Promise<{ status: number; json: Rec }> => {
  if (path === `/assist/v1/scenarios/${SCN}/graph`) {
    return { status: 200, json: { graph: persisted as Rec, brief_text: null, graph_hash: computeAnalysisAffectingGraphHash(persisted as never),
      graph_identity_hash: { kind: 'graph_identity', value: identityOf(persisted), algorithm: 'sha256' } } };
  }
  if (path === `/assist/v1/scenarios/${SCN}/versions`) {
    const versions = [...rows.values()].filter((r) => r.receipt !== undefined).reverse().map((r) => ({
      version_id: r.receipt!.version_id, sequence: r.receipt!.version_number,
      creation: { kind: 'committed_mutation', mutation_id: r.receipt!.mutation_id, source_turn_id: r.receipt!.source_turn_id } }));
    return { status: 200, json: { versions } };
  }
  throw new Error(`unscripted ${path}`);
});

/** The fixture with ranges on the queue (0–100 minutes), and the staff → goal link as Olumi's estimate. */
function stored(): unknown {
  const g = fixtureGraph() as { nodes: Rec[]; edges: Rec[] };
  const nodes = g.nodes.map((n) => n.id === 'queue' ? { ...n, observed_state: { value: 0.3, raw_value: 30, unit: 'minutes', cap: 100 } } : n);
  const edges = g.edges.map((e) => e.from === 'staff' && e.to === 'goal' ? { ...e, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } } : e);
  return projectGraphForPersistence({ ...GraphV3.parse({ ...g, nodes, edges }), options: [] as Rec[] });
}
const nodeOf = (id: string): Rec | undefined => (persisted as { nodes: Rec[] }).nodes.find((n) => n.id === id);
const edgeOf = (from: string, to: string): Rec | undefined => (persisted as { edges: Rec[] }).edges.find((e) => e.from === from && e.to === to);

const SAID = 'The queue is about 20 minutes on a Saturday. Rename Ticket price to Entry price. Take Walk-in visits next week out of the model.';
const ctx = { scenario_id: SCN, authenticated_user_id: 'user-a', request_id: 'req-c5', turn_id: 'turn-c5', user_turn_text: SAID, verified_user_messages: [SAID] };
const queueTo20 = { op: 'set_factor_value', factor_id: 'queue', value: 20, unit: 'minutes', stance: 'stated_current',
  source: { origin: 'user', quote: 'about 20 minutes', named_source: null } };
const staffBand = { op: 'set_link_strength', from: 'staff', to: 'goal', band: 'moderate', stance: 'estimate', source: { origin: 'olumi', quote: null, named_source: null } };
const renamePrice = (label = 'Entry price', quote = 'Rename Ticket price to Entry price.') =>
  ({ op: 'rename', kind: 'factor', target_id: 'price', new_label: label, quote });
const removeVisits = { op: 'remove_from_model', kind: 'factor', target_id: 'visits', to_id: null, quote: 'Take Walk-in visits next week out of the model.' };

type Mod = typeof import('../change-tools.js');
let proposeChange: Mod['proposeChange'];
let applyChange: Mod['applyChange'];
let ProposalStore: typeof import('../../../agent-lane/proposal.js').ProposalStore;
let authorisationTurnId: typeof import('../../../agent-lane/runtime/agent-capabilities.js').authorisationTurnId;
let createAgentCapabilities: typeof import('../../../agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
let commitOptionLevelsInProcess: typeof import('../../../system-events/dispatch.js').commitOptionLevelsInProcess;
beforeAll(async () => {
  ({ proposeChange, applyChange } = await import('../change-tools.js'));
  ({ ProposalStore } = await import('../../../agent-lane/proposal.js'));
  ({ authorisationTurnId, createAgentCapabilities } = await import('../../../agent-lane/runtime/agent-capabilities.js'));
  ({ commitOptionLevelsInProcess } = await import('../../../system-events/dispatch.js'));
});
beforeEach(() => {
  persisted = stored();
  rows.clear();
  dispatch.mockClear();
});

const door = () => vi.fn((input: Parameters<typeof commitOptionLevelsInProcess>[0]) => commitOptionLevelsInProcess(input, 'req-c5'));
function deps(commit = door()) {
  const proposals = new ProposalStore();
  const caps = createAgentCapabilities(dispatch as never, proposals, undefined, 'full', undefined, { commitOptionLevels: commit });
  return { dispatch, proposals, commitOptionLevels: commit,
    proposeLinkStrengths: (cx: Rec, a: Rec) => caps.proposeLinkStrengths!({ request_id: 'req-c5', ...cx } as never, a as never) };
}
const saying = (words: string) => ({ ...ctx, user_turn_text: words, verified_user_messages: [words] });
const propose = (d: ReturnType<typeof deps>, ops: readonly unknown[], cx: typeof ctx = ctx) =>
  proposeChange(d, cx, { public_label: 'Record the queue time', basis: 'From what the user said and the model.', ops } as never);
const idOf = (out: unknown): string => String((out as { data: Rec }).data.proposal_id);

describe('GAP 2: a complete change is ONE door commit, with its own receipt and the full postimage read back', () => {
  it('RED: a figure + Olumi’s link band + a rename → ONE proposal, ONE commit, every member read back as approved', async () => {
    const d = deps();
    const out = await propose(d, [queueTo20, staffBand, renamePrice()]);
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
    expect(d.proposals.size(), 'ONE card: the link set is a member, never a card of its own').toBe(1);
    const id = idOf(out);
    const applied = await applyChange(d, ctx, { proposal_id: id });
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'ok', mutated: true, data: { saved: true,
      receipt: { source_turn_id: authorisationTurnId(id) },
      written: [
        { op: 'set_factor_value', factor_id: 'queue', figure: 20, stored_as: { origin: 'human', role: 'unverified' } },
        { op: 'set_link_strength', from: 'staff', to: 'goal', band: 'moderate', figure: 0.3, stored_as: { origin: 'ai', accepted: true } },
        { op: 'rename', id: 'price', was: 'Ticket price', label: 'Entry price' },
      ] } });
    expect(rows.size, 'ONE commit').toBe(1);
    expect(d.commitOptionLevels).toHaveBeenCalledTimes(1);
    expect(provenanceOf({ value: nodeOf('queue')!.observed_state })).toMatchObject({ origin: 'human', role: 'unverified' });
    expect((edgeOf('staff', 'goal')!.strength as Rec).mean).toBeCloseTo(0.3, 9);
    expect(linkProvenanceOf(edgeOf('staff', 'goal')!)).toMatchObject({ origin: 'ai', accepted: true });
    expect(nodeOf('price')!.label).toBe('Entry price');
  });

  it('RED: a removal → ONE commit: the factor and its link are gone, read back by its own receipt', async () => {
    const d = deps();
    const out = await propose(d, [removeVisits]);
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok' });
    const id = idOf(out);
    const applied = await applyChange(d, ctx, { proposal_id: id });
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'ok', mutated: true, data: { saved: true,
      receipt: { source_turn_id: authorisationTurnId(id) }, written: [{ op: 'remove', ids: ['visits'], removed: true }] } });
    expect(rows.size).toBe(1);
    expect(nodeOf('visits')).toBeUndefined();
    expect(edgeOf('visits', 'goal')).toBeUndefined();
  });

  it('RED: one refused member refuses the whole change before any card: a name already taken → nothing proposed, nothing written', async () => {
    const d = deps();
    const words = 'The queue is about 20 minutes. Rename Ticket price to Queue time.';
    const out = await propose(d, [queueTo20, staffBand, renamePrice('Queue time', 'Rename Ticket price to Queue time.')], saying(words));
    expect(out).toMatchObject({ status: 'refused', reason: 'name_taken', data: { op: 2 } });
    expect(d.proposals.size()).toBe(0);
    expect(rows.size).toBe(0);
  });

  it('members acting on a part another member removes: refused whole, nothing proposed, not even the prepared link set', async () => {
    const d = deps();
    const words = 'Take Assistants on shift out of the model.';
    const removeStaff = { op: 'remove_from_model', kind: 'factor', target_id: 'staff', to_id: null, quote: words };
    const out = await propose(d, [staffBand, removeStaff], saying(words));
    expect(out).toEqual({ status: 'refused', reason: 'compound_members_conflict' });
    expect(d.proposals.size(), 'the link set is a member, discarded with the change').toBe(0);
    expect(rows.size).toBe(0);
  });

  it('the DOOR refuses the whole compound when one member is refused at commit: the figure is not written either', async () => {
    const before = JSON.stringify(persisted);
    const r = await commitOptionLevelsInProcess({ scenario_id: SCN, base_graph_hash: computeAnalysisAffectingGraphHash(persisted as never)!,
      turn_id: 'turn-door-1', links: [], levels: [], values: [{ factor_id: 'queue', value: 20, unit: 'minutes', author: 'user_specified' }],
      compound: { structural: [{ kind: 'rename', node_id: 'price', expected_label: 'Not its name', label: 'Entry price' }] } }, 'req-c5');
    expect(r).toMatchObject({ status: 'refused', reason: 'structural_expected_label_mismatch' });
    expect(rows.size).toBe(0);
    expect(JSON.stringify(persisted)).toBe(before);
  });

  it('the DOOR refuses members that act on one part twice: compound_members_conflict, nothing written', async () => {
    const r = await commitOptionLevelsInProcess({ scenario_id: SCN, base_graph_hash: computeAnalysisAffectingGraphHash(persisted as never)!,
      turn_id: 'turn-door-2', links: [], levels: [], values: [{ factor_id: 'queue', value: 20, unit: 'minutes', author: 'user_specified' }],
      compound: { structural: [{ kind: 'remove', node_ids: ['queue'], edges: [] }] } }, 'req-c5');
    expect(r).toEqual({ status: 'refused', reason: 'compound_members_conflict' });
    expect(rows.size).toBe(0);
  });

  it('A LANE UNCHANGED: without `compound`, a link set beside a value is still refused `link_strengths_not_alone`, nothing written', async () => {
    const edge = edgeOf('staff', 'goal')!;
    const r = await commitOptionLevelsInProcess({ scenario_id: SCN, base_graph_hash: computeAnalysisAffectingGraphHash(persisted as never)!,
      turn_id: 'turn-door-3', links: [], levels: [], values: [{ factor_id: 'queue', value: 20, unit: 'minutes', author: 'user_specified' }],
      link_strengths: [{ from: 'staff', to: 'goal', magnitude: 0.3, intent: 'set', band: 'moderate', author: 'model_proposed',
        expected: { mean: (edge.strength as { mean: number }).mean, effect_direction: 'positive', reviewed_at: null } }] }, 'req-c5');
    expect(r).toMatchObject({ status: 'refused', reason: 'link_strengths_not_alone' });
    expect(rows.size).toBe(0);
  });
});
