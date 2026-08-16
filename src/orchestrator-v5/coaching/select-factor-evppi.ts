/**
 * Deterministic reader for ISL's per-factor EVPPI priority.
 *
 * The producer contract is deliberately narrow:
 *
 * - rows arrive in descending producer order;
 * - `resolved` means the estimate cleared that factor's permutation-noise
 *   floor;
 * - `below_resolution` is a demotion, never a zero; and
 * - a factor absent from the array was not assessed (commonly because it is an
 *   option-controlled lever), so consumers must never impute it; and
 * - `FACTOR_EVPPI_PARTIAL` means an estimator drop made the surviving order
 *   incomplete, so a single global priority must be withheld.
 *
 * This reader therefore carries only the first usable `resolved` factor ID.
 * It validates `evppi` solely to decide whether the producer row is readable;
 * the magnitude is never compared, returned, logged, or made available to
 * prose. Producer order is the ranking authority. Contract source:
 * ISL `28fe0c950f6ca5737f4555c863353d37b734dddf`,
 * `RobustnessAnalyzerV2._compute_factor_evppi` (Strong–Oakley estimator,
 * per-factor permutation floor, lever omission, partial-drop disclosure,
 * descending stable sort).
 */

import { EnrichmentFactorEvppiEntrySchema } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { HARD_BAN_PATTERNS } from '../../orchestrator/shared/forbidden-tokens.js';
import { ENTITY_ID_LEAK_RE } from '../../orchestrator/shared/entity-id-pattern.js';
import { isSlugShapedEntityId } from '../../orchestrator/shared/output-safety.js';
import { selectRunAnalysisFact } from '../context/freshness.js';
import {
  findForbiddenPhraseHit,
  RAW_DECIMAL_RE,
} from '../compose/forbidden-user-facing-phrases.js';
import { isUnsafeLabel } from '../compose/resolve-label.js';

const FactorEvppiPriorityRowSchema = EnrichmentFactorEvppiEntrySchema.pick({
  factor_id: true,
  evppi: true,
  status: true,
});

const FACTOR_EVPPI_PARTIAL_WARNING_CODE = 'FACTOR_EVPPI_PARTIAL';
const ENRICHMENT_CONTRACT_MISMATCH_WARNING_CODE = 'ENRICHMENT_CONTRACT_MISMATCH';
const UNSAFE_LABEL_FORMAT_CODEPOINT_RE =
  /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;

type FactorEvppiPriorityRow = ReturnType<typeof FactorEvppiPriorityRowSchema.parse>;

export type FactorEvppiPriorityRefusalReason =
  | 'absent'
  | 'producer_partial'
  | 'transport_contract_mismatch'
  | 'warning_carrier_unreadable'
  | 'all_below_resolution'
  | 'unreadable_before_priority'
  | 'duplicate_before_priority'
  | 'priority_not_eligible';

export type FactorEvppiPriorityDecision =
  | {
      readonly outcome: 'selected';
      /** Identity only. No EVPPI magnitude can leave this module. */
      readonly factorId: string;
    }
  | {
      readonly outcome: 'not_selected';
      readonly reason: FactorEvppiPriorityRefusalReason;
    };

export type FactorEvppiPriorityGuidanceRefusalReason =
  | FactorEvppiPriorityRefusalReason
  | 'factor_sensitivity_absent'
  | 'factor_sensitivity_duplicate'
  | 'factor_label_unreadable';

/**
 * User-safe, number-free join from the producer's EVPPI priority to the exact
 * factor label carried by the same analysis. `specificAction` is optional:
 * Decision Review is configuration-gated and may soft-fail, so it may enrich
 * the guidance but can never be required to make the real science reachable.
 */
export type FactorEvppiPriorityGuidanceDecision =
  | {
      readonly outcome: 'selected';
      readonly factorId: string;
      readonly factorLabel: string;
      readonly specificAction: string | null;
    }
  | {
      readonly outcome: 'not_selected';
      readonly reason: FactorEvppiPriorityGuidanceRefusalReason;
    };

export interface FactorEvppiPriorityOptions {
  /**
   * Optional current-model eligibility authority. When the producer's first
   * resolved row is not eligible, selection fails closed; row two is never
   * promoted into a rank the producer did not give it.
   */
  readonly eligibleFactorIds?: ReadonlySet<string>;
}

/**
 * Pick the EVPPI priority decision from the same newest successful analysis
 * fact used by freshness, analysis projection, and the other post-analysis
 * coaching readers. `null` means there is no selected analysis fact at all;
 * a present fact with no usable ranking returns the selector's explicit
 * `not_selected` reason.
 */
