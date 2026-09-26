/**
 * ⛔ THREE DEFECTS FROM PAUL'S MANUAL TEST ON SERVED CEE `d5d5839` (#69 5832088673; Runtime's plan 5832133236).
 *
 *   1. TRUTH — "These are starting assumptions, not measurements. Shall I record them?" was followed by
 *      Olumi's "The model was saved as version 1.": the build really was saved, but the line read as if
 *      the proposed figures had been recorded before he agreed.
 *   2. ACTION ≠ QUESTION — the reply asked "Shall I save the £50,000 assumption?" and the chip beside it
 *      read "Use as starting option levels": a label fixed per tool.
 *   3. FIDELITY — the £50,000 included a recruitment consultant; the Agent recorded it as an annual salary.
 *
 * Unit rows run the REAL capabilities over a fake product (so every proposal is a real stored one); the
 * route rows drive the REAL `/agent/v1/turn` with the conversation model and the build's structured call
 * both stubbed at `fetch` — no provider is ever reached.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { narrateWriteOutcome } from '../write-outcome.js';
import { APPROVAL_LABEL_MAX, approvalChipIdFor, approvalChipsFor } from '../approval-chips.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import type { ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';

const e = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' as const });

/** Paul's decision, in the shape a built model takes: two options that set nothing yet, one salary factor. */
const PA_GRAPH = {
  nodes: [
    { id: 'dec_pa', kind: 'decision', label: 'How to free up leadership time' },
    { id: 'goal_time', kind: 'goal', label: 'Leadership time freed', goal_threshold: 0.8 },
    { id: 'fac_salary', kind: 'factor', label: 'Annual PA salary', category: 'controllable', observed_state: { value: 0.5, raw_value: 40000, cap: 80000, unit: 'GBP' } },
    { id: 'fac_fee', kind: 'factor', label: 'Recruitment fee', category: 'observable', scale_frame: 20000 },
    { id: 'opt_pa', kind: 'option', label: 'Hire PA' },
    { id: 'opt_agency', kind: 'option', label: 'Use an agency' },
  ],
  edges: [e('dec_pa', 'opt_pa'), e('dec_pa', 'opt_agency'), e('opt_pa', 'fac_salary'), e('opt_agency', 'fac_salary'), e('fac_salary', 'goal_time'), e('fac_fee', 'goal_time')],
  goal_node_id: 'goal_time',
};

const SCENARIO = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
/** What the user wrote in these rows: a figure is recorded as theirs only when it is here (`stated-by-user.ts`). */
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r', user_text: 'The recruitment fee is £5,000 and the PA salary £45,000; hiring a PA would pay £50,000.' };

function capsOver(graph: { nodes: unknown[]; edges: unknown[] } = PA_GRAPH) {
  const d: InternalDispatch = async () => ({ status: 200, json: { graph, graph_hash: 'h0' } });
  const store = new ProposalStore();
  return { store, caps: createAgentCapabilities(d, store) };
}

/** A turn's calls and results as the loop records them, then the chips the route would offer. */
function chipsFor(store: ProposalStore, turn: { name: string; result: ToolResult }[]) {
  const calls = turn.map(({ name, result }) => ({ name, ok: result.ok, mutated: result.mutated, ...(typeof result.proposal_id === 'string' ? { proposal_id: result.proposal_id } : {}) }));
  const results = turn.map((t) => t.result);
  return approvalChipsFor(calls, (id) => ({ proposal: store.get(id), result: results.find((r) => r.proposal_id === id) }));
}

const BUILT: ToolResult = { ok: true, mutated: true, model_version: { version_number: 1 } };
const OLD_LINE = 'The model was saved as version 1.';
const NEW_LINE = 'I saved the model I drafted as version 1. The figures above are not recorded until you approve them.';

