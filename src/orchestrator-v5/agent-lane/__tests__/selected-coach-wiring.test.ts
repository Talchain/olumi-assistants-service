import { runPressToolResponse } from './fixtures/run-press-model.js';
import { explainRun } from './fixtures/run-explanation-follow-up.js';
/** Selected coaching reaches the real Agent route on every conversation path. No provider is called. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { HOST_TOOL_CONTRACT, SELECTED_COACH_V02_TEMPLATE } from '../coach-route-v0_2.js';
import { STATED_FIGURE_INSTRUCTION } from '../../../routes/agent-v1-turn.js';
import { NARRATE_LABEL_LINE } from '../runtime/agent-loop.js';
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
// AI HARNESS W3 (6 Oct evening, Paul's headline ruling): the per-option headline is the chance of meeting the goal, never
// the share of runs; chat quotes the screen's goal-chance display: 09f7b6ac… → f6cec112….
// S-E GOALS S2b (7 Oct): #34 and #35 gain the share-by-date sentences (goal_chance_words; a stated_time range says slow to
// fast end, never causal doubt): 22,393 → 23,075 bytes (+682, exactly the two added sentences). 0732df33… → a9c847ef….
// G (12 Oct, AIE #94 6133027121): the range rule in #34 and #35 says goal_chance_words when given (else “chance of meeting
// your goal”), and #35's headline is “its chance, in this model”, so a part-goal Run is never called the whole goal's chance:
// 23,075 → 23,185 bytes (+110). Reversing exactly those three edits on the module's string reproduces a9c847ef… and 23,075.
// PROMPT 28 (13 Oct, AIE one-pass packet 94ad9c8f…): #9, #14, #19, #34 (the AIE's whole replaced entry), #35, #36 and #41
// carry the packet's words, beside their kept non-deferring sentences (old #34's measured `provisional: true` rule is its own
// entry after the AIE's whole #34); 21,010 bytes. Derived with the route's SENT body (below), never by hand.
// #2994 AMEND (14 Oct, AIE rulings 1ad7f7b2… Q2): #35 is the AIE's whole replaced entry; staging's three protection
// sentences it did not see (its pin 0c90d3cc) follow as their own entry, pending the AIE: 21,010 → 21,188 bytes. Replacing
// that HOST with the previous one on the SENT prefix reproduces 1a6ad616… (below).
// BYPASS1 (14 Oct): the AIE's Q4 next-step rule appended last (#94 6158232014, verbatim): 21,188 → 22,225 bytes. Every
// captured body differs from staging's only by this HOST and, on the Agent call that offers tools, the stated-figure rule
// after the shared instructions (10 leaves; 0 unexplained).
const HOST_SHA = '94d4e35f5fa29a4ba645ba7c03d18438d1540a612d815d3ed9f204e81270be08';
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
//   highest" is false on a minimise Run and inexact under split tie credit), and with no share makes no claim about how
//   runs fell (Codex r2): 28,835 → 29,212 bytes (+377). Same rebuild, which reproduced 2bc25cba… exactly first.
// + GOAL_CHANCE_RANKING_INSTRUCTION appended after the naming rule (D3 step 2, DL 0df0e1 ruling C, 6 Oct): 29,212 → 29,958
//   bytes (+1 space +745 = exactly the rule's bytes); Codex r2 widened it to every probability_of_goal and to the result being
//   reported: 29,212 → 30,154 (+1 +941, exactly the rule). Template and host shas unchanged. Derived from the SENT body.
// + W3 headline + goal-chance display (6 Oct evening): 30,246 → 31,346 bytes. Derived from the SENT body.
// + S-A REPLY_SHAPE_INSTRUCTION joined after the reply-length sentence (lane COPY-SHAPE, 7 Oct; Paul: "the three bullets
//   as a construct"; AIE #87 6037293086 §5: under 75 words, one move, one ask): 33,758 → 34,302 bytes (+1 space +543 =
//   exactly the sentence's bytes). Derived from the SENT body.
// + S-E GOALS S2b share-by-date sentences in the host contract (7 Oct): +682 bytes, the host delta. Derived from the SENT body.
// #2783 (B15): + 193 bytes = exactly " " + MODEL_RELATIVE_NAMING_INSTRUCTION's new last sentence ("When the result gives
// options' chances of meeting the goal, lead with those chances …; never open with the share."), nothing else.
// Combined (#2762 merge of staging): 34,302 + 682 + 193 = 35,177 bytes; sha re-derived from the SENT body.
// + S-E GOALS S4 propose_new_limit clause in the proposing-tool instruction: staging 35,177 + 241 = 35,418 bytes.
//   Removing exactly that clause from the SENT body reproduces staging's 915133ba… sha and 35,177 bytes.
// + G (12 Oct, AIE #94 6133027121): the AIE's selected-Run scope line, verbatim and ONCE, appended to
//   GOAL_CHANCE_RANKING_INSTRUCTION (where the Agent receives analysis.goal_chance_licence); that rule's three whole-goal
//   phrases (“their chance of meeting the goal”, “highest chance of meeting the goal”, “similar chances of meeting the
//   goal”) become goal chances / chance / similar chances; plus the +110-byte host edits above: 35,418 → 35,782 bytes (+364).
//   Derived from the SENT body; reversing exactly those edits on the SENT body reproduces a8a9845b… and 35,418 bytes.
// + PROMPT 28 (13 Oct, AIE one-pass packet 94ad9c8f…): the host contract above, MUTATION_INSTRUCTION's propose_new_limit
//   clause (P9), REPLY_LENGTH_INSTRUCTION (P10/P11), REPLY_SHAPE_INSTRUCTION (P12), and MODEL_RELATIVE_NAMING_INSTRUCTION
//   leaving the join (its P13 words sit once inside #34): 35,782 → 32,007 bytes. Derived from the SENT body; replacing
//   exactly those five pieces with staging's on the SENT body reproduces 96cd8417… and 35,782 bytes.
// + #2994 AMEND (AIE Q2): the host contract above only: 32,007 → 32,185 bytes. The previous head's SENT prefix reproduces
//   1a6ad616…; swapping in this HOST gives exactly this, and the captured bodies differ only by the five AIE constants.
// + BYPASS1: the host contract above only: 32,185 → 33,222 bytes; staging's SENT prefix with this HOST swapped in.
const RENDERED_SHA = '2896fa86c033bf4ba49b8fafb95e5e91f7e862a855a8998e1c9f6bbf1add6c73';
const RENDERED_BYTES = 33_222;
/**
 * BYPASS1 (AIE #94 6158232014): a call that offers the Agent's proposing tools carries the selected coach, then the
 * stated-figure rule; a tool-less call carries the coach alone. The coach bytes stay exactly RENDERED either way.
 */
