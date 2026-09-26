/**
 * ⛔ NOTHING OLUMI SAYS TO THE USER IS AN INSTRUCTION MEANT FOR THE AGENT, A RAW CODE, OR A FALSE "NOT SAVED".
 *
 * SERVED (WIRE-WITNESSED on CEE `af719a1`, scenario `bdba963b`, journey Q step f2 —
 * `witness-journey-q-bdba963b-252a-40fb-8770-afc5504734ed.json`): after one click on "Record this link" the user read
 *   Recorded as the user's own estimate: "Pro plan price" → "MRR" as strong (0.825 on Olumi's 0–1 scale), as your
 *   own estimate. Offer to run the analysis again so they can see what it changes.
 * — the link-strength branch of `authoriseChange` returned a `follow_up` written TO THE AGENT, and the typed-approval
 * fast path shows `follow_up` verbatim (no model reads the result on that path).
 *
 * CODE-READ gap in the same seam: `write-outcome.ts` fell back to "the change was refused (<code>)" for every code
 * missing from its words — `not_verified` arrives WITH `mutated: true`, so an option that DID land read
 * "Partly saved: the change was refused (not_verified)."
 *
 * Rows drive the REAL route and the REAL capabilities (the model is a scripted fetch; nothing but the stubbed graph
 * read and turn endpoints is faked), plus the REAL `narrateWriteOutcome` for every code the write tools return.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { narrateWriteOutcome, withWriteOutcome } from '../write-outcome.js';

/** The follow_up the user read at step f2, verbatim from the served witness (the assistant_text before Olumi's status). */
const SERVED_F2_FOLLOW_UP = 'Recorded as the user\'s own estimate: "Pro plan price" → "MRR" as strong (0.825 on Olumi\'s 0–1 scale), as your own estimate. Offer to run the analysis again so they can see what it changes.';
/** The follow_up the user read at step d3 of the SAME witness — addressed to the user, and must survive untouched. */
const SERVED_D3_FOLLOW_UP = 'Added "Grandfather existing customers at £49; charge £59 for new customers", linked from the decision and acting on Pro plan price. Added "Introduce £49 monthly and a discounted annual Pro plan", linked from the decision and acting on Pro plan price.';

