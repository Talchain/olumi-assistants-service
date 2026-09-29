/**
 * JSON example extractor for prompt text.
 *
 * Scans prompt template strings for embedded JSON objects and arrays.
 * Uses balanced brace/bracket matching + JSON.parse validation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedExample {
  /** 0-based index within the prompt */
  exampleIndex: number;
  /** Parsed JSON value */
  json: unknown;
  /** ~80 chars of surrounding text before the JSON (for context in error messages) */
  context: string;
  /** Character offset in the prompt string where the JSON starts */
  offset: number;
  /** The raw JSON string before parsing */
  rawJson: string;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract all valid JSON objects and arrays from prompt text.
 *
 * Strategy:
 * 1. Scan for `{` or `[` characters
 * 2. Balanced brace/bracket match forward
 * 3. Attempt JSON.parse on the balanced region
 * 4. Deduplicate: drop any example whose range is entirely contained within another
 *
 * Handles:
 * - Standalone JSON blocks
 * - JSON inside XML-like tags (<examples>, <output>, etc.)
 * - Multi-line nested objects (annotated examples)
 *
 * Skips:
 * - Partial fragments (contrastive examples like `fac_x: category: "controllable"`)
 * - Template literals and regex-like braces that don't parse as JSON
 */
export function extractPromptExamples(promptText: string): ExtractedExample[] {
  const raw: Array<{ offset: number; endOffset: number; json: unknown; rawJson: string }> = [];
  const len = promptText.length;

  for (let i = 0; i < len; i++) {
    const ch = promptText[i];
    if (ch !== '{' && ch !== '[') continue;

    const close = ch === '{' ? '}' : ']';
    const result = balancedMatch(promptText, i, ch, close);
    if (result === null) continue;

    const candidate = promptText.slice(i, result + 1);

    // Skip very short strings (likely not real JSON examples)
    if (candidate.length < 5) continue;

    try {
      const parsed = JSON.parse(candidate);
      // Skip primitives wrapped in arrays (e.g., [0, 1])
      if (Array.isArray(parsed) && parsed.every(v => typeof v !== 'object' || v === null)) continue;
      // Skip empty objects/arrays
      if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length === 0) continue;

      raw.push({ offset: i, endOffset: result, json: parsed, rawJson: candidate });
      // Advance past this JSON to avoid re-scanning interior braces
      i = result;
    } catch {
      // Not valid JSON — skip this opening brace/bracket
    }
  }

  // Deduplicate: remove examples whose range is entirely within a larger example
  const deduped = raw.filter((item, idx) => {
    return !raw.some((other, otherIdx) =>
      otherIdx !== idx &&
      other.offset <= item.offset &&
      other.endOffset >= item.endOffset &&
      (other.endOffset - other.offset) > (item.endOffset - item.offset),
    );
  });

  return deduped.map((item, idx) => ({
    exampleIndex: idx,
    json: item.json,
    context: promptText.slice(Math.max(0, item.offset - 80), item.offset).trim(),
    offset: item.offset,
    rawJson: item.rawJson,
  }));
}

// ---------------------------------------------------------------------------
// Balanced matching
// ---------------------------------------------------------------------------

/**
 * Find the matching close brace/bracket, accounting for nesting and strings.
 * Returns the index of the closing character, or null if unbalanced.
 */
function balancedMatch(
  text: string,
  start: number,
  open: string,
  close: string,
): number | null {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }

  return null;
}
