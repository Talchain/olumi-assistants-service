/**
 * Clarify v2 — draft-preflight decision core + response composition
 * (ROADMAP 1.94 Option A replacement; E0-B lane).
 *
 * The PURE half of the capability: given a brief (round 1) or a persisted
 * round state plus the user's reply (resume), decide whether to ASK up to
 * `CLARIFY_V2_MAX_QUESTIONS_PER_ROUND` clarifying questions or PROCEED to
 * the draft. The I/O half (pending-action read, commit, telemetry) lives
 * in `handlers/clarify-v2-dispatch.ts`.
 *
 * Doctrine invariants encoded here (Paul, 16 Jul; clarify-brief-1.94.md §E3):
 *
 *   - QUESTION BUDGET, NOT A CAP: up to 3 questions when the brief is
 *     thin, 0 when it is complete. The retired clarifier's hard-coded
 *     ONE-question cap (`questions[0]`) is structurally gone.
 *   - SEMANTIC NO-REPEAT, BY CONSTRUCTION: a rubric dimension is asked AT
 *     MOST ONCE per scenario (`asked_dimensions` is the REAL asked-history,
 *     persisted on the pending action — the old plumbing always passed
 *     `previous_answers: []`). An ANSWERED question can additionally never
 *     re-fire because its answer satisfies the dimension's detector
 *     (template invariant, `questions.ts`).
 *   - EXPLICIT READY-TO-DRAFT STOP RULE: `decideClarifyV2Resume` PROCEEDS
 *     — never stalls, never re-asks — when (a) the working brief is
 *     complete, (b) every still-missing dimension has already been asked
 *     (the user chose not to answer it; defaults apply), (c) the round
 *     budget (`CLARIFY_V2_MAX_ROUNDS`) is exhausted, or (d) the user says
 *     go-ahead (the default-forward chip, a bare confirmation, or an
 *     explicit-generate turn). Every ask-response's copy names the escape
 *     hatch ("say 'go ahead'…"), so the stop rule is user-visible, not
 *     just internal.
 *   - ANSWERS INCORPORATE VIA THE NORMAL TURN FLOW: candidate chips carry
 *     plain user-voice messages; the resume appends them to the working
 *     brief and the eventual draft runs through the ordinary
 *     `dispatchDraftGraph` with a `briefOverride` — no bespoke
 *     incorporation LLM call (the retired `incorporateAnswer` burned
 *     ~14.6k tokens/round under a contradictory system prompt).
 *
 * Pure and total: no I/O, no Date.now(), no config reads.
 */

import type { OlumiResponse } from '@talchain/schemas/boundary';

import { DRAFT_GRAPH_MAX_BRIEF_LENGTH } from '../../schemas/assist.js';
import type { SuggestedAction } from '../compose/types.js';
import {
  assessBriefCompleteness,
  type ClarifyDimension,
} from './rubric.js';
import { composeClarifyQuestions, type ClarifyQuestion } from './questions.js';

export const CLARIFY_V2_MAX_QUESTIONS_PER_ROUND = 3;
export const CLARIFY_V2_MAX_ROUNDS = 2;

/**
 * The default-forward chip — the explicit "proceed with defaults" escape
 * every clarify response carries. Its `message` is deliberately a stable
 * constant: the resume path recognises it (alongside free-typed
 * equivalents via `CLARIFY_V2_PROCEED_PATTERN`) as the ready-to-draft
 * signal. No `action_type`: it re-submits as a fresh user turn through
 * normal routing, where the live pending action claims it.
 */
export const CLARIFY_V2_PROCEED_CHIP_ID = 'cv2_proceed_default';
export const CLARIFY_V2_PROCEED_MESSAGE =
  'Go ahead and draft the model with sensible defaults.';

