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
 *   · NEVER BY DELETING MEANING. Sentences are MOVED, never removed, rewritten or cut. A runtime invariant compares the
 *     sentence multiset of the input and of the derived text; any difference ships the input whole (fail closed).
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
 *   · NEVER DELETES A CHALLENGE (AIE §7): nothing is removed; a challenge the face cannot hold sits under More detail.
 *
 * Pure and deterministic: no model, no I/O. The route logs {@link ReplyComposition.measure} on every turn, so each
 * model's compliance with the prompt half ({@link REPLY_SHAPE_INSTRUCTION}) is a count, not an impression.
 *
 * Regexes: bounded runs only; every unbounded `.*` is a single class over one line (linear). Timing rows:
 * `__tests__/compose-reply.test.ts`.
 */
import { AnswerShapeSchema, deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { openQuestionsSegment } from '../decision-input-ask.js';
import { namedUnsizedLinks, UNSIZED_CAUSE } from './named-unsized-links.js';

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
 * but is never split. A reply with no model sentence outside host parts ships as the host composed it.
 */
export type FaceObligationRole = 'ask' | 'withheld_reason' | 'caveat' | 'evidence' | 'host';
/** Overlapping obligations are one unit carrying the strongest role among them. */
const ROLE_RANK: Record<FaceObligationRole, number> = { ask: 5, withheld_reason: 4, caveat: 3, evidence: 2, host: 1 };
export interface FaceObligation { readonly role: FaceObligationRole; readonly text: string; readonly subjects?: readonly string[] }

/** Turns the route ships whole, by identity of the turn (never by reading the words). */
/** The typed response profile, chosen by the turn kind (never by reading the words). */
export type ReplyProfile = 'coaching' | 'method_step' | 'proposal';
/**
 * Why a reply ships whole by the turn's identity: its profile is not `coaching`, the egress replaced the body, or no model
 * wrote words this turn (a card press, an uninterpreted Run: the host composed every line, `host_composed`).
 */
export type KeepWholeReason = 'method_step' | 'proposal' | 'leader_free_envelope' | 'host_composed';

export interface ReplyComposeInput {
  /** The final prose, after every gate: exactly what would ship without the composer. */
  readonly text: string;
  readonly obligations?: readonly FaceObligation[];
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
}

export interface ReplyComposition {
  /** The `assistant_text` to ship: the derivation of `shape` when shaped, else the input byte-identical. */
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
const SENTENCE_BOUNDARY = /([.!?…]["'”’)\]]{0,3})([ \t]{1,8})(?=["'“‘([]?[A-Z0-9£$€])/g;
const QUESTION_END = /\?["'”’)\]*]{0,4}$/;
const HEADING_MAX = 60;

function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  if (t.endsWith(':')) return true;
  return t.length <= HEADING_MAX && !/[.!?…]["'”’)\]*]{0,4}$/.test(t);
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

// ── the composer ─────────────────────────────────────────────────────────────────────────────────

/**
 * Compose the reply's shape. Never throws; never deletes, rewrites or cuts a sentence.
 */
export function composeReplyShape(input: ReplyComposeInput): ReplyComposition {
  const text = input.text;
  if (input.keepWhole !== undefined) return { text, shape: null, outcome: 'kept_whole', reason: input.keepWhole };
  if (input.profile === 'method_step' || input.profile === 'proposal') return { text, shape: null, outcome: 'kept_whole', reason: input.profile };
  if (text.trim().length === 0) return { text, shape: null, outcome: 'kept_whole', reason: 'empty' };

  // Obligations still present in the final text (a later gate may have removed one: then it is no longer owed).
  const present = (input.obligations ?? []).map((o) => ({ ...o, text: o.text.trim() }))
    .filter((o) => o.text.length > 0 && text.includes(o.text))
    .sort((a, b) => b.text.length - a.text.length);
  // Overlapping obligations are ONE unit (the gate's closing can carry the ask): the larger span stands for both, and it
  // is the ask when it holds one, so it closes the face.
  const owed: { role: FaceObligationRole; text: string }[] = [];
  for (const o of present) {
    const container = owed.find((k) => k.text.includes(o.text));
    if (container === undefined) owed.push({ ...o });
    else if (ROLE_RANK[o.role] > ROLE_RANK[container.role]) container.role = o.role;
  }
  if (owed.some((o) => o.text.includes('\n'))) return { text, shape: null, outcome: 'kept_whole', reason: 'obligation_unlocated' };

  const split = openQuestionsSegment(text);
  const before = parseUnits(split === null ? text : split.lead, owed, 0, 0);
  const after = split === null || split.after === '' ? { units: [] as Unit[] } : parseUnits(split.after, owed, before.paras, before.lines + 1);
  const units: Unit[] = [...before.units, ...after.units].map((u, idx) => ({ ...u, idx }));
  if (units.length === 0) return { text, shape: null, outcome: 'kept_whole', reason: 'empty' };

  // Each obligation binds its LAST occurrence (the host appends); an earlier narrator copy is an ordinary unit.
  for (const role of ['ask', 'withheld_reason', 'caveat', 'evidence', 'host'] as const) {
    const tagged = units.filter((u) => u.obligation === role);
    for (const u of tagged.slice(0, -1)) {
      const sameText = tagged.at(-1)!.text === u.text;
      if (sameText) delete u.obligation;
    }
  }
  if (owed.some((o) => !units.some((u) => u.obligation === o.role && u.text.includes(o.text)))) {
    return { text, shape: null, outcome: 'kept_whole', reason: 'obligation_unlocated' };
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
  const otherObligations = units.filter((u) => u.obligation !== undefined && u.obligation !== 'ask' && u.obligation !== 'host' && u !== ask);

  // The face's list: the first bullet run with a point that is not an obligation; its lead-in becomes the headline.
  const faceRun = runs.find((r) => units.some((u) => u.run === r && u.obligation === undefined && eligible(u) && u !== ask && !isQuestionUnit(u)));
  const firstOfRun = faceRun === undefined ? undefined : units.find((u) => u.run === faceRun)!;
  const beforeRun = firstOfRun === undefined ? undefined : units[firstOfRun.idx - 1];
  const leadIn = beforeRun !== undefined && beforeRun.obligation === undefined && eligible(beforeRun) && beforeRun !== ask
    && (beforeRun.kind === 'heading' || /:["'”’)\]*]{0,4}$/.test(beforeRun.text)) ? beforeRun : undefined;

  const headline = leadIn
    ?? units.find((u) => u.kind === 'sentence' && u.obligation === undefined && eligible(u) && u !== ask && !isQuestionUnit(u))
    ?? units.find((u) => u.kind === 'heading' && eligible(u))
    ?? (restatements.size > 0 ? units.find((u) => u.obligation !== undefined && u.obligation !== 'host') : undefined)
    ?? (units.length === 1 && eligible(units[0]!) ? units[0] : undefined);
  if (headline === undefined) return { text, shape: null, outcome: 'kept_whole', reason: 'no_headline' };

  const mustFace = [...otherObligations.filter((u) => u !== headline), ...(ask !== undefined && ask !== headline ? [ask] : [])];
  const slots = Math.max(0, REPLY_FACE_MAX_BULLETS - mustFace.length);
  const pool = faceRun !== undefined
    ? units.filter((u) => u.run === faceRun && u.obligation === undefined && eligible(u) && u !== ask && !isQuestionUnit(u))
    : units.filter((u) => u.idx > headline.idx && u.kind === 'sentence' && u.obligation === undefined && eligible(u) && u !== ask && !isQuestionUnit(u));
  // Fill the face in order up to the bullet cap AND the word budget; must-face lines are counted first and always kept.
  let faceWords = wordCount(headline.text) + mustFace.reduce((n, u) => n + wordCount(u.text), 0);
  const fromPool: Unit[] = [];
  for (const u of pool) {
    if (fromPool.length >= slots) break;
    const w = wordCount(u.text);
    if (fromPool.length > 0 && faceWords + w > REPLY_FACE_WORD_BUDGET) break;
    fromPool.push(u);
    faceWords += w;
  }
  const faceSet = new Set<Unit>([headline, ...fromPool, ...mustFace]);
  // Face bullets keep the reply's own order, except: a caveat on the finding opens them (#2565: "the Explain robustness
  // caveat goes on the face as bullet 1"), and the ask closes them.
  const inOrder = units.filter((u) => faceSet.has(u) && u !== headline && u !== ask);
  const faceBullets = [...inOrder.filter((u) => u.obligation === 'caveat'), ...inOrder.filter((u) => u.obligation !== 'caveat')];
  if (ask !== undefined && ask !== headline) faceBullets.push(ask);
  const detailUnits = units.filter((u) => !faceSet.has(u));

  const measure: ReplyMeasure = {
    words_in: wordCount(text),
    units_in: units.length,
    bullets_in: units.filter((u) => u.kind === 'bullet').length,
    questions_in: units.filter(isQuestionUnit).length,
    face_bullets: faceBullets.length,
    detail_units: detailUnits.length,
    restatements_to_detail: restatements.size,
    face_words: wordCount(headline.text) + faceBullets.reduce((n, u) => n + wordCount(u.text), 0),
    face_bullets_over_word_bar: faceBullets.filter((u) => wordCount(u.text) > BULLET_WORD_LOG_BAR).length,
    obligations_on_face: mustFace.length + (headline.obligation !== undefined ? 1 : 0),
    face_over_cap: faceBullets.length > REPLY_FACE_MAX_BULLETS,
    face_over_word_budget: faceWords > REPLY_FACE_WORD_BUDGET,
    open_questions_segment: split !== null,
  };
  // Already in shape, shipped exactly as written: the whole reply fits the face budget with at most one question, or
  // too little would go behind "More detail" to be worth a click.
  if (restatements.size === 0 && measure.words_in <= REPLY_FACE_WORD_BUDGET && questions.length <= 1) return { text, shape: null, outcome: 'already_in_shape', measure };
  if (restatements.size === 0 && detailUnits.reduce((n, u) => n + wordCount(u.text), 0) < REPLY_DETAIL_MIN_WORDS) return { text, shape: null, outcome: 'already_in_shape', measure };
  // More obligations than the face holds: hiding one would break its rule, so the reply ships whole (counted).
  if (measure.face_over_cap) return { text, shape: null, outcome: 'kept_whole', reason: 'face_over_cap', measure };
  // ⛔ A lead-in stays with what it introduces ("…, on current information:" before the screen's chance lines): a face
  // line whose lead-in would go to detail ships the reply whole (counted), never a finding stripped of its frame.
  if (units.some((u) => faceSet.has(u) && u !== headline && u.idx > 0 && !faceSet.has(units[u.idx - 1]!)
    && units[u.idx - 1]!.kind === 'sentence' && /:["'”’)\]*]{0,4}$/.test(units[u.idx - 1]!.text))) {
    return { text, shape: null, outcome: 'kept_whole', reason: 'lead_in_split', measure };
  }

  const detail = [renderDetail(detailUnits), split?.segment ?? ''].filter((p) => p.length > 0).join('\n\n');
  const parsed = AnswerShapeSchema.safeParse({ headline: headline.text, bullets: faceBullets.map((u) => u.text), detail });
  if (!parsed.success) return { text, shape: null, outcome: 'kept_whole', reason: 'no_headline', measure };
  const shaped = deriveAnswerTextFromShape(parsed.data);
  // ⛔ THE INVARIANT: every sentence of the input, and nothing else, is in the derived text.
  const a = sentenceMultiset(text);
  const b = sentenceMultiset(shaped);
  if (a.length !== b.length || a.some((s, i) => s !== b[i])) return { text, shape: null, outcome: 'kept_whole', reason: 'invariant_failed', measure };
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
