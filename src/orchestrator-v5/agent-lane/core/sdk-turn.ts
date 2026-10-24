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
 * The model, its proposals and its Runs stay in Olumi's stores. Each turn gives today's date and the CURRENT model state
 * (`turnContextItems`) as ONE state block in the turn's own input, and the newest block supersedes every earlier one:
 * conversation history never overrides saved state (after Undo, the restored state is given). The instructions are the
 * same bytes on every call, so the provider's cache holds them (DL ruling B, 22 Oct; `stateBlockText`).
 *
 * The SDK's Responses model runs on its Conversation-bound client (`ledgeredAgentsClient`: no automatic replay), whose fetch writes each
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
import { WITHHELD_ON_CHIP_TURN, type AgentTurnResult } from '../runtime/agent-loop.js';
import type { CallBudget } from '../model-budgets.js';
import { BRIEF_LABEL, runFactsContext, turnContextItems, turnContextText } from '../turn-context.js';

/** The exact SDK release this path runs (package.json pins it). */
export const AGENTS_SDK = '@openai/agents@0.18.0';
/** Model calls one core turn may make before it stops (the SDK's `maxTurns`). */
export const CORE_MAX_MODEL_CALLS = 8;
/** Rendered tokens past which the server compacts the Conversation (native compaction; the window grows every turn). */
export const CORE_COMPACT_THRESHOLD = 100_000;
/** The tools that draft or change the living model: never offered on a reply-only turn (a press carries no consent to draft). */
const MODEL_WRITING_TOOLS: ReadonlySet<string> = new Set(['build_model_from_brief', 'propose_change']);
/** The tools the route opens a reply-only turn on: the Run, and applying a change the person approved. */
const REPLY_ENTRY_TOOLS: ReadonlySet<string> = new Set(['run_analysis', 'apply_change']);
/** A turn that reads, runs and explains only: a press, or a turn the route opens on applying a change or a Run. */
export const replyOnlyTurn = (input: Pick<CoreTurnInput, 'press' | 'firstTool'>): boolean =>
  input.press !== undefined || (input.firstTool !== undefined && REPLY_ENTRY_TOOLS.has(input.firstTool));

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

