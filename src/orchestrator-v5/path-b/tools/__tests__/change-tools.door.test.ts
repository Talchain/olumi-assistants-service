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
import { linkProvenanceOf, linkSizing, provenanceOf } from '../../../../cee/provenance/provenance-of.js';
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
      : n.id === 'price' ? { ...n, observed_state: { value: 0.5, raw_value: 5, unit: 'GBP', cap: 10, source: 'cee_inference' } }
      : n);
  return projectGraphForPersistence({ ...GraphV3.parse({ ...g, nodes }), options: [] as Rec[] });
}
const nodeOf = (id: string): Rec => ((persisted as { nodes: Rec[] }).nodes.find((n) => n.id === id))!;
const cellOf = (optionId: string, factorId: string): Rec => (nodeOf(optionId).interventions as Rec)[factorId] as Rec;

const SAID = 'On a Saturday the queue is about 20 minutes, and my manager reckons about 20 minutes too.';
const ctx = { scenario_id: SCN, authenticated_user_id: 'user-a', request_id: 'req-c5', turn_id: 'turn-c5',
  user_turn_text: SAID, verified_user_messages: [SAID] };
const queueTo = (origin: string, quote: string | null, named: string | null = null, stance = origin === 'olumi' ? 'estimate' : 'stated_current') => ({
  op: 'set_factor_value' as const, factor_id: 'queue', value: 20, unit: 'minutes', stance, source: { origin, quote, named_source: named } });

