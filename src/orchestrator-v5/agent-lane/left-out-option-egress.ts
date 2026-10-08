/** Q6: a reply cannot claim the Run included an option its own recorded set left out. */
import { log } from '../../utils/telemetry.js';
import { runOptionSetForCopy, type LeftOutRunOption, type RecordedRunOption, type RecordedRunOptionSet } from '../tools/handlers/option-participation.js';
import { openQuestionsSegment } from './decision-input-ask.js';

export const LEFT_OUT_OPTION_INCLUSION_REMOVED = 'LEFT_OUT_OPTION_INCLUSION_REMOVED';

/** All runs inside a regex are bounded; sentence/line traversal below is a single forward scan. */
export const LEFT_OUT_COPY_REGEXES = {
  singleQuotes: /[‘’‚‛]/g,
  doubleQuotes: /[“”„‟]/g,
  figure: /(?<![\p{L}\p{N}_£$€])(?:[£$€][ \t]{0,3})?\d{1,16}(?:,\d{3}){0,4}(?:\.\d{1,8})?(?:[ \t]{0,3}%)?(?![\p{L}\p{N}_%]|[.,]\d)/gu,
  figureSpace: /[ \t]{1,3}/g,
  inclusion: /\b(?:(?:includ|compar|analy[sz]|evaluat)(?:e|es|ed|ing)|assess(?:es|ed|ing)?|cover(?:s|ed|ing)?)\b|\btested\b|\bconsider(?:s|ed|ing)?[ \t]{1,4}(?:in\b|as[ \t]{1,4}part[ \t]{1,4}of\b)|\bpart[ \t]{1,4}of\b|\bin[ \t]{1,4}(?:the|this)[ \t]{1,4}(?:run|analysis|comparison)\b|\balongside\b|\bruns?[ \t]{1,4}with\b/i,
  negation: /\b(?:not|never|excluded|without)\b|n['’]t\b|\bleft[ \t]{1,4}out\b/i,
  clauseBoundary: /[;:—–]|,[ \t]{0,4}(?:and|but|while|whereas|although|though|yet|with)\b|\b(?:but|whereas|however)\b/gi,
  bullet: /^[ \t]{0,8}(?:[-*•]|\d{1,3}[.)])[ \t]{1,4}/,
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
/** Mask only full names, never the `Test` substring of the inclusion verb `tested`. */
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

/** An option name's own punctuation is part of its referent; only punctuation outside names separates assertions. */
function clausesOf(text: string, labels: readonly string[]): { readonly text: string; readonly beforeColon: boolean }[] {
  const outsideNames = labels.reduce(maskLabelIn, text);
  const clauses: { text: string; beforeColon: boolean }[] = [];
  let start = 0;
  for (const boundary of outsideNames.matchAll(LEFT_OUT_COPY_REGEXES.clauseBoundary)) {
    clauses.push({ text: text.slice(start, boundary.index!), beforeColon: boundary[0] === ':' });
    start = boundary.index! + boundary[0].length;
  }
  clauses.push({ text: text.slice(start), beforeColon: false });
  return clauses;
}

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
/** Mask the alias's own words separately, preserving assertion verbs between them. */
function maskSpans(text: string, spans: readonly Span[]): string {
  const pieces: string[] = [];
  let at = 0;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.end <= at) continue;
    const start = Math.max(at, span.start);
    pieces.push(text.slice(at, start), ' '.repeat(span.end - start));
    at = span.end;
  }
  pieces.push(text.slice(at));
  return pieces.join('');
}

/** Producer-owned words are also negated, so the second pass leaves them byte-identical. */
export function leftOutOptionSentence(o: LeftOutRunOption & { label: string }): string {
  return o.reason === 'olumi_proposed'
    ? `‘${o.label}’ is Olumi’s suggestion, so it was left out of this comparison until you add it.`
    : `‘${o.label}’ was left out of this comparison.`;
}

