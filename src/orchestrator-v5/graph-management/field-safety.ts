/**
 * Track 3 — R4 field-safety (fail-closed).
 *
 * Two checks, restating T4.0 R4:
 *  1. Field allowlist for `update_node_field` / `update_edge_field`: a candidate
 *     may touch only tunable node/edge fields — reconciled (lane CEE-W5) to the
 *     SANCTIONED EDIT VOCABULARY (what edit_graph's PatchOperation schema +
 *     patch applier + downstream Zod validation already accept), evaluated on
 *     the field's ROOT segment so every producer spelling (bare root,
 *     slash-keyed `data/value`, dotted `observed_state.value`) resolves
 *     identically. Pipeline-OWNED value fields (sensitivity_score, elasticity,
 *     e-values, robustness, flip thresholds, …) are analysis-derived — a
 *     producer must never set them (dual-draft G10) — and pipeline-recomputed
 *     stamps (provenance, validation, defaulted, origin) are equally owned;
 *     identity fields (node `id`/`kind`, edge `from`/`to`) stay blocked.
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
import { InterventionV3 } from '../../schemas/cee-v3.js';
import {
  FIELD_NOT_ALLOWED,
  PIPELINE_OWNED_FIELD,
  ENGINE_CLAIM_IN_TEXT,
  type MutationReasonCode,
} from './reason-codes.js';

/**
 * Field paths arrive in every spelling the edit pipeline actually produces:
 * a bare root (`description`, `data`, `observed_state`, `goal_threshold`),
 * a slash-keyed leaf path from `normalisePath` (`data/value`,
 * `data/interventions/<fac_id>`), or a legacy dotted path
 * (`observed_state.value`, `strength.mean`). The allowlist is evaluated on
 * the ROOT segment: a sanctioned root sanctions its sub-paths (subject to
 * the pipeline-owned screen on the FULL path below).
 */
function fieldRootOf(field: string): string {
  const first = field.split(/[/.]/, 1)[0];
  return first ?? field;
}

/**
 * Tunable node field ROOTS a candidate may update — reconciled (lane CEE-W5
 * Mission A, 2026-07-07) to the sanctioned edit vocabulary: every node field
 * the edit_graph PatchOperation schema + patch applier + downstream NodeV3
 * Zod validation accept as safe (that surface IS the sanctioned edit
 * vocabulary), PLUS the two wire-canonical spellings that do not appear on
 * NodeV3 but are produced/consumed by the live edit pipeline: `data` (the
 * PLoT-canonical rename of `observed_state`, see normaliseEditOpsForPlot)
 * and `goal_constraints` (the deterministic constraint vocabulary).
 *
 * Deliberately ABSENT (protected — FIELD_NOT_ALLOWED):
 *  - `id`   — node identity (the applier strips it; the producer skips it);
 *  - `kind` — identity-class re-typing (a factor→goal flip can silently break
 *    structural invariants no Zod check re-validates; pinned by
 *    referee-core.test.ts since Track 3).
 * Pipeline-owned / provenance-class roots are screened separately (below)
 * with the precise PIPELINE_OWNED_FIELD code.
 */
const ALLOWED_NODE_FIELD_ROOTS: ReadonlySet<string> = new Set([
  'label',
  'description',
  'category',
  'display_value',
  'observed_state',
  'data',
  // goal_threshold* deliberately REMOVED (review hardening, 2026-07-07):
  // the threshold quad has exactly one sanctioned writer (add_constraint's
  // goal-join, which keeps raw/unit/cap/normalised consistent). A candidate
  // setting goal_threshold alone creates the registered/scored desync the
  // receipt guard exists to prevent — referee holds it, the conversational
  // writer path is unaffected (tool handlers are not enveloped).
  'goal_constraints',
  'encoding_map',
  'prior',
  'factor_type',
  // extractionType REMOVED: extraction provenance is pipeline-owned (see
  // PIPELINE_OWNED_SEGMENTS) — a producer must not relabel how a value
  // entered the model.
  'uncertainty_drivers',
  'intercept',
  'interventions',
  'is_baseline',
]);

/**
 * Within the observed_state/data subtree only these sub-fields are tunable
 * (the old exact allowlist, restored as a depth-1 rule after the root-only
 * relaxation was found to sanction provenance-class sub-fields like
 * `observed_state.source`). `interventions` allows deeper paths
 * (data/interventions/<factor_id>).
 *
 * EXPORTED (R1 residual, follow-up to #509) so the held-confirm value
 * canonicaliser (`canonicalise-held-value-ops.ts`) DERIVES its translatable
 * leaf set from this single owner instead of mirroring it — trap 12, a
 * hand-maintained second copy would drift silently and the drift would read
 * as green.
 */
export const ALLOWED_OBSERVED_SUBKEYS: ReadonlySet<string> = new Set([
  'value',
  'baseline',
  'unit',
  'interventions',
]);

/**
 * Tunable edge field ROOTS a candidate may update (EdgeV3 vocabulary minus
 * identity `from`/`to` and the pipeline stamps screened below).
 */
