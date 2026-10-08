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
 * THE DRAFT/RUN FACE CONTRACT (the route opts in by typed turn identity):
 *   · FACE: the selected headline/finding, the screen's typed chance lines with their own notes, optional typed
 *     whatChanges and RC4 estimates lines, and one next step. A pending/suggested typed card owns its question;
 *     every prose copy of that question stays in detail. Other host and narrator words stay in detail, verbatim.
 *   · A withheld reason or firmness disclosure stays beside a face figure only when their typed subjects match.
 *   · Optional estimates and whatChanges demote in that order over 80 visible words. Chance findings, their own
 *     notes, horizon, matching figure disclosures and the next step stay; mandatory overflow is counted.
 *   · Ordinary coaching retains the three-bullet pool, small-detail/short-reply passthrough and whole-reply exits.
 *   · The existing method_step, proposal, leader_free_envelope and host_composed whole-reply paths are unchanged.
 *   · `_answer_shape` and assistant_text have one identity: deriveAnswerTextFromShape(shape). RC6 removes only its
 *     recorded whole-sentence copies; every other sentence is conserved. Open questions belong to detail.
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

/** Ordinary coaching retains this cap; Draft/Run contracts count it without shipping prose whole. */
export const REPLY_FACE_MAX_BULLETS = 3;
/** The prompt's per-bullet target. The composer never cuts a bullet; one over the log bar is counted. */
export const REPLY_BULLET_WORD_TARGET = 20;
const BULLET_WORD_LOG_BAR = 25;
/**
 * Below this many words, what would go behind "More detail" is too little to hide: the reply ships whole. (A toggle that
 * hides one short sentence costs a click and saves nothing; the 18 Sep defect was hiding SUBSTANCE, #1478.)
 */
export const REPLY_DETAIL_MIN_WORDS = 15;
/** The face word budget; irreducible mandatory Draft/Run overflow is counted, never cut. */
export const REPLY_FACE_WORD_BUDGET = 80;
/** The optional face lines demote in this one deterministic order; mandatory units never demote. */
export const FACE_DEMOTION_ORDER = ['estimates', 'what_changes'] as const;

/**
 * ⭐ THE PRODUCER HALF: one sentence every chat-writing model is given (joined into `AGENT_INSTRUCTIONS`, and appended to
 * `RESEARCH_INSTRUCTIONS`). Code only: it ships in the CEE build and is never written to a prompt store. No dash a user
 * could see quoted back, and no figure other than the two budgets.
 */
export const REPLY_SHAPE_INSTRUCTION =
  'Shape: begin with one short sentence that answers. Then give at most three bullets, each on its own line starting '
  + 'with "- " and under 20 words: concise, action-oriented points grounded in this model (two bullets if you also ask a '
  + 'question). Keep that part under 80 words, with one reasoning move and at most one question or next action; no '
  + 'generic advice. Put any further explanation after the bullets, after a blank line: Olumi shows it under More '
  + 'detail, so never repeat it in the bullets. If you ask a question, it stays your last sentence.';

/**
 * A host line by exact typed identity. Lead evidence carries the screen finding; matching subjects bind a withheld
 * reason/caveat to its face figure. Other host parts stay in detail. The last ask question is the one prose next step
 * unless its typed control owns it. With only typed host parts, the first host part is the whole headline.
 */