type Mod = typeof import('../change-tools.js');
let proposeChange: Mod['proposeChange'];
let ProposeChangeParams: Mod['ProposeChangeParams'];
let applyChange: Mod['applyChange'];
let ProposalStore: typeof import('../../../agent-lane/proposal.js').ProposalStore;
let authorisationTurnId: typeof import('../../../agent-lane/runtime/agent-capabilities.js').authorisationTurnId;
let commitOptionLevelsInProcess: typeof import('../../../system-events/dispatch.js').commitOptionLevelsInProcess;
let createAgentCapabilities: typeof import('../../../agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
beforeAll(async () => {
  ({ createAgentCapabilities } = await import('../../../agent-lane/runtime/agent-capabilities.js'));
  ({ proposeChange, applyChange, ProposeChangeParams } = await import('../change-tools.js'));
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

  it('a door that reports "already held" is said as unchanged only when a fresh readback holds the approved figure and source', async () => {
    const { proposals, id } = await proposed([queueTo('user', 'about 20 minutes')]);
    const noOp = vi.fn(async () => ({ status: 'committed' as const, graph_hash: 'h', receipt: null, already_applied: true, committed_levels: [] }));
    // The stored queue time is still 30, of no recorded source: "unchanged" would be a false claim.
    expect(await applyChange({ dispatch, proposals, commitOptionLevels: noOp }, ctx, { proposal_id: id }))
      .toEqual({ status: 'unavailable', reason: 'not_verified', write: 'unknown' });
    expect(proposals.isApplied(id)).toBe(false);
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

describe('ROW 3: each declared source, through the real writers, read back by the ONE provenance authority, with what was not kept', () => {
  it.each([
    ['Olumi\'s estimate, adopted by the press', queueTo('olumi', null), { origin: 'ai', accepted: true }, [], null],
    // GAP 1: a person's figure is kept as THEIR claim beside it (who, their name, their words, the stance), so nothing is lost.
    ['the user\'s declared words (literal bytes, speaker as declared)', queueTo('user', 'about 20 minutes'), { origin: 'human', role: 'unverified' },
      [], { said_by: 'user' }],
    ['a named third party, in the user\'s words', queueTo('third_party', 'my manager reckons about 20 minutes', 'their manager'), { origin: 'human', role: 'unverified' },
      [], { said_by: 'party', party: 'their manager' }],
  ] as const)('a factor value from %s', async (_name, op, expected, notKept, claim) => {
    const { proposals, id } = await proposed([op]);
    const out = await applyChange({ dispatch, proposals, commitOptionLevels: door() }, ctx, { proposal_id: id });
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', mutated: true, data: { saved: true, faithful: notKept.length === 0,
      written: [{ op: 'set_factor_value', factor_id: 'queue', figure: 20, declared: { ...op.source, stance: op.stance }, stored_as: expected, not_kept: notKept,
        ...(claim === null ? {} : { claim }) }] } });
    if (claim === null) expect(((out as { data: Rec }).data.written as Rec[])[0]).not.toHaveProperty('claim');
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
      value: { value: 20, unit: 'minutes', stance: 'stated_current', source: { origin: 'third_party', quote: 'my manager reckons about 20 minutes', named_source: 'their manager' } } });
    const other = await proposed([queueTo('third_party', 'my manager reckons about 20 minutes', 'their director')]);
    expect(other.id).not.toBe(id);
  });

  it('Olumi\'s option setting: stored as Olumi\'s (a cell holds no acceptance marker)', async () => {
    const { proposals, id } = await proposed([{ op: 'set_option_setting', option_id: 'add_staff', factor_id: 'staff', value: 3, unit: 'people', stance: 'estimate',
      source: { origin: 'olumi', quote: null, named_source: null } }]);
    const out = await applyChange({ dispatch, proposals, commitOptionLevels: door() }, ctx, { proposal_id: id });
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', mutated: true });
    expect(cellOf('add_staff', 'staff')).toMatchObject({ raw_value: 3, cap: 10 });
    expect(provenanceOf({ setting: cellOf('add_staff', 'staff'), target: nodeOf('staff') })).toMatchObject({ origin: 'ai' });
  });

  it('BLOCKED-SCHEMA: a factor value from an unknown speaker would read as a person\'s figure: unavailable, nothing proposed', async () => {
    for (const quote of ['about 20 minutes', null]) {
      const proposals = new ProposalStore();
      const out = await proposeChange({ dispatch, proposals }, ctx, { public_label: 'Record the queue time', basis: 'b', ops: [queueTo('unknown', quote)] } as never);
      expect(out).toMatchObject({ status: 'unavailable', reason: 'blocked_schema', write: 'none' });
      expect(proposals.size()).toBe(0);
    }
  });

  it('a write the authority reads as another source is never reported saved: Olumi\'s setting stored as the user\'s → not verified', async () => {
    const { proposals, id } = await proposed([{ op: 'set_option_setting', option_id: 'add_staff', factor_id: 'staff', value: 3, unit: 'people', stance: 'estimate',
      source: { origin: 'olumi', quote: null, named_source: null } }]);
    // A writer fault: the level lands under the user's own stamp (no adoption context).
    const relabelling = vi.fn((input: Parameters<typeof commitOptionLevelsInProcess>[0]) =>
      commitOptionLevelsInProcess({ ...input, levels: input.levels.map((l) => ({ ...l, author: 'user_specified' as const })) }, 'req-c5'));
    expect(await applyChange({ dispatch, proposals, commitOptionLevels: relabelling }, ctx, { proposal_id: id }))
      .toEqual({ status: 'unavailable', reason: 'not_verified', write: 'unknown' });
    expect(provenanceOf({ setting: cellOf('add_staff', 'staff'), target: nodeOf('staff') })).toMatchObject({ origin: 'human' });
  });

  /**
   * R3 (DL lease 19 Oct; PL 3b): an option setting from words the user typed, whoever the AI says gave them, is saved as ORIGIN
   * UNKNOWN (`cee_hypothesis` beside `user_material_unverified`): a literal match proves the bytes, never the speaker or the binding.
   * Never Olumi's estimate, never the user's verified figure; what the cell cannot hold is returned, and the save is never faithful.
   */
  const SAID3 = 'With the new rota we would have 3 assistants on a Saturday, our area manager said.';
  const ctx3 = { ...ctx, user_turn_text: SAID3, verified_user_messages: [SAID3] };
  const words = 'we would have 3 assistants on a Saturday';
  it.each([
    // GAP 1: the cell holds the figure as origin unknown; who gave it, their name and words are kept in their claim beside it.
    ['user', null, { said_by: 'user' }],
    ['third_party', 'their area manager', { said_by: 'party', party: 'their area manager' }],
    ['unknown', null, { said_by: 'unknown' }],
  ] as const)('RED: an option setting declared %s, in the user\u2019s literal words, is saved as origin unknown \u2014 never Olumi\u2019s, never the user\u2019s verified figure', async (origin, named, claim) => {
    const proposals = new ProposalStore();
    const p = await proposeChange({ dispatch, proposals }, ctx3, { public_label: 'Set the assistants', basis: 'From what the user said.', ops: [{
      op: 'set_option_setting', option_id: 'add_staff', factor_id: 'staff', value: 3, unit: 'people', stance: 'hypothetical',
      source: { origin, quote: words, named_source: named } }] } as never);
    expect(p.status, JSON.stringify(p)).toBe('ok');
    const out = await applyChange({ dispatch, proposals, commitOptionLevels: door() }, ctx3, { proposal_id: String((p as { data: Rec }).data.proposal_id) });
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', mutated: true, data: { saved: true, faithful: true,
      written: [{ op: 'set_option_setting', option_id: 'add_staff', factor_id: 'staff', figure: 3, unit: 'people',
        declared: { origin, quote: words, named_source: named, stance: 'hypothetical' }, stored_as: { origin: 'unknown' }, claim, not_kept: [] }] } });
    expect(cellOf('add_staff', 'staff')).toMatchObject({ raw_value: 3, cap: 10, source: 'cee_hypothesis', user_material_unverified: true });
    expect(provenanceOf({ setting: cellOf('add_staff', 'staff'), target: nodeOf('staff') }).origin).toBe('unknown');
  });

  it('a writer fault that stores the person\u2019s setting as Olumi\u2019s is never reported saved: not verified', async () => {
    const proposals = new ProposalStore();
    const p = await proposeChange({ dispatch, proposals }, ctx3, { public_label: 'Set the assistants', basis: 'b', ops: [{
      op: 'set_option_setting', option_id: 'add_staff', factor_id: 'staff', value: 3, unit: 'people', stance: 'hypothetical',
      source: { origin: 'user', quote: words, named_source: null } }] } as never);
    const relabelling = vi.fn((input: Parameters<typeof commitOptionLevelsInProcess>[0]) =>
      commitOptionLevelsInProcess({ ...input, levels: input.levels.map((l) => ({ ...l, author: 'model_proposed' as const })) }, 'req-c5'));
    expect(await applyChange({ dispatch, proposals, commitOptionLevels: relabelling }, ctx3, { proposal_id: String((p as { data: Rec }).data.proposal_id) }))
      .toEqual({ status: 'unavailable', reason: 'not_verified', write: 'unknown' });
    expect(provenanceOf({ setting: cellOf('add_staff', 'staff'), target: nodeOf('staff') }).origin).toBe('ai');
  });

  it('an equal figure on the brief\u2019s own setting is never reported "unchanged" while it names another author: refused, nothing written', async () => {
    const SAID4 = 'They said we would have 2 assistants with the new rota.';
    const ctx4 = { ...ctx, user_turn_text: SAID4, verified_user_messages: [SAID4] };
    const proposals = new ProposalStore();
    const p = await proposeChange({ dispatch, proposals }, ctx4, { public_label: 'Set the assistants', basis: 'b', ops: [{
      op: 'set_option_setting', option_id: 'add_staff', factor_id: 'staff', value: 2, unit: 'people', stance: 'hypothetical',
      source: { origin: 'unknown', quote: 'we would have 2 assistants', named_source: null } }] } as never);
    const before = JSON.stringify(persisted);
    const out = await applyChange({ dispatch, proposals, commitOptionLevels: door() }, ctx4, { proposal_id: String((p as { data: Rec }).data.proposal_id) });
    expect(out).toMatchObject({ status: 'refused', reason: 'same_figure_other_source' });
    expect(rows.size).toBe(0);
    expect(JSON.stringify(persisted)).toBe(before);
  });

  it('add_to_model whose part to act on is not in the model: refused by the add-factor door\'s own builder, nothing proposed or saved', async () => {
    const proposals = new ProposalStore();
    const out = await proposeChange({ dispatch, proposals }, ctx, { public_label: 'A change', basis: 'b',
      ops: [{ op: 'add_to_model', kind: 'factor', label: 'Weekend volunteers', acts_on: 'nope', direction: 'negative', value: 4, unit: 'people',
        stance: 'estimate', source: { origin: 'olumi', quote: null, named_source: null } }] } as never);
    expect(out).toMatchObject({ status: 'refused', reason: 'add_node_not_found' });
    expect(proposals.size()).toBe(0);
  });

  it.each([
    ['rename', { op: 'rename', kind: 'factor', target_id: 'price', new_label: 'Entry price', quote: 'Rename Ticket price to Entry price.' }],
    ['remove_from_model', { op: 'remove_from_model', kind: 'factor', target_id: 'price', to_id: null, quote: 'Take Ticket price out of the model.' }],
  ])('a %s the user did not ask for in this message: the existing proposer\u2019s own refusal, nothing proposed or saved', async (_op, op) => {
    const proposals = new ProposalStore();
    const out = await proposeChange({ dispatch, proposals }, ctx, { public_label: 'A change', basis: 'b', ops: [op] } as never);
    expect(out).toMatchObject({ status: 'refused', reason: 'not_asked', data: { op: 0 } });
    expect(proposals.size()).toBe(0);
    expect(rows.size).toBe(0);
  });

  it.each([
    ['a declared human source with no quote', queueTo('user', null), 'quote_not_in_users_words'],
    ['a quote that is not in the user\'s typed words', queueTo('user', 'about 25 minutes'), 'quote_not_in_users_words'],
    ['a third party with no words to hold', queueTo('third_party', null, 'their manager'), 'quote_not_in_users_words'],
    ['an option setting declared the user\u2019s with no quote', { op: 'set_option_setting', option_id: 'add_staff', factor_id: 'staff', value: 3, unit: 'people',
      stance: 'hypothetical', source: { origin: 'user', quote: null, named_source: null } }, 'quote_not_in_users_words'],
    ['an option setting of unknown origin whose words are not the user\u2019s', { op: 'set_option_setting', option_id: 'add_staff', factor_id: 'staff', value: 3,
      unit: 'people', stance: 'hypothetical', source: { origin: 'unknown', quote: 'about 3 assistants', named_source: null } }, 'quote_not_in_users_words'],
  ] as const)('%s: refused, nothing proposed', async (_name, op, reason) => {
    const proposals = new ProposalStore();
    const out = await proposeChange({ dispatch, proposals }, ctx, { public_label: 'Record the queue time', basis: 'b', ops: [op] } as never);
    expect(out).toMatchObject({ status: 'refused', reason, data: { op: 0 } });
    expect(proposals.size()).toBe(0);
  });
});

