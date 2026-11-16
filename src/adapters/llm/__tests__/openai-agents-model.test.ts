import { createHash } from 'node:crypto';
import { Agent, RunState, run } from '@openai/agents';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsageCompatibleResponsesModel } from '../openai-agents-model.js';
import { ledgeredAgentsClient } from '../openai-agents-client.js';
import { OPENAI_ONLY, recordedProviderCalls, runWithProviderPolicy } from '../provider-policy.js';

describe('Agents SDK usage compatibility', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('a buffered answer and its serialised SDK state keep exact counts while the ledger keeps nested usage and the original digest', async () => {
    const response = {
      id: 'resp_usage', object: 'response', model: 'gpt-scripted-returned', status: 'completed',
      output: [{ id: 'msg_usage', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: 'The model can be discussed.', annotations: [] }] }],
      usage: {
        input_tokens: 10, output_tokens: 5, total_tokens: 15,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens_details: { short_lived_tokens: 0 } },
        output_tokens_details: { reasoning_tokens: 2, nested_reasoning_details: { another_count: 1 } },
      },
    };
    const bytes = JSON.stringify(response);
    const fetch = vi.fn(async () => new Response(bytes, { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    await runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'), async () => {
      const client = ledgeredAgentsClient({ site: 'agent-core.sdk', detailOf: () => ({ model: 'gpt-6.1-sol', purpose: 'test' }) });
      const agent = new Agent({ name: 'Usage regression', instructions: 'Synthetic test.',
        model: new UsageCompatibleResponsesModel(client, 'gpt-6.1-sol') });
      const result = await run(agent, 'Explain the model.', { maxTurns: 1 });
      expect(result.finalOutput).toBe('The model can be discussed.');
      expect(result.rawResponses[0]?.usage).toMatchObject({
        inputTokens: 10, outputTokens: 5, totalTokens: 15,
        inputTokensDetails: [{ cached_tokens: 0 }], outputTokensDetails: [{ reasoning_tokens: 2 }],
        requestUsageEntries: [{ inputTokensDetails: { cached_tokens: 0 }, outputTokensDetails: { reasoning_tokens: 2 } }],
      });
      await expect(RunState.fromString(agent, result.state.toString())).resolves.toBeDefined();
      const calls = recordedProviderCalls();
      expect(calls).toHaveLength(1);
      expect(calls?.[0]?.usage?.raw).toEqual(response.usage);
      expect(calls?.[0]?.attempt?.response_sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});
