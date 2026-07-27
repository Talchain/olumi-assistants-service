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
  resolveExistingRawValue,
  suggestExtendedCap,
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
  // V5 edit_graph P0 containment (task_99f83f0d): a set_factor_value proposal
  // refused because the user's message implies an option-specific
  // intervention edit (not a factor-value change). Synthesised at the
  // turn-executor execute chokepoint, never produced by validateToolCall
  // itself (the check needs the raw user message, which the validator does
  // not receive). Routed through the standard recoverable-validator path so
  // the turn composes a clarify and commits a direct_answer, graph unchanged.
  | 'OPTION_INTERVENTION_MISROUTE'
  // P0-A value/unit fail-closed containment: a set_factor_value proposal
  // refused because the user expressed the value with a unit that cannot be
  // resolved against the target factor with confidence (e.g. "Set Hiring Cost
  // to 5 agents" — a headcount value on a £ factor). Like
  // OPTION_INTERVENTION_MISROUTE it is synthesised at the turn-executor execute
  // chokepoint (the check needs the raw user message, which validateToolCall
  // does not receive) and routed through the standard recoverable-validator
  // path so the turn composes a clarify and commits a direct_answer, graph
  // unchanged.
  | 'VALUE_UNIT_UNRESOLVED'
  | 'PRECONDITION_UNMET';

export interface ValidationError {
  readonly code: ValidationErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Which proposal-entity attributes the graph overrode. */
export type RepairedEntityAttribute = 'kind' | 'label';

/**
 * Record of an entity-kind repair (see `validateToolCall`). Present on a
 * successful result ONLY when the routing model's `entity.kind` disagreed
 * with the graph's own kind for that id and the graph's kind was adopted.
 * Observability-only: the caller logs it. Absent on the common path where
 * the model labelled the entity correctly.
 *
 * ⚠ THE NAME IS THE POPULATION. This record is produced for KIND repairs
 * only, so `v5.entity_kind_repaired` keeps the exact population it had when
 * the staging diagnosis was read off it. A LABEL-only repair also happens
 * (see `effectiveProposal` below) and deliberately produces NO record: the
 * label is prose-only, adopting the graph's is strictly more truthful, and
 * there is no routing-prompt question a label-only signal would answer.
 * `repaired_attributes` exists so the kind-repair population still discloses
 * when the model got BOTH wrong — a doubly-confused proposal is a stronger
 * prompt signal than a kind slip alone, and that was previously invisible.
 */
export interface EntityKindRepair {
  readonly handler_id: string;
  readonly entity_id: string;
  /** What the model claimed. */
  readonly proposed_kind: EntityKind;
  /** What the graph says — the kind actually used for validation. */
  readonly resolved_kind: EntityKind;
  /**
   * Attribute names the graph overrode on this proposal, in a stable order.
   * Always contains 'kind' (see the population note above); contains 'label'
   * as well when the model's label also disagreed with the graph's. Attribute
   * NAMES only — never the label values, which are user-authored content and
   * must not enter the log line (safe_details privacy contract).
   */
  readonly repaired_attributes: readonly RepairedEntityAttribute[];
}

export type ValidationResult =
  | {
      readonly valid: true;
      readonly proposal: ProposalAction;
      readonly kind_repair?: EntityKindRepair;
    }
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

