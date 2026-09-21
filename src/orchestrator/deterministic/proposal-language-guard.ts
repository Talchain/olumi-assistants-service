/**
 * Proposal Language Guard (T5)
 *
 * Detects "applied-language" completion phrases ("Adding now", "I've added")
 * leaking into user-facing text on PROPOSAL turns — turns whose graph_patch
 * block has `auto_apply === false`. The LLM has no enforced contract that
 * separates proposal narration from completion narration; this guard catches
 * the leak after assembly and appends a corrective suffix so the user reads
 * a coherent proposal frame.
 *
 * Scope (CRITICAL):
 *   - Run ONLY when the response will emit a graph_patch block with
 *     `auto_apply === false`. The check must gate on the actual block state,
 *     not on `operations.length > 0` — a future path might emit operations
 *     but auto-apply, in which case completion language is correct.
 *   - Skip on draft_graph (auto_apply true) and on turns without a patch block.
 *
 * Telemetry:
 *   - Emits `v4.proposal_language_leak` on every match. Watch for >20% leak
 *     rate per tool — escalate to a prompt-level fix when that happens.
 *
 * Pattern design:
 *   - Word-boundary anchored, case-insensitive, narrowly targeting completion
 *     idioms. NOT phrases like "adding a factor would" or "I'd suggest adding"
 *     which are legitimate proposal-context usages.
 *   - One leak per scan is sufficient — the suffix is the same regardless of
 *     which exact phrase tripped, and we don't want to spam the log.
 */

import { log } from "../../utils/telemetry.js";

