/**
 * Usage-tracking adapter wrapper.
 *
 * Wraps any LLMAdapter to:
 * 1. Enforce daily token budget BEFORE every LLM call (adapter boundary)
 * 2. Log token usage after every LLM call (structured info event)
 * 3. Record tokens against the user's daily budget
 *
 * Budget enforcement at the adapter boundary catches multi-call flows
 * (e.g. draft → repair) that exceed the budget mid-request.
 *
 * Composable with withCaching: withUsageTracking(withCaching(adapter))
 */

import { log } from '../../utils/telemetry.js';
import {
  checkBudget,
  recordTokenUsage,
  getRequestContext,
  isBudgetEnabled,
} from '../../middleware/token-budget.js';
import { DailyBudgetExceededError } from './errors.js';
import type {
  LLMAdapter,
  DraftGraphArgs,
  DraftGraphResult,
  SuggestOptionsArgs,
  SuggestOptionsResult,
  RepairGraphArgs,
  RepairGraphResult,
  ClarifyBriefArgs,
  ClarifyBriefResult,
  CritiqueGraphArgs,
  CritiqueGraphResult,
  ExplainDiffArgs,
  ExplainDiffResult,
  ChatArgs,
  ChatResult,
  ChatWithToolsArgs,
  ChatWithToolsResult,
  CallOpts,
  DraftStreamEvent,
  UsageMetrics,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Enforce daily token budget before an LLM call.
 * Throws DailyBudgetExceededError if the user has exceeded their allowance.
 * No-op if budget tracking is disabled or request context is missing.
 */
function enforceBudget(requestId: string): void {
  if (!isBudgetEnabled()) return;

  const ctx = getRequestContext(requestId);
  if (!ctx) return; // No context = internal/system call — allow

  const result = checkBudget(ctx.userKey);
  if (result.exceeded) {
    throw new DailyBudgetExceededError(
      `Daily token budget exceeded (${result.used}/${result.limit})`,
      result.retryAfterSeconds,
      requestId,
      ctx.userKey,
    );
  }
}

/**
 * Log token usage and record against daily budget.
 * Reads rich context (userId, scenarioId, task) from the request context map.
 */
function logAndRecord(
  adapterTask: string,
  provider: string,
  model: string,
  usage: UsageMetrics,
  requestId: string,
): void {
  const totalTokens = usage.input_tokens + usage.output_tokens;

  // Resolve rich context from request mapping
  const ctx = getRequestContext(requestId);

  log.info({
    event: 'llm_usage',
    model,
    provider,
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    total_tokens: totalTokens,
    user_id: ctx?.userId ?? null,
    scenario_id: ctx?.scenarioId ?? null,
    task: ctx?.task ?? adapterTask,
    request_id: requestId,
  }, 'LLM token usage');

  // Increment daily budget (no-op if mapping is missing)
  recordTokenUsage(requestId, totalTokens);
}

// ---------------------------------------------------------------------------
// Adapter wrapper
// ---------------------------------------------------------------------------

class UsageTrackingAdapter implements LLMAdapter {
  readonly name: string;
  readonly model: string;

  constructor(private readonly adapter: LLMAdapter) {
    this.name = adapter.name;
    this.model = adapter.model;
  }

  async draftGraph(args: DraftGraphArgs, opts: CallOpts): Promise<DraftGraphResult> {
    enforceBudget(opts.requestId);
    const result = await this.adapter.draftGraph(args, opts);
    logAndRecord('draft_graph', this.name, this.model, result.usage, opts.requestId);
    return result;
  }

  async suggestOptions(args: SuggestOptionsArgs, opts: CallOpts): Promise<SuggestOptionsResult> {
    enforceBudget(opts.requestId);
    const result = await this.adapter.suggestOptions(args, opts);
    logAndRecord('suggest_options', this.name, this.model, result.usage, opts.requestId);
    return result;
  }

  async repairGraph(args: RepairGraphArgs, opts: CallOpts): Promise<RepairGraphResult> {
    enforceBudget(opts.requestId);
    const result = await this.adapter.repairGraph(args, opts);
    logAndRecord('repair_graph', this.name, this.model, result.usage, opts.requestId);
    return result;
  }

  async clarifyBrief(args: ClarifyBriefArgs, opts: CallOpts): Promise<ClarifyBriefResult> {
    enforceBudget(opts.requestId);
    const result = await this.adapter.clarifyBrief(args, opts);
    logAndRecord('clarify_brief', this.name, this.model, result.usage, opts.requestId);
    return result;
  }

  async critiqueGraph(args: CritiqueGraphArgs, opts: CallOpts): Promise<CritiqueGraphResult> {
    enforceBudget(opts.requestId);
    const result = await this.adapter.critiqueGraph(args, opts);
    logAndRecord('critique_graph', this.name, this.model, result.usage, opts.requestId);
    return result;
  }

  async explainDiff(args: ExplainDiffArgs, opts: CallOpts): Promise<ExplainDiffResult> {
    enforceBudget(opts.requestId);
    const result = await this.adapter.explainDiff(args, opts);
    logAndRecord('explain_diff', this.name, this.model, result.usage, opts.requestId);
    return result;
  }

  async chat(args: ChatArgs, opts: CallOpts): Promise<ChatResult> {
    enforceBudget(opts.requestId);
    const result = await this.adapter.chat(args, opts);
    logAndRecord('chat', this.name, this.model, result.usage, opts.requestId);
    return result;
  }

  async chatWithTools(args: ChatWithToolsArgs, opts: CallOpts): Promise<ChatWithToolsResult> {
    if (!this.adapter.chatWithTools) {
      throw new Error(`Adapter ${this.adapter.name} does not support chatWithTools`);
    }
    enforceBudget(opts.requestId);
    const result = await this.adapter.chatWithTools(args, opts);
    logAndRecord('chat_with_tools', this.name, this.model, result.usage, opts.requestId);
    return result;
  }

  /**
   * Stream support — delegates to underlying adapter (usage logged on complete event)
   */
  async *streamDraftGraph(
    args: DraftGraphArgs,
    opts: CallOpts,
  ): AsyncIterable<DraftStreamEvent> {
    if (!this.adapter.streamDraftGraph) {
      throw new Error(`Adapter ${this.adapter.name} does not support streaming`);
    }
    enforceBudget(opts.requestId);
    for await (const event of this.adapter.streamDraftGraph(args, opts)) {
      if (event.type === 'complete' && event.result.usage) {
        logAndRecord('draft_graph_stream', this.name, this.model, event.result.usage, opts.requestId);
      }
      yield event;
    }
  }
}

/**
 * Wrap an adapter with usage tracking.
 * Enforces daily budget before each call, logs token usage, and records against budget.
 */
export function withUsageTracking(adapter: LLMAdapter): LLMAdapter {
  return new UsageTrackingAdapter(adapter);
}
