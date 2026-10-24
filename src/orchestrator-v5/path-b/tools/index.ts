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
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { ModelBehaviorError, tool, type FunctionTool, type Tool } from '@openai/agents';
import { toolArgumentsAsSent } from '../../agent-lane/runtime/agent-loop.js';
import type { AgentLaneMode, AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import { READ_CANONICAL_CONTEXT, ReadCanonicalContextParams, readCanonicalContext } from './context-tool.js';
import { BUILD_MODEL_FROM_BRIEF, BuildModelParams, buildModel, type DraftDeps } from './draft-tool.js';
import { RUN_ANALYSIS, RunAnalysisParams, recordedRun, runAnalysis, type RunDeps } from './run-tool.js';
import { APPLY_CHANGE, ApplyChangeParams, PROPOSE_CHANGE, ProposeChangeParams, applyChange, proposeChange, type ChangeDeps } from './change-tools.js';
import { LivingChangeParams, applyLivingChange, isLivingProposal, proposeLivingChange } from './living-change.js';
import { REPAIRS, type Blocker } from './goal-path.js';
import type { Relabelled } from '../living-model/kernel.js';
import { NOTE_MAX, NOTE_ON_ITEM, NoteOnItemParams, noteOnItem } from './note-on-item.js';
import { STRESS_TEST, StressTestParams, stressTest, type StressDeps } from './stress-tool.js';
import { OFFER_PUBLIC_RESEARCH, OFFER_PUBLIC_RESEARCH_DESCRIPTION, OfferResearchParams, offerResearch, type ResearchDeps } from './research-tool.js';
import { log } from '../../../utils/telemetry.js';
import { OUTCOME_TRACE, refused, traceRow, type ToolOutcome, type TraceRow } from './outcome.js';
import { applyProgramChange, isProgramProposal, ProgramChangeParams, proposeProgramChange, readProgramContext, runProgram } from '../../model-program-turn/program-tools.js';
import { PROGRAM_TOOL_DESCRIPTIONS } from '../../core-route/instructions.js';

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
    `Show one short note beside one item of the saved model, labelled as Olumi’s: a question to test it, a challenge to an assumption, or what seems missing. When your reply asks the person one question about one item in the model, call this with that item’s id and the question, so it shows on that item; as the note, keep the same question in at most ${NOTE_MAX} characters, naming items by their label, never by id. When the person asks you to challenge one item they name, put your challenge to it as this note on that item. At most one per turn; it changes nothing in the model. Use the item’s id from read_canonical_context. Never call an option best and never recommend one.`,
  // TRACK 3: prompt text routed to Science by the DL (inform-only); each cell is the variant Run's own chance (DL ruling B, 21 Oct).
  stress_test:
    'Only when the person asks to stress-test an assumption, or to try other values for one. Name one to three links or factors from read_canonical_context with the values to test, in their own units, and say whether the person gave those values; optionally one named alternative link. Nothing is saved. Each result is that tested setting’s own chance of meeting the goal, in this model, as the result would show it, or why it is not shown: say each option’s lowest and highest with the settings that give them. Never average the settings or call anything across them a chance. Never use this to compute something a Run could not use (an unsized link, or a range with no distribution): propose a size with propose_change instead. Say where the two explanations differ; never combine them, never call an option best and never recommend one.',
} as const;