/**
 * WITNESS (#3436 R4, reviews/CODEX-3436-835ee9b0-probes/recovery-notes/r4): one message carries the user's own figure and a
 * figure someone else gave. The approved change is saved WHOLE or not at all: never the user's half alone (the partial write
 * #3436 reproduced), and never the other person's figure as the user's. SYNTHETIC wording in the same shape.
 */
describe('WITNESS: a mixed user + third-party change is saved whole or not at all', () => {
  const SAID2 = 'Queue time is about 20 minutes. Our finance lead said "the ticket price should be £6". Add my queue time and the finance lead\'s price.';
  const ctx2 = { ...ctx, user_turn_text: SAID2, verified_user_messages: [SAID2] };
  const mine = queueTo('user', 'Queue time is about 20 minutes');
  const theirs = (op: Rec): Rec => ({ ...op, source: { origin: 'third_party', quote: 'the ticket price should be £6', named_source: 'finance lead' } });

  it('the other person\'s figure as an option setting: ONE commit holds both; theirs reads unknown, never the user\'s, and what was lost is returned', async () => {
    const proposals = new ProposalStore();
    const p = await proposeChange({ dispatch, proposals }, ctx2, { public_label: 'Queue time and price', basis: 'b',
      ops: [mine, theirs({ op: 'set_option_setting', option_id: 'add_staff', factor_id: 'price', value: 6, unit: 'GBP', stance: 'stated_current' })] } as never);
    expect(p.status, JSON.stringify(p)).toBe('ok');
    const out = await applyChange({ dispatch, proposals, commitOptionLevels: door() }, ctx2, { proposal_id: String((p as { data: Rec }).data.proposal_id) });
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', mutated: true, data: { saved: true, faithful: true } });
    expect(rows.size, 'ONE commit').toBe(1);
    expect(provenanceOf({ value: nodeOf('queue').observed_state })).toMatchObject({ origin: 'human', role: 'unverified' });
    expect(cellOf('add_staff', 'price')).toMatchObject({ raw_value: 6, source: 'cee_hypothesis', user_material_unverified: true });
    expect(provenanceOf({ setting: cellOf('add_staff', 'price'), target: nodeOf('price') }).origin).toBe('unknown');
    const written = out.status === 'ok' ? out.data.written as Rec[] : [];
    // GAP 1: their figure, name and words are kept as THEIR claim beside the cell, never the user's.
    expect(written[1]).toMatchObject({ factor_id: 'price', stored_as: { origin: 'unknown' }, claim: { said_by: 'party', party: 'finance lead' }, not_kept: [] });
  });

  it('both as factor values: ONE commit holds both; the other person\'s is never the user\'s, and the lost name is returned, not called faithful', async () => {
    const { proposals, id } = await (async () => {
      const store = new ProposalStore();
      const p = await proposeChange({ dispatch, proposals: store }, ctx2, { public_label: 'Queue time and price', basis: 'b',
        ops: [mine, theirs({ op: 'set_factor_value', factor_id: 'price', value: 6, unit: 'GBP', stance: 'stated_current' })] } as never);
      expect(p.status, JSON.stringify(p)).toBe('ok');
      return { proposals: store, id: String((p as { data: Rec }).data.proposal_id) };
    })();
    const out = await applyChange({ dispatch, proposals, commitOptionLevels: door() }, ctx2, { proposal_id: id });
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', mutated: true, data: { saved: true, faithful: true } });
    expect(rows.size, 'ONE commit').toBe(1);
    expect((nodeOf('queue').observed_state as Rec).raw_value).toBe(20);
    expect((nodeOf('price').observed_state as Rec).raw_value).toBe(6);
    for (const id2 of ['queue', 'price']) expect(provenanceOf({ value: nodeOf(id2).observed_state })).toMatchObject({ origin: 'human', role: 'unverified' });
    const written = out.status === 'ok' ? out.data.written as Rec[] : [];
    expect(written[0]).toMatchObject({ factor_id: 'queue', claim: { said_by: 'user' }, not_kept: [] });
    expect(written[1]).toMatchObject({ factor_id: 'price', claim: { said_by: 'party', party: 'finance lead' }, not_kept: [] });
  });

  it('a writer refusal of either half refuses the whole change: nothing is written', async () => {
    const before = JSON.stringify(persisted);
    const store = new ProposalStore();
    const p = await proposeChange({ dispatch, proposals: store }, ctx2, { public_label: 'Queue time and price', basis: 'b',
      ops: [mine, theirs({ op: 'set_factor_value', factor_id: 'price', value: 6, unit: 'kg', stance: 'stated_current' })] } as never);
    expect(p.status, JSON.stringify(p)).toBe('ok');
    const out = await applyChange({ dispatch, proposals: store, commitOptionLevels: door() }, ctx2, { proposal_id: String((p as { data: Rec }).data.proposal_id) });
    expect(out.status, JSON.stringify(out)).toBe('refused');
    expect(rows.size).toBe(0);
    expect(JSON.stringify(persisted)).toBe(before);
  });
});