/* ── 1. TRUTH: the build's save line ── */
describe('the build line says what was saved and what was not', () => {
  it('RED: build + a starting point awaiting approval in the SAME turn → the saved model, and the figures NOT recorded', () => {
    const n = narrateWriteOutcome('These are starting assumptions, not measurements. Shall I record them?',
      [{ name: 'build_model_from_brief' }, { name: 'propose_starting_point' }],
      [BUILT, { ok: true, mutated: false, proposal_id: 'prop_aaaaaa' }]);
    expect(n.status).toBe(NEW_LINE);
    expect(n.status).not.toContain(OLD_LINE);
  });

  it('RED: with NO returned version, the line claims no version and still says the figures are not recorded', () => {
    // Independent review 5832147341: "as version N" only on an actual returned version — never invented.
    const n = narrateWriteOutcome('These are starting assumptions, not measurements. Shall I record them?',
      [{ name: 'build_model_from_brief' }, { name: 'propose_starting_point' }],
      [{ ok: true, mutated: true }, { ok: true, mutated: false, proposal_id: 'prop_bbbbbb' }]);
    expect(n.status).toBe('I saved the model I drafted. The figures above are not recorded until you approve them.');
    expect(n.status).not.toMatch(/version/);
  });

  it('RED: the tails (left out, open questions, context factors) stay intact after the new line', () => {
    const built = { ...BUILT, left_out_to_stay_compact: [{ label: 'Office space' }], open_questions: ['Who covers holidays'], treated_as_context: ['Recruitment fee'] };
    const n = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }, { name: 'propose_option_interventions' }], [built, { ok: true, mutated: false, proposal_id: 'prop_bbbbbb' }]);
    expect(n.status).toBe(`${NEW_LINE} To keep it readable, I left out: Office space. Ask me to add any of them back.`
      + ' Questions this model does not answer yet: Who covers holidays?'
      + ' No option changes Recruitment fee, so I held it as fixed context rather than a lever — tell me if one of the options should change it.');
  });

  it('RED: an authorisation withheld beside it (refused, no id) consumed nothing — the figures are still unrecorded', () => {
    const n = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }, { name: 'propose_assumptions' }, { name: 'authorise_change' }],
      [BUILT, { ok: true, mutated: false, proposal_id: 'prop_cccccc' }, { ok: false, mutated: false, refusal: 'withheld_on_chip_turn' }]);
    // The withheld call keeps its own (pre-existing) refusal line after the build's.
    expect(n.status!.startsWith(`${NEW_LINE} `), String(n.status)).toBe(true);
  });

  it('RED: a link proposed after the build is named as a change, not as figures', () => {
    const n = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }, { name: 'propose_model_change' }], [BUILT, { ok: true, mutated: false, proposal_id: 'prop_dddddd' }]);
    expect(n.status).toBe('I saved the model I drafted as version 1. What I proposed above is not made until you approve it.');
  });

  it('CONTRAST: a build with NO pending proposal keeps today’s line', () => {
    expect(narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [BUILT]).status).toBe(OLD_LINE);
  });

  it('CONTRAST: a refused proposal, a proposal made BEFORE the build (stale), and one approved in the same turn → today’s line', () => {
    expect(narrateWriteOutcome('', [{ name: 'build_model_from_brief' }, { name: 'propose_starting_point' }],
      [BUILT, { ok: false, mutated: false, refusal: 'incomplete_starting_point' }]).status).toBe(OLD_LINE);
    expect(narrateWriteOutcome('', [{ name: 'propose_starting_point' }, { name: 'build_model_from_brief' }],
      [{ ok: true, mutated: false, proposal_id: 'prop_eeeeee' }, BUILT]).status).toBe(OLD_LINE);
    const consumed = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }, { name: 'propose_assumptions' }, { name: 'authorise_change' }],
      [BUILT, { ok: true, mutated: false, proposal_id: 'prop_ffffff' }, { ok: true, mutated: true, applied: true, proposal_id: 'prop_ffffff', receipts: [{ version: 2 }] }]).status;
    expect(consumed).toBe(`${OLD_LINE} Saved as version 2.`);
  });
});

