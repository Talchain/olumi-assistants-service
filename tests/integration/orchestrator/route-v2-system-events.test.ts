/**
 * Task 1 — route-level tests for V5 system-event dispatch.
 *
 * Validates that /orchestrate/v2/turn intercepts kind: 'system_event'
 * payloads BEFORE TurnExecutor and produces 200 acknowledgements via the
 * deterministic dispatcher. Six event kinds covered:
 *   - patch_accepted, patch_dismissed, direct_graph_edit, chip_click → commit
 *   - undo, redo → no commit (client-only), skip reason recognised by route
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// -------- Mocks --------
// Session store mock: append records append calls so we can assert which
// events committed. readRecent / checkScenarioExists return minimal happy-
// path values so pre-flight passes.
const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// Make sure TurnExecutor is NEVER called for system events — assertions below
// `expect(runTurnExecutorSpy).not.toHaveBeenCalled()` cover this invariant.
// We can't vi.spy on the real module easily, so we instead check that the
// route never invokes runTurnExecutor by monkey-patching through the module
// graph: the simplest guard is to assert the LLM adapter was NOT reached
// (TurnExecutor's ORIENT step calls it; system events never should).
const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: llmChatMock,
    chatWithTools: llmChatMock,
  }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

// V5 route registration flag ON.
vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'pipelineV4Enabled') return false;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

// -------- Test setup --------
const SCENARIO_ID = '22222222-2222-4222-8222-222222222222';
const TURN_ID_BASE = '11111111-1111-4111-8111-11111111111';

function makeSystemEventPayload(
  event: Record<string, unknown>,
  turnIdSuffix: string,
): Record<string, unknown> {
  return {
    kind: 'system_event',
    turn_id: `${TURN_ID_BASE}${turnIdSuffix}`,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    event,
  };
}

describe('POST /orchestrate/v2/turn — system event dispatch', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    appendMock.mockClear();
    llmChatMock.mockClear();
  });

  it('patch_accepted → 200 + empty acknowledgement + commit fires', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: makeSystemEventPayload({ kind: 'patch_accepted', patch_id: 'patch-1' }, '0'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.response_version).toBe(2);
    expect(body.assistant_text).toBe('');
    expect(body.blocks).toEqual([]);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it('patch_dismissed → 200 + empty acknowledgement + commit fires', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: makeSystemEventPayload({ kind: 'patch_dismissed', patch_id: 'patch-2' }, '1'),
    });
    expect(res.statusCode).toBe(200);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it('direct_graph_edit → 200 + commit fires', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: makeSystemEventPayload(
        { kind: 'direct_graph_edit', target_id: 'node-1', operation: 'update_value' },
        '2',
      ),
    });
    expect(res.statusCode).toBe(200);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it('chip_click → 200 + commit fires', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: makeSystemEventPayload({ kind: 'chip_click', chip_id: 'chip-1' }, '3'),
    });
    expect(res.statusCode).toBe(200);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it('undo → 200 + NO commit (client-only event)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: makeSystemEventPayload({ kind: 'undo' }, '4'),
    });
    expect(res.statusCode).toBe(200);
    expect(appendMock).not.toHaveBeenCalled();
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it('redo → 200 + NO commit (client-only event)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: makeSystemEventPayload({ kind: 'redo' }, '5'),
    });
    expect(res.statusCode).toBe(200);
    expect(appendMock).not.toHaveBeenCalled();
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it('selection_change → 200 + NO commit (client-only event)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: makeSystemEventPayload(
        { kind: 'selection_change', selected: [{ id: 'node-1', kind: 'factor' }] },
        '7',
      ),
    });
    expect(res.statusCode).toBe(200);
    expect(appendMock).not.toHaveBeenCalled();
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it('selection_change cleared → 200 + NO commit (client-only event)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: makeSystemEventPayload(
        { kind: 'selection_change', selected: [], cleared: true },
        '8',
      ),
    });
    expect(res.statusCode).toBe(200);
    expect(appendMock).not.toHaveBeenCalled();
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it('system event with malformed event kind → 422 BoundaryError', async () => {
    const payload = makeSystemEventPayload(
      { kind: 'not_a_real_event', foo: 'bar' },
      '6',
    );
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload,
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INGRESS_CONTRACT_VIOLATION');
    expect(appendMock).not.toHaveBeenCalled();
  });
});
