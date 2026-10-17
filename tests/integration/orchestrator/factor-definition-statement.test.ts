/**
 * ⭐ A USER'S QUALITATIVE STATEMENT GETS A HOME (DL-3 05:21Z; PROGRAMME-PLAN §156): what a factor's quantity covers, in the user's
 * words, recorded on its node by the existing statement-record owner and changing no figure. Served loss (Paul's export 6292b268,
 * turn 8): "That is a good point. It covers both." answered Olumi's question about the £500,000 limit on ‘Investment spend’, and
 * Olumi said the available edits could not record it. Path: `proposeStatement` → `readStatement` (the one door) → the card →
 * `authoriseChange` → `applyStatementRecord` → `commitOptionLevelsInProcess` → persisted → cold `GraphV3`.
 * Harness: `m1-strengthen-apply-keeps-figure.test.ts`'s store + door, verbatim. SYNTHETIC scenario (a marketing budget).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { assignEntityRefs } from '../../../src/orchestrator-v5/graph/entity-refs.js';
import { userStatementFor } from '../../../src/orchestrator-v5/statement-door/statements.js';

const SCENARIO_ID = 'f4f4f4f4-0000-4000-8000-000000000501';
const BUDGET = 'budget';
const SUBJECT = { kind: 'factor' as const, id: BUDGET, field: 'measure' as const };
const ASK = 'Does the £400,000 limit on ‘Marketing budget’ cover the agency fees as well as the media spend?';
type Json = Record<string, any>;
const PRESS = 'Yes, use this reading.';

function storedGraph(): unknown {
  const parsed = GraphV3.parse({
    nodes: [
      { id: 'plan', kind: 'decision', label: 'Campaign plan' },
      { id: 'paid', kind: 'option', label: 'Run a paid campaign', interventions: {} },
      { id: 'organic', kind: 'option', label: 'Stay organic', interventions: {} },
      { id: BUDGET, kind: 'factor', label: 'Marketing budget', observed_state: { value: 0.8, raw_value: 400000, unit: '£', cap: 500000, source: 'brief_extraction', extractionType: 'explicit' } },
      { id: 'heads', kind: 'factor', label: 'Sales headcount', observed_state: { value: 0.4, raw_value: 4, unit: 'people', cap: 10, source: 'brief_extraction', extractionType: 'explicit' } },
      { id: 'leads', kind: 'goal', label: 'Qualified leads', goal_direction: '>=', goal_threshold_raw: 900, goal_threshold_unit: 'leads' },
    ],
    edges: [
      { from: 'plan', to: 'paid', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'plan', to: 'organic', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: BUDGET, to: 'leads', strength: { mean: 0.3, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'heads', to: 'leads', strength: { mean: 0.2, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    ],
  });
  const projected = projectGraphForPersistence({ ...parsed, options: [] as Array<Record<string, unknown>> });
  return assignEntityRefs(projected, projected).graph;
}

let persisted: unknown = storedGraph();
const rows = new Map<string, { id: string; write: Record<string, unknown> }>();

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    readMostRecentPendingActions: async () => [],
    readFactsFor: async () => [],
    readRecent: async () => [...rows.values()].reverse().map(r => ({
      id: r.id, scenario_id: r.write.scenario_id, turn_id: r.write.turn_id, turn_class: r.write.turn_class,
      handler_id: r.write.handler_id, request_hash: r.write.request_hash, response_emitted: r.write.response_emitted,
      llm_calls_used: r.write.llm_calls_used, duration_ms: r.write.duration_ms,
      assistant_message: r.write.assistantMessage ?? null, created_at: '2026-10-17T00:00:00.000Z',
    })),
    readFactsWithTurnFor: async (ids: readonly string[]) => [...rows.values()].flatMap(r => {
      if (!ids.includes(r.id)) return [];
      const facts = (r.write.handler_facts ?? []) as unknown[];
      return facts.map(fact => ({ turn_id: r.id, fact_created_at: '2026-10-17T00:00:00.000Z', fact }));
    }),
    append: async (write: Record<string, unknown>) => {
      const key = `${String(write.scenario_id)}/${String(write.turn_id)}`;
      const existing = rows.get(key);
      if (existing !== undefined) return { id: existing.id };
      const id = `row-${rows.size + 1}`;
      rows.set(key, { id, write: JSON.parse(JSON.stringify(write)) });
      if (write.graph !== undefined) persisted = write.graph;
      return { id };
    },
    getScenarioOwner: async () => null,
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

/** Every byte of the model except the factor's statement records: what the analysis and every figure reader see. */
const withoutStatements = (g: unknown): unknown => {
  const c = structuredClone(g) as Json;
  for (const n of c.nodes as Json[]) delete n.user_statements;
  return c;
};

