/**
 * Turn Handler Integration Tests
 *
 * Verifies the full parse → assemble pipeline through handleTurn():
 * - LLM XML envelope → parseLLMResponse → assembleEnvelope → OrchestratorResponseEnvelope
 * - Parser and assembler run for real; only the LLM adapter is stubbed
 * - Covers: text-only responses, parse warning logging, and debug field suppression
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks — vi.hoisted() ensures these are available to hoisted vi.mock factories
// ============================================================================

const { mockChatWithTools, mockChat, mockLogWarn, mockRunUnifiedPipeline } = vi.hoisted(() => ({
  mockChatWithTools: vi.fn(),
  mockChat: vi.fn(),
  mockLogWarn: vi.fn(),
  mockRunUnifiedPipeline: vi.fn(),
}));

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({
    name: 'test-adapter',
    model: 'test-model',
    chat: mockChat,
    chatWithTools: mockChatWithTools,
  }),
}));

vi.mock('../../src/orchestrator/plot-client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/orchestrator/plot-client.js')>();
  return {
    ...original,
    createPLoTClient: vi.fn().mockReturnValue(null),
  };
});

vi.mock('../../src/utils/telemetry.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/utils/telemetry.js')>();
  return {
    ...original,
    log: {
      ...original.log,
      warn: mockLogWarn,
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config/index.js')>();
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

vi.mock('../../src/cee/unified-pipeline/index.js', () => ({
  runUnifiedPipeline: mockRunUnifiedPipeline,
}));

// ============================================================================
// Imports — after mocks
// ============================================================================

import { handleTurn, _resetPlotClient } from '../../src/orchestrator/turn-handler.js';
import { _clearIdempotencyCache } from '../../src/orchestrator/idempotency.js';
import { createPLoTClient } from '../../src/orchestrator/plot-client.js';
import { isProduction } from '../../src/config/index.js';
import type { OrchestratorTurnRequest, ConversationContext } from '../../src/orchestrator/types.js';
import type { PLoTClient } from '../../src/orchestrator/plot-client.js';
import type { FastifyRequest } from 'fastify';

// ============================================================================
// Test Helpers
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let turnCounter = 0;

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
    client_turn_id: `test-turn-${turnCounter}-${Date.now()}`,
    ...overrides,
  };
}

const mockFastifyRequest = {} as FastifyRequest;

/** Build a well-formed XML envelope as the LLM would produce. */
function makeXmlEnvelope(opts: {
  diagnostics?: string;
  assistantText?: string;
  blocks?: string;
  suggestedActions?: string;
} = {}): string {
  const diag = opts.diagnostics !== undefined
    ? `<diagnostics>${opts.diagnostics}</diagnostics>\n`
    : '';
  const text = opts.assistantText ?? 'Here is a test response.';
  const blocks = opts.blocks ?? '';
  const actions = opts.suggestedActions ?? '';

  return `${diag}<response>
  <assistant_text>${text}</assistant_text>
  <blocks>${blocks}</blocks>
  <suggested_actions>${actions}</suggested_actions>
</response>`;
}

// ============================================================================
// Tests
// ============================================================================