export function pickLatestFactorEvppiPriority(
  priorFacts: readonly HandlerFact[],
): FactorEvppiPriorityDecision | null {
  const selected = selectRunAnalysisFact(priorFacts);
  if (selected === null || selected.fact.fact_type !== 'run_analysis') return null;
  return selectFactorEvppiPriority(selected.fact.result.enrichment);
}

/**
 * Resolve the newest freshness-aligned analysis into actionable guidance.
 * The priority, label, and optional review action all come from that one fact;
 * no prior run or object-order fallback is allowed.
 */
export function pickLatestFactorEvppiPriorityGuidance(
  priorFacts: readonly HandlerFact[],
): FactorEvppiPriorityGuidanceDecision | null {
  const selected = selectRunAnalysisFact(priorFacts);
  if (selected === null || selected.fact.fact_type !== 'run_analysis') return null;
  return selectFactorEvppiPriorityGuidance(selected.fact.result.enrichment);
}

/**
 * Join a producer-selected factor identity to the decision-review action for
 * that exact factor. This is deliberately an identity join, not a fallback
 * ranking: missing/malformed/unsafe action text returns `null` and never
 * promotes a different enhancement or an unranked assumption. Decision Review
 * is a verbatim enrichment subtree, so this reader is the source-local safety
 * gate before the optional LLM prose enters deterministic factor-EVPPI advice.
 */
export function readFactorEvppiPriorityAction(
  decisionReview: unknown,
  priority: FactorEvppiPriorityDecision | null,
): string | null {
  if (priority?.outcome !== 'selected') return null;
  const review = readRecord(decisionReview);
  const enhancements = readRecord(review?.evidence_enhancements);
  const entry = readRecord(enhancements?.[priority.factorId]);
  const action = entry?.specific_action;
  if (typeof action !== 'string' || action.trim().length === 0) return null;
  const trimmed = action.trim();
  if (
    hasUnsafeDisplayCodepoint(trimmed)
    || findForbiddenPhraseHit(trimmed) !== null
    || RAW_DECIMAL_RE.test(trimmed)
    || HARD_BAN_PATTERNS.some((pattern) => pattern.test(trimmed))
    || containsEntityId(trimmed)
  ) return null;
  return trimmed;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasUnsafeDisplayCodepoint(value: string): boolean {
  for (const character of value) {
    const codepoint = character.codePointAt(0);
    if (
      codepoint !== undefined
      && ((codepoint >= 0x00 && codepoint <= 0x1f)
        || (codepoint >= 0x7f && codepoint <= 0x9f))
    ) {
      return true;
    }
  }
  return UNSAFE_LABEL_FORMAT_CODEPOINT_RE.test(value);
}

function containsEntityId(value: string): boolean {
  const matcher = new RegExp(ENTITY_ID_LEAK_RE.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(value)) !== null) {
    if (isSlugShapedEntityId(match[0])) return true;
  }
  return false;
}

function readSafeFactorLabel(row: Record<string, unknown>, factorId: string): string | null {
  const rawCandidates = [row.factor_label, row.label]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const candidates = [...new Set(rawCandidates)];
  if (candidates.length !== 1) return null;
  const label = candidates[0]!;
  if (
    label.length > 160
    || hasUnsafeDisplayCodepoint(label)
    || isUnsafeLabel(label, factorId)
  ) return null;
  return label;
}

function isUsableRow(row: FactorEvppiPriorityRow | null): row is FactorEvppiPriorityRow {
  return (
    row !== null &&
    row.factor_id.length > 0 &&
    typeof row.evppi === 'number' &&
    Number.isFinite(row.evppi) &&
    row.evppi >= 0 &&
    (row.status === 'resolved' || row.status === 'below_resolution')
  );
}

/**
 * Select the first producer-ranked factor whose EVPPI cleared its own
 * resolution floor. The result is total and number-free.
 */
