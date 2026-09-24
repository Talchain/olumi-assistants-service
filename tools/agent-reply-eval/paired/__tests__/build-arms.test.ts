/**
 * PROOF FOR THE PAIRED-EVAL PROMPT ARMS (Docs/evals/agent-reply/paired/57f903c/arms).
 *
 * 1. M is the SERVED text: the real route (src/routes/agent-v1-turn.ts, working tree asserted equal to
 *    served 57f903c) is booted in-process and the `instructions` it hands to the OpenAI Responses call are
 *    captured from the fetch boundary — an ordinary Agent turn and an explicit Run (fast path 3). Their
 *    sha256 must equal the arm files. This is independent of the generator's AST evaluation.
 * 2. Discriminating mutants: the preview-mode evaluation and a one-entry mutation do NOT match the capture.
 * 3. C1 differs from M ONLY at the documented entries, each replaced by a v2 `+` sentence (evaluated here
 *    independently of the generator).
 * 4. FP3 stacks are agent + "\n\n" + INTERPRET_ONLY_CONSTRAINT + "\n\n" + v0.2 | v0.3, and v0.3 is the
 *    PR #1791 module's own `instructions` / composition.
 *
 * No network: fetch is replaced by a stub that refuses every host but api.openai.com and never sends.
 * No Anthropic credentials may be present in this process.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARMS_DIR, REPO_ROOT, SERVED_SHA, SERVED_ROUTE_PATH, SOURCES_DIR, V03_BLOB, V02_SHA256_PREFIX,
  evaluateServedPrompts, gitBlobId,
} from '../build-arms.js';

// ── HARD RULE: no Anthropic credential in this process (deleted, then asserted absent).
for (const k of Object.keys(process.env)) {
  if (/ANTHROPIC/i.test(k) || k === 'CLAUDE_API_KEY') delete process.env[k];
}

const { store } = vi.hoisted(() => ({
  store: {
    ensureScenarioExists: async () => ({ user_id: null }),
    readCommittedTurn: async () => null,
    append: async () => ({ id: 'row-1' }),
  },
}));
vi.mock('../../../../src/orchestrator-v5/session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../../src/orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const SCENARIO = '00000000-0000-4000-8000-000000000112';
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const arm = (f: string): string => readFileSync(join(ARMS_DIR, f), 'utf8');
const git = (args: string[]): string => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
type Entry = { index: number; kind: string; text: string };
type Record_ = { id: string; served_index: number; before_served: string; after: string; relation: string };

describe('paired-eval prompt arms at served 57f903c', () => {
  let app: FastifyInstance;
  const guard: { url: string; decision: 'allowed (stubbed, nothing sent)' | 'blocked' }[] = [];
  const calls: { url: string; authorization: string; body: Record<string, unknown> }[] = [];
  let routeExports: { INTERPRET_ONLY_CONSTRAINT: string; INTERPRETER_V02_BANKED: string };
  let ordinary: Record<string, unknown>;
  let fp3: Record<string, unknown>;

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { body?: unknown; headers?: Record<string, string> }) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String((input as { url?: unknown }).url);
      if (!url.startsWith('https://api.openai.com/')) {
        guard.push({ url, decision: 'blocked' });
        throw new Error(`network guard: ${url} is not https://api.openai.com/ — refused before sending`);
      }
      guard.push({ url, decision: 'allowed (stubbed, nothing sent)' });
      const auth = String(init?.headers?.['authorization'] ?? '');
      calls.push({ url, authorization: auth.length > 0 ? 'Bearer [REDACTED]' : '', body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      return new Response(JSON.stringify({
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'In this model the comparison is provisional.' }] }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const mod = await import('../../../../src/routes/agent-v1-turn.js');
    routeExports = mod as unknown as typeof routeExports;
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: 'h1',
      blocks: [{ type: 'analysis_result', data: { marker: 'the-run' } }], analysis_ready: { status: 'ready', options: [], blockers: [] },
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Velocity' }, { id: 'f', kind: 'factor', label: 'Capacity' }], edges: [{ from: 'f', to: 'g' }] },
      graph_hash: 'h1',
      analysis_state: { run_state: { kind: 'complete_current' }, leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } },
    }));
    await app.register(mod.agentV1TurnRoute);
    await app.ready();

    // An ordinary Agent turn (the path construction/approval/conversation turns take).
    calls.length = 0;
    const r1 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'What does the model say about capacity?' } });
    expect(r1.statusCode).toBe(200);
    expect(calls.length, 'the ordinary turn made at least one model call').toBeGreaterThanOrEqual(1);
    ordinary = calls[0]!.body;
    // An explicit Run: the UI's typed chip → fast path 3, one interpreting call.
    calls.length = 0;
    const r2 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      // The served explicit-Run request shape (captures/57f903c-pricing/explicit-run.request.json, minus turn_id).
      kind: 'message', scenario_id: SCENARIO, stage: 'frame', turn_class: 'decide', message: 'Run analysis', source: 'chip_click', chip: { action_type: 'run_analysis' },
    } });
    expect(r2.statusCode).toBe(200);
    expect(calls, 'fast path 3 makes exactly ONE model call').toHaveLength(1);
    fp3 = calls[0]!.body;
  }, 300_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('guards held: no Anthropic credential in the process; every fetch went to api.openai.com (stubbed); none blocked', () => {
    expect(Object.keys(process.env).filter((k) => /ANTHROPIC/i.test(k) || k === 'CLAUDE_API_KEY')).toEqual([]);
    expect(guard.length).toBeGreaterThanOrEqual(2);
    expect(guard.filter((g) => g.decision === 'blocked')).toEqual([]);
    expect(new Set(guard.map((g) => g.url))).toEqual(new Set(['https://api.openai.com/v1/responses']));
  });

  it('the in-process route IS served 57f903c: HEAD and src/ are unmodified against it', () => {
    expect(SERVED_SHA).toMatch(/^[0-9a-f]{40}$/);
    expect(git(['rev-parse', 'HEAD']).trim()).toBe(SERVED_SHA);
    expect(git(['status', '--porcelain', '--', 'src']), 'no modified or untracked file under src/').toBe('');
    expect(git(['diff', '--stat', SERVED_SHA, '--', 'src']), 'no committed drift from the served commit').toBe('');
  });

  it('M_agent.txt is byte-identical to the instructions the served route sends on an ordinary Agent turn', () => {
    expect(ordinary['tool_choice'], 'the ordinary Agent call, not the interpreting one').toBeUndefined();
    expect(ordinary['model']).toBe('gpt-5.6-terra');
    const captured = String(ordinary['instructions']);
    expect(sha(arm('M_agent.txt'))).toBe(sha(captured));
    expect(arm('M_agent.txt.sha256')).toBe(`${sha(captured)}  M_agent.txt\n`);
  });

  it('M_fp3_stack.txt is byte-identical to the explicit-Run call, and is M_agent + INTERPRET_ONLY + v0.2', () => {
    expect(fp3['tool_choice']).toBe('none');
    expect(fp3['tools']).toEqual([]);
    const captured = String(fp3['instructions']);
    expect(sha(arm('M_fp3_stack.txt'))).toBe(sha(captured));
    expect(captured).toBe(`${arm('M_agent.txt')}\n\n${arm('M_interpret_only.txt')}\n\n${arm('M_v02.txt')}`);
    expect(arm('M_interpret_only.txt')).toBe(routeExports.INTERPRET_ONLY_CONSTRAINT);
    expect(arm('M_v02.txt')).toBe(routeExports.INTERPRETER_V02_BANKED);
    expect(sha(arm('M_v02.txt')).startsWith(V02_SHA256_PREFIX)).toBe(true);
  });

  it('the generator\'s evaluation matches the capture in FULL mode, and discriminating mutants do not', () => {
    const source = git(['show', `${SERVED_SHA}:${SERVED_ROUTE_PATH}`]);
    const captured = sha(String(ordinary['instructions']));
    const full = evaluateServedPrompts(source, 'full');
    expect(sha(full.agent)).toBe(captured);
    // Mutant 1: the preview-mode text differs from what the served route sends.
    const preview = evaluateServedPrompts(source, 'preview');
    expect(sha(preview.agent)).not.toBe(captured);
    expect(preview.entries.filter((e, i) => e.text !== full.entries[i]!.text).map((e) => e.kind)).toEqual(['MUTATION_INSTRUCTION']);
    // Mutant 2: dropping any single entry breaks the match.
    const dropped = full.entries.filter((e) => e.index !== 30).map((e) => e.text).join(' ');
    expect(sha(dropped)).not.toBe(captured);
    // The persisted entry list is the evaluated one.
    expect(JSON.parse(arm('M_agent.entries.json'))).toEqual(full.entries);
  });

  it('C1 differs from M ONLY at the documented entries, each replaced by a v2 "+" sentence', () => {
    const m = JSON.parse(arm('M_agent.entries.json')) as Entry[];
    const c1 = JSON.parse(arm('C1_agent.entries.json')) as Entry[];
    const t = JSON.parse(arm('TRANSPOSITIONS.json')) as { transposed: Record_[]; not_transposed: { id: string }[] };
    expect(c1).toHaveLength(m.length);
    expect(m.map((e) => e.text).join(' ')).toBe(arm('M_agent.txt'));
    expect(c1.map((e) => e.text).join(' ')).toBe(arm('C1_agent.txt'));
    const differingAt = (a: Entry[], b: Entry[]): number[] => a.filter((e, i) => e.text !== b[i]!.text).map((e) => e.index);
    const documented = t.transposed.map((r) => r.served_index).sort((a, b) => a - b);
    expect(differingAt(m, c1)).toEqual(documented);
    // Mutant: one undocumented byte changed in C1 is caught by the same check.
    const mutant = c1.map((e) => ({ ...e }));
    mutant[0] = { ...mutant[0]!, text: `${mutant[0]!.text} ` };
    expect(differingAt(m, mutant)).not.toEqual(documented);
    expect(t.transposed.map((r) => r.id)).toEqual(['a-receipts', 'b-no-run-after-authorise', 'c-reporting', 'd-revision', 'e-style']);
    for (const r of t.transposed) {
      expect(m[r.served_index]!.text, `${r.id}: before is the served entry`).toBe(r.before_served);
      expect(c1[r.served_index]!.text, `${r.id}: after is the recorded sentence`).toBe(r.after);
    }
    // The v2 "+" sentences, evaluated HERE (plain JS, not the generator's transpiler).
    const patch = readFileSync(join(SOURCES_DIR, 'ai-quality-copy-correction.v2.patch'), 'utf8');
    const plus = patch.split('\n').filter((l) => /^\+ {2}'.*',$/.test(l))
      .map((l) => new Function(`return ${l.slice(3, -1)};`)() as string);
    expect(plus).toHaveLength(6);
    const used = t.transposed.map((r) => r.after);
    for (const a of used) expect(plus, 'each after is a v2 + sentence verbatim').toContain(a);
    const unused = plus.filter((p) => !used.includes(p));
    expect(unused).toHaveLength(1);
    expect(unused[0]!.startsWith('After build_model_from_brief, never call run_analysis on the same turn: Olumi runs the first analysis itself')).toBe(true);
    expect(arm('C1_agent.txt')).not.toContain(unused[0]!);
    expect(t.not_transposed.map((n) => n.id)).toEqual(['first-analysis']);
  });

  it('C1 carries no "how firmly" and no same-turn Run instruction — and M does (contrast control)', () => {
    for (const phrase of ['how firmly', 'call run_analysis in the SAME turn']) {
      expect(arm('M_agent.txt'), `contrast: M contains ${phrase}`).toContain(phrase);
      for (const f of ['C1_agent.txt', 'C1_fp3_stack.txt', 'C2_fp3_stack.txt']) expect(arm(f), `${f} must not contain ${phrase}`).not.toContain(phrase);
    }
  });

  it('FP3 stacks: agent + "\\n\\n" + INTERPRET_ONLY + "\\n\\n" + v0.2 | v0.3; v0.3 is PR #1791\'s own module text', async () => {
    const io = arm('M_interpret_only.txt');
    expect(arm('M_fp3_stack.txt')).toBe(`${arm('M_agent.txt')}\n\n${io}\n\n${arm('M_v02.txt')}`);
    expect(arm('C1_fp3_stack.txt')).toBe(`${arm('C1_agent.txt')}\n\n${io}\n\n${arm('M_v02.txt')}`);
    expect(arm('C2_fp3_stack.txt')).toBe(`${arm('C1_agent.txt')}\n\n${io}\n\n${arm('C2_v03.txt')}`);
    const srcBuf = readFileSync(join(SOURCES_DIR, 'analysis-interpreter-v03.ts'));
    expect(gitBlobId(srcBuf), 'the PR head blob').toBe(V03_BLOB);
    const v03 = await import(join(SOURCES_DIR, 'analysis-interpreter-v03.ts')) as {
      ANALYSIS_INTERPRETER_V03: { instructions: string; version: string };
      composeAnalysisInterpreterV03: (b: string) => { instructions: string };
    };
    expect(v03.ANALYSIS_INTERPRETER_V03.version).toBe('0.3-candidate');
    expect(arm('C2_v03.txt')).toBe(v03.ANALYSIS_INTERPRETER_V03.instructions);
    expect(v03.composeAnalysisInterpreterV03(`${arm('C1_agent.txt')}\n\n${io}`).instructions).toBe(arm('C2_fp3_stack.txt'));
  });

  it('every .sha256 file matches its arm', () => {
    for (const f of ['M_agent.txt', 'M_interpret_only.txt', 'M_v02.txt', 'C1_agent.txt', 'C2_v03.txt', 'M_fp3_stack.txt', 'C1_fp3_stack.txt', 'C2_fp3_stack.txt',
      'M_agent.entries.json', 'C1_agent.entries.json', 'TRANSPOSITIONS.json', 'arms.json']) {
      expect(arm(`${f}.sha256`), f).toBe(`${sha(arm(f))}  ${f}\n`);
    }
  });
});
