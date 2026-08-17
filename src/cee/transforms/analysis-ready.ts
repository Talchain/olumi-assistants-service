/**
 * Analysis-Ready Transformer
 *
 * Transforms V3 options to analysis-ready format for direct PLoT consumption.
 *
 * Key transformation:
 * - V3: interventions: Record<string, InterventionV3> (objects with metadata)
 * - Analysis-ready: interventions: Record<string, number> (plain numbers)
 *
 * @see CEE Workstream — Analysis-Ready Output (Complete Specification)
 */

import type {
  OptionV3T,
  GraphV3T,
  NodeV3T,
} from "../../schemas/cee-v3.js";
import type {
  OptionForAnalysisT,
  AnalysisReadyPayloadT,
  AnalysisReadyStatusT,
  AnalysisBlockerT,
  ModelAdjustmentT,
  ExtractionMetadataT,
} from "../../schemas/analysis-ready.js";
import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";
import { computeAnalysisReadyStatusWithReason } from "./option-status.js";
import { synthesiseDisplayValue } from "../factor-extraction/display-value.js";
import {
  magnitudeUnderScale,
  resolveMagnitudeScale,
} from "../provenance/stated-amounts.js";
import { readIsBaseline } from "../baseline-identity.js";
import { pickGoalThresholdTrio } from "../../utils/goal-threshold-trio.js";
import { classifyEncodedInterventionAdmissibility } from "../../orchestrator/shared/encoded-intervention-admissibility.js";
// ⭐ ROADMAP 2.1266 — ONE authority on repair-authored option→factor edges,
// shared with the V5 Run-admission projection in `analysis-ready-helper.ts`.
// Two readiness paths deciding independently which edges the repair invented is
// the two-authorities shape this estate keeps paying for (trap 21).
import { isRepairAuthoredOptionFactorEdge } from "../../graph/repair-authored-edge.js";

// ============================================================================
// Types
// ============================================================================

/**
 * F15: Fallback metadata from analysis-ready building — surfaced in trace.
 */
export interface AnalysisReadyFallbackMeta {
  fallback_count: number;
  fallback_sources: Array<{ optionId: string; factorId: string; source: string }>;
}

/**
 * Validation error for analysis-ready payload.
 */
export interface AnalysisReadyValidationError {
  code: string;
  message: string;
  field?: string;
}

/**
 * Validation result for analysis-ready payload.
 */
export interface AnalysisReadyValidationResult {
  valid: boolean;
  errors: AnalysisReadyValidationError[];
}

// ============================================================================
// Option Transformation
// ============================================================================

/**
 * Transform a V3 option to analysis-ready format.
 * Flattens InterventionV3 objects to plain numeric values.
 *
 * Supports the Raw+Encoded pattern:
 * - Extracts raw_value from InterventionV3 to build raw_interventions
 * - Status logic: needs_encoding when raw values exist but aren't fully encoded
 */
export function transformOptionToAnalysisReady(option: OptionV3T): OptionForAnalysisT {
  // Flatten interventions: Record<string, InterventionV3> -> Record<string, number>
  const interventions: Record<string, number> = {};
  // Build raw_interventions from raw_value fields (Raw+Encoded pattern)
  const rawInterventions: Record<string, number | string | boolean> = {};
  let hasRawValues = false;
  let hasNonNumericRaw = false;

  for (const [factorId, intervention] of Object.entries(option.interventions ?? {})) {
    const encodedAdmissibility = classifyEncodedInterventionAdmissibility(intervention);
    // Extract the encoded numeric value (always required)
    interventions[factorId] = intervention.value;

    // Explicit/mapped encoded carriers must prove one of the currently
    // faithful representations before the whole-model producer can call the
    // option ready. This also catches a claimed encoded type with no raw value.
    if (encodedAdmissibility === 'inadmissible') {
      hasNonNumericRaw = true;
    }

    // Check for raw_value in the intervention (Raw+Encoded pattern)
    if (intervention.raw_value !== undefined) {
      rawInterventions[factorId] = intervention.raw_value;
      hasRawValues = true;
      // Track if we have non-numeric raw values (categorical/boolean)
      if (
        typeof intervention.raw_value !== "number"
        && encodedAdmissibility !== 'admissible'
      ) {
        hasNonNumericRaw = true;
      }
    }
  }

  // Also carry through raw_interventions from option level if present
  if (option.raw_interventions) {
    for (const [factorId, rawValue] of Object.entries(option.raw_interventions)) {
      if (rawInterventions[factorId] === undefined) {
        rawInterventions[factorId] = rawValue;
        hasRawValues = true;
        if (typeof rawValue !== "number") {
          hasNonNumericRaw = true;
        }
      }
    }
  }

  // Build extraction metadata from first intervention's source/confidence
  let extractionMetadata: ExtractionMetadataT | undefined;
  const firstIntervention = Object.values(option.interventions ?? {})[0];
  if (firstIntervention) {
    extractionMetadata = {
      source: firstIntervention.source,
      confidence: firstIntervention.value_confidence ?? firstIntervention.target_match.confidence,
      reasoning: firstIntervention.reasoning,
    };
  } else if (option.provenance) {
    // Fallback to option provenance
    extractionMetadata = {
      source: option.provenance.source,
      confidence: "low",
      reasoning: option.provenance.brief_quote,
    };
  }

  // Determine status using shared utility for consistency across endpoints
  // Uses computeAnalysisReadyStatusWithReason() from option-status.ts
  //
  // Status rules:
  // - "ready": has interventions, no non-numeric raw values needing encoding
  // - "needs_encoding": has non-numeric raw values awaiting user encoding
  // - "needs_user_mapping": no interventions or option explicitly needs mapping
  const { status, reason: statusReason } = computeAnalysisReadyStatusWithReason(
    Object.keys(interventions).length,
    option.status,
    hasNonNumericRaw
  );

  const result: OptionForAnalysisT = {
    id: option.id,
    label: option.label,
    status,
    status_reason: statusReason,
    interventions,
    extraction_metadata: extractionMetadata,
  };

  // Only include raw_interventions if we have any (additive field)
  if (hasRawValues) {
    result.raw_interventions = rawInterventions;
  }

  return result;
}

// ============================================================================
// Payload Transformation
// ============================================================================

/**
 * Context for building analysis-ready payload.
 */
export interface AnalysisReadyContext {
  /** Suggested seed for reproducibility */
  seed?: string;
  /** Request ID for tracing */
  requestId?: string;
}

// ============================================================================
// is_baseline Detection (Task 3 / CEE-2)
// ============================================================================

/**
 * ⭐⭐ TIERED 2026-08-14 AFTER A MEASURED, DETERMINISTIC INVERSION. This list was
 * ONE flat set of eleven entries and the detector took the first match by array
 * index, so on the deployed build `41156fc` it flagged the CHANGE option as the
 * status quo on 3 of 3 `B_crm` draws:
 *
 *     is_baseline: true   "replace our current CRM with HubSpot next quarter"
 *     is_baseline: absent "keep what we have"        ← the ACTUAL status quo
 *
 * `"current"` matched inside *"replace our **current** CRM"* at index 0 and won
 * before *"**keep** what we have"* was ever tested. `is_baseline` tells the
 * analysis which option is the COMPARISON BASE, so an inverted flag corrupts
 * every comparison the user then reads.
 *
 * ── WHY TIERING AND NOT A BETTER FLAT LIST (trap 22f) ───────────────────────
 * The bare tokens below differ from the idioms in KIND, not in confidence. A
 * change option must NAME the thing it is changing, so it contains
 * "current"/"existing" as naturally as a status-quo option does — the token
 * carries no discriminating power at all, in either direction. No reordering
 * fixes that, and reordering is the "one more rule" this estate has burned four
 * rounds on. The idioms are different: they are whole phrases asserting that
 * NOTHING is done, and a change option cannot contain one without contradicting
 * itself.
 *
 * ⚠ THE ASYMMETRY THAT SETS THE THRESHOLD (trap 22b). A missed baseline is a
 * DISCLOSED GAP — the flag is absent, the analysis says so, nothing is asserted.
 * A wrong baseline is a LIE that silently rebases every comparison. Not
 * symmetric harms, so not a symmetric predicate: an ambiguous label yields NO
 * baseline rather than a guessed one.
 */
