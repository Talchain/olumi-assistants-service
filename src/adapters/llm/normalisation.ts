/**
 * NodeKind Normalisation Module
 *
 * Maps non-standard LLM node types to canonical types to prevent schema errors.
 * Shared between all LLM adapters (OpenAI, Anthropic, etc.)
 */

import { emit, TelemetryEvents, log } from "../../utils/telemetry.js";
import { contentDigest } from "../../utils/redaction.js";
import { resolveGoalThresholdCap } from "../../utils/goal-threshold-cap.js";
import { stampFallbackDefault } from "../../cee/provenance/factor-value-provenance.js";

// ============================================================================
// Types
// ============================================================================

export type CanonicalNodeKind = 'goal' | 'decision' | 'option' | 'outcome' | 'risk' | 'action' | 'factor';

// ============================================================================
// Mappings
// ============================================================================

/**
 * Map of non-standard node kinds to canonical kinds.
 * LLMs may return synonyms like "evidence", "constraint", "benefit" etc.
 * that need to be normalised before Zod validation.
 */
export const NODE_KIND_MAP: Record<string, CanonicalNodeKind> = {
  // Canonical kinds (pass through)
  'goal': 'goal',
  'decision': 'decision',
  'option': 'option',
  'outcome': 'outcome',
  'risk': 'risk',
  'action': 'action',
  'factor': 'factor',

  // Synonyms that map to 'option'
  'evidence': 'option',
  'consideration': 'option',
  'alternative': 'option',
  'choice': 'option',
  'input': 'option',
  'criteria': 'option',
  'criterion': 'option',

  // Synonyms that map to 'risk'
  'constraint': 'risk',
  'issue': 'risk',
  'threat': 'risk',
  'problem': 'risk',
  'concern': 'risk',
  'challenge': 'risk',
  'blocker': 'risk',

  // Synonyms that map to 'outcome'
  'benefit': 'outcome',
  'result': 'outcome',
  'consequence': 'outcome',
  'impact': 'outcome',
  'effect': 'outcome',
  'reward': 'outcome',

  // Synonyms that map to 'goal'
  'objective': 'goal',
  'target': 'goal',
  'aim': 'goal',
  'purpose': 'goal',

  // Synonyms that map to 'action'
  'step': 'action',
  'task': 'action',
  'activity': 'action',
  'measure': 'action',

  // Synonyms that map to 'decision'
  'question': 'decision',
  'dilemma': 'decision',
};

// ============================================================================
// Functions
// ============================================================================

/**
 * Normalise a node kind from LLM output to a canonical kind.
 * Unknown kinds default to 'option' with a warning.
 */
export function normaliseNodeKind(kind: string): CanonicalNodeKind {
  const normalised = NODE_KIND_MAP[kind.toLowerCase().trim()];
  if (!normalised) {
    emit(TelemetryEvents.NodeKindNormalized, {
      original_kind: kind,
      normalised_kind: 'option',
      was_unknown: true,
    });
    log.warn({ original_kind: kind }, 'Unknown node kind from LLM, defaulting to option');
    return 'option';
  }
  return normalised;
}

// ============================================================================
// STRINGIFIED AUX FIELDS (v8 — 2026-07-07 grammar-size fix, Lane 26)
// The Anthropic draft schema declares coaching, causal_claims, and
// topology_plan as `{ type: "string" }` JSON-string fields (see the GRAMMAR
// BUDGET (v8) note in src/cee/draft/anthropic-graph-schema.ts) — the full
// object subtrees pushed the compiled grammar past Anthropic's unpublished
// size limit, 400-failing structured outputs on every draft. This ingress
// parse converts the strings back to objects/arrays BEFORE Zod and every
// downstream consumer (normalise-legacy-coaching, validateCausalClaims,
// Stage 5 Package).
// ============================================================================

const STRINGIFIED_AUX_FIELDS = [
  { key: 'coaching', expect: 'object' },
  { key: 'causal_claims', expect: 'array' },
  { key: 'topology_plan', expect: 'array' },
] as const;

/**
 * Parse the v8 JSON-string aux fields in place.
 *
 * Shape-based and tolerant by design:
 * - Field absent, or already an object/array (prompt-only fallback path,
 *   OpenAI adapter, legacy fixtures) → untouched.
 * - Valid JSON string of the expected shape → replaced with the parsed value.
 * - Double-encoded string (model JSON-encoded the JSON string once more) →
 *   parsed twice. A single parse can never yield a valid final shape when it
 *   yields a string, so the second attempt is unambiguous.
 * - Malformed JSON or wrong shape → the field is DROPPED. Downstream then
 *   behaves exactly as when the LLM omits the field — Stage 5 emits the
 *   canonical-empty coaching block; causal_claims / topology_plan are
 *   omitted from the response — which is identical to today's prompt-only
 *   fallback behaviour. Enforcement is therefore never worse than status
 *   quo, while nodes/edges/goal_constraints gain full grammar enforcement.
 */
export function parseStringifiedAuxFields(obj: Record<string, unknown>): void {
  for (const { key, expect } of STRINGIFIED_AUX_FIELDS) {
    const raw = obj[key];
    if (typeof raw !== 'string') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
      // Double-encoded edge case: unwrap exactly one extra layer.
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    } catch {
      parsed = undefined;
    }

    const shapeOk = expect === 'array'
      ? Array.isArray(parsed)
      : parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);

    if (shapeOk) {
      obj[key] = parsed;
    } else {
      delete obj[key];
      log.warn({
        event: 'llm.normalisation.aux_field_parse_failed',
        field: key,
        expected_shape: expect,
        raw_length: raw.length,
        // Digest raw model output — never place it on the wire verbatim (see contentDigest).
        raw_preview: contentDigest(raw),
      }, `Draft aux field "${key}" was not a JSON-encoded ${expect} — dropped (canonical-empty default applies downstream)`);
    }
  }
}

