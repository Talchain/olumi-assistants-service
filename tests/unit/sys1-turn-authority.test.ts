import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { ReadableStream } from 'node:stream/web';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { createAgentCapabilities, authorisationTurnId, type InternalDispatch } from '../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { ProposalStore, createProposal, approvedOperationKey, MAX_EXECUTIONS_PER_PROPOSAL, type ProposalContent } from '../../src/orchestrator-v5/agent-lane/proposal.js';
import { isComposerApprovalWords } from '../../src/orchestrator-v5/agent-lane/composer-approval-words.js';
import * as adapter from '../../src/adapters/llm/openai.js';
import * as capabilitiesModule from '../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import * as policyModule from '../../src/adapters/llm/provider-policy.js';
import * as briefModule from '../../src/orchestrator-v5/agent-lane/brief-reading.js';
import * as researchModule from '../../src/orchestrator-v5/agent-lane/runtime/public-research.js';
import { runWithStageStream } from '../../src/cee/unified-pipeline/stage-stream-context.js';
import { OPENAI_ONLY, recordedProviderCalls, runWithProviderPolicy } from '../../src/adapters/llm/provider-policy.js';
import { agentRequestIdentity } from '../../src/orchestrator-v5/agent-lane/runtime/prompt-identity.js';
import { narrateWriteOutcome } from '../../src/orchestrator-v5/agent-lane/write-outcome.js';
import { RUN_INTERPRETATION_FORMAT } from '../../src/orchestrator-v5/agent-lane/provisional-view.js';
import { onceMoreOnTransportFailure } from '../../src/orchestrator-v5/agent-lane/runtime/transport-retry.js';
import { strictForTheDrafter, type CallStructuredModel } from '../../src/orchestrator-v5/agent-lane/runtime/build-model.js';
import { budgetFor, callEffortFor, type CallBudget } from '../../src/orchestrator-v5/agent-lane/model-budgets.js';
import type { CallModel } from '../../src/orchestrator-v5/agent-lane/runtime/agent-loop.js';
import { conversationPromptAlias } from '../../src/orchestrator-v5/agent-lane/runtime/prompt-identity.js';
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const jsonSha = (v: unknown) => sha(JSON.stringify(v));
// Golden baselines captured before the production edit (SYS1-RUN1); evidence dumps write only when SYS1_EVIDENCE is set.
const golden = 'tests/fixtures/sys1';
const evidence = process.env.SYS1_EVIDENCE;
const dump = (name: string, body: string): void => { if (evidence) writeFileSync(`${evidence}/${name}`, body); };
const scenario = '11111111-1111-4111-8111-111111111111';
const ctx = { scenario_id: scenario, authenticated_user_id: null, request_id: 'request-a', turn_id: 'turn-a', user_text: 'Competitor discounts strongly raise churn.', user_turn_text: 'Competitor discounts strongly raise churn.' };
const nodes = [{ id: 'competitive_pricing', kind: 'factor', label: 'Competitive pricing' }, { id: 'monthly_churn', kind: 'factor', label: 'Monthly churn' }];
function writer(options: { wait?: Promise<void>; uncertain?: boolean; receipt?: boolean } = {}) {
  let revision = 'h0'; let writes = 0; let edges: unknown[] = []; let lookups = 0;
  const proposals = new ProposalStore();
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/versions')) {
      lookups++;
      return { status: 200, json: { versions: options.receipt ? [{ version_id: 'v1', sequence: 1, creation: { kind: 'committed_mutation', source_turn_id: authorisationTurnId(pid), mutation_id: 'm1' } }] : [] } };
    }
    if (path === '/orchestrate/v2/turn') {
      writes++; await options.wait;
      if (options.uncertain) throw new TypeError('write response lost');
      edges = [(body as { event: unknown }).event]; revision = 'h1';
      return { status: 200, json: { assistant_text: 'Added.', graph_hash: revision } };
    }
    return { status: 200, json: { graph: { nodes, edges }, graph_hash: revision } };
  };
  // Opt-in belongs to the existing ordinary-turn writer; legacy callers are not migrated by this cut.
  const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { turnAuthority: true });
  let pid = '';
  const prepare = async () => {
    const p = await caps.proposeModelChange(ctx, { from_label: 'Competitive pricing', to_label: 'Monthly churn', direction: 'negative', strength: 'strong', rationale: 'competitor discounts raise churn' });
    pid = String(p.proposal_id); expect(p.ok).toBe(true); return pid;
  };
  const approve = (extra = {}) => caps.authoriseChange({ ...ctx, typed_approval_of: pid, ...extra }, { proposal_id: pid });
  return { caps, proposals, prepare, approve, writes: () => writes, lookups: () => lookups, stale: () => { revision = 'other'; }, restore: () => { revision = 'h0'; } };
}

