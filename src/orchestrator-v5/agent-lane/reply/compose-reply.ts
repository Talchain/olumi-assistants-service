/**
 * ⭐⭐ S-A REPLY COMPOSITION: THE ONE SHAPE OF EVERY AGENT-LANE CHAT REPLY (lane COPY-SHAPE, DL 0fd71f, 7 Oct 2026).
 *
 * Paul, prod test 7 Oct: "The coaching copy has got very long again. It was a better length before with the three
 * bullets as a construct." Longer detail belongs under progressive disclosure, and every model must follow one
 * guideline, with "a set of deterministic systems that enforce this": "a few bullets … concise, action-oriented, and
 * science-grounded".
 *
 * WHY THE CONSTRUCT WAS LOST (`inflight/lane-copy-shape-DESIGN.md` §2): route-v2's model tool REQUIRED
 * `{headline, ≤3 bullets, detail}` (#481/#611, July). The Agent lane (22 Sep, #1687) writes free prose, and only a Run
 * reply with no host line, no approval and no gate edit was shaped (#1914). Every other reply shipped whole.
 *
 * THE CONTRACT (REPLY SHAPE v1):
 *   · FACE: one headline sentence + at most {@link REPLY_FACE_MAX_BULLETS} bullets. DETAIL: every other sentence,
 *     verbatim and in its original order, collapsed by the UI ("More detail"); the open-questions segment goes last,
 *     where the panel moves it to its own toggle.
 *   · Carried as the existing `_answer_shape` sidecar, with `assistant_text := deriveAnswerTextFromShape(shape)` (the
 *     identity tie). No schemas change: the sidecar already rides the additive extensions (DGAI `answerShape.ts`).
 *   · NEVER BY DELETING MEANING. RC6 removes only whole sentences already carried by another sentence (equal copies keep
 *     the first). The invariant compares the derived multiset with the input minus exactly those recorded copies;
 *     any other difference ships the input whole (fail closed). The Open Questions segment is untouched.
 *   · TYPED RESPONSE PROFILES (DL, AIE line review 6037446159 item 5), chosen deterministically by the TURN KIND:
 *       - `coaching` (an ordinary converse / Explain / Run / research reply): the face construct below;
 *       - `method_step` (a method press: pre-mortem): ONE structured prompt under the RC method contract; never reshaped
 *         (its worksheet is the chat verbatim, R3);
 *       - `proposal` (a turn that made a proposal): the typed card (approve chip, held card, preview) + the reply as its
 *         disclosure, never reshaped, so consent is never hidden (R2; S-D's proposal panel will carry the change).
 *   · MUST-FACE on a coaching reply (DL R1 + AIE): the headline, the ONE ask, the withheld reason, a caveat on a named
 *     finding, and required evidence (the screen's chance lines, the comparison's basis, a root treated as zero). Each is
 *     a {@link FaceObligation} by its exact text. Receipts and status may move to detail. The ask is the last bullet;
 *     other questions go to detail (D-12). Required evidence, caveats and consent are NEVER hidden: an obligation that is
 *     present but not locatable as one unit, or more obligations than the face holds, keeps the reply whole.
 *   · FACE BUDGET (AIE #87 6037293086 §5): ≤ {@link REPLY_FACE_WORD_BUDGET} words, one move, one ask. A reply that fits
 *     it whole with at most one question is ALREADY IN SHAPE: returned byte-identical, no sidecar.
 *   · NEVER DELETES A CHALLENGE (AIE §7): a challenge the face cannot hold sits under More detail; only said copies go.
 *
 * Pure and deterministic: no model, no I/O. The route logs {@link ReplyComposition.measure} on every turn, so each
 * model's compliance with the prompt half ({@link REPLY_SHAPE_INSTRUCTION}) is a count, not an impression.
 *
 * Regexes use disjoint single-character runs over one line (linear). Timing rows:
 * `__tests__/compose-reply.test.ts`.
 */
import { z } from 'zod';
import { AnswerShapeSchema, deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { openQuestionsSegment } from '../decision-input-ask.js';
import { namedUnsizedLinks, UNSIZED_CAUSE } from './named-unsized-links.js';

/** Straight and curly quotes as one glyph each, length-preserving (offsets in the folded text are offsets in the original). */
export function foldQuotes(text: string): string {
  return text.replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″]/g, '"');
}

/** The face holds the headline plus at most this many bullets (Paul's "three bullets as a construct"). */
export const REPLY_FACE_MAX_BULLETS = 3;
/** The prompt's per-bullet target. The composer never cuts a bullet; one over the log bar is counted. */
export const REPLY_BULLET_WORD_TARGET = 20;
const BULLET_WORD_LOG_BAR = 25;
/**
 * Below this many words, what would go behind "More detail" is too little to hide: the reply ships whole. (A toggle that
 * hides one short sentence costs a click and saves nothing; the 18 Sep defect was hiding SUBSTANCE, #1478.)
 */
export const REPLY_DETAIL_MIN_WORDS = 15;
/**
 * ⭐ THE FACE BUDGET (AIE coaching quality target, #87 6037293086 §5: "1–3 short bullets, ≤~75 initial words"). A reply
 * that fits it whole and asks at most one question is already in shape; otherwise the face fills to it. Must-face lines
 * are never dropped to fit it (a must-face face over budget is counted, never cut).
 */
export const REPLY_FACE_WORD_BUDGET = 75;

/**
 * ⭐ THE PRODUCER HALF: one sentence every chat-writing model is given (joined into `AGENT_INSTRUCTIONS`, and appended to
 * `RESEARCH_INSTRUCTIONS`). Code only: it ships in the CEE build and is never written to a prompt store. No dash a user
 * could see quoted back, and no figure other than the two budgets.
 */
