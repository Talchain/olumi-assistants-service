/**
 * Shared graph adapters for analysis_ready.
 *
 * `buildCanonicalAnalysisReadyFromGraph` is the sole whole-status projection:
 * it adapts persisted/request graph carriers, then delegates semantics to the
 * pipeline's `buildAnalysisReadyPayload`. The legacy structural helper below
 * remains exported only for compatibility tests and per-option diagnostics.
 */

import { GraphV3 } from "../../schemas/cee-v3.js";
import type { GraphV3T, OptionV3T } from "../../schemas/cee-v3.js";
import type { GraphPatchBlockData } from "../types.js";
import { log } from "../../utils/telemetry.js";
import {
  buildAnalysisReadyPayload,
  labelMatchesBaseline,
} from "../../cee/transforms/analysis-ready.js";
import { pickGoalThresholdTrio } from "../../utils/goal-threshold-trio.js";

// ============================================================================
// Types
// ============================================================================

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

// ============================================================================
// Intervention Extraction
// ============================================================================

/**
 * Extract a normalised numeric value (0-1 scale) from an intervention entry.
 * Handles both flat numbers and InterventionV3 objects `{ value: number, ... }`.
 * Extracts `.value` (the normalised numeric), NOT `.raw_value`.
 * @internal Exported for testing.
 */
export function extractNumericIntervention(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object' && 'value' in v) {
    const inner = (v as Record<string, unknown>).value;
    if (typeof inner === 'number' && Number.isFinite(inner)) return inner;
  }
  return undefined;
}

/**
 * Merge intervention values from all known locations on an option node.
 *
 * Scope: the canonical graph adapter and the quarantined compatibility helper
 * both need to read historical intervention carriers. Do not add whole-status
 * policy here; the canonical rule lives in `buildAnalysisReadyPayload`.
 *
 * Sources (in precedence order — first write wins per factor_id):
 * 1. `node.data.interventions` — prompt-taught canonical edit location (wins on conflict)
 * 2. `node["data/interventions/<fac_id>"]` — slash-keyed flat entries from scalar wrapping
 * 3. `node.interventions` — top-level passthrough (fallback only)
 *
 * data.interventions wins over top-level because edit_graph writes to
 * data.interventions per the prompt, while top-level may contain stale
 * values from a prior pipeline run.
 *
 * Fix 1A: the read path consults all three sources unconditionally. Previously
 * Sources 1+2 were gated behind CEE_EDIT_INTERVENTION_ROUTING_ENABLED, which
 * caused add_option (and any other handler that rebuilds a synthetic graph
 * post-mutation) to silently lose existing options' interventions whenever
 * the flag was off and those options happened to carry interventions at
 * `data.interventions` rather than the top-level field. The flag still gates
 * where future writers WRITE slash-keyed entries, but the read side must
 * always consider every known location.
 *
 * @internal Exported for testing.
 */
export function mergeInterventionSources(nodeAny: Record<string, unknown>): Record<string, number> | undefined {
  const merged: Record<string, number> = {};
  let found = false;

  // Source 1 (highest precedence): node.data.interventions — canonical edit location
  const data = nodeAny.data;
  if (data && typeof data === 'object') {
    const dataInterventions = (data as Record<string, unknown>).interventions;
    if (dataInterventions && typeof dataInterventions === 'object') {
      for (const [k, v] of Object.entries(dataInterventions as Record<string, unknown>)) {
        const num = extractNumericIntervention(v);
        if (num !== undefined) {
          merged[k] = num;
          found = true;
          log.info(
            { event: 'analysis_ready.intervention_merged', source: 'data.interventions', factor_id: k },
            `analysis_ready merged intervention from data.interventions: ${k}`,
          );
        }
      }
    }
  }

  // Source 2: flat slash-keyed entries like "data/interventions/fac_1"
  for (const [k, v] of Object.entries(nodeAny)) {
    const match = k.match(/^data\/interventions\/(.+)$/);
    if (!match) continue;
    const facId = match[1];
    if (facId in merged) continue; // data.interventions already set
    const num = extractNumericIntervention(v);
    if (num !== undefined) {
      merged[facId] = num;
      found = true;
      log.info(
        { event: 'analysis_ready.intervention_merged', source: 'slash_keyed', factor_id: facId, field_from: k },
        `analysis_ready merged intervention from slash-keyed entry: ${k}`,
      );
    }
  }

  // Source 3 (lowest precedence): top-level node.interventions — fallback
  if (nodeAny.interventions && typeof nodeAny.interventions === 'object') {
    for (const [k, v] of Object.entries(nodeAny.interventions as Record<string, unknown>)) {
      if (k in merged) continue; // higher-precedence source already set
      const num = extractNumericIntervention(v);
      if (num !== undefined) {
        merged[k] = num;
        found = true;
      }
    }
  }

  return found ? merged : undefined;
}

