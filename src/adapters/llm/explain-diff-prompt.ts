/**
 * THE PROVIDER-AGNOSTIC HALF OF `explain_diff`.
 *
 * ⭐ WHY THIS FILE EXISTS RATHER THAN A REFACTOR. `explainDiffWithAnthropic`
 * (`anthropic.ts:3434-3452`) builds this prompt INLINE inside the Anthropic
 * call path. Lifting it out would edit the Conventional provider's code, and
 * the governing brief's hard constraint is that Conventional stays untouched —
 * no provider config change, no prompt migration. So this is a SECOND renderer
 * of the same prompt, deliberately, and the equivalence is pinned by a test
 * instead of by sharing a function.
 *
 * ⚠ THAT MAKES IT A MIRROR, AND MIRRORS DRIFT. The mitigation is stated rather
 * than assumed: `explain-diff-prompt.equivalence.test.ts` holds the expected
 * text copied from `anthropic.ts` at CEE `88934ef7d3195ee1ac7000e5f9d059e884f21955`
 * and REDs if this renderer stops matching it. That is weaker than a derived
 * comparison against the Anthropic function — which is not importable without
 * touching that file — and I would rather say so than imply parity is enforced
 * at the source.
 *
 * ⛔ `explain_diff` HAS NO PMS PROMPT. Unlike `critique_graph`, there is no
 * store-backed system prompt for this task: `model-routing.ts` records it as a
 * "code-constant prompt". So there is no `getSystemPrompt('explain_diff')` to
 * call, and the whole instruction lives here.
 */
import { wrapUntrusted } from './untrusted-envelope.js';
import type { ExplainDiffArgs } from './types.js';

/**
 * The single-message prompt `explainDiffWithAnthropic` sends, byte for byte.
 *
 * Anthropic sends this as ONE user message with no system prompt at all. The
 * OpenAI adapter reaches the provider through `chat()`, whose `ChatArgs.system`
 * is a required `string`, so it pairs this body with `EXPLAIN_DIFF_SYSTEM`
 * below. The SEMANTIC content is unchanged; only the message split differs, and
 * that divergence is recorded here rather than left for a reader to discover.
 */
export function buildExplainDiffUserContent(
  args: Pick<ExplainDiffArgs, 'patch' | 'brief' | 'graph_summary'>,
): string {
  return `You are explaining why changes were made to a decision graph.

Given this patch:
${JSON.stringify(args.patch, null, 2)}

${args.brief ? wrapUntrusted('Context:', args.brief) : ''}
${args.graph_summary ? `Graph has ${args.graph_summary.node_count} nodes and ${args.graph_summary.edge_count} edges.` : ''}

Generate a JSON array of rationales explaining why each change was made. Each rationale should have:
- target: the node/edge ID being explained
- why: a concise explanation (≤280 chars)
- provenance_source: optional source indicator (e.g., "user_brief", "hypothesis")

Return ONLY valid JSON in this format:
{
  "rationales": [
    {"target": "node_1", "why": "explanation here", "provenance_source": "user_brief"}
  ]
}`;
}

/**
 * The minimal system half, required because `ChatArgs.system` is a non-optional
 * string.
 *
 * ⚠ It deliberately adds NO instruction the user message does not already
 * carry. It restates only the JSON-only contract, which `responseFormat:
 * 'json_object'` independently enforces — so if this line were dropped the
 * behaviour would be unchanged. Anything more here would be a prompt this
 * provider runs and Anthropic does not, which is exactly the silent divergence
 * a bake-off cannot see.
 */
export const EXPLAIN_DIFF_SYSTEM =
  'You explain changes to a decision graph. Return only valid JSON.';

/** The token cap Anthropic uses for this task. There is no config key for it. */
export const EXPLAIN_DIFF_MAX_TOKENS = 2048;