/**
 * Typed go-ahead detection for the resume path. STRONG confirmations
 * ("yes", "go ahead", "draft it") count: the ask-copy explicitly offers
 * "say 'go ahead'", and a bare yes to a question LIST is a proceed
 * signal, not an answer to any single question. Anchored ^…$ so an
 * answer that merely contains "yes" is never mis-claimed.
 *
 * Review fix A4 (1.152): the WEAK acks (ok / okay / sure / fine) are
 * deliberately NOT here — a bare "ok" to a three-question list is an
 * acknowledgement, not consent to skip the questions. They live in
 * `CLARIFY_V2_BARE_ACK_PATTERN` and get a one-time re-offer of the
 * default-forward choice; after that re-offer (a direct yes/no question)
 * the same ack IS consent and proceeds.
 *
 * Review fix A12 (1.152) — why this vocabulary is NOT derived from
 * `SHORT_CONFIRM_PATTERN` (routing/deterministic-short-confirm.ts): the
 * two patterns answer different consent questions. SHORT_CONFIRM
 * confirms a SINGLE concrete offered action ("apply it", "do that"), so
 * weak acks are rightly consent there and its vocabulary carries
 * apply/confirm verbs that would be wrong here; this pattern consents to
 * "skip the remaining questions and draft with defaults", so it carries
 * draft-domain phrases (draft it, use sensible defaults, skip the
 * questions) meaningless to short-confirm — and, after A4, deliberately
 * EXCLUDES the weak acks short-confirm accepts. Deriving either from the
 * other would re-couple two different consent surfaces; the divergence
 * is pinned in clarify-v2.preflight.test.ts (1.152 A12).
 */
export const CLARIFY_V2_PROCEED_PATTERN =
  /^\s*(?:yes|yep|yeah|go ahead(?:\s+and\s+draft(?:\s+the\s+model)?(?:\s+with\s+sensible\s+defaults)?)?|proceed|continue|carry on|just draft(?:\s+it|\s+the\s+model)?|draft (?:it|the model)|use (?:sensible\s+)?defaults|skip(?:\s+the\s+questions)?)\s*[.!]?\s*$/i;

/** Review fix A4 (1.152): weak single-word acks — re-offer, don't assume. */
export const CLARIFY_V2_BARE_ACK_PATTERN = /^\s*(?:ok(?:ay)?|sure|fine)\s*[.!]?\s*$/i;

/**
 * Review fix A1 (1.152): the closed DECLINE cue set (hold off / not now /
 * don't want / stop / cancel / later / wait). Anchored ^…$ with only
 * politeness tails tolerated, so a cue word INSIDE a real answer ("we
 * should wait until Q3…") is never mis-claimed. The don't-want arm only
 * accepts process objects (answer / do this / continue) — "I don't want
 * to expand into Germany" is a statement about the DECISION and must fold
 * into the brief, not release the round.
 *
 * 1.152(i) (#498-review P2) — widened for genuine declines the first cut
 * missed, still anchored, still process-object-only:
 *   - bare no-forms ("no", "No.", "nope", "nah") and "no thanks" /
 *     "no thank you" (the politeness TAIL now carries the whole decline
 *     when the cue is a bare no);
 *   - "cancel it/this/that" (process object on the cancel arm — "the
 *     options are to cancel the contract or…" stays an answer because the
 *     pattern is anchored and 'the contract' is not an accepted object);
 *   - "let's not (do this/that | continue | bother) (now/yet)?" — bare
 *     "let's not" included; "let's not expand into Germany" is about the
 *     DECISION and still folds as an answer (unaccepted object);
 *   - a leading softener adverb ("actually/honestly hold off",
 *     "Actually, no").
 */
export const CLARIFY_V2_DECLINE_PATTERN =
  /^\s*(?:(?:actually|honestly)[,\s]+)?(?:no[,.\s]+)?(?:i\s+)?(?:(?:please\s+)?hold\s+off(?:\s+for\s+now)?|not\s+(?:now|yet|right\s+now)|don'?t\s+want\s+to(?:\s+answer(?:\s+(?:these|those|the|any))?(?:\s+questions?)?|\s+do\s+this(?:\s+(?:now|yet))?|\s+continue)?|let'?s\s+not(?:\s+(?:do\s+(?:this|that)|continue|bother)(?:\s+(?:now|yet|right\s+now))?)?|stop|cancel(?:\s+(?:it|this|that))?|(?:maybe\s+)?later|wait|no|nope|nah)\s*[,.!]?\s*(?:please|thanks|thank\s+you)?\s*[.!]?\s*$/i;

