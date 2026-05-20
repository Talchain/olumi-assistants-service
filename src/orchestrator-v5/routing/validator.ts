/**
 * V5 Phase 1 — Validation Contract.
 *
 * Given a parsed ToolCallResponse proposal plus an OPTIONAL graph and the
 * handler validation registry, produce a typed ValidationResult. Never
 * throws; every failure path yields a typed ValidationError.
 *
 * Ordered checks per spec §6 (current behaviour after the post-review fix
 * that split structural vs graph-dependent checks):
 *
 *   ALWAYS RUN — structural (no graph required):
 *     1. handler_id exists in registry            → HANDLER_NOT_FOUND
 *     2. resolution_status === 'resolved'         → ENTITY_RESOLUTION_AMBIGUOUS
 *        (precedes kind check: clarification supersedes structural error
 *        because the user-facing recovery is "pick one of these", not "pick
 *        a different handler")
 *     3. entity.kind is accepted by the handler   → ENTITY_KIND_MISMATCH
 *     4. each parameter validates                 → PARAMETER_INVALID
 *
 *   GRAPH-DEPENDENT — skipped when graph is undefined:
 *     5. entity.id exists in graph                → ENTITY_NOT_FOUND
 *     6. if resolution_method === 'label_match',
 *        a closer Dice match exists               → ENTITY_RESOLUTION_SUSPICIOUS
 *     7. handler preconditions met                → PRECONDITION_UNMET
 *
 * Phase 1a production runs structural checks only (graph not yet threaded
 * through the V5 payload). Tests that want to exercise graph-dependent
 * checks pass an explicit graphLookup. The split was added in response to
 * post-PR review: graph-independent checks (especially resolution_status)
 * MUST run on every execute proposal, not just when graph is available.
 *
 * Non-labeled resolutions (id_match, kind_inference, context_inference) skip
 * the Dice check — Dice is specific to label-matched resolutions.
 *
 * This module does NOT:
 *   - call an LLM
 *   - hit the network
 *   - mutate graph or session state
 *   - perform any Math.round / .toFixed / parseFloat coercion on proposals
 *
 * REPAIR_ONCE behaviour (spec §7) is implemented by the *caller* (D5
 * route-with-tool-use.ts), not here. The validator is pure.
 */

import { z } from 'zod';

import { describeSchema } from '../compose/helpers.js';
import {
  evaluateFactorValueProposal,
  type FactorValueOperator,
} from '../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import type { EntityKind, ProposalAction, ProposalEntity, ProposalParameter } from './types.js';

// Dice coefficient delta above which the closer-match is flagged as
// suspicious. Conservative per brief §3 resolution D: flags for
// clarification, never silently overrides.
export const SUSPICIOUS_DICE_THRESHOLD = 0.15 as const;

// -----------------------------------------------------------------------
// Graph lookup interface
// -----------------------------------------------------------------------

/**
 * Minimal graph query surface the validator needs. Decouples the validator
 * from the concrete graph representation (GraphV3T, ContextPack, etc.). A
 * thin adapter in D6 wraps whichever shape TurnExecutor has at hand.
 */
/**
 * Snapshot of a factor's `observed_state` fields the validator's value
 * precheck needs. All fields optional — a factor may carry any subset
 * depending on whether the user has set a value yet. `null` from
 * `findFactorObservedState` means "no factor at that id" (caller should
 * have already established factor-kind via `findEntityById`, but the
 * null path is a defensive return for non-factor ids).
 *
 * The validator only reads these four fields — keeping the surface
 * narrow so the adapter doesn't have to project the full ObservedStateV3
 * shape into the lookup.
 */
export interface FactorObservedStateSnapshot {
  readonly value?: number;
  readonly raw_value?: number;
  readonly unit?: string;
  readonly cap?: number;
}

