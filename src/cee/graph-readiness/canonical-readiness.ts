/**
 * The readiness ROUTE's single admission assessor.
 *
 * ⭐ WHY THIS FILE EXISTS
 *
 * `/assist/v1/graph-readiness` used to choose its assessor from the REQUEST
 * BODY SHAPE: a payload carrying `analysis_ready.options[]` was scored by a
 * strict local predicate, and a payload without one fell through to the legacy
 * assessor whose `can_run_analysis` was a HARDCODED `true` literal gated only
 * by node-count minimums. The UI populates `analysis_ready` only from its own
 * CACHED state, so the readiness verdict was a function of CLIENT CACHE rather
 * than of the model: a fresh session and a warmed session received opposite
 * answers for the same graph, and the route path and the turn path answered
 * the same question with different predicates on one deploy.
 *
 * There is now ONE admission authority for both paths:
 * `assessCanonicalAnalysisReadiness` (the turn path's sole whole-model
 * assessor). This module is a thin ADAPTER over it — it owns no predicate of
 * its own about whether analysis may run.
 *
 * ⚠ THE ONE REAL SEAM, derived at the bytes (probe, this tip):
 * the route's request `Graph` schema and the canonical assessor's `GraphV3`
 * describe edges in TWO DIFFERENT WIRE FORMATS.
 *
 *   route `Graph` (EdgeInput):  strength_mean?  strength_std?  belief_exists?   (all OPTIONAL, flat)
 *   canonical `GraphV3` (EdgeV3): strength:{mean,std}  exists_probability  effect_direction  (all REQUIRED, nested)
 *
 * Handing a route-format graph straight to the canonical assessor therefore
 * returns `SCHEMA_INVALID` — for EVERY request, including healthy ones. That
 * was measured: a probe over six graphs returned a uniform "structure is
 * invalid", which is the tell that the probe, not the data, is at fault. So a
 * STRUCTURAL normalisation is required before the assessor can see the model
 * at all.
 *
 * ⚠ AND THE HONESTY CONSTRAINT ON THAT NORMALISATION: filling in required edge
 * PARAMETERS could fabricate evidence. It does not, and that is not an
 * assumption — `__tests__/canonical-readiness.invariance.test.ts` asserts it.
 *
 * That file sweeps std ∈ {0.01, 0.1, 0.5} × exists_probability ∈ {0, 0.5, 1} ×
 * effect_direction ∈ {positive, negative} — 18 points — across a five-graph
 * corpus that admits BOTH ways (healthy · one unconfigured option · goal-less ·
 * mixed explicit/absent edge fields · identical options), and asserts the
 * `can_run_analysis` verdict and every `readiness_issues[]` entry BY IDENTITY
 * (code · option_id · factor_id, as a full set, never a count) are unchanged.
 * It works in the INPUT SPACE — comparing a graph whose edges omit the fields
 * against the same graph carrying each sweep value explicitly — so it pins the
 * stronger property that NO synthesis choice can move admission, not merely
 * that today's two constants happen to be inert. It carries a negative control
 * (removing an option's interventions MUST flip the verdict), because an
 * invariance probe that cannot see a difference is not evidence of invariance.
 *
 * The reason the parameters are inert: they exist only to satisfy `EdgeV3`'s
 * required keys, and the admission assessment reads graph CONNECTIVITY and
 * option INTERVENTIONS, not edge weights.
 *
 * ⚠ THE CITATION CAME FIRST AND THE FILE DID NOT — for the module's whole life
 * until 2026-08-16 this paragraph named a test that did not exist (the
 * invariance had been shown once by a build-time mutant and never pinned). If
 * you are reading a claim like this one anywhere in this repo, open the file.
 *
 * If that invariance ever breaks, the test REDs and this adapter is
 * fabricating — treat it as a hard stop, not a flake.
 *
 * ⭐ TWO QUESTIONS, NAMED APART (the defect class this route already shipped
 * once): "how good is this model?" and "may analysis run?" are DIFFERENT
 * questions. Conflating them under one score is what let a quality heuristic
 * answer an admission question. The legacy assessor still answers the first
 * (quality_factors, evidence_quality — coaching). It no longer answers the
 * second. Only the canonical assessment does.
 */

import type { CanonicalReadinessIssue } from "../../orchestrator/tools/analysis-ready-helper.js";
import { resolveRunAdmission } from "../../orchestrator-v5/tools/handlers/analysis-ready-core.js";

