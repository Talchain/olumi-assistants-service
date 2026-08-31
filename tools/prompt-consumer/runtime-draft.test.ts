import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertExactCaseIds } from './contract.js';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const names = ['target ESM class is actually intercepted', 'production adapter replay makes no network attempt', 'wrong CJS interceptor is refused before a call'] as const;
const collected: string[] = [];
beforeEach(() => expect.hasAssertions());
let temporaryDirectory: string | undefined;
let ownedWorktree: string | undefined;
let report: {
  sameClass: boolean; targetHead: string; captures: number; parserCalls: number;
  consumerCalls: number; transport: string; structuralStatus: string; fidelityStatus: string;
  providerBound: boolean; networkAttempts: number; wrongInterceptorRefused: boolean;
  wrongInterceptorError?: { name?: string; code?: string; message?: string; operator?: string; actualIsWrongClass: boolean; expectedIsTargetClass: boolean };
  prototypesRestored: boolean; error?: string;
};

beforeAll(() => {
  // The real adapter must run in native ESM, not Vitest's transformed module
  // graph. A pristine HEAD worktree makes this portable in CI and keeps the
  // target immutable even when the author is testing uncommitted tools.
  const suppliedRuntime = process.env.PROMPT_CONSUMER_TEST_RUNTIME_ROOT;
  let runtimeRoot: string;
  if (suppliedRuntime) runtimeRoot = resolve(suppliedRuntime);
  else {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'prompt-runtime-test-'));
    runtimeRoot = join(temporaryDirectory, 'runtime');
    execFileSync('git', ['worktree', 'add', '--detach', runtimeRoot, 'HEAD'], { cwd: root, stdio: 'pipe' });
    ownedWorktree = runtimeRoot;
    symlinkSync(resolve(root, 'node_modules'), join(runtimeRoot, 'node_modules'), 'dir');
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: runtimeRoot, encoding: 'utf8' }).trim();
  const script = `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    import { createHash } from 'node:crypto';
    import { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const [runtimeRoot, head, runnerUrl] = process.argv.slice(1);
    let networkAttempts = 0;
    const originalConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function () { networkAttempts++; throw new Error('NETWORK_FORBIDDEN_IN_REPLAY_TEST'); };
    try {
      const { loadDraftRuntime, draftConfiguration, captureDraft } = await import(runnerUrl);
      const runtime = await loadDraftRuntime(runtimeRoot, head);
      const targetRequire = createRequire(runtimeRoot + '/package.json');
      const { default: Anthropic } = await import(pathToFileURL(targetRequire.resolve('@anthropic-ai/sdk/index.mjs')).href);
      const sameClass = runtime.Messages === Anthropic.Messages;
      assert(sameClass);
      const originalStream = runtime.Messages.prototype.stream;
      const originalCreate = runtime.Messages.prototype.create;
      const brief = 'Reduce delivery delays. Add a support team. Keep current staffing. Delivery time is 12 days.';
      const records = {
        stated_items: [
          { kind: 'goal', source_quote: 'Reduce delivery delays' },
          { kind: 'option', source_quote: 'Add a support team' },
          { kind: 'option', source_quote: 'Keep current staffing' },
          { kind: 'figure', source_quote: 'Delivery time is 12 days', value: 12, unit: 'days', role: 'baseline' }
        ],
        claims: [
          { claim_kind: 'prior', label: 'Coordination effort', value: 4, basis: [0] },
          { claim_kind: 'causal_link', label: 'Support improves delivery', from_stated: 1, to_stated: 3, effect: 'negative', sets_to: 8 },
          { claim_kind: 'causal_link', label: 'Current staffing maintains delivery', from_stated: 2, to_stated: 3, effect: 'positive', sets_to: 12 },
          { claim_kind: 'causal_link', label: 'Delivery time bears on delays', from_stated: 3, to_stated: 0, effect: 'negative' },
          { claim_kind: 'causal_link', label: 'Coordination bears on delays', from_claim: 0, to_stated: 0, effect: 'negative' }
        ]
      };
      const model = 'claude-sonnet-5';
      const prompt = 'Replay-only mechanics control, not a natural-language quality fixture.';
      const configuration = draftConfiguration(runtime, { id: 'draft_graph_default', version: 'unpromoted-replay', content: prompt, sha256: createHash('sha256').update(prompt).digest('hex') }, model);
      const response = value => ({ id: 'msg_replay', type: 'message', role: 'assistant', model, stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text: JSON.stringify(value) }], usage: { input_tokens: 100, output_tokens: 200 } });
      const result = await captureDraft(runtime, configuration, brief, { timeoutMs: 5000, replayResponses: [response(records), response({ claims: [] })] });
      const { Messages: CjsMessages } = await import(pathToFileURL(targetRequire.resolve('@anthropic-ai/sdk/resources/messages')).href);
      assert.notEqual(CjsMessages, runtime.Messages);
      let wrongInterceptorRefused = false;
      let wrongInterceptorError;
      try { await captureDraft({ ...runtime, Messages: CjsMessages }, configuration, brief, { replayResponses: [response(records)] }); }
      catch (error) {
        // Node 20 substitutes its own message for same-shaped, distinct class
        // references. Check the exact failed identity relation, not prose that
        // varies by Node version; an unrelated refusal cannot satisfy this.
        wrongInterceptorError = { name: error.name, code: error.code, message: error.message, operator: error.operator,
          actualIsWrongClass: error.actual === CjsMessages, expectedIsTargetClass: error.expected === runtime.Messages };
        wrongInterceptorRefused = error.code === 'ERR_ASSERTION' && error.operator === 'strictEqual'
          && wrongInterceptorError.actualIsWrongClass && wrongInterceptorError.expectedIsTargetClass;
      }
      console.log('RUNTIME_REPLAY_REPORT=' + JSON.stringify({ sameClass, targetHead: runtime.head, captures: result.captures.length, parserCalls: result.fidelity.participation.parser.calls, consumerCalls: result.fidelity.participation.consumer.calls, transport: result.capture.transport, structuralStatus: result.fidelity.structuralStatus, fidelityStatus: result.fidelity.status, providerBound: result.fidelity.providerBound, networkAttempts, wrongInterceptorRefused, wrongInterceptorError, prototypesRestored: runtime.Messages.prototype.stream === originalStream && runtime.Messages.prototype.create === originalCreate, error: result.error }));
    } finally { net.Socket.prototype.connect = originalConnect; }
  `;
  const output = execFileSync(process.execPath, ['--import', pathToFileURL(require.resolve('tsx')).href, '--input-type=module', '-e', script,
    runtimeRoot, head, pathToFileURL(resolve(root, 'tools/prompt-consumer/runtime-draft.ts')).href], {
    cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 2_000_000,
    env: { ...process.env, ANTHROPIC_API_KEY: 'placeholder-no-provider-call', LOG_LEVEL: 'fatal', CEE_ANTHROPIC_STRUCTURED_OUTPUTS: 'true', CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED: 'true' },
  });
  const line = output.split('\n').find(value => value.startsWith('RUNTIME_REPLAY_REPORT='));
  if (!line) throw new Error('Native ESM replay did not issue its report');
  report = JSON.parse(line.slice('RUNTIME_REPLAY_REPORT='.length));
}, 40_000);

