/**
 * Schema V3 Transformer
 *
 * Transforms CEE draft-graph responses to v3.0 schema format.
 *
 * V3 Key Changes:
 * - Options are separate from graph nodes (top-level options[] array)
 * - Options include interventions mapping to factor nodes
 * - Options have status: 'ready' | 'needs_user_mapping'
 * - goal_node_id is required at top level
 * - Edge strength uses nested strength: { mean, std } + exists_probability (canonical v2.2)
 */

import type {
  CEEGraphResponseV3T,
  NodeV3T,
  EdgeV3T,
  OptionV3T,
  GraphV3T,
  ValidationWarningV3T,
} from "../../schemas/cee-v3.js";
import { deriveEffectDirection } from "../../schemas/cee-v3.js";
import { deriveStrengthStd, type ProvenanceObject } from "./strength-derivation.js";
import type { V1DraftGraphResponse, V1Node, V1Edge, V1Graph } from "./schema-v2.js";
import { isFactorData, isOptionData } from "./schema-v2.js";
import { readIsBaseline } from "../baseline-identity.js";
import {
  deriveCorroboratingRawValue,
  findUncorroboratedCapFactorIds,
} from "./observed-state-cap-corroboration.js";
import {
  extractOptionsFromNodes,
  toOptionsV3,
  getExtractionStatistics,
  hasPriceRelatedUnresolvedTargets,
  type EdgeHint,
  type ExtractedOption,
} from "../extraction/intervention-extractor.js";
import { normalizeToId } from "../utils/id-normalizer.js";
import { PriorDistribution, isKnownPriorDistribution } from "../../schemas/graph.js";
import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";
import { validateV3Response } from "../validation/v3-validator.js";
import { config } from "../../config/index.js";
import type { AnalysisReadyPayloadT } from "../../schemas/analysis-ready.js";
import { buildAnalysisReadyPayload, validateAndLogAnalysisReady } from "./analysis-ready.js";
import { runIntegrityChecks, detectStrengthDefaults, detectStrengthMeanDominant } from "../validation/integrity-sentinel.js";
import { DEFAULT_STRENGTH_MEAN, EDGE_STRENGTH_LOW_THRESHOLD, EDGE_STRENGTH_NEGLIGIBLE_THRESHOLD } from "../constants.js";
import { CIL_WARNING_CODES, DEFAULT_EXISTS_PROBABILITY } from "@talchain/schemas";
import { classifyEdgeByKind } from "../utils/structural-edge-classifier.js";
import { synthesiseDisplayValue, synthesiseRangeDisplayValue } from "../factor-extraction/display-value.js";
import { assertsBriefExtraction } from "../factor-extraction/brief-extraction-claim.js";
import { nodeProvenanceDisplay, edgeProvenanceDisplay } from "./provenance-display.js";
import { mayClaimFromBrief } from "../provenance/factor-value-provenance.js";
// ⭐ THE SAME AUTHORITY THE PROJECTOR BINDS STATED ITEMS WITH. Imported, never
// restated — `nodes[].provenance` and `options[].provenance.source` describe one
// fact and must not be able to disagree about it (trap 12).
import { bindOptionLabelToBrief, bindingEarnsBriefClaim } from "../provenance/brief-binding.js";
import {
  mergeRephrasedOptions,
  type RephraseMergeResult,
} from "./option-rephrase-merge.js";
import { detectUnreconciledStatedMagnitudes } from "../provenance/money-invariant.js";

// ============================================================================
// V3 Types
// ============================================================================

/**
 * V3 draft-graph response.
 */
export interface V3DraftGraphResponse extends CEEGraphResponseV3T {
  /** Additional fields from V1 response */
  quality?: {
    overall: number;
    structure?: number;
    coverage?: number;
    structural_proxy?: number;
    safety?: number;
  };
  draft_warnings?: Array<{
    id: string;
    severity: string;
    node_ids?: string[];
    edge_ids?: string[];
    affected_node_ids: string[];
    affected_edge_ids: string[];
    explanation?: string;
    fix_hint?: string;
  }>;
  /** P0: Ready-to-use analysis payload for direct PLoT consumption */
  analysis_ready: AnalysisReadyPayloadT;
}

/**
 * Context for V3 transformation.
 */
export interface V3TransformContext {
  /** Original brief text for extraction */
  brief?: string;
  /** Request ID for tracing */
  requestId?: string;
  /** Correlation ID for tracing */
  correlationId?: string;
  /** Enable strict validation mode */
  strictMode?: boolean;
  /**
   * CIL Phase 0.1: Enable sentinel integrity checks in the response.
   * Should be true when debug bundle capture is active (include_debug=true
   * or observabilityEnabled). This ensures sentinel output lands in bundles.
   */
  includeDebug?: boolean;
}

// ============================================================================
// Node Kind Mapping
// ============================================================================

/** V3 valid node kinds (option is included for graph connectivity) */
const V3_VALID_KINDS = new Set(["goal", "factor", "outcome", "decision", "risk", "action", "option"]);

/** Node kinds whose value-free labels may earn a brief-bound provenance claim. */
const LABEL_BOUND_PROVENANCE_KINDS: ReadonlySet<string> = new Set([
  "goal",
  "risk",
  "outcome",
  "decision",
]);

/**
 * Resolve an option's baseline flag from its two accepted V1 carriers.
 *
 * The terminal response and the staged graph both consume this function. The
 * truth table itself remains owned by `readIsBaseline`; this wrapper only
 * prevents the two projection sites from presenting different option identity.
 */
function resolveOptionIsBaseline(node: V1Node): boolean | undefined {
  const dataBaseline = isOptionData(node.data) ? node.data.is_baseline : undefined;
  const nodeBaseline = (node as V1Node & { is_baseline?: boolean }).is_baseline;
  return readIsBaseline({
    is_baseline: nodeBaseline,
    data: { is_baseline: dataBaseline },
  });
}

/**
 * Map V1 node kind to V3 kind.
 * Options remain in graph for connectivity; also extracted to options[] array.
 */
function mapKindToV3(kind: string): NodeV3T["kind"] {
  // "constraint" is normalised to "risk" in adapter normalisation (normalisation.ts:45).
  // This function should never see "constraint" under normal flow, but if it does
  // (e.g. rawOutput re-processing), align with the adapter mapping.
  if (kind === "constraint") {
    return "risk";
  }
  // decision, action, goal, factor, outcome, risk, option are all valid V3 kinds
  if (V3_VALID_KINDS.has(kind)) {
    return kind as NodeV3T["kind"];
  }
  log.warn({ kind, defaultedTo: "factor" }, `Unknown node kind "${kind}", defaulting to "factor"`);
  return "factor";
}

// ============================================================================
// Label Cleaning
// ============================================================================

/**
 * Normalisation annotations injected by the LLM into factor labels.
 * Stripped at the V3 boundary so the UI receives clean display labels.
 *
 * LABEL_NORMALISATION_RE matches patterns that start with `(0` + separator
 * AND contain normalisation-specific tokens (scale, normali[sz]ed, share,
 * cap, proportion, ratio, index, score, bounded, capped) or are exactly
 * a bare range like `(0–1)`, `(0/1)`, `(0-1)`.
 *
 * LABEL_SCALE_RE matches `(normalised)`, `(normalized)`, `(scale 0 to 1)` etc.
 *
 * Legitimate parentheticals like `(0-100 range)`, `(Q4)`, `(UK)` survive.
 */
const LABEL_NORMALISATION_RE = /\s*\(0[–\-/]1(?:\s*(?:,\s*)?(?:scale|normali[sz]ed|share|cap|proportion|ratio|index|score|bounded|capped)[^)]*|)\)\s*/gi;
const LABEL_SCALE_RE = /\s*\((normali[sz]ed|scale\s+\d[^)]*)\)\s*/gi;

export interface LabelCleaningEntry {
  node_id: string;
  original: string;
  cleaned: string;
}

/**
 * Strip normalisation annotations from a node label.
 * Returns the cleaned label and, if stripping occurred, the before/after pair.
 */
export function cleanNodeLabel(
  nodeId: string,
  rawLabel: string,
): { label: string; entry: LabelCleaningEntry | null } {
  let cleaned = rawLabel.replace(LABEL_NORMALISATION_RE, " ").trim();
  cleaned = cleaned.replace(LABEL_SCALE_RE, " ").trim();

  // Collapse any double internal whitespace left after stripping
  cleaned = cleaned.replace(/\s{2,}/g, " ");

  // Guard: never produce an empty label
  if (cleaned.length === 0) cleaned = rawLabel;

  if (cleaned !== rawLabel) {
    return { label: cleaned, entry: { node_id: nodeId, original: rawLabel, cleaned } };
  }
  return { label: rawLabel, entry: null };
}

// ============================================================================
// Node Transformation
// ============================================================================

/**
 * Transform a V1 node to V3 format.
 *
 * @param labelCleaningTrace - Optional array; cleaning entries are pushed when annotations are stripped.
 */
