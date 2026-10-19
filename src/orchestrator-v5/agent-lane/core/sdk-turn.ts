/**
 * ⭐ PATH-B: AN ORDINARY `core` TURN RUNS ON THE OPENAI AGENTS SDK (Paul 19 Oct 13:44Z: "If there's anything we can utilise
 * that OpenAI provides out of the box, we should ensure that that is our starting solution"; DL-3 fit decision 13:5xZ).
 *
 * The SDK owns the tool loop (`run`), the conversation memory (ONE strategy: an SDK `MemorySession` per scenario and user)
 * and the trace (its built-in tracing, one trace per turn, grouped by scenario). ONE agent owns the reply, on the existing
 * role models (`model-budgets.ts`). Olumi's existing capabilities are its tools: `toolsFor(mode)` declares them with their
 * existing JSON schemas, and `dispatchTool` runs them, so construction (drafter → registration), proposals, approval with
 * digest, CAS and readback, the Run (PLoT/ISL) and the canonical read are the same code the product uses. Each tool's typed
 * result goes back to the model as its own licensed view (`modelFacingToolResult`): real outcomes, and refusals as refusals.
 *
 * The SDK's memory holds only the conversation. The model, its proposals and its Runs stay in Olumi's stores, and every turn
 * the agent is given the CURRENT model state afresh (`turnContextItems`), ephemerally, never written into the session.
 *
 * Retained bridges, each for a requirement the SDK does not meet on its own:
 *   1. TRANSPORT. The SDK's Responses model calls `responses.create` on a client we hand it; ours posts through Olumi's
 *      provider policy (`postResponses`), so every call stays on this request's OPENAI_ONLY policy and its `_provider_calls`
 *      row, now with the returned model, the tool names sent and a digest of the input sent (core-acceptance witness).
 *   2. CONSENT. Three protocol checks on a tool call, as the existing loop makes them: a change proposed this turn is never
 *      approved by the AI in the same turn; one approval carries one change; only this turn's own card may be withdrawn.
 *
 * ⚠ Memory is per process: after a restart the agent starts the conversation again from the durable model state and brief.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  Agent, MaxTurnsExceededError, MemorySession, OpenAIResponsesModel, run, setTracingDisabled, system, tool, ToolCallError, user, withTrace,
  type AgentInputItem, type OpenAIClient,
} from '@openai/agents';
import { getRuntimeEnv } from '../../../config/env-resolver.js';
import { postResponses } from '../../../adapters/llm/openai.js';
import { recordProviderReturnedModel } from '../../../adapters/llm/provider-policy.js';
import { log } from '../../../utils/telemetry.js';
import { agentRequestIdentity } from '../runtime/prompt-identity.js';
import { dispatchTool, toolsFor, type AgentCapabilities, type AgentLaneMode, type AgentToolContext, type ToolResult } from '../runtime/agent-tools.js';
import type { AgentTurnResult } from '../runtime/agent-loop.js';
import type { CallBudget } from '../model-budgets.js';
import { runFactsContext, turnContextItems, turnContextText } from '../turn-context.js';
import { modelFacingToolResult } from '../licensed-run-view.js';
import {
  earlierTurnWithdrawal, isProposingTool, NOT_ON_NARRATION, NOT_PROPOSED_THIS_TURN, ONE_CHANGE_PER_APPROVAL,
  ONE_CHANGE_PER_APPROVAL_DETAIL, WITHDRAW_PROPOSAL,
} from '../approval-chips.js';

/** The exact SDK release this path runs (package.json pins it). */
export const AGENTS_SDK = '@openai/agents@0.18.0';
/** Model calls one core turn may make before it stops (the SDK's `maxTurns`). */
export const CORE_MAX_MODEL_CALLS = 8;
/** Conversations held in memory at once; the oldest is dropped past this. */
const SESSIONS_CAP = 500;
const LIMIT_CHANGE_TOOL = 'propose_limit_change';
const AUTHORISE_CHANGE = 'authorise_change';

