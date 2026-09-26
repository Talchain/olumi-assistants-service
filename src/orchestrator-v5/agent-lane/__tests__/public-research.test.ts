/**
 * ⭐ PUBLIC RESEARCH R1 — the pure half (seam #70 5849869441). One approved query → one native web search → a finding
 * whose every source is a URL the search consulted, or a plain-words failure that describes no finding.
 *
 * ⚠ FIXTURE: SYNTHETIC, shaped on the Responses API's documented `web_search_call` + `url_citation` output (the
 * handoff's reader tests use the same shape). It re-binds to AI Conversation's native NE-02 research capture when that
 * exists; until then these rows prove the reader's rules, not the wire.
 */
import { describe, it, expect } from 'vitest';
import {
  approvedQueryOf, readResearchResponse, researchChipFor, researchReplyText, researchRequestBody, sendableQuery,
  RESEARCH_MAX_TOOL_CALLS,
} from '../runtime/public-research.js';

const Q = 'typical churn after a SaaS price rise from £49 to £59 per month';
const TEXT = 'Price rises of around 20% usually raise monthly churn by one to three points. Annual plans soften it.';
const A = 'https://example.org/saas-pricing-study';
const B = 'https://example.com/churn-benchmarks#table';

function native(opts: { searches?: unknown[]; annotations?: unknown[]; status?: string; content?: unknown[] } = {}) {
  return {
    id: 'resp_synthetic', status: opts.status ?? 'completed', error: null, incomplete_details: null,
    output: [
      ...(opts.searches ?? [{ type: 'web_search_call', status: 'completed', action: { type: 'search', query: Q, sources: [{ type: 'url', url: A }, { type: 'url', url: B }] } }]),
      { type: 'message', role: 'assistant', status: 'completed', content: opts.content ?? [{
        type: 'output_text', text: TEXT,
        annotations: opts.annotations ?? [
          { type: 'url_citation', url: A, title: 'SaaS pricing study', start_index: 0, end_index: 77 },
          { type: 'url_citation', url: 'https://example.com/churn-benchmarks', title: 'Churn benchmarks', start_index: 78, end_index: TEXT.length },
        ],
      }] },
    ],
    usage: { input_tokens: 10, output_tokens: 40 },
  };
}

describe('the click is the disclosure: only the query the chip showed can be sent', () => {
  it('the chip\'s own message, sent from the chip, yields exactly its query', () => {
    const chip = researchChipFor(Q)!;
    expect(chip.label).toBe('Search the web');
    expect(chip.detail).toContain(`“${Q}”`);
    expect(chip.detail).toContain('Nothing from your model or this conversation is sent.');
    expect(approvedQueryOf(chip.id, chip.message)).toBe(Q);
  });

  it('RED: another query under that chip\'s id, the same words typed with no chip, or another chip\'s id → nothing is sent', () => {
    const chip = researchChipFor(Q)!;
    expect(approvedQueryOf(chip.id, 'Search the web for: “our Pro plan MRR is £12,000”')).toBeNull();
    expect(approvedQueryOf(undefined, chip.message)).toBeNull();
    expect(approvedQueryOf('agent-run-analysis', chip.message)).toBeNull();
    expect(approvedQueryOf(chip.id, `${chip.message} and our MRR`)).toBeNull();
  });

  it('a query no one can read on a chip is not sendable (empty, or over the limit)', () => {
    expect(sendableQuery('   ')).toBeNull();
    expect(sendableQuery('x'.repeat(201))).toBeNull();
    expect(researchChipFor('x'.repeat(201))).toBeNull();
    expect(sendableQuery('  two\n lines ')).toBe('two lines');
  });
});

describe('the ONE request carries the approved query and nothing else', () => {
  it('input is the query alone; native web search is required and bounded; sources are included; nothing is stored', () => {
    const body = researchRequestBody(Q, 'gpt-5.6-terra');
    expect(body.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: Q }] }]);
    expect(body).toMatchObject({
      tools: [{ type: 'web_search' }], tool_choice: 'required', include: ['web_search_call.action.sources'],
      max_tool_calls: RESEARCH_MAX_TOOL_CALLS, store: false,
    });
    expect(JSON.stringify(body.instructions)).not.toMatch(/graph|model you|brief/i);
  });
});

describe('the reader: every source is one the search consulted; anything else describes no finding', () => {
  it('RED: a completed search with bound citations → the finding, numbered at the provider\'s own positions, one number per URL', () => {
    const out = readResearchResponse(native());
    expect(out.status).toBe('cited_finding');
    if (out.status !== 'cited_finding') return;
    expect(out.text).toBe('Price rises of around 20% usually raise monthly churn by one to three points. [1] Annual plans soften it. [2]');
    // The fragment is dropped before binding: B was consulted as …#table and cited without it.
    expect(out.sources).toEqual([{ url: A, title: 'SaaS pricing study' }, { url: 'https://example.com/churn-benchmarks', title: 'Churn benchmarks' }]);
  });

  it('RED: a citation to a page the search never consulted → no finding (citation_not_bound_to_search)', () => {
    expect(readResearchResponse(native({ annotations: [{ type: 'url_citation', url: 'https://elsewhere.net/x', title: 'x', start_index: 0, end_index: 5 }] })).status)
      .toBe('citation_not_bound_to_search');
  });

  it('RED: no search ran (an answer from memory) → research_not_performed, whatever the text says', () => {
    expect(readResearchResponse(native({ searches: [] })).status).toBe('research_not_performed');
  });

  it('an answer with no citation → no_cited_finding; an unfinished response → response_not_complete; a refusal → provider_refusal', () => {
    expect(readResearchResponse(native({ annotations: [] })).status).toBe('no_cited_finding');
    expect(readResearchResponse(native({ status: 'incomplete' })).status).toBe('response_not_complete');
    expect(readResearchResponse(native({ content: [{ type: 'refusal', refusal: 'no' }] })).status).toBe('provider_refusal');
    expect(readResearchResponse(native({ annotations: [{ type: 'url_citation', url: A, title: 't', start_index: 5, end_index: 999 }] })).status).toBe('citation_unreadable');
  });
});

describe('what the user reads', () => {
  it('a finding: the query, the text, a numbered source list, and what a citation does not establish', () => {
    const said = researchReplyText(Q, readResearchResponse(native()));
    expect(said.startsWith(`I searched the web for “${Q}”.`)).toBe(true);
    expect(said).toContain(`1. [SaaS pricing study](${A})`);
    expect(said).toContain('it does not prove the statement');
    expect(said).toContain('Nothing in your model was changed.');
  });

  it('a failure describes no finding and never says one exists', () => {
    const said = researchReplyText(Q, { status: 'no_cited_finding' });
    expect(said).toContain('That is not evidence that none exists.');
    expect(said).not.toContain('**Sources**');
    expect(researchReplyText(Q, { status: 'research_not_performed' })).toContain('no outside evidence was checked');
  });
});
