import { beforeEach, describe, expect, it, vi } from 'vitest';

// A plain stub, not vi.fn: a spy's own bookkeeping on a rejected promise reports it as unhandled (Vitest 4).
const sdk = vi.hoisted(() => ({ impl: async (..._a: any[]): Promise<unknown> => ({ finalOutput: null }), calls: [] as any[][] }));
vi.mock('@openai/agents', async (importOriginal) => ({ ...(await importOriginal<typeof import('@openai/agents')>()),
  run: (...a: any[]) => { sdk.calls.push(a); return sdk.impl(...a); } }));
vi.mock('../../../../adapters/llm/openai-agents-client.js', () => ({ ledgeredAgentsClient: () => ({}) }));

import { CRITIC_DEADLINE_MS, CRITIC_MAX_OUTPUT_TOKENS, modelCritic } from '../model-critic.js';
import { coreBudget } from '../../model-budgets.js';

const CRITIQUE = { measurable_goal: null, missing: [], connect: [], question: 'What figure would you need to reach?' };

describe('the model critic is bounded: one call, a short answer, a deadline (#3567 Codex + buddy SIMPLER)', () => {
  beforeEach(() => { sdk.calls.length = 0; });

  it('one model call, under a deadline signal, with a small output cap; a valid critique is returned', async () => {
    sdk.impl = async () => ({ finalOutput: CRITIQUE });
    expect(await modelCritic(coreBudget())('{}')).toEqual(CRITIQUE);
    expect(sdk.calls).toHaveLength(1);
    const [agent, , options] = sdk.calls[0]!;
    expect(options).toMatchObject({ maxTurns: 1 });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(agent.modelSettings.maxTokens).toBe(CRITIC_MAX_OUTPUT_TOKENS);
    expect(CRITIC_DEADLINE_MS).toBeLessThanOrEqual(45_000);
  });

  it('a stalled or failed reviewer never blocks the draft: an aborted run gives no critique', async () => {
    sdk.impl = async () => { throw new Error('reviewer timed out'); };
    expect(await modelCritic(coreBudget())('{}')).toBeUndefined();
  });

  it('CONTRAST: an answer that is not a critique is dropped, never passed on', async () => {
    sdk.impl = async () => ({ finalOutput: { missing: 'everything' } });
    expect(await modelCritic(coreBudget())('{}')).toBeUndefined();
  });
});
