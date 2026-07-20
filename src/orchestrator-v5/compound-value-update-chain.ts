/**
 * O-1 — the ONE batch-mutation lifecycle for compound value updates.
 *
 * A compound value update ("Set A to 0.6 and B to 0.8") is detected by
 * `tryCompoundValueUpdate` in the routing pre-route. This module is the single
 * component that owns the batch:
 *
 *   1. `preflightCompoundBatch` — one shared contextual preflight that EVERY
 *      part passes through BEFORE any execution: the factor-kind check, the
 *      full `validateToolCall` (structural + graph checks + the shared
 *      `evaluateFactorValueProposal` value predicate), and the raw-message
 *      unit-family guard scoped to the part's OWN message segment. This is the
 *      same validation the promoted primary gets from the ordinary lifecycle —
 *      previously parts 1..N bypassed all of it (Codex F4: "Marketing Budget
 *      to 5 agents" stored £5 into a £ factor when it sat in second position).
 *      The executor promotes the FIRST APPROVED part into the ordinary STEP
 *      2-7 lifecycle and chains the remaining approved parts here, so clause
 *      order can no longer decide correctness.
 *
 *   2. `applyCompoundValueUpdateChain` — applies the approved non-primary
 *      parts by looping the same `set_factor_value` handler, threading each
 *      part's `mutated_graph` into the next part's `graphForTurn`.
 *
 *   3. BATCH POLICY — DISCLOSED-PARTIAL (Paul's ratified compound doctrine):
 *      apply the valid parts, refuse the invalid ones BY NAME with reasons,
 *      one receipt naming both sets. Same input set → same applied set and
 *      same named refusals regardless of clause order. (Strict atomic-or-
 *      refuse is a rowed future upgrade — deliberately not built here.)
 *
 *   4. ERROR DISCIPLINE — only typed parameter-invalid errors become named
 *      refusals. Abort, timeout, and infrastructure errors RETHROW so the
 *      turn fails as what it is; `signal.throwIfAborted()` runs before each
 *      part (mirroring the executor's own abort checks). Previously the chain
 *      caught EVERY thrown value as "value invalid" — an infrastructure error
 *      mid-batch committed the earlier parts and blamed the user (Codex F12).
 *
 * WHY A DEDICATED MODULE (not inline in turn-executor): the Gate 2 invariant
 * (`turn-executor-d1-mutation-commit-graph.test.ts`) enforces that
 * `HandlerOutcome.mutated_graph` is only PRODUCED by the three D1 mutation
 * handlers, because the STEP 7 persisted-base merge-back (V5-D1-SHAPE-01)
 * assumes every producer is a D1 ingress-echo mutation that never deletes
 * nodes. This module produces a merged `HandlerOutcome.mutated_graph` — but the
 * graph it forwards is EXACTLY the `set_factor_value` handler's own output
 * chained across parts, so the ingress-echo / never-deletes-nodes contract
 * holds by construction. Keeping the producer in this small, purpose-built file
 * lets the Gate 2 allowlist name it precisely, rather than exempting the whole
 * 9,000-line turn-executor (the repo's most regression-prone file) from the
 * guard.
 *
 * Two commit channels, both fed here:
 *   - FACTS: every applied part's `SetFactorValueHandlerFact` is appended to
 *     the commit fact set. `compose.ts` emits one `graph_patch` block per fact,
 *     so the UI sees every part; this is also what drives the committed nodes
 *     on the genuinely-empty-scenario commit path.
 *   - GRAPH: each part's `mutated_graph` becomes the next part's `graphForTurn`
 *     (graph-in → graph-out), so the FINAL `mutated_graph` carries every
 *     mutation. This threading is load-bearing on the PERSISTED-base commit
 *     path: `mergeMutatedGraphForPersistence` takes `nodes` from the emitted
 *     `mutated_graph`, so without threading the persisted graph would carry
 *     only the primary part's mutation. It also keeps each part's handler
 *     validating against the correct running graph (e.g. delta operators).
 */

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { EnrichedTurnContext } from './build-turn-context.js';
import type { HandlerFn, HandlerOutcome } from './tools/registry.js';
import type { ProposalAction } from './routing/types.js';
import type { CompoundUpdatePart } from './routing/deterministic-value-update.js';
import {
  mapCqeQuantityToProposalValue,
  deriveOperator,
} from './routing/deterministic-value-update.js';
import type { GraphLookup, HandlerValidationRegistry } from './routing/validator.js';
import { validateToolCall } from './routing/validator.js';
import { classifyValueUnitAgainstFactor } from './routing/value-unit-resolution.js';
import { HandlerInvocationFailedError } from './tools/handler-errors.js';
import { D1HandlerError } from './tools/handlers/d1-shared/errors.js';
import { STALENESS_NARRATIVE } from './tools/handlers/set-factor-value.js';
import { log } from '../utils/telemetry.js';