/** Default parametric uncertainty. Must be > 0 to satisfy `EdgeStrengthV3`. */
const SYNTHETIC_STRENGTH_STD = 0.1;
/** Default existence probability when the request carries no belief field. */
const SYNTHETIC_EXISTS_PROBABILITY = 1;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstFiniteNumber(...candidates: unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Normalise ONE edge from the route's flat wire format to `EdgeV3`'s nested,
 * required-field format. Structural only: an edge that already carries the
 * canonical shape is passed through untouched.
 */
function normaliseEdge(edge: unknown): unknown {
  const e = asRecord(edge);
  if (!e) return edge;

  const existingStrength = asRecord(e.strength);
  const mean =
    firstFiniteNumber(existingStrength?.mean, e.strength_mean, e.weight) ?? 0;
  const std =
    firstFiniteNumber(existingStrength?.std, e.strength_std) ?? SYNTHETIC_STRENGTH_STD;

  const existsProbability =
    firstFiniteNumber(e.exists_probability, e.belief_exists, e.belief) ??
    SYNTHETIC_EXISTS_PROBABILITY;

  const effectDirection =
    e.effect_direction === "positive" || e.effect_direction === "negative"
      ? e.effect_direction
      : mean < 0
        ? "negative"
        : "positive";

  return {
    ...e,
    strength: { mean, std: std > 0 ? std : SYNTHETIC_STRENGTH_STD },
    exists_probability: Math.min(1, Math.max(0, existsProbability)),
    effect_direction: effectDirection,
  };
}

/**
 * Project a request graph into the shape the canonical assessor can parse.
 * Pure — the caller's graph is never mutated.
 */
export function toCanonicalAssessableGraph(graph: unknown): unknown {
  const g = asRecord(graph);
  if (!g || !Array.isArray(g.edges)) return graph;
  return { ...g, edges: g.edges.map(normaliseEdge) };
}

/** A per-option, per-factor blocker the UI's draft-missing-values affordance can act on. */
export interface RouteReadinessBlocker {
  readonly code: string;
  readonly category: string;
  readonly message: string;
  readonly repairability: string;
  readonly option_id?: string;
  readonly option_label?: string;
  readonly factor_id?: string;
  readonly factor_label?: string;
}

export interface RouteReadinessCritique {
  readonly code: string;
  readonly severity: "warn" | "error";
  readonly message: string;
}

/**
 * Pre-run projection of the run path's scaffold decision.
 *
 * ⚠ RETAINED DELIBERATELY, against this lane's original brief, on evidence.
 * The brief listed `scaffold_plan` for deletion as "papering over the two
 * assessors disagreeing". Derived at the deployed UI
 * (DecisionGuideAI@9a8b84c6) it is LOAD-BEARING: `canRunAnalysis.ts:230-232`
 * feeds `readinessWillScaffold` into `readinessObjectsToRun` (`:255`), so the
 * effective Run gate is
 *     allowed = can_run_analysis || scaffold_plan.will_scaffold_options
 * Dropping the field is fail-safe in the crash sense (it degrades to
 * `undefined`) but turns every graph the run WOULD have scaffolded into a hard
 * block. It is kept — but it is no longer computed from the client's cached
 * `analysis_ready`; it is computed from the CANONICAL options, so it cannot
 * reintroduce the payload-shape dependence this lane exists to remove.
 */
export interface RouteScaffoldPlan {
  readonly will_scaffold_options: boolean;
  readonly option_count?: number;
}

/** The route's admission verdict — derived wholly from the canonical assessment. */
export interface RouteAdmissionVerdict {
  readonly can_run_analysis: boolean;
  readonly blocker_reason?: string;
  readonly readiness_issues: RouteReadinessBlocker[];
  readonly issues: string[];
  readonly options_ready: number;
  readonly options_total: number;
  readonly goal_node_valid: boolean;
  readonly critiques?: RouteReadinessCritique[];
  readonly scaffold_plan: RouteScaffoldPlan;
}

function toBlocker(issue: CanonicalReadinessIssue): RouteReadinessBlocker {
  return {
    code: issue.code,
    category: issue.category,
    message: issue.message,
    repairability: issue.repairability,
    ...(issue.option_id ? { option_id: issue.option_id } : {}),
    ...(issue.option_label ? { option_label: issue.option_label } : {}),
    ...(issue.factor_id ? { factor_id: issue.factor_id } : {}),
    ...(issue.factor_label ? { factor_label: issue.factor_label } : {}),
  };
}

/**
 * Option-distinctiveness critique, derived from the GRAPH's own option
 * interventions.
 *
 * This capability previously lived inside the deleted payload-shape assessor
 * and read the client's cached `analysis_ready.options[]`. It is retained
 * because it surfaces a real PLoT preflight failure ("identical options")
 * before the run — but it is now derived from the model, like every other
 * answer this route gives.
 */
function computeCritiques(graph: unknown): RouteReadinessCritique[] {
  const g = asRecord(graph);
  const nodes = Array.isArray(g?.nodes) ? g!.nodes : [];

  const optionMaps: Array<Record<string, number>> = [];
  for (const node of nodes) {
    const n = asRecord(node);
    if (!n || n.kind !== "option") continue;
    if (n.is_baseline === true) continue;

    const data = asRecord(n.data);
    const source = asRecord(n.interventions) ?? asRecord(data?.interventions);
    if (!source) continue;

    const numeric: Record<string, number> = {};
    for (const [key, raw] of Object.entries(source)) {
      const value =
        typeof raw === "number"
          ? raw
          : firstFiniteNumber(asRecord(raw)?.value);
      if (typeof value === "number" && Number.isFinite(value)) numeric[key] = value;
    }
    if (Object.keys(numeric).length > 0) optionMaps.push(numeric);
  }

  if (optionMaps.length < 2) return [];

  const sameProfile = (a: Record<string, number>, b: Record<string, number>): boolean => {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return false;
    return ka.every((k) => Math.abs(a[k] - b[k]) < 0.01);
  };

  let identicalPairs = 0;
  for (let i = 0; i < optionMaps.length; i += 1) {
    for (let j = i + 1; j < optionMaps.length; j += 1) {
      if (sameProfile(optionMaps[i], optionMaps[j])) identicalPairs += 1;
    }
  }

  return identicalPairs > 0
    ? [
        {
          code: "IDENTICAL_OPTION_INTERVENTIONS",
          severity: "warn",
          message:
            "Options have identical intervention profiles and cannot be meaningfully distinguished by analysis.",
        },
      ]
    : [];
}

/**
 * THE route's admission verdict. One assessor, one answer, derived from the
 * graph alone — never from the request's `analysis_ready` cache.
 */
export function assessRouteAdmission(graph: unknown): RouteAdmissionVerdict {
  const assessableGraph = toCanonicalAssessableGraph(graph);
  // ⚠ ONE assessment for the whole route. This used to call
  // `assessCanonicalAnalysisReadiness` here AND again inside
  // `resolveRunAdmission` — measured +28% on a route the canvas hits on every
  // change, and two independent calls could in principle disagree about the
  // same graph, which is the hazard this module exists to remove.
  const admission = resolveRunAdmission(assessableGraph);
  const assessment = admission.assessment;

  const payload = assessment.analysisReady as
    | {
        goal_node_id?: string;
        options?: Array<{
          option_id?: string;
          label?: string;
          status?: string;
          interventions?: Record<string, number>;
        }>;
      }
    | undefined;

  const options = payload?.options ?? [];
  const optionsTotal = options.length;
  const optionsReady = options.filter((option) => option.status === "ready").length;

  const goalNodeId = payload?.goal_node_id ?? "";
  const nodes = Array.isArray(asRecord(graph)?.nodes) ? (asRecord(graph)!.nodes as unknown[]) : [];
  const goalNodeValid =
    goalNodeId.length > 0 && nodes.some((node) => asRecord(node)?.id === goalNodeId);

  const readinessIssues = assessment.blockingIssues.map(toBlocker);

  // Scaffold projection — now the RUN PATH'S OWN ADMISSION OBJECT, not a
  // parallel computation of it.
  //
  // ⚠ IT USED TO BE `computeScaffoldPlan` ALONE, AND THAT WAS HALF THE ANSWER
  // (row 2.1235 / NEW-1 / L-63, 2026-08-16). `computeScaffoldPlan` reports
  // whether EXCLUSION leaves a submittable set — it knows nothing about the
  // OTHER blockers on the graph. So a model with a structural or numeric
  // blocker AND an unconfigured option advertised `will_scaffold_options: true`
  // while the run refused, because the deployed UI's gate is
  //     allowed = can_run_analysis || scaffold_plan.will_scaffold_options
  // (`DecisionGuideAI@f15bccaf canRunAnalysis.ts:230-232`, `:255`).
  //
  // `resolveRunAdmission` is the predicate `build-turn-context.ts` admits on, so
  // this field now answers its documented question — *"will the run proceed even
  // though not every option is configured?"* — with the run path's own answer
  // rather than with a projection of one term of it.

  return {
    can_run_analysis: assessment.safeToAnalyse,
    ...(assessment.safeToAnalyse
      ? {}
      : { blocker_reason: readinessIssues[0]?.message ?? "This model is not ready to analyse." }),
    readiness_issues: readinessIssues,
    issues: readinessIssues.map((issue) => issue.message),
    options_ready: optionsReady,
    options_total: optionsTotal,
    goal_node_valid: goalNodeValid,
    ...((): { critiques?: RouteReadinessCritique[] } => {
      const critiques = computeCritiques(graph);
      return critiques.length > 0 ? { critiques } : {};
    })(),
    scaffold_plan: {
      // BOTH terms. `plan.will_scaffold_options` says exclusion leaves a
      // submittable set; `willProceed` says nothing ELSE blocks the run. The
      // panel may only offer when both hold.
      will_scaffold_options: admission.plan.will_scaffold_options && admission.willProceed,
      ...(admission.plan.will_scaffold_options && admission.willProceed
        ? { option_count: admission.plan.option_count }
        : {}),
    },
  };
}
