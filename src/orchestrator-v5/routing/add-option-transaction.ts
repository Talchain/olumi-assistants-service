/**
 * S3 §5 / Lane C3 — add-option compound transaction builder (PURE).
 *
 * THE GAP THIS CLOSES. Today an add-option journey is TWO turns: a structural
 * add (edit_graph LLM emits `add_node`(option) + `add_edge`s → held
 * `STRUCTURAL_APPLY_HELD` → confirm applies the option with `interventions:null`)
 * and, separately, a configure turn that writes the effect values. Between them
 * the option is analysis-poison (PLoT 422 `options_not_configured`) — debit (a),
 * the interventions=null poison gap (R-3 probe,
 * acceptance-evidence/s2s3-p0-addoption-probe-2026-07-22/).
 *
 * This module turns a typed `add_option` intent (`chip.intent='add_option'`,
 * @talchain/schemas 0.22.0) carrying a pre-resolved spec in `chip.parameters`
 * into ONE atomic `PatchOperation[]` — the option node + the parent-decision
 * edge + one option->factor edge per configured factor + the per-factor effect
 * VALUES — so the whole option lands configured (or is honestly disclosed as
 * unconfigured) in a SINGLE held proposal. The intervention values ride INSIDE
 * the `add_node` op's node value in the canonical top-level `interventions`
 * spelling.
 *
 * WHY THIS BUILDS ON THE LIVE add_node/add_edge CHAIN, NOT the `add_option`
 * referee case (R-3, trap-16). The dedicated `add_option` referee case
 * (referee.ts) is ALWAYS-held and has ZERO live producers (probe-confirmed on
 * the wire) — a dead branch. The LIVE producer is the generic structural hold
 * (`add_node`/`add_edge` → `STRUCTURAL_APPLY_HELD`). These ops therefore route
 * through the SAME referee gate + `pending_actions` inline_patch +
 * `executeGmHeldResume` confirm/apply the free-text edit already uses — reuse,
 * not a new mechanism.
 *
 * WHY THE CANONICAL INTERVENTION SPELLING (load-bearing — the confirm apply is
 * deterministic). The confirm-side apply (`executeGmHeldResume`) does NOT run
 * the edit-lane encoders (`encodeOptionInterventionsForEdit`, `normalisePath`,
 * `enforceStructuralEdgeDefaults`). Its atomicity guard (`batchFullyLanded`)
 * refuses the WHOLE batch if any written field does not survive
 * `GraphV3.safeParse`. So this module writes:
 *  - interventions as a canonical top-level `node.interventions` record on the
 *    `add_node` value — `NodeV3.interventions` is a declared field GraphV3
 *    preserves, and `batchFullyLanded` verifies an `add_node` by node PRESENCE,
 *    so the bundle lands without depending on any encoder or on the held-lane
 *    value-op canonicaliser (which deliberately EXCLUDES interventions —
 *    `encodeOptionInterventionsForEdit` owns that subtree);
 *  - structural edges (decision->option, option->factor) with the shared
 *    `STRUCTURAL_EDGE_DEFAULTS` (topology, strength 1.0), since the confirm path
 *    does not run `enforceStructuralEdgeDefaults`.
 *
 * PURE + TOTAL + FAIL-SAFE. Any missing/malformed/unresolved input (absent
 * graph, parent that is not a decision, a target that is not a factor, an id
 * collision on a producer-supplied id) resolves to `{ matched: false, reason }`
 * — the caller then falls through BENIGNLY to the existing free-text/LLM path.
 * Never throws; never mutates its inputs.
 */
import { z } from 'zod';

import { STRUCTURAL_EDGE_DEFAULTS } from '../../orchestrator/context/constants.js';
import { normaliseIdBase } from '../../cee/utils/id-normalizer.js';
import type { PatchOperation } from '../../orchestrator/types.js';

/**
 * The minimal graph view the builder needs to VALIDATE the spec before
 * synthesising a proposal (so it never emits a doomed one). Matches the
 * `GraphStateIngress` leaf shape route-v2 already holds.
 */
export interface AddOptionGraphView {
  readonly nodes: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly label?: string;
  }>;
  readonly edges: ReadonlyArray<{ readonly from: string; readonly to: string }>;
}

