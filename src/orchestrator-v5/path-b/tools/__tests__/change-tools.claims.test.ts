/**
 * GAP 1 — A PERSON'S FIGURE IS KEPT AS THEIR CLAIM (DL-3 GO, 19 Oct: the recordable lease; additive `stance`). When the user or
 * someone they name gives a figure for a factor's level or an option's setting, the SAME door commit that writes the figure also
 * writes their claim in the existing claim record (`user_statements`): who said it (a party by the name given, relayed by the
 * user), their words and the line they are in, the figure, unit and stance. A cold read (`read_canonical_context`) returns it.
 * Other sources' claims on the subject stay beside it. Olumi's own figure is no one's claim. Degrading to "not kept" is only
 * what the record truly cannot say (an unnamed party's identity). SYNTHETIC wording; the door and its writers are real.
 */
import { createHash } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { graph as fixtureGraph, type Rec } from './fixtures.js';

const SCN = '5c5c5c5c-0000-4000-8000-000000000049';
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


function stored(): unknown {
  const g = fixtureGraph() as { nodes: Rec[] };
  const nodes = g.nodes.map((n) => n.id === 'queue' ? { ...n, observed_state: { value: 0.3, raw_value: 30, unit: 'minutes', cap: 100 } }
    : n.id === 'visits' ? { ...n, observed_state: { value: 0.4, raw_value: 40, unit: 'visits', cap: 100 } }
      : n.id === 'staff' ? { ...n, observed_state: { value: 0.1, raw_value: 1, unit: 'people', cap: 10, source: 'brief_extraction', extractionType: 'explicit' } } : n);
  return projectGraphForPersistence({ ...GraphV3.parse({ ...g, nodes }), options: [] as Rec[] });
}
const nodeOf = (id: string): Rec => (persisted as { nodes: Rec[] }).nodes.find((n) => n.id === id)!;
const claimsOn = (id: string): Rec[] => ((nodeOf(id).user_statements ?? []) as Rec[]).flatMap((r) => r.statements as Rec[]);

const SAID = 'The queue is about 20 minutes on a Saturday, if the weather holds. Our area lead says the new rota would give us 3 assistants. Someone in finance thinks visits are 55.';
const ctx = { scenario_id: SCN, authenticated_user_id: 'user-a', request_id: 'req-c5', turn_id: 'turn-c5', user_turn_text: SAID, verified_user_messages: [SAID] };
const fig = (op: Rec, origin: string, quote: string | null, named: string | null = null): Rec => ({ ...op, source: { origin, quote, named_source: named } });
const queue20 = (origin: string, quote: string | null, named: string | null = null, stance = 'stated_current') =>
  fig({ op: 'set_factor_value', factor_id: 'queue', value: 20, unit: 'minutes', stance }, origin, quote, named);

type Mod = typeof import('../change-tools.js');
let proposeChange: Mod['proposeChange'];
let applyChange: Mod['applyChange'];
let readCanonicalContext: typeof import('../context-tool.js').readCanonicalContext;
let ProposalStore: typeof import('../../../agent-lane/proposal.js').ProposalStore;
let commitOptionLevelsInProcess: typeof import('../../../system-events/dispatch.js').commitOptionLevelsInProcess;
beforeAll(async () => {
  ({ proposeChange, applyChange } = await import('../change-tools.js'));
  ({ readCanonicalContext } = await import('../context-tool.js'));
  ({ ProposalStore } = await import('../../../agent-lane/proposal.js'));
  ({ commitOptionLevelsInProcess } = await import('../../../system-events/dispatch.js'));
});
beforeEach(() => {
  persisted = stored();
  rows.clear();
  dispatch.mockClear();
});
const door = () => vi.fn((input: Parameters<typeof commitOptionLevelsInProcess>[0]) => commitOptionLevelsInProcess(input, 'req-c5'));
async function saved(ops: readonly unknown[], c: typeof ctx = ctx): Promise<Rec> {
  const proposals = new ProposalStore();
  const p = await proposeChange({ dispatch, proposals }, c, { public_label: 'Record it', basis: 'From what the user said.', ops } as never);
  expect(p.status, JSON.stringify(p)).toBe('ok');
  const out = await applyChange({ dispatch, proposals, commitOptionLevels: door() }, c, { proposal_id: String((p as { data: Rec }).data.proposal_id) });
  expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', mutated: true, data: { saved: true } });
  expect(rows.size, 'ONE commit holds the figure and the claim').toBe(1);
  return (out as { data: Rec }).data;
}
/** The cold read: a fresh `read_canonical_context`, as the AI and a reopen see it. */
async function coldClaims(id: string): Promise<Rec[]> {
  const view = await readCanonicalContext({ dispatch }, ctx);
  const node = ((view as { data: Rec }).data.nodes as Rec[]).find((n) => n.id === id)!;
  return ((node.statements ?? []) as Rec[]).flatMap((r) => r.statements as Rec[]);
}

