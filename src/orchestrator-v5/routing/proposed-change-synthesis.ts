/**
 * V5 G7/G8 — proposed-change synthesis helper.
 *
 * When `tryShortConfirmResume` returns `dispatch: 'pending_action'` and
 * the pending action's kind is `apply_proposed_change`, TurnExecutor
 * calls this helper to decide what to do next:
 *
 *   - `superseded`: graph hash diverged since emit → emit a fresh-
 *     suggestion recovery rather than apply against a different graph.
 *   - `already_applied`: a successful mutation matching the proposal's
 *     intent and target is already in `prior_facts` → emit an
 *     idempotent confirmation rather than running the handler twice.
 *   - `invalid`: the pending action carries no resumable patch (no
 *     inline_patch.handler_id) → fall through to LLM.
 *   - `execute`: pre-conditions pass → return the synthesised handler
 *     dispatch info so TurnExecutor can build the RoutingResult.
 *
 * Lifecycle states this module covers:
 *   - active                                    → `execute`
 *   - superseded by graph mutation              → `superseded`
 *   - already applied / idempotent re-confirm   → `already_applied`
 *   - invalid proposal_ref                      → `invalid`
 *
 * Active / unexpired and expired and ambiguous and dismissed are
 * handled before this module is reached (`tryShortConfirmResume`,
 * `tryProposalOrdinalSelect`, `tryProposalDismissal`).
 */

import type { HandlerFact, V5ActionType } from '@talchain/schemas/orchestrator';

import type { PendingAction } from '../session/pending-action.js';
import type { HandlerFactWithTurn } from '../session/store.js';
import type { ProposalAction } from './types.js';

export type ProposedChangeSynthesisDecision =
  | {
      readonly status: 'execute';
      readonly handler_id: V5ActionType;
      readonly params: Readonly<Record<string, unknown>>;
      readonly target_entity_ids: readonly string[];
    }
  | { readonly status: 'superseded' }
  | { readonly status: 'already_applied' }
  | { readonly status: 'invalid'; readonly reason: 'missing_inline_patch' | 'unknown_handler_id' };

export interface DecideProposedChangeSynthesisInput {
  readonly pending: PendingAction;
  /**
   * The live graph hash at the time of resume. When undefined or null
   * we cannot verify the graph is the same one the proposal was
   * emitted against; we treat absence as superseded for safety,
   * matching the existing clarification-resume contract.
   */
  readonly currentGraphHash: string | null | undefined;
  /**
   * Mutation facts paired with their parent turn id and creation
   * timestamp. The idempotency check filters by
   * `fact_created_at >= emitted_at_iso` to ensure ONLY post-emit
   * facts can trigger `already_applied`. Read-only input; the
   * helper filters in-process and never calls the DB.
   *
   * Schema-aligned ownership link via the FK
   * `v5_handler_facts.v5_conversation_turn_id`. Replaces the prior
   * positional pairing across `priorTurns` and `priorFacts`.
   */
  readonly priorFactsWithTurn: readonly HandlerFactWithTurn[];
}

/**
 * The set of allowed handler ids for a proposed change. Mirrors the
 * intents in `ProposedChangeIntent` so a future mismatch is a
 * compile-time error.
 */
const ALLOWED_HANDLER_IDS: ReadonlySet<V5ActionType> = new Set<V5ActionType>([
  'add_constraint',
  'set_factor_value',
  'adjust_edge_strength',
]);

interface InlinePatchShape {
  readonly handler_id?: unknown;
  readonly params?: unknown;
  readonly target_entity_ids?: unknown;
}

function readInlinePatch(pending: PendingAction): InlinePatchShape | null {
  if (pending.action.kind !== 'apply_proposed_change') return null;
  const ip = pending.action.inline_patch;
  if (!ip || typeof ip !== 'object' || Array.isArray(ip)) return null;
  return ip as InlinePatchShape;
}

function isHandlerId(value: unknown): value is V5ActionType {
  return typeof value === 'string' && ALLOWED_HANDLER_IDS.has(value as V5ActionType);
}

