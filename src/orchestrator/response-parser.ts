/**
 * Response Parser for Orchestrator
 *
 * Two-layer parsing:
 * 1. Anthropic content blocks — extracts text (concatenated) and tool_use invocations.
 * 2. XML envelope extraction — from concatenated text, extracts:
 *    - <diagnostics> (stripped — internal reasoning, not surfaced)
 *    - <assistant_text> (user-visible prose)
 *    - <blocks> containing commentary or review_card blocks
 *    - <suggested_actions> (capped at 2)
 *
 * Safety rules:
 * - FactBlock and GraphPatchBlock are NEVER parsed from free text
 *   (they are server-constructed from tool output only).
 * - Never throws on malformed XML — falls back gracefully.
 * - Unknown block types in <blocks> are silently dropped.
 */

import type { ToolResponseBlock, ChatWithToolsResult } from "../adapters/llm/types.js";
import type { SuggestedAction } from "./types.js";

// ============================================================================
// Parsed Response Types
// ============================================================================

export interface ToolInvocation {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** An AI-authored block extracted from XML <blocks> in LLM text. */
export interface ExtractedBlock {
  type: 'commentary' | 'review_card';
  title?: string;
  content: string;
  /** Only for review_card */
  tone?: 'facilitator' | 'challenger';
}

export interface ParsedLLMResponse {
  /** User-visible text: from <assistant_text> if XML envelope present, else raw text */
  assistant_text: string | null;
  /** Tool invocations extracted from tool_use content blocks */
  tool_invocations: ToolInvocation[];
  /** AI-authored blocks extracted from XML <blocks> (commentary + review_card only) */
  extracted_blocks: ExtractedBlock[];
  /** Suggested actions extracted from XML <suggested_actions> (max 2) */
  suggested_actions: SuggestedAction[];
  /** Raw stop reason from the LLM */
  stop_reason: ChatWithToolsResult['stop_reason'];
}

// ============================================================================
// XML Extraction Helpers
// ============================================================================

/** Types allowed in AI-authored <blocks>. FactBlock/GraphPatchBlock are NEVER parsed from text. */
const ALLOWED_BLOCK_TYPES = new Set(['commentary', 'review_card']);

/**
 * Extract content between XML-like tags. Returns null if tag not found.
 * Greedy match — takes everything between first open and last close.
 */
function extractTag(text: string, tag: string): string | null {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const startIdx = text.indexOf(openTag);
  if (startIdx === -1) return null;
  const contentStart = startIdx + openTag.length;
  const endIdx = text.lastIndexOf(closeTag);
  if (endIdx === -1 || endIdx <= contentStart) return null;
  return text.substring(contentStart, endIdx).trim();
}

/**
 * Extract all occurrences of a tag.
 */
function extractAllTags(text: string, tag: string): string[] {
  const results: string[] = [];
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const startIdx = text.indexOf(openTag, searchFrom);
    if (startIdx === -1) break;
    const contentStart = startIdx + openTag.length;
    const endIdx = text.indexOf(closeTag, contentStart);
    if (endIdx === -1) break;
    results.push(text.substring(contentStart, endIdx).trim());
    searchFrom = endIdx + closeTag.length;
  }

  return results;
}

/**
 * Strip <diagnostics>...</diagnostics> from text.
 * Diagnostics are internal reasoning — never surfaced to the user.
 */
function stripDiagnostics(text: string): string {
  return text.replace(/<diagnostics>[\s\S]*?<\/diagnostics>/g, '').trim();
}

/**
 * Parse blocks from the <blocks> section.
 * Only commentary and review_card are allowed. Everything else is dropped.
 */
function parseBlocks(blocksContent: string): ExtractedBlock[] {
  const rawBlocks = extractAllTags(blocksContent, 'block');
  const results: ExtractedBlock[] = [];

  for (const raw of rawBlocks) {
    const typeStr = extractTag(raw, 'type');
    if (!typeStr || !ALLOWED_BLOCK_TYPES.has(typeStr)) continue;

    const content = extractTag(raw, 'content');
    if (!content) continue;

    const block: ExtractedBlock = {
      type: typeStr as 'commentary' | 'review_card',
      content,
    };

    const title = extractTag(raw, 'title');
    if (title) block.title = title;

    if (typeStr === 'review_card') {
      const tone = extractTag(raw, 'tone');
      if (tone === 'facilitator' || tone === 'challenger') {
        block.tone = tone;
      }
    }

    results.push(block);
  }

  return results;
}

