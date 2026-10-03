import { explainRun } from './fixtures/run-explanation-follow-up.js';
/**
 * ⭐ EVERY SERVED AGENT CALL SAYS WHICH PROMPT IT SENT — `prompt_alias` + `prompt_sha256` on its `_provider_calls` row.
 *
 * AIQ identity map (`aiq-p2-20260927/PROMPT-HARNESS-IDENTITY-MAP.md` @30c0e79c, Part 2 §2), CODE-READ at CEE 339ed343:
 * "No served model call carries a prompt identity. A `_provider_calls` entry holds `site, provider, model, purpose,
 * outcome, tokens` … with no prompt id, version or hash." DL #70 5858315483 item 3 asks Runtime for the map's smallest
 * enabling change: each row gains the stage alias and the sha256 of the FINAL composed instructions.
 *
 * ⛔ BOUND TO THE WIRE, NOT TO THE HELPER. Every sha below is recomputed HERE, with `node:crypto`, from the
 * `instructions` the stubbed provider actually RECEIVED — never from `promptSha256` — so a helper that hashed the wrong
 * string (the base prompt before a constraint was appended, a constant instead of the composed text) cannot agree with
 * itself and pass. Rows are bound to requests by ORDER: the route's calls are sequential, and each row count is
 * asserted equal to the request count first.
 *
 * The real route over a product double (the pattern of `run-fast-path.test.ts` / `agent-turn-is-openai-only.test.ts`);
 * `fetch` is the only provider seam.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { AGENT_PROMPT_ALIASES, promptSha256 } from '../runtime/prompt-identity.js';
import { researchChipFor } from '../runtime/public-research.js';
import { OPENAI_ONLY, assertProviderAllowed, recordedProviderCalls, runWithProviderPolicy } from '../../../adapters/llm/provider-policy.js';
import { asSent } from './helpers/as-sent.js';

/** P0 SHARED DATA (#85 5963281356): the readback's admission, as the producer always mints it (matrix M1); an absent one now fails the ONE leader licence closed. */
const COMPARATIVE_ADMISSION = { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } as const;

const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

/** Independent of the code under test: the digest of exactly what the provider was sent. */
const sha = (text: unknown): string => createHash('sha256').update(typeof text === 'string' ? text : '', 'utf8').digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;

type Row = { site: string; provider: string; model: string; purpose: string; outcome: string; prompt_alias?: string; prompt_sha256?: string; instructions_carrier?: string };

/** One scenario per row, so no row reads another's history, offer or readback. */
const ORDINARY = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c01';
const RUN_WITHHELD = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c02';
const RUN_NOTHING_ON_RECORD = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c03';
const RESEARCH = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c04';
const CONSTRUCT = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c05';
const LEGACY = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c06';

const Q = 'typical churn after a SaaS price rise of about 20%';
const BRIEF = 'Should we hire a tech lead or two developers to lift delivery reliability?';