const expectCoachInstructions = (body: { instructions: string; tools?: unknown[] }): void => {
  const bytes = Buffer.from(body.instructions);
  expect(sha256(bytes.subarray(0, RENDERED_BYTES))).toBe(RENDERED_SHA);
  const tail = bytes.subarray(RENDERED_BYTES).toString('utf8');
  expect(tail).toBe((body.tools ?? []).length > 0 ? `\n\n${STATED_FIGURE_INSTRUCTION}` : '');
};
/** ⛔ CHANGED EXPECTATION (prompt P13): the result-reply rule that replaced "N% of runs supported X", matched as SENT bytes. */
const NAMING_RULE_FORM = 'Do not state a share of model runs or name a leader from that share in a result reply, even when a comparative leader-naming permission is present.';
/** G (AIE #94 6133027121): the approved selected-Run scope line, verbatim; SENT once on every coaching path. */
const AIE_SCOPE_LINE = 'Describe the selected Run using its licensed target wording and scope. If it scores only part of the user\'s goal, '
  + 'name that target and retain the unscored conditions; never call its chance the chance of meeting the whole goal. Keep its provisional '
  + 'or timing-assumption qualification in your own explanation.';
/**
 * PROMPT 28 (AIE one-pass packet SHA 94ad9c8f…): the approved texts the converse role's SYSTEM instructions carry, copied
 * from the packet's own rows (never read from the source modules), plus the AIE's withheld-better rule. Each is SENT once.
 */
