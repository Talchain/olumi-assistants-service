/**
 * FP3 explicit-Run interpretation replay — MATCHED requests for two instruction stacks.
 *
 *   pnpm exec tsx tools/agent-reply-eval/replay-fp3.ts \
 *     --cases fp3-captured-cases.json --stack-a a.txt --stack-b b.txt [--out <dir>] [--execute]
 *
 * For every captured case it builds one Responses-API request per stack. The two requests
 * differ ONLY in `instructions`: same model (gpt-5.6-terra), same `input` (the captured
 * prior turn + run pair), `tools: []`, `tool_choice: 'none'`, same `max_output_tokens`.
 * Stacks come from files — use extract-stack.ts to derive one from a route.
 *
 * ⛔ PAID CALLS ARE DOUBLE-GATED. The default is a DRY RUN that writes the requests to
 * `<out>/requests/` and a manifest, and sends nothing. Sending needs BOTH `--execute` AND
 * `AIQ_REPLAY_BUDGET_APPROVED=yes` in the environment; `--execute` without the variable is
 * REFUSED with a non-zero exit, before any key is read. There is no default budget.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const REPLAY_MODEL = 'gpt-5.6-terra';
export const RESPONSES_URL = 'https://api.openai.com/v1/responses';
export const BUDGET_ENV = 'AIQ_REPLAY_BUDGET_APPROVED';

export interface ReplayCase {
  readonly caseId: string;
  readonly input: unknown[];
  readonly maxOutputTokens: number;
  readonly expected: readonly string[];
}

export interface ReplayRequest {
  readonly caseId: string;
  readonly stack: 'A' | 'B';
  readonly body: {
    readonly model: string;
    readonly instructions: string;
    readonly input: unknown[];
    readonly tools: [];
    readonly tool_choice: 'none';
    readonly max_output_tokens: number;
  };
}

/** Accepts PR #1791's shape ({captures:[{case_id, request:{input, max_output_tokens}, expected}]}) or {cases:[…]}. */
export function loadCases(json: unknown): ReplayCase[] {
  const root = json as { captures?: unknown; cases?: unknown };
  const list = Array.isArray(root.captures) ? root.captures : Array.isArray(root.cases) ? root.cases : null;
  if (list === null) throw new Error('cases file has neither `captures` nor `cases`');
  return list.map((c, i) => {
    const r = c as { case_id?: unknown; request?: { input?: unknown; max_output_tokens?: unknown }; expected?: unknown };
    if (typeof r.case_id !== 'string') throw new Error(`case ${i}: no case_id`);
    if (!Array.isArray(r.request?.input)) throw new Error(`${r.case_id}: request.input is not an array`);
    return {
      caseId: r.case_id,
      input: r.request!.input as unknown[],
      maxOutputTokens: typeof r.request?.max_output_tokens === 'number' ? r.request.max_output_tokens : 3400,
      expected: Array.isArray(r.expected) ? (r.expected as unknown[]).map(String) : [],
    };
  });
}

export function buildRequests(cases: readonly ReplayCase[], stacks: { readonly A: string; readonly B: string }): ReplayRequest[] {
  if (stacks.A.trim() === '' || stacks.B.trim() === '') throw new Error('an instruction stack is empty');
  return cases.flatMap((c) =>
    (['A', 'B'] as const).map((stack) => ({
      caseId: c.caseId,
      stack,
      body: { model: REPLAY_MODEL, instructions: stacks[stack], input: c.input, tools: [] as [], tool_choice: 'none' as const, max_output_tokens: c.maxOutputTokens },
    })),
  );
}

export type Gate = { readonly mode: 'dry-run' } | { readonly mode: 'execute' } | { readonly mode: 'refused'; readonly reason: string };

