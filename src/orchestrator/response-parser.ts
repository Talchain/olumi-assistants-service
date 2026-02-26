/**
 * Response Parser for Orchestrator
 *
 * Two-layer parsing:
 * 1. Anthropic content blocks — extracts text (concatenated) and tool_use invocations.
 * 2. XML envelope extraction — from concatenated text, extracts:
 *    - <diagnostics> (captured for debug, stripped from user-visible output)
 *    - <assistant_text> (user-visible prose)
 *    - <blocks> containing commentary or review_card blocks
 *    - <suggested_actions> (capped at 2)
 *
 * Safety rules:
 * - FactBlock and GraphPatchBlock are NEVER parsed from free text
 *   (they are server-constructed from tool output only).
 * - Never throws on malformed XML — falls back gracefully with parse_warnings.
 * - Unknown block types in <blocks> are dropped with a warning.
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

/** Parsed block from the XML envelope (brief-specified type). */
export interface ParsedBlock {
  type: 'commentary' | 'review_card';
  tone?: 'facilitator' | 'challenger';
  title?: string;
  content: string;
}

/** Parsed action from the XML envelope (brief-specified type). */
export interface ParsedAction {
  role: 'facilitator' | 'challenger';
  label: string;
  message: string;
}

/**
 * Output of parseOrchestratorResponse() — pure XML envelope parse result.
 *
 * Never throws. All malformed input results in a degraded-but-valid
 * response with parse_warnings describing the issues.
 */
export interface ParsedResponse {
  diagnostics: string | null;
  assistant_text: string;
  blocks: ParsedBlock[];
  suggested_actions: ParsedAction[];
  parse_warnings: string[];
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
  /** Diagnostics content from <diagnostics> tag (null if missing/malformed) */
  diagnostics: string | null;
  /** Any parse issues encountered during XML extraction */
  parse_warnings: string[];
}

// ============================================================================
// XML Entity Unescaping
// ============================================================================

const XML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

const XML_ENTITY_RE = /&(?:amp|lt|gt|quot|apos);/g;

/**
 * Unescape the five standard XML entities in text content.
 */