// Tests never export traces; a deployed runtime uses the SDK's built-in exporter, which reads the lane's OPENAI_API_KEY.
if (getRuntimeEnv() === 'test') setTracingDisabled(true);

const sessions = new Map<string, MemorySession>();
/** The scenario's conversation for this user, kept in the SDK's own session store (process memory). */
export function coreSession(scenarioId: string, userId: string | null): MemorySession {
  const key = `${scenarioId}:${userId ?? 'guest'}`;
  const held = sessions.get(key);
  if (held !== undefined) {
    sessions.delete(key);
    sessions.set(key, held);
    return held;
  }
  const session = new MemorySession({ sessionId: key });
  sessions.set(key, session);
  if (sessions.size > SESSIONS_CAP) sessions.delete(sessions.keys().next().value!);
  return session;
}
/** Test-only: forget every held conversation. */
export function resetCoreSessionsForTests(): void { sessions.clear(); }

const sha256 = (value: unknown): string => {
  let text = '';
  try { text = JSON.stringify(value) ?? ''; } catch { text = ''; }
  return createHash('sha256').update(text, 'utf8').digest('hex');
};
/** A message item's text, in either content form (a string, or parts with `text`). */
const itemText = (item: unknown): string => {
  const content = item !== null && typeof item === 'object' ? (item as { content?: unknown }).content : undefined;
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.map((part) => (part !== null && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
    ? (part as { text: string }).text : '')).join('\n') : '';
};
const toolNamesOf = (tools: unknown): string[] => (Array.isArray(tools) ? tools : [])
  .map((t) => (t !== null && typeof t === 'object' ? (t as { name?: unknown }).name : undefined))
  .filter((n): n is string => typeof n === 'string');

/**
 * Bridge 1: the client the SDK's Responses model calls. Only `responses.create` is used on the non-streaming path the
 * runner takes; it posts the SDK's own request body through `postResponses` and returns the provider's response unchanged.
 */
