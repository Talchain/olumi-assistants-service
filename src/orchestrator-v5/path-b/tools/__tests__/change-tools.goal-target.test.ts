/**
 * PATH-B GOAL TARGET (C5 candidate 2; buddy AMEND 16:0x, PL 16:05). One complete candidate, one registration:
 *  · the AI declares the comparator (strict or inclusive), the figure, its unit, what it measures, its frame and stance; the
 *    host carries them literally into the product's own target writer (`applyGoalTargetEdit`, in memory, under the stated
 *    comparator) and registers the WHOLE candidate once (CAS on both base hashes, `operation_id` = `authorisationTurnId`);
 *  · whose it is (the ONE table): the target figure is stored as Olumi's reading (`threshold_source: cee_inference`, "the
 *    target"); a person's words stay theirs beside it in the goal's `user_statements`; what the carrier cannot keep is returned;
 *  · exactly once: the registration's own version (`registrationTurnId`) is looked up first; a NEW save needs that receipt
 *    and the complete approved postimage read back.
 * The register and read routes are a ROUTE DOUBLE here (CAS + versions), as the register route's own suite uses a store
 * double; the writer, the statement carrier and the readers are the product's. SYNTHETIC wording.
 */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { registrationTurnId } from '../../../graph-registration/registration-identity.js';
import { authorisationTurnId } from '../../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../../agent-lane/proposal.js';
import { targetNounOf } from '../../../admission/target-testability.js';
import { userStatementsOn } from '../../../statement-door/statements.js';
import { applyChange, proposeChange } from '../change-tools.js';
import { graph as fixtureGraph, type Rec } from './fixtures.js';

const SCN = '5c5c5c5c-0000-4000-8000-0000000000a1';
const SAID = 'We need to serve at least 95% of visitors on the day.';
const ctx = { scenario_id: SCN, authenticated_user_id: 'user-a', request_id: 'req-c5', turn_id: 'turn-c5', user_turn_text: SAID, verified_user_messages: [SAID] };

let persisted: Rec;
let registered: { turn: string; version: number; version_id: string; mutation_id: string }[];
let failNextResponse = false;
const identityOf = (g: unknown): string => createHash('sha256').update(JSON.stringify(g)).digest('hex');
const hashOf = (g: unknown): string => computeAnalysisAffectingGraphHash(g as never) ?? '';

/** The scenario's read, versions and register routes, over one stored graph: CAS on both base hashes, one version per operation. */
const dispatch = vi.fn(async (path: string, body?: unknown): Promise<{ status: number; json: Rec }> => {
  if (path === `/assist/v1/scenarios/${SCN}/graph`) {
    return { status: 200, json: { graph: persisted, graph_hash: hashOf(persisted), graph_identity_hash: { value: identityOf(persisted) } } };
  }
  if (path === `/assist/v1/scenarios/${SCN}/versions`) {
    return { status: 200, json: { versions: [...registered].reverse().map((r) => ({ version_id: r.version_id, sequence: r.version,
      creation: { kind: 'committed_mutation', mutation_id: r.mutation_id, source_turn_id: r.turn } })) } };
  }
  if (path === `/assist/v1/scenarios/${SCN}/graph/register`) {
    const b = body as { graph: Rec; expected_graph_hash: string; expected_graph_identity_hash: string; operation_id: string };
    const turn = registrationTurnId(SCN, b.operation_id);
    if (registered.some((r) => r.turn === turn)) return { status: 409, json: { code: 'OPERATION_ID_REUSED' } };
    if (b.expected_graph_identity_hash !== identityOf(persisted) || b.expected_graph_hash !== hashOf(persisted)) {
      return { status: 409, json: { code: 'GRAPH_STALE' } };
    }
    persisted = JSON.parse(JSON.stringify(b.graph)) as Rec;
    const v = { turn, version: registered.length + 2, version_id: `ver_${registered.length + 2}`, mutation_id: `mut_${registered.length + 2}` };
    registered.push(v);
    if (failNextResponse) { failNextResponse = false; throw new Error('socket closed after the registration'); }
    return { status: 200, json: { graph_hash: hashOf(persisted), graph_identity_hash: { value: identityOf(persisted) },
      model_version: { version_number: v.version, version_id: v.version_id, mutation_id: v.mutation_id }, replayed: false } };
  }
  throw new Error(`unscripted ${path}`);
});

function stored(): Rec {
  const g = fixtureGraph() as { nodes: Rec[] };
  return projectGraphForPersistence({ ...GraphV3.parse(g), options: [] as Rec[] }) as Rec;
}
beforeEach(() => {
  persisted = stored();
  registered = [];
  failNextResponse = false;
  dispatch.mockClear();
});

const goalNode = (): Rec => (persisted.nodes as Rec[]).find((n) => n.id === 'goal')!;
const targetRows = (): Rec[] => (Array.isArray(persisted.goal_constraints) ? persisted.goal_constraints as Rec[] : []).filter((r) => r.node_id === 'goal');
const target = (over: Rec = {}): Rec => ({ op: 'set_goal_target', goal_id: 'goal', comparator: '>=', value: 95, unit: '%',
  quantity: 'visitors served on the day', frame: 'level', stance: 'target', source: { origin: 'user', quote: 'at least 95% of visitors', named_source: null }, ...over });
async function proposed(ops: Rec[], store = new ProposalStore()) {
  const out = await proposeChange({ dispatch, proposals: store }, ctx, { public_label: 'Set the goal’s target', basis: 'From what the user said.', ops } as never);
  expect(out.status, JSON.stringify(out)).toBe('ok');
  return { store, id: String((out as { data: Rec }).data.proposal_id) };
}

