/**
 * ⭐ PATH-B: THE ADAPTERS AS SDK FUNCTION TOOLS (C5, 19 Oct 2026). The runner's ONE seam: `pathBTools(deps, ctx, mode, onCall)`.
 *  · Each tool sends its zod schema STRICT (OpenAI holds the call to it; the SDK parses it). Strict schemas carry no string
 *    length limits, so the adapters refuse an empty label or brief themselves.
 *  · Each execute returns the ONE typed outcome as JSON, and `onCall` records it once, after it is known: the kit's
 *    `_agent.tool_calls` row (`traceRow`) and the route's tool result.
 *  · `apply_change` needs the user's approval (the SDK's interruption; PATH-B owns the pause and the resume). A change it
 *    commits is analysed at once by the route's automatic Run (`analyseAfterCommit`, at most once per request), and that
 *    Run's outcome rides `apply_change`'s own: the SDK continues with it, so the AI that writes the reply has the results.
 *    A Run asked for after that in the same turn is refused (`run_not_requested`).
 *  · THIN CORE: on a scenario whose meaning is its living model (or that has no model yet), `propose_change` carries the
 *    complete proposed living model (`living-change.ts`); a living proposal is applied as one core write. A legacy scenario
 *    keeps the existing change adapter.
 *  · A `preview` lane reads only.
 * The adapters return outcomes and do not throw; anything that does throw (arguments a strict schema should have stopped,
 * a defect) ends the turn with the route's own handlers, as on the existing loop (`errorFunction: null`).
 */
