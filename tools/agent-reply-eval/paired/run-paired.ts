/**
 * Paired, paid, OpenAI-ONLY baseline-vs-candidate runs on the captured 57f903c request shapes.
 *
 *   npx tsx tools/agent-reply-eval/paired/run-paired.ts --dry-run            # build + verify + plan, no network
 *   OPENAI_API_KEY=<never printed> npx tsx tools/agent-reply-eval/paired/run-paired.ts --seed <n>
 *
 * For each case's reply-writing request (MANIFEST.json) it builds one request per arm by replacing
 * ONLY `instructions`; every other body key (input, tools, tool_choice, model, max_output_tokens, …)
 * is asserted byte-identical to the captured request, and the M arm's whole body is asserted
 * byte-identical to it (so M reproduces what 57f903c sent).
 *
 *   FP3 (explicit Run) cases:          M = M_agent+io+v02 · C1 = C1_agent+io+v02 · C2 = C1_agent+io+v03
 *   construction final-hop, R&C card:  M = M_agent · C1 = C1_agent
 *
 * n=3 per arm per case, in a seeded randomised interleaved order (one shuffled block per repeat),
 * strictly sequential, plus a noise control: pricing-run-complete arm M reps 4–5, placed at seeded
 * positions inside blocks 2 and 3.
 *
 * HARD RULES enforced here: every *ANTHROPIC* / CLAUDE_API_KEY env var is deleted at start and
 * asserted absent before every send; global fetch is wrapped so only https://api.openai.com/ can be
 * reached (anything else throws before a byte is sent), and every fetch decision is logged; the key
 * is never printed or written (writeOnce refuses any file containing it); Authorization is redacted
 * in every recorded request; every output file is write-once (`wx`); paid attempts are capped at 80.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { assertNoAnthropicEnv, scrubAnthropicEnv, sha256, writeOnce } from './capture/network-guard.js';

// ───────────────────────────── constants ─────────────────────────────
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SERVED_HEAD = '57f903c4652783a9de1a3778d6682a8e5f8414e1';
const BASE = join(REPO_ROOT, 'Docs/evals/agent-reply/paired/57f903c');
const SHAPES = join(BASE, 'shapes');
const ARMS_DIR = join(BASE, 'arms');
const RUNS = join(BASE, 'runs');
const LEDGER_DIR = join(RUNS, '_runs');
export const OPENAI_URL = 'https://api.openai.com/v1/responses';
export const PAID_CALL_BUDGET = 80;
export const REPS = 3;
const MAX_RETRIES = 2;
const BACKOFF_MS = [5_000, 15_000];
const CALL_TIMEOUT_MS = 240_000;
const NOISE_CONTROL = { caseId: 'pricing-run-complete', arm: 'M', reps: [4, 5] } as const;

export const EXPECTED_CASES = [
  'heldout-ed-triage-construction',
  'hiring-construction',
  'hiring-run-blocked',
  'pricing-construction',
  'pricing-discussion-card',
  'pricing-run-complete',
] as const;

type Kind = 'fp3' | 'construction-final-hop' | 'discussion-card';
type Arm = 'M' | 'C1' | 'C2';
type Json = Record<string, unknown>;

// ───────────────────────────── network guard ─────────────────────────────
export function isAllowedUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' && u.host === 'api.openai.com' && u.username === '' && u.password === '';
}

interface GuardEntry { seq: number; at: string; url: string; host: string; decision: 'allowed' | 'blocked'; selftest: boolean; label: string }
interface Guard { log: GuardEntry[]; realFetchInvocations: number; label: string; selftest: boolean }

const redactUrl = (url: string): { url: string; host: string } => {
  try { const u = new URL(url); return { url: `${u.protocol}//${u.host}${u.pathname}`, host: u.host }; } catch { return { url: '(unparseable)', host: '(unparseable)' }; }
};

/** Wraps global fetch. Only https://api.openai.com/ passes; every decision is logged. */
export function installFetchGuard(): Guard {
  const g: Guard = { log: [], realFetchInvocations: 0, label: '', selftest: false };
  const realFetch = globalThis.fetch;
  const guarded = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : String((input as { url?: unknown })?.url ?? '');
    const { url, host } = redactUrl(raw);
    const allowed = isAllowedUrl(raw);
    g.log.push({ seq: g.log.length + 1, at: new Date().toISOString(), url, host, decision: allowed ? 'allowed' : 'blocked', selftest: g.selftest, label: g.label });
    if (!allowed) throw new Error(`network guard: ${host} is not api.openai.com — refused before send`);
    assertNoAnthropicEnv();
    g.realFetchInvocations += 1;
    return realFetch(raw, init);
  };
  globalThis.fetch = guarded as typeof fetch;
  return g;
}

