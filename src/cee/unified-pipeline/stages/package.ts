/**
 * Stage 5: Package — Caps + warnings + quality + trace assembly
 *
 * Source: Pipeline A lines 2553-3222
 *
 * GRAPH FROZEN INVARIANT: Stage 5 must not mutate ctx.graph.
 * A runtime check enforces this in non-production environments.
 * If any function called here modifies the graph, that's a bug
 * in the extraction — do not accommodate it, flag it.
 */

import type { StageContext } from "../types.js";
import { config, isProduction } from "../../../config/index.js";
import { log, emit, TelemetryEvents } from "../../../utils/telemetry.js";
import { inferArchetype } from "../../archetypes/index.js";
import { computeQuality } from "../../quality/index.js";
import { detectBiases, sortBiasFindings } from "../../bias/index.js";
import { applyResponseCaps } from "../../transforms/response-caps.js";
import { ceeAnyTruncated, buildCeeGuidance } from "../../guidance/index.js";
import {
  detectStructuralWarnings,
  detectUniformStrengths,
  detectStrengthClustering,
  detectSameLeverOptions,
  detectOptionSimilarity,
  detectMissingBaseline,
  detectMissingCounterfactual,
  detectGoalNoBaselineValue,
  detectZeroExternalFactors,
  checkGoalConnectivity,
  computeModelQualityFactors,
} from "../../structure/index.js";
import { matchesStatusQuoLabel } from "../../structure/status-quo-patterns.js";
import { verificationPipeline } from "../../verification/index.js";
import { CEEDraftGraphResponseV1Schema } from "../../../schemas/ceeResponses.js";
import {
  captureCheckpoint,
  applyCheckpointSizeGuard,
  assembleCeeProvenance,
} from "../../pipeline-checkpoints.js";
import { buildLLMRawTrace } from "../../llm-output-store.js";
import { buildLlmMetadataProjection } from "../llm-metadata-projection.js";
import { SERVICE_VERSION } from "../../../version.js";
import { assembleDraftProvenanceDescriptor } from "../../../context/context-pack.js";
import { narrowCoachingForResponse } from "../../../orchestrator/draft-coaching.js";
import { enforceCoachingContract } from "../../../adapters/llm/coaching-contract-conformance.js";
import { sanitiseCoachingProse } from "../../../orchestrator-v5/compose/output-safety.js";
import { scanCoachingForIdLeakage } from "../../validation/coaching-safety-scanner.js";
import type { DraftCoaching } from "../../../orchestrator/types.js";
import type { GraphV3T, NodeV3T } from "../../../schemas/cee-v3.js";
import type { GraphV1 } from "../../../contracts/plot/engine.js";

/**
 * Project a V1 graph into the minimal GraphV3T shape the coaching scrubber
 * (`sanitiseCoachingProse`) consumes. The scrubber reads `nodes[].id` to
 * decide whether a token in coaching prose is a real graph ID and
 * `nodes[].label` to substitute a human label when one is available; we
 * additionally satisfy `kind` because NodeV3T requires it. Edges are not
 * consulted, so an empty edge array is fine.
 *
 * Unlike a label-resolution-only projection, this projection RETAINS nodes
 * whose label is missing, empty, or equal to the id. The scrubber's rule 1
 * is "token present in `graph.nodes[].id`" (not "label resolves to a
 * non-id string"), so carrying these nodes through preserves the evidence
 * that the id is real — closing the leak path where a single-segment
 * risky-prefix id like `{id: "risk_churn", label: "risk_churn"}` would
 * otherwise be classified as an ambiguous orphan and preserved verbatim.
 *
 * The scrubber's internal `label !== id` check then decides between
 * substituting the label and falling back to the prefix-aware
 * `PREFIX_GENERIC` neutral phrase. NodeV3T requires `label: z.string()`,
 * so when the source has no usable label we pass `n.id` as the label
 * placeholder; the scrubber treats `label === id` as "no usable label"
 * and emits the generic fallback.
 *
 * Avoids both (a) scrubbing with a null graph (which loses all label
 * resolution) and (b) reaching for an `as unknown as GraphV3T` cast.
 */
const V3_VALID_NODE_KINDS = new Set<NodeV3T["kind"]>([
  "goal", "factor", "outcome", "decision", "risk", "action", "option",
]);

function projectGraphForCoachingScrub(graph: GraphV1 | undefined): GraphV3T | null {
  if (!graph || !Array.isArray(graph.nodes)) return null;
  const nodes: NodeV3T[] = [];
  for (const n of graph.nodes) {
    if (typeof n.id !== "string" || n.id.length === 0) continue;
    // Retain label-less and `label === id` nodes; pass `n.id` as the label
    // placeholder when no usable label is available. The downstream scrubber
    // detects `label === id` and emits the prefix-aware generic instead of
    // re-emitting the leaked id.
    const label = typeof n.label === "string" && n.label.length > 0 ? n.label : n.id;
    const rawKind = typeof n.kind === "string" ? (n.kind as NodeV3T["kind"]) : "factor";
    const kind: NodeV3T["kind"] = V3_VALID_NODE_KINDS.has(rawKind) ? rawKind : "factor";
    nodes.push({ id: n.id, kind, label });
  }
  return { nodes, edges: [] };
}

/**
 * Decide whether a narrowed coaching block has anything worth surfacing.
 * A null or whitespace-only summary alone with empty arrays is silence —
 * drop. Any populated field (including a non-blank string summary) makes
 * the panel worth rendering.
 */
