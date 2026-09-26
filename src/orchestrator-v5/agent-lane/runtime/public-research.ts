/**
 * ⭐ PUBLIC RESEARCH, SLICE R1 — one approved public query → one native web search → a finding with its sources
 * (DL #70 5849401101: "Product slice (research → source-linked answer → authorised evidence persistence/reload):
 * after PAUL_TEST_NOW, Runtime owns it"; seam 5849869441; design and reader from AI Experience's handoff,
 * programme-docs `bcd02347…/openai/ai-experience/2026-09-26/native-evidence/evidence-adapter.mjs`).
 *
 * ⛔ THE DISCLOSURE DECISION IS THE USER'S CLICK. Nothing leaves Olumi but the one query the user saw on the chip:
 * no model, no history, no brief. The chip's id carries a hash of that exact query, so a click can only ever send
 * the words it showed (`approvedQueryOf`). Words typed in chat never search.
 *
 * ⛔ A CITATION IDENTIFIES A SOURCE; IT DOES NOT PROVE THE SENTENCE. Sources come only from the response's own
 * `url_citation` annotations, each bound to a URL the search itself consulted. None is invented, and the reply says
 * what a citation does and does not establish. Every other outcome is a plain-words failure that describes no finding.
 *
 * Pure: no network, no store. The route owns the call, the provider policy and persistence (the reply text is what
 * the answer row keeps, so a reload shows the same sources).
 */
import { createHash } from 'node:crypto';

/** Hosted search calls one research request may make (the handoff's `max_tool_calls`). */
export const RESEARCH_MAX_TOOL_CALLS = 3;
export const RESEARCH_MAX_OUTPUT_TOKENS = 1_500;
/** A query longer than this is not one a user can read on a chip before sending it. */
export const RESEARCH_QUERY_MAX_CHARS = 200;
export const RESEARCH_CHIP_PREFIX = 'agent-public-research:';

export const RESEARCH_INSTRUCTIONS = [
  'You research one public question for a decision-maker. Search the web, then answer in a few short sentences.',
  'Cite every factual claim with the web sources you used. Say where sources disagree.',
  'If you cannot find a reliable source, say so plainly instead of answering from memory.',
  // The chat renders no tables (NE-02, AI Conversation 5849971004: a table arrived as raw pipes in a 319px panel).
  'Never use a table; use short bullet points.',
  'You know nothing about the user or their model beyond the question itself.',
].join(' ');

/** The exact words a query is sent as: one line, trimmed, within the chip's readable length. `null` = not sendable. */
export function sendableQuery(query: unknown): string | null {
  if (typeof query !== 'string') return null;
  const q = query.replace(/\s+/gu, ' ').trim();
  return q === '' || q.length > RESEARCH_QUERY_MAX_CHARS ? null : q;
}

const queryId = (q: string): string => createHash('sha256').update(q, 'utf8').digest('hex').slice(0, 16);
const chipMessage = (q: string): string => `Search the web for: “${q}”`;

/** The one control that sends a query: its label is short, its `detail` says exactly what leaves Olumi. */
export function researchChipFor(query: string): { id: string; label: string; message: string; detail: string } | null {
  const q = sendableQuery(query);
  if (q === null) return null;
  return {
    id: `${RESEARCH_CHIP_PREFIX}${queryId(q)}`,
    label: 'Search the web',
    message: chipMessage(q),
    detail: `Only these words are sent to a public web search: “${q}”. Nothing from your model or this conversation is sent.`,
  };
}

/** The query a click approved: the message's query, only when it is the one the chip's id was made for. */
export function approvedQueryOf(chipId: unknown, message: unknown): string | null {
  if (typeof chipId !== 'string' || !chipId.startsWith(RESEARCH_CHIP_PREFIX) || typeof message !== 'string') return null;
  const m = /^Search the web for: “(.*)”$/su.exec(message.trim());
  const q = m === null ? null : sendableQuery(m[1]);
  return q !== null && chipMessage(q) === message.trim() && `${RESEARCH_CHIP_PREFIX}${queryId(q)}` === chipId ? q : null;
}