describe('GAP 1: a person\u2019s figure is kept as THEIR claim, in the same commit, and survives a cold read', () => {
  it('RED: the user\u2019s figure, with its condition and stance: their claim beside the value, read back cold, nothing lost', async () => {
    const data = await saved([queue20('user', 'about 20 minutes on a Saturday, if the weather holds', null, 'estimate')]);
    expect(data).toMatchObject({ faithful: true, written: [{ claim: { said_by: 'user' }, not_kept: [] }] });
    expect(await coldClaims('queue')).toContainEqual(expect.objectContaining({ said_by: 'user', quote: 'about 20 minutes on a Saturday, if the weather holds',
      form: 'point', low: 20, high: 20, unit: 'minutes', stance: 'estimate' }));
  });

  it('RED: a named party\u2019s option setting: their claim (name, relayed by the user, their words), never the user\u2019s; read back cold', async () => {
    const data = await saved([fig({ op: 'set_option_setting', option_id: 'add_staff', factor_id: 'staff', value: 3, unit: 'people', stance: 'hypothetical' },
      'third_party', 'the new rota would give us 3 assistants', 'area lead')]);
    expect(data).toMatchObject({ faithful: true, written: [{ stored_as: { origin: 'unknown' }, claim: { said_by: 'party', party: 'area lead' }, not_kept: [] }] });
    const claim = (await coldClaims('staff')).find((c) => c.party === 'area lead');
    expect(claim).toMatchObject({ said_by: 'party', party: 'area lead', relayed_by: 'user', quote: 'the new rota would give us 3 assistants', low: 3, stance: 'hypothetical' });
    expect(claim).not.toHaveProperty('speaker');
  });

  it('another source\u2019s claim on the subject stays beside it: construction\u2019s words on "visits" are kept, now beside the party\u2019s', async () => {
    const before = claimsOn('visits');
    expect(before.length).toBeGreaterThan(0);
    await saved([fig({ op: 'set_factor_value', factor_id: 'visits', value: 55, unit: 'visits', stance: 'estimate' }, 'third_party', 'visits are 55', 'finance')]);
    const after = claimsOn('visits');
    for (const b of before) expect(after).toContainEqual(expect.objectContaining({ quote: b.quote, form: b.form }));
    expect(after).toContainEqual(expect.objectContaining({ said_by: 'party', party: 'finance', quote: 'visits are 55', low: 55 }));
  });

  it('an unnamed party: their words are kept, but WHO is not known: said as unresolved, and that it was a third party is named as not kept', async () => {
    const data = await saved([fig({ op: 'set_factor_value', factor_id: 'visits', value: 55, unit: 'visits', stance: 'estimate' }, 'third_party', 'visits are 55')]);
    expect(data).toMatchObject({ faithful: false, written: [{ claim: { said_by: 'unknown' }, not_kept: [{ what: 'speaker', declared: 'third_party' }] }] });
  });

  const ADDING = 'We also run 4 weekend volunteers who keep the queue down.';
  const adding = { ...ctx, user_turn_text: ADDING, verified_user_messages: [ADDING] };
  const volunteers = (origin: string, quote: string | null, stance: string) => ({ op: 'add_to_model', kind: 'factor', label: 'Weekend volunteers',
    acts_on: 'queue', direction: 'negative', value: 4, unit: 'people', stance, source: { origin, quote, named_source: null } });
  const added = (data: Rec): Rec => (data.written as Rec[]).find((w) => w.op === 'add_to_model')!;

  it('RED: a factor the user ADDS with their figure: their claim on the new factor, in the SAME commit, read back cold; their words kept', async () => {
    const data = await saved([volunteers('user', 'We also run 4 weekend volunteers', 'stated_current')], adding);
    expect(data, JSON.stringify(data)).toMatchObject({ faithful: true });
    expect(added(data)).toMatchObject({ figure: 4, claim: { said_by: 'user' }, not_kept: [] });
    expect(await coldClaims(String(added(data).id))).toContainEqual(expect.objectContaining({ said_by: 'user', quote: 'We also run 4 weekend volunteers',
      form: 'point', low: 4, high: 4, unit: 'people', stance: 'stated_current' }));
    expect(claimsOn(String(added(data).id))).toContainEqual(expect.objectContaining({ said_by: 'user', source: ADDING }));
  });

  it('a factor Olumi adds with its own estimate: no one\u2019s claim on it', async () => {
    const data = await saved([volunteers('olumi', null, 'estimate')], adding);
    expect(added(data)).not.toHaveProperty('claim');
    expect(nodeOf(String(added(data).id)).user_statements ?? []).toEqual([]);
  });

  it('Olumi\u2019s own figure is no one\u2019s claim: nothing is added to the record', async () => {
    const before = JSON.stringify(nodeOf('queue').user_statements ?? null);
    const data = await saved([queue20('olumi', null, null, 'estimate')]);
    expect(data.written as Rec[]).toEqual([expect.not.objectContaining({ claim: expect.anything() })]);
    expect(JSON.stringify(nodeOf('queue').user_statements ?? null)).toBe(before);
  });
});