export function unescapeXmlEntities(text: string): string {
  return text.replace(XML_ENTITY_RE, (match) => XML_ENTITY_MAP[match] ?? match);
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
 * Extract <diagnostics>…</diagnostics> content from text.
 * Returns the diagnostics content, or null if not found.
 */
function extractDiagnostics(text: string): string | null {
  const match = text.match(/<diagnostics>([\s\S]*?)<\/diagnostics>/);
  return match ? match[1].trim() : null;
}

/**
 * Strip <diagnostics>...</diagnostics> from text.
 */
function stripDiagnostics(text: string): string {
  return text.replace(/<diagnostics>[\s\S]*?<\/diagnostics>/g, '').trim();
}

/**
 * Parse blocks from the <blocks> section with warning collection.
 * Only commentary and review_card are allowed. Everything else is dropped with a warning.
 */
function parseBlocksWithWarnings(
  blocksContent: string,
  warnings: string[],
): ParsedBlock[] {
  const rawBlocks = extractAllTags(blocksContent, 'block');
  const results: ParsedBlock[] = [];

  for (const raw of rawBlocks) {
    const typeStr = extractTag(raw, 'type');
    if (!typeStr) {
      warnings.push('Block missing <type> tag — dropped');
      continue;
    }
    if (!ALLOWED_BLOCK_TYPES.has(typeStr)) {
      warnings.push(`Unknown block type "${typeStr}" — dropped`);
      continue;
    }

    const content = extractTag(raw, 'content');
    if (!content) {
      warnings.push(`Block of type "${typeStr}" missing <content> — dropped`);
      continue;
    }

    const block: ParsedBlock = {
      type: typeStr as 'commentary' | 'review_card',
      content: unescapeXmlEntities(content),
    };

    const title = extractTag(raw, 'title');
    if (title) block.title = unescapeXmlEntities(title);

    if (typeStr === 'review_card') {
      const tone = extractTag(raw, 'tone');
      if (tone === 'facilitator' || tone === 'challenger') {
        block.tone = tone;
      } else {
        block.tone = 'facilitator';
      }
    }

    results.push(block);
  }

  return results;
}

/**
 * Parse suggested actions from the <suggested_actions> section with warning collection.
 * Capped at 2 per turn.
 */
function parseSuggestedActionsWithWarnings(
  actionsContent: string,
  warnings: string[],
): ParsedAction[] {
  const rawActions = extractAllTags(actionsContent, 'action');
  const results: ParsedAction[] = [];

  let truncated = false;
  for (const raw of rawActions) {
    if (results.length >= 2) {
      truncated = true;
      break;
    }

    const label = extractTag(raw, 'label');
    const message = extractTag(raw, 'message');
    const role = extractTag(raw, 'role');

    if (!label || !message) {
      warnings.push('Action missing required <label> or <message> — dropped');
      continue;
    }

    let validRole: 'facilitator' | 'challenger';
    if (role === 'facilitator' || role === 'challenger') {
      validRole = role;
    } else {
      validRole = 'facilitator';
      warnings.push(`Action role "${role ?? '(missing)'}" invalid — defaulted to facilitator`);
    }

    results.push({
      label: unescapeXmlEntities(label),
      message: unescapeXmlEntities(message),
      role: validRole,
    });
  }

  if (truncated) {
    warnings.push(`More than 2 suggested actions — truncated to 2`);
  }

  return results;
}

// ============================================================================
// Pure XML Envelope Parser
// ============================================================================

/**
 * Parse raw LLM text into structured components.
 *
 * Pure function — no side effects, no logging, no async.
 * Never throws. All malformed input results in a degraded-but-valid
 * ParsedResponse with parse_warnings describing the issues.
 *
 * Fallback cascade:
 * 1. <response> + <assistant_text> found → extract normally
 * 2. <response> found, <assistant_text> missing → assistant_text = '', warning
 * 3. No <response> tag → entire input (trimmed) as plain assistant_text, warning
 * 4. Empty/whitespace input → assistant_text = '', warning
 */
export function parseOrchestratorResponse(raw: string): ParsedResponse {
  const warnings: string[] = [];

  // Trim leading whitespace (models may emit leading whitespace/newlines)
  const trimmed = raw.trimStart();

  // Fallback 4: empty or whitespace-only input
  if (!trimmed) {
    warnings.push('Empty or whitespace-only input');
    return {
      diagnostics: null,
      assistant_text: '',
      blocks: [],
      suggested_actions: [],
      parse_warnings: warnings,
    };
  }

  // Extract diagnostics (capture, don't discard)
  const diagnostics = extractDiagnostics(trimmed);

  // Strip diagnostics from text for further processing
  const withoutDiagnostics = stripDiagnostics(trimmed);

  // Try to find <response> envelope
  const responseContent = extractTag(withoutDiagnostics, 'response');

  // Fallback 3: no <response> tag
  if (!responseContent) {
    warnings.push('No <response> envelope found — treating as plain text');
    return {
      diagnostics,
      assistant_text: unescapeXmlEntities(withoutDiagnostics),
      blocks: [],
      suggested_actions: [],
      parse_warnings: warnings,
    };
  }

  // Extract assistant_text from within <response>
  const assistantTextRaw = extractTag(responseContent, 'assistant_text');

  let assistantText: string;
  if (assistantTextRaw === null) {
    // Fallback 2: <response> found but <assistant_text> missing
    warnings.push('<response> present but <assistant_text> missing');
    assistantText = '';
  } else {
    assistantText = unescapeXmlEntities(assistantTextRaw);
  }

  // Extract blocks
  const blocksContent = extractTag(responseContent, 'blocks');
  const blocks = blocksContent ? parseBlocksWithWarnings(blocksContent, warnings) : [];

  // Extract suggested actions
  const actionsContent = extractTag(responseContent, 'suggested_actions');
  const suggestedActions = actionsContent
    ? parseSuggestedActionsWithWarnings(actionsContent, warnings)
    : [];

  return {
    diagnostics,
    assistant_text: assistantText,
    blocks,
    suggested_actions: suggestedActions,
    parse_warnings: warnings,
  };
}

// ============================================================================
// Legacy XML Envelope Parser (backward compat — delegates to parseOrchestratorResponse)
// ============================================================================

interface XmlEnvelopeResult {
  assistantText: string;
  extractedBlocks: ExtractedBlock[];
  suggestedActions: SuggestedAction[];
  diagnostics: string | null;
  parseWarnings: string[];
}

/**
 * Attempt to parse the XML envelope from LLM text.
 * Delegates to parseOrchestratorResponse() and maps types.
 */
function parseXmlEnvelope(rawText: string): XmlEnvelopeResult {
  const parsed = parseOrchestratorResponse(rawText);

  // Map ParsedBlock[] → ExtractedBlock[]
  const extractedBlocks: ExtractedBlock[] = parsed.blocks.map((b) => {
    const block: ExtractedBlock = {
      type: b.type,
      content: b.content,
    };
    if (b.title) block.title = b.title;
    if (b.tone) block.tone = b.tone;
    return block;
  });

  // Map ParsedAction[] → SuggestedAction[]
  const suggestedActions: SuggestedAction[] = parsed.suggested_actions.map((a) => ({
    label: a.label,
    prompt: a.message,
    role: a.role,
  }));

  return {
    // Preserve empty string from parser fallback (don't coerce to null)
    assistantText: parsed.assistant_text,
    extractedBlocks,
    suggestedActions,
    diagnostics: parsed.diagnostics,
    parseWarnings: parsed.parse_warnings,
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
      // Preserve empty string from parser fallback (e.g., <response> without <assistant_text>).
      // null only comes from the "no text content at all" path below (Layer 1).
      assistant_text: envelope.assistantText,
      tool_invocations: toolInvocations,
      extracted_blocks: envelope.extractedBlocks,
      suggested_actions: envelope.suggestedActions,
      stop_reason: result.stop_reason,
      diagnostics: envelope.diagnostics,
      parse_warnings: envelope.parseWarnings,
    };
  }

  return {
    assistant_text: null,
    tool_invocations: toolInvocations,
    extracted_blocks: [],
    suggested_actions: [],
    stop_reason: result.stop_reason,
    diagnostics: null,
    parse_warnings: [],
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