export const BASELINE_IDIOMS = [
  "status quo",
  "do nothing",
  "no change",
  "as-is",
  "as is",
  "baseline",
  // Multiword continuations. Whole phrases ONLY — the bare verbs "keep",
  // "stay" and "remain" live in the ambiguous set below, and it is exactly the
  // difference between "keep what we have" (a status quo) and "keep the rollout
  // on schedule" (a change) that the whole phrase captures and the bare token
  // cannot. "keep what we have" is the label that was measured LOSING to
  // "replace our current CRM"; it is here so that case resolves correctly rather
  // than merely stopping being wrong.
  "keep what we have",
  "keep things as they are",
  "keep what we've got",
  "leave things as they are",
  "leave it as it is",
  "carry on as we are",
  "stay as we are",
  "stay put",
  "remain as-is",
  "remain as is",
  // ⭐⭐ CONTINUATION COLLOCATIONS — added because the first cut of this tiering
  // CLOSED THE LIE AND OPENED A GAP, which is the trade trap 22b exists to stop
  // anyone making silently. Demoting the bare tokens correctly refused
  // "replace our current CRM", and it also lost "Maintain current strategy" and
  // "Keep existing process" — labels that ARE the status quo and that the repo's
  // own suite already pinned as detected.
  //
  // ⚠ AND THE FORM MATTERS MORE THAN THE MEMBERS. The obvious repair was a
  // PARSER — "a continuation verb governing a current-state token" — and it was
  // RUN BEFORE BEING COMMISSIONED (trap 22f(b)) against a corpus including
  // adversarial cases written outside the original design. It scored 2 of 7
  // WRONG: "stop maintaining the current system" and "migrate off our existing
  // platform, keeping current integrations" both matched, i.e. it reopened the
  // inversion in a new place. It was rejected rather than patched, because
  // patching an oscillating predicate is the sunk cost this estate has paid four
  // times.
  //
  // These are therefore CONTIGUOUS PHRASES, matched exactly as every idiom above
  // is — not a verb-object relation. That is why they are narrow enough to be
  // safe: "keeping current integrations" does not contain "keep current", and
  // "maintaining the current system" does not contain "maintain current". The
  // phrase form scored 14 of 14 on the same corpus, including both cases the
  // parser failed. Pinned in `value-carriage-and-baseline.test.ts`, both
  // directions.
  "maintain current",
  "maintain existing",
  "keep current",
  "keep existing",
  "retain current",
  "retain existing",
  "continue as we are",
  "continue with current",
];

/**
 * Tokens that merely REFERENCE the current state. Retained as a named, exported
 * set — NOT as detection input — because their exclusion is a DECISION with
 * measured evidence behind it, and a deleted list would leave the next reader to
 * rediscover why "current" is not baseline evidence. Asserted to be excluded by
 * `analysis-ready.baseline-tiering` rather than left as a comment.
 */
export const AMBIGUOUS_CURRENT_STATE_TOKENS = [
  "current",
  "existing",
  "stay",
  "remain",
  "keep",
];

/**
 * @deprecated The flat union that produced the inversion above. Kept ONLY so a
 * stale importer fails loudly at review rather than silently reverting to
 * first-match-wins behaviour; nothing in the detection path reads it.
 */
export const BASELINE_KEYWORDS = [...BASELINE_IDIOMS, ...AMBIGUOUS_CURRENT_STATE_TOKENS];

/**
 * Detect which option, if any, represents the status-quo baseline.
 *
 * Detection order (highest confidence first):
 * 1. Option has `is_baseline === true` set by the LLM (OptionV3T field).
 * 2. Option label matches a BASELINE_KEYWORD at a word boundary.
 *    If multiple options match rule 2, the first by array index wins.
 * 3. No match → returns `null` (no baseline marked).
 *
 * @param options - V3 options in their original order
 * @returns Index of the baseline option, or `null` if none detected
 */
/**
 * Test whether a single label matches any BASELINE_KEYWORD at a word boundary.
 * Shared between detectBaselineOptionIndex (CEE pipeline) and the persisted-
 * graph canonical readiness adapter.
 */
export function labelMatchesBaseline(label: string): boolean {
  const lower = label.toLowerCase();
  for (const kw of BASELINE_IDIOMS) {
    const escaped = kw.replace(/[-\s]/g, "[\\s\\-]");
    const re = new RegExp(`(?<![a-z0-9\\-])${escaped}(?![a-z0-9\\-])`, "i");
    if (re.test(lower)) return true;
  }
  return false;
}

function detectBaselineOptionIndex(options: OptionV3T[]): number | null {
  // Priority 1: LLM-provided flag. Read via the shared baseline-identity
  // reader (SINGLE SOURCE OF TRUTH) so this path reconciles the flag
  // identically to schema-v3 + auto-baseline-dedup. OptionV3T is already
  // flattened to the node-level surface, so this collapses to the same
  // `=== true` check — but going through the shared reader keeps every
  // baseline decision on one truth table.
  for (let i = 0; i < options.length; i++) {
    if (readIsBaseline({ is_baseline: options[i].is_baseline }) === true) return i;
  }

  // Priority 2: a baseline IDIOM, and only when exactly ONE option carries one.
  //
  // ⚠ UNIQUENESS IS PART OF THE PREDICATE, NOT A TIDY-UP. First-match-by-index
  // over a set that several options can satisfy is not a detection, it is an
  // arbitrary pick wearing a detection's name — which is precisely how
  // "replace our current CRM" beat "keep what we have". Two options both
  // asserting they change nothing is a degenerate draft, and there is no basis
  // for preferring either; returning null says so instead of flipping a coin.
  const idiomatic: number[] = [];
  for (let i = 0; i < options.length; i++) {
    if (labelMatchesBaseline(options[i].label)) idiomatic.push(i);
  }
  if (idiomatic.length === 1) return idiomatic[0]!;

  // No idiom, or several — no baseline is claimed. The flag is then absent
  // rather than wrong, and priority 1 above is the honest channel for the model
  // to say what a label cannot: the records grammar carries `is_baseline`
  // (grammar design note 5) precisely so this guess is no longer load-bearing.
  return null;
}

// ============================================================================
// Intervention Details (Task 4 / CEE-9)
// ============================================================================

/**
 * A single intervention detail entry for a factor.
 * Additive alongside the existing `interventions: Record<string, number>`.
 */
export interface InterventionDetail {
  /** Human-readable display string (e.g. "5 developers", "£200k", "High (0.7)") */
  display_value: string;
  /** Mirrors `interventions[factorId]` — normalised numeric value */
  normalised_value: number;
  /** Pre-normalisation value when available */
  raw_value?: number;
  /** Unit string when available */
  unit?: string;
}