export const REPLY_SHAPE_INSTRUCTION =
  'Shape: begin with one short sentence that answers. Then give at most three bullets, each on its own line starting '
  + 'with "- " and under 20 words: concise, action-oriented points grounded in this model (two bullets if you also ask a '
  + 'question). Keep that part under 75 words, with one reasoning move and at most one question or next action; no '
  + 'generic advice. Put any further explanation after the bullets, after a blank line: Olumi shows it under More '
  + 'detail, so never repeat it in the bullets. If you ask a question, it stays your last sentence.';

/**
 * A host line by its exact text. `ask`, `withheld_reason`, `caveat` and `evidence` must be seen without opening "More
 * detail"; `host` (a receipt, a status, CEE's own run words, the arithmetic) is one atomic part that may sit in detail (R1)
 * but is never split. In coaching with only typed host parts, the first part is the whole headline.
 */
export type FaceObligationRole = 'ask' | 'withheld_reason' | 'caveat' | 'evidence' | 'host' | 'detail';
/** Overlapping obligations are one unit carrying the strongest role among them. */
const ROLE_RANK: Record<FaceObligationRole, number> = { ask: 5, withheld_reason: 4, caveat: 3, evidence: 2, host: 1, detail: 0 };
export interface FaceObligation {
  readonly role: FaceObligationRole;
  readonly text: string;
  readonly subjects?: readonly string[];
  /** B15: a typed screen goal-chance finding leads when present; its evidence rank is unchanged. */
  readonly lead?: true;
}

/** Turns the route ships whole, by identity of the turn (never by reading the words). */
/** The typed response profile, chosen by the turn kind (never by reading the words). */
export type ReplyProfile = 'coaching' | 'method_step' | 'proposal';
/**
 * Why a reply ships whole by the turn's identity: its profile is not `coaching`, the egress replaced the body, or no model
 * wrote words this turn (a card press, an uninterpreted Explain: `host_composed`). Uninterpreted Run uses coaching.
 */
export type KeepWholeReason = 'method_step' | 'proposal' | 'leader_free_envelope' | 'host_composed';

export interface ReplyComposeInput {
  /** The final prose, after every gate: exactly what would ship without the composer. */
  readonly text: string;
  readonly obligations?: readonly FaceObligation[];
  /** Code-authored disclosures owed once, under More detail even for a short reply. */
  readonly detailLines?: readonly string[];
  /** Node labels resolve narrator mentions to the typed directed link subjects. */
  readonly graph?: unknown;
  /** The typed response profile for this turn kind (default `coaching`). */
  readonly profile?: ReplyProfile;
  readonly keepWhole?: KeepWholeReason;
}

export interface ReplyMeasure {
  /** The RAW reply (AIE §7 scores raw and shown separately): its words and questions. */
  readonly words_in: number;
  readonly units_in: number;
  readonly bullets_in: number;
  readonly questions_in: number;
  readonly face_bullets: number;
  readonly detail_units: number;
  readonly restatements_to_detail: number;
  readonly face_words: number;
  readonly face_bullets_over_word_bar: number;
  readonly obligations_on_face: number;
  readonly face_over_cap: boolean;
  readonly face_over_word_budget: boolean;
  readonly open_questions_segment: boolean;
  /** RC6: exact dropped sentence occurrences, in input order (not a set). */
  readonly said_once_dropped: string[];
}

export interface ReplyComposition {
  /** The `assistant_text` to ship: the derivation of `shape`, or the whole reply minus its recorded said copies. */
  readonly text: string;
  readonly shape: AnswerShape | null;
  readonly outcome: 'already_in_shape' | 'shaped' | 'kept_whole';
  readonly reason?: KeepWholeReason | 'empty' | 'no_headline' | 'obligation_unlocated' | 'face_over_cap' | 'lead_in_split' | 'invariant_failed';
  readonly measure?: ReplyMeasure;
}

// ── units ────────────────────────────────────────────────────────────────────────────────────────

type UnitKind = 'sentence' | 'bullet' | 'heading';
interface Unit {
  readonly idx: number;
  readonly para: number;
  /** Index of the source line; consecutive sentences of ONE line are re-joined with a space. */
  readonly line: number;
  readonly kind: UnitKind;
  /** Verbatim words (a bullet without its marker). */
  readonly text: string;
  /** A bullet's own marker, kept when it stays in detail. */
  readonly marker?: string;
  /** Consecutive bullet lines of one paragraph share a run. */
  readonly run?: number;
  obligation?: FaceObligationRole;
}