function serialiseError(err: unknown): { name?: string; message?: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { message: String(err) };
}

// ---------------------------------------------------------------------------
// Batch preflight
// ---------------------------------------------------------------------------

/** Why a part was refused. Coarse machine enums (no user text) — safe for
 *  telemetry; the receipt maps each to user-facing copy. */
export type CompoundPartRefusalReason =
  /** The resolved target is not a factor node — no value can be set on it. */
  | 'not_a_factor'
  /** `validateToolCall` rejected the proposal with PARAMETER_INVALID (the
   *  shared value predicate: range / cap / unit / delta checks). */
  | 'value_invalid'
  /** `validateToolCall` rejected for a non-parameter reason (entity missing,
   *  suspicious label match, precondition unmet, …). */
  | 'target_unresolved'
  /** Segment unit-family guard: the value carries a unit token from a
   *  DIFFERENT family than the factor's stored unit ("5 agents" on £). */
  | 'unit_incompatible'
  /** Segment unit-family guard: a value-attached unit-like token that cannot
   *  be resolved at all ("5 widgets" on a typed factor). */
  | 'unit_unresolved'
  /** The handler itself refused at execute time (typed parameter/entity
   *  error) — defence in depth behind the preflight. */
  | 'execute_invalid';

export interface CompoundPartRefusal {
  readonly label: string;
  readonly target_id: string;
  readonly reason: CompoundPartRefusalReason;
  /** Machine detail (validator code / rejection_reason) — telemetry only. */
  readonly detail?: string;
}

export interface CompoundBatchPreflightResult {
  /** Parts that passed every check, in detector (document) order. */
  readonly approved: readonly CompoundUpdatePart[];
  /** Parts refused by name, with reasons, in detector (document) order. */
  readonly refused: readonly CompoundPartRefusal[];
}

/**
 * Build the `set_factor_value` proposal for one compound part — the single
 * construction shared by the preflight (validation) and the chain (execution),
 * and shape-identical to the primary proposal the executor synthesises.
 */
export function buildCompoundPartProposal(
  part: CompoundUpdatePart,
  message: string,
): ProposalAction {
  const { value, unit } = mapCqeQuantityToProposalValue(part.quantity);
  const operator = deriveOperator(message, part.quantity);
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: part.candidate.id,
      kind: 'node',
      label: part.candidate.label,
      resolution_status: 'resolved',
      resolution_method: 'label_match',
    },
    parameters: [
      {
        name: 'value',
        value: unit !== undefined ? { value, unit } : value,
        operator,
        source: 'user_explicit',
        ...(unit !== undefined ? { unit } : {}),
      },
    ],
    cited_context_fields: ['graph.nodes'],
  };
}

export interface CompoundBatchPreflightParams {
  readonly updates: readonly CompoundUpdatePart[];
  /** The raw user message (operator derivation for each part). */
  readonly message: string;
  /** Raw graph nodes for the turn (`graphStateForTurn?.nodes ?? []`) — the
   *  same source the executor's primary kind-check reads. */
  readonly graphNodes: ReadonlyArray<unknown>;
  readonly graphLookup: GraphLookup | undefined;
  readonly validationRegistry: HandlerValidationRegistry;
  readonly requestId: string;
  readonly scenarioId: string;
}