/** The provider may have accepted this Conversation call. It must not be replayed as a known-undelivered turn. */
export class CoreDeliveryUnknownError extends Error {
  readonly code = 'CORE_DELIVERY_UNKNOWN';
  readonly delivery_outcome = 'UNKNOWN';
  readonly retry_safe = false;
  constructor(cause: unknown) {
    super('The reply did not arrive. Its delivery is unknown; it was not sent again automatically.', { cause });
    this.name = 'CoreDeliveryUnknownError';
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

/** The provider's prompt-cache key for the core agent: one per model and standing-instructions text (`instructions`). */
export function corePromptCacheKey(model: string, instructions: string): string {
  return `olumi-core:${model}:${createHash('sha256').update(instructions, 'utf8').digest('hex').slice(0, 16)}`;
}

/**
 * ⭐ THE TURN'S STATE IS ONE BLOCK IN THE TURN'S INPUT, NOT IN THE INSTRUCTIONS (DL ruling B, 22 Oct). A request writes ONE
 * cache breakpoint, at its end, so a call reads the cache only when an earlier prompt is a whole prefix of it. The state in
 * the instructions came before the stored Conversation, so every turn's first call read nothing and wrote ~20k tokens
 * (served 21ad02f5, baseline). Now the full block follows the turn's new input, every turn, and is stored with it: the
 * newest block supersedes every earlier one (Codex r2 #3656: no cross-turn memory of what was sent, so no stale "unchanged").
 */
export const STATE_BLOCK_PREFIX = 'OLUMI STATE BLOCK';
export const stateBlockText = (revision: string, runId: string, body: string): string =>
  `${STATE_BLOCK_PREFIX}: model revision ${revision}, run ${runId}. It supersedes every earlier state block in this conversation.\n\n${body}`;

export interface CoreTurnInput {
  readonly ctx: AgentToolContext;
  readonly message: string;
  /**
   * The agent's STANDING instructions: the same bytes on every call of every turn for one mode, so the provider's cached
   * prefix (the tools, then these, then the stored Conversation) is reused (DL 22 Oct, the caching split). Anything that
   * varies by turn goes in the turn's input: the state block, and `turnGuidance`.
   */
  readonly instructions: string;
  /** This turn's own guidance (a Challenge's note, the drafting arm), given once, after the turn's state block. */
  readonly turnGuidance?: readonly string[];
  readonly budget: CallBudget;
  /**
   * MULTI-MODEL (Paul, 20 Oct): the fast budget for a turn that only reads, runs and explains: a press on a card or the Run
   * button, or a turn the route opens on applying an approved change or a Run. A typed message, which may draft or change
   * the model, keeps `budget` (the high-effort builder). Absent: `budget` answers every turn, as before.
   */
  readonly replyBudget?: CallBudget;
  readonly briefText?: unknown;
  /** The model state as this turn began (the route's canonical packet state), given to the agent, never stored. */
  readonly canonicalState?: unknown;
  readonly withheldTools?: readonly string[];
  /** A press that names its tool (the Run press): the run's first call must call it (`toolChoice`; the SDK resets it after). */
  readonly firstTool?: string;
  /** The scenario's turns before its Conversation existed, oldest first: a host-written reply (a program's first draft, with
   * its numbered questions) is in no Conversation otherwise, so the next turn could not map an answer to them (24 Oct). */
  readonly earlierTurns?: readonly { readonly role: 'user' | 'assistant'; readonly text: string }[];
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
  /** The turn's tools. On a press that approves a card, `press` binds the apply to that card, for every caller (Codex r1 on #3695). */
  readonly tools: (onCall: CoreToolRecorder, press?: { readonly approves: string }) => readonly Tool[];
  /** Where the turn records its calls, so a caller still has them if the turn throws (the route's turn log). */
  readonly calls?: CoreTurnCalls;
  /**
   * Run once when the SDK run has ended, before the result is built: a call Class 3's offer left refused runs as base would,
   * recorded like any call, so a refusal never makes a turn worse (DL, #3672 fix-forward; `goal-path.ts`).
   */
  readonly settle?: () => Promise<void>;
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

/**
 * The scenario's core turns still running. A Conversation cannot take a new turn while a tool call in it is unanswered:
 * a turn that outlives its stream budget keeps running and committing (`streamed-turn-sse.ts`), and a turn sent meanwhile
 * was refused by the provider ("No tool output found for function call", R1 run 20261020T220553Z). So the scenario's
 * turns run one after another, in arrival order. The route takes the slot BEFORE its first read of the model, so a turn
 * that waited starts from what the turn before it saved, never from the model as it was when it arrived.
 */
const turnsInFlight = new Map<string, Promise<void>>();

/**
 * The provider refuses any turn on a Conversation that holds a tool call with no answer. The in-process queue above cannot
 * prevent that when a turn is cut off mid-tool by a restart or a crash (served 22 Oct, after a deploy: every later turn of
 * the scenario was refused). The refusal accepts nothing, so the call is answered as interrupted and the turn is sent again.
 */
const UNANSWERED_CALL = /No tool output found for function call (call_[A-Za-z0-9_-]+)/;
export const INTERRUPTED_CALL = 'This step was interrupted before its result was recorded, so whether it saved anything is unknown. '
  + 'Read the current saved model (read_canonical_context) before saying what happened or repeating it.';

/** Waits for the scenario's earlier core turns, then holds its slot until `release`; `waited` says an earlier turn was running. */
export async function acquireCoreTurnSlot(scenarioId: string): Promise<{ readonly release: () => void; readonly waited: boolean }> {
  const prior = turnsInFlight.get(scenarioId);
  let done!: () => void;
  const mine = (prior ?? Promise.resolve()).then(() => new Promise<void>((resolve) => { done = resolve; }));
  turnsInFlight.set(scenarioId, mine);
  await prior;
  let released = false;
  return { waited: prior !== undefined, release: () => {
    if (released) return;
    released = true;
    done?.();
    if (turnsInFlight.get(scenarioId) === mine) turnsInFlight.delete(scenarioId);
  } };
}

export interface CoreTurnCalls {
  readonly tool_calls: (AgentTurnResult['tool_calls'][number] & { readonly args?: Readonly<Record<string, unknown>>;
    readonly draft_verification?: DraftVerification })[];
  readonly tool_results: ToolResult[];
}

/** One ordinary `core` turn: the agent, its tools and its memory, run by the SDK. Returns the loop's result shape. */
export async function runCoreTurn(input: CoreTurnInput): Promise<AgentTurnResult & { readonly sdk: CoreTurnSdk }> {
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  const withheld = new Set(input.withheldTools ?? []);
  const toolCalls = input.calls?.tool_calls ?? [];
  const toolResults = input.calls?.tool_results ?? [];
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
  // A reply-only turn never offers the model writers, so drafting and changes stay on typed turns. It runs on the fast budget
  // only where the caller gives one; the core route gives none (DL 22 Oct, M4), so its presses keep the typed turn's effort
  // and settings and read the typed turns' cached prefix (the served A/B: a press at "low" read 0 of 37,303 tokens).
  const replyOnly = replyOnlyTurn(input);
  const fast = input.replyBudget !== undefined && replyOnly;
  const budget = fast ? input.replyBudget! : input.budget;
  /**
   * ⭐ ONE TOOL LIST, BYTE-IDENTICAL ON EVERY CALL (DL 22 Oct, the caching split: a list that changed with the turn's kind
   * broke the provider's cached prefix on every press and the turn after it). A tool this turn withholds keeps its exact
   * definition; the provider is told which it may call (`allowed_tools`, below), and the tool refuses in execute if it is
   * called anyway: no approval, nothing written.
   */
  const blocked = (name: string): boolean => withheld.has(name) || (replyOnly && MODEL_WRITING_TOOLS.has(name));
  const allTools = input.tools(record, input.press?.decision === 'approve' ? { approves: input.press.proposal_id } : undefined);
  const allowedNames = allTools.flatMap((t) => ('name' in t && !blocked(t.name) ? [t.name] : []));
  const tools = allTools.map((t): Tool => {
    if (!('name' in t) || !blocked(t.name) || t.type !== 'function') return t;
    const name = t.name;
    return { ...t, needsApproval: async () => false, invoke: async () => {
      record({ name, ok: false, mutated: false, outcome: 'refused', refusal: WITHHELD_ON_CHIP_TURN, ran: null },
        { ok: false, mutated: false, refusal: WITHHELD_ON_CHIP_TURN });
      return JSON.stringify({ status: 'refused', reason: WITHHELD_ON_CHIP_TURN, mutated: false,
        detail: `${name} is not available on this turn. Nothing was changed or run.` });
    } };
  });
  const restrictedTo = allowedNames.length < allTools.length
    ? { type: 'allowed_tools', mode: 'auto', tools: allowedNames.map((name) => ({ type: 'function', name })) } : undefined;
  const pendingRows: Promise<void>[] = [];
  let deliveryUnknown: { readonly cause: unknown } | undefined;
  const client = ledgeredAgentsClient({ site: 'agent-core.sdk', pending: pendingRows,
    conversationBound: true, onDeliveryUnknown: (cause) => { deliveryUnknown = { cause }; },
    // A call the SDK leaves free (no forced first tool) may call only this turn's allowed tools; a forced call names its own.
    ...(restrictedTo !== undefined ? { requestBody: (body: Record<string, unknown>) => (body['tool_choice'] === undefined || body['tool_choice'] === 'auto'
      ? { ...body, tool_choice: restrictedTo } : body) } : {}),
    detailOf: (body) => ({ model: budget.model, purpose: 'conversation', ...agentRequestIdentity('agent.converse', body) }) });
  const agent = new Agent({
    name: 'Olumi',
    instructions: input.instructions,
    model: new OpenAIResponsesModel(client, budget.model),
    modelSettings: {
      maxTokens: budget.max_output_tokens,
      ...(budget.reasoning_effort !== undefined ? { reasoning: { effort: budget.reasoning_effort } } : {}),
      parallelToolCalls: false,
      ...(input.firstTool !== undefined ? { toolChoice: input.firstTool } : {}),
      // Native server-side compaction of the Conversation as it grows: no transcript trim of our own.
      contextManagement: [{ type: 'compaction', compactThreshold: CORE_COMPACT_THRESHOLD }],
      // The cached prefix (the tools, then the standing instructions) is the same for every scenario on one model and prompt:
      // one cache key for it, kept 24 h, so each scenario's first call reads it rather than writing it again.
      promptCacheRetention: '24h',
      providerData: { prompt_cache_key: corePromptCacheKey(budget.model, input.instructions) },
    },
    tools: [...tools],
  });
  // Tool time, from the SDK's own lifecycle events (the calls run one at a time: `parallelToolCalls: false`).
  let toolStartedAt: number | undefined;
  agent.on('agent_tool_start', () => { toolStartedAt = now(); });
  agent.on('agent_tool_end', () => { if (toolStartedAt !== undefined) toolMs += Math.max(0, now() - toolStartedAt); toolStartedAt = undefined; });

  /**
   * Olumi's own facts for THIS turn, as its state block: today's date, the CURRENT model state as the turn began, and the
   * Run-facts rule when a Run is in it. The user's own words are the Conversation's: on the turn that creates it, a brief
   * written apart from this message goes in first, once.
   */
  const stateContext = runFactsContext(input.canonicalState);
  const stateBody = turnContextItems({
    now: new Date(startedAt), briefText: undefined, conversation: [],
    canonicalState: stateContext.facts, runFactsUse: stateContext.use,
  }).map(turnContextText).filter((t) => t !== '').join('\n\n');
  const conversation = await scenarioConversation(input.ctx.scenario_id, input.conversationStore, () => startOpenAIConversationsSession(client));
  /**
   * After the turn's new input: the full state block, then this turn's guidance. Sent on every request until a
   * response the provider ACCEPTED carried them (Codex r1 #3656: a first request refused before anything was accepted is
   * resent, and the resend must carry the state, or the turn reasons from the Conversation's older block).
   */
  const turnItems: AgentInputItem[] = [
    { role: 'system', content: stateBlockText(input.traceMeta?.revision ?? 'none', input.traceMeta?.run_id ?? 'none', stateBody) },
    ...(input.turnGuidance ?? []).map((text): AgentInputItem => ({ role: 'system', content: text })),
  ];
  /** This request carries the turn's items; an accepted response's input carried them (the only proof they are stored). */
  let carrying = false;
  let delivered = false;
  const brief = typeof input.briefText === 'string' ? input.briefText.trim() : '';
  const earlier = (input.earlierTurns ?? []).map((t, i): AgentInputItem => (t.role === 'assistant'
    ? { role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: t.text }] }
    : { role: 'user', content: i === 0 && brief !== '' && t.text.trim() === brief ? `${BRIEF_LABEL}\n${brief}` : t.text }));
  let turnInput: string | AgentInputItem[] | RunState<unknown, Agent> = conversation.created && earlier.length > 0 ? [...earlier, { role: 'user', content: input.message }]
    : conversation.created && brief !== '' && brief !== input.message.trim()
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
    if (withheld.has(held.tool)) {
      // A turn that withholds the paused call's own tool (a Run press withholds apply_change) does not restore the paused run:
      // the SDK cannot restore a call to a tool the agent lacks (Lenses, served 0ce7ae88: every Run press while a card awaited
      // approval answered 502), and a restored run would drop the press's forced first call (Codex r1 on #3644). The paused
      // call is answered as superseded in the Conversation, as a typed message answers it, and this turn runs from its own input.
      await client.conversations.items.create(conversation.id, { items: [{ type: 'function_call_output', call_id: held.call_id, output: PAUSE_SUPERSEDED }] });
      resumed = { pause_id: held.pause_id, answer: 'superseded' };
    } else {
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
  }
  /**
   * A press on a card whose change never paused (the AI prepared it and said so), or whose pause was on another id: the run's
   * first call is that change's own apply_change (`firstTool`), and THIS press is the approval of the interruption it raises.
   * The route binds that apply to the pressed card, so the AI's argument never decides which card is applied (DL 93d79c3e).
   */
  const approvesNow = (held == null || resumed?.answer === 'superseded') && input.press?.decision === 'approve' ? input.press.proposal_id : undefined;
  let paused: CoreTurnSdk['paused'];

  let traceId = `trace_${randomUUID().replace(/-/g, '')}`;
  /** Whether the provider has accepted any request of this turn (a model event arrived). */
  let accepted = false;
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
        // The instructions go as the agent holds them, the same bytes on every call. The input is what the SDK sends, plus
        // the turn's state block and guidance until an accepted response carried them, then, once, a typed message that
        // declined a paused run.
        callModelInputFilter: ({ modelData }: { modelData: { input: AgentInputItem[]; instructions?: string } }) => {
          carrying = !delivered;
          const extra: AgentInputItem[] = [...(carrying ? turnItems : []), ...(carried === undefined ? [] : [{ role: 'user' as const, content: carried }])];
          carried = undefined;
          return { ...modelData, input: [...modelData.input, ...extra] };
        },
      };
      /**
       * Every model call consumes the SDK stream, including buffered HTTP turns and approval resumes. UI transport does
       * not choose provider transport. A stage emitter is optional; the reply, outcomes and saved state remain final JSON.
       */
      const showProgress = currentStageEmitter() !== undefined;
      const go = async (from: string | AgentInputItem[] | RunState<unknown, Agent>) => {
        const live = await run(agent, from, { ...options, stream: true });
        let writing = false;
        for await (const event of live) {
          accepted = true;
          // The provider created the response from this request's input: the turn's items are now in the Conversation.
          if (carrying && event.type === 'raw_model_stream_event' && event.data.type === 'response_started') { delivered = true; carrying = false; }
          if (!writing && event.type === 'raw_model_stream_event' && event.data.type === 'output_text_delta') {
            writing = true;
            if (showProgress) emitAgentPhase('writing');
          }
        }
        await live.completed;
        await Promise.allSettled(pendingRows);
        if (deliveryUnknown !== undefined) throw new CoreDeliveryUnknownError(deliveryUnknown.cause);
        return live;
      };
      // At most two interrupted calls are answered, each once, and only when the turn's FIRST request was refused with a 400
      // before anything was accepted (no model event, no tool run): only then is a resend sure to repeat nothing (Codex r1
      // on #3615: a matching 500, or a later hop's refusal after a tool ran, must stay the provider's answer).
      const answered = new Set<string>();
      const goAnswering = async (from: typeof turnInput) => {
        for (;;) {
          try { return await go(from); } catch (err) {
            const callId = UNANSWERED_CALL.exec(err instanceof Error ? err.message : '')?.[1];
            const refusedFirst = (err as { status?: unknown }).status === 400 && !accepted && toolCalls.length === 0;
            if (callId === undefined || !refusedFirst || answered.has(callId) || answered.size >= 2 || from instanceof RunState) throw err;
            answered.add(callId);
            await client.conversations.items.create(conversation.id, { items: [{ type: 'function_call_output', call_id: callId, output: INTERRUPTED_CALL }] });
            log.warn({ event: 'agent_core.unanswered_call_answered', scenario_id: input.ctx.scenario_id, call_id: callId },
              'agent-core: an interrupted tool call was answered before the turn');
          }
        }
      };
      let result = await goAnswering(turnInput);
      let calls = result.rawResponses.length;
      const pressed = result.interruptions.length === 1 ? result.interruptions[0] : undefined;
      if (pressed !== undefined && approvesNow !== undefined) {
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
          await input.settle?.();
          return finish(words, words.trim() === '' ? 'incomplete' : 'answered', calls, words.trim() === '' ? 'host' : 'ai');
        }
        // The pause cannot be kept, so the Conversation gets its answer now: nothing applied, said by the AI.
        for (const item of result.interruptions) result.state.reject(item, { message: PAUSE_NOT_KEPT });
        result = await go(result.state);
        calls += result.rawResponses.length;
      }
      const text = typeof result.finalOutput === 'string' ? result.finalOutput : '';
      await input.settle?.();
      return finish(text, text.trim() === '' ? 'incomplete' : 'answered', calls, text.trim() === '' ? 'host' : 'ai');
    }, { groupId: input.ctx.scenario_id, metadata: {
      // The SDK's own trace (tool spans are native) carries what this turn ran on: prompt, model, state, revision and Run.
      request_id: String(input.ctx.request_id ?? ''), turn_id: String(input.ctx.turn_id ?? ''),
      prompt_sha256: createHash('sha256').update(input.instructions, 'utf8').digest('hex'), model: budget.model,
      conversation_id: conversation.id, revision: input.traceMeta?.revision ?? '', run_id: input.traceMeta?.run_id ?? '',
    } });
  } catch (err) {
    // The stream's copy records transport loss asynchronously; settle it before classifying the SDK's error.
    await Promise.allSettled(pendingRows);
    // ⭐ Whatever ended the run, a call Class 3's offer left refused is settled as base would have it (Codex r1 on #3675: a
    // provider error after the refusal left nothing saved, where base had saved the draft). The turn's own error is reported.
    await input.settle?.().catch(() => undefined);
    if (err instanceof MaxTurnsExceededError && deliveryUnknown === undefined) return finish('', 'hop_limit', CORE_MAX_MODEL_CALLS, 'host');
    // The capability's own error, unwrapped, so the route's existing handlers see the same error the loop would raise.
    if (err instanceof ToolCallError && err.error !== undefined) throw err.error;
    log.warn({ event: 'agent_core.turn_failed', scenario_id: input.ctx.scenario_id, request_id: input.ctx.request_id, err: String(err).slice(0, 300) },
      'agent-core: the SDK run did not finish');
    if (deliveryUnknown !== undefined) throw err instanceof CoreDeliveryUnknownError ? err : new CoreDeliveryUnknownError(err);
    throw err;
  } finally {
    // A streamed attempt's ledger row is written when its stream ends: complete before anyone reads `_provider_calls`.
    await Promise.allSettled(pendingRows);
  }
}
