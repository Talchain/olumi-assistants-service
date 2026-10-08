/** Q6: a reply cannot claim the Run included an option its own recorded set left out. */
import { log } from '../../utils/telemetry.js';
import { runOptionSetForCopy, type LeftOutRunOption, type RecordedRunOption } from '../tools/handlers/option-participation.js';
import { openQuestionsSegment } from './decision-input-ask.js';

export const LEFT_OUT_OPTION_INCLUSION_REMOVED = 'LEFT_OUT_OPTION_INCLUSION_REMOVED';

/** All runs inside a regex are bounded; sentence/line traversal below is a single forward scan. */
export const LEFT_OUT_COPY_REGEXES = {
  singleQuotes: /[‘’‚‛]/g,
  doubleQuotes: /[“”„‟]/g,
  figure: /(?<![\p{L}\p{N}_£$€])(?:[£$€][ \t]{0,3})?\d{1,16}(?:,\d{3}){0,4}(?:\.\d{1,8})?(?:[ \t]{0,3}%)?(?![\p{L}\p{N}_%]|[.,]\d)/gu,
  figureSpace: /[ \t]{1,3}/g,
  inclusion: /\b(?:included|compared|analysed|analyzed|evaluated|assessed|tested)\b|\bin[ \t]{1,4}(?:the|this)[ \t]{1,4}comparison\b|\bpart[ \t]{1,4}of[ \t]{1,4}(?:this|the)[ \t]{1,4}(?:run|analysis)\b|\bin[ \t]{1,4}this[ \t]{1,4}run\b|\b(?:the|this)[ \t]{1,4}analysis[ \t]{1,4}covers\b/i,
  negation: /\b(?:not|never|excluded|without)\b|n['’]t\b|\bleft[ \t]{1,4}out\b/i,
  clauseBoundary: /[;—–]|\b(?:but|yet|however|whereas)\b|,[ \t]{0,4}(?:and|or)[ \t]{1,4}(?=(?:we|i|it|they|you)\b)/gi,
  bullet: /^[ \t]{0,8}(?:[-*•]|\d{1,3}[.)])[ \t]{1,4}/,
  word: /[\p{L}\p{N}_]/u,
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

/** Producer-owned words are also negated, so the second pass leaves them byte-identical. */
export function leftOutOptionSentence(o: LeftOutRunOption & { label: string }): string {
  return o.reason === 'olumi_proposed'
    ? `‘${o.label}’ is Olumi’s suggestion, so it was left out of this comparison until you add it.`
    : `‘${o.label}’ was left out of this comparison.`;
}

interface TextUnit { readonly start: number; readonly end: number; readonly text: string }
/** A bullet is one unit; prose is cut only at a sentence end, never at a decimal's dot. */
function unitsOf(text: string): TextUnit[] {
  const out: TextUnit[] = [];
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
  const options = leftOut.flatMap((o) => typeof o.label === 'string' && o.label.trim() !== '' ? [{
    ...o, label: o.label, folded: fold(o.label), figures: [...figuresOf(o.label)].filter((f) => !sentFigures.has(f)),
  }] : []);
  if (options.length === 0) return { text, removed: 0, optionIds: [] };
  const knownLabels = [...sent, ...leftOut].flatMap((o) => typeof o.label === 'string' && o.label.trim() !== '' ? [fold(o.label)] : [])
    .sort((a, b) => b.length - a.length);
  const removed: TextUnit[] = [];
  const named = new Set<string>();
  for (const unit of unitsOf(text)) {
    const foldedUnit = fold(unit.text);
    const clauses = foldedUnit.split(LEFT_OUT_COPY_REGEXES.clauseBoundary);
    let strike = false;
    for (const clause of clauses) {
      // A word inside an exact option name (e.g. “Expand without debt”) does not negate “was analysed”.
      const outsideNames = knownLabels.reduce(maskLabelIn, clause);
      if (!LEFT_OUT_COPY_REGEXES.inclusion.test(outsideNames) || LEFT_OUT_COPY_REGEXES.negation.test(outsideNames)) continue;
      const figures = figuresOf(clause);
      for (const o of options) {
        if (!exactLabelIn(clause, o.folded) && !o.figures.some((f) => figures.has(f))) continue;
        named.add(o.option_id);
        strike = true;
      }
    }
    if (strike) {
      removed.push(unit);
      // The WHOLE sentence/bullet leaves: restore every excluded option it named, including another clause's name.
      const unitFigures = figuresOf(foldedUnit);
      for (const o of options) {
        if (exactLabelIn(foldedUnit, o.folded) || o.figures.some((f) => unitFigures.has(f))) named.add(o.option_id);
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
  readonly analysisResult: unknown;
  readonly optionParticipation?: unknown;
  readonly graph: unknown;
  readonly requestId: string;
  readonly exitPath: string;
  readonly turnId?: string;
}

/** Same three exit carriers as the driver egress: replay, provisional-view reasoning, and live assistant_text. */
export function withoutLeftOutOptionInclusionClaimsAtEgress<T extends { assistant_text?: unknown }>(body: T, opts: LeftOutEgressOpts): T {
  try {
    const { leftOut, sent } = runOptionSetForCopy(opts.analysisResult, opts.optionParticipation, opts.graph);
    if (leftOut.length === 0) return body;
    const agent = (body as { _agent?: { provisional_view?: { reasoning?: unknown } } })._agent;
    const reasoning = agent?.provisional_view?.reasoning;
    const reply = typeof body.assistant_text === 'string' ? removeLeftOutOptionInclusionClaims(body.assistant_text, leftOut, sent) : undefined;
    const view = typeof reasoning === 'string' ? removeLeftOutOptionInclusionClaims(reasoning, leftOut, sent) : undefined;
    const removed = (reply?.removed ?? 0) + (view?.removed ?? 0);
    if (removed === 0) return body;
    log.warn({ event: 'agent_lane.left_out_option_inclusion_removed', code: LEFT_OUT_OPTION_INCLUSION_REMOVED,
      request_id: opts.requestId, exit_path: opts.exitPath, turn_id: opts.turnId ?? null, removed_count: removed,
      option_count: new Set([...(reply?.optionIds ?? []), ...(view?.optionIds ?? [])]).size }, LEFT_OUT_OPTION_INCLUSION_REMOVED);
    return { ...body,
      ...(reply?.removed ? { assistant_text: reply.text } : {}),
      ...(view?.removed ? { _agent: { ...agent, provisional_view: { ...agent!.provisional_view, reasoning: view.text } } } : {}),
    };
  } catch {
    return body;
  }
}