export function selectFactorEvppiPriority(
  enrichment: unknown,
  options: FactorEvppiPriorityOptions = {},
): FactorEvppiPriorityDecision {
  const record = readRecord(enrichment);

  // A partial producer result ranks only the surviving estimates. A dropped
  // factor may have outranked every surviving row, so deterministic coaching
  // cannot honestly promote the first survivor to "resolve first". The UI's
  // richer ranking surface can disclose this state alongside the whole list;
  // this single-priority reader instead fails closed.
  const warnings = record?.inference_warnings;
  if (warnings !== undefined) {
    if (!Array.isArray(warnings)) {
      return { outcome: 'not_selected', reason: 'warning_carrier_unreadable' };
    }
    for (const warning of warnings) {
      const parsedWarning = readRecord(warning);
      if (parsedWarning === null || typeof parsedWarning.code !== 'string') {
        // `inference_warnings` is the producer's disclosure channel for a
        // partial EVPPI estimate. A malformed entry could be the disclosure we
        // need, so ignoring it and promoting a surviving row is unsafe.
        return { outcome: 'not_selected', reason: 'warning_carrier_unreadable' };
      }
      if (parsedWarning.code === FACTOR_EVPPI_PARTIAL_WARNING_CODE) {
        return { outcome: 'not_selected', reason: 'producer_partial' };
      }
      if (parsedWarning.code === ENRICHMENT_CONTRACT_MISMATCH_WARNING_CODE) {
        // PLoT's egress guard may withhold a malformed factor_evppi row and
        // disclose the removal under this envelope-wide warning. It does not
        // rewrite that disclosure as FACTOR_EVPPI_PARTIAL. Promoting the next
        // surviving row would therefore invent a rank the transported array
        // no longer proves. Refuse the whole priority without parsing warning
        // prose or relying on PLoT's internal `_meta` evidence carrier.
        return { outcome: 'not_selected', reason: 'transport_contract_mismatch' };
      }
    }
  }

  const rows = record?.factor_evppi;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { outcome: 'not_selected', reason: 'absent' };
  }

  // Validate the WHOLE producer carrier before selecting anything. Returning as
  // soon as row one is resolved would let a malformed or duplicate trailing row
  // hide behind an otherwise-usable priority. That is not a complete ranking:
  // PLoT's production schema arm is sampled and the shared row schema cannot
  // express cross-row uniqueness, so this consumer remains the final claim cage.
  const seenFactorIds = new Set<string>();
  const parsedRows: FactorEvppiPriorityRow[] = [];
  for (const raw of rows) {
    const parsed = FactorEvppiPriorityRowSchema.safeParse(raw);
    const row = parsed.success ? parsed.data : null;

    // Keep the historical refusal code for telemetry compatibility. It now
    // means an unreadable row anywhere in the ranking, not only before the
    // first resolved row. Negative EVPPI is unreadable too: the producer clamps
    // the Strong-Oakley estimate to Howard's non-negative bound before sorting.
    if (!isUsableRow(row)) {
      return { outcome: 'not_selected', reason: 'unreadable_before_priority' };
    }

    if (seenFactorIds.has(row.factor_id)) {
      return { outcome: 'not_selected', reason: 'duplicate_before_priority' };
    }
    seenFactorIds.add(row.factor_id);
    parsedRows.push(row);
  }

  // The carrier is now proven readable and unique. Preserve producer order
  // exactly; magnitude is still never compared, returned, logged, or rendered.
  for (const row of parsedRows) {
    if (row.status === 'below_resolution') continue;

    if (
      options.eligibleFactorIds !== undefined &&
      !options.eligibleFactorIds.has(row.factor_id)
    ) {
      return { outcome: 'not_selected', reason: 'priority_not_eligible' };
    }

    return { outcome: 'selected', factorId: row.factor_id };
  }

  return { outcome: 'not_selected', reason: 'all_below_resolution' };
}

/**
 * Join the ordered/status-bearing EVPPI identity to its display label and, if
 * present, the exact same-factor decision-review action. The label is sourced
 * from top-level `factor_sensitivity`, a committed PLoT carrier available even
 * when Decision Review is absent or fails. Duplicate/malformed joins fail closed.
 */
export function selectFactorEvppiPriorityGuidance(
  enrichment: unknown,
  options: FactorEvppiPriorityOptions = {},
): FactorEvppiPriorityGuidanceDecision {
  const priority = selectFactorEvppiPriority(enrichment, options);
  if (priority.outcome !== 'selected') return priority;

  const record = readRecord(enrichment);
  const rows = record?.factor_sensitivity;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { outcome: 'not_selected', reason: 'factor_sensitivity_absent' };
  }

  const matches = rows.filter(
    (row) => readRecord(row)?.factor_id === priority.factorId,
  );
  if (matches.length === 0) {
    return { outcome: 'not_selected', reason: 'factor_sensitivity_absent' };
  }
  if (matches.length !== 1) {
    return { outcome: 'not_selected', reason: 'factor_sensitivity_duplicate' };
  }

  const row = readRecord(matches[0]);
  if (row === null) {
    return { outcome: 'not_selected', reason: 'factor_label_unreadable' };
  }
  const factorLabel = readSafeFactorLabel(row, priority.factorId);
  if (factorLabel === null) {
    return { outcome: 'not_selected', reason: 'factor_label_unreadable' };
  }

  return {
    outcome: 'selected',
    factorId: priority.factorId,
    factorLabel,
    specificAction: readFactorEvppiPriorityAction(
      record?.decision_review,
      priority,
    ),
  };
}