describe('handleTurn — parse → assemble integration', () => {
  beforeEach(() => {
    _clearIdempotencyCache();
    mockChatWithTools.mockReset();
    mockChat.mockReset();
    mockLogWarn.mockReset();
    vi.mocked(isProduction).mockReturnValue(false);
  });

  it('returns a valid OrchestratorResponseEnvelope for a text-only LLM response', async () => {
    const xmlResponse = makeXmlEnvelope({
      diagnostics: 'Route: conversational. No tool needed.',
      assistantText: 'Here is a test response.',
      suggestedActions: `
        <action>
          <role>facilitator</role>
          <label>Next step</label>
          <message>What would you like to do next?</message>
        </action>`,
    });

    mockChatWithTools.mockResolvedValueOnce({
      content: [{ type: 'text', text: xmlResponse }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
      model: 'test-model',
      latencyMs: 200,
    });

    const result = await handleTurn(makeRequest(), mockFastifyRequest, 'req-test-001');

    expect(result.httpStatus).toBe(200);

    const env = result.envelope;

    // turn_id is a UUID
    expect(env.turn_id).toMatch(UUID_RE);

    // assistant_text from the XML envelope
    expect(env.assistant_text).toBe('Here is a test response.');

    // blocks is an empty array (no AI-authored blocks in this response)
    expect(env.blocks).toEqual([]);

    // suggested_actions parsed from XML
    expect(env.suggested_actions).toHaveLength(1);
    expect(env.suggested_actions![0].label).toBe('Next step');
    expect(env.suggested_actions![0].prompt).toBe('What would you like to do next?');
    expect(env.suggested_actions![0].role).toBe('facilitator');

    // lineage.context_hash is a 32-char hex string
    expect(env.lineage.context_hash).toMatch(/^[0-9a-f]{32}$/);

    // turn_plan reflects LLM routing with no tool selected
    expect(env.turn_plan).toBeDefined();
    expect(env.turn_plan!.routing).toBe('llm');
    expect(env.turn_plan!.selected_tool).toBeNull();

    // Debug fields included because isProduction() returns false
    expect(env.diagnostics).toBe('Route: conversational. No tool needed.');
  });

  it('returns envelope with empty blocks and actions when LLM returns minimal XML', async () => {
    const xmlResponse = makeXmlEnvelope({
      assistantText: 'Just a simple reply.',
    });

    mockChatWithTools.mockResolvedValueOnce({
      content: [{ type: 'text', text: xmlResponse }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 25 },
      model: 'test-model',
      latencyMs: 100,
    });

    const result = await handleTurn(makeRequest(), mockFastifyRequest, 'req-test-002');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.assistant_text).toBe('Just a simple reply.');
    expect(result.envelope.blocks).toEqual([]);
    expect(result.envelope.suggested_actions).toBeUndefined();
  });

  it('handles plain text response (no XML envelope) with parse warnings', async () => {
    mockChatWithTools.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Just plain text, no XML at all.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 25 },
      model: 'test-model',
      latencyMs: 100,
    });

    const result = await handleTurn(makeRequest(), mockFastifyRequest, 'req-test-003');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.assistant_text).toBe('Just plain text, no XML at all.');
    expect(result.envelope.blocks).toEqual([]);

    // parse_warnings included in debug mode (isProduction = false)
    expect(result.envelope.parse_warnings).toBeDefined();
    expect(result.envelope.parse_warnings).toContain(
      'No <response> envelope found — treating as plain text',
    );
  });

  it('extracts AI-authored commentary blocks from XML and converts to ConversationBlock[]', async () => {
    const xmlResponse = makeXmlEnvelope({
      assistantText: 'Analysis summary follows.',
      blocks: `
        <block>
          <type>commentary</type>
          <title>Key Insight</title>
          <content>Revenue is the dominant driver.</content>
        </block>`,
    });

    mockChatWithTools.mockResolvedValueOnce({
      content: [{ type: 'text', text: xmlResponse }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 80 },
      model: 'test-model',
      latencyMs: 150,
    });

    const result = await handleTurn(makeRequest(), mockFastifyRequest, 'req-test-004');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.blocks).toHaveLength(1);

    const block = result.envelope.blocks[0];
    expect(block.block_type).toBe('commentary');
    expect(block.block_id).toMatch(/^blk_commentary_/);
    expect(block.provenance.trigger).toBe('llm:xml');
    expect((block.data as { narrative: string }).narrative).toBe('Revenue is the dominant driver.');
  });

  it('unescapes XML entities in the parsed assistant_text', async () => {
    const xmlResponse = makeXmlEnvelope({
      assistantText: 'Revenue &gt; $1M &amp; growing &lt;fast&gt;',
    });

    mockChatWithTools.mockResolvedValueOnce({
      content: [{ type: 'text', text: xmlResponse }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 30 },
      model: 'test-model',
      latencyMs: 100,
    });

    const result = await handleTurn(makeRequest(), mockFastifyRequest, 'req-test-005');

    expect(result.envelope.assistant_text).toBe('Revenue > $1M & growing <fast>');
  });

  it('context_hash is deterministic for the same context', async () => {
    const xmlResponse = makeXmlEnvelope({ assistantText: 'reply' });
    const llmResult = {
      content: [{ type: 'text' as const, text: xmlResponse }],
      stop_reason: 'end_turn' as const,
      usage: { input_tokens: 50, output_tokens: 25 },
      model: 'test-model',
      latencyMs: 100,
    };

    mockChatWithTools.mockResolvedValueOnce(llmResult);
    const result1 = await handleTurn(makeRequest(), mockFastifyRequest, 'req-test-006a');

    mockChatWithTools.mockResolvedValueOnce(llmResult);
    const result2 = await handleTurn(makeRequest(), mockFastifyRequest, 'req-test-006b');

    expect(result1.envelope.lineage.context_hash).toBe(result2.envelope.lineage.context_hash);
  });

  it('stage_indicator reflects framing context', async () => {
    const xmlResponse = makeXmlEnvelope({ assistantText: 'evaluating' });

    mockChatWithTools.mockResolvedValueOnce({
      content: [{ type: 'text', text: xmlResponse }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 25 },
      model: 'test-model',
      latencyMs: 100,
    });

    const req = makeRequest({
      context: {
        graph: null,
        analysis_response: null,
        framing: { stage: 'evaluate' },
        messages: [],
        scenario_id: 'test-scenario',
      } as ConversationContext,
    });

    const result = await handleTurn(req, mockFastifyRequest, 'req-test-007');

    expect(result.envelope.stage_indicator).toBe('evaluate');
    expect(result.envelope.stage_label).toBe('Evaluating options');
  });

  it('calls log.warn with parse warnings when XML envelope is missing', async () => {
    mockChatWithTools.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Plain text without XML.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 25 },
      model: 'test-model',
      latencyMs: 100,
    });

    await handleTurn(makeRequest(), mockFastifyRequest, 'req-test-008');

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 'req-test-008',
        parse_warnings: expect.arrayContaining([
          'No <response> envelope found — treating as plain text',
        ]),
      }),
      'XML envelope parse warnings',
    );
  });

  it('suppresses debug fields when isProduction() returns true', async () => {
    vi.mocked(isProduction).mockReturnValue(true);

    const xmlResponse = makeXmlEnvelope({
      diagnostics: 'Route: conversational.',
      assistantText: 'Production response.',
    });

    mockChatWithTools.mockResolvedValueOnce({
      content: [{ type: 'text', text: xmlResponse }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 25 },
      model: 'test-model',
      latencyMs: 100,
    });

    const result = await handleTurn(makeRequest(), mockFastifyRequest, 'req-test-009');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.assistant_text).toBe('Production response.');

    // Debug fields must NOT be present in production
    expect(result.envelope.diagnostics).toBeUndefined();
    expect(result.envelope.parse_warnings).toBeUndefined();
  });
});

