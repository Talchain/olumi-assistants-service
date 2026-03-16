/**
 * Production LLM Client
 *
 * Thin wrapper around getAdapter('orchestrator') that implements the LLMClient interface.
 * Production wires in the real adapter; tests wire in mocks via dependency injection.
 */

import { getAdapter } from "../../adapters/llm/router.js";
import { log } from "../../utils/telemetry.js";
import type { ChatWithToolsStreamEvent } from "../../adapters/llm/types.js";
import type { LLMClient } from "./types.js";

/**
 * Create a production LLMClient that delegates to the LLM adapter.
 */
export function createProductionLLMClient(): LLMClient {
  return {
    async chatWithTools(options, config) {
      const adapter = getAdapter('orchestrator');
      if (!adapter.chatWithTools) {
        throw new Error('LLM adapter does not support chatWithTools');
      }
      return adapter.chatWithTools(options, config);
    },

    async chat(options, config) {
      const adapter = getAdapter('orchestrator');
      return adapter.chat(options, config);
    },

    async *streamChatWithTools(args, opts): AsyncGenerator<ChatWithToolsStreamEvent> {
      const adapter = getAdapter('orchestrator');

      // FIX: The adapter returned by getAdapter is wrapped by CachingAdapter and
      // UsageTrackingAdapter, which both expose streamChatWithTools but throw if the
      // inner adapter (e.g. OpenAI) doesn't support it. We must try the stream call
      // and fall back to non-streaming if it throws, rather than relying on the
      // truthiness check which passes for wrappers that define the method signature.
      if (adapter.streamChatWithTools) {
        try {
          yield* adapter.streamChatWithTools(args, opts);
          return;
        } catch (err) {
          // If the error is specifically about missing stream support, fall back.
          // Any other error (timeout, HTTP, etc.) should propagate normally.
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('does not support streamChatWithTools')) {
            log.info(
              { provider: adapter.name },
              'llm-client: adapter wrapper threw streamChatWithTools unsupported — falling back to non-streaming',
            );
          } else {
            throw err;
          }
        }
      }

      // Fallback: call non-streaming, yield single message_complete
      if (!adapter.chatWithTools) {
        throw new Error('LLM adapter does not support chatWithTools');
      }
      const result = await adapter.chatWithTools(args, opts);
      yield { type: 'message_complete', result };
    },

    getResolvedModel() {
      const adapter = getAdapter('orchestrator');
      return { model: adapter.model, provider: adapter.name };
    },
  };
}
