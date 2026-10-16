/**
 * ⭐ G3 (VERIFY-2da89781 "Ranges for B and C (chat, T02 and T03). Stored nowhere"; TL 21:18Z adopting the AIE AMEND: "Chat ranges
 * are stored durably through the existing statement door, separately from sizing, and are never claimed as used by a Run").
 * Through the real /agent/v1/turn route with a scripted provider: the AI asks, the user states a link's effect as a range, the AI
 * calls propose_statement for that link, the card is pressed, the route registers, and a fresh /graph read is the cold readback.
 *  · the range is kept as the user's (`user_statements`, `form: range`, both ends, their whole sentence) and sizes nothing: the
 *    edge is byte-identical, still Olumi's placeholder, and the card says so;
 *  · then no asker asks that link's size again: the Strengthen card's selector and the Run's withhold (the link-size ask has its row);
 *  · NEGATIVES: two ranges, a single figure, words the user never typed: no card, nothing written.
 * Graph from the real build (scripted drafter, no range in the brief). SYNTHETIC brief and answers, never an unseen brief.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { __setUseAppendV6ForTest } from '../../append-v6-flag.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { linkHoldsStatedRange, userStatementFor } from '../../statement-door/statements.js';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { selectStrengthenPlaceholder } from '../guidance/select-strengthen-placeholder.js';
import { placeholderGoalWarning, unsizedLeaderGoalPaths } from '../goal-certainty.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH } from '../../../orchestrator/context/option-result-source.js';

const { facade } = vi.hoisted(() => ({ facade: { value: null as unknown } }));
vi.mock('../../session/index.js', async (original) => ({ ...await original<Record<string, unknown>>(), getSessionStore: () => facade.value }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({ ...await original<Record<string, unknown>>(),
  resolveUserIdentity: async () => ({ mode: 'off' }) }));

type Dict = Record<string, any>;
const SCENARIO = '550e8400-e29b-41d4-a716-4466554400db';
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const TOOL = 'propose_statement';
const apps: FastifyInstance[] = [];
let stored: Dict;
let writes: SessionTurnWrite[];
let phase: 'ask' | 'propose';
let emitted: boolean;
let question: string;
let args: Dict;
let toolResults: Dict[];

async function world(g: Dict) {
  stored = clone(g); writes = []; toolResults = []; emitted = false; phase = 'ask';
  const recent = () => writes.map((w, i) => makeSessionTurnRow({ id: `row-${i}`, scenario_id: w.scenario_id,
    turn_id: w.turn_id, turn_class: w.turn_class, handler_id: w.handler_id, request_hash: w.request_hash,
    response_emitted: w.response_emitted, llm_calls_used: w.llm_calls_used, duration_ms: w.duration_ms,
    user_message: w.userMessage ?? null, assistant_message: w.assistantMessage ?? null })).reverse();
  facade.value = createMockSessionStore({
    ensureScenarioExists: async () => ({ user_id: null }), getScenarioOwner: async () => null,
    scenarioExists: async () => true,
    loadGraph: async () => clone(stored), loadGraphAndBriefText: async () => ({ graph: clone(stored), briefText: null }),
    readRecent: async () => recent(), readMostRecentPendingActions: async () => clone(writes.at(-1)?.pending_actions ?? []),
    readFactsWithTurnFor: async (ids) => writes.flatMap((w, i) => ids.includes(`row-${i}`)
      ? w.handler_facts.map((fact) => ({ turn_id: `row-${i}`, fact_created_at: new Date().toISOString(), fact })) : []),
    append: async (w) => { writes.push(clone(w)); if (w.graph !== undefined) stored = clone(w.graph) as Dict; return { id: `row-${writes.length - 1}` }; },
  });
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init: { body?: unknown }) => {
    expect(String(url)).toBe('https://api.openai.com/v1/responses');
    const request = JSON.parse(String(init.body));
    for (const item of request.input ?? []) if (item.type === 'function_call_output') {
      try { toolResults.push(JSON.parse(item.output)); } catch { /* the raw request stays in the assertion messages */ }
    }
    const output = phase === 'propose' && !emitted
      ? [{ type: 'function_call', call_id: 'native-level', name: TOOL, arguments: JSON.stringify(args) }]
      : [{ type: 'message', content: [{ type: 'output_text', text: phase === 'ask' ? question : 'Review the current-level card before it is saved.' }] }];
    emitted = true;
    return new Response(JSON.stringify({ id: `stub-${randomUUID()}`, status: 'completed', output }), { status: 200 });
  }));
  const app = Fastify({ logger: false }); apps.push(app);
  app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: clone(stored),
    graph_hash: computeAnalysisAffectingGraphHash(stored as never), graph_identity_hash: computeGraphIdentityHash(stored as never) }));
  const register = (await import('../../../routes/assist.v1.scenario-graph-register.js')).default;
  await app.register(register);
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js'); await app.register(agentV1TurnRoute);
  await app.ready();
  const session = `link-range-${randomUUID()}`;
  return { app, turn: (message: string, chip?: Dict) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    kind: 'message', scenario_id: SCENARIO, agent_session_id: session, message, ...(chip ? { chip } : {}),
  } }) };
}