// Scan AST nodes, not comments. Exemptions are exact file:symbol pairs and may only shrink.
const BASELINE = [
  'src/routes/admin.testing.ts:callAnthropicWithPrompt',
  'src/routes/admin.testing.ts:callOpenAIWithPrompt',
  'src/services/model-availability.ts:fetchOpenAIModels',
  'src/routes/agent-v1-turn.ts:callResearch',
  'src/routes/agent-v1-turn.ts:callStructured',
  'src/routes/agent-v1-turn.ts:callBriefReading',
];
const EXEMPTIONS = BASELINE.filter(entry => !entry.startsWith('src/routes/agent-v1-turn.ts:'));
vi.setConfig({ testTimeout: 60_000 });
function symbol(n: ts.Node): string {
  for (let p: ts.Node | undefined = n; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && p.initializer && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) return p.name.text;
  }
  return '<module>';
}
function scan(file: string, source: string): string[] {
  if (/^src\/adapters\/llm\//.test(file)) return [];
  // Every provider import, endpoint or SDK call recognised below contains one of these words.
  if (!['openai', 'anthropic', 'responses', 'messages', 'completions', 'models'].some(word => source.includes(word))) return [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const providerNames = new Set<string>(); const endpoints = new Set<string>(); const hits = new Set<string>();
  function discover(n: ts.Node) {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && /^(openai|@anthropic-ai\/sdk)(\/|$)/.test(n.moduleSpecifier.text) && !n.importClause?.isTypeOnly) {
      if (n.importClause?.name) providerNames.add(n.importClause.name.text);
      for (const e of n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings) ? n.importClause.namedBindings.elements : []) if (!e.isTypeOnly) providerNames.add(e.name.text);
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isStringLiteral(n.initializer) && /api\.(openai|anthropic)\.com/.test(n.initializer.text)) endpoints.add(n.name.text);
    ts.forEachChild(n, discover);
  }
  discover(ast);
  function visit(n: ts.Node) {
    if (ts.isNewExpression(n) && providerNames.has(n.expression.getText(ast))) hits.add(`${file}:${symbol(n)}`);
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(ast);
      if (/\.(responses|messages|chat\.completions)\.(create|stream)$/.test(callee) || /\.models\.list$/.test(callee)) hits.add(`${file}:${symbol(n)}`);
      if (/^(fetch|globalThis\.fetch)$/.test(callee) && n.arguments[0] && (endpoints.has(n.arguments[0].getText(ast)) || /api\.(openai|anthropic)\.com/.test(n.arguments[0].getText(ast)))) hits.add(`${file}:${symbol(n)}`);
      if (callee === 'require' && n.arguments[0] && /["'](openai|@anthropic-ai\/sdk)/.test(n.arguments[0].getText(ast))) hits.add(`${file}:${symbol(n)}`);
    }
    ts.forEachChild(n, visit);
  }
  visit(ast); return [...hits].sort();
}
function files(path: string): string[] { return readdirSync(path, { withFileTypes: true }).flatMap(e => e.isDirectory() && e.name !== '__tests__' ? files(`${path}/${e.name}`) : e.isFile() && e.name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(e.name) ? [`${path}/${e.name}`] : []); }
let productionFiles: string[] | undefined;

describe('SYS1 ordinary-turn authority', () => {
  it('RED approval: a missing approval cannot mutate', async () => { const w = writer(); const pid = await w.prepare(); const r = await w.caps.authoriseChange(ctx, { proposal_id: pid }); expect(r.refusal).toBe('approval_required'); expect(w.writes()).toBe(0); });
  it('RED approval: a different approval cannot mutate', async () => { const w = writer(); await w.prepare(); expect((await w.approve({ typed_approval_of: 'other' })).refusal).toBe('approval_required'); expect(w.writes()).toBe(0); });
  it('RED stale: approval does not override the current revision', async () => { const w = writer(); await w.prepare(); w.stale(); expect((await w.approve()).refusal).toBe('superseded'); expect(w.writes()).toBe(0); });
  it('RED turn: a mutating approval requires a host turn identity', async () => { const w = writer(); await w.prepare(); const r = await w.approve({ turn_id: undefined }); expect(r.refusal).toBe('turn_identity_required'); expect(w.writes()).toBe(0); });
  it('RED duplicate: concurrent retry with changed tool id commits once', async () => {
    let release!: () => void; const wait = new Promise<void>(r => { release = r; }); const w = writer({ wait }); await w.prepare();
    const a = w.approve({ tool_call_id: 'provider-id-a' }); const b = w.approve({ tool_call_id: 'provider-id-b' });
    await new Promise(r => setTimeout(r, 20)); release(); const results = await Promise.all([a, b]);
    expect(results.every(r => r.applied === true)).toBe(true); expect(w.writes()).toBe(1);
  });
  it('RED uncertain: retry reconciles against existing write receipts', async () => {
    const w = writer({ uncertain: true, receipt: true }); await w.prepare(); await w.approve().catch(() => undefined);
    const r = await w.approve({ tool_call_id: 'changed' }); expect(w.writes()).toBe(1); expect(w.lookups()).toBeGreaterThan(0); expect(r.receipts).toEqual([{ version: 1, version_id: 'v1', mutation_id: 'm1', source_turn_id: r.operation_id }]); expect(r.applied).toBe(true);
  });
  it('RED uncertain: absent receipt stays OPEN and never re-executes', async () => {
    const w = writer({ uncertain: true }); await w.prepare(); await w.approve().catch(() => undefined);
    const r = await w.approve(); expect(w.writes()).toBe(1); expect(w.lookups()).toBeGreaterThan(0);
    const status = narrateWriteOutcome('', [{ name: 'authorise_change' }], [r]).status;
    expect(status).toContain('could not be confirmed'); expect(status).not.toContain('Not saved'); expect(r.outcome).toBe('outcome_unknown');
  });
  it('RED identity: receipt recovery cannot bypass ownership or stored-content integrity', async () => {
    const w = writer({ uncertain: true, receipt: true }); const pid = await w.prepare(); await w.approve().catch(() => undefined);
    expect((await w.approve({ authenticated_user_id: 'other-user' })).refusal).toBe('not_authorised'); expect(w.lookups()).toBe(0);
    w.proposals.put({ ...w.proposals.get(pid)!, public_label: 'Unapproved replacement' });
    expect((await w.approve()).refusal).toBe('integrity_failed'); expect(w.lookups()).toBe(0); expect(w.writes()).toBe(1);
  });
  it('RED release: a refusal that wrote NOTHING does not block the same approval once its precondition holds', async () => {
    const w = writer(); await w.prepare(); w.stale();
    expect((await w.approve()).refusal).toBe('superseded'); expect(w.writes()).toBe(0);
    w.restore();
    const r = await w.approve(); expect(r.applied).toBe(true); expect(w.writes()).toBe(1);
  });
  it('RED unknown: the SAME turn stays blocked after an uncertain write; a FRESH turn is its own key', async () => {
    const w = writer({ uncertain: true }); await w.prepare(); await w.approve().catch(() => undefined);
    await w.approve(); expect(w.writes()).toBe(1);
    await w.approve({ turn_id: 'turn-fresh' }).catch(() => undefined); expect(w.writes()).toBe(2);
  });
  it('RED bounded: one proposal remembers at most MAX_EXECUTIONS_PER_PROPOSAL distinct turns', async () => {
    const content: ProposalContent = { scenario_id: scenario, user_id: null, base_graph_identity_hash: 'h0', operations: [{ op: 'add_edge', path: 'a::b', value: { from: 'a', to: 'b' } }], provenance: { authored_by: 'user_stated' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Add the link' };
    const p = createProposal(content); const store = new ProposalStore();
    let executed = 0; let reconciled = 0;
    const execute = async () => { executed++; return { mutated: true as const }; };
    const reconcile = async () => { reconciled++; return { mutated: true as const }; };
    const unknown = () => 'unknown' as const;
    for (let i = 0; i < MAX_EXECUTIONS_PER_PROPOSAL + 8; i++) await store.executeApproved(p, `t${i}`, execute, unknown, reconcile);
    executed = 0; reconciled = 0;
    await store.executeApproved(p, 't0', execute, unknown, reconcile); // evicted: its key is forgotten, so it executes again
    expect([executed, reconciled]).toEqual([1, 0]);
    executed = 0; reconciled = 0;
    await store.executeApproved(p, `t${MAX_EXECUTIONS_PER_PROPOSAL + 7}`, execute, unknown, reconcile); // retained: reconcile only
    expect([executed, reconciled]).toEqual([0, 1]);
  });
  it('RED composer words: the approval sentence must END where it ends; a cancelling, qualifying or quoting continuation is not consent', () => {
    for (const ok of ['Yes, apply it.', 'yes apply that!', ' Yes, go ahead with that ', 'yes, add it', 'Yes! record it.',
      'Yes, apply that. Tooling moderately drives velocity too, so connect it.']) expect(isComposerApprovalWords(ok), ok).toBe(true);
    for (const no of ['yes, apply it. Do not change anything; I am quoting the button.', 'yes, apply it but only the first one', 'yes, apply it. Actually, never mind.',
      'yes, apply it. Cancel that.', 'no, do not apply it', 'I said yes, apply it', 'yes, apply it\nand also delete the goal. But wait.', 'yes']) expect(isComposerApprovalWords(no), no).toBe(false);
  });
  it('RED positive: existing successful writer payload is byte identical', async () => {
    const w = writer(); await w.prepare(); const r = await w.approve();
    if (process.env.SYS1_CAPTURE_BASELINE) writeFileSync(`${golden}/writer-before.json`, JSON.stringify(r));
    expect(JSON.stringify(r)).toBe(readFileSync(`${golden}/writer-before.json`, 'utf8')); expect(w.writes()).toBe(1);
    dump('writer-after.json', JSON.stringify(r));
  });
  it('RED structural: production calls outside the adapter match a shrink-only file:symbol list', () => {
    expect(jsonSha(BASELINE), 'Frozen baseline cannot grow; only EXEMPTIONS may shrink').toBe('50c353ecf1b4d819e17e2ea5f1187d7ed2f0cf90e42cd5df6b153ea03a3f9772');
    expect(EXEMPTIONS.every(e => BASELINE.includes(e))).toBe(true);
    const hits = (productionFiles ??= files('src')).flatMap(f => scan(f, readFileSync(f, 'utf8')));
    expect(hits.filter(h => !EXEMPTIONS.includes(h))).toEqual([]);
    dump('bypass-after.json', JSON.stringify(hits, null, 2));
  });
  it('key: every approved identity component matters and canonical key order does not', () => {
    const content: ProposalContent = { scenario_id: scenario, user_id: null, base_graph_identity_hash: 'h0', operations: [{ op: 'add_edge', path: 'a::b', value: { from: 'a', to: 'b' } }], provenance: { authored_by: 'user_stated' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Add the link' };
    const p = createProposal(content); const key = approvedOperationKey(p, 'turn-a');
    expect(approvedOperationKey({ ...p, operations: [{ op: 'add_edge', path: 'a::b', value: { to: 'b', from: 'a' } }] }, 'turn-a')).toBe(key);
    for (const changed of [{ ...p, scenario_id: 'other' }, { ...p, proposal_id: 'other' }, { ...p, base_graph_identity_hash: 'other' }, { ...p, operations: [{ op: 'add_edge' as const, path: 'a::c' }] }]) expect(approvedOperationKey(changed, 'turn-a')).not.toBe(key);
    expect(approvedOperationKey(p, 'turn-b')).not.toBe(key);
  });
  it('structural scanner catches SDK, aliases, streams and direct HTTP mutants', () => {
    for (const code of ["import Renamed from 'openai'; function bad(){ new Renamed(); }", "function bad(){ client.responses.create({}); }", "function bad(){ client.messages.stream({}); }", "const ENDPOINT='https://api.openai.com/v1/responses'; function bad(){fetch(ENDPOINT);}"]) expect(scan('src/new-bypass.ts', code)).toEqual(['src/new-bypass.ts:bad']);
    expect(scan('src/new-bypass.ts', '// client.messages.create({})')).toEqual([]);
    expect([...EXEMPTIONS, 'src/new-bypass.ts:bad'].every(e => BASELINE.includes(e))).toBe(false);
  });
});

// The real ordinary-turn route is exercised with local responses only.
// `readStatedObjectionFactsFor` is a SUCCESSFUL empty read: a store without it is "unknown" to the route (S8 row 2) and the golden bytes would carry the flag.
const store = { ensureScenarioExists: vi.fn(async () => ({ user_id: null })), readCommittedTurn: vi.fn(async () => null), append: vi.fn(async () => ({ id: 'row-1' })), readStatedObjectionFactsFor: vi.fn(async () => []) };
vi.mock('../../src/orchestrator-v5/session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../src/orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
describe('SYS1 ordinary Responses transport', () => {
  let app: FastifyInstance; let routeWrites = 0; let sent: string[] = []; let script: Array<Response | Error> = [];
  const payload = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Here is where the model stands.' }] }], usage: { input_tokens: 12, output_tokens: 4 }, status: 'completed' };
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u, init) => { sent.push(String(init?.body)); const next = script.shift(); if (next instanceof Error) throw next; return next ?? new Response(JSON.stringify(payload), { status: 200 }); }));
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../src/routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => { routeWrites++; return { assistant_text: 'Added.' }; });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes, edges: [] }, graph_hash: 'h0' }));
    await app.register(agentV1TurnRoute); await app.ready();
  });
  beforeEach(() => { sent = []; script = []; routeWrites = 0; });
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  const turn = () => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: scenario, message: 'Explain the current model.' } });
  it('RED positive: exact instructions, tool definitions, schema and success bytes stay unchanged', async () => {
    // ⭐ The turn now carries the server's London day (agent-loop.ts `todayLine`, DL 15 Oct 23:08Z): ONE fixed instant, so these
    // bytes are the same on every day the suite runs. Only Date is faked; timers stay real.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-14T12:00:00Z') });
    const res = await (async () => { try { return await turn(); } finally { vi.useRealTimers(); } })(); expect(res.statusCode).toBe(200);
    const bodies = sent.map(s => JSON.parse(s));
    dump('requests-after.json', JSON.stringify(bodies, null, 2));
    const proof = bodies.map(b => ({ body: sha(JSON.stringify(b)), instructions: sha(b.instructions ?? b.input?.[0]?.content?.[0]?.text ?? ''), tools: jsonSha(b.tools ?? null), schema: jsonSha(b.text?.format?.schema ?? null) }));
    // Baseline is retained BEFORE any production edits, not manufactured from the candidate.
    const result = { proof, assistant_text: res.json().assistant_text };
    if (process.env.SYS1_CAPTURE_BASELINE) { writeFileSync(`${golden}/llm-before.json`, JSON.stringify(result, null, 2)); dump('requests-before.json', JSON.stringify(bodies, null, 2)); }
    expect(result).toEqual(JSON.parse(readFileSync(`${golden}/llm-before.json`, 'utf8')));
    dump('llm-after.json', JSON.stringify(result, null, 2));
  });
  it('RED schema: the existing interpretation schema and adapter success payload retain their bytes', async () => {
    // ⛔ CHANGED EXPECTATION (#2994 AMEND, AIE C5, rulings 1ad7f7b2…): only `confirm_step`'s description changed; the previous
    // schema with exactly that description swapped in is byte-equal to this one (3539e2bc… before).
    expect(jsonSha(RUN_INTERPRETATION_FORMAT.schema)).toBe('a7b613f54c9487e83065952b4641db4fd5c06cb7f8278fc2effd9d01c1adb08e');
    const body = { model: 'gpt-x', instructions: 'unchanged', input: [], tools: [], text: { format: RUN_INTERPRETATION_FORMAT } };
    const rows = await runWithProviderPolicy({ ...OPENAI_ONLY('schema'), request_id: 'request-schema', scenario_id: scenario, turn_id: 'turn-schema' }, async () => {
      const { r } = await adapter.postResponses(body, { detail: { ...agentRequestIdentity('agent.interpret', body), purpose: 'conversation' } });
      expect(await r.text()).toBe(JSON.stringify(payload)); return recordedProviderCalls();
    });
    expect(sent[0]).toBe(JSON.stringify(body)); expect(rows[0].usage?.raw).toEqual(payload.usage); expect(rows[0].schema_sha256).toBe(jsonSha(RUN_INTERPRETATION_FORMAT.schema));
    expect(rows[0].prompt_sha256).toBe(sha(body.instructions)); expect(rows[0]).toMatchObject({ request_id: 'request-schema', scenario_id: scenario, turn_id: 'turn-schema' });
    dump('schema-proof.json', JSON.stringify({ source_sha256_before: 'd1c490845b861860f03843c9d4e53b6f7a18dfc10cdcd411d500a8c0cac2edbf', source_sha256_after: sha(readFileSync('src/orchestrator-v5/agent-lane/provisional-view.ts', 'utf8')), schema_sha256: jsonSha(RUN_INTERPRETATION_FORMAT.schema) }, null, 2));
  });
  it('RED receipt: route records every retry, settings, usage and result under request identity', async () => {
    script = [new TypeError('fetch failed')]; const res = await turn(); expect(res.statusCode).toBe(200); const rows = res.json()._provider_calls;
    expect(rows).toHaveLength(2); expect(rows.map((r: any) => r.attempt?.outcome)).toEqual(['transport_error', 'success']);
    expect(rows[0].attempt.retry).toBe(true); expect(rows[1].attempt.retry).toBe(false);
    expect(rows[1].attempt.transport_status).toBe(200); expect(rows[1].attempt.result).toBe('completed'); expect(rows[1].attempt.response_sha256).toBe(sha(JSON.stringify(payload))); expect(rows[1].usage.raw).toEqual(payload.usage);
    expect(rows[0].request_id).toBe(rows[1].request_id); expect(typeof rows[0].request_id).toBe('string'); expect(rows[0].scenario_id).toBe(scenario);
    const b = JSON.parse(sent[1]); expect(rows[1].model).toBe(b.model); expect(rows[1].tools_sha256).toBe(jsonSha(b.tools)); expect(rows[1].settings).toEqual({ reasoning: b.reasoning, max_output_tokens: b.max_output_tokens });
    expect(sent[0]).toBe(sent[1]);
    dump('receipt-example.json', JSON.stringify(rows, null, 2));
  });
  it.each(['AbortError', 'TimeoutError', '429', '503', 'malformed'])('RED receipt: %s is recorded without retry', async kind => {
    const error = new Error('cancelled'); error.name = kind;
    script = [kind === '429' || kind === '503' ? new Response('refused', { status: Number(kind) }) : kind === 'malformed' ? new Response('invalid json', { status: 200 }) : error];
    const res = await turn(); expect(sent).toHaveLength(1);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json()._provider_calls[0].attempt?.retry).toBe(false);
    const rows = await runWithProviderPolicy(OPENAI_ONLY('contrast'), async () => {
      script = [kind === '429' || kind === '503' ? new Response('refused', { status: Number(kind) }) : kind === 'malformed' ? new Response('invalid json', { status: 200 }) : error];
      await (adapter as any).postResponses({ model: 'gpt-x', instructions: 'unchanged', tools: [] }, { detail: { ...agentRequestIdentity('agent.converse', { instructions: 'unchanged', tools: [] }), purpose: 'conversation' } }).catch(() => undefined);
      return recordedProviderCalls();
    });
    expect(rows).toHaveLength(1); expect(rows[0].attempt?.transport_status).toBe(kind === '429' || kind === '503' ? Number(kind) : kind === 'malformed' ? 200 : null); expect(rows[0].attempt?.retry).toBe(false); expect(rows[0].attempt?.outcome).toBe(kind === '429' ? 'rate_limited' : kind === '503' ? 'http_error' : kind === 'malformed' ? 'invalid_response' : kind === 'AbortError' ? 'cancelled' : 'timeout');
  });
  it('RED receipt: a received HTTP error whose body cannot be read is a retried transport failure, and its receipt says so', async () => {
    const failing = new Response(new ReadableStream({ pull(controller) { controller.error(new TypeError('body stream failed')); } }), { status: 503 });
    script = [failing]; const res = await turn();
    expect(sent).toHaveLength(2); const rows = res.json()._provider_calls;
    expect(rows[0].attempt).toMatchObject({ transport_status: 503, retry: true, retry_reason: 'transport', result: 'http_error_body_unreadable' });
    expect(rows[1].attempt.retry).toBe(false);
  });
  it('RED terminal retry: two failed attempts are receipted and the second never advertises another retry', async () => {
    script = [new TypeError('fetch failed'), new TypeError('fetch failed again')];
    const res = await turn(); expect(res.statusCode).toBe(502); expect(sent).toHaveLength(2);
    const rows = res.json()._provider_calls; expect(rows.map((r: { attempt: { retry: boolean } }) => r.attempt.retry)).toEqual([true, false]);
    expect(rows.every((r: { attempt: { transport_status: unknown; outcome: string } }) => r.attempt.transport_status === null && r.attempt.outcome === 'transport_error')).toBe(true);
  });
  it('RED provider policy: the adapter refuses before I/O under the existing policy', async () => {
    const rows = await runWithProviderPolicy({ ...OPENAI_ONLY('refused'), allowed: new Set() }, async () => {
      await expect(adapter.postResponses({ model: 'gpt-x' }, { detail: {} })).rejects.toThrow('not allowed'); return recordedProviderCalls();
    });
    expect(sent).toHaveLength(0); expect(rows[0].outcome).toBe('refused_before_network');
  });
  it('RED route authority: model-emitted approval cannot bypass the ordinary writer', async () => {
    const args = { from_label: 'Competitive pricing', to_label: 'Monthly churn', direction: 'negative', strength: 'strong', rationale: 'competitor discounts raise churn' };
    const call = (name: string, arguments_: unknown, id: string) => new Response(JSON.stringify({ output: [{ type: 'function_call', name, call_id: id, arguments: JSON.stringify(arguments_) }] }), { status: 200 });
    script = [call('propose_model_change', args, 'provider-a'), call('authorise_change', { proposal_id: 'prop_101a74076f0180f73fb32e03b0aadc28' }, 'provider-b')];
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: scenario, message: ctx.user_turn_text } });
    expect(res.statusCode).toBe(200); expect(routeWrites).toBe(0);
    script = [call('authorise_change', { proposal_id: 'prop_101a74076f0180f73fb32e03b0aadc28' }, 'provider-changed-id')];
    const next = await turn();
    expect(next.statusCode).toBe(200); expect(next.json()._agent.tool_calls.find((c: { name: string }) => c.name === 'authorise_change')?.refusal).toBe('approval_required'); expect(routeWrites).toBe(0);
  });

  it('RED carrier fallback: the existing breakpoint fallback has a per-attempt retry receipt', async () => {
    script = [new Response(JSON.stringify({ error: { param: 'input[0].content[0].prompt_cache_breakpoint' } }), { status: 400 })];
    const res = await turn(); expect(res.statusCode).toBe(200); expect(sent).toHaveLength(2);
    const rows = res.json()._provider_calls;
    expect(rows[0].attempt.retry).toBe(true); expect(rows[0].attempt.retry_reason).toBe('instructions_carrier_fallback'); expect(rows[1].attempt.retry).toBe(false);
    expect(rows[0].prompt_sha256).toBe(rows[1].prompt_sha256); expect(rows[0].tools_sha256).toBe(rows[1].tools_sha256);
  });

});