/**
 * ONE shared contextual preflight over the whole batch — every part gets the
 * same validation the promoted primary receives from the ordinary lifecycle:
 *
 *   a. factor-kind check (mirrors the executor's pre-synthesis kind gate);
 *   b. `validateToolCall` — structural checks + graph-dependent checks +
 *      the shared `evaluateFactorValueProposal` value predicate (Layer A.2);
 *   c. the P0-A unit-family guard, scoped to the part's OWN message segment
 *      (`part.segmentText`), so a dropped unit token ("5 agents") is judged
 *      against its own factor — this is the check whose absence stored £5
 *      into a £200k factor when the clause sat in second position (F4).
 *
 * Runs BEFORE any execution. The caller applies the approved parts (first
 * approved part through the ordinary lifecycle, the rest through the chain)
 * and narrates the refused parts by name — DISCLOSED-PARTIAL.
 */
export function preflightCompoundBatch(
  params: CompoundBatchPreflightParams,
): CompoundBatchPreflightResult {
  const { updates, message, graphNodes, graphLookup, validationRegistry } = params;
  const approved: CompoundUpdatePart[] = [];
  const refused: CompoundPartRefusal[] = [];

  const refuse = (
    part: CompoundUpdatePart,
    reason: CompoundPartRefusalReason,
    detail?: string,
  ): void => {
    refused.push({
      label: part.candidate.label,
      target_id: part.candidate.id,
      reason,
      ...(detail !== undefined ? { detail } : {}),
    });
    log.warn(
      {
        event: 'v5.compound_value_update.part_refused',
        phase: 'preflight',
        request_id: params.requestId,
        scenario_id: params.scenarioId,
        target_id: part.candidate.id,
        reason,
        ...(detail !== undefined ? { detail } : {}),
      },
      'V5 compound batch preflight: part refused; remaining parts unaffected',
    );
  };

  for (const part of updates) {
    // (a) Kind gate — same source of truth as the executor's primary check.
    const node = graphNodes.find(
      (n) => (n as { id?: unknown }).id === part.candidate.id,
    ) as { kind?: unknown; observed_state?: { unit?: unknown } } | undefined;
    if (typeof node?.kind !== 'string' || node.kind !== 'factor') {
      refuse(part, 'not_a_factor', typeof node?.kind === 'string' ? node.kind : 'missing');
      continue;
    }

    // (b) The full validator — structural + graph checks + value predicate.
    const proposal = buildCompoundPartProposal(part, message);
    const validation = validateToolCall(proposal, graphLookup, validationRegistry);
    if (!validation.valid) {
      refuse(
        part,
        validation.error.code === 'PARAMETER_INVALID' ? 'value_invalid' : 'target_unresolved',
        validation.error.code,
      );
      continue;
    }

    // (c) Unit-family guard over the part's OWN segment. Mirrors the STEP 2
    // P0-A guard (including its findFactorObservedState availability gate),
    // but scoped so one part's unit token can never be attributed to another
    // part's value.
    if (graphLookup?.findFactorObservedState !== undefined) {
      const obs = graphLookup.findFactorObservedState(part.candidate.id);
      const { value: userUnitValue } = mapCqeQuantityToProposalValue(part.quantity);
      const verdict = classifyValueUnitAgainstFactor(
        part.segmentText,
        obs?.unit,
        userUnitValue,
      );
      if (!verdict.resolved) {
        refuse(
          part,
          verdict.reason === 'incompatible_unit' ? 'unit_incompatible' : 'unit_unresolved',
          verdict.reason,
        );
        continue;
      }
    }

    approved.push(part);
  }

  return { approved, refused };
}

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------

/** User-facing clause per refusal reason. Phrasing deliberately avoids the
 *  state-mutation denial forms the egress guard rewrites ("no change",
 *  "nothing changed"). */
function refusalClause(reason: CompoundPartRefusalReason, plural: boolean): string {
  const factors = plural ? 'those factors' : 'that factor';
  switch (reason) {
    case 'unit_incompatible':
    case 'unit_unresolved':
      return `the value's unit doesn't match how ${plural ? 'they are' : 'it is'} measured`;
    case 'not_a_factor':
      return `${plural ? "they aren't factors" : "it isn't a factor"} I can set a value on`;
    case 'target_unresolved':
      return `I couldn't match ${plural ? 'them' : 'it'} to ${plural ? 'factors' : 'a factor'} confidently`;
    case 'value_invalid':
    case 'execute_invalid':
      return `that value isn't valid for ${factors}`;
  }
}