/**
 * Build `intervention_details` for a single option using factor node metadata.
 *
 * For each intervention the caller provides `normalisedValue` (from
 * `interventions[factorId]`) and, optionally, a matching factor node from the
 * graph.  The display string is synthesised using the factor's display_value
 * (from the enricher/LLM), raw_value, unit, and factor_type. If none of that
 * is available the normalised value is rendered via the qualitative band.
 *
 * CEE-6 echo stripping: when the synthesised display string would be identical
 * to the factor label (case-insensitive trim), fall back to a pure numeric/
 * qualitative representation so the card interior doesn't just repeat the label.
 *
 * @param factorId - Factor node ID
 * @param normalisedValue - Normalised numeric intervention value
 * @param factorNode - Optional factor node from the V3 graph
 * @returns An InterventionDetail entry
 */
function buildInterventionDetail(
  factorId: string,
  normalisedValue: number,
  factorNode: NodeV3T | undefined,
  interventionDisplayValue?: string,
): InterventionDetail {
  // ⚠ F3 (Codex, 2026-08-13) — AN OPTION'S RECEIPT USED TO DESCRIBE THE FACTOR,
  // NOT THE OPTION. Every branch below returned the FACTOR's
  // `observed_state.raw_value` and, in the second branch, the FACTOR's
  // `display_value` — the same bytes for EVERY option that touches the factor.
  // On the brief "Plan A sets the support headcount to 80. Plan B sets it to
  // 50. It is currently 40", Plan A (level .8) and Plan B (level .5) both
  // showed `raw_value: 40` / "40": the status quo, presented as each option's
  // proposal. `synthesiseDisplayValue` prioritises `raw_value` over `value`
  // (display-value.ts:176), so the factor's raw won even though the option's
  // own level was passed beside it.
  //
  // THE SPEC: a display value must describe ITS OWN intervention. So the
  // option's magnitude is derived from the option's OWN level under the
  // factor's scale — the same `resolveMagnitudeScale` / `recoverScaleFrame`
  // authority the provenance seam uses, never a second derivation.
  //
  // ⚠ WHY THE TEST CORPUS COULD NOT SEE THIS: every pre-existing fixture sets
  // the intervention level EQUAL to the factor's observed value (0.5 on a
  // {0.5, 5} factor, 0.4 on a {0.4, 200000} factor). At equal levels the
  // borrowed value and the derived value COINCIDE, so 21 `intervention_details`
  // assertions and 18 `display_value` assertions all passed while the defect
  // was live. The corpus never varied two options on one factor — CLAUDE.md
  // trap 22, and the reason the RED fixtures below do exactly that.
  const os = factorNode?.observed_state;
  const unit = os?.unit;
  const factorType = factorNode?.factor_type ?? os?.factor_type;

  // Is this option sitting AT the factor's observed state? Only then does a
  // factor-scoped display string ("£200k") truthfully describe the option's
  // intervention. This is what keeps the baseline/status-quo option rendering
  // exactly as before while a genuinely different lever stops borrowing it.
  const sitsAtObservedState =
    typeof os?.value === "number" && os.value === normalisedValue;

  // The magnitude THIS option's level denotes, or null when the record settles
  // no denominator (zero baseline, no `raw_value`, no `observed_state`). Null
  // means the receipt omits `raw_value` rather than borrowing the factor's —
  // visible absence over confident wrongness.
  //
  // ⚠ FLOAT DIRT AT THE BASELINE (review of #944). The frame is RECOVERED as
  // `raw / value`, so re-deriving the baseline as `value × (raw / value)` is a
  // round-trip through binary floating point and does NOT always return the
  // input: a factor observed at 29 with frame 100 yields
  // `raw_value: 28.999999999999996` where the pre-fix receipt carried an exact
  // 29. It fails for ~2.3% of producer-domain pairs and lands precisely on the
  // STATUS-QUO option, i.e. the one case where the honest answer is already
  // recorded verbatim. So where this option sits at the observed state, the
  // recorded `raw_value` is returned DIRECTLY — no arithmetic to be dirty.
  // (The pre-existing `{0.5, 5}` fixtures round-trip exactly, which is why the
  // first version of this suite could not see it — trap 22, again.)
  const ownRawValue =
    sitsAtObservedState && typeof os?.raw_value === "number"
      ? os.raw_value
      : magnitudeUnderScale(normalisedValue, unit, resolveMagnitudeScale(os));

  const ownFields = {
    normalised_value: normalisedValue,
    ...(ownRawValue !== null && { raw_value: ownRawValue }),
    ...(unit !== undefined && { unit }),
  };

  // Highest priority: display_value on the intervention itself (LLM/enricher-
  // supplied). This lets the draft prompt provide per-intervention display
  // strings without having to mutate factor node state. It is already
  // per-intervention, so it is the option's own and is kept verbatim.
  if (interventionDisplayValue && interventionDisplayValue.trim().length > 0) {
    const factorLabel = (factorNode?.label ?? "").toLowerCase().trim();
    const candidate = interventionDisplayValue.toLowerCase().trim();
    const isEcho =
      factorLabel !== "" &&
      (candidate === factorLabel || candidate.includes(factorLabel));
    if (!isEcho) {
      return {
        display_value: interventionDisplayValue,
        ...ownFields,
      };
    }
  }

  // Prefer LLM/enricher-provided display_value on the factor node — but ONLY
  // when this option sits at the factor's observed state (see above). For any
  // other lever it is the status quo wearing the option's name.
  if (factorNode?.display_value && sitsAtObservedState) {
    const factorLabel = (factorNode.label ?? "").toLowerCase().trim();
    const candidate = factorNode.display_value.toLowerCase().trim();
    // CEE-6: strip echo — display_value must not be identical to or fully contain the
    // label (e.g. "Marketing Expertise" as display for the "Marketing Expertise" factor).
    // Guard against empty label: String.includes("") is always true, which would
    // incorrectly strip every LLM-provided display_value for unlabelled nodes.
    const isEcho =
      factorLabel !== "" &&
      (candidate === factorLabel || candidate.includes(factorLabel));

    if (!isEcho) {
      return {
        display_value: factorNode.display_value,
        ...ownFields,
      };
    }
  }

  // Synthesise from the option's OWN magnitude. When it is underivable,
  // `raw_value` is undefined and `synthesiseDisplayValue` falls through to its
  // normalised-value ladder (qualitative band / bare level) — which describes
  // this option's own lever and borrows nothing.
  const synthesised = synthesiseDisplayValue({
    value: normalisedValue,
    raw_value: ownRawValue ?? undefined,
    unit,
    factor_type: factorType,
  });

  const displayValue = synthesised ?? String(parseFloat(normalisedValue.toFixed(2)));

  // CEE-6 echo check on synthesised value: only strip when display is identical to
  // or fully contains the label. Do NOT strip when the label contains the display
  // value as a substring — that would incorrectly discard valid qualitative band
  // output (e.g. "High (0.7)" for a factor labelled "High Risk").
  const factorLabel = (factorNode?.label ?? "").toLowerCase().trim();
  const displayLower = displayValue.toLowerCase().trim();
  const isEcho =
    factorLabel !== "" &&
    (displayLower === factorLabel || displayLower.includes(factorLabel));

  const finalDisplay = isEcho
    ? String(parseFloat(normalisedValue.toFixed(2)))
    : displayValue;

  return {
    display_value: finalDisplay,
    ...ownFields,
  };
}

/**
 * Build analysis-ready payload from V3 options and graph.
 *
 * Supports the Raw+Encoded pattern:
 * - Payload status is "needs_encoding" when any option needs encoding
 * - This is separate from "needs_user_mapping" (missing values)
 *
 * @param options - V3 options array
 * @param goalNodeId - Goal node ID
 * @param graph - V3 graph (for validation)
 * @param context - Optional context
 * @returns Analysis-ready payload
 */
