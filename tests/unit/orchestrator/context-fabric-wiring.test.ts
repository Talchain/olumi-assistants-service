/**
 * Context Fabric Wiring Tests
 *
 * Verifies Context Fabric integration in the turn handler:
 * 1. Flag off → falls back to simple prompt assembly
 * 2. Flag on → uses fabric context as system prompt
 * 3. Flag on + assembleContext throws → graceful fallback
 * 4. Context hash in lineage from fabric when active
 * 5. Route is always 'CHAT' for LLM dispatch
 * 6. No double context injection (only current message when fabric active)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mocks — vi.hoisted() ensures these are available to hoisted vi.mock factories
// ============================================================================

const { mockChatWithTools, mockChat, mockLogWarn, mockLogInfo, mockAssembleContext } = vi.hoisted(() => ({
  mockChatWithTools: vi.fn(),
  mockChat: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogInfo: vi.fn(),
  mockAssembleContext: vi.fn(),
}));

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({
    name: 'test-adapter',
    model: 'test-model',
    chat: mockChat,
    chatWithTools: mockChatWithTools,
  }),
}));

vi.mock('../../../src/orchestrator/plot-client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/orchestrator/plot-client.js')>();
  return {
    ...original,
    createPLoTClient: vi.fn().mockReturnValue(null),
  };
});

vi.mock('../../../src/utils/telemetry.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/utils/telemetry.js')>();
  return {
    ...original,
    log: {
      ...original.log,
      warn: mockLogWarn,
      info: mockLogInfo,
      debug: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    isProduction: vi.fn().mockReturnValue(false),
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'orchestrator') return true;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        if (prop === 'plot') {
          return { baseUrl: undefined };
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

vi.mock('../../../src/orchestrator/context-fabric/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/orchestrator/context-fabric/index.js')>();
  // Default: delegate to real implementation; tests override with mockImplementationOnce
  mockAssembleContext.mockImplementation(original.assembleContext);
  return {
    ...original,
    assembleContext: mockAssembleContext,
  };
});

// ============================================================================
// Imports — after mocks
// ============================================================================

import { handleTurn, _resetPlotClient } from '../../../src/orchestrator/turn-handler.js';
import { _clearIdempotencyCache } from '../../../src/orchestrator/idempotency.js';
import type { OrchestratorTurnRequest, ConversationContext } from '../../../src/orchestrator/types.js';
import type { FastifyRequest } from 'fastify';

// ============================================================================
// Test Helpers
// ============================================================================

let turnCounter = 0;
let savedEnv: string | undefined;

function makeRequest(overrides?: Partial<OrchestratorTurnRequest>): OrchestratorTurnRequest {
  turnCounter++;
  return {
    message: 'help me understand the analysis',
    context: {
      graph: null,
      analysis_response: null,
      framing: { stage: 'frame' },
      messages: [],
      scenario_id: 'test-scenario',
    } as ConversationContext,
    scenario_id: 'test-scenario',
    client_turn_id: `fabric-test-${turnCounter}-${Date.now()}`,
    ...overrides,
  };
}

const mockFastifyRequest = {} as FastifyRequest;

function makeXmlEnvelope(text: string = 'Test response.'): string {
  return `<response>
  <assistant_text>${text}</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;
}

function stubLLMResponse(text: string = 'Test response.') {
  mockChatWithTools.mockResolvedValueOnce({
    content: [{ type: 'text', text: makeXmlEnvelope(text) }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
    model: 'test-model',
    latencyMs: 200,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('Context Fabric wiring in turn handler', () => {
  beforeEach(() => {
    _clearIdempotencyCache();
    _resetPlotClient();
    mockChatWithTools.mockReset();
    mockChat.mockReset();
    mockLogWarn.mockReset();
    mockLogInfo.mockReset();
    mockAssembleContext.mockClear(); // clear call history, keep implementation
    savedEnv = process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED;
  });

  afterEach(() => {
    // Restore env var
    if (savedEnv === undefined) {
      delete process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED;
    } else {
      process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED = savedEnv;
    }
  });

  // ── 1. Flag off → simple assembly fallback ──────────────────────────────

  it('uses simple prompt assembly when CEE_ORCHESTRATOR_CONTEXT_ENABLED is not set', async () => {
    delete process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED;
    stubLLMResponse();

    const result = await handleTurn(makeRequest(), mockFastifyRequest, 'req-fabric-off');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.assistant_text).toBe('Test response.');

    // lineage.context_hash should be a 32-char hex hash (from hashContext, not fabric)
    expect(result.envelope.lineage.context_hash).toMatch(/^[0-9a-f]{32}$/);

    // Verify chatWithTools was called with full history (not just current message)
    expect(mockChatWithTools).toHaveBeenCalledTimes(1);
    const callArgs = mockChatWithTools.mock.calls[0][0];
    // When fabric is off, messages include the user message from assembleMessages
    expect(callArgs.messages.length).toBeGreaterThanOrEqual(1);
  });

  // ── 2. Flag on → uses fabric context ────────────────────────────────────

  it('uses Context Fabric as system prompt when CEE_ORCHESTRATOR_CONTEXT_ENABLED=true', async () => {
    process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED = 'true';
    stubLLMResponse();

    const result = await handleTurn(makeRequest(), mockFastifyRequest, 'req-fabric-on');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.assistant_text).toBe('Test response.');

    // Verify chatWithTools was called
    expect(mockChatWithTools).toHaveBeenCalledTimes(1);
    const callArgs = mockChatWithTools.mock.calls[0][0];

    // System prompt should contain Context Fabric markers
    expect(callArgs.system).toContain('prompt version: v0.1.0-cee-fabric');
    expect(callArgs.system).toContain('canonical_state');
    expect(callArgs.system).toContain('rules_reminder');

    // Log.info should have been called with fabric assembly details
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 'req-fabric-on',
        profile: 'CHAT',
        within_budget: expect.any(Boolean),
      }),
      'Context Fabric assembled',
    );
  });

  it('accepts CEE_ORCHESTRATOR_CONTEXT_ENABLED=1 as enabled', async () => {
    process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED = '1';
    stubLLMResponse();

    const result = await handleTurn(makeRequest(), mockFastifyRequest, 'req-fabric-1');

    expect(result.httpStatus).toBe(200);

    // Verify fabric was used (system prompt contains fabric markers)
    const callArgs = mockChatWithTools.mock.calls[0][0];
    expect(callArgs.system).toContain('prompt version: v0.1.0-cee-fabric');
  });

  // ── 3. Flag on + assembleContext error → graceful fallback ──────────────

  it('falls back to simple assembly when Context Fabric throws', async () => {
    process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED = 'true';
    stubLLMResponse();

    // Force assembleContext to throw
    mockAssembleContext.mockImplementationOnce(() => {
      throw new Error('test fabric crash');
    });

    const result = await handleTurn(makeRequest(), mockFastifyRequest, 'req-fabric-fallback');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.assistant_text).toBe('Test response.');

    // Warning should be logged about the fallback
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 'req-fabric-fallback',
        error: 'test fabric crash',
      }),
      'Context Fabric assembly failed, falling back to simple prompt',
    );

    // System prompt should NOT contain fabric markers (fell back to simple assembly)
    const callArgs = mockChatWithTools.mock.calls[0][0];
    expect(callArgs.system).not.toContain('v0.1.0-cee-fabric');

    // Lineage context_hash should be 32-char (from hashContext fallback, not fabric)
    expect(result.envelope.lineage.context_hash).toMatch(/^[0-9a-f]{32}$/);
  });

  // ── 4. Context hash from fabric in lineage ──────────────────────────────

  it('lineage.context_hash is a 64-char hex SHA-256 when fabric is active', async () => {
    process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED = 'true';
    stubLLMResponse();

    const result = await handleTurn(makeRequest(), mockFastifyRequest, 'req-fabric-hash');

    expect(result.httpStatus).toBe(200);

    // When Context Fabric is active, the hash is a full SHA-256 (64 hex chars)
    // vs the simple hashContext which produces 32-char hex
    expect(result.envelope.lineage.context_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('context_hash differs between fabric-on and fabric-off', async () => {
    // First call with fabric off
    delete process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED;
    stubLLMResponse();
    const offResult = await handleTurn(makeRequest(), mockFastifyRequest, 'req-hash-off');

    // Second call with fabric on
    process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED = 'true';
    stubLLMResponse();
    const onResult = await handleTurn(makeRequest(), mockFastifyRequest, 'req-hash-on');

    // Different assembly methods produce different hashes
    expect(offResult.envelope.lineage.context_hash).not.toBe(
      onResult.envelope.lineage.context_hash,
    );

    // Off = 32-char (hashContext), On = 64-char (SHA-256)
    expect(offResult.envelope.lineage.context_hash).toHaveLength(32);
    expect(onResult.envelope.lineage.context_hash).toHaveLength(64);
  });

  // ── 5. Route is always CHAT for LLM dispatch ───────────────────────────

  it('logs profile as CHAT when fabric is active', async () => {
    process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED = 'true';
    stubLLMResponse();

    await handleTurn(makeRequest(), mockFastifyRequest, 'req-fabric-route');

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({ profile: 'CHAT' }),
      'Context Fabric assembled',
    );
  });

  // ── 6. No double context injection ──────────────────────────────────────

  it('sends only current user message when fabric is active (no history duplication)', async () => {
    process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED = 'true';
    stubLLMResponse();

    const reqWithHistory = makeRequest({
      message: 'What should I focus on?',
      context: {
        graph: null,
        analysis_response: null,
        framing: { stage: 'ideate' },
        messages: [
          { role: 'user', content: 'Prior user message' },
          { role: 'assistant', content: 'Prior assistant reply' },
        ],
        scenario_id: 'test-scenario',
      } as ConversationContext,
    });

    const result = await handleTurn(reqWithHistory, mockFastifyRequest, 'req-no-double');

    expect(result.httpStatus).toBe(200);

    // When fabric is active, only the current user message should be in messages array
    const callArgs = mockChatWithTools.mock.calls[0][0];
    expect(callArgs.messages).toHaveLength(1);
    expect(callArgs.messages[0]).toEqual({
      role: 'user',
      content: 'What should I focus on?',
    });

    // Zone 3 (in the system prompt) should contain the conversation history
    // from the sliding window — history is embedded in the system prompt, not messages
    expect(callArgs.system).toContain('Prior user message');
    expect(callArgs.system).toContain('Prior assistant reply');
  });

  it('sends full history when fabric is off', async () => {
    delete process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED;
    stubLLMResponse();

    const reqWithHistory = makeRequest({
      message: 'What should I focus on?',
      context: {
        graph: null,
        analysis_response: null,
        framing: { stage: 'ideate' },
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'First reply' },
        ],
        scenario_id: 'test-scenario',
      } as ConversationContext,
    });

    const result = await handleTurn(reqWithHistory, mockFastifyRequest, 'req-full-history');

    expect(result.httpStatus).toBe(200);

    // When fabric is off, assembleMessages includes full history + current message
    const callArgs = mockChatWithTools.mock.calls[0][0];
    expect(callArgs.messages.length).toBe(3); // 2 history + 1 current
  });

  // ── Stage mapping ───────────────────────────────────────────────────────

  it('maps evaluate stage to evaluate_pre in fabric context', async () => {
    process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED = 'true';
    stubLLMResponse();

    const req = makeRequest({
      context: {
        graph: null,
        analysis_response: null,
        framing: { stage: 'evaluate' },
        messages: [],
        scenario_id: 'test-scenario',
      } as ConversationContext,
    });

    const result = await handleTurn(req, mockFastifyRequest, 'req-stage-map');

    expect(result.httpStatus).toBe(200);

    // The system prompt should contain evaluate_pre (mapped from evaluate)
    const callArgs = mockChatWithTools.mock.calls[0][0];
    expect(callArgs.system).toContain('evaluate_pre');
  });

  // ── Graph extraction ────────────────────────────────────────────────────

  it('extracts graph summary into fabric context when graph is provided', async () => {
    process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED = 'true';
    stubLLMResponse();

    const req = makeRequest({
      context: {
        graph: {
          nodes: [
            { id: 'goal_1', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
            { id: 'opt_a', kind: 'option', label: 'Option A' },
            { id: 'fac_1', kind: 'factor', label: 'Market Size' },
          ],
          edges: [
            { from: 'opt_a', to: 'fac_1', strength: { mean: 0.7, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
          ],
        },
        analysis_response: null,
        framing: { stage: 'ideate' },
        messages: [],
        scenario_id: 'test-scenario',
      } as ConversationContext,
    });

    const result = await handleTurn(req, mockFastifyRequest, 'req-graph-extract');

    expect(result.httpStatus).toBe(200);

    // System prompt should contain graph info from canonical_state
    const callArgs = mockChatWithTools.mock.calls[0][0];
    expect(callArgs.system).toContain('3 nodes');
    expect(callArgs.system).toContain('1 edges');
    expect(callArgs.system).toContain('goal_1');
  });

  // ── run_analysis skips Context Fabric ───────────────────────────────────

  it('deterministic run_analysis does not invoke Context Fabric', async () => {
    process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED = 'true';

    // "run the analysis" routes deterministically to run_analysis.
    // Needs graph so prerequisite passes (graph != null).
    // PLoT client is null (mock), so it will return an error envelope — that's fine,
    // the assertion is that assembleContext was never called.
    const req = makeRequest({
      message: 'run the analysis',
      context: {
        graph: { nodes: [{ id: 'g1', kind: 'goal', label: 'G' }], edges: [] } as any,
        analysis_response: null,
        framing: { stage: 'evaluate' },
        messages: [],
        scenario_id: 'test-scenario',
      } as ConversationContext,
    });
    const result = await handleTurn(req, mockFastifyRequest, 'req-run-analysis');

    // run_analysis fails because PLoT client is null — expected
    expect(result.httpStatus).toBe(502);

    // Context Fabric should NOT have been invoked (deterministic path skips dispatchViaLLM)
    expect(mockAssembleContext).not.toHaveBeenCalled();
  });
});