  // ----- entity-kind repair: the GRAPH is the authority on kind -----
  //
  // The routing model emits both an entity `id` and an entity `kind`. The id
  // is a lookup into the graph we handed it. The kind is the model's own
  // LABEL for that entity — a guess about our taxonomy, not a claim the user
  // made. Trusting the guess over our own graph throws away correct requests.
  //
  // Live evidence (cee-staging, 2026-07-26/27 — 20 consecutive
  // ENTITY_KIND_MISMATCH refusals on "add a hard constraint on <outcome>"):
  //   * 12× proposed_kind 'constraint'  → refused by the registry check below
  //     (the user's own word "constraint" primes the label);
  //   * 8× proposed_kind 'goal' with resolved_kind 'node' on the REAL id
  //     `out_tco_efficiency` → refused by the graph cross-check.
  // In every one of the 20 the id resolved to the node the user meant, and
  // `add_constraint` accepts that node's real kind. Nothing was wrong with
  // the request except the model's label for it.
  //
  // So: when the id resolves, adopt the graph's kind and carry on.
  //
  // BLAST RADIUS — this does not widen what can execute. Today a proposal
  // reaches a handler iff
  //     proposed ∈ accepted   AND   proposed === resolved
  // (the registry check plus the graph cross-check that used to live at the
  // bottom of this function), which entails `resolved ∈ accepted`. After
  // this change it reaches a handler iff
  //     resolved ∈ accepted
  // Both conditions are stated over the GRAPH-RESOLVED kind, so the set of
  // (handler, real graph kind) pairs that can execute is IDENTICAL; the old
  // admit-set is a strict subset of the new one, and the difference is
  // exactly "the model mislabelled an entity it had already identified
  // correctly". The id — the only thing that selects a target — is never
  // altered. Handlers still run their own graph-kind check against their
  // finer taxonomy (e.g. add-constraint.ts ALLOWED_TARGET_KINDS).
  //
  // This SUBSUMES the former graph-resolved cross-check, which existed to
  // stop a hallucinated kind reaching a handler pointed at the wrong node
  // class. Adopting ground truth is strictly stronger than rejecting on a
  // disagreement with it: a proposal whose resolved kind the handler does
  // not accept is still refused here, by the check immediately below.
  //
  // NOT repaired, both keeping exactly today's behaviour:
  //   * 'edge' proposals — edges have no stable id and are excluded from
  //     graph resolution entirely, so there is nothing to resolve against;
  //   * graph-absent turns — no graph, no ground truth, model's claim stands.
  // An id that does NOT resolve is also not repaired: the model's kind is
  // left alone so this check still fires first, preserving today's error
  // precedence (kind before not-found) for unresolvable entities.
  const resolvedEntity =
    graph && proposal.entity.kind !== 'edge'
      ? graph.findEntityById(proposal.entity.id)
      : null;

  const kindNeedsRepair = resolvedEntity !== null && resolvedEntity.kind !== proposal.entity.kind;

  // ----- the LABEL is graph-owned too -----
  //
  // The same argument that makes the graph authoritative on `kind` makes it
  // authoritative on `label`: the model emits a label as its own NAME for the
  // entity it resolved, not as a claim the user made, and we are holding the
  // real one. Left un-adopted the model's invention reaches user prose — the
  // turn-executor stamps `factor_label` onto its VALUE_UNIT_UNRESOLVED and
  // OPTION_INTERVENTION_MISROUTE errors straight from the proposal entity, and
  // those render through `safeLabel()` into "the {label} factor". We would be
  // repeating a name that appears nowhere in the user's model back to them as
  // if it were theirs.
  //
  // Adopted ONLY when the graph actually knows a label. `label: null` on a
  // graph entry is missing data, not ground truth, and blanking a usable
  // model label in its favour would degrade the same prose (safeLabel would
  // fall back to "that item").
  const labelNeedsRepair =
    resolvedEntity !== null &&
    typeof resolvedEntity.label === 'string' &&
    resolvedEntity.label.length > 0 &&
    resolvedEntity.label !== proposal.entity.label;

  const kindRepair: EntityKindRepair | null =
    resolvedEntity && kindNeedsRepair
      ? {
          handler_id: decl.handler_id,
          entity_id: proposal.entity.id,
          proposed_kind: proposal.entity.kind,
          resolved_kind: resolvedEntity.kind,
          repaired_attributes: labelNeedsRepair ? (['kind', 'label'] as const) : (['kind'] as const),
        }
      : null;

