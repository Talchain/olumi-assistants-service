/**
 * Defensive prose sanitiser for chip text derived from `review_cards`
 * (Phase 2 workstream A — P1 hardening).
 *
 * The decision-review enricher already runs `sanitiseEnrichment()` over
 * the parent enrichment before facts are committed, so under normal
 * dispatch paths review_cards prose is clean. The post-analysis
 * coaching wrapper, however, may run on facts produced via paths that
 * skipped the enricher (legacy facts, alternate enrichment writers,
 * future refactors). Re-sanitising the specific fields the wrapper
 * surfaces as user-visible chip messages keeps the chip contract
 * consistent with the rest of V5's egress safety, regardless of
 * upstream history.
 *
 * Scope: leaf-prose level only. Drops the chip when the text matches a
 * HARD_BAN pattern; otherwise returns the original. Entity-id resolution
 * is the parent enricher's job — the wrapper does not have a graph
 * lookup at this layer, so id-bearing prose simply gets dropped.
 */

import { HARD_BAN_PATTERNS } from '../../orchestrator/shared/forbidden-tokens.js';

/**
 * Loose entity-id token detector. Matches the prefixes the existing
 * sanitiser scans for: `fac_`, `opt_`, `goal_`, `dec_`, `out_`, `risk_`,
 * `con_`, `factor_`, `option_`, `decision_`, `outcome_`, `constraint_`.
 * Used to suppress chip text that leaked an id (the parent sanitiser
 * resolves these to labels via a graph lookup; we don't have one here).
 */
const ENTITY_ID_TOKEN =
  /\b(?:fac|opt|goal|dec|out|risk|con|factor|option|decision|outcome|constraint)[_:-]\w/i;

const SUPPRESSED_FALLBACK_MARKER = 'review-card prose was suppressed';

export interface SanitiseChipProseResult {
  /** The cleaned text (same reference when no transform was applied). */
  readonly text: string;
  /** True when the text was suppressed entirely — caller should drop the chip. */
  readonly suppressed: boolean;
  /** Reason for suppression — telemetry breadcrumb. */
  readonly reason: 'hard_ban' | 'entity_id_leak' | 'suppressed_marker' | 'empty' | null;
}

/**
 * Defensive sanitiser for chip-text candidates pulled from review_cards.
 * Returns `suppressed: true` when the caller should drop the chip rather
 * than ship it.
 */
export function sanitiseChipProse(input: string | null | undefined): SanitiseChipProseResult {
  if (!input || input.trim().length === 0) {
    return { text: '', suppressed: true, reason: 'empty' };
  }

  // The parent sanitiser replaces blocked prose with its own marker.
  // If a card carries that marker, surfacing it in a chip would expose
  // internal mechanics — drop instead.
  if (input.includes(SUPPRESSED_FALLBACK_MARKER)) {
    return { text: '', suppressed: true, reason: 'suppressed_marker' };
  }

  for (const re of HARD_BAN_PATTERNS) {
    if (re.test(input)) {
      return { text: '', suppressed: true, reason: 'hard_ban' };
    }
  }

  if (ENTITY_ID_TOKEN.test(input)) {
    return { text: '', suppressed: true, reason: 'entity_id_leak' };
  }

  return { text: input, suppressed: false, reason: null };
}