export type FaceObligationRole = 'ask' | 'withheld_reason' | 'caveat' | 'evidence' | 'host' | 'detail';
/** Overlapping obligations are one unit carrying the strongest role among them. */
const ROLE_RANK: Record<FaceObligationRole, number> = { ask: 5, withheld_reason: 4, caveat: 3, evidence: 2, host: 1, detail: 0 };
export interface FaceObligation {
  readonly role: FaceObligationRole;
  readonly text: string;
  readonly subjects?: readonly string[];
  /** The screen finding this separately written depends/spread/shortfall note belongs to. */
  readonly companionOf?: string;
  /** B15: a typed screen goal-chance finding leads when present; its evidence rank is unchanged. */
  readonly lead?: true;
  /** This finding and its typed presses already carry the visible next step. */
  readonly ownsNextStep?: true;
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
  /** Only a typed Draft mutation or Run/Explain turn opts into the H/W/E/N face contract. */
  readonly faceContract?: 'draft' | 'run';
  /** Exact horizon disclosure owed beside on-face Run chances, after their own notes. */
  readonly horizonLine?: string;
  readonly obligations?: readonly FaceObligation[];
  /** Code-authored disclosures owed once, under More detail even for a short reply. */
  readonly detailLines?: readonly string[];
  /** Typed Run finding supplied by the host; after the chance lines, before estimates and the next step. */
  readonly whatChanges?: string;
  /** The route's RC4 census words; never counted or inferred from prose here. */
  readonly estimatesLine?: string;
  /** Exact questions already carried by this reply's pending/suggested typed control. */
  readonly typedControlQuestions?: readonly string[];
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
  /** Exact source gap after the prior segment of this same line (including no gap before punctuation). */
  readonly joinBefore?: string;
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

function parseUnits(text: string, obligations: readonly FaceObligation[], paraBase: number, lineBase: number, faceContract = false): { units: Unit[]; paras: number; lines: number } {
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
      if (!faceContract) {
        units.push({ idx: 0, para, line: lineNo, kind: 'bullet', text: words, marker: bullet[1]!, run: paraBase * 1000 + run, ...(role !== undefined ? { obligation: role } : {}) });
        return;
      }
      // A narrator/host bullet may contain a statement followed by its ask. N takes only the question sentence;
      // the screen's atomic evidence (chance plus its own notes/questions) stays intact.
      const atomicEvidence = obligations.some((o) => o.role === 'evidence' && o.text === words);
      const segments = !atomicEvidence && sentencesOf(words).some((text) => QUESTION_END.test(text.trim()))
        ? proseSegments(words, obligations) : [{ text: words, role }];
      let end = 0;
      for (const [index, segment] of segments.entries()) {
        const text = segment.text.trim();
        const at = words.indexOf(text, end);
        units.push({ idx: 0, para, line: lineNo, kind: 'bullet', text,
          ...(index === 0 ? {} : { joinBefore: words.slice(end, at) }),
          marker: bullet[1]!, run: paraBase * 1000 + run, ...(segment.role !== undefined ? { obligation: segment.role } : {}) });
        end = at + text.length;
      }
      return;
    }
    lastWasBullet = false;
    const next = lines[i + 1];
    if (next !== undefined && BULLET_LINE.test(next) && isHeadingLine(raw) && sentencesOf(raw).length === 1) {
      units.push({ idx: 0, para, line: lineNo, kind: 'heading', text: raw.trim() });
      return;
    }
    let end = 0;
    for (const [index, seg] of proseSegments(raw, obligations).entries()) {
      const text = seg.text.trim();
      const at = raw.indexOf(text, end);
      units.push({ idx: 0, para, line: lineNo, kind: 'sentence', text,
        ...(index === 0 ? {} : { joinBefore: raw.slice(end, at) }),
        ...(seg.role !== undefined ? { obligation: seg.role } : {}) });
      end = at + text.length;
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
  /** The heading section the sentence sits under (0 before any heading): equal words under two headings are two findings. */
  readonly section?: number;
}
interface SaidOnce {
  readonly text: string;
  readonly dropped: string[];
  readonly obligations: FaceObligation[];
  readonly questions: ReturnType<typeof openQuestionsSegment>;
}
/** The frame before a contained sentence that restates it as the container's reason (keys are normalised). */
// The container's tail after 'because'/'since', and no 'not'/'n't' anywhere before it: a negated frame ('The result is not
// withheld because …') can deny the reason as a cause. The quantifier 'no' ('No single option can be put forward yet,
// because …', Paul's served text) is not a negation of the reason.
/** Each 'because'/'since' with its spaces: what follows it to the end of the key is a candidate restated finding. */
const REASON_TAIL = /\b(?:because|since)\s*/g;
const SAID_AGAIN_AFTER = { test: (prefix: string): boolean => /\b(?:because|since)\s*$/.test(prefix) && !/\bnot\b/.test(prefix) };
/** A 'not' / "n't" (straight or curly apostrophe) before the reason's 'because'/'since', on the original words. */
const NEGATED_BEFORE_REASON = /(?:\bnot\b|n['’]t\b)[^]*\b(?:because|since)\b/i;
/** Which typed copy of a repeated sentence stays: the strongest role (ask closes the face), then the first. */
const SAID_ONCE_ROLE_RANK: Partial<Record<FaceObligationRole, number>> = { ask: 5, withheld_reason: 4, caveat: 3, evidence: 2, host: 1 };

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
  let section = 0;
  const allLines = text.split('\n');
  // A heading frames what follows it (Codex r4/r5/r7 on #2801): a line that is not a finished sentence, a Markdown heading,
  // a line wholly in bold, or one sentence directly above a bullet list. A heading starts a section and is never dropped.
  const isFrameLine = (raw: string, next: string | undefined): boolean => {
    const t = raw.trim();
    if (t === '' || BULLET_LINE.exec(raw) !== null) return false;
    return !/[.!?]["'”’)\]*_`]{0,4}$/.test(t) || /^#{1,6}\s/.test(t) || /^(\*\*|__)[^*_].*(\*\*|__)$/.test(t)
      || (next !== undefined && BULLET_LINE.test(next) && sentencesOf(t).length === 1);
  };
  // The next non-empty line after each line, in one backward pass (a slice per line is quadratic in lines: DL on #2801).
  const nextNonEmpty: (string | undefined)[] = new Array(allLines.length);
  for (let i = allLines.length - 1, seen: string | undefined; i >= 0; i -= 1) {
    nextNonEmpty[i] = seen;
    if (allLines[i]!.trim() !== '') seen = allLines[i];
  }
  for (const [lineNo, raw] of allLines.entries()) {
    const frameLine = isFrameLine(raw, nextNonEmpty[lineNo]);
    if (frameLine) section += 1;
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
      // Only a finished sentence (ending . ! ?) is a finding that can be said twice. Anything else — a heading or label in
      // any form ("Option A", "## Option A", "**Option A**", "Option A:") — frames what follows it, and removing a repeat
      // would re-parent findings under another heading (Codex r4/r5 on #2801).
      if (frameLine || !/[.!?]["'”’)\]*_`]{0,4}$/.test(sentence.trim())) continue;
      const span = { text: sentence, start, end, section };
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
  const groups: { key: string; section: number; first: SentenceSpan; copies: SentenceSpan[] }[] = [];
  const groupByKey = new Map<string, number>();
  for (const span of spans) {
    const key = saidOnceKey(span.text);
    if (key === '') continue;
    const at = `${span.section ?? 0}\u0000${key}`;
    const prior = groupByKey.get(at);
    if (prior !== undefined) groups[prior]!.copies.push(span);
    else {
      groupByKey.set(at, groups.length);
      groups.push({ key, section: span.section ?? 0, first: span, copies: [span] });
    }
  }

  // ⭐ PREFER THE TYPED COPY (Codex r1 on #2801, P1-2/P1-3): a sentence inside a typed obligation is what the host owes
  // the face. Among equal copies the first TYPED one stays (else the first), so a typed role never has to move onto a
  // surviving untyped copy, and composing twice is stable (the typed text is still there the second time). A contained
  // sentence re-binds to its container as before (one whole sentence carries it).
  const typedRanges = obligations.filter((o) => o.role !== 'detail' && o.text.trim() !== '').flatMap((o) => {
    const ranges: { start: number; end: number; rank: number }[] = [];
    for (let at = text.indexOf(o.text); at !== -1; at = text.indexOf(o.text, at + o.text.length)) ranges.push({ start: at, end: at + o.text.length, rank: SAID_ONCE_ROLE_RANK[o.role] ?? 0 });
    return ranges;
  });
  // A typed text may stop short of the sentence's own terminal punctuation (the route types `coHold.why` without its
  // period; Codex r4 on #2801): it still covers that sentence.
  const coreEnd = (span: SentenceSpan): number => span.start + span.text.replace(/[.!?]+["'”’)\]*_]{0,4}$/, '').length;
  const covers = (r: { start: number; end: number }, span: SentenceSpan): boolean => r.start <= span.start && coreEnd(span) <= r.end;
  const rankOf = (span: SentenceSpan): number => Math.max(-1, ...typedRanges
    .filter((r) => covers(r, span)).map((r) => r.rank));
  // The strongest typed copy stays (an ask's question stays the ask), ties to the first; else the first.
  for (const group of groups) {
    const best = Math.max(...group.copies.map(rankOf));
    group.first = group.copies.find((c) => rankOf(c) === best)!;
  }
  const groupTyped = (idx: number): boolean => groups[idx]!.copies.some((c) => rankOf(c) >= 0);
  // A typed copy may be contained away only when it IS a whole obligation (its role moves to the container whole); a
  // sentence inside a larger typed unit never is (Codex r3 on #2801: the unit's other part would keep the role alone).
  const wholeWhereTyped = (idx: number): boolean => groups[idx]!.copies.every((c) => rankOf(c) < 0
    || typedRanges.some((r) => r.start === c.start && (r.end === c.end || r.end === coreEnd(c))));

  // Only the container's explanatory TAIL after 'because'/'since' says the same finding, so each container looks up its
  // tails in the per-section key Map: linear in sentences, never a pairwise or substring scan (DL on #2801: timing 23.6×).
  const carrier = new Map<number, number>();
  const longestFirst = groups.map((_, idx) => idx).sort((a, b) => groups[b]!.key.length - groups[a]!.key.length || a - b);
  for (const idx of longestFirst) {
    if (carrier.has(idx)) continue;
    const containerKey = groups[idx]!.key;
    for (const reason of containerKey.matchAll(REASON_TAIL)) {
      const prefix = containerKey.slice(0, reason.index! + reason[0].length);
      const found = groupByKey.get(`${groups[idx]!.section}\u0000${containerKey.slice(prefix.length)}`);
      // ⛔ A sentence inside any other frame ("It is not true that <it>", "If X, <it>") means something else, and both are kept.
      if (found !== undefined && found !== idx && SAID_AGAIN_AFTER.test(prefix)
        // Negation read on the WORDS AS WRITTEN (the key drops apostrophes: "isn't" → "isnt"; Codex r7).
        && !NEGATED_BEFORE_REASON.test(groups[idx]!.first.text)
        // BOTH sentences are Olumi's own typed words (the route types the gate's "No single option … because <why>."
        // by identity: Codex r6), the contained one a WHOLE obligation (its role moves whole: r2/r3). An untyped
        // frame — hypothetical, conditional, reported — never absorbs a typed finding (Codex r8).
        && groupTyped(found) && groupTyped(idx) && wholeWhereTyped(found)
        && !askKeys.has(groups[found]!.key) && !carrier.has(found)) carrier.set(found, idx);
    }
  }
  const keptByDrop = new Map<SentenceSpan, SentenceSpan>();
  // A typed range LONGER than the sentence is an atomic finding (one option's chance + what it rests on). A STATEMENT
  // inside one belongs to that option and stays with it, even when another option's finding says the same words (Codex
  // r9 on #2801: dropping it would leave the qualification on the other option only). Only a repeated QUESTION (R2)
  // leaves an atomic unit: asked once, it closes the first.
  const unitOf = (span: SentenceSpan): { start: number; end: number } | undefined => typedRanges
    .filter((r) => covers(r, span) && (r.end - r.start) > (span.end - span.start))
    .sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  const isQuestion = (span: SentenceSpan): boolean => /\?["'”’)\]*_`]{0,4}$/.test(span.text.trim());
  groups.forEach((group, idx) => {
    const kept = groups[carrier.get(idx) ?? idx]!.first;
    for (const copy of group.copies) {
      if (copy === kept) continue;
      const unit = unitOf(copy);
      const keptUnit = unitOf(kept);
      // The SAME finding repeated word for word (equal unit text) is one finding said twice; a different unit is another option's.
      const sameFinding = unit !== undefined && keptUnit !== undefined && text.slice(unit.start, unit.end) === text.slice(keptUnit.start, keptUnit.end);
      if (unit !== undefined && !isQuestion(copy) && !sameFinding && !(unit.start <= kept.start && kept.end <= unit.end)) continue;
      keptByDrop.set(copy, kept);
    }
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
  const faceContract = input.faceContract !== undefined;
  const detailLines = [...new Set((input.detailLines ?? []).filter((line) => line.trim() !== ''))];
  const faceHostLines = !faceContract || input.keepWhole !== undefined || input.profile === 'method_step' || input.profile === 'proposal' ? [] : [input.faceContract === 'run' ? input.horizonLine : undefined, input.whatChanges, input.estimatesLine].filter((line): line is string => typeof line === 'string' && line.trim() !== '');
  const sourceText = [input.text, ...faceHostLines.filter((line) => !input.text.includes(line))].filter(Boolean).join('\n\n');
  // Move verbatim narrator copies to their typed detail position; never duplicate a risk sentence.
  const body = detailLines.length === 0 ? sourceText : detailLines.reduce((text, line) => text.replaceAll(line, ''), sourceText)
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
  const controlQuestions = (faceContract ? input.typedControlQuestions ?? [] : []).flatMap((question) =>
    [question, ...sentencesOf(question).filter((sentence) => QUESTION_END.test(sentence.trim()))])
    .map(asWritten).filter((question) => question !== '');
  const separateControlQuestion = (o: FaceObligation): FaceObligation[] => {
    if (o.role !== 'evidence') return [o];
    const question = controlQuestions.find((q) => o.text.includes(q));
    if (question === undefined) return [o];
    const at = o.text.indexOf(question);
    return [
      ...separateControlQuestion({ ...o, text: o.text.slice(0, at).trim() }),
      { role: 'detail' as const, text: question },
      ...separateControlQuestion({ ...o, text: o.text.slice(at + question.length).trim() }),
    ].filter((part) => part.text !== '');
  };
  const originalPresent = [...(input.obligations ?? []), ...faceHostLines.map((text): FaceObligation => ({ role: 'host', text })), ...detailLines.map((text): FaceObligation => ({ role: 'detail', text }))].map((o) => ({ ...o, text: asWritten(o.text.trim()) }))
    .filter((o) => o.text.length > 0 && originalText.includes(o.text))
    .flatMap(separateControlQuestion)
    // A typed withheld finding can lead without taking an adjacent host status along with it.
    .flatMap((o): FaceObligation[] => {
      if (!faceContract) return [o];
      const finding = (input.obligations ?? []).find((lead) => lead.lead === true && lead.role === 'withheld_reason'
        && o.text !== asWritten(lead.text) && o.text.includes(asWritten(lead.text)));
      if (finding === undefined) return [o];
      const written = { ...finding, text: asWritten(finding.text) };
      return proseSegments(o.text, [written]).map((part) => ({ ...o, text: part.text.trim(),
        role: part.role ?? o.role, ...(part.text === written.text ? { lead: true as const } : {}) }));
    })
    // In this explicit-detail path, questions already in their own toggle stay there.
    // Obligations in the ordinary reply remain subject to the same face checks.
    .filter((o) => originalQuestions === null || o.role !== 'ask'
      || originalQuestions.lead.includes(o.text) || originalQuestions.after.includes(o.text))
    .sort((a, b) => b.text.length - a.text.length);
  const once = sayOnce(originalText, originalPresent);
  const text = once.text;
  // RC6 first prefers the complete typed host copy. Only then split N into its one question sentence; splitting
  // before copy selection would mistakenly type the narrator's earlier echo as the same host question.
  const normalised = !faceContract ? once.obligations : once.obligations.flatMap((o): FaceObligation[] => o.role !== 'ask' ? [o] : sentencesOf(o.text).map((text) => ({
    ...o, text, role: QUESTION_END.test(text.trim()) ? 'ask' as const : 'host' as const,
  })));
  const present = normalised.flatMap((o): FaceObligation[] => {
    if (!faceContract) return [o];
    const containedAsk = o.role !== 'ask' && o.role !== 'evidence'
      && normalised.some((ask) => ask.role === 'ask' && o.text.includes(ask.text));
    return containedAsk ? sentencesOf(o.text).map((text) => ({ ...o, text,
      role: QUESTION_END.test(text.trim()) ? 'ask' as const : o.role })) : [o];
  }).sort((a, b) => b.text.length - a.text.length);
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
  const before = parseUnits(split === null ? text : split.lead, owed, 0, 0, faceContract);
  const after = split === null || split.after === '' ? { units: [] as Unit[] } : parseUnits(split.after, owed, before.paras, before.lines + 1, faceContract);
  const units: Unit[] = [...before.units, ...after.units].map((u, idx) => ({ ...u, idx }));
  const rawSplit = openQuestionsSegment(originalText);
  const rawUnits = once.dropped.length === 0 ? units : [
    ...parseUnits(rawSplit?.lead ?? originalText, originalPresent, 0, 0, faceContract).units,
    ...(rawSplit === null ? [] : parseUnits(rawSplit.after, originalPresent, 0, 0, faceContract).units),
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
  // A control's exact typed question owns the next step. Its prose copies (including a narrator echo in a longer
  // sentence) all remain in detail. This is question identity supplied by the route, never a prose classifier.

  const controlAsk = (u: Unit): boolean => controlQuestions.some((question) => foldQuotes(u.text).includes(foldQuotes(question)));
  const nextStepFinding = !faceContract ? undefined : units.find((u) => !controlAsk(u)
    && present.some((o) => o.lead === true && o.ownsNextStep === true && u.text === o.text));
  const selectedAsk = hostAsks.at(-1) ?? questions.filter((u) => u.obligation === undefined).at(-1);
  const ask = nextStepFinding !== undefined || (selectedAsk !== undefined && controlAsk(selectedAsk)) ? undefined : selectedAsk;

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
  const goalChanceHeadline = nextStepFinding
    ?? units.find((u) => !controlAsk(u) && present.some((o) => o.lead === true && u.text === o.text));
  // A unit that carries a lead finding beside other words never leads by ANY selector (Codex r2 P2 #2783).
  const mixedLead = (u: Unit): boolean => present.some((o) => o.lead === true && u.text !== o.text && u.text.includes(o.text));
  const headline = goalChanceHeadline ?? hostHeadline ?? leadIn
    ?? units.find((u) => u.kind === 'sentence' && u.obligation === undefined && eligible(u) && !controlAsk(u) && u !== ask && !isQuestionUnit(u))
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
  let headlineText = chanceLeadIn !== undefined ? `${chanceLeadIn.text}\n${headline.text}` : headline.text;

  let faceSet: Set<Unit>;
  let faceBullets: Unit[];
  let faceWords: number;
  if (!faceContract) {
    const otherObligations = units.filter((u) => u.obligation !== undefined && u.obligation !== 'ask' && u.obligation !== 'host' && u.obligation !== 'detail' && u !== ask);
    const mustFace = [...otherObligations.filter((u) => u !== headline), ...(ask !== undefined && ask !== headline ? [ask] : [])];
    const slots = Math.max(0, REPLY_FACE_MAX_BULLETS - mustFace.length);
    const pool = faceRun !== undefined
      ? units.filter((u) => u.run === faceRun && u.obligation === undefined && eligible(u) && u !== ask && !isQuestionUnit(u))
      : units.filter((u) => u.idx > headline.idx && u.kind === 'sentence' && u.obligation === undefined && eligible(u) && u !== ask && !isQuestionUnit(u));
    // Fill the face in order up to the bullet cap AND the word budget; must-face lines are counted first and always kept.
    faceWords = wordCount(headlineText) + mustFace.reduce((n, u) => n + wordCount(u.text), 0);
    const fromPool: Unit[] = [];
    for (const u of pool) {
      if (fromPool.length >= slots) break;
      const w = wordCount(u.text);
      if (fromPool.length > 0 && faceWords + w > REPLY_FACE_WORD_BUDGET) break;
      fromPool.push(u);
      faceWords += w;
    }
    faceSet = new Set<Unit>([headline, ...fromPool, ...mustFace, ...(chanceLeadIn !== undefined ? [chanceLeadIn] : [])]);
    // Face bullets keep the reply's own order, except: a caveat on the finding opens them (#2565: "the Explain robustness
    // caveat goes on the face as bullet 1"), and the ask closes them.
    const inOrder = units.filter((u) => faceSet.has(u) && u !== headline && u !== chanceLeadIn && u !== ask);
    faceBullets = [...inOrder.filter((u) => u.obligation === 'caveat'), ...inOrder.filter((u) => u.obligation !== 'caveat')];
    if (ask !== undefined && ask !== headline) faceBullets.push(ask);
  } else {
    // H is the selected finding. Other chances and their own notes remain atomic, without narrator pool fill.
    const chanceUnits = units.filter((u) => u !== headline && !controlAsk(u)
      && present.some((o) => o.lead === true && o.role === 'evidence' && u.text === o.text));
    const findingUnits = [headline, ...chanceUnits];
    const subjectsOf = (u: Unit): Set<string> => new Set(present.filter((o) => u.text.includes(o.text))
      .flatMap((o) => o.subjects ?? []));
    const companions = units.filter((u) => !findingUnits.includes(u) && present.some((o) =>
      o.role === 'evidence' && o.companionOf !== undefined && u.text === o.text
      && findingUnits.some((finding) => subjectsOf(finding).has(o.companionOf!))));
    const exceptions = units.filter((u) => u !== headline && u !== ask && !companions.includes(u) && !controlAsk(u)
      && (u.obligation === 'withheld_reason' || u.obligation === 'caveat')
      && findingUnits.some((finding) => {
        const figureSubjects = subjectsOf(finding);
        return present.some((o) => (o.role === 'withheld_reason' || o.role === 'caveat') && u.text.includes(o.text)
          && (o.subjects ?? []).some((subject) => figureSubjects.has(subject)));
      }));
    const horizon = input.faceContract !== 'run' || input.horizonLine === undefined ? undefined
      : units.find((u) => u.text === asWritten(input.horizonLine!.trim()));
    const whatChanges = input.whatChanges === undefined ? undefined : units.find((u) => u.text === asWritten(input.whatChanges!.trim()));
    const estimates = input.estimatesLine === undefined ? undefined : units.find((u) => u.text === asWritten(input.estimatesLine!.trim()));
    faceSet = new Set<Unit>([...findingUnits, ...companions, ...exceptions, ...(horizon === undefined ? [] : [horizon]),
      ...(whatChanges === undefined ? [] : [whatChanges]), ...(estimates === undefined ? [] : [estimates]),
      ...(ask === undefined ? [] : [ask]), ...(chanceLeadIn === undefined ? [] : [chanceLeadIn])]);
    const faceWordCount = (): number => wordCount(headlineText) + [...faceSet]
      .filter((u) => u !== headline && u !== chanceLeadIn).reduce((count, u) => count + wordCount(u.text), 0);
    // One ranked list demotes only optional E and W. Figure qualifications, own notes, horizon and N stay.
    const optionalLines = { estimates, what_changes: whatChanges };
    for (const rank of FACE_DEMOTION_ORDER) {
      const optional = optionalLines[rank];
      if (faceWordCount() <= REPLY_FACE_WORD_BUDGET) break;
      if (optional !== undefined && optional !== headline && optional !== ask && !findingUnits.includes(optional)) faceSet.delete(optional);
    }
    // A narrator frame is optional when the chance already leads. Overflow consists of the mandatory set only.
    if (faceWordCount() > REPLY_FACE_WORD_BUDGET && goalChanceHeadline !== undefined && chanceLeadIn !== undefined) {
      faceSet.delete(chanceLeadIn);
      headlineText = headline.text;
    }
    faceBullets = [];
    const addExceptionsAfter = (finding: Unit): void => {
      for (const companion of companions) {
        if (!faceBullets.includes(companion) && present.some((o) => companion.text === o.text
          && o.companionOf !== undefined && subjectsOf(finding).has(o.companionOf))) faceBullets.push(companion);
      }
      const figureSubjects = subjectsOf(finding);
      for (const exception of exceptions) {
        if (faceSet.has(exception) && !faceBullets.includes(exception)
          && present.some((o) => exception.text.includes(o.text) && (o.subjects ?? []).some((subject) => figureSubjects.has(subject)))) {
          faceBullets.push(exception);
        }
      }
    };
    addExceptionsAfter(headline);
    for (const chance of chanceUnits) {
      faceBullets.push(chance);
      addExceptionsAfter(chance);
    }
    for (const line of [horizon, whatChanges, estimates, ask]) {
      if (line !== undefined && line !== headline && faceSet.has(line) && !faceBullets.includes(line)) faceBullets.push(line);
    }
    faceWords = faceWordCount();
  }
  const detailUnits = units.filter((u) => !faceSet.has(u));
  const measure: ReplyMeasure = {
    ...initialMeasure,
    face_bullets: faceBullets.length,
    detail_units: detailUnits.length,
    restatements_to_detail: restatements.size,
    face_words: wordCount(headlineText) + faceBullets.reduce((n, u) => n + wordCount(u.text), 0),
    face_bullets_over_word_bar: faceBullets.filter((u) => wordCount(u.text) > BULLET_WORD_LOG_BAR).length,
    obligations_on_face: [...faceSet].filter((u) => u.obligation !== undefined).length,
    face_over_cap: faceBullets.length > REPLY_FACE_MAX_BULLETS,
    face_over_word_budget: faceWords > REPLY_FACE_WORD_BUDGET,
    open_questions_segment: split !== null,
  };
  if (!faceContract) {
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
  }
  const detail = [renderDetail(detailUnits, faceContract), split?.segment ?? ''].filter((p) => p.length > 0).join('\n\n');
  // A typed host or goal-chance part can contain several sentences; narrator headlines keep the single-sentence contract.
  // Typed chance findings and their notes can exceed the old three-bullet limit. The coaching contract is bounded
  // by visible words; the legacy cap remains counted in telemetry, never an escape to the whole reply.
  const schema = !faceContract
    ? (goalChanceHeadline === undefined && hostHeadline === undefined ? AnswerShapeSchema
      : AnswerShapeSchema.extend({ headline: z.string().trim().min(1) }))
    : AnswerShapeSchema.extend({
      ...(goalChanceHeadline === undefined && hostHeadline === undefined ? {} : { headline: z.string().trim().min(1) }),
      bullets: z.array(z.string().trim().min(1)),
    });
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
function renderDetail(units: readonly Unit[], faceContract = false): string {
  const paras: string[][] = [];
  let prev: Unit | undefined;
  for (const u of units) {
    if (prev === undefined || u.para !== prev.para) paras.push([]);
    const lines = paras.at(-1)!;
    const piece = u.kind === 'bullet' ? `${u.marker ?? '-'} ${u.text}` : u.text;
    const joinsLine = prev !== undefined && (faceContract ? u.kind === prev.kind && u.kind !== 'heading' : u.kind === 'sentence' && prev.kind === 'sentence')
      && u.para === prev.para && u.line === prev.line && u.idx === prev.idx + 1;
    if (joinsLine) lines[lines.length - 1] = faceContract ? `${lines.at(-1)!}${u.joinBefore ?? ' '}${u.text}` : `${lines.at(-1)!} ${piece}`;
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