// ============================================================================
// Intent Gate Integration Tests
// ============================================================================

describe('handleTurn — intent gate integration', () => {
  beforeEach(() => {
    _clearIdempotencyCache();
    mockChatWithTools.mockReset();
    mockChat.mockReset();
    mockLogWarn.mockReset();
    mockRunUnifiedPipeline.mockReset();
    vi.mocked(isProduction).mockReturnValue(false);
  });

  it('"brief" with prerequisites met → deterministic routing, chatWithTools NOT called', async () => {
    const req = makeRequest({
      message: 'brief',
      context: {
        graph: { nodes: [], edges: [] },
        analysis_response: {
          decision_brief: { headline: 'Test brief summary' },
          meta: { seed_used: 42, n_samples: 1000, response_hash: 'abc123' },
          results: [],
        },
        framing: { stage: 'evaluate' },
        messages: [],
        scenario_id: 'test-scenario',
      } as ConversationContext,
    });

    const result = await handleTurn(req, mockFastifyRequest, 'req-gate-001');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.turn_plan).toBeDefined();
    expect(result.envelope.turn_plan!.routing).toBe('deterministic');
    expect(result.envelope.turn_plan!.selected_tool).toBe('generate_brief');
    expect(mockChatWithTools).not.toHaveBeenCalled();

    // Brief block produced by handleGenerateBrief
    expect(result.envelope.blocks).toHaveLength(1);
    expect(result.envelope.blocks[0].block_type).toBe('brief');
  });

  it('"edit" with graph: null → prerequisites not met, falls to LLM', async () => {
    const xmlResponse = makeXmlEnvelope({ assistantText: 'You need a model first.' });
    mockChatWithTools.mockResolvedValueOnce({
      content: [{ type: 'text', text: xmlResponse }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 25 },
      model: 'test-model',
      latencyMs: 100,
    });

    const req = makeRequest({
      message: 'edit',
      context: {
        graph: null,
        analysis_response: null,
        framing: { stage: 'frame' },
        messages: [],
        scenario_id: 'test-scenario',
      } as ConversationContext,
    });

    const result = await handleTurn(req, mockFastifyRequest, 'req-gate-002');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.turn_plan!.routing).toBe('llm');
    expect(result.envelope.turn_plan!.selected_tool).toBeNull();
    expect(mockChatWithTools).toHaveBeenCalled();
  });

  it('conversational message → LLM routing', async () => {
    const xmlResponse = makeXmlEnvelope({ assistantText: 'Let me help you decide.' });
    mockChatWithTools.mockResolvedValueOnce({
      content: [{ type: 'text', text: xmlResponse }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 25 },
      model: 'test-model',
      latencyMs: 100,
    });

    const req = makeRequest({
      message: 'What do you think about this decision?',
    });

    const result = await handleTurn(req, mockFastifyRequest, 'req-gate-003');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.turn_plan!.routing).toBe('llm');
    expect(mockChatWithTools).toHaveBeenCalled();
  });

  it('"brief" with graph: null → prerequisites not met, falls to LLM', async () => {
    const xmlResponse = makeXmlEnvelope({ assistantText: 'Build a model first.' });
    mockChatWithTools.mockResolvedValueOnce({
      content: [{ type: 'text', text: xmlResponse }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 25 },
      model: 'test-model',
      latencyMs: 100,
    });

    const req = makeRequest({
      message: 'brief',
      context: {
        graph: null,
        analysis_response: null,
        framing: { stage: 'frame' },
        messages: [],
        scenario_id: 'test-scenario',
      } as ConversationContext,
    });

    const result = await handleTurn(req, mockFastifyRequest, 'req-gate-004');

    expect(result.envelope.turn_plan!.routing).toBe('llm');
    expect(result.envelope.turn_plan!.selected_tool).toBeNull();
    expect(mockChatWithTools).toHaveBeenCalled();
  });

  it('"brief" with graph but analysis_response: null → prerequisites not met', async () => {
    const xmlResponse = makeXmlEnvelope({ assistantText: 'Run analysis first.' });
    mockChatWithTools.mockResolvedValueOnce({
      content: [{ type: 'text', text: xmlResponse }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 25 },
      model: 'test-model',
      latencyMs: 100,
    });

    const req = makeRequest({
      message: 'brief',
      context: {
        graph: { nodes: [], edges: [] },
        analysis_response: null,
        framing: { stage: 'evaluate' },
        messages: [],
        scenario_id: 'test-scenario',
      } as ConversationContext,
    });

    const result = await handleTurn(req, mockFastifyRequest, 'req-gate-005');

    expect(result.envelope.turn_plan!.routing).toBe('llm');
    expect(result.envelope.turn_plan!.selected_tool).toBeNull();
    expect(mockChatWithTools).toHaveBeenCalled();
  });

  it('"draft" with empty framing → prerequisites not met, falls to LLM', async () => {
    const xmlResponse = makeXmlEnvelope({ assistantText: 'Tell me about your decision.' });
    mockChatWithTools.mockResolvedValueOnce({
      content: [{ type: 'text', text: xmlResponse }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 25 },
      model: 'test-model',
      latencyMs: 100,
    });

    const req = makeRequest({
      message: 'draft',
      context: {
        graph: null,
        analysis_response: null,
        framing: { stage: 'frame' },
        messages: [],
        scenario_id: 'test-scenario',
      } as ConversationContext,
    });

    const result = await handleTurn(req, mockFastifyRequest, 'req-gate-006');

    expect(result.envelope.turn_plan!.routing).toBe('llm');
    expect(result.envelope.turn_plan!.selected_tool).toBeNull();
    expect(mockChatWithTools).toHaveBeenCalled();
  });

  it('"draft" with framing.goal → deterministic dispatch', async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        graph: {
          nodes: [{ id: 'goal_1', kind: 'goal', label: 'Buy a car' }],
          edges: [],
        },
      },
    });

    const req = makeRequest({
      message: 'draft',
      context: {
        graph: null,
        analysis_response: null,
        framing: { stage: 'frame', goal: 'Decide which car to buy' },
        messages: [],
        scenario_id: 'test-scenario',
      } as ConversationContext,
    });

    const result = await handleTurn(req, mockFastifyRequest, 'req-gate-007');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.turn_plan!.routing).toBe('deterministic');
    expect(result.envelope.turn_plan!.selected_tool).toBe('draft_graph');
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it('"draft" with framing.brief_text → deterministic dispatch', async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        graph: {
          nodes: [{ id: 'goal_1', kind: 'goal', label: 'Expand team' }],
          edges: [],
        },
      },
    });

    const req = makeRequest({
      message: 'draft',
      context: {
        graph: null,
        analysis_response: null,
        framing: { stage: 'frame', brief_text: 'Should I hire two more engineers?' } as ConversationContext['framing'],
        messages: [],
        scenario_id: 'test-scenario',
      } as ConversationContext,
    });

    const result = await handleTurn(req, mockFastifyRequest, 'req-gate-008');

    expect(result.envelope.turn_plan!.routing).toBe('deterministic');
    expect(result.envelope.turn_plan!.selected_tool).toBe('draft_graph');
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it('"draft" with framing.options → deterministic dispatch', async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        graph: {
          nodes: [{ id: 'goal_1', kind: 'goal', label: 'Choose CRM' }],
          edges: [],
        },
      },
    });

    const req = makeRequest({
      message: 'draft',
      context: {
        graph: null,
        analysis_response: null,
        framing: { stage: 'frame', options: ['Salesforce', 'HubSpot'] } as ConversationContext['framing'],
        messages: [],
        scenario_id: 'test-scenario',
      } as ConversationContext,
    });

    const result = await handleTurn(req, mockFastifyRequest, 'req-gate-009');

    expect(result.envelope.turn_plan!.routing).toBe('deterministic');
    expect(result.envelope.turn_plan!.selected_tool).toBe('draft_graph');
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });
});