/**
 * 1.152(i) (#498-review P3, decision PINNED here): a HEDGED proceed —
 * "not sure — maybe just draft it?" — is proceed-INTENT without clear
 * consent. It is deliberately:
 *   - NOT a decline (the user is leaning toward drafting, not away);
 *   - NOT an answer-fold (the hedge is about OUR questions, not the
 *     decision — folding it in would pollute the working brief);
 *   - NOT an immediate proceed (a trailing '?' is a request for the
 *     assistant's judgement, not consent to skip the questions).
 * It takes the SAME calibration as the bare ack (A4): one direct yes/no
 * re-offer ("shall I draft with sensible defaults?"), after which the
 * same hedge — or any ack — IS consent and proceeds. Anchored: a hedge
 * opener is REQUIRED and the tail must be a recognised proceed phrase, so
 * "maybe we should expand into France" still folds as an answer.
 */
export const CLARIFY_V2_HEDGED_PROCEED_PATTERN =
  /^\s*(?:(?:i'?m\s+|i\s+am\s+)?not\s+sure|unsure|maybe|perhaps|i\s+guess)[\s,.…—–-]*(?:maybe\s+|perhaps\s+)?(?:just\s+)?(?:draft\s+(?:it|the\s+model)|go\s+ahead|proceed|use\s+(?:sensible\s+)?defaults)\s*[.!?]?\s*$/i;

/**
 * Review fix A1 (1.152), not-an-answer guard: a reply that is itself a
 * question TO the assistant (interrogative opener + trailing '?'). Never
 * folded into the working brief; re-offered once per round, then treated
 * as a decline.
 */
export const CLARIFY_V2_QUESTION_REPLY_PATTERN =
  /^\s*(?:what|why|how|who|whom|whose|when|where|which|can|could|do|does|did|is|are|was|were|will|would|should|shall|whether)\b[\s\S]*\?\s*$/i;

/**
 * Review fix A2 (1.152) — the REPLACEMENT bar. Wholesale brief
 * replacement is the one destructive move in this flow (it discards the
 * working brief, answers and all), so it demands a genuinely STANDALONE
 * draft-shaped restatement, not any ≥30-char message that clears the
 * route's loose regex (whose bare `\?$` arm lets "What do you mean by
 * timeframe?" through). Bar: route-draft-shaped AND no meta-reference to
 * the assistant/questions AND (≥60 chars OR a standalone decision
 * QUESTION — trailing '?' plus a decision word, so "Should we focus on
 * France instead?" replaces while the 33-char "It depends on whether Sam
 * accepts." appends). Precision bias runs TOWARD append: a false
 * negative costs a slightly redundant brief; a false positive destroys
 * the user's answers.
 */
const CLARIFY_V2_REPLACEMENT_MIN_LENGTH = 60;
const CLARIFY_V2_DECISION_WORD_PATTERN =
  /\b(?:should|shall|whether|versus|vs\.?|choose|decide|expand|invest|launch|hire|fire|buy|sell|acquire|pivot|layoff|restructure)\b/i;
const CLARIFY_V2_META_REFERENCE_PATTERN =
  /\b(?:you|your|question|questions|answer|answers|mean|clarify|explain)\b/i;

export function isStandaloneBriefRestatement(
  message: string,
  messageIsDraftShaped: boolean,
): boolean {
  if (!messageIsDraftShaped) return false;
  const trimmed = message.trim();
  if (CLARIFY_V2_META_REFERENCE_PATTERN.test(trimmed)) return false;
  if (trimmed.length >= CLARIFY_V2_REPLACEMENT_MIN_LENGTH) return true;
  return /\?\s*$/.test(trimmed) && CLARIFY_V2_DECISION_WORD_PATTERN.test(trimmed);
}

/** Round state persisted on the `clarify_v2_round` pending action. */
export interface ClarifyV2RoundState {
  /** The working brief (original + incorporated answers), ≤ draft max. */
  readonly brief: string;
  /** Dimensions asked so far — the REAL asked-history. */
  readonly asked: readonly ClarifyDimension[];
  /** Rounds asked so far (1-based after the first ask). */
  readonly round: number;
  /**
   * Review fixes A1/A4 (1.152): true once THIS round has spent its single
   * re-offer (bare-ack calibration or not-an-answer guard). After it, a
   * bare ack proceeds (it answers the re-offer's direct yes/no) and a
   * second question-shaped reply declines. Optional: rows persisted
   * before 1.152 parse as not-reoffered.
   */
  readonly reoffered?: boolean;
}

export type ClarifyV2ProceedReason =
  | 'complete'
  | 'all_missing_already_asked'
  | 'round_budget_exhausted'
  | 'user_proceed'
  | 'explicit_generate';

/** Why a re-offer / decline fired (also the telemetry `cue` field). */
export type ClarifyV2DeflectionCue =
  | 'bare_ack'
  | 'question_reply'
  | 'decline'
  | 'hedged_proceed';

export type ClarifyV2Decision =
  | {
      readonly kind: 'proceed';
      /** The brief the draft should run from. */
      readonly brief: string;
      readonly reason: ClarifyV2ProceedReason;
    }
  | {
      readonly kind: 'ask';
      readonly questions: readonly ClarifyQuestion[];
      /** The state to persist for the next turn's resume. */
      readonly state: ClarifyV2RoundState;
      readonly phase: 'initial' | 'follow_up';
    }
  | {
      /**
       * Review fix A1 (1.152): the user declined the round (explicit cue,
       * or a second deflection after the one re-offer). The round is
       * RELEASED — never a forced draft, never a re-ask — and the working
       * brief is kept for a later resume.
       */
      readonly kind: 'decline';
      /** The working brief to preserve (terminal `brief_text` seed, A9). */
      readonly brief: string;
      readonly cue: Exclude<ClarifyV2DeflectionCue, 'bare_ack'>;
    }
  | {
      /**
       * Review fixes A1/A4 (1.152): the reply was neither an answer nor
       * consent (a bare ack, or a question back to us). Re-present the
       * default-forward choice ONCE per round; the state to persist marks
       * the re-offer as spent (brief / asked / round untouched).
       */
      readonly kind: 'reoffer';
      readonly state: ClarifyV2RoundState;
      readonly cue: Exclude<ClarifyV2DeflectionCue, 'decline'>;
    };

/**
 * Append an answer to the working brief, capped at the draft pipeline's
 * Zod max so the eventual `briefOverride` is guaranteed-valid.
 *
 * ANSWER-PRESERVING under the cap (PR #490 review P1): when the working
 * brief is already at/near the max (a long pasted background capped at
 * round 1), a naive tail-slice of the JOINED string would delete the
 * user's answer — the one thing this function exists to keep. The answer
 * is the newest, highest-signal content, so the BRIEF's tail is truncated
 * to make room instead (a mid-word cut in a >5k background's tail loses
 * nothing meaningful — same rationale as
 * `assemble-explicit-generate-brief.ts`'s `capToDraftMax`).
 */
export function incorporateAnswerIntoBrief(brief: string, answer: string): string {
  const trimmed = answer.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return brief;
  const joined = `${brief.trim()} ${trimmed}`;
  if (joined.length <= DRAFT_GRAPH_MAX_BRIEF_LENGTH) return joined;
  const room = DRAFT_GRAPH_MAX_BRIEF_LENGTH - trimmed.length - 1;
  if (room <= 0) return trimmed.slice(0, DRAFT_GRAPH_MAX_BRIEF_LENGTH);
  return `${brief.trim().slice(0, room)} ${trimmed}`;
}

/**
 * Round 1 can only proceed or ask — decline / re-offer are resume-only
 * (they need a live round to release or re-present). The narrow type
 * keeps the dispatch's round-1 arm exhaustive without dead branches.
 */
export type ClarifyV2Round1Decision = Extract<
  ClarifyV2Decision,
  { kind: 'proceed' | 'ask' }
>;

/**
 * Round 1: assess the brief at draft preflight.
 *
 * `isExplicitGenerate` — this turn arrived with the explicit-generate wire
 * flag (the Generate action / `generate_model`). That is an EXPLICIT user
 * instruction to draft NOW; clarifying over it is a dead-end class (the
 * user pressed Generate and got a question list instead of a graph — the
 * verified worst-first-impression bug, 19 Jul journey probe). So we RESPECT
 * it unconditionally and PROCEED, exactly as the resume path already does
 * (reason `explicit_generate`), regardless of what the rubric would say
 * about brief completeness. The rubric still governs every NON-generate
 * draft-shaped turn, so genuinely thin briefs typed normally are never
 * lobotomised — they still get their clarifying questions.
 *
 * Optional with a `false` default so the many single-arg call sites (unit
 * fixtures, the eval-floor harness) keep the pre-flag rubric path, and so
 * an omitted argument fails toward "not a generate turn" — the same
 * fail-safe direction as `decideClarifyV2Resume`'s `?? null`.
 */
export function decideClarifyV2Round1(
  brief: string,
  isExplicitGenerate = false,
): ClarifyV2Round1Decision {
  // PRODUCER/READER CONTRACT — cap at the WRITE. The round state persists
  // on a `clarify_v2_round` pending whose reader (`parsePendingAction`)
  // REFUSES briefs over DRAFT_GRAPH_MAX_BRIEF_LENGTH fail-closed; an
  // uncapped round-1 brief (a long pasted background is the common case)
  // would ask questions and then be dropped at the next turn's parse —
  // answers silently ignored, escape chip dead: the exact dead-end class
  // this capability exists to kill. Same convention as
  // `incorporateAnswerIntoBrief` and the resume draft-shaped-replacement
  // branch: trim + hard slice at the draft pipeline's Zod max.
  const workingBrief = brief.trim().slice(0, DRAFT_GRAPH_MAX_BRIEF_LENGTH);
  // RESPECT the explicit generate instruction before touching the rubric —
  // never clarify over a user who has told us to draft.
  if (isExplicitGenerate) {
    return { kind: 'proceed', brief: workingBrief, reason: 'explicit_generate' };
  }
  const assessment = assessBriefCompleteness(workingBrief);
  if (assessment.complete) {
    return { kind: 'proceed', brief: workingBrief, reason: 'complete' };
  }
  const questions = composeClarifyQuestions(
    assessment.missing,
    CLARIFY_V2_MAX_QUESTIONS_PER_ROUND,
  );
  return {
    kind: 'ask',
    questions,
    state: {
      brief: workingBrief,
      asked: questions.map((q) => q.dimension),
      round: 1,
    },
    phase: 'initial',
  };
}

export interface DecideClarifyV2ResumeInput {
  readonly state: ClarifyV2RoundState;
  /** The user's reply, verbatim off the wire. */
  readonly message: string;
  /**
   * True when the reply is itself a full draft-shaped brief (length +
   * decision-regex, per the route's own heuristic). Necessary but NOT
   * sufficient for replacement — see `isStandaloneBriefRestatement`
   * (review fix A2, 1.152).
   */
  readonly messageIsDraftShaped: boolean;
  /**
   * Review fix A3 (1.152): the server-ASSEMBLED brief when the reply
   * arrived with the explicit-generate wire flag (route C2 assembly);
   * null otherwise. The strongest possible ready-to-draft signal — always
   * proceeds, and the assembled brief is INCORPORATED into the working
   * brief (it may carry content the round never saw, e.g. a draft-shaped
   * message typed alongside the Generate click) rather than discarded.
   */
  readonly explicitGenerateBrief: string | null;
}

/**
 * Review fix A3 (1.152) — merge the C2-assembled explicit-generate brief
 * into the working brief. Containment first (the assembled brief is
 * usually the persisted seed or the original message, both already inside
 * the working brief — appending would duplicate), superset restatement
 * wins outright, genuinely new content appends via the same
 * answer-preserving cap convention as `incorporateAnswerIntoBrief`.
 */
export function mergeExplicitGenerateBrief(
  workingBrief: string,
  assembled: string,
): string {
  const w = workingBrief.trim();
  const a = assembled.trim();
  if (a.length === 0) return w;
  if (w.includes(a)) return w;
  if (a.includes(w)) return a.slice(0, DRAFT_GRAPH_MAX_BRIEF_LENGTH);
  return incorporateAnswerIntoBrief(w, a);
}

/** Resume: the user replied while a clarify round was live. */
export function decideClarifyV2Resume(
  input: DecideClarifyV2ResumeInput,
): ClarifyV2Decision {
  const { state, message } = input;

  // `?? null` is deliberate: if a JS caller ever omits the field,
  // `undefined !== null` would silently turn EVERY resume reply into an
  // explicit-generate proceed — fail toward "not a generate turn" instead.
  const assembledGenerateBrief = input.explicitGenerateBrief ?? null;
  if (assembledGenerateBrief !== null) {
    // The wire message on an explicit generate is often canned chip text;
    // draft from the working brief MERGED with the assembled brief (A3),
    // never from the message.
    return {
      kind: 'proceed',
      brief: mergeExplicitGenerateBrief(state.brief, assembledGenerateBrief),
      reason: 'explicit_generate',
    };
  }
  // Review fix A10: the exact-constant check was dead code — the pattern's
  // 'go ahead…' alternation matches CLARIFY_V2_PROCEED_MESSAGE exactly
  // (pinned in clarify-v2.preflight.test.ts so a pattern edit that breaks
  // the constant's coverage goes RED, not silently dead again).
  if (CLARIFY_V2_PROCEED_PATTERN.test(message)) {
    return { kind: 'proceed', brief: state.brief, reason: 'user_proceed' };
  }
  // Review fix A4 (1.152): a weak ack is consent only AFTER the re-offer
  // turned the choice into a direct yes/no; before that it gets the
  // one-per-round re-offer.
  if (CLARIFY_V2_BARE_ACK_PATTERN.test(message)) {
    if (state.reoffered === true) {
      return { kind: 'proceed', brief: state.brief, reason: 'user_proceed' };
    }
    return { kind: 'reoffer', state: { ...state, reoffered: true }, cue: 'bare_ack' };
  }
  // 1.152(i) (P3, pinned): a hedged proceed ("not sure — maybe just draft
  // it?") is proceed-intent without clear consent — same one-per-round
  // re-offer calibration as the bare ack; after the re-offer's direct
  // yes/no, the hedge IS consent. Checked BEFORE decline so the decline
  // set can never claim a leaning-forward reply.
  if (CLARIFY_V2_HEDGED_PROCEED_PATTERN.test(message)) {
    if (state.reoffered === true) {
      return { kind: 'proceed', brief: state.brief, reason: 'user_proceed' };
    }
    return {
      kind: 'reoffer',
      state: { ...state, reoffered: true },
      cue: 'hedged_proceed',
    };
  }
  // Review fix A1 (1.152): an explicit decline releases the round.
  if (CLARIFY_V2_DECLINE_PATTERN.test(message)) {
    return { kind: 'decline', brief: state.brief, cue: 'decline' };
  }

  // Review fix A2 (1.152): replacement only for a genuinely standalone
  // restatement; the bar is checked BEFORE the not-an-answer guard so a
  // standalone decision QUESTION ("Should we focus on France instead?")
  // replaces rather than deflects.
  const replaces = isStandaloneBriefRestatement(message, input.messageIsDraftShaped);
  if (!replaces && CLARIFY_V2_QUESTION_REPLY_PATTERN.test(message)) {
    // Review fix A1 (1.152), not-an-answer guard: a question back to us is
    // never folded into the brief. One re-offer per round, then decline.
    if (state.reoffered === true) {
      return { kind: 'decline', brief: state.brief, cue: 'question_reply' };
    }
    return {
      kind: 'reoffer',
      state: { ...state, reoffered: true },
      cue: 'question_reply',
    };
  }

  const workingBrief = replaces
    ? message.trim().slice(0, DRAFT_GRAPH_MAX_BRIEF_LENGTH)
    : incorporateAnswerIntoBrief(state.brief, message);

  const assessment = assessBriefCompleteness(workingBrief);
  if (assessment.complete) {
    return { kind: 'proceed', brief: workingBrief, reason: 'complete' };
  }

  // NO-REPEAT: a dimension is asked at most once per scenario.
  const askable = assessment.missing.filter((d) => !state.asked.includes(d));
  if (askable.length === 0) {
    return {
      kind: 'proceed',
      brief: workingBrief,
      reason: 'all_missing_already_asked',
    };
  }
  // STOP RULE: bounded rounds, then draft with what we have.
  if (state.round >= CLARIFY_V2_MAX_ROUNDS) {
    return {
      kind: 'proceed',
      brief: workingBrief,
      reason: 'round_budget_exhausted',
    };
  }

  const questions = composeClarifyQuestions(
    askable,
    CLARIFY_V2_MAX_QUESTIONS_PER_ROUND,
  );
  return {
    kind: 'ask',
    questions,
    state: {
      brief: workingBrief,
      asked: [...state.asked, ...questions.map((q) => q.dimension)],
      round: state.round + 1,
    },
    phase: 'follow_up',
  };
}

/**
 * Compose the wire response for an ask decision.
 *
 * Copy contract:
 *   - British English, product voice, no graph-shape language.
 *   - Each question is numbered and carries its one-clause impact.
 *   - The escape hatch is ALWAYS named in prose ("answer whichever
 *     matters most… or say 'go ahead'") — the stop rule is user-visible.
 *   - Chips: every question's candidates (labels prefixed by topic so
 *     multi-question chip rows stay legible) + the single default-forward
 *     chip. All conversational (no `action_type`): a tap re-submits as a
 *     fresh user turn, which the live pending action claims — answers
 *     incorporate via the NORMAL turn flow.
 *
 * The response ships through `sendFinalised200` → `sanitiseOlumiResponse
 * ForEgress`, so the universal looping-chip guard (#464) covers these
 * chips BY CONSTRUCTION — pinned by clarify-v2 egress tests, not
 * re-implemented here.
 */
export function composeClarifyV2Response(
  questions: readonly ClarifyQuestion[],
  phase: 'initial' | 'follow_up',
): OlumiResponse {
  const singular = questions.length === 1;
  const lead =
    phase === 'initial'
      ? singular
        ? 'Before I draft the model, one quick question will make it sharper.'
        : 'Before I draft the model, a few quick questions will make it sharper.'
      : singular
        ? 'Thanks — I have folded that in. One more thing would sharpen the draft.'
        : 'Thanks — I have folded that in. A couple more things would sharpen the draft.';
  const numbered = questions
    .map((q, i) => `${i + 1}. ${q.text} (${q.impact})`)
    .join(' ');
  const tail =
    'Answer whichever matters most — tap an option below or type your own — ' +
    "or say “go ahead” and I'll draft with sensible defaults.";
  const assistantText = `${lead} ${numbered} ${tail}`;

  const candidateChips: SuggestedAction[] = questions.flatMap((q) =>
    q.candidates.map((c) => ({
      id: c.id,
      label: c.label,
      message: c.message,
    })),
  );
  const proceedChip: SuggestedAction = {
    id: CLARIFY_V2_PROCEED_CHIP_ID,
    label: 'Use sensible defaults',
    message: CLARIFY_V2_PROCEED_MESSAGE,
  };

  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [],
    suggested_actions: [...candidateChips, proceedChip],
    insights: [],
    stage_indicator: 'frame',
  } as OlumiResponse;
}

/**
 * Review fix A1 (1.152) — the honest decline reply. The round is released
 * (the dispatch retires the pending via `consumedPendingRefs`), the
 * working brief is preserved server-side (terminal `brief_text` seed,
 * A9), and the copy names the way back in. Deliberately NO chips: the
 * released round means a proceed chip here would replay through round-1
 * preflight where its canned message is not draft-shaped — a dead chip is
 * dishonest, so the escape hatch is named in prose instead.
 */
export const CLARIFY_V2_DECLINE_MESSAGE =
  "Okay — I'll hold off. Say 'draft it' whenever you're ready.";

export function composeClarifyV2DeclineResponse(): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: CLARIFY_V2_DECLINE_MESSAGE,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'frame',
  } as OlumiResponse;
}