/* ── 2. ACTION ≠ QUESTION: the chip names what it saves, from the STORED proposal ── */
describe('the approve chip is labelled from the stored proposal it approves', () => {
  it('RED: one option level → "Save £50,000 for Hire PA"; id and message exactly as before', async () => {
    const { store, caps } = capsOver();
    const r = await caps.proposeOptionInterventions(ctx, { interventions: [{ option_label: 'Hire PA', factor_label: 'Annual PA salary', value: 50000, basis: 'the figure the user gave' }] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const chips = chipsFor(store, [{ name: 'propose_option_interventions', result: r }]);
    expect(chips.map((c) => [c.id, c.label, c.message])).toEqual([
      [approvalChipIdFor(String(r.proposal_id)), 'Save £50,000 for Hire PA', 'Yes, use those.'],
      ['agent-amend-proposal', 'Change something first', 'Before you apply it, I want to change some of it.'],
    ]);
  });

  it('RED: one starting value → "Set Recruitment fee to £5,000"', async () => {
    const { store, caps } = capsOver();
    const r = await caps.proposeAssumptions(ctx, { assumptions: [{ factor_label: 'Recruitment fee', value: 5000, unit: 'GBP', basis: 'a consultant’s one-off fee' }] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(chipsFor(store, [{ name: 'propose_assumptions', result: r }])[0]!.label).toBe('Set Recruitment fee to £5,000');
  });

  it('RED: several figures in one starting point → "Use these 3 starting figures"', async () => {
    const { store, caps } = capsOver();
    const r = await caps.proposeStartingPoint(ctx, {
      assumptions: [{ factor_label: 'Recruitment fee', value: 5000, unit: 'GBP', basis: 'one-off' }],
      option_levels: [
        { option_label: 'Hire PA', factor_label: 'Annual PA salary', value: 45000, basis: 'market rate' },
        { option_label: 'Use an agency', factor_label: 'Annual PA salary', value: 0, basis: 'no salary; agency fees instead' },
      ],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(store.get(String(r.proposal_id))!.operations, 'control: one stored proposal of three figures').toHaveLength(3);
    const [approve] = chipsFor(store, [{ name: 'propose_starting_point', result: r }]);
    expect([approve!.id, approve!.label, approve!.message]).toEqual([approvalChipIdFor(String(r.proposal_id)), 'Use these 3 starting figures', 'Yes, use those.']);
  });

  it('RED: a per-period money unit reads as money per period', async () => {
    const graph = { ...PA_GRAPH, nodes: PA_GRAPH.nodes.map((n) => (n.id === 'fac_salary' ? { ...n, observed_state: { ...n.observed_state!, unit: 'GBP/year' } } : n)) };
    const { store, caps } = capsOver(graph);
    const r = await caps.proposeOptionInterventions(ctx, { interventions: [{ option_label: 'Hire PA', factor_label: 'Annual PA salary', value: 50000, basis: 'x' }] });
    expect(chipsFor(store, [{ name: 'propose_option_interventions', result: r }])[0]!.label).toBe('Save £50,000/year for Hire PA');
  });

  it('RED: a long option label is shortened with an ellipsis — the figure never is — and the label stays within the cap', async () => {
    const long = 'Hire a full-time executive PA based in the London office';
    const graph = { ...PA_GRAPH, nodes: PA_GRAPH.nodes.map((n) => (n.id === 'opt_pa' ? { ...n, label: long } : n)) };
    const { store, caps } = capsOver(graph);
    const r = await caps.proposeOptionInterventions(ctx, { interventions: [{ option_label: long, factor_label: 'Annual PA salary', value: 50000, basis: 'x' }] });
    const label = chipsFor(store, [{ name: 'propose_option_interventions', result: r }])[0]!.label;
    expect(label).toMatch(/^Save £50,000 for Hire a full-time.*…$/);
    expect(label.length).toBeLessThanOrEqual(APPROVAL_LABEL_MAX);
    expect(APPROVAL_LABEL_MAX).toBe(40);
  });

  it('FALLBACK: a figure that cannot be shown exactly as stored, a link, and a revision of several values keep today’s label', async () => {
    const { store, caps } = capsOver();
    const pence = await caps.proposeOptionInterventions(ctx, { interventions: [{ option_label: 'Hire PA', factor_label: 'Annual PA salary', value: 1234.56, basis: 'x' }] });
    expect(pence.ok, JSON.stringify(pence)).toBe(true);
    expect(chipsFor(store, [{ name: 'propose_option_interventions', result: pence }])[0]!.label).toBe('Use as starting option levels');
    const s2 = capsOver();
    // A link is proposed only with the band the user typed THIS turn (#70 5845493088).
    const linkSaid = 'The recruitment fee moderately raises the PA salary.';
    const link = await s2.caps.proposeModelChange({ ...ctx, user_turn_text: linkSaid }, { from_label: 'Recruitment fee', to_label: 'Annual PA salary', direction: 'positive', strength: 'moderate', rationale: 'x' });
    expect(link.ok, JSON.stringify(link)).toBe(true);
    expect(chipsFor(s2.store, [{ name: 'propose_model_change', result: link }])[0]!.label).toBe('Make this change');
    const valued = { ...PA_GRAPH, nodes: PA_GRAPH.nodes.map((n) => (n.id === 'fac_fee' ? { ...n, observed_state: { value: 0.2, raw_value: 4000, cap: 20000, unit: 'GBP' } } : n)) };
    const s3 = capsOver(valued);
    const revise = await s3.caps.proposeAssumptions(ctx, { assumptions: [
      { factor_label: 'Recruitment fee', value: 5000, unit: 'GBP', basis: 'the user’s figure', revise: true },
      { factor_label: 'Annual PA salary', value: 45000, unit: 'GBP', basis: 'the user’s figure', revise: true },
    ] });
    expect(revise.ok, JSON.stringify(revise)).toBe(true);
    expect(chipsFor(s3.store, [{ name: 'propose_assumptions', result: revise }])[0]!.label).toBe('Use as starting assumptions');
  });

  it('FALLBACK: a result that does not agree with the stored proposal figure for figure keeps today’s label', async () => {
    const { store, caps } = capsOver();
    const r = await caps.proposeOptionInterventions(ctx, { interventions: [{ option_label: 'Hire PA', factor_label: 'Annual PA salary', value: 50000, basis: 'x' }] });
    const tampered = { ...r, interventions: (r.interventions as Record<string, unknown>[]).map((i) => ({ ...i, value: 60000 })) };
    expect(chipsFor(store, [{ name: 'propose_option_interventions', result: tampered }])[0]!.label).toBe('Use as starting option levels');
    // And with no stored proposal at all (a process that no longer holds it), today's label.
    expect(approvalChipsFor([{ name: 'propose_option_interventions', ok: true, mutated: false, proposal_id: String(r.proposal_id) }])[0]!.label).toBe('Use as starting option levels');
  });
});

/* ── the ROUTE: build + proposal in one turn, the chip's words, and the prompt actually sent ── */
const { runCalls } = vi.hoisted(() => ({ runCalls: { n: 0 } }));
vi.mock('../../handlers/chip-click-dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, dispatchChipClickRunAnalysis: async () => { runCalls.n += 1; throw new Error('no analysis runs in this spec'); } };
});
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, loadPriorFactsWithReadState: async () => ({ status: 'ok', facts: [] }) };
});
const sessionStore = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => sessionStore }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const BRIEF = 'Should I hire a PA or use an agency to free up my time? A PA would cost about £50,000, which includes a recruitment consultant.';
const CANDIDATE = {
  goal: { metric: 'Leadership time freed', operator: '>=', value: 10, unit: 'hours per week', horizon_months: 6, provenance: 'explicit' },
  constraints: [],
  options: [{ label: 'Hire PA', provenance: 'explicit', interventions: [] }, { label: 'Use an agency', provenance: 'explicit', interventions: [] }],
  factors: [{ label: 'Annual PA salary', role: 'controllable', baseline_known: true, baseline_value: 40000, unit: 'GBP', provenance: 'explicit' }],
  risks: [], outcomes: [{ label: 'Leadership time freed', provenance: 'inferred' }],
  links: [{ from: 'Annual PA salary', to: 'Leadership time freed', direction: 'positive', provenance: 'inferred' }],
  unknowns: [],
};

let script: Record<string, unknown>[] = [];
let modelBodies: Record<string, unknown>[] = [];
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const callTool = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${modelBodies.length}`, arguments: JSON.stringify(args) }] });
const product = new Map<string, { registered: boolean; revision: number }>();
const scen = (sid: string) => { let s = product.get(sid); if (s === undefined) { s = { registered: false, revision: 0 }; product.set(sid, s); } return s; };

type Chip = { id: string; label: string; message: string };
type Body = { assistant_text: string; suggested_actions: Chip[]; _agent: { tool_calls: { name: string; ok: boolean; proposal_id?: string }[] } };

describe('the real route: build + proposal in one turn', () => {
  let app: FastifyInstance;
  let n = 0;
  let SID = '';
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> & { text?: { format?: { type?: string } } };
      // The build's own structured call — stubbed, like every model call here.
      if (body.text?.format?.type === 'json_schema') return new Response(JSON.stringify(say(JSON.stringify(CANDIDATE))), { status: 200 });
      modelBodies.push(body);
      const next = body['tool_choice'] === 'none' ? undefined : script.shift();
      return new Response(JSON.stringify(next ?? say('Here is where the model stands.')), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const s = scen((req.params as { id: string }).id);
      return s.registered ? { graph: PA_GRAPH, graph_hash: `rev-${s.revision}` } : { graph: { nodes: [], edges: [] }, graph_hash: 'empty' };
    });
    app.post('/assist/v1/scenarios/:id/graph/register', async (req) => {
      const s = scen((req.params as { id: string }).id);
      s.registered = true;
      s.revision += 1;
      return { registered: true, graph_hash: `rev-${s.revision}`, model_version: { version_id: `00000000-0000-4000-8000-00000000000${s.revision}`, version_number: s.revision } };
    });
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [], next_cursor: null }));
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ok', blocks: [], suggested_actions: [], insights: [] }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    n += 1;
    SID = `7b1e2d3c-4a5f-4e6d-8c7b-6a5f4e3d2c${String(n).padStart(2, '0')}`;
    script = [];
    modelBodies = [];
    runCalls.n = 0;
  });
  const turn = async (): Promise<Body> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, message: BRIEF } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as Body;
  };
  const proposalOf = (b: Body, tool: string) => b._agent.tool_calls.find((c) => c.name === tool && c.ok)?.proposal_id;

  it('RED: one level proposed after the build → the honest save line, and a chip naming the STORED £50,000 even though the prose says £60,000', async () => {
    script = [
      callTool('build_model_from_brief', { brief: BRIEF }),
      callTool('propose_option_interventions', { interventions: [{ option_label: 'Hire PA', factor_label: 'Annual PA salary', value: 50000, basis: 'the figure you gave', user_stated: true }] }),
      say('These are starting assumptions, not measurements. Shall I save the £60,000 assumption for Hire PA?'),
    ];
    const b = await turn();
    expect(b._agent.tool_calls.map((c) => [c.name, c.ok])).toEqual([['build_model_from_brief', true], ['propose_option_interventions', true]]);
    expect(runCalls.n, 'control: no analysis ran on this turn').toBe(0);
    // CONTROL: the model's prose really names a DIFFERENT figure from the one stored.
    expect(b.assistant_text).toContain('£60,000');
    const pid = proposalOf(b, 'propose_option_interventions');
    expect(pid).toMatch(/^prop_[0-9a-f]{32}$/);
    expect(b.suggested_actions[0]).toEqual({ id: approvalChipIdFor(pid!), label: 'Save £50,000 for Hire PA', message: 'Yes, use those.' });
    expect(b.assistant_text).toContain(NEW_LINE);
    expect(b.assistant_text).not.toContain(OLD_LINE);
  });

  it('RED: several figures after the build → "Use these 2 starting figures" and the honest save line', async () => {
    script = [
      callTool('build_model_from_brief', { brief: BRIEF }),
      callTool('propose_starting_point', { assumptions: [], option_levels: [
        { option_label: 'Hire PA', factor_label: 'Annual PA salary', value: 45000, basis: 'market rate' },
        { option_label: 'Use an agency', factor_label: 'Annual PA salary', value: 30000, basis: 'agency day rate over a year' },
      ] }),
      say('Here is a starting point. These are assumptions to adopt or correct.'),
    ];
    const b = await turn();
    const pid = proposalOf(b, 'propose_starting_point');
    expect(pid, JSON.stringify(b._agent.tool_calls)).toBeDefined();
    expect(b.suggested_actions[0]).toEqual({ id: approvalChipIdFor(pid!), label: 'Use these 2 starting figures', message: 'Yes, use those.' });
    expect(b.assistant_text).toContain(NEW_LINE);
  });

  it('FALLBACK: a figure the composer cannot show exactly keeps today’s label (id and message unchanged)', async () => {
    script = [
      callTool('build_model_from_brief', { brief: BRIEF }),
      callTool('propose_option_interventions', { interventions: [{ option_label: 'Hire PA', factor_label: 'Annual PA salary', value: 1234.56, basis: 'x' }] }),
      say('Shall I use that?'),
    ];
    const b = await turn();
    const pid = proposalOf(b, 'propose_option_interventions');
    expect(b.suggested_actions[0]).toEqual({ id: approvalChipIdFor(pid!), label: 'Use as starting option levels', message: 'Yes, use those.' });
  });

  it('CONTRAST: a build with nothing proposed keeps today’s line and offers no approve chip', async () => {
    script = [callTool('build_model_from_brief', { brief: BRIEF }), say('I have drafted the model.')];
    const b = await turn();
    expect(b.assistant_text).toContain(OLD_LINE);
    expect(b.assistant_text).not.toContain('not recorded until you approve');
    expect(b.suggested_actions.some((c) => c.id.startsWith('agent-approve-proposal:'))).toBe(false);
  });

  /* ── 3. FIDELITY: in the prompt the Agent is actually sent ── */
  it('RED: the instructions sent to the model carry the bundled-figure rule', async () => {
    script = [say('Hello.')];
    await turn();
    const instructions = String(modelBodies[0]?.['instructions'] ?? '');
    expect(instructions, 'control: the captured text is the Agent prompt').toContain('call propose_starting_point ONCE');
    expect(instructions).toContain(
      'When a figure the user gives bundles a one-off cost with a recurring one (a salary that includes a recruitment fee, say) or two different quantities, '
      + 'ask which part is which before you propose it, and never record the bundle as the recurring figure.',
    );
  });
});
