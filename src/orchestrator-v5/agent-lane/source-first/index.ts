import { budgetFor } from '../model-budgets.js';
import type { CallStructuredModel } from '../runtime/build-model.js';
import { compileSourceMeaning, type SourceFirstCompilation } from './compiler.js';
import { buildSourceMeaningSchema, SOURCE_MEANING_INSTRUCTIONS, SourceMeaningSchema } from './meaning.js';

export { compileSourceMeaning, sourceEntityId } from './compiler.js';
export type { SourceFirstCompilation, SourceFinding } from './compiler.js';
export { SourceMeaningSchema, buildSourceMeaningSchema, SOURCE_MEANING_INSTRUCTIONS } from './meaning.js';
export type { SourceMeaning, SourceSpan, SourceQuantity, SourceUnit } from './meaning.js';

/** Producer only. The lead-owned tail validates, registers and reads canonical state. */
export async function buildSourceFirstModel(
  brief: string,
  callStructured: CallStructuredModel,
  config: { model?: string; reasoning_effort?: 'low' | 'medium' | 'high'; max_output_tokens?: number } = {},
): Promise<SourceFirstCompilation & { usage?: Record<string, unknown>; latency_ms: number; meaning: ReturnType<typeof SourceMeaningSchema.parse> }> {
  const budget = budgetFor('gpt-5.6-terra', 'whole');
  const started = Date.now();
  const output = await callStructured({
    model: config.model ?? budget.model,
    reasoning_effort: config.reasoning_effort ?? budget.reasoning_effort,
    max_output_tokens: config.max_output_tokens ?? budget.max_output_tokens,
    instructions: SOURCE_MEANING_INSTRUCTIONS,
    schema: buildSourceMeaningSchema(),
    input: brief,
  });
  if (output.status === 'incomplete') throw new Error(`source_first_incomplete:${output.incomplete_reason ?? 'unspecified'}`);
  if (!output.text.trim()) throw new Error('source_first_no_structured_output');
  const meaning = SourceMeaningSchema.parse(JSON.parse(output.text));
  return { ...compileSourceMeaning(brief, meaning), meaning, usage: output.usage, latency_ms: Date.now() - started };
}
