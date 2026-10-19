/**
 * PATH-B CHANGE ADAPTERS THROUGH THE REAL DOOR (C5, 19 Oct 2026; DL-3 rulings 1–3 and 7, PL 3b). `propose_change` records the
 * AI's declared change and writes nothing; `apply_change`, run only after the user's press, commits it ONCE through the
 * product's batch door (`commitOptionLevelsInProcess` → the canonical value and level writers, CAS on the base, idempotent on
 * `authorisationTurnId(proposal_id)`), and claims a save only on its own receipt plus the approved postimage read back.
 *  · ROW 2 (exactly once): commit → lost response → restart → re-press reconciles to the COMMITTED receipt, never `superseded`.
 *  · ROW 3 (source truth): each declared origin reads back through the ONE provenance authority as its carrier can hold it;
 *    a carrier that cannot hold it refuses as BLOCKED-SCHEMA, never a downgrade to Olumi and never "the user's, verified".
 *  · RULE 7: a re-press of an applied proposal says "already saved", with no new write.
 * SYNTHETIC wording. Only the session store and the scenario's read routes are faked; the door and its writers are real.
 */
import { createHash } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { provenanceOf } from '../../../../cee/provenance/provenance-of.js';
import { graph as fixtureGraph, type Rec } from './fixtures.js';

const SCN = '5c5c5c5c-0000-4000-8000-000000000019';
type Receipt = { version_number: number; version_id: string; mutation_id: string; source_turn_id: string };
let persisted: unknown;
const rows = new Map<string, { id: string; write: Record<string, unknown>; receipt?: Receipt }>();