const PACKET_SYSTEM_TEXTS: Readonly<Record<string, string>> = {
  'P1/P8': 'Use the tool result to explain what changed and the value and unit saved. Distinguish a prepared proposal from a committed change. If the result or current read does not confirm the save, say that its outcome is uncertain; never claim it was saved.',
  'P2/P21': 'If analysis did not run, explain its actual recorded reason and a useful next action from the supplied facts. Keep reasoning useful before a Run; do not invent a missing value or promise that one answer will make analysis possible.',
  'P3': 'Explain what the tool committed and use readiness_after to describe what can happen next. Do not report readiness or a result from an earlier model revision as current.',
  'P4/P15/P20/P26': 'Include your provisional interpretation in the reply, labelled as your view of the current model rather than a computed result or a human fact. Preserve the supplied uncertainty, source and unresolved conditions.',
  'P5/P6': 'Explain the selected Run’s currently licensed figures in your own words, retaining the exact licensed number or range, named option and target, unit, reference and period, in-this-model meaning, and supplied provisional or timing qualifications. A narrower target is not the chance of meeting the whole goal. Do not derive, invent, re-round or substitute a goal chance, or replace a missing chance with a share of model runs.',
  'P7/P22/P23': 'Explain the supplied current withholding or certainty reason in ordinary language, keeping its actual scope and limitation. Preserve relevant conditions and give a supported next action when available; do not output raw reason codes, invent an action, or drop a known limitation merely to shorten the answer.',
  'P9/P27/P28': 'Explain the returned proposal or revised draft in your own words. Keep its actual quantities, units, timing, source and scope, including what it would replace or leave out. The existing card contains the complete change for approval; your explanation must not change the proposal, imply approval, or claim that it has already been saved.',
  'P10/P11': 'Answer the user directly and visibly with the relevant reasoning, uncertainty and next action. The host does not supply a separate explanatory answer. Ask for a necessary missing target or input yourself only when it has not already been supplied; do not re-ask a known figure. Keep concise ordinary replies, with enough detail for the actual question and proposed change.',
  'P12': 'Keep the existing reply structure where required by this role’s schema, but put the useful answer and necessary explanation in the visible answer. Do not rely on a host-authored headline, hidden More detail section or later appendix to communicate it.',
  'P13': 'Run result replies: lead with the selected Run\'s licensed goal-chance or withholding lines. Retain their target scope, unscored conditions and provisional, timing and source qualifications. Do not state a share of model runs or name a leader from that share in a result reply, even when a comparative leader-naming permission is present. Never substitute a relative ranking for an unavailable goal chance. The separate goal-chance licence governs any comparison of goal chances. In dedicated comparative reasoning only, you may report a permitted share recorded for the selected Run, using the approved credit label and qualifier; never turn it into a recommendation or the chance of the whole goal. Explain the supported implication or useful next action, and what the result rests on, using measured sensitivity and the figure\'s source when available. Never write recommend or recommendation, including negated forms. Never call a result, option or link fragile.',
  'withheld-better': 'When leader permission is withheld, do not describe an option as the better, preferred or superior option, or the one to choose. You may explain a specifically scoped difference supported by current supplied facts, preserving its uncertainty and unresolved conditions; that difference does not establish an overall option to favour.',
};
/** The host-deferral premises the packet retires: none may reach the model in its instructions or tool descriptions. */
const RETIRED_DEFERRALS = ['beneath your reply', 'Olumi adds its own status', 'Olumi asks for it after your words', 'show its card exactly',
  'Olumi shows it under More detail', 'use its exact say', 'Never write that view', 'Never write the view in', 'N% of runs supported',
  'use goal_chance_words verbatim', 'beyond the screen\'s own driver lines'] as const;
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

type Sent = { model: string; instructions: string; reasoning?: { effort?: string }; max_output_tokens: number; input?: unknown;
  tools?: { name?: string }[]; tool_choice?: unknown; text?: { format?: { name?: string } } };
