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
import {
  validateGraphStructure,
  VIOLATION_MESSAGES,
  type StructuralViolationCode,
} from "../graph-structure-validator.js";
import { encodeOptionInterventionsForEdit } from "./encode-option-interventions.js";
import { stableStringify } from "../context/stable-stringify.js";

// ============================================================================
// Types
// ============================================================================

export type CanonicalReadinessIssueCategory =
  | 'graph_structure'
  | 'option_values'
  | 'option_mapping'
  | 'numeric_integrity'
  | 'internal';

export type CanonicalReadinessIssueCode =
  | StructuralViolationCode
  | 'NO_GRAPH'
  | 'SCHEMA_INVALID'
  | 'OPTION_INTERVENTION_UNRESOLVABLE'
  | 'NO_CAP_UNRECOVERABLE'
  | 'UNIT_MISMATCH'
  | 'OPTION_NEEDS_MAPPING'
  | 'OPTION_NEEDS_ENCODING'
  | 'MISSING_OPTION_VALUE'
  | 'AMBIGUOUS_OPTION_VALUE'
  | 'MISSING_OPTION_CONNECTION'
  | 'CONSTRAINT_REVIEW_REQUIRED'
  | 'UNREACHABLE_CONTROLLABLE_FACTOR'
  | 'INTERNAL_ERROR';

export interface CanonicalReadinessIssue {
  readonly issue_id: string;
  readonly code: CanonicalReadinessIssueCode;
  readonly category: CanonicalReadinessIssueCategory;
  readonly message: string;
  readonly repairability: 'safe_canonicalisation' | 'human_input_required';
  readonly option_id?: string;
  readonly option_label?: string;
  readonly factor_id?: string;
  readonly factor_label?: string;
}

export interface CanonicalReadinessRepairChange {
  readonly change_id: string;
  readonly kind: 'canonicalise_option_interventions';
  readonly option_id: string;
  readonly option_label: string;
  readonly description: string;
}

export interface CanonicalReadinessRequiredInput {
  readonly issue_id: string;
  readonly kind: 'model_structure' | 'option_mapping' | 'option_effect_value' | 'value_scale' | 'constraint_review';
  readonly prompt: string;
  readonly option_id?: string;
  readonly factor_id?: string;
}

/**
 * One complete, reviewable plan for a genuinely multi-blocker state. Complete
 * means every known issue is represented either by a value-preserving change
 * or by an explicit human input. It never means that Olumi invented the
 * missing judgement, relationship, scale, or scalar.
 */
export interface CanonicalReadinessRepairProposal {
  readonly proposal_version: 'readiness_repair_v1';
  readonly complete: true;
  readonly issue_ids: string[];
  readonly changes: CanonicalReadinessRepairChange[];
  readonly unresolved_inputs: CanonicalReadinessRequiredInput[];
}

export type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']> & {
  /** Exhaustive structural + semantic issues from the canonical assessment. */
  readonly readiness_issues?: CanonicalReadinessIssue[];
  /** Present only for two-or-more blocking issues. */
  readonly repair_proposal?: CanonicalReadinessRepairProposal;
};

export interface CanonicalReadinessAssessment {
  readonly analysisReady: AnalysisReadyPayload | undefined;
  readonly issues: readonly CanonicalReadinessIssue[];
  readonly blockingIssues: readonly CanonicalReadinessIssue[];
  readonly repairProposal: CanonicalReadinessRepairProposal | null;
  /** Strict value-preserving canonical graph admitted to Run, else null. */
  readonly canonicalGraph: unknown | null;
  /** Candidate containing every currently safe carrier canonicalisation. */
  readonly proposedGraph: unknown | null;
  readonly repairedForAnalysis: boolean;
  readonly safeToAnalyse: boolean;
}

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
  // Read every historical carrier through the documented per-factor
  // precedence table. Selecting `candidate.interventions` as a whole bundle
  // used to let a stale top-level mirror hide a newer data/slash-keyed value
  // (and also dropped factors that existed only in those higher-priority
  // carriers). `mergeInterventionSourceObjects` is the single source selector:
  // data.interventions > data/interventions/<id> > top-level interventions.
  const sourceBundle = mergeInterventionSourceObjects(candidate);
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

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return stableStringify(left) === stableStringify(right);
  } catch {
    return left === right;
  }
}

