/**
 * ROADMAP 2.474 (CEE leg) — TRANSPORT for `propose_structural_edit`.
 *
 * One model call, one validation, one answer. This module is the only place
 * that talks to an adapter on this path; the CONTRACT (advert, grounding
 * table, validator) lives in `propose-structural-edit.ts` and the DECISION to
 * engage lives in `structural-edit-entry.ts`. Splitting it three ways is what
 * lets the rules be proved without an LLM and the transport be proved without
 * a graph.
 *
 * REJECT-DON'T-REPAIR, and it is enforced HERE rather than merely intended:
 * this function makes AT MOST ONE call. There is no corrective round, no
 * retry, no "try again with the errors" loop. A batch that fails the grounding
 * validator returns a rejection, the dispatcher declines honestly, and the
 * turn ends without a mutation. The reason is not tidiness — a repair loop
 * against a model that just invented an id is a loop that will invent a
 * different id, and each round costs the user latency to arrive at the same
 * refusal.
 *
 * A5(b) — the model NEVER echoes a hash. `base_graph_hash` is stamped
 * server-side by the referee producer from the frame that built the grounding
 * table, so a transcription slip cannot manufacture a spurious
 * BASE_HASH_DIVERGED dead-end.
 */

import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
import { MIN_TIMEOUT_MS, PLOT_VALIDATE_TIMEOUT_MS } from '../../config/timeouts.js';
import { getTurnExecutorBudgets } from '../budgets.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  CallOpts,
  ToolDefinition,
} from '../../adapters/llm/types.js';
import type { EditPatchOperationLike } from '../graph-management/adapters/edit-graph-producer.js';

import {
  buildProposeStructuralEditTool,
  PROPOSE_STRUCTURAL_EDIT_TOOL_NAME,
  validateProposedStructuralEdit,
  type StructuralEditGrounding,
  type StructuralEditRejectionCode,
} from './propose-structural-edit.js';
import type { StructuralEditPart } from './structural-edit-batch-split.js';

/** The minimal adapter surface this path needs. */
export interface StructuralEditComposerAdapter {
  readonly name?: string;
  chatWithTools?: (
    args: ChatWithToolsArgs,
    opts: CallOpts,
  ) => Promise<ChatWithToolsResult>;
}

export type StructuralEditComposeOutcome =
  | {
      readonly status: 'composed';
      /** The WHOLE composed batch, in order — never a part, never truncated. */
      readonly operations: readonly EditPatchOperationLike[];
      readonly envelopeCount: number;
      /**
       * A3 — the batch partitioned into cap-legal parts. Length 1 on the
       * ordinary path. Length > 1 means the caller must submit `parts[0]` and
       * DISCLOSE the remainder; it must never submit a later part on this turn,
       * and never drop one.
       */
      readonly parts: readonly StructuralEditPart[];
    }
  | {
      readonly status: 'rejected';
      readonly code: StructuralEditRejectionCode;
      readonly reason: string;
    }
  | {
      readonly status: 'unavailable';
      /**
       * The tool could not run at all. Distinct from `rejected`: nothing was
       * judged, so nothing about the user's request was decided. The caller
       * must not present this as a refusal of the EDIT.
       */
      readonly reason: 'no_tool_adapter' | 'call_failed' | 'no_tool_call';
    };