export type PathBToolDeps = ChangeDeps & DraftDeps & RunDeps & Pick<StressDeps, 'runStressVariant'> & ResearchDeps & {
  /**
   * The route's automatic Run after a committed change (the existing pipeline, at most once per request): the pipeline's
   * outcome, or none with the saved model's readiness when that readiness admits no Run.
   */
  readonly analyseAfterCommit?: () => Promise<{ readonly run?: Record<string, unknown>; readonly ready?: unknown; readonly awaitsTiming?: true }>;
  /** A Challenge on one card (the route's `challengeTargetOf`): this turn's note may sit only beside that card (Codex r2 #3634). */
  readonly noteOnlyOn?: string;
  /** The card a press approves: on that turn the apply is bound to it, never to the AI's argument (DL 93d79c3e). */
  readonly pressedProposal?: string;
};
export type PathBContext = Pick<AgentToolContext, 'scenario_id' | 'authenticated_user_id' | 'turn_id' | 'verified_user_messages' | 'user_turn_text'>;
/** The route's tool result for one call: what `tool_results[i]` reads. `mutated` is false for an unknown write (the row says null). */
export interface ToolCallResult {
  /** The AI's parsed declaration, with the same bounds and redaction as A's trace. */
  readonly args?: Readonly<Record<string, unknown>>;
  readonly ok: boolean;
  readonly mutated: boolean;
  readonly ran?: true;
  /** The Run a `ran` call confirmed by a fresh read (`recordedRun`): the only Run whose result the route may ship for it. */
  readonly run_id?: string;
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
  /** The self-check's verdict and the authorship decisions the call reports, by code and id only (the route's turn log). */
  readonly check?: TurnCheck;
}
export interface TurnCheck {
  readonly run_ready?: boolean;
  readonly blockers?: readonly { readonly code: string; readonly verdict?: 'fix' | 'ask' | 'said'; readonly items?: readonly string[] }[];
  readonly relabelled?: readonly Relabelled[];
  /** Whose-words checks (codes and ids only): the check that refused a change, and the ids it refused. */
  readonly words?: { readonly check: string; readonly ids: readonly string[] };
}
// A condition is keyed by its words (`condition:<text>`): a log names only that it was one.
const idOnly = (id: string): string => (id.startsWith('condition:') ? 'condition' : id);
/** An id as the log holds it: a plain id as it is; any other (an id holding someone's words) a stable stand-in, never its text. */
const loggedId = (id: string): string => (/^[A-Za-z0-9_.-]{1,64}$/.test(idOnly(id)) ? idOnly(id) : `#${createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 8)}`);
const listOf = (v: unknown): Record<string, unknown>[] =>
  (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object') : []);
/** Any tool's `blockers` (a Run's readiness has its own shape and words): only a code, and the self-check's verdict and ids. */
function checkOf(outcome: ToolOutcome): TurnCheck | undefined {
  const data: Record<string, unknown> = ('data' in outcome ? outcome.data : undefined) ?? {};
  const blockers = listOf(data.blockers).filter((b) => typeof b.code === 'string').map((b) => ({ code: b.code as string,
    ...(b.fix !== undefined ? { verdict: 'fix' as const } : b.ask === true ? { verdict: 'ask' as const } : b.said === true ? { verdict: 'said' as const } : {}),
    ...(Array.isArray(b.items) ? { items: (b.items as Blocker['items']).filter((i) => typeof i === 'string').map(idOnly) } : {}) }));
  const relabelled = listOf(outcome[OUTCOME_TRACE]?.relabelled)
    .filter((r) => typeof r.id === 'string' && typeof r.was === 'string').map((r) => ({ id: idOnly(r.id as string), was: r.was as Relabelled['was'] }));
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((i): i is string => typeof i === 'string').map(loggedId) : []);
  const words = typeof data.check === 'string' && ids(data.ids).length > 0 ? { check: data.check, ids: ids(data.ids) } : undefined;
  const check: TurnCheck = { ...(typeof data.run_ready === 'boolean' ? { run_ready: data.run_ready } : {}),
    ...(blockers.length > 0 ? { blockers } : {}), ...(relabelled.length > 0 ? { relabelled } : {}), ...(words ? { words } : {}) };
  return Object.keys(check).length > 0 ? check : undefined;
}
export type OnToolCall = (row: TraceRow, result: ToolCallResult) => void;

/** The automatic Run that was not started because the goal's chance needs a timing reading nobody has given (DL 22 Oct). */
const AWAITS_TIMING = 'Saved. No analysis ran: this goal\'s chance rests on when the options\' effects are in place, and no reading of that '
  + 'is recorded yet. Invite the person to press Run; give your reading of the timing (effects_timing) with that Run.';

