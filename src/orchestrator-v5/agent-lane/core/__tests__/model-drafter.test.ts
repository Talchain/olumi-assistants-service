import { beforeEach, describe, expect, it, vi } from 'vitest';

// A plain stub, not vi.fn: a spy's own bookkeeping on a rejected promise reports it as unhandled (Vitest 4).
const sdk = vi.hoisted(() => ({ impl: async (..._a: any[]): Promise<unknown> => ({ finalOutput: null }), calls: [] as any[][] }));
vi.mock('@openai/agents', async (importOriginal) => ({ ...(await importOriginal<typeof import('@openai/agents')>()),
  run: (...a: any[]) => { sdk.calls.push(a); return sdk.impl(...a); } }));
vi.mock('../../../../adapters/llm/openai-agents-client.js', () => ({ ledgeredAgentsClient: () => ({}) }));

import { DRAFTER_DEADLINE_MS, modelDrafter } from '../model-drafter.js';
import { DRAFTER_INSTRUCTIONS } from '../drafter-instructions.js';
import { coreBudget } from '../../model-budgets.js';

const MODEL = { aims: [{ id: 'g', text: 'Visitors served', status: 'current', target: null, defined_as: null, source: 'user', party: null, quote: 'Visitors served' }],
  options: [], factors: [], links: [], risks: [], conditions: [], views: [], history: [] };

describe('the construction role (21 Oct): one bounded call whose strict output is the living model', () => {
  beforeEach(() => { sdk.calls.length = 0; });

  it('one call with the construction instruction, the core budget (model, effort, output cap) and a deadline signal; a valid model is returned', async () => {
    sdk.impl = async () => ({ finalOutput: MODEL });
    expect(await modelDrafter(coreBudget())('{"brief":"x"}')).toEqual(MODEL);
    expect(sdk.calls).toHaveLength(1);
    const [agent, input, options] = sdk.calls[0]!;
    expect(input).toBe('{"brief":"x"}');
    expect(options).toMatchObject({ maxTurns: 1 });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(agent.instructions).toBe(DRAFTER_INSTRUCTIONS);
    expect(agent.modelSettings).toMatchObject({ maxTokens: coreBudget().max_output_tokens, reasoning: { effort: coreBudget().reasoning_effort } });
    expect(DRAFTER_DEADLINE_MS).toBeLessThanOrEqual(150_000);
  });

  it('the instruction carries the construction rules, and never an Olumi estimate under a relabelled factor or a reply', () => {
    for (const rule of ['EVERY OPTION MUST SAY WHAT IT DOES', 'PRESERVE EVERY RISK THE USER NAMED', 'A TARGET THE BRIEF DOES NOT STATE STAYS UNSTATED',
      'its value stays null: the analysis asks the person for it', 'never relabel it as Olumi’s to hold an estimate'.replace('’', "'")])
      expect(DRAFTER_INSTRUCTIONS, rule).toContain(rule);
    expect(DRAFTER_INSTRUCTIONS).not.toContain('your reply');
    expect(DRAFTER_INSTRUCTIONS).not.toContain('give a defensible starting level only as Olumi');
  });

  it('a failed call, a hung call (aborted at the deadline) or an answer that is not a living model gives no draft', async () => {
    sdk.impl = async () => { throw new Error('provider error'); };
    expect(await modelDrafter(coreBudget())('{}')).toBeUndefined();
    let seen: AbortSignal | undefined;
    sdk.impl = (_agent: unknown, _input: unknown, options: { signal: AbortSignal }) => { seen = options.signal; return new Promise(() => {}); };
    const started = Date.now();
    expect(await modelDrafter(coreBudget(), undefined, 30)('{}')).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(seen?.aborted).toBe(true);
    sdk.impl = async () => ({ finalOutput: { aims: 'everything' } });
    expect(await modelDrafter(coreBudget())('{}')).toBeUndefined();
  });
});
