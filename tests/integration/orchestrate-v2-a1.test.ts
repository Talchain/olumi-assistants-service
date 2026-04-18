/**
 * V5 slice A1 — integration tests for POST /orchestrate/v2/turn.
 *
 * Replays the 4 A1 fixtures under tests/fixtures/contracts/b1/slice-a1/ through
 * the real route handler with the LLM adapter mocked at the `getAdapter` seam
 * (Paul's constraint 9 — no live provider calls in the acceptance pack).
 *
 * A2 update: a classifier LLM call now runs before narrate. The mock
 * distinguishes classify calls (`args.responseFormat === 'json_object'`) from
 * narrate calls. A1 fixtures were all direct_answer, so the classifier mock
 * always returns `{"turn_class":"direct_answer"}` here — fixture intent is
 * unchanged. `llm_calls_used` expectation is updated from 1 → 2 (classify +
 * narrate), which is semantically accurate post-A2.
 *
 * Verifies for each fixture:
 *   - HTTP 200
 *   - OlumiResponse parses against @talchain/schemas/boundary
 *   - turn_executor.started / .completed events fire exactly once each
 *   - response_emitted is always true (BI-01)
 *   - failure_type matches the fixture expectation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { setTestSink } from '../../src/utils/telemetry.js';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX_DIR = join(__dirname, '..', 'fixtures', 'contracts', 'b1', 'slice-a1');

interface A1Fixture {
  _meta: { fixture_id: string; expected_result_class: string };
  request: Record<string, unknown>;
  mock: {
    narrate_output?: string;
    narrate_throws?: string;
    narrate_delay_ms?: number;
    env?: Record<string, string>;
  };
  expected: {
    status: number;
    body?: Record<string, unknown>;
    body_shape?: Record<string, unknown>;
    telemetry: Record<string, unknown>;
  };
}

function loadFixture(name: string): A1Fixture {
  return JSON.parse(readFileSync(join(FIX_DIR, name), 'utf8')) as A1Fixture;
}

// ---------------------------------------------------------------------------
// Mock LLM adapter + prompt loader at module seam.
//
// A2: the same mock serves both classify (JSON mode) and narrate. The
// classify path always returns the direct_answer turn class for A1 fixtures —
// A1 was direct-answer-only so that's the intended routing.
// ---------------------------------------------------------------------------

type Phase = 'classify' | 'narrate';
interface PhaseState {
  output: string;
  throws?: 'NarrateTimeoutError' | 'generic';
  delayMs: number;
}
const phaseState: Record<Phase, PhaseState> = {
  classify: { output: '{"turn_class":"direct_answer"}', delayMs: 0 },
  narrate: { output: '', delayMs: 0 },
};

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test-a1-mock',
    chat: async (
      args: { responseFormat?: string },
      opts: { signal?: AbortSignal },
    ) => {
      const phase: Phase = args.responseFormat === 'json_object' ? 'classify' : 'narrate';
      const m = phaseState[phase];
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (m.throws === 'NarrateTimeoutError') {
            import('../../src/adapters/llm/errors.js').then((errs) => {
              reject(new errs.UpstreamTimeoutError('test timeout', phase, 1));
            });
            return;
          }
          if (m.throws === 'generic') {
            reject(new Error('test generic error'));
            return;
          }
          resolve();
        }, m.delayMs);
        opts.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          const abort = new Error('abort');
          (abort as Error & { name: string }).name = 'AbortError';
          reject(abort);
        });
      });
      return {
        content: m.output,
        usage: { input_tokens: 1, output_tokens: 1 },
        model: 'test-a1-mock',
        latencyMs: 0,
      };
    },
  }),
}));

vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

// Slice B: mock the V5 session store so the integration tests don't try to
// reach Supabase. Every mocked method is a no-op; Slice B behaviour is
// covered by dedicated session unit + integration tests.
vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

let v5Enabled = true;
vi.mock('../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'orchestratorV5') return v5Enabled;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../src/orchestrator/route-v2.js');

// ---------------------------------------------------------------------------
// Telemetry sink
// ---------------------------------------------------------------------------

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];
function installSink(): void {
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
}
function uninstallSink(): void {
  setTestSink(null);
}
function turnExecutorEvents(kind: 'started' | 'completed'): Event[] {
  return events.filter((e) => e.event === `turn_executor.${kind}`);
}

function resetPhases(): void {
  phaseState.classify = { output: '{"turn_class":"direct_answer"}', delayMs: 0 };
  phaseState.narrate = { output: '', delayMs: 0 };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /orchestrate/v2/turn — slice A1 fixtures', () => {
  let app: FastifyInstance;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    v5Enabled = true;
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
    installSink();
  });
  afterAll(async () => {
    uninstallSink();
    await app.close();
  });
  beforeEach(() => {
    events = [];
    process.env = { ...originalEnv };
    resetPhases();
  });

  it('happy path: fixture emits a valid OlumiResponse + exactly-one completed event', async () => {
    const fx = loadFixture('direct-answer-happy.json');
    phaseState.narrate.output = fx.mock.narrate_output!;
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: fx.request,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const parsed = OlumiResponseSchema.parse(body);
    expect(parsed.assistant_text).toBe(fx.expected.body!.assistant_text);
    expect(parsed.blocks).toEqual([]);
    expect(parsed.suggested_actions).toEqual([]);
    expect(parsed.insights).toEqual([]);
    expect(parsed.stage_indicator).toBe('frame');

    expect(turnExecutorEvents('started')).toHaveLength(1);
    const completed = turnExecutorEvents('completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.data.response_emitted).toBe(true);
    expect(completed[0]!.data.failure_type).toBeNull();
    expect(completed[0]!.data.commit_performed).toBe(true);
    // A2: classifier + narrate = 2 LLM calls on happy path
    expect(completed[0]!.data.llm_calls_used).toBe(2);
    expect(completed[0]!.data.turn_class).toBe('direct_answer');
  });

  it('llm-timeout fixture: UPSTREAM_TIMEOUT envelope, commit not performed', async () => {
    const fx = loadFixture('direct-answer-llm-timeout.json');
    phaseState.narrate.throws = 'NarrateTimeoutError';
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: fx.request,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const parsed = OlumiResponseSchema.parse(body);
    expect(parsed.blocks).toHaveLength(1);
    const block = parsed.blocks[0]!;
    expect(block.type).toBe('error');
    if (block.type === 'error') {
      expect(block.error_code).toBe('UPSTREAM_TIMEOUT');
      expect(block.severity).toBe('error');
    }

    const completed = turnExecutorEvents('completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.data.response_emitted).toBe(true);
    expect(completed[0]!.data.failure_type).toBe('UPSTREAM_TIMEOUT');
    expect(completed[0]!.data.commit_performed).toBe(false);
  });

  it('budget-exceeded fixture: BUDGET_EXCEEDED wins over any inner timeout', async () => {
    const fx = loadFixture('direct-answer-budget-exceeded.json');
    for (const [k, v] of Object.entries(fx.mock.env ?? {})) {
      process.env[k] = v;
    }
    phaseState.narrate.output = fx.mock.narrate_output!;
    // A2: classifier is the first LLM call — make it the slow one so the
    // outer budget trips while classifier waits. Fixture already sets an
    // aggressive TURN_BUDGET_MS.
    phaseState.classify.delayMs = fx.mock.narrate_delay_ms ?? 100;

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: fx.request,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const parsed = OlumiResponseSchema.parse(body);
    const block = parsed.blocks[0]!;
    expect(block.type).toBe('error');
    if (block.type === 'error') {
      expect(block.error_code).toBe('TURN_BUDGET_EXCEEDED');
    }
    const completed = turnExecutorEvents('completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.data.failure_type).toBe('TURN_BUDGET_EXCEEDED');
    expect(completed[0]!.data.commit_performed).toBe(false);
  });

  it('contamination fixture: sanitised text, response stays a success', async () => {
    const fx = loadFixture('direct-answer-contamination.json');
    phaseState.narrate.output = fx.mock.narrate_output!;
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: fx.request,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const parsed = OlumiResponseSchema.parse(body);
    // Text was contaminated; sanitiser stripped tags + em-dashes.
    expect(parsed.assistant_text).not.toMatch(/<[a-zA-Z]|\u2014/);
    expect(parsed.assistant_text).toContain('two forces');
    expect(parsed.blocks).toEqual([]);

    const contam = events.filter(
      (e) => e.event === 'turn_executor.contamination_narrate',
    );
    expect(contam).toHaveLength(1);

    const completed = turnExecutorEvents('completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.data.failure_type).toBeNull();
    expect(completed[0]!.data.commit_performed).toBe(true);
  });

  // Missing-owner detector: every `started` has a matching `completed` with
  // response_emitted=true across the whole fixture replay.
  it('BI-01 missing-owner detector: every started has a matching completed', async () => {
    const fixtures = [
      'direct-answer-happy.json',
      'direct-answer-llm-timeout.json',
      'direct-answer-contamination.json',
    ];
    for (const name of fixtures) {
      const fx = loadFixture(name);
      resetPhases();
      phaseState.narrate.output = fx.mock.narrate_output ?? '';
      phaseState.narrate.throws = fx.mock.narrate_throws === 'NarrateTimeoutError'
        ? 'NarrateTimeoutError'
        : undefined;
      await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: fx.request,
      });
    }
    const started = turnExecutorEvents('started');
    const completed = turnExecutorEvents('completed');
    expect(started).toHaveLength(3);
    expect(completed).toHaveLength(3);
    for (const c of completed) {
      expect(c.data.response_emitted).toBe(true);
    }
  });
});
