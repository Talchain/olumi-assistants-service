/**
 * Tests for Orchestrator Response Parser
 *
 * Verifies parseOrchestratorResponse() and parseLLMResponse():
 * - XML envelope extraction with fallback cascade
 * - Diagnostics capture
 * - Block parsing (commentary, review_card)
 * - Suggested action parsing (max 2, role validation)
 * - XML entity unescaping (all five standard entities)
 * - parse_warnings for all degradation paths
 * - Never throws on malformed input
 */

import { describe, it, expect } from 'vitest';
import {
  parseOrchestratorResponse,
  parseLLMResponse,
  unescapeXmlEntities,
  getFirstToolInvocation,
  hasToolInvocations,
} from '../../src/orchestrator/response-parser.js';
import type {
  ParsedResponse,
  ParsedBlock,
  ParsedAction,
  ParsedLLMResponse,
} from '../../src/orchestrator/response-parser.js';
import type { ChatWithToolsResult } from '../../src/adapters/llm/types.js';

// ============================================================================
// Test Helpers
// ============================================================================

/** Build a well-formed XML envelope response. */
function makeXmlResponse(opts: {
  diagnostics?: string;
  assistantText?: string;
  blocks?: string;
  suggestedActions?: string;
} = {}): string {
  const diag = opts.diagnostics !== undefined
    ? `<diagnostics>${opts.diagnostics}</diagnostics>\n`
    : '';
  const text = opts.assistantText ?? 'Hello from the assistant';
  const blocks = opts.blocks ?? '';
  const actions = opts.suggestedActions ?? '';

  return `${diag}<response>
  <assistant_text>${text}</assistant_text>
  <blocks>${blocks}</blocks>
  <suggested_actions>${actions}</suggested_actions>
</response>`;
}

/** Build a commentary block XML fragment. */
function makeCommentaryBlock(content: string, title?: string): string {
  const titleTag = title ? `<title>${title}</title>` : '';
  return `<block><type>commentary</type>${titleTag}<content>${content}</content></block>`;
}

/** Build a review_card block XML fragment. */
function makeReviewCardBlock(
  content: string,
  title: string,
  tone?: 'facilitator' | 'challenger',
): string {
  const toneTag = tone ? `<tone>${tone}</tone>` : '';
  return `<block><type>review_card</type>${toneTag}<title>${title}</title><content>${content}</content></block>`;
}

/** Build an action XML fragment. */
function makeAction(
  label: string,
  message: string,
  role: string = 'facilitator',
): string {
  return `<action><role>${role}</role><label>${label}</label><message>${message}</message></action>`;
}

/** Build a ChatWithToolsResult for parseLLMResponse tests. */
function makeLLMResult(opts: {
  text?: string | string[];
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens';
}): ChatWithToolsResult {
  const content: ChatWithToolsResult['content'] = [];

  const texts = opts.text !== undefined
    ? (Array.isArray(opts.text) ? opts.text : [opts.text])
    : [];

  for (const t of texts) {
    content.push({ type: 'text', text: t });
  }

  if (opts.toolCalls) {
    for (const tc of opts.toolCalls) {
      content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }
  }

  return {
    content,
    stop_reason: opts.stopReason ?? 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
    model: 'claude-test',
    latencyMs: 200,
  };
}

// ============================================================================
// 4a. parseOrchestratorResponse — Unit Tests (15+ cases)
// ============================================================================

