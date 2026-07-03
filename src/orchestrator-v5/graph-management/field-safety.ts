/**
 * Track 3 — R4 field-safety (fail-closed).
 *
 * Two checks, restating T4.0 R4:
 *  1. Field allowlist for `update_node_field` / `update_edge_field`: a candidate
 *     may touch only tunable node/edge fields. Pipeline-OWNED value fields
 *     (sensitivity_score, elasticity, e-values, robustness, flip thresholds, …)
 *     are analysis-derived — a producer must never set them (dual-draft G10).
 *  2. Engine-claim scan on narrative free text (rationale / question / reason):
 *     no EVPI / flip-point / quantified-probability prose may ride in on a
 *     candidate (dual-draft G14). Node LABELS are deliberately out of scope — a
 *     label like "50% uptake" is legitimate identifier text, not an engine claim.
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

/** Conservative engine-claim patterns for narrative free text (G14). */
const ENGINE_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bEVPI\b/i,
  /\bVOI\b/i,
  /flip[\s-]?point/i,
  /would\s+flip/i,
  /\bprobability\s+of\s+\d/i,
  /\b\d{1,3}(?:\.\d+)?\s?%\s+(?:likely|chance|probability|confiden)/i,
];

export interface FieldSafetyResult {
  readonly ok: boolean;
  readonly code?: MutationReasonCode;
  readonly path?: string;
}

function isPipelineOwned(field: string): boolean {
  const f = field.toLowerCase();
  return PIPELINE_OWNED_MARKERS.some((m) => f.includes(m));
}

function scanText(text: string | undefined): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  return ENGINE_CLAIM_PATTERNS.some((re) => re.test(text));
}

/**
 * R4 field-safety for a parsed envelope. Returns the first failure (fail-closed,
 * first-failure-wins) or `{ ok: true }`.
 */
export function checkFieldSafety(envelope: CandidateMutationEnvelope): FieldSafetyResult {
  // (a) field allowlist / pipeline-owned guard for the two field-edit kinds.
  if (envelope.kind === 'update_node_field') {
    const field = envelope.payload.field;
    if (isPipelineOwned(field)) return { ok: false, code: PIPELINE_OWNED_FIELD, path: field };
    if (!ALLOWED_NODE_FIELDS.has(field)) return { ok: false, code: FIELD_NOT_ALLOWED, path: field };
  } else if (envelope.kind === 'update_edge_field') {
    const field = envelope.payload.field;
    if (isPipelineOwned(field)) return { ok: false, code: PIPELINE_OWNED_FIELD, path: field };
    if (!ALLOWED_EDGE_FIELDS.has(field)) return { ok: false, code: FIELD_NOT_ALLOWED, path: field };
  }

  // (b) engine-claim scan on narrative free text (rationale / question / reason).
  const texts: (string | undefined)[] = [envelope.provenance.rationale];
  const p = envelope.payload as Record<string, unknown>;
  if (typeof p.question === 'string') texts.push(p.question);
  if (typeof p.reason === 'string') texts.push(p.reason);
  for (const t of texts) {
    if (scanText(t)) return { ok: false, code: ENGINE_CLAIM_IN_TEXT, path: 'free_text' };
  }

  return { ok: true };
}