function ledgeredClient(budget: CallBudget, signal: AbortSignal | undefined): OpenAIClient {
  const create = async (body: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown> => {
    const { r, usageHandle } = await postResponses(body, {
      site: 'agent-core.sdk',
      detail: {
        model: budget.model, purpose: 'conversation', ...agentRequestIdentity('agent.converse', body),
        tool_names: toolNamesOf(body['tools']), input_sha256: sha256(body['input']),
      },
      ...(options?.signal ?? signal) !== undefined ? { signal: options?.signal ?? signal } : {},
      preserveResponseErrors: true,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      // A 429 ends the turn: the runner surfaces it and nothing is retried here.
      throw new Error(`openai_${r.status}: ${text.slice(0, 300)}`);
    }
    const j = (await r.json()) as { model?: unknown };
    recordProviderReturnedModel(usageHandle, j.model);
    return j;
  };
  // forbidden-exempt: the SDK's Responses model calls only `responses.create` on this path; this object is that one method.
  return { responses: { create } } as unknown as OpenAIClient;
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
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

/** What the route adds to `_agent` for a core turn: the runtime and its trace (the witness reads both). */
export interface CoreTurnSdk { readonly runtime: string; readonly trace_id: string; readonly session: 'sdk_memory_session' }

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
  const agent = new Agent({
    name: 'Olumi',
    instructions: input.instructions,
    model: new OpenAIResponsesModel(ledgeredClient(input.budget, input.signal), input.budget.model),
    modelSettings: {
      maxTokens: input.budget.max_output_tokens,
      ...(input.budget.reasoning_effort !== undefined ? { reasoning: { effort: input.budget.reasoning_effort } } : {}),
      parallelToolCalls: false,
    },
    tools,
  });

  // The CURRENT state, today's date and the brief: this turn's context, given before the user's message and never saved.
  const stateContext = runFactsContext(input.canonicalState);
  // The SAME items the existing loop sends, in the SDK's message form: Olumi's own facts as system items, the user's words
  // (the brief) as a user item — the authority rule `turn-context.ts` states.
  const contextItems: AgentInputItem[] = turnContextItems({
    now: new Date(startedAt), briefText: input.briefText, conversation: [],
    verifiedUserMessages: input.ctx.verified_user_messages, unknownUserText: input.ctx.unverified_user_text,
    currentRequestOrigin: input.ctx.user_turn_text ? 'typed' : 'unknown',
    canonicalState: stateContext.facts, runFactsUse: stateContext.use,
  }).map((item) => ((item as { role?: unknown }).role === 'user' ? user(turnContextText(item)) : system(turnContextText(item))));
  const session = coreSession(input.ctx.scenario_id, input.userId);
  const remembered = (await session.getItems()).length;
  /**
   * The SDK persists what the model was sent, injected items included. This turn's context is taken back out once the run
   * ends, so the session holds only the conversation and the next turn gets its own context, fresh.
   */
  const contextTexts = new Set(contextItems.map(itemText));
  const forgetContext = async (): Promise<void> => {
    const all = await session.getItems();
    const kept = all.filter((item) => !contextTexts.has(itemText(item)));
    if (kept.length === all.length) return;
    await session.clearSession();
    await session.addItems(kept);
  };

  let traceId = `trace_${randomUUID().replace(/-/g, '')}`;
  const finish = (text: string, stopped: AgentTurnResult['stopped_reason'], calls: number, author: 'ai' | 'host'): AgentTurnResult & { sdk: CoreTurnSdk } => {
    const total = Math.max(0, now() - startedAt);
    return {
      assistant_text: text, items: [], tool_calls: toolCalls, tool_results: toolResults,
      mutated: toolResults.some((r) => r.mutated === true), hops: calls, stopped_reason: stopped, reply_author: author,
      timing: { total_ms: total, provider_ms: Math.max(0, total - toolMs), tool_ms: toolMs, tool_provider_ms: 0, overhead_ms: 0,
        provider_calls: calls, tool_calls: toolCalls.length, hops: calls },
      sdk: { runtime: AGENTS_SDK, trace_id: traceId, session: 'sdk_memory_session' },
    };
  };
  try {
    return await withTrace('Olumi core turn', async (trace) => {
      traceId = trace.traceId;
      const result = await run(agent, input.message, {
        session,
        maxTurns: CORE_MAX_MODEL_CALLS,
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
        // Ephemeral context: inserted after the remembered conversation, before this turn's message, on every model call.
        callModelInputFilter: ({ modelData }) => ({
          ...modelData,
          input: [...modelData.input.slice(0, remembered), ...contextItems, ...modelData.input.slice(remembered)],
        }),
      });
      await forgetContext();
      const text = typeof result.finalOutput === 'string' ? result.finalOutput : '';
      return finish(text, text.trim() === '' ? 'incomplete' : 'answered', result.rawResponses.length, text.trim() === '' ? 'host' : 'ai');
    }, { groupId: input.ctx.scenario_id, metadata: { request_id: String(input.ctx.request_id ?? ''), turn_id: String(input.ctx.turn_id ?? '') } });
  } catch (err) {
    await forgetContext().catch(() => undefined);
    if (err instanceof MaxTurnsExceededError) return finish('', 'hop_limit', CORE_MAX_MODEL_CALLS, 'host');
    // The capability's own error, unwrapped, so the route's existing handlers see the same error the loop would raise.
    if (err instanceof ToolCallError && err.error !== undefined) throw err.error;
    log.warn({ event: 'agent_core.turn_failed', scenario_id: input.ctx.scenario_id, request_id: input.ctx.request_id, err: String(err).slice(0, 300) },
      'agent-core: the SDK run did not finish');
    throw err;
  }
}