export interface StructuralEditComposeInput {
  readonly adapter: StructuralEditComposerAdapter;
  readonly grounding: StructuralEditGrounding;
  /** The user's edit request, verbatim. */
  readonly message: string;
  /** Pipeline op cap (`config.cee.maxPatchOperations`) — passed, never guessed. */
  readonly maxPatchOperations: number;
  readonly requestId: string;
  readonly scenarioId: string;
  /**
   * ⚠ REQUIRED, and that is the fix (ROADMAP 2.684).
   *
   * It was `timeoutMs?: number` with a module-local default behind the `??`,
   * so "the dispatcher never passes one" was not a type error, was not a test
   * failure, and was not visible anywhere — it was simply the behaviour. Two
   * budget fixes shipped against this file without either of them making the
   * caller pass a budget, because nothing could see that it didn't. Making the
   * parameter required turns that entire defect class into a COMPILE ERROR: no
   * caller can reach this function without having derived a deadline.
   *
   * There is deliberately no fallback. A default here would be a static value,
   * and the whole finding of witness #3 is that no static value can be right.
   */
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

const COMPOSER_SYSTEM_PROMPT =
  'You are the structural editor for a decision model. The user has asked for ' +
  'a change to their model. Call the `propose_structural_edit` tool exactly ' +
  'once with the complete batch of operations that makes the change.\n' +
  '\n' +
  'Every operation must be grounded in the model given in the tool ' +
  'description: name real ids, echo real labels, and create anything new ' +
  'explicitly. If the change the user asked for cannot be expressed against ' +
  'that model, do not call the tool and say briefly what is missing. Never ' +
  'invent an id to make a batch look complete — a batch with one invented id ' +
  'is rejected whole, so guessing costs the user the entire edit.\n' +
  '\n' +
  'Do not claim the change has been made. Structural changes are held for the ' +
  'user to confirm.';

const COMPOSER_MAX_TOKENS = 4000;

/**
 * What still has to happen on this turn AFTER the composer returns, charged at
 * its only bounded cost.
 *
 * The composer's success path re-enters `handleEditGraph` with
 * `preComposedOperations`, which SKIPS the LLM call entirely
 * (edit-graph.ts:2090) — so the apply's only bounded cost is the PLoT gate.
 * DERIVED from that constant rather than restated next to it: raise the PLoT
 * validate timeout on Render and this reserve rises with it.
 *
 * ⚠ DISCLOSED, not silently assumed: the commit that follows the apply is
 * charged AT MEASUREMENT, not at a bound, because it has no bounded constant to
 * charge it at. `turn_ms` is itself already `proxy − TURN_RESPONSE_HEADROOM_MS`
 * (10,000), so the serialisation headroom is inside the deadline this reserve
 * is measured against; the commit's Supabase writes are not. They were ~2.0s on
 * both witness #3 attempts (composer end → boundary.response), comfortably
 * inside that 10,000 — but that is a measurement, not a guarantee, and it is
 * recorded here so the next person does not read this reserve as one.
 */
export const COMPOSER_POST_CALL_RESERVE_MS = PLOT_VALIDATE_TIMEOUT_MS;

/**
 * The composer's budget, or the honest finding that there is none left.
 *
 * `exhausted` is not an error and not a refusal of the user's request — it is
 * the turn running out of time before the composer could be given a usable
 * window. The caller must decline, and must never present it as a judgement
 * about the edit.
 */
export type StructuralEditComposerBudget =
  | {
      readonly kind: 'available';
      /** What to give the call. Always ≥ MIN_TIMEOUT_MS. */
      readonly timeoutMs: number;
      /** Time to the turn deadline at the moment of the derivation. */
      readonly remainingMs: number;
    }
  | {
      readonly kind: 'exhausted';
      /** Time to the turn deadline. May be negative: the deadline has passed. */
      readonly remainingMs: number;
    };

/**
 * ROADMAP 2.684 — the composer's budget is THE TURN'S ACTUAL REMAINING TIME.
 *
 * ── WHY NEITHER PREDECESSOR WORKED, because both were reasonable ───────────
 *
 * #829-era: `const COMPOSER_DEFAULT_TIMEOUT_MS = 60_000`. The dispatcher passed
 * nothing, so that literal WAS the bound, and the composer was killed at 60.0s
 * deterministically (witnessed 2/2).
 *
 * #842: a DERIVED static ceiling,
 * `max(MIN_TIMEOUT_MS, turn_ms − ORCHESTRATOR_TIMEOUT_MS − PLOT_VALIDATE_TIMEOUT_MS)`
 * = 80,000 at repo defaults. Correct arithmetic. It shipped, and witness #3
 * measured the composer killed at **5.008s and 5.006s** — WORSE than the
 * literal it replaced. Cause, measured at the deployed bytes: the Render
 * dashboard carries `ORCHESTRATOR_TIMEOUT_MS=150000`, five times the 30,000
 * code default the arithmetic assumed, so `115,000 − 150,000 − 5,000` = −40,000
 * and the floor clamped it to 5,000. That is trap 18 — the deployed env is not
 * the YAML and is not the code default — breaking a derivation that was right
 * about everything except which numbers the box holds.
 *
 * ── THE TWO INVARIANTS THAT REPLACE THEM ──────────────────────────────────
 *
 * I-A. NO STATIC VALUE CAN BE RIGHT, so this derives no ceiling at all. It asks
 * one question — how long until this turn must have answered? — and hands the
 * rest to the composer minus what still has to happen after it. A static
 * ceiling is blind to what the turn ALREADY SPENT: witness #3 measured ~62s of
 * edit_graph + repair ahead of the composer, so even a perfect 80,000 ceiling
 * would have authorised a call that could not finish inside the turn. Remaining
 * time cannot be blind to that, because consumed time is precisely what it
 * measures.
 *
 * I-B. THE ARITHMETIC READS NO ENV CONSTANT WHOSE DEPLOYED VALUE CAN SILENTLY
 * DIVERGE. `ORCHESTRATOR_TIMEOUT_MS` is GONE from this file. It never belonged:
 * it is the per-call cap on the rulebook's LLM call, not a description of the
 * turn's shape, and setting it to 150,000 on the dashboard does not lengthen
 * the turn by one millisecond — it only made a formula that subtracted it
 * believe the turn was over. Subtracting a parallel constant is a claim about
 * the deployment that the deployment never agreed to.
 *
 * ⚠ AND THE OBVIOUS ALTERNATIVE FIX IS A TRAP, so it is closed here in writing:
 * "just set ORCHESTRATOR_TIMEOUT_MS back to 30,000 on the dashboard" WOULD
 * repair this formula and BREAK the live product. The 2.684 archaeology read
 * the deployed env from the Render API and traced every consumer at
 * `e8fcb4f2`: the key is the V5 ROUTING call's per-call LLM budget
 * (`routing/route-with-tool-use.ts:578`, and its retry window at `:799`) and
 * the edit_graph tool's own call budget (`orchestrator/tools/edit-graph.ts:2024`).
 * Lowering it 150,000 → 30,000 cuts the live routing budget by five-sixths.
 * The value is load-bearing somewhere else entirely, which is exactly why a
 * formula here must not depend on it — and why the fix had to be this one and
 * not a dashboard edit. (Its provenance is UNTRACEABLE: set by hand in the
 * dashboard between 2026-02-07 and 2026-04-11, no commit, PR, YAML or handover
 * entry records it; Render's API exposes no env-change events. It is also on
 * cee-demo, identically. Rowed as a question for Paul, not a change.)
 *
 * The one env-bearing term that remains is `turn_ms`, and it qualifies because
 * it is not parallel to anything: it is the value the turn executor itself
 * arms its abort with (`setTimeout(() => turnAbort.abort(), budgets.turn_ms)`,
 * turn-executor.ts), clamped by `clampTurnBudgetToProxyDeadline` to the browser
 * proxy's real deadline. Raise it or lower it and the turn's actual lifetime
 * moves with it. That is the whole test: the value that ends the turn is the
 * value the budget is measured against.
 *
 * ⚠ SCOPE, STATED PRECISELY BECAUSE THE OVERCLAIM IS AVAILABLE HERE. On the
 * edit_graph path `turn_ms` is a DEADLINE, not an abort. This path runs through
 * `route-v2.ts` → `dispatchEditGraph` and never enters the turn executor, so no
 * `turnAbort` fires on it; what actually cuts it off is the browser proxy at
 * `browserProxyTimeoutMs` (125,000), which `turn_ms` is derived to sit 10,000
 * below precisely so CEE answers first with its own typed error. Measuring
 * against `turn_ms` therefore means "answer before the proxy gives up on you",
 * which is the deadline that matters to the user, and it is strictly the safer
 * of the two. It is NOT the claim that something aborts this call at turn_ms.
 *
 * ── WHY A FLOOR-HIT NOW MEANS DECLINE, NOT A DOOMED CALL ──────────────────
 * The old floor was a clamp: below the minimum, fire a 5s call anyway. Witness
 * #3 is what that looks like from the user's chair — a guaranteed
 * `UpstreamTimeoutError` dressed as an attempt, 5s of the user's time spent to
 * learn nothing. `exhausted` says the true thing instead, and the caller
 * declines through `compose_unavailable` without paying for a call that cannot
 * finish. The floor stays as a sanity minimum; it no longer manufactures
 * failures.
 *
 * Read at CALL TIME, never at module load, so an env rotation on the deployed
 * instance is honoured without a restart (the `getTurnExecutorBudgets` posture).
 *
 * @param input.requestStartMs Wall-clock baseline of the HTTP request, threaded
 *   from `route-v2.ts`'s `routeStartedAt`. The REQUEST's start, not the
 *   dispatcher's: pre-flight, ingress parse and scenario upsert all happen
 *   before the dispatcher and all spend the same deadline.
 * @param input.nowMs Injectable clock. Tests only; defaults to `Date.now()`.
 */
export function resolveComposerBudget(input: {
  readonly requestStartMs: number;
  readonly nowMs?: number;
}): StructuralEditComposerBudget {
  const { turn_ms } = getTurnExecutorBudgets();
  const nowMs = input.nowMs ?? Date.now();
  const remainingMs = input.requestStartMs + turn_ms - nowMs;
  const timeoutMs = remainingMs - COMPOSER_POST_CALL_RESERVE_MS;
  if (timeoutMs < MIN_TIMEOUT_MS) {
    return { kind: 'exhausted', remainingMs };
  }
  return { kind: 'available', timeoutMs, remainingMs };
}

/**
 * Compose ONE grounded batch. Never throws: an adapter failure resolves to
 * `unavailable`, which the caller reports as an inability to compose, not as
 * a refusal of the edit.
 */
export async function composeStructuralEdit(
  input: StructuralEditComposeInput,
): Promise<StructuralEditComposeOutcome> {
  const chatWithTools = input.adapter.chatWithTools;
  if (typeof chatWithTools !== 'function') {
    return { status: 'unavailable', reason: 'no_tool_adapter' };
  }

  const tool: ToolDefinition = buildProposeStructuralEditTool(input.grounding);

  let result: ChatWithToolsResult;
  try {
    result = await chatWithTools.call(
      input.adapter,
      {
        system: COMPOSER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: input.message }],
        tools: [tool],
        tool_choice: { type: 'auto' },
        temperature: 0,
        maxTokens: COMPOSER_MAX_TOKENS,
      },
      {
        requestId: input.requestId,
        // No `??` fallback, deliberately — see the `timeoutMs` jsdoc. Every
        // caller derives a deadline or does not compile.
        timeoutMs: input.timeoutMs,
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
      },
    );
  } catch (err) {
    log.warn(
      {
        event: 'v5.structural_edit_tool.call_failed',
        request_id: input.requestId,
        scenario_id: input.scenarioId,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 propose_structural_edit — composer call failed; the turn declines rather than guessing',
    );
    return { status: 'unavailable', reason: 'call_failed' };
  }

  const toolUse = result.content.find(
    (block): block is Extract<typeof block, { type: 'tool_use' }> =>
      block.type === 'tool_use' && block.name === PROPOSE_STRUCTURAL_EDIT_TOOL_NAME,
  );
  if (toolUse === undefined) {
    // The model declined to compose — the correct outcome when the request
    // cannot be expressed against the persisted graph. Not an error.
    return { status: 'unavailable', reason: 'no_tool_call' };
  }

  const validation = validateProposedStructuralEdit(toolUse.input, input.grounding, {
    maxPatchOperations: input.maxPatchOperations,
  });

  // ROADMAP 2.713 — WHAT THE CAP COUNTS IS WHAT THE CAP DISCLOSES.
  //
  // The counts below are read off `validation`, which on a REJECTION carries
  // no operations BY DESIGN (reject-don't-repair returns no partial batch), so
  // every count was hardcoded 0 on exactly the branch a diagnosis needs them.
  // The model's raw emission has been in scope all along and was never
  // counted. With `raw_operations_count` present, the two guards that share
  // `BATCH_CAP_EXCEEDED` become distinguishable from telemetry alone — a
  // RUNAWAY emission (count over the cap) versus a legitimate batch no split
  // can make cap-legal (count at or under it) — which is the exact ambiguity
  // that blocked a live diagnosis. Structural only: a COUNT and a CODE, never
  // the reason prose, which quotes ids.
  const rawOperationsCount = Array.isArray(
    (toolUse.input as { operations?: unknown } | null)?.operations,
  )
    ? ((toolUse.input as { operations: unknown[] }).operations.length)
    : null;

  emit(TelemetryEvents.V5StructuralEditToolComposed, {
    request_id: input.requestId,
    scenario_id: input.scenarioId,
    outcome: validation.ok ? 'accepted' : 'rejected',
    // Structural code only — never the reason prose, which quotes ids.
    rejection_code: validation.ok ? null : validation.code,
    // Which of the two guards behind BATCH_CAP_EXCEEDED fired; null on every
    // other rejection code and on acceptance.
    rejection_detail: validation.ok ? null : (validation.detail ?? null),
    // The model's RAW emission length, on BOTH branches — the one number that
    // survives a rejection, because it is measured from the tool payload and
    // not from the validation outcome. `null` only if the payload carried no
    // `operations` array at all (itself a SCHEMA_INVALID rejection).
    raw_operations_count: rawOperationsCount,
    operations_count: validation.ok ? validation.operations.length : 0,
    envelope_count: validation.ok ? validation.envelopeCount : 0,
    // A3 — how many proposals this request became. 1 on the ordinary path;
    // >1 is the split that replaced a dead turn, and it is the number to watch
    // when asking whether the headline scenario is actually working.
    part_count: validation.ok ? validation.parts.length : 0,
    grounded_node_count: input.grounding.nodes.length,
  });

  if (!validation.ok) {
    return { status: 'rejected', code: validation.code, reason: validation.reason };
  }
  return {
    status: 'composed',
    operations: validation.operations,
    envelopeCount: validation.envelopeCount,
    parts: validation.parts,
  };
}