/** Proves the guard blocks before send (contrast: the allow predicate accepts the one OpenAI URL). */
async function guardSelfTest(g: Guard): Promise<Json> {
  const predicate: Record<string, boolean> = {};
  for (const u of [
    OPENAI_URL,
    'https://api.anthropic.com/v1/messages',
    'http://api.openai.com/v1/responses',
    'https://api.openai.com.evil.example/v1/responses',
    'https://user:pw@api.openai.com/v1/responses',
    'https://cee-staging.onrender.com/agent/v1/turn',
    'https://example.com/',
  ]) predicate[u] = isAllowedUrl(u);
  const expectOnlyOpenAi = Object.entries(predicate).every(([u, ok]) => ok === (u === OPENAI_URL));
  const before = g.realFetchInvocations;
  g.selftest = true;
  let threw = '';
  try { await fetch('https://example.com/guard-selftest'); } catch (e) { threw = (e as Error).message; }
  g.selftest = false;
  const result = {
    predicate,
    predicate_allows_only_openai: expectOnlyOpenAi,
    blocked_fetch_threw: threw,
    real_fetch_invoked_by_blocked_call: g.realFetchInvocations !== before,
  };
  if (!expectOnlyOpenAi || !threw.includes('refused before send') || result.real_fetch_invoked_by_blocked_call) {
    throw new Error(`guard self-test failed: ${JSON.stringify(result)}`);
  }
  return result;
}

// ───────────────────────────── inputs ─────────────────────────────
const readText = (p: string): string => readFileSync(p, 'utf8');
const readJson = (p: string): any => JSON.parse(readText(p));

interface ArmFiles { M_agent: string; C1_agent: string; io: string; v02: string; v03: string; M_fp3: string; C1_fp3: string; C2_fp3: string }

export function loadArms(): { files: ArmFiles; hashes: Record<string, string> } {
  const arms = readJson(join(ARMS_DIR, 'arms.json'));
  if (arms.served_sha !== SERVED_HEAD) throw new Error(`arms.json served_sha ${arms.served_sha} != ${SERVED_HEAD}`);
  const names: Record<keyof ArmFiles, string> = {
    M_agent: 'M_agent.txt', C1_agent: 'C1_agent.txt', io: 'M_interpret_only.txt', v02: 'M_v02.txt', v03: 'C2_v03.txt',
    M_fp3: 'M_fp3_stack.txt', C1_fp3: 'C1_fp3_stack.txt', C2_fp3: 'C2_fp3_stack.txt',
  };
  const files = {} as ArmFiles;
  const hashes: Record<string, string> = {};
  for (const [k, f] of Object.entries(names) as [keyof ArmFiles, string][]) {
    const text = readText(join(ARMS_DIR, f));
    const h = sha256(text);
    const want = arms.files?.[f]?.sha256;
    const side = readText(join(ARMS_DIR, `${f}.sha256`)).trim().split(/\s+/)[0];
    if (h !== want || h !== side) throw new Error(`${f}: sha256 ${h} != arms.json ${want} / .sha256 ${side}`);
    files[k] = text;
    hashes[f] = h;
  }
  // The stack rule, re-derived here rather than trusted.
  const stack = (agent: string, profile: string) => `${agent}\n\n${files.io}\n\n${profile}`;
  if (files.M_fp3 !== stack(files.M_agent, files.v02)) throw new Error('M_fp3 != M_agent+io+v02');
  if (files.C1_fp3 !== stack(files.C1_agent, files.v02)) throw new Error('C1_fp3 != C1_agent+io+v02');
  if (files.C2_fp3 !== stack(files.C1_agent, files.v03)) throw new Error('C2_fp3 != C1_agent+io+v03');
  return { files, hashes };
}

