/**
 * The FP3 replay may never send by default. These tests drive it with a fake fetch
 * that records every call; no network is touched.
 */
import { describe, expect, it } from 'vitest';
import { BUDGET_ENV, REPLAY_MODEL, buildRequests, gate, loadCases, parseArgs, runReplay, type ReplayDeps } from '../replay-fp3.js';

const CASES = {
  source_head: 'x',
  captures: [
    { case_id: 'PJ01', request: { input: [{ role: 'user', content: [{ type: 'input_text', text: 'Which?' }] }], max_output_tokens: 3400 }, expected: ['a'] },
    { case_id: 'PJ02', request: { input: [{ role: 'user', content: [{ type: 'input_text', text: 'Why?' }] }] }, expected: [] },
  ],
};

function deps(env: Record<string, string | undefined>) {
  const files = new Map<string, string>([
    ['cases.json', JSON.stringify(CASES)],
    ['a.txt', 'STACK A'],
    ['b.txt', 'STACK B'],
  ]);
  const calls: string[] = [];
  const d: ReplayDeps = {
    env,
    fetch: (async (url: string) => {
      calls.push(url);
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch,
    readFile: (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`no file ${p}`);
      return v;
    },
    writeFile: (p, s) => void files.set(p, s),
    mkdir: () => undefined,
    log: () => undefined,
  };
  return { d, calls, files };
}

const ARGS = ['--cases', 'cases.json', '--stack-a', 'a.txt', '--stack-b', 'b.txt', '--out', 'out'];

describe('gate', () => {
  it('dry run unless --execute; refuses --execute without the budget variable; executes only with both', () => {
    expect(gate(false, { [BUDGET_ENV]: 'yes' }).mode).toBe('dry-run');
    expect(gate(true, {}).mode).toBe('refused');
    expect(gate(true, { [BUDGET_ENV]: 'true' }).mode).toBe('refused');
    expect(gate(true, { [BUDGET_ENV]: 'yes' }).mode).toBe('execute');
  });
});

describe('runReplay', () => {
  it('default (no --execute) writes 2 requests per case and sends nothing, even with the budget variable set', async () => {
    const { d, calls, files } = deps({ [BUDGET_ENV]: 'yes', OPENAI_API_KEY: 'k' });
    expect(await runReplay(parseArgs(ARGS), d)).toBe(0);
    expect(calls).toEqual([]);
    expect([...files.keys()].filter((k) => k.startsWith('out/requests/')).sort()).toEqual([
      'out/requests/PJ01__A.json',
      'out/requests/PJ01__B.json',
      'out/requests/PJ02__A.json',
      'out/requests/PJ02__B.json',
    ]);
    expect(JSON.parse(files.get('out/manifest.json')!).request_count).toBe(4);
  });

  it('--execute without the budget variable is refused: exit 2, nothing written, nothing sent', async () => {
    const { d, calls, files } = deps({ OPENAI_API_KEY: 'k' });
    expect(await runReplay(parseArgs([...ARGS, '--execute']), d)).toBe(2);
    expect(calls).toEqual([]);
    expect([...files.keys()].some((k) => k.startsWith('out/'))).toBe(false);
  });

  it('only --execute AND the budget variable send — one POST per request', async () => {
    const { d, calls } = deps({ [BUDGET_ENV]: 'yes', OPENAI_API_KEY: 'k' });
    expect(await runReplay(parseArgs([...ARGS, '--execute']), d)).toBe(0);
    expect(calls).toHaveLength(4);
  });
});

describe('matched requests', () => {
  it('the A and B request for a case differ ONLY in instructions; tools [] and tool_choice none', () => {
    const reqs = buildRequests(loadCases(CASES), { A: 'STACK A', B: 'STACK B' });
    expect(reqs).toHaveLength(4);
    for (const id of ['PJ01', 'PJ02']) {
      const [a, b] = [reqs.find((r) => r.caseId === id && r.stack === 'A')!.body, reqs.find((r) => r.caseId === id && r.stack === 'B')!.body];
      expect(Object.keys(a).filter((k) => JSON.stringify((a as Record<string, unknown>)[k]) !== JSON.stringify((b as Record<string, unknown>)[k]))).toEqual(['instructions']);
      expect([a.model, a.tools, a.tool_choice]).toEqual([REPLAY_MODEL, [], 'none']);
    }
    expect(reqs.find((r) => r.caseId === 'PJ02')!.body.max_output_tokens).toBe(3400);
  });
  it('refuses an empty stack', () => {
    expect(() => buildRequests(loadCases(CASES), { A: ' ', B: 'x' })).toThrow(/empty/);
  });
});