/**
 * Review fixes A1/A4 (1.152) — the one-per-round re-offer. Keeps the
 * round alive (the dispatch re-persists the pending with `reoffered`
 * spent; same chip_id → supersession, no zombie twin) and re-presents the
 * default-forward choice. Copy is cue-specific: a bare ack — and a hedged
 * proceed ("not sure — maybe just draft it?", 1.152(i) P3) — gets a direct
 * yes/no ("shall I draft with sensible defaults?") so the NEXT ack is
 * unambiguous consent; a question back to us gets the honest meta-answer
 * (the questions are optional) — this path is deterministic and must not
 * pretend to answer an arbitrary question.
 */
export function composeClarifyV2ReofferResponse(
  cue: Exclude<ClarifyV2DeflectionCue, 'decline'>,
): OlumiResponse {
  const assistantText =
    cue === 'question_reply'
      ? "Happy to clarify — the questions are optional and each one just sharpens the draft. Answer whichever you like above, or say 'go ahead' and I'll draft with sensible defaults."
      : 'Just to check — shall I draft with sensible defaults, or would you like to answer any of the questions above first?';
  const proceedChip: SuggestedAction = {
    id: CLARIFY_V2_PROCEED_CHIP_ID,
    label: 'Use sensible defaults',
    message: CLARIFY_V2_PROCEED_MESSAGE,
  };
  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [],
    suggested_actions: [proceedChip],
    insights: [],
    stage_indicator: 'frame',
  } as OlumiResponse;
}
