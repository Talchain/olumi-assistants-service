/**
 * ⭐ PATH-B: AN ORDINARY `core` TURN RUNS ON THE OPENAI AGENTS SDK (Paul 19 Oct 13:44Z: "If there's anything we can utilise
 * that OpenAI provides out of the box, we should ensure that that is our starting solution"; DL-3 fit decision 13:5xZ).
 *
 * The SDK owns the tool loop (`run`) and the trace (its built-in tracing, one trace per turn, grouped by scenario). The
 * conversation lives in ONE durable OpenAI Conversation per scenario (Paul via AIE 14:10Z): created on the first `core` turn,
 * its id saved on the scenario (`scenarios.openai_conversation_id`) and reused on reopen. Each turn sends only the new user
 * input and that turn's tool outcomes (the SDK's `conversationId`), and the server compacts the window as it grows. ONE agent owns the reply, on the existing
 * role models (`model-budgets.ts`). Olumi's existing capabilities are its tools: `toolsFor(mode)` declares them with their
 * existing JSON schemas, and `dispatchTool` runs them, so construction (drafter → registration), proposals, approval with
 * digest, CAS and readback, the Run (PLoT/ISL) and the canonical read are the same code the product uses. Each tool's typed
 * result goes back to the model as its own licensed view (`modelFacingToolResult`): real outcomes, and refusals as refusals.
 *
 * The Conversation holds only the conversation. The model, its proposals and its Runs stay in Olumi's stores. Every model
 * call is given today's date and the CURRENT model state afresh (`turnContextItems`), in its instructions, which the
 * Conversation never stores: conversation history never overrides saved state (after Undo, the restored state is given).
 *
 * The SDK's Responses model runs on the SDK's own client (`ledgeredAgentsClient`: native retries), whose fetch writes each
 * attempt to this request's `_provider_calls` with the returned model, the tool names sent and a digest of the input sent.
 *
 * Retained bridge, for a requirement the SDK does not meet on its own:
 *   CONSENT. Three protocol checks on a tool call, as the existing loop makes them: a change proposed this turn is never
 *      approved by the AI in the same turn; one approval carries one change; only this turn's own card may be withdrawn.
 *
 * No local session, no previous_response_id and no transcript of our own: the Conversation is the one state strategy. A store
 * that cannot hold the id stops the turn (`CoreStateUnavailableError`): never a Conversation the next turn could not find.
 */
import { randomUUID } from 'node:crypto';
import {
  Agent, MaxTurnsExceededError, OpenAIResponsesModel, run, setTracingDisabled, startOpenAIConversationsSession, tool, ToolCallError,
  withTrace, type AgentInputItem,
} from '@openai/agents';
import { getRuntimeEnv } from '../../../config/env-resolver.js';
import { ledgeredAgentsClient } from '../../../adapters/llm/openai-agents-client.js';
import { log } from '../../../utils/telemetry.js';
import { agentRequestIdentity } from '../runtime/prompt-identity.js';
import { dispatchTool, toolsFor, type AgentCapabilities, type AgentLaneMode, type AgentToolContext, type ToolResult } from '../runtime/agent-tools.js';
import type { AgentTurnResult } from '../runtime/agent-loop.js';
import type { CallBudget } from '../model-budgets.js';
import { BRIEF_LABEL, runFactsContext, turnContextItems, turnContextText } from '../turn-context.js';
import { modelFacingToolResult } from '../licensed-run-view.js';
import {
  earlierTurnWithdrawal, isProposingTool, NOT_ON_NARRATION, NOT_PROPOSED_THIS_TURN, ONE_CHANGE_PER_APPROVAL,
  ONE_CHANGE_PER_APPROVAL_DETAIL, WITHDRAW_PROPOSAL,
} from '../approval-chips.js';

/** The exact SDK release this path runs (package.json pins it). */
export const AGENTS_SDK = '@openai/agents@0.18.0';
/** Model calls one core turn may make before it stops (the SDK's `maxTurns`). */
export const CORE_MAX_MODEL_CALLS = 8;
/** Rendered tokens past which the server compacts the Conversation (native compaction; the window grows every turn). */
export const CORE_COMPACT_THRESHOLD = 100_000;
const LIMIT_CHANGE_TOOL = 'propose_limit_change';
const AUTHORISE_CHANGE = 'authorise_change';

// Tests never export traces; a deployed runtime uses the SDK's built-in exporter, which reads the lane's OPENAI_API_KEY.
if (getRuntimeEnv() === 'test') setTracingDisabled(true);