describe('what a factor covers, in the user\'s words: kept on its node, changing no figure', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  let createAgentCapabilities: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
  let ProposalStore: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').ProposalStore;
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
    ({ createAgentCapabilities } = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js'));
    ({ ProposalStore } = await import('../../../src/orchestrator-v5/agent-lane/proposal.js'));
  });
  beforeEach(() => { persisted = storedGraph(); rows.clear(); llmChatMock.mockClear(); });

  const capabilities = () => {
    const d = async () => ({ status: 200, json: { graph: persisted, graph_hash: computeAnalysisAffectingGraphHash(persisted as never) } });
    return createAgentCapabilities(d as never, new ProposalStore(), undefined, 'full', undefined, {
      commitOptionLevels: (input) => commitOptionLevelsInProcess(input, 'req-def'),
    });
  };
  /** `typed` is THIS turn's words; `earlier` the user's earlier typed words in the conversation (a chip press types nothing now). */
  const ctxOf = (typed: string, preceding?: string, earlier: readonly string[] = []) => ({ scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a',
    request_id: 'r', user_text: [...earlier, typed].filter((t) => t !== '').join('\n'), user_turn_text: typed,
    ...(preceding !== undefined ? { preceding_assistant_text: preceding } : {}) });
  const propose = (typed: string, statement: Json, preceding?: string, subject: Json = { kind: 'factor', label: 'Marketing budget', id: BUDGET, field: 'measure' },
    earlier: readonly string[] = []) => capabilities().proposeStatement!(ctxOf(typed, preceding, earlier) as never, { subject, statements: [statement] });
  /** The ONE commit's edit fact: what the history says was done, and whether a re-Run is owed. */
  const factOf = (): Json => (([...rows.values()][0]?.write.handler_facts ?? []) as Json[]).find((f) => f.fact_type === 'edit_graph')!;

  async function pressed(typed: string, statement: Json, preceding?: string): Promise<{ card: Json; out: Json }> {
    const caps = capabilities();
    const card = await caps.proposeStatement!(ctxOf(typed, preceding) as never, { subject: { kind: 'factor', label: 'Marketing budget', id: BUDGET, field: 'measure' }, statements: [statement] }) as Json;
    expect(card.ok, JSON.stringify(card)).toBe(true);
    // The press, as the route binds it: this card's id and its own button words (a reading Olumi derives: "Use this reading").
    const id = String(card.proposal_id);
    const out = await caps.authoriseChange({ ...ctxOf(PRESS, preceding), typed_approval_of: id, typed_approval_words: PRESS } as never, { proposal_id: id }) as Json;
    return { card, out };
  }

  it('⭐ named in the user\'s words: card → press → ONE commit → read back → cold, the words on the node and every figure as before', async () => {
    const typed = 'Our marketing budget covers both the agency fees and the media spend.';
    const before = structuredClone(persisted);
    const hash = computeAnalysisAffectingGraphHash(persisted as never);
    const { card, out } = await pressed(typed, { quote: typed, reading_words: 'both the agency fees and the media spend' });
    expect(card.public_label).toBe(`From your message: “${typed}” Olumi proposes this reading: what ‘Marketing budget’ covers: both the agency `
      + 'fees and the media spend. It is kept with ‘Marketing budget’ as your words and Olumi’s reading of them. It changes no figure: the '
      + 'model and its analysis use ‘Marketing budget’ exactly as before. Record this reading?');
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.follow_up).toBe('Recorded your words on ‘Marketing budget’, with Olumi’s reading of what it covers. No figure changed: the model '
      + 'and its analysis use it exactly as before.');
    expect(rows.size, 'ONE commit').toBe(1);
    // ⛔ BUDDY-A 05:30Z: words, not a figure: never the range-law adoption's receipt, and no re-Run owed.
    expect(factOf().result).toMatchObject({ rerun_recommended: false,
      safe_summary: 'Recorded your words and Olumi’s reading of what it covers; no figure changed' });
    expect(JSON.stringify(factOf())).not.toMatch(/range|approximation/i);
    const cold = GraphV3.parse(JSON.parse(JSON.stringify(persisted)));
    const record = userStatementFor(cold, SUBJECT);
    expect(record).toMatchObject({ field: 'measure', statements: [{ speaker: 'user', quote: typed, form: 'describes', reading: 'olumi' }] });
    // Non-operative: the analysis-affecting hash and every byte outside the records are as before.
    expect(computeAnalysisAffectingGraphHash(persisted as never)).toBe(hash);
    expect(computeAnalysisAffectingGraphHash(cold as never)).toBe(computeAnalysisAffectingGraphHash(GraphV3.parse(JSON.parse(JSON.stringify(before))) as never));
    expect(withoutStatements(cold)).toEqual(withoutStatements(GraphV3.parse(JSON.parse(JSON.stringify(before)))));
  }, 60_000);

  it('⭐ an answer to Olumi\'s own question (Paul\'s shape): bound by that question, the question kept with the answer', async () => {
    const preceding = `The figures look consistent so far. ${ASK} If so, the limit already includes both.`;
    const typed = 'Yes, it covers both.';
    const { card, out } = await pressed(typed, { quote: typed, answering: ASK, reading_words: 'the agency fees as well as the media spend' }, preceding);
    expect(card.public_label).toContain('Olumi proposes this reading: what ‘Marketing budget’ covers: the agency fees as well as the media spend.');
    expect(card.public_label).toContain(`You said this in answer to Olumi’s question: “${ASK}” The words for what it covers are that question’s, as your answer confirms them.`);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size, 'ONE commit').toBe(1);
    const cold = GraphV3.parse(JSON.parse(JSON.stringify(persisted)));
    // The answer and the whole question are kept apart: the question is Olumi's, never the user's words (no "£400,000" of theirs).
    expect(userStatementFor(cold, SUBJECT)).toMatchObject({ statements: [{ speaker: 'user', quote: typed, source: typed, answering: ASK, form: 'describes', reading: 'olumi' }] });
    expect(withoutStatements(cold)).toEqual(withoutStatements(GraphV3.parse(JSON.parse(JSON.stringify(storedGraph())))));
    expect(factOf().result).toMatchObject({ rerun_recommended: false });
  }, 60_000);

  it.each([
    ['the question is not in Olumi\'s last reply', 'Yes, it covers both.', { answering: ASK, reading_words: 'the agency fees as well as the media spend' },
      'Something else entirely.', 'not_this_subject', 'is not in Olumi’s last reply'],
    ['Olumi\'s question names ANOTHER factor', 'Yes, it covers both.', { answering: 'Does ‘Sales headcount’ include the contractors as well as the employees?',
      reading_words: 'the contractors as well as the employees' }, 'Does ‘Sales headcount’ include the contractors as well as the employees?', 'not_this_subject', 'is not clearly about'],
    ['nothing names it and it answers nothing', 'It covers both.', { reading_words: 'covers both' }, undefined, 'not_this_subject', 'is not clearly about'],
    ['the reading words are in neither the quote nor the question', 'Our marketing budget covers both the agency fees and the media spend.',
      { reading_words: 'the events budget too' }, undefined, 'not_this_field', 'Give reading_words'],
    // BUDDY-A 05:30Z: the AI's choice of one question does not say which factor a bare "both" is about.
    ['Olumi\'s last reply asks about TWO factors', 'It covers both.', { answering: ASK, reading_words: 'the agency fees as well as the media spend' },
      `${ASK} And does ‘Sales headcount’ include the contractors as well as the employees?`, 'not_this_subject', 'does not ask about ‘Marketing budget’ alone'],
    // Precedence: words that name ANOTHER factor are that factor's, whatever question the AI says they answer.
    ['the words name another factor', 'Sales headcount covers both.', { answering: ASK, reading_words: 'the agency fees as well as the media spend' },
      `Thanks. ${ASK}`, 'not_this_subject', 'is not clearly about'],
  ])('⛔ %s: nothing prepared, nothing written', async (_why, typed, extra, preceding, refusal, detail) => {
    const before = structuredClone(persisted);
    const p = await propose(typed, { quote: typed, ...extra }, preceding) as Json;
    expect(p, JSON.stringify(p)).toMatchObject({ ok: false, refusal });
    expect(String(p.detail)).toContain(detail);
    expect(persisted).toEqual(before);
    expect(rows.size).toBe(0);
  });

  // BUDDY-A 05:30Z: only words typed THIS turn answer Olumi's last question; an earlier "both" never acquires a later question.
  it.each([
    ['an earlier typed answer reused against the new question', 'Thanks, that is clear.'],
    ['a chip press (nothing typed this turn)', ''],
  ])('⛔ %s: not this turn\'s answer, nothing prepared', async (_why, now) => {
    const old = 'Yes, it covers both.';
    const p = await propose(now, { quote: old, answering: ASK, reading_words: 'the agency fees as well as the media spend' }, `Thanks. ${ASK}`,
      undefined, [old]) as Json;
    expect(p, JSON.stringify(p)).toMatchObject({ ok: false, refusal: 'not_answered_now' });
    expect(String(p.detail)).toContain('is not in what the user typed in this message');
    expect(rows.size).toBe(0);
  });

  it('⛔ CONTRAST (opt-in only): a row that does not opt in is NOT bound by Olumi\'s question (a goal\'s measure, as before)', async () => {
    const ask = 'Is ‘Qualified leads’ counted as leads that booked a call?';
    const typed = 'Yes, booked calls.';
    const p = await propose(typed, { quote: typed, answering: ask, reading_words: 'booked calls' }, ask, { kind: 'goal', label: 'Qualified leads', id: 'leads', field: 'measure' }) as Json;
    expect(p, JSON.stringify(p)).toMatchObject({ ok: false });
    expect(String(p.detail)).not.toContain('Olumi’s last reply');
    expect(rows.size).toBe(0);
  });
});
