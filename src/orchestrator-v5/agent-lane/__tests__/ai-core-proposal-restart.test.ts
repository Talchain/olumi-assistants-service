/**
 * ⭐ PATH-B: A CORE PROPOSAL SURVIVES A PROCESS RESTART ON THE PRODUCT'S OWN CARRIER (DL-3 ruling, 19 Oct; C5's exactly-once
 * guarantee rests on it). `propose_change` stores the proposal in this process's ProposalStore; the route writes it on the
 * answer row's `pending_actions` (`proposalPendingAction`, the carrier every Agent card uses); a fresh process reads that row
 * back as the database returns it and rehydrates it (`rehydrateProposals`); `apply_change` then commits the SAME proposal ONCE
 * through the real door. The harness (session store and read routes faked; the door and its writers real) is C5's
 * `path-b/tools/__tests__/change-tools.door.test.ts`, copied. SYNTHETIC wording.
 */
import { createHash } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { graph as fixtureGraph, type Rec } from '../../path-b/tools/__tests__/fixtures.js';

const SCN = '5c5c5c5c-0000-4000-8000-000000000019';
type Receipt = { version_number: number; version_id: string; mutation_id: string; source_turn_id: string };
let persisted: unknown;
const rows = new Map<string, { id: string; write: Record<string, unknown>; receipt?: Receipt }>();

vi.mock('../../session/index.js', () => ({
  getSessionStore: () => ({
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    readMostRecentPendingActions: async () => [],
    readFactsFor: async () => [],
    // The door reads its own row and facts back (the shape `agent-link-set-is-one-commit.test.ts` serves).
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
      // A receipt as the atomic append returns it (the shape `tests/contract/mutation-spine-range-vs-value.test.ts` mints).
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

/** The scenario as the graph route and the versions route serve it, from the bytes the door actually stored. */
const identityOf = (g: unknown): string => createHash('sha256').update(JSON.stringify(g)).digest('hex');
const dispatch = vi.fn(async (path: string): Promise<{ status: number; json: Rec }> => {
  if (path === `/assist/v1/scenarios/${SCN}/graph`) {
    return { status: 200, json: { graph: persisted as Rec, graph_hash: computeAnalysisAffectingGraphHash(persisted as never),
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

/** The fixture with ranges on the two figures this file writes: queue time on 0–100 minutes, assistants on 0–10 people. */
function stored(): unknown {
  const g = fixtureGraph() as { nodes: Rec[] };
  const nodes = g.nodes.map((n) => n.id === 'queue' ? { ...n, observed_state: { value: 0.3, raw_value: 30, unit: 'minutes', cap: 100 } }
    : n.id === 'staff' ? { ...n, observed_state: { value: 0.1, raw_value: 1, unit: 'people', cap: 10, source: 'brief_extraction', extractionType: 'explicit' } }
      : n);
  return projectGraphForPersistence({ ...GraphV3.parse({ ...g, nodes }), options: [] as Rec[] });
}
const nodeOf = (id: string): Rec => ((persisted as { nodes: Rec[] }).nodes.find((n) => n.id === id))!;

const SAID = 'On a Saturday the queue is about 20 minutes, and my manager reckons about 20 minutes too.';
const ctx = { scenario_id: SCN, authenticated_user_id: 'user-a', request_id: 'req-c5', turn_id: 'turn-c5',
  user_turn_text: SAID, verified_user_messages: [SAID] };
const queueTo = (origin: string, quote: string | null, named: string | null = null) => ({
  op: 'set_factor_value' as const, factor_id: 'queue', value: 20, unit: 'minutes', source: { origin, quote, named_source: named } });

type Mod = typeof import('../../path-b/tools/change-tools.js');
let proposeChange: Mod['proposeChange'];
let applyChange: Mod['applyChange'];
let ProposalStore: typeof import('../proposal.js').ProposalStore;
let commitOptionLevelsInProcess: typeof import('../../system-events/dispatch.js').commitOptionLevelsInProcess;
beforeAll(async () => {
  ({ proposeChange, applyChange } = await import('../../path-b/tools/change-tools.js'));
  ({ ProposalStore } = await import('../proposal.js'));
  ({ commitOptionLevelsInProcess } = await import('../../system-events/dispatch.js'));
});
beforeEach(() => {
  persisted = stored();
  rows.clear();
  dispatch.mockClear();
});

const door = () => vi.fn((input: Parameters<typeof commitOptionLevelsInProcess>[0]) => commitOptionLevelsInProcess(input, 'req-c5'));
async function proposed(ops: readonly unknown[], proposals = new ProposalStore()) {
  const out = await proposeChange({ dispatch, proposals }, ctx, { public_label: 'Record the queue time', basis: 'From what the user said.', ops } as never);
  expect(out.status, JSON.stringify(out)).toBe('ok');
  return { proposals, id: String((out as { data: Rec }).data.proposal_id) };
}


describe('PATH-B: a proposal survives a process restart on the answer row\'s carrier', () => {
  it('⭐ RED→GREEN: propose → carrier on the answer row → a FRESH process rehydrates it from the stored row → apply commits it ONCE', async () => {
    const { proposalPendingAction, rehydrateProposals } = await import('../durable-proposal.js');
    const { approvalChipIdFor } = await import('../approval-chips.js');
    const { proposals, id } = await proposed([queueTo('user', 'about 20 minutes')]);
    const offered = proposals.get(id)!;
    // The route's own carrier for the card it offers, as the answer row stores it (JSONB: a JSON round trip).
    const carrier = proposalPendingAction(offered, { id: approvalChipIdFor(id), label: 'Make this change', message: 'Yes, make this change.' },
      { scenario_id: SCN, emitted_at_iso: new Date().toISOString() });
    const row = JSON.parse(JSON.stringify([carrier])) as unknown[];

    const restarted = new ProposalStore();
    // Contrast: without the carrier, a fresh process cannot apply it: nothing written.
    const lost = await applyChange({ dispatch, proposals: restarted, commitOptionLevels: door() }, ctx, { proposal_id: id });
    expect(lost.status).not.toBe('ok');
    expect(rows.size, 'nothing written without the proposal').toBe(0);

    expect(rehydrateProposals(row, restarted, { scenario_id: SCN, user_id: ctx.authenticated_user_id })).toBe(1);
    expect(restarted.get(id), 'the SAME proposal, by its content-hashed id').toEqual(offered);
    const real = door();
    const applied = await applyChange({ dispatch, proposals: restarted, commitOptionLevels: real }, ctx, { proposal_id: id });
    expect(applied.status, JSON.stringify(applied)).toBe('ok');
    expect(applied).toMatchObject({ mutated: true });
    expect(real).toHaveBeenCalledTimes(1);
    expect(rows.size, 'one write').toBe(1);
    expect((nodeOf('queue').observed_state as Rec).raw_value).toBe(20);
  });
});