export function gate(executeFlag: boolean, env: Readonly<Record<string, string | undefined>>): Gate {
  if (!executeFlag) return { mode: 'dry-run' };
  if (env[BUDGET_ENV] !== 'yes') return { mode: 'refused', reason: `--execute given but ${BUDGET_ENV}=yes is not set — no agreed budget, nothing sent` };
  return { mode: 'execute' };
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

export interface ReplayDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: typeof fetch;
  readonly readFile: (p: string) => string;
  readonly writeFile: (p: string, s: string) => void;
  readonly mkdir: (p: string) => void;
  readonly log: (s: string) => void;
}

export interface ReplayArgs {
  readonly cases: string;
  readonly stackA: string;
  readonly stackB: string;
  readonly out: string;
  readonly execute: boolean;
}

export function parseArgs(argv: readonly string[]): ReplayArgs {
  const get = (k: string): string | null => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--') ? argv[i + 1]! : null;
  };
  const cases = get('--cases');
  const stackA = get('--stack-a');
  const stackB = get('--stack-b');
  if (cases === null || stackA === null || stackB === null) {
    throw new Error('usage: replay-fp3.ts --cases <json> --stack-a <file> --stack-b <file> [--out <dir>] [--execute]');
  }
  return { cases, stackA, stackB, out: get('--out') ?? 'agent-reply-replay-out', execute: argv.includes('--execute') };
}

/** Returns the process exit code: 0 dry run or sent, 2 refused, 1 a send failed. */
export async function runReplay(args: ReplayArgs, deps: ReplayDeps): Promise<number> {
  const g = gate(args.execute, deps.env);
  if (g.mode === 'refused') {
    deps.log(`REFUSED: ${g.reason}`);
    return 2;
  }
  const casesText = deps.readFile(args.cases);
  const stackA = deps.readFile(args.stackA);
  const stackB = deps.readFile(args.stackB);
  const requests = buildRequests(loadCases(JSON.parse(casesText)), { A: stackA, B: stackB });
  deps.mkdir(join(args.out, 'requests'));
  for (const r of requests) deps.writeFile(join(args.out, 'requests', `${r.caseId}__${r.stack}.json`), `${JSON.stringify(r.body, null, 2)}\n`);
  const manifest = {
    mode: g.mode,
    model: REPLAY_MODEL,
    request_count: requests.length,
    cases: [...new Set(requests.map((r) => r.caseId))],
    cases_sha256: sha(casesText),
    stack_a: { file: args.stackA, sha256: sha(stackA), chars: stackA.length },
    stack_b: { file: args.stackB, sha256: sha(stackB), chars: stackB.length },
    matched: 'each case: identical model, input, tools [], tool_choice none, max_output_tokens — only instructions differ',
  };
  deps.writeFile(join(args.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  deps.log(JSON.stringify({ mode: g.mode, request_count: requests.length, out: args.out }));
  if (g.mode === 'dry-run') return 0;

  const key = deps.env.OPENAI_API_KEY;
  if (key === undefined || key === '') {
    deps.log('REFUSED: OPENAI_API_KEY is not set');
    return 2;
  }
  deps.mkdir(join(args.out, 'responses'));
  let failed = 0;
  for (const r of requests) {
    const res = await deps.fetch(RESPONSES_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(r.body),
    });
    const text = await res.text();
    deps.writeFile(join(args.out, 'responses', `${r.caseId}__${r.stack}.json`), text);
    if (!res.ok) failed += 1;
    deps.log(`${r.caseId} ${r.stack}: HTTP ${res.status}`);
  }
  return failed === 0 ? 0 : 1;
}

async function main(): Promise<void> {
  const code = await runReplay(parseArgs(process.argv.slice(2)), {
    env: process.env,
    fetch,
    readFile: (p) => readFileSync(p, 'utf8'),
    writeFile: (p, s) => writeFileSync(p, s),
    mkdir: (p) => mkdirSync(p, { recursive: true }),
    log: (s) => console.log(s),
  });
  process.exitCode = code;
}

if (process.argv[1] !== undefined && /replay-fp3\.ts$/.test(process.argv[1])) void main();