const LEVEL = 'We run a 300-member gym and weekday attendance is about 45% at the moment.';
const TARGET = 'We need weekday attendance to reach at least 55% by the end of March next year.';
const BRIEF = `${LEVEL} ${TARGET} Option one is a corporate wellness deal with two offices nearby.`;
const DRAFT = JSON.stringify({
  goal: { kind: null, deliverable: null, metric: 'weekday attendance', operator: '>=', target_stated: true, value: 55, unit: '%', horizon_months: null,
    provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 45, baseline_provenance: 'explicit', scope: null, quantity_frame: 'level',
    basis: { reference: 'today', denominator: null, period_months: null, period_kind: 'at_end', effect_unit: 'percentage points', effects_at_period_end: false, also_required: null, open_question: null },
    source_quote: TARGET, deadline_words: null },
  constraints: [],
  options: [
    { label: 'Keep current setup', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
    { label: 'Corporate wellness deal', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
      interventions: [{ factor_label: 'Corporate deal active', value: 1, value_kind: 'absolute', unit: '0/1', provenance: 'inferred' }] },
  ],
  factors: [{ label: 'Corporate deal active', role: 'controllable', baseline_known: false, baseline_value: 0, unit: '0/1', provenance: 'inferred', plausible_max: 1 }],
  risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
  links: [{ from: 'Corporate deal active', to: 'weekday attendance', direction: 'positive', provenance: 'ai_proposed', effect_amount: null,
    effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null }],
  statements: [
    { quote: LEVEL, subject: { kind: 'goal', label: 'weekday attendance', to_label: null, factor_label: null }, field: 'level', form: 'point', value: 45, low: null, high: null, unit: '%', qualifier: null, conditions: null },
    { quote: TARGET, subject: { kind: 'goal', label: 'weekday attendance', to_label: null, factor_label: null }, field: 'target', form: 'lower_bound', value: 55, low: null, high: null, unit: '%', qualifier: null, conditions: null },
  ],
});
async function builtGraph(): Promise<Dict> {
  let graph: Dict | undefined;
  const r = await buildModelFromBrief('7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d', BRIEF, (async (path: string, body: Dict) => {
    if (path.endsWith('/graph/register')) { graph = clone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: DRAFT, status: 'completed' })) as never) as Dict;
  expect(r.ok, JSON.stringify(r).slice(0, 800)).toBe(true);
  return graph!;
}
const idOf = (g: Dict, label: string): string => (g.nodes as Dict[]).find((n) => n.label === label)!.id as string;
const edgeOf = (g: Dict, from: string, to: string): Dict => (g.edges as Dict[]).find((e) => e.from === from && e.to === to)!;
const ASK = 'How much would the corporate deal lift weekday attendance?';

/** The AI asks; the user answers; the AI calls propose_statement for the deal → attendance link with `quote`. */
async function answered(g: Dict, answer: string, quote: string) {
  question = ASK;
  const from = idOf(g, 'Corporate deal active'); const to = idOf(g, 'weekday attendance');
  args = { subject: { kind: 'link', id: from, to_id: to, label: 'Corporate deal active', to_label: 'weekday attendance', field: 'effect' }, statements: [{ quote }] };
  const w = await world(g);
  const asked = await w.turn('What does the model still need from me?'); expect(asked.statusCode, asked.body).toBe(200);
  phase = 'propose'; emitted = false;
  const res = await w.turn(answer); expect(res.statusCode, res.body).toBe(200);
  const b = res.json();
  expect(b._agent?.tool_calls).toContainEqual(expect.objectContaining({ name: TOOL }));
  return { ...w, b, from, to, card: b.suggested_actions?.find((c: Dict) => String(c.id).startsWith('agent-approve-proposal:')) };
}

beforeEach(() => {
  __setUseAppendV6ForTest(false);
  process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
});
afterEach(async () => { while (apps.length) await apps.pop()!.close(); vi.unstubAllGlobals(); });

describe('a link\'s effect stated as a range in chat is stored through the statement door, and never asked again', () => {
  it('⭐ the range is kept as the user\'s words and ends, sizes nothing, and no asker asks that link\'s size again', async () => {
    const g = await builtGraph();
    const said = 'The corporate deal could lift weekday attendance by somewhere between 4 and 7 points.';
    const option = idOf(g, 'Corporate wellness deal');
    const w = await answered(g, said, said);
    const { from, to } = w;
    // BEFORE: the link is a placeholder its askers ask about.
    expect(selectStrengthenPlaceholder(g, [option])).toMatchObject({ from_id: from, to_id: to });
    expect(w.card, JSON.stringify({ calls: w.b._agent?.tool_calls, toolResults })).toBeDefined();
    expect(toolResults.map((r) => String(r.public_label ?? '')).join(' ')).toContain('does not size this link');
    expect(writes.filter((x) => x.graph !== undefined)).toHaveLength(0);
    const approved = await w.turn(w.card.message, w.card); expect(approved.statusCode, approved.body).toBe(200);
    const graphWrites = writes.filter((x) => x.graph !== undefined);
    expect(graphWrites).toHaveLength(1);
    const read = await w.app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
    const cold = clone(read.json().graph);
    expect(graphWrites[0]!.graph).toEqual(cold);
    // KEPT as the user's: their whole sentence, the range as a range, Olumi's reading flagged; a press record (no attest).
    const record = userStatementFor(cold, { kind: 'link', id: from, to_id: to, field: 'effect' })!;
    expect(record.attest).toBeUndefined();
    expect(record.statements).toEqual([expect.objectContaining({ speaker: 'user', reading: 'olumi', quote: said, form: 'range', low: 4, high: 7 })]);
    expect(linkHoldsStatedRange(cold, from, to)).toBe(true);
    // SIZES NOTHING: the edge is byte-identical (still Olumi's placeholder).
    expect(edgeOf(cold, from, to)).toEqual(edgeOf(g, from, to));
    // NEVER ASKED AGAIN: the Strengthen card's selector and the Run's withhold (the link-size ask: link-size-ask.test.ts).
    expect(selectStrengthenPlaceholder(cold, [option])).toBeNull();
    const withheld = placeholderGoalWarning(cold, unsizedLeaderGoalPaths(cold, [option]), GOAL_FIGURES_PLACEHOLDER_PATH) as Dict;
    expect(withheld.first_ask).toBeUndefined();
    expect(withheld.acceptable_links).toBeUndefined();
  }, 60_000);

  it.each([
    ['two ranges in one statement', 'The corporate deal could lift weekday attendance by 4 to 7 points, or 2 to 3 points in winter.'],
    ['a single figure, not a range', 'The corporate deal could lift weekday attendance by about 5 points.'],
  ] as const)('NEGATIVE (%s): no card, nothing written', async (_n, said) => {
    const g = await builtGraph();
    const w = await answered(g, said, said);
    expect(w.b._agent?.tool_calls).toContainEqual(expect.objectContaining({ name: TOOL, ok: false, mutated: false }));
    expect(w.card).toBeUndefined();
    expect(writes.filter((x) => x.graph !== undefined)).toHaveLength(0);
  }, 60_000);

  it('NEGATIVE: words the user never typed are never the source (statement_not_found): no card', async () => {
    const g = await builtGraph();
    const w = await answered(g, 'Somewhere between 4 and 7 points, I think.', 'The corporate deal could lift weekday attendance by somewhere between 4 and 7 points.');
    expect(toolResults, JSON.stringify(toolResults)).toContainEqual(expect.objectContaining({ ok: false, refusal: 'statement_not_found' }));
    expect(w.card).toBeUndefined();
  }, 60_000);
});