/**
 * CEE-SIDE INGRESS CONTRACT for `chip.parameters` on a typed `add_option`
 * intent (the CEE-side shape authority the UI producer, Lane U1, matches; the
 * schema keeps `parameters` an untyped `z.record`). `interventions` folds the
 * configure step into the add so the option lands analysable in ONE
 * transaction:
 *
 *   { parent_decision_id, label, option_id?,
 *     interventions: [ { factor_id, value, unit?, raw_value? } ] }
 *
 * `interventions` may be empty — the option is then added UNCONFIGURED and the
 * caller discloses that at proposal time (never a silent analysis-poison land).
 * Non-strict: producer-side keys (`chip_id`/`spark_id`) pass through harmlessly.
 */
/**
 * A GENUINELY-typed finite number. `z.number()` alone rejects a non-number
 * (a string `"140"`/`"one hundred and forty"` parse-FAILS — no coercion), but
 * still ADMITS `NaN`/`±Infinity`; this refinement rejects those too. No
 * `z.coerce`, no `.catch`, no clamping: a non-finite/non-number value fails the
 * parse, and the caller falls through with `fell_through` telemetry rather than
 * silently committing a coerced value (orchestrator directive, A2 live probe).
 */
const FiniteNumber = z
  .number()
  .refine((n) => Number.isFinite(n), { message: 'expected a finite number' });

const InterventionSpecSchema = z.object({
  factor_id: z.string().min(1),
  value: FiniteNumber,
  unit: z.string().min(1).optional(),
  // raw_value is deliberately polymorphic (categorical/boolean raw values keep
  // their original type); its NUMBER branch must still be finite.
  raw_value: z.union([FiniteNumber, z.string(), z.boolean()]).optional(),
});

const AddOptionParamsSchema = z.object({
  parent_decision_id: z.string().min(1),
  label: z.string().min(1),
  option_id: z.string().min(1).optional(),
  interventions: z.array(InterventionSpecSchema).default([]),
});

export type AddOptionSkipReason =
  | 'no_parameters'
  | 'parameters_invalid'
  | 'no_graph'
  | 'parent_not_found'
  | 'parent_not_decision'
  | 'option_id_collision'
  | 'option_id_invalid'
  | 'factor_not_found'
  | 'factor_not_factor'
  | 'duplicate_factor';

export interface AddOptionProposal {
  readonly operations: PatchOperation[];
  readonly optionId: string;
  readonly optionLabel: string;
  /** True when the option lands with >=1 effect value (analysable on commit). */
  readonly configured: boolean;
  /** Factor ids that received an effect value (for the proposal-time receipt). */
  readonly configuredFactorIds: readonly string[];
}

export type AddOptionBuildResult =
  | { readonly matched: true; readonly proposal: AddOptionProposal }
  | { readonly matched: false; readonly reason: AddOptionSkipReason };

/** Canonical id pattern (mirrors NodeV3/OptionV3 `id`). */
const CANONICAL_ID_RE = /^[a-z0-9_:-]+$/;

function fail(reason: AddOptionSkipReason): AddOptionBuildResult {
  return { matched: false, reason };
}

function findNode(
  graph: AddOptionGraphView,
  id: string,
): { id: string; kind: string; label?: string } | undefined {
  return graph.nodes.find((n) => n.id === id);
}

function nodeIdExists(graph: AddOptionGraphView, id: string): boolean {
  return graph.nodes.some((n) => n.id === id);
}

/**
 * Derive a fresh, canonical, collision-free option id from the label
 * (`opt_<slug>`), suffixing `_2`, `_3`, ... on a collision. Reuses
 * `normaliseIdBase` (the production id normaliser) so the slug rule cannot
 * drift from the rest of the pipeline (trap-12).
 */
