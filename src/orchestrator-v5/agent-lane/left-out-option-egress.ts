/**
 * Q6 (DL 58e392 scope ruling, 8 Oct, #2810): when a reply NAMES an option the Run left out, the deterministic correction is
 * appended next to it. NOTHING is removed: no claim parsing, no negation logic (three review rounds showed sentence-level
 * claim parsing does not converge). The narrator-input fix (the sent roster as typed input) is on Paul's morning list.
 */
import { log } from '../../utils/telemetry.js';
import { runOptionSetForCopy, type LeftOutRunOption, type RecordedRunOption, type RecordedRunOptionSet } from '../tools/handlers/option-participation.js';
import { openQuestionsSegment } from './decision-input-ask.js';

export const LEFT_OUT_OPTION_CORRECTION_APPENDED = 'LEFT_OUT_OPTION_CORRECTION_APPENDED';

/** All runs inside a regex are bounded. */
export const LEFT_OUT_COPY_REGEXES = {
  singleQuotes: /[‘’‚‛]/g,
  doubleQuotes: /[“”„‟]/g,
  figure: /(?<![\p{L}\p{N}_£$€])(?:[£$€][ \t]{0,3})?\d{1,16}(?:,\d{3}){0,4}(?:\.\d{1,8})?(?:[ \t]{0,3}%)?(?![\p{L}\p{N}_%]|[.,]\d)/gu,
  figureSpace: /[ \t]{1,3}/g,
  word: /[\p{L}\p{N}_]/u,
  wordToken: /[\p{L}\p{N}_]{1,128}(?:[-‐‑][\p{L}\p{N}_]{1,128}){0,16}/gu,
  letter: /\p{L}/u,
};

const fold = (s: string): string => s.replace(LEFT_OUT_COPY_REGEXES.singleQuotes, "'")
  .replace(LEFT_OUT_COPY_REGEXES.doubleQuotes, '"').toLowerCase();
const figuresOf = (s: string): Set<string> => new Set([...s.matchAll(LEFT_OUT_COPY_REGEXES.figure)]
  .map((m) => m[0].replace(LEFT_OUT_COPY_REGEXES.figureSpace, '')));
const exactLabelAt = (text: string, label: string, at: number): boolean => {
  const before = text[at - 1];
  const after = text[at + label.length];
  return (before === undefined || !LEFT_OUT_COPY_REGEXES.word.test(before) || !LEFT_OUT_COPY_REGEXES.word.test(label[0]!))
    && (after === undefined || !LEFT_OUT_COPY_REGEXES.word.test(after) || !LEFT_OUT_COPY_REGEXES.word.test(label.at(-1)!));
};
const exactLabelIn = (text: string, label: string): boolean => {
  let at = text.indexOf(label);
  while (at !== -1) {
    if (exactLabelAt(text, label, at)) return true;
    at = text.indexOf(label, at + Math.max(1, label.length));
  }
  return false;
};
/** Mask only full names, never a substring of a longer word (`Test` inside `tested`). */
const maskLabelIn = (text: string, label: string): string => {
  const pieces: string[] = [];
  let copied = 0;
  let at = text.indexOf(label);
  while (at !== -1) {
    if (exactLabelAt(text, label, at)) {
      pieces.push(text.slice(copied, at), ' '.repeat(label.length));
      copied = at + label.length;
    }
    at = text.indexOf(label, at + Math.max(1, label.length));
  }
  return copied === 0 ? text : [...pieces, text.slice(copied)].join('');
};

const OPTION_NOUNS = new Set(['option', 'test', 'variant', 'plan', 'tier', 'price', 'offer']);
const LABEL_STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'at', 'as', 'by',
  'with', 'without', 'from', 'per', 'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were', 'be', 'it']);
interface Span { readonly start: number; readonly end: number }
interface WordToken extends Span { readonly word: string }
interface FigureContext extends Span { readonly figure: string; readonly nearby: readonly WordToken[] }
interface NamedOption extends LeftOutRunOption {
  readonly label: string; readonly folded: string; readonly figures: readonly string[]; readonly contentWords: ReadonlySet<string>;
}
const wordsOf = (text: string): WordToken[] => [...text.matchAll(LEFT_OUT_COPY_REGEXES.wordToken)]
  .map((m) => ({ start: m.index!, end: m.index! + m[0].length, word: m[0] }));
/** At most two word-token positions on either side; a hyphenated word occupies one position. */
function figureContextsOf(text: string): FigureContext[] {
  const words = wordsOf(text);
  let cursor = 0;
  return [...text.matchAll(LEFT_OUT_COPY_REGEXES.figure)].map((m) => {
    const start = m.index!;
    const end = start + m[0].length;
    while (cursor < words.length && words[cursor]!.end <= start) cursor += 1;
    let after = cursor;
    while (after < words.length && words[after]!.start < end) after += 1;
    return { start, end, figure: m[0].replace(LEFT_OUT_COPY_REGEXES.figureSpace, ''),
      nearby: [...words.slice(Math.max(0, cursor - 2), cursor), ...words.slice(after, after + 2)] };
  });
}
/** Exact label OR an exclusive figure next to a word of that label/an option noun. Bare figures never refer. */
function referentIn(text: string, option: NamedOption, figures: readonly FigureContext[]): { referred: boolean; spans: Span[] } {
  const spans: Span[] = [];
  for (const figure of figures) {
    if (!option.figures.includes(figure.figure)) continue;
    const ownWords = figure.nearby.filter((token) => OPTION_NOUNS.has(token.word) || option.contentWords.has(token.word));
    if (ownWords.length > 0) spans.push(figure, ...ownWords);
  }
  return { referred: exactLabelIn(text, option.folded) || spans.length > 0, spans };
}
/** The one correction per left-out reason (DL 58e392 kept its wording unchanged). */
export function leftOutOptionSentence(o: LeftOutRunOption & { label: string }): string {
  return o.reason === 'olumi_proposed'
    ? `‘${o.label}’ is Olumi’s suggestion, so it was left out of this comparison until you add it.`
    : `‘${o.label}’ was left out of this comparison.`;
}