/**
 * Returns true exactly when `extractNumericIntervention(v)` would return a
 * finite number — bare finite number, or object with a finite numeric
 * `.value`. Mirrors that function's acceptance predicate VERBATIM (same
 * `typeof === 'object'` + `'value' in v` test, no extra array special-casing)
 * so the object-preserving merge below selects the same source and the same
 * factor set as the numeric `mergeInterventionSources`.
 * @internal Exported for testing.
 */
export function hasFiniteInterventionValue(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (v && typeof v === 'object' && 'value' in v) {
    const inner = (v as Record<string, unknown>).value;
    return typeof inner === 'number' && Number.isFinite(inner);
  }
  return false;
}

/**
 * Object-preserving sibling of `mergeInterventionSources`.
 *
 * `mergeInterventionSources` collapses each entry to a bare number via
 * `extractNumericIntervention`, discarding `raw_value` / `unit` / `cap` /
 * `value_type`. The CEE → PLoT egress value-scale protection
 * (`plot-intervention-scale.ts`) needs those fields to decide raw vs
 * normalised, so this returns the ORIGINAL intervention entry (object or bare
 * number) per factor_id.
 *
 * Precedence and membership are IDENTICAL to `mergeInterventionSources`: same
 * source order (1 `data.interventions` > 2 slash-keyed > 3 top-level
 * `interventions`), same container guards (`typeof === 'object'`), and the same
 * per-entry acceptance predicate (`hasFiniteInterventionValue`, which mirrors
 * `extractNumericIntervention`). The two therefore produce the SAME key set and
 * pick from the SAME source per factor_id — verified by a parity test. The only
 * difference is the value shape (original entry vs bare number) and the
 * empty-result encoding (`{}` here vs `undefined` there). Keep in sync.
 * Read-only: never mutates the node.
 * @internal Exported for the egress projection + testing.
 */
export function mergeInterventionSourceObjects(
  nodeAny: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  // Source 1 (highest precedence): node.data.interventions
  const data = nodeAny.data;
  if (data && typeof data === 'object') {
    const dataInterventions = (data as Record<string, unknown>).interventions;
    if (dataInterventions && typeof dataInterventions === 'object') {
      for (const [k, v] of Object.entries(dataInterventions as Record<string, unknown>)) {
        if (!(k in merged) && hasFiniteInterventionValue(v)) merged[k] = v;
      }
    }
  }

  // Source 2: flat slash-keyed entries like "data/interventions/fac_1"
  for (const [k, v] of Object.entries(nodeAny)) {
    const match = k.match(/^data\/interventions\/(.+)$/);
    if (!match) continue;
    const facId = match[1];
    if (facId in merged) continue;
    if (hasFiniteInterventionValue(v)) merged[facId] = v;
  }

  // Source 3 (lowest precedence): top-level node.interventions
  if (nodeAny.interventions && typeof nodeAny.interventions === 'object') {
    for (const [k, v] of Object.entries(nodeAny.interventions as Record<string, unknown>)) {
      if (k in merged) continue;
      if (hasFiniteInterventionValue(v)) merged[k] = v;
    }
  }

  return merged;
}

// ============================================================================
// Canonical persisted-graph projection
// ============================================================================

type Dict = Record<string, unknown>;

