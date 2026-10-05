import { explainRun } from './fixtures/run-explanation-follow-up.js';
/** Selected coaching reaches the real Agent route on every conversation path. No provider is called. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { HOST_TOOL_CONTRACT, SELECTED_COACH_V02_TEMPLATE } from '../coach-route-v0_2.js';
import { READY_GRAPH } from './fixtures/first-analysis-graphs.js';
import { asSent } from './helpers/as-sent.js';

const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const TEMPLATE_SHA = '170ac5e7a629f8408fd92857b34d196aede92b99e2ebbce281c23a900c9ed66d';
// AI HARNESS (1 Oct, DL 5936996041 on R3 DEFECT 2): the links sentence defines `sizing` (F1b's linkSizing) and no longer
// says `defaulted` means unsized: 325bb61e… → 26f7e9c0…. The template sha above is unchanged.
// MODEL GENERATION (2 Oct, M1 Accept receipt; Codex pre-review 2 on CEE mg/accept-receipt-authorship): the link-set sentence
// no longer says a user-named band is always "recorded as theirs" — a band the link already sits in records review and stays
// Olumi's estimate (R11): 26f7e9c0… → 913872bf…, +210 bytes. The template sha above is unchanged.
// AI HARNESS (2 Oct, RC 5950124321): none_measurable makes no claim; the sentence it was told to say is gone: 913872bf… → cd04fd8c….
const HOST_SHA = 'cd04fd8c700ea94434e31465d01e785312d61d8394441826974f9836f335f68b';
// + REPLY_LENGTH_INSTRUCTION appended after the host contract (1 Oct, AIQ bound v2 5922412812): 26,834 → 27,324 bytes.
// + K2: the budgets are limits, one question, the goal's target left to the host's D1 (1 Oct, DL 5925649954 item 5): 27,324 → 27,547 bytes.
// + AI HARNESS: the links sentence's `sizing` definition replaces the `defaulted` one (1 Oct, DL 5936996041): 27,547 → 27,833 bytes.
// Derived from the request the real route SENT (harness raw body), never computed by hand.
// + the link-set sentence above (MG, 2 Oct): 27,833 → 28,043 bytes.
// + none_measurable makes no claim (AI HARNESS, RC 5950124321): 28,043 → 28,026 bytes.
// + MODEL_RELATIVE_NAMING_INSTRUCTION appended after the reply-length sentence (WORDING BATCH, DL 0df0e1 lease, 5 Oct):
//   28,026 → 28,835 bytes (+1 space +808). Rebuilt from the source literals, it reproduced the old pin b2653d0e… exactly first.
// + the naming rule glosses N in positive words and bans the recommend stem even negated (WORDING, DL 0df0e1 cut 3,
//   Acceptance rehearsal 2), and names an option in Part B's neutral form "N% of runs supported X" (Codex r1 #2614: "scored
//   highest" is false on a minimise Run and inexact under split tie credit): 28,835 → 29,197 bytes (+362). Same rebuild,
//   which reproduced 2bc25cba… exactly first.
const RENDERED_SHA = '9adadf8cd11696564c4e0f3bf222061b3735d1093d6f7784936d01331cc49936';
const RENDERED_BYTES = 29_197;
/** The model-relative naming rule's sentence form (`MODEL_RELATIVE_NAMING_INSTRUCTION`), matched as SENT bytes. */
const NAMING_RULE_FORM = 'name it only as \u201cIn this model, N% of runs supported \u2018X\u2019\u201d';
const SCENARIO = '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a0f';
const FIRST_SCENARIO = '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a11';
const FAILED_SCENARIO = '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a12';
const fx = JSON.parse(readFileSync(new URL('../../compose/__tests__/fixtures/leader-gate-real-replies.json', import.meta.url), 'utf8')) as {
  state: { draft_graph: unknown; analysis_state: Record<string, unknown>; analysis_ready: unknown };
};
const runFixture = JSON.parse(readFileSync(new URL('../../coaching/__tests__/fixtures/c19-8428207-B.run-turns.trimmed.json', import.meta.url), 'utf8')) as {
  turns: { t2: { analysis_result: { computed_against_hash: string } & Record<string, unknown> } };
};
const runBlock = runFixture.turns.t2.analysis_result;

type Sent = { model: string; instructions: string; reasoning?: { effort?: string }; max_output_tokens: number;
  tools?: { name?: string }[]; tool_choice?: unknown; text?: { format?: { name?: string } } };