describe('the provider ledger names the prompt each Agent call sent', () => {
  let app: FastifyInstance;
  /** Every request body the provider received, in order. */
  let sent: Record<string, unknown>[] = [];
  /** The same requests exactly as sent, before `asSent` reads the instructions back out of their carrier (T1 b). */
  let raw: Record<string, unknown>[] = [];
  /** What the conversation model does next, one entry per non-interpreting call; then it just answers. */
  let script: Record<string, unknown>[] = [];
  const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
  const callTool = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${sent.length}`, arguments: JSON.stringify(args) }] });

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const rawBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      raw.push(rawBody);
      const body = asSent(rawBody) as Record<string, unknown> & { text?: { format?: { type?: string } } };
      sent.push(body);
      // Construction: no structured answer (the measured "reasoning ate the budget" shape) — the row is what is tested.
      if (body.text?.format?.type === 'json_schema') return new Response(JSON.stringify({ output: [] }), { status: 200 });
      if (JSON.stringify(body['tools'] ?? []).includes('web_search')) return new Response(JSON.stringify({ output: [], status: 'completed' }), { status: 200 });
      if (body['tool_choice'] === 'none') return new Response(JSON.stringify(say('In the current model, the result turns on Capacity.')), { status: 200 });
      return new Response(JSON.stringify(script.shift() ?? say('Here is where the model stands.')), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    // The ROUTE's module instance (after resetModules), so a legacy attempt lands on the same ledger the route reads.
    const policyMod = await import('../../../adapters/llm/provider-policy.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async (req) => {
      const sid = String((req.body as { scenario_id?: unknown } | undefined)?.scenario_id ?? '');
      // A LEGACY Anthropic site beneath internal dispatch, as decision_review was on served c4a6cce.
      if (sid === LEGACY) {
        try { policyMod.assertProviderAllowed('anthropic', 'decision_review', { model: 'claude-sonnet-5', purpose: 'decision_review' }); } catch { /* refused, as the enricher degrades */ }
      }
      return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: 'h1',
        blocks: [{ type: 'analysis_result', data: { marker: 'the-run' } }], analysis_ready: { status: 'ready', options: [], blockers: [], analysis_admission: COMPARATIVE_ADMISSION } };
    });
    app.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const sid = (req.params as { id: string }).id;
      // An empty scenario: the only one a construction may build on.
      if (sid === CONSTRUCT) return { graph: { nodes: [], edges: [] }, graph_hash: null };
      return {
        graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Velocity' }, { id: 'f', kind: 'factor', label: 'Capacity' }], edges: [{ from: 'f', to: 'g' }] },
        graph_hash: 'h1',
        analysis_ready: { status: 'ready', analysis_admission: COMPARATIVE_ADMISSION },
        // A completed withheld Run asks for C5b's typed view; the permitted completed control does not. Same alias, different composed instructions.
        ...([RUN_WITHHELD, RUN_NOTHING_ON_RECORD].includes(sid) ? { analysis_result: { type: 'analysis_result', computed_against_hash: '0123456789abcdef', data: { marker: 'synthetic' } },
          analysis_state: { run_state: { kind: 'complete_current', computed_at: '2026-10-01T12:00:00.000Z' }, leader_claim: sid === RUN_WITHHELD
            ? { permitted: false, withheld_reason: 'constraint_verdict_withheld' } : { permitted: true, separation: 'separated' } } } : {}),
      };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { sent = []; raw = []; script = []; });

  const turn = async (scenarioId: string, payload: Record<string, unknown>) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: scenarioId, ...payload } });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    return (r.json() as { _provider_calls: Row[] })._provider_calls;
  };
  const runChip = async (scenarioId: string) => {
    const first = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { scenario_id: scenarioId, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } } });
    expect(first.json()._provider_calls).toEqual([]);
    const second = await explainRun(app, scenarioId, first);
    return second.json()._provider_calls as Row[];
  };

  it('RED: an ordinary turn — every row is agent.converse, and its sha is of the instructions the provider received', async () => {
    script = [callTool('run_analysis', { reason: 'compare' })];
    const rows = await turn(ORDINARY, { message: 'Compare the options for me.' });
    expect(rows.length, 'a tool hop, then the answer').toBeGreaterThanOrEqual(2);
    expect(rows.length, 'one row per provider request').toBe(sent.length);
    rows.forEach((row, i) => {
      expect(row.site, `row ${i}`).toBe('agent-v1-turn.callModel');
      expect(row.prompt_alias, `row ${i}`).toBe('agent.converse');
      expect(row.prompt_sha256, `row ${i}`).toMatch(HEX64);
      expect(typeof sent[i]!['instructions'], `request ${i} sent instructions`).toBe('string');
      expect(row.prompt_sha256, `row ${i} is bound to request ${i}`).toBe(sha(sent[i]!['instructions']));
    });
  });

  it('RED: a Run-chip fast-path turn — its ONE interpreting call is agent.interpret, hashed as sent', async () => {
    const rows = await runChip(RUN_WITHHELD);
    expect(sent, 'exactly one provider request').toHaveLength(1);
    expect(sent[0]!['tool_choice'], 'the interpreting call').toBe('none');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.site).toBe('agent-v1-turn.callModel');
    expect(rows[0]!.prompt_alias).toBe('agent.interpret');
    expect(rows[0]!.prompt_sha256).toMatch(HEX64);
    expect(rows[0]!.prompt_sha256).toBe(sha(sent[0]!['instructions']));
  });

  it('RED: changing the composed instructions changes the sha — an appended constraint, and C5b’s view line under ONE alias', async () => {
    const converse = await turn(ORDINARY, { message: 'What does the model say?' });
    const conversed = sent[0]!['instructions'] as string;
    sent = [];
    const withView = await runChip(RUN_WITHHELD);
    const interpretedWithView = sent[0]!['instructions'] as string;
    sent = [];
    const withoutView = await runChip(RUN_NOTHING_ON_RECORD);
    const interpretedPlain = sent[0]!['instructions'] as string;

    // The premises: the three prompts really differ, and only by what was appended.
    expect(interpretedPlain.startsWith(`${conversed}\n\n`), 'the interpreter appends its constraint to the Agent prompt').toBe(true);
    expect(interpretedWithView.length, 'the withheld run adds C5b’s view line').toBeGreaterThan(interpretedPlain.length);

    expect(converse[0]!.prompt_sha256).toBe(sha(conversed));
    expect(withView[0]!.prompt_sha256).toBe(sha(interpretedWithView));
    expect(withoutView[0]!.prompt_sha256).toBe(sha(interpretedPlain));
    expect(withView[0]!.prompt_alias).toBe('agent.interpret');
    expect(withoutView[0]!.prompt_alias, 'same stage, same alias').toBe('agent.interpret');
    expect(new Set([converse[0]!.prompt_sha256, withView[0]!.prompt_sha256, withoutView[0]!.prompt_sha256]).size, 'three prompts, three digests').toBe(3);
  });

  it('RED: the approved public-research call is agent.research, hashed as the research body sent it', async () => {
    script = [callTool('offer_public_research', { query: Q }), say('I can search the web for that if you press the button.')];
    await turn(RESEARCH, { message: 'What churn do other SaaS firms see after a price rise?' });
    sent = [];
    const chip = researchChipFor(Q)!;
    const rows = await turn(RESEARCH, { message: chip.message, source: 'chip_click', chip: { id: chip.id } });
    expect(sent, 'the click makes one request, the search').toHaveLength(1);
    expect(JSON.stringify(sent[0]!['tools'])).toContain('web_search');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.site).toBe('agent-v1-turn.callResearch');
    expect(rows[0]!.prompt_alias).toBe('agent.research');
    expect(rows[0]!.prompt_sha256).toBe(sha(sent[0]!['instructions']));
  });

  it('RED: a construction call is agent.construct, hashed as sent — beside the conversation rows that asked for it', async () => {
    script = [callTool('build_model_from_brief', { brief: BRIEF })];
    const rows = await turn(CONSTRUCT, { message: BRIEF });
    expect(rows.length).toBe(sent.length);
    const constructIdx = rows.map((r, i) => (r.site === 'agent-v1-turn.callStructured' ? i : -1)).filter((i) => i >= 0);
    expect(constructIdx.length, JSON.stringify(rows.map((r) => r.site))).toBeGreaterThanOrEqual(1);
    for (const i of constructIdx) {
      expect((sent[i] as { text?: { format?: { type?: string } } }).text?.format?.type, `request ${i} is the structured call`).toBe('json_schema');
      expect(rows[i]!.prompt_alias, `row ${i}`).toBe('agent.construct');
      expect(rows[i]!.prompt_sha256, `row ${i}`).toBe(sha(sent[i]!['instructions']));
    }
    for (const [i, row] of rows.entries()) if (!constructIdx.includes(i)) expect(row.prompt_alias, `row ${i}`).toBe('agent.converse');
  });

  it('CONTROL: a LEGACY site beneath internal dispatch stays unaliased (v1 wires the Agent’s own calls only)', async () => {
    script = [callTool('run_analysis', { reason: 'compare' })];
    const rows = await turn(LEGACY, { message: 'Compare the options for me.' });
    const legacy = rows.filter((r) => r.provider === 'anthropic');
    expect(legacy, JSON.stringify(rows)).toEqual([
      { site: 'decision_review', provider: 'anthropic', model: 'claude-sonnet-5', purpose: 'decision_review', outcome: 'refused_before_network' },
    ]);
    expect('prompt_alias' in legacy[0]!).toBe(false);
    expect('prompt_sha256' in legacy[0]!).toBe(false);
    // Contrast in the same turn: the Agent's own rows DO carry both.
    const own = rows.filter((r) => r.provider === 'openai');
    expect(own.length).toBeGreaterThanOrEqual(1);
    for (const r of own) expect([r.prompt_alias, HEX64.test(r.prompt_sha256 ?? '')]).toEqual(['agent.converse', true]);
  });
  it('RED (T1 b): a converse call sends the Agent instructions as a developer block with an EXPLICIT cache breakpoint; same text, same sha', async () => {
    const rows = await turn(ORDINARY, { message: 'What does the model say?' });
    const req = raw[0]!;
    expect(req, 'no top-level instructions on a converse call').not.toHaveProperty('instructions');
    const first = (req['input'] as Record<string, unknown>[])[0]!;
    expect(first['role']).toBe('developer');
    const block = (first['content'] as Record<string, unknown>[])[0]!;
    expect(block['type']).toBe('input_text');
    expect(block['prompt_cache_breakpoint']).toEqual({ mode: 'explicit' });
    expect(block['text'], 'exactly the instructions the old carrier sent').toBe(sent[0]!['instructions']);
    expect(rows[0]!.prompt_sha256, 'the ledger identity is of the same text').toBe(sha(block['text']));
    expect(rows[0]!.instructions_carrier).toBe('developer_breakpoint');
  });

  it('CONTROL (T1 b): the interpreting call keeps top-level instructions — its per-Run line would make a breakpoint write an entry nothing reads', async () => {
    const rows = await runChip(RUN_WITHHELD);
    expect(raw[0]!['tool_choice']).toBe('none');
    expect(typeof raw[0]!['instructions']).toBe('string');
    expect(JSON.stringify(raw[0]!['input'] ?? [])).not.toContain('prompt_cache_breakpoint');
    expect(rows[0]!.instructions_carrier).toBe('instructions');
  });

});

describe('the ledger fields are additive, and the alias list is the map’s', () => {
  it('CONTROL: a provider-policy call without the fields records NEITHER key; the same call with them records both', () => {
    const rows = runWithProviderPolicy(OPENAI_ONLY('test'), () => {
      assertProviderAllowed('openai', 'legacy.site', { model: 'gpt-x', purpose: 'p' });
      assertProviderAllowed('openai', 'agent.site', { model: 'gpt-x', purpose: 'p', prompt_alias: 'agent.converse', prompt_sha256: sha('abc') });
      return recordedProviderCalls();
    });
    expect(rows[0]).toEqual({ site: 'legacy.site', provider: 'openai', model: 'gpt-x', purpose: 'p', outcome: 'allowed' });
    expect(Object.keys(rows[0]!).sort()).toEqual(['model', 'outcome', 'provider', 'purpose', 'site']);
    expect(rows[1]).toEqual({ site: 'agent.site', provider: 'openai', model: 'gpt-x', purpose: 'p', outcome: 'allowed', prompt_alias: 'agent.converse', prompt_sha256: sha('abc') });
  });

  it('the hash never throws: absent instructions hash the empty string, and a non-string hashes its JSON', () => {
    expect(promptSha256(undefined)).toBe(sha(''));
    expect(promptSha256(null)).toBe(sha(''));
    expect(promptSha256('Answer briefly.')).toBe(sha('Answer briefly.'));
    expect(promptSha256(['a', 'b'])).toBe(sha('["a","b"]'));
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(promptSha256(circular)).toBe(sha(''));
  });

  it('the four served-stage aliases are the identity map’s Part 3 names, verbatim, plus C6-2\'s brief reading', () => {
    expect([...AGENT_PROMPT_ALIASES]).toEqual(['agent.converse', 'agent.interpret', 'agent.research', 'agent.construct', 'agent.read_brief']);
  });
});