/**
 * The turn cannot keep its conversation state durable, so it stops before any model call: the scenario's store cannot
 * hold the id (the column is not there yet), or the id could not be saved. A Conversation the next turn could not find
 * would silently start the reasoning over; this says so instead. Nothing was written, so a retry is safe.
 */
export class CoreStateUnavailableError extends Error {
  readonly code = 'CORE_STATE_UNAVAILABLE';
  constructor(readonly reason: 'store_cannot_hold_id' | 'id_not_saved' | 'store_unreadable', cause?: unknown) {
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

/**
 * The JSON schema object a function tool declares, sent as the existing loop sends it: NOT strict (the SDK's
 * `JsonObjectSchemaNonStrict`). Several existing schemas use `oneOf`, which strict mode cannot express.
 */
type ToolParameters = { type: 'object'; properties: Record<string, never>; required: never[]; additionalProperties: true };

export interface CoreTurnInput {
  readonly ctx: AgentToolContext;
  readonly caps: AgentCapabilities;
  readonly mode: AgentLaneMode;
  readonly message: string;
  readonly instructions: string;
  readonly budget: CallBudget;
  readonly briefText?: unknown;
  /** The model state as this turn began (the route's canonical packet state), given to the agent, never stored. */
  readonly canonicalState?: unknown;
  readonly withheldTools?: readonly string[];
  readonly userId: string | null;
  /** Where the scenario's Conversation id is saved (the session store); absent → the turn stops (CoreStateUnavailableError). */
  readonly conversationStore?: ConversationIdStore;
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
}

/** One ordinary `core` turn: the agent, its tools and its memory, run by the SDK. Returns the loop's result shape. */
export async function runCoreTurn(input: CoreTurnInput): Promise<AgentTurnResult & { readonly sdk: CoreTurnSdk }> {
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  const withheld = new Set(input.withheldTools ?? []);
  const toolCalls: { name: string; ok: boolean; mutated: boolean; proposal_id?: string; outcome?: string; refusal?: string }[] = [];
  const toolResults: ToolResult[] = [];
  let toolMs = 0;
  /** Proposals this turn made that still wait for the user's yes, by id → tool. */
  const awaiting = new Map<string, string>();

  // Bridge 2: the consent checks the existing loop makes before a tool runs.
  const consentRefusal = (name: string, args: Record<string, unknown>): ToolResult | null => {
    const id = typeof args['proposal_id'] === 'string' ? args['proposal_id'] : '';
    if (name === AUTHORISE_CHANGE && awaiting.has(id)) {
      return { ok: false, mutated: false, refusal: NOT_ON_NARRATION,
        detail: 'The change you just prepared is waiting for the user’s yes. Show it and ask; nothing was approved or changed.' };
    }
    if (isProposingTool(name) && [...awaiting.values()].some((t) => t !== LIMIT_CHANGE_TOOL && name !== LIMIT_CHANGE_TOOL)) {
      return { ok: false, mutated: false, refusal: ONE_CHANGE_PER_APPROVAL, detail: ONE_CHANGE_PER_APPROVAL_DETAIL };
    }
    if (withheld.has(name)) {
      return { ok: false, mutated: false, refusal: 'withheld_on_chip_turn', detail: 'Not offered on this turn. Nothing was changed.' };
    }
    return null;
  };
  const call = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const t0 = now();
    const id = typeof args['proposal_id'] === 'string' ? args['proposal_id'] : '';
    const result: ToolResult = consentRefusal(name, args)
      ?? (name === WITHDRAW_PROPOSAL && !awaiting.has(id) && !id.startsWith('goal-scope:')
        ? await (async (): Promise<ToolResult> => {
            const own = /^prop_[0-9a-f]{32}$/.test(id) && input.caps.withdrawProposal !== undefined
              ? await input.caps.withdrawProposal(input.ctx, earlierTurnWithdrawal(id)) : undefined;
            return own?.ok === true ? own : { ok: false, mutated: false, refusal: NOT_PROPOSED_THIS_TURN,
              detail: 'Nothing was withdrawn. This card is not eligible for withdrawal by Olumi; it remains unchanged.' };
          })()
        : await dispatchTool(name, JSON.stringify(args), input.ctx, input.caps, input.mode));
    toolMs += Math.max(0, now() - t0);
    if (typeof result.proposal_id === 'string' && result.ok === true && isProposingTool(name)) awaiting.set(result.proposal_id, name);
    if (name === WITHDRAW_PROPOSAL && result.ok === true) awaiting.delete(id);
    toolCalls.push({
      name, ok: result.ok, mutated: result.mutated,
      ...(typeof result.proposal_id === 'string' ? { proposal_id: result.proposal_id } : {}),
      ...(typeof result.outcome === 'string' ? { outcome: result.outcome } : {}),
      ...(typeof result.refusal === 'string' ? { refusal: result.refusal } : {}),
    });
    toolResults.push(result);
    // The model reads the LICENSED view of a Run (no unlicensed leader); the route keeps the raw result.
    return JSON.stringify(runFactsContext(modelFacingToolResult(name, result)).facts);
  };

  const tools = toolsFor(input.mode).filter((def) => !withheld.has(def.name)).map((def) => tool({
    name: def.name,
    description: def.description,
    parameters: def.parameters as ToolParameters,
    strict: false,
    execute: async (args: unknown) => call(def.name, (args !== null && typeof args === 'object' ? args : {}) as Record<string, unknown>),
    // A capability that THROWS (an ownership refusal, a revision conflict, an unreadable model) ends the turn exactly as it
    // does on the existing loop: the route's own handlers answer it. Never turned into text for the model.
    errorFunction: null,
  }));
  const client = ledgeredAgentsClient({ site: 'agent-core.sdk',
    detailOf: (body) => ({ model: input.budget.model, purpose: 'conversation', ...agentRequestIdentity('agent.converse', body) }) });
  const agent = new Agent({
    name: 'Olumi',
    instructions: input.instructions,
    model: new OpenAIResponsesModel(client, input.budget.model),
    modelSettings: {
      maxTokens: input.budget.max_output_tokens,
      ...(input.budget.reasoning_effort !== undefined ? { reasoning: { effort: input.budget.reasoning_effort } } : {}),
      parallelToolCalls: false,
      // Native server-side compaction of the Conversation as it grows: no transcript trim of our own.
      contextManagement: [{ type: 'compaction', compactThreshold: CORE_COMPACT_THRESHOLD }],
    },
    tools,
  });

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
  const turnInput: string | AgentInputItem[] = conversation.created && brief !== '' && brief !== input.message.trim()
    ? [{ role: 'user', content: `${BRIEF_LABEL}\n${brief}` }, { role: 'user', content: input.message }] : input.message;

  let traceId = `trace_${randomUUID().replace(/-/g, '')}`;
  const finish = (text: string, stopped: AgentTurnResult['stopped_reason'], calls: number, author: 'ai' | 'host'): AgentTurnResult & { sdk: CoreTurnSdk } => {
    const total = Math.max(0, now() - startedAt);
    return {
      assistant_text: text, items: [], tool_calls: toolCalls, tool_results: toolResults,
      mutated: toolResults.some((r) => r.mutated === true), hops: calls, stopped_reason: stopped, reply_author: author,
      timing: { total_ms: total, provider_ms: Math.max(0, total - toolMs), tool_ms: toolMs, tool_provider_ms: 0, overhead_ms: 0,
        provider_calls: calls, tool_calls: toolCalls.length, hops: calls },
      sdk: { runtime: AGENTS_SDK, trace_id: traceId, state: 'openai_conversation', conversation_id: conversation.id,
        conversation_created: conversation.created, compact_threshold: CORE_COMPACT_THRESHOLD },
    };
  };
  try {
    return await withTrace('Olumi core turn', async (trace) => {
      traceId = trace.traceId;
      const result = await run(agent, turnInput, {
        conversationId: conversation.id,
        maxTurns: CORE_MAX_MODEL_CALLS,
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
        // This turn's facts ride the instructions of every call; the input stays exactly what the SDK sends.
        callModelInputFilter: ({ modelData }) => ({
          ...modelData,
          instructions: [modelData.instructions ?? '', ...turnFacts].filter((t) => t !== '').join('\n\n'),
        }),
      });
      const text = typeof result.finalOutput === 'string' ? result.finalOutput : '';
      return finish(text, text.trim() === '' ? 'incomplete' : 'answered', result.rawResponses.length, text.trim() === '' ? 'host' : 'ai');
    }, { groupId: input.ctx.scenario_id, metadata: { request_id: String(input.ctx.request_id ?? ''), turn_id: String(input.ctx.turn_id ?? '') } });
  } catch (err) {
    if (err instanceof MaxTurnsExceededError) return finish('', 'hop_limit', CORE_MAX_MODEL_CALLS, 'host');
    // The capability's own error, unwrapped, so the route's existing handlers see the same error the loop would raise.
    if (err instanceof ToolCallError && err.error !== undefined) throw err.error;
    log.warn({ event: 'agent_core.turn_failed', scenario_id: input.ctx.scenario_id, request_id: input.ctx.request_id, err: String(err).slice(0, 300) },
      'agent-core: the SDK run did not finish');
    throw err;
  }
}