/**
 * Per-handler canonical idempotency matchers.
 *
 * Different V5 handlers shape their `HandlerFact.result` differently.
 * A naive "params[key] === after[key]" comparison would over- or
 * under-match (e.g. `add_constraint`'s `target_id` is the new
 * constraint id, NOT the node it constrains; `adjust_edge_strength`
 * stores nested `after.strength.mean` rather than a flat `after.strength`).
 * This module defines a strict per-handler matcher so the synthesis-
 * layer "already_applied" path only fires when the proposal's
 * material parameters genuinely already hold in the graph.
 *
 * Each matcher returns true iff the fact reflects the same mutation
 * the proposal would apply. False on any uncertainty — handlers
 * themselves remain the ultimate source of truth for noop detection,
 * and the synthesis check is a best-effort short-circuit.
 */

interface FactResultLike {
  readonly status?: string;
  readonly target_id?: string;
  readonly after?: unknown;
}

function readFactResult(fact: HandlerFact): FactResultLike | null {
  const result = (fact as { result?: FactResultLike }).result;
  if (!result || typeof result !== 'object') return null;
  if (result.status !== 'applied') return null;
  if ((fact as { noop?: boolean }).noop === true) return null;
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function matchSetFactorValue(
  proposalTargets: readonly string[],
  proposalParams: Readonly<Record<string, unknown>>,
  fact: HandlerFact,
): boolean {
  const result = readFactResult(fact);
  if (result === null) return false;
  // target_id is the factor id; MUST intersect proposal targets.
  // The synthesis-level `hasMinExecutablePayload` gate guarantees
  // proposalTargets is non-empty before reaching here — the empty-
  // targets escape hatch is no longer accepted.
  if (
    typeof result.target_id !== 'string' ||
    !proposalTargets.includes(result.target_id)
  ) {
    return false;
  }
  if (!isPlainObject(result.after)) return false;
  // Material params persisted in `after` by the handler are `value`
  // and (optionally) `unit`. The proposal may carry `operator` for
  // user intent ('set' / 'increase' / etc.) but the handler resolves
  // that to a final value before persisting; the operator is NOT in
  // `after`. Compare only fields the handler actually persists.
  if ('value' in proposalParams) {
    if (result.after.value !== proposalParams.value) return false;
  }
  if ('unit' in proposalParams && proposalParams.unit !== undefined) {
    if (result.after.unit !== proposalParams.unit) return false;
  }
  return true;
}

function matchAdjustEdgeStrength(
  proposalTargets: readonly string[],
  proposalParams: Readonly<Record<string, unknown>>,
  fact: HandlerFact,
): boolean {
  const result = readFactResult(fact);
  if (result === null) return false;
  // Proposal targets contain the edge id and MUST intersect target_id.
  // Empty-targets escape removed — synthesis gate catches it earlier.
  if (
    typeof result.target_id !== 'string' ||
    !proposalTargets.includes(result.target_id)
  ) {
    return false;
  }
  if (!isPlainObject(result.after)) return false;
  // Edge strength is stored nested as `after.strength = { mean, std }`.
  // A proposal supplying `params.strength` matches only when
  // `after.strength.mean === params.strength`. When the proposal
  // also supplies `params.std`, that must match `after.strength.std`
  // — a same-mean different-uncertainty proposal must NOT
  // short-circuit.
  const afterStrength = result.after.strength;
  if (!isPlainObject(afterStrength)) return false;
  if ('strength' in proposalParams) {
    if (afterStrength.mean !== proposalParams.strength) return false;
  } else {
    return false;
  }
  if ('std' in proposalParams && proposalParams.std !== undefined) {
    if (afterStrength.std !== proposalParams.std) return false;
  }
  return true;
}

/**
 * Map the proposal's `constraint_type` (`'at_most' | 'at_least'`) to
 * the operator string the handler persists into `GoalConstraint.operator`
 * (`'<=' | '>='`). Returns null for unknown values so the matcher can
 * fail closed.
 */
function constraintTypeToOperator(value: unknown): '<=' | '>=' | null {
  if (value === 'at_most') return '<=';
  if (value === 'at_least') return '>=';
  return null;
}

function matchAddConstraint(
  proposalTargets: readonly string[],
  proposalParams: Readonly<Record<string, unknown>>,
  fact: HandlerFact,
): boolean {
  // `add_constraint` facts: `result.target_id` is the new
  // constraint's id; `result.after` is the canonical `GoalConstraint`
  // shape `{ constraint_id, node_id, operator: '<=' | '>=', value,
  // unit?, label? }`. The matcher therefore reads `after.node_id` to
  // gate by the proposal's targeted node, maps the proposal's
  // `constraint_type` ('at_most' / 'at_least') to operator
  // ('<=' / '>='), and compares value / unit / label when present.
  const result = readFactResult(fact);
  if (result === null) return false;
  if (!isPlainObject(result.after)) return false;
  const after = result.after;

  // Target gate: after.node_id MUST be in proposal targets. Empty
  // proposalTargets is rejected upstream by the synthesis gate.
  const nodeId = typeof after.node_id === 'string' ? after.node_id : null;
  if (nodeId === null || !proposalTargets.includes(nodeId)) return false;

  // Operator gate: derive from constraint_type and compare to after.operator.
  let sawMatchingField = false;
  const proposalConstraintType = proposalParams.constraint_type;
  if (proposalConstraintType !== undefined) {
    const expectedOperator = constraintTypeToOperator(proposalConstraintType);
    if (expectedOperator === null) return false;
    if (after.operator !== expectedOperator) return false;
    sawMatchingField = true;
  }
  if ('value' in proposalParams && proposalParams.value !== undefined) {
    if (after.value !== proposalParams.value) return false;
    sawMatchingField = true;
  }
  if ('unit' in proposalParams && proposalParams.unit !== undefined) {
    if (after.unit !== proposalParams.unit) return false;
    sawMatchingField = true;
  }
  if ('label' in proposalParams && proposalParams.label !== undefined) {
    if (after.label !== proposalParams.label) return false;
    sawMatchingField = true;
  }
  // Without at least one material-field match, do not over-match.
  return sawMatchingField;
}

const HANDLER_MATCHERS: Readonly<
  Record<V5ActionType, ((t: readonly string[], p: Readonly<Record<string, unknown>>, f: HandlerFact) => boolean) | undefined>
> = {
  add_constraint: matchAddConstraint,
  set_factor_value: matchSetFactorValue,
  adjust_edge_strength: matchAdjustEdgeStrength,
  // Other registered handlers do not represent graph mutations the
  // synthesis path can short-circuit on.
  run_analysis: undefined,
  what_would_flip: undefined,
  explain_result: undefined,
  explain_results: undefined,
  explain_from_structure: undefined,
  compare_options: undefined,
};

/**
 * Pick the post-emit subset of facts for a given `handler_id`.
 *
 * Each entry's `fact_created_at` is the fact row's own DB-stamped
 * `created_at`. Facts and their parent turn are written inside the
 * same `append_turn_atomic` transaction (FK
 * `v5_handler_facts.v5_conversation_turn_id`), so the fact-side
 * timestamp is equivalent to the parent turn's `created_at` for the
 * post-emit gate; we surface the fact-side value because it requires
 * no JOIN at read time.
 * We filter directly on that — no positional pairing across
 * separate `priorTurns` / `priorFacts` arrays.
 */
function pickPostEmitFacts(
  handlerId: V5ActionType,
  priorFactsWithTurn: readonly HandlerFactWithTurn[],
  emittedAtMs: number,
): readonly HandlerFact[] {
  const out: HandlerFact[] = [];
  for (const entry of priorFactsWithTurn) {
    if (entry.fact.fact_type !== handlerId) continue;
    const createdMs = Date.parse(entry.fact_created_at);
    if (!Number.isFinite(createdMs)) continue;
    if (createdMs < emittedAtMs) continue;
    out.push(entry.fact);
  }
  return out;
}

/**
 * Per-handler minimum executable payload required before the
 * idempotency check is allowed to fire. The reviewer's invariant:
 * "fail closed unless the pending action has non-empty target ids
 * and the handler-required material params are present". A proposal
 * missing the fields below is either (a) malformed (synthesis will
 * later return 'invalid') or (b) ambiguous enough that
 * `already_applied` could over-match against unrelated facts.
 */
function hasMinExecutablePayload(
  handlerId: V5ActionType,
  targetIds: readonly string[],
  params: Readonly<Record<string, unknown>>,
): boolean {
  if (targetIds.length === 0) return false;
  if (handlerId === 'set_factor_value') {
    return 'value' in params && params.value !== undefined;
  }
  if (handlerId === 'add_constraint') {
    return (
      'constraint_type' in params &&
      params.constraint_type !== undefined &&
      'value' in params &&
      params.value !== undefined
    );
  }
  if (handlerId === 'adjust_edge_strength') {
    return 'strength' in params && params.strength !== undefined;
  }
  return false;
}

/**
 * Idempotency check.
 *
 * Strategy:
 *   1. Fail closed unless the proposal carries non-empty targets
 *      and the handler-required minimum executable payload (P0-2).
 *   2. Filter facts to those whose parent turn was dispatched at or
 *      after the proposal's `emitted_at_iso` via the explicit
 *      `fact_created_at` field on each `HandlerFactWithTurn` entry.
 *      Pre-emit facts are NEVER eligible. Schema-aligned ownership
 *      link (P0-3).
 *   3. Build "latest fact per target_id" from the post-emit subset.
 *      For add_constraint each fact has a unique constraint id, so
 *      every fact appears; for set_factor_value / adjust_edge_strength
 *      the same target appearing twice is collapsed to its newest
 *      state, avoiding stale-state matches.
 *   4. Apply the per-handler canonical matcher.
 *
 * For handlers without a registered matcher, returns false — the
 * handler itself remains the source of truth via `noop: true` on
 * duplicates.
 */
function isAlreadyApplied(
  handlerId: V5ActionType,
  targetIds: readonly string[],
  params: Readonly<Record<string, unknown>>,
  priorFactsWithTurn: readonly HandlerFactWithTurn[],
  emittedAtIso: string,
): boolean {
  const matcher = HANDLER_MATCHERS[handlerId];
  if (matcher === undefined) return false;

  // P0-2 fail-closed gate: without a non-empty target list and the
  // handler-required material params, the matcher cannot uniquely
  // identify the mutation's effect — short-circuiting could match
  // unrelated facts. Skip the idempotency path entirely; the handler
  // will run (and either dispatch or surface a typed precondition
  // failure).
  if (!hasMinExecutablePayload(handlerId, targetIds, params)) return false;

  const emittedAtMs = Date.parse(emittedAtIso);
  if (!Number.isFinite(emittedAtMs)) return false;

  const postEmitFacts = pickPostEmitFacts(handlerId, priorFactsWithTurn, emittedAtMs);
  if (postEmitFacts.length === 0) return false;

  // Build "latest fact per target_id" from the post-emit subset.
  const latestPerTarget = new Map<string, HandlerFact>();
  for (const fact of postEmitFacts) {
    const result = (fact as { result?: { target_id?: unknown } }).result;
    const targetId = result?.target_id;
    if (typeof targetId !== 'string') continue;
    if (!latestPerTarget.has(targetId)) latestPerTarget.set(targetId, fact);
  }

  for (const fact of latestPerTarget.values()) {
    if (matcher(targetIds, params, fact)) return true;
  }
  return false;
}

export function decideProposedChangeSynthesis(
  input: DecideProposedChangeSynthesisInput,
): ProposedChangeSynthesisDecision {
  const { pending } = input;
  if (pending.action.kind !== 'apply_proposed_change') {
    // Caller error — only apply_proposed_change kinds reach here.
    return { status: 'invalid', reason: 'missing_inline_patch' };
  }

  // Hash divergence check FIRST. If the graph has changed since emit,
  // the patch is no longer safe to apply even if everything else looks
  // fine. The pending action's preconditions.graph_hash is required
  // (parsePendingAction enforces); the live hash may be absent if the
  // turn has no graph context, in which case we conservatively treat
  // as superseded.
  const expectedHash = pending.preconditions.graph_hash;
  if (typeof expectedHash !== 'string' || expectedHash.length === 0) {
    return { status: 'invalid', reason: 'missing_inline_patch' };
  }
  if (input.currentGraphHash !== expectedHash) {
    return { status: 'superseded' };
  }

  // Inline patch must be present and well-formed.
  const inline = readInlinePatch(pending);
  if (inline === null) {
    return { status: 'invalid', reason: 'missing_inline_patch' };
  }
  if (!isHandlerId(inline.handler_id)) {
    return { status: 'invalid', reason: 'unknown_handler_id' };
  }
  const params =
    inline.params !== null &&
    typeof inline.params === 'object' &&
    !Array.isArray(inline.params)
      ? (inline.params as Readonly<Record<string, unknown>>)
      : ({} as Readonly<Record<string, unknown>>);
  const targets: readonly string[] = Array.isArray(inline.target_entity_ids)
    ? (inline.target_entity_ids as readonly unknown[]).filter(
        (v): v is string => typeof v === 'string' && v.length > 0,
      )
    : [];

  // Idempotency check (turn-bound via FK, params-matched).
  if (
    isAlreadyApplied(
      inline.handler_id,
      targets,
      params,
      input.priorFactsWithTurn,
      pending.emitted_at_iso,
    )
  ) {
    return { status: 'already_applied' };
  }

  return {
    status: 'execute',
    handler_id: inline.handler_id,
    params,
    target_entity_ids: targets,
  };
}

/**
 * Deterministic recovery copy — single source of truth so tests assert
 * the same strings the production path emits.
 */
export const PROPOSAL_SUPERSEDED_RESPONSE =
  'The model has changed since I suggested that. Would you like a fresh suggestion?';
export const PROPOSAL_ALREADY_APPLIED_RESPONSE = 'That change is already in place.';

/**
 * Build a `ProposalAction` for an apply_proposed_change pending action
 * that has passed `decideProposedChangeSynthesis` (i.e. is ready to
 * execute). Uses the inline patch's `target_entity_ids[0]` as the
 * entity id when present, falling back to a caller-supplied entity
 * (the same fallback used by `run_analysis` / `what_would_flip` short-
 * confirm synthesis).
 *
 * Parameter projection: `inline_patch.params` is a
 * `Record<string, unknown>`; each top-level entry becomes a
 * `ProposalParameter` with `source: 'user_explicit'` (the user
 * confirmed the proposal authored by the assistant on the prior turn).
 * Handler-specific validation runs in the existing validator.
 */
export interface FallbackEntity {
  readonly id: string;
  readonly kind: 'option' | 'goal' | 'node' | 'edge' | 'constraint';
  readonly label: string | null;
}

/**
 * Optional lookup callback: given an entity id, return the live graph
 * kind (and label) for that entity. The synthesis builder uses this
 * to render a proposal whose `entity.kind` matches the graph-resolved
 * kind, so the validator's per-entity kind check accepts it. When no
 * lookup is provided (or the id is unknown), the builder falls back
 * to a permissive default ('node' / 'edge' depending on handler).
 */
export interface SynthesisEntityLookup {
  (id: string): { kind: 'option' | 'goal' | 'node' | 'edge' | 'constraint'; label?: string | null } | null;
}

/**
 * Project a proposal's `inline_patch.params` Record into the
 * handler-specific `ProposalParameter[]` shape the validator expects.
 *
 * Canonical inline_patch.params shape per intent (P1-2):
 *   - `set_factor_value`:
 *       `{ value: number | { value, unit?, cap? }, unit?, cap?, operator? }`
 *       where `operator` is one of 'set' | 'increase' | 'decrease' |
 *       'multiply'. Produces ONE `value` ProposalParameter; `unit`,
 *       `cap`, and `operator` are folded into either the structured
 *       value object or sibling fields on the parameter.
 *   - `add_constraint`:
 *       `{ constraint_type, value, label?, unit? }`
 *       Produces one ProposalParameter per top-level key.
 *   - `adjust_edge_strength`:
 *       `{ strength, std? }`
 *       Produces one ProposalParameter per top-level key.
 *
 * Unknown handler ids fall back to the flat-projection shape so a
 * future handler keeps working without code changes here, but the
 * V5 handlers we care about today are exhaustively covered.
 */
function buildHandlerParameters(
  handlerId: V5ActionType,
  params: Readonly<Record<string, unknown>>,
): ProposalAction['parameters'] {
  if (handlerId === 'set_factor_value') {
    // Build at most ONE parameter named 'value'. Compose the structured
    // value object only if unit or cap are present. Operator and unit
    // become sibling fields on the parameter (matching how the LLM
    // validator interprets `ProposalParameter.operator` /
    // `ProposalParameter.unit`).
    if (!('value' in params) || params.value === undefined) return [];
    const baseValue = params.value as unknown;
    const proposalUnit = typeof params.unit === 'string' ? params.unit : undefined;
    const proposalCap = typeof params.cap === 'number' ? params.cap : undefined;
    const proposalOperator =
      params.operator === 'set' ||
      params.operator === 'increase' ||
      params.operator === 'decrease' ||
      params.operator === 'multiply'
        ? params.operator
        : undefined;
    // If the proposal carried a structured value object, pass it
    // through verbatim. Otherwise fold unit/cap into a structured
    // object only when at least one is present; else use the bare
    // numeric.
    let valueField: unknown = baseValue;
    if (typeof baseValue === 'number' && (proposalUnit !== undefined || proposalCap !== undefined)) {
      valueField = {
        value: baseValue,
        ...(proposalUnit !== undefined ? { unit: proposalUnit } : {}),
        ...(proposalCap !== undefined ? { cap: proposalCap } : {}),
      };
    }
    return [
      {
        name: 'value',
        value: valueField,
        source: 'user_explicit' as const,
        ...(proposalOperator !== undefined ? { operator: proposalOperator } : {}),
        ...(proposalUnit !== undefined && typeof baseValue !== 'number'
          ? { unit: proposalUnit }
          : {}),
      },
    ];
  }
  // add_constraint and adjust_edge_strength: one parameter per
  // top-level key, matching the validator's parameter_schemas.
  return Object.entries(params).map(([name, value]) => ({
    name,
    value,
    source: 'user_explicit' as const,
  }));
}

export function buildApplyProposedChangeProposal(
  pending: PendingAction,
  fallbackEntity: FallbackEntity,
  entityLookup?: SynthesisEntityLookup,
): ProposalAction {
  if (pending.action.kind !== 'apply_proposed_change') {
    // Caller error — should never happen given the call site is
    // guarded. Fall back to the supplied entity with a passthrough
    // handler id so the validator can fail loudly rather than this
    // function silently producing an invalid proposal.
    return {
      handler_id: 'run_analysis',
      entity: {
        id: fallbackEntity.id,
        kind: fallbackEntity.kind,
        ...(fallbackEntity.label !== null ? { label: fallbackEntity.label } : {}),
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [],
      cited_context_fields: [],
    };
  }
  const ip = readInlinePatch(pending);
  const handlerId =
    ip !== null && isHandlerId(ip.handler_id) ? ip.handler_id : ('run_analysis' as V5ActionType);
  const targets: readonly string[] =
    ip !== null && Array.isArray(ip.target_entity_ids)
      ? (ip.target_entity_ids as readonly unknown[]).filter(
          (v): v is string => typeof v === 'string' && v.length > 0,
        )
      : [];
  const entityId = targets.length > 0 ? targets[0]! : fallbackEntity.id;
  // Resolve the entity's kind. The validator runs both a structural
  // check (proposed kind ∈ accepted_entity_kinds) AND a per-entity
  // check (proposed kind === graph-resolved kind). We therefore
  // prefer the graph-resolved kind when the lookup is available so
  // both checks pass; we fall back to a sensible default when not.
  let resolvedLabel: string | null = null;
  let entityKind: FallbackEntity['kind'];
  if (targets.length > 0 && entityLookup !== undefined) {
    const looked = entityLookup(entityId);
    if (looked !== null) {
      entityKind = looked.kind;
      if (looked.label !== undefined && looked.label !== null) {
        resolvedLabel = looked.label;
      }
    } else {
      entityKind = handlerId === 'adjust_edge_strength' ? 'edge' : 'node';
    }
  } else {
    entityKind =
      targets.length > 0
        ? handlerId === 'adjust_edge_strength'
          ? 'edge'
          : 'node'
        : fallbackEntity.kind;
  }
  const params =
    ip !== null &&
    ip.params !== null &&
    typeof ip.params === 'object' &&
    !Array.isArray(ip.params)
      ? (ip.params as Readonly<Record<string, unknown>>)
      : ({} as Readonly<Record<string, unknown>>);
  // Per-handler ProposalParameter shaping (P1-2). The validator's
  // `parameter_schemas` differs per handler:
  //   - set_factor_value: ONE `value` parameter accepting either a
  //     bare number OR `{ value, unit?, cap? }`; an `operator`
  //     ('set' | 'increase' | 'decrease' | 'multiply') and `unit`
  //     are SIBLING fields on the parameter, NOT separate parameters.
  //   - add_constraint: 4 separate parameters
  //     (`constraint_type`, `value`, `label`, `unit`).
  //   - adjust_edge_strength: 2 separate parameters (`strength`, `std`).
  //
  // Naively flattening every key in `params` into its own parameter
  // works for `add_constraint` and `adjust_edge_strength` but
  // misshapes `set_factor_value` — splitting `unit` / `cap` /
  // `operator` away from the `value` parameter the validator and
  // handler expect.
  const parameters = buildHandlerParameters(handlerId, params);
  // Prefer the graph-resolved label, else the fallback label (no
  // targets case), else omit.
  const labelToUse =
    resolvedLabel ?? (targets.length === 0 ? fallbackEntity.label : null);
  return {
    handler_id: handlerId,
    entity: {
      id: entityId,
      kind: entityKind,
      ...(labelToUse !== null ? { label: labelToUse } : {}),
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters,
    cited_context_fields: [],
  };
}