/**
 * STANCE (AIE 15:24 / 15:54): how a figure is put forward, separate from who said it. It rides the hashed operation and the
 * receipt; a value holds a current level and an option's setting a what-if, so a target or a supposition is never saved as a
 * value, and a stance the carrier does not mean is saved only with that stance named as not kept. SYNTHETIC wording.
 */
describe('STANCE: carried with each figure, never promoted to an operative current level', () => {
  it.each([
    ['a supposition', 'hypothetical'],
    ['a target', 'target'],
  ])('%s as a factor value would become its current level: unavailable, nothing proposed', async (_name, stance) => {
    const proposals = new ProposalStore();
    const out = await proposeChange({ dispatch, proposals }, ctx, { public_label: 'Record the queue time', basis: 'b',
      ops: [queueTo('user', 'about 20 minutes', null, stance)] } as never);
    expect(out).toMatchObject({ status: 'unavailable', reason: 'blocked_schema', write: 'none' });
    expect(proposals.size()).toBe(0);
    expect(rows.size).toBe(0);
  });

  it('a person\'s estimate is saved, with its stance kept in their claim beside the value (GAP 1)', async () => {
    const { proposals, id } = await proposed([queueTo('user', 'about 20 minutes', null, 'estimate')]);
    const out = await applyChange({ dispatch, proposals, commitOptionLevels: door() }, ctx, { proposal_id: id });
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', mutated: true, data: { faithful: true,
      written: [{ declared: { stance: 'estimate' }, claim: { said_by: 'user' }, not_kept: [] }] } });
    const claims = (nodeOf('queue').user_statements as Rec[]).flatMap((r) => r.statements as Rec[]);
    expect(claims).toContainEqual(expect.objectContaining({ said_by: 'user', quote: 'about 20 minutes', stance: 'estimate', low: 20, high: 20 }));
  });

  it('Olumi\'s setting declared as a target is not an option\'s setting: unavailable', async () => {
    const proposals = new ProposalStore();
    const out = await proposeChange({ dispatch, proposals }, ctx, { public_label: 'Set the assistants', basis: 'b', ops: [{
      op: 'set_option_setting', option_id: 'add_staff', factor_id: 'staff', value: 3, unit: 'people', stance: 'target',
      source: { origin: 'olumi', quote: null, named_source: null } }] } as never);
    expect(out).toMatchObject({ status: 'unavailable', reason: 'blocked_schema', write: 'none' });
  });

  it('the stance is part of the hashed operation, and a figure without one is outside the schema', async () => {
    const a = await proposed([queueTo('user', 'about 20 minutes', null, 'stated_current')]);
    const b = await proposed([queueTo('user', 'about 20 minutes', null, 'estimate')]);
    expect(a.proposals.get(a.id)!.operations[0]!.value).toMatchObject({ stance: 'stated_current' });
    expect(b.id).not.toBe(a.id);
    const { stance: _dropped, ...noStance } = queueTo('user', 'about 20 minutes');
    expect(ProposeChangeParams.safeParse({ public_label: 'x', basis: 'b', ops: [noStance] }).success).toBe(false);
  });
});