function joinNames(names: readonly string[]): string {
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Build the combined user-visible receipt for a compound value update from the
 * per-part handler outcomes plus the refused parts.
 *
 * Each `set_factor_value` outcome's `assistant_text` is its own change sentence
 * ("Updated Factor A to 0.6.") optionally followed by the shared staleness
 * narrative when a prior analysis existed. Concatenating raw texts would repeat
 * that narrative once per part, so we STRIP the trailing narrative from each
 * sentence, join the change sentences, then re-append the narrative exactly
 * once when ANY part made the analysis stale. Refused parts are named plainly
 * WITH their reason (DISCLOSED-PARTIAL: one receipt, both sets), grouped by
 * reason so shared clauses read naturally.
 */
export function buildCompoundReceiptText(
  outcomes: readonly HandlerOutcome[],
  refusals: readonly CompoundPartRefusal[],
): string {
  const stripStaleness = (text: string): string =>
    text.endsWith(STALENESS_NARRATIVE)
      ? text.slice(0, text.length - STALENESS_NARRATIVE.length).trimEnd()
      : text;
  const sentences = outcomes
    .map((o) => stripStaleness(o.assistant_text).trim())
    .filter((s) => s.length > 0);
  let text = sentences.join(' ');

  if (refusals.length > 0) {
    // Group by the user-facing clause so identical reasons share a sentence.
    const groups = new Map<CompoundPartRefusalReason, string[]>();
    for (const r of refusals) {
      const key: CompoundPartRefusalReason =
        r.reason === 'execute_invalid' ? 'value_invalid'
        : r.reason === 'unit_unresolved' ? 'unit_incompatible'
        : r.reason;
      const bucket = groups.get(key);
      if (bucket) bucket.push(r.label);
      else groups.set(key, [r.label]);
    }
    for (const [reason, labels] of groups) {
      const plural = labels.length > 1;
      text = `${text} I couldn't set ${joinNames(labels)} — ${refusalClause(reason, plural)}.`.trim();
    }
  }

  const anyStale = outcomes.some((o) => o.assistant_text.endsWith(STALENESS_NARRATIVE));
  if (anyStale) {
    text = `${text}${STALENESS_NARRATIVE}`;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Chain execution
// ---------------------------------------------------------------------------

/** Handler-boundary cause kinds that mean "this part's input was invalid" —
 *  the ONLY errors a part may absorb as a named refusal. Everything else
 *  (abort, timeout, PLoT transport, commit, graph invariants, plain Errors)
 *  rethrows so the turn fails as infrastructure, not as the user's fault. */
const REFUSABLE_EXECUTE_CAUSES: ReadonlySet<string> = new Set([
  'parameter_invalid_at_execute',
  'entity_not_found_in_graph',
  'entity_kind_mismatch_at_execute',
]);

const REFUSABLE_D1_CODES: ReadonlySet<string> = new Set([
  'PARAMETER_INVALID',
  'ENTITY_NOT_FOUND',
  'ENTITY_KIND_MISMATCH',
]);

function isRefusablePartError(err: unknown): boolean {
  if (err instanceof HandlerInvocationFailedError) {
    return REFUSABLE_EXECUTE_CAUSES.has(err.cause_kind);
  }
  // Defence in depth for a handler invoked without its runD1Handler boundary.
  if (err instanceof D1HandlerError) {
    return REFUSABLE_D1_CODES.has(err.code);
  }
  return false;
}

export interface CompoundChainParams {
  /** The primary part's outcome (first APPROVED part), already executed by
   *  the ordinary lifecycle. */
  readonly primaryOutcome: HandlerOutcome;
  /** The remaining APPROVED parts to apply (preflight-passed). */
  readonly remainingUpdates: readonly CompoundUpdatePart[];
  /** The resolved `set_factor_value` handler fn to invoke per part. */
  readonly handlerFn: HandlerFn;
  /** The user's raw message — used to derive each part's operator. */
  readonly message: string;
  /** Parts already refused by the batch preflight — folded into the receipt
   *  so the user sees ONE disclosure naming applied and refused sets. */
  readonly preflightRefusals?: readonly CompoundPartRefusal[];
  readonly context: EnrichedTurnContext;
  readonly payload: MessageTurnPayload;
  readonly requestId: string;
  readonly scenarioId: string;
  readonly signal: AbortSignal;
}

export interface CompoundChainResult {
  /** The primary outcome merged with the chained parts (combined receipt,
   *  appended facts, final chained `mutated_graph`). */
  readonly outcome: HandlerOutcome;
  /** True when at least one part (primary or chained) emitted a mutated graph. */
  readonly graphMutated: boolean;
}

/**
 * Apply the remaining approved parts of a compound value update by looping the
 * `set_factor_value` handler, threading the mutated graph part-to-part, and
 * merging the results (and the preflight refusals) into the primary outcome.
 * See the module doc for the contract the Gate 2 invariant relies on, the
 * DISCLOSED-PARTIAL batch policy, and the error discipline.
 */
export async function applyCompoundValueUpdateChain(
  params: CompoundChainParams,
): Promise<CompoundChainResult> {
  const {
    primaryOutcome,
    remainingUpdates,
    handlerFn,
    message,
    context,
    payload,
    requestId,
    scenarioId,
    signal,
  } = params;

  let chainedGraph: unknown = primaryOutcome.mutated_graph;
  let graphMutated =
    primaryOutcome.mutated_graph !== undefined && primaryOutcome.mutated_graph !== null;
  const chainedFacts: HandlerFact[] = [];
  const appliedOutcomes: HandlerOutcome[] = [];
  const refusals: CompoundPartRefusal[] = [...(params.preflightRefusals ?? [])];

  for (const part of remainingUpdates) {
    // Error discipline: a turn abort (budget) must stop the batch NOW and
    // surface as BUDGET_EXCEEDED — never absorb it into a part refusal or
    // keep executing parts after the turn is dead. Mirrors the executor's
    // own `turnAbort.signal.aborted` checks around handler invocation.
    signal.throwIfAborted();
    const partProposal = buildCompoundPartProposal(part, message);
    try {
      const partOutcome = await handlerFn({
        context,
        payload,
        requestId,
        signal,
        orientationText: '',
        proposal: partProposal,
        graphForTurn: chainedGraph,
      });
      chainedFacts.push(...partOutcome.handler_facts);
      appliedOutcomes.push(partOutcome);
      if (partOutcome.mutated_graph !== undefined && partOutcome.mutated_graph !== null) {
        chainedGraph = partOutcome.mutated_graph;
        graphMutated = true;
      }
    } catch (partError) {
      // ONLY typed parameter/entity-invalid errors become named refusals
      // (defence in depth — the batch preflight already vets every part).
      // Abort, timeout, and infrastructure errors rethrow: pre-O-1 this
      // catch swallowed EVERY thrown value as "value invalid", so an
      // infrastructure fault mid-batch committed the earlier parts and
      // blamed the user (Codex F12).
      if (!isRefusablePartError(partError)) {
        throw partError;
      }
      refusals.push({
        label: part.candidate.label,
        target_id: part.candidate.id,
        reason: 'execute_invalid',
      });
      log.warn(
        {
          event: 'v5.compound_value_update.part_refused',
          phase: 'execute',
          request_id: requestId,
          scenario_id: scenarioId,
          target_id: part.candidate.id,
          err: serialiseError(partError),
        },
        'V5 TurnExecutor: compound value-update part refused (value invalid); remaining parts applied',
      );
    }
  }

  const combinedReceipt = buildCompoundReceiptText(
    [primaryOutcome, ...appliedOutcomes],
    refusals,
  );
  const mergedFacts: readonly HandlerFact[] = [
    ...primaryOutcome.handler_facts,
    ...chainedFacts,
  ];
  const outcome: HandlerOutcome = {
    ...primaryOutcome,
    assistant_text: combinedReceipt,
    handler_facts: mergedFacts,
    mutated_graph: chainedGraph,
  };
  return { outcome, graphMutated };
}
