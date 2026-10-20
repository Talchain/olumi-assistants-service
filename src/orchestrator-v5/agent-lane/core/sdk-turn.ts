/**
 * ⭐ PATH-B: AN ORDINARY `core` TURN RUNS ON THE OPENAI AGENTS SDK (Paul 19 Oct 13:44Z: "If there's anything we can utilise
 * that OpenAI provides out of the box, we should ensure that that is our starting solution"; DL-3 fit decision 13:5xZ).
 *
 * The SDK owns the tool loop (`run`) and the trace (its built-in tracing, one trace per turn, grouped by scenario). The
 * conversation lives in ONE durable OpenAI Conversation per scenario (Paul via AIE 14:10Z): created on the first `core` turn,
 * its id saved on the scenario (`scenarios.openai_conversation_id`) and reused on reopen. Each turn sends only the new user
 * input and that turn's tool outcomes (the SDK's `conversationId`), and the server compacts the window as it grows. ONE agent
 * owns the reply, on the existing role models (`model-budgets.ts`). Its tools are the typed adapters (`path-b/tools`
 * `pathBTools`): the canonical read, the draft, propose/apply (apply needs the person's approval: the SDK pauses and the
 * press resumes the same saved RunState) and the Run, each over the product's own protocol-safe primitives, each returning
 * ONE typed outcome that it records once (`onCall`).
 *
 * The Conversation holds only the conversation. The model, its proposals and its Runs stay in Olumi's stores. Every model
 * call is given today's date and the CURRENT model state afresh (`turnContextItems`), in its instructions, which the
 * Conversation never stores: conversation history never overrides saved state (after Undo, the restored state is given).
 *
 * The SDK's Responses model runs on the SDK's own client (`ledgeredAgentsClient`: native retries), whose fetch writes each
 * attempt to this request's `_provider_calls` with the returned model, the tool names sent and a digest of the input sent.
 *
 * Consent is the SDK's: `apply_change` needs approval, so the AI can never approve its own change; only the person's
 * press resumes it. No consent orchestration of our own.
 *
 * No local session, no previous_response_id and no transcript of our own: the Conversation is the one state strategy. A store
 * that cannot hold the id stops the turn (`CoreStateUnavailableError`): never a Conversation the next turn could not find.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  Agent, extractAllTextOutput, MaxTurnsExceededError, OpenAIResponsesModel, run, RunState, setTracingDisabled,
  startOpenAIConversationsSession, ToolCallError, withTrace, type AgentInputItem, type RunToolApprovalItem, type Tool,
} from '@openai/agents';
import { getRuntimeEnv } from '../../../config/env-resolver.js';
import { ledgeredAgentsClient } from '../../../adapters/llm/openai-agents-client.js';
import { currentStageEmitter, emitAgentPhase } from '../../../cee/unified-pipeline/stage-stream-context.js';
import { log } from '../../../utils/telemetry.js';
import type { OpenAiPausedRun } from '../../session/store.js';
import type { DraftVerification } from '../../path-b/tools/outcome.js';
import { agentRequestIdentity } from '../runtime/prompt-identity.js';
import type { AgentToolContext, ToolResult } from '../runtime/agent-tools.js';
import type { AgentTurnResult } from '../runtime/agent-loop.js';
import type { CallBudget } from '../model-budgets.js';
import { BRIEF_LABEL, runFactsContext, turnContextItems, turnContextText } from '../turn-context.js';

/** The exact SDK release this path runs (package.json pins it). */
export const AGENTS_SDK = '@openai/agents@0.18.0';
/** Model calls one core turn may make before it stops (the SDK's `maxTurns`). */
export const CORE_MAX_MODEL_CALLS = 8;
/** Rendered tokens past which the server compacts the Conversation (native compaction; the window grows every turn). */
export const CORE_COMPACT_THRESHOLD = 100_000;
/** The tools that draft or change the model: only the builder holds them when the turn has a reply agent. */
export const MODEL_WRITING_TOOLS: ReadonlySet<string> = new Set(['build_model_from_brief', 'propose_change']);
export const CORE_BUILDER_NAME = 'Olumi model builder';
/** The reply agent's one extra rule: what it hands on (the SDK names the handoff tool after the builder). */
export const CORE_HANDOFF_RULE =
  'You answer this turn yourself unless the model must be drafted or changed. When the person gives a brief to draft, or '
  + 'anything that would change what the model holds (a correction, a new or edited option, factor, link, figure, goal or '
  + 'condition), hand the turn to the model builder straight away, without answering first.';

