/**
 * Arm B — equal-compute stronger single model at high reasoning effort.
 * B is the bar: C and D must beat a compute-matched B, not just arm A.
 *
 * claude-opus-4-8: adaptive thinking; effort from config (default "high");
 * NO temperature (rejected by the model). When a per-brief token budget is
 * supplied (equal-compute matching against C's or D's realized spend), it is
 * applied via output_config.task_budget (beta task-budgets-2026-03-13,
 * minimum 20k tokens) with max_tokens headroom.
 */
import { extractJson } from "../llm/client.ts";
import { buildCallRecord } from "../compute/cost.ts";
import { briefUserContent, emptyOutput, type ArmRunner } from "./types.ts";

export const TASK_BUDGETS_BETA = "task-budgets-2026-03-13";
export const TASK_BUDGET_MIN_TOKENS = 20_000;
export const ARM_B_DEFAULT_MAX_TOKENS = 16_384;
export const ARM_B_MAX_TOKENS_CEILING = 128_000;

export function armBTokenPlan(budget?: number): {
  maxTokens: number;
  taskBudget: number | null;
  betas: string[];
} {
  if (budget === undefined) {
    return { maxTokens: ARM_B_DEFAULT_MAX_TOKENS, taskBudget: null, betas: [] };
  }
  const taskBudget = Math.max(TASK_BUDGET_MIN_TOKENS, budget);
  const maxTokens = Math.min(ARM_B_MAX_TOKENS_CEILING, Math.max(ARM_B_DEFAULT_MAX_TOKENS, Math.ceil(taskBudget * 1.2)));
  return { maxTokens, taskBudget, betas: [TASK_BUDGETS_BETA] };
}

export const runArmB: ArmRunner = async (input) => {
  const out = emptyOutput();
  const plan = armBTokenPlan(input.bTokenBudget);
  const result = await input.client.call({
    purpose: "arm-b-draft",
    model: input.models.B.model,
    system: input.prompts.armB.body,
    userContent: briefUserContent(input.brief),
    maxTokens: plan.maxTokens,
    thinking: { type: "adaptive" },
    outputConfig: {
      effort: input.models.B.effort,
      ...(plan.taskBudget !== null ? { task_budget: { type: "tokens", total: plan.taskBudget } } : {}),
    },
    betas: plan.betas,
  });
  out.calls.push(buildCallRecord("arm-b-draft", input.models.B.model, result));
  try {
    out.candidate = extractJson(result.text);
  } catch (err) {
    out.failure = { stage: "arm-b-parse", message: (err as Error).message };
  }
  return out;
};