export function transformNodeToV3(
  node: V1Node,
  existingIds: Set<string> = new Set(),
  labelCleaningTrace?: LabelCleaningEntry[],
): NodeV3T {
  const id = normalizeToId(node.id, existingIds);
  existingIds.add(id);

  const rawLabel = node.label ?? node.id;
  const { label: cleanedLabel, entry: cleaningEntry } = cleanNodeLabel(id, rawLabel);
  if (cleaningEntry && labelCleaningTrace) {
    labelCleaningTrace.push(cleaningEntry);
  }

  const v3Node: NodeV3T = {
    id,
    kind: mapKindToV3(node.kind),
    label: cleanedLabel,
    description: node.body,
    // Preserve category field (V12.4+) for factor nodes
    category: node.category,
    // Preserve goal threshold fields (V14+) for goal nodes.
    // Use != null (not !== undefined) to exclude both null and undefined —
    // internal schema accepts nullable values from LLM, but V3 output must not contain nulls.
    ...(node.goal_threshold != null && { goal_threshold: node.goal_threshold }),
    ...(node.goal_threshold_raw != null && { goal_threshold_raw: node.goal_threshold_raw }),
    ...(node.goal_threshold_unit != null && { goal_threshold_unit: node.goal_threshold_unit }),
    ...(node.goal_threshold_cap != null && { goal_threshold_cap: node.goal_threshold_cap }),
    // ROADMAP 2.258 — the frame rides across the V1→V3 transform with its
    // threshold. This copy is REQUIRED, not decorative: the transform rebuilds
    // the node field-by-field, so a `goal_threshold_frame` minted on the V1
    // draft graph is dropped here unless it is named. Carried only when the
    // threshold itself is present, so the frame can never travel without the
    // number it describes.
    ...(node.goal_threshold != null &&
      node.goal_threshold_frame != null && {
        goal_threshold_frame: node.goal_threshold_frame,
      }),
  };

  // Transform data to observed_state.
  // OptionData (with interventions) is handled separately in options extraction.
  //
  // ⚠ ORDER IS LOAD-BEARING (ROADMAP 2.294): the goal limb is checked FIRST.
  // This gate originally led with the factor-data branch, on the 2.273
  // assumption that a goal node never carries `data` — FALSE on live drafts.
  // The third 2.258 witness (witness-2258-goal-probability-THIRD.md §3.2, CEE
  // 33c10e52) caught the model authoring `data.value = 0.667` on the goal, so
  // the data branch shadowed the goal limb — the ONLY projection of
  // `goal_baseline` into `observed_state.baseline` — the minted 0.5333…
  // baseline died here, and ISL refused with `missing_goal_baseline`. A
  // baseline-bearing goal must take the goal limb regardless of model-authored
  // `data`. (Stripping `data` off goal nodes generally is NOT this gate's job —
  // that belongs to the 2.286 server-owned attestation object.)
  if (node.kind === "goal" && node.goal_baseline != null) {
    // ROADMAP 2.273 — THE GOAL LIMB of this gate. The factor-data branch below
    // builds `observed_state` only from `data`; before this limb existed a
    // goal without factor-shaped data reached the wire with a threshold and a
    // frame but no `observed_state` AT ALL — ISL's stronger refusal limb
    // (`observed_state_present=False`, `missing_goal_baseline`), pinned by the
    // 2.258 characterisation test that PR retired.
    //
    // ⚠ `value` IS REQUIRED, and it is NOT a second measurement. ISL's
    // `ObservedState.value` is a required Pydantic field
    // (`robustness_v2.py:171`, `Field(...)`) and so is `ObservedStateV3.value`
    // here, so a baseline-only observed_state cannot reach ISL — it would be
    // rejected before the conversion it exists to enable. Both fields
    // therefore carry the SAME single extracted number: the goal metric's
    // current observed level. That is exactly what each field is documented to
    // mean (`value` = "current observed value"; `baseline` = "reference for
    // change-from-baseline"), and at draft time — before any option is
    // applied — they genuinely coincide. Nothing is invented to fill `value`.
    //
    // KNOWN, ACCEPTED CONSEQUENCES — both disclosed rather than discovered
    // later (adversarial review, PR #787):
    //
    // 1. NON-ROOT goal (the normal case): ISL emits
    //    `GOAL_OBSERVED_VALUE_UNUSED` (robustness_analyzer_v2.py:2735-2754)
    //    telling us `value` is not used as a base under doctrine B. Correct
    //    and harmless — `baseline`, the field the conversion actually reads,
    //    is the one we are here to deliver. Ruled non-blocking (info
    //    severity, no wrong number); ISL-side suppression is rowed as 2.279.
    //
    // 2. ROOT goal (a goal with no parents): ISL DOES consult
    //    `observed_state.value` as the node's base (:1158-1166, :2686), so
    //    stamping it shifts that goal's sample base from 0.0 to B. The shift
    //    is UNIFORM ACROSS OPTIONS — it moves every option's samples by the
    //    same constant — so comparative verdicts (which option leads, by how
    //    much) are unchanged. Goal PROBABILITY is unaffected for a different
    //    reason: a root goal is refused outright at :3182 (`root_goal`,
    //    "takes its base from observed_state.value, so its samples are not in
    //    the non-root change-from-origin frame"), so no probability is
    //    rendered either way. What DOES change is the absolute level of a root
    //    goal's reported samples and `GOAL_NODE_ROOT_STATIC.base_value` —
    //    arguably more correct (0.0 was a placeholder for "no observed
    //    value"), but a change, and named here so it is not mistaken for a
    //    regression.
    v3Node.observed_state = {
      value: node.goal_baseline,
      baseline: node.goal_baseline,
      ...(node.goal_threshold_unit != null && { unit: node.goal_threshold_unit }),
      source: "brief_extraction",
      ...(node.goal_baseline_raw != null && { raw_value: node.goal_baseline_raw }),
      ...(node.goal_threshold_cap != null && { cap: node.goal_threshold_cap }),
    };
  } else if (isFactorData(node.data) && node.data.value !== undefined) {
    // Map extractionType to V3 source format
    const source: "brief_extraction" | "cee_inference" =
      node.data.extractionType === "inferred" ? "cee_inference" : "brief_extraction";

    // ⭐ A WRITTEN `cap` MUST SHIP WITH THE `raw_value` THAT CORROBORATES IT.
    //
    // The model is taught to emit the triple (`data: {value: 0.6, raw_value:
    // 30000, unit: "£", cap: 50000}` — defaults-v187.ts:548), but `raw_value`
    // is an OPTIONAL grammar slot and drafts drop it. The pass-through below
    // then emits `{value: 0.6, cap: 150000}` with no corroboration, and such a
    // factor cannot PROVE its scale convention: `buildFactorScaleMap` grants
    // `normalisedConvention` only on a self-consistent pair, so
    // `resolveRawInterventionValue` returns `ambiguous_no_evidence` and
    // refuses to denormalise. That refusal is CORRECT — PLoT divides
    // intervention values by `observed_state.cap`, so 0.6 against cap 150,000
    // reaches ISL as ~0.000004 — and it is deliberately NOT weakened.
    //
    // The cost lands on the analysable-option gate, which can only HOLD a
    // status-quo option at factors whose observed values are provable: a
    // status quo all of whose factors are unprovable is EXCLUDED rather than
    // held, and below two options the whole run refuses.
    //
    // So the producer is fixed instead. Derivation is bounded to the domain the
    // CONSUMER can actually accept as evidence (see
    // `deriveCorroboratingRawValue`) and invents nothing outside it — an absent
    // `raw_value` that keeps a factor honestly unprovable beats a fabricated one
    // that launders the corruption the rule exists to stop.
    const derivedRawValue = deriveCorroboratingRawValue(
      node.data.value,
      node.data.cap,
      node.data.raw_value,
      node.data.unit,
    );

    v3Node.observed_state = {
      value: node.data.value,
      baseline: node.data.baseline,
      unit: node.data.unit,
      source,
      // Pass through factor metadata fields
      ...(node.data.raw_value !== undefined && { raw_value: node.data.raw_value }),
      ...(derivedRawValue !== undefined && { raw_value: derivedRawValue }),
      ...(node.data.cap !== undefined && { cap: node.data.cap }),
      ...(node.data.extractionType !== undefined && { extractionType: node.data.extractionType }),
      ...(node.data.factor_type !== undefined && { factor_type: node.data.factor_type }),
      ...(node.data.uncertainty_drivers !== undefined && { uncertainty_drivers: node.data.uncertainty_drivers }),
    };
  } else if (isFactorData(node.data)) {
    // Controllable factors without value: preserve factor_type and uncertainty_drivers
    // directly on the node. Required by PLoT's graph validator —
    // stripping them causes CONTROLLABLE_MISSING_DATA errors.
    if (node.data.factor_type !== undefined) {
      v3Node.factor_type = node.data.factor_type;
    }
    if (node.data.uncertainty_drivers !== undefined) {
      v3Node.uncertainty_drivers = node.data.uncertainty_drivers;
    }
  }

  // Preserve prior distribution data for external factors.
  // prior is set by the LLM (via Anthropic schema) or synthesised by unreachable-factors
  // repair. ISL needs prior ranges to run Monte Carlo sampling on external factors.
  const nodePrior = (node as any).prior;
  if (nodePrior && typeof nodePrior === "object") {
    // ⭐ PROMPT/GRAMMAR DRIFT ALARM (F4, /code-review 2026-07-25).
    //
    // `PriorDistribution` (schemas/graph.ts) is a ONE-MEMBER enum in the SENT
    // draft grammar, and its only justification is that the PMS-served
    // `draft_graph` prompt promises `distribution` is always "uniform". That
    // prompt is re-pinnable WITHOUT a CEE deploy, and the actual validator
    // (`cee-v3.ts`) types the field as `z.string()` — free text. So the
    // grammar's claim that "the grammar and the validator cannot disagree" is
    // FALSE for this one field, and nothing in this repo can prove otherwise at
    // build time.
    //
    // Without this, a prompt that taught a second family would drift silently:
    // on the structured path the grammar would force "uniform" and the prior
    // would be MISLABELLED downstream rather than rejected; on the prompt-only
    // fallback (no grammar) the new value would pass through untouched. Both
    // read as green. So the alarm is a RUNTIME one, at the boundary where a real
    // value arrives, and it is LOUD rather than assume-good.
    if (!isKnownPriorDistribution((nodePrior as any).distribution)) {
      log.error({
        event: "cee.draft.prior_distribution_drift",
        node_id: v3Node.id,
        observed_distribution: (nodePrior as any).distribution,
        grammar_distributions: [...PriorDistribution.options],
      }, "[V3] prior.distribution is OUTSIDE the value set the sent draft grammar can express — the served draft_graph prompt and PriorDistribution (schemas/graph.ts) have drifted apart. Add the family to PriorDistribution, or re-pin the prompt. The value is passed through unchanged: a prompt decision must not 400 live drafts.");
    }
    v3Node.prior = nodePrior;
  }

  // Preserve node-level factor metadata for external factors.
  // The repair stages (deterministic-sweep, unreachable-factors) promote factor_type,
  // extractionType, and uncertainty_drivers from data to node level when stripping
  // data.value from external factors. Pick them up here so they reach the V3 output.
  const anyNode = node as any;
  if (anyNode.factor_type !== undefined && v3Node.factor_type === undefined) {
    v3Node.factor_type = anyNode.factor_type;
  }
  if (anyNode.extractionType !== undefined && v3Node.extractionType === undefined) {
    v3Node.extractionType = anyNode.extractionType;
  }
  if (anyNode.uncertainty_drivers !== undefined && v3Node.uncertainty_drivers === undefined) {
    v3Node.uncertainty_drivers = anyNode.uncertainty_drivers;
  }

  // Preserve intercept as a top-level node field (v191+).
  // intercept is the prior mean for root nodes in ISL inference. It's set by
  // the LLM on node-level (not inside data), so it survives data deletion
  // during reclassification. Must be explicitly forwarded since transformNodeToV3
  // constructs a fresh object (passthrough only preserves fields already on it).
  // graph-data-integrity.ts auto-populates from observed_state.value if absent,
  // but only for root nodes — explicit forwarding ensures LLM-provided intercepts
  // on non-root nodes also survive.
  // Kind-constrained to match INTERCEPT_ELIGIBLE_KINDS in graph-data-integrity.ts.
  const interceptEligible = v3Node.kind === 'factor' || v3Node.kind === 'outcome'
    || v3Node.kind === 'risk' || v3Node.kind === 'goal';
  if (interceptEligible && anyNode.intercept != null && typeof anyNode.intercept === 'number') {
    v3Node.intercept = anyNode.intercept;
    log.debug({ event: 'cee.v3_transform.intercept_forwarded', node_id: id, value: anyNode.intercept }, 'cee.v3_transform.intercept_forwarded');
  }

  // Preserve encoding_map as a top-level node field (v191+).
  // encoding_map describes label encoding (e.g. "0=Developers, 1=Tech Lead"), not
  // observed state, so it lives at node level rather than inside observed_state.
  // Two sources: node.data (controllable/observable factors that still have their data
  // object) or node-level (external factors whose data was deleted by repair stages,
  // which promoted encoding_map alongside factor_type/extractionType/uncertainty_drivers).
  const dataEncodingMap = isFactorData(node.data) ? (node.data as any).encoding_map : undefined;
  const nodeEncodingMap = anyNode.encoding_map;
  const resolvedEncodingMap = dataEncodingMap ?? nodeEncodingMap;
  if (resolvedEncodingMap !== undefined) {
    v3Node.encoding_map = resolvedEncodingMap;
  }

  // Preserve display_value as a top-level node field (v191+).
  // Human-readable value string (e.g. "£40,000", "18 months") for UI rendering.
  // Source: node.data.display_value (all factor kinds that still carry a data object).
  // Only defined when the LLM produced a non-null value.
  const dataDisplayValue = isFactorData(node.data) ? (node.data as any).display_value : undefined;
  if (dataDisplayValue !== undefined) {
    v3Node.display_value = dataDisplayValue;
  }

  // Synthesise display_value for factors that lack an LLM-provided value.
  //
  // Path A (external factors): use prior range via synthesiseRangeDisplayValue.
  // Path B (controllable/observable factors): use observed_state fields via
  //   synthesiseDisplayValue. E.g. value=6, unit="developers" → "6 developers".
  if (v3Node.display_value === undefined && v3Node.kind === "factor") {
    if ((node as any).category === "external" && v3Node.prior) {
      // Path A: external factor — synthesise from prior range
      const priorUnit = anyNode.unit ?? (isFactorData(node.data) ? (node.data as any).unit : undefined);
      const synthesised = synthesiseRangeDisplayValue(
        v3Node.prior,
        priorUnit,
        v3Node.factor_type,
      );
      if (synthesised !== undefined) {
        v3Node.display_value = synthesised;
      }
    } else if (v3Node.observed_state) {
      // Path B: controllable/observable factor — synthesise from observed_state
      const os = v3Node.observed_state;
      const synthesised = synthesiseDisplayValue({
        value: os.value,
        raw_value: os.raw_value,
        unit: os.unit,
        factor_type: os.factor_type ?? v3Node.factor_type,
      });
      if (synthesised !== undefined) {
        v3Node.display_value = synthesised;
      }
    }
  }

  // UI provenance display. Read extractionType from whichever location holds
  // it on this node — observed_state (factor with value), node-level
  // (external/repaired factors), or data (factor without observed_state).
  // Decisions/options/goals fall through to the ai_inferred default.
  const dataExtractionType = isFactorData(node.data) ? node.data.extractionType : undefined;
  const extractionTypeForDisplay =
    v3Node.observed_state?.extractionType
    ?? v3Node.extractionType
    ?? dataExtractionType;
  const claimedProvenance = nodeProvenanceDisplay(extractionTypeForDisplay);

  // ROADMAP 2.972 — A VALUE-FREE NODE CANNOT HAVE COME FROM THE BRIEF.
  //
  // MEASURED 2026-08-08 on deployed staging: `fac_nrr` shipped
  // `extractionType: "explicit", provenance: "from_brief"` carrying only a
  // maximum-ignorance prior U(0,1) and no value at all — while
  // `factor_value_coverage` in the SAME payload reported `explicit: 0`. The
  // analysis then named NRR the strongest driver and the evidence card asked
  // the user to go and collect the number they had already stated. The false
  // label is the part that inverts the product's meaning, so the label is what
  // goes — the prior, the label text and every computed field are untouched.
  //
  // The verdict comes from `classifyFactorValueTier`, the SAME function
  // `factor_value_coverage` now uses, so the badge a user sees and the number
  // the pipeline reports about itself cannot disagree again (trap 12: the two
  // were separate readers of separate field locations, which is exactly how
  // they drifted).
  const briefClaimEarned = mayClaimFromBrief({
    observed_state: v3Node.observed_state,
    extractionType: v3Node.extractionType,
    data: node.data,
  });
  if (claimedProvenance === "from_brief" && !briefClaimEarned) {
    v3Node.provenance = "ai_inferred";
    // Withdraw the contradicting structural label too, or the wire still
    // carries the claim one field to the left of the one we corrected.
    // `extractionType` is NOT in `computeAnalysisAffectingGraphHash`'s node
    // whitelist (graph-hash.ts), so no analysis input, freshness verdict or
    // computed number moves with it.
    if (v3Node.extractionType === "explicit" || v3Node.extractionType === "observed") {
      v3Node.extractionType = "inferred";
    }
    if (
      v3Node.observed_state?.extractionType === "explicit" ||
      v3Node.observed_state?.extractionType === "observed"
    ) {
      v3Node.observed_state = { ...v3Node.observed_state, extractionType: "inferred" };
    }
  } else {
    v3Node.provenance = claimedProvenance;
  }

  // ⭐⭐ ROW 2.1207 — THE CLAIM HAD A **THIRD** CARRIER, AND NOTHING WITHDREW IT.
  //
  // The block directly above withdraws a false brief claim from TWO fields, and
  // its own comment names the reason: *"or the wire still carries the claim one
  // field to the left of the one we corrected."* There is a third field, and it
  // is the one a user actually reads.
  //
  // MEASURED (closing witness 14 Aug, `captures-run/captures/P3/
  // committed-graph.json`, node `19d5a529`) against a brief stating £120,000:
  //
  //     provenance:          "ai_inferred"                      ← honest
  //     extractionType:      "inferred"                         ← honest
  //     uncertainty_drivers: ["Extracted from brief — confirm value"]  ← FALSE
  //     display_value:       "£0.2 to £0.6"
  //
  // The two structural fields told the truth and the human-readable sentence
  // told the user their number had been extracted from their brief. That string
  // is CEE-authored and passed straight through — the closing witness's own copy
  // sweep confirmed it is not a UI literal (`GRAPH-CARRIER-READER-DERIVATION.md`
  // :139-153, with contrast controls). So the lie was ours, and of the three
  // carriers on the NODE it was the only one written in English.
  //
  // ⚠ CORRECTED AT REVIEW: an earlier draft of this sentence said "the only
  // carrier written in English" without the node qualifier, and that was an
  // overclaim — there is a FOURTH carrier, on EDGE `provenance.quote`, which
  // this withdrawal does not reach (separately rowed). A count is a claim about
  // a scope; state the scope or the count is wrong.
  //
  // ── THE INVARIANT, AGAINST THE SPEC RATHER THAN THE WITNESSED CASE ────────
  // `provenance` IS this response's answer to "did this come from the brief".
  // A prose driver asserting brief extraction is a SECOND carrier of that same
  // fact, and two carriers of one fact must not be able to disagree (trap 12).
  // So the marker survives exactly when the authority says `from_brief`, and is
  // dropped otherwise — no parsing of the display string, no second predicate
  // over the brief, no new magnitude alphabet.
  //
  // Note the direction: the VALUE is untouched and only the CLAIM is withdrawn.
  // Where the number cannot be made faithful, the honest move is to stop
  // attributing it to the user — not to invent one that matches.
  //
  // ⚠ THE PREDICATE AND THE PRODUCERS SHARE ONE CONSTANT (`brief-extraction-
  // claim.ts`). They used to spell the literal independently, which is trap 12
  // with a user-facing lie as the failure mode: reword the producer — an em-dash
  // to a hyphen, a capital to a lower case — and this guard silently stops
  // matching while every test spelling the old literal stays green.
  //
  // ⚠ AND IT IS NOT THE ONLY CARRIER. The claim also rides EDGE
  // `provenance.quote` (`enricher.ts:457/:1145` → wire at `schema-v3.ts:811-814`),
  // which this node-level withdrawal does not reach. Separately rowed, and
  // mitigated by those edges carrying an honest `source: "hypothesis"` beside
  // the claim — but the earlier version of this comment called `uncertainty_
  // drivers` "the only carrier written in English", and that was wrong.
  if (v3Node.provenance !== "from_brief" && Array.isArray(v3Node.uncertainty_drivers)) {
    const kept = v3Node.uncertainty_drivers.filter((d) => !assertsBriefExtraction(d));
    if (kept.length !== v3Node.uncertainty_drivers.length) {
      // An empty list is dropped rather than shipped: `uncertainty_drivers: []`
      // reads as "we looked and found none", which is a different and equally
      // unearned claim from "we are not telling you anything here".
      if (kept.length > 0) {
        v3Node.uncertainty_drivers = kept;
      } else {
        delete (v3Node as { uncertainty_drivers?: unknown }).uncertainty_drivers;
      }
    }
  }

  return v3Node;
}