export function buildAnalysisReadyPayload(
  options: OptionV3T[],
  goalNodeId: string,
  graph: GraphV3T,
  context: AnalysisReadyContext = {}
): AnalysisReadyPayloadT & { _fallback_meta?: AnalysisReadyFallbackMeta } {
  // Transform all options
  const analysisOptions = options.map(transformOptionToAnalysisReady);

  // === is_baseline detection (CEE-2) ===
  // Mark exactly one option as the status-quo baseline, based on LLM flag or
  // label keyword matching. This is additive — no existing field is modified.
  const baselineIdx = detectBaselineOptionIndex(options);
  if (baselineIdx !== null) {
    analysisOptions[baselineIdx].is_baseline = true;
  }

  // === Task 2A+2B: Factor value fallback + blocker emission ===
  // For qualitative briefs, V3 options may have empty interventions because
  // enrichment didn't set data.value on factor nodes. We recover values from
  // the V3 factor node's observed_state or V1 data field (preserved via passthrough).
  const blockers: AnalysisBlockerT[] = [];
  // What we DECLINED to substitute, and from where. Recorded for the trace so
  // the refusal is observable — an operator can see how often a current level
  // was available and deliberately not used as an option's lever.
  const declinedFallbacks: Array<{ optionId: string; factorId: string; source: string }> = [];

  // Build factor node lookup and node kind map
  const factorNodeMap = new Map<string, NodeV3T>();
  const nodeKindLookup = new Map<string, string>();
  for (const node of graph.nodes) {
    nodeKindLookup.set(node.id, node.kind);
    if (node.kind === "factor") {
      factorNodeMap.set(node.id, node);
    }
  }

  // Build option→factor adjacency from V3 graph edges.
  //
  // ⛔ REPAIR-AUTHORED EDGES ARE EXCLUDED — ROADMAP 2.1266. THE PRODUCT MUST NOT
  // BILL THE USER FOR ITS OWN INVENTIONS.
  //
  // `fixStatusQuoConnectivity` wires each DISCONNECTED option to the UNION of
  // every factor the CONNECTED options target, so the graph acquires a path to
  // goal and the draft is not lost at the 422 fail-closed gate
  // (`repair/graph-enforcement.ts:665`, reached because `NO_PATH_TO_GOAL` is
  // `severity: "error"` — `validators/graph-validator.ts:626`). Those edges carry
  // no intervention value, and this loop used to mint one `MISSING_OPTION_VALUE`
  // blocker for each of them: measured 14 asks on a brief-04-shaped graph
  // (2 disconnected options × 7 union targets), asked in the user's own name
  // ("What should option \"C\" set it to?") with nothing saying the product had
  // drawn the link itself.
  //
  // ⚠ WHAT SUPPRESSING THEM DOES **NOT** DO — checked, because the dangerous
  // outcome would be flipping the model to `ready` with a numerically inert
  // option, i.e. the exact harm the NO-SILENT-INVENTION block below removed. It
  // cannot: an option whose `interventions` are empty sets `hasIncompleteOptions`
  // (:803-805), so `payloadStatus` falls to `needs_user_mapping` (:923) and
  // `user_questions` carries the ONE true question — which factor does this
  // option change, and by how much — instead of seven false ones. Fewer asks AND
  // a non-ready model; nothing is analysed on invented magnitudes.
  //
  // The wiring itself stays disclosed: `STATUS_QUO_WIRED` rides
  // `trace.pipeline.repair_summary.deterministic_repairs[]`
  // (`stages/package.ts:751-752`), which the UI renders — see the adjudication in
  // `stages/boundary.ts:31-40` for why it cannot become a `model_adjustments` row
  // without a new `@talchain/schemas` contract member.
  //
  // `optionEdgeTargets` (:854) is DELIBERATELY left reading every edge: it
  // answers a different question ("is this factor connected to any option at
  // all?") and the repair's targets always carry a real edge from a connected
  // option by construction, since the union is taken FROM those options.
  const optionFactorAdj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (nodeKindLookup.get(edge.from) === "option" && nodeKindLookup.get(edge.to) === "factor") {
      if (isRepairAuthoredOptionFactorEdge(edge, nodeKindLookup)) continue;
      const list = optionFactorAdj.get(edge.from) ?? [];
      list.push(edge.to);
      optionFactorAdj.set(edge.from, list);
    }
  }

  // For each analysis option, fill missing interventions from factor node values
  for (let i = 0; i < analysisOptions.length; i++) {
    const analysisOpt = analysisOptions[i];
    const v3Option = options[i]; // Parallel array — same index
    const connectedFactors = optionFactorAdj.get(v3Option.id) ?? [];

    for (const factorId of connectedFactors) {
      // Skip if option already has an intervention for this factor
      if (analysisOpt.interventions[factorId] !== undefined) continue;

      const factorNode = factorNodeMap.get(factorId);
      if (!factorNode) continue;

      // Task 6: Only skip if category is explicitly set to a non-controllable value.
      // When category is undefined but an option→factor edge exists, treat as
      // potentially controllable (the edge IS the signal).
      if (factorNode.category && factorNode.category !== "controllable") continue;

      // ⛔ NO SILENT INVENTION. This branch used to WRITE a value here —
      // `observed_state.value`, else the V1 `data.value` passthrough — into an
      // option that had none.
      //
      // Neither is a statement about THIS OPTION. `observed_state.value` is the
      // factor's CURRENT level, i.e. what happens if nobody acts; writing it as
      // the option's intervention asserts "this option sets churn to 0.12",
      // which the user never said. It is invention with a citation, and it is
      // the more persuasive kind because the number is real — just an answer to
      // a different question (CLAUDE.md trap 21).
      //
      // Two measured consequences, both of which the refusal removes:
      //  · Every option with no stated magnitude received the SAME value (the
      //    shared baseline), so the analysis compared strategies that were
      //    numerically identical while reporting itself ready.
      //  · Public `options[]` showed `{}` while this copy showed a value, so
      //    THE SET SHOWN AND THE SET ANALYSED WERE DIFFERENT OBJECTS WITH
      //    DIFFERENT CONTENTS.
      //
      // A path that can only proceed by inventing must refuse, and say why.
      // The blocker below is that refusal: it names the option, the factor and
      // the action needed, so the gap is visible rather than papered over.
      const factorLabel = factorNode.label ?? factorId ?? "Unknown factor";
      const observedValue = factorNode.observed_state?.value;
      const rawData = (factorNode as Record<string, unknown>).data;
      const dataValue =
        typeof rawData === "object" && rawData !== null && "value" in rawData
          ? (rawData as { value: unknown }).value
          : undefined;
      const currentLevel =
        typeof observedValue === "number"
          ? observedValue
          : typeof dataValue === "number"
            ? dataValue
            : undefined;
      if (currentLevel !== undefined) {
        declinedFallbacks.push({
          optionId: analysisOpt.id,
          factorId,
          source: typeof observedValue === "number" ? "observed_state" : "data.value",
        });
      }

      blockers.push({
        option_id: analysisOpt.id,
        option_label: analysisOpt.label,
        factor_id: factorId,
        factor_label: factorLabel,
        blocker_type: "missing_value",
        // Knowing the current level is genuinely useful to the user — it just
        // is not an answer. Say both things rather than substituting one for
        // the other.
        message:
          currentLevel !== undefined
            ? `Factor "${factorLabel}" is currently ${currentLevel}. What should option "${analysisOpt.label}" set it to?`
            : `Factor "${factorLabel}" needs a numeric value for option "${analysisOpt.label}"`,
        suggested_action: "add_value",
      });
    }

    // ⛔ NOTHING RE-EVALUATES STATUS HERE ANY MORE, AND THAT IS THE POINT.
    //
    // A promotion block stood here: when the fallback had filled interventions
    // it flipped this COPY to "ready" while public `options[]` — the object the
    // team is shown — stayed `needs_user_mapping`. The product refused in the
    // panel and offered an executable "Run the analysis" chip at the same
    // moment: `chip-generator.ts` reads `input.analysisReady?.status` (:310)
    // and gates the run chip on it (:358). ⚠ Note the hop — it reads the
    // PAYLOAD status, never a per-option one (zero per-option status reads in
    // that file). A per-option promotion reached the chip only because the
    // payload status is derived from the option statuses. The causal chain is
    // real; describing it as "the chip reads this status" was one hop short.
    //
    // ⚠ WHAT THIS DOES AND DOES NOT GUARANTEE — an earlier version of this
    // comment claimed the two surfaces "cannot disagree BY CONSTRUCTION". That
    // is FALSIFIED, and the falsifying call site is downstream of this file:
    //
    //   `repairFactorScaleConsistency` (`graph-data-integrity.ts:171-177`)
    //   binds `v3Body.analysis_ready.options` and MUTATES
    //   `option.interventions[factorId]` IN PLACE (:285-295). It runs at
    //   `boundary.ts:63` — AFTER `transformResponseToV3` computed status at
    //   :37 — and it never touches public `v3Body.options` (0 hits; contrast
    //   control `analysis_ready.options` = 6, positive control `v3Body` = 18).
    //
    // So the honest, narrow claim: no KEY can be added to `interventions` after
    // its status is computed, because the only writer that did so is gone. The
    // broad claim does not hold — a later pass can still change a VALUE on this
    // copy without changing the public one, so the two sets can diverge in
    // CONTENT even while their statuses agree.
    //
    // "By construction" is exactly the class of claim one missed call site
    // falsifies. State what the code supports.
  }

  // Task 7: Deduplicate blockers by (option_id, factor_id) pair
  const blockerKeys = new Set<string>();
  const dedupedBlockers: AnalysisBlockerT[] = [];
  for (const blocker of blockers) {
    const key = `${blocker.option_id ?? "_all_"}::${blocker.factor_id}`;
    if (!blockerKeys.has(key)) {
      blockerKeys.add(key);
      dedupedBlockers.push(blocker);
    }
  }

  if (declinedFallbacks.length > 0 || dedupedBlockers.length > 0) {
    log.info({
      event: "cee.analysis_ready.fallback_declined",
      request_id: context.requestId,
      declined_count: declinedFallbacks.length,
      blocker_count: dedupedBlockers.length,
      declined_sources: declinedFallbacks,
    }, `analysis-ready: declined ${declinedFallbacks.length} factor-level substitution(s) rather than invent an option's lever, ${dedupedBlockers.length} blocker(s)`);
  }
  // === End Task 2A+2B ===

  // === intervention_details (CEE-9 / CEE-6) ===
  // Build a richer display-oriented map alongside the existing numeric-only
  // `interventions`. Each entry includes a human-readable display_value, the
  // normalised numeric value, and optional raw_value/unit from factor metadata.
  // CEE-6 echo stripping is applied inside buildInterventionDetail.
  for (let i = 0; i < analysisOptions.length; i++) {
    const analysisOpt = analysisOptions[i];
    const v3Option = options[i];
    const interventionEntries = Object.entries(analysisOpt.interventions);
    if (interventionEntries.length === 0) continue;

    const details: Record<string, InterventionDetail> = {};
    for (const [factorId, interventionEntry] of interventionEntries) {
      const factorNode = factorNodeMap.get(factorId);
      // Interventions may be a bare number or a rich { value, ... } object
      // (from upstream transforms or a prior upgrade pass). Unwrap for
      // detail building; the raw entry is kept as-is until the upgrade step.
      const numericValue = typeof interventionEntry === 'number'
        ? interventionEntry
        : (interventionEntry as { value?: unknown })?.value;
      if (typeof numericValue !== 'number') continue;
      const v3Intervention = v3Option?.interventions?.[factorId];
      const llmDisplayValue = v3Intervention && typeof (v3Intervention as { display_value?: unknown }).display_value === 'string'
        ? (v3Intervention as { display_value: string }).display_value
        : undefined;
      details[factorId] = buildInterventionDetail(factorId, numericValue, factorNode, llmDisplayValue);
    }
    analysisOpt.intervention_details = details;

    // Upgrade pass: attach display_value directly onto each intervention
    // object in the flat map, but ONLY when the display_value is materially
    // different from the bare numeric representation. UI consumers read
    // from analysis_ready.options[].interventions (unwrapping via
    // unwrapInterventionValue); having display_value there avoids a
    // separate intervention_details lookup. flattenInterventions on the
    // CEE side (pre-PLoT) strips the wrapper back to a bare number, so
    // inference is unaffected.
    //
    // Contract preservation: when buildInterventionDetail only has the
    // numeric fallback to show (`String(parseFloat(n.toFixed(2)))`), the
    // intervention stays a bare number. This keeps the common case (plain
    // normalised factors without unit / LLM display_value) flat and
    // preserves backward compatibility with callers that expect
    // `interventions[factorId]` to be a number.
    for (const [factorId, detail] of Object.entries(details)) {
      if (!detail.display_value) continue;
      const current = analysisOpt.interventions[factorId];
      const numericValue = typeof current === 'number'
        ? current
        : typeof (current as { value?: unknown })?.value === 'number'
          ? (current as { value: number }).value
          : null;
      if (numericValue == null) continue;
      const bareFallback = String(parseFloat(numericValue.toFixed(2)));
      // Skip upgrade when display_value is just the numeric fallback — no
      // meaningful human-readable string was produced.
      if (detail.display_value === bareFallback) continue;
      const v3Intervention = v3Option?.interventions?.[factorId];
      const source = v3Intervention && typeof (v3Intervention as { source?: unknown }).source === 'string'
        ? (v3Intervention as { source: string }).source
        : undefined;
      (analysisOpt.interventions as Record<string, unknown>)[factorId] = {
        value: numericValue,
        ...(source ? { source } : {}),
        display_value: detail.display_value,
      };
    }
  }
  // === End intervention_details ===

  // Determine status based on transformed options (Raw+Encoded pattern)
  // Priority: needs_user_mapping > needs_encoding > ready
  const hasIncompleteOptions = analysisOptions.some(
    (o) => o.status === "needs_user_mapping" || Object.keys(o.interventions).length === 0
  );
  const hasEncodingNeeded = analysisOptions.some(
    (o) => o.status === "needs_encoding"
  );

  // Collect user questions from options that need mapping
  const userQuestions: string[] = [];
  for (const option of options) {
    if (option.user_questions) {
      userQuestions.push(...option.user_questions);
    }
  }

  // Deduplicate user questions
  const uniqueQuestions = [...new Set(userQuestions)];

  // Generate fallback questions for incomplete options without explicit questions
  // This ensures the payload passes validation (needs_user_mapping requires user_questions)
  if (hasIncompleteOptions && uniqueQuestions.length === 0) {
    const incompleteOptionLabels = analysisOptions
      .filter((o) => o.status === "needs_user_mapping" || Object.keys(o.interventions).length === 0)
      .map((o) => o.label)
      .slice(0, 3); // Limit to first 3 for readability

    if (incompleteOptionLabels.length > 0) {
      uniqueQuestions.push(
        `Which factors and values should be specified for: ${incompleteOptionLabels.join(", ")}?`
      );
    } else {
      // Fallback if somehow we have no labels
      uniqueQuestions.push("What factor values should be used for the incomplete options?");
    }
  }

  // Count options by status for telemetry
  const readyOptionsCount = analysisOptions.filter(
    (o) => o.status === "ready"
  ).length;
  const optionsNeedingEncoding = analysisOptions.filter(
    (o) => o.status === "needs_encoding"
  ).length;
  const optionsNeedingMapping = analysisOptions.filter(
    (o) => o.status === "needs_user_mapping" || Object.keys(o.interventions).length === 0
  ).length;

  // === Unreachable controllable factor check ===
  // Check if any factor nodes in the graph have zero inbound option→factor edges
  // AND zero factor→factor inbound edges from a factor that does have option edges.
  // Only controllable factors (not external) trigger this blocker.
  const optionEdgeTargets = new Set<string>();
  for (const edge of graph.edges) {
    if (nodeKindLookup.get(edge.from) === "option" && nodeKindLookup.get(edge.to) === "factor") {
      optionEdgeTargets.add(edge.to);
    }
  }

  // BFS through factor→factor edges to find transitively reachable factors
  const factorForwardAdj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (nodeKindLookup.get(edge.from) === "factor" && nodeKindLookup.get(edge.to) === "factor") {
      const list = factorForwardAdj.get(edge.from) ?? [];
      list.push(edge.to);
      factorForwardAdj.set(edge.from, list);
    }
  }
  const transitivelyReachableFactors = new Set<string>(optionEdgeTargets);
  const bfsQueue = [...optionEdgeTargets];
  while (bfsQueue.length > 0) {
    const current = bfsQueue.shift()!;
    for (const next of factorForwardAdj.get(current) ?? []) {
      if (!transitivelyReachableFactors.has(next)) {
        transitivelyReachableFactors.add(next);
        bfsQueue.push(next);
      }
    }
  }

  // Build set of factors that already have interventions in the options
  const factorsWithInterventions = new Set<string>();
  for (const opt of analysisOptions) {
    for (const factorId of Object.keys(opt.interventions ?? {})) {
      factorsWithInterventions.add(factorId);
    }
  }

  // Find unreachable controllable factors
  const unreachableControllableBlockers: AnalysisBlockerT[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== "factor") continue;
    // Exclude constraint nodes by ID prefix (compound-goals creates constraint_* nodes with kind=constraint,
    // but guard against any that might be mis-tagged as factor)
    if (node.id.startsWith("constraint_")) continue;
    if (transitivelyReachableFactors.has(node.id)) continue;
    // Skip factors that already have mapped interventions (reachable via V3 option data)
    if (factorsWithInterventions.has(node.id)) continue;
    // Only controllable factors (or undefined category) trigger this blocker.
    // External and observable factors are contextual — they influence outcomes but
    // aren't intervention targets, so they're legitimate without option connections.
    const category = node.category;
    if (category === "external") continue;
    if (category === "observable") continue;
    // Only category === "controllable" or category === undefined triggers blocker
    unreachableControllableBlockers.push({
      factor_id: node.id,
      factor_label: node.label ?? node.id,
      blocker_type: "missing_value" as const,
      message: `Factor "${node.label ?? node.id}" is not connected to any option`,
      suggested_action: "add_value" as const,
    });
  }
  // === End unreachable controllable factor check ===

  // Determine payload status (priority: needs_user_input > needs_user_mapping > needs_encoding > ready)
  let payloadStatus: AnalysisReadyStatusT;
  if (dedupedBlockers.length > 0) {
    payloadStatus = "needs_user_input";
  } else if (unreachableControllableBlockers.length > 0) {
    payloadStatus = "needs_user_mapping";
  } else if (hasIncompleteOptions) {
    payloadStatus = "needs_user_mapping";
  } else if (hasEncodingNeeded) {
    payloadStatus = "needs_encoding";
  } else {
    payloadStatus = "ready";
  }

  // Look up goal node for threshold fields
  const goalNode = graph.nodes.find((n) => n.id === goalNodeId);

  const payload: AnalysisReadyPayloadT = {
    options: analysisOptions,
    goal_node_id: goalNodeId,
    status: payloadStatus,
    bias_findings: [],
    ...(goalNode?.goal_threshold != null && { goal_threshold: goalNode.goal_threshold }),
    // ROADMAP 2.315(a) — carry the RAW goal target beside the normalised one.
    // `goal_threshold` alone left consumers unable to recover the user's own
    // figure: a £800,000 target surfaced as "reaching ≥ 0.8 count".
    // RAW-ANCHORED: raw may ride alone, cap and unit only alongside it, so a
    // cap can never arm the consumer's `norm × cap` re-derivation (see
    // utils/goal-threshold-trio.ts). Carried verbatim from the enricher's
    // attested mint; never recomputed here.
    ...pickGoalThresholdTrio(goalNode),
  };

  // Add user_questions when status is needs_user_mapping
  // (uniqueQuestions is guaranteed to be non-empty due to fallback above)
  if (payload.status === "needs_user_mapping") {
    // Generate questions for unreachable factors if needed
    if (unreachableControllableBlockers.length > 0 && uniqueQuestions.length === 0) {
      const factorLabels = unreachableControllableBlockers
        .map((b) => b.factor_label)
        .slice(0, 3);
      uniqueQuestions.push(
        `Which options should affect: ${factorLabels.join(", ")}?`
      );
    }
    payload.user_questions = uniqueQuestions;
  }

  // Add blockers when status is needs_user_input (Task 2B, deduplicated per Task 7)
  if (dedupedBlockers.length > 0) {
    payload.blockers = dedupedBlockers;
  }

  // Add unreachable controllable factor blockers (informational, alongside existing blockers)
  if (unreachableControllableBlockers.length > 0) {
    if (!payload.blockers) payload.blockers = [];
    payload.blockers.push(...unreachableControllableBlockers);
  }

  // Emit telemetry with option status breakdown for observability
  emit(TelemetryEvents.AnalysisReadyBuilt ?? "cee.analysis_ready.built", {
    optionCount: analysisOptions.length,
    status: payload.status,
    userQuestionCount: uniqueQuestions.length,
    goalNodeId,
    requestId: context.requestId,
    // Option status breakdown (P0 observability)
    readyOptionsCount,
    optionsNeedingEncoding,
    optionsNeedingMapping,
    // Task 2A+2B observability
    declinedFallbackCount: declinedFallbacks.length,
    blockerCount: dedupedBlockers.length,
  });

  // F15: Attach fallback metadata for trace surfacing. `fallback_count` is now
  // always 0 by construction — no value is ever substituted — and the sources
  // list records what was DECLINED, so the trace shows the refusal happening
  // rather than falling silent about a path that no longer fires.
  if (declinedFallbacks.length > 0) {
    // AnalysisReadyPayload uses .passthrough() — _fallback_meta is a runtime-only trace field
    (payload as Record<string, unknown>)._fallback_meta = {
      fallback_count: 0,
      fallback_sources: declinedFallbacks,
    };
  }

  return payload;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate analysis-ready payload against graph and V3 options.
 *
 * Rules from spec:
 * 1. All option IDs in payload must match V3 options (cross-check)
 * 2. Goal node must exist in graph where kind="goal"
 * 3. All intervention factor IDs must exist in graph nodes where kind="factor"
 * 4. Intervention values must be numbers (enforced by type)
 * 5. Status consistency: needs_user_mapping requires user_questions
 *
 * @param payload - Analysis-ready payload to validate
 * @param graph - V3 graph for node validation
 * @param v3Options - Optional V3 options for cross-checking option IDs
 */
