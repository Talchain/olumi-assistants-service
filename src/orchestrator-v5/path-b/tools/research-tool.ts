/**
 * THIN CORE: Olumi's offer of ONE public web search, the legacy `offer_public_research` on the core lane (21 Oct: making
 * core the staging default, #3522, would otherwise drop it; independent review BLOCK on c898ea6f). Pure: nothing is searched
 * here. The route turns an accepted query into the one control that can send it (`researchChipFor`), and a query is
 * accepted only when that control survives the final egress gate (the route's `researchControlShowableNow`). The words the
 * AI reads are the legacy tool's, verbatim.
 */
import { z } from 'zod-v4';
import { sendableQuery } from '../../agent-lane/runtime/public-research.js';
import { ok, refused, type ToolOutcome } from './outcome.js';

export const OFFER_PUBLIC_RESEARCH = 'offer_public_research';
export const OFFER_PUBLIC_RESEARCH_DESCRIPTION =
  'Offer to search the public web when the user wants outside evidence the model does not hold (a benchmark, a ' +
  'market figure, published research). This searches NOTHING: Olumi shows the user a control with exactly your ' +
  'query, and the search runs only if they press it, as a separate step with the sources shown. Write the query in ' +
  'plain public words; leave out the user’s own figures, names and model details unless they asked you to search ' +
  'for them. Never say you have searched, and never describe results you do not have.';

export const OfferResearchParams = z.object({
  query: z.string().describe('The exact public search question, one line, at most 200 characters.'),
}).strict();

export interface ResearchDeps {
  /** The route's readback through the final egress gate's own chip rule. Absent: every sendable query is accepted. */
  readonly researchShowable?: (query: string) => Promise<boolean>;
}

export async function offerResearch(deps: ResearchDeps, args: z.infer<typeof OfferResearchParams>): Promise<ToolOutcome> {
  const query = sendableQuery(args.query);
  if (query === null) {
    return refused('query_not_sendable', 'That query cannot be offered: write it as one line of at most 200 characters. Nothing was searched.');
  }
  // A control that may not arrive is never promised: a read that throws refuses the offer (fail closed).
  let showable = true;
  if (deps.researchShowable !== undefined) {
    try { showable = (await deps.researchShowable(query)) === true; } catch { showable = false; }
  }
  if (!showable) {
    return refused('query_cannot_be_shown', 'That query cannot be shown as a control here: it reads as putting one option ahead of another, and this '
      + 'analysis names no leading option. The user sees NO control and nothing was searched. Either offer ONE '
      + 'neutral public question that names no option as better, or tell the user that no search is on offer. '
      + 'Never say a control is there.');
  }
  return ok({ offered_query: query,
    detail: 'The user now sees a control that searches the web for exactly this query. Nothing has been searched yet: '
      + 'tell them what the search would look for and that it runs only if they press it.' });
}