// Tests never export traces; a deployed runtime uses the SDK's built-in exporter, which reads the lane's OPENAI_API_KEY.
if (getRuntimeEnv() === 'test') setTracingDisabled(true);

/**
 * The turn cannot keep its conversation state durable, so it stops before any model call: the scenario's store cannot
 * hold the id (the column is not there yet), or the id could not be saved. A Conversation the next turn could not find
 * would silently start the reasoning over; this says so instead. Nothing was written, so a retry is safe.
 */
export class CoreStateUnavailableError extends Error {
  readonly code = 'CORE_STATE_UNAVAILABLE';
  constructor(readonly reason: 'store_cannot_hold_id' | 'id_not_saved' | 'store_unreadable' | 'pause_not_resumable', cause?: unknown) {
    super(`core conversation state unavailable: ${reason}`, cause === undefined ? undefined : { cause });
    this.name = 'CoreStateUnavailableError';
  }
}

/** Where a scenario's Conversation id is saved. `undefined` from either call = this store cannot hold it. */
export interface ConversationIdStore {
  read(scenarioId: string): Promise<string | null | undefined>;
  /** Save `id` only if the scenario has none (one conditional write); returns the scenario's id after it (a race's winner). */
  claim(scenarioId: string, id: string): Promise<string | null | undefined>;
}

/**
 * Where the scenario's ONE run paused for the person's approval is kept (`scenarios.openai_paused_run`). A tool with
 * `needsApproval` pauses the SDK run; its `RunState` is saved here, and the press that answers the card resumes that same
 * state. `take` is one conditional write, so a duplicate press finds nothing to resume and nothing is applied twice.
 */
export interface PausedRunStore {
  read(scenarioId: string): Promise<OpenAiPausedRun | null | undefined>;
  save(scenarioId: string, run: OpenAiPausedRun): Promise<boolean | undefined>;
  take(scenarioId: string, pauseId: string): Promise<boolean | undefined>;
}

/** What the model is told when the person declines the paused change on its card. */
export const PAUSE_DECLINED = 'Not applied: the person declined this change on its card. Nothing was changed.';
/** What the model is told when the person writes instead of answering the card; their new message follows it. */
export const PAUSE_SUPERSEDED = 'Not applied: the person has not approved this change; they wrote a new message instead, which follows. Nothing was changed.';
/** What the model is told when the pause itself could not be kept; it ends this turn's run with nothing applied. */
export const PAUSE_NOT_KEPT = 'Not applied: Olumi could not hold this change for the person\'s approval. Nothing was changed; say so, and that they can ask again.';

/**
 * The scenario's ONE Conversation, read from the store on every turn (no process copy): the saved one, else a new one
 * whose id is saved atomically before the turn uses it. A store that cannot hold the id stops the turn (no fallback).
 */
async function scenarioConversation(scenarioId: string, store: ConversationIdStore | undefined,
  create: () => Promise<string>): Promise<{ readonly id: string; readonly created: boolean }> {
  if (store === undefined) throw new CoreStateUnavailableError('store_cannot_hold_id');
  let saved: string | null | undefined;
  try { saved = await store.read(scenarioId); } catch (err) { throw new CoreStateUnavailableError('store_unreadable', err); }
  if (saved === undefined) throw new CoreStateUnavailableError('store_cannot_hold_id');
  if (typeof saved === 'string' && saved !== '') return { id: saved, created: false };
  const created = await create();
  let winner: string | null | undefined;
  try { winner = await store.claim(scenarioId, created); } catch (err) { throw new CoreStateUnavailableError('id_not_saved', err); }
  if (typeof winner !== 'string' || winner === '') throw new CoreStateUnavailableError('id_not_saved');
  // A concurrent first turn saved its own Conversation first: continue that one (ours is left unused).
  return { id: winner, created: winner === created };
}