describe('a goal target: one candidate, one registration, the declared comparator carried literally', () => {
  it('RED: the user’s words → the target saved as Olumi’s reading of them, the words kept as theirs, the loss returned, its own receipt', async () => {
    const { store, id } = await proposed([target()]);
    const out = await applyChange({ dispatch, proposals: store }, ctx, { proposal_id: id });
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', mutated: true, data: { saved: true, faithful: false,
      receipt: { version_id: 'ver_2', source_turn_id: registrationTurnId(SCN, authorisationTurnId(id)) },
      written: [{ op: 'set_goal_target', goal_id: 'goal', comparator: '>=', figure: 95, not_kept: [{ what: 'origin', declared: 'user' }] }] } });
    expect(registered).toHaveLength(1);
    expect(targetRows()).toEqual([expect.objectContaining({ operator: '>=', value: 95 })]);
    expect(goalNode().threshold_source).toBe('cee_inference');
    expect(targetNounOf(persisted, 'goal')).toBe('the target');
    const words = userStatementsOn(goalNode()).filter((r) => r.field === 'target').flatMap((r) => r.statements);
    expect(words).toEqual([expect.objectContaining({ speaker: 'user', quote: 'at least 95% of visitors', reading: 'olumi' })]);
  });

  it('Olumi’s target: Olumi’s, with no words of the user’s invented beside it', async () => {
    const { store, id } = await proposed([target({ source: { origin: 'olumi', quote: null, named_source: null } })]);
    expect(await applyChange({ dispatch, proposals: store }, ctx, { proposal_id: id })).toMatchObject({ status: 'ok', mutated: true });
    expect(goalNode().threshold_source).toBe('cee_inference');
    expect(userStatementsOn(goalNode()).filter((r) => r.field === 'target')).toEqual([]);
  });

  it('a strict comparator is carried as declared, never widened to inclusive', async () => {
    const { store, id } = await proposed([target({ comparator: '>' })]);
    expect(await applyChange({ dispatch, proposals: store }, ctx, { proposal_id: id })).toMatchObject({ status: 'ok', mutated: true,
      data: { written: [{ comparator: '>' }] } });
  });

  it('exactly once: registered → lost response → restart → re-press = saved earlier, the same receipt, no second registration', async () => {
    const { store, id } = await proposed([target()]);
    failNextResponse = true;
    expect(await applyChange({ dispatch, proposals: store }, ctx, { proposal_id: id })).toEqual({ status: 'unavailable', reason: 'not_confirmed', write: 'unknown' });
    const restarted = new ProposalStore();
    restarted.put(store.get(id)!);
    expect(await applyChange({ dispatch, proposals: restarted }, ctx, { proposal_id: id })).toMatchObject({ status: 'ok', mutated: false,
      data: { already_saved: true, holds_now: true, receipt: { version_id: 'ver_2' } } });
    expect(registered).toHaveLength(1);
  });

  it('a model moved by someone else: superseded, nothing registered', async () => {
    const { store, id } = await proposed([target()]);
    // Someone else moved the MODEL (an analysis-affecting figure): the base every proposer and the card machinery read (the graph
    // hash) no longer matches. (A label-only rename moves no graph hash, as for every other proposer's card.)
    persisted = { ...persisted, nodes: (persisted.nodes as Rec[]).map((n) => n.id === 'queue' ? { ...n, observed_state: { value: 0.9, raw_value: 90, unit: 'minutes', cap: 100 } } : n) };
    expect(hashOf(persisted), 'PRECONDITION: the model moved').not.toBe(hashOf(stored()));
    expect(await applyChange({ dispatch, proposals: store }, ctx, { proposal_id: id })).toEqual({ status: 'refused', reason: 'superseded' });
    expect(registered).toHaveLength(0);
  });
});

describe('what this path cannot hold as declared is said, never saved as something else', () => {
  it.each([
    ['a target mixed with another figure (one registration only)', [target(), { op: 'set_factor_value', factor_id: 'queue', value: 20, unit: 'minutes',
      stance: 'stated_current', source: { origin: 'user', quote: 'at least 95% of visitors', named_source: null } }], 'mixed_change_not_available'],
    ['a target stated as a change from today', [target({ frame: 'change' })], 'change_target_not_available'],
    ['a supposition declared as a target', [target({ stance: 'hypothetical' })], 'blocked_schema'],
  ] as const)('%s: unavailable, nothing proposed', async (_name, ops, reason) => {
    const store = new ProposalStore();
    const out = await proposeChange({ dispatch, proposals: store }, ctx, { public_label: 'x', basis: 'b', ops } as never);
    expect(out).toMatchObject({ status: 'unavailable', reason, write: 'none' });
    expect(store.size()).toBe(0);
  });

  it('a target on something that is not a goal: refused, nothing proposed', async () => {
    const store = new ProposalStore();
    expect(await proposeChange({ dispatch, proposals: store }, ctx, { public_label: 'x', basis: 'b', ops: [target({ goal_id: 'queue' })] } as never))
      .toMatchObject({ status: 'refused', reason: 'not_a_goal' });
    expect(store.size()).toBe(0);
  });

  it('a person’s words that are not in the user’s messages: refused', async () => {
    const out = await proposeChange({ dispatch, proposals: new ProposalStore() }, ctx, { public_label: 'x', basis: 'b',
      ops: [target({ source: { origin: 'user', quote: 'at least 99%', named_source: null } })] } as never);
    expect(out).toMatchObject({ status: 'refused', reason: 'quote_not_in_users_words' });
  });
});
