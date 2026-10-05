/**
 * ⭐ EVERY SERVED AGENT CALL RESOLVES TO BASELINE v1 BY ITS OWN ROW (PTL row 4, #72 5871228357; DL ASSIGN 5871346171).
 *
 * "Production must be able to prove for every AI call: task → model → exact prompt ID/version/hash →
 * environment/variant." A `_provider_calls` row carried the alias and the instructions sha (`prompt-identity.ts`), but
 * not the rest of what decides a call: the tool surface, the json_schema, the reasoning effort, the output cap, the
 * build and the environment. So MG's Baseline v1 manifest (MG-BASELINE-V1-MANIFEST.md @a50c868f: schema
 * `8b99fd09…` = sha256(JSON.stringify(buildCandidateSchema())), tool surface `f05f9608…`, effort medium, max 12000) had
 * to be recomputed OFFLINE from the code; a served call could not say which of it it sent.
 *
 * ⛔ BOUND TO THE WIRE, NOT TO THE HELPER (as `provider-ledger-prompt-identity.test.ts`): every hash below is recomputed
 * HERE, with `node:crypto`, from the body the stubbed provider RECEIVED. Rows are bound to requests by ORDER.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { OPENAI_ONLY, assertProviderAllowed, recordedProviderCalls, runWithProviderPolicy } from '../../../adapters/llm/provider-policy.js';
import { buildStrictDraftRecordsSchema } from '../runtime/build-model-from-records.js';
import { GIT_COMMIT_SHA } from '../../../version.js';
import { getRuntimeEnvResolution } from '../../../config/env-resolver.js';

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

/** Independent of the code under test: the digest of a value exactly as JSON-encoding sends it. */
const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const shaJson = (v: unknown): string => sha(JSON.stringify(v));

type Row = Record<string, unknown> & { site: string; provider: string };
type Sent = Record<string, unknown> & { text?: { format?: { type?: string; schema?: unknown } }; reasoning?: { effort?: string }; tools?: unknown };

const ORDINARY = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d01';
const CONSTRUCT = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d05';
const LEGACY = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d06';
const BRIEF = 'Should we hire a tech lead or two developers to lift delivery reliability?';