export interface GraphLookup {
  /** Find a node by id — any kind. Returns null when absent. */
  findEntityById(id: string): { id: string; kind: EntityKind; label: string | null } | null;
  /**
   * List all entities of a given kind. `label` is null when the underlying
   * node has no label — consumers must NEVER substitute the id in its place
   * because ids leak into user-visible failure chips otherwise.
   */
  listEntitiesByKind(kind: EntityKind): ReadonlyArray<{ id: string; label: string | null }>;
  /**
   * Optional — return the factor's stored observed_state fields (cap,
   * unit, value, raw_value). Used by `set_factor_value` validator
   * precheck so a proposal whose value would be rejected at execute
   * time by `normaliseFactorValue`'s cap/range guards is rejected
   * earlier with `PARAMETER_INVALID`, routing into the existing
   * recoverable path.
   *
   * Optional because not every GraphLookup adapter implements it
   * (older test mocks, simple synthetic graphs). When absent, the
   * validator skips the value precheck and relies on the handler-side
   * guard — same behaviour as before this widening. The production
   * `buildGraphLookup` adapter does implement it.
   *
   * Returns null when the id does not resolve to a factor node or when
   * the factor has no `observed_state` block at all.
   */
  findFactorObservedState?(id: string): FactorObservedStateSnapshot | null;
}

// -----------------------------------------------------------------------
// Handler validation registry
// -----------------------------------------------------------------------

/**
 * Precondition check — returns { ok: true } when preconditions are met, or
 * { ok: false, reason } to signal a typed PRECONDITION_UNMET to the caller.
 * Non-throwing.
 */
export type PreconditionCheck = (args: {
  graph: GraphLookup;
  entity: ProposalEntity;
  parameters: readonly ProposalParameter[];
}) => { ok: true } | { ok: false; reason: string };

export interface HandlerValidationDeclaration {
  readonly handler_id: string;
  readonly accepted_entity_kinds: readonly EntityKind[];
  /** Optional per-parameter Zod schemas. Absent means no parameter validation. */
  readonly parameter_schemas?: Readonly<Record<string, z.ZodType>>;
  /** Optional precondition — absent means handler has no preconditions. */
  readonly preconditions?: PreconditionCheck;
  /**
   * Typed-per-handler confirmation template (brief correction 5). Either a
   * static string, or a function that renders one from the HandlerOutcome.
   * Rendering is the CONFIRM step's responsibility (D6); the validator only
   * verifies presence here so we fail fast on misconfigured handlers.
   */
  readonly confirmation_template: string | ((outcome: unknown) => string);
}

export type HandlerValidationRegistry = Readonly<Record<string, HandlerValidationDeclaration>>;

// -----------------------------------------------------------------------
// Validation result
// -----------------------------------------------------------------------

export type ValidationErrorCode =
  | 'HANDLER_NOT_FOUND'
  | 'ENTITY_KIND_MISMATCH'
  | 'ENTITY_NOT_FOUND'
  | 'ENTITY_RESOLUTION_AMBIGUOUS'
  | 'ENTITY_RESOLUTION_SUSPICIOUS'
  | 'PARAMETER_INVALID'
  | 'PRECONDITION_UNMET';