const sent: Sent[] = [];
const registeredAtCall: boolean[] = [];
let scripted: Record<string, unknown>[][] = [];
let readMode: 'populated' | 'empty' | 'failed' = 'populated';
let registered = false;
let ran = false;
const BRIEF = 'Should we raise the Pro price or grow the Pro subscriber base to lift MRR?';
const candidate = {
  goal: { metric: 'MRR', operator: '>=', value: 100, unit: 'k', horizon_months: 6, provenance: 'explicit' },
  constraints: [],
  options: [{ label: 'Raise the Pro price', provenance: 'explicit', interventions: [] }],
  factors: [{ label: 'Pro subscriber base', role: 'controllable', baseline_known: true, baseline_value: 5, unit: 'k', provenance: 'explicit' }],
  risks: [], outcomes: [{ label: 'MRR', provenance: 'inferred' }],
  links: [{ from: 'Pro subscriber base', to: 'MRR', direction: 'positive', provenance: 'inferred' }],
  unknowns: [],
};
const rows = new Map<string, { id: string; turn_id: string; request_hash: string; assistant_message: string | null }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string }) => {
    const row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveUserIdentity: async () => ({ mode: 'off' }),
}));

const say = (text: string) => [{ type: 'message', content: [{ type: 'output_text', text }] }];
const proposeLink = [{ type: 'function_call', name: 'propose_model_change', call_id: 'link-1',
  arguments: JSON.stringify({ from_label: 'Price-release alignment', to_label: 'Pro conversion rate',
    direction: 'positive', strength: 'strong', rationale: 'Timing changes how the price lands.' }) }];

