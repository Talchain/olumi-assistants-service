/**
 * RT-1 (red team #87 5992417601; HARNESS INTEGRATION lease 5992955500): `/agent/v1/turn` never read
 * `selected_elements`, so "Is the value on this one from me or from you?" with a node selected was answered about a
 * different link (staging a4977d9, 3/3, wire-captured: the request carried the selection, the reply ignored it).
 *
 * Rows bind by IDENTITY: the selected node's id and canonical label in the bytes the stubbed model reads, and the wire
 * sidecar's ids. A discriminating pair (same words, A vs B selected) proves the note follows the selection, not the
 * conversation. Served bytes: the W3 cold read (`520aab46`, CEE `f074916`). 0 LLM calls.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentSelectionContext, SELECTION_MAX_ELEMENTS, SELECTION_NOTE_PREFIX } from '../selection-context.js';
import { CURRENT_MODEL_STATE_PREFIX } from '../runtime/agent-loop.js';
import { parseSelectedElements } from '../../boundary/request-extensions.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-w3-520aab46-cold-read-f074916.json', import.meta.url), 'utf8')) as Json;
const SCENARIO = '6a7c2f0e-1b3d-4e5f-8a9b-0c1d2e3f4a5b';
const PRICE = { id: 'pro_plan_price', label: 'Pro plan price' };
const CHURN = { id: 'monthly_churn', label: 'Monthly churn' };
const QUESTION = 'Is the value on this one from me or from you?';

/** A state shaped as `getCanonicalState` returns it: only `ok` and `entities` are read. */
const stateOf = (...entities: Json[]): Json => ({ ok: true, mutated: false, entities });
const entity = (n: { id: string; label: string }, extra: Json = {}): Json => ({ id: n.id, label: n.label, kind: 'factor', ...extra });
const noteEntries = (note: string): Json[] => JSON.parse(note.slice(SELECTION_NOTE_PREFIX.length).match(/^\[.*?\](?=\s|$)/s)?.[0] ?? '[]');

describe('RT-1 selection context (pure)', () => {
  const state = stateOf(entity(PRICE, { value_provenance: { source: 'brief_extraction' } }),
    entity(CHURN, { value_provenance: { source: 'cee_inference' } }));

  it('S0 nothing selected → no note and no sidecar (the turn is exactly as before)', () => {
    expect(agentSelectionContext(null, state)).toBeNull();
    expect(agentSelectionContext({ node_ids: [], edge_ids: [] }, state)).toBeNull();
    expect(parseSelectedElements(undefined)).toBeNull();
    expect(parseSelectedElements(42 as never), 'a malformed value is dropped, never thrown').toBeNull();
    expect(agentSelectionContext(parseSelectedElements({ not: 'a selection' } as never), state), 'an object naming nothing selects nothing').toBeNull();
  });

  it('S1 discriminating pair: the note names exactly the selected entity, with its own value source', () => {
    const a = agentSelectionContext(parseSelectedElements([{ id: PRICE.id, kind: 'factor', label: 'stale UI label' }]), state)!;
    const b = agentSelectionContext(parseSelectedElements([{ id: CHURN.id, kind: 'factor' }]), state)!;
    expect(noteEntries(a.note).map((e) => e.id)).toEqual([PRICE.id]);
    expect(noteEntries(b.note).map((e) => e.id)).toEqual([CHURN.id]);
    expect(noteEntries(a.note)[0]).toMatchObject({ label: PRICE.label, value_provenance: { source: 'brief_extraction' } });
    expect(noteEntries(b.note)[0]).toMatchObject({ label: CHURN.label, value_provenance: { source: 'cee_inference' } });
    expect(a.note, 'the canonical label, never the client one').not.toContain('stale UI label');
    expect(a.grounded).toEqual({ element_ids: [PRICE.id], unresolved: 'none' });
    expect(b.grounded).toEqual({ element_ids: [CHURN.id], unresolved: 'none' });
  });

  it('S2 an id the model does not hold → not_in_model, said, and never replaced by another element', () => {
    const c = agentSelectionContext({ node_ids: ['shops_operating'], edge_ids: [] }, state)!;
    expect(c.grounded).toEqual({ element_ids: [], unresolved: 'not_in_model' });
    expect(c.note).toContain('does not contain');
    expect(c.note).not.toContain(PRICE.id);
    const mixed = agentSelectionContext({ node_ids: [CHURN.id, 'shops_operating'], edge_ids: [] }, state)!;
    expect(mixed.grounded).toEqual({ element_ids: [CHURN.id], unresolved: 'not_in_model' });
  });

  it('S3 the turn state could not be read → could_not_check, never not_in_model', () => {
    for (const unread of [undefined, { ok: false, refusal: 'not_found' }]) {
      const c = agentSelectionContext({ node_ids: [PRICE.id], edge_ids: [] }, unread)!;
      expect(c.grounded).toEqual({ element_ids: [], unresolved: 'could_not_check' });
      expect(c.note).toContain('could not be checked');
    }
  });

  it('S4 a link is named only when that exact directed pair is in the state\'s link list (Codex P2 on #2584)', () => {
    const ref = `${PRICE.id}→${CHURN.id}`;
    const withLink = { ...state, links: [{ from: PRICE.id, to: CHURN.id, source: 'cee_hypothesis', band: 'moderate' }] };
    const present = agentSelectionContext({ node_ids: [], edge_ids: [ref] }, withLink)!;
    expect(noteEntries(present.note)).toEqual([{ kind: 'link', from: PRICE, to: CHURN, source: 'cee_hypothesis', band: 'moderate' }]);
    expect(present.grounded).toEqual({ element_ids: [], unresolved: 'none' });
    // Negative twin: both ends present, the link absent (deleted) → not_in_model, and no link is named.
    const absent = agentSelectionContext({ node_ids: [], edge_ids: [ref] }, { ...state, links: [] })!;
    expect(absent.grounded.unresolved).toBe('not_in_model');
    expect(noteEntries(absent.note)).toEqual([]);
    // Reversed: B→A is not A→B.
    const reversed = agentSelectionContext({ node_ids: [], edge_ids: [`${CHURN.id}→${PRICE.id}`] }, withLink)!;
    expect(reversed.grounded.unresolved).toBe('not_in_model');
    // No link list to check against, or an unreadable reference → could_not_check.
    expect(agentSelectionContext({ node_ids: [], edge_ids: [ref] }, state)!.grounded.unresolved).toBe('could_not_check');
    expect(agentSelectionContext({ node_ids: [], edge_ids: ['e5'] }, withLink)!.grounded.unresolved).toBe('could_not_check');
  });

  it(`S5 at most ${SELECTION_MAX_ELEMENTS} elements reach the note`, () => {
    const many = Array.from({ length: 30 }, (_, i) => entity({ id: `f${i}`, label: `Factor ${i}` }));
    const c = agentSelectionContext({ node_ids: many.map((e) => e.id), edge_ids: [] }, stateOf(...many))!;
    expect(c.grounded.element_ids).toHaveLength(SELECTION_MAX_ELEMENTS);
  });
});