/** What an instruction to the Agent looks like in the text a user reads. */
const AGENT_DIRECTED = /Offer to run|\bthe user\b|Tell the user|never the id|authorise_change|so they can see/i;
/** A code: a snake_case token (tool name, refusal, field). */
const SNAKE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/;

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e${String(n).padStart(2, '0')}`; };
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; pending_actions?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) rows.set(k, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0, pending_actions: JSON.parse(JSON.stringify(w.pending_actions ?? [])) });
    return { id: rows.get(k)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});
/**
 * The REAL capabilities, unless a row forces `authoriseChange`'s result (the served-text row): every other row runs
 * the production capability end to end.
 */
let forcedAuthorise: Record<string, unknown> | undefined;
vi.mock('../runtime/agent-capabilities.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown> & { createAgentCapabilities: (...a: unknown[]) => Record<string, unknown> & { authoriseChange: (...a: unknown[]) => Promise<unknown> } }>();
  return {
    ...actual,
    createAgentCapabilities: (...args: unknown[]) => {
      const caps = actual.createAgentCapabilities(...args);
      return { ...caps, authoriseChange: async (...a: unknown[]) => (forcedAuthorise !== undefined ? forcedAuthorise : caps.authoriseChange(...a)) };
    },
  };
});

type Chip = { id: string; label: string; message: string; action_type?: string };
type Body = { assistant_text: string; suggested_actions: Chip[]; _diagnostic_trace: { fast_path?: string }; _provider_calls: unknown[];
  _agent: { tool_calls: { name: string; ok: boolean; mutated: boolean; refusal?: string; proposal_id?: string }[] } };

describe('a link-strength approval through the REAL route: the user reads what was recorded, never the Agent\'s instructions', () => {
  let app: FastifyInstance;
  let mean = 0.5;
  let source = 'cee_hypothesis';
  let rev = 1;
  /** Another writer, AFTER the link write has answered and BEFORE the Agent reads the model back (round-2 blocker 2). */
  let afterWrite: (() => void) | undefined;
  /** The link writer's own honest refusal: 200, nothing written, the revision unmoved. */
  let refuseWrite = false;
  let linkWrites = 0;
  let script: ((body: Record<string, unknown>) => unknown)[] = [];
  let modelCalls = 0;
  const fnCall = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${modelCalls}`, arguments: JSON.stringify(args) }] });
  const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      modelCalls += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const next = script.shift();
      return new Response(JSON.stringify(next !== undefined ? next(body) : say('In the current model, that link matters.')), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: {
        nodes: [
          { id: 'dec', kind: 'decision', label: 'Price decision' },
          { id: 'price', kind: 'factor', label: 'Pro plan price' },
          { id: 'mrr', kind: 'goal', label: 'MRR' },
        ],
        edges: [{ from: 'price', to: 'mrr', strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', provenance: { source } }],
      },
      graph_hash: `h${rev}`,
      analysis_ready: { status: 'ready', may_run: true },
      analysis_state: {},
    }));
    // The product's link-strength writer, only as far as its contract states it: sets ±magnitude, stamps it the user's.
    app.post('/orchestrate/v2/turn', async (req) => {
      const ev = (req.body as { event?: Record<string, unknown> }).event ?? {};
      if (ev['kind'] === 'edge_strength_edit') {
        linkWrites += 1;
        if (refuseWrite) return { assistant_text: "I couldn't save that change, so I haven't changed anything.", graph_hash: `h${rev}` };
        mean = Number(ev['magnitude']); source = 'user_specified'; rev += 1;
        const answered = { assistant_text: 'Updated.', graph_hash: `h${rev}` };
        afterWrite?.();
        return answered;
      }
      return { assistant_text: 'Updated.', graph_hash: `h${rev}` };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 180_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { mean = 0.5; source = 'cee_hypothesis'; rev = 1; afterWrite = undefined; refuseWrite = false; linkWrites = 0; script = []; forcedAuthorise = undefined; nextScenario(); });

  const turn = async (payload: Record<string, unknown>): Promise<Body> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, ...payload } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as Body;
  };
  /** Turn f1 of the served journey: "record that link as strong, as my own estimate" → ONE proposal and its button. */
  const proposeStrong = async (): Promise<{ approve: Chip; proposalId: string }> => {
    script = [
      () => fnCall('propose_link_strength', { from_label: 'Pro plan price', to_label: 'MRR', strength: 'strong', rationale: 'The user said its effect is strong.' }),
      () => say('I can record Pro plan price → MRR as strong, as your own estimate. Shall I apply it?'),
    ];
    const t1 = await turn({ message: 'Its effect is strong. Please record that link as strong, as my own estimate.' });
    const approve = t1.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
    expect(approve, `the control: a real link-strength proposal was offered ${JSON.stringify(t1._agent.tool_calls)}`).toBeDefined();
    return { approve: approve!, proposalId: approve!.id.slice('agent-approve-proposal:'.length) };
  };

  it('[f2] RED: one click on "Record this link" (the REAL fast path + the REAL capability) → the recorded link in the user\'s words, no instruction to the Agent, no code', async () => {
    const { approve } = await proposeStrong();
    const before = modelCalls;
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._diagnostic_trace.fast_path, 'the control: this is the typed-approval fast path').toBe('approve');
    expect(modelCalls - before, 'no model reads the result on this path').toBe(0);
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    expect(source, 'the control: the link really was recorded as the user\'s').toBe('user_specified');
    expect(t2.assistant_text, t2.assistant_text).not.toMatch(AGENT_DIRECTED);
    expect(t2.assistant_text, t2.assistant_text).not.toMatch(SNAKE);
    // What was recorded is still said, to the user, once.
    expect(t2.assistant_text, t2.assistant_text).toMatch(/"Pro plan price" → "MRR" as strong \(0\.825 on Olumi's 0–1 scale\), as your own estimate/);
    expect(t2.assistant_text.match(/own estimate/g), 'said once, not twice').toHaveLength(1);
  }, 120_000);

  /**
   * ⛔ ROUND-2 REVIEW, BLOCKER 2 — A FALSE "NOT SAVED" ON THIS SAME SEAM. The link write answers 200 with its own
   * revision; another writer moves the model before the Agent reads it back. The link now holds exactly what the user
   * approved, stamped as theirs, yet `landed` also demanded that the two revisions be EQUAL, so the user read "Not
   * saved: none of it was applied." and the approval was left unapplied.
   */
  const RECORDED = 'Recorded "Pro plan price" → "MRR" as strong (0.825 on Olumi\'s 0–1 scale), as your own estimate.';
  it('[f2-race] RED: the link write lands, another writer then moves the model, and the link holds exactly the approved strength and source → Saved, the recorded link said, the approval applied', async () => {
    const { approve } = await proposeStrong();
    afterWrite = () => { rev += 1; };
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._diagnostic_trace.fast_path).toBe('approve');
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    expect(t2.assistant_text, t2.assistant_text).toContain(RECORDED);
    expect(t2.assistant_text, t2.assistant_text).toMatch(/^Saved\b|\bSaved\./);
    expect(t2.assistant_text, t2.assistant_text).not.toMatch(/Not saved|none of it was applied|could not be confirmed/);
    // Marked applied: the same click again recovers the first result and writes nothing twice.
    afterWrite = undefined;
    const t3 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t3.assistant_text, t3.assistant_text).toMatch(/That change was already saved; nothing was written again\./);
    expect(linkWrites, 'written once').toBe(1);
  }, 120_000);

  it('[f2-race-moved] RED: the link write lands, then another writer changes THAT link before the read-back → "could not be confirmed" with mutated:true — never "Not saved"', async () => {
    const { approve } = await proposeStrong();
    afterWrite = () => { mean = 0.3; source = 'cee_hypothesis'; rev += 1; };
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: false, mutated: true, refusal: 'not_verified' })]);
    expect(t2.assistant_text, t2.assistant_text).toMatch(/could not be confirmed/);
    expect(t2.assistant_text, t2.assistant_text).not.toMatch(/Not saved|none of it was applied|\bSaved\./);
    expect(t2.assistant_text, 'nothing is described as recorded').not.toContain(RECORDED);
  }, 120_000);

  it('CONTRAST (passes at base): the link writer refuses (200, nothing written, revision unmoved) → still "Not saved", mutated:false', async () => {
    const { approve } = await proposeStrong();
    refuseWrite = true;
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: false, mutated: false, refusal: 'not_applied' })]);
    expect(t2.assistant_text, t2.assistant_text).toMatch(/Not saved: none of it was applied\./);
  }, 120_000);

  it('CONTROL: the same approval typed as words (the Agent path) → the Agent still READS the guidance the user never sees', async () => {
    const { proposalId } = await proposeStrong();
    let seenByModel = '';
    script = [
      () => fnCall('authorise_change', { proposal_id: proposalId }),
      (body) => { seenByModel = JSON.stringify(body['input']); return say('That link is now recorded as strong, as your own estimate.'); },
    ];
    const t2 = await turn({ message: 'Yes, record it.' });
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    expect(seenByModel, seenByModel.slice(-1200)).toMatch(/Offer to run the analysis again/);
  }, 120_000);

  it('[f2-served] RED: the served follow_up VERBATIM through the real fast path → "Offer to run…" and "the user" never reach the user', async () => {
    forcedAuthorise = { ok: true, mutated: true, applied: true, receipts: [], follow_up: SERVED_F2_FOLLOW_UP };
    const t = await turn({ message: 'Yes, record that.', source: 'chip', chip: { id: 'agent-approve-proposal:prop_0123456789abcdef0123456789abcdef' } });
    expect(t._diagnostic_trace.fast_path).toBe('approve');
    expect(t.assistant_text, t.assistant_text).not.toMatch(AGENT_DIRECTED);
    expect(t.assistant_text, 'Olumi\'s own status line still stands').toMatch(/^Saved\b|\bSaved\./);
  }, 120_000);

  it('CONTRAST: the served add-option follow_up (addressed to the user) reaches the user unchanged through the same fast path', async () => {
    forcedAuthorise = { ok: true, mutated: true, applied: true, receipts: [], follow_up: SERVED_D3_FOLLOW_UP };
    const t = await turn({ message: 'Yes, add that option.', source: 'chip', chip: { id: 'agent-approve-proposal:prop_0123456789abcdef0123456789abcdef' } });
    expect(t.assistant_text.startsWith(SERVED_D3_FOLLOW_UP), t.assistant_text).toBe(true);
  }, 120_000);
});