// ============================================================================
// Edge Transformation
// ============================================================================

// ============================================================================
// Edge Strength Bounds (P1-CEE-2)
// ============================================================================

/** Min/Max bounds for strength_mean coefficient */
// Canonical strength range: [-1, +1] (standardised coefficients)
const STRENGTH_MEAN_MIN = -1;
const STRENGTH_MEAN_MAX = 1;

/** Minimum floor for strength_std */
const STRENGTH_STD_FLOOR = 1e-6;

/**
 * Clamp strength_mean to valid range and emit telemetry if clamped.
 */
function clampStrengthMean(
  value: number,
  edgeFrom: string,
  edgeTo: string
): { clamped: number; wasClamped: boolean } {
  if (value < STRENGTH_MEAN_MIN) {
    log.info(
      { edgeFrom, edgeTo, original: value, clamped: STRENGTH_MEAN_MIN },
      "Clamped strength_mean below minimum"
    );
    return { clamped: STRENGTH_MEAN_MIN, wasClamped: true };
  }
  if (value > STRENGTH_MEAN_MAX) {
    log.info(
      { edgeFrom, edgeTo, original: value, clamped: STRENGTH_MEAN_MAX },
      "Clamped strength_mean above maximum"
    );
    return { clamped: STRENGTH_MEAN_MAX, wasClamped: true };
  }
  return { clamped: value, wasClamped: false };
}

/**
 * Apply bounds to strength_std:
 * - Floor at 1e-6 (must be > 0)
 * - Cap at max(0.5, 2×|mean|)
 */
function boundStrengthStd(
  std: number,
  strengthMean: number,
  edgeFrom: string,
  edgeTo: string
): number {
  // Floor at 1e-6
  let bounded = Math.max(STRENGTH_STD_FLOOR, std);

  // Cap at max(0.5, 2×|mean|)
  const cap = Math.max(0.5, 2 * Math.abs(strengthMean));
  if (bounded > cap) {
    log.debug(
      { edgeFrom, edgeTo, original: std, capped: cap },
      "Capped strength_std to max bound"
    );
    bounded = cap;
  }

  return bounded;
}

/**
 * Classify a V1 edge as structural or causal based on the from/to node kinds.
 * Structural edges (decision→option, option→factor) have hard
 * exists_probability = 1.0 because they are definitional, not probabilistic.
 */
/**
 * Classify an edge as structural or causal by resolving endpoint kinds from nodes.
 * Delegates to the shared classifier — only decision→option and option→factor
 * are structural. Forbidden patterns (option→outcome, etc.) stay visible.
 */
function classifyEdge(
  fromId: string,
  toId: string,
  nodes: V1Node[],
): "structural" | "causal" {
  let fromKind: string | undefined;
  let toKind: string | undefined;
  for (const n of nodes) {
    if (n.id === fromId) fromKind = n.kind;
    if (n.id === toId) toKind = n.kind;
    if (fromKind && toKind) break;
  }
  return classifyEdgeByKind(fromKind, toKind, { edgeFrom: fromId, edgeTo: toId });
}

/**
 * Default exists_probability when neither belief_exists nor belief is present on the edge.
 *
 * - Structural edges (decision→option, option→factor): 1.0 — definitional connections.
 * - Causal edges: DEFAULT_EXISTS_PROBABILITY (0.8) — matches PLoT's normaliser default, making the assumption explicit
 *   in CEE's output so PLoT receives an intentional value rather than an unset field.
 *
 * If the LLM explicitly emitted belief_exists or belief, that value is used as-is
 * (subject only to the boundary repair for structural < 1.0).
 */
const STRUCTURAL_EXISTS_PROBABILITY_DEFAULT = 1.0;
const CAUSAL_EXISTS_PROBABILITY_DEFAULT = DEFAULT_EXISTS_PROBABILITY;

/** Record of a single default applied during V3 edge transform. */
export interface TransformDefaultRecord {
  edge_id: string;
  field: string;
  default_value: number | string;
  reason: string;
}

/** Result of transforming a V1 edge to V3, including any defaults applied. */
export interface EdgeTransformResult {
  edge: EdgeV3T;
  defaults: TransformDefaultRecord[];
}

/**
 * Transform a V1 edge to V3 format.
 *
 * V3 Changes:
 * - weight → strength_mean (can be negative for negative effects)
 * - Uses signed coefficient model: range [-1, +1]
 * - effect_direction derived from strength_mean sign
 * - strength_std: floor 1e-6, cap max(0.5, 2×|mean|)
 * - exists_probability: LLM value if present; else 1.0 for structural, DEFAULT_EXISTS_PROBABILITY for causal
 */
