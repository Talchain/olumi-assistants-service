/**
 * Tier 0 S1 — Decision Data Spine proof slice: provenance + claim-safety classifier.
 *
 * Classifies each field of the live `blocks[0].enrichment` payload for
 *   - PROVENANCE  — where the field originated (PLoT engine / ISL / coaching / CEE meta), and
 *   - CLAIM-SAFETY — how strongly the product is allowed to assert it.
 *
 * ── SCIENTIFIC BOUNDARY (read this before trusting the table) ──────────────
 * The REGISTRY below is **DRAFT DOCTRINE pending Neil/Jinghui ratification**,
 * NOT settled scientific truth. Both the `category` and the `defaultClaimSafety`
 * columns are provisional working defaults chosen conservatively; they exist so
 * S1 can prove the read-side derivation, and they are expected to be revised once
 * Neil/Jinghui rule on the scientific semantics. Specifically:
 *   - No field defaults to `claim_safe` (the status stays in the vocabulary but
 *     is unused by default until ruled).
 *   - Comparison fields default `conservative` (descriptive model output, not
 *     real-world truth; non-causal; non-empirical).
 *   - Causal-effect-like fields default `not_claim_safe` (counterfactual claims).
 *   - Confidence / robustness / VOI-EVPI / calibration / identifiability /
 *     sensitivity default `conservative`, pending ratification.
 *
 * ── PROOF-SLICE BOUNDARY ───────────────────────────────────────────────────
 * Claim-safety is **re-derived on read** from the enrichment and is **never
 * persisted** (no handler-fact write, no DB, no telemetry, no fs). A consequence:
 * S1 cannot answer historical audit/query questions such as "which past analyses
 * were claim-unsafe?" — there is no stored tag to query. Persistence is a future
 * lane and would require re-sequencing (and is an explicit hard stop here).
 *
 * CEE-local types only — no import of `@talchain/schemas`, `orchestrator/types`,
 * or any response-shaping module.
 */

export type ClaimSafetyStatus =
  | 'claim_safe'
  | 'provisional'
  | 'conservative'
  | 'not_claim_safe'
  | 'unknown';

export type ScientificCategory =
  | 'comparison'
  | 'sensitivity'
  | 'robustness'
  | 'confidence'
  | 'value_of_information'
  | 'calibration'
  | 'identifiability'
  | 'causal_effect'
  | 'metadata'
  | 'other';

export type Provenance =
  | 'plot_engine'
  | 'isl'
  | 'coaching_m1'
  | 'cee_meta'
  | 'unknown';

/**
 * Stable string codes for the contested-signal a field is disputed by. Closed
 * set, pure predicates — re-derived from the enrichment on read, never inferred
 * by an LLM and never persisted.
 */
export type DisputeSignal =
  | 'status_not_computed'
  | 'named_in_inference_warnings'
  | 'thresholds_provisional'
  | 'near_tie'
  | 'review_skipped';

export interface RegistryEntry {
  readonly category: ScientificCategory;
  readonly provenance: Provenance;
  /** DRAFT default — pending Neil/Jinghui ratification. */
  readonly defaultClaimSafety: ClaimSafetyStatus;
  readonly reason: string;
}

export interface FieldClassification {
  readonly field: string;
  readonly category: ScientificCategory;
  readonly provenance: Provenance;
  /** Draft doctrine value from the REGISTRY (pending Neil/Jinghui ratification). */
  readonly defaultClaimSafety: ClaimSafetyStatus;
  /** Re-derived final status after applying any dispute signals. */
  readonly claimSafety: ClaimSafetyStatus;
  readonly disputed: boolean;
  readonly disputeSignals: DisputeSignal[];
  /** `'neil_jinghui'` for scientific categories whose default is unratified. */
  readonly pendingRuling: 'neil_jinghui' | null;
  readonly reason: string;
}

const DRAFT = 'DRAFT (pending Neil/Jinghui ratification):';

/** Reason shared by all comparison fields — carries the mandated wording. */
const COMPARISON_REASON =
  `${DRAFT} descriptive model output, not real-world truth; non-causal; non-empirical`;