describe('the boundary guard, on the capability\'s OWN words (not the author\'s)', () => {
  it('RED: every Agent-directed sentence in the served follow_up is removed; the served user-facing follow_up is kept byte for byte', async () => {
    const { withoutAgentDirections } = await import('../write-outcome.js') as { withoutAgentDirections?: (t: string) => { readonly text: string; readonly dropped: readonly string[] } };
    expect(typeof withoutAgentDirections, 'the boundary exists').toBe('function');
    const served = withoutAgentDirections!(SERVED_F2_FOLLOW_UP);
    expect(served.text).not.toMatch(AGENT_DIRECTED);
    expect(served.dropped.length).toBeGreaterThan(0);
    expect(withoutAgentDirections!(SERVED_D3_FOLLOW_UP)).toEqual({ text: SERVED_D3_FOLLOW_UP, dropped: [] });
  });

  it('RED (round-2 review, non-blocking 2): a quoted label holding ". " is never split — the sentence is kept whole, byte for byte', async () => {
    const { withoutAgentDirections } = await import('../write-outcome.js');
    const text = 'Recorded "Acme Inc. price" → "net_mrr" as strong (0.825 on Olumi\'s 0–1 scale), as your own estimate.';
    expect(withoutAgentDirections(text)).toEqual({ text, dropped: [] });
  });

  it('CONTRAST: an instruction to the Agent after a quoted label holding ". " is still dropped, and only it', async () => {
    const { withoutAgentDirections } = await import('../write-outcome.js');
    const kept = 'Recorded "Acme Inc. price" → "MRR" as strong, as your own estimate.';
    expect(withoutAgentDirections(`${kept} Offer to run the analysis again so they can see what it changes.`))
      .toEqual({ text: kept, dropped: ['Offer to run the analysis again so they can see what it changes.'] });
  });

  it('RED: the model-facing notes and details the REAL link-strength capability returns are all caught by the guard', async () => {
    const { withoutAgentDirections } = await import('../write-outcome.js') as { withoutAgentDirections?: (t: string) => { readonly text: string; readonly dropped: readonly string[] } };
    const { createAgentCapabilities } = await import('../runtime/agent-capabilities.js');
    const { ProposalStore } = await import('../proposal.js');
    const ctx = { scenario_id: '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3eff', authenticated_user_id: null, request_id: 'r' };
    const graph = (m: number) => ({ nodes: [{ id: 'price', kind: 'factor', label: 'Pro plan price' }, { id: 'mrr', kind: 'goal', label: 'MRR' }],
      edges: [{ from: 'price', to: 'mrr', strength: { mean: m, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'cee_hypothesis' } }] });
    const d = async (path: string) => (path.endsWith('/graph') ? { status: 200, json: { graph: graph(0.5), graph_hash: 'h1' } } : { status: 200, json: { assistant_text: '', graph_hash: 'h1' } });
    const caps = createAgentCapabilities(d as never, new ProposalStore());
    const texts = [
      (await caps.proposeLinkStrength!(ctx, { from_label: 'Pro plan price', to_label: 'MRR', strength: 'strong', rationale: 'x' })).note,
      (await caps.proposeLinkStrength!(ctx, { from_label: 'Pro plan price', to_label: 'MRR', strength: 'moderate', rationale: 'x' })).note,
      (await caps.proposeLinkStrength!(ctx, { from_label: 'MRR', to_label: 'Pro plan price', strength: 'strong', rationale: 'x' })).detail,
      (await caps.proposeLinkStrength!(ctx, { from_label: 'Pro plan price', to_label: 'MRR', strength: 'huge' as never, rationale: 'x' })).detail,
    ].map(String);
    expect(texts.every((t) => t.length > 0), JSON.stringify(texts)).toBe(true);
    for (const t of texts) {
      const g = withoutAgentDirections!(t);
      expect(g.text, `${t}\n→ ${g.text}`).not.toMatch(AGENT_DIRECTED);
      expect(g.text, `${t}\n→ ${g.text}`).not.toMatch(SNAKE);
    }
  });
});