interface TextUnit { readonly start: number; readonly end: number; readonly text: string }
/** A bullet is one unit; prose is cut only at a sentence end, never at a decimal's dot. */
function unitsOf(text: string, names: readonly Span[] = []): TextUnit[] {
  const out: TextUnit[] = [];
  // One pass marks every position inside a name (its last character may still end a sentence): linear, never span × dot.
  const inName = new Uint8Array(text.length);
  for (const n of names) inName.fill(1, n.start, Math.max(n.start, n.end - 1));
  const insideName = (at: number): boolean => inName[at] === 1;
  let lineStart = 0;
  while (lineStart < text.length) {
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(lineStart, lineEnd);
    if (LEFT_OUT_COPY_REGEXES.bullet.test(line)) {
      out.push({ start: lineStart, end: newline === -1 ? lineEnd : lineEnd + 1, text: line });
    } else {
      let start = lineStart;
      for (let at = start; at < lineEnd; at += 1) {
        if (!'.!?'.includes(text[at]!)) continue;
        // An option name's own punctuation ('… incl. revised packaging') is never a sentence end (Codex r2 on #2810).
        if (insideName(at)) continue;
        if (text[at] === '.' && '0123456789'.includes(text[at - 1] ?? '') && text[at - 1] !== undefined
          && '0123456789'.includes(text[at + 1] ?? '') && text[at + 1] !== undefined) continue;
        let end = at + 1;
        while (end < lineEnd && '”’\"\')*_]'.includes(text[end]!)) end += 1;
        if (end < lineEnd && text[end] !== ' ' && text[end] !== '\t' && text[end] !== '\r') continue;
        while (end < lineEnd && (text[end] === ' ' || text[end] === '\t' || text[end] === '\r')) end += 1;
        out.push({ start, end, text: text.slice(start, end) });
        start = end;
        at = end - 1;
      }
      if (start < lineEnd) out.push({ start, end: lineEnd, text: text.slice(start, lineEnd) });
    }
    lineStart = lineEnd + 1;
  }
  return out;
}