/** Pure: the corrections owed for every left-out option this text NAMES, appended once each; nothing else changes. */
export function appendLeftOutOptionCorrections(
  text: string,
  leftOut: readonly LeftOutRunOption[],
  sent: readonly RecordedRunOption[],
): { readonly text: string; readonly appended: number; readonly optionIds: readonly string[] } {
  const named = leftOutOptionsNamedIn([text], leftOut, sent);
  const lines = named.map(leftOutOptionSentence).filter((line) => !fold(text).includes(fold(line)));
  if (lines.length === 0) return { text, appended: 0, optionIds: [] };
  // Before a trailing Open Questions segment, as whole paragraphs (P02's methodReplySurvives keeps a clean method reply).
  const questions = openQuestionsSegment(text);
  const at = questions === null ? -1 : text.lastIndexOf(questions.segment);
  const body = at === -1 ? text.trimEnd() : text.slice(0, at).trimEnd();
  const edited = [body, ...lines, ...(at === -1 ? [] : [text.slice(at)])].filter((part) => part !== '').join('\n\n');
  return { text: edited, appended: lines.length, optionIds: named.map((o) => o.option_id) };
}

/** The left-out options (with a label) any of these texts names: exact label, or an exclusive figure beside its own words. */
function leftOutOptionsNamedIn(texts: readonly string[], leftOut: readonly LeftOutRunOption[], sent: readonly RecordedRunOption[]): (LeftOutRunOption & { label: string })[] {
  const sentFigures = new Set(sent.flatMap((o) => [...figuresOf(o.label ?? '')]));
  const options: NamedOption[] = leftOut.flatMap((o) => typeof o.label === 'string' && o.label.trim() !== '' ? [{
    ...o, label: o.label, folded: fold(o.label), figures: [...figuresOf(o.label)].filter((f) => !sentFigures.has(f)),
    contentWords: new Set(wordsOf(fold(o.label)).map((token) => token.word)
      .filter((word) => LEFT_OUT_COPY_REGEXES.letter.test(word) && !LABEL_STOP_WORDS.has(word))),
  }] : []);
  if (options.length === 0) return [];
  // A SENT option's full name is masked first, so a longer sent name containing a left-out one never names it.
  const sentLabels = sent.flatMap((o) => typeof o.label === 'string' && o.label.trim() !== '' ? [fold(o.label)] : [])
    .sort((a, b) => b.length - a.length);
  const masked = texts.map((t) => sentLabels.reduce(maskLabelIn, fold(t)));
  return options.filter((option) => masked.some((t) => referentIn(t, option, figureContextsOf(t)).referred));
}

interface LeftOutEgressOpts {
  readonly analysisResult?: unknown;
  readonly optionParticipation?: unknown;
  readonly runOptionSet?: RecordedRunOptionSet;
  readonly graph: unknown;
  readonly requestId: string;
  readonly exitPath: string;
  readonly turnId?: string;
}

/** All five strings are displayed by DGAI's readProvisionalView/MessageBubble (confirm_step becomes confirmStep). */
export const PROVISIONAL_VIEW_COPY_FIELDS = ['heading', 'view', 'reasoning', 'confirm_step', 'because'] as const;

/**
 * Same three exits as the driver egress: replay, the provisional-view sidecar, and live assistant_text. The reply gets its
 * own corrections; a provisional view that names a left-out option in ANY displayed field gets them once, after `view`.
 */
export function withLeftOutOptionCorrectionAtEgress<T extends { assistant_text?: unknown }>(body: T, opts: LeftOutEgressOpts): T {
  try {
    const { leftOut, sent } = opts.runOptionSet ?? runOptionSetForCopy(undefined, opts.optionParticipation, opts.graph);
    if (leftOut.length === 0) return body;
    const agent = (body as { _agent?: { provisional_view?: Record<string, unknown> } })._agent;
    const reply = typeof body.assistant_text === 'string' ? appendLeftOutOptionCorrections(body.assistant_text, leftOut, sent) : undefined;
    const view = agent?.provisional_view;
    const viewTexts = PROVISIONAL_VIEW_COPY_FIELDS.flatMap((field) => typeof view?.[field] === 'string' ? [view[field] as string] : []);
    const viewNamed = typeof view?.view === 'string' ? leftOutOptionsNamedIn(viewTexts, leftOut, sent) : [];
    const viewLines = viewNamed.map(leftOutOptionSentence).filter((line) => !viewTexts.some((t) => fold(t).includes(fold(line))));
    const appended = (reply?.appended ?? 0) + viewLines.length;
    if (appended === 0) return body;
    log.info({ event: 'agent_lane.left_out_option_correction_appended', code: LEFT_OUT_OPTION_CORRECTION_APPENDED,
      request_id: opts.requestId, exit_path: opts.exitPath, turn_id: opts.turnId ?? null, appended_count: appended,
      option_count: new Set([...(reply?.optionIds ?? []), ...viewNamed.map((o) => o.option_id)]).size }, LEFT_OUT_OPTION_CORRECTION_APPENDED);
    return { ...body,
      ...(reply !== undefined && reply.appended > 0 ? { assistant_text: reply.text } : {}),
      ...(viewLines.length > 0 ? { _agent: { ...agent, provisional_view: { ...view,
        view: [(view!.view as string).trimEnd(), ...viewLines].join('\n\n') } } } : {}),
    };
  } catch {
    return body;
  }
}