/**
 * Parse suggested actions from the <suggested_actions> section.
 * Capped at 2 per turn.
 */
function parseSuggestedActions(actionsContent: string): SuggestedAction[] {
  const rawActions = extractAllTags(actionsContent, 'action');
  const results: SuggestedAction[] = [];

  for (const raw of rawActions) {
    if (results.length >= 2) break;

    const label = extractTag(raw, 'label');
    const message = extractTag(raw, 'message');
    const role = extractTag(raw, 'role');

    if (!label || !message) continue;

    const validRole = (role === 'facilitator' || role === 'challenger') ? role : 'facilitator';

    results.push({
      label,
      prompt: message,
      role: validRole,
    });
  }

  return results;
}

// ============================================================================
// XML Envelope Parser
// ============================================================================

interface XmlEnvelopeResult {
  assistantText: string | null;
  extractedBlocks: ExtractedBlock[];
  suggestedActions: SuggestedAction[];
}

/**
 * Attempt to parse the XML envelope from LLM text.
 *
 * Expected structure:
 *   <diagnostics>...</diagnostics>
 *   <response>
 *     <assistant_text>...</assistant_text>
 *     <blocks>...</blocks>
 *     <suggested_actions>...</suggested_actions>
 *   </response>
 *
 * Falls back gracefully:
 * - No <response> tag → use stripped text as assistant_text
 * - Malformed XML → use stripped text as assistant_text
 */
function parseXmlEnvelope(rawText: string): XmlEnvelopeResult {
  // Strip diagnostics first
  const stripped = stripDiagnostics(rawText);

  // Try to find <response> envelope
  const responseContent = extractTag(stripped, 'response');
  if (!responseContent) {
    // No XML envelope — use stripped text as-is
    return {
      assistantText: stripped || null,
      extractedBlocks: [],
      suggestedActions: [],
    };
  }

  // Extract assistant_text from within <response>
  const assistantText = extractTag(responseContent, 'assistant_text');

  // Extract blocks
  const blocksContent = extractTag(responseContent, 'blocks');
  const extractedBlocks = blocksContent ? parseBlocks(blocksContent) : [];

  // Extract suggested actions
  const actionsContent = extractTag(responseContent, 'suggested_actions');
  const suggestedActions = actionsContent ? parseSuggestedActions(actionsContent) : [];

  return {
    assistantText: assistantText || null,
    extractedBlocks,
    suggestedActions,
  };
}

// ============================================================================
// Main Parser
// ============================================================================

/**
 * Parse a ChatWithToolsResult into structured components.
 *
 * Layer 1: Anthropic content blocks → text + tool_use invocations.
 * Layer 2: XML envelope extraction from text → assistant_text, blocks, suggested_actions.
 */
export function parseLLMResponse(result: ChatWithToolsResult): ParsedLLMResponse {
  const textParts: string[] = [];
  const toolInvocations: ToolInvocation[] = [];

  for (const block of result.content) {
    if (block.type === 'text') {
      const trimmed = block.text.trim();
      if (trimmed) {
        textParts.push(trimmed);
      }
    } else if (block.type === 'tool_use') {
      toolInvocations.push({
        id: block.id,
        name: block.name,
        input: block.input,
      });
    }
  }

  const rawText = textParts.length > 0 ? textParts.join('\n\n') : null;

  // If there's text content, attempt XML envelope extraction
  if (rawText) {
    const envelope = parseXmlEnvelope(rawText);
    return {
      assistant_text: envelope.assistantText,
      tool_invocations: toolInvocations,
      extracted_blocks: envelope.extractedBlocks,
      suggested_actions: envelope.suggestedActions,
      stop_reason: result.stop_reason,
    };
  }

  return {
    assistant_text: null,
    tool_invocations: toolInvocations,
    extracted_blocks: [],
    suggested_actions: [],
    stop_reason: result.stop_reason,
  };
}

/**
 * Check if the response contains any tool invocations.
 */
export function hasToolInvocations(parsed: ParsedLLMResponse): boolean {
  return parsed.tool_invocations.length > 0;
}

/**
 * Get the first tool invocation (most common case — single tool per turn).
 * Returns null if no tool invocations.
 */
export function getFirstToolInvocation(parsed: ParsedLLMResponse): ToolInvocation | null {
  return parsed.tool_invocations[0] ?? null;
}
