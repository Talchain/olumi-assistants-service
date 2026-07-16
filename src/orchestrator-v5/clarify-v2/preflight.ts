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
 * Typed go-ahead detection for the resume path. Bare confirmations
 * ("yes", "ok") count: the ask-copy explicitly offers "say 'go ahead'",
 * and a bare yes to a question LIST is a proceed signal, not an answer to
 * any single question. Anchored ^…$ so an answer that merely contains
 * "ok" is never mis-claimed.
 */
export const CLARIFY_V2_PROCEED_PATTERN =
  /^\s*(?:yes|yep|yeah|ok(?:ay)?|sure|fine|go ahead(?:\s+and\s+draft(?:\s+the\s+model)?(?:\s+with\s+sensible\s+defaults)?)?|proceed|continue|carry on|just draft(?:\s+it|\s+the\s+model)?|draft (?:it|the model)|use (?:sensible\s+)?defaults|skip(?:\s+the\s+questions)?)\s*[.!]?\s*$/i;

/** Round state persisted on the `clarify_v2_round` pending action. */
export interface ClarifyV2RoundState {
  /** The working brief (original + incorporated answers), ≤ draft max. */
  readonly brief: string;
  /** Dimensions asked so far — the REAL asked-history. */
  readonly asked: readonly ClarifyDimension[];
  /** Rounds asked so far (1-based after the first ask). */
  readonly round: number;
}

export type ClarifyV2ProceedReason =
  | 'complete'
  | 'all_missing_already_asked'
  | 'round_budget_exhausted'
  | 'user_proceed'
  | 'explicit_generate';

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
    };

/**
 * Append an answer to the working brief, capped at the draft pipeline's
 * Zod max so the eventual `briefOverride` is guaranteed-valid. A mid-word
 * cut at 5000 chars loses nothing meaningful (same rationale as
 * `assemble-explicit-generate-brief.ts`'s `capToDraftMax`).
 */
export function incorporateAnswerIntoBrief(brief: string, answer: string): string {
  const trimmed = answer.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return brief;
  const joined = `${brief.trim()} ${trimmed}`;
  return joined.length > DRAFT_GRAPH_MAX_BRIEF_LENGTH
    ? joined.slice(0, DRAFT_GRAPH_MAX_BRIEF_LENGTH)
    : joined;
}

/** Round 1: assess the brief at draft preflight. */
export function decideClarifyV2Round1(brief: string): ClarifyV2Decision {
  const assessment = assessBriefCompleteness(brief);
  if (assessment.complete) {
    return { kind: 'proceed', brief, reason: 'complete' };
  }
  const questions = composeClarifyQuestions(
    assessment.missing,
    CLARIFY_V2_MAX_QUESTIONS_PER_ROUND,
  );
  return {
    kind: 'ask',
    questions,
    state: {
      brief,
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
   * decision-regex, per the route's own heuristic) — treated as a
   * REPLACEMENT brief rather than an appended answer.
   */
  readonly messageIsDraftShaped: boolean;
  /**
   * True when the reply arrived with the explicit-generate wire flag —
   * the strongest possible ready-to-draft signal; always proceeds.
   */
  readonly explicitGenerate: boolean;
}

/** Resume: the user replied while a clarify round was live. */
export function decideClarifyV2Resume(
  input: DecideClarifyV2ResumeInput,
): ClarifyV2Decision {
  const { state, message } = input;

  if (input.explicitGenerate) {
    // The wire message on an explicit generate is often canned chip text;
    // draft from the working brief, not from it.
    return { kind: 'proceed', brief: state.brief, reason: 'explicit_generate' };
  }
  if (
    CLARIFY_V2_PROCEED_PATTERN.test(message) ||
    message.trim() === CLARIFY_V2_PROCEED_MESSAGE
  ) {
    return { kind: 'proceed', brief: state.brief, reason: 'user_proceed' };
  }

  const workingBrief = input.messageIsDraftShaped
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