export interface CaseSpec { caseId: string; kind: Kind; requestPath: string; captured: { url: string; method: string; headers: Json; body: Json } }

export function loadCases(): CaseSpec[] {
  const manifest = readJson(join(SHAPES, 'MANIFEST.json'));
  if (manifest.head !== SERVED_HEAD) throw new Error(`MANIFEST head ${manifest.head} != ${SERVED_HEAD}`);
  const out: CaseSpec[] = [];
  for (const c of manifest.cases as Json[]) {
    const rel = c['reply_writing_request'];
    if (typeof rel !== 'string' || rel === '') continue;
    const purpose = String(c['purpose']);
    const kind: Kind = purpose === 'fp3-explicit-run' ? 'fp3'
      : purpose === 'live-construction' ? 'construction-final-hop'
        : purpose === 'discussion-card-first-hop' ? 'discussion-card'
          : (() => { throw new Error(`unknown purpose ${purpose} for ${String(c['case'])}`); })();
    const captured = readJson(join(REPO_ROOT, rel));
    if (captured.url !== OPENAI_URL || captured.method !== 'POST') throw new Error(`${rel}: not a POST to ${OPENAI_URL}`);
    out.push({ caseId: String(c['case']), kind, requestPath: rel, captured });
  }
  const ids = out.map((c) => c.caseId).sort();
  if (JSON.stringify(ids) !== JSON.stringify([...EXPECTED_CASES])) throw new Error(`cases ${ids.join(',')} != expected`);
  return out;
}

export function armsFor(kind: Kind, f: ArmFiles): { arm: Arm; file: string; text: string }[] {
  return kind === 'fp3'
    ? [{ arm: 'M', file: 'M_fp3_stack.txt', text: f.M_fp3 }, { arm: 'C1', file: 'C1_fp3_stack.txt', text: f.C1_fp3 }, { arm: 'C2', file: 'C2_fp3_stack.txt', text: f.C2_fp3 }]
    : [{ arm: 'M', file: 'M_agent.txt', text: f.M_agent }, { arm: 'C1', file: 'C1_agent.txt', text: f.C1_agent }];
}

/** Replaces ONLY `instructions`; key order preserved. Returns the body and a key-level diff. */
export function buildArmBody(captured: Json, instructions: string): { body: Json; diff: string[]; keyOrderEqual: boolean; restSha: [string, string] } {
  if (typeof captured['instructions'] !== 'string') throw new Error('captured body has no string instructions');
  const body: Json = { ...captured, instructions };
  const keys = [...new Set([...Object.keys(captured), ...Object.keys(body)])];
  const diff = keys.filter((k) => JSON.stringify(captured[k]) !== JSON.stringify(body[k]));
  const rest = (b: Json) => { const { instructions: _i, ...r } = b; return sha256(JSON.stringify(r)); };
  return { body, diff, keyOrderEqual: JSON.stringify(Object.keys(captured)) === JSON.stringify(Object.keys(body)), restSha: [rest(captured), rest(body)] };
}

// ───────────────────────────── schedule ─────────────────────────────
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Unit { caseId: string; arm: Arm; rep: number; control: boolean; block: number }