describe('selected Sol-high coach on the actual Agent route', () => {
  let app: FastifyInstance;
  let turn = 0;
  let interpretOnlyConstraint: string;
  let interpreterV02: string;

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body?: unknown }) => {
      const body = asSent(JSON.parse(String(init.body))) as Sent;
      sent.push(body);
      registeredAtCall.push(registered);
      if (body.text?.format?.name === 'whole_candidate') {
        return new Response(JSON.stringify({ status: 'completed', output: say(JSON.stringify(candidate)) }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'completed', output: scripted.shift() ?? say('Done.') }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const route = await import('../../../routes/agent-v1-turn.js');
    interpretOnlyConstraint = route.INTERPRET_ONLY_CONSTRAINT;
    interpreterV02 = route.INTERPRETER_V02_BANKED;
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => {
      ran = true;
      return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [],
        graph_hash: runBlock.computed_against_hash, blocks: [runBlock],
        analysis_ready: fx.state.analysis_ready, analysis_state: fx.state.analysis_state };
    });
    app.post('/assist/v1/scenarios/:id/graph', async (_req, reply) => {
      if (readMode === 'failed') return reply.code(500).send({ error: 'read_failed' });
      if (readMode === 'empty' && !registered) return { graph: null, graph_hash: null };
      if (readMode === 'empty' && !ran) return { graph: READY_GRAPH, graph_hash: runBlock.computed_against_hash,
        analysis_state: { run_state: { kind: 'never_run' }, leader_claim: { permitted: false, withheld_reason: 'no_analysis' } } };
      return { graph: readMode === 'empty' ? READY_GRAPH : fx.state.draft_graph,
        graph_hash: runBlock.computed_against_hash, analysis_ready: fx.state.analysis_ready,
        analysis_state: fx.state.analysis_state, analysis_result: runBlock };
    });
    app.post('/assist/v1/scenarios/:id/graph/register', async () => {
      registered = true;
      return { registered: true, graph_hash: runBlock.computed_against_hash,
        model_version: { version_id: '00000000-0000-4000-8000-000000000001', version_number: 1 } };
    });
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [], next_cursor: null }));
    await app.register(route.agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => {
    if (app) await app.close();
    vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED;
    delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => { rows.clear(); sent.length = 0; registeredAtCall.length = 0; scripted = [];
    readMode = 'populated'; registered = false; ran = false; });

  const sendTurn = async (message: string, output: Record<string, unknown>[][],
    chip?: { id: string; action_type: string }, scenario = SCENARIO) => {
    scripted = [...output];
    turn += 1;
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: scenario, message, turn_id: `5d4c3b2a-1f0e-4d9c-8b7a-${String(turn).padStart(12, '0')}`,
      ...(chip ? { chip } : {}),
    } });
    expect(response.statusCode, response.body.slice(0, 300)).toBe(200);
    if (chip?.action_type !== 'run_analysis') expect(scripted, 'each scripted model hop was consumed').toEqual([]);
    return response.json() as { _diagnostic_trace?: { fast_path?: string } };
  };
  const selected = (body: Sent) => {
    expect(body.model).toBe('gpt-6.1-sol');
    expect(body.reasoning?.effort).toBe('high');
    expect(body.max_output_tokens).toBe(3400);
  };
  const conversationBodies = () => sent.filter((body) => body.text?.format?.name !== 'whole_candidate');

  it('uses the exact selected template and host authority on an ordinary conversation', async () => {
    expect(sha256(SELECTED_COACH_V02_TEMPLATE)).toBe(TEMPLATE_SHA);
    expect(sha256(HOST_TOOL_CONTRACT)).toBe(HOST_SHA);
    expect(SELECTED_COACH_V02_TEMPLATE.split('{{MODE_AND_AUTHORITY}}')).toHaveLength(2);
    await sendTurn('What does the analysis say?', [say('The comparison is provisional.')]);
    expect(sent).toHaveLength(1);
    selected(sent[0]!);
    expect(Buffer.byteLength(sent[0]!.instructions)).toBe(RENDERED_BYTES);
    expect(sha256(sent[0]!.instructions)).toBe(RENDERED_SHA);
    expect(sent[0]!.instructions).toContain('To change the model you must first call a proposing tool');
    expect(sent[0]!.instructions).toContain('authorise_change');
    // The exported host contract is the one-space join of all 31 approved old entries.
    expect(sent[0]!.instructions).toContain(HOST_TOOL_CONTRACT);
    // WORDING BATCH: the served conversation prompt carries the model-relative naming rule (agent.converse).
    expect(sent[0]!.instructions).toContain(NAMING_RULE_FORM);
  });

  it('keeps the same selected prompt and budget on a tool-followup conversation', async () => {
    await sendTurn('Timing strongly shapes how the price lands, so add that link.',
      [proposeLink, say('The proposed link is ready for approval.')]);
    expect(sent).toHaveLength(2);
    for (const body of sent) {
      selected(body);
      expect(sha256(body.instructions)).toBe(RENDERED_SHA);
    }
  });

  it('uses selected coach bytes as the prefix of the typed Run interpretation', async () => {
    const response = await sendTurn('Run analysis.', [say('The Run is provisional.')],
      { id: 'agent-run-analysis', action_type: 'run_analysis' });
    expect(response._diagnostic_trace?.fast_path).toBe('run');
    expect(sent).toHaveLength(0);
    await explainRun(app, SCENARIO, { statusCode: 200, json: () => response });
    expect(scripted, 'the separate narration consumed the answer').toEqual([]);
    expect(sent).toHaveLength(1);
    const body = sent[0]!;
    // AI HARNESS 2a: the interpreting call keeps the selected model, prompt and cap, at the interpret role's measured
    // effort (low; `model-budgets.ts` evidence). The ordinary conversation above stays high.
    expect(body.model).toBe('gpt-6.1-sol');
    expect(body.reasoning?.effort).toBe('low');
    expect(body.max_output_tokens).toBe(3400);
    expect(body.tool_choice).toBe('none');
    expect(body.tools).toEqual([]);
    // A withheld Run inserts its view instruction before the interpret-only constraint.
    // The selected coach remains the exact first RENDERED_BYTES UTF-8 bytes in either case.
    const prefix = Buffer.from(body.instructions).subarray(0, RENDERED_BYTES);
    expect(sha256(prefix)).toBe(RENDERED_SHA);
    expect(body.instructions).toContain(interpretOnlyConstraint);
    expect(body.instructions).toContain(interpreterV02);
    // WORDING BATCH: the Run's narration call (agent.interpret) carries the rule too, inside the selected-coach prefix.
    expect(prefix.toString('utf8')).toContain(NAMING_RULE_FORM);
  });

  it('keeps Terra-low for every hop of a known-empty construction, then uses Sol-high on the next turn', async () => {
    readMode = 'empty';
    await sendTurn(BRIEF, [[{ type: 'function_call', name: 'build_model_from_brief', call_id: 'build-1',
      arguments: JSON.stringify({ brief: BRIEF }) }]], undefined, FIRST_SCENARIO);
    expect(registered, 'the first turn registered the model after its initial empty read').toBe(true);
    const first = conversationBodies();
    expect(first.length, 'the construction turn continued after registration').toBeGreaterThan(1);
    expect(sent.some((body, i) => registeredAtCall[i] && body.text?.format?.name !== 'whole_candidate'),
      'at least one conversation hop occurred after registration').toBe(true);
    for (const body of first) {
      expect(body.model).toBe('gpt-5.6-terra');
      expect(body.reasoning?.effort).toBe('low');
      expect(body.max_output_tokens).toBe(3400);
      expect(sha256(body.instructions)).toBe(RENDERED_SHA);
    }

    sent.length = 0;
    registeredAtCall.length = 0;
    await sendTurn('What should we examine next?', [say('The new model is provisional.')], undefined, FIRST_SCENARIO);
    expect(conversationBodies().length).toBeGreaterThan(0);
    for (const body of conversationBodies()) selected(body);
  });

  it('a failed initial read does not pretend the model is empty', async () => {
    readMode = 'failed';
    await sendTurn('What can you tell me about this model?', [say('I cannot verify the model state.')], undefined, FAILED_SCENARIO);
    expect(conversationBodies()).toHaveLength(1);
    selected(conversationBodies()[0]!);
    expect(conversationBodies()[0]!.tools?.map((tool) => tool.name)).toContain('get_canonical_state');
  });
});
