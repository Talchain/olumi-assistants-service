import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { createAgentCapabilities, authorisationTurnId, type InternalDispatch } from '../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { ProposalStore, createProposal, approvedOperationKey, MAX_EXECUTIONS_PER_PROPOSAL, type ProposalContent } from '../../src/orchestrator-v5/agent-lane/proposal.js';
import { isComposerApprovalWords } from '../../src/orchestrator-v5/agent-lane/composer-approval-words.js';
import * as adapter from '../../src/adapters/llm/openai.js';
import { OPENAI_ONLY, recordedProviderCalls, runWithProviderPolicy } from '../../src/adapters/llm/provider-policy.js';
import { agentRequestIdentity } from '../../src/orchestrator-v5/agent-lane/runtime/prompt-identity.js';
import { narrateWriteOutcome } from '../../src/orchestrator-v5/agent-lane/write-outcome.js';
import { RUN_INTERPRETATION_FORMAT } from '../../src/orchestrator-v5/agent-lane/provisional-view.js';
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
const EXEMPTIONS = [...BASELINE];
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
  it('RED composer words: the WHOLE message must be the approval (anchored); quoted, negated or qualified text is not consent', () => {
    for (const ok of ['Yes, apply it.', 'yes apply that!', ' Yes, go ahead with that ', 'yes, add it', 'Yes! record it.']) expect(isComposerApprovalWords(ok), ok).toBe(true);
    for (const no of ['yes, apply it. Do not change anything; I am quoting the button.', 'yes, apply it but only the first one', 'no, do not apply it', 'I said yes, apply it', 'yes, apply it\nand also delete the goal', 'yes']) expect(isComposerApprovalWords(no), no).toBe(false);
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
const store = { ensureScenarioExists: vi.fn(async () => ({ user_id: null })), readCommittedTurn: vi.fn(async () => null), append: vi.fn(async () => ({ id: 'row-1' })) };
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
    const res = await turn(); expect(res.statusCode).toBe(200);
    const bodies = sent.map(s => JSON.parse(s));
    const proof = bodies.map(b => ({ body: sha(JSON.stringify(b)), instructions: sha(b.instructions ?? b.input?.[0]?.content?.[0]?.text ?? ''), tools: jsonSha(b.tools ?? null), schema: jsonSha(b.text?.format?.schema ?? null) }));
    // Baseline is retained BEFORE any production edits, not manufactured from the candidate.
    const result = { proof, assistant_text: res.json().assistant_text };
    if (process.env.SYS1_CAPTURE_BASELINE) { writeFileSync(`${golden}/llm-before.json`, JSON.stringify(result, null, 2)); dump('requests-before.json', JSON.stringify(bodies, null, 2)); }
    expect(result).toEqual(JSON.parse(readFileSync(`${golden}/llm-before.json`, 'utf8')));
    dump('llm-after.json', JSON.stringify(result, null, 2));
  });
  it('RED schema: the existing interpretation schema and adapter success payload retain their bytes', async () => {
    expect(jsonSha(RUN_INTERPRETATION_FORMAT.schema)).toBe('3539e2bc2bf7963a295ae854719e99354383cbc93880efc1c7938f46f7c9bf83');
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