// ============================================================================
// patch_accepted System Event Tests
// ============================================================================

describe('handleTurn — patch_accepted system event', () => {
  beforeEach(() => {
    _clearIdempotencyCache();
    _resetPlotClient();
    mockChatWithTools.mockReset();
    mockChat.mockReset();
    mockLogWarn.mockReset();
    vi.mocked(isProduction).mockReturnValue(false);
  });

  function makePatchAcceptedRequest(overrides?: Partial<OrchestratorTurnRequest>): OrchestratorTurnRequest {
    turnCounter++;
    return {
      message: '',
      context: {
        graph: { nodes: [{ id: 'goal_1', kind: 'goal', label: 'Test' }], edges: [] },
        analysis_response: null,
        framing: { stage: 'frame' },
        messages: [],
        scenario_id: 'test-scenario',
      } as ConversationContext,
      scenario_id: 'test-scenario',
      client_turn_id: `patch-test-${turnCounter}-${Date.now()}`,
      system_event: {
        type: 'patch_accepted' as const,
        payload: {
          operations: [{ op: 'add_node', node: { id: 'fac_1', kind: 'factor', label: 'Cost' } }],
        },
      },
      ...overrides,
    };
  }

  it('calls PLoT validate-patch and returns graph_hash in lineage when PLoT succeeds', async () => {
    const mockValidatePatch = vi.fn().mockResolvedValue({
      kind: 'success',
      data: { graph_hash: 'abc123def456', verdict: 'accepted' },
    });
    const mockClient: PLoTClient = {
      run: vi.fn().mockResolvedValue({}),
      validatePatch: mockValidatePatch,
    };
    vi.mocked(createPLoTClient).mockReturnValue(mockClient);

    const req = makePatchAcceptedRequest();
    const result = await handleTurn(req, mockFastifyRequest, 'req-patch-001');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.turn_plan!.routing).toBe('deterministic');
    // graph_hash lives in its own field, not context_hash
    expect(result.envelope.lineage.graph_hash).toBe('abc123def456');
    // context_hash should be a real SHA-256 hash (32-char hex), not the graph hash
    expect(result.envelope.lineage.context_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(mockValidatePatch).toHaveBeenCalledOnce();
    expect(mockValidatePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        graph: req.context.graph,
        operations: req.system_event!.payload.operations,
        scenario_id: 'test-scenario',
      }),
      'req-patch-001',
    );
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it('returns ack with warning when PLoT returns FEATURE_DISABLED', async () => {
    const mockValidatePatch = vi.fn().mockResolvedValue({
      kind: 'feature_disabled',
    });
    vi.mocked(createPLoTClient).mockReturnValue({
      run: vi.fn().mockResolvedValue({}),
      validatePatch: mockValidatePatch,
    });

    const req = makePatchAcceptedRequest();
    const result = await handleTurn(req, mockFastifyRequest, 'req-patch-002');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.parse_warnings).toContain(
      'PLoT validate-patch not available — graph_hash not computed',
    );
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it('returns ack with warning when PLoT client is not configured', async () => {
    // Default mock returns null (PLoT not configured)
    vi.mocked(createPLoTClient).mockReturnValue(null);

    const req = makePatchAcceptedRequest();
    const result = await handleTurn(req, mockFastifyRequest, 'req-patch-003');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.parse_warnings).toContain(
      'PLoT client not configured — graph_hash not computed',
    );
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it('returns ack with warning when PLoT throws an error', async () => {
    const mockValidatePatch = vi.fn().mockRejectedValue(new Error('Connection refused'));
    vi.mocked(createPLoTClient).mockReturnValue({
      run: vi.fn().mockResolvedValue({}),
      validatePatch: mockValidatePatch,
    });

    const req = makePatchAcceptedRequest();
    const result = await handleTurn(req, mockFastifyRequest, 'req-patch-004');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.parse_warnings).toContain(
      'PLoT validate-patch failed: Connection refused',
    );
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ request_id: 'req-patch-004', error: 'Connection refused' }),
      expect.stringContaining('patch_accepted'),
    );
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });
});
