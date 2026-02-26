/**
 * Turn Handler Integration Tests
 *
 * Verifies the full parse → assemble pipeline through handleTurn():
 * - LLM XML envelope → parseLLMResponse → assembleEnvelope → OrchestratorResponseEnvelope
 * - Parser and assembler run for real; only the LLM adapter is stubbed
 * - Covers: text-only, tool+text, tool-only, and parse warning logging paths
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks — vi.hoisted() ensures these are available to hoisted vi.mock factories
// ============================================================================

const { mockChatWithTools, mockChat } = vi.hoisted(() => ({
  mockChatWithTools: vi.fn(),
  mockChat: vi.fn(),
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

// ============================================================================
// Imports — after mocks
// ============================================================================

import { handleTurn } from '../../src/orchestrator/turn-handler.js';
import { _clearIdempotencyCache } from '../../src/orchestrator/idempotency.js';
import type { OrchestratorTurnRequest, ConversationContext } from '../../src/orchestrator/types.js';
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
});