/* ── the WRITE narrator: every code the write tools return reads as words ── */

/** Exactly what the user reads for one write result. */
const said = (tool: 'authorise_change' | 'build_model_from_brief', r: Record<string, unknown>): string => {
  const n = narrateWriteOutcome('', [{ name: tool }], [r as never]);
  return withWriteOutcome(n.text, n.status);
};

/**
 * Every refusal `authorise_change` and `build_model_from_brief` can return that had NO words at base, with its
 * producer (derived by grep over `runtime/agent-capabilities.ts`, `runtime/build-model.ts`, `runtime/agent-tools.ts`,
 * `runtime/agent-loop.ts`). `not_verified`, `not_confirmed` and `model_not_readable_after_write` have rows of their own.
 */
const UNWORDED_AT_BASE: readonly { tool: 'authorise_change' | 'build_model_from_brief'; code: string; producer: string }[] = [
  { tool: 'authorise_change', code: 'not_found', producer: 'authoriseChange / confirmHeld: the model could not be read' },
  { tool: 'authorise_change', code: 'unsupported_compound', producer: 'applyCompound: an operation outside COMPOUND_ORDER' },
  { tool: 'authorise_change', code: 'unparsable_arguments', producer: 'dispatchTool: arguments were not JSON' },
  { tool: 'authorise_change', code: 'unknown_tool', producer: 'dispatchTool: no such tool' },
  { tool: 'authorise_change', code: 'withheld_on_chip_turn', producer: 'agent-loop: withheld on a suggestion-button turn' },
  { tool: 'build_model_from_brief', code: 'construction_unavailable', producer: 'buildModelFromBrief: no structured caller' },
  { tool: 'build_model_from_brief', code: 'empty_brief', producer: 'buildModelFromBrief: nothing to build from' },
  { tool: 'build_model_from_brief', code: 'not_found', producer: 'buildModelFromBrief: the model could not be read' },
  { tool: 'build_model_from_brief', code: 'unparsable_arguments', producer: 'dispatchTool' },
  { tool: 'build_model_from_brief', code: 'unknown_tool', producer: 'dispatchTool' },
];