export interface ValidationError {
  readonly code: ValidationErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export type ValidationResult =
  | { readonly valid: true; readonly proposal: ProposalAction }
  | { readonly valid: false; readonly error: ValidationError };

// -----------------------------------------------------------------------
// Dice bigram similarity
// -----------------------------------------------------------------------

/**
 * Sørensen–Dice coefficient over character bigrams.
 *
 *   2 × |bigrams(a) ∩ bigrams(b)| / (|bigrams(a)| + |bigrams(b)|)
 *
 * Case-insensitive. Whitespace is preserved inside bigrams so "Marketing
 * Cost" and "Marketing" produce overlapping bigrams on the shared prefix.
 * Strings shorter than two characters compare by equality.
 */
export function bigramDice(a: string, b: string): number {
  const normA = a.trim().toLowerCase();
  const normB = b.trim().toLowerCase();
  if (normA.length === 0 || normB.length === 0) return 0;
  if (normA === normB) return 1;
  if (normA.length < 2 || normB.length < 2) return 0;

  const bigramsA = bigramMultiset(normA);
  const bigramsB = bigramMultiset(normB);
  let overlap = 0;
  for (const [bg, countA] of bigramsA) {
    const countB = bigramsB.get(bg);
    if (countB !== undefined) overlap += Math.min(countA, countB);
  }
  const total = countTotal(bigramsA) + countTotal(bigramsB);
  return total === 0 ? 0 : (2 * overlap) / total;
}

function bigramMultiset(s: string): Map<string, number> {
  const ms = new Map<string, number>();
  for (let i = 0; i + 1 < s.length; i++) {
    const bg = s.slice(i, i + 2);
    ms.set(bg, (ms.get(bg) ?? 0) + 1);
  }
  return ms;
}

function countTotal(ms: Map<string, number>): number {
  let total = 0;
  for (const c of ms.values()) total += c;
  return total;
}

// -----------------------------------------------------------------------
// validateToolCall
// -----------------------------------------------------------------------

export function validateToolCall(
  proposal: ProposalAction,
  graph: GraphLookup | undefined,
  registry: HandlerValidationRegistry,
): ValidationResult {
  const decl = registry[proposal.handler_id];
  if (!decl) {
    return {
      valid: false,
      error: {
        code: 'HANDLER_NOT_FOUND',
        message: `Unknown handler_id: "${proposal.handler_id}"`,
        details: {
          handler_id: proposal.handler_id,
          registered: Object.keys(registry),
        },
      },
    };
  }

  // Per tool-schema.ts parser intent: execute proposals with
  // resolution_status !== 'resolved' must NOT execute. The parser accepts
  // them so the validator can surface candidates in a typed clarification
  // path; downstream compose can ask the user to disambiguate.
  if (proposal.entity.resolution_status !== 'resolved') {
    return {
      valid: false,
      error: {
        code: 'ENTITY_RESOLUTION_AMBIGUOUS',
        message: `Entity resolution is "${proposal.entity.resolution_status}" — cannot execute without confirmation`,
        details: {
          entity_id: proposal.entity.id,
          entity_kind: proposal.entity.kind,
          resolution_status: proposal.entity.resolution_status,
          resolution_method: proposal.entity.resolution_method,
          ...(proposal.entity.candidates ? { candidates: proposal.entity.candidates } : {}),
        },
      },
    };
  }

  if (!decl.accepted_entity_kinds.includes(proposal.entity.kind)) {
    return {
      valid: false,
      error: {
        code: 'ENTITY_KIND_MISMATCH',
        message: `Handler "${decl.handler_id}" does not accept entity kind "${proposal.entity.kind}"`,
        details: {
          handler_id: decl.handler_id,
          proposed_kind: proposal.entity.kind,
          accepted_kinds: [...decl.accepted_entity_kinds],
          ...(proposal.entity.label ? { proposed_label: proposal.entity.label } : {}),
        },
      },
    };
  }

  // PARAMETER_INVALID is structural — runs before the graph-dependent
  // checks because handler-declared parameter bounds don't depend on graph.
  if (decl.parameter_schemas) {
    for (const p of proposal.parameters) {
      const schema = decl.parameter_schemas[p.name];
      // DEFERRED (V5 D1 golden-path closure A3.1 follow-up): this loop
      // only validates parameters whose `name` is declared in
      // `parameter_schemas`. An undeclared parameter (e.g. a rogue
      // `{ name: 'raw_value', value: 0.05 }` entry alongside the real
      // `value`) is silently ignored by the validator and reaches the
      // handler, which itself only reads the parameters it knows
      // about. Tightening this to reject unknown parameter names is a
      // cross-handler change (every handler would need a declared
      // allowlist) flagged for a future brief alongside
      // required-parameter enforcement. See
      // `tools/handlers/__tests__/raw-value-strict-rejection.test.ts`
      // for the pinned current contract.
      if (!schema) continue;
      const parsed = schema.safeParse(p.value);
      if (!parsed.success) {
        return {
          valid: false,
          error: {
            code: 'PARAMETER_INVALID',
            message: `Parameter "${p.name}" failed schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
            details: {
              parameter: p.name,
              issue: parsed.error.issues[0]?.message,
              actual_value: p.value,
              constraint_description: describeSchema(schema),
            },
          },
        };
      }
    }
  }

  // ----- graph-dependent checks (skipped when graph is undefined) -----
  // V5 D1: edges are keyed by composite `from→to` and have no stable id
  // in the GraphLookup adapter. The handler does its own (from, to)
  // resolution at execute-time and surfaces ENTITY_NOT_FOUND through
  // the typed handler error path. Skip the structural existence + kind
  // cross-check + Dice check for edge entities.
  if (graph && proposal.entity.kind !== 'edge') {
    const existing = graph.findEntityById(proposal.entity.id);
    if (!existing) {
      return {
        valid: false,
        error: {
          code: 'ENTITY_NOT_FOUND',
          message: `Entity "${proposal.entity.id}" not found in graph`,
          details: {
            entity_id: proposal.entity.id,
            entity_kind: proposal.entity.kind,
            ...(proposal.entity.label ? { entity_label: proposal.entity.label } : {}),
          },
        },
      };
    }

    // Phase 1.5 P0-1: cross-check proposal.entity.kind against the graph's
    // actual kind for this id. The earlier accepted_entity_kinds check only
    // trusts the LLM's claim about the entity. Without this check, an LLM
    // that hallucinates kind='option' on a factor id would pass validation
    // and reach the handler targeting the wrong node class.
    if (existing.kind !== proposal.entity.kind) {
      return {
        valid: false,
        error: {
          code: 'ENTITY_KIND_MISMATCH',
          message:
            `Proposed kind "${proposal.entity.kind}" does not match graph-resolved kind ` +
            `"${existing.kind}" for id "${proposal.entity.id}"`,
          details: {
            entity_id: proposal.entity.id,
            proposed_kind: proposal.entity.kind,
            resolved_kind: existing.kind,
            ...(proposal.entity.label ? { proposed_label: proposal.entity.label } : {}),
            ...(existing.label ? { resolved_label: existing.label } : {}),
          },
        },
      };
    }

    if (proposal.entity.resolution_method === 'label_match') {
      const suspicion = detectSuspiciousLabelMatch(proposal.entity, graph);
      if (suspicion) return { valid: false, error: suspicion };
    }
  }

  // set_factor_value value-precheck (Layer A.2 of the validator/executor
  // parity workstream): structural Zod is shape-only and has no access
  // to the factor's stored cap/unit. Run the shared
  // `evaluateFactorValueProposal` predicate here — the same predicate
  // `normaliseFactorValue` runs at execute time — so a proposal that
  // would be rejected by the handler with `parameter_invalid_at_execute`
  // is rejected earlier with PARAMETER_INVALID, routing through the
  // existing recoverable path with the canonical user guidance copy.
  //
  // The precheck runs in TWO phases (review feedback 2026-05-20,
  // Blocking #2):
  //
  //   (a) Graph-INDEPENDENT structural rejection — missing or
  //       malformed `value` parameter. This runs ALWAYS for
  //       `set_factor_value` regardless of whether a graph lookup is
  //       wired in, so a caller with no graph (test, future codegen)
  //       cannot let a malformed proposal through to the handler.
  //
  //   (b) Graph-DEPENDENT range / unit / delta / existing-value
  //       checks. These need observed_state, so they only run when
  //       both `graph` and `findFactorObservedState` are available.
  //       Test mocks that don't expose observed_state still
  //       benefit from (a); they just skip the cap/unit checks.
  if (proposal.handler_id === 'set_factor_value' && proposal.entity.kind === 'node') {
    const structuralResult = preexecuteSetFactorValueStructural(proposal);
    if (structuralResult) return { valid: false, error: structuralResult };
    if (graph && typeof graph.findFactorObservedState === 'function') {
      const precheckResult = preexecuteSetFactorValue(proposal, graph);
      if (precheckResult) return { valid: false, error: precheckResult };
    }
  }

  // PRECONDITION_UNMET — preconditions take graph as input, so they only
  // run when graph is available. Handlers whose preconditions don't need
  // graph are still safe (the function ignores the unused arg).
  if (graph && decl.preconditions) {
    const pre = decl.preconditions({ graph, entity: proposal.entity, parameters: proposal.parameters });
    if (!pre.ok) {
      return {
        valid: false,
        error: {
          code: 'PRECONDITION_UNMET',
          message: `Precondition unmet: ${pre.reason}`,
          details: {
            handler_id: decl.handler_id,
            reason: pre.reason,
          },
        },
      };
    }
  }

  return { valid: true, proposal };
}

function detectSuspiciousLabelMatch(
  entity: ProposalEntity,
  graph: GraphLookup,
): ValidationError | null {
  if (!entity.label) return null;
  const candidates = graph.listEntitiesByKind(entity.kind);
  const chosen = candidates.find((c) => c.id === entity.id);
  // Unlabeled candidates cannot Dice-match a user-typed label — skip.
  if (!chosen || chosen.label === null) return null;

  const chosenScore = bigramDice(entity.label, chosen.label);
  let bestOther: { id: string; label: string; score: number } | null = null;
  for (const cand of candidates) {
    if (cand.id === entity.id) continue;
    if (cand.label === null) continue;
    const score = bigramDice(entity.label, cand.label);
    if (!bestOther || score > bestOther.score) {
      bestOther = { id: cand.id, label: cand.label, score };
    }
  }

  if (bestOther && bestOther.score - chosenScore >= SUSPICIOUS_DICE_THRESHOLD) {
    return {
      code: 'ENTITY_RESOLUTION_SUSPICIOUS',
      message:
        `Label match may be wrong: chosen "${chosen.label}" Dice=${chosenScore} ` +
        `but closer candidate "${bestOther.label}" Dice=${bestOther.score}`,
      details: {
        entity_id: entity.id,
        entity_kind: entity.kind,
        chosen: { id: chosen.id, label: chosen.label, dice: chosenScore },
        closer_candidate: { id: bestOther.id, label: bestOther.label, dice: bestOther.score },
        delta: bestOther.score - chosenScore,
      },
    };
  }

  return null;
}

/**
 * `set_factor_value` value precheck. Mirrors the handler's
 * `normaliseFactorValue` cap/range/unit guards via the shared
 * `evaluateFactorValueProposal` predicate, so a proposal that would be
 * rejected at execute time is rejected here with `PARAMETER_INVALID`
 * and routed through the existing recoverable-validator path.
 *
 * Returns null when the proposal passes (the validator continues to
 * the rest of the graph-dependent checks). Returns a ValidationError
 * when the predicate rejects.
 *
 * Caller has already established that `graph.findFactorObservedState`
 * exists and that the entity kind is `'node'`.
 */
/**
 * Graph-independent structural checks for `set_factor_value` (review
 * feedback 2026-05-20, Blocking #2): missing or malformed `value`
 * parameter MUST be rejected regardless of whether a graph lookup is
 * available. Returns null when the proposal carries a parseable
 * `value` parameter; the graph-dependent precheck below then runs
 * the cap/unit/existing-value guards.
 *
 * Operator validity is also a structural concern — a stray operator
 * the predicate doesn't understand is a malformed proposal, not
 * something to silently coerce (review feedback NB #2).
 */
function preexecuteSetFactorValueStructural(
  proposal: ProposalAction,
): ValidationError | null {
  const valueParam = proposal.parameters.find((p) => p.name === 'value');
  if (!valueParam) {
    // A proposal with no `value` parameter previously slipped through
    // (returned null = "no objection" inside an optional-graph gate)
    // and was caught by the handler with `parameter_invalid_at_execute`
    // — the same staging bug class this PR fixes. Reject at the
    // validator so the recoverable invalid_parameter path fires.
    return {
      code: 'PARAMETER_INVALID',
      message: 'set_factor_value requires a "value" parameter.',
      details: {
        parameter: 'value',
        rejection_reason: 'missing_value',
        issue: 'value parameter is missing',
        handler_id: 'set_factor_value',
      },
    };
  }

  const parsed = parseValueParameter(valueParam.value);
  if (parsed === null) {
    // Same class as missing: the `value` parameter is present but
    // its shape is neither `number` nor `{ value: number, ... }`.
    return {
      code: 'PARAMETER_INVALID',
      message: 'set_factor_value value parameter has an unsupported shape.',
      details: {
        parameter: 'value',
        rejection_reason: 'missing_value',
        issue: 'value parameter shape is not number or { value, unit?, cap? }',
        handler_id: 'set_factor_value',
        actual_value: valueParam.value,
      },
    };
  }

  // NB #2 — operator validity. The wire `ProposalParameterSchema`
  // constrains `operator` to the FactorValueOperator union, but a
  // direct validator caller (test or future codegen) could pass an
  // unknown value. Reject as PARAMETER_INVALID rather than coerce —
  // coercion would silently change the user's intent (review feedback
  // NB #2).
  const rawOperator = valueParam.operator;
  if (
    rawOperator !== undefined &&
    rawOperator !== 'set' &&
    rawOperator !== 'increase' &&
    rawOperator !== 'decrease' &&
    rawOperator !== 'multiply'
  ) {
    return {
      code: 'PARAMETER_INVALID',
      message: 'set_factor_value operator must be set, increase, decrease, or multiply.',
      details: {
        parameter: 'value',
        rejection_reason: 'missing_value',
        issue: `unknown operator: ${String(rawOperator)}`,
        handler_id: 'set_factor_value',
      },
    };
  }

  return null;
}

function preexecuteSetFactorValue(
  proposal: ProposalAction,
  graph: GraphLookup,
): ValidationError | null {
  const valueParam = proposal.parameters.find((p) => p.name === 'value');
  // Caller (validateToolCall) already ran the structural check above;
  // valueParam and its shape are guaranteed here. Defensive guards
  // for type safety only.
  if (!valueParam) return null;
  const parsed = parseValueParameter(valueParam.value);
  if (parsed === null) return null;

  const rawOperator = valueParam.operator;
  const operator: FactorValueOperator =
    rawOperator === 'set' ||
    rawOperator === 'increase' ||
    rawOperator === 'decrease' ||
    rawOperator === 'multiply'
      ? rawOperator
      : 'set';

  // `findFactorObservedState` is defined per the caller's guard, but
  // narrow defensively in case the adapter widening drifts.
  const obs = graph.findFactorObservedState
    ? graph.findFactorObservedState(proposal.entity.id)
    : null;

  const evaluation = evaluateFactorValueProposal({
    rawInput: parsed.numeric,
    operator,
    ...(parsed.unit !== undefined ? { unit: parsed.unit } : {}),
    ...(parsed.cap !== undefined ? { proposalCap: parsed.cap } : {}),
    ...(obs?.cap !== undefined ? { factorCap: obs.cap } : {}),
    ...(obs?.unit !== undefined ? { factorUnit: obs.unit } : {}),
    ...(obs?.raw_value !== undefined
      ? { factorExistingRaw: obs.raw_value }
      : obs?.value !== undefined
        ? { factorExistingRaw: obs.value }
        : {}),
    inputHasUnit: parsed.inputHasUnit,
  });

  if (evaluation.ok) return null;

  return {
    code: 'PARAMETER_INVALID',
    message: evaluation.specific_issue,
    details: {
      parameter: 'value',
      rejection_reason: evaluation.reason,
      issue: evaluation.specific_issue,
      handler_id: 'set_factor_value',
    },
  };
}

interface ParsedValueParameter {
  readonly numeric: number;
  readonly unit?: string;
  readonly cap?: number;
  readonly inputHasUnit: boolean;
}

/**
 * Mirror of `parseProposalValue` in set-factor-value.ts. Kept narrow —
 * the validator returns null on unparseable values rather than throwing,
 * because the structural Zod schema check earlier in the validator
 * already gated the union shape. A defensive null here means "structural
 * pass + nothing for precheck to evaluate"; the handler will surface
 * any genuine shape mismatch at execute time via its own
 * `parseProposalValue`.
 */
function parseValueParameter(raw: unknown): ParsedValueParameter | null {
  if (typeof raw === 'number') {
    return { numeric: raw, inputHasUnit: false };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as { value?: unknown; unit?: unknown; cap?: unknown };
    if (typeof obj.value !== 'number') return null;
    const unit = typeof obj.unit === 'string' ? obj.unit : undefined;
    const cap = typeof obj.cap === 'number' ? obj.cap : undefined;
    return {
      numeric: obj.value,
      ...(unit !== undefined ? { unit } : {}),
      ...(cap !== undefined ? { cap } : {}),
      inputHasUnit: unit !== undefined && unit.length > 0,
    };
  }
  return null;
}
