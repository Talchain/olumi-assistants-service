/**
 * V5 slice A2 — integration tests for POST /orchestrate/v2/turn (clarify).
 *
 * Replays the 3 A2 fixtures under tests/fixtures/contracts/b1/slice-a2/ through
 * the real route handler with the LLM adapter mocked at the `getAdapter` seam.
 * The mock distinguishes classifier calls (`args.responseFormat === 'json_object'`)
 * from narrate calls.
 *
 * Verifies for each fixture:
 *   - HTTP 200
 *   - OlumiResponse parses against @talchain/schemas/boundary
 *   - turn_executor.started / .completed events fire exactly once each
 *   - response_emitted is always true (BI-01)
 *   - completed.data.turn_class = 'clarify' (A2 telemetry)
 *   - failure_type matches the fixture expectation
 *
 * No V4 baseline for clarify (Paul's correction on Target 6). Coverage is
 * fixture-based only.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { setTestSink } from '../../src/utils/telemetry.js';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX_DIR = join(__dirname, '..', 'fixtures', 'contracts', 'b1', 'slice-a2');

interface A2Fixture {
  _meta: { fixture_id: string; expected_result_class: string };
  request: Record<string, unknown>;
  mock: {
    classify_output?: string;
    narrate_output?: string;
    narrate_throws?: string;
    classify_throws?: string;
    env?: Record<string, string>;
  };
  expected: {
    status: number;
    body?: Record<string, unknown>;
    body_shape?: Record<string, unknown>;
    telemetry: Record<string, unknown>;
  };
}

function loadFixture(name: string): A2Fixture {
  return JSON.parse(readFileSync(join(FIX_DIR, name), 'utf8')) as A2Fixture;
}

// ---------------------------------------------------------------------------
// Phase-aware mock: classify vs narrate routed by responseFormat
// ---------------------------------------------------------------------------

type Phase = 'classify' | 'narrate';
interface PhaseState {
  output: string;
  throws?: 'NarrateTimeoutError' | 'generic';
}
const phaseState: Record<Phase, PhaseState> = {
  classify: { output: '{"turn_class":"clarify"}' },
  narrate: { output: '' },
};

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test-a2-mock',
    chat: async (args: { responseFormat?: string }) => {
      const phase: Phase = args.responseFormat === 'json_object' ? 'classify' : 'narrate';
      const m = phaseState[phase];
      if (m.throws === 'NarrateTimeoutError') {
        const errs = await import('../../src/adapters/llm/errors.js');
        throw new errs.UpstreamTimeoutError('test timeout', phase, 1);
      }
      if (m.throws === 'generic') {
        throw new Error('test generic error');
      }
      return {
        content: m.output,
        usage: { input_tokens: 1, output_tokens: 1 },
        model: 'test-a2-mock',
        latencyMs: 0,
      };
    },
  }),
}));

vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
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
  phaseState.classify = { output: '{"turn_class":"clarify"}' };
  phaseState.narrate = { output: '' };
}

describe('POST /orchestrate/v2/turn — slice A2 clarify fixtures', () => {
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

  it('clarify-happy: ambiguous input → 200 + clarify envelope, commit performed', async () => {
    const fx = loadFixture('clarify-happy.json');
    phaseState.classify.output = fx.mock.classify_output!;
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
    expect(completed[0]!.data.llm_calls_used).toBe(2);
    expect(completed[0]!.data.turn_class).toBe('clarify');
    const stages = completed[0]!.data.stages_completed as string[];
    expect(stages).toContain('classify');
    expect(stages).toContain('dispatch');
    expect(stages).toContain('compose');
    expect(stages).toContain('commit');
  });

  it('clarify-llm-timeout: narrate timeout → UPSTREAM_TIMEOUT envelope, turn_class=clarify', async () => {
    const fx = loadFixture('clarify-llm-timeout.json');
    phaseState.classify.output = fx.mock.classify_output!;
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
    // turn_class reflects the classifier decision even when narrate fails.
    expect(completed[0]!.data.turn_class).toBe('clarify');
  });

  it('clarify-contamination: sanitiser strips tags + em-dashes, response succeeds', async () => {
    const fx = loadFixture('clarify-contamination.json');
    phaseState.classify.output = fx.mock.classify_output!;
    phaseState.narrate.output = fx.mock.narrate_output!;

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: fx.request,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const parsed = OlumiResponseSchema.parse(body);
    expect(parsed.assistant_text).not.toMatch(/<[a-zA-Z]|\u2014/);
    expect(parsed.assistant_text).toContain("What is the decision you're weighing");
    expect(parsed.blocks).toEqual([]);

    const contam = events.filter((e) => e.event === 'turn_executor.contamination_narrate');
    expect(contam).toHaveLength(1);
    expect(contam[0]!.data.turn_class).toBe('clarify');

    const completed = turnExecutorEvents('completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.data.failure_type).toBeNull();
    expect(completed[0]!.data.commit_performed).toBe(true);
    expect(completed[0]!.data.turn_class).toBe('clarify');
  });

  // BI-01 across the A2 fixture set — every started has a matching completed.
  it('BI-01 missing-owner detector: all A2 clarify fixtures', async () => {
    const fixtures: Array<[string, () => void]> = [
      ['clarify-happy.json', () => {
        phaseState.classify.output = '{"turn_class":"clarify"}';
        phaseState.narrate.output = 'What decision?';
      }],
      ['clarify-llm-timeout.json', () => {
        phaseState.classify.output = '{"turn_class":"clarify"}';
        phaseState.narrate.throws = 'NarrateTimeoutError';
      }],
      ['clarify-contamination.json', () => {
        phaseState.classify.output = '{"turn_class":"clarify"}';
        phaseState.narrate.output = '<t>x</t>What are you deciding?';
      }],
    ];
    for (const [name, setup] of fixtures) {
      resetPhases();
      setup();
      const fx = loadFixture(name);
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
