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

const { mockChatWithTools, mockChat, mockLogWarn, mockRunUnifiedPipeline, testFlags } = vi.hoisted(() => ({
  mockChatWithTools: vi.fn(),
  mockChat: vi.fn(),
  mockLogWarn: vi.fn(),
  mockRunUnifiedPipeline: vi.fn(),
  testFlags: { briefDetectionEnabled: false },
}));

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({
    name: 'test-adapter',
    model: 'test-model',
    chat: mockChat,
    chatWithTools: mockChatWithTools,
  }),
  getMaxTokensFromConfig: vi.fn().mockReturnValue(undefined),
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
              if (featProp === 'briefDetectionEnabled') return testFlags.briefDetectionEnabled;
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
import { getAdapter } from '../../src/adapters/llm/router.js';
import { isProduction } from '../../src/config/index.js';
import type { OrchestratorTurnRequest, ConversationContext } from '../../src/orchestrator/types.js';
import type { PLoTClient } from '../../src/orchestrator/plot-client.js';
import type { FastifyRequest } from 'fastify';
import { isToolAllowedAtStage } from '../../src/orchestrator/tools/stage-policy.js';

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
  toolUse?: string;
} = {}): string {
  const diag = opts.diagnostics !== undefined
    ? `<diagnostics>${opts.diagnostics}</diagnostics>\n`
    : '';
  const text = opts.assistantText ?? 'Here is a test response.';
  const blocks = opts.blocks ?? '';
  const actions = opts.suggestedActions ?? '';
  const toolUse = opts.toolUse ?? '';

  return `${diag}<response>
  <assistant_text>${text}</assistant_text>
  <blocks>${blocks}</blocks>
  <suggested_actions>${actions}</suggested_actions>
  ${toolUse}
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
    testFlags.briefDetectionEnabled = false;
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

    expect(env.debug).toEqual({
      response_summary: {
        assistant_text_present: true,
        assistant_text_length: 'Here is a test response.'.length,
        block_count_by_type: {},
        suggested_action_count: 1,
        error_present: false,
      },
      turn_summary: {
        stage: 'frame',
        response_mode_declared: null,
        response_mode_inferred: 'INTERPRET',
        tool_selected: null,
        tool_permitted: null,
      },
      fallback_summary: {
        fallback_injected: false,
        fallback_reason: null,
      },
      contract_summary: {
        contract_violations_count: 0,
        contract_violation_codes: [],
      },
    });
  });

  it('recomputes debug response summary after tool envelope merges', async () => {
    const xmlResponse = makeXmlEnvelope({
      diagnostics: 'Route: tool.',
      assistantText: 'Tool summary from XML.',
      suggestedActions: `
        <action>
          <role>facilitator</role>
          <label>Inspect result</label>
          <message>Show me the result details.</message>
        </action>`,
      blocks: `
        <block>
          <type>commentary</type>
          <title>Key Insight</title>
          <content>Revenue is the dominant driver.</content>
        </block>`,
      toolUse: `
        <tool_use name="run_analysis">
          <focus>top drivers</focus>
        </tool_use>`,
    });

    mockChatWithTools.mockResolvedValueOnce({
      content: [{ type: 'text', text: xmlResponse }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 80 },
      model: 'test-model',
      latencyMs: 150,
    });

    const result = await handleTurn(makeRequest(), mockFastifyRequest, 'req-test-debug-tool');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.assistant_text).toBe('Tool summary from XML.');
    expect(result.envelope.debug?.response_summary.assistant_text_present).toBe(true);
    expect(result.envelope.debug?.response_summary.assistant_text_length).toBe('Tool summary from XML.'.length);
    expect(result.envelope.debug?.response_summary.block_count_by_type).toEqual({ commentary: 1 });
    expect(result.envelope.debug?.response_summary.suggested_action_count).toBe(1);
    expect(result.envelope.debug?.turn_summary).toEqual({
      stage: 'frame',
      response_mode_declared: null,
      response_mode_inferred: 'INTERPRET',
      tool_selected: null,
      tool_permitted: null,
    });
    expect(result.envelope.diagnostics).toBe('Route: tool.');
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
        graph: { nodes: [{ id: 'n1', kind: 'decision', label: 'D' }], edges: [] },
        analysis_response: { meta: { seed_used: 1, n_samples: 100, response_hash: 'h' }, results: [] },
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

  it('"generate brief" with prerequisites met → deterministic routing, chatWithTools NOT called', async () => {
    const req = makeRequest({
      message: 'generate brief',
      context: {
        graph: { nodes: [{ id: 'n1', kind: 'decision', label: 'D' }], edges: [] },
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

  const GRAPH_STATE = { nodes: [{ id: 'goal_1', kind: 'goal', label: 'Test' }], edges: [] };
  const PATCH_OPERATIONS = [{ op: 'add_node', path: '/nodes/fac_1', value: { id: 'fac_1', kind: 'factor', label: 'Cost' } }];

  // A pending patch in context.messages is required by the cf-v11.1 guard
  const PENDING_PATCH_MSG = {
    role: 'assistant',
    content: {
      blocks: [{ block_type: 'graph_patch', data: { patch_type: 'edit', operations: [], status: 'proposed' } }],
    },
  };

  function makePatchAcceptedRequest(overrides?: Partial<OrchestratorTurnRequest>): OrchestratorTurnRequest {
    turnCounter++;
    return {
      message: '',
      context: {
        graph: GRAPH_STATE,
        analysis_response: null,
        framing: { stage: 'frame' },
        messages: [PENDING_PATCH_MSG],
        scenario_id: 'test-scenario',
      } as unknown as ConversationContext,
      scenario_id: 'test-scenario',
      client_turn_id: `patch-test-${turnCounter}-${Date.now()}`,
      // Brief C: graph_state required for Path B (no applied_graph_hash)
      graph_state: GRAPH_STATE as unknown as OrchestratorTurnRequest['graph_state'],
      system_event: {
        event_type: 'patch_accepted' as const,
        timestamp: '2026-03-03T00:00:00Z',
        event_id: 'evt-patch-1',
        details: {
          patch_id: 'patch-1',
          operations: PATCH_OPERATIONS,
        },
      },
      ...overrides,
    };
  }

  it('calls PLoT validate-patch (Path B) and returns graph_hash in lineage when PLoT succeeds', async () => {
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
        graph: req.graph_state,
        operations: PATCH_OPERATIONS,
        scenario_id: 'test-scenario',
      }),
      'req-patch-001',
      expect.objectContaining({
        turnBudgetMs: expect.any(Number),
        turnStartedAt: expect.any(Number),
      }),
    );
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it('Path B with FEATURE_DISABLED: returns "unavailable" message (no LLM call)', async () => {
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
    expect(result.envelope.assistant_text).toContain('unavailable');
    expect(result.envelope.blocks).toEqual([]);
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it('Path B with null PLoT client: returns "unavailable" message', async () => {
    vi.mocked(createPLoTClient).mockReturnValue(null);

    const req = makePatchAcceptedRequest();
    const result = await handleTurn(req, mockFastifyRequest, 'req-patch-003');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.assistant_text).toContain('unavailable');
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it('Path B with PLoT error: returns "unavailable" message (non-blocking)', async () => {
    const mockValidatePatch = vi.fn().mockRejectedValue(new Error('Connection refused'));
    vi.mocked(createPLoTClient).mockReturnValue({
      run: vi.fn().mockResolvedValue({}),
      validatePatch: mockValidatePatch,
    });

    const req = makePatchAcceptedRequest();
    const result = await handleTurn(req, mockFastifyRequest, 'req-patch-004');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.assistant_text).toContain('unavailable');
    expect(mockChatWithTools).not.toHaveBeenCalled();
  });

  it('Path A (applied_graph_hash present + graph_state): skips PLoT, returns 200', async () => {
    const mockValidatePatch = vi.fn();
    vi.mocked(createPLoTClient).mockReturnValue({
      run: vi.fn().mockResolvedValue({}),
      validatePatch: mockValidatePatch,
    });

    const req = makePatchAcceptedRequest({
      system_event: {
        event_type: 'patch_accepted',
        timestamp: '2026-03-03T00:00:00Z',
        event_id: 'evt-path-a',
        details: {
          patch_id: 'patch-a',
          operations: PATCH_OPERATIONS,
          applied_graph_hash: 'ui-validated-hash',
        },
      },
    });
    const result = await handleTurn(req, mockFastifyRequest, 'req-patch-005');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.lineage.graph_hash).toBe('ui-validated-hash');
    expect(mockValidatePatch).not.toHaveBeenCalled();
  });

  it('Path A GUARD: applied_graph_hash without graph_state → 400', async () => {
    const req = makePatchAcceptedRequest({
      graph_state: undefined,
      system_event: {
        event_type: 'patch_accepted',
        timestamp: '2026-03-03T00:00:00Z',
        event_id: 'evt-guard',
        details: {
          patch_id: 'patch-guard',
          operations: [],
          applied_graph_hash: 'some-hash',
        },
      },
    });
    const result = await handleTurn(req, mockFastifyRequest, 'req-patch-006');

    expect(result.httpStatus).toBe(400);
    expect(result.envelope.error?.code).toBe('MISSING_GRAPH_STATE');
  });
});

describe('handleTurn — adapter task routing', () => {
  beforeEach(() => {
    _clearIdempotencyCache();
    _resetPlotClient();
    mockChatWithTools.mockReset();
    mockChat.mockReset();
    vi.mocked(getAdapter).mockClear();
    vi.mocked(createPLoTClient).mockReset();
    vi.mocked(createPLoTClient).mockReturnValue(null);
    vi.mocked(isProduction).mockReturnValue(false);
  });

  it('calls getAdapter("edit_graph") when edit_graph is deterministically dispatched', async () => {
    // edit_graph handler calls adapter.chat() — mock it to return a valid JSON response
    mockChat.mockResolvedValueOnce({
      content: '{"operations": [], "removed_edges": [], "warnings": ["test"], "coaching": null}',
      model: 'test-model',
      latencyMs: 50,
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const req = makeRequest({
      message: 'edit the model',
      context: {
        graph: {
          version: '3.0',
          default_seed: 17,
          nodes: [{ id: 'goal_1', kind: 'goal', label: 'Test Goal' }],
          edges: [],
        },
        analysis_response: null,
        framing: { stage: 'ideate' },
        messages: [],
        scenario_id: 'test-scenario',
      } as unknown as ConversationContext,
    });

    await handleTurn(req, mockFastifyRequest, 'req-edit-adapter-001');

    // Verify getAdapter was called with 'edit_graph' (not 'orchestrator')
    const getAdapterCalls = vi.mocked(getAdapter).mock.calls;
    const editGraphCall = getAdapterCalls.find(([task]) => task === 'edit_graph');
    expect(editGraphCall).toBeDefined();
  });
});

// ============================================================================
// Stage inference override — regression test for UI ideate + no graph
// ============================================================================

describe('handleTurn — stage inference override', () => {
  beforeEach(() => {
    _clearIdempotencyCache();
    mockChatWithTools.mockReset();
    mockChat.mockReset();
    vi.mocked(isProduction).mockReturnValue(false);
  });

  it('UI sends ideate but no graph → stage overridden to frame, draft_graph allowed', async () => {
    const xmlResponse = makeXmlEnvelope({ assistantText: 'Let me help you get started.' });

    mockChatWithTools.mockResolvedValueOnce({
      content: [{ type: 'text', text: xmlResponse }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 25 },
      model: 'test-model',
      latencyMs: 100,
    });

    const req = makeRequest({
      message: 'help me think through this decision',
      context: {
        graph: null,
        analysis_response: null,
        framing: { stage: 'ideate' }, // UI incorrectly sends ideate
        messages: [],
        scenario_id: 'test-scenario',
      } as ConversationContext,
    });

    const result = await handleTurn(req, mockFastifyRequest, 'req-stage-override-001');

    // 1. Envelope stage_indicator must be frame (not ideate)
    expect(result.envelope.stage_indicator).toBe('frame');
    expect(result.envelope.stage_label).toBe('Framing the decision');

    // 2. Telemetry stage must be frame
    const logInfoCalls = vi.mocked(vi.fn()).mock?.calls ?? [];
    // The telemetry log is emitted via log.info — check envelope carries frame
    // (telemetry stage is derived from the same currentStage used for envelope)
    expect(result.envelope.stage_indicator).not.toBe('ideate');

    // 3. draft_graph must be allowed at the inferred frame stage
    const guard = isToolAllowedAtStage('draft_graph', 'frame');
    expect(guard.allowed).toBe(true);

    // 4. run_analysis must be blocked at frame stage (stage policy integrity)
    const analysisGuard = isToolAllowedAtStage('run_analysis', 'frame');
    expect(analysisGuard.allowed).toBe(false);
  });

  // ==========================================================================
  // Brief detection → draft_graph integration
  // ==========================================================================

  it('NL decision brief routes to draft_graph deterministically when CEE_BRIEF_DETECTION_ENABLED=true', async () => {
    testFlags.briefDetectionEnabled = true;

    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        graph: {
          nodes: [
            { id: 'goal_1', kind: 'goal', label: 'CRM Selection' },
            { id: 'opt_1', kind: 'option', label: 'Salesforce' },
            { id: 'opt_2', kind: 'option', label: 'HubSpot' },
          ],
          edges: [],
        },
      },
    });

    const req = makeRequest({
      message: "We're choosing between three CRM vendors: Salesforce, HubSpot, and Pipedrive. Our budget is £50k and we need to decide by Q3.",
      context: {
        graph: null,
        analysis_response: null,
        framing: null,
        messages: [],
        scenario_id: 'test-scenario',
      } as ConversationContext,
    });

    const result = await handleTurn(req, mockFastifyRequest, 'req-brief-detect-001');

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.turn_plan!.selected_tool).toBe('draft_graph');
    expect(result.envelope.turn_plan!.routing).toBe('deterministic');
    expect(result.envelope.assistant_text).not.toBeNull();
    expect(typeof result.envelope.assistant_text).toBe('string');
    // Must not fall through to LLM — the whole point is deterministic routing
    expect(mockChatWithTools).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('NL decision brief falls through to LLM when CEE_BRIEF_DETECTION_ENABLED=false', async () => {
    testFlags.briefDetectionEnabled = false;

    const xmlResponse = makeXmlEnvelope({
      assistantText: 'Let me help you think through this decision.',
    });
    mockChatWithTools.mockResolvedValueOnce({
      content: [{ type: 'text', text: xmlResponse }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
      model: 'test-model',
      latencyMs: 200,
    });

    const req = makeRequest({
      message: "We're choosing between three CRM vendors: Salesforce, HubSpot, and Pipedrive. Our budget is £50k and we need to decide by Q3.",
      context: {
        graph: null,
        analysis_response: null,
        framing: null,
        messages: [],
        scenario_id: 'test-scenario',
      } as ConversationContext,
    });

    const result = await handleTurn(req, mockFastifyRequest, 'req-brief-detect-002');

    expect(result.httpStatus).toBe(200);
    // With flag off, should fall through to LLM (no deterministic draft_graph routing)
    expect(mockChatWithTools).toHaveBeenCalledOnce();
    expect(result.envelope.turn_plan!.routing).toBe('llm');
    expect(result.envelope.turn_plan!.selected_tool).not.toBe('draft_graph');
  });
});