// S1 task 2: real route, fixture-only provider and storage boundaries. Golden capture precedes transport edits.
const residualSites = ['callResearch', 'callStructured', 'callBriefReading'] as const;
type ResidualSite = typeof residualSites[number];
type SiteGolden = { body: string; instructions: string; tools: string; schema: string; consumed: string };
describe('S1T2 residual Responses sites', () => {
  let app: FastifyInstance;
  let active: ResidualSite;
  let failure: '429' | '503' | 'transport' | 'terminal' | 'TimeoutError' | 'undiciTimeout' | 'unreadableHTTP' | 'malformed' | undefined;
  let attempts: string[] = [];
  let consumed: string[] = [];
  let sequence = 0;
  let discovery = false;
  const captured: Partial<Record<ResidualSite, SiteGolden[]>> = {};
  const usage = { input_tokens: 23, output_tokens: 7 };
  const brief = 'Reach 90% delivery reliability within 6 months. Hire a tech lead or hire two developers. Team capacity is 5 people.';
  const query = 'typical churn after a SaaS price rise of about 20%';
  const candidate = {
    goal: { metric: 'Delivery reliability', operator: '>=', value: 90, unit: '%', horizon_months: 6, provenance: 'explicit' }, constraints: [],
    options: [{ label: 'Hire a tech lead', provenance: 'explicit', interventions: [] }],
    factors: [{ label: 'Team capacity', role: 'controllable', baseline_known: true, baseline_value: 5, unit: 'people', provenance: 'explicit' }],
    risks: [], outcomes: [{ label: 'Delivery reliability', provenance: 'inferred' }],
    links: [{ from: 'Team capacity', to: 'Delivery reliability', direction: 'positive', provenance: 'inferred' }], unknowns: [],
  };
  const nativeResearch = (JSON.parse(readFileSync('src/orchestrator-v5/agent-lane/__tests__/fixtures/native-research-ne02.json', 'utf8')) as { response: Record<string, unknown> }).response;
  const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }], status: 'completed', usage });
  const responseFor = (site: ResidualSite) => site === 'callResearch' ? { ...nativeResearch, usage }
    : say(site === 'callStructured' ? JSON.stringify(candidate) : JSON.stringify({ goal: '90% delivery reliability', limits: [], options: ['Hire a tech lead', 'hire two developers'], build: false }));
  beforeAll(async () => {
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    // Observe exactly what the EXISTING caller consumes, without changing its execution.
    const makeCaps = capabilitiesModule.createAgentCapabilities;
    vi.spyOn(capabilitiesModule, 'createAgentCapabilities').mockImplementation((...args) => {
      const call = args[2];
      if (call) args[2] = async (...input) => { const result = await call(...input); consumed.push(JSON.stringify(result)); return result; };
      return makeCaps(...args);
    });
    const readBrief = briefModule.readBrief;
    vi.spyOn(briefModule, 'readBrief').mockImplementation((message, call) => readBrief(message, async input => {
      const result = await call(input); consumed.push(JSON.stringify(result)); return result;
    }));
    const readResearch = researchModule.readResearchResponse;
    vi.spyOn(researchModule, 'readResearchResponse').mockImplementation(input => { consumed.push(JSON.stringify(input)); return readResearch(input); });
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const bytes = String(init?.body); const body = JSON.parse(bytes);
      const site: ResidualSite | undefined = body.text?.format?.name === 'brief_spans' ? 'callBriefReading'
        : body.text?.format?.name === 'whole_candidate' ? 'callStructured'
        : body.tools?.some((t: { type?: string }) => t.type === 'web_search') ? 'callResearch' : undefined;
      if (site) {
        expect(site).toBe(active); attempts.push(bytes);
        if (failure === '429' || failure === '503') return new Response('fixture refusal', { status: Number(failure) });
        if (failure === 'terminal' || failure === 'transport' && attempts.length === 1) throw new TypeError('fetch failed');
        if (failure === 'TimeoutError') { const error = new Error('fixture timeout'); error.name = 'TimeoutError'; throw error; }
        if (failure === 'undiciTimeout') throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } });
        if (failure === 'unreadableHTTP') return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('fixture body lost')); } }), { status: 503 });
        if (failure === 'malformed') return new Response('{broken', { status: 200 });
        return new Response(JSON.stringify(responseFor(site)), { status: 200 });
      }
      if (!discovery && body.max_output_tokens !== 16 && active !== 'callBriefReading') {
        discovery = true;
        const name = active === 'callResearch' ? 'offer_public_research' : 'build_model_from_brief';
        const args = active === 'callResearch' ? { query } : { brief };
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name, call_id: 'site-discovery', arguments: JSON.stringify(args) }] }), { status: 200 });
      }
      return new Response(JSON.stringify(say('Here is where the model stands.')), { status: 200 });
    }));
    const { agentV1TurnRoute } = await import('../../src/routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: active === 'callResearch' ? nodes : [], edges: [] }, graph_hash: active === 'callResearch' ? 'h0' : null }));
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [] }));
    app.post('/assist/v1/scenarios/:id/graph/register', async () => ({ registered: true, graph_hash: 'h1' }));
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'Fixture state.', blocks: [], suggested_actions: [], insights: [] }));
    await app.register(agentV1TurnRoute); await app.ready();
  });
  afterAll(async () => { await app.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { attempts = []; consumed = []; discovery = false; failure = undefined; });
  const drive = async (site: ResidualSite, refuse = false) => {
    active = site;
    const sid = `22222222-2222-4222-8222-${String(++sequence).padStart(12, '0')}`;
    const inject = (extra: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: sid, message: site === 'callResearch' ? 'What churn do SaaS firms see after a price rise?' : brief, ...extra,
    } });
    if (site === 'callResearch') { await inject(); attempts = []; consumed = []; }
    const originalPolicy = policyModule.runWithProviderPolicy;
    const originalAssert = policyModule.assertProviderAllowed;
    // Refuse the target site only: construction's preceding conversation must still reach its tool.
    const policySpy = refuse ? vi.spyOn(policyModule, 'assertProviderAllowed').mockImplementation((provider, at, detail) => {
      if (at !== `agent-v1-turn.${site}`) return originalAssert(provider, at, detail);
      const policy = policyModule.currentProviderPolicy();
      if (policy === undefined) throw new Error('Expected the real route provider policy');
      return originalPolicy({ ...policy, allowed: new Set() }, () => originalAssert(provider, at, detail));
    }) : undefined;
    try {
      const chip = researchModule.researchChipFor(query)!;
      const response = site === 'callResearch' ? await inject({ message: chip.message, source: 'chip_click', chip: { id: chip.id } })
        : site === 'callBriefReading' ? await runWithStageStream(() => undefined, async () => await inject()) : await inject();
      return { response, sid, rows: (response.json()._provider_calls ?? []) as policyModule.GenerativeCall[] };
    } finally { policySpy?.mockRestore(); }
  };
  it.each(residualSites)('%s happy-path bytes equal the BEFORE golden', async site => {
    const { response } = await drive(site);
    // A build sends the drafter's structured call, then the two draft-time widening passes (risks, options): restored (Paul
    // #94 6166259456) after E6 parked them; the drafter's entry is byte-unchanged.
    expect(response.statusCode, response.body).toBe(200); expect(attempts).toHaveLength(site === 'callStructured' ? 3 : 1); expect(consumed).toHaveLength(attempts.length);
    const proof = attempts.map((bytes, i) => {
      const body = JSON.parse(bytes);
      return { body: sha(bytes), instructions: sha(body.instructions), tools: jsonSha(body.tools ?? null), schema: jsonSha(body.text?.format?.schema ?? null), consumed: consumed[i] };
    });
    dump(`sites-${site}-after.json`, JSON.stringify(attempts.map(bytes => JSON.parse(bytes)), null, 2));
    if (process.env.SYS1_CAPTURE_SITES === '1') {
      captured[site] = proof;
      if (residualSites.every(s => captured[s])) writeFileSync(`${golden}/sites-before.json`, JSON.stringify(captured, null, 2) + '\n');
    } else expect(proof).toEqual(JSON.parse(readFileSync(`${golden}/sites-before.json`, 'utf8'))[site]);
  });
  it.each(residualSites)('%s has one host-bound physical success receipt and usage', async site => {
    const { rows, sid } = await drive(site);
    const calls = rows.filter(r => r.site === `agent-v1-turn.${site}`);
    expect(calls).toHaveLength(attempts.length); expect(calls).toHaveLength(site === 'callStructured' ? 3 : 1);
    calls.forEach((call, i) => {
      const body = JSON.parse(attempts[i]);
      expect(call).toMatchObject({ request_id: expect.any(String), scenario_id: sid,
        attempt: { outcome: 'success', transport_status: 200, retry: false, response_sha256: sha(JSON.stringify(responseFor(site))) }, usage: { raw: usage } });
      expect(call.settings).toEqual(Object.fromEntries(['reasoning', 'max_output_tokens', 'tool_choice', 'temperature', 'max_tool_calls'].filter(k => body[k] !== undefined).map(k => [k, body[k]])));
    });
  });
  it.each(residualSites)('%s provider policy refuses before network', async site => {
    const { rows } = await drive(site, true);
    expect(attempts).toHaveLength(0); expect(consumed).toHaveLength(0);
    const calls = rows.filter(r => r.site === `agent-v1-turn.${site}`);
    expect(calls.length).toBeGreaterThan(0); expect(calls.every(r => r.outcome === 'refused_before_network' && r.attempt === undefined)).toBe(true);
  });
  for (const site of residualSites) {
    it.each(['429', '503', 'transport', 'terminal', 'TimeoutError', 'undiciTimeout', 'unreadableHTTP', 'malformed'] as const)(`${site} %s is receipted with the existing attempt count`, async kind => {
      failure = kind;
      const { rows } = await drive(site);
      const calls = rows.filter(r => r.site === `agent-v1-turn.${site}`);
      const retried = site === 'callStructured' && ['transport', 'terminal', 'malformed', 'unreadableHTTP'].includes(kind);
      // A transport retry succeeds, so the build goes on to the two widening passes; every other failure ends the build.
      expect(attempts).toHaveLength(retried ? kind === 'transport' ? 4 : 2 : 1); expect(calls).toHaveLength(attempts.length);
      const expectedOutcome = kind === '429' ? 'rate_limited' : kind === '503' || kind === 'unreadableHTTP' ? 'http_error' : kind === 'TimeoutError' || kind === 'undiciTimeout' ? 'timeout' : kind === 'malformed' ? 'invalid_response' : 'transport_error';
      expect(calls[0].attempt).toMatchObject({ outcome: expectedOutcome, transport_status: kind === '429' || kind === '503' ? Number(kind) : kind === 'unreadableHTTP' ? 503 : kind === 'malformed' ? 200 : null, retry: retried });
      if (kind === 'unreadableHTTP') expect(calls[0].attempt?.result).toBe(site === 'callBriefReading' ? 'http_error' : 'http_error_body_unreadable');
      if (retried) expect(calls[1].attempt).toMatchObject({ outcome: kind === 'transport' ? 'success' : expectedOutcome, retry: false });
      if (kind !== 'transport' || !retried) expect(consumed).toHaveLength((kind === 'TimeoutError' || kind === 'undiciTimeout') && site === 'callStructured' ? 1 : 0);
    });
  }
});