export function buildSchedule(pairs: { caseId: string; arm: Arm }[], seed: number): Unit[] {
  const rnd = mulberry32(seed);
  const shuffle = <T>(xs: T[]): T[] => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
    return a;
  };
  const out: Unit[] = [];
  for (let rep = 1; rep <= REPS; rep += 1) {
    const block: Unit[] = shuffle(pairs).map((p) => ({ ...p, rep, control: false, block: rep }));
    const controlRep = rep === 2 ? NOISE_CONTROL.reps[0] : rep === 3 ? NOISE_CONTROL.reps[1] : null;
    if (controlRep !== null) {
      const at = Math.floor(rnd() * (block.length + 1));
      block.splice(at, 0, { caseId: NOISE_CONTROL.caseId, arm: NOISE_CONTROL.arm, rep: controlRep, control: true, block: rep });
    }
    out.push(...block);
  }
  return out;
}

// ───────────────────────────── response helpers ─────────────────────────────
export function extractOutcome(parsed: Json | null): { type: string; text: string; function_calls: { name: string; call_id: string | null; arguments: unknown }[]; refusals: string[] } {
  let text = '';
  const fns: { name: string; call_id: string | null; arguments: unknown }[] = [];
  const refusals: string[] = [];
  for (const o of (Array.isArray(parsed?.['output']) ? parsed!['output'] : []) as Json[]) {
    if (o?.['type'] === 'message') {
      for (const c of (Array.isArray(o['content']) ? o['content'] : []) as Json[]) {
        if (c?.['type'] === 'output_text') text += String(c['text'] ?? '');
        else if (c?.['type'] === 'refusal') refusals.push(String(c['refusal'] ?? ''));
      }
    } else if (o?.['type'] === 'function_call') {
      let args: unknown = o['arguments'];
      try { args = JSON.parse(String(o['arguments'])); } catch { /* keep raw */ }
      fns.push({ name: String(o['name']), call_id: (o['call_id'] as string | undefined) ?? null, arguments: args });
    }
  }
  const type = parsed === null ? 'error'
    : text !== '' && fns.length > 0 ? 'text+function_call'
      : fns.length > 0 ? 'function_call'
        : text !== '' ? 'text'
          : refusals.length > 0 ? 'refusal' : 'empty';
  return { type, text, function_calls: fns, refusals };
}

const words = (s: string): number => (s.trim() === '' ? 0 : s.trim().split(/\s+/).length);

function usageOf(u: unknown): Json | null {
  if (u === null || typeof u !== 'object') return null;
  const x = u as Record<string, any>;
  return {
    input_tokens: x.input_tokens ?? null,
    cached_tokens: x.input_tokens_details?.cached_tokens ?? null,
    output_tokens: x.output_tokens ?? null,
    reasoning_tokens: x.output_tokens_details?.reasoning_tokens ?? null,
    total_tokens: x.total_tokens ?? null,
    raw: x,
  };
}