export function validateAnalysisReadyPayload(
  payload: AnalysisReadyPayloadT,
  graph: GraphV3T,
  v3Options?: OptionV3T[]
): AnalysisReadyValidationResult {
  const errors: AnalysisReadyValidationError[] = [];

  // Build lookup sets for efficient validation
  const factorNodeIds = new Set(
    graph.nodes.filter((n) => n.kind === "factor").map((n) => n.id)
  );
  const goalNodeIds = new Set(
    graph.nodes.filter((n) => n.kind === "goal").map((n) => n.id)
  );
  const allNodeIds = new Set(graph.nodes.map((n) => n.id));
  const nodeKindMap = new Map(graph.nodes.map((n) => [n.id, n.kind]));

  // Rule 1: Option IDs must match V3 options (if provided)
  if (v3Options) {
    const v3OptionIds = new Set(v3Options.map((o) => o.id));
    for (const option of payload.options) {
      if (!v3OptionIds.has(option.id)) {
        errors.push({
          code: "OPTION_ID_MISMATCH",
          message: `Option "${option.id}" in analysis_ready not found in V3 options`,
          field: `options[${option.id}].id`,
        });
      }
    }
  }

  // Rule 2: Goal node must exist with kind="goal"
  if (!goalNodeIds.has(payload.goal_node_id)) {
    // Check if it exists at all but with wrong kind
    if (allNodeIds.has(payload.goal_node_id)) {
      const nodeKind = nodeKindMap.get(payload.goal_node_id);
      errors.push({
        code: "GOAL_NODE_WRONG_KIND",
        message: `Goal node "${payload.goal_node_id}" exists but has kind="${nodeKind}" instead of "goal"`,
        field: "goal_node_id",
      });
    } else {
      errors.push({
        code: "GOAL_NODE_NOT_FOUND",
        message: `Goal node "${payload.goal_node_id}" not found in graph`,
        field: "goal_node_id",
      });
    }
  }

  // Rule 3: All intervention factor IDs must exist with kind="factor"
  for (const option of payload.options) {
    for (const factorId of Object.keys(option.interventions ?? {})) {
      if (!factorNodeIds.has(factorId)) {
        // Check if it exists at all but with wrong kind
        if (allNodeIds.has(factorId)) {
          const nodeKind = nodeKindMap.get(factorId);
          errors.push({
            code: "INTERVENTION_TARGET_WRONG_KIND",
            message: `Intervention target "${factorId}" in option "${option.id}" has kind="${nodeKind}" instead of "factor"`,
            field: `options[${option.id}].interventions.${factorId}`,
          });
        } else {
          errors.push({
            code: "INTERVENTION_FACTOR_NOT_FOUND",
            message: `Factor "${factorId}" in option "${option.id}" not found in graph`,
            field: `options[${option.id}].interventions.${factorId}`,
          });
        }
      }
    }
  }

  // Rule 4: Intervention values must resolve to finite numbers.
  //
  // Interventions may be bare numbers (legacy shape) or rich
  // { value, display_value?, source? } objects (presentation upgrade).
  // Both resolve to the same numeric value for PLoT; we validate the
  // resolved number rather than the wrapping shape.
  for (const option of payload.options) {
    for (const [factorId, entry] of Object.entries(option.interventions ?? {})) {
      const numeric = typeof entry === 'number'
        ? entry
        : entry != null && typeof entry === 'object' && typeof (entry as { value?: unknown }).value === 'number'
          ? (entry as { value: number }).value
          : undefined;
      if (numeric === undefined) {
        errors.push({
          code: "INTERVENTION_NOT_NUMBER",
          message: `Intervention "${factorId}" in option "${option.id}" is not a number: ${typeof entry}`,
          field: `options[${option.id}].interventions.${factorId}`,
        });
        continue;
      }
      if (!Number.isFinite(numeric)) {
        errors.push({
          code: "INTERVENTION_INVALID_NUMBER",
          message: `Intervention "${factorId}" in option "${option.id}" has invalid number: ${numeric}`,
          field: `options[${option.id}].interventions.${factorId}`,
        });
      }
    }
  }

  // Rule 5: Status consistency
  const hasEmptyInterventions = payload.options.some(
    (o) => Object.keys(o.interventions ?? {}).length === 0
  );

  if (hasEmptyInterventions && payload.status === "ready") {
    errors.push({
      code: "STATUS_INCONSISTENT",
      message: "Status is 'ready' but some options have empty interventions",
      field: "status",
    });
  }

  if (payload.status === "needs_user_mapping" && (!payload.user_questions || payload.user_questions.length === 0)) {
    errors.push({
      code: "MISSING_USER_QUESTIONS",
      message: "Status is 'needs_user_mapping' but no user_questions provided",
      field: "user_questions",
    });
  }

  // Rule 5b: needs_user_input requires blockers (Phase 2B)
  if (payload.status === "needs_user_input" && (!payload.blockers || payload.blockers.length === 0)) {
    errors.push({
      code: "NEEDS_USER_INPUT_WITHOUT_BLOCKERS",
      message: "Status is 'needs_user_input' but no blockers provided",
      field: "blockers",
    });
  }

  // Rule 6: needs_encoding status consistency (Raw+Encoded pattern)
  // When status is "needs_encoding", at least one option should have raw_interventions
  // with non-numeric values that justify the encoding requirement
  if (payload.status === "needs_encoding") {
    const hasRawInterventions = payload.options.some(
      (o) => o.raw_interventions && Object.keys(o.raw_interventions).length > 0
    );

    if (!hasRawInterventions) {
      errors.push({
        code: "NEEDS_ENCODING_WITHOUT_RAW",
        message: "Status is 'needs_encoding' but no options have raw_interventions",
        field: "status",
      });
    }

    // Check that at least one raw value is non-numeric (categorical/boolean)
    const hasNonNumericRaw = payload.options.some((o) => {
      if (!o.raw_interventions) return false;
      return Object.values(o.raw_interventions).some((v) => typeof v !== "number");
    });

    if (hasRawInterventions && !hasNonNumericRaw) {
      // All raw values are numeric - should be "ready" not "needs_encoding"
      errors.push({
        code: "NEEDS_ENCODING_ALL_NUMERIC",
        message: "Status is 'needs_encoding' but all raw_interventions are already numeric",
        field: "status",
      });
    }
  }

  // Rule 7: Option-level status consistency with raw_interventions
  for (const option of payload.options) {
    if (option.status === "needs_encoding") {
      // Option claims to need encoding, should have raw_interventions
      if (!option.raw_interventions || Object.keys(option.raw_interventions).length === 0) {
        errors.push({
          code: "OPTION_NEEDS_ENCODING_WITHOUT_RAW",
          message: `Option "${option.id}" has status 'needs_encoding' but no raw_interventions`,
          field: `options[${option.id}].raw_interventions`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate and log results, emitting telemetry on failure.
 *
 * @param payload - Analysis-ready payload to validate
 * @param graph - V3 graph for node validation
 * @param v3Options - Optional V3 options for cross-checking option IDs
 * @param requestId - Optional request ID for tracing
 */
export function validateAndLogAnalysisReady(
  payload: AnalysisReadyPayloadT,
  graph: GraphV3T,
  v3Options?: OptionV3T[],
  requestId?: string
): AnalysisReadyValidationResult {
  const result = validateAnalysisReadyPayload(payload, graph, v3Options);

  if (!result.valid) {
    // Emit telemetry event for observability
    emit(TelemetryEvents.AnalysisReadyValidationFailed, {
      request_id: requestId,
      error_count: result.errors.length,
      error_codes: result.errors.map((e) => e.code),
      option_count: payload.options.length,
      goal_node_id: payload.goal_node_id,
    });

    // Log warning with full error details
    log.warn({
      request_id: requestId,
      error_count: result.errors.length,
      errors: result.errors,
    }, `Analysis-ready validation failed with ${result.errors.length} error(s)`);
  }

  return result;
}

// ============================================================================
// Summary Statistics
// ============================================================================

/**
 * Summary statistics for analysis-ready payload.
 */
export interface AnalysisReadySummary {
  optionCount: number;
  totalInterventions: number;
  averageInterventionsPerOption: number;
  status: "ready" | "needs_user_mapping" | "needs_encoding" | "needs_user_input" | "blocked";
  userQuestionCount: number;
  readyOptions: number;
  incompleteOptions: number;
}

/**
 * Get summary statistics for analysis-ready payload.
 */
export function getAnalysisReadySummary(payload: AnalysisReadyPayloadT): AnalysisReadySummary {
  const totalInterventions = payload.options.reduce(
    (sum, o) => sum + Object.keys(o.interventions).length,
    0
  );

  const incompleteOptions = payload.options.filter(
    (o) => Object.keys(o.interventions).length === 0
  ).length;

  return {
    optionCount: payload.options.length,
    totalInterventions,
    averageInterventionsPerOption:
      payload.options.length > 0 ? totalInterventions / payload.options.length : 0,
    status: payload.status,
    userQuestionCount: payload.user_questions?.length ?? 0,
    readyOptions: payload.options.length - incompleteOptions,
    incompleteOptions,
  };
}

// ============================================================================
// Model Adjustments Mapping (Task 2C)
// ============================================================================

/**
 * STRP mutation code → user-facing ModelAdjustment code.
 * Only codes with a mapping are surfaced; unmapped codes are internal-only.
 */
const STRP_CODE_MAP: Record<string, ModelAdjustmentT["code"]> = {
  CATEGORY_OVERRIDE: "category_reclassified",
  SIGN_CORRECTED: "risk_coefficient_corrected",
  CONTROLLABLE_DATA_FILLED: "data_filled",
  ENUM_VALUE_CORRECTED: "enum_corrected",
};

/**
 * Graph correction type → user-facing ModelAdjustment code.
 * Only the `edge_added` type from goal wiring/enrichment is surfaced.
 */
const CORRECTION_TYPE_MAP: Record<string, ModelAdjustmentT["code"]> = {
  edge_added: "connectivity_repaired",
};

/**
 * Minimal shape of an STRP mutation for mapping purposes.
 * Avoids coupling to the full STRPMutation interface.
 */
interface MutationInput {
  code: string;
  node_id?: string;
  edge_id?: string;
  field: string;
  before: unknown;
  after: unknown;
  reason: string;
}

/**
 * Minimal shape of a graph correction for mapping purposes.
 */
interface CorrectionInput {
  type: string;
  target: { node_id?: string; edge_id?: string };
  before?: unknown;
  after?: unknown;
  reason: string;
}

/**
 * Map STRP mutations and graph corrections to user-facing model adjustments.
 *
 * Only mutations with a known mapping are surfaced. Unmapped internal codes
 * (e.g., CONSTRAINT_REMAPPED) remain in trace.strp only.
 *
 * Task 10B: Malformed entries (missing code/type/reason) are skipped with a warning.
 *
 * @param strpMutations - STRP mutation records (from trace.strp.mutations)
 * @param corrections - Graph correction records (from trace.corrections)
 * @param nodeLabels - Optional lookup map from node ID → label for enrichment (Task 10A)
 * @returns Model adjustments for the analysis_ready payload
 */
export function mapMutationsToAdjustments(
  strpMutations?: MutationInput[],
  corrections?: CorrectionInput[],
  nodeLabels?: Map<string, string>,
): ModelAdjustmentT[] {
  const adjustments: ModelAdjustmentT[] = [];

  for (const m of strpMutations ?? []) {
    // Task 10B: Skip malformed entries
    if (!m || typeof m.code !== "string" || typeof m.reason !== "string") {
      log.warn({ mutation: m }, "Skipping malformed STRP mutation (missing code or reason)");
      continue;
    }
    const code = STRP_CODE_MAP[m.code];
    if (code) {
      // Task 10A: Enrich with node label if available
      const label = m.node_id ? nodeLabels?.get(m.node_id) : undefined;
      const reason = label ? `${m.reason} (${label})` : m.reason;
      adjustments.push({
        code,
        node_id: m.node_id,
        edge_id: m.edge_id,
        field: m.field,
        before: m.before,
        after: m.after,
        reason,
      });
    } else {
      log.debug({ strp_code: m.code, node_id: m.node_id }, "STRP mutation code not mapped to user-facing adjustment (internal-only)");
    }
  }

  for (const c of corrections ?? []) {
    // Task 10B: Skip malformed entries
    if (!c || typeof c.type !== "string" || typeof c.reason !== "string") {
      log.warn({ correction: c }, "Skipping malformed graph correction (missing type or reason)");
      continue;
    }
    const code = CORRECTION_TYPE_MAP[c.type];
    if (code) {
      // Task 10A: Enrich with node label if available
      const label = c.target?.node_id ? nodeLabels?.get(c.target.node_id) : undefined;
      const reason = label ? `${c.reason} (${label})` : c.reason;
      adjustments.push({
        code,
        node_id: c.target?.node_id,
        edge_id: c.target?.edge_id,
        field: c.type,
        before: c.before,
        after: c.after,
        reason,
      });
    }
  }

  return adjustments;
}

// ============================================================================
// Constraint-Drop Blocker Extraction
// ============================================================================

/**
 * Extract STRP constraint-drop mutations as analysis_ready blockers.
 *
 * When STRP drops a constraint because the target node doesn't exist in the
 * graph, the mutation has code "CONSTRAINT_DROPPED". This function converts
 * those mutations into properly typed AnalysisBlocker entries so users see
 * that their constraints were silently removed.
 *
 * Note: These blockers are informational — they do NOT change analysis_ready.status.
 * The status is computed before constraint-drop blockers are injected, and is not
 * recomputed afterwards. This is by design: dropped constraints mean the graph is
 * still runnable, it just won't enforce those constraints.
 *
 * Field mapping:
 * - factor_id: The target node_id the constraint referenced (from mutation.before)
 * - factor_label: Same as factor_id (the node doesn't exist, so we have no label)
 * - message: Includes constraint_id for traceability
 *
 * @param mutations - STRP mutation records (from trace.strp.mutations)
 * @returns Deduplicated blocker entries for dropped constraints
 */
export function extractConstraintDropBlockers(
  mutations: Array<{ code?: string; constraint_id?: string; before?: unknown; reason?: string }>,
): AnalysisBlockerT[] {
  const seen = new Set<string>();
  const blockers: AnalysisBlockerT[] = [];

  for (const m of mutations) {
    if (m.code !== "CONSTRAINT_DROPPED") continue;

    // Dedup by constraint_id (or target node_id if no constraint_id)
    const dedupKey = m.constraint_id ?? (typeof m.before === "string" ? m.before : "");
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    // factor_id = target node_id (matches AnalysisBlocker schema: "Factor node ID")
    const targetNodeId = typeof m.before === "string" ? m.before : "unknown";
    const constraintLabel = m.constraint_id ? ` (${m.constraint_id})` : "";

    blockers.push({
      factor_id: targetNodeId,
      factor_label: targetNodeId,
      blocker_type: "constraint_dropped" as const,
      message: `Constraint dropped${constraintLabel}: ${m.reason ?? "target node not found in graph"}`,
      suggested_action: "review_constraint" as const,
    });
  }

  return blockers;
}