export function pathBTools(deps: PathBToolDeps, ctx: PathBContext, mode: AgentLaneMode, onCall: OnToolCall = () => {},
  scenario: 'core' | 'legacy' | 'program' = 'legacy'): Tool[] {
  let approvalApplied = false;
  const notes = { notes: 0, ...(deps.noteOnlyOn !== undefined ? { only: deps.noteOnlyOn } : {}) };
  const review = { done: false };
  const record = (name: string, input: Record<string, unknown>, outcome: ToolOutcome, proposalId?: string): string => {
    const args = toolArgumentsAsSent(name, JSON.stringify(input), [ctx.user_turn_text ?? '', ...(ctx.verified_user_messages ?? [])]).arguments;
    const row = { ...traceRow(name, outcome), args };
    const pid = outcome.status === 'ok' && typeof outcome.data.proposal_id === 'string' ? outcome.data.proposal_id : proposalId;
    // The draft reports its commit as `model_version` (`draft-tool.ts`), a change as `receipt`: either is this call's own receipt.
    const receipt = outcome.status === 'ok' ? outcome.data.receipt ?? outcome.data.model_version : undefined;
    try {
      const check = checkOf(outcome);
      onCall(row, { args, ok: row.ok, mutated: row.mutated === true, ...(row.ran === true ? { ran: true as const } : {}),
        ...(row.ran === true && outcome.status === 'ok' && typeof outcome.data.run_id === 'string' ? { run_id: outcome.data.run_id } : {}),
        ...(pid === undefined ? {} : { proposal_id: pid }),
        ...(outcome.status === 'ok' && typeof outcome.data.public_label === 'string' ? { public_label: outcome.data.public_label } : {}), outcome: row.outcome, ...(row.refusal === null ? {} : { refusal: row.refusal }),
        ...(receipt !== null && typeof receipt === 'object' ? { receipts: [receipt as Record<string, unknown>] } : {}),
        ...(outcome.status === 'ok' && outcome.data.ui_directive !== null && typeof outcome.data.ui_directive === 'object'
          ? { ui_directive: outcome.data.ui_directive as Record<string, unknown>, note_basis: String(outcome.data.graph_identity) } : {}),
        ...(outcome.status === 'ok' && typeof outcome.data.offered_query === 'string' ? { offered_query: outcome.data.offered_query } : {}),
        ...(check === undefined ? {} : { check }) });
    } catch { /* a recorder never decides the outcome */ }
    return JSON.stringify(outcome);
  };

  // ⭐ THE TURN'S REPAIRS are the route's (`deps.restructure`; none without it). At the turn's end, a call it left refused, with no
  // draft or card since, runs once more with no repair left, as base would, recorded like any call (DL, #3672 fix-forward).
  const restructure = deps.restructure;
  if (restructure !== undefined) {
    let settled = false;
    restructure.settle = async () => {
      if (settled) return;
      settled = true;
      restructure.repairs = REPAIRS;
      const p = restructure.pending;
      if (p?.tool === BUILD_MODEL_FROM_BRIEF) record(BUILD_MODEL_FROM_BRIEF, p.args, await buildModel({ ...deps, review }, ctx, p.args));
      else if (p?.tool === PROPOSE_CHANGE && scenario === 'core') record(PROPOSE_CHANGE, p.args, await proposeLivingChange(deps, ctx, p.args));
    };
  }

  const read = tool({
    name: READ_CANONICAL_CONTEXT,
    description: scenario === 'program' ? PROGRAM_TOOL_DESCRIPTIONS.read_canonical_context : TOOL_DESCRIPTIONS.read_canonical_context,
    parameters: ReadCanonicalContextParams,
    execute: async (args) => record(READ_CANONICAL_CONTEXT, args, scenario === 'program' ? await readProgramContext(deps, ctx) : await readCanonicalContext(deps, ctx)),
    errorFunction: null,
  });
  if (mode === 'preview') return [read];
  if (scenario === 'program') return programTools(deps, ctx, read, record);

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
      execute: async (sent) => {
        // A press applies the card pressed, whatever id the AI sent (marketing on 05745055: it sent '', and the card was lost).
        const args = deps.pressedProposal !== undefined ? { ...sent, proposal_id: deps.pressedProposal } : sent;
        const outcome = isLivingProposal(deps.proposals.get(args.proposal_id))
          ? await applyLivingChange(deps, ctx, args.proposal_id) : await applyChange(deps, ctx, args);
        if (outcome.status === 'ok') approvalApplied = true;
        if (outcome.status !== 'ok' || !outcome.mutated || deps.analyseAfterCommit === undefined) return record(APPLY_CHANGE, args, outcome, args.proposal_id);
        const auto = await deps.analyseAfterCommit();
        const analysis = auto.awaitsTiming === true ? refused('run_awaits_timing', AWAITS_TIMING)
          : auto.run === undefined ? refused('run_not_ready', undefined, { analysis_ready: auto.ready ?? null })
          : await recordedRun(deps, ctx, auto.run);
        // The automatic Run ran (Lenses 22 Oct, 15c72e9d): this approval's call says so, as a pressed Run's does, so the turn
        // ships that Run's analysis_result (`core-turn.ts` ranThisTurn) instead of "refresh to see it".
        const ran = analysis.status === 'ok' && analysis.ran;
        return record(APPLY_CHANGE, args, { ...outcome, ...(ran ? { ran: true } : {}),
          data: { analysis, ...outcome.data, ...(ran ? { run_id: analysis.data.run_id } : {}) } }, args.proposal_id);
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

/**
 * A call whose arguments fail the tool's schema goes back to the model as that tool's own error, through the SDK's tool-error
 * path (`errorFunction`), so it corrects its call in the same turn (batch 4 marketing r3–r5: the turn ended as a 502).
 * The SDK redacts the input it hands the error function by default, so the call's arguments are kept for it here
 * (`withSentArguments`): the failing fields (paths and the schema's words, never the values) are logged and named to the model.
 * Any other failure still ends the turn, as before.
 */
const sentArguments = new AsyncLocalStorage<string>();
const withSentArguments = <T extends FunctionTool<any, any, any>>(t: T): T =>
  ({ ...t, invoke: (runContext, input, details) => sentArguments.run(input, () => t.invoke(runContext, input, details)) });
type Issue = { readonly path: readonly PropertyKey[]; readonly message: string; readonly code?: string; readonly errors?: readonly (readonly Issue[])[] };
/** Each failing field's path and the schema's words; inside an op, the branch its own `op` names (a union reports only "Invalid input"). */
const issueWords = (issues: readonly Issue[], prefix: readonly PropertyKey[] = []): string[] => issues.flatMap((i) => {
  const path = [...prefix, ...i.path];
  const branch = i.code === 'invalid_union' ? i.errors?.find((b) => b.length > 0 && !b.some((e) => e.path[0] === 'op')) : undefined;
  return branch !== undefined ? issueWords(branch, path) : [`${path.map(String).join('.') || '(root)'}: ${i.message}`];
});
const schemaErrorToModel = (name: string, schema: typeof ProgramChangeParams) => (_ctx: unknown, error: unknown): string => {
  if (!(error instanceof ModelBehaviorError) || error.name !== 'InvalidToolInputError') throw error;
  let fields: string[] = [];
  try {
    const parsed = schema.safeParse(JSON.parse(sentArguments.getStore() ?? ''));
    if (!parsed.success) fields = issueWords(parsed.error.issues);
  } catch { /* not JSON: the SDK's own parse error */ }
  log.warn({ tool: name, fields }, 'program tool: arguments that fail the schema returned to the model');
  return JSON.stringify(refused('invalid_arguments', `That ${name} call did not match its schema${fields.length > 0 ? ` (${fields.join('; ')})` : ''}. `
    + 'Nothing was proposed. Call it again with every field as its description asks.'));
};

/**
 * A PROGRAM scenario's tools (alpha): the same names and approval contract, on the canonical model
 * (`model-program-turn/program-tools.ts`). Its model exists from the first turn, so there is no build; a change carries its
 * own Run, so apply_change reports that Run instead of starting the automatic one.
 */
function programTools(deps: PathBToolDeps, ctx: PathBContext, read: Tool, record: (name: string, input: Record<string, unknown>, outcome: ToolOutcome, proposalId?: string) => string): Tool[] {
  return [
    read,
    withSentArguments(tool({
      name: PROPOSE_CHANGE,
      description: PROGRAM_TOOL_DESCRIPTIONS.propose_change,
      parameters: ProgramChangeParams,
      execute: async (args) => record(PROPOSE_CHANGE, args, await proposeProgramChange(deps, ctx, args)),
      errorFunction: schemaErrorToModel(PROPOSE_CHANGE, ProgramChangeParams),
    })),
    tool({
      name: APPLY_CHANGE,
      description: PROGRAM_TOOL_DESCRIPTIONS.apply_change,
      parameters: ApplyChangeParams,
      needsApproval: true,
      execute: async (sent) => {
        const args = deps.pressedProposal !== undefined ? { ...sent, proposal_id: deps.pressedProposal } : sent;
        const outcome = isProgramProposal(deps.proposals.get(args.proposal_id)) ? await applyProgramChange(deps, ctx, args.proposal_id) : refused('not_a_change_proposal');
        return record(APPLY_CHANGE, args, outcome, args.proposal_id);
      },
      errorFunction: null,
    }),
    tool({
      name: RUN_ANALYSIS,
      description: PROGRAM_TOOL_DESCRIPTIONS.run_analysis,
      parameters: RunAnalysisParams,
      execute: async (args) => record(RUN_ANALYSIS, args, await runProgram(deps, ctx)),
      errorFunction: null,
    }),
  ];
}
