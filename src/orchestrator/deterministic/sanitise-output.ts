/**
 * Output Sanitiser
 *
 * Cleans user-facing text (assistantText, suggested_action labels/messages,
 * graph_patch summaries) before the envelope is returned. Applied after all
 * other text assembly (coaching, chip pre-text, error text) but before the
 * proposal-language guard.
 *
 * Transformations are safe for all turn types — they remove typographic
 * artefacts and flag leaked internal terminology without altering meaning.
 */

import { log } from "../../utils/telemetry.js";

/**
 * Banned terms that should not appear in user-facing text.
 * Logged for observability but NOT rewritten (to avoid silently altering meaning).
 */
const BANNED_TERMS = /\b(interventions|graph_patch|patch|operation)\b/i;

/**
 * Pattern for inline quoted chip-like lines the LLM sometimes writes
 * alongside the real chips:
 *
 *     "Challenge the Cost driver" (challenger)
 *     "Calibrate market size" (facilitator)
 *     "What would flip this?" (scientist)
 *
 * Must be a standalone line — we never strip mid-paragraph quotes or
 * factor labels wrapped in quotes. The role tag is optional (some LLM
 * outputs drop the parenthetical), but at least one of the role words
 * must appear, OR the line must be a full-length single-quoted line
 * with no other content. We stick to the stricter role-required variant
 * here to avoid false positives.
 */
