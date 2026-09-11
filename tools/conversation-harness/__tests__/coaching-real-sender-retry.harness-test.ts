/**
 * CEE #1398 — the ONE real-sender retry witness the `3b3c2353` review asked for.
 *
 * ── THE EVIDENCE GAP THIS CLOSES ───────────────────────────────────────────────
 * The scope controls in `coaching-capability-contract.harness-test.ts` use senders
 * that only READ `isLiveEvalSingleAttempt()`, and the existing
 * `live-eval-retry-policy.harness-test.ts` controls inspect policy values and
 * source strings. Both prove the scope is plumbed; neither executes the retrying
 * sender, so neither can show that one budget charge really is one provider
 * attempt. The actual client wraps its request in the repository `withRetry`
 * helper AND configures SDK retries of its own.
 *
 * So this drives the REAL non-streaming `chatWithToolsAnthropic` with the SDK
 * mocked at the module boundary — the existing injection pattern used by
 * `tests/unit/anthropic.system-cache-blocks.test.ts` — and counts what the
 * provider boundary actually receives.
 *
 * ⚠ NO PAID CALL, AND NO RETRY PROVOKED FROM A REAL PROVIDER. The failure is a
 * controlled rejection from a mock; the network is never reached. This is not a
 * production bug report and changes no production retry policy.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../../src/adapters/llm/types.js';

/** Constructor options every mock client was built with, newest last. */
const clientOptions: Record<string, unknown>[] = [];
const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
    constructor(opts: Record<string, unknown>) {
      clientOptions.push(opts);
    }
  },
}));

/** "rate limit" is one of the repository helper's retryable patterns. */
const RETRYABLE = new Error('rate limit exceeded, please retry');

function args(): ChatWithToolsArgs {
  return {
    system: 'system',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [{ name: 't', description: 'd', input_schema: { type: 'object', properties: {} } }],
  } as unknown as ChatWithToolsArgs;
}

/**
 * The adapter, the policy and the dispatcher from ONE module graph, loaded once.
 *
 * ⚠ ONE GRAPH IS LOAD-BEARING, not an optimisation. `beginLiveEvalSingleAttempt`
 * keeps its scope count in module state, so a copy imported across a
 * `vi.resetModules()` boundary would be a DIFFERENT counter: the adapter would
 * never observe the scope and the test would pass while proving nothing. Loading
 * once also keeps this file cheap — a per-test reset re-imported the routing
 * module three times, and that kind of added load has already pushed sibling
 * harness files past their timeouts once in this branch.
 *
 * The adapter's cached client is NOT a confound: `getClient` rebuilds whenever
 * the resolved SDK retry setting changes, which is exactly what each test below
 * toggles, and `clientOptions` records every construction.
 */
let graph: Promise<Record<string, never>> | null = null;
function loadGraph() {
  graph ??= (async () => {
    const [adapter, policy, boundary] = await Promise.all([
      import('../../../src/adapters/llm/anthropic.js'),
      import('../../../src/adapters/llm/live-eval-retry-policy.js'),
      import('../coaching-request-boundary.js'),
    ]);
    return { ...adapter, ...policy, ...boundary } as unknown as Record<string, never>;
  })();
  return graph as unknown as Promise<
    typeof import('../../../src/adapters/llm/anthropic.js') &
      typeof import('../../../src/adapters/llm/live-eval-retry-policy.js') &
      typeof import('../coaching-request-boundary.js')
  >;
}

const SLOW = 30_000;

describe('#1398 — one charge is one PROVIDER attempt, witnessed on the real sender', () => {
  beforeEach(() => {
    clientOptions.length = 0;
    mockCreate.mockReset();
    mockCreate.mockRejectedValue(RETRYABLE);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-a-real-credential');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('inside the scope: one charge, ONE provider attempt, SDK maxRetries 0', async () => {
    const g = await loadGraph();
    const budget = new g.AttemptBudget(1);
    const capture = { question: 'q', freshness: 'none' as const, args: args() };

    const records = await g.dispatchBounded(
      [{ arm: 'candidate' as const, capture, args: capture.args }],
      // The REAL sender, not a stand-in that merely reads the policy.
      (a: ChatWithToolsArgs): Promise<ChatWithToolsResult> =>
        g.chatWithToolsAnthropic({ ...a, model: 'claude-sonnet-4-6' } as never),
      budget,
    );

    // Exactly one charge, and the failure did not refund it.
    expect(budget.spent).toBe(1);
    expect(records[0]!.ok).toBe(false);

    // THE LOAD-BEARING ASSERTION: a retryable failure produced ONE provider
    // request, not the repository helper's default three.
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // ...and the SDK's own retry layer was disabled on the client that made it.
    // VACUITY GUARD: a `.at(-1)` on an empty array would make the negative form
    // of this assertion (used below) pass by testing nothing.
    expect(clientOptions.length).toBeGreaterThan(0);
    expect(clientOptions.at(-1)?.maxRetries).toBe(0);

    // The scope is closed again on the failing exit path.
    expect(g.isLiveEvalSingleAttempt()).toBe(false);
  }, SLOW);

  it('DISCRIMINATION — outside the scope the SAME failure retries and the SDK default returns', async () => {
    // Without this counterpart the test above would pass against an adapter that
    // simply never retried, proving nothing about the scope.
    const g = await loadGraph();
    expect(g.isLiveEvalSingleAttempt()).toBe(false);

    await expect(
      g.chatWithToolsAnthropic({ ...args(), model: 'claude-sonnet-4-6' } as never),
    ).rejects.toBeTruthy();

    expect(mockCreate.mock.calls.length).toBeGreaterThan(1);
    // Production default preserved: the adapter passes no maxRetries at all.
    expect(clientOptions.length).toBeGreaterThan(0);
    expect(clientOptions.at(-1)).not.toHaveProperty('maxRetries');
  }, SLOW);

  it('RESTORATION — after a failing scoped dispatch the default client configuration comes back', async () => {
    const g = await loadGraph();
    const budget = new g.AttemptBudget(1);
    const capture = { question: 'q', freshness: 'none' as const, args: args() };

    await g.dispatchBounded(
      [{ arm: 'candidate' as const, capture, args: capture.args }],
      (a: ChatWithToolsArgs): Promise<ChatWithToolsResult> =>
        g.chatWithToolsAnthropic({ ...a, model: 'claude-sonnet-4-6' } as never),
      budget,
    );
    expect(clientOptions.at(-1)?.maxRetries).toBe(0);
    const scopedCalls = mockCreate.mock.calls.length;
    expect(scopedCalls).toBe(1);

    // A later call, outside the released scope, must get an ordinary client back.
    // A leaked scope would silently disable retries for the rest of the process.
    await expect(
      g.chatWithToolsAnthropic({ ...args(), model: 'claude-sonnet-4-6' } as never),
    ).rejects.toBeTruthy();
    expect(clientOptions.length).toBeGreaterThan(1);
    expect(clientOptions.at(-1)).not.toHaveProperty('maxRetries');
    expect(mockCreate.mock.calls.length).toBeGreaterThan(scopedCalls + 1);
  }, SLOW);
});
