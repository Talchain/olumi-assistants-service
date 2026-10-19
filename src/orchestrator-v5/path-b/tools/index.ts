/**
 * ⭐ PATH-B: THE ADAPTERS AS SDK FUNCTION TOOLS (C5, 19 Oct 2026). The runner's ONE seam: `pathBTools(deps, ctx, mode, onCall)`.
 *  · Each tool sends its zod schema STRICT (OpenAI holds the call to it; the SDK parses it). Strict schemas carry no string
 *    length limits, so the adapters refuse an empty label or brief themselves.
 *  · Each execute returns the ONE typed outcome as JSON, and `onCall` records it once, after it is known: the kit's
 *    `_agent.tool_calls` row (`traceRow`) and the route's tool result.
 *  · `apply_change` needs the user's approval (the SDK's interruption; PATH-B owns the pause and the resume). After an
 *    applied approval, a Run in the same turn is refused (`run_not_requested`): the route's own Run after a committed change runs it.
 *  · A `preview` lane reads only.
 * The adapters return outcomes and do not throw; anything that does throw (arguments a strict schema should have stopped,
 * a defect) ends the turn with the route's own handlers, as on the existing loop (`errorFunction: null`).
 */
import { tool, type Tool } from '@openai/agents';
import type { AgentLaneMode, AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import { READ_CANONICAL_CONTEXT, ReadCanonicalContextParams, readCanonicalContext } from './context-tool.js';
import { BUILD_MODEL_FROM_BRIEF, BuildModelParams, buildModel, type DraftDeps } from './draft-tool.js';
import { RUN_ANALYSIS, RunAnalysisParams, runAnalysis, type RunDeps } from './run-tool.js';
import { APPLY_CHANGE, ApplyChangeParams, PROPOSE_CHANGE, ProposeChangeParams, applyChange, proposeChange, type ChangeDeps } from './change-tools.js';
import { traceRow, type ToolOutcome, type TraceRow } from './outcome.js';

export { traceRow, type TraceRow, type ToolOutcome } from './outcome.js';
export { readCanonicalContext } from './context-tool.js';

export type PathBToolDeps = ChangeDeps & DraftDeps & RunDeps;
export type PathBContext = Pick<AgentToolContext, 'scenario_id' | 'authenticated_user_id' | 'turn_id' | 'verified_user_messages' | 'user_turn_text'>;
/** The route's tool result for one call: what `tool_results[i]` reads. `mutated` is false for an unknown write (the row says null). */
export interface ToolCallResult {
  readonly ok: boolean;
  readonly mutated: boolean;
  readonly ran?: true;
  readonly proposal_id?: string;
  readonly outcome: ToolOutcome['status'];
  readonly refusal?: string;
}
export type OnToolCall = (row: TraceRow, result: ToolCallResult) => void;

export function pathBTools(deps: PathBToolDeps, ctx: PathBContext, mode: AgentLaneMode, onCall: OnToolCall = () => {}): Tool[] {
  let approvalApplied = false;
  const record = (name: string, outcome: ToolOutcome, proposalId?: string): string => {
    const row = traceRow(name, outcome);
    const pid = outcome.status === 'ok' && typeof outcome.data.proposal_id === 'string' ? outcome.data.proposal_id : proposalId;
    try {
      onCall(row, { ok: row.ok, mutated: row.mutated === true, ...(row.ran === true ? { ran: true as const } : {}),
        ...(pid === undefined ? {} : { proposal_id: pid }), outcome: row.outcome, ...(row.refusal === null ? {} : { refusal: row.refusal }) });
    } catch { /* a recorder never decides the outcome */ }
    return JSON.stringify(outcome);
  };

  const read = tool({
    name: READ_CANONICAL_CONTEXT,
    description: 'Read the saved scenario as it stands now: the model, where each figure came from, whether it can be run, and the latest Run.',
    parameters: ReadCanonicalContextParams,
    execute: async () => record(READ_CANONICAL_CONTEXT, await readCanonicalContext(deps, ctx)),
    errorFunction: null,
  });
  if (mode === 'preview') return [read];

  return [
    read,
    tool({
      name: BUILD_MODEL_FROM_BRIEF,
      description: 'Draft Olumi\'s provisional first model from the user\'s brief, copied verbatim from their own messages. Only when the scenario has no model yet.',
      parameters: BuildModelParams,
      execute: async (args) => record(BUILD_MODEL_FROM_BRIEF, await buildModel(deps, ctx, args)),
      errorFunction: null,
    }),
    tool({
      name: PROPOSE_CHANGE,
      description: 'Prepare a change to the model for the user to approve; nothing is saved. For each figure, declare where it came from: the user (with their exact words), a third party they named (with the user\'s exact words), Olumi\'s own estimate, or not known (with the user\'s exact words).',
      parameters: ProposeChangeParams,
      execute: async (args) => record(PROPOSE_CHANGE, await proposeChange(deps, ctx, args)),
      errorFunction: null,
    }),
    tool({
      name: APPLY_CHANGE,
      description: 'Save a prepared change. The user approves it first; nothing is saved without their approval.',
      parameters: ApplyChangeParams,
      needsApproval: true,
      execute: async (args) => {
        const outcome = await applyChange(deps, ctx, args);
        if (outcome.status === 'ok') approvalApplied = true;
        return record(APPLY_CHANGE, outcome, args.proposal_id);
      },
      errorFunction: null,
    }),
    tool({
      name: RUN_ANALYSIS,
      description: 'Run the analysis on the model as it stands now, when the user asks for it.',
      parameters: RunAnalysisParams,
      execute: async (args) => record(RUN_ANALYSIS, await runAnalysis(deps, ctx, args, { approvalApplied })),
      errorFunction: null,
    }),
  ];
}