function hasMeaningfulCoaching(coaching: DraftCoaching): boolean {
  if (typeof coaching.summary === "string" && coaching.summary.trim().length > 0) return true;
  if (coaching.strengthen_items.length > 0) return true;
  // v0.11.0 schema amendment: widening_log is the canonical object shape;
  // meaningful when any sub-array is populated or completeness signals more
  // than the default "thin".
  if (
    coaching.widening_log &&
    (coaching.widening_log.elements_added.length > 0 ||
      coaching.widening_log.elements_considered_but_excluded.length > 0 ||
      coaching.widening_log.brief_completeness !== "thin")
  ) {
    return true;
  }
  if (coaching.bias_signals && coaching.bias_signals.length > 0) return true;
  return false;
}

/**
 * Scrub user-facing coaching strings against the entity-ID leak guard.
 * Returns a new DraftCoaching with the same shape; original input is untouched.
 *
 * The graph (projected from V1 to a minimal GraphV3T-shaped object by
 * `projectGraphForCoachingScrub`) is threaded through so the scrubber's
 * rule 1 can resolve leaked IDs to the actual node label, or — when a real
 * graph node carries no usable label — fall back to the prefix-aware
 * generic ("the relevant factor") rather than re-emitting the raw id.
 *
 * Delegates per-string scrubbing to `sanitiseCoachingProse` (not the
 * codebase-wide `sanitiseUserFacingText`): the coaching context has a
 * stricter prompt rule (DISPLAY SAFETY: "Do not mention internal IDs")
 * so the narrow-guard scrubber catches real-graph leaks the broader
 * heuristic-gated scrubber misses, while preserving English compounds
 * like `risk_adjusted` / `goal_setting` via rule 3.
 */
function sanitiseCoachingForDisplay(
  coaching: DraftCoaching | null,
  graph: GraphV3T | null,
): DraftCoaching | null {
  if (!coaching) return null;
  const scrub = (text: string): string => sanitiseCoachingProse(text, graph).text;
  return {
    summary: coaching.summary !== null ? scrub(coaching.summary) : null,
    strengthen_items: coaching.strengthen_items.map((item) => ({
      ...item,
      label: scrub(item.label),
      detail: scrub(item.detail),
    })),
    // v0.11.0 schema amendment: widening_log is the canonical object.
    // Scrub `elements_considered_but_excluded` (free-text reason
    // descriptions). `elements_added` is a string[] of NODE IDS by
    // contract — do NOT scrub those (they would be stripped as ID-shaped
    // tokens by the sanitiser).
    widening_log: coaching.widening_log
      ? {
          elements_added: coaching.widening_log.elements_added,
          elements_considered_but_excluded:
            coaching.widening_log.elements_considered_but_excluded.map((s) => scrub(s)),
          brief_completeness: coaching.widening_log.brief_completeness,
        }
      : null,
    bias_signals: coaching.bias_signals
      ? coaching.bias_signals.map((signal) => ({
          ...signal,
          detail: scrub(signal.detail),
          // target is a structural node-ID pointer the UI uses to highlight
          // the referenced node — leaving it unscrubbed preserves that link.
          // detail (above) is the user-facing prose and is sanitised.
        }))
      : null,
  };
}

/**
 * Derive a single status_quo_action enum from the sweep trace.
 * "wired" = edges were added, "droppable" = unfixable, "none" = no status quo issue detected.
 */
function deriveStatusQuoAction(
  sweepTrace: Record<string, unknown> | undefined,
): "wired" | "droppable" | "none" {
  const sq = (sweepTrace as any)?.status_quo;
  if (!sq) return "none";
  if (sq.fixed) return "wired";
  if (sq.marked_droppable) return "droppable";
  return "none";
}