import { tool, type Tool } from '@openai/agents';
import { toolArgumentsAsSent } from '../../agent-lane/runtime/agent-loop.js';
import type { AgentLaneMode, AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import { READ_CANONICAL_CONTEXT, ReadCanonicalContextParams, readCanonicalContext } from './context-tool.js';
import { BUILD_MODEL_FROM_BRIEF, BuildModelParams, buildModel, type DraftDeps } from './draft-tool.js';
import { RUN_ANALYSIS, RunAnalysisParams, recordedRun, runAnalysis, type RunDeps } from './run-tool.js';
import { APPLY_CHANGE, ApplyChangeParams, PROPOSE_CHANGE, ProposeChangeParams, applyChange, proposeChange, type ChangeDeps } from './change-tools.js';
import { LivingChangeParams, applyLivingChange, isLivingProposal, proposeLivingChange } from './living-change.js';
import { NOTE_MAX, NOTE_ON_ITEM, NoteOnItemParams, noteOnItem } from './note-on-item.js';
import { STRESS_TEST, StressTestParams, stressTest, type StressDeps } from './stress-tool.js';
import { OFFER_PUBLIC_RESEARCH, OFFER_PUBLIC_RESEARCH_DESCRIPTION, OfferResearchParams, offerResearch, type ResearchDeps } from './research-tool.js';
import { refused, traceRow, type ToolOutcome, type TraceRow } from './outcome.js';

export { traceRow, type TraceRow, type ToolOutcome } from './outcome.js';
export { readCanonicalContext } from './context-tool.js';

/** The AIE's five descriptions, verbatim (prompt/AIE-PATH-B-FIVE-TOOL-DESCRIPTIONS-AND-STANCE-20261019-v1.json, sha256 e8b43291…). */
export const TOOL_DESCRIPTIONS = {
  read_canonical_context:
    'Read the current saved scenario view, its revision, recorded sources, analysis readiness and selected Run. Use the returned saved facts rather than old conversation claims. Check the Run’s revision and staleness before using it; missing source or context remains unknown.',
  build_model_from_brief:
    'Create and save Olumi’s provisional first Living Model from the user’s actual brief, supplied verbatim from their messages. Use only when there is no existing model to replace. Preserve the brief’s known sources, assumptions, conditions and disagreement; creating the model does not verify its claims. Report creation only from the tool’s confirmed outcome.',
  propose_change:
    'Prepare the complete requested change for review without changing the operative saved model. Preserve supplied values, signs, units, periods, conditions and retain, replace or retract intent. Declare each figure’s actual source using the available fields; keep unknown source unknown and assumptions distinct from current claims. Quote only actual supplied words; never invent a quote or a source, and never present Olumi’s estimate as the person’s or a party’s: on their item it is marked estimate_by olumi, and it never replaces or mixes with a figure they gave. If required meaning cannot be represented, report the specific unavailable capability rather than silently dropping part of the change or relabelling its source.',
  apply_change:
    'Commit the exact prepared change after the user approves that current proposal. Approval is permission to apply, not proof that a save succeeded or that its claims are verified. Use the operation’s own receipt and approved postimage readback. Distinguish an earlier completed save from a new write, honour stale or conflicting proposals, and report unknown outcomes without repeating a completed effect.',
  run_analysis:
    'Request a fresh scientific Run of the current saved model. Eligible committed changes and Undo use the existing automatic analysis and coaching path; do not issue a duplicate Run after them. Read actual readiness and the recorded Run, then explain only what its results support. Report refusal or unavailability honestly. Do not rerun analysis merely to retry an explanation.',
  note_on_item:
    `Show one short note beside one item of the saved model, labelled as Olumi’s: a question to test it, a challenge to an assumption, or what seems missing. When your reply asks the person one question about one item in the model, call this with that item’s id and the question, so it shows on that item; as the note, keep the same question in at most ${NOTE_MAX} characters, naming items by their label, never by id. At most one per turn; it changes nothing in the model. Use the item’s id from read_canonical_context. Never call an option best and never recommend one.`,
  // TRACK 3: prompt text routed to Science by the DL (inform-only); each cell is the variant Run's own chance (DL ruling B, 21 Oct).
  stress_test:
    'Only when the person asks to stress-test an assumption, or to try other values for one. Name one to three links or factors from read_canonical_context with the values to test, in their own units, and say whether the person gave those values; optionally one named alternative link. Nothing is saved. Each result is that tested setting’s own chance of meeting the goal, in this model, as the result would show it, or why it is not shown: say each option’s lowest and highest with the settings that give them. Never average the settings or call anything across them a chance. Never use this to compute something a Run could not use (an unsized link, or a range with no distribution): propose a size with propose_change instead. Say where the two explanations differ; never combine them, never call an option best and never recommend one.',
} as const;


export type PathBToolDeps = ChangeDeps & DraftDeps & RunDeps & Pick<StressDeps, 'runStressVariant'> & ResearchDeps & {
  /**
   * The route's automatic Run after a committed change (the existing pipeline, at most once per request): the pipeline's
   * outcome, or none with the saved model's readiness when that readiness admits no Run.
   */
  readonly analyseAfterCommit?: () => Promise<{ readonly run?: Record<string, unknown>; readonly ready?: unknown }>;
};
export type PathBContext = Pick<AgentToolContext, 'scenario_id' | 'authenticated_user_id' | 'turn_id' | 'verified_user_messages' | 'user_turn_text'>;
/** The route's tool result for one call: what `tool_results[i]` reads. `mutated` is false for an unknown write (the row says null). */
export interface ToolCallResult {
  /** The AI's parsed declaration, with the same bounds and redaction as A's trace. */
  readonly args?: Readonly<Record<string, unknown>>;
  readonly ok: boolean;
  readonly mutated: boolean;
  readonly ran?: true;
  readonly proposal_id?: string;
  readonly outcome: ToolOutcome['status'];
  readonly refusal?: string;
  /** The commit's own receipt, as every writer reports one (`turn-receipts.ts` lifts it onto `_agent.receipts`). */
  readonly receipts?: readonly Record<string, unknown>[];
  /** `note_on_item`'s block, for the route to ship beside the reply, and the model identity it was read on (`note_basis`). */
  readonly ui_directive?: Record<string, unknown>;
  readonly note_basis?: string;
  /** `offer_public_research`'s accepted query: the route ships the one control that can send it (`researchChipFor`). */
  readonly offered_query?: string;
}
export type OnToolCall = (row: TraceRow, result: ToolCallResult) => void;

export function pathBTools(deps: PathBToolDeps, ctx: PathBContext, mode: AgentLaneMode, onCall: OnToolCall = () => {},
  scenario: 'core' | 'legacy' = 'legacy'): Tool[] {
  let approvalApplied = false;
  const notes = { notes: 0 };
  const review = { done: false };
  const record = (name: string, input: Record<string, unknown>, outcome: ToolOutcome, proposalId?: string): string => {
    const args = toolArgumentsAsSent(name, JSON.stringify(input), [ctx.user_turn_text ?? '', ...(ctx.verified_user_messages ?? [])]).arguments;
    const row = { ...traceRow(name, outcome), args };
    const pid = outcome.status === 'ok' && typeof outcome.data.proposal_id === 'string' ? outcome.data.proposal_id : proposalId;
    const receipt = outcome.status === 'ok' ? outcome.data.receipt : undefined;
    try {
      onCall(row, { args, ok: row.ok, mutated: row.mutated === true, ...(row.ran === true ? { ran: true as const } : {}),
        ...(pid === undefined ? {} : { proposal_id: pid }),
        ...(outcome.status === 'ok' && typeof outcome.data.public_label === 'string' ? { public_label: outcome.data.public_label } : {}), outcome: row.outcome, ...(row.refusal === null ? {} : { refusal: row.refusal }),
        ...(receipt !== null && typeof receipt === 'object' ? { receipts: [receipt as Record<string, unknown>] } : {}),
        ...(outcome.status === 'ok' && outcome.data.ui_directive !== null && typeof outcome.data.ui_directive === 'object'
          ? { ui_directive: outcome.data.ui_directive as Record<string, unknown>, note_basis: String(outcome.data.graph_identity) } : {}),
        ...(outcome.status === 'ok' && typeof outcome.data.offered_query === 'string' ? { offered_query: outcome.data.offered_query } : {}) });
    } catch { /* a recorder never decides the outcome */ }
    return JSON.stringify(outcome);
  };

  const read = tool({
    name: READ_CANONICAL_CONTEXT,
    description: TOOL_DESCRIPTIONS.read_canonical_context,
    parameters: ReadCanonicalContextParams,
    execute: async (args) => record(READ_CANONICAL_CONTEXT, args, await readCanonicalContext(deps, ctx)),
    errorFunction: null,
  });
  if (mode === 'preview') return [read];

  return [
    read,
    tool({
      name: BUILD_MODEL_FROM_BRIEF,
      description: TOOL_DESCRIPTIONS.build_model_from_brief,
      parameters: BuildModelParams,
      execute: async (args) => record(BUILD_MODEL_FROM_BRIEF, args, await buildModel({ ...deps, review }, ctx, args)),
      errorFunction: null,
    }),
    scenario === 'core' ? tool({
      name: PROPOSE_CHANGE,
      description: TOOL_DESCRIPTIONS.propose_change,
      parameters: LivingChangeParams,
      execute: async (args) => record(PROPOSE_CHANGE, args, await proposeLivingChange(deps, ctx, args)),
      errorFunction: null,
    }) : tool({
      name: PROPOSE_CHANGE,
      description: TOOL_DESCRIPTIONS.propose_change,
      parameters: ProposeChangeParams,
      execute: async (args) => record(PROPOSE_CHANGE, args, await proposeChange(deps, ctx, args)),
      errorFunction: null,
    }),
    tool({
      name: APPLY_CHANGE,
      description: TOOL_DESCRIPTIONS.apply_change,
      parameters: ApplyChangeParams,
      needsApproval: true,
      execute: async (args) => {
        const outcome = isLivingProposal(deps.proposals.get(args.proposal_id))
          ? await applyLivingChange(deps, ctx, args.proposal_id) : await applyChange(deps, ctx, args);
        if (outcome.status === 'ok') approvalApplied = true;
        if (outcome.status !== 'ok' || !outcome.mutated || deps.analyseAfterCommit === undefined) return record(APPLY_CHANGE, args, outcome, args.proposal_id);
        const auto = await deps.analyseAfterCommit();
        const analysis = auto.run === undefined ? refused('run_not_ready', undefined, { analysis_ready: auto.ready ?? null })
          : await recordedRun(deps, ctx, auto.run);
        return record(APPLY_CHANGE, args, { ...outcome, data: { analysis, ...outcome.data } }, args.proposal_id);
      },
      errorFunction: null,
    }),
    tool({
      name: RUN_ANALYSIS,
      description: TOOL_DESCRIPTIONS.run_analysis,
      parameters: RunAnalysisParams,
      execute: async (args) => record(RUN_ANALYSIS, args, await runAnalysis(deps, ctx, args, { approvalApplied })),
      errorFunction: null,
    }),
    // TRACK 3: offered only where the route wires the variant Run; it reads and computes, and saves nothing.
    ...(deps.runStressVariant === undefined ? [] : [tool({
      name: STRESS_TEST,
      description: TOOL_DESCRIPTIONS.stress_test,
      parameters: StressTestParams,
      execute: async (args) => record(STRESS_TEST, args, await stressTest(deps, ctx, args)),
      errorFunction: null,
    })]),
    tool({
      name: NOTE_ON_ITEM,
      description: TOOL_DESCRIPTIONS.note_on_item,
      parameters: NoteOnItemParams,
      execute: async (args) => record(NOTE_ON_ITEM, args, await noteOnItem(deps, ctx, args, notes)),
      errorFunction: null,
    }),
    // The legacy research offer on the core lane: it searches nothing and saves nothing (`research-tool.ts`).
    tool({
      name: OFFER_PUBLIC_RESEARCH,
      description: OFFER_PUBLIC_RESEARCH_DESCRIPTION,
      parameters: OfferResearchParams,
      execute: async (args) => record(OFFER_PUBLIC_RESEARCH, args, await offerResearch(deps, args)),
      errorFunction: null,
    }),
  ];
}