const BULLET_LINE = /^[ \t]{0,6}([-•*]|\d{1,2}[.)])[ \t]{1,4}(\S.*)$/;
/** A terminator run, its closers, a gap, then the start of the next sentence (capital, digit, currency, opening quote). */
const SENTENCE_BOUNDARY = /([.!?…]["'”’)\]*_`]*)([ \t]+)(?=["'“‘([*_`]*[A-Z0-9£$€])/g;
const QUESTION_END = /\?["'”’)\]*_`]*$/;
const HEADING_MAX = 60;

function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  if (t.endsWith(':')) return true;
  return t.length <= HEADING_MAX && !/[.!?…]["'”’)\]*_`]*$/.test(t);
}

/** Sentences of one line, verbatim, at the boundary rule above. */
export function sentencesOf(line: string): string[] {
  const out: string[] = [];
  let start = 0;
  SENTENCE_BOUNDARY.lastIndex = 0;
  for (let m = SENTENCE_BOUNDARY.exec(line); m !== null; m = SENTENCE_BOUNDARY.exec(line)) {
    const end = m.index + m[1]!.length;
    const s = line.slice(start, end).trim();
    if (s.length > 0) out.push(s);
    start = m.index + m[0].length;
  }
  const rest = line.slice(start).trim();
  if (rest.length > 0) out.push(rest);
  return out;
}

/** Split one prose line around the obligations it carries; each obligation span is ONE unit. */
function proseSegments(line: string, obligations: readonly FaceObligation[]): { text: string; role?: FaceObligationRole }[] {
  for (const o of obligations) {
    const at = line.indexOf(o.text);
    if (at === -1) continue;
    return [
      ...proseSegments(line.slice(0, at), obligations),
      { text: o.text, role: o.role },
      ...proseSegments(line.slice(at + o.text.length), obligations),
    ].filter((s) => s.text.trim().length > 0);
  }
  return sentencesOf(line).map((text) => ({ text }));
}

function parseUnits(text: string, obligations: readonly FaceObligation[], paraBase: number, lineBase: number): { units: Unit[]; paras: number; lines: number } {
  const units: Unit[] = [];
  let para = paraBase;
  let run = -1;
  let lastWasBullet = false;
  let sawContent = false;
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    const lineNo = lineBase + i;
    if (raw.trim().length === 0) {
      if (sawContent) para += 1;
      sawContent = false;
      lastWasBullet = false;
      return;
    }
    sawContent = true;
    const bullet = BULLET_LINE.exec(raw);
    if (bullet !== null) {
      if (!lastWasBullet) run += 1;
      lastWasBullet = true;
      const words = bullet[2]!.trim();
      const role = obligations.find((o) => words.includes(o.text))?.role;
      units.push({ idx: 0, para, line: lineNo, kind: 'bullet', text: words, marker: bullet[1]!, run: paraBase * 1000 + run, ...(role !== undefined ? { obligation: role } : {}) });
      return;
    }
    lastWasBullet = false;
    const next = lines[i + 1];
    if (next !== undefined && BULLET_LINE.test(next) && isHeadingLine(raw) && sentencesOf(raw).length === 1) {
      units.push({ idx: 0, para, line: lineNo, kind: 'heading', text: raw.trim() });
      return;
    }
    for (const seg of proseSegments(raw, obligations)) {
      units.push({ idx: 0, para, line: lineNo, kind: 'sentence', text: seg.text.trim(), ...(seg.role !== undefined ? { obligation: seg.role } : {}) });
    }
  });
  return { units, paras: para + 1, lines: lineBase + lines.length };
}

/** Every sentence of a text, glyphs stripped and whitespace collapsed: the invariant's multiset. */
/** The composer's invariant, exported so route rows pin "moved, never changed" with the same measure. */
export function sentenceMultiset(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    if (raw.trim().length === 0) continue;
    const b = BULLET_LINE.exec(raw);
    const body = b !== null ? b[2]! : raw;
    for (const s of sentencesOf(body)) out.push(s.replace(/[ \t]{1,64}/g, ' ').trim());
  }
  return out.sort();
}

const wordCount = (s: string): number => s.split(/[ \t\n]{1,16}/).filter(Boolean).length;
const isQuestionUnit = (u: Unit): boolean => QUESTION_END.test(u.text.trim());

interface SentenceSpan {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}
interface SaidOnce {
  readonly text: string;
  readonly dropped: string[];
  readonly obligations: FaceObligation[];
  readonly questions: ReturnType<typeof openQuestionsSegment>;
}
/** The frame before a contained sentence that restates it as the container's reason or gloss (keys are normalised). */
const SAID_AGAIN_AFTER = /(?:\bbecause|\bsince|[:;])\s*$/;