/**
 * Every field of the goal-threshold contract CEE mints for itself (ROADMAP
 * 2.281). The quad the draft grammar used to declare, PLUS the attestation
 * fields — `goal_threshold_frame` is the whole point of the exercise, and
 * `goal_baseline*` are only sound when divided by the SAME cap on the SAME
 * branch that produced the threshold (enricher.ts:699-719).
 *
 * DERIVED-BY-INTENT, not mirrored: this list is the fields no model may author,
 * and the pinning test asserts it covers every `goal_*` field the node schema
 * declares, so a new goal field added to `schemas/graph.ts` REDs rather than
 * quietly becoming model-writable.
 */
export const CEE_MINTED_GOAL_FIELDS = [
  'goal_threshold',
  'goal_threshold_raw',
  'goal_threshold_unit',
  'goal_threshold_cap',
  'goal_threshold_frame',
  'goal_baseline',
  'goal_baseline_raw',
] as const;

/** What a strip actually removed — returned so the caller can log it, never silent. */
export interface GoalThresholdStripResult {
  /** Node ids that carried at least one CEE-minted goal field. */
  nodeIds: string[];
  /** Field names actually removed, deduped, for telemetry. */
  fields: string[];
}

/**
 * Remove any model-authored goal-threshold contract from a DRAFT response.
 *
 * ── WHY THIS EXISTS ALONGSIDE THE GRAMMAR CUT (ROADMAP 2.281) ──────────────
 * `buildDraftGraphSchema()` (cee/draft/anthropic-graph-schema.ts, v15) makes the
 * quad UNEMITTABLE — but only when the grammar is actually sent. Structured
 * outputs is conditional on `CEE_ANTHROPIC_STRUCTURED_OUTPUTS` (config default
 * FALSE), a model allowlist, thinking being off, and no `so_reject` fallback
 * having fired (anthropic.ts:792-798). On the prompt-only path there is NO
 * GRAMMAR AT ALL, so the grammar cut alone would be inert on exactly the path
 * the 2026-08-01 live witness measured. This strip is the layer that does not
 * depend on that posture: it holds for every REAL provider draft call
 * (anthropic.ts:1801, openai.ts:747).
 *
 * Neither layer is redundant. The grammar stops the tokens being generated (and
 * so also saves the output tokens); this stops the value being persisted. The
 * claim "the enricher is the only mint" is true because of BOTH.
 *
 * ── WHY THIS IS SAFE TO DO UNCONDITIONALLY *ON A DRAFT RESPONSE* ───────────
 * A draft response is a from-scratch graph: `draftGraph` receives a brief, docs
 * and an optional attachment — never an existing graph — and Stage 1 (Parse)
 * runs BEFORE Stage 3 (Enrich) in the unified pipeline. So at this seam no
 * legitimate, attested threshold can exist yet: anything present was written by
 * the model. Deleting it cannot destroy a CEE-minted value because none has been
 * minted.
 *
 * ⚠ AND WHY IT IS NOT WIRED INTO `normaliseDraftResponse` ITSELF. That function
 * is SHARED with the repair_graph path (anthropic.ts:2624, openai.ts:1215),
 * which runs at Stage 4 — i.e. AFTER Stage 3 has enriched. A strip there would
 * delete a threshold the enricher had already minted and attested, turning this
 * fix into the very defect it closes. The two seams are deliberately separate;
 * do not "simplify" this by folding it into the normaliser.
 *
 * Mutates in place (the file's established style) and reports what it removed.
 */
export function stripModelAuthoredGoalThreshold(raw: unknown): GoalThresholdStripResult {
  const result: GoalThresholdStripResult = { nodeIds: [], fields: [] };
  if (!raw || typeof raw !== 'object') return result;
  const nodes = (raw as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes)) return result;

  const seenFields = new Set<string>();
  for (const node of nodes as any[]) {
    if (!node || typeof node !== 'object') continue;
    let touched = false;
    for (const field of CEE_MINTED_GOAL_FIELDS) {
      // `in`, not a truthiness check: an explicit `null` (the shape the old
      // nullable grammar taught) is still a model-authored key, and 0 is a
      // legitimate threshold value that a truthiness test would skip.
      if (field in node && node[field] !== undefined) {
        delete node[field];
        touched = true;
        seenFields.add(field);
      }
    }
    if (touched) result.nodeIds.push(String(node.id ?? '<unidentified>'));
  }
  result.fields = [...seenFields];
  return result;
}

/**
 * Normalise all node kinds in a draft response before Zod validation.
 * Also coerces string numbers to actual numbers for belief/weight.
 */