const sent: Sent[] = [];
const registeredAtCall: boolean[] = [];
let scripted: Record<string, unknown>[][] = [];
let readMode: 'populated' | 'empty' | 'failed' = 'populated';
let registered = false;
let ran = false;
let graphOverride: unknown;
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
      const runCall = runPressToolResponse(body as unknown as Record<string, unknown>);
      if (runCall) return runCall;
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
      return { graph: graphOverride ?? (readMode === 'empty' ? READY_GRAPH : fx.state.draft_graph),
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
    readMode = 'populated'; registered = false; ran = false; graphOverride = undefined; });

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

  it('R2: the SENT model view says today at 4% does not meet under 4%, with unchanged coach pins', async () => {
    const graph = JSON.parse(JSON.stringify(fx.state.draft_graph)) as { nodes: Array<Record<string, unknown>>; goal_constraints?: unknown[] };
    graph.nodes = graph.nodes.map((node) => node.id === 'monthly_churn_rate' ? { ...node, scale_frame: 100,
      observed_state: { value: 0.04, raw_value: 4, unit: '%', source: 'user_override' } } : node);
    graph.goal_constraints = [{ constraint_id: 'agent-lane:monthly_churn_rate:<=', node_id: 'monthly_churn_rate',
      operator: '<=', operator_as_stated: '<', value: 4, unit: '%', value_frame: 'level', provenance: 'explicit' }];
    graphOverride = graph;
    await sendTurn('Our current churn is 4%. Does that meet keeping monthly churn UNDER 4%?', [say('In this model, today’s 4% does not meet your under 4% limit.')]);
    const body = conversationBodies()[0]!;
    const textBlocks: string[] = [];
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value !== null && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
          if (key === 'text' && typeof item === 'string') textBlocks.push(item);
          else collect(item);
        }
      }
    };
    collect(body.input);
    const modelInput = textBlocks.join('\n');
    expect(modelInput).toMatch(/"today_within_limit"\s*:\s*"at_threshold"/);
    expect(modelInput).toContain('do no arithmetic');
    // SHA and byte count are derived from the intercepted request, not estimated from source literals.
    expectCoachInstructions(body);
  });

  it('uses the exact selected template and host authority on an ordinary conversation', async () => {
    expect(sha256(SELECTED_COACH_V02_TEMPLATE)).toBe(TEMPLATE_SHA);
    expect(sha256(HOST_TOOL_CONTRACT)).toBe(HOST_SHA);
    expect(SELECTED_COACH_V02_TEMPLATE.split('{{MODE_AND_AUTHORITY}}')).toHaveLength(2);
    await sendTurn('What does the analysis say?', [say('The comparison is provisional.')]);
    expect(sent).toHaveLength(1);
    selected(sent[0]!);
    expectCoachInstructions(sent[0]!);
    expect(sent[0]!.instructions).toContain('To change the model you must first call a proposing tool');
    expect(sent[0]!.instructions).toContain('authorise_change');
    // The exported host contract is the one-space join of all 31 approved old entries.
    expect(sent[0]!.instructions).toContain(HOST_TOOL_CONTRACT);
    // WORDING BATCH: the served conversation prompt carries the model-relative naming rule (agent.converse).
    expect(sent[0]!.instructions).toContain(NAMING_RULE_FORM);
    // G: the coaching conversation carries the AIE's scope line exactly once, and no whole-goal headline or superlative.
    expect(sent[0]!.instructions.split(AIE_SCOPE_LINE)).toHaveLength(2);
    expect(sent[0]!.instructions).not.toMatch(/headline is its chance of meeting|highest chance of meeting|similar chances of meeting/);
  });

  it('PROMPT 28: the SENT converse call carries each approved packet text once and no retired deferral', async () => {
    // The UI's own typed-message shape (DGAI `buildV5Payload`, e218e3d2: kind, turn_id, scenario_id, stage, turn_class, message,
    // source), never a self-authored wire body. `sendTurn` always passes `turn_class: 'frame'` (useConversation.ts:4746);
    // `stage: 'analyse'` is `deriveV5Stage` after a completed Run; a typed message normalises to `source: 'composer'`.
    scripted = [say('The comparison is provisional.')];
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', turn_id: '5d4c3b2a-1f0e-4d9c-8b7a-0000000000f8', scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame',
      message: 'What does the analysis say?', source: 'composer',
    } });
    expect(response.statusCode, response.body.slice(0, 300)).toBe(200);
    expect(sent).toHaveLength(1);
    const body = sent[0]!;
    for (const [site, text] of Object.entries(PACKET_SYSTEM_TEXTS)) expect(body.instructions.split(text).length - 1, site).toBe(1);
    for (const retired of RETIRED_DEFERRALS) expect(body.instructions, retired).not.toContain(retired);
    const tools = (body.tools ?? []) as { name?: string; description?: string }[];
    expect(tools.find((t) => t.name === 'give_provisional_view')?.description).toContain(PACKET_SYSTEM_TEXTS['P4/P15/P20/P26']);
    for (const tool of tools) for (const retired of RETIRED_DEFERRALS) expect(tool.description ?? '', `${tool.name}: ${retired}`).not.toContain(retired);
  });

  it('keeps the same selected prompt on a tool-followup conversation; the narrating hop is low effort (P44 S1)', async () => {
    await sendTurn('Timing strongly shapes how the price lands, so add that link.',
      [proposeLink, say('The proposed link is ready for approval.')]);
    expect(sent).toHaveLength(2);
    for (const body of sent) {
      expect(body.model).toBe('gpt-6.1-sol');
      expect(body.max_output_tokens).toBe(3400);
      expectCoachInstructions(body);
    }
    // The deciding call stays high; the call after a held proposal only states it and asks for the yes.
    expect(sent[0]!.reasoning?.effort).toBe('high');
    expect(JSON.stringify(sent[0]!.input)).not.toContain(NARRATE_LABEL_LINE);
    expect(sent[1]!.reasoning?.effort).toBe('low');
    const narrateInput = sent[1]!.input as { content?: { text?: string }[] }[];
    expect(narrateInput.at(-1)?.content?.[0]?.text).toBe(NARRATE_LABEL_LINE);
  });

  it('uses selected coach bytes as the prefix of the typed Run interpretation', async () => {
    const response = await sendTurn('Run analysis.', [say('The Run is provisional.')],
      { id: 'agent-run-analysis', action_type: 'run_analysis' });
    expect(response._diagnostic_trace?.fast_path).toBe('run');
    expect(sent).toHaveLength(1);
    for (const body of sent) {
      expect(body.model).toBe('gpt-6.1-sol');
      expectCoachInstructions(body);
    }
    sent.length = 0;
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
    // G: the Run's narration carries the AIE's scope line once, inside the selected-coach prefix, and nowhere else.
    expect(prefix.toString('utf8').split(AIE_SCOPE_LINE)).toHaveLength(2);
    expect(body.instructions.split(AIE_SCOPE_LINE)).toHaveLength(2);
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
      expectCoachInstructions(body);
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
