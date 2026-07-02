/**
 * V6 dual-draft deterministic guards.
 *
 * G10 — numeric sanity + field allowlists. EdgeStrengthV3.mean is documented
 *   as [-1, +1] but the Zod schema leaves it unbounded, and the pipeline's
 *   clamps (src/cee/transforms/schema-v3.ts) are module-private to the
 *   pipeline transform — a post-pipeline merge bypasses them. Proposals are
 *   advisory, so out-of-bounds values are REJECTED, never clamped. The field
 *   allowlists keep every value-bearing channel (observed_state, thresholds,
 *   priors, interventions, …) closed to M2: model VALUES belong to the user
 *   and the engine, not the reviewer.
 *
 * G12 — analysis-ready no-downgrade. (i) Option-surface invariance: the merge
 *   must leave option nodes and option-adjacent edges byte-identical.
 *   (ii) Structural-readiness recompute via the REAL readiness gate.
 *   Standing activation ruling: these structural checks are necessary but NOT
 *   sufficient — enabling the flag beyond local/dev additionally requires a
 *   proven merged-graph run_analysis SUCCESS; on failure the system degrades
 *   to M1-only.
 *
 * G14 — engine-boundary claim scan. The proposal schema has no field where an
 *   analysis number can live, so free text (question / rationale /
 *   evidence_pointer / labels) is the only leak channel. Engine-owned
 *   vocabulary (EVPI, VOI, flip points, robustness, sensitivity, quantified
 *   probabilities, "analysis shows…") rejects the proposal outright — a
 *   recorded failure, never a silent scrub.
 */
import type { GraphV3T } from '../../schemas/cee-v3.js';
// Deliberate cee → orchestrator/tools import: computeStructuralReadiness is the
// canonical pure readiness gate and must not be re-implemented here. It has no
// dual-draft (or orchestrator-v5) dependencies, so no import cycle arises.
import { computeStructuralReadiness } from '../../orchestrator/tools/analysis-ready-helper.js';

/** Node fields M2 may propose. Everything else is value-bearing or pipeline-owned. */
export const ALLOWED_NODE_DELTA_FIELDS = [
  'id',
  'kind',
  'label',
  'description',
  'category',
  'uncertainty_drivers',
] as const;

/** Edge fields M2 may propose. Provenance/validation/origin are pipeline-owned. */
export const ALLOWED_EDGE_DELTA_FIELDS = [
  'from',
  'to',
  'strength',
  'exists_probability',
  'effect_direction',
] as const;

/**
 * Returns the first own key of `raw` that is not in the allowlist, or null.
 * Non-objects return null — schema validation owns shape errors.
 */
export function findForbiddenProposalField(
  raw: unknown,
  allow: readonly string[],
): string | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  for (const key of Object.keys(raw)) {
    if (!allow.includes(key)) return key;
  }
  return null;
}

/** Engine-owned analysis vocabulary. A hit anywhere in proposal text rejects it. */
const ANALYSIS_CLAIM_PATTERNS: ReadonlyArray<{ readonly label: string; readonly re: RegExp }> = [
  { label: 'evpi', re: /\bEVPI\b/i },
  { label: 'voi', re: /\bVOI\b/i },
  { label: 'flip_point', re: /\bflip[\s-]?points?\b/i },
  { label: 'robustness', re: /\brobustness\b/i },
  { label: 'sensitivity_analysis', re: /\bsensitivity\s+analys[ie]s\b/i },
  { label: 'quantified_probability', re: /\d{1,3}(?:\.\d+)?\s*%\s*(?:probability|likely|likelihood|confidence|chance)/i },
  { label: 'analysis_result_claim', re: /\banalysis\s+(?:shows|indicates|computed|has computed|will show)\b/i },
  { label: 'win_probability', re: /\bwin\s+probabilit(?:y|ies)\b/i },
  { label: 'expected_value_of_information', re: /\bexpected\s+value\s+of\s+(?:information|perfect)/i },
];

/**
 * Scans the given texts for engine-owned analysis claims. Returns the label
 * of the first matching pattern, or null when all texts are clean/absent.
 */
export function findAnalysisClaim(...texts: Array<string | null | undefined>): string | null {
  for (const text of texts) {
    if (!text) continue;
    for (const { label, re } of ANALYSIS_CLAIM_PATTERNS) {
      if (re.test(text)) return label;
    }
  }
  return null;
}

/**
 * G10 numeric sanity for a proposed edge. Mirrors the pipeline's private
 * clamp bounds (clampStrengthMean [-1,+1]; boundStrengthStd floor 1e-6, cap
 * max(0.5, 2·|mean|)) — but rejects instead of clamping.
 */
export function checkEdgeNumericSanity(edge: {
  readonly strength: { readonly mean: number; readonly std: number };
}): string | null {
  const { mean, std } = edge.strength;
  if (Math.abs(mean) > 1) return `strength.mean ${mean} outside [-1, 1]`;
  if (std < 1e-6) return `strength.std ${std} below 1e-6 floor`;
  const stdCap = Math.max(0.5, 2 * Math.abs(mean));
  if (std > stdCap) return `strength.std ${std} above max(0.5, 2|mean|) cap ${stdCap}`;
  return null;
}

function optionSurface(graph: GraphV3T): string {
  const optionNodes = graph.nodes.filter((n) => n.kind === 'option');
  const optionIds = new Set(optionNodes.map((n) => n.id));
  const optionEdges = graph.edges.filter((e) => optionIds.has(e.from) || optionIds.has(e.to));
  return JSON.stringify({ nodes: optionNodes, edges: optionEdges });
}

/**
 * G12(i): true iff option nodes and option-adjacent edges are identical
 * between the pre-merge and post-merge graphs. The merge is constructed so
 * this always holds (option kinds deferred, option endpoints rejected) — this
 * guard re-asserts it at runtime as defence in depth.
 */
export function optionSurfaceUnchanged(before: GraphV3T, after: GraphV3T): boolean {
  return optionSurface(before) === optionSurface(after);
}

// Severity order for structural-readiness statuses. Lower = better. A payload
// that cannot be derived at all (no goal node) ranks worst.
const READINESS_RANK: Record<string, number> = {
  ready: 0,
  needs_encoding: 1,
  needs_user_mapping: 2,
  needs_user_input: 3,
};
const RANK_UNKNOWN_STATUS = 4;
const RANK_UNDERIVABLE = 5;

function readinessRank(graph: GraphV3T): { rank: number; status: string | null } {
  const payload = computeStructuralReadiness(graph);
  if (!payload) return { rank: RANK_UNDERIVABLE, status: null };
  const status = String(payload.status);
  return { rank: READINESS_RANK[status] ?? RANK_UNKNOWN_STATUS, status };
}

export interface ReadinessNoDowngradeResult {
  readonly ok: boolean;
  readonly before_status: string | null;
  readonly after_status: string | null;
}

/**
 * G12(ii): structural readiness of the merged graph must not be worse than
 * the M1 graph's. Necessary-but-not-sufficient by ruling — the activation
 * gate is real merged-graph run_analysis success, not this check.
 */
export function checkReadinessNoDowngrade(
  before: GraphV3T,
  after: GraphV3T,
): ReadinessNoDowngradeResult {
  const b = readinessRank(before);
  const a = readinessRank(after);
  return { ok: a.rank <= b.rank, before_status: b.status, after_status: a.status };
}