export function normaliseDraftResponse(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;

  const obj = raw as Record<string, unknown>;
  let normalisedCount = 0;

  // v8 stringified aux fields: must run before the coaching sentinel
  // coercion below and before any Zod/downstream consumer sees the fields.
  parseStringifiedAuxFields(obj);

  // ========================================================================
  // PRE-NORMALISATION DIAGNOSTIC: Capture raw LLM output shape for edge
  // strength and factor data BEFORE any coercion/stripping runs.
  // Helps distinguish "LLM didn't produce it" from "pipeline lost it".
  // ========================================================================
  if (Array.isArray(obj.edges)) {
    const rawEdges = obj.edges as any[];
    const withNestedStrength = rawEdges.filter((e: any) => e && typeof e.strength === 'object' && e.strength !== null).length;
    const withFlatStrength = rawEdges.filter((e: any) => e && e.strength_mean !== undefined).length;
    const withWeight = rawEdges.filter((e: any) => e && e.weight !== undefined).length;
    log.debug({
      event: 'llm.raw_diagnostic.edges',
      edge_count: rawEdges.length,
      with_nested_strength: withNestedStrength,
      with_flat_strength_mean: withFlatStrength,
      with_legacy_weight: withWeight,
    }, `[RAW] Edge strengths before normalisation: ${withNestedStrength} nested, ${withFlatStrength} flat, ${withWeight} legacy out of ${rawEdges.length}`);
  }
  if (Array.isArray(obj.nodes)) {
    const rawNodes = obj.nodes as any[];
    const factors = rawNodes.filter((n: any) => n && (n.kind === 'factor' || n.kind === 'Factor'));
    const withDataValue = factors.filter((n: any) => n.data && (typeof n.data.value === 'number' || typeof n.data.value === 'string')).length;
    const withDataNull = factors.filter((n: any) => n.data && n.data.value === null).length;
    const withNoData = factors.filter((n: any) => !n.data).length;
    const withMetadataNoValue = factors.filter((n: any) => {
      if (!n.data) return false;
      const hasValue = typeof n.data.value === 'number' || typeof n.data.value === 'string';
      const hasMeta = n.data.factor_type || n.data.extractionType || n.data.uncertainty_drivers;
      return !hasValue && n.data.value !== null && hasMeta;
    }).length;
    log.debug({
      event: 'llm.raw_diagnostic.factor_data',
      factor_count: factors.length,
      with_data_value: withDataValue,
      with_data_value_null: withDataNull,
      with_no_data: withNoData,
      with_metadata_no_value: withMetadataNoValue,
    }, `[RAW] Factor data before normalisation: ${withDataValue} have value, ${withDataNull} null, ${withNoData} no data, ${withMetadataNoValue} metadata-only out of ${factors.length}`);
  }

  // Normalise node kinds
  if (Array.isArray(obj.nodes)) {
    obj.nodes = obj.nodes.map((node: unknown) => {
      if (!node || typeof node !== 'object') return node;
      const n = node as Record<string, unknown>;

      if (typeof n.kind === 'string') {
        const original = n.kind;
        const normalised = normaliseNodeKind(n.kind);
        if (original.toLowerCase() !== normalised) {
          normalisedCount++;
          emit(TelemetryEvents.NodeKindNormalized, {
            original_kind: original,
            normalised_kind: normalised,
            node_id: n.id,
            was_unknown: false,
          });
        }
        return { ...n, kind: normalised };
      }
      return n;
    });
  }

  // ========================================================================
  // SENTINEL & NULL COERCION (v4 — 2026-04-02):
  // The Anthropic schema uses plain (non-nullable) types for most fields
  // to stay under the 16 union-param limit. The LLM emits sentinels
  // (0, "", [], false) for inapplicable fields. We strip them here by
  // node kind so downstream code sees undefined for absent fields.
  // Null coercion is retained as a safety net for non-Anthropic providers.
  // ========================================================================
  if (Array.isArray(obj.nodes)) {
    obj.nodes = (obj.nodes as any[]).map((node: any) => {
      if (!node || typeof node !== 'object') return node;
      const kind: string = node.kind ?? '';

      // Top-level fields still using anyOf (category, data, prior)
      if (node.category === null) node.category = undefined;
      if (node.data === null) node.data = undefined;
      if (node.prior === null) node.prior = undefined;

      // ── Node-kind-aware stripping ────────────────────────────────
      // goal_threshold* / goal_threshold_cap only meaningful on goal nodes
      if (kind !== 'goal') {
        node.goal_threshold = undefined;
        node.goal_threshold_raw = undefined;
        node.goal_threshold_unit = undefined;
        node.goal_threshold_cap = undefined;
      } else {
        if (node.goal_threshold === null) node.goal_threshold = undefined;
        if (node.goal_threshold_raw === null) node.goal_threshold_raw = undefined;
        if (node.goal_threshold_unit === null || node.goal_threshold_unit === '') node.goal_threshold_unit = undefined;
        if (node.goal_threshold_cap === null) node.goal_threshold_cap = undefined;
        if (
          node.goal_threshold_cap === 0 &&
          (node.goal_threshold_raw === null || node.goal_threshold_raw === undefined)
        ) {
          node.goal_threshold_cap = undefined;
        }

        // ── ROADMAP 2.239: degenerate model-supplied cap ────────────────
        // `goal_threshold_cap` is an LLM-WRITABLE draft field
        // (cee/draft/anthropic-graph-schema.ts:299) and the LIVE draft
        // prompt sanctions `cap >= raw` verbatim ("goal_threshold_cap:
        // reference maximum (must be >= goal_threshold_raw)",
        // prompts/defaults-v187.ts:294 — v187 is the live default;
        // defaults.ts:2231 marks v19 deprecated/superseded). A model that
        // takes the `=` produces `goal_threshold = raw/cap = 1.0` — the
        // state utils/goal-threshold-cap.ts's own doctrine forbids, because
        // ISL then scores P(sample >= the ceiling of the scale). Measured
        // on the deployed build: 0.021 and exactly 0.0 across two options
        // whose leader won 95% of scenarios (diagnosis §5 Finding B).
        //
        // ⚠ AND v187 IS STRICTLY WORSE THAN ITS PREDECESSOR HERE. v19
        // carried a mitigating line — ":184 …prefer a headroom cap above
        // the target (not cap = target, which forces goal_threshold = 1.0
        // and eliminates probability spread)" — and **v187 has no such
        // sentence anywhere**; :294 is a bare `>=`. The prompt got weaker
        // while the code kept the same hole. Restoring that sentence to
        // v187 is rowed separately; this guard must hold regardless of
        // what any prompt version says, which is the reason it lives here
        // and not only in the prompt.
        //
        // WHY HERE. This is the only seam that sees a model-authored
        // threshold quad before it is persisted, for every REAL provider:
        // `normaliseDraftResponse` is called by anthropic.ts :1801/:2624
        // and openai.ts :747/:1215. (NOT literally every drafted graph —
        // `FixturesAdapter.draftGraph`, router.ts:298-316, returns
        // `fixtureGraph` WITHOUT normalising, so `LLM_PROVIDER=fixtures`
        // never reaches this code. Zero blast radius, but it means no
        // fixtures-backed end-to-end test can exercise it — the coverage
        // below is unit-level against this function by necessity.)
        // The three resolver-bearing paths — add_constraint's two sites and
        // the factor-extraction enricher — are fixed by the `>` change in
        // resolveGoalThresholdCap, but NONE runs on a quad the model wrote
        // itself: the enricher's branch is gated on `goal_threshold ===
        // undefined` (enricher.ts:649), and nothing anywhere recomputes
        // goal_threshold from raw/cap for a goal node (every raw/cap
        // recomputation site in src/ is a FACTOR site). Stage 4b
        // (threshold-sweep) only DELETES — its contract declares
        // `allowedModifications.node: []` — and does not fire on the live
        // shape anyway (raw present, label carries digits). So without this
        // block the fix would be provably partial while looking complete.
        //
        // ── THE TWO GATES, and why each is load-bearing ─────────────────
        // (1) `gtCap <= gtRaw`. WITHOUT THIS THE REPAIR IS ITSELF A DEFECT
        //     OF THE CLASS IT FIXES. `resolveGoalThresholdCap` evaluates
        //     its '%' rule (raw 0-100 → cap 100) BEFORE the existing-cap
        //     rule, so calling it unconditionally rewrites SOUND, strictly
        //     -greater percentage caps: {raw 5, '%', cap 20, th 0.25} would
        //     become th 0.05 (5x), {raw 80, '%', cap 1000, th 0.08} would
        //     become th 0.8 (10x) — silently, on non-degenerate graphs, in
        //     the OVER-OPTIMISTIC direction. This gate confines the repair
        //     to caps that are equal to or below the target, i.e. exactly
        //     the ones that cannot be a sound denominator.
        // (2) the drafted threshold must actually BE `raw / cap`. v187's
        //     MODEL UNIT TYPES table (:296-303) declares `goal_threshold`
        //     is NOT raw/cap for two of its four rows — "NRR 110% → 1.10,
        //     raw 110" and "3 hires → 3, raw 3". A model following the
        //     prompt exactly, with the minimum cap the prompt permits
        //     (cap = raw), would otherwise be rewritten to 0.8 and have a
        //     correct, prompt-instructed threshold destroyed. Requiring the
        //     raw/cap convention to hold means we only touch quads that are
        //     using the normalisation this fix is about.
        // Together the gates imply the drafted threshold is >= 1 - 1e-6 —
        // i.e. the repair fires only on the "kills probability spread" state
        // and nothing else. NOT >= 1.0 exactly: gate (1) gives r = raw/cap
        // >= 1, so the tolerance below is 1e-6*r and gate (2) admits any
        // threshold down to r*(1 - 1e-6), whose infimum over r >= 1 is
        // 0.999999. That band is still the degenerate state (a threshold of
        // 0.9999991 asks for the ceiling of the scale just as 1.0 does, and
        // every case in it has cap <= raw), so the CONSEQUENCE is unchanged
        // — but the bound is the stated one, and a later reader must not
        // build on a strict >= 1.0 that does not hold.
        // Tolerance mirrors the established convention for this same
        // cross-check (SCALE_CONSISTENCY_TOLERANCE, relative,
        // magnitude-scaled — src/orchestrator-v5/system-events/
        // factor-value-edit.ts:82).
        //
        // Repairs the DENOMINATOR only — `goal_threshold_raw` and
        // `goal_threshold_unit` (what the user actually asked for) are
        // never rewritten. `unit`/`existingUnit` are deliberately the
        // node's OWN goal_threshold_unit for both arguments: cap and raw
        // are two numbers on one node under one declared unit, so there is
        // no second unit to be incompatible with.
        //
        // DELIBERATELY NOT REPAIRED (each would be a different defect):
        // a threshold that disagrees with an otherwise-sound raw/cap pair;
        // a missing cap or a missing threshold (so this never MINTS a
        // threshold, and never closes the enricher's `goal_threshold ===
        // undefined` redirect branch); a non-positive or non-finite value.
        const gtRaw = node.goal_threshold_raw;
        const gtCap = node.goal_threshold_cap;
        const gtVal = node.goal_threshold;
        const usesRawOverCapConvention =
          typeof gtRaw === 'number' && Number.isFinite(gtRaw) && gtRaw > 0 &&
          typeof gtCap === 'number' && Number.isFinite(gtCap) && gtCap > 0 &&
          typeof gtVal === 'number' && Number.isFinite(gtVal) &&
          Math.abs(gtVal - gtRaw / gtCap) <=
            1e-6 * Math.max(1, Math.abs(gtRaw / gtCap));
        if (
          usesRawOverCapConvention &&
          // gate (1) — only a degenerate or undercutting denominator
          (gtCap as number) <= (gtRaw as number)
        ) {
          const soundCap = resolveGoalThresholdCap(
            gtCap,
            gtRaw,
            node.goal_threshold_unit,
            node.goal_threshold_unit,
          );
          if (soundCap !== null && soundCap !== gtCap) {
            const before = { cap: gtCap, threshold: node.goal_threshold };
            node.goal_threshold_cap = soundCap;
            node.goal_threshold = gtRaw / soundCap;
            log.info(
              {
                node_id: node.id,
                goal_threshold_raw: gtRaw,
                goal_threshold_unit: node.goal_threshold_unit,
                cap_before: before.cap,
                cap_after: soundCap,
                threshold_before: before.threshold,
                threshold_after: node.goal_threshold,
                reason: gtCap === gtRaw ? 'cap_equals_raw' : 'cap_undercuts_raw',
                event: 'cee.normalisation.goal_threshold_cap_repaired',
              },
              'Repaired a degenerate model-supplied goal_threshold_cap',
            );
          }
        }
      }

      // is_baseline only meaningful on option nodes
      if (kind !== 'option') {
        node.is_baseline = undefined;
      } else {
        if (node.is_baseline === null) node.is_baseline = undefined;
      }

      // intercept only meaningful on factor nodes
      if (kind !== 'factor') {
        node.intercept = undefined;
      } else {
        if (node.intercept === null) node.intercept = undefined;
      }

      // ── Inner data fields: sentinel + null coercion ──────────────
      if (node.data && typeof node.data === 'object') {
        const d = node.data;
        // Null safety net (non-Anthropic providers may still emit null)
        if (d.value === null) d.value = undefined;
        if (d.raw_value === null) d.raw_value = undefined;
        if (d.cap === null) d.cap = undefined;
        if (d.uncertainty_drivers === null) d.uncertainty_drivers = undefined;
        if (d.interventions === null) d.interventions = undefined;
        if (d.is_baseline === null) d.is_baseline = undefined;
        // String sentinel coercion: "" → undefined
        if (d.extractionType === null || d.extractionType === '') d.extractionType = undefined;
        if (d.factor_type === null || d.factor_type === '') d.factor_type = undefined;
        if (d.unit === null || d.unit === '') d.unit = undefined;
        if (d.encoding_map === null || d.encoding_map === '') d.encoding_map = undefined;
        if (d.display_value === null || d.display_value === '') d.display_value = undefined;

        // Numeric coercion: LLMs may emit data.value / data.raw_value / data.cap
        // as strings (e.g. "0.6", "180000"). Coerce to number so the downstream
        // union-key check (typeof data.value === 'number') doesn't strip the
        // entire data object, losing factor_type/extractionType/uncertainty_drivers.
        if (typeof d.value === 'string') {
          const parsed = Number(d.value);
          if (!Number.isNaN(parsed)) {
            d.value = parsed;
          }
        }
        if (typeof d.raw_value === 'string') {
          const parsed = Number(d.raw_value);
          if (!Number.isNaN(parsed)) {
            d.raw_value = parsed;
          }
        }
        if (typeof d.cap === 'string') {
          const parsed = Number(d.cap);
          if (!Number.isNaN(parsed)) {
            d.cap = parsed;
          }
        }
      }
      // Inner prior fields: sentinel + null coercion
      if (node.prior && typeof node.prior === 'object') {
        const p = node.prior;
        if (p.distribution === null || p.distribution === '') p.distribution = undefined;
        if (p.range_min === null) p.range_min = undefined;
        if (p.range_max === null) p.range_max = undefined;
      }
      return node;
    });
  }

  // Coerce sentinels/nulls in goal_constraints items
  if (Array.isArray(obj.goal_constraints)) {
    obj.goal_constraints = (obj.goal_constraints as any[]).filter((c: any) => {
      if (!c || typeof c !== 'object') return false;
      if (c.constraint_id === null || c.constraint_id === '') c.constraint_id = undefined;
      if (c.operator === null || c.operator === '') c.operator = undefined;
      if (c.value === null) c.value = undefined;
      if (c.label === null || c.label === '') c.label = undefined;
      // Optional string fields: sentinel coercion
      if (c.unit === null || c.unit === '') c.unit = undefined;
      if (c.source_quote === null || c.source_quote === '') c.source_quote = undefined;
      if (c.provenance === null || c.provenance === '') c.provenance = undefined;
      if (c.confidence === null) c.confidence = undefined;
      return typeof c.node_id === 'string'; // drop items without valid node_id
    });
  }

  // Coerce sentinels/nulls in coaching.strengthen_items
  if (obj.coaching && typeof obj.coaching === 'object') {
    const coaching = obj.coaching as Record<string, unknown>;
    if (Array.isArray(coaching.strengthen_items)) {
      coaching.strengthen_items = (coaching.strengthen_items as any[]).map((item: any) => {
        if (!item || typeof item !== 'object') return item;
        if (item.label === null || item.label === '') item.label = undefined;
        if (item.detail === null || item.detail === '') item.detail = undefined;
        return item;
      });
    }
  }

  // Coerce string numbers to numbers for belief/weight on edges, and clamp to valid ranges
  // Also handle V4 format (strength.mean, strength.std, exists_probability)
  if (Array.isArray(obj.edges)) {
    obj.edges = obj.edges.map((edge: unknown) => {
      if (!edge || typeof edge !== 'object') return edge;
      const e = edge as Record<string, unknown>;

      // Coerce required-nullable edge fields (null → undefined)
      if (e.exists_probability === null) e.exists_probability = undefined;
      if (e.effect_direction === null) e.effect_direction = undefined;
      // Optional string fields: sentinel coercion
      if (e.edge_type === null || e.edge_type === '') e.edge_type = undefined;
      if (e.provenance_source === null || e.provenance_source === '') e.provenance_source = undefined;

      // ========================================================================
      // V4 FORMAT HANDLING: strength.mean/std and exists_probability
      // Convert to internal representation (strength_mean, strength_std, belief_exists)
      // while preserving backwards compatibility with legacy weight/belief fields
      // ========================================================================

      let strength_mean: number | undefined = undefined;
      let strength_std: number | undefined = undefined;
      let belief_exists: number | undefined = undefined;

      // Preserve flat V4 fields if already provided
      if (e.strength_mean !== undefined && e.strength_mean !== null) {
        const parsedMean = Number(e.strength_mean);
        if (!Number.isNaN(parsedMean)) {
          strength_mean = parsedMean;
        }
      }

      if (e.strength_std !== undefined && e.strength_std !== null) {
        const parsedStd = Number(e.strength_std);
        if (!Number.isNaN(parsedStd) && parsedStd > 0) {
          strength_std = parsedStd;
        }
      }

      if (e.belief_exists !== undefined && e.belief_exists !== null) {
        const rawBeliefExists = Number(e.belief_exists);
        if (!Number.isNaN(rawBeliefExists)) {
          if (rawBeliefExists < 0 || rawBeliefExists > 1) {
            belief_exists = Math.max(0, Math.min(1, rawBeliefExists));
            log.warn({
              event: 'llm.normalisation.belief_exists_clamped',
              edge_from: e.from,
              edge_to: e.to,
              raw: rawBeliefExists,
              clamped: belief_exists,
            }, `V4 belief_exists ${rawBeliefExists} clamped to ${belief_exists}`);
          } else {
            belief_exists = rawBeliefExists;
          }
        }
      }

      // Handle V4 nested strength object
      // Use Number() coercion to handle string numbers (e.g., "0.7" → 0.7)
      if (strength_mean === undefined && e.strength && typeof e.strength === 'object') {
        const strength = e.strength as { mean?: unknown; std?: unknown };
        const parsedMean = Number(strength.mean);
        if (!Number.isNaN(parsedMean) && strength.mean !== undefined && strength.mean !== null) {
          strength_mean = parsedMean;
          log.debug({
            event: 'llm.normalisation.v4_strength_mean',
            edge_from: e.from,
            edge_to: e.to,
            strength_mean,
            was_string: typeof strength.mean === 'string',
          }, 'V4 strength.mean extracted');
        }
        const parsedStd = Number(strength.std);
        if (strength_std === undefined && !Number.isNaN(parsedStd) && parsedStd > 0) {
          strength_std = parsedStd;
        }
      }

      // Handle V4 exists_probability
      // Use Number() coercion to handle string numbers
      if (belief_exists === undefined && e.exists_probability !== undefined && e.exists_probability !== null) {
        const rawProb = Number(e.exists_probability);
        if (!Number.isNaN(rawProb)) {
          if (rawProb < 0 || rawProb > 1) {
            belief_exists = Math.max(0, Math.min(1, rawProb));
            log.warn({
              event: 'llm.normalisation.exists_probability_clamped',
              edge_from: e.from,
              edge_to: e.to,
              raw: rawProb,
              clamped: belief_exists,
            }, `V4 exists_probability ${rawProb} clamped to ${belief_exists}`);
          } else {
            belief_exists = rawProb;
          }
        }
      }

      // ========================================================================
      // LEGACY FORMAT HANDLING: weight and belief
      // Use as fallback when V4 fields not present
      // ========================================================================

      // Parse and clamp belief to [0, 1] (legacy format)
      let belief: number | undefined = undefined;
      if (e.belief !== undefined && e.belief !== null) {
        const rawBelief = Number(e.belief);
        if (!isNaN(rawBelief)) {
          if (rawBelief < 0 || rawBelief > 1) {
            const clampedBelief = Math.max(0, Math.min(1, rawBelief));
            log.warn({
              event: 'llm.normalisation.belief_clamped',
              edge_from: e.from,
              edge_to: e.to,
              raw_belief: rawBelief,
              clamped_belief: clampedBelief,
            }, `Edge belief value ${rawBelief} clamped to ${clampedBelief}`);
            belief = clampedBelief;
          } else {
            belief = rawBelief;
          }
        }
      }

      // Parse weight (no clamping - can be any number for inverse relationships)
      let weight: number | undefined = undefined;
      if (e.weight !== undefined && e.weight !== null) {
        const rawWeight = Number(e.weight);
        if (!isNaN(rawWeight)) {
          weight = rawWeight;
        }
      }

      // ========================================================================
      // OUTPUT: V4 fields are primary, legacy fields preserved if present
      // Phase 2d: Downstream consumers now read V4 fields directly
      // Legacy fields only populated from original input (not mapped from V4)
      // ========================================================================

      return {
        ...e,
        // V4 fields (primary)
        strength_mean,
        strength_std,
        belief_exists,
        // Legacy fields (only from original input, NOT from V4 mapping)
        // Kept for backwards compatibility with old fixtures/inputs
        weight,
        belief,
      };
    });

    // [DIAGNOSTIC] Temporary: stratified edge field sample after V4 extraction.
    // Samples 1 structural + 1 causal + 1 bridge edge to avoid sampling bias
    // (previous .slice(0,3) always picked structural dec→opt edges without strength).
    // Remove after confirming extraction behaviour on staging.
    if ((obj.edges as any[]).length > 0) {
      const allEdges = (obj.edges as any[]).filter((e: any) => e && typeof e === 'object');
      const sorted = [...allEdges].sort((a: any, b: any) =>
        `${a.from ?? ''}::${a.to ?? ''}`.localeCompare(`${b.from ?? ''}::${b.to ?? ''}`)
      );
      const mapEdge = (e: any) => ({
        from: e.from,
        to: e.to,
        strength_mean: e.strength_mean ?? 'MISSING',
        strength_nested: typeof e.strength === 'object' && e.strength !== null
          ? { mean: e.strength.mean, std: e.strength.std }
          : (e.strength === undefined ? 'UNDEFINED' : `TYPE:${typeof e.strength}`),
        weight: e.weight ?? 'MISSING',
        belief_exists: e.belief_exists ?? 'MISSING',
      });
      // Stratified: 1 structural (dec_/opt_ source), 1 causal (fac_ source), 1 bridge (→goal_ target)
      // Falls back to first sorted edge if no prefixed IDs found
      const structural = sorted.find((e: any) => e.from?.startsWith('dec_') || e.from?.startsWith('opt_'));
      const causal = sorted.find((e: any) => e.from?.startsWith('fac_'));
      const bridge = sorted.find((e: any) => e.to?.startsWith('goal_'));
      const stratified = [structural, causal, bridge].filter(Boolean);
      const diagSample = (stratified.length > 0 ? stratified : sorted.slice(0, 3)).map(mapEdge);

      const withStrengthCount = allEdges.filter((e: any) => e.strength_mean !== undefined).length;
      const withNestedCount = allEdges.filter((e: any) => typeof e.strength === 'object' && e.strength !== null).length;

      log.debug(
        {
          event: 'llm.normalisation.post_extraction_diagnostic',
          edge_count: allEdges.length,
          edges_with_strength_mean: withStrengthCount,
          edges_with_nested_strength: withNestedCount,
          sample_edges: diagSample,
        },
        `[DIAGNOSTIC] Edge fields after V4 extraction: ${withStrengthCount}/${allEdges.length} have strength_mean`,
      );
    }
  }

  // ========================================================================
  // NODE DATA NORMALISATION (single pass):
  //  1. Convert array-form interventions → object-form on option nodes
  //     (Anthropic structured outputs cannot produce Record<K,V>)
  //  2. Strip empty/partial data objects that would fail the Zod NodeData
  //     union (requires value, interventions, or operator)
  // ========================================================================
  if (Array.isArray(obj.nodes)) {
    obj.nodes = (obj.nodes as any[]).map((node: any) => {
      if (!node || typeof node !== 'object') return node;

      // Step 1: Convert array-form interventions on option nodes
      if (node.kind === 'option' && node.data && typeof node.data === 'object') {
        const interventions = node.data.interventions;
        if (Array.isArray(interventions)) {
          const mapped: Record<string, number> = {};
          for (const item of interventions) {
            if (item && typeof item === 'object' && typeof item.factor_id === 'string' && typeof item.value === 'number') {
              mapped[item.factor_id] = item.value;
            }
          }
          if (Object.keys(mapped).length > 0) {
            log.debug({
              event: 'llm.normalisation.interventions_array_to_object',
              node_id: node.id,
              count: Object.keys(mapped).length,
            }, `Converted array-form interventions to object for ${node.id}`);
          }
          node = { ...node, data: { ...node.data, interventions: mapped } };
        }
      }

      // Step 1b: Strip interventions sentinel from non-option nodes.
      // Anthropic structured outputs produces interventions: [] on all nodes due
      // to the flat schema; only option nodes should retain interventions.
      // Without this, the empty array keeps data alive after handleUnreachableFactors
      // deletes data.value, causing Zod NodeData union failures (invalid_union).
      // Uses key-presence ("in") rather than !== undefined so that null-coerced-
      // to-undefined sentinels are also caught.
      if (node.kind !== 'option' && node.data && typeof node.data === 'object' && "interventions" in node.data) {
        const { interventions: _sentinel, ...restData } = node.data;
        node = { ...node, data: Object.keys(restData).length > 0 ? restData : undefined };
      }

      // Step 2: Parse JSON-string encoding_map on factor nodes back to Record<string,string>.
      // The Anthropic structured outputs schema emits encoding_map as a JSON string
      // (additionalProperties:false makes dynamic-key objects impossible in structured outputs).
      if (node.data && typeof node.data === 'object' && typeof node.data.encoding_map === 'string') {
        try {
          const parsed = JSON.parse(node.data.encoding_map);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            node = { ...node, data: { ...node.data, encoding_map: parsed } };
          } else {
            // Valid JSON but wrong shape (array, primitive, null) — drop the field
            const { encoding_map: _dropped, ...restData } = node.data;
            node = { ...node, data: restData };
          }
        } catch {
          // Malformed JSON — drop the field rather than propagating bad data
          const { encoding_map: _dropped, ...restData } = node.data;
          node = { ...node, data: restData };
        }
      }

      // Step 3: Strip data objects that lack a union-discriminating key.
      // Preserve data if it contains factor metadata (factor_type, extractionType,
      // uncertainty_drivers, encoding_map) even when value is absent — the deterministic
      // sweep fills value defaults and these metadata fields must survive.
      const data = node.data;
      if (data && typeof data === 'object') {
        const hasUnionKey = typeof data.value === 'number' || data.interventions || data.operator;
        const hasFactorMetadata = data.factor_type || data.extractionType || data.uncertainty_drivers || data.encoding_map;
        if (!hasUnionKey && !hasFactorMetadata) {
          const { data: _stripped, ...rest } = node;
          log.debug({
            event: 'llm.normalisation.empty_data_stripped',
            node_id: node.id,
            node_kind: node.kind,
            data_keys: Object.keys(data),
          }, `Stripped empty data object from ${node.id} (no value/interventions/operator/factor metadata)`);
          return rest;
        }
      }

      return node;
    });
  }

  if (normalisedCount > 0) {
    log.info({ normalised_count: normalisedCount }, `Normalised ${normalisedCount} non-standard node kind(s)`);
  }

  return obj;
}

