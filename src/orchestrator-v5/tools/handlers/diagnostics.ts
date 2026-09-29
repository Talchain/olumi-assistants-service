/**
 * Shared diagnostic-field helpers for the V5 explanation handlers.
 *
 * The schema (talchain-schemas) defines four optional diagnostic fields on
 * the explanation result bodies: `answer_source`, `fallback_reason`,
 * `answer_text_length`, `staleness_prefixed`. These let the DB row alone
 * answer "why did this turn produce that text?" without Render log access.
 *
 * The validator's `answer_validation_error` enum uses
 * `mutation_language_detected` whereas the schema's `fallback_reason` enum
 * uses the bare `mutation_language`. `mapFallbackReason` translates between
 * the two and treats unrecognised codes as `'missing'` (defensive default
 * — a deterministic fallback was taken; the user got useful text).
 */

import type {
  ExplainAnswerSource,
  ExplainFallbackReason,
} from '@talchain/schemas/orchestrator';
import type { ExplanationAnswerErrorReason } from '../../routing/validator-explanation.js';

export type { ExplainAnswerSource, ExplainFallbackReason };

/**
 * Translate the validator's verdict error code into the schema's
 * fallback_reason enum. Returns `'missing'` for unrecognised codes —
 * the user always got the deterministic fallback, so 'missing' is the
 * conservative attribution.
 */
export function mapFallbackReason(
  reason: ExplanationAnswerErrorReason | undefined,
): NonNullable<ExplainFallbackReason> {
  switch (reason) {
    case 'missing':
    case 'too_short':
    case 'forbidden_internal_term':
      return reason;
    case 'mutation_language_detected':
      return 'mutation_language';
    case 'analysis_language_without_analysis_fact':
    default:
      // Brief contract limits fallback_reason to the four listed enums;
      // `analysis_language_without_analysis_fact` (a defensive validator
      // path that should never fire on the precondition-bypass route) and
      // any unrecognised future code collapse to 'missing' — the
      // conservative attribution: the user got the deterministic fallback.
      return 'missing';
  }
}
