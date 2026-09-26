/**
 * ⭐ PUBLIC RESEARCH R1 — the pure half (seam #70 5849869441). One approved query → one native web search → a finding
 * whose every source is a URL the search consulted, or a plain-words failure that describes no finding.
 *
 * FIXTURE: the NATIVE research response AI Conversation captured under NE-20260926-02 (#70 5849971004; gpt-5.6-terra,
 * 3 web_search calls, 4 url_citation annotations — 3 with an EMPTY title — each spanning the model's own inline link).
 * Every failure row is a targeted mutation of that capture.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  approvedQueryOf, readResearchResponse, researchChipFor, researchReplyText, researchRequestBody, sendableQuery,
  RESEARCH_MAX_TOOL_CALLS,
} from '../runtime/public-research.js';

const Q = 'typical churn after a SaaS price rise from £49 to £59 per month';
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
    // The chat renders no table (NE-02: a table arrived as raw pipes); bullets instead.
    expect(String(body.instructions)).toContain('Never use a table; use short bullet points.');
  });
});

const ne02 = (JSON.parse(readFileSync(new URL('./fixtures/native-research-ne02.json', import.meta.url), 'utf8')) as { response: Record<string, unknown> }).response;
/** A deep copy of the capture with one change. */
const mutated = (change: (r: { status: unknown; output: Record<string, unknown>[] }) => void) => {
  const r = structuredClone(ne02) as { status: unknown; output: Record<string, unknown>[] };
  change(r);
  return r;
};
const message = (r: { output: Record<string, unknown>[] }) => r.output.find((o) => o.type === 'message') as { content: { text: string; annotations: Record<string, unknown>[] }[] };

describe('the reader, on the native NE-02 capture: every source is one the search consulted', () => {
  it('RED (native): the finding, each inline cited link REPLACED by its number, one number per URL, no clickable link left in the text', () => {
    const out = readResearchResponse(ne02);
    expect(out.status).toBe('cited_finding');
    if (out.status !== 'cited_finding') return;
    // 4 annotations, 3 URLs (saasmag.com is cited twice).
    expect(out.sources).toEqual([
      { url: 'https://sandhill.com/wp-content/uploads/2023/10/Allied-Advisers-report.pdf', title: 'sandhill.com' },
      { url: 'https://saasmag.com/wp-content/uploads/2018/06/SaaS-Magazine-Issue-1-A4-Digital.pdf', title: 'saasmag.com' },
      // The provider's own URL, kept as it is (utm_source included); the one titled source keeps its title.
      { url: 'https://chartmogul.com/reports/saas-benchmarks-report/saas-benchmarks-report-2023.pdf?utm_source=openai', title: 'ChartMogul_SaaS Benchmark_V11' },
    ]);
    expect(out.text).toContain('it contrasts this with less than 1% for enterprise SaaS. [1] A separate SaaS Magazine');
    expect(out.text).not.toMatch(/\]\(https?:/);
    expect(out.text.match(/\[2\]/g)).toHaveLength(2);
    expect(out.text).toContain('[3]');
  });

  it('RED: a citation to a page the search never consulted → no finding (citation_not_bound_to_search)', () => {
    expect(readResearchResponse(mutated((r) => { message(r).content[0]!.annotations[0]!.url = 'https://elsewhere.net/x'; })).status)
      .toBe('citation_not_bound_to_search');
  });

  it('RED: no search ran (an answer from memory) → research_not_performed, whatever the text says', () => {
    expect(readResearchResponse(mutated((r) => { r.output = r.output.filter((o) => o.type !== 'web_search_call'); })).status).toBe('research_not_performed');
  });

  it('an answer with no citation → no_cited_finding; unfinished → response_not_complete; a refusal → provider_refusal; a span past the text → citation_unreadable', () => {
    expect(readResearchResponse(mutated((r) => { message(r).content[0]!.annotations = []; })).status).toBe('no_cited_finding');
    expect(readResearchResponse(mutated((r) => { r.status = 'incomplete'; })).status).toBe('response_not_complete');
    expect(readResearchResponse(mutated((r) => { (message(r) as { content: unknown[] }).content = [{ type: 'refusal', refusal: 'no' }]; })).status).toBe('provider_refusal');
    expect(readResearchResponse(mutated((r) => { message(r).content[0]!.annotations[0]!.end_index = 99_999; })).status).toBe('citation_unreadable');
  });

  it('a markdown link the provider did NOT annotate is reduced to its words (only bound links stay clickable)', () => {
    const out = readResearchResponse(mutated((r) => { message(r).content[0]!.text += ' See [a blog](https://unbound.example/post).'; }));
    expect(out.status).toBe('cited_finding');
    if (out.status === 'cited_finding') expect(out.text.endsWith(' See a blog.')).toBe(true);
  });
});

describe('what the user reads', () => {
  it('a finding: the query, the text, a numbered source list, and what a citation does not establish', () => {
    const said = researchReplyText(Q, readResearchResponse(ne02));
    expect(said.startsWith(`I searched the web for “${Q}”.`)).toBe(true);
    expect(said).toContain('1. [sandhill.com](https://sandhill.com/wp-content/uploads/2023/10/Allied-Advisers-report.pdf)');
    expect(said).toContain('it does not prove the statement');
    expect(said).toContain('Nothing in your model was changed.');
  });

  it('every source is a link the chat renders: no `]` or line break in a title, `(`/`)` encoded in a URL (UI safeRichText)', () => {
    const said = researchReplyText(Q, { status: 'cited_finding', text: 'x [1]', sources: [{ url: 'https://en.wikipedia.org/wiki/Churn_(business)', title: 'Churn [business]\nrate' }] });
    expect(said).toContain('1. [Churn business rate](https://en.wikipedia.org/wiki/Churn_%28business%29)');
  });

  it('a failure describes no finding and never says one exists', () => {
    const said = researchReplyText(Q, { status: 'no_cited_finding' });
    expect(said).toContain('That is not evidence that none exists.');
    expect(said).not.toContain('**Sources**');
    expect(researchReplyText(Q, { status: 'research_not_performed' })).toContain('no outside evidence was checked');
  });
});
