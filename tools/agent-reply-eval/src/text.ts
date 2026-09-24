/**
 * Text measurement for one reply.
 *
 * REUSE, NOT COPY: word / sentence / bullet / question counts come from the
 * conversation harness's own PQ1 (brevity) and PQ2 (question-asking) dims,
 * through an adapter that builds the harness `TurnRow` with the harness's own
 * `rowFromWire`. So "words" here means exactly what PQ1 means by words, and a
 * change to that definition moves both tools together.
 *
 * The only local additions are what PQ1/PQ2 do not do: markdown is stripped
 * before counting words (so a `-` bullet marker or a `**` is not a word), and
 * the reply is split into the MODEL's paragraphs and the SERVER's paragraphs.
 */
import { rowFromWire } from '../../conversation-harness/scorer/dims.js';
import { pqBrevityDensity, pqQuestionAsking } from '../../conversation-harness/scorer/prompt-dims.js';
import { PLACEHOLDER_STRENGTH_DISCLOSURE } from '../../../src/orchestrator-v5/agent-lane/disclosure.js';
import type { ReplyView } from './wire.js';

/** Visible words: markdown emphasis, heading hashes, quote and bullet markers removed. */
export function visibleText(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*•]\s+|\d+[.)]\s+)/, '')
        .replace(/\*\*|__|`/g, '')
        .replace(/(^|\s)[*_](\S)/g, '$1$2')
        .replace(/(\S)[*_](?=\s|$|[.,;:!?])/g, '$1'),
    )
    .join('\n');
}

interface Counts {
  readonly words: number;
  readonly sentences: number;
  readonly bullets: number;
  readonly questions: number;
}

/** PQ1 + PQ2 counts for one text, via the harness's own row builder and dims. */
export function countsOf(text: string): Counts {
  if (text.trim() === '') return { words: 0, sentences: 0, bullets: 0, questions: 0 };
  const coach = { turn_class_hint: 'coach' };
  const plain = rowFromWire('t', { assistant_text: visibleText(text) }, coach);
  const raw = rowFromWire('t', { assistant_text: text }, coach);
  const pq1Plain = (pqBrevityDensity([plain]).details.perTurn as { words: number; sentences: number }[])[0];
  const pq1Raw = (pqBrevityDensity([raw]).details.perTurn as { bullets: number }[])[0];
  const pq2 = (pqQuestionAsking([raw]).details.perTurn as { questions: number }[])[0];
  return {
    words: pq1Plain?.words ?? 0,
    sentences: pq1Plain?.sentences ?? 0,
    bullets: pq1Raw?.bullets ?? 0,
    questions: pq2?.questions ?? 0,
  };
}

// ---------- server-authored text ----------

/**
 * Paragraph openers the SERVER writes (src/orchestrator-v5/agent-lane/write-outcome.ts
 * `statusLine` / `partsLine` / `notAdoptedLine`, disclosure.ts, and the route's
 * hop-limit line). The route appends them AFTER the model's text, each joined by
 * a blank line (`withDisclosures`, then `withWriteOutcome`), so they are peeled
 * off the END of the reply only.
 */
const SERVER_PARAGRAPH = [
  /^The model was saved(?: as version \d+)?\./,
  /^This model had already been built/,
  /^The model was not built:/,
  /^Saved(?: \d+ of \d+ | as versions? |\.)/,
  /^Not saved:/,
  /^Partly saved/,
  /^That change was already saved/,
  /^Nothing was saved this turn\./,
  /^Not included in this proposal:/,
  /^Note: (?:the model did not store|the analysis needed a range|the analysis still needs a range|this turn recorded changes|when those writes went in)/,
  /^I was not able to finish that within this turn\./,
];

const isServerParagraph = (p: string): boolean => {
  const s = p.trim();
  return s.startsWith(PLACEHOLDER_STRENGTH_DISCLOSURE.slice(0, 40)) || SERVER_PARAGRAPH.some((r) => r.test(s));
};

export type SplitBasis =
  | 'fast_path_approve'
  | 'forwarded_no_llm'
  | 'run_without_model_call'
  | 'trailing_server_paragraphs'
  | 'no_server_paragraph';

export interface TextSplit {
  readonly modelText: string;
  readonly serverText: string;
  readonly basis: SplitBasis;
}

/**
 * Split the final reply into the model's words and the server's words.
 *
 * ⚠ The model half is an ESTIMATE: the server has already removed any sentence
 * that claimed a completed write (`_diagnostic_trace.write_claims_removed`) and
 * rewritten proposal ids, so the raw model output is not recoverable from a
 * capture. What is certain is the zero-model-call cases, where every word is
 * the server's.
 */
export function splitServerText(v: ReplyView): TextSplit {
  const text = v.text;
  if (v.fastPath === 'approve') return { modelText: '', serverText: text, basis: 'fast_path_approve' };
  if (v.exitPath === 'agent_lane_forwarded' && (v.providerCalls ?? 0) === 0 && (v.forwardedLlmCalls ?? 0) === 0) {
    return { modelText: '', serverText: text, basis: 'forwarded_no_llm' };
  }
  if (v.fastPath === 'run' && v.providerCalls === 0 && !v.replayed) {
    return { modelText: '', serverText: text, basis: 'run_without_model_call' };
  }
  const paragraphs = text.split(/\n{2,}/);
  let cut = paragraphs.length;
  while (cut > 0 && isServerParagraph(paragraphs[cut - 1]!)) cut -= 1;
  if (cut === paragraphs.length) return { modelText: text, serverText: '', basis: 'no_server_paragraph' };
  return {
    modelText: paragraphs.slice(0, cut).join('\n\n'),
    serverText: paragraphs.slice(cut).join('\n\n'),
    basis: 'trailing_server_paragraphs',
  };
}

// ---------- sentences and clauses ----------

export type Where = 'model' | 'server';

export interface Sentence {
  readonly text: string;
  readonly where: Where;
  readonly isBullet: boolean;
  /** For a bullet line: the nearest preceding non-bullet line (its list header). */
  readonly header: string | null;
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

/**
 * Sentences: lines, then the production write narrator's `(?<=[.!?])\s+` — widened
 * so a terminator inside closing emphasis or a closing quote (`…developers.** Hiring`)
 * still ends the sentence. Without that, a bold opening sentence swallowed the next
 * one, and a negation in the first ("cannot distinguish") hid a claim in the second.
 */
export function sentencesOf(text: string, where: Where): Sentence[] {
  const out: Sentence[] = [];
  let header: string | null = null;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const isBullet = BULLET.test(line);
    if (!isBullet) header = line.trim();
    for (const s of line.replace(BULLET, '').split(/(?<=[.!?](?:\*\*|["”’)])*)\s+/)) {
      if (s.trim() !== '') out.push({ text: s.trim(), where, isBullet, header: isBullet ? header : null });
    }
  }
  return out;
}

export function sentencesOfSplit(split: TextSplit): Sentence[] {
  return [...sentencesOf(split.modelText, 'model'), ...sentencesOf(split.serverText, 'server')];
}

/**
 * Clauses: a contrastive or list boundary starts a new claim ("X leads, but it is a near tie").
 * `colon: false` keeps "Label: value" together — figure binding needs the label and its value
 * in one segment; a ranking claim after "**Finding:**" needs the colon split.
 */
export function clausesOf(sentence: string, opts: { colon: boolean } = { colon: true }): string[] {
  const boundary = opts.colon
    ? /[;:—–]|,\s*(?=(?:but|while|whereas|although|though|not|so|yet)\b)|\s+(?=(?:but|whereas|although|though)\b)|\bwhile\b/i
    : /[;—–]|,\s*(?=(?:but|while|whereas|although|though|not|so|yet)\b)|\s+(?=(?:but|whereas|although|though)\b)|\bwhile\b/i;
  return sentence
    .split(boundary)
    .map((c) => c.trim())
    .filter((c) => c !== '');
}

/** Lower-case, markdown/quote-free, whitespace-collapsed — for label matching. */
export function norm(s: string): string {
  return s
    .replace(/\*\*|__|`/g, '')
    .replace(/[“”"‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A short verbatim excerpt for a report: markdown emphasis dropped, whitespace collapsed, clipped. */
export function excerpt(s: string, max = 160): string {
  const t = s.replace(/\*\*/g, '').replace(/\s+/g, ' ').replace(/^[\s*:]+/, '').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