/** The ONE Responses request: the approved query only, native web search required and bounded, sources included. */
export function researchRequestBody(query: string, model: string): Record<string, unknown> {
  return {
    model,
    instructions: RESEARCH_INSTRUCTIONS,
    input: [{ role: 'user', content: [{ type: 'input_text', text: query }] }],
    max_output_tokens: RESEARCH_MAX_OUTPUT_TOKENS,
    store: false,
    tools: [{ type: 'web_search' }],
    tool_choice: 'required',
    include: ['web_search_call.action.sources'],
    max_tool_calls: RESEARCH_MAX_TOOL_CALLS,
  };
}

export type ResearchFailure =
  | 'research_not_performed' | 'research_incomplete' | 'response_not_complete' | 'response_unreadable'
  | 'provider_refusal' | 'citation_unreadable' | 'citation_not_bound_to_search' | 'empty_answer' | 'no_cited_finding';

export type ResearchOutcome =
  | { readonly status: 'cited_finding'; readonly text: string; readonly sources: readonly { readonly url: string; readonly title: string }[] }
  | { readonly status: ResearchFailure };

const record = (x: unknown): Record<string, unknown> | null => (x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null);

/** A clickable http(s) link, fragment dropped — link validation only, never a fetch. */
function sourceUrl(value: unknown): string | null {
  // No space or control character anywhere (code points up to U+0020).
  if (typeof value !== 'string' || value === '' || [...value].some((ch) => (ch.codePointAt(0) ?? 0) <= 0x20)) return null;
  try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || u.username !== '' || u.password !== '' || u.hostname === '') return null;
    u.hash = '';
    return u.href;
  } catch { return null; }
}

/**
 * Read the native response (the handoff's `completeEvidenceRequest`, research branch). On the wire (NE-02, `gpt-5.6-terra`)
 * each `url_citation` spans the model's own inline link, "([sandhill.com](https://…))": that span is REPLACED by its number,
 * numbered by first appearance, the same URL keeping one number, so a source is shown once. Any markdown link the provider
 * did not annotate is reduced to its words, so every clickable link in the reply is one the search consulted.
 */