afterAll(() => {
  try { if (ownedWorktree) execFileSync('git', ['worktree', 'remove', '--force', ownedWorktree], { cwd: root, stdio: 'pipe' }); }
  finally { if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true }); }
  assertExactCaseIds(names, collected);
});

describe('native ESM target adapter capture', () => {
  it(names[0], () => { collected.push(names[0]); expect(report.sameClass).toBe(true); expect(report.targetHead).toMatch(/^[a-f0-9]{40}$/); });
  it(names[1], () => {
    collected.push(names[1]);
    expect(report.error).toBeUndefined();
    expect(report.captures).toBeGreaterThan(0);
    expect(report.parserCalls).toBe(1);
    expect(report.consumerCalls).toBe(2);
    expect(report.transport).toBe('replay');
    expect(report.structuralStatus).toBe('PASS');
    expect(report.fidelityStatus).toBe('PASS');
    expect(report.providerBound).toBe(false);
    expect(report.networkAttempts).toBe(0);
    expect(report.prototypesRestored).toBe(true);
  });
  it(names[2], () => {
    collected.push(names[2]);
    expect(report.wrongInterceptorError).toMatchObject({ name: 'AssertionError', code: 'ERR_ASSERTION', operator: 'strictEqual', actualIsWrongClass: true, expectedIsTargetClass: true });
    expect(report.wrongInterceptorRefused).toBe(true);
    expect(report.networkAttempts).toBe(0);
  });
});
