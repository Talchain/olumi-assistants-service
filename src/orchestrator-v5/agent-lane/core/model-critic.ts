/**
 * THE MODEL CRITIC (21 Oct 2026; Paul: a multi-model architecture that checks and enhances the model). A second agent, SDK-native
 * (`Agent` + `run`, its own ledgered client, the same OpenAI family), reads the person's brief and Olumi's first draft and says
 * what a thoughtful expert would add: a measurable goal when there is none, at most three missing options, factors, outcomes or
 * risks with how each reaches the goal, the links that would connect stranded items, and the one question that would most
 * change the result. It never edits the model and never gives a figure: the drafter decides what to adopt, as Olumi's own.
 */
import { Agent, OpenAIResponsesModel, run } from '@openai/agents';
import { z } from 'zod-v4';
import { ledgeredAgentsClient } from '../../../adapters/llm/openai-agents-client.js';
import { agentRequestIdentity } from '../runtime/prompt-identity.js';
import type { CallBudget } from '../model-budgets.js';

export const Critique = z.object({
  measurable_goal: z.object({ quantity: z.string(), unit: z.string(), horizon: z.string(), why: z.string() }).strict().nullable()
    .describe('Only when no current aim has a target: the measurable quantity the person\'s aim depends on. Null otherwise.'),
  missing: z.array(z.object({
    kind: z.enum(['option', 'factor', 'outcome', 'risk']),
    label: z.string(),
    reaches_goal_via: z.string().describe('How it acts on the goal, naming the existing item it connects to and the direction.'),
    why_it_matters: z.string(),
  }).strict()).describe('At most three, the most consequential first. Specific to this situation, never generic advice.'),
  connect: z.array(z.object({ item_id: z.string(), to_id: z.string(), sign: z.enum(['+', '-']), why: z.string() }).strict())
    .describe('For each item in the draft that does not reach the goal: the link that would connect it.'),
  question: z.string().describe('The ONE input from the person that would most change the result.'),
}).strict();
export type CritiqueT = z.infer<typeof Critique>;

export const CRITIC_INSTRUCTIONS = [
  'You review the first model Olumi drafted of a person\'s situation. Olumi is a reasoning partner: it helps people think, it never decides for them.',
  'You are given the person\'s own words, the draft (aims, options, factors, links, risks, conditions, views) and its structural gaps.',
  'You are advisory: say what a thoughtful, independent expert would raise so the model is complete enough to reason with and to analyse:',
  'a measurable goal when no aim has a target; at most three consequential omissions or contradictions (options, factors, outcomes or risks, including non-obvious ones);',
  'the link that would connect a stranded item where there is a real causal relationship (context may rightly stay unconnected); and the one question whose answer would most change the result.',
  'Never give a figure or a chance, never credit anything to the person they did not say, and never repeat what the draft already holds.',
].join(' ');

/** Bounded (Codex + buddy SIMPLER, #3567): one model call, a short structured answer, and a deadline, so a stalled reviewer
 *  never delays the first model by more than this. */
export const CRITIC_DEADLINE_MS = 45_000;
export const CRITIC_MAX_OUTPUT_TOKENS = 2_000;

/**
 * The critic for one turn: undefined when the call fails or runs out of time, so a draft is never blocked by its reviewer.
 * The deadline is HARD (Codex delta on #3567): the answer races the clock, so SDK retry backoff can never hold the draft
 * past it; the request is then aborted. `msLeft` is what remains of the turn's construction budget; the smaller one wins.
 */
export function modelCritic(budget: CallBudget, signal?: AbortSignal, deadlineMs = CRITIC_DEADLINE_MS): (input: string, msLeft?: number) => Promise<CritiqueT | undefined> {
  return async (input, msLeft) => {
    const ms = Math.min(deadlineMs, msLeft ?? deadlineMs);
    if (ms <= 0) return undefined;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clock = new Promise<undefined>((resolve) => { timer = setTimeout(() => { abort.abort(); resolve(undefined); }, ms); });
    try {
      return await Promise.race([critique(budget, input, signal === undefined ? abort.signal : AbortSignal.any([signal, abort.signal])), clock]);
    } finally {
      clearTimeout(timer);
    }
  };
}

async function critique(budget: CallBudget, input: string, signal: AbortSignal): Promise<CritiqueT | undefined> {
  try {
    const client = ledgeredAgentsClient({ site: 'agent-core.critic', pending: [],
      detailOf: (body) => ({ model: budget.model, purpose: 'model_critique', ...agentRequestIdentity('agent.critique', body) }) });
    const critic = new Agent({ name: 'model_critic', instructions: CRITIC_INSTRUCTIONS, outputType: Critique,
      model: new OpenAIResponsesModel(client, budget.model),
      modelSettings: { maxTokens: CRITIC_MAX_OUTPUT_TOKENS, reasoning: { effort: 'medium' } } });
    const result = await run(critic, input, { maxTurns: 1, signal });
    const parsed = Critique.safeParse(result.finalOutput);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