export function transformEdgeToV3(
  edge: V1Edge,
  _index: number,
  _nodes: V1Node[]
): EdgeTransformResult {
  const defaults: TransformDefaultRecord[] = [];
  const edgeId = `${edge.from}->${edge.to}`;
  // V4 fields take precedence, fallback to legacy for backwards compatibility
  const rawStrength = edge.strength_mean ?? edge.weight ?? DEFAULT_STRENGTH_MEAN;
  if (edge.strength_mean === undefined && edge.weight === undefined) {
    defaults.push({ edge_id: edgeId, field: "strength_mean", default_value: DEFAULT_STRENGTH_MEAN, reason: "no LLM value" });
  }

  // exists_probability: use LLM-emitted value if present; otherwise apply
  // class-appropriate default rather than the old fixed 0.5 sentinel.
  // Rationale: 0.5 is indistinguishable from "I know this edge exists with 50%
  // confidence" vs "I forgot to emit the field", causing PLoT to override with DEFAULT_EXISTS_PROBABILITY.
  // Using the class default makes the assumption explicit and auditable.
  const isStructural = classifyEdge(edge.from, edge.to, _nodes) === "structural";
  const beliefExists =
    edge.belief_exists ?? edge.belief ??
    (isStructural
      ? STRUCTURAL_EXISTS_PROBABILITY_DEFAULT
      : CAUSAL_EXISTS_PROBABILITY_DEFAULT);
  if (edge.belief_exists === undefined && edge.belief === undefined) {
    const defaultVal = isStructural ? STRUCTURAL_EXISTS_PROBABILITY_DEFAULT : CAUSAL_EXISTS_PROBABILITY_DEFAULT;
    defaults.push({ edge_id: edgeId, field: "exists_probability", default_value: defaultVal, reason: isStructural ? "structural edge default" : "causal edge default" });
  }

  // In V3, strength_mean is a signed coefficient
  // If effect_direction is negative, strength_mean should be negative
  const existingDirection = edge.effect_direction;
  let strengthMean = rawStrength;

  // Apply sign based on effect direction (only if not already signed from V4)
  if (existingDirection === "negative" && rawStrength > 0) {
    strengthMean = -Math.abs(rawStrength);
  }

  // P1-CEE-2: Clamp strength_mean to [-1, +1]
  const { clamped: clampedMean, wasClamped } = clampStrengthMean(
    strengthMean,
    edge.from,
    edge.to
  );
  strengthMean = clampedMean;

  // Emit telemetry if clamped
  if (wasClamped) {
    emit(TelemetryEvents.EdgeStrengthClamped ?? "cee.edge.strength_clamped", {
      edgeFrom: edge.from,
      edgeTo: edge.to,
      originalMean: rawStrength * (existingDirection === "negative" ? -1 : 1),
      clampedMean: strengthMean,
    });
  }

  // Use V4 strength_std if present, otherwise derive from strength and belief
  let strengthStd = edge.strength_std;
  if (strengthStd === undefined) {
    strengthStd = deriveStrengthStd(Math.abs(rawStrength), beliefExists, edge.provenance);
    defaults.push({ edge_id: edgeId, field: "strength_std", default_value: strengthStd, reason: "derived from mean/belief" });
  }

  // P1-CEE-2: Apply std bounds (floor 1e-6, cap max(0.5, 2×|mean|))
  strengthStd = boundStrengthStd(strengthStd, strengthMean, edge.from, edge.to);

  // Derive effect direction from strength_mean
  const effectDirection = deriveEffectDirection(strengthMean);

  // Extract provenance — prefer structured edge.provenance, fall back to
  // edge.provenance_source (flat enum from Anthropic structured outputs).
  const provenance = extractProvenanceForV3(edge.provenance)
    ?? (edge.provenance_source ? { source: mapToV3ProvenanceSource(edge.provenance_source) } : undefined);

  return {
    edge: {
      from: edge.from,
      to: edge.to,
      strength: { mean: strengthMean, std: strengthStd },
      exists_probability: beliefExists,
      effect_direction: effectDirection,
      provenance,
      // UI display vocabulary derived from structured provenance.source.
      // Sibling of `provenance` (structured); leaves the structural enum intact.
      provenance_display: edgeProvenanceDisplay(provenance?.source),
      // Edge origin: tracks creation source (ai, user, repair, enrichment, default)
      origin: edge.origin ?? "ai",
      // Bidirected edges represent unmeasured confounding — preserve through pipeline. See 3A-trust.
      ...(edge.edge_type ? { edge_type: edge.edge_type } : {}),
      // F5: Preserve enrichment defaulted flag through V3 transform
      ...((edge as any).defaulted != null ? { defaulted: (edge as any).defaulted } : {}),
      // Preserve validation pipeline metadata (two-pass parameter review)
      ...((edge as any).validation != null ? { validation: (edge as any).validation } : {}),
    },
    defaults,
  };
}

/**
 * Valid V3 provenance sources.
 */
type V3ProvenanceSource = "brief_extraction" | "cee_hypothesis" | "domain_knowledge" | "user_specified";

/**
 * Map provenance string to V3 source.
 */
function mapToV3ProvenanceSource(source: string): V3ProvenanceSource {
  const normalized = source.toLowerCase();
  if (normalized.includes("user") || normalized.includes("specified") || normalized.includes("manual")) {
    return "user_specified";
  }
  if (normalized.includes("hypothesis")) return "cee_hypothesis";
  if (normalized.includes("document") || normalized.includes("brief") || normalized.includes("evidence")) {
    return "brief_extraction";
  }
  if (normalized.includes("domain") || normalized.includes("knowledge")) {
    return "domain_knowledge";
  }
  // Default to cee_hypothesis for unknown sources
  return "cee_hypothesis";
}

/**
 * Extract provenance as V3 format.
 */
function extractProvenanceForV3(
  prov?: string | ProvenanceObject
): { source: V3ProvenanceSource; reasoning?: string } | undefined {
  if (!prov) return undefined;

  if (typeof prov === "string") {
    return { source: mapToV3ProvenanceSource(prov) };
  }

  return {
    source: mapToV3ProvenanceSource(prov.source),
    reasoning: prov.quote,
  };
}

// ============================================================================
// Graph Transformation
// ============================================================================

/**
 * Find the goal node in a graph.
 */
function findGoalNode(nodes: V1Node[]): V1Node | undefined {
  return nodes.find((n) => n.kind === "goal");
}

/**
 * Extract option nodes from graph (to be converted to V3 options).
 * Note: Only "option" nodes are extracted; "decision" nodes remain in the graph.
 */
function extractOptionNodes(nodes: V1Node[]): V1Node[] {
  return nodes.filter((n) => n.kind === "option");
}

/**
 * Extract edge hints from V1 graph - edges from option nodes to factor nodes.
 * These provide structural hints for intervention targeting.
 * Note: Only "option" nodes, not "decision" nodes.
 */
function extractEdgeHints(graph: V1Graph): EdgeHint[] {
  const optionNodeIds = new Set(
    graph.nodes
      .filter((n) => n.kind === "option")
      .map((n) => n.id)
  );
  const factorNodeIds = new Set(
    graph.nodes
      .filter((n) => n.kind === "factor" || n.kind === "constraint" || n.kind === "action")
      .map((n) => n.id)
  );

  return graph.edges
    .filter((edge) => optionNodeIds.has(edge.from) && factorNodeIds.has(edge.to))
    .map((edge) => ({
      from_option_id: edge.from,
      to_factor_id: edge.to,
      weight: edge.weight,
    }));
}

interface OptionIdMismatchSummary {
  optionNodeIds: string[];
  optionIds: string[];
  missingOptionIds: string[];
  extraOptionIds: string[];
}

function getOptionIdMismatchSummary(
  graph: GraphV3T,
  options: OptionV3T[]
): OptionIdMismatchSummary {
  const optionNodeIds = graph.nodes.filter((n) => n.kind === "option").map((n) => n.id);
  const optionIds = options.map((option) => option.id);
  const optionIdSet = new Set(optionIds);
  const optionNodeIdSet = new Set(optionNodeIds);

  return {
    optionNodeIds,
    optionIds,
    missingOptionIds: optionNodeIds.filter((id) => !optionIdSet.has(id)),
    extraOptionIds: optionIds.filter((id) => !optionNodeIdSet.has(id)),
  };
}

/**
 * Transform V1 graph to V3 format.
 * Keeps ALL nodes including options for graph connectivity (decision→option→factor).
 * Options are also extracted to the separate options[] array with intervention metadata.
 */
/** Result of transforming a V1 graph to V3, including aggregated defaults. */
export interface GraphTransformResult {
  graph: GraphV3T;
  transform_defaults: TransformDefaultRecord[];
  defaulted_edge_count: number;
  label_cleaning: LabelCleaningEntry[];
}

export function transformGraphToV3(graph: V1Graph): GraphTransformResult {
  // Keep ALL nodes including options (for PLoT connectivity and canvas visualization)
  const allNodeIds = new Set(graph.nodes.map((n) => n.id));

  // Transform all nodes, collecting label cleaning trace
  const usedNodeIds = new Set<string>();
  const labelCleaningTrace: LabelCleaningEntry[] = [];
  const v3Nodes = graph.nodes.map((node) => transformNodeToV3(node, usedNodeIds, labelCleaningTrace));

  // Keep ALL valid edges (including decision→option and option→factor)
  const validEdges = graph.edges.filter(
    (edge) => allNodeIds.has(edge.from) && allNodeIds.has(edge.to)
  );

  // Transform edges, collecting defaults
  const edgeResults = validEdges.map((edge, index) =>
    transformEdgeToV3(edge, index, graph.nodes)
  );
  const v3Edges = edgeResults.map((r) => r.edge);
  const allDefaults = edgeResults.flatMap((r) => r.defaults);
  const edgesWithDefaults = new Set(allDefaults.map((d) => d.edge_id));

  // Log label cleaning trace if any annotations were stripped
  if (labelCleaningTrace.length > 0) {
    log.info({
      event: "cee.v3_transform.label_cleaning",
      count: labelCleaningTrace.length,
      entries: labelCleaningTrace,
    }, `Stripped normalisation annotations from ${labelCleaningTrace.length} node label(s)`);
  }

  // ⭐ LOUD, NEVER ASSUME-GOOD: a factor shipping a `cap` its own observed state
  // cannot PROVE. The write above corroborates every case it can do so
  // truthfully; what reaches here is the residue it could NOT — a degenerate
  // `cap <= 1`, a `%` factor whose divisor is not 100, or a `raw_value` that
  // DISAGREES with `value * cap` (a wrong number a presence-only check would
  // bless). Each leaves the factor `ambiguous_no_evidence` at the analysis seam,
  // so its interventions cannot be denormalised and the analysable-option gate
  // cannot hold a status quo at it.
  //
  // An alarm rather than a repair: outside the derivable domain there is no
  // truthful raw value to write, and fabricating one would launder the exact
  // 100,000x corruption the `ambiguous_no_evidence` rule exists to stop. This
  // is the same RUNTIME, at-the-boundary shape as the prior-distribution drift
  // alarm above — the value is passed through unchanged, never 400'd.
  //
  // ⚠ MEASURED SCOPE, STATED SO IT IS NOT MISREAD (trap 20): across five banked
  // real capture corpora (71 factors with observed_state, 50 capped) this class
  // has ZERO incidence, and the probe discriminates (a contrast control with an
  // injected uncorroborated factor reports it). So this is DEFENCE IN DEPTH
  // against a writer that does not exist today — the draft path's records
  // projector deliberately stores no cap, and the graph grammar that let a model
  // author one is retired — not a fix for an observed production failure.
  const uncorroborated = findUncorroboratedCapFactorIds(v3Nodes);
  if (uncorroborated.length > 0) {
    log.error({
      event: "cee.v3_transform.uncorroborated_cap",
      factor_ids: uncorroborated,
      count: uncorroborated.length,
    }, `[V3] ${uncorroborated.length} factor(s) ship an observed_state cap with no corroborating raw_value (or one that disagrees with value x cap). Such a factor cannot prove its scale convention: resolveRawInterventionValue returns ambiguous_no_evidence, its interventions are never denormalised, and the analysable-option gate cannot hold a status quo at it. Ids only — no magnitudes are logged.`);
  }

  return {
    graph: {
      nodes: v3Nodes,
      edges: v3Edges,
    },
    transform_defaults: allDefaults,
    defaulted_edge_count: edgesWithDefaults.size,
    label_cleaning: labelCleaningTrace,
  };
}