/**
 * Ensure all controllable factors have baseline values (data.value).
 *
 * Controllable factors are factors with incoming option→factor edges.
 * When LLM fails to output data.value for a controllable factor,
 * we add a default value of **0.5** with extractionType: "inferred".
 * 0.5 is the neutral midpoint on the 0–1 scale per prompt instructions.
 *
 * Must agree with `fixControllableMissingData()` in deterministic-sweep.ts,
 * which acts as a safety net with the same 0.5 default.
 *
 * This ensures ISL can compute sensitivity analysis.
 *
 * @param response - Draft graph response
 * @returns Response with baseline values ensured on controllable factors
 */
export function ensureControllableFactorBaselines(response: unknown): {
  response: unknown;
  defaultedFactors: string[];
} {
  const defaultedFactors: string[] = [];

  if (!response || typeof response !== 'object') {
    return { response, defaultedFactors };
  }

  const obj = response as Record<string, unknown>;
  const nodes = obj.nodes as Array<Record<string, unknown>> | undefined;
  const edges = obj.edges as Array<Record<string, unknown>> | undefined;

  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    return { response, defaultedFactors };
  }

  // Build set of controllable factor IDs (factors with incoming option→factor edges)
  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) {
    if (typeof node.id === 'string' && typeof node.kind === 'string') {
      nodeKindMap.set(node.id, node.kind);
    }
  }

  const controllableFactorIds = new Set<string>();
  for (const edge of edges) {
    const fromId = edge.from ?? edge.source;
    const toId = edge.to ?? edge.target;
    if (typeof fromId === 'string' && typeof toId === 'string') {
      const fromKind = nodeKindMap.get(fromId);
      const toKind = nodeKindMap.get(toId);
      // option→factor edge makes the factor controllable
      if (fromKind === 'option' && toKind === 'factor') {
        controllableFactorIds.add(toId);
      }
    }
  }

  // For each controllable factor, ensure data.value exists
  const updatedNodes = nodes.map((node) => {
    const nodeId = typeof node.id === 'string' ? node.id : undefined;
    const nodeKind = typeof node.kind === 'string' ? node.kind : undefined;

    if (!nodeId || nodeKind !== 'factor' || !controllableFactorIds.has(nodeId)) {
      return node;
    }

    // Check if node already has data.value (coerce string → number if needed)
    const data = node.data as Record<string, unknown> | undefined;
    if (data && typeof data.value === 'string') {
      const parsed = Number(data.value);
      if (!Number.isNaN(parsed)) {
        // Return a new node with coerced value — avoid mutating the input
        return { ...node, data: { ...data, value: parsed } };
      }
    }
    if (data && typeof data.value === 'number') {
      return node; // Already has value
    }

    // Add default baseline value.
    // 0.5 is the neutral midpoint on the 0–1 scale, matching prompt instructions
    // ("Unknown baseline: 0.5 with extractionType: inferred") and the safety-net
    // default in fixControllableMissingData() (deterministic-sweep.ts).
    defaultedFactors.push(nodeId);
    log.info({
      event: 'llm.normalisation.factor_baseline_defaulted',
      factor_id: nodeId,
      default_value: 0.5,
      extraction_type: 'inferred',
    }, `Controllable factor ${nodeId} missing data.value, defaulting to 0.5`);

    const existingType = data?.extractionType;
    return {
      ...node,
      data: {
        // ⭐ STAMPED, NOT LEFT TO BE GUESSED (quantities lane, 2026-08-18).
        // This 0.5 carries no information, and the ONE place that knows it is
        // right here. Downstream readers previously had to recover the fact
        // from the magnitude (`value === 0.5`), which misreads a genuinely
        // stated 0.5 as an invention and vice versa — CLAUDE.md trap 19. The
        // stamp is what stops `unreachable-factors` narrowing this into a
        // prior range that reads as a measurement.
        ...stampFallbackDefault(data || {}),
        value: 0.5,
        // Preserve LLM-emitted extractionType if present; only default when
        // truly absent — matches the guard in fixControllableMissingData().
        extractionType: existingType ?? 'inferred',
      },
    };
  });

  if (defaultedFactors.length > 0) {
    emit(TelemetryEvents.FactorBaselineDefaulted, {
      defaulted_count: defaultedFactors.length,
      factor_ids: defaultedFactors,
    });
  }

  return {
    response: { ...obj, nodes: updatedNodes },
    defaultedFactors,
  };
}