function optionRecordById(graph: unknown, id: string): Dict | null {
  if (!isPlainObject(graph) || !Array.isArray(graph.nodes)) return null;
  const found = graph.nodes.find(
    (node) => isPlainObject(node) && node.kind === 'option' && node.id === id,
  );
  return isPlainObject(found) ? found : null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

interface UnresolvedOptionDetail {
  readonly code: 'NO_CAP_UNRECOVERABLE' | 'UNIT_MISMATCH' | 'OPTION_INTERVENTION_UNRESOLVABLE';
  readonly factorId?: string;
  readonly factorLabel?: string;
}

/** Refines the encoder's defer without second-guessing its defer decision. */
function classifyUnresolvedOption(
  graph: unknown,
  optionId: string,
): UnresolvedOptionDetail {
  const generic = (factorId?: string, factorLabel?: string): UnresolvedOptionDetail => ({
    code: 'OPTION_INTERVENTION_UNRESOLVABLE',
    ...(factorId ? { factorId } : {}),
    ...(factorLabel ? { factorLabel } : {}),
  });
  try {
    if (!isPlainObject(graph) || !Array.isArray(graph.nodes)) {
      return generic();
    }
    const option = graph.nodes.find(
      (node) => isPlainObject(node) && node.kind === 'option' && node.id === optionId,
    );
    if (!isPlainObject(option)) return generic();
    const factorById = new Map<string, Dict>();
    for (const node of graph.nodes) {
      if (isPlainObject(node) && node.kind === 'factor' && typeof node.id === 'string') {
        factorById.set(node.id, node);
      }
    }
    // Recover factor identity with the encoder's carrier precedence. This does
    // not re-decide whether the option is unresolved—the strict encoder already
    // did that—it only lets semantic blockers be compared at option×factor
    // granularity instead of collapsing every factor on the same option.
    const candidates = new Map<string, unknown>();
    if (isPlainObject(option.data) && isPlainObject(option.data.interventions)) {
      for (const [factorId, raw] of Object.entries(option.data.interventions)) {
        candidates.set(factorId, raw);
      }
    }
    for (const [key, raw] of Object.entries(option)) {
      const match = key.match(/^data\/interventions\/(.+)$/);
      if (match?.[1] && !candidates.has(match[1])) candidates.set(match[1], raw);
    }
    if (isPlainObject(option.interventions)) {
      for (const [factorId, raw] of Object.entries(option.interventions)) {
        if (!candidates.has(factorId)) candidates.set(factorId, raw);
      }
    }
    if (candidates.size === 0 && Array.isArray(graph.edges)) {
      const targets = graph.edges
        .filter(
          (edge): edge is Dict =>
            isPlainObject(edge)
            && edge.from === optionId
            && typeof edge.to === 'string'
            && factorById.has(edge.to),
        )
        .map((edge) => edge.to as string);
      const hasNodeLevelIntent = finiteNumber(option.value) !== undefined
        || finiteNumber(option.raw_value) !== undefined;
      if (hasNodeLevelIntent && targets.length === 1) {
        candidates.set(targets[0]!, {
          value: option.value,
          raw_value: option.raw_value,
          unit: option.unit,
          cap: option.cap,
        });
      }
    }

    let firstGeneric: UnresolvedOptionDetail | null = null;
    for (const [factorId, raw] of candidates) {
      if (isPlainObject(raw) && finiteNumber(raw.value) !== undefined) continue;
      const factor = factorById.get(factorId);
      const factorLabel = readNonEmptyString(factor?.label) ?? undefined;
      if (firstGeneric === null) firstGeneric = generic(factorId, factorLabel);
      if (!isPlainObject(raw) || finiteNumber(raw.raw_value) === undefined || !factor) continue;
      const observed = isPlainObject(factor.observed_state) ? factor.observed_state : undefined;
      const sourceUnit = readNonEmptyString(raw.unit);
      const factorUnit = readNonEmptyString(observed?.unit);
      if (sourceUnit && factorUnit && sourceUnit.toLowerCase() !== factorUnit.toLowerCase()) {
        return { code: 'UNIT_MISMATCH', factorId, ...(factorLabel ? { factorLabel } : {}) };
      }
      if (finiteNumber(raw.cap) === undefined && finiteNumber(observed?.cap) === undefined) {
        return { code: 'NO_CAP_UNRECOVERABLE', factorId, ...(factorLabel ? { factorLabel } : {}) };
      }
    }
    return firstGeneric ?? generic();
  } catch {
    return generic();
  }
}

function structuralIssue(
  code: StructuralViolationCode,
  ordinal: number,
): CanonicalReadinessIssue {
  return {
    issue_id: `structural_${ordinal + 1}`,
    code,
    category: 'graph_structure',
    message: VIOLATION_MESSAGES[code],
    repairability: 'human_input_required',
  };
}

function blockerIssue(
  blocker: unknown,
  ordinal: number,
  status: string,
): CanonicalReadinessIssue | null {
  if (!isPlainObject(blocker)) return null;
  const blockerType = readNonEmptyString(blocker.blocker_type);
  const optionId = readNonEmptyString(blocker.option_id) ?? undefined;
  const optionLabel = readNonEmptyString(blocker.option_label) ?? undefined;
  const factorId = readNonEmptyString(blocker.factor_id) ?? undefined;
  const factorLabel = readNonEmptyString(blocker.factor_label) ?? undefined;
  const suffix = optionLabel && factorLabel
    ? ` for "${optionLabel}" on "${factorLabel}"`
    : optionLabel
      ? ` for "${optionLabel}"`
      : factorLabel
        ? ` for "${factorLabel}"`
        : '';
  const common = {
    issue_id: `semantic_${ordinal + 1}`,
    repairability: 'human_input_required' as const,
    ...(optionId ? { option_id: optionId } : {}),
    ...(optionLabel ? { option_label: optionLabel } : {}),
    ...(factorId ? { factor_id: factorId } : {}),
    ...(factorLabel ? { factor_label: factorLabel } : {}),
  };
  if (status === 'needs_user_mapping' && !optionId && factorId) {
    return {
      ...common,
      code: 'UNREACHABLE_CONTROLLABLE_FACTOR',
      category: 'option_mapping',
      message: `Choose which option changes${suffix} and by how much.`,
    };
  }
  switch (blockerType) {
    case 'missing_value':
      return {
        ...common,
        code: 'MISSING_OPTION_VALUE',
        category: 'option_values',
        message: `Choose the missing effect value${suffix}.`,
      };
    case 'ambiguous_value':
      return {
        ...common,
        code: 'AMBIGUOUS_OPTION_VALUE',
        category: 'option_values',
        message: `Confirm the effect value${suffix}.`,
      };
    case 'missing_connection':
      return {
        ...common,
        code: 'MISSING_OPTION_CONNECTION',
        category: 'option_mapping',
        message: `Choose the missing connection${suffix}.`,
      };
    case 'constraint_dropped':
      return {
        ...common,
        code: 'CONSTRAINT_REVIEW_REQUIRED',
        category: 'option_values',
        message: `Review the unresolved constraint${suffix}.`,
      };
    default:
      return null;
  }
}

function requiredInputForIssue(
  issue: CanonicalReadinessIssue,
): CanonicalReadinessRequiredInput | null {
  if (issue.repairability !== 'human_input_required') return null;
  const kind: CanonicalReadinessRequiredInput['kind'] =
    issue.category === 'graph_structure'
      ? 'model_structure'
      : issue.code === 'CONSTRAINT_REVIEW_REQUIRED'
        ? 'constraint_review'
        : issue.category === 'option_mapping'
          ? 'option_mapping'
          : issue.category === 'numeric_integrity'
            || issue.code === 'NO_CAP_UNRECOVERABLE'
            || issue.code === 'UNIT_MISMATCH'
            ? 'value_scale'
            : 'option_effect_value';
  return {
    issue_id: issue.issue_id,
    kind,
    prompt: issue.message,
    ...(issue.option_id ? { option_id: issue.option_id } : {}),
    ...(issue.factor_id ? { factor_id: issue.factor_id } : {}),
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
function projectSemanticAnalysisReadyFromGraph(
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
  const topLevelIdCounts = new Map<string, number>();
  for (const option of projectedTopLevel) {
    topLevelIdCounts.set(option.id, (topLevelIdCounts.get(option.id) ?? 0) + 1);
  }
  const topLevelById = new Map(
    projectedTopLevel
      .filter((option) => topLevelIdCounts.get(option.id) === 1)
      .map((option) => [option.id, option]),
  );
  const projectedTopLevelIds = new Set(projectedTopLevel.map((option) => option.id));

  // A top-level options array owns order only when it is an exact UNIQUE-ID
  // bijection with the option nodes. Length equality is insufficient: two
  // copies of opt_a can have the same length as {opt_a,opt_b}, silently drop
  // opt_b, and make the whole-status producer reason over the wrong choice
  // set. Invalid/unknown rows were already filtered above, so equality of both
  // unique sets plus both raw lengths proves the exact one-to-one cover.
  const topLevelIsExactOptionNodeBijection =
    projectedTopLevel.length === optionNodeRecords.length
    && projectedTopLevelIds.size === projectedTopLevel.length
    && optionNodeIds.size === optionNodeRecords.length
    && projectedTopLevelIds.size === optionNodeIds.size
    && [...optionNodeIds].every((id) => projectedTopLevelIds.has(id));

  // Preserve the producer's canonical option order when it completely covers
  // the option-node set exactly once. A partial/stale/duplicated mirror falls
  // back to node order and fills each missing entry from that node, never
  // silently dropping an arm.
  const options = topLevelIsExactOptionNodeBijection
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

function appendSemanticIssues(
  payload: AnalysisReadyPayload | undefined,
  out: CanonicalReadinessIssue[],
): void {
  if (!payload || payload.status === 'ready') return;
  const exactKey = (issue: CanonicalReadinessIssue): string => [
    issue.option_id ?? '',
    issue.factor_id ?? '',
    issue.code,
  ].join('::');
  const optionFactorKey = (issue: CanonicalReadinessIssue): string | null =>
    issue.option_id && issue.factor_id
      ? `${issue.option_id}::${issue.factor_id}`
      : null;
  const strictEncoderPairs = new Set(
    out
      .filter((issue) =>
        issue.code === 'NO_CAP_UNRECOVERABLE'
        || issue.code === 'UNIT_MISMATCH'
        || issue.code === 'OPTION_INTERVENTION_UNRESOLVABLE')
      .map(optionFactorKey)
      .filter((key): key is string => key !== null),
  );
  const seenExact = new Set(out.map(exactKey));
  for (const [index, blocker] of (payload.blockers ?? []).entries()) {
    const issue = blockerIssue(blocker, out.length + index, payload.status);
    if (!issue) continue;
    const pair = optionFactorKey(issue);
    // The semantic producer sees an unencoded raw carrier as a missing value.
    // When the strict encoder has already named that exact option×factor, they
    // are two views of one blocker. Do not suppress any other factor or any
    // distinct blocker code on the same pair.
    if (issue.code === 'MISSING_OPTION_VALUE' && pair && strictEncoderPairs.has(pair)) continue;
    const key = exactKey(issue);
    if (seenExact.has(key)) continue;
    seenExact.add(key);
    out.push(issue);
  }
  const coveredOptionIds = new Set(
    out
      .map((issue) => issue.option_id)
      .filter((id): id is string => typeof id === 'string'),
  );
  for (const option of payload.options) {
    if (option.status === 'ready' || coveredOptionIds.has(option.option_id)) continue;
    const mapping = option.status === 'needs_user_mapping';
    out.push({
      issue_id: `semantic_${out.length + 1}`,
      code: mapping ? 'OPTION_NEEDS_MAPPING' : 'OPTION_NEEDS_ENCODING',
      category: mapping ? 'option_mapping' : 'option_values',
      message: mapping
        ? `Choose which factor "${option.label}" changes and by how much.`
        : `Choose how "${option.label}" should be represented on the effect scale.`,
      repairability: 'human_input_required',
      option_id: option.option_id,
      option_label: option.label,
    });
  }
}

/**
 * The sole whole-model readiness assessment. It exhaustively records every
 * structural and semantic issue, while separately identifying the carrier
 * normalisations that are safe because they preserve user-supplied values.
 * Both the wire projection and Run admission are adapters over this record.
 */
export function assessCanonicalAnalysisReadiness(
  graph: unknown,
): CanonicalReadinessAssessment {
  try {
    if (graph === null || graph === undefined) {
      const issue: CanonicalReadinessIssue = {
        issue_id: 'graph_1',
        code: 'NO_GRAPH',
        category: 'graph_structure',
        message: 'Draft or save a model first, then run analysis.',
        repairability: 'human_input_required',
      };
      return {
        analysisReady: undefined,
        issues: [issue],
        blockingIssues: [issue],
        repairProposal: null,
        canonicalGraph: null,
        proposedGraph: null,
        repairedForAnalysis: false,
        safeToAnalyse: false,
      };
    }

    // Strict encoding is the Run candidate: any unresolvable option keeps it
    // out. The empty touched set is the proposal candidate: it canonicalises
    // every safely expressible carrier while deliberately leaving unresolved
    // options alone, so one bad option cannot hide safe work on another.
    const strictEncoding = encodeOptionInterventionsForEdit(graph);
    const proposalEncoding = encodeOptionInterventionsForEdit(graph, new Set<string>());
    const proposalGraph = proposalEncoding.graph;
    const parsed = GraphV3.safeParse(proposalGraph);
    if (!parsed.success) {
      const issue: CanonicalReadinessIssue = {
        issue_id: 'graph_1',
        code: 'SCHEMA_INVALID',
        category: 'graph_structure',
        message: 'This graph cannot be analysed because its structure is invalid.',
        repairability: 'human_input_required',
      };
      return {
        analysisReady: undefined,
        issues: [issue],
        blockingIssues: [issue],
        repairProposal: null,
        canonicalGraph: null,
        proposedGraph: null,
        repairedForAnalysis: false,
        safeToAnalyse: false,
      };
    }

    const labels = new Map(
      parsed.data.nodes.map((node) => [node.id, node.label] as const),
    );
    const changes: CanonicalReadinessRepairChange[] = [];
    const carrierIssues: CanonicalReadinessIssue[] = [];
    for (const node of parsed.data.nodes) {
      if (node.kind !== 'option') continue;
      const before = optionRecordById(graph, node.id);
      const after = optionRecordById(proposalGraph, node.id);
      if (!before || !after || sameJson(before, after)) continue;
      const issueId = `carrier_${carrierIssues.length + 1}`;
      carrierIssues.push({
        issue_id: issueId,
        code: 'OPTION_NEEDS_ENCODING',
        category: 'option_values',
        message: `Store the existing effect values for "${node.label}" in the canonical format.`,
        repairability: 'safe_canonicalisation',
        option_id: node.id,
        option_label: node.label,
      });
      changes.push({
        change_id: `canonicalise_${changes.length + 1}`,
        kind: 'canonicalise_option_interventions',
        option_id: node.id,
        option_label: node.label,
        description: `Canonicalise the existing effect values for "${node.label}" without changing them.`,
      });
    }

    const blockingIssues: CanonicalReadinessIssue[] = [];
    for (const optionId of strictEncoding.unresolvedOptionIds) {
      const label = labels.get(optionId);
      const detail = classifyUnresolvedOption(graph, optionId);
      const code = detail.code;
      const message = code === 'NO_CAP_UNRECOVERABLE'
        ? label
          ? `Review the effect values for "${label}"; a real bound is required before its raw value can be normalised.`
          : 'Review the option effect values; a real bound is required before the raw value can be normalised.'
        : code === 'UNIT_MISMATCH'
          ? label
            ? `Review the effect values for "${label}"; the supplied unit does not match the factor.`
            : 'Review the option effect values; the supplied unit does not match the factor.'
          : label
            ? `Review the effect values for "${label}"; at least one value cannot be safely interpreted yet.`
            : 'Review the option effect values; at least one value cannot be safely interpreted yet.';
      blockingIssues.push({
        issue_id: `numeric_${blockingIssues.length + 1}`,
        code,
        category: code === 'OPTION_INTERVENTION_UNRESOLVABLE'
          ? 'numeric_integrity'
          : 'option_values',
        message,
        repairability: 'human_input_required',
        option_id: optionId,
        ...(label ? { option_label: label } : {}),
        ...(detail.factorId ? { factor_id: detail.factorId } : {}),
        ...(detail.factorLabel ? { factor_label: detail.factorLabel } : {}),
      });
    }
    const structural = validateGraphStructure(parsed.data);
    structural.violations.forEach((violation, index) => {
      blockingIssues.push(structuralIssue(violation.code, index));
    });

    const semantic = projectSemanticAnalysisReadyFromGraph(proposalGraph);
    appendSemanticIssues(semantic, blockingIssues);

    const allIssues = [...carrierIssues, ...blockingIssues];
    const proposal: CanonicalReadinessRepairProposal | null =
      blockingIssues.length >= 2
        ? {
            proposal_version: 'readiness_repair_v1',
            complete: true,
            issue_ids: allIssues.map((issue) => issue.issue_id),
            changes,
            unresolved_inputs: blockingIssues
              .map(requiredInputForIssue)
              .filter((input): input is CanonicalReadinessRequiredInput => input !== null),
          }
        : null;

    const hardBlocked = blockingIssues.some(
      (issue) => issue.category === 'graph_structure'
        || issue.category === 'numeric_integrity'
        || issue.category === 'internal',
    );
    const analysisReady = semantic
      ? {
          ...semantic,
          ...(hardBlocked
            ? { status: 'blocked', blocked_reason: blockingIssues[0]?.code ?? 'INTERNAL_ERROR' }
            : {}),
          ...(allIssues.length > 0 ? { readiness_issues: allIssues } : {}),
          ...(proposal ? { repair_proposal: proposal } : {}),
        }
      : {
          status: 'blocked',
          goal_node_id: '',
          options: [],
          blocked_reason: blockingIssues[0]?.code ?? 'INTERNAL_ERROR',
          readiness_issues: allIssues,
          ...(proposal ? { repair_proposal: proposal } : {}),
        };
    const safeToAnalyse = blockingIssues.length === 0 && analysisReady?.status === 'ready';
    const strictCanonicalGraph = strictEncoding.unresolvedOptionIds.length === 0
      ? strictEncoding.graph
      : null;
    return {
      analysisReady,
      issues: allIssues,
      blockingIssues,
      repairProposal: proposal,
      canonicalGraph: safeToAnalyse ? strictCanonicalGraph : null,
      proposedGraph: changes.length > 0 ? proposalGraph : null,
      repairedForAnalysis:
        safeToAnalyse && strictCanonicalGraph !== null && !sameJson(graph, strictCanonicalGraph),
      safeToAnalyse,
    };
  } catch {
    const issue: CanonicalReadinessIssue = {
      issue_id: 'internal_1',
      code: 'INTERNAL_ERROR',
      category: 'internal',
      message: 'This graph could not be checked safely. Review it before analysis.',
      repairability: 'human_input_required',
    };
    return {
      analysisReady: undefined,
      issues: [issue],
      blockingIssues: [issue],
      repairProposal: null,
      canonicalGraph: null,
      proposedGraph: null,
      repairedForAnalysis: false,
      safeToAnalyse: false,
    };
  }
}

/** Thin wire adapter over the canonical assessment. */
export function buildCanonicalAnalysisReadyFromGraph(
  graph: unknown,
): AnalysisReadyPayload | undefined {
  return assessCanonicalAnalysisReadiness(graph).analysisReady;
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