const LEAK_PATTERNS: ReadonlyArray<RegExp> = [
  /\badding now\b/i,
  /\badding that\b/i,
  /\bi['’]ve added\b/i,
  /\bi['’]ll add it now\b/i,
  /\bupdating now\b/i,
  /\bi['’]ve updated\b/i,
  /\bdone\b/i,
  /\bapplied\b/i,
  /\bmaking that change\b/i,
  // Deterministic-handler assistantText leak styles. These fire only on
  // proposal turns (gated by emittedProposalBlock in the caller), so they
  // cannot flag legitimate completion language on auto-apply turns.
  //
  // Anchor on sentence-start (or line-start) + verb so we catch handler
  // confirmations like "Got it, setting the AI Tool Cost to £2,000" but NOT
  // proposal framings like "I'd recommend setting the cost to 2000" or
  // "proposing to set the cost to 2000". The (?:^|[.\n]\s*) prefix matches
  // either the very start of the text or the start of a new sentence.
  /\bgot it\b/i,
  /(?:^|[.\n]\s*)setting\s+.+\s+to\s+/i,
  /(?:^|[.\n]\s*)(?:i['’]ve\s+)?set\s+.+\s+to\s+/i,
  /(?:^|[.\n]\s*)(?:i['’]ve\s+)?updated\s+.+\s+to\s+/i,
  /(?:^|[.\n]\s*)(?:i['’]ve\s+)?changed\s+.+\s+to\s+/i,
  // "I’ll <verb>" patterns — the LLM sometimes frames a completed action as
  // a future intent on proposal turns. Same quote-class as lines 35-36.
  /\bI['’]ll add\b/i,
  /\bI['’]ll update\b/i,
  /\bI['’]ll remove\b/i,
  /\bI['’]ll change\b/i,
];

export interface ProposalLanguageScanResult {
  leaked: boolean;
  /** The exact substring that matched, when leaked === true. */
  matchedPhrase?: string;
  /** The text with the leaked phrase rewritten to proposal language, when leaked === true. */
  suffixed?: string;
}

/**
 * Inline rewrites that replace completion-language phrases with proposal
 * phrasing. Applied BEFORE the LEAK_PATTERNS scan so that common handler
 * text ("I'll add X", "Updated X to Y") is normalised into proposal framing
 * directly, not just suffixed with a corrective sentence.
 *
 * Order matters: more specific patterns first. Each rewrite is case-preserving
 * at the rewrite boundary (handlers are the main source and use sentence-case).
 */
const INLINE_REWRITES: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // "I'll add/update/remove/change …" → "Proposing to add/update/remove/change …"
  // Handler text: "I'll add **Label** (value: ...) as a risk factor. Please confirm."
  //             → "Proposing to add **Label** (value: ...) as a risk factor. Please confirm."
  { pattern: /\bI['’]ll add\b/gi, replacement: 'Proposing to add' },
  { pattern: /\bI['’]ll update\b/gi, replacement: 'Proposing to update' },
  { pattern: /\bI['’]ll remove\b/gi, replacement: 'Proposing to remove' },
  { pattern: /\bI['’]ll change\b/gi, replacement: 'Proposing to change' },
  { pattern: /\bI['’]ll set\b/gi, replacement: 'Proposing to set' },
  // Handler completion phrases at sentence start: "Updated X to Y" → "Proposing to update X to Y"
  // Matches beginning-of-text or after sentence break. Whitespace is preserved.
  { pattern: /(^|[.\n]\s*)Updated\s+/g, replacement: '$1Proposing to update ' },
  { pattern: /(^|[.\n]\s*)Added\s+/g, replacement: '$1Proposing to add ' },
  { pattern: /(^|[.\n]\s*)Removed\s+/g, replacement: '$1Proposing to remove ' },
  { pattern: /(^|[.\n]\s*)Changed\s+/g, replacement: '$1Proposing to change ' },
  // Gerund forms: "Setting X to Y" → "Proposing to set X to Y"
  // These come from handler text like "Setting Market Size to 500."
  //
  // Narrow the match: it must be followed by a word that's NOT an idiomatic
  // non-completion phrase ("Setting now", "Setting aside", "Setting that",
  // "Setting it") so legitimate prose flows through unchanged. LEAK_PATTERNS
  // catches the genuinely leaked cases ("Setting now") via the suffix path.
  { pattern: /(^|[.\n]\s*)Setting\s+(?!now\b|that\b|it\b|aside\b|up\b|out\b)/g, replacement: '$1Proposing to set ' },
  { pattern: /(^|[.\n]\s*)Updating\s+(?!now\b|that\b|it\b)/g, replacement: '$1Proposing to update ' },
  // Only rewrite "Adding" when followed by a capitalised label (starts with
  // uppercase letter), not when followed by "now"/"that"/"it" etc. This
  // preserves the original leak-suffix path for phrases like "Adding now".
  { pattern: /(^|[.\n]\s*)Adding\s+(?=[A-Z])/g, replacement: '$1Proposing to add ' },
  // Past-tense "Set X to Y" at sentence start (narrow: only when followed
  // by an identifier + " to " to avoid matching "Set to one side ...").
  { pattern: /(^|[.\n]\s*)Set\s+(?=\S+\s+to\s+)/g, replacement: '$1Proposing to set ' },
];

/**
 * Scan an assembled assistant text for proposal-language leaks. Two-stage
 * approach:
 *   1. Inline rewrite: common handler phrasings ("I'll add X", "Updated X to Y")
 *      are rewritten to proposal language in place. This catches the majority
 *      of leaks from deterministic handlers (add-factor, set-factor-value, etc.).
 *   2. Pattern scan: anything the rewrite missed triggers a suffix fallback
 *      ("Review the suggested changes above.") so the user sees a coherent
 *      proposal frame even when the leak is novel prose from the LLM.
 *
 * The caller is responsible for gating this on the actual block state
 * (`auto_apply === false`). This function does not inspect blocks itself.
 *
 * @param text  The assembled assistant text (post-coaching, post-warnings).
 * @param toolName  Tool name for telemetry routing (`edit_graph`, action name, etc.).
 * @returns scan result; callers should use `suffixed` if `leaked === true`.
 */
export function enforceProposalLanguage(
  text: string | null | undefined,
  toolName: string,
): ProposalLanguageScanResult {
  if (!text) return { leaked: false };

  // Stage 1: inline rewrite. Track whether any rewrite fired so we can log once.
  let rewritten = text;
  let rewroteSomething = false;
  let firstRewriteMatch: string | null = null;
  for (const rule of INLINE_REWRITES) {
    const before = rewritten;
    rewritten = rewritten.replace(rule.pattern, (match, ...args) => {
      if (!firstRewriteMatch) firstRewriteMatch = match;
      // If the pattern captured a leading-sentence-break group, preserve it.
      if (typeof args[0] === 'string' && (args[0] === '' || /^[.\n\s]+$/.test(args[0]))) {
        return rule.replacement.replace('$1', args[0]);
      }
      return rule.replacement;
    });
    if (rewritten !== before) rewroteSomething = true;
  }

  if (rewroteSomething) {
    log.warn(
      {
        event: 'v4.proposal_language_rewrite',
        matched_phrase: firstRewriteMatch,
        tool_name: toolName,
      },
      'Proposal turn contained applied-language completion phrase — rewritten to proposal language',
    );
  }

  // Stage 2: residual leak scan on the rewritten text. If anything still
  // matches a completion pattern, fall back to the suffix strategy.
  for (const re of LEAK_PATTERNS) {
    const m = rewritten.match(re);
    if (m) {
      log.warn(
        {
          event: 'v4.proposal_language_leak',
          matched_phrase: m[0],
          tool_name: toolName,
        },
        'Proposal turn contained applied-language completion phrase (residual after rewrite)',
      );
      return {
        leaked: true,
        matchedPhrase: m[0],
        suffixed: `${rewritten}\n\nReview the suggested changes above.`,
      };
    }
  }

  // Rewrites fired but no residual leak — return the rewritten text.
  if (rewroteSomething) {
    return {
      leaked: true,
      matchedPhrase: firstRewriteMatch ?? undefined,
      suffixed: rewritten,
    };
  }

  return { leaked: false };
}