function saidOnceKey(text: string): string {
  const key = text.replace(/['"‘’“”`*_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  // A reverse scan avoids retrying a long nonterminal punctuation run at every character.
  let end = key.length;
  while (end > 0 && '.!?'.includes(key[end - 1]!)) end -= 1;
  return key.slice(0, end).trimEnd();
}

/** Remove only the recorded ranges, retaining the bytes of every surviving sentence and gap. */
function withoutRanges(text: string, ranges: readonly { start: number; end: number }[]): string {
  let out = '';
  let at = 0;
  for (const range of ranges) {
    out += text.slice(at, range.start);
    at = range.end;
  }
  return out + text.slice(at);
}

/**
 * RC6 runs BEFORE atomic units are formed. A substring index finds whole normalised sentences, including a question
 * inside a chance+depends part. It indexes total sentence characters rather than comparing every pair of sentences.
 * Strict containers are visited longest first, so every dropped occurrence points directly to a surviving carrier.
 */
function sayOnce(text: string, obligations: readonly FaceObligation[]): SaidOnce {
  const split = openQuestionsSegment(text);
  const protectedAt = split === null ? -1 : text.indexOf(split.segment);
  const protectedEnd = protectedAt + (split?.segment.length ?? 0);
  const lastOutsideQuestions = (words: string): number => {
    let last = -1;
    for (let at = text.indexOf(words); at !== -1; at = text.indexOf(words, at + words.length)) {
      if (protectedAt === -1 || at + words.length <= protectedAt || at >= protectedEnd) last = at;
    }
    return last;
  };
  const spans: SentenceSpan[] = [];
  const lines: { start: number; end: number; spans: SentenceSpan[] }[] = [];
  let lineAt = 0;
  for (const raw of text.split('\n')) {
    const bullet = BULLET_LINE.exec(raw);
    const body = bullet?.[2] ?? raw;
    const bodyAt = bullet === null ? 0 : raw.indexOf(body);
    const lineSpans: SentenceSpan[] = [];
    let cursor = bodyAt;
    for (const sentence of sentencesOf(body)) {
      const start = lineAt + raw.indexOf(sentence, cursor);
      const end = start + sentence.length;
      cursor = end - lineAt;
      // Neither a drop candidate nor a containment witness may touch the questions toggle.
      if (protectedAt !== -1 && start < protectedEnd && end > protectedAt) continue;
      const span = { text: sentence, start, end };
      spans.push(span);
      lineSpans.push(span);
    }
    lines.push({ start: lineAt, end: lineAt + raw.length, spans: lineSpans });
    lineAt += raw.length + 1;
  }

  // The closing typed ask may move to an identical earlier copy, but never to a merely containing sentence.
  const closingAsk = obligations.filter((o) => o.role === 'ask')
    .map((o) => ({ start: lastOutsideQuestions(o.text), end: lastOutsideQuestions(o.text) + o.text.length }))
    .filter((o) => o.start !== -1).sort((a, b) => b.start - a.start)[0];
  const askKeys = new Set(spans.filter((s) => closingAsk !== undefined && s.start >= closingAsk.start
    && s.end <= closingAsk.end).map((s) => saidOnceKey(s.text)));
  const groups: { key: string; first: SentenceSpan; copies: SentenceSpan[] }[] = [];
  const groupByKey = new Map<string, number>();
  for (const span of spans) {
    const key = saidOnceKey(span.text);
    if (key === '') continue;
    const prior = groupByKey.get(key);
    if (prior !== undefined) groups[prior]!.copies.push(span);
    else {
      groupByKey.set(key, groups.length);
      groups.push({ key, first: span, copies: [span] });
    }
  }

  // ⭐ PREFER THE TYPED COPY (Codex r1 on #2801, P1-2/P1-3): a sentence inside a typed obligation is what the host owes
  // the face. Among equal copies the first TYPED one stays (else the first), so a typed role never has to move onto a
  // surviving untyped copy, and composing twice is stable (the typed text is still there the second time). A contained
  // sentence re-binds to its container as before (one whole sentence carries it).
  const typedRanges = obligations.filter((o) => o.role !== 'detail' && o.text.trim() !== '').flatMap((o) => {
    const ranges: { start: number; end: number }[] = [];
    for (let at = text.indexOf(o.text); at !== -1; at = text.indexOf(o.text, at + o.text.length)) ranges.push({ start: at, end: at + o.text.length });
    return ranges;
  });
  const isTyped = (span: SentenceSpan): boolean => typedRanges.some((r) => r.start <= span.start && span.end <= r.end);
  for (const group of groups) group.first = group.copies.find(isTyped) ?? group.copies[0]!;

  // Aho-Corasick: all complete sentence keys are patterns; output links avoid copying suffix-match arrays.
  const trie: { next: Map<string, number>; fail: number; output: number; group?: number }[] = [
    { next: new Map(), fail: 0, output: 0 },
  ];
  groups.forEach((group, idx) => {
    let node = 0;
    for (const char of group.key) {
      let next = trie[node]!.next.get(char);
      if (next === undefined) {
        next = trie.length;
        trie[node]!.next.set(char, next);
        trie.push({ next: new Map(), fail: 0, output: 0 });
      }
      node = next;
    }
    trie[node]!.group = idx;
  });
  const queue = [...trie[0]!.next.values()];
  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head]!;
    for (const [char, child] of trie[node]!.next) {
      let fail = trie[node]!.fail;
      while (fail !== 0 && !trie[fail]!.next.has(char)) fail = trie[fail]!.fail;
      trie[child]!.fail = trie[fail]!.next.get(char) ?? 0;
      const suffix = trie[child]!.fail;
      trie[child]!.output = trie[suffix]!.group !== undefined ? suffix : trie[suffix]!.output;
      queue.push(child);
    }
  }
  const carrier = new Map<number, number>();
  const longestFirst = groups.map((_, idx) => idx).sort((a, b) => groups[b]!.key.length - groups[a]!.key.length || a - b);
  for (const idx of longestFirst) {
    if (carrier.has(idx)) continue;
    let node = 0;
    const containerKey = groups[idx]!.key;
    for (let at = 0; at < containerKey.length; at += 1) {
      const char = containerKey[at]!;
      while (node !== 0 && !trie[node]!.next.has(char)) node = trie[node]!.fail;
      node = trie[node]!.next.get(char) ?? 0;
      // ⛔ Only the container's explanatory TAIL says the same finding ("…, because <it>", "…: <it>"). A sentence inside any
      // other frame ("It is not true that <it>", "If X, <it>") means something else, and both are kept.
      if (at !== containerKey.length - 1) continue;
      for (let match = node; match !== 0; match = trie[match]!.output) {
        const found = trie[match]!.group;
        if (found !== undefined && groups[found]!.key.length < containerKey.length
          && SAID_AGAIN_AFTER.test(containerKey.slice(0, containerKey.length - groups[found]!.key.length))
          && !askKeys.has(groups[found]!.key) && !carrier.has(found)) carrier.set(found, idx);
      }
    }
  }
  const keptByDrop = new Map<SentenceSpan, SentenceSpan>();
  groups.forEach((group, idx) => {
    const kept = groups[carrier.get(idx) ?? idx]!.first;
    for (const copy of group.copies) if (copy !== kept) keptByDrop.set(copy, kept);
  });
  const dropped = spans.filter((s) => keptByDrop.has(s));
  if (dropped.length === 0) return { text, dropped: [], obligations: [...obligations], questions: split };

  const ranges: { start: number; end: number }[] = [];
  for (const line of lines) {
    const kept = line.spans.filter((s) => !keptByDrop.has(s));
    if (!line.spans.some((s) => keptByDrop.has(s))) continue;
    // Whole-line removal also removes an empty bullet marker. Protected text on that line stays byte-identical.
    if (kept.length === 0 && !(protectedAt !== -1 && line.start < protectedEnd && line.end > protectedAt)) {
      ranges.push({ start: line.start, end: line.end });
      continue;
    }
    for (let i = 0; i < line.spans.length; i += 1) {
      if (!keptByDrop.has(line.spans[i]!)) continue;
      const first = i;
      while (i + 1 < line.spans.length && keptByDrop.has(line.spans[i + 1]!)
        && !(protectedAt !== -1 && line.spans[i]!.end <= protectedAt && line.spans[i + 1]!.start >= protectedEnd)) i += 1;
      const next = line.spans[i + 1];
      const prev = line.spans[first - 1];
      let start = next === undefined && prev !== undefined ? prev.end : line.spans[first]!.start;
      let end = next?.start ?? line.spans[i]!.end;
      if (protectedAt !== -1 && start < protectedEnd && end > protectedAt) {
        if (line.spans[first]!.start >= protectedEnd) start = line.spans[first]!.start;
        else end = line.spans[i]!.end;
      }
      ranges.push({ start, end });
    }
  }
  const rebound = obligations.flatMap((o): FaceObligation[] => {
    const at = lastOutsideQuestions(o.text);
    if (at === -1) return [{ ...o }];
    const end = at + o.text.length;
    const enclosingDrop = dropped.find((s) => s.start <= at && s.end >= end);
    if (enclosingDrop !== undefined) return [{ ...o, text: keptByDrop.get(enclosingDrop)!.text }];
    const local = ranges.filter((r) => r.start < end && r.end > at)
      .map((r) => ({ start: Math.max(0, r.start - at), end: Math.min(o.text.length, r.end - at) }));
    const remaining = withoutRanges(o.text, local).trim();
    if (remaining !== '') return [{ ...o, text: remaining }];
    // An entirely repeated atomic part can lose several sentences at once. Recover its kept atomic span when the
    // witnesses share a source line; otherwise each surviving carrier owes the same role and metadata.
    const witnesses = [...new Set(dropped.filter((s) => s.start < end && s.end > at)
      .map((s) => keptByDrop.get(s)!))].sort((a, b) => a.start - b.start);
    const first = witnesses[0];
    const last = witnesses.at(-1);
    if (first !== undefined && last !== undefined && !text.slice(first.start, last.end).includes('\n')) {
      const witnessRanges = ranges.filter((r) => r.start < last.end && r.end > first.start)
        .map((r) => ({ start: Math.max(0, r.start - first.start), end: Math.min(last.end, r.end) - first.start }));
      return [{ ...o, text: withoutRanges(text.slice(first.start, last.end), witnessRanges).trim() }];
    }
    return witnesses.map((s) => ({ ...o, text: s.text }));
  });
  const retainedPart = (words: string, offset: number): string => withoutRanges(words,
    ranges.filter((r) => r.start < offset + words.length && r.end > offset)
      .map((r) => ({ start: Math.max(0, r.start - offset), end: Math.min(words.length, r.end - offset) })));
  // Keep the original toggle identity even if its entire preceding lead was absorbed by a later carrier.
  const questions = split === null ? null : { lead: retainedPart(split.lead, 0).trimEnd(), segment: split.segment,
    after: split.after === '' ? '' : retainedPart(split.after, text.indexOf(split.after, protectedEnd)).trim() };
  return { text: withoutRanges(text, ranges), dropped: dropped.map((s) => s.text), obligations: rebound, questions };
}