/** Pure edit, including counts for the egress's one content-free log line. No recorded exclusions means no edit. */
export function removeLeftOutOptionInclusionClaims(
  text: string,
  leftOut: readonly LeftOutRunOption[],
  sent: readonly RecordedRunOption[],
): { readonly text: string; readonly removed: number; readonly optionIds: readonly string[] } {
  const sentFigures = new Set(sent.flatMap((o) => [...figuresOf(o.label ?? '')]));
  const options: NamedOption[] = leftOut.flatMap((o) => typeof o.label === 'string' && o.label.trim() !== '' ? [{
    ...o, label: o.label, folded: fold(o.label), figures: [...figuresOf(o.label)].filter((f) => !sentFigures.has(f)),
    contentWords: new Set(wordsOf(fold(o.label)).map((token) => token.word)
      .filter((word) => LEFT_OUT_COPY_REGEXES.letter.test(word) && !LABEL_STOP_WORDS.has(word))),
  }] : []);
  if (options.length === 0) return { text, removed: 0, optionIds: [] };
  const sentLabels = sent.flatMap((o) => typeof o.label === 'string' && o.label.trim() !== '' ? [fold(o.label)] : [])
    .sort((a, b) => b.length - a.length);
  const leftOutLabels = options.map((o) => o.folded).sort((a, b) => b.length - a.length);
  const removed: TextUnit[] = [];
  const named = new Set<string>();
  // Where every option name sits in the text, so segmentation cannot cut one (fold keeps offsets for these scripts).
  const foldedText = fold(text);
  const nameSpans: Span[] = foldedText.length !== text.length ? [] : [...sentLabels, ...leftOutLabels].flatMap((label) => {
    const spans: Span[] = [];
    for (let at = foldedText.indexOf(label); at !== -1; at = foldedText.indexOf(label, at + Math.max(1, label.length))) {
      if (exactLabelAt(foldedText, label, at)) spans.push({ start: at, end: at + label.length });
    }
    return spans;
  });
  for (const unit of unitsOf(text, nameSpans)) {
    // Mask SENT full labels before ANY search or split, including longer names containing a left-out name.
    const foldedUnit = sentLabels.reduce(maskLabelIn, fold(unit.text));
    const clauses = clausesOf(foldedUnit, leftOutLabels);
    let strike = false;
    // A FRONTED predicate ("Included for comparison: £59 and the £54 test.") names no option before its colon; its
    // inclusion carries to the list after it (Codex r2 on #2810). A colon after a named option stays a boundary.
    let frontedInclusion = false;
    for (const { text: clause, beforeColon } of clauses) {
      // A word inside an exact option name (e.g. “Expand without debt”) does not negate “was analysed”.
      const figures = figureContextsOf(clause);
      const referents = options.map((option) => ({ option, ...referentIn(clause, option, figures) }));
      const outsideNames = maskSpans(leftOutLabels.reduce(maskLabelIn, clause), referents.flatMap((r) => r.spans));
      const carried = frontedInclusion;
      const noOptionNamed = referents.every((r) => !r.referred) && figures.length === 0;
      frontedInclusion = beforeColon && noOptionNamed && LEFT_OUT_COPY_REGEXES.inclusion.test(outsideNames)
        && !LEFT_OUT_COPY_REGEXES.negation.test(outsideNames);
      if (!(carried || LEFT_OUT_COPY_REGEXES.inclusion.test(outsideNames)) || LEFT_OUT_COPY_REGEXES.negation.test(outsideNames)) continue;
      for (const referent of referents) {
        if (!referent.referred) continue;
        named.add(referent.option.option_id);
        strike = true;
      }
    }
    if (strike) {
      removed.push(unit);
      // The WHOLE sentence/bullet leaves: restore every excluded option it named, including another clause's name.
      const unitFigures = figureContextsOf(foldedUnit);
      for (const o of options) {
        if (referentIn(foldedUnit, o, unitFigures).referred) named.add(o.option_id);
      }
    }
  }
  if (removed.length === 0) return { text, removed: 0, optionIds: [] };
  const pieces: string[] = [];
  let at = 0;
  for (const unit of removed) { pieces.push(text.slice(at, unit.start)); at = unit.end; }
  pieces.push(text.slice(at));
  const remaining = pieces.join('').trim();
  const lines = [...new Set(options.filter((o) => named.has(o.option_id)).map(leftOutOptionSentence))]
    .filter((line) => !fold(remaining).includes(fold(line)));
  // The original split still locates the trailing segment if removing the only bullet left no lead for its reader.
  const originalQuestions = openQuestionsSegment(text);
  const questions = openQuestionsSegment(remaining)
    ?? (originalQuestions !== null && remaining.includes(originalQuestions.segment) ? originalQuestions : null);
  const body = questions === null ? remaining : remaining.replace(questions.segment, '').trim();
  const edited = [body, ...lines, ...(questions === null ? [] : [questions.segment])].filter(Boolean).join('\n\n');
  return { text: edited, removed: removed.length, optionIds: [...named] };
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

/** Same three exits as the driver egress: replay, the complete provisional-view sidecar, and live assistant_text. */
export function withoutLeftOutOptionInclusionClaimsAtEgress<T extends { assistant_text?: unknown }>(body: T, opts: LeftOutEgressOpts): T {
  try {
    const { leftOut, sent } = opts.runOptionSet ?? runOptionSetForCopy(undefined, opts.optionParticipation, opts.graph);
    if (leftOut.length === 0) return body;
    const agent = (body as { _agent?: { provisional_view?: Record<string, unknown> } })._agent;
    const reply = typeof body.assistant_text === 'string' ? removeLeftOutOptionInclusionClaims(body.assistant_text, leftOut, sent) : undefined;
    const view = agent?.provisional_view;
    const viewEdits = PROVISIONAL_VIEW_COPY_FIELDS.flatMap((field) => typeof view?.[field] === 'string'
      ? [{ field, ...removeLeftOutOptionInclusionClaims(view[field], leftOut, sent) }] : []);
    const removed = (reply?.removed ?? 0) + viewEdits.reduce((count, edit) => count + edit.removed, 0);
    if (removed === 0) return body;
    log.warn({ event: 'agent_lane.left_out_option_inclusion_removed', code: LEFT_OUT_OPTION_INCLUSION_REMOVED,
      request_id: opts.requestId, exit_path: opts.exitPath, turn_id: opts.turnId ?? null, removed_count: removed,
      option_count: new Set([...(reply?.optionIds ?? []), ...viewEdits.flatMap((edit) => edit.optionIds)]).size }, LEFT_OUT_OPTION_INCLUSION_REMOVED);
    return { ...body,
      ...(reply?.removed ? { assistant_text: reply.text } : {}),
      ...(viewEdits.some((edit) => edit.removed > 0) ? { _agent: { ...agent, provisional_view: { ...view,
        ...Object.fromEntries(viewEdits.filter((edit) => edit.removed > 0).map((edit) => [edit.field, edit.text])),
      } } } : {}),
    };
  } catch {
    return body;
  }
}