  // Every check from here on runs against the repaired proposal, so the
  // graph's kind is what the parameter prechecks, the Dice check, the
  // preconditions and the handler all see. Carrying the model's stale label
  // any further would silently skip kind-gated checks (notably the
  // `set_factor_value` value precheck, gated on kind === 'node').
  const effectiveProposal: ProposalAction =
    resolvedEntity && (kindNeedsRepair || labelNeedsRepair)
      ? {
          ...proposal,
          entity: {
            ...proposal.entity,
            ...(kindNeedsRepair ? { kind: resolvedEntity.kind } : {}),
            ...(labelNeedsRepair ? { label: resolvedEntity.label as string } : {}),
          },
        }
      : proposal;

  const effectiveKind = effectiveProposal.entity.kind;

  if (!decl.accepted_entity_kinds.includes(effectiveKind)) {
    return {
      valid: false,
      error: {
        code: 'ENTITY_KIND_MISMATCH',
        message:
          `Handler "${decl.handler_id}" does not accept entity kind "${effectiveKind}"` +
          (kindRepair
            ? ` (graph-resolved for id "${proposal.entity.id}"; model proposed "${kindRepair.proposed_kind}")`
            : ''),
        details: {
          handler_id: decl.handler_id,
          proposed_kind: proposal.entity.kind,
          accepted_kinds: [...decl.accepted_entity_kinds],
          // Present only when the graph disagreed with the model. Lets the
          // composer say what was actually found instead of guessing.
          ...(kindRepair ? { resolved_kind: kindRepair.resolved_kind } : {}),
          ...(resolvedEntity?.label ? { resolved_label: resolvedEntity.label } : {}),
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
  // the typed handler error path. Skip the structural existence +
  // Dice check for edge entities.
  //
  // The kind cross-check that used to live here is gone — it is subsumed by
  // the repair above, which adopts `existing.kind` rather than rejecting a
  // disagreement with it. `existing` is the same lookup, hoisted so the
  // repair could run before the registry check; it is reused (not re-run)
  // so this stays a single graph read.
  if (graph && effectiveProposal.entity.kind !== 'edge') {
    const existing = resolvedEntity;
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

    // Phase 1.5 P0-1's cross-check (`existing.kind !== proposal.entity.kind`
    // → ENTITY_KIND_MISMATCH) stood here. It is INTENTIONALLY REMOVED, not
    // lost: the repair above adopts `existing.kind` as the validated kind, so
    // this comparison is true-by-construction and the hazard it guarded — a
    // hallucinated kind reaching a handler aimed at the wrong node class — is
    // now handled by the registry check running against the graph's kind
    // instead of the model's. Leaving the old branch in place would have been
    // a condition that can no longer fire.
    //
    // The Dice check runs on the REPAIRED KIND, so it lists candidates from
    // the bucket the entity actually lives in. On a mislabelled proposal it
    // previously listed the wrong bucket, failed to find the chosen id and
    // returned null — i.e. this guard silently did nothing on exactly the
    // proposals most likely to be confused. It now discriminates.
    //
    // ⚠ BUT IT MUST SEE THE MODEL'S LABEL, NOT THE REPAIRED ONE. The check
    // scores `bigramDice(entity.label, graphLabelOf(entity.id))` and fires
    // when some OTHER graph entry scores materially higher. The model's label
    // is the entire input under judgement: it is the evidence that the
    // `label_match` resolution picked the right id. Hand it the adopted graph
    // label and that score is 1.0 by construction, `bestOther - 1 >= 0.15`
    // can never hold, and ENTITY_RESOLUTION_SUSPICIOUS becomes unreachable —
    // a guard deleted by a change that reads like an improvement. Pinned by
    // `resolved-label-adoption.test.ts` ("STILL flags a suspicious label
    // match after the graph label is adopted").
    if (effectiveProposal.entity.resolution_method === 'label_match') {
      // Repaired kind (right candidate bucket) + the MODEL's own label (the
      // evidence under judgement). Never `effectiveProposal.entity` wholesale.
      const diceEntity: ProposalEntity = {
        ...proposal.entity,
        kind: effectiveProposal.entity.kind,
      };
      const suspicion = detectSuspiciousLabelMatch(diceEntity, graph);
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
  //
  // Gated on the REPAIRED kind. A proposal the model mislabelled (say
  // kind 'goal' on a factor id) is now admitted by the registry check, so
  // gating this precheck on the model's stale label would let a malformed
  // value skip it and reach the handler — the repair must not open a hole
  // in a kind-gated check.
  if (
    effectiveProposal.handler_id === 'set_factor_value' &&
    effectiveProposal.entity.kind === 'node'
  ) {
    const structuralResult = preexecuteSetFactorValueStructural(effectiveProposal);
    if (structuralResult) return { valid: false, error: structuralResult };
    if (graph && typeof graph.findFactorObservedState === 'function') {
      const precheckResult = preexecuteSetFactorValue(effectiveProposal, graph);
      if (precheckResult) return { valid: false, error: precheckResult };
    }
  }

  // PRECONDITION_UNMET — preconditions take graph as input, so they only
  // run when graph is available. Handlers whose preconditions don't need
  // graph are still safe (the function ignores the unused arg).
  if (graph && decl.preconditions) {
    const pre = decl.preconditions({
      graph,
      entity: effectiveProposal.entity,
      parameters: effectiveProposal.parameters,
    });
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

  // Return the REPAIRED proposal — the graph's kind and label, not the
  // model's guesses. `kind_repair` is present only when a KIND repair
  // happened; the caller logs it so a rise in repairs is visible as a
  // routing-prompt signal rather than disappearing into a silent success.
  //
  // CALLER CONTRACT (this comment used to say "hand the HANDLER the repaired
  // proposal", which was not what either caller did — the handler received
  // the unrepaired object and the discrepancy sat here as an untrue claim):
  //   • turn-executor.ts — REBINDS its `action` to this proposal immediately
  //     after a valid verdict, so the handler, and the two validation errors
  //     the executor itself raises afterwards (VALUE_UNIT_UNRESOLVED,
  //     OPTION_INTERVENTION_MISROUTE), all see the repaired entity.
  //   • compound-value-update-chain.ts — uses the result as a VERDICT ONLY.
  //     It approves the caller's own `CompoundUpdatePart`, never a proposal,
  //     so there is nothing there for a repaired proposal to flow into.
  return kindRepair
    ? { valid: true, proposal: effectiveProposal, kind_repair: kindRepair }
    : { valid: true, proposal: effectiveProposal };
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
 * Graph-independent structural checks for `set_factor_value` (review
 * feedback 2026-05-20, Blocking #2): missing or malformed `value`
 * parameter MUST be rejected regardless of whether a graph lookup is
 * available. Returns null when the proposal carries a parseable
 * `value` parameter and a known operator; the graph-dependent
 * precheck below then runs the cap/unit/existing-value guards.
 *
 * Operator validity is also a structural concern — a stray operator
 * the predicate doesn't understand is a malformed proposal, not
 * something to silently coerce (review feedback NB #2, NB #1).
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
        // Explicit `null` (not omitted) so the composer can branch on
        // the rejection_reason without ever rendering the "unknown"
        // sentinel from `sanitiseForUser(undefined)`. V5 row-7 fix B.
        actual_value: null,
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
        // NB #1 (review 2026-05-20): distinct enum for operator-shape
        // rejection so dashboards can distinguish "no value parameter"
        // from "value parameter present but operator is invalid". The
        // overloaded `missing_value` made the two indistinguishable.
        rejection_reason: 'invalid_operator',
        issue: `unknown operator: ${String(rawOperator)}`,
        handler_id: 'set_factor_value',
      },
    };
  }

  return null;
}

/**
 * Graph-dependent cap / unit / existing-value precheck for
 * `set_factor_value`. Mirrors the handler's `normaliseFactorValue`
 * via the shared `evaluateFactorValueProposal` predicate, so a
 * proposal that would be rejected at execute time is rejected here
 * with `PARAMETER_INVALID` and routed through the existing
 * recoverable-validator path.
 *
 * Caller has already run `preexecuteSetFactorValueStructural` above
 * AND established that `graph.findFactorObservedState` exists and
 * that the entity kind is `'node'`. Defensive null returns inside
 * this function are type-safety guards only — by construction the
 * `value` param is present and parseable when we get here.
 */
function preexecuteSetFactorValue(
  proposal: ProposalAction,
  graph: GraphLookup,
): ValidationError | null {
  const valueParam = proposal.parameters.find((p) => p.name === 'value');
  // Defensive — the structural precheck above guarantees the value
  // parameter is present and parseable; these early-returns are for
  // type narrowing only.
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

  // De-normalise the delta LHS identically to the handler (raw_value, else
  // value*cap for capped, else value) so validator and handler agree on the
  // existing value — never feed the normalised `value` as the raw LHS. Only a
  // `resolved` value is a usable LHS; `missing`/`ambiguous` omit it so the
  // delta guard rejects (fail closed).
  const existing = resolveExistingRawValue({
    ...(obs?.raw_value !== undefined ? { raw_value: obs.raw_value } : {}),
    ...(obs?.value !== undefined ? { value: obs.value } : {}),
    ...(obs?.unit !== undefined ? { unit: obs.unit } : {}),
    ...(obs?.cap !== undefined ? { cap: obs.cap } : {}),
  });
  const evaluation = evaluateFactorValueProposal({
    rawInput: parsed.numeric,
    operator,
    ...(parsed.unit !== undefined ? { unit: parsed.unit } : {}),
    ...(parsed.cap !== undefined ? { proposalCap: parsed.cap } : {}),
    ...(obs?.cap !== undefined ? { factorCap: obs.cap } : {}),
    ...(obs?.unit !== undefined ? { factorUnit: obs.unit } : {}),
    ...(existing.kind === 'resolved' ? { factorExistingRaw: existing.raw } : {}),
    inputHasUnit: parsed.inputHasUnit,
  });

  if (evaluation.ok) return null;

  // Surface the effective unit (proposal unit, else the factor's stored
  // unit) so the recoverable composer can render unit-aware clarify copy
  // (e.g. the `bare_ratio_on_unit_factor` branch). A short symbol like
  // '£' / '%' / 'people' — never user prose.
  const effectiveUnit = parsed.unit ?? obs?.unit;
  // 1.16 items A1/A2/B — thread the full user-facing context the composer
  // branches need: the proposed value + operator, the factor's id + live
  // label (entity-named copy for delta_no_existing_value; the rescale
  // chip's replay message must name the factor), and — for a 'set' with an
  // explicit unit whose value genuinely exceeds the cap — a suggested
  // extended cap for the user-consented rescale chip. Details never reach
  // logs unfiltered (buildSafeValidatorLogDetails whitelists).
  const liveEntity = graph.findEntityById(proposal.entity.id);
  const factorLabel = liveEntity?.label ?? undefined;
  const effectiveCap = parsed.cap ?? obs?.cap;
  const suggestedCap =
    evaluation.reason === 'value_exceeds_cap' &&
    operator === 'set' &&
    parsed.inputHasUnit &&
    effectiveCap !== undefined &&
    parsed.numeric > effectiveCap
      ? suggestExtendedCap(parsed.numeric)
      : undefined;
  return {
    code: 'PARAMETER_INVALID',
    message: evaluation.specific_issue,
    details: {
      parameter: 'value',
      rejection_reason: evaluation.reason,
      issue: evaluation.specific_issue,
      handler_id: 'set_factor_value',
      value: parsed.numeric,
      operator,
      factor_id: proposal.entity.id,
      ...(factorLabel !== undefined && factorLabel !== null ? { factor_label: factorLabel } : {}),
      ...(effectiveUnit !== undefined ? { unit: effectiveUnit } : {}),
      ...(suggestedCap !== undefined ? { suggested_cap: suggestedCap } : {}),
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