/**
 * #3461 R1 BLOCK 1 (Codex R1, /private/tmp/rev-3461-r1/recovery-notes/R1-review.md §1): an option setting on a factor with no
 * range, with a declared unit, must never take the frameless 0–1 path (its figure and unit were dropped, and the commit was
 * only found incomplete afterwards). It comes back unavailable BEFORE any proposal or write, with the figure kept.
 * SYNTHETIC probes in Codex's shape: two distinct quantities.
 */
describe('R1: a setting with a declared unit on a factor with no range is never written as a bare 0–1 value', () => {
  it.each([
    ['0.5 people', 'visits', 0.5, 'people'],
    ['£0.75', 'price', 0.75, 'GBP'],
  ] as const)('RED: %s → unavailable needs_range, nothing proposed, 0 writes, the figure kept', async (_name, factorId, value, unitWord) => {
    // `price` with no range of its own (the fixture's stored figure, without a cap); `visits` holds no figure at all.
    const g = stored() as { nodes: Rec[] };
    persisted = projectGraphForPersistence({ ...GraphV3.parse({ ...g, nodes: g.nodes.map((n) => n.id === 'price'
      ? { ...n, observed_state: { value: 0.5, raw_value: 5, unit: 'GBP', source: 'cee_inference' } } : n) }), options: [] as Rec[] });
    const before = JSON.stringify(persisted);
    const proposals = new ProposalStore();
    const out = await proposeChange({ dispatch, proposals }, ctx, { public_label: 'Set the option', basis: 'b', ops: [{
      op: 'set_option_setting', option_id: 'add_staff', factor_id: factorId, value, unit: unitWord, stance: 'estimate',
      source: { origin: 'olumi', quote: null, named_source: null } }] } as never);
    expect(out).toMatchObject({ status: 'unavailable', reason: 'needs_range', write: 'none',
      data: { op: 0, not_kept: [{ what: 'figure', declared: `${value} ${unitWord}` }] } });
    expect(proposals.size()).toBe(0);
    expect(rows.size).toBe(0);
    expect(JSON.stringify(persisted)).toBe(before);
  });

  it('a unitless share on a factor with no range still takes the model scale (contrast)', async () => {
    const { proposals, id } = await proposed([{ op: 'set_option_setting', option_id: 'add_staff', factor_id: 'visits', value: 0.5, unit: null,
      stance: 'estimate', source: { origin: 'olumi', quote: null, named_source: null } }]);
    expect(await applyChange({ dispatch, proposals, commitOptionLevels: door() }, ctx, { proposal_id: id })).toMatchObject({ status: 'ok', mutated: true });
  });
});