describe('parseOrchestratorResponse', () => {
  it('parses a valid complete response with all fields', () => {
    const raw = makeXmlResponse({
      diagnostics: 'Route: explain. Tool: explain_results.',
      assistantText: 'The analysis suggests Option A leads.',
      blocks: makeCommentaryBlock('Key insight here', 'Analysis Summary'),
      suggestedActions: makeAction('Explore drivers', 'What are the key drivers?', 'facilitator'),
    });

    const result = parseOrchestratorResponse(raw);

    expect(result.diagnostics).toBe('Route: explain. Tool: explain_results.');
    expect(result.assistant_text).toBe('The analysis suggests Option A leads.');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe('commentary');
    expect(result.blocks[0].content).toBe('Key insight here');
    expect(result.blocks[0].title).toBe('Analysis Summary');
    expect(result.suggested_actions).toHaveLength(1);
    expect(result.suggested_actions[0].label).toBe('Explore drivers');
    expect(result.suggested_actions[0].message).toBe('What are the key drivers?');
    expect(result.suggested_actions[0].role).toBe('facilitator');
    expect(result.parse_warnings).toHaveLength(0);
  });

  it('parses a minimal response (empty blocks, empty actions)', () => {
    const raw = makeXmlResponse({ assistantText: 'Hello' });

    const result = parseOrchestratorResponse(raw);

    expect(result.assistant_text).toBe('Hello');
    expect(result.blocks).toHaveLength(0);
    expect(result.suggested_actions).toHaveLength(0);
    expect(result.parse_warnings).toHaveLength(0);
  });

  it('handles missing <diagnostics> gracefully (diagnostics: null)', () => {
    const raw = makeXmlResponse({ assistantText: 'No diagnostics here' });

    const result = parseOrchestratorResponse(raw);

    expect(result.diagnostics).toBeNull();
    expect(result.assistant_text).toBe('No diagnostics here');
    expect(result.parse_warnings).toHaveLength(0);
  });

  it('handles <response> present but <assistant_text> missing (fallback 2)', () => {
    const raw = `<diagnostics>test</diagnostics>
<response>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;

    const result = parseOrchestratorResponse(raw);

    expect(result.assistant_text).toBe('');
    expect(result.diagnostics).toBe('test');
    expect(result.parse_warnings).toContain('<response> present but <assistant_text> missing');
  });

  it('handles no <response> tag at all (fallback 3 — plain text)', () => {
    const raw = 'Just plain text from the model, no XML at all.';

    const result = parseOrchestratorResponse(raw);

    expect(result.assistant_text).toBe('Just plain text from the model, no XML at all.');
    expect(result.diagnostics).toBeNull();
    expect(result.blocks).toHaveLength(0);
    expect(result.suggested_actions).toHaveLength(0);
    expect(result.parse_warnings).toContain('No <response> envelope found — treating as plain text');
  });

  it('handles empty string input (fallback 4)', () => {
    const result = parseOrchestratorResponse('');

    expect(result.assistant_text).toBe('');
    expect(result.diagnostics).toBeNull();
    expect(result.blocks).toHaveLength(0);
    expect(result.suggested_actions).toHaveLength(0);
    expect(result.parse_warnings).toContain('Empty or whitespace-only input');
  });

  it('handles whitespace-only input (fallback 4)', () => {
    const result = parseOrchestratorResponse('   \n\n  \t  ');

    expect(result.assistant_text).toBe('');
    expect(result.parse_warnings).toContain('Empty or whitespace-only input');
  });

  it('trims leading whitespace/newlines before parsing', () => {
    const raw = `\n\n   ${makeXmlResponse({ assistantText: 'Trimmed' })}`;

    const result = parseOrchestratorResponse(raw);

    expect(result.assistant_text).toBe('Trimmed');
    expect(result.parse_warnings).toHaveLength(0);
  });

  it('handles malformed XML (unclosed tags) with best-effort fallback', () => {
    const raw = '<diagnostics>some reasoning<response><assistant_text>Hello</assistant_text>';

    const result = parseOrchestratorResponse(raw);

    // Diagnostics is malformed (no closing tag) — should be null
    expect(result.diagnostics).toBeNull();
    // No <response> closing tag — treated as no response
    expect(result.parse_warnings.length).toBeGreaterThan(0);
  });

  it('drops unknown block types with a warning', () => {
    const blocks = `
      <block><type>fact</type><content>Should be dropped</content></block>
      <block><type>commentary</type><content>Should be kept</content></block>
      <block><type>graph_patch</type><content>Should be dropped</content></block>
    `;
    const raw = makeXmlResponse({ blocks });

    const result = parseOrchestratorResponse(raw);

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe('commentary');
    expect(result.parse_warnings).toContain('Unknown block type "fact" — dropped');
    expect(result.parse_warnings).toContain('Unknown block type "graph_patch" — dropped');
  });

  it('truncates more than 2 suggested actions with a warning', () => {
    const actions = [
      makeAction('Action 1', 'Do thing 1', 'facilitator'),
      makeAction('Action 2', 'Do thing 2', 'challenger'),
      makeAction('Action 3', 'Do thing 3', 'facilitator'),
    ].join('');
    const raw = makeXmlResponse({ suggestedActions: actions });

    const result = parseOrchestratorResponse(raw);

    expect(result.suggested_actions).toHaveLength(2);
    expect(result.suggested_actions[0].label).toBe('Action 1');
    expect(result.suggested_actions[1].label).toBe('Action 2');
    expect(result.parse_warnings).toContain('More than 2 suggested actions — truncated to 2');
  });

  it('defaults review_card tone to facilitator when missing', () => {
    const blocks = makeReviewCardBlock('Card content', 'Card Title');
    const raw = makeXmlResponse({ blocks });

    const result = parseOrchestratorResponse(raw);

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe('review_card');
    expect(result.blocks[0].tone).toBe('facilitator');
  });

  it('drops block missing content with a warning', () => {
    const blocks = '<block><type>commentary</type><title>No Content</title></block>';
    const raw = makeXmlResponse({ blocks });

    const result = parseOrchestratorResponse(raw);

    expect(result.blocks).toHaveLength(0);
    expect(result.parse_warnings).toContain('Block of type "commentary" missing <content> — dropped');
  });

  it('defaults invalid action role to facilitator with a warning', () => {
    const actions = `
      <action><role>narrator</role><label>Test</label><message>Test message</message></action>
    `;
    const raw = makeXmlResponse({ suggestedActions: actions });

    const result = parseOrchestratorResponse(raw);

    expect(result.suggested_actions).toHaveLength(1);
    expect(result.suggested_actions[0].role).toBe('facilitator');
    expect(result.parse_warnings).toContain('Action role "narrator" invalid — defaulted to facilitator');
  });

  it('defaults missing action role to facilitator with a warning', () => {
    const actions = `
      <action><label>No Role</label><message>Test message</message></action>
    `;
    const raw = makeXmlResponse({ suggestedActions: actions });

    const result = parseOrchestratorResponse(raw);

    expect(result.suggested_actions).toHaveLength(1);
    expect(result.suggested_actions[0].role).toBe('facilitator');
    expect(result.parse_warnings).toContain('Action role "(missing)" invalid — defaulted to facilitator');
  });

  it('drops action missing required field with a warning', () => {
    const actions = `
      <action><role>facilitator</role><label>Valid</label><message>Valid message</message></action>
      <action><role>facilitator</role><label>Missing Message</label></action>
      <action><role>facilitator</role><message>Missing Label</message></action>
    `;
    const raw = makeXmlResponse({ suggestedActions: actions });

    const result = parseOrchestratorResponse(raw);

    expect(result.suggested_actions).toHaveLength(1);
    expect(result.suggested_actions[0].label).toBe('Valid');
    expect(result.parse_warnings.filter(w => w.includes('missing required'))).toHaveLength(2);
  });

  it('unescapes all five XML entities in assistant_text', () => {
    const raw = makeXmlResponse({
      assistantText: 'A &amp; B &lt; C &gt; D &quot;E&quot; F &apos;G&apos;',
    });

    const result = parseOrchestratorResponse(raw);

    expect(result.assistant_text).toBe('A & B < C > D "E" F \'G\'');
  });

  it('unescapes XML entities in block content and title', () => {
    const blocks = makeCommentaryBlock(
      'Revenue &gt; $1M &amp; growing',
      'Market &lt;Overview&gt;',
    );
    const raw = makeXmlResponse({ blocks });

    const result = parseOrchestratorResponse(raw);

    expect(result.blocks[0].content).toBe('Revenue > $1M & growing');
    expect(result.blocks[0].title).toBe('Market <Overview>');
  });

  it('unescapes XML entities in action labels and messages', () => {
    const actions = makeAction(
      'Test &amp; verify',
      'What happens if X &lt; Y?',
      'facilitator',
    );
    const raw = makeXmlResponse({ suggestedActions: actions });

    const result = parseOrchestratorResponse(raw);

    expect(result.suggested_actions[0].label).toBe('Test & verify');
    expect(result.suggested_actions[0].message).toBe('What happens if X < Y?');
  });

  it('plain text input with diagnostics but no response', () => {
    const raw = `<diagnostics>Intent: chat</diagnostics>
Just chatting without XML envelope.`;

    const result = parseOrchestratorResponse(raw);

    expect(result.diagnostics).toBe('Intent: chat');
    expect(result.assistant_text).toBe('Just chatting without XML envelope.');
    expect(result.parse_warnings).toContain('No <response> envelope found — treating as plain text');
  });

  it('parses review_card with challenger tone correctly', () => {
    const blocks = makeReviewCardBlock('Challenge this assumption', 'Counterpoint', 'challenger');
    const raw = makeXmlResponse({ blocks });

    const result = parseOrchestratorResponse(raw);

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].tone).toBe('challenger');
    expect(result.blocks[0].title).toBe('Counterpoint');
  });

  it('parses multiple blocks of different types', () => {
    const blocks = [
      makeCommentaryBlock('Commentary 1'),
      makeReviewCardBlock('Review content', 'Review Title', 'facilitator'),
      makeCommentaryBlock('Commentary 2', 'With Title'),
    ].join('\n');
    const raw = makeXmlResponse({ blocks });

    const result = parseOrchestratorResponse(raw);

    expect(result.blocks).toHaveLength(3);
    expect(result.blocks[0].type).toBe('commentary');
    expect(result.blocks[1].type).toBe('review_card');
    expect(result.blocks[2].type).toBe('commentary');
    expect(result.blocks[2].title).toBe('With Title');
  });

  it('is a pure function with no side effects', () => {
    const raw = makeXmlResponse({ assistantText: 'Test' });

    // Call twice — results must be identical
    const result1 = parseOrchestratorResponse(raw);
    const result2 = parseOrchestratorResponse(raw);

    expect(result1).toEqual(result2);
  });

  it('drops block missing <type> tag with a warning', () => {
    const blocks = '<block><content>No type here</content></block>';
    const raw = makeXmlResponse({ blocks });

    const result = parseOrchestratorResponse(raw);

    expect(result.blocks).toHaveLength(0);
    expect(result.parse_warnings).toContain('Block missing <type> tag — dropped');
  });
});

// ============================================================================
// unescapeXmlEntities
// ============================================================================

describe('unescapeXmlEntities', () => {
  it('unescapes &amp;', () => {
    expect(unescapeXmlEntities('A &amp; B')).toBe('A & B');
  });

  it('unescapes &lt;', () => {
    expect(unescapeXmlEntities('x &lt; y')).toBe('x < y');
  });

  it('unescapes &gt;', () => {
    expect(unescapeXmlEntities('x &gt; y')).toBe('x > y');
  });

  it('unescapes &quot;', () => {
    expect(unescapeXmlEntities('&quot;hello&quot;')).toBe('"hello"');
  });

  it('unescapes &apos;', () => {
    expect(unescapeXmlEntities('it&apos;s')).toBe("it's");
  });

  it('unescapes all five entities in one string', () => {
    expect(unescapeXmlEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'');
  });

  it('passes through text with no entities unchanged', () => {
    expect(unescapeXmlEntities('plain text')).toBe('plain text');
  });

  it('does not unescape non-standard entities', () => {
    expect(unescapeXmlEntities('&mdash;&nbsp;')).toBe('&mdash;&nbsp;');
  });
});

// ============================================================================
// parseLLMResponse — Layer 1 + Layer 2
// ============================================================================

describe('parseLLMResponse', () => {
  it('extracts text and parses XML envelope from a text-only response', () => {
    const raw = makeXmlResponse({
      diagnostics: 'Route: chat',
      assistantText: 'Hello user',
    });
    const llmResult = makeLLMResult({ text: raw });

    const parsed = parseLLMResponse(llmResult);

    expect(parsed.assistant_text).toBe('Hello user');
    expect(parsed.diagnostics).toBe('Route: chat');
    expect(parsed.tool_invocations).toHaveLength(0);
    expect(parsed.parse_warnings).toHaveLength(0);
    expect(parsed.stop_reason).toBe('end_turn');
  });

  it('extracts tool invocations from tool_use content blocks', () => {
    const llmResult = makeLLMResult({
      text: makeXmlResponse({ assistantText: 'Drafting your graph now.' }),
      toolCalls: [{ id: 'toolu_123', name: 'draft_graph', input: { brief: 'test' } }],
      stopReason: 'tool_use',
    });

    const parsed = parseLLMResponse(llmResult);

    expect(parsed.assistant_text).toBe('Drafting your graph now.');
    expect(parsed.tool_invocations).toHaveLength(1);
    expect(parsed.tool_invocations[0].name).toBe('draft_graph');
    expect(parsed.tool_invocations[0].input).toEqual({ brief: 'test' });
    expect(parsed.stop_reason).toBe('tool_use');
  });

  it('handles tool-call-only response (no text content)', () => {
    const llmResult = makeLLMResult({
      toolCalls: [{ id: 'toolu_456', name: 'run_analysis', input: {} }],
      stopReason: 'tool_use',
    });

    const parsed = parseLLMResponse(llmResult);

    expect(parsed.assistant_text).toBeNull();
    expect(parsed.tool_invocations).toHaveLength(1);
    expect(parsed.extracted_blocks).toHaveLength(0);
    expect(parsed.suggested_actions).toHaveLength(0);
    expect(parsed.parse_warnings).toHaveLength(0);
  });

  it('concatenates multiple text blocks before XML parsing', () => {
    const part1 = '<diagnostics>part 1</diagnostics>';
    const part2 = `<response>
  <assistant_text>Combined text</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;
    const llmResult = makeLLMResult({ text: [part1, part2] });

    const parsed = parseLLMResponse(llmResult);

    expect(parsed.assistant_text).toBe('Combined text');
    expect(parsed.diagnostics).toBe('part 1');
  });

  it('maps ParsedAction to SuggestedAction (message → prompt)', () => {
    const actions = makeAction('Click me', 'Full prompt message', 'challenger');
    const raw = makeXmlResponse({ suggestedActions: actions });
    const llmResult = makeLLMResult({ text: raw });

    const parsed = parseLLMResponse(llmResult);

    expect(parsed.suggested_actions).toHaveLength(1);
    // SuggestedAction uses 'prompt' not 'message'
    expect(parsed.suggested_actions[0].prompt).toBe('Full prompt message');
    expect(parsed.suggested_actions[0].label).toBe('Click me');
    expect(parsed.suggested_actions[0].role).toBe('challenger');
  });

  it('maps ExtractedBlock correctly from ParsedBlock', () => {
    const blocks = makeCommentaryBlock('Test content', 'Test Title');
    const raw = makeXmlResponse({ blocks });
    const llmResult = makeLLMResult({ text: raw });

    const parsed = parseLLMResponse(llmResult);

    expect(parsed.extracted_blocks).toHaveLength(1);
    expect(parsed.extracted_blocks[0].type).toBe('commentary');
    expect(parsed.extracted_blocks[0].content).toBe('Test content');
    expect(parsed.extracted_blocks[0].title).toBe('Test Title');
  });

  it('propagates parse_warnings from Layer 2', () => {
    const llmResult = makeLLMResult({ text: 'Plain text, no XML' });

    const parsed = parseLLMResponse(llmResult);

    expect(parsed.parse_warnings.length).toBeGreaterThan(0);
    expect(parsed.parse_warnings).toContain('No <response> envelope found — treating as plain text');
  });

  it('propagates diagnostics from Layer 2', () => {
    const raw = makeXmlResponse({
      diagnostics: 'Route: draft_graph',
      assistantText: 'Creating model',
    });
    const llmResult = makeLLMResult({ text: raw });

    const parsed = parseLLMResponse(llmResult);

    expect(parsed.diagnostics).toBe('Route: draft_graph');
  });

  it('preserves empty string assistant_text from fallback 2 (not coerced to null)', () => {
    // Fallback 2: <response> present but <assistant_text> missing
    const raw = `<response>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;
    const llmResult = makeLLMResult({ text: raw });

    const parsed = parseLLMResponse(llmResult);

    // Empty string preserved (not coerced to null)
    // null in ParsedLLMResponse means "no text content at all" (Layer 1)
    expect(parsed.assistant_text).toBe('');
    expect(parsed.parse_warnings).toContain('<response> present but <assistant_text> missing');
  });

  it('returns null assistant_text only when no text blocks at all', () => {
    const llmResult = makeLLMResult({
      toolCalls: [{ id: 'toolu_1', name: 'draft_graph', input: {} }],
    });

    const parsed = parseLLMResponse(llmResult);

    expect(parsed.assistant_text).toBeNull();
  });
});

// ============================================================================
// Helper functions
// ============================================================================

describe('getFirstToolInvocation', () => {
  it('returns first tool when present', () => {
    const llmResult = makeLLMResult({
      toolCalls: [
        { id: 'toolu_1', name: 'draft_graph', input: {} },
        { id: 'toolu_2', name: 'run_analysis', input: {} },
      ],
    });
    const parsed = parseLLMResponse(llmResult);
    const first = getFirstToolInvocation(parsed);

    expect(first).not.toBeNull();
    expect(first!.name).toBe('draft_graph');
  });

  it('returns null when no tool invocations', () => {
    const llmResult = makeLLMResult({ text: 'no tools' });
    const parsed = parseLLMResponse(llmResult);

    expect(getFirstToolInvocation(parsed)).toBeNull();
  });
});

describe('hasToolInvocations', () => {
  it('returns true when tool invocations present', () => {
    const llmResult = makeLLMResult({
      toolCalls: [{ id: 'toolu_1', name: 'draft_graph', input: {} }],
    });
    const parsed = parseLLMResponse(llmResult);

    expect(hasToolInvocations(parsed)).toBe(true);
  });

  it('returns false when no tool invocations', () => {
    const llmResult = makeLLMResult({ text: 'no tools' });
    const parsed = parseLLMResponse(llmResult);

    expect(hasToolInvocations(parsed)).toBe(false);
  });
});
