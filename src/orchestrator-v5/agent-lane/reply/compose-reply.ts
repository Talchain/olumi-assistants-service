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
 *   · MUST-FACE (DL ruling R1, 7 Oct): the headline, the ONE ask, the withheld reason ({@link FaceObligation}), and the
 *     line that states what the user is consenting to ({@link ReplyComposeInput.consentLabels}). Host disclosures,
 *     receipts and status may move to detail. The ask is the last bullet; other questions go to detail (D-12). An
 *     obligation present in the text but not locatable as one unit keeps the reply whole (fail closed); so does a face
 *     that would need more than {@link REPLY_FACE_MAX_BULLETS} must-face bullets.
 *   · A reply with nothing to move to detail is ALREADY IN SHAPE: returned byte-identical, no sidecar.
 *
 * Pure and deterministic: no model, no I/O. The route logs {@link ReplyComposition.measure} on every turn, so each
 * model's compliance with the prompt half ({@link REPLY_SHAPE_INSTRUCTION}) is a count, not an impression.
 *
 * Regexes: bounded runs only; every unbounded `.*` is a single class over one line (linear). Timing rows:
 * `__tests__/compose-reply.test.ts`.
 */
import { AnswerShapeSchema, deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { openQuestionsSegment } from '../decision-input-ask.js';

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
 * ⭐ THE PRODUCER HALF: one sentence every chat-writing model is given (joined into `AGENT_INSTRUCTIONS`, and appended to
 * `RESEARCH_INSTRUCTIONS`). Code only: it ships in the CEE build and is never written to a prompt store. No dash a user
 * could see quoted back, and no figure other than the two budgets.
 */
export const REPLY_SHAPE_INSTRUCTION =
  'Shape: begin with one short sentence that answers. Then give at most three bullets, each on its own line starting '
  + 'with "- " and under 20 words: concise, action-oriented points grounded in this model (two bullets if you also ask a '
  + 'question). Put any further explanation after the bullets, after a blank line: Olumi shows it under More detail, '
  + 'so never repeat it in the bullets. If you ask a question, it stays your last sentence.';

export type FaceObligationRole = 'ask' | 'withheld_reason' | 'consent';
/** A host line the user must see without opening "More detail", by its exact text. */
export interface FaceObligation { readonly role: FaceObligationRole; readonly text: string }

/** Turns the route ships whole, by identity of the turn (never by reading the words). */
export type KeepWholeReason = 'method_turn' | 'leader_free_envelope' | 'consent_with_figures';

export interface ReplyComposeInput {
  /** The final prose, after every gate: exactly what would ship without the composer. */
  readonly text: string;
  readonly obligations?: readonly FaceObligation[];
  /**
   * The labels of what a proposal made THIS turn would add (by the stored proposal's identity). The first sentence that
   * names each one states what the user is consenting to, and stays on the face (R1's exception).
   */
  readonly consentLabels?: readonly string[];
  readonly keepWhole?: KeepWholeReason;
}

export interface ReplyMeasure {
  readonly units_in: number;
  readonly bullets_in: number;
  readonly questions_in: number;
  readonly face_bullets: number;
  readonly detail_units: number;
  readonly face_words: number;
  readonly face_bullets_over_word_bar: number;
  readonly obligations_on_face: number;
  readonly consent_units: number;
  readonly face_over_cap: boolean;
  readonly open_questions_segment: boolean;
}

export interface ReplyComposition {
  /** The `assistant_text` to ship: the derivation of `shape` when shaped, else the input byte-identical. */
  readonly text: string;
  readonly shape: AnswerShape | null;
  readonly outcome: 'already_in_shape' | 'shaped' | 'kept_whole';
  readonly reason?: KeepWholeReason | 'empty' | 'no_headline' | 'obligation_unlocated' | 'face_over_cap' | 'invariant_failed';
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
const SENTENCE_BOUNDARY = /([.!?…]["'”’)\]]{0,3})([ \t]{1,8})(?=["'“‘(\[]?[A-Z0-9£$€])/g;
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
function sentenceMultiset(text: string): string[] {
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
  if (text.trim().length === 0) return { text, shape: null, outcome: 'kept_whole', reason: 'empty' };

  // Obligations still present in the final text (a later gate may have removed one: then it is no longer owed).
  const present = (input.obligations ?? []).map((o) => ({ role: o.role, text: o.text.trim() }))
    .filter((o) => o.text.length > 0 && text.includes(o.text))
    .sort((a, b) => b.text.length - a.text.length);
  // Overlapping obligations are ONE unit (the gate's closing can carry the ask): the larger span stands for both, and it
  // is the ask when it holds one, so it closes the face.
  const owed: { role: FaceObligationRole; text: string }[] = [];
  for (const o of present) {
    const container = owed.find((k) => k.text.includes(o.text));
    if (container === undefined) owed.push({ ...o });
    else if (o.role === 'ask') container.role = 'ask';
  }
  if (owed.some((o) => o.text.includes('\n'))) return { text, shape: null, outcome: 'kept_whole', reason: 'obligation_unlocated' };

  const split = openQuestionsSegment(text);
  const before = parseUnits(split === null ? text : split.lead, owed, 0, 0);
  const after = split === null || split.after === '' ? { units: [] as Unit[] } : parseUnits(split.after, owed, before.paras, before.lines + 1);
  const units: Unit[] = [...before.units, ...after.units].map((u, idx) => ({ ...u, idx }));
  if (units.length === 0) return { text, shape: null, outcome: 'kept_whole', reason: 'empty' };

  // Each obligation binds its LAST occurrence (the host appends); an earlier narrator copy is an ordinary unit.
  for (const role of ['ask', 'withheld_reason'] as const) {
    const tagged = units.filter((u) => u.obligation === role);
    for (const u of tagged.slice(0, -1)) {
      const sameText = tagged.at(-1)!.text === u.text;
      if (sameText) delete u.obligation;
    }
  }
  if (owed.some((o) => !units.some((u) => u.obligation === o.role && u.text.includes(o.text)))) {
    return { text, shape: null, outcome: 'kept_whole', reason: 'obligation_unlocated' };
  }

  // R1's exception: the FIRST sentence naming each proposed item states the change being consented to.
  for (const label of (input.consentLabels ?? []).map((l) => l.trim()).filter((l) => l.length >= 3)) {
    const first = units.find((u) => u.obligation === undefined && u.kind !== 'heading' && u.text.includes(label));
    if (first !== undefined) first.obligation = 'consent';
  }

  const questions = units.filter(isQuestionUnit);
  const hostAsks = units.filter((u) => u.obligation === 'ask');
  const runs = [...new Set(units.filter((u) => u.kind === 'bullet').map((u) => u.run!))];
  // THE ONE ASK: the host's typed ask; else a question that closes the reply's first list (where the face puts it, so a
  // composed reply composes to itself); else the reply's last question. Every other question goes to detail (D-12).
  const firstRunLast = runs.length === 0 ? undefined : units.filter((u) => u.run === runs[0]).at(-1);
  const ask = hostAsks.at(-1) ?? (firstRunLast !== undefined && isQuestionUnit(firstRunLast) ? firstRunLast : questions.at(-1));
  const otherObligations = units.filter((u) => u.obligation !== undefined && u.obligation !== 'ask' && u !== ask);

  // The face's list: the first bullet run with a point that is not an obligation; its lead-in becomes the headline.
  const faceRun = runs.find((r) => units.some((u) => u.run === r && u.obligation === undefined && u !== ask));
  const firstOfRun = faceRun === undefined ? undefined : units.find((u) => u.run === faceRun)!;
  const beforeRun = firstOfRun === undefined ? undefined : units[firstOfRun.idx - 1];
  const leadIn = beforeRun !== undefined && beforeRun.obligation === undefined && beforeRun !== ask
    && (beforeRun.kind === 'heading' || /:["'”’)\]*]{0,4}$/.test(beforeRun.text)) ? beforeRun : undefined;

  const headline = leadIn
    ?? units.find((u) => u.kind === 'sentence' && (u.obligation === undefined || u.obligation === 'consent') && u !== ask && !isQuestionUnit(u))
    ?? units.find((u) => u.kind === 'heading')
    ?? (units.length === 1 ? units[0] : undefined);
  if (headline === undefined) return { text, shape: null, outcome: 'kept_whole', reason: 'no_headline' };

  const mustFace = [...otherObligations.filter((u) => u !== headline), ...(ask !== undefined && ask !== headline ? [ask] : [])];
  const slots = Math.max(0, REPLY_FACE_MAX_BULLETS - mustFace.length);
  const pool = faceRun !== undefined
    ? units.filter((u) => u.run === faceRun && u.obligation === undefined && u !== ask)
    : units.filter((u) => u.idx > headline.idx && u.kind === 'sentence' && u.obligation === undefined && u !== ask && !isQuestionUnit(u));
  const faceSet = new Set<Unit>([headline, ...pool.slice(0, slots), ...mustFace]);
  // Face bullets keep the reply's own order, except the ask, which closes the face.
  const faceBullets = units.filter((u) => faceSet.has(u) && u !== headline && u !== ask);
  if (ask !== undefined && ask !== headline) faceBullets.push(ask);
  const detailUnits = units.filter((u) => !faceSet.has(u));

  const measure: ReplyMeasure = {
    units_in: units.length,
    bullets_in: units.filter((u) => u.kind === 'bullet').length,
    questions_in: questions.length,
    face_bullets: faceBullets.length,
    detail_units: detailUnits.length,
    face_words: wordCount(headline.text) + faceBullets.reduce((n, u) => n + wordCount(u.text), 0),
    face_bullets_over_word_bar: faceBullets.filter((u) => wordCount(u.text) > BULLET_WORD_LOG_BAR).length,
    obligations_on_face: mustFace.length + (headline.obligation !== undefined ? 1 : 0),
    consent_units: units.filter((u) => u.obligation === 'consent').length,
    face_over_cap: faceBullets.length > REPLY_FACE_MAX_BULLETS,
    open_questions_segment: split !== null,
  };
  // Nothing (or too little) to put behind "More detail": the reply is already in shape, and ships exactly as written.
  if (detailUnits.reduce((n, u) => n + wordCount(u.text), 0) < REPLY_DETAIL_MIN_WORDS) return { text, shape: null, outcome: 'already_in_shape', measure };
  // More obligations than the face holds: hiding one would break its rule, so the reply ships whole (counted).
  if (measure.face_over_cap) return { text, shape: null, outcome: 'kept_whole', reason: 'face_over_cap', measure };

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

/**
 * ⭐ S-A, DL ruling R1's exception (7 Oct): the labels of what a proposal made THIS turn would add — the risk, option or
 * factors its typed result names (`propose_new_risk` `risk.label`, `propose_new_option` `option.label`,
 * `propose_new_factor` `factors[].label`), and any `add_node` label in its stored operations. The composer keeps the first
 * sentence naming each on the face: what the user consents to. Identity of the proposal, never a reading of the reply.
 */
export function consentLabelsOf(proposed: readonly { result?: unknown; operations?: readonly { op: string; value?: unknown }[] }[]): string[] {
  const labels: string[] = [];
  const add = (l: unknown): void => { if (typeof l === 'string' && l.trim() !== '' && !labels.includes(l.trim())) labels.push(l.trim()); };
  for (const p of proposed) {
    const r = (p.result ?? {}) as { risk?: { label?: unknown }; option?: { label?: unknown }; factors?: unknown };
    add(r.risk?.label);
    add(r.option?.label);
    if (Array.isArray(r.factors)) for (const f of r.factors) add((f as { label?: unknown } | null)?.label);
    for (const o of p.operations ?? []) if (o.op === 'add_node') add((o.value as { label?: unknown } | null | undefined)?.label);
  }
  return labels;
}
