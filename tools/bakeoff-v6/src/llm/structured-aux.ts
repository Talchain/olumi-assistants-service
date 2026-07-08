/**
 * Mirror of the live adapter's STRUCTURED_OUTPUTS_AUX_STRING_REMINDER
 * (src/adapters/llm/anthropic.ts:296), appended to the M1 user turn on grammar
 * arms (A, C-M1) so the model JSON-ENCODES the v8-stringified aux fields
 * (coaching / causal_claims / topology_plan) that the grammar constrains to
 * `{ type: "string" }`.
 *
 * This is a VERSION-INDEPENDENT ADAPTER concern, not part of the benchmark
 * system prompt. The served system prompt (v187/v194) and the benchmark
 * candidate prompts describe object/array shapes; the adapter appends this
 * override under structured outputs and de-stringifies the result on ingress.
 * Keeping it in the harness (not the prompt) keeps the benchmark prompt aligned
 * with the served prompt.
 */
export const STRUCTURED_OUTPUTS_AUX_STRING_REMINDER = `\n\nOUTPUT FORMAT OVERRIDE (structured mode):
Emit "coaching", "causal_claims", and "topology_plan" as JSON-encoded STRINGS.
Each must contain exactly the JSON value the schema instructions describe
(coaching object, causal_claims array, topology_plan string array), serialised
with correctly escaped quotes. Example: "topology_plan": "[\\"line 1\\",\\"line 2\\"]".`;