/**
 * LINK STRENGTH (candidate 2, item 3; design outbox/C5-PATHB-LINK-STRENGTH-DESIGN.md v2, buddy AMEND): Olumi's band for an
 * existing link, through the existing capability's ONE rule set (`proposeLinkStrengths`) and the SAME door, ALONE (the writer
 * refuses a link set beside anything else). A person's band is BLOCKED-SCHEMA: no link carrier holds "human, unverified" or
 * "unknown" (PL 3b). SYNTHETIC wording.
 */
describe('LINK STRENGTH: Olumi\u2019s band for a link, as its own candidate, read back by the one authority', () => {
  const edgeOf = (from: string, to: string): Rec => ((persisted as { edges: Rec[] }).edges.find((e) => e.from === from && e.to === to))!;
  beforeEach(() => {
    const g = JSON.parse(JSON.stringify(stored())) as { edges: Rec[] };
    g.edges.find((e) => e.from === 'staff' && e.to === 'goal')!.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_estimate' };
    persisted = projectGraphForPersistence(g);
  });
  let proposals0: InstanceType<typeof ProposalStore>;
  const caps = (commit = door()) => createAgentCapabilities(dispatch as never, proposals0, undefined, 'full', undefined, { commitOptionLevels: commit });
  const link = (band: string, origin = 'olumi', stance = 'estimate', from = 'staff', to = 'goal', quote: string | null = null) =>
    ({ op: 'set_link_strength', from, to, band, stance, source: { origin, quote, named_source: null } });
  const linkDeps = (commit = door()) => {
    proposals0 = new ProposalStore();
    const c = caps(commit);
    return { dispatch, proposals: proposals0, commitOptionLevels: commit,
      proposeLinkStrengths: (cx: Rec, a: Rec) => c.proposeLinkStrengths!({ request_id: 'req-c5', ...cx } as never, a as never) };
  };
  const propose = async (deps: ReturnType<typeof linkDeps>, ops: readonly unknown[]) =>
    proposeChange(deps, ctx, { public_label: 'Size the link', basis: 'More assistants clear the queue faster, from the model.', ops } as never);

  it('RED: Olumi\u2019s band applied by the press: ONE commit, the band\u2019s midpoint, the sign kept, read back as Olumi\u2019s accepted estimate', async () => {
    const deps = linkDeps();
    const p = await propose(deps, [link('moderate')]);
    expect(p, JSON.stringify(p)).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
    const id = String((p as { data: Rec }).data.proposal_id);
    const out = await applyChange(deps, ctx, { proposal_id: id });
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', mutated: true, data: { saved: true, faithful: true,
      receipt: { source_turn_id: authorisationTurnId(`${id}#links`) },
      written: [{ op: 'set_link_strength', from: 'staff', to: 'goal', band: 'moderate', figure: 0.3, stored_as: { origin: 'ai', accepted: true } }] } });
    expect(rows.size, 'ONE commit').toBe(1);
    expect((edgeOf('staff', 'goal').strength as Rec).mean).toBeCloseTo(0.3, 9);
    expect(linkSizing(edgeOf('staff', 'goal'))).toBe('olumi_accepted');
    expect(linkProvenanceOf(edgeOf('staff', 'goal'))).toMatchObject({ origin: 'ai', accepted: true });
  });

  it('exactly once: the response is lost after the commit, the press again → the committed receipt, no second write', async () => {
    const real = door();
    let lose = true;
    const lossy = vi.fn(async (input: Parameters<typeof commitOptionLevelsInProcess>[0]) => {
      const r = await real(input);
      if (lose) { lose = false; throw new Error('socket closed after the commit'); }
      return r;
    });
    const deps = linkDeps(lossy);
    const p = await propose(deps, [link('moderate')]);
    const id = String((p as { data: Rec }).data.proposal_id);
    expect((await applyChange(deps, ctx, { proposal_id: id })).status).not.toBe('ok');
    const again = await applyChange(deps, { ...ctx, turn_id: 'turn-c5-2' }, { proposal_id: id });
    expect(again, JSON.stringify(again)).toMatchObject({ status: 'ok', data: { already_saved: true, receipt: { source_turn_id: authorisationTurnId(`${id}#links`) }, holds_now: true } });
    expect(rows.size).toBe(1);
  });

  it.each(['user', 'third_party', 'unknown'])('BLOCKED-SCHEMA: a band declared %s would read as the person\u2019s verified size: unavailable, nothing proposed', async (origin) => {
    const deps = linkDeps();
    // Put forward as an estimate, so only WHOSE band it is decides (a person's band, whatever its stance).
    const out = await propose(deps, [link('moderate', origin, 'estimate', 'staff', 'goal', 'about 20 minutes')]);
    expect(out).toMatchObject({ status: 'unavailable', reason: 'blocked_schema', write: 'none' });
    expect((out as { detail: string }).detail).toContain('would read as their own verified size');
    expect(proposals0.size()).toBe(0);
  });

  it.each(['hypothetical', 'target', 'stated_current'])('a band put forward as %s is not saved as Olumi\u2019s estimate: unavailable, nothing proposed', async (stance) => {
    const deps = linkDeps();
    expect(await propose(deps, [link('moderate', 'olumi', stance)])).toMatchObject({ status: 'unavailable', reason: 'blocked_schema' });
    expect(proposals0.size()).toBe(0);
  });

  it('GAP 2: a link beside a figure is ONE card for ONE commit (change-tools.compound.test.ts), never two', async () => {
    const deps = linkDeps();
    const out = await propose(deps, [link('moderate'), queueTo('user', 'about 20 minutes')]);
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
    expect(proposals0.size()).toBe(1);
    expect(proposals0.get(String((out as { data: Rec }).data.proposal_id))!.operations.map((o) => o.op)).toEqual(['set_factor_value', 'set_link_strength']);
  });

  it('no such link: the capability\u2019s own refusal, nothing proposed', async () => {
    const deps = linkDeps();
    const out = await propose(deps, [link('moderate', 'olumi', 'estimate', 'price', 'staff')]);
    expect(out).toMatchObject({ status: 'refused', reason: 'no_such_link' });
    expect(proposals0.size()).toBe(0);
  });

  it('without the capability on this path: truthfully not available', async () => {
    const { proposeLinkStrengths: _absent, ...deps } = linkDeps();
    expect(await propose(deps as never, [link('moderate')])).toMatchObject({ status: 'unavailable', reason: 'set_link_strength_not_available' });
  });

  it('a writer fault that stores Olumi\u2019s band as the user\u2019s own is never reported saved: not verified', async () => {
    const relabelling = vi.fn((input: Parameters<typeof commitOptionLevelsInProcess>[0]) =>
      commitOptionLevelsInProcess({ ...input, link_strengths: input.link_strengths!.map((l) => ({ ...l, author: 'user_specified' as const })) }, 'req-c5'));
    const deps = linkDeps(relabelling);
    const p = await propose(deps, [link('moderate')]);
    const out = await applyChange(deps, ctx, { proposal_id: String((p as { data: Rec }).data.proposal_id) });
    expect(out).toEqual({ status: 'unavailable', reason: 'not_verified', write: 'unknown' });
    expect(linkSizing(edgeOf('staff', 'goal'))).toBe('user');
  });
});