/**
 * DRAFT REGISTRY for the live `blocks[0].enrichment` keys (40 known keys at the
 * captured shape). Categories + claim-safety are provisional doctrine pending
 * Neil/Jinghui ratification. Kept as an in-module `const` — there is deliberately
 * NO separate `registry.ts` file (proof slice is new-files-only).
 */
export const ENRICHMENT_REGISTRY: Readonly<Record<string, RegistryEntry>> = {
  // ── comparison (descriptive model output) → conservative until ruled ──
  option_comparison: { category: 'comparison', provenance: 'plot_engine', defaultClaimSafety: 'conservative', reason: COMPARISON_REASON },
  conditional_winners: { category: 'comparison', provenance: 'plot_engine', defaultClaimSafety: 'conservative', reason: COMPARISON_REASON },
  decision_brief: { category: 'comparison', provenance: 'cee_meta', defaultClaimSafety: 'conservative', reason: COMPARISON_REASON },

  // ── sensitivity → conservative ──
  factor_sensitivity: { category: 'sensitivity', provenance: 'isl', defaultClaimSafety: 'conservative', reason: `${DRAFT} composite — sensitivity + embedded VOI/EVPI + confidence; conservative pending ratification` },
  edge_sensitivity: { category: 'sensitivity', provenance: 'plot_engine', defaultClaimSafety: 'conservative', reason: `${DRAFT} edge sensitivity; conservative pending ratification; shape unverified (empty in reference fixture)` },

  // ── robustness / stability → conservative ──
  factor_stability: { category: 'robustness', provenance: 'isl', defaultClaimSafety: 'conservative', reason: `${DRAFT} stability metric; conservative pending ratification` },
  stability_thresholds: { category: 'robustness', provenance: 'cee_meta', defaultClaimSafety: 'conservative', reason: `${DRAFT} stability thresholds (operational defaults); conservative pending ratification` },
  robustness: { category: 'robustness', provenance: 'isl', defaultClaimSafety: 'conservative', reason: `${DRAFT} robustness assessment; conservative pending ratification` },
  robustness_synthesis: { category: 'robustness', provenance: 'cee_meta', defaultClaimSafety: 'conservative', reason: `${DRAFT} robustness synthesis; conservative pending ratification` },

  // ── confidence → conservative ──
  confidence_tier: { category: 'confidence', provenance: 'isl', defaultClaimSafety: 'conservative', reason: `${DRAFT} confidence tier; conservative pending ratification` },
  decision_quality: { category: 'confidence', provenance: 'cee_meta', defaultClaimSafety: 'conservative', reason: `${DRAFT} decision-quality signal; conservative pending ratification` },

  // ── identifiability → conservative ──
  identifiability: { category: 'identifiability', provenance: 'isl', defaultClaimSafety: 'conservative', reason: `${DRAFT} identifiability; conservative pending ratification` },

  // ── calibration / inference warnings → conservative ──
  inference_warnings: { category: 'calibration', provenance: 'isl', defaultClaimSafety: 'conservative', reason: `${DRAFT} calibration / inference warnings; conservative pending ratification` },

  // ── causal-effect-like → NOT claim-safe by default ──
  flip_thresholds: { category: 'causal_effect', provenance: 'isl', defaultClaimSafety: 'not_claim_safe', reason: `${DRAFT} causal-effect-like counterfactual (tipping point); not claim-safe by default` },
  edge_e_values: { category: 'causal_effect', provenance: 'isl', defaultClaimSafety: 'not_claim_safe', reason: `${DRAFT} causal-effect-like (edge E-values); not claim-safe by default; shape unverified (empty in reference fixture)` },

  // ── coaching / prose (M1 + CEE) → conservative ──
  m1_coaching: { category: 'other', provenance: 'coaching_m1', defaultClaimSafety: 'conservative', reason: `${DRAFT} coaching narrative; conservative pending ratification` },
  m1_review: { category: 'other', provenance: 'coaching_m1', defaultClaimSafety: 'conservative', reason: `${DRAFT} coaching review; conservative pending ratification` },
  improvement_guidance: { category: 'other', provenance: 'coaching_m1', defaultClaimSafety: 'conservative', reason: `${DRAFT} coaching guidance; conservative pending ratification` },
  critiques: { category: 'other', provenance: 'isl', defaultClaimSafety: 'conservative', reason: `${DRAFT} ISL critiques; conservative pending ratification` },
  review_cards: { category: 'other', provenance: 'cee_meta', defaultClaimSafety: 'conservative', reason: `${DRAFT} review cards; conservative pending ratification` },
  insights: { category: 'other', provenance: 'cee_meta', defaultClaimSafety: 'conservative', reason: `${DRAFT} insights; conservative pending ratification` },
  rationale: { category: 'other', provenance: 'cee_meta', defaultClaimSafety: 'conservative', reason: `${DRAFT} rationale; conservative pending ratification` },

  // ── transport / diagnostic metadata → unknown (not a scientific claim) ──
  analysis_status: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
  option_comparison_status: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
  robustness_status: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
  drivers_status: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
  isl_analysis_status: { category: 'metadata', provenance: 'isl', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
  review_status: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
  review_skip_reason: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
  cee_status: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
  request_id: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
  response_hash: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
  processing_time_ms: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
  request_schema_version: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
  endpoint_version: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
  preflight_version: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
  downstream_calls: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
  fact_objects: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
  _meta: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
  meta: { category: 'metadata', provenance: 'cee_meta', defaultClaimSafety: 'unknown', reason: 'transport/diagnostic metadata; not a scientific claim' },
};

/** Closed set of enrichment keys the spine recognises (single source of truth). */
export const KNOWN_ENRICHMENT_KEYS: ReadonlySet<string> = new Set(Object.keys(ENRICHMENT_REGISTRY));

/** Fallback for keys absent from the registry — preserved, never classified. */
const UNKNOWN_ENTRY: RegistryEntry = {
  category: 'other',
  provenance: 'unknown',
  defaultClaimSafety: 'unknown',
  reason: 'unrecognised enrichment key; preserved as-is, not classified',
};

/** Categories whose draft claim-safety awaits a Neil/Jinghui ruling. */
const SCIENTIFIC_CATEGORIES: ReadonlySet<ScientificCategory> = new Set<ScientificCategory>([
  'comparison',
  'sensitivity',
  'robustness',
  'confidence',
  'value_of_information',
  'calibration',
  'identifiability',
  'causal_effect',
]);

/** Most-safe → least-safe. A dispute can only move a field rightwards. */
const SAFETY_ORDER: ClaimSafetyStatus[] = ['claim_safe', 'conservative', 'provisional', 'not_claim_safe'];

function mostRestrictive(a: ClaimSafetyStatus, b: ClaimSafetyStatus): ClaimSafetyStatus {
  const ia = SAFETY_ORDER.indexOf(a);
  const ib = SAFETY_ORDER.indexOf(b);
  // 'unknown' is not on the order; never downgraded here (metadata only).
  if (ia < 0) return a;
  if (ib < 0) return b;
  return ia >= ib ? a : b;
}

// ── small local narrowing helpers (no external deps) ──
function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}
function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