type TypedRecordProvenanceClass = "stated" | "ai_inferred" | "projector_structural";
type TypedRecordBriefBinding = "verified" | "unverified" | "unchecked";

interface RecognizedTypedRecordProvenance {
  readonly provenance_class: TypedRecordProvenanceClass;
  readonly brief_binding?: TypedRecordBriefBinding;
}

/**
 * Read only the closed typed-record provenance vocabulary. Other provenance
 * objects belong to legacy graph paths and deliberately fall through to their
 * existing extraction/label rules.
 */
function readTypedRecordProvenance(node: V1Node): RecognizedTypedRecordProvenance | undefined {
  const candidate = (node as V1Node & { provenance?: unknown }).provenance;
  if (!candidate || typeof candidate !== "object") return undefined;
  const value = candidate as Record<string, unknown>;
  const provenanceClass = value.provenance_class;
  if (
    provenanceClass !== "stated" &&
    provenanceClass !== "ai_inferred" &&
    provenanceClass !== "projector_structural"
  ) {
    return undefined;
  }

  const binding = value.brief_binding;
  return {
    provenance_class: provenanceClass,
    ...(binding === "verified" || binding === "unverified" || binding === "unchecked"
      ? { brief_binding: binding }
      : {}),
  };
}

/**
 * Project node authorship once, from the source node and its transformed twin.
 *
 * Typed records are authoritative: only `stated + verified` earns the user's
 * badge; inferred/structural records and unverified/unchecked stated records do
 * not. This is intentionally evaluated before label containment, otherwise an
 * inferred label that happens to repeat brief text is falsely re-attributed to
 * the user. Graphs without a recognized typed record retain the legacy,
 * fail-closed label/value behaviour.
 */
function projectNodeProvenance(
  sourceNodes: readonly V1Node[],
  projectedNodes: NodeV3T[],
  brief?: string,
): void {
  for (let index = 0; index < projectedNodes.length; index += 1) {
    const node = projectedNodes[index];
    const sourceNode = sourceNodes[index];
    if (!node || !sourceNode) continue;

    const typed = readTypedRecordProvenance(sourceNode);
    if (typed) {
      node.provenance =
        typed.provenance_class === "stated" && typed.brief_binding === "verified"
          ? "from_brief"
          : "ai_inferred";
      continue;
    }

    if (node.kind === "option") {
      const binding = bindOptionLabelToBrief(node.label, brief);
      node.provenance = bindingEarnsBriefClaim(binding) ? "from_brief" : "ai_inferred";
      continue;
    }

    if (!LABEL_BOUND_PROVENANCE_KINDS.has(node.kind)) continue;

    const carriesValue =
      node.observed_state !== undefined ||
      node.prior !== undefined ||
      node.display_value !== undefined ||
      typeof node.intercept === "number" ||
      typeof node.goal_threshold === "number" ||
      typeof node.goal_threshold_raw === "number";
    if (carriesValue) continue;

    const tokenCount = node.label.trim().split(/\s+/).filter(Boolean).length;
    if (tokenCount < 2) continue;

    const binding = bindOptionLabelToBrief(node.label, brief);
    if (bindingEarnsBriefClaim(binding)) node.provenance = "from_brief";
  }
}

/** The one deterministic graph/options projection consumed by both wire phases. */
export interface V3GraphOptionsProjection extends GraphTransformResult {
  readonly options: OptionV3T[];
  readonly goal_node_id: string;
  readonly extracted_options: ExtractedOption[];
  readonly rephrase_merge: RephraseMergeResult;
}

/**
 * Project a V1 graph into its canonical V3 graph and options view.
 *
 * This function owns every structural operation that must agree between
 * GRAPH_READY and COMPLETE: node/edge transformation, canonical ids, typed
 * provenance, option extraction, interventions, the three-state baseline flag,
 * option provenance, and conservative rephrase absorption. It never packages a
 * terminal response and never mutates the supplied graph.
 */
export function projectGraphAndOptionsToV3(
  graph: V1Graph,
  context: Pick<V3TransformContext, "brief"> = {},
): V3GraphOptionsProjection {
  const transformed = transformGraphToV3(graph);
  const projectedNodes = transformed.graph.nodes as NodeV3T[];
  const projectedEdges = transformed.graph.edges as EdgeV3T[];
  const projectedIdBySourceId = new Map(
    graph.nodes.map((node, index) => [node.id, projectedNodes[index]?.id ?? node.id]),
  );

  const sourceGoal = findGoalNode(graph.nodes);
  const goalNodeId = sourceGoal
    ? projectedIdBySourceId.get(sourceGoal.id) ?? sourceGoal.id
    : "goal";
  const edgeHints = extractEdgeHints(graph).map((hint) => ({
    ...hint,
    from_option_id: projectedIdBySourceId.get(hint.from_option_id) ?? hint.from_option_id,
    to_factor_id: projectedIdBySourceId.get(hint.to_factor_id) ?? hint.to_factor_id,
  }));

  const extractedOptions = extractOptionsFromNodes(
    extractOptionNodes(graph.nodes).map((node) => ({
      id: projectedIdBySourceId.get(node.id) ?? node.id,
      label: node.label ?? node.id,
      description: node.body,
      v4Interventions: isOptionData(node.data) ? node.data.interventions : undefined,
      is_baseline: resolveOptionIsBaseline(node),
    })),
    projectedNodes,
    projectedEdges,
    goalNodeId,
    edgeHints,
    context.brief,
  );
  const options = toOptionsV3(extractedOptions);

  projectNodeProvenance(graph.nodes, projectedNodes, context.brief);
  const optionById = new Map(options.map((option) => [option.id, option]));
  for (const node of projectedNodes) {
    if (node.kind !== "option") continue;
    const option = optionById.get(node.id);
    if (!option) continue;

    // The top-level option is canonical for analysis; the graph node carries
    // the exact same target keys/identities for canvas and staged consumers.
    node.interventions = option.interventions;
    if (option.is_baseline !== undefined) node.is_baseline = option.is_baseline;

    const fromBrief = node.provenance === "from_brief";
    option.provenance = {
      ...(option.provenance ?? {}),
      source: fromBrief ? "brief_extraction" : "cee_hypothesis",
      ...(fromBrief ? { brief_quote: node.label } : {}),
    };
  }

  // One absorption authority, before either consumer observes graph/options.
  const rephraseMerge = mergeRephrasedOptions({
    nodes: projectedNodes,
    edges: projectedEdges,
    options,
  });

  return {
    ...transformed,
    options,
    goal_node_id: goalNodeId,
    extracted_options: extractedOptions,
    rephrase_merge: rephraseMerge,
  };
}

// ============================================================================
// Response Transformation
// ============================================================================

/**
 * Transform a V1 draft-graph response to V3 format.
 *
 * @param v1Response - V1 draft-graph response
 * @param context - Transformation context
 * @returns V3 draft-graph response
 */