const rows: Json[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_s: string, id: string) => rows.find((r) => r.turn_id === id) ?? null),
  append: vi.fn(async (row: Json) => { rows.push({ ...row, id: row.turn_id }); return { id: String(row.turn_id) }; }),
  readRecent: vi.fn(async () => [...rows].reverse()),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('RT-1 live in-process /agent/v1/turn with a stubbed model', () => {
  let app: FastifyInstance;
  const requests: Json[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ output: [
        { type: 'message', content: [{ type: 'output_text', text: 'That figure comes from your brief.' }] },
      ] }), { status: 200 });
    }));
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => SERVED);
    await app.register(agentV1TurnRoute);
    await app.ready();
  });
  beforeEach(() => { requests.length = 0; });
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  const send = (payload: Json) => app.inject({ method: 'POST', url: '/agent/v1/turn',
    payload: { kind: 'message', scenario_id: SCENARIO, message: QUESTION, ...payload } });
  /** The developer texts of the FIRST model request, in order. */
  const developerTexts = (): string[] => (requests[0]?.input as Json[] ?? []).filter((i) => i.role === 'developer')
    .flatMap((i) => i.content ?? []).map((p: Json) => String(p.text ?? ''));
  const selectionNotes = (): string[] => developerTexts().filter((t) => t.startsWith(SELECTION_NOTE_PREFIX));

  it('R1 discriminating pair on the route: the same words with A vs B selected put A vs B in front of the model', async () => {
    for (const [picked, other] of [[PRICE, CHURN], [CHURN, PRICE]] as const) {
      requests.length = 0;
      const res = await send({ turn_id: randomUUID(), selected_elements: [{ id: picked.id, kind: 'factor', label: picked.label }] });
      expect(res.statusCode).toBe(200);
      expect(requests.length, 'the stubbed model was called').toBeGreaterThan(0);
      const notes = selectionNotes();
      expect(notes).toHaveLength(1);
      const entries = noteEntries(notes[0]!);
      expect(entries.map((e) => e.id)).toEqual([picked.id]);
      expect(entries[0]!.label).toBe(picked.label);
      expect(notes[0]).not.toContain(`"${other.id}"`);
      expect(res.json()._grounded_selection).toEqual({ element_ids: [picked.id], unresolved: 'none' });
    }
  });

  it('R2 the note follows the model state it was resolved against and precedes the user message', async () => {
    await send({ turn_id: randomUUID(), selected_elements: [{ id: PRICE.id, kind: 'factor' }] });
    const input = requests[0]!.input as Json[];
    const textOf = (i: Json): string => String(i.content?.[0]?.text ?? '');
    const stateAt = input.findIndex((i) => i.role === 'developer' && textOf(i).startsWith(CURRENT_MODEL_STATE_PREFIX));
    const noteAt = input.findIndex((i) => i.role === 'developer' && textOf(i).startsWith(SELECTION_NOTE_PREFIX));
    // The LAST user item is this turn's (earlier turns in the session ask the same words).
    const userAt = input.map((i) => i.role === 'user' && textOf(i) === QUESTION).lastIndexOf(true);
    expect(stateAt, 'control: the turn was given its model state').toBeGreaterThanOrEqual(0);
    expect(noteAt).toBe(stateAt + 1);
    expect(userAt).toBe(noteAt + 1);
  });

  it('R3 control: no selection → no note and no sidecar key', async () => {
    const res = await send({ turn_id: randomUUID() });
    expect(requests.length).toBeGreaterThan(0);
    expect(selectionNotes()).toEqual([]);
    expect(res.json()).not.toHaveProperty('_grounded_selection');
  });

  it('R4 an id the model does not hold is said as such on the wire', async () => {
    const res = await send({ turn_id: randomUUID(), selected_elements: [{ id: 'shops_operating', kind: 'factor' }] });
    expect(res.json()._grounded_selection).toEqual({ element_ids: [], unresolved: 'not_in_model' });
    expect(selectionNotes()[0]).toContain('does not contain');
  });

  it('R5 the note is this turn\'s only: the next turn in the same session does not inherit it', async () => {
    const session = 'rt1-r5-session';
    await send({ turn_id: randomUUID(), agent_session_id: session, selected_elements: [{ id: CHURN.id, kind: 'factor' }] });
    expect(selectionNotes(), 'control: turn 1 carried its note').toHaveLength(1);
    requests.length = 0;
    await send({ turn_id: randomUUID(), agent_session_id: session, message: 'And what about the other options?' });
    expect(requests.length).toBeGreaterThan(0);
    const all = (requests[0]!.input as Json[]).flatMap((i) => i.content ?? []).map((p: Json) => String(p.text ?? ''));
    expect(all.some((t) => t.startsWith(SELECTION_NOTE_PREFIX))).toBe(false);
  });

  it('R8 a served link is named with its own projection; the same pair reversed is not_in_model', async () => {
    const edge = (SERVED.graph.edges as Json[]).find((e) => e.from === PRICE.id)!;
    const res = await send({ turn_id: randomUUID(), selected_elements: [{ id: `${edge.from}→${edge.to}`, kind: 'edge' }] });
    const entries = noteEntries(selectionNotes()[0]!);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'link', from: { id: edge.from }, to: { id: edge.to } });
    expect(res.json()._grounded_selection).toEqual({ element_ids: [], unresolved: 'none' });
    requests.length = 0;
    const back = await send({ turn_id: randomUUID(), selected_elements: [{ id: `${edge.to}→${edge.from}`, kind: 'edge' }] });
    expect(back.json()._grounded_selection).toEqual({ element_ids: [], unresolved: 'not_in_model' });
  });

  it('R6 retry after selecting elsewhere (same turn id, live selection changed) replays the recorded answer: no 409, no second model call', async () => {
    const turnId = randomUUID();
    const first = await send({ turn_id: turnId, selected_elements: [{ id: PRICE.id, kind: 'factor' }] });
    expect(first.statusCode).toBe(200);
    const calls = requests.length;
    expect(calls, 'control: the first send reached the model').toBeGreaterThan(0);
    const retry = await send({ turn_id: turnId, source: 'retry', selected_elements: [{ id: CHURN.id, kind: 'factor' }] });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()._agent?.replayed).toBe(true);
    expect(requests.length, 'a replay makes no model call').toBe(calls);
  });

  it('R7 twin: a retry with the SAME selection replays too', async () => {
    const turnId = randomUUID();
    await send({ turn_id: turnId, selected_elements: [{ id: CHURN.id, kind: 'factor' }] });
    const calls = requests.length;
    const retry = await send({ turn_id: turnId, source: 'retry', selected_elements: [{ id: CHURN.id, kind: 'factor' }] });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()._agent?.replayed).toBe(true);
    expect(requests.length).toBe(calls);
  });
});