function textFileFor(outcome: ReturnType<typeof extractOutcome>): string {
  let s = outcome.text;
  for (const r of outcome.refusals) s += `${s === '' ? '' : '\n\n'}[refusal] ${r}`;
  for (const f of outcome.function_calls) {
    s += `${s === '' ? '' : '\n\n'}[function_call] ${f.name}\n${typeof f.arguments === 'string' ? f.arguments : JSON.stringify(f.arguments, null, 2)}`;
  }
  return s.endsWith('\n') ? s : `${s}\n`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rel = (p: string) => relative(REPO_ROOT, p);

// ───────────────────────────── main ─────────────────────────────
interface Args { dryRun: boolean; seed: number | null; maxCalls: number | null }
function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, seed: null, maxCalls: null };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--dry-run') a.dryRun = true;
    else if (k === '--seed') a.seed = Number(argv[++i]);
    else if (k === '--max-calls') a.maxCalls = Number(argv[++i]);
    else throw new Error(`unknown arg ${k}`);
  }
  if (a.seed !== null && !Number.isInteger(a.seed)) throw new Error('--seed must be an integer');
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const removedAtStart = scrubAnthropicEnv();
  assertNoAnthropicEnv();
  const guard = installFetchGuard();
  const selftest = await guardSelfTest(guard);

  const { files, hashes } = loadArms();
  const cases = loadCases();
  const byId = new Map(cases.map((c) => [c.caseId, c]));

  // Build every arm body once; assert the diff.
  const plan: Json[] = [];
  const bodies = new Map<string, { body: Json; bodyText: string; file: string; instructionsSha: string }>();
  for (const c of cases) {
    const arms = armsFor(c.kind, files);
    const mText = arms[0]!.text;
    if (c.captured.body['instructions'] !== mText) throw new Error(`${c.caseId}: captured instructions != ${arms[0]!.file}`);
    for (const a of arms) {
      const b = buildArmBody(c.captured.body, a.text);
      const expected = a.arm === 'M' ? [] : ['instructions'];
      if (JSON.stringify(b.diff) !== JSON.stringify(expected)) throw new Error(`${c.caseId}/${a.arm}: diff ${JSON.stringify(b.diff)} != ${JSON.stringify(expected)}`);
      if (!b.keyOrderEqual || b.restSha[0] !== b.restSha[1]) throw new Error(`${c.caseId}/${a.arm}: key order or non-instruction bytes differ`);
      const bodyText = JSON.stringify(b.body);
      if (a.arm === 'M' && bodyText !== JSON.stringify(c.captured.body)) throw new Error(`${c.caseId}/M: body not byte-identical to capture`);
      bodies.set(`${c.caseId}/${a.arm}`, { body: b.body, bodyText, file: a.file, instructionsSha: sha256(a.text) });
      plan.push({
        case: c.caseId, kind: c.kind, arm: a.arm, instructions_file: a.file, instructions_sha256: sha256(a.text),
        captured_request: c.requestPath, captured_instructions_sha256: sha256(String(c.captured.body['instructions'])),
        key_diff_vs_captured: b.diff, key_order_equal: b.keyOrderEqual,
        non_instruction_bytes_sha256: { captured: b.restSha[0], arm: b.restSha[1], equal: b.restSha[0] === b.restSha[1] },
        whole_body_byte_identical_to_capture: bodyText === JSON.stringify(c.captured.body),
        settings: {
          model: b.body['model'], max_output_tokens: b.body['max_output_tokens'], tool_choice: b.body['tool_choice'] ?? null,
          reasoning: b.body['reasoning'] ?? null, tools_count: Array.isArray(b.body['tools']) ? (b.body['tools'] as unknown[]).length : null,
          input_items: Array.isArray(b.body['input']) ? (b.body['input'] as unknown[]).length : null,
        },
      });
    }
  }
  const pairs = cases.flatMap((c) => armsFor(c.kind, files).map((a) => ({ caseId: c.caseId, arm: a.arm })));
  const seed = args.seed ?? randomInt(1, 2 ** 31 - 1);
  const schedule = buildSchedule(pairs, seed);
  if (schedule.length > PAID_CALL_BUDGET) throw new Error(`planned ${schedule.length} > budget ${PAID_CALL_BUDGET}`);

  mkdirSync(LEDGER_DIR, { recursive: true });
  const planFile = join(LEDGER_DIR, `${runStamp}-${args.dryRun ? 'dryrun-' : ''}plan.json`);
  writeOnce(planFile, {
    schema: 'agent-reply-paired-plan.v1', run_stamp: runStamp, dry_run: args.dryRun, head: SERVED_HEAD, seed,
    budget: PAID_CALL_BUDGET, reps: REPS, noise_control: NOISE_CONTROL, planned_calls: schedule.length,
    arm_hashes: hashes, anthropic_env_removed_at_start: removedAtStart, guard_selftest: selftest,
    arm_bodies: plan, schedule: schedule.map((u, i) => ({ i: i + 1, ...u })),
  });
  console.log(`plan: ${rel(planFile)} | cases ${cases.length} | arm bodies ${plan.length} (all diffs as expected) | planned calls ${schedule.length} | seed ${seed}`);
  for (const p of plan) console.log(`  ${String(p['case']).padEnd(32)} ${String(p['arm']).padEnd(3)} diff=${JSON.stringify(p['key_diff_vs_captured'])} rest_equal=${(p['non_instruction_bytes_sha256'] as Json)['equal']} whole_identical=${p['whole_body_byte_identical_to_capture']} instr=${String(p['instructions_sha256']).slice(0, 12)}`);
  if (args.dryRun) {
    console.log(`dry run: no network call made | guard log ${JSON.stringify(guard.log.map((e) => [e.host, e.decision, e.selftest]))} | real fetch invocations ${guard.realFetchInvocations}`);
    return;
  }

  const key = process.env['OPENAI_API_KEY'];
  if (typeof key !== 'string' || key.length < 20) throw new Error('OPENAI_API_KEY absent (not printed)');

  const journal = join(LEDGER_DIR, `${runStamp}-journal.jsonl`);
  const t0 = Date.now();
  let paidAttempts = 0;
  let stopReason: string | null = null;
  const done: Json[] = [];

  for (let i = 0; i < schedule.length; i += 1) {
    const u = schedule[i]!;
    const c = byId.get(u.caseId)!;
    const b = bodies.get(`${u.caseId}/${u.arm}`)!;
    const dir = join(RUNS, u.caseId, u.arm);
    mkdirSync(dir, { recursive: true });
    const stem = join(dir, `rep-${u.rep}`);
    if (existsSync(`${stem}.meta.json`)) { console.log(`[${i + 1}/${schedule.length}] ${u.caseId}/${u.arm}/rep-${u.rep} already recorded — skipped`); done.push({ ...u, skipped: true }); continue; }
    if (args.maxCalls !== null && paidAttempts >= args.maxCalls) { stopReason = `--max-calls ${args.maxCalls} reached`; break; }
    if (paidAttempts + 1 > PAID_CALL_BUDGET) { stopReason = `budget ${PAID_CALL_BUDGET} would be exceeded`; break; }

    const requestRecord = { url: OPENAI_URL, method: 'POST', headers: { authorization: '[REDACTED]', 'content-type': 'application/json' }, body: b.body };
    if (existsSync(`${stem}.request.json`)) {
      if (JSON.stringify(readJson(`${stem}.request.json`)) !== JSON.stringify(requestRecord)) throw new Error(`${rel(stem)}.request.json exists and differs`);
    } else writeOnce(`${stem}.request.json`, requestRecord);

    const attempts: Json[] = [];
    let final: { status: number | null; parsed: Json | null; rawText: string; headers: Json; wall: number; startedAt: string; error: string | null } | null = null;
    for (let a = 1; a <= 1 + MAX_RETRIES; a += 1) {
      if (paidAttempts + 1 > PAID_CALL_BUDGET) { stopReason = `budget ${PAID_CALL_BUDGET} would be exceeded (mid-retry)`; break; }
      assertNoAnthropicEnv();
      guard.label = `${u.caseId}/${u.arm}/rep-${u.rep}/attempt-${a}`;
      const guardSeq = guard.log.length + 1;
      const startedAt = new Date().toISOString();
      const s = performance.now();
      let status: number | null = null; let rawText = ''; let error: string | null = null; const headers: Json = {};
      try {
        const res = await fetch(OPENAI_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: b.bodyText,
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
        status = res.status;
        for (const h of ['x-request-id', 'openai-processing-ms', 'openai-version', 'openai-model']) { const v = res.headers.get(h); if (v !== null) headers[h] = v; }
        rawText = await res.text();
      } catch (e) { error = String((e as Error).message ?? e).replaceAll(key, '[REDACTED]'); }
      const wall = Math.round((performance.now() - s) * 10) / 10;
      paidAttempts += 1;
      const g = guard.log.find((e) => e.seq === guardSeq);
      let parsed: Json | null = null;
      try { parsed = JSON.parse(rawText) as Json; } catch { parsed = null; }
      const ok = status !== null && status >= 200 && status < 300 && parsed !== null;
      const attempt = { attempt: a, started_at: startedAt, wall_ms: wall, http_status: status, error, response_headers: headers, guard_seq: guardSeq, guard_decision: g?.decision ?? null, file: null as string | null };
      appendFileSync(journal, `${JSON.stringify({ i: i + 1, case: u.caseId, arm: u.arm, rep: u.rep, ...attempt, usage: parsed ? usageOf(parsed['usage']) : null, response_id: parsed?.['id'] ?? null })}\n`);
      const lastChance = a === 1 + MAX_RETRIES || status === 401 || status === 403;
      if (!ok && !lastChance) {
        const af = `${stem}.attempt-${a}`;
        if (parsed !== null) writeOnce(`${af}.response.json`, parsed); else writeOnce(`${af}.response.txt`, rawText === '' ? `(no body; error: ${error})\n` : rawText);
        writeOnce(`${af}.meta.json`, { ...attempt, case: u.caseId, arm: u.arm, rep: u.rep, guard: g?.decision === 'allowed' ? 'openai-only-ok' : 'unknown' });
        attempt.file = rel(af);
        attempts.push(attempt);
        console.log(`  attempt ${a} failed (${status ?? error}); backing off ${BACKOFF_MS[a - 1]} ms`);
        await sleep(BACKOFF_MS[a - 1]!);
        continue;
      }
      attempts.push(attempt);
      final = { status, parsed, rawText, headers, wall, startedAt, error };
      break;
    }
    if (final === null) break; // budget stop mid-retry

    const outcome = extractOutcome(final.parsed);
    const usage = final.parsed ? usageOf(final.parsed['usage']) : null;
    if (final.parsed !== null) writeOnce(`${stem}.response.json`, final.parsed);
    else writeOnce(`${stem}.response.txt`, final.rawText === '' ? `(no body; error: ${final.error})\n` : final.rawText);
    const gFinal = guard.log.find((e) => e.seq === (attempts[attempts.length - 1]!['guard_seq'] as number));
    const meta = {
      schema: 'agent-reply-paired-run-meta.v1',
      case: u.caseId, kind: c.kind, arm: u.arm, rep: u.rep, control: u.control, block: u.block,
      schedule_index: i + 1, seed, run_stamp: runStamp, served_head: SERVED_HEAD,
      captured_request: c.requestPath,
      model: b.body['model'], response_model: final.parsed?.['model'] ?? null,
      settings: {
        max_output_tokens: b.body['max_output_tokens'] ?? null, tool_choice: b.body['tool_choice'] ?? null,
        reasoning: b.body['reasoning'] ?? null, temperature: b.body['temperature'] ?? null,
        tools_count: Array.isArray(b.body['tools']) ? (b.body['tools'] as unknown[]).length : null,
        tool_names: Array.isArray(b.body['tools']) ? (b.body['tools'] as Json[]).map((t) => t['name']) : null,
        instructions_file: `Docs/evals/agent-reply/paired/57f903c/arms/${b.file}`, instructions_sha256: b.instructionsSha,
        instructions_chars: String(b.body['instructions']).length,
        input_items: Array.isArray(b.body['input']) ? (b.body['input'] as unknown[]).length : null,
        input_sha256: sha256(JSON.stringify(b.body['input'])),
        body_sha256: sha256(b.bodyText),
        response_reasoning: final.parsed?.['reasoning'] ?? null,
        response_service_tier: final.parsed?.['service_tier'] ?? null,
      },
      started_at: final.startedAt, wall_ms: final.wall, http_status: final.status,
      response_id: final.parsed?.['id'] ?? null, response_status: final.parsed?.['status'] ?? null,
      incomplete_details: final.parsed?.['incomplete_details'] ?? null,
      usage,
      outcome: { type: outcome.type, text_chars: outcome.text.length, words: words(outcome.text), function_calls: outcome.function_calls, refusals: outcome.refusals },
      attempts,
      response_headers: final.headers,
      guard: gFinal?.decision === 'allowed' ? 'openai-only-ok' : 'unknown',
      guard_detail: { seq: gFinal?.seq ?? null, host: gFinal?.host ?? null, decision: gFinal?.decision ?? null, anthropic_env_asserted_absent_before_send: true },
      recorded_at: new Date().toISOString(),
    };
    writeOnce(`${stem}.meta.json`, meta);
    if (final.parsed !== null && final.status !== null && final.status < 300) writeOnce(`${stem}.text.txt`, textFileFor(outcome));
    done.push({ ...u, status: final.status, attempts: attempts.length, wall_ms: final.wall, usage: usage ? { ...usage, raw: undefined } : null, outcome: outcome.type, words: words(outcome.text), fn: outcome.function_calls.map((f) => f.name) });
    console.log(`[${i + 1}/${schedule.length}] ${u.caseId}/${u.arm}/rep-${u.rep} http=${final.status} ${outcome.type} words=${words(outcome.text)} fn=${JSON.stringify(outcome.function_calls.map((f) => f.name))} in=${usage?.['input_tokens']} cached=${usage?.['cached_tokens']} out=${usage?.['output_tokens']} reas=${usage?.['reasoning_tokens']} ${final.wall}ms`);
    if (final.status === 401 || final.status === 403) { stopReason = `HTTP ${final.status} — run aborted`; break; }
  }

  // Totals + guard proof.
  const recorded = done.filter((d) => !d['skipped']);
  const sum = (k: string) => recorded.reduce((n, d) => n + (Number((d['usage'] as Json | null)?.[k] ?? 0) || 0), 0);
  const nonSelf = guard.log.filter((e) => !e.selftest);
  const hostsSeen = [...new Set(nonSelf.map((e) => e.host))];
  const ledger = {
    schema: 'agent-reply-paired-ledger.v1', run_stamp: runStamp, head: SERVED_HEAD, seed, plan: rel(planFile), journal: rel(journal),
    stop_reason: stopReason, planned_calls: schedule.length, recorded_units: recorded.length, skipped_units: done.length - recorded.length,
    paid_attempts: paidAttempts, budget: PAID_CALL_BUDGET,
    totals: {
      input_tokens: sum('input_tokens'), cached_tokens: sum('cached_tokens'), output_tokens: sum('output_tokens'),
      reasoning_tokens: sum('reasoning_tokens'), total_tokens: sum('total_tokens'),
      sum_call_wall_ms: Math.round(recorded.reduce((n, d) => n + Number(d['wall_ms'] ?? 0), 0)),
      run_wall_ms: Date.now() - t0,
    },
    guard: {
      fetch_attempts_excluding_selftest: nonSelf.length,
      allowed_openai: nonSelf.filter((e) => e.decision === 'allowed' && e.host === 'api.openai.com').length,
      blocked_excluding_selftest: nonSelf.filter((e) => e.decision === 'blocked'),
      hosts_seen_excluding_selftest: hostsSeen,
      anthropic_host_attempts: guard.log.filter((e) => /anthropic/i.test(e.host)).length,
      real_fetch_invocations: guard.realFetchInvocations,
      selftest,
      anthropic_env_removed_at_start: removedAtStart,
      anthropic_env_absent_at_end: Object.keys(process.env).filter((k) => /ANTHROPIC/i.test(k) || k === 'CLAUDE_API_KEY').length === 0,
      log: guard.log,
    },
    units: done,
  };
  const ledgerFile = join(LEDGER_DIR, `${runStamp}-ledger.json`);
  writeOnce(ledgerFile, ledger);
  console.log(`ledger: ${rel(ledgerFile)}`);
  console.log(`stop_reason=${stopReason} | paid_attempts=${paidAttempts} | recorded=${recorded.length} | tokens ${JSON.stringify(ledger.totals)}`);
  console.log(`guard: hosts=${JSON.stringify(hostsSeen)} allowed_openai=${ledger.guard.allowed_openai} blocked(non-selftest)=${ledger.guard.blocked_excluding_selftest.length} anthropic_host_attempts=${ledger.guard.anthropic_host_attempts} real_fetch=${guard.realFetchInvocations} anthropic_env_absent_at_end=${ledger.guard.anthropic_env_absent_at_end}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`run-paired failed: ${(e as Error).message}`); process.exitCode = 1; });
}
