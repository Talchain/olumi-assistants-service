/**
 * Production LLM Client
 *
 * Thin wrapper around getAdapter('orchestrator') that implements the LLMClient interface.
 * Production wires in the real adapter; tests wire in mocks via dependency injection.
 */

import { getAdapter } from "../../adapters/llm/router.js";
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
      if (adapter.streamChatWithTools) {
        yield* adapter.streamChatWithTools(args, opts);
      } else {
        // Fallback: call non-streaming, yield single message_complete
        if (!adapter.chatWithTools) {
          throw new Error('LLM adapter does not support chatWithTools');
        }
        const result = await adapter.chatWithTools(args, opts);
        yield { type: 'message_complete', result };
      }
    },

    getResolvedModel() {
      const adapter = getAdapter('orchestrator');
      return { model: adapter.model, provider: adapter.name };
    },
  };
}