const ALLOWED_EDGE_FIELD_ROOTS: ReadonlySet<string> = new Set([
  'strength',
  'exists_probability',
  'effect_direction',
  'edge_type',
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

/**
 * Pipeline-recomputed / pipeline-review stamps (G10-adjacent, matched on the
 * field's ROOT segment — exact, not substring, so e.g. a hypothetical
 * `origin_label` would not be swept in accidentally):
 *  - `provenance` / `provenance_display` — RESPONSE-ONLY, recomputed by
 *    `transformResponseToV3` on every response;
 *  - `validation` — two-pass parameter-review pipeline metadata (edges);
 *  - `defaulted` — CIL default-strength flag (edges);
 *  - `origin` — creation-source stamp (edges).
 */
const PIPELINE_OWNED_ROOTS: ReadonlySet<string> = new Set([
  'provenance',
  'provenance_display',
  'validation',
  'defaulted',
  'origin',
  // Extraction-provenance stamps (review hardening, 2026-07-07): these mark
  // HOW a value entered the model and must never be producer-writable —
  // relabelling an AI-invented value as user-extracted is a provenance
  // integrity breach.
  'source',
  'extractiontype',
  'raw_value',
]);

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
  // Segment-wise (review hardening): the owned set is screened on EVERY path
  // segment, not just the root — `observed_state.provenance` and `data/origin`
  // are as owned as their bare spellings. Exact-segment match preserved (a
  // hypothetical `origin_label` still passes).
  if (f.split(/[./]/).some((seg) => PIPELINE_OWNED_ROOTS.has(seg))) return true;
  return PIPELINE_OWNED_MARKERS.some((m) => f.includes(m));
}

/** Recursively collect every object key in a payload value (lowercased). */
function collectObjectKeys(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const el of value) collectObjectKeys(el, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k.toLowerCase());
      collectObjectKeys(v, out);
    }
  }
}

/**
 * ROADMAP 2.11 / P0-2 — the intervention CONTRACT keys, DERIVED from the
 * canonical Zod schema (`InterventionV3.shape`, trap-12: derive, don't
 * mirror) plus `cap` (the edit prompt's DERIVED-FIELD RULE instructs
 * "Include value, raw_value, unit, and cap"; the option-intervention
 * encoder reads `cap` to normalise, and InterventionV3 passes it through).
 *
 * Why: an option-configure edit ("the raise price option should reduce
 * marketing spend to £25k") lands as `update_node` at
 * `data/interventions/<factor_id>` with an object payload carrying
 * `raw_value` — which is ALSO a pipeline-owned extraction-provenance root
 * on nodes. The smuggle guard read the payload keys context-free and
 * REJECTED the whole sanctioned configure vocabulary (PIPELINE_OWNED_FIELD),
 * so the one chat path that writes option interventions was dead on
 * arrival. Inside the interventions subtree these keys belong to the
 * intervention contract, not to node provenance — exempt exactly the
 * schema-derived set, exactly there. Everywhere else the screen is
 * unchanged.
 */
const INTERVENTION_CONTRACT_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(InterventionV3.shape).map((k) => k.toLowerCase()),
  'cap',
]);

/**
 * Depth-1 subtree rule for observed_state/data field paths, plus a smuggle
 * guard for whole-object writes: an object payload must not carry pipeline-
 * owned keys at any depth, and a whole-object observed_state/data write may
 * only carry the tunable sub-keys (the field-path check cannot see keys
 * riding inside the payload value).
 */
function checkObservedSubtree(field: string, payloadValue: unknown): FieldSafetyResult {
  const segs = field.toLowerCase().split(/[./]/);
  const root = segs[0];
  const isObserved = root === 'observed_state' || root === 'data';
  if (isObserved && segs.length > 1 && !ALLOWED_OBSERVED_SUBKEYS.has(segs[1]!)) {
    return { ok: false, code: FIELD_NOT_ALLOWED };
  }
  // Intervention-subtree writes (`data/interventions/<factor_id>` and the
  // top-level `interventions` root) carry the InterventionV3 contract —
  // see INTERVENTION_CONTRACT_KEYS above.
  const isInterventionSubtree =
    (isObserved && segs[1] === 'interventions') || root === 'interventions';
  if (payloadValue !== null && typeof payloadValue === 'object') {
    const keys = new Set<string>();
    collectObjectKeys(payloadValue, keys);
    for (const k of keys) {
      if (
        PIPELINE_OWNED_ROOTS.has(k) &&
        !(isInterventionSubtree && INTERVENTION_CONTRACT_KEYS.has(k))
      ) {
        return { ok: false, code: PIPELINE_OWNED_FIELD };
      }
    }
    if (isObserved && segs.length === 1) {
      for (const k of keys) {
        // depth-1 keys of a whole-object write must be tunable sub-keys;
        // deeper keys (inside interventions maps) are factor ids — allow.
        if (!ALLOWED_OBSERVED_SUBKEYS.has(k) && typeof (payloadValue as Record<string, unknown>)[k] !== 'undefined' && Object.prototype.hasOwnProperty.call(payloadValue, k)) {
          return { ok: false, code: FIELD_NOT_ALLOWED };
        }
      }
    }
  }
  return { ok: true };
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
  //     Pipeline-owned is screened on the FULL path (a nested
  //     `data/sensitivity_score` is still pipeline-owned); the allowlist is
  //     evaluated on the ROOT segment (a sanctioned root sanctions its
  //     sub-paths in every producer spelling: bare, slash-keyed, dotted).
  if (envelope.kind === 'update_node_field') {
    const field = envelope.payload.field;
    if (isPipelineOwned(field)) return { ok: false, code: PIPELINE_OWNED_FIELD };
    if (!ALLOWED_NODE_FIELD_ROOTS.has(fieldRootOf(field))) {
      return { ok: false, code: FIELD_NOT_ALLOWED };
    }
    const sub = checkObservedSubtree(field, envelope.payload.to);
    if (!sub.ok) return sub;
  } else if (envelope.kind === 'update_edge_field') {
    const field = envelope.payload.field;
    if (isPipelineOwned(field)) return { ok: false, code: PIPELINE_OWNED_FIELD };
    if (!ALLOWED_EDGE_FIELD_ROOTS.has(fieldRootOf(field))) {
      return { ok: false, code: FIELD_NOT_ALLOWED };
    }
    const sub = checkObservedSubtree(field, envelope.payload.to);
    if (!sub.ok) return sub;
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
