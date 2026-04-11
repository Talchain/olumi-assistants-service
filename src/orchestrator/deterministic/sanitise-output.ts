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
 * Belt-and-braces pass: sanitise all user-facing text fields on an assembled
 * response envelope. Catches em dashes, banned terms, or artefacts that
 * slipped through per-field sanitisation (e.g. text injected by normaliser,
 * block titles, or post-assembly additions).
 *
 * Mutates the envelope in place — call after normaliseDeterministicResponse.
 */
export function sanitiseEnvelopeText(envelope: Record<string, unknown>): void {
  // assistant_text
  if (typeof envelope.assistant_text === 'string') {
    envelope.assistant_text = sanitiseAssistantText(envelope.assistant_text);
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
