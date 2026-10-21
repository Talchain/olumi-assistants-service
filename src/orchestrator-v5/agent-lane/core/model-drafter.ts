/**
 * THE CONSTRUCTION ROLE (21 Oct 2026; Paul: "why do we not have the most optimal prompts already?"; buddy AMEND/PROCEED).
 * The 15 Oct AIE design had a separate construction call with its own instruction. Thin core folded it into the conversation
 * agent, which then drafted from the coach prompt and field descriptions alone. This restores ONE native construction role
 * inside `build_model_from_brief`: an SDK `Agent` with the construction instruction (`DRAFTER_INSTRUCTIONS`) whose strict
 * output IS the living model. Kernel, mapper and the one core write are unchanged; the drafter never saves anything.
 */
import { Agent, OpenAIResponsesModel, run } from '@openai/agents';
import { ledgeredAgentsClient } from '../../../adapters/llm/openai-agents-client.js';
import { LivingModel, type LivingModelT } from '../../../schemas/living-model.js';
import { agentRequestIdentity } from '../runtime/prompt-identity.js';
import type { CallBudget } from '../model-budgets.js';
import { DRAFTER_INSTRUCTIONS } from './drafter-instructions.js';

/** A first model at high effort takes about a minute (#3567's served first turns); past this the build reports a failed draft. */
export const DRAFTER_DEADLINE_MS = 150_000;

/**
 * The drafter for one turn: the living model, or undefined when the call fails, runs out of time or answers with something
 * that is not a living model. The deadline is HARD, as the critic's (Codex on #3567): the answer races the clock, and the
 * request is aborted when the clock wins. `msLeft` is what remains of the turn's construction budget (buddy served BLOCK on
 * #3574: a fresh 150 s per call outran the 170 s stream); the call never outlives the smaller of the two.
 */
export function modelDrafter(budget: CallBudget, signal?: AbortSignal, deadlineMs = DRAFTER_DEADLINE_MS): (input: string, msLeft?: number) => Promise<LivingModelT | undefined> {
  return async (input, msLeft) => {
    const ms = Math.min(deadlineMs, msLeft ?? deadlineMs);
    if (ms <= 0) return undefined;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clock = new Promise<undefined>((resolve) => { timer = setTimeout(() => { abort.abort(); resolve(undefined); }, ms); });
    try {
      return await Promise.race([draft(budget, input, signal === undefined ? abort.signal : AbortSignal.any([signal, abort.signal])), clock]);
    } finally {
      clearTimeout(timer);
    }
  };
}

async function draft(budget: CallBudget, input: string, signal: AbortSignal): Promise<LivingModelT | undefined> {
  try {
    const client = ledgeredAgentsClient({ site: 'agent-core.drafter', pending: [],
      detailOf: (body) => ({ model: budget.model, purpose: 'model_construction', ...agentRequestIdentity('agent.construct', body) }) });
    const drafter = new Agent({ name: 'model_drafter', instructions: DRAFTER_INSTRUCTIONS, outputType: LivingModel,
      model: new OpenAIResponsesModel(client, budget.model),
      modelSettings: { maxTokens: budget.max_output_tokens, ...(budget.reasoning_effort === undefined ? {} : { reasoning: { effort: budget.reasoning_effort } }) } });
    const result = await run(drafter, input, { maxTurns: 1, signal });
    const parsed = LivingModel.safeParse(result.finalOutput);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