describe('every code a write tool returns reads as plain words — never the code, never "refused (…)"', () => {
  const GENERIC_AUTHORISE = said('authorise_change', { ok: false, mutated: false, refusal: 'a_code_nobody_has_worded' });
  const GENERIC_BUILD = said('build_model_from_brief', { ok: false, mutated: false, refusal: 'a_code_nobody_has_worded' });
  for (const { tool, code, producer } of UNWORDED_AT_BASE) {
    it(`RED: ${tool} → ${code} (${producer}) has its own plain words`, () => {
      const text = said(tool, { ok: false, mutated: false, refusal: code });
      expect(text, text).not.toContain(code);
      expect(text, text).not.toMatch(SNAKE);
      expect(text, text).not.toMatch(/refused \(/);
      expect(text, 'its own words, not the generic sentence').not.toBe(tool === 'authorise_change' ? GENERIC_AUTHORISE : GENERIC_BUILD);
    });
  }

  it('RED: not_verified WITH mutated:true (the option DID land) → "could not be confirmed", never "Not saved", "refused" or the code', () => {
    const text = said('authorise_change', { ok: false, mutated: true, refusal: 'not_verified', proposal_id: 'gmh_0123456789ab' });
    expect(text, text).toMatch(/could not be confirmed/);
    expect(text, text).not.toMatch(/Not saved|refused|not_verified|Partly saved/);
  });

  it('RED: not_confirmed (the read-back failed after a 200) → "could not be confirmed", never "Not saved" or the code', () => {
    const text = said('authorise_change', { ok: false, mutated: false, applied: false, refusal: 'not_confirmed' });
    expect(text, text).toMatch(/could not be confirmed/);
    expect(text, text).not.toMatch(/Not saved|refused|not_confirmed/);
  });

  it('RED: model_not_readable_after_write (the build may have been saved) → never "was not built", never the code', () => {
    const text = said('build_model_from_brief', { ok: false, mutated: false, refusal: 'model_not_readable_after_write' });
    expect(text, text).toMatch(/could not be confirmed/);
    expect(text, text).not.toMatch(/was not built|refused|model_not_readable_after_write/);
  });

  it('RED: a code nobody has worded → one plain generic sentence, never the code (authorise, build, and a part\'s reason)', () => {
    for (const text of [GENERIC_AUTHORISE, GENERIC_BUILD]) {
      expect(text, text).not.toMatch(/a_code_nobody_has_worded|a code nobody has worded|refused \(/);
      expect(text, text).toMatch(/ask me/i);
    }
    const partly = said('authorise_change', { ok: false, mutated: true, refusal: 'a_code_nobody_has_worded' });
    expect(partly, partly).not.toMatch(/a_code_nobody_has_worded|refused \(/);
    const part = said('authorise_change', { ok: false, mutated: true, refusal: 'partially_applied', parts: [
      { part: 'values', ok: true, recorded_count: 1, requested_count: 1, receipts: [{ version: 2 }] },
      { part: 'option_levels', ok: false, recorded_count: 0, requested_count: 2, reason: 'a_code_nobody_has_worded' },
    ] });
    expect(part, part).toMatch(/^Saved 1 of 1 starting values as version 2\. Not saved: none of the 2 option levels/);
    expect(part, part).not.toMatch(/a_code_nobody_has_worded|a code nobody has worded/);
  });

  it('CONTRAST: a worded refusal keeps its own words (superseded), and a clean save is still "Saved"', () => {
    expect(said('authorise_change', { ok: false, mutated: false, refusal: 'superseded' })).toMatch(/^Not saved: the model changed after this was proposed/);
    expect(said('authorise_change', { ok: true, mutated: true, applied: true, receipts: [{ version: 3 }] })).toBe('Saved as version 3.');
  });
});
