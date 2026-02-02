/**
 * Provider Failover Adapter - Multi-Provider Resilience
 *
 * Wraps multiple LLM adapters to provide automatic failover when primary provider fails.
 * If the primary provider exhausts retries, automatically falls back to configured
 * fallback providers in order.
 *
 * Features:
 * - Transparent failover (same interface as single adapter)
 * - Telemetry for failover events
 * - Configurable provider chain
 * - Preserves error context for debugging
 *
 * Configuration:
 * - LLM_FAILOVER_PROVIDERS: Comma-separated list (e.g., "anthropic,openai,fixtures")
 * - First provider is primary, others are fallbacks
 */

import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";
import type {
  LLMAdapter,
  DraftGraphArgs,
  DraftGraphResult,
  SuggestOptionsArgs,
  SuggestOptionsResult,
  ExplainDiffArgs,
  ExplainDiffResult,
  RepairGraphArgs,
  RepairGraphResult,
  ClarifyBriefArgs,
  ClarifyBriefResult,
  CritiqueGraphArgs,
  CritiqueGraphResult,
  ChatArgs,
  ChatResult,
  CallOpts,
  DraftStreamEvent,
} from "./types.js";

/**
 * Failover adapter that tries multiple providers in sequence
 */
export class FailoverAdapter implements LLMAdapter {
  readonly name: string;
  readonly model: string;

  constructor(
    private readonly adapters: LLMAdapter[],
    private readonly operation: string = "unknown"
  ) {
    if (adapters.length === 0) {
      throw new Error("FailoverAdapter requires at least one adapter");
    }

    // Primary adapter determines name/model for telemetry
    this.name = `${adapters[0].name}-failover`;
    this.model = adapters[0].model;
  }

  /**
   * Get failover configuration metadata
   * Used by /v1/status for diagnostics
   */
  getFailoverMetadata(): { enabled: true; providers: string[] } {
    return {
      enabled: true,
      providers: this.adapters.map((a) => a.name),
    };
  }

  /**
   * Execute operation with automatic failover
   */
  private async withFailover<T>(
    operation: string,
    fn: (adapter: LLMAdapter) => Promise<T>,
    opts: CallOpts
  ): Promise<T> {
    const errors: Array<{ provider: string; error: unknown }> = [];

    for (let i = 0; i < this.adapters.length; i++) {
      const adapter = this.adapters[i];
      const isLastAdapter = i === this.adapters.length - 1;

      try {
        // Try the adapter
        const result = await fn(adapter);

        // Success - emit telemetry if this was a failover (not primary)
        if (i > 0) {
          emit(TelemetryEvents.ProviderFailoverSuccess, {
            operation,
            primary_provider: this.adapters[0].name,
            fallback_provider: adapter.name,
            fallback_index: i,
            failed_providers: errors.map((e) => e.provider),
            request_id: opts.requestId,
          });

          log.info(
            {
              operation,
              primary: this.adapters[0].name,
              fallback: adapter.name,
              fallback_index: i,
            },
            "Provider failover successful"
          );
        }

        return result;
      } catch (error) {
        errors.push({ provider: adapter.name, error });

        if (isLastAdapter) {
          // All adapters exhausted - aggregate all errors for debuggability
          emit(TelemetryEvents.ProviderFailoverExhausted, {
            operation,
            providers_tried: this.adapters.map((a) => a.name),
            total_attempts: this.adapters.length,
            request_id: opts.requestId,
          });

          log.error(
            {
              operation,
              providers_tried: this.adapters.map((a) => a.name),
              errors: errors.map((e) => ({
                provider: e.provider,
                message: e.error instanceof Error ? e.error.message : String(e.error),
              })),
            },
            "Provider failover exhausted - all providers failed"
          );

          // Throw AggregateError with all provider failures for incident response
          const errorMessages = errors.map(
            (e) => `${e.provider}: ${e.error instanceof Error ? e.error.message : String(e.error)}`
          );
          throw new AggregateError(
            errors.map((e) => e.error),
            `All ${this.adapters.length} providers failed for ${operation}: ${errorMessages.join("; ")}`
          );
        }

        // Not last adapter - emit failover event and try next
        emit(TelemetryEvents.ProviderFailover, {
          operation,
          from_provider: adapter.name,
          to_provider: this.adapters[i + 1].name,
          fallback_index: i + 1,
          reason: error instanceof Error ? error.message : String(error),
          request_id: opts.requestId,
        });

        log.warn(
          {
            operation,
            from: adapter.name,
            to: this.adapters[i + 1].name,
            reason: error instanceof Error ? error.message : String(error),
          },
          "Provider failed, trying fallback"
        );
      }
    }

    // Should never reach here
    throw new Error("Failover logic error - no result or error");
  }

  async draftGraph(args: DraftGraphArgs, opts: CallOpts): Promise<DraftGraphResult> {
    return this.withFailover("draft_graph", (adapter) => adapter.draftGraph(args, opts), opts);
  }

  async suggestOptions(
    args: SuggestOptionsArgs,
    opts: CallOpts
  ): Promise<SuggestOptionsResult> {
    return this.withFailover(
      "suggest_options",
      (adapter) => adapter.suggestOptions(args, opts),
      opts
    );
  }

  async repairGraph(args: RepairGraphArgs, opts: CallOpts): Promise<RepairGraphResult> {
    return this.withFailover("repair_graph", (adapter) => adapter.repairGraph(args, opts), opts);
  }

  async clarifyBrief(args: ClarifyBriefArgs, opts: CallOpts): Promise<ClarifyBriefResult> {
    return this.withFailover(
      "clarify_brief",
      (adapter) => adapter.clarifyBrief(args, opts),
      opts
    );
  }

  async critiqueGraph(args: CritiqueGraphArgs, opts: CallOpts): Promise<CritiqueGraphResult> {
    return this.withFailover(
      "critique_graph",
      (adapter) => adapter.critiqueGraph(args, opts),
      opts
    );
  }

  async explainDiff(args: ExplainDiffArgs, opts: CallOpts): Promise<ExplainDiffResult> {
    return this.withFailover("explain_diff", (adapter) => adapter.explainDiff(args, opts), opts);
  }

  /**
   * Chat completion with automatic failover
   */
  async chat(args: ChatArgs, opts: CallOpts): Promise<ChatResult> {
    return this.withFailover("chat", (adapter) => adapter.chat(args, opts), opts);
  }

  /**
   * Stream support - delegates to primary adapter only
   * (Failover not supported for streaming to maintain simplicity)
   */
  async *streamDraftGraph(
    args: DraftGraphArgs,
    opts: CallOpts
  ): AsyncIterable<DraftStreamEvent> {
    const primary = this.adapters[0];
    if (!primary.streamDraftGraph) {
      throw new Error(`Primary adapter ${primary.name} does not support streaming`);
    }

    yield* primary.streamDraftGraph(args, opts);
  }
}
