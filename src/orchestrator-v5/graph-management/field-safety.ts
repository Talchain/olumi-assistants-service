/**
 * Track 3 — R4 field-safety (fail-closed).
 *
 * Two checks, restating T4.0 R4:
 *  1. Field allowlist for `update_node_field` / `update_edge_field`: a candidate
 *     may touch only tunable node/edge fields. Pipeline-OWNED value fields
 *     (sensitivity_score, elasticity, e-values, robustness, flip thresholds, …)
 *     are analysis-derived — a producer must never set them (dual-draft G10).
 *  2. Engine-claim scan on ALL free text — EVERY string leaf in the payload (labels,
 *     descriptions, questions, reasons, update `from`/`to` values) PLUS the provenance
 *     rationale: no EVPI / flip-point / quantified-probability prose may ride in on a
 *     candidate, whether as narrative prose OR as a label/value (dual-draft G14, "any
 *     free text"). Ids are scanned too — in the rare case an id literally contains an
 *     engine-claim term (e.g. "flip-point"), the conservative false-positive rejection is
 *     acceptable: a producer should not name entities with engine-claim terms.
 *
 * All checks are pure and total.
 */
import type { CandidateMutationEnvelope } from './types.js';
import {
  FIELD_NOT_ALLOWED,
  PIPELINE_OWNED_FIELD,
  ENGINE_CLAIM_IN_TEXT,
  type MutationReasonCode,
} from './reason-codes.js';

/** Tunable node fields a candidate may update (value/label-metadata floor). */
const ALLOWED_NODE_FIELDS: ReadonlySet<string> = new Set([
  'label',
  'description',
  'category',
  'display_value',
  'observed_state.value',
  'observed_state.baseline',
  'observed_state.unit',
]);

/** Tunable edge fields a candidate may update (strength / probability floor). */
const ALLOWED_EDGE_FIELDS: ReadonlySet<string> = new Set([
  'strength',
  'strength.mean',
  'strength.std',
  'exists_probability',
  'effect_direction',
]);

/**
 * Analysis-derived, pipeline-owned fields. A candidate that names any of these —
 * on any kind — is rejected as PIPELINE_OWNED_FIELD (checked before the allowlist
 * so the reason is precise). Substring match on a lowercased field path.
 */
const PIPELINE_OWNED_MARKERS: readonly string[] = [
  'sensitivity_score',
  'elasticity',
  'e_value',
  'e-values',
  'robustness',
  'flip_threshold',
  'flip_thresholds',
  'confidence_tier',
  'inference_warnings',
];

/** Conservative engine-claim patterns applied to every candidate string leaf (G14). */
const ENGINE_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bEVPI\b/i,
  /\bVOI\b/i,
  /flip[\s-]?point/i,
  /would\s+flip/i,
  /\bprobability\s+of\s+\d/i,
  /\b\d{1,3}(?:\.\d+)?\s?%\s+(?:likely|chance|probability|confiden)/i,
];

/**
 * Result carries a CODE only — never the offending field name or value. The raw
 * `field`/`to` strings are model-controlled payload values, so surfacing them (even
 * as a diagnostic `path`) would violate the §5 redaction contract; callers render a
 * fixed per-code message.
 */
export interface FieldSafetyResult {
  readonly ok: boolean;
  readonly code?: MutationReasonCode;
}

function isPipelineOwned(field: string): boolean {
  const f = field.toLowerCase();
  return PIPELINE_OWNED_MARKERS.some((m) => f.includes(m));
}

function scanText(text: unknown): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  return ENGINE_CLAIM_PATTERNS.some((re) => re.test(text));
}

/**
 * Collect every string leaf in an arbitrary value (payload). Total; bounded by the
 * envelope schema (already parsed + capped). Ids are collected too but never match
 * the engine-claim patterns, so scanning them is harmless.
 */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const el of value) collectStrings(el, out);
  } else if (value !== null && typeof value === 'object') {
    for (const el of Object.values(value)) collectStrings(el, out);
  }
}

/**
 * R4 field-safety for a parsed envelope. Returns the first failure (fail-closed,
 * first-failure-wins) or `{ ok: true }`.
 */
export function checkFieldSafety(envelope: CandidateMutationEnvelope): FieldSafetyResult {
  // (a) field allowlist / pipeline-owned guard for the two field-edit kinds.
  if (envelope.kind === 'update_node_field') {
    const field = envelope.payload.field;
    if (isPipelineOwned(field)) return { ok: false, code: PIPELINE_OWNED_FIELD };
    if (!ALLOWED_NODE_FIELDS.has(field)) return { ok: false, code: FIELD_NOT_ALLOWED };
  } else if (envelope.kind === 'update_edge_field') {
    const field = envelope.payload.field;
    if (isPipelineOwned(field)) return { ok: false, code: PIPELINE_OWNED_FIELD };
    if (!ALLOWED_EDGE_FIELDS.has(field)) return { ok: false, code: FIELD_NOT_ALLOWED };
  }

  // (b) engine-claim scan on ALL free text (G14 "any free text"): every string leaf in
  //     the payload — labels, descriptions, questions, reasons, update `from`/`to`
  //     values — PLUS the provenance rationale. A claim must not ride in as a label or
  //     any other string field, not just as narrative prose.
  const texts: string[] = [];
  collectStrings(envelope.payload, texts);
  if (typeof envelope.provenance.rationale === 'string') texts.push(envelope.provenance.rationale);
  for (const t of texts) {
    if (scanText(t)) return { ok: false, code: ENGINE_CLAIM_IN_TEXT };
  }

  return { ok: true };
}