const SUCCESS_STATUSES: ReadonlySet<string> = new Set(['computed', 'completed', 'ready']);

/**
 * Map historical / non-canonical status values to the success set, mirroring the
 * allowlist+normalise idea in context/freshness.ts (idiom only — not imported).
 * Returns null for unknown / non-success values.
 */
function normaliseStatus(raw: string | null): string | null {
  if (raw === null) return null;
  const t = raw.trim().toLowerCase();
  if (t === '') return null;
  if (SUCCESS_STATUSES.has(t)) return t;
  if (t === 'complete') return 'completed';
  if (t === 'ok' || t === 'success') return 'completed';
  return null;
}

function isSuccessStatus(v: unknown): boolean {
  return normaliseStatus(asString(v)) !== null;
}

/** Status companion → the fields it guards. */
const STATUS_COMPANIONS: Readonly<Record<string, readonly string[]>> = {
  option_comparison_status: ['option_comparison'],
  robustness_status: ['robustness', 'robustness_synthesis'],
  drivers_status: ['factor_sensitivity', 'factor_stability'],
};

/** Fields downgraded when `stability_thresholds.provisional === true`. */
const STABILITY_GUARDED: readonly string[] = ['factor_stability', 'stability_thresholds', 'robustness', 'robustness_synthesis'];