// Declared origin and stance survive the real batch writer and a cold canonical read.
describe('ONE declared pair edit writer', () => {
  it.each([
    ['user', 'stated_current', 'human'],
    ['olumi', 'estimate', 'ai'],
    ['unknown', 'estimate', 'unknown'],
    ['user', 'hypothetical', null],
  ] as const)('RED: %s/%s is carried without refusal or promotion to today', async (origin, stance, expectedOrigin) => {
    const data = await saved([queue20(origin, origin === 'olumi' ? null : 'about 20 minutes on a Saturday, if the weather holds', null, stance)]);
    expect(data.written).toEqual([expect.objectContaining({ declared: expect.objectContaining({ origin, stance }) })]);
    if (expectedOrigin === null) expect(nodeOf('queue').observed_state).toEqual((stored() as { nodes: Rec[] }).nodes.find((n) => n.id === 'queue')!.observed_state);
    else expect((data.written as Rec[])[0]!.stored_as.origin).toBe(expectedOrigin);
    if (origin === 'unknown') expect(nodeOf('queue').provenance).toBe('unverified_brief');
    if (origin !== 'olumi') expect(await coldClaims('queue')).toContainEqual(expect.objectContaining({ stance, low: 20, said_by: origin === 'unknown' ? 'unknown' : 'user' }));
    persisted = JSON.parse(JSON.stringify(persisted));
    expect(nodeOf('visits')).toEqual((stored() as { nodes: Rec[] }).nodes.find((n) => n.id === 'visits'));
    expect((await readCanonicalContext({ dispatch }, ctx)).status).toBe('ok');
  });
});


describe('ONE declared pair new-factor writer, second brief', () => {
  const words = 'There are 4 people on weekend cover; suppose we had 4 people on the rota.';
  it.each([
    ['user', 'stated_current', 'human'], ['olumi', 'estimate', 'ai'],
    ['unknown', 'estimate', 'unknown'], ['user', 'hypothetical', 'unknown'],
  ] as const)('RED: adding %s/%s keeps source and stance through the real door', async (origin, stance, expectedOrigin) => {
    const data = await saved([{ op: 'add_to_model', kind: 'factor', label: 'Weekend cover', acts_on: 'queue', direction: 'negative',
      value: 4, unit: 'people', stance, source: { origin, quote: origin === 'olumi' ? null : words, named_source: null } }],
    { ...ctx, user_turn_text: words, verified_user_messages: [words] });
    persisted = JSON.parse(JSON.stringify(persisted));
    const row = (data.written as Rec[])[0]!;
    expect(row.stored_as.origin).toBe(expectedOrigin);
    expect(row.figure).toBe(4);
    const added = nodeOf(String(row.id));
    if (stance === 'hypothetical') expect(added.observed_state).toBeUndefined();
    else expect((added.observed_state as Rec).raw_value).toBe(4);
    if (origin !== 'olumi') expect(await coldClaims(String(row.id))).toContainEqual(expect.objectContaining({
      stance, low: 4, high: 4, unit: 'people', said_by: origin === 'unknown' ? 'unknown' : 'user' }));
  });

  it.each([
    ['missing literal', 4, 'There are people on weekend cover.'],
    ['opposite sign', 4, 'There are -4 people on weekend cover.'],
  ])('a user credit needs its own literal figure: %s', async (_label, value, quote) => {
    const proposals = new ProposalStore();
    const out = await proposeChange({ dispatch, proposals }, { ...ctx, user_turn_text: String(quote), verified_user_messages: [String(quote)] }, {
      public_label: 'Add cover', basis: 'Typed figure', ops: [{ op: 'add_to_model', kind: 'factor', label: 'Weekend cover', acts_on: 'queue',
        direction: 'negative', value, unit: 'people', stance: 'stated_current', source: { origin: 'user', quote, named_source: null } }],
    } as never);
    expect(out.status).toBe('refused');
    expect(rows.size).toBe(0);
  });
});


it('a hypothetical cannot give a user credit in another unit, and a quote cannot borrow a number from another message', async () => {
  for (const op of [
    { ...queue20('user', 'about 20 minutes on a Saturday, if the weather holds', null, 'hypothetical'), unit: 'people' },
    queue20('user', 'The queue is about', null, 'stated_current'),
    queue20('user', 'We use 20 minutes at noon', null, 'stated_current'),
  ]) {
    const proposals = new ProposalStore();
    const out = await proposeChange({ dispatch, proposals }, ctx, { public_label: 'Record it', basis: 'Typed', ops: [op] } as never);
    expect(out.status).toBe('refused');
    expect(rows.size).toBe(0);
  }
});