export async function runStagePackage(ctx: StageContext): Promise<void> {
  if (!ctx.graph) return;

  log.info({ requestId: ctx.requestId, stage: "package" }, "Unified pipeline: Stage 5 (Package) started");

  // ── Graph frozen invariant (runtime enforcement) ─────────────────────────
  const graphSnapshot = !isProduction() ? JSON.stringify(ctx.graph) : undefined;

  // ── Compute allStrpMutations once — used in Steps 5 and 14 ──────────────
  const allStrpMutations = [
    ...(ctx.strpResult?.mutations ?? []),
    ...(ctx.constraintStrpResult?.mutations ?? []),
  ];

  const validationIssues: any[] = [];

  // ── Promote STRP heuristic warnings to validation_issues (surfaces on V3 response) ──
  for (const m of allStrpMutations) {
    if (m.code === "CONSTRAINT_DIRECTION_HEURISTIC") {
      validationIssues.push({
        code: "CONSTRAINT_DIRECTION_HEURISTIC",
        severity: "info",
        message: m.reason,
        affected_node_id: m.node_id,
        details: {
          constraint_id: m.constraint_id,
          operator: m.before,
        },
      });
    }
  }

  // ── Step 1: Archetype inference (gated) ──────────────────────────────────
  if (config.cee.draftArchetypesEnabled && ctx.graph) {
    const { archetype, issues: archetypeIssues } = inferArchetype({
      hint: (ctx.input as any).archetype_hint,
      brief: ctx.input.brief,
      graph: ctx.graph as any,
      engineConfidence: ctx.confidence,
    });
    ctx.archetype = archetype;
    if (Array.isArray(archetypeIssues) && archetypeIssues.length > 0) {
      validationIssues.push(...archetypeIssues);
    }
  } else {
    // Fallback: generic archetype from hint (match pipeline.ts:2237-2248)
    ctx.archetype = (ctx.input as any).archetype_hint
      ? { decision_type: (ctx.input as any).archetype_hint, match: "fuzzy" as const, confidence: ctx.confidence }
      : { decision_type: "generic", match: "generic" as const, confidence: ctx.confidence };
  }

  // ── Step 2: Quality computation (canonical) ──────────────────────────────
  ctx.quality = computeQuality({
    graph: ctx.graph!,
    confidence: ctx.confidence ?? 0.7,
    engineIssueCount: 0,
    ceeIssues: validationIssues,
  });

  // ── Step 2b: STATUS_QUO_ABSENT coaching injection ─────────────────────────
  // If no option has a status-quo-like label, inject a coaching strengthen_item
  // so the user is prompted to add a baseline comparator.
  // Uses shared matchesStatusQuoLabel() from structure/status-quo-patterns.ts.
  {
    const nodes = ((ctx.graph as any).nodes ?? []) as Array<{ id: string; kind: string; label?: string; data?: any }>;
    const options = nodes.filter((n) => n.kind === "option");
    const hasStatusQuo = options.some((opt) => {
      if (opt.data?.is_status_quo === true) return true;
      return matchesStatusQuoLabel(opt.label ?? "");
    });

    if (!hasStatusQuo && options.length > 0) {
      // v0.11.0 schema amendment: coaching default is now schema-valid against
      // the canonical CoachingSchema (widening_log + bias_signals required;
      // empty arrays + brief_completeness "thin" are valid). Insertion fires
      // DraftGraphContractDefaultApplied telemetry — observable so a regression
      // after v194 is detectable. The status-quo strengthen_item uses the
      // canonical BiasType "narrow_framing" (was legacy "framing").
      let inserted = false;
      const coaching = (ctx.coaching ?? (() => {
        inserted = true;
        return {
          summary: "",
          strengthen_items: [],
          widening_log: {
            elements_added: [],
            elements_considered_but_excluded: [],
            brief_completeness: "thin",
          },
          bias_signals: [],
        };
      })()) as {
        summary: string;
        strengthen_items: Array<Record<string, unknown>>;
        widening_log?: Record<string, unknown>;
        bias_signals?: unknown[];
      };
      if (inserted) {
        emit(TelemetryEvents.DraftGraphContractDefaultApplied, {
          field: "coaching",
          request_id: ctx.requestId,
          prompt_version: (ctx as { promptVersion?: string }).promptVersion,
        });
      }
      if (!Array.isArray(coaching.strengthen_items)) {
        coaching.strengthen_items = [];
      }
      const alreadyPresent = coaching.strengthen_items.some(
        (item) => item.id === "str_status_quo",
      );
      if (!alreadyPresent) {
        coaching.strengthen_items.push({
          id: "str_status_quo",
          label: "Add baseline option",
          detail: "No status quo option detected — add one to measure improvement. If one of your existing options is the baseline (e.g. 'Continue as-is', 'Maintain current approach'), rename it to make the baseline intent explicit.",
          action_type: "add_option",
          bias_category: "narrow_framing",
        });
        ctx.coaching = coaching;
      }
    }
  }

  // ── Step 2c: Force coaching onto the declared contract ────────────────────
  // THE seam every coaching producer passes through — the post-draft coaching
  // pass, the draft-LLM fallback path, and the status-quo item injected just
  // above — so one call covers all of them.
  //
  // Was: a missing-`action_type` default only. That let a PRESENT but
  // off-contract value straight through, which is how the live draft-graph
  // response came to violate `CEEDraftGraphResponseV1Schema` on 8 of 9
  // successful drafts (`verification_status: failed_degraded`, day-3 matrix
  // 2026-07-24). The coaching pass's prompt vocabulary had drifted from
  // `StrengthenItemActionType` / `BiasType` and nothing checked it.
  //
  // `enforceCoachingContract` subsumes the old default (a missing action_type
  // still resolves to the generic canonical member) and additionally rejects
  // off-contract values — coercing action categories, DROPPING unnameable bias
  // labels rather than fabricating a different bias. Membership is derived from
  // the contract enums, not mirrored. See the module header for the full
  // rationale.
  if (ctx.coaching) {
    enforceCoachingContract(ctx.coaching, ctx.requestId);
  }

  // ── Step 3: Validate causal claims against post-STRP graph (Phase 2B) ────
  // Claims are validated here (not earlier) because node ID validation must
  // run against the post-repair graph — STRP may remove nodes.
  // Track whether the LLM emitted causal_claims at all (for provenance).
  // undefined = LLM didn't emit → omit from response.
  // CausalClaim[] (possibly empty) = LLM emitted → include in response.
  const llmEmittedCausalClaims = ctx.causalClaims !== undefined;
  let validatedCausalClaims: import("../../../schemas/causal-claims.js").CausalClaim[] = [];
  const causalClaimsWarnings: any[] = [];

  if (llmEmittedCausalClaims) {
    const graphNodeIds = new Set<string>(
      Array.isArray((ctx.graph as any)?.nodes)
        ? (ctx.graph as any).nodes.map((n: any) => n.id as string)
        : [],
    );
    const { validateCausalClaims } = await import("../../transforms/causal-claims-validation.js");
    const result = validateCausalClaims(ctx.causalClaims, graphNodeIds);
    validatedCausalClaims = result.claims;
    causalClaimsWarnings.push(...result.warnings);
  }
  if (causalClaimsWarnings.length > 0) {
    validationIssues.push(...causalClaimsWarnings);
  }

  // ── Step 3b: Detect biases + build payload ─────────────────────────────
  // Run deterministic bias heuristics against the frozen graph.
  // detectBiases is cheap (no LLM call) — always runs.
  const biasFindings = ctx.graph
    ? sortBiasFindings(detectBiases(ctx.graph as any, ctx.archetype), ctx.input.seed)
    : [];

  // Narrow + sanitise coaching for the user-facing response.
  // ctx.coaching is the raw LLM passthrough block; narrow to typed display
  // shape and scrub any entity-ID leaks (e.g. "fac_churn") from user-visible
  // strings before the response leaves the boundary. Project the V1 graph
  // into a minimal GraphV3T shape so label resolution works (sanitiser
  // replaces `fac_churn` with the actual node label rather than the generic
  // "the relevant factor" fallback).
  const scrubGraph = projectGraphForCoachingScrub(ctx.graph);
  const narrowedCoaching: DraftCoaching | null = ctx.coaching
    ? narrowCoachingForResponse(ctx.coaching)
    : null;

  // v0.11.0 schema amendment: output-safety scan runs on the NARROWED-but-
  // PRE-SANITISATION coaching object. Sanitisation strips raw IDs, so a
  // post-sanitisation scan would miss the exact leaks it is meant to flag.
  // The scanner emits warning telemetry only — never rejects. Fields scanned:
  // summary, strengthen_items.label/.detail,
  // widening_log.elements_considered_but_excluded, bias_signals.detail.
  // widening_log.elements_added is intentionally NOT scanned (structural
  // node IDs by contract).
  if (narrowedCoaching) {
    const idLeakHits = scanCoachingForIdLeakage(narrowedCoaching);
    if (idLeakHits.length > 0) {
      log.warn(
        {
          event: "cee.draft_graph.coaching_id_leakage_detected",
          request_id: ctx.requestId,
          hit_count: idLeakHits.length,
          // Cap at 10 hits for log payload bloat protection.
          hits: idLeakHits.slice(0, 10),
        },
        `${idLeakHits.length} raw node-ID leak(s) detected in coaching prose (pre-sanitisation)`,
      );
    }
  }

  const sanitisedCoaching: DraftCoaching | null = narrowedCoaching
    ? sanitiseCoachingForDisplay(narrowedCoaching, scrubGraph)
    : null;

  const payload: Record<string, unknown> = {
    graph: ctx.graph,
    rationales: ctx.rationales,
    confidence: ctx.confidence,
    goal_constraints: ctx.goalConstraints,
    bias_findings: biasFindings,
    // Display-shape coaching for the UI (sanitised, narrowed). Attach when
    // any coaching field is meaningful — summary may be null and other
    // fields populated (e.g. LLM produced widening_log without a summary),
    // and the UI renders null as "no summary" rather than dropping the panel.
    // widening_log / bias_signals are spread conditionally because the wire
    // schemas mark them optional (undefined) rather than nullable, while
    // DraftCoaching uses null to signal "absent".
    // v0.11.0 schema amendment: coaching is REQUIRED at the V3 boundary
    // per canonical contract. Always emit a coaching block — populated
    // when the LLM produced meaningful content; canonical-empty when not.
    // Stage 6 V3 transform also has a fallback for the truly-absent case
    // (legacy callers); this is the primary emit point.
    coaching: sanitisedCoaching && hasMeaningfulCoaching(sanitisedCoaching)
      ? {
          summary: sanitisedCoaching.summary,
          strengthen_items: sanitisedCoaching.strengthen_items,
          // widening_log: emit when present (object shape always preserved).
          // bias_signals: emit when present and non-empty.
          ...(sanitisedCoaching.widening_log
            ? { widening_log: sanitisedCoaching.widening_log }
            : {}),
          ...(sanitisedCoaching.bias_signals && sanitisedCoaching.bias_signals.length > 0
            ? { bias_signals: sanitisedCoaching.bias_signals }
            : {}),
        }
      : {
          // Canonical empty coaching shape (matches Stage 6 V3 fallback).
          summary: null,
          strengthen_items: [],
          widening_log: {
            elements_added: [],
            elements_considered_but_excluded: [],
            brief_completeness: "thin",
          },
          bias_signals: [],
        },
    // Causal claims passthrough (Phase 2B):
    //   LLM didn't emit → omit field (absent provenance)
    //   LLM emitted but all dropped → causal_claims: [] (emptied provenance)
    //   LLM emitted valid claims → causal_claims: [...] (normal)
    ...(llmEmittedCausalClaims ? { causal_claims: validatedCausalClaims } : {}),
    // v0.11.0 schema amendment: topology_plan (string array) carried
    // through from Stage 1 Parse to V3 boundary. Stage 6 V1 → V3 transform
    // preserves length + order + string contents exactly.
    ...(Array.isArray(ctx.topologyPlan) ? { topology_plan: ctx.topologyPlan } : {}),
  };

  // ── F6 (2026-07-24): coaching_status honesty — decide from VALIDATED counts ──
  // The coaching pass (Stage 4.5) marks `attached=true` for ANY non-null
  // container — including `{"coaching":{},"causal_claims":[{}]}`, which Stage 5
  // narrows to canonical-empty coaching and drops the invalid claim. Deciding the
  // terminal status from pre-validation presence then wrongly stamped 'complete'.
  // Own the complete-vs-degraded call HERE, from the SAME validators Stage 5 uses
  // (hasMeaningfulCoaching + validateCausalClaims) — deriving, never a second
  // mirror of the narrowing. When the pass ATTACHED content that validates to
  // nothing usable, the honest status is 'failed_degraded'. Scope-tight: fires
  // ONLY when the pass attached (so a never-ran / budget-skipped / no-adapter path
  // is untouched — index.ts stamps those), and never clobbers 'skipped_budget'.
  const coachingPassAttached =
    (ctx.coaching !== undefined && ctx.coaching !== null) || ctx.causalClaims !== undefined;
  const coachingUsable =
    (sanitisedCoaching != null && hasMeaningfulCoaching(sanitisedCoaching)) ||
    validatedCausalClaims.length > 0;
  if (
    coachingPassAttached &&
    !coachingUsable &&
    ctx.pipelineOutcome &&
    ctx.pipelineOutcome.coaching_status !== 'skipped_budget'
  ) {
    ctx.pipelineOutcome.coaching_status = 'failed_degraded';
  }

  // ── Step 4: Apply response caps ──────────────────────────────────────────
  const { cappedPayload, limits } = applyResponseCaps(payload);

  // ── Step 5: (STRP trace merged onto trace variable in Step 9b below) ─────

  // ── Step 6: Structural warnings ──────────────────────────────────────────
  // UNCONDITIONAL since 2026-07-20 (O-7 wave 2:
  // CEE_DRAFT_STRUCTURAL_WARNINGS_ENABLED deleted, live-true on staging).
  let draftWarnings: any[] | undefined;
  let confidenceFlags: Record<string, unknown> | undefined;

  {
    const structural = detectStructuralWarnings(ctx.graph as any, ctx.structuralMeta);
    if (structural.warnings.length > 0) {
      draftWarnings = structural.warnings;
    }

    const anyTruncated = ceeAnyTruncated(limits);
    const uncertainNodes =
      structural.uncertainNodeIds.length > 0 ? structural.uncertainNodeIds : undefined;
    const simplificationApplied = Boolean(
      anyTruncated ||
        (ctx.structuralMeta && ((ctx.structuralMeta as any).had_cycles || (ctx.structuralMeta as any).had_pruned_nodes)),
    );

    if (uncertainNodes || simplificationApplied) {
      confidenceFlags = {
        ...(uncertainNodes ? { uncertain_nodes: uncertainNodes } : {}),
        ...(simplificationApplied ? { simplification_applied: true } : {}),
      };
    }
  }

  // Uniform strengths (always run, not gated)
  const uniformResult = detectUniformStrengths(ctx.graph as any);
  if (uniformResult.detected && uniformResult.warning) {
    if (!draftWarnings) draftWarnings = [];
    draftWarnings.push(uniformResult.warning);
  }

  // Pre-analysis quality detectors
  const strengthClust = detectStrengthClustering(ctx.graph as any);
  if (strengthClust.detected && (strengthClust as any).warning) {
    if (!draftWarnings) draftWarnings = [];
    draftWarnings.push((strengthClust as any).warning);
  }

  const sameLever = detectSameLeverOptions(ctx.graph as any);
  if (sameLever.detected && (sameLever as any).warning) {
    if (!draftWarnings) draftWarnings = [];
    draftWarnings.push((sameLever as any).warning);
  }

  // Detect option similarity — emit to validationIssues (type: OPTION_SIMILARITY, severity: info)
  const optSimilarity = detectOptionSimilarity(ctx.graph as any);
  if (optSimilarity.detected) {
    validationIssues.push(...optSimilarity.validationIssues);
  }

  // Detect missing counterfactual — emit to validationIssues (type: MISSING_COUNTERFACTUAL, severity: info)
  // Supersedes detectMissingBaseline — skip baseline when counterfactual fires.
  const missingCounterfactualResult = detectMissingCounterfactual(ctx.graph as any);
  if (missingCounterfactualResult.detected && missingCounterfactualResult.validationIssue) {
    validationIssues.push(missingCounterfactualResult.validationIssue);
  }

  // Detect missing baseline (legacy — skipped when counterfactual already fires)
  if (!missingCounterfactualResult.detected) {
    const missingBaselineResult = detectMissingBaseline(ctx.graph as any);
    if (missingBaselineResult.detected && (missingBaselineResult as any).warning) {
      if (!draftWarnings) draftWarnings = [];
      draftWarnings.push((missingBaselineResult as any).warning);
    }
  }

  const goalNoValue = detectGoalNoBaselineValue(ctx.graph as any);
  if (goalNoValue.detected && (goalNoValue as any).warning) {
    if (!draftWarnings) draftWarnings = [];
    draftWarnings.push((goalNoValue as any).warning);
  }

  const zeroExternal = detectZeroExternalFactors(ctx.graph as any);
  if (zeroExternal.detected && zeroExternal.warning) {
    if (!draftWarnings) draftWarnings = [];
    draftWarnings.push(zeroExternal.warning);
  }

  const goalConn = checkGoalConnectivity(ctx.graph as any);
  if (goalConn.status === "none" && (goalConn as any).warning) {
    if (!draftWarnings) draftWarnings = [];
    draftWarnings.push((goalConn as any).warning);
  }

  const modelQualityFactors = computeModelQualityFactors(ctx.graph as any);
  const goalConnectivity = {
    status: goalConn.status,
    disconnected_options: (goalConn as any).disconnectedOptions,
    weak_paths: (goalConn as any).weakPaths,
  };

  ctx.draftWarnings = draftWarnings ?? [];

  // ── Step 7: Intervention hints extraction (inline) ───────────────────────
  const interventionHints: any[] = [];
  if (ctx.graph && Array.isArray((ctx.graph as any).nodes)) {
    for (const node of (ctx.graph as any).nodes) {
      if (node?.kind !== "option") continue;
      const rawInterventions = (node?.data as any)?.interventions;
      const interventionValues = Array.isArray(rawInterventions)
        ? rawInterventions
        : rawInterventions && typeof rawInterventions === "object"
          ? Object.values(rawInterventions)
          : [];
      for (const interv of interventionValues as any[]) {
        const targetId = interv?.target_match?.node_id ?? interv?.target;
        if (!targetId) continue;
        interventionHints.push({
          option_id: node.id,
          target_node_id: targetId,
          unit: interv?.unit,
          factor_type: interv?.factor_type ?? "unknown",
          extracted_range: interv?.range
            ? { min: interv.range.min, max: interv.range.max, source: interv?.range_source ?? "default" }
            : undefined,
          source: interv?.source ?? "ai",
        });
      }
    }
  }

  // ── Step 8: Build CEE guidance ───────────────────────────────────────────
  const guidance = buildCeeGuidance({
    quality: ctx.quality!,
    validationIssues,
    limits,
  });

  // ── Step 9: Build initial trace (CEETraceMeta) ───────────────────────────
  const trace: any = {
    request_id: ctx.requestId,
    correlation_id: ctx.requestId,
    engine: {
      provider: ctx.draftAdapter?.name,
      model: ctx.draftAdapter?.model,
      version: SERVICE_VERSION,
    },
    ...(ctx.llmMeta
      ? {
          prompt_version: ctx.llmMeta.prompt_version,
          prompt_hash: ctx.llmMeta.prompt_hash,
          model: ctx.llmMeta.model ?? ctx.draftAdapter?.model,
          temperature: ctx.llmMeta.temperature,
          token_usage: ctx.llmMeta.token_usage,
          finish_reason: ctx.llmMeta.finish_reason,
        }
      : {}),
    // BriefSignals v1 — deterministic bias detection (persisted on trace for debug bundles)
    ...(ctx.input.bias_signals?.length ? { bias_signals: ctx.input.bias_signals } : {}),
  };

  // ── Step 9b: Merge STRP trace onto trace variable ─────────────────────────
  // Must be on the trace object itself (not cappedPayload.trace) because
  // Step 11 overrides cappedPayload.trace with the explicit trace property.
  // Stage 6 reads trace.strp.mutations for model_adjustments.
  if (allStrpMutations.length > 0) {
    trace.strp = {
      mutation_count: allStrpMutations.length,
      rules_triggered: [...new Set(allStrpMutations.map((m: any) => m.rule))],
      mutations: allStrpMutations,
    };
  }

  // ── Step 9c: Merge deterministic repair summary onto trace ──────────────
  {
    const sweepTrace = (ctx.repairTrace as any)?.deterministic_sweep;
    const repairs = ctx.deterministicRepairs ?? [];
    trace.repair_summary = {
      // Sweep execution proof — consumers should gate on deterministic_sweep_ran
      // before reading bucket_summary (null = sweep didn't run, {0,0,0} = ran with zero violations).
      deterministic_sweep_ran: sweepTrace?.sweep_ran ?? false,
      deterministic_sweep_version: sweepTrace?.sweep_version ?? "unknown",
      bucket_summary: sweepTrace ? (sweepTrace.bucket_summary ?? null) : null,
      status_quo_action: deriveStatusQuoAction(sweepTrace),
      // Post-2.731 semantics: Bucket-C violations survived the deterministic
      // sweep. No LLM repair exists to be "needed" any more — this is the
      // sweep's own diagnostic and predicts the post-enforcement 422 when
      // the deterministic normalisation cannot clear the violations.
      // (llm_repair_called / llm_repair_brief_included /
      // llm_repair_skipped_reason were DELETED with the call — ROADMAP
      // 2.732; leaving them would have made them constant-wrong.)
      llm_repair_needed: ctx.llmRepairNeeded ?? false,
      // Existing fields
      deterministic_repairs_count: repairs.length,
      deterministic_repairs: repairs,
      unreachable_factors: sweepTrace?.unreachable_factors ?? { reclassified: [], marked_droppable: [] },
      status_quo: sweepTrace?.status_quo ?? { fixed: false, marked_droppable: false },
      remaining_violations_count: ctx.remainingViolations?.length ?? 0,
      remaining_violation_codes: [...new Set((ctx.remainingViolations ?? []).map((v) => v.code))],
      edge_format_detected: ctx.detectedEdgeFormat ?? "NONE",
      graph_delta: sweepTrace?.graph_delta ?? {
        nodes_before: 0,
        nodes_after: Array.isArray((ctx.graph as any)?.nodes) ? (ctx.graph as any).nodes.length : 0,
        edges_before: 0,
        edges_after: Array.isArray((ctx.graph as any)?.edges) ? (ctx.graph as any).edges.length : 0,
      },
      // F8: Per-edge risk coefficient corrections (sign flips on risk→goal/outcome edges)
      risk_coefficient_corrections: ctx.riskCoefficientCorrections.map((c) => ({
        source: c.source,
        target: c.target,
        original_sign: c.original >= 0 ? "positive" : "negative",
        corrected_sign: c.corrected >= 0 ? "positive" : "negative",
      })),
      // F9: Goal merge node renames — only present when goals were merged
      ...(ctx.nodeRenames.size > 0 ? {
        goal_merge_renames: Object.fromEntries(ctx.nodeRenames),
      } : {}),
    };
  }

  // ── Step 10: Clarifier status ────────────────────────────────────────────
  // Stage-4 clarifier RETIRED 2026-07-16 (ROADMAP 1.94 Option A). The wire
  // field is kept for client compatibility at its only observed live value:
  // the retired stage converged round-1 with status "complete" on 100% of
  // firings (and "complete" was also the disabled-flag fallback).
  const clarifierStatus = "complete";

  // ── Step 11: Assemble V1 response ────────────────────────────────────────
  const ceeResponse: any = {
    ...cappedPayload,
    trace,
    quality: ctx.quality,
    validation_issues: validationIssues.length ? validationIssues : undefined,
    archetype: ctx.archetype,
    seed: ctx.input.seed,
    response_hash: (cappedPayload as any).response_hash,
    response_limits: limits,
    draft_warnings: draftWarnings,
    confidence_flags: confidenceFlags,
    guidance,
    clarifier_status: clarifierStatus,
    goal_connectivity: goalConnectivity,
    model_quality_factors: modelQualityFactors,
    intervention_hints: interventionHints.length > 0 ? interventionHints : undefined,
    // BriefSignals v1 — deterministic bias detection
    bias_signals: ctx.input.bias_signals?.length ? ctx.input.bias_signals : undefined,
  };

  // ── Step 12: Pipeline checkpoint (post_stabilisation) ────────────────────
  if (ctx.checkpointsEnabled) {
    ctx.pipelineCheckpoints.push(captureCheckpoint("post_stabilisation", (cappedPayload as any).graph));
  }

  // ── Step 13: Verification pipeline (SOFT GATE — Track 1) ────────────────
  // Verification failure must not discard a valid graph. Log, record warning,
  // and continue with the unverified response.
  let verifiedResponse: any;
  if (config.cee.verificationPipelineEnabled) {
    try {
      const { response } = await verificationPipeline.verify(
        ceeResponse,
        CEEDraftGraphResponseV1Schema,
        { endpoint: "draft-graph", requiresEngineValidation: false, requestId: ctx.requestId },
      );
      verifiedResponse = response;
      ctx.pipelineOutcome.verification_status = 'passed';

      if (ctx.checkpointsEnabled) {
        ctx.pipelineCheckpoints.push(captureCheckpoint("pre_boundary", (verifiedResponse as any).graph));
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "verification failed";
      log.warn({
        event: "pipeline.soft_gate_degraded",
        stage: "verification",
        error: errMsg,
        request_id: ctx.requestId,
      }, "Verification pipeline failed — continuing with unverified response (soft gate)");

      ctx.pipelineOutcome.verification_status = 'failed_degraded';
      ctx.pipelineOutcome.warnings.push({
        stage: 'verification',
        error: errMsg,
        degraded: true,
      });

      // Continue with unverified response — do NOT set earlyReturn
      verifiedResponse = ceeResponse;

      if (ctx.checkpointsEnabled) {
        ctx.pipelineCheckpoints.push(captureCheckpoint("pre_boundary", (verifiedResponse as any).graph));
      }
    }
  } else {
    log.debug(
      { event: "cee.verification.skipped", request_id: ctx.requestId },
      "cee.verification.skipped",
    );
    verifiedResponse = ceeResponse;

    if (ctx.checkpointsEnabled) {
      ctx.pipelineCheckpoints.push(captureCheckpoint("pre_boundary", (verifiedResponse as any).graph));
    }
  }

  // ── Step 14: Pipeline trace assembly ─────────────────────────────────────
  const totalDurationMs = Date.now() - ctx.start;
  const pipelineTrace: Record<string, unknown> = {
    status: "success",
    total_duration_ms: totalDurationMs,
    llm_call_count: 1,
    llm_quality: {
      risk_coefficient_corrections: ctx.riskCoefficientCorrections.length,
      corrections: ctx.riskCoefficientCorrections.length > 0 ? ctx.riskCoefficientCorrections : undefined,
    },
    // ONE projection, shared with the error surface in unified-pipeline/index.ts
    // — see llm-metadata-projection.ts for why this stopped being written out by
    // hand (the two keep-lists had drifted and both dropped runaway_abort_count).
    llm_metadata: buildLlmMetadataProjection(ctx.llmMeta, ctx.draftAdapter?.model),
    validation_summary: ctx.validationSummary,
    transforms: ctx.transforms.length > 0 ? ctx.transforms : undefined,
    corrections: ctx.collector.hasCorrections() ? ctx.collector.getCorrections() : undefined,
    corrections_summary: ctx.collector.hasCorrections() ? ctx.collector.getSummary() : undefined,
  };

  // Strength default retry trace (from Stage 1)
  if (ctx.strengthDefaultRetried) {
    pipelineTrace.strength_default_retry = {
      retried: true,
      detection: ctx.strengthDefaultDetection ?? null,
    };
  }

  // Enrichment trace (from Stage 3)
  if (ctx.enrichmentTrace) {
    pipelineTrace.enrich = { ...ctx.enrichmentTrace, source: "unified_pipeline" };
  }

  // STRP trace (merged early + late — reusing allStrpMutations from Step 5)
  if (allStrpMutations.length > 0) {
    pipelineTrace.strp = {
      mutation_count: allStrpMutations.length,
      rules_triggered: [...new Set(allStrpMutations.map((m: any) => m.rule))],
      mutations: allStrpMutations,
    };
  }

  // Repair trace (from Stage 4)
  if (ctx.repairTrace) {
    pipelineTrace.repair = ctx.repairTrace;
  }

  // Deterministic repair summary for observability.
  // Must live on pipelineTrace (not the pre-verification trace object) because
  // Zod's intersection parse in Step 13 may strip unknown keys from the trace.
  // The V3 transform reads from trace.pipeline.repair_summary.
  pipelineTrace.repair_summary = trace.repair_summary;

  // Threshold sweep trace (from Stage 4b)
  if (ctx.thresholdSweepTrace) {
    pipelineTrace.threshold_sweep = ctx.thresholdSweepTrace;
  }

  // Field deletion audit telemetry (aggregated across all repair stages)
  if (ctx.fieldDeletions && ctx.fieldDeletions.length > 0) {
    pipelineTrace.field_deletions = {
      count: ctx.fieldDeletions.length,
      stages: [...new Set(ctx.fieldDeletions.map((d) => d.stage))],
      reasons: [...new Set(ctx.fieldDeletions.map((d) => d.reason))],
      events: ctx.fieldDeletions,
    };
  }

  // Stage snapshots (goal_threshold field tracking across pipeline stages)
  if (ctx.stageSnapshots) {
    pipelineTrace.stage_snapshots = ctx.stageSnapshots;
  }

  // Plan annotation checkpoint (captured after Stage 3 — Enrich)
  if (ctx.planAnnotation) {
    pipelineTrace.plan_annotation = ctx.planAnnotation;
  }

  // Final graph summary
  const nodeCount = Array.isArray((ctx.graph as any)?.nodes) ? (ctx.graph as any).nodes.length : 0;
  const edgeCount = Array.isArray((ctx.graph as any)?.edges) ? (ctx.graph as any).edges.length : 0;
  pipelineTrace.final_graph = {
    node_count: nodeCount,
    edge_count: edgeCount,
    node_kinds: Array.isArray((ctx.graph as any)?.nodes)
      ? [...new Set((ctx.graph as any).nodes.map((n: any) => n?.kind).filter(Boolean))]
      : [],
  };

  // Pipeline checkpoints
  if (ctx.checkpointsEnabled) {
    const adapterCheckpoints = Array.isArray(ctx.llmMeta?.pipeline_checkpoints)
      ? (ctx.llmMeta.pipeline_checkpoints as any[])
      : [];
    const allCheckpoints = [...adapterCheckpoints, ...ctx.pipelineCheckpoints];
    pipelineTrace.pipeline_checkpoints = applyCheckpointSizeGuard(allCheckpoints);
    pipelineTrace.pipeline_checkpoints_meta = {
      enabled: true,
      adapter_count: adapterCheckpoints.length,
      pipeline_count: ctx.pipelineCheckpoints.length,
      total_count: allCheckpoints.length,
    };
  }

  // ── ContextPack v1 assembly (Stream C) ────────────────────────────────
  const resolvedModel = ctx.llmMeta?.model ?? ctx.draftAdapter?.model ?? "unknown";
  const promptHash = ctx.llmMeta?.prompt_hash as string | undefined;
  const promptVersion = ctx.llmMeta?.prompt_version as string | undefined;

  // Normalise seed: DraftInputWithCeeExtras declares seed as string|undefined,
  // but it may arrive as number from some callers. Coerce to number for ContextPack.
  const rawSeed = (ctx.input as any).seed;
  const normalizedSeed = typeof rawSeed === "number"
    ? rawSeed
    : typeof rawSeed === "string" && rawSeed !== ""
      ? Number(rawSeed)
      : undefined;

  const contextPack = assembleDraftProvenanceDescriptor({
    capability: "draft_graph",
    brief: ctx.effectiveBrief,
    seedGraph: (ctx.input as any).previous_graph,
    resolvedModel: {
      route: (ctx.input as any).model ? "client_override" : "default",
      id: resolvedModel,
    },
    promptVersion: promptVersion ?? "unknown",
    promptContent: "unused", // Fallback — overridden by promptHashPrecomputed
    // Pass adapter's pre-computed content hash directly to avoid hash-of-hash.
    // The adapter already hashes actual prompt text via getSystemPromptMeta().
    promptHashPrecomputed: promptHash,
    seed: Number.isFinite(normalizedSeed) ? normalizedSeed : undefined,
    config: {
      maxTokens: {
        draft: config.cee.maxTokens?.draft,
        repair: config.cee.maxTokens?.repair,
      },
      enforceSingleGoal: config.cee.enforceSingleGoal,
      draftArchetypesEnabled: config.cee.draftArchetypesEnabled,
      clarificationEnforced: config.cee.clarificationEnforced,
      // Stage-4 clarifier retired (2026-07-16, ROADMAP 1.94 Option A). The
      // field stays in the ContextPack config fingerprint at its permanent
      // truth (no in-pipeline clarifier) so context_hash provenance remains
      // stable for configs that never enabled it.
      clarifierEnabled: false,
    },
    clarificationRound: (ctx.input as any).clarification_rounds_completed,
    clarificationAnswers: (ctx.input as any).conversation_history?.map(
      (h: { question_id: string; answer: string }) => ({
        question_id: h.question_id,
        answer: h.answer,
      }),
    ),
  });
  ctx.contextPack = contextPack;

  // Provenance (with ContextPack v1 lineage)
  pipelineTrace.cee_provenance = assembleCeeProvenance({
    pipelinePath: "unified",
    model: resolvedModel,
    promptVersion,
    promptSource: ctx.llmMeta?.prompt_source,
    promptStoreVersion: ctx.llmMeta?.prompt_store_version,
    // eslint-disable-next-line no-restricted-syntax -- ISSUE-9020 inherited not-yet-in-config; pending migration to src/config
    modelOverrideActive: Boolean(process.env.CEE_DRAFT_MODEL),
    // ContextPack v1 lineage (Stream C)
    contextHash: contextPack.context_hash,
    promptHash: contextPack.prompt_hash,
    modelId: contextPack.model_id,
    capability: contextPack.capability,
  });

  // LLM raw trace
  if (ctx.llmMeta?.raw_llm_text) {
    pipelineTrace.llm_raw = buildLLMRawTrace(ctx.requestId, ctx.llmMeta.raw_llm_text, ctx.graph as any, {
      model: ctx.llmMeta.model ?? ctx.draftAdapter?.model,
      promptVersion: ctx.llmMeta.prompt_version,
      storeOutput: true,
    });
  }

  // Unsafe additions
  if (ctx.opts.unsafeCaptureEnabled && ctx.llmMeta) {
    pipelineTrace.unsafe = { raw_output_preview: ctx.llmMeta.raw_output_preview };
  }

  // Attach pipeline trace to verified response
  verifiedResponse.trace = { ...verifiedResponse.trace, pipeline: pipelineTrace } as any;

  // ── Step 15: Graph frozen invariant check ────────────────────────────────
  if (graphSnapshot !== undefined && JSON.stringify(ctx.graph) !== graphSnapshot) {
    throw new Error("Stage 5 invariant violation: graph mutated during Package stage");
  }

  // ── Step 16: Populate ctx outputs ────────────────────────────────────────
  // Propagate structured outputs flag for diagnostic trace extraction
  if (ctx.llmMeta?.structured_outputs_used) {
    (verifiedResponse as Record<string, unknown>)._structured_outputs_used = true;
  }
  ctx.ceeResponse = verifiedResponse;
  ctx.pipelineTrace = pipelineTrace;
}