/** Fields downgraded when `robustness.near_tie.is_tie === true`. */
const NEAR_TIE_GUARDED: readonly string[] = ['option_comparison', 'conditional_winners'];

function addSignal(map: Map<string, Set<DisputeSignal>>, field: string, signal: DisputeSignal): void {
  let set = map.get(field);
  if (!set) {
    set = new Set<DisputeSignal>();
    map.set(field, set);
  }
  set.add(signal);
}

/**
 * Re-derive, from the enrichment alone, which fields are disputed and by which
 * signal. Pure: reads only `raw`, returns a map. Never mutates, never persists.
 */
function computeDisputeContext(raw: Record<string, unknown>): Map<string, Set<DisputeSignal>> {
  const map = new Map<string, Set<DisputeSignal>>();

  // 1. status_not_computed — companion status not in the success set.
  for (const [companion, fields] of Object.entries(STATUS_COMPANIONS)) {
    if (companion in raw && !isSuccessStatus(raw[companion])) {
      for (const f of fields) addSignal(map, f, 'status_not_computed');
    }
  }

  // 2. thresholds_provisional.
  const thresholds = asRecord(raw.stability_thresholds);
  if (thresholds?.provisional === true) {
    for (const f of STABILITY_GUARDED) addSignal(map, f, 'thresholds_provisional');
  }

  // 3. near_tie.
  const robustness = asRecord(raw.robustness);
  const nearTie = asRecord(robustness?.near_tie);
  if (nearTie?.is_tie === true) {
    for (const f of NEAR_TIE_GUARDED) addSignal(map, f, 'near_tie');
  }

  // 4. review_skipped.
  if (asString(raw.review_status) === 'skipped') {
    addSignal(map, 'review_cards', 'review_skipped');
  }

  // 5. named_in_inference_warnings — a warning naming a registry key disputes it.
  const warnings = asArray(raw.inference_warnings) ?? [];
  for (const w of warnings) {
    const named = referencedField(w);
    if (named && KNOWN_ENRICHMENT_KEYS.has(named)) {
      addSignal(map, named, 'named_in_inference_warnings');
    }
  }

  return map;
}

/** Extract a registry-key reference from an inference-warning entry, if any. */
function referencedField(warning: unknown): string | null {
  const s = asString(warning);
  if (s !== null) return s;
  const rec = asRecord(warning);
  if (!rec) return null;
  for (const key of ['field', 'target', 'key', 'factor_id'] as const) {
    const v = asString(rec[key]);
    if (v !== null) return v;
  }
  return null;
}

/**
 * Classify every present key of the live enrichment. Re-derived on read; the
 * returned objects are never persisted. Idempotent — identical input yields a
 * deep-equal result every call.
 */
export function classifyEnrichment(enrichment: unknown): FieldClassification[] {
  const raw = asRecord(enrichment) ?? {};
  const disputeCtx = computeDisputeContext(raw);

  return Object.keys(raw).map((field) => {
    const entry = ENRICHMENT_REGISTRY[field] ?? UNKNOWN_ENTRY;
    const signalSet = disputeCtx.get(field);
    const disputeSignals: DisputeSignal[] = signalSet ? [...signalSet].sort() : [];
    const disputed = disputeSignals.length > 0;
    const claimSafety = disputed
      ? mostRestrictive(entry.defaultClaimSafety, 'provisional')
      : entry.defaultClaimSafety;
    const pendingRuling = SCIENTIFIC_CATEGORIES.has(entry.category) ? 'neil_jinghui' : null;
    return {
      field,
      category: entry.category,
      provenance: entry.provenance,
      defaultClaimSafety: entry.defaultClaimSafety,
      claimSafety,
      disputed,
      disputeSignals,
      pendingRuling,
      reason: entry.reason,
    };
  });
}

/** Convenience: classifications keyed by field name. */
export function classifyEnrichmentByField(enrichment: unknown): Record<string, FieldClassification> {
  const out: Record<string, FieldClassification> = {};
  for (const c of classifyEnrichment(enrichment)) out[c.field] = c;
  return out;
}