function deriveOptionId(label: string, graph: AddOptionGraphView): string {
  const base = `opt_${normaliseIdBase(label)}`;
  if (!nodeIdExists(graph, base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;
    if (!nodeIdExists(graph, candidate)) return candidate;
  }
}

/**
 * A canonical structural edge (topology, not a causal belief): the shared
 * `STRUCTURAL_EDGE_DEFAULTS` (strength 1.0 / exists 1.0 / positive) plus a
 * truthful `user_specified` provenance. Full canonical value because the
 * confirm-side apply does not run `enforceStructuralEdgeDefaults`.
 */
function structuralEdgeValue(from: string, to: string): Record<string, unknown> {
  return {
    from,
    to,
    ...STRUCTURAL_EDGE_DEFAULTS,
    provenance: { source: 'user_specified' as const },
  };
}

/**
 * Build the atomic add-option `PatchOperation[]` (or a classified skip) from a
 * typed `add_option` chip's parameters, validated against the current graph.
 *
 * Op ORDER is load-bearing: the `add_node`(option) MUST precede its edges so
 * the referee's intra-batch sequencing (`advanceBatchGraph`) sees the option
 * node when it referees each `add_edge`.
 *
 * @param parameters the chip's `parameters` bag (untyped `z.record` on the wire)
 * @param graph      the turn's graph (validation authority); null -> skip
 */
export function buildAddOptionTransaction(
  parameters: unknown,
  graph: AddOptionGraphView | null,
): AddOptionBuildResult {
  if (parameters == null || typeof parameters !== 'object') {
    return fail('no_parameters');
  }
  if (graph === null) {
    return fail('no_graph');
  }

  const parsed = AddOptionParamsSchema.safeParse(parameters);
  if (!parsed.success) return fail('parameters_invalid');
  const { parent_decision_id, label, option_id, interventions } = parsed.data;

  // Parent must resolve to a DECISION node (an option hangs off a decision).
  const parent = findNode(graph, parent_decision_id);
  if (parent === undefined) return fail('parent_not_found');
  if (parent.kind !== 'decision') return fail('parent_not_decision');

  // Resolve the option id: a producer-supplied id must be canonical AND free;
  // otherwise derive a fresh collision-free one from the label.
  let optionId: string;
  if (option_id !== undefined) {
    if (!CANONICAL_ID_RE.test(option_id)) return fail('option_id_invalid');
    if (nodeIdExists(graph, option_id)) return fail('option_id_collision');
    optionId = option_id;
  } else {
    optionId = deriveOptionId(label, graph);
  }

  // Every target factor must resolve to a FACTOR node, and no factor twice.
  const seenFactors = new Set<string>();
  for (const iv of interventions) {
    if (seenFactors.has(iv.factor_id)) return fail('duplicate_factor');
    seenFactors.add(iv.factor_id);
    const node = findNode(graph, iv.factor_id);
    if (node === undefined) return fail('factor_not_found');
    if (node.kind !== 'factor') return fail('factor_not_factor');
  }

  // Canonical top-level InterventionV3 bundle (the spelling GraphV3 preserves
  // and run_analysis reads). `source: 'user_specified'` and an exact-id
  // `target_match` mirror `normalise-option-interventions.freshInterventionV3`.
  const interventionBundle: Record<string, unknown> = {};
  for (const iv of interventions) {
    const entry: Record<string, unknown> = {
      value: iv.value,
      source: 'user_specified',
      target_match: {
        node_id: iv.factor_id,
        match_type: 'exact_id',
        confidence: 'high',
      },
    };
    if (iv.unit !== undefined) entry.unit = iv.unit;
    if (iv.raw_value !== undefined) entry.raw_value = iv.raw_value;
    interventionBundle[iv.factor_id] = entry;
  }

  const operations: PatchOperation[] = [
    {
      op: 'add_node',
      path: optionId,
      value: {
        id: optionId,
        kind: 'option',
        label,
        interventions: interventionBundle,
      },
    },
    { op: 'add_edge', path: `${parent_decision_id}::${optionId}`, value: structuralEdgeValue(parent_decision_id, optionId) },
    ...interventions.map(
      (iv): PatchOperation => ({
        op: 'add_edge',
        path: `${optionId}::${iv.factor_id}`,
        value: structuralEdgeValue(optionId, iv.factor_id),
      }),
    ),
  ];

  return {
    matched: true,
    proposal: {
      operations,
      optionId,
      optionLabel: label,
      configured: interventions.length > 0,
      configuredFactorIds: interventions.map((iv) => iv.factor_id),
    },
  };
}