export function transformResponseToV3(
  v1Response: V1DraftGraphResponse,
  context: V3TransformContext = {}
): V3DraftGraphResponse {
  const { graph } = v1Response;

  // [V3-CAT-INPUT] Log category on V1 input (before any transform)
  // Gated behind CEE_DEBUG_CATEGORY_TRACE feature flag
  if (config.cee.debugCategoryTrace) {
    const v1InputFactors = graph.nodes.filter((n) => n.kind === "factor");
    const v1InputWithCategory = v1InputFactors.filter((n) => n.category);
    log.info({
      requestId: context.requestId,
      v1_input_factor_count: v1InputFactors.length,
      v1_input_with_category: v1InputWithCategory.length,
      v1_input_sample: v1InputWithCategory.slice(0, 5).map((n) => ({ id: n.id, category: n.category })),
      all_input_node_ids: graph.nodes.map((n) => n.id),
      event: "cee.v3_transform.input_category_check",
    }, "[V3-CAT-INPUT] V1 input category status at transform entry");
  }

  if (!findGoalNode(graph.nodes)) {
    log.warn({ requestId: context.requestId }, "No goal node found in graph");
  }
  const projection = projectGraphAndOptionsToV3(graph, { brief: context.brief });
  const {
    graph: v3Graph,
    options: v3Options,
    goal_node_id: goalNodeId,
    extracted_options: extractedOptions,
    rephrase_merge: rephraseMerge,
    transform_defaults: transformDefaults,
    defaulted_edge_count: defaultedEdgeCount,
    label_cleaning: labelCleaning,
  } = projection;

  // [V3-CAT-TRACE] Log category field status through V3 transform
  // Gated behind CEE_DEBUG_CATEGORY_TRACE feature flag
  if (config.cee.debugCategoryTrace) {
    const v1FactorsWithCategory = graph.nodes.filter((n) => n.kind === "factor" && n.category);
    const v3FactorsWithCategory = v3Graph.nodes.filter((n) => n.kind === "factor" && n.category);
    log.info({
      requestId: context.requestId,
      v1_factor_count: graph.nodes.filter((n) => n.kind === "factor").length,
      v1_factors_with_category: v1FactorsWithCategory.length,
      v1_category_sample: v1FactorsWithCategory.slice(0, 3).map((n) => ({ id: n.id, cat: n.category })),
      v3_factor_count: v3Graph.nodes.filter((n) => n.kind === "factor").length,
      v3_factors_with_category: v3FactorsWithCategory.length,
      v3_category_sample: v3FactorsWithCategory.slice(0, 3).map((n) => ({ id: n.id, cat: n.category })),
      event: "cee.v3_transform.category_trace",
    }, "[V3-CAT-TRACE] Category field status in V3 transform");
  }

  // Historical evidence for the provenance policy executed by the shared
  // graph/options projector above. Response packaging does not re-project it.
  // ⭐⭐ ROW 2.1205 — THE BADGE WAS REACHABLE FOR EXACTLY ONE NODE KIND.
  //
  // ── MEASURED, ON BANKED CAPTURES ─────────────────────────────────────────
  // 201 nodes across four capture runs and six briefs (closing witness 14 Aug,
  // `driver/captures-<run>/captures/<arm>/committed-graph.json`):
  //
  //     option/from_brief    20   ← every from_brief in the corpus
  //     option/ai_inferred   38       risk/ai_inferred     37
  //     goal/ai_inferred     16       outcome/ai_inferred  26
  //     factor/ai_inferred   48       decision/ai_inferred 16
  //
  // **47 of the 201 carry a label that is VERBATIM brief text and read
  // `ai_inferred`** — 16/16 goals among them, including the user's own sentence
  // *"Our aim is to raise our average seat price"*. A user reading the canvas is
  // told Olumi wrote their goal.
  //
  // ── WHY: TWO DERIVATIONS OF ONE FACT, AND ONLY ONE WAS EXTENDED ──────────
  // The loop above (root 4) derives provenance from the brief bytes for OPTIONS.
  // Every other kind falls out of `extractionType` in `transformNodeToV3`, and
  // `extractionType` is a FACTOR-ONLY field — its own comment says so:
  // *"Decisions/options/goals fall through to the ai_inferred default."* So the
  // badge was not failing for these kinds; it was unreachable by construction.
  //
  // ── ONE AUTHORITY, MORE READERS — NOT A WIDER PREDICATE ──────────────────
  // This calls the SAME `bindOptionLabelToBrief` on the SAME brief bytes with
  // the SAME containment and the SAME specificity floor. Nothing about the
  // predicate moves; only the set of callers does. Widening the predicate is the
  // direction that CERTIFIES content the user did not write, and
  // `brief-binding.ts` exists because of that class — so it stays untouched.
  //
  // ⚠ FACTORS ARE DELIBERATELY EXCLUDED, AND THE EXCLUSION IS THE CAREFUL PART.
  // A factor is VALUE-BEARING, and a label test certifies nothing about a
  // number. `bindStatedItemToBrief` checks a figure's value INSIDE its own quote
  // precisely because an exact quote carrying a contradicted value ("Churn is 10
  // percent", value 90) is the external audit's finding 2. Badging a factor on
  // its label alone would re-admit that class through the side door. Factors
  // keep their value-aware path (`mayClaimFromBrief`, ROADMAP 2.972) —
  // `Annual Support Cost` and `Seat Price` are verbatim brief text in the corpus
  // above and deliberately do NOT flip here.
  //
  // ⚠ On the LEGACY label-only path, a value-bearing node declines: a goal that
  // merely acquires a threshold cannot claim authorship for a number the user
  // never gave. Typed records are stronger evidence and are handled first: a
  // stated numeric record earns the badge only when its quote AND value were
  // already verified against the brief by the records projector.
  //
  // ⚠⚠ WHAT THIS DOES **NOT** DO, and the row was written from that case.
  // DOM-3 witnessed the user's stated risk surfacing as `Revenue Lost During
  // Cutover` — a title-cased PARAPHRASE of *"losing revenue during the
  // cutover"*. Containment cannot tie a paraphrase to brief bytes and nothing
  // here tries: a fuzzy match that manufactured the badge would be fabricated
  // provenance, the same sin in the other direction. That node keeps
  // `ai_inferred`, and a KNOWN-DROPPED test pins it so the gap is visible in the
  // suite rather than invisible to it. What DOES change is that a hazard the
  // user states reaches a correctly-badged risk node at all: the grammar carries
  // it through the `constraint` stated channel, where the projector labels the
  // node with the user's own quote (`projector.ts:1614`) and `NODE_KIND_MAP`
  // maps `constraint → risk`. Before this loop that path could not earn the
  // badge either.
    // ⚠ THE FIELD NAMES HERE WERE WRONG ON THE FIRST WRITE, AND A TEST CAUGHT
    // IT — worth recording, because the guard was PRESENT and CORRECT and
    // pointed at bytes that do not exist (trap 22: verify what a guard actually
    // RECEIVES, not that it is there). The first version tested `target_value`
    // and `threshold`; the V3 node's goal threshold is `goal_threshold` /
    // `goal_threshold_raw` (`schemas/cee-v3.ts:155-178`), so a thresholded goal
    // sailed straight past it and earned the badge. Derived at the schema, then
    // re-measured.
    //
    // ⚠ AND READ THROUGH THE DECLARED TYPE, NOT THROUGH A DOUBLE CAST. The
    // first version reached these fields via `node as unknown as Record<string,
    // unknown>` and CI's forbidden-boundary ratchet caught it (`as_unknown_as`,
    // 59 exact) — correctly: every one of these fields is DECLARED on `NodeV3T`
    // (`schemas/cee-v3.ts`), so the cast bought nothing and erased the very
    // types that would have caught the wrong field names above.
    //
    // ⚠⚠ `intercept` ADDED AT REVIEW, AND THE MISS IS THE INSTRUCTIVE PART.
    // It is declared (`cee-v3.ts:193`), model-emittable, and forwarded to the
    // wire at `:380-385` — a label-verbatim node carrying ONLY a model-authored
    // intercept would have earned the badge for a number the user never gave.
    // This list is a HAND-MAINTAINED MIRROR of "which node fields carry a
    // value" (trap 12), and no amount of comment makes it not one — the schema
    // marks no field as value-bearing, so it cannot be derived. What CAN be
    // derived is the schema's KEY SET, so a completeness twin pins it and REDs
    // when a new node field lands, forcing the question "is this value-bearing?"
    // rather than letting the next `intercept` arrive silently.

    // ⭐⭐ ELIGIBILITY — A SINGLE WORD IS NOT EVIDENCE OF AUTHORSHIP.
    //
    // ── MEASURED AT REVIEW, IN THE FABRICATION DIRECTION ─────────────────────
    // Through the full `transformResponseToV3` on an ordinary brief —
    // *"…This is a big decision for us. We worry about churn, want growth, and
    // need more revenue."* — the scaffold node labelled **`Decision`** and the
    // model's own one-word nodes **`Churn`**, **`Growth`** and **`Revenue`** all
    // came back **`from_brief`**. Four fabricated authorship claims on one draw,
    // in exactly the class this loop exists to close.
    //
    // ── WHY MY OWN CORPUS COULD NOT SEE IT ──────────────────────────────────
    // None of the six banked briefs contains the word "decision", so the 16/16
    // banked `Decision` nodes never matched. **A corpus drawn from captures is
    // still a corpus with a shape** (trap 22) — it bounded what the product HAD
    // emitted, not what the predicate WOULD accept.
    //
    // ── WHY THE FLOOR DID NOT CATCH IT, AND WHY IT IS NOT MOVED ─────────────
    // `MIN_QUOTE_CHARS = 3` (`brief-binding.ts`) is a DEGENERACY floor, and its
    // own doc says so: *"A single common word ('the') clears three characters
    // and would still be contained by coincidence."* It was calibrated for
    // OPTION labels, which are phrases by construction. This loop pointed the
    // same predicate at kinds where a single-token label is the NORM.
    //
    // So the repair is an ELIGIBILITY condition HERE, at the caller, not a
    // second floor inside the shared authority. D4 ruled ONE floor for both
    // callers precisely because two floors behind one name is two predicates
    // under one name (trap 21) — that ruling stands untouched, `bindOptionLabel
    // ToBrief` is unchanged, and root-4's option behaviour cannot move.
    //
    // ── THE TWO HARMS, AND THEY ARE NOT SYMMETRIC (trap 22b) ────────────────
    //   • accept a single token → we tell the user they wrote a node the model
    //     coined, because one of its words appears somewhere in their brief.
    //     A LIE about authorship.
    //   • decline one → a genuine one-word label ("Churn" the user really did
    //     name) loses its badge and keeps everything else. AN UNDER-CLAIM.
    // ⚠ Named rather than waved away: a hyphenated label (`Time-to-Target`) is
    // one whitespace token and declines despite being specific. That is the safe
    // direction, and the class ends the same way the floor's does — with span
    // binding into the brief, where no token counting is needed at all.

  // Absorption already happened inside the shared graph/options projection,
  // before GRAPH_READY or terminal summaries could observe the option set.
  // Response packaging only records its diagnostics here.
  if (rephraseMerge.absorbedOptionIds.length > 0) {
    log.info(
      {
        requestId: context.requestId,
        absorbedOptionIds: rephraseMerge.absorbedOptionIds,
      },
      "cee.v3_transform.option_rephrase_absorbed"
    );
  }

  const optionIdSummary = getOptionIdMismatchSummary(v3Graph, v3Options);
  if (optionIdSummary.missingOptionIds.length > 0) {
    log.warn(
      {
        requestId: context.requestId,
        missingOptionIds: optionIdSummary.missingOptionIds,
        optionNodeIds: optionIdSummary.optionNodeIds,
      },
      "Option node IDs missing from options[]"
    );
  }
  if (optionIdSummary.extraOptionIds.length > 0) {
    log.warn(
      {
        requestId: context.requestId,
        extraOptionIds: optionIdSummary.extraOptionIds,
        optionIds: optionIdSummary.optionIds,
      },
      "Options[] contains IDs not present in graph option nodes"
    );
  }

  // Generate validation warnings
  const validationWarnings = generateValidationWarnings(
    v3Graph,
    v3Options,
    goalNodeId
  );

  // The absorption's disclosures ride the same channel as the other
  // transform-stage findings. ⚠ NOT a user-facing channel on the draft turn —
  // an independent review established at the artefacts that
  // `validation_warnings` has no wire carrier there (the draft block schema is
  // `.strict()` and omits it) and that the UI's only readers are debug panels.
  // What a user can actually reach is the "Also drafted as: …" description on
  // the surviving option, code-traced to the option inspector. This push is a
  // RECORD of the merge, not the notice.
  validationWarnings.push(...rephraseMerge.warnings);

  // ── WS-A item 1(b): THE COMMIT-TIME MONEY INVARIANT ──────────────────────
  //
  // THIS IS THE COMMIT POINT. `v3Options` carries the interventions that were
  // just extracted and `v3Graph.nodes` the factors they are levers on, so this
  // is the first and only place where both halves of the encoding pair
  // (`cap` and `level`) exist together — which is exactly why nothing has ever
  // asserted their product (L2B-VARIANCE.md §3.1: the two halves are emitted
  // independently by one LLM call, and the user's £6,000 committed as £1,440
  // with `warnings: []` throughout).
  //
  // DISCLOSURE, NOT REPAIR. The detector is pure and the graph is untouched:
  // it appends to the same `validation_warnings` channel that already carries
  // `CONSTRAINT_DIRECTION_HEURISTIC` and `STRENGTH_DEFAULT_APPLIED`, both
  // witnessed on the persisted wire. Never a rewrite — that is #853's defect
  // class, and a magnitude silently corrected can be 10^6x wrong.
  validationWarnings.push(
    ...detectUnreconciledStatedMagnitudes({
      nodes: v3Graph.nodes as NodeV3T[],
      options: v3Options,
      briefText: context.brief,
    }),
  );

  // P0: Build analysis-ready payload for direct PLoT consumption
  const analysisReady = buildAnalysisReadyPayload(
    v3Options,
    goalNodeId,
    v3Graph,
    {
      seed: (v1Response as any).seed ?? "42",
      requestId: context.requestId,
    }
  );

  // Validate analysis-ready payload (log warnings but don't fail)
  validateAndLogAnalysisReady(analysisReady, v3Graph, v3Options, context.requestId);

  // Check for price-related unresolved targets (for retry suggestion)
  const priceCheck = hasPriceRelatedUnresolvedTargets(extractedOptions);

  // Emit telemetry
  const stats = getExtractionStatistics(extractedOptions);
  emit(TelemetryEvents.SchemaV3TransformComplete ?? "cee.schema_v3.transform_complete", {
    nodeCount: v3Graph.nodes.length,
    edgeCount: v3Graph.edges.length,
    optionCount: v3Options.length,
    ...stats,
    validationWarningCount: validationWarnings.length,
    analysisReadyStatus: analysisReady.status,
    priceRelatedUnresolved: priceCheck.detected,
    priceRelatedTerms: priceCheck.terms,
    requestId: context.requestId,
  });

  // Build response - V3.1: nodes and edges at root level (not nested under graph)
  const v3Response: V3DraftGraphResponse = {
    schema_version: "3.0",
    nodes: v3Graph.nodes,
    edges: v3Graph.edges,
    options: v3Options,
    goal_node_id: goalNodeId,
    // v0.11.0 schema amendment: coaching + causal_claims are required at
    // the V3 boundary. Initialise to canonical defaults; the conditional
    // assignments below overwrite when V1 carries populated values.
    coaching: {
      summary: null,
      strengthen_items: [],
      widening_log: {
        elements_added: [],
        elements_considered_but_excluded: [],
        brief_completeness: "thin",
      },
      bias_signals: [],
    } as unknown as V3DraftGraphResponse["coaching"],
    causal_claims: [] as unknown as V3DraftGraphResponse["causal_claims"],
    analysis_ready: (() => {
      // Strip internal _fallback_meta before sending to client
      const { _fallback_meta, ...cleanPayload } = analysisReady as any;
      return cleanPayload;
    })(),
    quality: v1Response.quality,
    trace: {
      request_id: context.requestId ?? v1Response.trace?.request_id,
      correlation_id: context.correlationId ?? v1Response.trace?.correlation_id,
      engine: v1Response.trace?.engine,
      goal_handling: v1Response.trace?.goal_handling,
      // P0: Pipeline diagnostics for debug panel
      pipeline: v1Response.trace?.pipeline,
      // STRP mutation records for observability
      // v1Response.trace has [key: string]: unknown — direct access via index signature
      ...(v1Response.trace?.strp ? { strp: v1Response.trace.strp } : {}),
      // Enrichment metadata (Pipeline B, Step 12)
      ...(v1Response.trace?.enrich ? { enrich: v1Response.trace.enrich } : {}),
      // Deterministic repair summary for observability.
      // Primary path: trace.pipeline.repair_summary (survives Zod verification in Step 13).
      // Fallback: trace.repair_summary (pre-verification, for backward-compatible fixtures).
      // Always emitted so the UI can depend on the key existing.
      repair_summary:
        (v1Response.trace?.pipeline as Record<string, unknown> | undefined)?.repair_summary
        ?? v1Response.trace?.repair_summary
        ?? { deterministic_repairs_count: 0, deterministic_repairs: [] },
      // F6: Log all defaulted edge parameters applied during V3 transform
      transform_defaults: {
        defaulted_edge_count: defaultedEdgeCount,
        total_defaults: transformDefaults.length,
        defaults: transformDefaults,
      },
      // Label cleaning: normalisation annotations stripped at V3 boundary
      ...(labelCleaning.length > 0 ? {
        label_cleaning: labelCleaning,
      } : {}),
      // F15: Surface analysis_ready fallback count when fallbacks occurred
      // AnalysisReadyPayload uses .passthrough() — _fallback_meta is a runtime-only trace field
      ...((analysisReady as Record<string, unknown>)._fallback_meta
        ? { analysis_ready_fallbacks: (analysisReady as Record<string, unknown>)._fallback_meta }
        : {}),
    },
    draft_warnings: v1Response.draft_warnings,
  };

  // CIL Phase 0: Carry goal_constraints from V1 pipeline into V3 response.
  // These are generated during compound goal extraction (Phase 3) and were
  // previously dropped during V1→V3 reconstruction.
  // V1DraftGraphResponse has [key: string]: unknown index signature —
  // passthrough fields are accessed directly without type assertion.
  const v1GoalConstraints = v1Response.goal_constraints;
  if (Array.isArray(v1GoalConstraints) && v1GoalConstraints.length > 0) {
    v3Response.goal_constraints = v1GoalConstraints;
  }

  // v0.11.0 schema amendment: coaching is required at the V3 boundary
  // per canonical contract. When V1 omits the field (legacy callers,
  // LLM didn't emit, or `hasMeaningfulCoaching` filtered the empty
  // case), default to the canonical empty shape so consumers always
  // see the field. Stage 5 emits a populated coaching when meaningful;
  // this default activates only on the legacy/empty path.
  const v1Coaching = v1Response.coaching;
  if (v1Coaching && typeof v1Coaching === "object") {
    v3Response.coaching = v1Coaching as typeof v3Response.coaching;
  } else {
    v3Response.coaching = {
      summary: null,
      strengthen_items: [],
      widening_log: {
        elements_added: [],
        elements_considered_but_excluded: [],
        brief_completeness: "thin",
      },
      bias_signals: [],
    } as typeof v3Response.coaching;
  }

  // v0.11.0 schema amendment: causal_claims is required at the V3 boundary
  // per canonical contract. When V1 omits the field (legacy callers, LLM
  // didn't emit), default to []. The Phase 2B provenance distinction
  // (undefined vs [] meaning "not emitted" vs "emitted but dropped") is
  // collapsed at the V3 boundary in favour of contract-required presence;
  // upstream pipelines preserve the distinction internally on
  // ctx.causalClaims for analytics.
  const v1CausalClaims = v1Response.causal_claims;
  v3Response.causal_claims = Array.isArray(v1CausalClaims)
    ? (v1CausalClaims as typeof v3Response.causal_claims)
    : ([] as typeof v3Response.causal_claims);

  // v0.11.0 schema amendment: carry topology_plan V1 → V3 with hard
  // deep-equality preservation. When present, the V3 array MUST equal the
  // V1 array — same length, same order, same string contents. No filter,
  // no trim, no reorder. When V1 omits the field, default to [] so the
  // V3 boundary always carries the field per canonical contract intent.
  // Tested at tests/unit/boundary.coaching-preservation.test.ts.
  const v1TopologyPlan = (v1Response as { topology_plan?: unknown }).topology_plan;
  (v3Response as { topology_plan?: unknown[] }).topology_plan = Array.isArray(v1TopologyPlan)
    ? [...v1TopologyPlan]
    : [];

  // ⭐⭐ ROOT 4(b) — THE R1 DISCLOSURES REACH THE WIRE, ANCHORED TO REAL NODES.
  //
  // Everything the projector refused to assert was, until now, recorded in
  // `projection.dropped[]` and read by NOTHING. A user saw a constraint with no
  // threshold, a target that never became a goal, one of two contradictory
  // intervention levels — each of them a deliberate, principled refusal, and each
  // of them silent. Improving the projector's honesty without this carrier
  // improves nothing the user experiences.
  //
  // ⚠⚠ NOTHING IS DROPPED HERE. THE FIRST VERSION DROPPED 55 OF 56 IN SILENCE.
  //
  // It required every disclosure to resolve to a node in `nodes[]` and discarded
  // the rest. Measured on both real banked B3 captures: 56 produced, **1**
  // emitted. The dominant class, `unconnected_to_goal` (51 of 56), is
  // unanchorable BY CONSTRUCTION — the record was withdrawn from the graph, so
  // its absence from `nodes[]` is the very thing it is reporting. The rule
  // therefore deleted exactly the disclosures a user most needs — "you told me
  // this and it is not in the model" — and kept only the ones about things the
  // user could already see.
  //
  // ⭐ TWO CHANGES, AND BOTH MATTER:
  //   1. RESOLVE BY ID, NOT BY LABEL. The projector mints the id and now carries
  //      it (`DroppedRecordRef.node_id`). The old label lookup was FIRST-WINS, so
  //      two same-labelled nodes anchored the notice to the wrong one.
  //   2. WITHDRAWAL IS A FACT, NOT A FAILURE. `withdrawn` carries what the anchor
  //      cannot; an absent subject is emitted with `withdrawn: true` rather than
  //      thrown away.
  //
  // A demote still names the SURVIVOR (`duplicate_of`, an id the projector
  // re-resolved at its fixed point), because that surviving option is the thing
  // the user is looking at and the thing the loss is about.
  const v1RecordDisclosures = (v1Response as { record_disclosures?: unknown }).record_disclosures;
  if (Array.isArray(v1RecordDisclosures) && v1RecordDisclosures.length > 0) {
    const finalNodeIds = new Set(v3Graph.nodes.map((n) => n.id));
    const emitted: Array<{
      reason: string;
      label: string;
      withdrawn: boolean;
      node_id?: string;
      value?: number;
      unit?: string;
    }> = [];
    let omitted = 0;
    for (const raw of v1RecordDisclosures) {
      // ⚠ A NON-OBJECT ENTRY IS COUNTED, NOT THROWN — and this line exists because
      // the first version threw. `null` reached `typeof d.reason` and raised, the
      // throw escaped `transformResponseToV3` at `boundary.ts:37`, and ONE bad
      // entry killed the WHOLE DRAFT. Unreachable from the current typed producer,
      // but this is the one case the field's own doc promises to handle, and a
      // landmine on a channel whose entire purpose is not losing things quietly.
      if (!raw || typeof raw !== "object") {
        omitted += 1;
        continue;
      }
      const d = raw as {
        reason?: unknown;
        label?: unknown;
        node_id?: unknown;
        duplicate_of?: unknown;
        value?: unknown;
        unit?: unknown;
      };
      // The ONLY other rejection: a record that cannot be rendered at all. It is
      // COUNTED, never silently swallowed — a channel that quietly loses part of
      // its payload reads exactly like one that had nothing to say.
      if (typeof d.reason !== "string" || typeof d.label !== "string") {
        omitted += 1;
        continue;
      }
      const subjectId = typeof d.node_id === "string" ? d.node_id : undefined;
      const survivorId = typeof d.duplicate_of === "string" ? d.duplicate_of : undefined;
      const anchorId =
        subjectId && finalNodeIds.has(subjectId)
          ? subjectId
          : survivorId && finalNodeIds.has(survivorId)
            ? survivorId
            : undefined;
      // ⭐ THE USER'S OWN MAGNITUDE RIDES THE DISCLOSURE, WHEN THE PROJECTOR HELD
      // ONE. Without it, "you told me this and it is not in your model" reaches
      // the wire carrying the user's words and not their number — and the number
      // is the reason the sentence is worth reading. Guarded rather than spread
      // so a malformed producer cannot smuggle a non-numeric value onto a channel
      // whose entire purpose is telling the truth about what was lost; an absent
      // magnitude stays an ABSENT KEY, so every disclosure that had none before is
      // byte-identical.
      const statedValue = typeof d.value === "number" && Number.isFinite(d.value) ? d.value : undefined;
      const statedUnit = typeof d.unit === "string" && d.unit.length > 0 ? d.unit : undefined;
      emitted.push({
        reason: d.reason,
        label: d.label,
        withdrawn: anchorId === undefined,
        ...(anchorId ? { node_id: anchorId } : {}),
        ...(statedValue !== undefined ? { value: statedValue } : {}),
        ...(statedUnit !== undefined ? { unit: statedUnit } : {}),
      });
    }
    if (emitted.length > 0) {
      (v3Response as { record_disclosures?: unknown[] }).record_disclosures = emitted;
    }
    if (omitted > 0) {
      (v3Response as { record_disclosures_omitted?: number }).record_disclosures_omitted = omitted;
    }
  }

  // Carry rationales from V1 pipeline into V3 response.
  // Rationales are LLM-generated per-node reasoning from Stage 1 (parse).
  // Shape normalised to { target, why } — matches PlanAnnotationCheckpoint pattern.
  // Length capped at 500 chars to prevent unexpectedly long LLM output from bloating responses.
  const v1Rationales = v1Response.rationales;
  if (Array.isArray(v1Rationales) && v1Rationales.length > 0) {
    const normalised = v1Rationales
      .filter((r: any) => r && typeof r === "object")
      .map((r: any) => ({
        target: String(r.target ?? r.node_id ?? r.id ?? ""),
        why: String(r.why ?? r.rationale ?? r.text ?? "").slice(0, 500),
        ...(r.provenance_source ? { provenance_source: String(r.provenance_source) } : {}),
      }))
      .filter((r: { target: string; why: string }) => r.target !== "" && r.why !== "");

    if (normalised.length > 0) {
      v3Response.rationales = normalised;
    }
  }

  // CIL Phase 1: Strength default detection (production-enabled, not debug-gated)
  // Run unconditionally so user-facing warning appears in all responses
  const strengthDefaults = detectStrengthDefaults(
    v3Graph.nodes as Parameters<typeof detectStrengthDefaults>[0],
    v3Graph.edges as Parameters<typeof detectStrengthDefaults>[1]
  );

  // Add STRENGTH_DEFAULT_APPLIED to validation_warnings if threshold exceeded
  if (strengthDefaults.detected) {
    const defaultedPercentage = Number(((strengthDefaults.defaulted_count / strengthDefaults.total_edges) * 100).toFixed(1));
    validationWarnings.push({
      code: CIL_WARNING_CODES.STRENGTH_DEFAULT_APPLIED,
      message: `Detected ${strengthDefaults.defaulted_count} of ${strengthDefaults.total_edges} edges (${defaultedPercentage}%) with default strength value ${strengthDefaults.default_value}. This indicates the LLM may not have output varied strength coefficients.`,
      severity: "warn" as const,
      details: {
        total_edges: strengthDefaults.total_edges,
        structural_edges_excluded: strengthDefaults.structural_edges_excluded,
        defaulted_count: strengthDefaults.defaulted_count,
        defaulted_percentage: defaultedPercentage,
        defaulted_edge_ids: strengthDefaults.defaulted_edge_ids,
      },
    });
  }

  // CIL Phase 1.1: Strength mean dominant detection (production-enabled, not debug-gated)
  // Detects when ≥70% of edges have mean ≈ 0.5 regardless of std. Both warnings can fire.
  const strengthMeanDominant = detectStrengthMeanDominant(
    v3Graph.nodes as any[],
    v3Graph.edges as any[]
  );

  // Add STRENGTH_MEAN_DEFAULT_DOMINANT to validation_warnings if threshold exceeded
  if (strengthMeanDominant.detected) {
    const meanDefaultPercentage = Number(((strengthMeanDominant.mean_default_count / strengthMeanDominant.total_edges) * 100).toFixed(1));
    validationWarnings.push({
      code: CIL_WARNING_CODES.STRENGTH_MEAN_DEFAULT_DOMINANT,
      message: `Detected ${strengthMeanDominant.mean_default_count} of ${strengthMeanDominant.total_edges} edges (${meanDefaultPercentage}%) with mean ≈ ${strengthMeanDominant.default_value} regardless of std. This indicates the LLM may have varied belief/provenance but defaulted strength magnitude.`,
      severity: "warn" as const,
      details: {
        total_edges: strengthMeanDominant.total_edges,
        structural_edges_excluded: strengthMeanDominant.structural_edges_excluded,
        mean_default_count: strengthMeanDominant.mean_default_count,
        mean_default_percentage: meanDefaultPercentage,
        mean_defaulted_edge_ids: strengthMeanDominant.mean_defaulted_edge_ids,
      },
    });
  }

  // Merge V1 pipeline validation_issues (e.g. causal-claim warnings) into V3 validation_warnings.
  // Stage 5 (package) accumulates warnings into validation_issues on the V1 envelope;
  // the V3 transform must surface them so V3 consumers see them.
  const v1ValidationIssues = (v1Response as any).validation_issues;
  if (Array.isArray(v1ValidationIssues)) {
    validationWarnings.push(...v1ValidationIssues);
  }

  // Add validation warnings if any
  if (validationWarnings.length > 0) {
    v3Response.validation_warnings = validationWarnings;
  }

  // CIL Phase 1: removed internal retry-suggestion field that leaked to API clients.
  // priceCheck telemetry is preserved above (line ~860).

  // Add meta if present
  if (graph.meta) {
    v3Response.meta = {
      roots: graph.meta.roots,
      leaves: graph.meta.leaves,
      source: graph.meta.source as "assistant" | "user" | "imported" | undefined,
    };
  }

  // CIL Phase 0.2: Sentinel integrity checks — compare post-pipeline V1 nodes
  // against final V3 output to detect silent data loss in the V3 transform.
  // Gated on debug bundle mode (includeDebug) OR debugLoggingEnabled so
  // sentinel output lands in bundles. Zero cost in production when both flags are off.
  const sentinelEnabled = context.includeDebug || config.cee.debugLoggingEnabled;
  if (sentinelEnabled) {
    try {
      const sentinelOutput = runIntegrityChecks(
        graph.nodes as any[],
        v3Response.nodes as any[],
        v3Response.options as any[],
        graph.edges as any[],
        v3Response.edges as any[],
      );
      // Always attach when debug is active (even if warnings is []).
      // This ensures bundles contain the evidence structure for verification.
      if (!v3Response.trace) {
        v3Response.trace = {};
      }
      // Guard: ensure pipeline is a plain object before mutation.
      // If upstream set it to a non-object (string/array), start fresh.
      const existing = v3Response.trace.pipeline;
      const pipeline: Record<string, unknown> =
        existing !== null && typeof existing === "object" && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {};
      // CIL Phase 0.2: Backward compatibility shim for raw_counts → input_counts rename.
      // Include both keys during deprecation window so existing debug tooling doesn't break.
      pipeline.integrity_warnings = {
        ...sentinelOutput,
        raw_counts: sentinelOutput.input_counts, // Deprecated: use input_counts
      };
      v3Response.trace.pipeline = pipeline;
    } catch (err) {
      // Sentinel must never block the response
      log.warn(
        { error: err, requestId: context.requestId },
        "Integrity sentinel check failed (non-blocking)",
      );
    }
  }

  return v3Response;
}