describe('⭐ PTL row 4: each Agent ledger row carries the WHOLE request identity, as sent', () => {
  let app: FastifyInstance;
  let sent: Sent[] = [];
  let script: Record<string, unknown>[] = [];
  const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
  const callTool = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${sent.length}`, arguments: JSON.stringify(args) }] });

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Sent;
      sent.push(body);
      if (body.text?.format?.type === 'json_schema') return new Response(JSON.stringify({ output: [] }), { status: 200 });
      return new Response(JSON.stringify(script.shift() ?? say('Here is where the model stands.')), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const policyMod = await import('../../../adapters/llm/provider-policy.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async (req) => {
      const sid = String((req.body as { scenario_id?: unknown } | undefined)?.scenario_id ?? '');
      if (sid === LEGACY) {
        try { policyMod.assertProviderAllowed('anthropic', 'decision_review', { model: 'claude-sonnet-5', purpose: 'decision_review' }); } catch { /* refused */ }
      }
      return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: 'h1',
        blocks: [{ type: 'analysis_result', data: { marker: 'the-run' } }], analysis_ready: { status: 'ready', options: [], blockers: [] } };
    });
    app.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const sid = (req.params as { id: string }).id;
      if (sid === CONSTRUCT) return { graph: { nodes: [], edges: [] }, graph_hash: null };
      return { graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Velocity' }, { id: 'f', kind: 'factor', label: 'Capacity' }], edges: [{ from: 'f', to: 'g' }] }, graph_hash: 'h1' };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { sent = []; script = []; });

  const turn = async (scenarioId: string, payload: Record<string, unknown>) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: scenarioId, ...payload } });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    return (r.json() as { _provider_calls: Row[] })._provider_calls;
  };
  const env = getRuntimeEnvResolution();

  it('RED: a conversation row carries the tool surface, effort, output cap, build and environment it was SENT with', async () => {
    script = [callTool('run_analysis', { reason: 'compare' })];
    const rows = await turn(ORDINARY, { message: 'Compare the options for me.' });
    expect(rows.length, 'one row per provider request').toBe(sent.length);
    rows.forEach((row, i) => {
      const s = sent[i]!;
      expect(Array.isArray(s.tools), `request ${i} sent a tool surface`).toBe(true);
      expect(row.tools_sha256, `row ${i}`).toBe(shaJson(s.tools));
      expect(row.reasoning_effort, `row ${i}`).toBe(s.reasoning?.effort);
      expect(row.max_output_tokens, `row ${i}`).toBe(s['max_output_tokens']);
      expect(row, `row ${i}: a conversation call sends no json_schema`).not.toHaveProperty('schema_sha256');
      expect(row.cee_build, `row ${i}`).toBe(GIT_COMMIT_SHA);
      expect(row.environment, `row ${i}`).toBe(env.env);
      expect(row.environment_source, `row ${i}`).toBe(env.source);
    });
  });

  it('RED: a construction row carries the schema it SENT — the Baseline v1 manifest’s own definition — with its effort and cap', async () => {
    script = [callTool('build_model_from_brief', { brief: BRIEF })];
    const rows = await turn(CONSTRUCT, { message: BRIEF });
    expect(rows.length).toBe(sent.length);
    const idx = rows.map((r, i) => (r.site === 'agent-v1-turn.callStructured' ? i : -1)).filter((i) => i >= 0);
    expect(idx.length, JSON.stringify(rows.map((r) => r.site))).toBeGreaterThanOrEqual(1);
    for (const i of idx) {
      const s = sent[i]!;
      expect(s.text?.format?.type).toBe('json_schema');
      expect(rows[i]!.schema_sha256, `row ${i}`).toBe(shaJson(s.text?.format?.schema));
      // Bind to the served records constructor's own strict schema, with the same full JSON hash assertion.
      expect(rows[i]!.schema_sha256, `row ${i} resolves to the manifest's definition`).toBe(shaJson(buildStrictDraftRecordsSchema()));
      expect(rows[i]!.reasoning_effort, `row ${i}`).toBe(s.reasoning?.effort);
      expect(rows[i]!.max_output_tokens, `row ${i}`).toBe(s['max_output_tokens']);
      expect(rows[i], `row ${i}: construction sends no tools`).not.toHaveProperty('tools_sha256');
      expect(rows[i]!.cee_build).toBe(GIT_COMMIT_SHA);
    }
  });

  it('the request bytes do not move: the bodies keep their fields, in order', async () => {
    script = [callTool('build_model_from_brief', { brief: BRIEF })];
    await turn(CONSTRUCT, { message: BRIEF });
    const structured = sent.find((s) => s.text?.format?.type === 'json_schema')!;
    expect(Object.keys(structured)).toEqual(['model', 'instructions', 'input', 'max_output_tokens', 'reasoning', 'text']);
    const conversation = sent.find((s) => s.text?.format?.type !== 'json_schema')!;
    // T1 (b): the converse instructions ride as input[0] (a developer block with an explicit cache breakpoint), not a field.
    expect(Object.keys(conversation)).toEqual(['model', 'input', 'tools', 'reasoning', 'max_output_tokens']);
  });

  it('CONTROL: a LEGACY site beneath internal dispatch carries none of the new fields; the Agent’s own rows in the same turn do', async () => {
    script = [callTool('run_analysis', { reason: 'compare' })];
    const rows = await turn(LEGACY, { message: 'Compare the options for me.' });
    const legacy = rows.filter((r) => r.provider === 'anthropic');
    expect(legacy).toHaveLength(1);
    for (const k of ['tools_sha256', 'schema_sha256', 'reasoning_effort', 'max_output_tokens', 'cee_build', 'environment']) expect(legacy[0], k).not.toHaveProperty(k);
    const own = rows.filter((r) => r.provider === 'openai');
    expect(own.length).toBeGreaterThanOrEqual(1);
    for (const r of own) expect([typeof r.tools_sha256, r.cee_build]).toEqual(['string', GIT_COMMIT_SHA]);
  });
});

describe('the new ledger fields are additive', () => {
  it('CONTROL: a call without them records none; the same call with them records them as given', () => {
    const rows = runWithProviderPolicy(OPENAI_ONLY('test'), () => {
      assertProviderAllowed('openai', 'legacy.site', { model: 'gpt-x', purpose: 'p' });
      assertProviderAllowed('openai', 'agent.site', {
        model: 'gpt-x', purpose: 'p', prompt_alias: 'agent.converse', prompt_sha256: sha('abc'),
        tools_sha256: sha('[]'), reasoning_effort: 'low', max_output_tokens: 3400, cee_build: 'b'.repeat(40), environment: 'staging', environment_source: 'render_service_name',
      });
      return recordedProviderCalls();
    });
    expect(Object.keys(rows[0]!).sort()).toEqual(['model', 'outcome', 'provider', 'purpose', 'site']);
    expect(rows[1]).toEqual({
      site: 'agent.site', provider: 'openai', model: 'gpt-x', purpose: 'p', outcome: 'allowed', prompt_alias: 'agent.converse', prompt_sha256: sha('abc'),
      tools_sha256: sha('[]'), reasoning_effort: 'low', max_output_tokens: 3400, cee_build: 'b'.repeat(40), environment: 'staging', environment_source: 'render_service_name',
    });
  });
});