const callIdOf = (item: RunToolApprovalItem): string | undefined => {
  const id = (item.rawItem as { callId?: unknown }).callId;
  return typeof id === 'string' ? id : undefined;
};
const argsOf = (item: RunToolApprovalItem): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(item.arguments ?? '{}');
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
};


/** A typed adapter's record of one call: its kit row (`traceRow`) and its result, as the route reads results. */
export type CoreToolRecorder = (
  row: { readonly name: string; readonly ok: boolean; readonly mutated: boolean | null; readonly outcome: string;
    readonly refusal: string | null; readonly ran: true | null; readonly args?: Readonly<Record<string, unknown>>;
    readonly draft_verification?: DraftVerification },
  result: ToolResult,
) => void;

export interface CoreTurnInput {
  readonly ctx: AgentToolContext;
  readonly message: string;
  readonly instructions: string;
  readonly budget: CallBudget;
  /**
   * MULTI-MODEL (Paul, 20 Oct): when given, a fast agent on this budget answers the turn, and hands the turn (the SDK's own
   * handoff: the whole Conversation goes with it) to the `budget` agent whenever the model must be drafted or changed.
   * Absent: the `budget` agent answers every turn, as before.
   */
  readonly replyBudget?: CallBudget;
  readonly briefText?: unknown;
  /** The model state as this turn began (the route's canonical packet state), given to the agent, never stored. */
  readonly canonicalState?: unknown;
  readonly withheldTools?: readonly string[];
  /** A press that names its tool (the Run press): the run's first call must call it (`toolChoice`; the SDK resets it after). */
  readonly firstTool?: string;
  readonly userId: string | null;
  /** Where the scenario's Conversation id is saved (the session store); absent → the turn stops (CoreStateUnavailableError). */
  readonly conversationStore?: ConversationIdStore;
  /** Where a run paused for approval is kept; absent → a tool that needs approval ends the run with nothing applied. */
  readonly pausedRunStore?: PausedRunStore;
  /** The person's press on the card of the paused run's proposal. Absent = a typed turn (any paused run is declined first). */
  readonly press?: { readonly decision: 'approve' | 'decline'; readonly proposal_id: string };
  /**
   * The agent's tools: the typed adapters (`path-b/tools` `pathBTools`), given the recorder each tool calls once with its
   * kit row and result.
   */
  readonly tools: (onCall: CoreToolRecorder) => readonly Tool[];
  /** The model revision and selected Run this turn began on, carried on the SDK trace with the prompt, model and Conversation. */
  readonly traceMeta?: { readonly revision?: string; readonly run_id?: string };
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

/** What the route adds to `_agent` for a core turn: the runtime, its trace and its Conversation (the witness reads all three). */
export interface CoreTurnSdk {
  readonly runtime: string;
  readonly trace_id: string;
  readonly state: 'openai_conversation';
  readonly conversation_id: string;
  /** This turn created the Conversation (the scenario's first `core` turn, or the first since its id was lost). */
  readonly conversation_created: boolean;
  readonly compact_threshold: number;
  /** This turn's run paused for the person's approval on this proposal's card (its state saved on the scenario). */
  readonly paused?: { readonly pause_id: string; readonly proposal_id: string | null; readonly tool: string };
  /** This turn resumed the scenario's paused run, with the person's answer. */
  readonly resumed?: { readonly pause_id: string; readonly answer: 'approved' | 'declined' | 'superseded' };
}

/** One ordinary `core` turn: the agent, its tools and its memory, run by the SDK. Returns the loop's result shape. */
export async function runCoreTurn(input: CoreTurnInput): Promise<AgentTurnResult & { readonly sdk: CoreTurnSdk }> {
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  const withheld = new Set(input.withheldTools ?? []);
  const toolCalls: (AgentTurnResult['tool_calls'][number] & { readonly args?: Readonly<Record<string, unknown>>;
    readonly draft_verification?: DraftVerification })[] = [];
  const toolResults: ToolResult[] = [];
  let toolMs = 0;

  // A typed adapter's row goes on the wire as the kit reads it; an unknown write (`mutated: null`) is never a claimed one.
  const record: CoreToolRecorder = (row, result) => {
    toolCalls.push({ name: row.name, args: row.args, ok: row.ok, mutated: row.mutated === true, outcome: row.outcome,
      ...(row.draft_verification === undefined ? {} : { draft_verification: row.draft_verification }),
      ...(row.refusal !== null ? { refusal: row.refusal } : {}), ...(row.ran === true ? { ran: true as const } : {}),
      ...(typeof result['proposal_id'] === 'string' ? { proposal_id: result['proposal_id'] } : {}) });
    toolResults.push(result);
  };
  // The typed adapters (`path-b/tools`), less any the route withholds on this turn. Approval is theirs to require
  // (`needsApproval`) and the SDK's to pause on: no consent orchestration of our own.
  const tools = input.tools(record).filter((t) => !('name' in t) || !withheld.has(t.name));
  const pendingRows: Promise<void>[] = [];
  const client = ledgeredAgentsClient({ site: 'agent-core.sdk', pending: pendingRows,
    detailOf: (body) => ({ model: typeof body?.model === 'string' ? body.model : input.budget.model, purpose: 'conversation',
      ...agentRequestIdentity('agent.converse', body) }) });
  const settings = (budget: CallBudget, firstTool: string | undefined) => ({
    maxTokens: budget.max_output_tokens,
    ...(budget.reasoning_effort !== undefined ? { reasoning: { effort: budget.reasoning_effort } } : {}),
    parallelToolCalls: false,
    ...(firstTool !== undefined ? { toolChoice: firstTool } : {}),
    // Native server-side compaction of the Conversation as it grows: no transcript trim of our own.
    contextManagement: [{ type: 'compaction' as const, compactThreshold: CORE_COMPACT_THRESHOLD }],
  });
  const reply = input.replyBudget;
  // A turn the route opens on a model-writing tool goes straight to the builder; any other starts with the reply agent.
  const startsWithBuilder = reply === undefined || (input.firstTool !== undefined && MODEL_WRITING_TOOLS.has(input.firstTool));
  const builder = new Agent({
    name: reply === undefined ? 'Olumi' : CORE_BUILDER_NAME,
    handoffDescription: 'Drafts or changes the model: a brief to draft, or any correction or new item, figure, link, goal or condition.',
    instructions: input.instructions,
    model: new OpenAIResponsesModel(client, input.budget.model),
    modelSettings: settings(input.budget, startsWithBuilder ? input.firstTool : undefined),
    tools: [...tools],
  });
  const front = reply === undefined ? undefined : new Agent({
    name: 'Olumi',
    instructions: `${input.instructions}\n\n${CORE_HANDOFF_RULE}`,
    model: new OpenAIResponsesModel(client, reply.model),
    modelSettings: settings(reply, startsWithBuilder ? undefined : input.firstTool),
    tools: tools.filter((t) => !('name' in t) || !MODEL_WRITING_TOOLS.has(t.name)),
    handoffs: [builder],
  });
  // The root of the agent graph (a saved pause is restored from it, whichever agent held it); the turn's first agent.
  const agent = front ?? builder;
  const entry = startsWithBuilder ? builder : agent;
  // Tool time, from the SDK's own lifecycle events (the calls run one at a time: `parallelToolCalls: false`).
  let toolStartedAt: number | undefined;
  for (const a of front === undefined ? [builder] : [front, builder]) {
    a.on('agent_tool_start', () => { toolStartedAt = now(); });
    a.on('agent_tool_end', () => { if (toolStartedAt !== undefined) toolMs += Math.max(0, now() - toolStartedAt); toolStartedAt = undefined; });
  }

  /**
   * Olumi's own facts for THIS turn, given fresh on every model call in its instructions (never stored in the Conversation):
   * today's date, the CURRENT model state as the turn began, and the Run-facts rule when a Run is in it. The user's own
   * words are the Conversation's: on the turn that creates it, a brief written apart from this message goes in first, once.
   */
  const stateContext = runFactsContext(input.canonicalState);
  const turnFacts = turnContextItems({
    now: new Date(startedAt), briefText: undefined, conversation: [],
    canonicalState: stateContext.facts, runFactsUse: stateContext.use,
  }).map(turnContextText).filter((t) => t !== '');
  const conversation = await scenarioConversation(input.ctx.scenario_id, input.conversationStore, () => startOpenAIConversationsSession(client));
  const brief = typeof input.briefText === 'string' ? input.briefText.trim() : '';
  let turnInput: string | AgentInputItem[] | RunState<unknown, Agent> = conversation.created && brief !== '' && brief !== input.message.trim()
    ? [{ role: 'user', content: `${BRIEF_LABEL}\n${brief}` }, { role: 'user', content: input.message }] : input.message;

  /**
   * A run paused for approval is answered before anything else, from its own saved state (the Conversation holds its tool
   * call and needs its answer first): a press on its card approves or declines it; a typed message declines it, and the
   * message goes to the model right after that answer, so the turn still has ONE reply.
   */
  let carried: string | undefined;
  let resumed: CoreTurnSdk['resumed'];
  const held = await input.pausedRunStore?.read(input.ctx.scenario_id);
  if (held != null) {
    if ((await input.pausedRunStore!.take(input.ctx.scenario_id, held.pause_id)) !== true) {
      throw new CoreStateUnavailableError('pause_not_resumable');
    }
    const state = await RunState.fromString(agent, held.state);
    const item = state.getInterruptions().find((i) => callIdOf(i) === held.call_id);
    if (item === undefined) throw new CoreStateUnavailableError('pause_not_resumable');
    const onCard = input.press !== undefined && input.press.proposal_id === held.proposal_id;
    const answer = onCard ? (input.press!.decision === 'approve' ? 'approved' : 'declined') : 'superseded';
    if (answer === 'approved') state.approve(item);
    else state.reject(item, { message: answer === 'declined' ? PAUSE_DECLINED : PAUSE_SUPERSEDED });
    if (answer === 'superseded') carried = input.message;
    turnInput = state;
    resumed = { pause_id: held.pause_id, answer };
  }
  /**
   * A press on a card whose change never paused (the AI prepared it and said so): the run's first call is that change's own
   * apply_change (`firstTool`), and THIS press is the approval of the interruption it raises, for that proposal only.
   */
  const approvesNow = held == null && input.press?.decision === 'approve' ? input.press.proposal_id : undefined;
  let paused: CoreTurnSdk['paused'];

  let traceId = `trace_${randomUUID().replace(/-/g, '')}`;
  const finish = (text: string, stopped: AgentTurnResult['stopped_reason'], calls: number, author: 'ai' | 'host'): AgentTurnResult & { sdk: CoreTurnSdk } => {
    const total = Math.max(0, now() - startedAt);
    return {
      assistant_text: text, items: [], tool_calls: toolCalls, tool_results: toolResults,
      mutated: toolResults.some((r) => r.mutated === true), hops: calls, stopped_reason: stopped, reply_author: author,
      timing: { total_ms: total, provider_ms: Math.max(0, total - toolMs), tool_ms: toolMs, tool_provider_ms: 0, overhead_ms: 0,
        provider_calls: calls, tool_calls: toolCalls.length, hops: calls },
      sdk: { runtime: AGENTS_SDK, trace_id: traceId, state: 'openai_conversation', conversation_id: conversation.id,
        conversation_created: conversation.created, compact_threshold: CORE_COMPACT_THRESHOLD,
        ...(paused !== undefined ? { paused } : {}), ...(resumed !== undefined ? { resumed } : {}) },
    };
  };
  try {
    return await withTrace('Olumi core turn', async (trace) => {
      traceId = trace.traceId;
      const options = {
        conversationId: conversation.id,
        maxTurns: CORE_MAX_MODEL_CALLS,
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
        // This turn's facts ride the instructions of every call. The input is what the SDK sends, plus, once, a typed
        // message that declined a paused run (it follows that run's answer).
        callModelInputFilter: ({ modelData }: { modelData: { input: AgentInputItem[]; instructions?: string } }) => {
          const extra: AgentInputItem[] = carried === undefined ? [] : [{ role: 'user', content: carried }];
          carried = undefined;
          return { ...modelData, input: [...modelData.input, ...extra],
            instructions: [modelData.instructions ?? '', ...turnFacts].filter((t) => t !== '').join('\n\n') };
        },
      };
      /**
       * On the streamed entry (`/proxy/v5/turn/stream` installs a stage emitter) the SDK streams: the person sees "writing"
       * only once the AI's first words arrive. The buffered entry runs the same turn unstreamed. Either way the reply,
       * the tool outcomes and the saved state are the final JSON's.
       */
      const streamed = currentStageEmitter() !== undefined;
      const go = async (from: string | AgentInputItem[] | RunState<unknown, Agent>) => {
        if (!streamed) return run(entry, from, options);
        const live = await run(entry, from, { ...options, stream: true });
        let writing = false;
        for await (const event of live) {
          if (!writing && event.type === 'raw_model_stream_event' && event.data.type === 'output_text_delta') {
            writing = true;
            emitAgentPhase('writing');
          }
        }
        await live.completed;
        return live;
      };
      let result = await go(turnInput);
      let calls = result.rawResponses.length;
      const pressed = result.interruptions.length === 1 ? result.interruptions[0] : undefined;
      if (pressed !== undefined && approvesNow !== undefined && argsOf(pressed)['proposal_id'] === approvesNow) {
        result.state.approve(pressed);
        resumed = { pause_id: callIdOf(pressed) ?? '', answer: 'approved' };
        result = await go(result.state);
        calls += result.rawResponses.length;
      }
      const pause = result.interruptions[0];
      if (pause !== undefined) {
        const args = argsOf(pause);
        const run0: OpenAiPausedRun = { pause_id: randomUUID(), proposal_id: typeof args['proposal_id'] === 'string' ? args['proposal_id'] : null,
          call_id: callIdOf(pause) ?? '', tool: pause.name ?? '', state: result.state.toString() };
        const kept = await input.pausedRunStore?.save(input.ctx.scenario_id, run0).catch(() => undefined);
        if (kept === true) {
          paused = { pause_id: run0.pause_id, proposal_id: run0.proposal_id, tool: run0.tool };
          toolCalls.push({ name: run0.tool, ok: true, mutated: false, outcome: 'awaiting_approval',
            ...(run0.proposal_id !== null ? { proposal_id: run0.proposal_id } : {}) });
          toolResults.push({ ok: true, mutated: false, outcome: 'awaiting_approval', ...(run0.proposal_id !== null ? { proposal_id: run0.proposal_id } : {}) });
          // The AI's own words this turn, written with the call it paused on (the card shows the change).
          const words = extractAllTextOutput(result.newItems);
          return finish(words, words.trim() === '' ? 'incomplete' : 'answered', calls, words.trim() === '' ? 'host' : 'ai');
        }
        // The pause cannot be kept, so the Conversation gets its answer now: nothing applied, said by the AI.
        for (const item of result.interruptions) result.state.reject(item, { message: PAUSE_NOT_KEPT });
        result = await go(result.state);
        calls += result.rawResponses.length;
      }
      const text = typeof result.finalOutput === 'string' ? result.finalOutput : '';
      return finish(text, text.trim() === '' ? 'incomplete' : 'answered', calls, text.trim() === '' ? 'host' : 'ai');
    }, { groupId: input.ctx.scenario_id, metadata: {
      // The SDK's own trace (tool spans are native) carries what this turn ran on: prompt, model, state, revision and Run.
      request_id: String(input.ctx.request_id ?? ''), turn_id: String(input.ctx.turn_id ?? ''),
      prompt_sha256: createHash('sha256').update(input.instructions, 'utf8').digest('hex'), model: input.budget.model,
      conversation_id: conversation.id, revision: input.traceMeta?.revision ?? '', run_id: input.traceMeta?.run_id ?? '',
    } });
  } catch (err) {
    if (err instanceof MaxTurnsExceededError) return finish('', 'hop_limit', CORE_MAX_MODEL_CALLS, 'host');
    // The capability's own error, unwrapped, so the route's existing handlers see the same error the loop would raise.
    if (err instanceof ToolCallError && err.error !== undefined) throw err.error;
    log.warn({ event: 'agent_core.turn_failed', scenario_id: input.ctx.scenario_id, request_id: input.ctx.request_id, err: String(err).slice(0, 300) },
      'agent-core: the SDK run did not finish');
    throw err;
  } finally {
    // A streamed attempt's ledger row is written when its stream ends: complete before anyone reads `_provider_calls`.
    await Promise.allSettled(pendingRows);
  }
}