export function readResearchResponse(response: unknown): ResearchOutcome {
  const r = record(response);
  if (r === null || r.status !== 'completed' || r.error != null || r.incomplete_details != null) return { status: 'response_not_complete' };
  if (!Array.isArray(r.output)) return { status: 'response_unreadable' };
  const searches = r.output.map(record).filter((o): o is Record<string, unknown> => o !== null && o.type === 'web_search_call');
  if (!searches.some((s) => s.status === 'completed')) return { status: 'research_not_performed' };
  const consulted = new Set<string>();
  for (const s of searches) {
    if (s.status !== 'completed') return { status: 'research_incomplete' };
    const rows = record(s.action)?.sources;
    if (rows !== undefined && !Array.isArray(rows)) return { status: 'response_unreadable' };
    for (const row of (rows as unknown[] | undefined) ?? []) {
      const u = sourceUrl(record(row)?.url);
      if (u !== null) consulted.add(u);
    }
  }
  const sources: { url: string; title: string }[] = [];
  const numberOf = new Map<string, number>();
  const texts: string[] = [];
  for (const item of r.output) {
    const it = record(item);
    if (it === null) return { status: 'response_unreadable' };
    if (it.type === 'reasoning' || it.type === 'web_search_call') continue;
    if (it.type !== 'message') return { status: 'response_unreadable' };
    if (it.status !== 'completed' || it.role !== 'assistant' || !Array.isArray(it.content)) return { status: 'response_not_complete' };
    for (const c of it.content) {
      const part = record(c);
      if (part?.type === 'refusal') return { status: 'provider_refusal' };
      if (part?.type !== 'output_text' || typeof part.text !== 'string') return { status: 'response_unreadable' };
      const text = part.text;
      if (part.annotations !== undefined && !Array.isArray(part.annotations)) return { status: 'citation_unreadable' };
      const marks: { start: number; end: number; n: number }[] = [];
      for (const a of (part.annotations as unknown[] | undefined) ?? []) {
        const ann = record(a);
        if (ann?.type !== 'url_citation') continue;
        const u = sourceUrl(ann.url);
        if (u === null || !consulted.has(u)) return { status: 'citation_not_bound_to_search' };
        const start = ann.start_index;
        const end = ann.end_index;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || (start as number) < 0 || (end as number) < (start as number) || (end as number) > text.length) {
          return { status: 'citation_unreadable' };
        }
        let n = numberOf.get(u);
        if (n === undefined) {
          n = sources.length + 1;
          numberOf.set(u, n);
          const title = typeof ann.title === 'string' && ann.title.trim() !== '' ? ann.title.trim() : new URL(u).hostname;
          sources.push({ url: u, title });
        }
        marks.push({ start: start as number, end: end as number, n });
      }
      // Replace from the end so every earlier index still addresses the original text; overlapping spans are unreadable.
      const ordered = [...marks].sort((x, y) => y.start - x.start);
      if (ordered.some((m, i) => i > 0 && m.end > ordered[i - 1]!.start)) return { status: 'citation_unreadable' };
      let out = text;
      for (const m of ordered) out = `${out.slice(0, m.start)}[${m.n}]${out.slice(m.end)}`;
      texts.push(out.replace(/\[([^\]\n]*)\]\((?:https?:)?\/\/[^)\s]*\)/gu, '$1'));
    }
  }
  const text = texts.join('\n\n').trim();
  if (text === '') return { status: 'empty_answer' };
  if (sources.length === 0) return { status: 'no_cited_finding' };
  return { status: 'cited_finding', text, sources };
}

/** What the user reads for every outcome; a failure describes no finding. */
const FAILURE_WORDS: Record<ResearchFailure, string> = {
  research_not_performed: 'The web search did not run, so no outside evidence was checked. Nothing was found or concluded.',
  research_incomplete: 'The web search did not finish, so no finding is shown.',
  response_not_complete: 'The research did not finish, so no finding is shown, not even a partial one.',
  response_unreadable: 'The research came back in a form Olumi could not read, so no finding is shown.',
  provider_refusal: 'The research service declined this question, so nothing was searched or concluded.',
  citation_unreadable: 'The research came back with sources Olumi could not match to its text, so no finding is shown.',
  citation_not_bound_to_search: 'The research cited a source the search did not consult, so no finding is shown.',
  empty_answer: 'The search ran but returned no answer, so nothing was concluded.',
  no_cited_finding: 'The search ran but returned no finding tied to a source. That is not evidence that none exists.',
};

export function researchReplyText(query: string, outcome: ResearchOutcome): string {
  const asked = `I searched the web for “${query}”.`;
  if (outcome.status !== 'cited_finding') return `${asked} ${FAILURE_WORDS[outcome.status]}`;
  // The chat renders ONLY `[title](url)` as a link (UI `safeRichText.ts`, AI Conversation 5849915005): a title with `]`
  // or a line break, or a URL with `)`, falls back to literal markdown — so both are made safe here.
  const list = outcome.sources.map((s, i) => `${i + 1}. [${s.title.replace(/[[\]\r\n]+/gu, ' ').replace(/\s+/gu, ' ').trim()}](${s.url.replace(/\(/gu, '%28').replace(/\)/gu, '%29')})`).join('\n');
  return `${asked}\n\n${outcome.text}\n\n**Sources**\n${list}\n\n`
    + 'Each number points to the page a statement came from; it does not prove the statement. Nothing in your model was changed. '
    + 'If this should change an assumption, say which and I will propose it for your approval.';
}
