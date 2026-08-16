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
// Deliberate cee → orchestrator/tools import: this adapter delegates whole-status
// semantics to buildAnalysisReadyPayload and must not be re-implemented here. It
// has no dual-draft dependency, so no import cycle arises.
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';

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

/**
 * G-size — per-proposal text-size caps. SINGLE SOURCE OF TRUTH for the merge
 * guard (the authoritative enforcement point) AND the structured-output JSON
 * schema mirror (proposal-json-schema.ts, a model-facing first fence only).
 * Lengths are character counts, except `uncertainty_drivers_items` which caps
 * the array element count.
 *
 * Policy: oversized fields are REJECTED per proposal (never truncated in the
 * merge). A truncated label would silently alter M2's committed content, and
 * proposals are advisory — same reject-not-clamp stance as G10/G14. Values are
 * generous defaults (real node labels are ~15–40 chars); tune here only.
 */
export const PROPOSAL_FIELD_CAPS = {
  node_id: 128,
  label: 200,
  description: 1000,
  uncertainty_drivers_items: 12,
  uncertainty_driver_length: 120,
  evidence_pointer: 300,
  rationale: 500,
  question: 500,
} as const;

/**
 * Injectable cap shape: every {@link PROPOSAL_FIELD_CAPS} key, widened from its
 * `as const` literal to `number`. `findOversizedProposalField`'s `caps` parameter
 * uses this so a caller/test can inject a DIFFERENT tuning (e.g. a smaller cap) —
 * the whole point of the injectable parameter. Typing the parameter as
 * `typeof PROPOSAL_FIELD_CAPS` (literal `300`, etc.) instead made every injected
 * override a type error (e.g. `evidence_pointer: 3` → "Type '3' is not assignable
 * to type '300'"). `PROPOSAL_FIELD_CAPS` (literal-typed) remains assignable here.
 */
export type ProposalFieldCaps = { readonly [K in keyof typeof PROPOSAL_FIELD_CAPS]: number };

export interface OversizedField {
  readonly field: string;
  /** Character count for text fields; element count for the drivers-array cap. */
  readonly length: number;
  readonly cap: number;
}

/**
 * Returns the first proposal text field exceeding {@link PROPOSAL_FIELD_CAPS},
 * or null. Reads raw fields defensively (delta.node stays `unknown` until the
 * merge's NodeV3 parse) so oversized input is rejected before schema parsing.
 * Envelope text (evidence_pointer, rationale, delta.question) is checked for
 * every proposal type; node text (id, label, description, uncertainty_drivers)
 * only when a delta.node object is present.
 *
 * Length is JS `String.length` = UTF-16 code units, not bytes/code points/
 * graphemes. That is a deliberate, conventional proxy: it blocks visual-length
 * tricks (combining/zero-width chars still count) and bounds UTF-8 byte size to
 * within a small constant factor (<= ~3 bytes/code unit, or 2 code units for an
 * astral char = 4 bytes), which — with PROPOSAL_CAP and the graph node/edge caps
 * — bounds aggregate merged growth. It is NOT a total-serialised-graph byte cap;
 * a graph-level byte ceiling, if ever wanted, is a separate PLoT-boundary
 * concern, not this per-field guard.
 */
export function findOversizedProposalField(
  proposal: {
    readonly evidence_pointer?: unknown;
    readonly rationale?: unknown;
    readonly delta?: unknown;
  },
  caps: ProposalFieldCaps = PROPOSAL_FIELD_CAPS,
): OversizedField | null {
  const check = (field: string, value: unknown, cap: number): OversizedField | null =>
    typeof value === 'string' && value.length > cap ? { field, length: value.length, cap } : null;

  let hit = check('evidence_pointer', proposal.evidence_pointer, caps.evidence_pointer);
  if (hit) return hit;
  hit = check('rationale', proposal.rationale, caps.rationale);
  if (hit) return hit;

  const delta =
    proposal.delta !== null && typeof proposal.delta === 'object'
      ? (proposal.delta as { node?: unknown; question?: unknown })
      : null;
  if (delta === null) return null;

  hit = check('delta.question', delta.question, caps.question);
  if (hit) return hit;

  const node =
    delta.node !== null && typeof delta.node === 'object' && !Array.isArray(delta.node)
      ? (delta.node as Record<string, unknown>)
      : null;
  if (node === null) return null;

  hit = check('delta.node.id', node.id, caps.node_id);
  if (hit) return hit;
  hit = check('delta.node.label', node.label, caps.label);
  if (hit) return hit;
  hit = check('delta.node.description', node.description, caps.description);
  if (hit) return hit;

  const drivers = node.uncertainty_drivers;
  if (Array.isArray(drivers)) {
    if (drivers.length > caps.uncertainty_drivers_items) {
      return {
        field: 'delta.node.uncertainty_drivers',
        length: drivers.length,
        cap: caps.uncertainty_drivers_items,
      };
    }
    for (let i = 0; i < drivers.length; i++) {
      hit = check(`delta.node.uncertainty_drivers[${i}]`, drivers[i], caps.uncertainty_driver_length);
      if (hit) return hit;
    }
  }
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
  // Canonical whole-status structural block: known and explicitly worse than
  // every recoverable input state, but distinct from an unknown future token
  // or an underivable record.
  blocked: 4,
};
const RANK_UNKNOWN_STATUS = 5;
const RANK_UNDERIVABLE = 6;

function readinessRank(graph: GraphV3T): { rank: number; status: string | null } {
  const payload = buildCanonicalAnalysisReadyFromGraph(graph);
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