/** Subtract exact recorded occurrences, keeping the invariant stricter than the said-once comparison. */
function expectedSentences(text: string, dropped: readonly string[]): string[] | null {
  const counts = new Map<string, number>();
  for (const sentence of dropped) {
    const key = sentence.replace(/[ \t]{1,64}/g, ' ').trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const expected = sentenceMultiset(text).filter((sentence) => {
    const count = counts.get(sentence) ?? 0;
    if (count === 0) return true;
    counts.set(sentence, count - 1);
    return false;
  });
  if ([...counts.values()].some((count) => count !== 0)) return null;
  return expected;
}

// ── the composer ─────────────────────────────────────────────────────────────────────────────────

/**
 * Compose the reply's shape. Only recorded whole-sentence copies may be deleted; all other text is retained.
 */
export function composeReplyShape(input: ReplyComposeInput): ReplyComposition {
  const detailLines = [...new Set((input.detailLines ?? []).filter((line) => line.trim() !== ''))];
  // Move verbatim narrator copies to their typed detail position; never duplicate a risk sentence.
  const body = detailLines.length === 0 ? input.text : detailLines.reduce((text, line) => text.replaceAll(line, ''), input.text)
    .replace(/^[ \t]*[-•*][ \t]*$/gm, '').trim();
  const originalQuestions = detailLines.length === 0 ? null : openQuestionsSegment(body);
  // The questions toggle owns its segment; disclosures sit before it, never inside it.
  const originalText = detailLines.length === 0 ? body
    : [originalQuestions?.lead ?? body, ...detailLines, originalQuestions?.segment ?? '', originalQuestions?.after ?? '']
      .filter(Boolean).join('\n\n');
  if (originalText.trim().length === 0) return { text: originalText, shape: null, outcome: 'kept_whole', reason: 'empty' };

  // Obligations still present in the final text (a later gate may have removed one: then it is no longer owed).
  // Obligation identity never depends on quote glyphs (Science #2787 P1-A): a typed text the reply carries with other
  // quotes ('Raise prices 10%' for ‘Raise prices 10%’) re-binds to the reply's OWN span (the fold keeps lengths), so every
  // exact match below sees the words as written.
  const foldedOriginal = foldQuotes(originalText);
  const asWritten = (t: string): string => {
    if (originalText.includes(t)) return t;
    const at = foldedOriginal.indexOf(foldQuotes(t));
    return at === -1 ? t : originalText.slice(at, at + t.length);
  };
  const originalPresent = [...(input.obligations ?? []), ...detailLines.map((text): FaceObligation => ({ role: 'detail', text }))].map((o) => ({ ...o, text: asWritten(o.text.trim()) }))
    .filter((o) => o.text.length > 0 && originalText.includes(o.text))
    // In this explicit-detail path, questions already in their own toggle stay there.
    // Obligations in the ordinary reply remain subject to the same face checks.
    .filter((o) => originalQuestions === null || o.role !== 'ask'
      || originalQuestions.lead.includes(o.text) || originalQuestions.after.includes(o.text))
    .sort((a, b) => b.text.length - a.text.length);
  const once = sayOnce(originalText, originalPresent);
  const text = once.text;
  const present = once.obligations.sort((a, b) => b.text.length - a.text.length);
  // Overlapping obligations are ONE unit (the gate's closing can carry the ask): the larger span stands for both, and it
  // is the ask when it holds one, so it closes the face.
  const owed: { role: FaceObligationRole; text: string; lead?: true; subjects?: readonly string[] }[] = [];
  for (const o of present) {
    const container = owed.find((k) => k.text.includes(o.text));
    if (container === undefined) owed.push({ ...o });
    else {
      if (ROLE_RANK[o.role] > ROLE_RANK[container.role]) container.role = o.role;
      if (o.lead === true) container.lead = true;
      if (o.subjects !== undefined) container.subjects = [...new Set([...(container.subjects ?? []), ...o.subjects])];
    }
  }
  const split = once.questions;
  const before = parseUnits(split === null ? text : split.lead, owed, 0, 0);
  const after = split === null || split.after === '' ? { units: [] as Unit[] } : parseUnits(split.after, owed, before.paras, before.lines + 1);
  const units: Unit[] = [...before.units, ...after.units].map((u, idx) => ({ ...u, idx }));
  const rawSplit = openQuestionsSegment(originalText);
  const rawUnits = once.dropped.length === 0 ? units : [
    ...parseUnits(rawSplit?.lead ?? originalText, originalPresent, 0, 0).units,
    ...(rawSplit === null ? [] : parseUnits(rawSplit.after, originalPresent, 0, 0).units),
  ];
  const initialMeasure: ReplyMeasure = {
    words_in: wordCount(originalText), units_in: rawUnits.length,
    bullets_in: rawUnits.filter((u) => u.kind === 'bullet').length,
    questions_in: rawUnits.filter(isQuestionUnit).length,
    face_bullets: 0, detail_units: 0, restatements_to_detail: 0, face_words: 0,
    face_bullets_over_word_bar: 0, obligations_on_face: 0,
    face_over_cap: false, face_over_word_budget: false, open_questions_segment: split !== null,
    said_once_dropped: once.dropped,
  };
  const expected = expectedSentences(originalText, once.dropped);
  const reduced = sentenceMultiset(text);
  if (expected === null || expected.length !== reduced.length || expected.some((s, i) => s !== reduced[i])) {
    return { text: originalText, shape: null, outcome: 'kept_whole', reason: 'invariant_failed',
      measure: { ...initialMeasure, said_once_dropped: [] } };
  }
  // Turn identity prohibits reshaping AND the copy rule: a whole reply ships byte-identical (DL rulings R2/R3: a
  // proposal's disclosure and a method worksheet are verbatim; keepWhole turns are host-composed), never deduplicated.
  const whole = { ...initialMeasure, said_once_dropped: [] };
  if (input.keepWhole !== undefined) return { text: originalText, shape: null, outcome: 'kept_whole', reason: input.keepWhole, measure: whole };
  if (input.profile === 'method_step' || input.profile === 'proposal') return { text: originalText, shape: null, outcome: 'kept_whole', reason: input.profile, measure: whole };
  if (owed.some((o) => o.text.length === 0 || o.text.includes('\n'))) {
    return { text, shape: null, outcome: 'kept_whole', reason: 'obligation_unlocated', measure: initialMeasure };
  }
  if (units.length === 0) return { text, shape: null, outcome: 'kept_whole', reason: 'empty', measure: initialMeasure };

  // Each obligation binds its LAST occurrence (the host appends); an earlier narrator copy is an ordinary unit.
  for (const role of ['ask', 'withheld_reason', 'caveat', 'evidence', 'host', 'detail'] as const) {
    const tagged = units.filter((u) => u.obligation === role);
    for (const u of tagged.slice(0, -1)) {
      const sameText = tagged.at(-1)!.text === u.text;
      if (sameText) delete u.obligation;
    }
  }
  if (owed.some((o) => !units.some((u) => u.obligation === o.role && u.text.includes(o.text)))) {
    return { text, shape: null, outcome: 'kept_whole', reason: 'obligation_unlocated', measure: initialMeasure };
  }

  // Only a PRESENT typed withheld reason can licence moving an unbound narrator cause to detail.
  // Use the original roles: an overlapping ask may make the atomic closing an ask in `owed`.
  const subjects = new Set(present.filter((o) => o.role === 'withheld_reason').flatMap((o) => o.subjects ?? []));
  const restatements = new Set(units.filter((u) => u.obligation === undefined && subjects.size > 0
    && UNSIZED_CAUSE.test(u.text) && namedUnsizedLinks(u.text, subjects, input.graph).size > 0));
  const eligible = (u: Unit): boolean => !restatements.has(u);

  const questions = units.filter((u) => eligible(u) && isQuestionUnit(u));
  const hostAsks = units.filter((u) => u.obligation === 'ask');
  const runs = [...new Set(units.filter((u) => u.kind === 'bullet').map((u) => u.run!))];
  // THE ONE ASK: the host's typed ask, else the reply's last question that is not itself another obligation (a screen
  // line that ends on its own question is evidence, kept in its place, never moved to close the face). Every other
  // question goes to detail (D-12).
  const ask = hostAsks.at(-1) ?? questions.filter((u) => u.obligation === undefined).at(-1);
  const otherObligations = units.filter((u) => u.obligation !== undefined && u.obligation !== 'ask' && u.obligation !== 'host' && u.obligation !== 'detail' && u !== ask);

  // The face's list: the first bullet run with a point that is not an obligation; its lead-in becomes the headline.
  const faceRun = runs.find((r) => units.some((u) => u.run === r && u.obligation === undefined && eligible(u) && u !== ask && !isQuestionUnit(u)));
  const firstOfRun = faceRun === undefined ? undefined : units.find((u) => u.run === faceRun)!;
  const beforeRun = firstOfRun === undefined ? undefined : units[firstOfRun.idx - 1];
  const leadIn = beforeRun !== undefined && beforeRun.obligation === undefined && eligible(beforeRun) && beforeRun !== ask
    && (beforeRun.kind === 'heading' || /:["'”’)\]*]{0,4}$/.test(beforeRun.text)) ? beforeRun : undefined;

  // ⭐ 2b-0, P05 W-1, DL GO: no narrator units → the first typed host part is the atomic headline.
  // Evidence/withheld/ask ranks below remain unchanged. No recognition by wording.
  const hostHeadline = units.every((u) => u.obligation !== undefined) && units[0]!.obligation === 'host'
    ? units[0] : undefined;
  // B15 (DL, 7 Oct): the first PRESENT screen goal-chance finding in text order leads, by identity alone.
  // `present` retains the marker even when overlapping obligations bind as one larger atomic unit. The unit must BE that
  // finding (exact text): a bullet that carries it beside other sentences (a run share) never leads (Codex r1 P1 #2783).
  const goalChanceHeadline = units.find((u) => present.some((o) => o.lead === true && u.text === o.text));
  // A unit that carries a lead finding beside other words never leads by ANY selector (Codex r2 P2 #2783).
  const mixedLead = (u: Unit): boolean => present.some((o) => o.lead === true && u.text !== o.text && u.text.includes(o.text));
  const headline = goalChanceHeadline ?? hostHeadline ?? leadIn
    ?? units.find((u) => u.kind === 'sentence' && u.obligation === undefined && eligible(u) && u !== ask && !isQuestionUnit(u))
    ?? units.find((u) => u.kind === 'heading' && eligible(u))
    ?? (restatements.size > 0 ? units.find((u) => u.obligation !== undefined && u.obligation !== 'host' && !mixedLead(u)) : undefined)
    ?? (units.length === 1 && eligible(units[0]!) && !mixedLead(units[0]!) ? units[0] : undefined);
  if (headline === undefined) return { text, shape: null, outcome: 'kept_whole', reason: 'no_headline', measure: initialMeasure };
  // A frame that introduces CHANCES ("…, chances of meeting it, in this model, are:", "…, on current information:"), never a
  // goal-keyword frame for another finding ("Risks to meeting your goal with X:"; Codex re-review 7ff59a6e).
  const CHANCE_FRAME = /\b(?:chances?|current information)\b[^\n]{0,200}:$/i;
  // ⭐ B15 (DL #2783, composed texts 8 Oct): the Agent's lead-in to the chance lines ("For reaching at least £126,000 …, on
  // current information:") travels WITH the first chance finding, as the headline's opening line, so it still introduces
  // the list and never ends the reply on a colon. Moved, never reworded; the line break keeps the sentence multiset. Only a
  // chance frame (CHANCE_FRAME, trailing emphasis aside) in the same or the paragraph just before, never another finding's frame.
  const prior = headline === goalChanceHeadline && headline.idx > 0 ? units[headline.idx - 1]! : undefined;
  const chanceLeadIn = prior !== undefined && prior.kind === 'sentence' && prior.obligation === undefined && eligible(prior)
    && prior !== ask && prior.para >= headline.para - 1 && CHANCE_FRAME.test(prior.text.trim().replace(/["'”’)\]*_]{1,4}$/, '')) ? prior : undefined;
  const headlineText = chanceLeadIn !== undefined ? `${chanceLeadIn.text}\n${headline.text}` : headline.text;

  const mustFace = [...otherObligations.filter((u) => u !== headline), ...(ask !== undefined && ask !== headline ? [ask] : [])];
  const slots = Math.max(0, REPLY_FACE_MAX_BULLETS - mustFace.length);
  const pool = faceRun !== undefined
    ? units.filter((u) => u.run === faceRun && u.obligation === undefined && eligible(u) && u !== ask && !isQuestionUnit(u))
    : units.filter((u) => u.idx > headline.idx && u.kind === 'sentence' && u.obligation === undefined && eligible(u) && u !== ask && !isQuestionUnit(u));
  // Fill the face in order up to the bullet cap AND the word budget; must-face lines are counted first and always kept.
  let faceWords = wordCount(headlineText) + mustFace.reduce((n, u) => n + wordCount(u.text), 0);
  const fromPool: Unit[] = [];
  for (const u of pool) {
    if (fromPool.length >= slots) break;
    const w = wordCount(u.text);
    if (fromPool.length > 0 && faceWords + w > REPLY_FACE_WORD_BUDGET) break;
    fromPool.push(u);
    faceWords += w;
  }
  const faceSet = new Set<Unit>([headline, ...fromPool, ...mustFace, ...(chanceLeadIn !== undefined ? [chanceLeadIn] : [])]);
  // Face bullets keep the reply's own order, except: a caveat on the finding opens them (#2565: "the Explain robustness
  // caveat goes on the face as bullet 1"), and the ask closes them.
  const inOrder = units.filter((u) => faceSet.has(u) && u !== headline && u !== chanceLeadIn && u !== ask);
  const faceBullets = [...inOrder.filter((u) => u.obligation === 'caveat'), ...inOrder.filter((u) => u.obligation !== 'caveat')];
  if (ask !== undefined && ask !== headline) faceBullets.push(ask);
  const detailUnits = units.filter((u) => !faceSet.has(u));

  const measure: ReplyMeasure = {
    ...initialMeasure,
    face_bullets: faceBullets.length,
    detail_units: detailUnits.length,
    restatements_to_detail: restatements.size,
    face_words: wordCount(headlineText) + faceBullets.reduce((n, u) => n + wordCount(u.text), 0),
    face_bullets_over_word_bar: faceBullets.filter((u) => wordCount(u.text) > BULLET_WORD_LOG_BAR).length,
    obligations_on_face: mustFace.length + (headline.obligation !== undefined ? 1 : 0),
    face_over_cap: faceBullets.length > REPLY_FACE_MAX_BULLETS,
    face_over_word_budget: faceWords > REPLY_FACE_WORD_BUDGET,
    open_questions_segment: split !== null,
  };
  // Already in shape, shipped exactly as written: the whole reply fits the face budget with at most one question, or
  // too little would go behind "More detail" to be worth a click.
  if (split?.lead !== '' && goalChanceHeadline === undefined && detailLines.length === 0 && restatements.size === 0 && wordCount(text) <= REPLY_FACE_WORD_BUDGET && questions.length <= 1) return { text, shape: null, outcome: 'already_in_shape', measure };
  if (split?.lead !== '' && goalChanceHeadline === undefined && detailLines.length === 0 && restatements.size === 0 && detailUnits.reduce((n, u) => n + wordCount(u.text), 0) < REPLY_DETAIL_MIN_WORDS
    // D-12: more than one question never ships whole on the face, however little would go to detail (RC6 can leave that).
    && questions.length <= 1) return { text, shape: null, outcome: 'already_in_shape', measure };
  // More obligations than the face holds: hiding one would break its rule, so the reply ships whole (counted).
  if (measure.face_over_cap) return { text, shape: null, outcome: 'kept_whole', reason: 'face_over_cap', measure };
  // ⛔ A lead-in stays with what it introduces ("…, on current information:" before the screen's chance lines): a face
  // line whose lead-in would go to detail ships the reply whole (counted), never a finding stripped of its frame.
  if (units.some((u) => faceSet.has(u) && u !== headline && u.idx > 0 && !faceSet.has(units[u.idx - 1]!)
    && units[u.idx - 1]!.kind === 'sentence' && /:["'”’)\]*]{0,4}$/.test(units[u.idx - 1]!.text))) {
    return { text, shape: null, outcome: 'kept_whole', reason: 'lead_in_split', measure };
  }

  const detail = [renderDetail(detailUnits), split?.segment ?? ''].filter((p) => p.length > 0).join('\n\n');
  // A typed host or goal-chance part can contain several sentences; narrator headlines keep the single-sentence contract.
  const schema = goalChanceHeadline === undefined && hostHeadline === undefined ? AnswerShapeSchema
    : AnswerShapeSchema.extend({ headline: z.string().trim().min(1) });
  const parsed = schema.safeParse({ headline: headlineText, bullets: faceBullets.map((u) => u.text), detail });
  if (!parsed.success) return { text, shape: null, outcome: 'kept_whole', reason: 'no_headline', measure };
  const shaped = deriveAnswerTextFromShape(parsed.data);
  // ⛔ THE INVARIANT: every input sentence except exactly the recorded copies, and nothing else, is derived.
  const a = expected;
  const b = sentenceMultiset(shaped);
  if (a.length !== b.length || a.some((s, i) => s !== b[i])) return { text: originalText, shape: null, outcome: 'kept_whole', reason: 'invariant_failed',
    measure: { ...measure, said_once_dropped: [] } };
  return { text: shaped, shape: parsed.data, outcome: 'shaped', measure };
}

/** Detail in the reply's own order: sentences of one source line re-joined, bullets and headings on their own lines. */
function renderDetail(units: readonly Unit[]): string {
  const paras: string[][] = [];
  let prev: Unit | undefined;
  for (const u of units) {
    if (prev === undefined || u.para !== prev.para) paras.push([]);
    const lines = paras.at(-1)!;
    const piece = u.kind === 'bullet' ? `${u.marker ?? '-'} ${u.text}` : u.text;
    const joinsLine = prev !== undefined && u.kind === 'sentence' && prev.kind === 'sentence'
      && u.para === prev.para && u.line === prev.line && u.idx === prev.idx + 1;
    if (joinsLine) lines[lines.length - 1] = `${lines.at(-1)!} ${piece}`;
    else lines.push(piece);
    prev = u;
  }
  return paras.map((p) => p.join('\n')).join('\n\n');
}

/**
 * A body's `_answer_shape` rides only while it derives the words that ship (checked AFTER every final gate: an egress may
 * edit the shape alone, Codex r2 on #2783). Otherwise the body ships its text whole, without the shape.
 */
export function withShapeOnlyIfItDerives<B extends { assistant_text?: unknown; _answer_shape?: unknown }>(body: B): B {
  const shape = body._answer_shape as AnswerShape | undefined;
  if (shape === undefined || deriveAnswerTextFromShape(shape) === body.assistant_text) return body;
  const { _answer_shape: _unproven, ...whole } = body;
  return whole as B;
}
