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
 * Composer call timeout. Matches the edit pipeline's own
 * `ORCHESTRATOR_TIMEOUT_MS` posture: this call happens INSTEAD of a repair
 * round the deterministic path would have paid, on a turn that was otherwise
 * about to dead-end, so it is not new budget on the happy path.
 */
const COMPOSER_DEFAULT_TIMEOUT_MS = 60_000;

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
        timeoutMs: input.timeoutMs ?? COMPOSER_DEFAULT_TIMEOUT_MS,
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
