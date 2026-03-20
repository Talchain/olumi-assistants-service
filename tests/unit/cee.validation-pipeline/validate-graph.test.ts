/**
 * Unit tests for the Pass 2 caller (validate-graph.ts).
 * All LLM adapter calls and prompt loading are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CallOpts } from '../../../src/adapters/llm/types.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You are a validation assistant.'),
}));

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({
    name: 'openai',
    model: 'o4-mini',
    chat: vi.fn(),
  }),
  getMaxTokensFromConfig: vi.fn().mockReturnValue(4096),
}));

// json-extractor: pass through JSON.parse from the content field
vi.mock('../../../src/utils/json-extractor.js', () => ({
  extractJsonFromResponse: vi.fn((content: string) => ({
    json: JSON.parse(content),
    wasExtracted: false,
  })),
}));

vi.mock('../../../src/utils/telemetry.js', () => ({
  log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  emit: vi.fn(),
}));

vi.mock('../../../src/config/timeouts.js', () => ({
  VALIDATION_PIPELINE_TIMEOUT_MS: 30_000,
}));

// ── Import under test (after mocks are set up) ────────────────────────────────

const { callValidateGraph } = await import(
  '../../../src/cee/validation-pipeline/validate-graph.js'
);
const { getAdapter } = await import('../../../src/adapters/llm/router.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

const CALL_OPTS: CallOpts = { requestId: 'test-req-1' };

function validPass2Response() {
  return {
    edges: [
      {
        from: 'fac_x',
        to: 'out_y',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.8,
        reasoning: 'Direct causal link in the brief',
        basis: 'brief_explicit',
        needs_user_input: false,
      },
    ],
    model_notes: ['Graph structure looks well specified'],
  };
}

function makeChatResult(parsed: unknown) {
  return {
    content: JSON.stringify(parsed),
    latencyMs: 200,
    model: 'o4-mini',
    usage: { input_tokens: 100, output_tokens: 200 },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('callValidateGraph — happy path', () => {
  beforeEach(() => {
    const adapter = (getAdapter as ReturnType<typeof vi.fn>)();
    adapter.chat = vi.fn().mockResolvedValue(makeChatResult(validPass2Response()));
  });

  it('returns a parsed Pass2Response with edges and model_notes', async () => {
    const result = await callValidateGraph(
      'Should I hire a VP of Sales?',
      [{ id: 'fac_x', kind: 'factor', label: 'X' }],
      [{ from: 'fac_x', to: 'out_y' }],
      CALL_OPTS,
    );
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].from).toBe('fac_x');
    expect(result.edges[0].to).toBe('out_y');
    expect(result.edges[0].basis).toBe('brief_explicit');
    expect(result.model_notes).toHaveLength(1);
  });

  it('returns empty model_notes when not present in response', async () => {
    const noNotes = { edges: [validPass2Response().edges[0]] };
    const adapter = (getAdapter as ReturnType<typeof vi.fn>)();
    adapter.chat = vi.fn().mockResolvedValue(makeChatResult(noNotes));

    const result = await callValidateGraph('brief', [], [], CALL_OPTS);
    expect(result.model_notes).toHaveLength(0);
  });
});

describe('callValidateGraph — parse errors', () => {
  it('throws when response is not a JSON object', async () => {
    const adapter = (getAdapter as ReturnType<typeof vi.fn>)();
    adapter.chat = vi.fn().mockResolvedValue(makeChatResult([1, 2, 3]));

    await expect(
      callValidateGraph('brief', [], [], CALL_OPTS),
    ).rejects.toThrow('not an object');
  });

  it('throws when edges array is missing', async () => {
    const adapter = (getAdapter as ReturnType<typeof vi.fn>)();
    adapter.chat = vi.fn().mockResolvedValue(makeChatResult({ model_notes: [] }));

    await expect(
      callValidateGraph('brief', [], [], CALL_OPTS),
    ).rejects.toThrow("missing 'edges' array");
  });

  it('throws when an edge is missing required field (from)', async () => {
    const badEdge = { to: 'b', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, reasoning: 'r', basis: 'domain_prior', needs_user_input: false };
    const adapter = (getAdapter as ReturnType<typeof vi.fn>)();
    adapter.chat = vi.fn().mockResolvedValue(makeChatResult({ edges: [badEdge] }));

    await expect(
      callValidateGraph('brief', [], [], CALL_OPTS),
    ).rejects.toThrow('from');
  });

  it('throws when an edge has an invalid basis value', async () => {
    const edge = { from: 'a', to: 'b', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, reasoning: 'r', basis: 'made_up_basis', needs_user_input: false };
    const adapter = (getAdapter as ReturnType<typeof vi.fn>)();
    adapter.chat = vi.fn().mockResolvedValue(makeChatResult({ edges: [edge] }));

    await expect(
      callValidateGraph('brief', [], [], CALL_OPTS),
    ).rejects.toThrow('basis');
  });

  it('throws when exists_probability is not a number', async () => {
    const edge = { from: 'a', to: 'b', strength: { mean: 0.4, std: 0.1 }, exists_probability: 'high', reasoning: 'r', basis: 'domain_prior', needs_user_input: false };
    const adapter = (getAdapter as ReturnType<typeof vi.fn>)();
    adapter.chat = vi.fn().mockResolvedValue(makeChatResult({ edges: [edge] }));

    await expect(
      callValidateGraph('brief', [], [], CALL_OPTS),
    ).rejects.toThrow('exists_probability');
  });
});

describe('callValidateGraph — adapter errors', () => {
  it('propagates adapter errors (e.g. network failure)', async () => {
    const adapter = (getAdapter as ReturnType<typeof vi.fn>)();
    adapter.chat = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      callValidateGraph('brief', [], [], CALL_OPTS),
    ).rejects.toThrow('ECONNREFUSED');
  });
});