const INLINE_CHIP_LINE_PATTERN =
  /^[ \t]*["“][^"”\n]{5,60}["”][ \t]*[-–—]?[ \t]*\(?(?:facilitator|challenger|scientist)\)?[ \t]*$/gim;

/**
 * "node" in a non-technical context — skip when preceded by common technical
 * qualifiers that make it a legitimate graph-modelling term.
 */
const NODE_TERM = /(?<!\bfactor |option |goal |decision |risk )(\bnode\b)/i;

export interface SanitiseOptions {
  /**
   * When true, preserve `**bold**` markers instead of stripping them.
   * Use for fields where a downstream renderer (e.g. UI safeRichText)
   * converts markdown to styled HTML. Default: false (strip markers).
   */
  preserveBold?: boolean;
}

/**
 * Sanitise user-facing text produced by the deterministic pipeline.
 *
 * Transformations (applied in order):
 * 1. "observed state" → "value"
 * 2. Em/en dashes → `. ` (new sentence)
 * 3. Strip bold markdown markers: `**text**` → `text` (unless preserveBold)
 * 4. Fix "a observable" → "an observable" (known case only)
 * 5. Log (don't rewrite) banned internal terms
 */
export function sanitiseAssistantText(text: string, opts?: SanitiseOptions): string {
  if (!text) return text;

  // 1. "observed state" → "value" (before dash replacement so capitalisation
  //    pass in step 2 naturally capitalises "value" at sentence boundaries)
  let result = text.replace(/\bobserved state\b/gi, 'value');

  // 2. Em dashes (U+2014) and en dashes (U+2013) → `. `
  //    Trim surrounding whitespace so "cost — this" becomes "cost. This"
  //    and capitalise the following letter for proper sentence start.
  //    Capitalisation is done in the same replacement to avoid touching
  //    existing periods (e.g. "i.e. something" stays untouched).
  result = result.replace(
    /\s*[\u2013\u2014]\s*([a-z])?/g,
    (_, ch?: string) => ch ? `. ${ch.toUpperCase()}` : '. ',
  );

  // 3. Strip bold markdown markers (skip when downstream renderer handles them)
  if (!opts?.preserveBold) {
    result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  }

  // 4. Article correction — narrow to the one known false case
  result = result.replace(/\ba observable\b/gi, 'an observable');

  // 5. Log banned terms (no rewrite)
  const bannedMatch = result.match(BANNED_TERMS);
  if (bannedMatch) {
    log.warn(
      {
        event: 'v4.banned_term_leak',
        term: bannedMatch[1],
        snippet: result.slice(
          Math.max(0, bannedMatch.index! - 20),
          bannedMatch.index! + bannedMatch[0].length + 20,
        ),
      },
      'User-facing text contains banned internal term',
    );
  }

  const nodeMatch = result.match(NODE_TERM);
  if (nodeMatch) {
    log.warn(
      {
        event: 'v4.banned_term_leak',
        term: 'node',
        snippet: result.slice(
          Math.max(0, nodeMatch.index! - 20),
          nodeMatch.index! + nodeMatch[0].length + 20,
        ),
      },
      'User-facing text contains "node" in non-technical context',
    );
  }

  return result;
}

/**
 * Task 6 (Part B): strip standalone quoted chip-like lines from assistant text.
 *
 * The LLM occasionally writes suggestions as quoted lines with role tags
 * (e.g. `"Challenge the Cost driver" (challenger)`), duplicating the real
 * chips that the UI renders from `suggested_actions`. We strip only lines
 * that match the full pattern above — standalone, on their own line, with
 * a role tag. Mid-paragraph quotes, factor labels in quotes, and example
 * questions stay untouched.
 *
 * Logs `v4.inline_chip_stripped` with the count.
 */
export function stripInlineChipLines(text: string): string {
  if (!text) return text;
  // Reset regex state (global flag retains lastIndex across calls).
  INLINE_CHIP_LINE_PATTERN.lastIndex = 0;
  const matches = text.match(INLINE_CHIP_LINE_PATTERN);
  if (!matches || matches.length === 0) return text;

  // Remove each matching line. Use a replace that drops the line AND the
  // trailing newline so we don't leave blank gaps where chips used to be.
  let result = text.replace(INLINE_CHIP_LINE_PATTERN, '');
  // Collapse runs of 3+ newlines left by stripping into exactly 2
  // (preserving paragraph boundaries without building empty stretches).
  result = result.replace(/\n{3,}/g, '\n\n');
  // Trim leading/trailing whitespace artefacts introduced by the strip.
  result = result.replace(/^\s+|\s+$/g, (m) => (m.includes('\n') ? '\n' : ''));

  log.warn(
    {
      event: 'v4.inline_chip_stripped',
      count: matches.length,
      sample: matches.slice(0, 2),
    },
    'Stripped inline quoted chip-like lines from assistant text',
  );

  return result;
}

/**
 * Belt-and-braces pass: sanitise all user-facing text fields on an assembled
 * response envelope. Catches em dashes, banned terms, or artefacts that
 * slipped through per-field sanitisation (e.g. text injected by normaliser,
 * block titles, or post-assembly additions).
 *
 * Mutates the envelope in place — call after normaliseDeterministicResponse.
 */
export function sanitiseEnvelopeText(envelope: Record<string, unknown>): void {
  // assistant_text: first strip inline chip lines, then run standard sanitiser.
  if (typeof envelope.assistant_text === 'string') {
    const stripped = stripInlineChipLines(envelope.assistant_text);
    envelope.assistant_text = sanitiseAssistantText(stripped);
  }

  // suggested_actions[].label and suggested_actions[].prompt
  const actions = envelope.suggested_actions;
  if (Array.isArray(actions)) {
    for (const chip of actions) {
      if (chip && typeof chip === 'object') {
        const c = chip as Record<string, unknown>;
        if (typeof c.label === 'string') c.label = sanitiseAssistantText(c.label);
        if (typeof c.prompt === 'string') c.prompt = sanitiseAssistantText(c.prompt);
      }
    }
  }

  // blocks[].data.summary (graph_patch summaries) and blocks[].data.narrative
  const blocks = envelope.blocks;
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      if (block && typeof block === 'object') {
        const data = (block as Record<string, unknown>).data;
        if (data && typeof data === 'object') {
          const d = data as Record<string, unknown>;
          if (typeof d.summary === 'string') {
            d.summary = sanitiseAssistantText(d.summary, { preserveBold: true });
          }
          if (typeof d.narrative === 'string') {
            d.narrative = sanitiseAssistantText(d.narrative, { preserveBold: true });
          }
        }
      }
    }
  }
}