vi.mock('../../../session/index.js', () => ({
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
const cellOf = (optionId: string, factorId: string): Rec => (nodeOf(optionId).interventions as Rec)[factorId] as Rec;

const SAID = 'On a Saturday the queue is about 20 minutes, and my manager reckons about 20 minutes too.';
const ctx = { scenario_id: SCN, authenticated_user_id: 'user-a', request_id: 'req-c5', turn_id: 'turn-c5',
  user_turn_text: SAID, verified_user_messages: [SAID] };
const queueTo = (origin: string, quote: string | null, named: string | null = null) => ({
  op: 'set_factor_value' as const, factor_id: 'queue', value: 20, unit: 'minutes', source: { origin, quote, named_source: named } });

type Mod = typeof import('../change-tools.js');
let proposeChange: Mod['proposeChange'];
let applyChange: Mod['applyChange'];
let ProposalStore: typeof import('../../../agent-lane/proposal.js').ProposalStore;
let authorisationTurnId: typeof import('../../../agent-lane/runtime/agent-capabilities.js').authorisationTurnId;
let commitOptionLevelsInProcess: typeof import('../../../system-events/dispatch.js').commitOptionLevelsInProcess;
beforeAll(async () => {
  ({ proposeChange, applyChange } = await import('../change-tools.js'));
  ({ ProposalStore } = await import('../../../agent-lane/proposal.js'));
  ({ authorisationTurnId } = await import('../../../agent-lane/runtime/agent-capabilities.js'));
  ({ commitOptionLevelsInProcess } = await import('../../../system-events/dispatch.js'));
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

describe('ROW 2: exactly once across a lost response and a restart', () => {
  it('RED: commit → lost response → restart → re-press: the COMMITTED receipt, never "superseded", and no second write', async () => {
    const { proposals, id } = await proposed([queueTo('user', 'about 20 minutes')]);
    const real = door();
    let lose = true;
    const lossy = vi.fn(async (input: Parameters<typeof commitOptionLevelsInProcess>[0]) => {
      const r = await real(input);
      if (lose) { lose = false; throw new Error('socket closed after the commit'); }
      return r;
    });
    const first = await applyChange({ dispatch, proposals, commitOptionLevels: lossy }, ctx, { proposal_id: id });
    expect(first).toEqual({ status: 'unavailable', reason: 'not_confirmed', write: 'unknown' });
    expect(rows.size, 'the commit landed').toBe(1);

    const restarted = new ProposalStore();
    restarted.put(proposals.get(id)!);
    const again = await applyChange({ dispatch, proposals: restarted, commitOptionLevels: lossy }, ctx, { proposal_id: id });
    expect(again).toMatchObject({ status: 'ok', mutated: false,
      data: { already_saved: true, holds_now: true, receipt: { version: 2, version_id: 'dddddddd-dddd-4ddd-8ddd-000000000002', source_turn_id: authorisationTurnId(id) } } });
    expect(lossy, 'the re-press wrote nothing').toHaveBeenCalledTimes(1);
    expect(rows.size).toBe(1);
  });

  it('RULE 7: a re-press of an applied proposal says "already saved", with no new write', async () => {
    const { proposals, id } = await proposed([queueTo('user', 'about 20 minutes')]);
    const d = door();
    const saved = await applyChange({ dispatch, proposals, commitOptionLevels: d }, ctx, { proposal_id: id });
    expect(saved).toMatchObject({ status: 'ok', mutated: true, data: { saved: true, receipt: { source_turn_id: authorisationTurnId(id) } } });
    const again = await applyChange({ dispatch, proposals, commitOptionLevels: d }, ctx, { proposal_id: id });
    expect(again).toMatchObject({ status: 'ok', mutated: false, data: { already_saved: true } });
    expect(d).toHaveBeenCalledTimes(1);
    expect(rows.size).toBe(1);
  });

  it('an id the store does not hold: refused, nothing read or written', async () => {
    const d = door();
    expect(await applyChange({ dispatch, proposals: new ProposalStore(), commitOptionLevels: d }, ctx, { proposal_id: 'prop_not_one' }))
      .toEqual({ status: 'refused', reason: 'unknown_proposal' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(d).not.toHaveBeenCalled();
  });

  it('a model that moved since the proposal (not by this proposal): superseded, nothing written', async () => {
    const { proposals, id } = await proposed([queueTo('user', 'about 20 minutes')]);
    persisted = projectGraphForPersistence({ ...GraphV3.parse({ ...(stored() as Rec), nodes: (stored() as { nodes: Rec[] }).nodes
      .map((n) => n.id === 'price' ? { ...n, observed_state: { value: 0.6, raw_value: 6, unit: 'GBP', source: 'cee_inference' } } : n) }), options: [] as Rec[] });
    const d = door();
    expect(await applyChange({ dispatch, proposals, commitOptionLevels: d }, ctx, { proposal_id: id })).toEqual({ status: 'refused', reason: 'superseded' });
    expect(d).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });
});

describe('ROW 3: each declared origin, through the real writers, read back by the ONE provenance authority', () => {
  it.each([
    ['Olumi\'s estimate, adopted by the press', queueTo('olumi', null), { origin: 'ai', accepted: true }],
    ['the user\'s declared words (literal bytes, speaker as declared)', queueTo('user', 'about 20 minutes'), { origin: 'human', role: 'unverified' }],
    ['a named third party, in the user\'s words', queueTo('third_party', 'my manager reckons about 20 minutes', 'their manager'), { origin: 'human', role: 'unverified' }],
    ['an unknown speaker, in the user\'s words', queueTo('unknown', 'about 20 minutes'), { origin: 'human', role: 'unverified' }],
  ] as const)('a factor value from %s', async (_name, op, expected) => {
    const { proposals, id } = await proposed([op]);
    const out = await applyChange({ dispatch, proposals, commitOptionLevels: door() }, ctx, { proposal_id: id });
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', mutated: true });
    const os = nodeOf('queue').observed_state as Rec;
    expect(os.raw_value).toBe(20);
    const read = provenanceOf({ value: os });
    expect(read).toMatchObject(expected);
    // 3b: a literal match never makes a figure "the user's, verified".
    expect(read.origin === 'human' && read.role === undefined).toBe(false);
  });

  it('the declaration (origin, quote, named source) is part of the hashed operation', async () => {
    const { proposals, id } = await proposed([queueTo('third_party', 'my manager reckons about 20 minutes', 'their manager')]);
    expect(proposals.get(id)!.operations[0]).toMatchObject({ op: 'set_factor_value', path: 'queue',
      value: { value: 20, unit: 'minutes', source: { origin: 'third_party', quote: 'my manager reckons about 20 minutes', named_source: 'their manager' } } });
    const other = await proposed([queueTo('third_party', 'my manager reckons about 20 minutes', 'their director')]);
    expect(other.id).not.toBe(id);
  });

  it('Olumi\'s option setting: stored as Olumi\'s (a cell holds no acceptance marker)', async () => {
    const { proposals, id } = await proposed([{ op: 'set_option_setting', option_id: 'add_staff', factor_id: 'staff', value: 3, unit: 'people',
      source: { origin: 'olumi', quote: null, named_source: null } }]);
    const out = await applyChange({ dispatch, proposals, commitOptionLevels: door() }, ctx, { proposal_id: id });
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', mutated: true });
    expect(cellOf('add_staff', 'staff')).toMatchObject({ raw_value: 3, cap: 10 });
    expect(provenanceOf({ setting: cellOf('add_staff', 'staff'), target: nodeOf('staff') })).toMatchObject({ origin: 'ai' });
  });

  it.each(['user', 'third_party', 'unknown'])('BLOCKED-SCHEMA: an option setting declared %s cannot be stored as declared, so nothing is proposed', async (origin) => {
    const proposals = new ProposalStore();
    const out = await proposeChange({ dispatch, proposals }, ctx, { public_label: 'Set the assistants', basis: 'From what the user said.', ops: [{
      op: 'set_option_setting', option_id: 'add_staff', factor_id: 'staff', value: 3, unit: 'people',
      source: { origin, quote: 'about 20 minutes', named_source: null } }] } as never);
    expect(out).toMatchObject({ status: 'refused', reason: 'blocked_schema', data: { op: 0, carrier: 'option_setting' } });
    expect(proposals.size()).toBe(0);
  });

  it.each([
    ['a declared human source with no quote', queueTo('user', null), 'quote_not_in_users_words'],
    ['a quote that is not in the user\'s typed words', queueTo('user', 'about 25 minutes'), 'quote_not_in_users_words'],
    ['an unknown speaker with no words to hold', queueTo('unknown', null), 'quote_not_in_users_words'],
  ] as const)('%s: refused, nothing proposed', async (_name, op, reason) => {
    const proposals = new ProposalStore();
    const out = await proposeChange({ dispatch, proposals }, ctx, { public_label: 'Record the queue time', basis: 'b', ops: [op] } as never);
    expect(out).toMatchObject({ status: 'refused', reason, data: { op: 0 } });
    expect(proposals.size()).toBe(0);
  });
});