// Extract the production closures, not a copy of their retry/parse/deadline logic.
function routeContract<T>(name: string, dependencies: Record<string, unknown>): T {
  const source = ts.createSourceFile('agent-v1-turn.ts', readFileSync('src/routes/agent-v1-turn.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  let expression: string | undefined;
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) expression = node.initializer?.getText(source);
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(source).replace(/^export\s+/, '');
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (expression === undefined) throw new Error(`Missing production closure ${name}`);
  const script = ts.transpileModule(`const extracted = ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('dependencies', `let { ${Object.keys(dependencies).join(', ')} } = dependencies; ${script}; return extracted;`)(dependencies) as T;
}

describe('S1T2 R2 actual resend receipts', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  type Site = 'callStructured' | 'callModel';
  const contractDependencies = () => ({
    ...policyModule, postResponses: adapter.postResponses, agentRequestIdentity, onceMoreOnTransportFailure,
    strictForTheDrafter, CONSTRUCTION_TIMEOUT_REASON: 'construction_timeout',
    isConstructionTimeout: routeContract<(err: unknown) => boolean>('isConstructionTimeout', {}),
    log: { warn: vi.fn(), error: vi.fn() }, conversationPromptAlias, callEffortFor,
    forcedToolOf: routeContract<(req: unknown) => string | undefined>('forcedToolOf', {}),
    withInstructionsBreakpoint: routeContract<(body: Record<string, unknown>) => Record<string, unknown>>('withInstructionsBreakpoint', {}),
    refusesInstructionsBreakpoint: routeContract<(status: number, text: string) => boolean>('refusesInstructionsBreakpoint', {}),
    instructionsBreakpointRefused: false,
    withTransportRetry: routeContract<(req: unknown, call: () => Promise<unknown>) => Promise<unknown>>('withTransportRetry', { onceMoreOnTransportFailure }),
  });
  const drive = async (site: Site, first: 'null' | '{}' | 'transport' | '{broken', expired = false, deadlined = false, revoke = false) => {
    let now = 1_000;
    const deadline = 2_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const physical: policyModule.GenerativeCall[] = [];
    const policy = { ...OPENAI_ONLY('receipt-contract'), allowed: new Set<policyModule.LlmProvider>(['openai']), request_id: `contract-${site}-${first}-${expired}-${deadlined}`, scenario_id: scenario };
    vi.stubGlobal('fetch', vi.fn(async () => {
      const receipt = policyModule.currentProviderPolicy()!.calls.at(-1)!;
      physical.push(receipt); // Identity of the ledger row guarded immediately before THIS physical send.
      if (physical.length === 1 && first === 'transport') {
        if (expired) now = deadline;
        if (revoke) policy.allowed.delete('openai');
        throw new TypeError('fetch failed');
      }
      return new Response(physical.length === 1 ? first : '{}', { status: 200 });
    }));
    const dependencies = contractDependencies();
    let result: unknown; let error: unknown;
    await runWithProviderPolicy(policy, async () => {
      try {
        result = site === 'callStructured'
          ? await routeContract<CallStructuredModel>('callStructured', dependencies)({ model: 'gpt-x', instructions: 'fixture', input: 'fixture', max_output_tokens: 100, schema: { type: 'object', properties: {}, additionalProperties: false } }, deadline)
          : await routeContract<(budget: CallBudget) => CallModel>('callModelFor', dependencies)(budgetFor('gpt-6.1-sol', 'conversation'))({ instructions: 'fixture', input: [], tools: [], max_output_tokens: 100, ...(deadlined ? { deadline_ms: deadline - now } : {}) });
      } catch (err) { error = err; }
    });
    return { physical, policy, result, error };
  };
  const assertFirst = (run: Awaited<ReturnType<typeof drive>>, site: Site, count: number, retry: boolean): void => {
    expect(run.physical).toHaveLength(count); expect(run.policy.calls).toHaveLength(count);
    const first = run.physical[0];
    expect(first).toBe(run.policy.calls[0]);
    expect(first).toMatchObject({ site: `agent-v1-turn.${site}`, request_id: run.policy.request_id, scenario_id: scenario });
    expect(first.attempt?.retry, 'receipt of physical request #1').toBe(retry);
    expect(first.attempt?.retry_reason, 'reason on physical request #1').toBe(retry ? 'transport' : undefined);
    if (count > 1) { expect(run.physical[1].attempt?.retry).toBe(false); expect(run.physical[1].attempt?.retry_reason).toBeUndefined(); }
  };
  for (const site of ['callStructured', 'callModel'] as const) {
    it(`${site} F1 negative: null then object marks request #1 when request #2 is sent`, async () => {
      const run = await drive(site, 'null'); assertFirst(run, site, 2, true); expect(run.error).toBeUndefined();
    });
    it(`${site} F1 control: object makes one request without a retry`, async () => {
      const run = await drive(site, '{}'); assertFirst(run, site, 1, false); expect(run.error).toBeUndefined();
    });
  }
  it('callStructured F1 malformed: original JSON error still resends', async () => {
    const run = await drive('callStructured', '{broken'); assertFirst(run, 'callStructured', 2, true); expect(run.error).toBeUndefined();
  });
  it('callStructured F2 negative: expired retry deadline leaves request #1 unmarked', async () => {
    const run = await drive('callStructured', 'transport', true); assertFirst(run, 'callStructured', 1, false);
    expect(run.result).toEqual({ text: '', status: 'incomplete', incomplete_reason: 'construction_timeout' }); expect(run.error).toBeUndefined();
  });
  it('callStructured F2 control: budget left sends request #2 and marks request #1', async () => {
    const run = await drive('callStructured', 'transport'); assertFirst(run, 'callStructured', 2, true); expect(run.error).toBeUndefined();
  });
  it('callModel F2 deadlined: no retry even when fetch consumes the remaining deadline', async () => {
    const run = await drive('callModel', 'transport', true, true); assertFirst(run, 'callModel', 1, false); expect(run.error).toBeInstanceOf(TypeError);
  });
  it('callModel F2 control: ordinary transport retry has no absolute deadline guard', async () => {
    const run = await drive('callModel', 'transport', true); assertFirst(run, 'callModel', 2, true); expect(run.error).toBeUndefined();
  });
  for (const site of ['callStructured', 'callModel'] as const) {
    it(`R3 ${site} admission negative: revoked permission cannot mark request #1 as retried`, async () => {
      const run = await drive(site, 'transport', false, false, true);
      dump(`r3-${site}-admission-negative.json`, JSON.stringify({ physical: run.physical.length, rows: run.policy.calls }));
      expect(run.physical).toHaveLength(1); expect(run.policy.calls).toHaveLength(2);
      expect(run.physical[0]).toBe(run.policy.calls[0]);
      expect(run.physical[0].attempt?.retry, 'request #1 after refused retry').toBe(false);
      expect(run.physical[0].attempt?.retry_reason).toBeUndefined();
      expect(run.policy.calls[1]).toMatchObject({ site: `agent-v1-turn.${site}`, outcome: 'refused_before_network', request_id: run.policy.request_id });
      expect(run.policy.calls[1].attempt).toBeUndefined(); expect(run.error).toBeInstanceOf(policyModule.ForbiddenProviderError);
    });
    it(`R3 ${site} admission control: kept permission marks the admitted retry`, async () => {
      const run = await drive(site, 'transport');
      dump(`r3-${site}-admission-control.json`, JSON.stringify({ physical: run.physical.length, rows: run.policy.calls }));
      assertFirst(run, site, 2, true); expect(run.error).toBeUndefined();
    });
  }
  it.each([true, false])('R3 construction overlap=%s keeps A and B physical receipt identities', async overlap => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const policy = { ...OPENAI_ONLY('overlap-contract'), request_id: 'overlap', scenario_id: scenario };
    const physical: Array<{ invocation: string; row: policyModule.GenerativeCall }> = [];
    let rejectA!: (error: Error) => void;
    const blockedA = new Promise<Response>((_resolve, reject) => { rejectA = reject; });
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const invocation = JSON.parse(String(init?.body)).input;
      const row = policyModule.currentProviderPolicy()!.calls.at(-1)!;
      physical.push({ invocation, row });
      if (physical.length === 1) return blockedA;
      return new Response('{}', { status: 200 });
    }));
    // One extracted function, two invocations: handles must belong to each invocation, not the shared site/function.
    const call = routeContract<CallStructuredModel>('callStructured', contractDependencies());
    const request = { model: 'gpt-x', instructions: 'fixture', max_output_tokens: 100, schema: { type: 'object', properties: {}, additionalProperties: false } };
    await runWithProviderPolicy(policy, async () => {
      const a = call({ ...request, input: 'A' }, 2_000);
      expect(physical).toHaveLength(1);
      if (overlap) await call({ ...request, input: 'B' }, 2_000);
      rejectA(new TypeError('fetch failed'));
      await a;
    });
    dump(`r3-overlap-${overlap}.json`, JSON.stringify({ physical: physical.length, rows: physical }));
    expect(physical).toHaveLength(overlap ? 3 : 2); expect(policy.calls).toHaveLength(physical.length);
    physical.forEach(({ row }, i) => expect(row).toBe(policy.calls[i]));
    const a = physical.filter(p => p.invocation === 'A').map(p => p.row);
    expect(a).toHaveLength(2);
    expect(a[0].attempt?.retry, 'A physical request #1').toBe(true); expect(a[0].attempt?.retry_reason).toBe('transport');
    expect(a[1].attempt?.retry).toBe(false); expect(a[1].attempt?.retry_reason).toBeUndefined();
    if (overlap) {
      const b = physical.find(p => p.invocation === 'B')!.row;
      expect(b.attempt).toMatchObject({ outcome: 'success', retry: false }); expect(b.attempt?.retry_reason).toBeUndefined();
    }
  });
  it('R3 callModel carrier fallback inside a transport retry keeps its own reason', async () => {
    const physical: policyModule.GenerativeCall[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => {
      physical.push(policyModule.currentProviderPolicy()!.calls.at(-1)!);
      if (physical.length === 1) throw new TypeError('fetch failed');
      if (physical.length === 2) return new Response(JSON.stringify({ error: { param: 'input[0].content[0].prompt_cache_breakpoint' } }), { status: 400 });
      return new Response('{}', { status: 200 });
    }));
    const call = routeContract<(budget: CallBudget) => CallModel>('callModelFor', contractDependencies())(budgetFor('gpt-6.1-sol', 'conversation'));
    await runWithProviderPolicy(OPENAI_ONLY('carrier-after-transport'), () => call({ instructions: 'fixture', input: [], tools: [], max_output_tokens: 100 }));
    expect(physical).toHaveLength(3);
    expect(physical.map(p => [p.attempt?.retry, p.attempt?.retry_reason])).toEqual([[true, 'transport'], [true, 'instructions_carrier_fallback'], [false, undefined]]);
  });
  it('adapter absent option records false; explicit legacy retry prediction retains its semantics', async () => {
    for (const kind of ['transport', 'unreadableHTTP', 'invalidJSON'] as const) for (const optIn of [false, true]) {
      const physical: policyModule.GenerativeCall[] = [];
      vi.stubGlobal('fetch', vi.fn(async () => {
        physical.push(policyModule.currentProviderPolicy()!.calls.at(-1)!);
        if (kind === 'transport') throw new TypeError('fetch failed');
        if (kind === 'unreadableHTTP') return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('body lost')); } }), { status: 503 });
        return new Response('{broken', { status: 200 });
      }));
      await runWithProviderPolicy(OPENAI_ONLY('adapter-options'), async () => {
        try { await adapter.postResponses({ model: 'gpt-x' }, { detail: {}, preserveResponseErrors: true, ...(optIn ? { retryOnTransportFailure: true } : {}) }); } catch { /* The transport error remains the caller's. */ }
        expect(physical).toHaveLength(1);
        expect(physical[0].attempt?.retry).toBe(optIn); expect(physical[0].attempt?.retry_reason).toBe(optIn ? 'transport' : undefined);
      });
    }
  });
});
