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
import { log, emit } from "../utils/telemetry.js";

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
 * Regex matching lines that look like LLM diagnostics emitted outside
 * `<diagnostics>` tags — e.g. "Mode: INTERPRET. Stage: IDEATE. …"
 *
 * Only matches lines that appear *before the first XML tag* so we never
 * accidentally strip user-visible prose inside `<response>`.
 *
 * Uses anchored key-value prefixes only — no bare keyword matching like
 * SUGGEST/ACT/RECOVER which would false-positive on normal prose.
 */
const DIAGNOSTICS_PREAMBLE_LINE =
  /^(?:Mode:|Stage:|Context:|Route:|Tool:|Using:).*$|^No tool (?:needed|invocation)\b.*$/i;

/**
 * Strip leading diagnostics-like lines that appear before any XML tag.
 *
 * Some LLM outputs emit diagnostics as a preamble (before `<diagnostics>`)
 * or omit the `<diagnostics>` tags entirely. This function removes those
 * leading lines so they don't pollute `assistant_text`.
 */
function stripDiagnosticsPreamble(text: string, warnings: string[]): string {
  const firstTagIdx = text.search(/<[a-zA-Z]/);

  // No XML tag at all — scan the entire text
  // Has XML tag — only inspect the part before it
  const preamble = firstTagIdx === -1 ? text : text.substring(0, firstTagIdx);
  const rest = firstTagIdx === -1 ? '' : text.substring(firstTagIdx);

  if (!preamble.trim()) return text;

  const lines = preamble.split('\n');
  const kept: string[] = [];
  let strippedAny = false;

  for (const line of lines) {
    if (DIAGNOSTICS_PREAMBLE_LINE.test(line.trim()) && line.trim().length > 0) {
      strippedAny = true;
    } else {
      kept.push(line);
    }
  }

  if (!strippedAny) return text;

  const strippedCount = lines.length - kept.length;
  const cleaned = kept.join('\n').trim();
  const result = cleaned ? `${cleaned}\n${rest}`.trim() : rest.trim();

  // Fail-safe: if stripping would leave nothing, restore original text.
  // This prevents false positives from producing empty assistant_text.
  if (!result) {
    warnings.push(`Diagnostics preamble stripping would empty text (${strippedCount} lines) — restored original`);
    return text;
  }

  warnings.push(`Diagnostics-like preamble stripped before XML envelope (${strippedCount} line(s))`);
  emit("orchestrator.diagnostics_preamble_stripped", { stripped_line_count: strippedCount, had_xml: firstTagIdx !== -1 });
  return result;
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
  let actionIndex = 0;
  for (const raw of rawActions) {
    if (results.length >= 2) {
      truncated = true;
      break;
    }

    const label = extractTag(raw, 'label');
    const message = extractTag(raw, 'message');
    const role = extractTag(raw, 'role');

    if (!label || !message) {
      const missingFields = [...(!label ? ['label'] : []), ...(!message ? ['message'] : [])];
      const diagnostic = {
        issue: 'action_dropped_missing_fields',
        action_index: actionIndex,
        missing_fields: missingFields,
        label_char_count: label?.length ?? 0,
        message_char_count: message?.length ?? 0,
      };
      warnings.push(JSON.stringify(diagnostic));
      log.warn(diagnostic, 'response-parser: suggested action dropped — missing required fields');
      actionIndex++;
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
    actionIndex++;
  }

  if (truncated) {
    warnings.push(`More than 2 suggested actions — truncated to 2`);
  }

  return results;
}

/**
 * Rescue suggested actions that the LLM embedded in assistant_text as prose
 * instead of placing them in `<suggested_actions>`.
 *
 * Matches lines like:
 *   Facilitator: Need someone in 3 months — Timeline is tight…
 *   Challenger: No rush, need it right — We can take 6 months…
 *   **Facilitator:** Label — Description
 *   - Facilitator: Label — Description
 *
 * Only runs when the structured `<suggested_actions>` extraction yielded
 * nothing — this is a conservative fallback, not a primary path.
 *
 * Returns { actions, cleanedText } where cleanedText has the matched lines removed.
 */
// Matches inline action lines with REQUIRED label–message separator:
//   Facilitator: Label — Message
//   **Facilitator:** Label — Message
//   - Challenger: Label – Message
// Both label and message parts must be present (separated by — or –)
// to avoid false-positives on prose like "Facilitator: the person who runs..."
const INLINE_ACTION_RE =
  /^[-\s]*\*{0,2}(facilitator|challenger)(?:\s*:\s*\*{0,2}|\s*\*{0,2}\s*[:–—])\s*(.+?)\s*[–—]\s*(.+)$/i;

function rescueInlineActions(
  assistantText: string,
  warnings: string[],
): { actions: ParsedAction[]; cleanedText: string } {
  const lines = assistantText.split('\n');
  const actions: ParsedAction[] = [];
  const kept: string[] = [];
  let truncated = false;

  for (const line of lines) {
    if (actions.length >= 2) {
      // Check if overflow lines also match — track for warning parity
      if (INLINE_ACTION_RE.test(line.trim())) {
        truncated = true;
      }
      kept.push(line);
      continue;
    }
    const m = INLINE_ACTION_RE.exec(line.trim());
    if (m) {
      const role = m[1].toLowerCase() as 'facilitator' | 'challenger';
      const label = m[2].trim();
      const message = m[3].trim();
      actions.push({ role, label, message });
    } else {
      kept.push(line);
    }
  }

  if (actions.length > 0) {
    warnings.push(`Rescued ${actions.length} inline suggested action(s) from assistant_text`);
  }
  if (truncated) {
    warnings.push('More than 2 inline suggested actions — truncated to 2');
  }

  return { actions, cleanedText: kept.join('\n').trim() };
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
 * Parse paths (numbered 1–6, tested in diagnostics-parsing.test.ts):
 * Path 1 (tool-only): handled at parseLLMResponse layer — no text → null
 * Path 2 (full envelope): <diagnostics> + <response> + <assistant_text> → normal
 * Path 3 (partial envelope): <response> present, <diagnostics> missing → warn, parse
 * Path 4 (standalone tag): no <response> but <assistant_text> extractable → warn, extract
 * Path 5 (plain text): no XML structure → entire input as assistant_text, warn
 * Path 6 (empty): empty/whitespace → generic fallback message
 */
export function parseOrchestratorResponse(raw: string): ParsedResponse {
  const warnings: string[] = [];

  // Trim leading whitespace (models may emit leading whitespace/newlines)
  const trimmed = raw.trimStart();

  // Path 6: empty or whitespace-only input → generic fallback message
  if (!trimmed) {
    warnings.push('Empty or whitespace-only input — returning generic fallback');
    emit("orchestrator.xml_parse_fallback", { path: "empty_input" });
    return {
      diagnostics: null,
      assistant_text: "I had trouble processing that. Could you rephrase your question?",
      blocks: [],
      suggested_actions: [],
      parse_warnings: warnings,
    };
  }

  // Extract diagnostics (capture, don't discard)
  const diagnostics = extractDiagnostics(trimmed);

  // Path 3 (partial envelope): <diagnostics> missing or malformed
  if (!diagnostics && trimmed.includes('<response>')) {
    warnings.push('<diagnostics> missing or malformed — response_mode_declared will be unknown');
  }

  // Strip diagnostics from text for further processing
  const strippedTags = stripDiagnostics(trimmed);
  // Also strip diagnostics-like preamble that appears before any XML tag
  const withoutDiagnostics = stripDiagnosticsPreamble(strippedTags, warnings);

  // Try to find <response> envelope
  const responseContent = extractTag(withoutDiagnostics, 'response');

  // No <response> tag found
  if (!responseContent) {
    // Path 4 (standalone tag): no <response> but <assistant_text> is extractable directly
    const standaloneAssistantText = extractTag(withoutDiagnostics, 'assistant_text');
    if (standaloneAssistantText !== null) {
      warnings.push('No <response> envelope but <assistant_text> found — extracting directly');
      emit("orchestrator.xml_parse_fallback", { path: "standalone_tag" });
      let text = unescapeXmlEntities(standaloneAssistantText);
      const rescued = rescueInlineActions(text, warnings);
      return {
        diagnostics,
        assistant_text: rescued.actions.length > 0 ? rescued.cleanedText : text,
        blocks: [],
        suggested_actions: rescued.actions,
        parse_warnings: warnings,
      };
    }

    // Path 5 (plain text): nothing structured — treat entire text as plain assistant_text
    warnings.push('No <response> envelope found — treating as plain text');
    emit("orchestrator.xml_parse_fallback", { path: "plain_text" });
    let plainText = unescapeXmlEntities(withoutDiagnostics);
    const rescued = rescueInlineActions(plainText, warnings);
    return {
      diagnostics,
      assistant_text: rescued.actions.length > 0 ? rescued.cleanedText : plainText,
      blocks: [],
      suggested_actions: rescued.actions,
      parse_warnings: warnings,
    };
  }

  // Extract assistant_text from within <response>
  const assistantTextRaw = extractTag(responseContent, 'assistant_text');

  let assistantText: string;
  if (assistantTextRaw === null) {
    // Path 3 sub-case: <response> found but <assistant_text> missing
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
  let suggestedActions = actionsContent
    ? parseSuggestedActionsWithWarnings(actionsContent, warnings)
    : [];

  // Rescue: if structured extraction found nothing, try extracting inline
  // actions from assistant_text (LLM sometimes embeds them as prose lines).
  if (suggestedActions.length === 0 && assistantText) {
    const rescued = rescueInlineActions(assistantText, warnings);
    if (rescued.actions.length > 0) {
      suggestedActions = rescued.actions;
      assistantText = rescued.cleanedText;
    }
  }

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

// ============================================================================
// Response Mode Telemetry (cf-v11.1)
// ============================================================================

export type ResponseMode = 'INTERPRET' | 'SUGGEST' | 'ACT' | 'RECOVER' | 'unknown';

/**
 * Extract the declared response mode from the <diagnostics> content.
 *
 * Looks for "Mode: INTERPRET|SUGGEST|ACT|RECOVER" (case-insensitive).
 * Returns 'unknown' if not found or diagnostics is null.
 */
export function extractDeclaredMode(diagnostics: string | null): ResponseMode {
  if (!diagnostics) return 'unknown';

  const match = diagnostics.match(/Mode:\s*(INTERPRET|SUGGEST|ACT|RECOVER)/i);
  if (!match) return 'unknown';

  return match[1].toUpperCase() as ResponseMode;
}

/**
 * Infer the actual response mode from parsed LLM response.
 *
 * Ground truth derived from actual behaviour:
 * - ACT: tool was invoked
 * - RECOVER: response contains error/problem/blocked language
 * - SUGGEST: response contains suggestion language
 * - INTERPRET: default
 */
export function inferResponseMode(parsed: ParsedLLMResponse): ResponseMode {
  if (parsed.tool_invocations.length > 0) return 'ACT';

  const text = parsed.assistant_text?.toLowerCase() ?? '';

  // RECOVER patterns
  if (/\b(sorry|error|failed|blocked|can't|cannot|unable to|went wrong)\b/.test(text)) {
    return 'RECOVER';
  }

  // SUGGEST patterns
  if (/\b(would you like|shall i|consider|worth (adding|considering|including)|i could)\b/.test(text)) {
    return 'SUGGEST';
  }

  return 'INTERPRET';
}
