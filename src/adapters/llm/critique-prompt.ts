/**
 * The PROVIDER-AGNOSTIC half of the critique prompt.
 *
 * `buildCritiquePrompt` in `anthropic.ts` returns `{ system, userContent }` where
 * `system` is Anthropic-shaped — `AnthropicSystemBlock[]` carrying `cache_control`
 * — but `userContent` is just the graph, the brief and the focus areas rendered
 * as text. Only that second half is shared, so only that second half lives here.
 *
 * ⚠ WHY THIS IS A SECOND CALL SITE RATHER THAN A REFACTOR, stated plainly.
 * The obvious move is to make `anthropic.ts` import this too, leaving one
 * builder. I have deliberately NOT done that: the brief governing this work says
 * **"Conventional stays untouched — do not change its provider configuration,
 * migrate its prompts, or make a global provider change merely to simplify
 * OpenAI."** Editing the Anthropic critique path to share a helper would be
 * exactly that, for a tidiness gain.
 *
 * ⛔ SO THE DRIFT RISK IS REAL, AND IT IS PINNED RATHER THAN HOPED AWAY.
 * Two renderers of the same text will drift — this estate's own words, from the
 * projection that #1698 unified: *"Two field lists will always drift; one
 * cannot."* `critique-prompt.equivalence.test.ts` asserts this function's output
 * is byte-identical to `__test_only.buildCritiquePrompt`'s `userContent` across a
 * matrix of graphs, briefs and focus areas. If either side is edited alone, that
 * suite REDs by name. That is the trade: two call sites, one enforced invariant,
 * and Conventional's bytes untouched.
 */
import { wrapUntrusted } from './untrusted-envelope.js';
import type { CritiqueGraphArgs } from './types.js';

/**
 * Render the user-facing half of a critique request.
 *
 * ⚠ BYTE-EXACT BY OBLIGATION, not by resemblance. The template below reproduces
 * `anthropic.ts`'s `buildCritiquePrompt` exactly, including the newline that sits
 * between the graph JSON and the brief block, and the two-space `JSON.stringify`
 * indent. A "tidier" rendering here would change the prompt one provider sees and
 * not the other, which is the one thing this file must never do.
 */
export function buildCritiqueUserContent(
  args: Pick<CritiqueGraphArgs, 'graph' | 'brief' | 'focus_areas'>,
): string {
  const graphJson = JSON.stringify(
    {
      nodes: args.graph.nodes,
      edges: args.graph.edges,
    },
    null,
    2,
  );

  // The brief is USER TEXT reaching a model, so it keeps the untrusted envelope.
  // Dropping it here would hand one provider an unwrapped brief while the other
  // wraps it — a prompt-injection asymmetry, not a formatting difference.
  const briefContext = args.brief ? '\n\n' + wrapUntrusted('## Original Brief', args.brief) : '';
  const focusContext = args.focus_areas?.length
    ? `\n\n## Focus Areas\nPrioritize issues in: ${args.focus_areas.join(', ')}`
    : '';

  return `## Graph to Critique
${graphJson}
${briefContext}${focusContext}`;
}