function isPlainObject(value: unknown): value is Dict {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readOptionStatus(value: unknown): OptionV3T['status'] | undefined {
  return value === 'ready' || value === 'needs_user_mapping' || value === 'needs_encoding'
    ? value
    : undefined;
}

function readRawInterventions(value: unknown): OptionV3T['raw_interventions'] | undefined {
  if (!isPlainObject(value)) return undefined;
  const out: NonNullable<OptionV3T['raw_interventions']> = {};
  for (const [factorId, raw] of Object.entries(value)) {
    if (typeof raw === 'number' || typeof raw === 'string' || typeof raw === 'boolean') {
      out[factorId] = raw;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Adapt one persisted option carrier (canonical top-level option first,
 * option-node fallback second) into the input shape consumed by
 * `buildAnalysisReadyPayload`.
 *
 * Persisted option nodes sometimes carry only `{value}` rather than the full
 * InterventionV3 provenance record. Readiness needs the value and the exact
 * factor identity, not invented provenance. The adapter therefore adds only a
 * transient exact-id target match so the canonical builder can consume the
 * record; it deliberately omits `source`, and the outward projection below
 * drops `extraction_metadata`. No synthetic provenance reaches the wire.
 */
function projectOptionForCanonicalBuilder(
  candidate: unknown,
  factorIds: ReadonlySet<string>,
  connectedFactorIds: ReadonlySet<string> = new Set<string>(),
): OptionV3T | null {
  if (!isPlainObject(candidate)) return null;
  const id = readNonEmptyString(candidate.id);
  const label = readNonEmptyString(candidate.label);
  if (!id || !label) return null;

  const interventions: Record<string, unknown> = {};
  const sourceBundle = isPlainObject(candidate.interventions)
    ? candidate.interventions
    : mergeInterventionSourceObjects(candidate);
  for (const [factorId, raw] of Object.entries(sourceBundle)) {
    if (!factorIds.has(factorId)) continue;
    const value = extractNumericIntervention(raw);
    if (value === undefined) continue;
    const carried = isPlainObject(raw) ? raw : {};
    interventions[factorId] = {
      ...carried,
      value,
      target_match: isPlainObject(carried.target_match)
        ? carried.target_match
        : { node_id: factorId, match_type: 'exact_id', confidence: 'high' },
    };
  }

  const rawInterventions = readRawInterventions(candidate.raw_interventions);
  const explicitStatus = readOptionStatus(candidate.status);
  const status: OptionV3T['status'] = explicitStatus
    ?? (rawInterventions && Object.values(rawInterventions).some((value) => typeof value !== 'number')
      ? 'needs_encoding'
      : Object.keys(interventions).length > 0
        ? 'ready'
        : connectedFactorIds.size > 0
          ? 'needs_encoding'
          : 'needs_user_mapping');

  return {
    id,
    label,
    status,
    interventions: interventions as OptionV3T['interventions'],
    ...(rawInterventions ? { raw_interventions: rawInterventions } : {}),
    ...(Array.isArray(candidate.unresolved_targets)
      ? {
          unresolved_targets: candidate.unresolved_targets.filter(
            (value): value is string => typeof value === 'string',
          ),
        }
      : {}),
    ...(Array.isArray(candidate.user_questions)
      ? {
          user_questions: candidate.user_questions.filter(
            (value): value is string => typeof value === 'string',
          ),
        }
      : {}),
    ...(candidate.is_baseline === true || candidate.is_baseline === false
      ? { is_baseline: candidate.is_baseline }
      : {}),
  };
}

function projectCanonicalPayloadToWire(
  payload: ReturnType<typeof buildAnalysisReadyPayload>,
): AnalysisReadyPayload {
  return {
    options: payload.options.map((option) => {
      const interventions: Record<string, number> = {};
      for (const [factorId, raw] of Object.entries(option.interventions)) {
        const value = extractNumericIntervention(raw);
        if (value !== undefined) interventions[factorId] = value;
      }
      return {
        option_id: option.id,
        label: option.label,
        status: option.status,
        interventions,
        ...(option.is_baseline !== undefined ? { is_baseline: option.is_baseline } : {}),
        ...(option.intervention_details !== undefined
          ? { intervention_details: option.intervention_details }
          : {}),
        ...(option.raw_interventions !== undefined
          ? { raw_interventions: option.raw_interventions }
          : {}),
        ...(option.status_reason !== undefined ? { status_reason: option.status_reason } : {}),
      };
    }),
    goal_node_id: payload.goal_node_id,
    status: payload.status,
    ...(payload.blockers !== undefined ? { blockers: payload.blockers } : {}),
    ...(payload.model_adjustments !== undefined
      ? { model_adjustments: payload.model_adjustments }
      : {}),
    ...(payload.goal_threshold !== undefined ? { goal_threshold: payload.goal_threshold } : {}),
    ...pickGoalThresholdTrio(payload),
    ...(payload.bias_findings !== undefined ? { bias_findings: payload.bias_findings } : {}),
  };
}

/**
 * Build the canonical whole-graph readiness payload from request, mutated, or
 * persisted graph bytes.
 *
 * This is the sole graph-to-whole-status projection for V5 Run admission. It
 * delegates the status decision to `buildAnalysisReadyPayload`, including its
 * unreachable-controllable-factor rule, instead of maintaining a second
 * graph-only status algorithm. Canonical top-level `options[]` wins when it is
 * present; option nodes are a conservative persistence/legacy fallback.
 */
export function buildCanonicalAnalysisReadyFromGraph(
  graph: unknown,
): AnalysisReadyPayload | undefined {
  const parsed = GraphV3.safeParse(graph);
  if (!parsed.success) return undefined;

  const rawGraph = isPlainObject(graph) ? graph : parsed.data as unknown as Dict;
  const goalNodes = parsed.data.nodes.filter((node) => node.kind === 'goal');
  const suppliedGoalId = readNonEmptyString(rawGraph.goal_node_id);
  const goalNodeId = suppliedGoalId && goalNodes.some((node) => node.id === suppliedGoalId)
    ? suppliedGoalId
    : goalNodes[0]?.id;
  if (!goalNodeId) return undefined;

  const factorIds = new Set(
    parsed.data.nodes.filter((node) => node.kind === 'factor').map((node) => node.id),
  );
  const rawNodes = Array.isArray(rawGraph.nodes) ? rawGraph.nodes : parsed.data.nodes;
  const optionNodeRecords = rawNodes.filter(
    (node): node is Dict => isPlainObject(node) && node.kind === 'option',
  );
  const optionNodeIds = new Set(
    optionNodeRecords
      .map((node) => readNonEmptyString(node.id))
      .filter((id): id is string => id !== null),
  );
  const optionConnectedFactorIds = new Map<string, Set<string>>();
  for (const edge of parsed.data.edges) {
    if (!optionNodeIds.has(edge.from) || !factorIds.has(edge.to)) continue;
    const connected = optionConnectedFactorIds.get(edge.from) ?? new Set<string>();
    connected.add(edge.to);
    optionConnectedFactorIds.set(edge.from, connected);
  }

  const projectedTopLevel = Array.isArray(rawGraph.options)
    ? rawGraph.options
        .map((option) => {
          const id = isPlainObject(option) ? readNonEmptyString(option.id) : null;
          return projectOptionForCanonicalBuilder(
            option,
            factorIds,
            id ? optionConnectedFactorIds.get(id) : undefined,
          );
        })
        .filter(
          (option): option is OptionV3T => option !== null && optionNodeIds.has(option.id),
        )
    : [];
  const topLevelById = new Map(projectedTopLevel.map((option) => [option.id, option]));

  // Preserve the producer's canonical option order when it completely covers
  // the option-node set. A partial/stale mirror falls back to node order and
  // fills each missing entry from that node, never silently dropping an arm.
  const options = projectedTopLevel.length === optionNodeRecords.length
    ? projectedTopLevel
    : optionNodeRecords
        .map((node) => {
          const id = readNonEmptyString(node.id);
          return id
            ? topLevelById.get(id)
              ?? projectOptionForCanonicalBuilder(node, factorIds, optionConnectedFactorIds.get(id))
            : null;
        })
        .filter((option): option is OptionV3T => option !== null);

  const canonical = buildAnalysisReadyPayload(options, goalNodeId, parsed.data);
  return projectCanonicalPayloadToWire(canonical);
}

// ============================================================================
// Readiness Computation
// ============================================================================

/**
 * Compute legacy structural option readiness from a graph.
 *
 * @deprecated Compatibility/test detail only. Production Run admission and
 * whole-status consumers must use `buildCanonicalAnalysisReadyFromGraph`.
 *
 * Returns undefined if no goal node exists (cannot determine readiness).
 *
 * Status logic (mirrors src/cee/transforms/analysis-ready.ts):
 * - "ready": all options have at least one numeric intervention
 * - "needs_user_mapping": some options lack numeric interventions
 * - "needs_user_input": fewer than 2 options
 */
export function computeStructuralReadiness(
  graph: GraphV3T,
): AnalysisReadyPayload | undefined {
  const goalNode = graph.nodes.find((n) => n.kind === 'goal');
  if (!goalNode) return undefined;

  const optionNodes = graph.nodes.filter((n) => n.kind === 'option');

  // Build edge map from options to factors for intervention lookup
  const optionToFactors = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    // Edges from option nodes to factor/goal nodes represent interventions
    const sourceNode = graph.nodes.find((n) => n.id === edge.from);
    if (sourceNode?.kind === 'option') {
      if (!optionToFactors.has(edge.from)) {
        optionToFactors.set(edge.from, new Set());
      }
      optionToFactors.get(edge.from)!.add(edge.to);
    }
  }

  const options: AnalysisReadyPayload['options'] = [];

  for (const opt of optionNodes) {
    const nodeAny = opt as Record<string, unknown>;
    const interventions = mergeInterventionSources(nodeAny);
    const connectedFactors = optionToFactors.get(opt.id) ?? new Set<string>();

    // Option is ready if it has numeric interventions or connected factors
    const hasNumericInterventions = interventions != null
      && Object.keys(interventions).length > 0
      && Object.values(interventions).every((v) => typeof v === 'number');

    let status: string;
    if (hasNumericInterventions) {
      status = 'ready';
    } else if (connectedFactors.size > 0) {
      // Connected but no encoded interventions yet
      status = 'needs_encoding';
    } else {
      status = 'needs_user_mapping';
    }

    options.push({
      option_id: opt.id,
      label: opt.label,
      status,
      interventions: interventions ?? {},
    });
  }

  // === is_baseline detection (CEE-2) ===
  // Mirror the detection logic from buildAnalysisReadyPayload:
  // Priority 1: node-level is_baseline flag from LLM
  // Priority 2: label keyword match via shared BASELINE_KEYWORDS
  // Non-matching options get explicit false (not omitted) so downstream can
  // distinguish "detected as not baseline" from "detection didn't run".
  let baselineIdx: number | null = null;
  for (let i = 0; i < optionNodes.length; i++) {
    if ((optionNodes[i] as Record<string, unknown>).is_baseline === true) {
      baselineIdx = i;
      break;
    }
  }
  if (baselineIdx === null) {
    for (let i = 0; i < options.length; i++) {
      if (labelMatchesBaseline(options[i].label)) {
        baselineIdx = i;
        break;
      }
    }
  }
  for (let i = 0; i < options.length; i++) {
    options[i].is_baseline = i === baselineIdx;
  }

  // Determine overall status
  let payloadStatus: string;
  if (options.length < 2) {
    payloadStatus = 'needs_user_input';
  } else if (options.some((o) => o.status === 'needs_user_mapping')) {
    payloadStatus = 'needs_user_mapping';
  } else if (options.some((o) => o.status === 'needs_encoding')) {
    payloadStatus = 'needs_encoding';
  } else {
    payloadStatus = 'ready';
  }

  return {
    options,
    goal_node_id: goalNode.id,
    status: payloadStatus,
    ...(goalNode.goal_threshold != null && { goal_threshold: goalNode.goal_threshold }),
    // ROADMAP 2.315(a) — the raw target trio, carried verbatim from the goal
    // node's attested mint. RAW-ANCHORED via the shared rule, so this mirror
    // cannot drift from the primary builder's.
    ...pickGoalThresholdTrio(goalNode),
  };
}

// ============================================================================
// Refusal (ROADMAP 2.1085 (root 2.1041) / golden-journey EXT-2)
//
// ⚠ CITATION NOTE, so this is not "corrected" back. Every comment in this
// change set originally cited **2.1091**. That is the DETERMINISTIC ADVICE
// GATE row and carries no mixed-scale content. The mixed-scale family is
// **2.1085** (analysis-seam mixed-scale guard), root **2.1041**
// (zero-baseline convention). Row 2.1134(b) records the correction, made
// 14 Aug — it had itself carried the wrong id until then, which is how the
// mis-citation propagated into this lane's brief and from there into ~29
// comments. `run-analysis.ts`'s own "THE COPY (row 2.1091…)" header is the
// same mis-citation, still uncorrected and deliberately left alone here
// (out of this change's scope — rowed, not silently edited).
// ============================================================================

/**
 * The status the readiness vocabulary already reserves for "something
 * prevents this analysis". Its documented semantics live on
 * `AnalysisReadyStatus` in `src/schemas/analysis-ready.ts` and it is already
 * on the wire — `synthesiseFreshnessOnlyAnalysisReady` emits it for the
 * transport-recovery carrier. Nothing new is minted here.
 */
export const ANALYSIS_READY_BLOCKED_STATUS = 'blocked';

/**
 * Build the typed readiness state for a REFUSED analyse turn.
 *
 * WHY THIS EXISTS (witnessed on staging 2026-08-13, golden journey EXT-2):
 * when the analyse handler refuses — the mixed-scale gate, the baseline-scale
 * gate, the scale postcondition, or any other RECOVERABLE_HANDLER_CAUSE — the
 * turn recovers as a graceful 200 carrying honest PROSE and nothing a machine
 * can read. On the chip-click arm no `analysis_ready` shipped at all; on the
 * routed arm the pre-dispatch structural payload shipped unrevised, so the
 * wire said `status: 'ready'` about a run CEE had just declined to perform.
 * Absent and confidently-wrong are the two halves of one defect: the refusal
 * had no representation in the readiness vocabulary.
 *
 * ⚠ WHY THIS LIVES HERE AND NOWHERE ELSE (ROADMAP 2.1135). Refusal readiness
 * shares the module that owns the canonical graph adapter, so a blocked turn
 * cannot drift into a separate wire vocabulary.
 *
 * ⚠⚠ THE SHAPE IS A PRESENT-BUT-EMPTY CARRIER, AND THAT IS A CORRECTION.
 * The first version of this helper CARRIED the real structural options onto
 * the refusal, reasoning that an empty block would discard consumer state.
 * An adversarial review measured what that does on the DEPLOYED UI: real
 * options flip `DecisionOverviewCard` from `unassessed` to `needs_input`,
 * which auto-expands "Olumi needs a little more from you" — with no
 * `user_questions` — mis-describing a SCALE refusal as a framing gap, and the
 * payload is then echoed back to CEE and persisted to sessionStorage.
 * Shipping a new false surface in order to deliver an honest wire field is
 * the wrong trade. This is the shape `synthesiseFreshnessOnlyAnalysisReady`
 * already puts on the wire and the UI already handles.
 *
 * ⚠ ROADMAP 2.1134(a), DERIVED AT THE REGISTER BYTES rather than paraphrased,
 * because the first version cited it for something it does not say. The row
 * withdraws a claimed defect between `analysis_ready.options[].status` (CEE:
 * "do we have user-warranted values?") and `enrichment.option_comparison[]
 * .status` (ISL/PLoT: "did this arm compute?"), and its ruling is *"Name them
 * apart; do not reconcile"* — forcing agreement would have broken
 * `isRecommendableOption`. It says NOTHING about refusal turns and does NOT
 * require options to be carried on one. A refusal turn produces no
 * `option_comparison` and names no leader, so there is nothing to reconcile
 * and `isRecommendableOption` has nothing to read. The row's genuine
 * requirement survives here as a stronger property: this function writes NO
 * per-option status at all.
 *
 * ⚠ `options` and `goal_node_id` are PRESENT-but-empty, never dropped. Both
 * are REQUIRED at the boundary (`@talchain/schemas` `OlumiResponseSchema`
 * declares `options: z.array(z.unknown())` and `goal_node_id: z.string()`),
 * so omitting either fails egress validation and destroys the whole turn.
 * Pinned by a test.
 *
 * @param blockedReason Stable, SPECIFIC code. Callers derive it with
 *                     `blockedReasonForHandlerFailure`, which cannot return
 *                     an empty or generic value.
 */
export function buildAnalysisRefusalReadiness(
  blockedReason: string,
): AnalysisReadyPayload {
  return {
    options: [],
    goal_node_id: '',
    status: ANALYSIS_READY_BLOCKED_STATUS,
    blocked_reason: blockedReason,
  };
}