// ============================================================================
// Validation Warning Generation
// ============================================================================

/**
 * Generate validation warnings for a V3 response.
 */
function generateValidationWarnings(
  graph: GraphV3T,
  options: OptionV3T[],
  goalNodeId: string
): ValidationWarningV3T[] {
  const warnings: ValidationWarningV3T[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const optionIdSummary = getOptionIdMismatchSummary(graph, options);

  // Check goal node exists
  if (!nodeIds.has(goalNodeId)) {
    warnings.push({
      code: "GOAL_NODE_MISSING",
      severity: "error",
      message: `Goal node "${goalNodeId}" not found in graph`,
      suggestion: "Ensure the graph contains a node with kind='goal'",
    });
  }

  // Note: Option nodes ARE now allowed in graph for connectivity (decision→option→factor)
  // Options also exist in the options[] array with intervention metadata

  // Check options
  for (const missingOptionId of optionIdSummary.missingOptionIds) {
    warnings.push({
      code: "OPTION_ID_MISMATCH",
      severity: "warn",
      message: `Option node "${missingOptionId}" has no matching entry in options[]`,
      affected_option_id: missingOptionId,
      suggestion: "Ensure options[] IDs match option node IDs in the graph",
    });
  }

  for (const extraOptionId of optionIdSummary.extraOptionIds) {
    warnings.push({
      code: "OPTION_ID_MISMATCH",
      severity: "warn",
      message: `Option "${extraOptionId}" exists in options[] but no option node matches`,
      affected_option_id: extraOptionId,
      suggestion: "Ensure options[] IDs match option node IDs in the graph",
    });
  }

  for (const option of options) {
    // Check for empty interventions on ready options
    if (option.status === "ready" && Object.keys(option.interventions ?? {}).length === 0) {
      warnings.push({
        code: "EMPTY_INTERVENTIONS_READY",
        severity: "warn",
        message: `Option "${option.id}" has status='ready' but no interventions`,
        affected_option_id: option.id,
        suggestion: "Either add interventions or change status to 'needs_user_mapping'",
      });
    }

    // Check intervention targets exist
    for (const [factorId, intervention] of Object.entries(option.interventions ?? {})) {
      if (!nodeIds.has(intervention.target_match.node_id)) {
        warnings.push({
          code: "INTERVENTION_TARGET_NOT_FOUND",
          severity: "error",
          message: `Intervention target "${intervention.target_match.node_id}" not found in graph`,
          affected_option_id: option.id,
          affected_node_id: intervention.target_match.node_id,
          suggestion: "Ensure the target node exists in the graph",
        });
      }

      // Check for low confidence matches
      if (intervention.target_match.confidence === "low") {
        warnings.push({
          code: "LOW_CONFIDENCE_MATCH",
          severity: "info",
          message: `Intervention for option "${option.id}" has low confidence match to factor "${factorId}"`,
          affected_option_id: option.id,
          affected_node_id: factorId,
          suggestion: "Review the intervention target mapping",
        });
      }
    }
  }

  // Check for duplicate node IDs
  const seenIds = new Set<string>();
  for (const node of graph.nodes) {
    if (seenIds.has(node.id)) {
      warnings.push({
        code: "DUPLICATE_NODE_ID",
        severity: "error",
        message: `Duplicate node ID "${node.id}"`,
        affected_node_id: node.id,
        suggestion: "Ensure all node IDs are unique",
      });
    }
    seenIds.add(node.id);
  }

  // P1-CEE-3: Check for negligible and low strength edges
  for (const edge of graph.edges) {
    const absMean = Math.abs(edge.strength.mean);

    if (absMean < EDGE_STRENGTH_LOW_THRESHOLD) {
      // Low strength edge (|mean| < 0.05, v2.7 schema)
      warnings.push({
        code: CIL_WARNING_CODES.EDGE_STRENGTH_LOW,
        severity: "info",
        message: `Edge from "${edge.from}" to "${edge.to}" has low strength (${edge.strength.mean.toFixed(3)})`,
        affected_node_id: edge.from,
        suggestion: "Review the strength of this relationship",
        details: {
          edge_id: `${edge.from}->${edge.to}`,
          mean: edge.strength.mean,
        },
      });
      emit(TelemetryEvents.EdgeStrengthLow ?? "cee.edge.strength_low", {
        edgeFrom: edge.from,
        edgeTo: edge.to,
        strengthMean: edge.strength.mean,
      });
    } else if (absMean < EDGE_STRENGTH_NEGLIGIBLE_THRESHOLD) {
      // Negligible edge (0.05 ≤ |mean| < 0.1)
      warnings.push({
        code: CIL_WARNING_CODES.EDGE_STRENGTH_NEGLIGIBLE,
        severity: "info",
        message: `Edge from "${edge.from}" to "${edge.to}" has negligible strength (${edge.strength.mean.toFixed(3)})`,
        affected_node_id: edge.from,
        suggestion: "Consider removing this edge or increasing its strength if the relationship is meaningful",
      });
      emit(TelemetryEvents.EdgeStrengthNegligible ?? "cee.edge.strength_negligible", {
        edgeFrom: edge.from,
        edgeTo: edge.to,
        strengthMean: edge.strength.mean,
      });
    }
  }

  return warnings;
}

/**
 * Validate a V3 response in strict mode.
 * Runs the full validator and throws an error if any validation errors are found.
 */
export function validateStrictModeV3(response: V3DraftGraphResponse): void {
  // Run full validation (schema + semantic checks)
  const result = validateV3Response(response);

  if (!result.valid) {
    const messages = result.errors.map((e) => e.message).join("; ");
    throw new Error(`V3 strict mode validation failed: ${messages}`);
  }
}

/**
 * Check if response needs user interaction (has needs_user_mapping options).
 */
export function needsUserMapping(response: V3DraftGraphResponse): boolean {
  return response.options.some((o) => o.status === "needs_user_mapping");
}

/**
 * Get summary statistics for a V3 response.
 */
export interface V3ResponseSummary {
  nodeCount: number;
  edgeCount: number;
  optionCount: number;
  readyOptions: number;
  needsMappingOptions: number;
  totalInterventions: number;
  validationErrorCount: number;
  validationWarningCount: number;
}

export function getV3ResponseSummary(response: V3DraftGraphResponse): V3ResponseSummary {
  const warnings = response.validation_warnings ?? [];

  return {
    nodeCount: response.nodes.length,
    edgeCount: response.edges.length,
    optionCount: response.options.length,
    readyOptions: response.options.filter((o) => o.status === "ready").length,
    needsMappingOptions: response.options.filter((o) => o.status === "needs_user_mapping").length,
    totalInterventions: response.options.reduce(
      (sum, o) => sum + Object.keys(o.interventions).length,
      0
    ),
    validationErrorCount: warnings.filter((w) => w.severity === "error").length,
    validationWarningCount: warnings.filter((w) => w.severity === "warn").length,
  };
}
