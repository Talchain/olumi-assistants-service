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
import {
  MIN_TIMEOUT_MS,
  ORCHESTRATOR_TIMEOUT_MS,
  PLOT_VALIDATE_TIMEOUT_MS,
} from '../../config/timeouts.js';
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
  readonly timeoutMs?: number;
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
 * ROADMAP 2.665 (CEE half) — the composer's call budget, DERIVED from the turn
 * ladder rather than declared as a literal.
 *
 * ⚠ WHAT WAS HERE AND WHY IT WAS THE BUG. This was
 * `const COMPOSER_DEFAULT_TIMEOUT_MS = 60_000`, justified by "matches the edit
 * pipeline's own ORCHESTRATOR_TIMEOUT_MS posture". The posture claim was true
 * and the CONSEQUENCE was not: `edit-graph-dispatch.ts` passes neither
 * `timeoutMs` nor `signal`, so this constant WAS the whole bound, and the
 * composer was killed at 60.0s deterministically (witnessed 2/2 on the
 * 2.634/2.655 walk) — returning `unavailable: call_failed` every time, which is
 * why `decision=engaged` has never once been reached. The rulebook that ran
 * ahead of it then supplied the user's final answer, which is the #829 shape.
 *
 * THE LADDER THIS SITS IN, derived at the bytes, not restated from a comment:
 *
 *   proxy deadline            `config.proxy.browserProxyTimeoutMs`   125,000
 *   V5 turn abort  turn_ms  = min(TURN_BUDGET_MS, proxy − 10,000)    115,000
 *     ├─ rulebook  `handleEditGraph`  ORCHESTRATOR_TIMEOUT_MS         30,000
 *     │            ⚠ PER ATTEMPT, and it makes up to
 *     │            `config.cee.maxRepairRetries + 1` = 2 of them
 *     │            (edit-graph.ts:2041) — see the charging note below
 *     ├─ composer  THIS CALL                                          ← here
 *     └─ apply     `handleEditGraph({ preComposedOperations })`
 *                  — SKIPS the LLM call entirely (edit-graph.ts:2090), so its
 *                    only bounded cost is the PLoT gate               5,000
 *
 * ⚠ TWO TERMS ARE DELIBERATELY CHARGED AT MEASUREMENT RATHER THAN AT THEIR
 * BOUND, and that is a decision on the record, not an oversight:
 *
 *   1. The V5 ROUTING call ahead of this handler (a second
 *      ORCHESTRATOR_TIMEOUT_MS) is not charged at all.
 *   2. The rulebook is charged ONE attempt, not its worst-case TWO.
 *
 * WHY. Charging both at their bounds gives 115,000 − 60,000 − 30,000 − 5,000 =
 * 20,000 — LESS than the 60,000 that was already here and demonstrably too
 * small, so a "fix" derived that way would ship a composer that still cannot
 * fire. The ladder is already over-subscribed before this path spends anything
 * (routing 30,000 + getHandlerBudgetMs() 85,000 = turn_ms EXACTLY), and
 * `config/timeouts.ts` records the identical situation for decision_review and
 * resolves it the identical way: "a ceiling derived from the nominal ladder
 * alone would be 0 and therefore useless". The second rulebook attempt is also
 * the least likely term to co-occur with this call — the composer only runs
 * when the rulebook produced NO operations, whereas the repair round exists for
 * a batch that failed validation.
 *
 * CONSEQUENCE, STATED PLAINLY SO NOBODY READS MORE INTO THIS THAN IT PROVES:
 * this is an upper bound on the ONE-ATTEMPT HANDLER CHAIN, NOT a sufficiency
 * proof for the whole turn. A turn whose routing burns its full 30s, or whose
 * rulebook takes its repair round, can still reach the outer abort. That is a
 * pre-existing property of the ladder which this change neither causes nor
 * fixes; making it go away needs the turn deadline plumbed into this call
 * (`composeStructuralEdit` already accepts a `signal` the dispatcher never
 * passes), which is a larger, separate piece of work.
 *
 * WHY DERIVED AND NOT SIMPLY A BIGGER NUMBER. Both ends of every relationship
 * above are env-overridable on Render. A literal raised to 80,000 would be
 * correct at repo defaults and would silently escape the turn the moment
 * BROWSER_PROXY_TIMEOUT_MS was lowered — the hand-maintained mirror, whose
 * symptom is a generic TURN_BUDGET_EXCEEDED with nothing naming the cause.
 * Deriving makes that drift impossible by construction: lower the proxy
 * deadline and this budget falls in lockstep, pinned by U2-3 in
 * `budget-timeout-invariants.test.ts`.
 *
 * Read at CALL TIME, never at module load, so an env rotation on the deployed
 * instance is honoured without a restart (the `getTurnExecutorBudgets` posture).
 */
export function resolveComposerTimeoutMs(): number {
  const { turn_ms } = getTurnExecutorBudgets();
  return Math.max(
    MIN_TIMEOUT_MS,
    turn_ms - ORCHESTRATOR_TIMEOUT_MS - PLOT_VALIDATE_TIMEOUT_MS,
  );
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
        timeoutMs: input.timeoutMs ?? resolveComposerTimeoutMs(),
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

  emit(TelemetryEvents.V5StructuralEditToolComposed, {
    request_id: input.requestId,
    scenario_id: input.scenarioId,
    outcome: validation.ok ? 'accepted' : 'rejected',
    // Structural code only — never the reason prose, which quotes ids.
    rejection_code: validation.ok ? null : validation.code,
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
