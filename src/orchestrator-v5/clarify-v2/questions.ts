/**
 * Clarify v2 — deterministic question composer (ROADMAP 1.94 Option A
 * replacement; E0-B lane).
 *
 * Encodes Paul's ratified clarifier doctrine as CODE-LEVEL INVARIANTS
 * (16 Jul 2026 ruling; clarify-brief-1.94.md §E3):
 *
 *   1. EVERY question ships 2–5 tap-able candidate answers. The response
 *      additionally carries an explicit default-forward chip ("go ahead
 *      with sensible defaults"), so no question is ever a dead end — a
 *      user can always answer in one tap or exit in one tap.
 *   2. The bare "can you give more details" class is BANNED. The
 *      postcheck (`isBannedBareDetailRequest`) is exported and applied to
 *      every emitted question; the retired clarifier's fallback templates
 *      ("Could you provide more details about: …") are the canonical
 *      offenders it rejects.
 *   3. Every question states, in one clause, what it will change in the
 *      model (`impact` — the old `impacts_draft` metadata made
 *      user-facing).
 *   4. Every candidate answer, when appended to the brief, SATISFIES the
 *      question's own rubric dimension — so an answered question can
 *      never be re-asked (the no-repeat invariant holds by construction;
 *      a pinned test iterates every template against the detectors).
 *
 * Deterministic templates, not an LLM: this is the dark launch surface.
 * The haiku-class LLM variant is the PMS `clarify_v2` prompt candidate
 * (prepared, not uploaded — parallel-briefs/clarify-v2-prompt-candidate-
 * 2026-07-16.md); when it lands it must satisfy the same shape validator.
 *
 * Pure: no I/O, no config, never throws on valid dimensions.
 */

import type { ClarifyDimension } from './rubric.js';

export interface ClarifyCandidateAnswer {
  /** Stable chip id (unique within a response). */
  readonly id: string;
  /** Short chip label (prefixed with the question topic). */
  readonly label: string;
  /**
   * The tap-to-send answer, phrased as the user's own message. MUST
   * satisfy the question's rubric dimension when appended to the brief
   * (pinned by the template-invariant test).
   */
  readonly message: string;
}

export interface ClarifyQuestion {
  readonly dimension: ClarifyDimension;
  /** The question itself, one sentence, chip-context aware. */
  readonly text: string;
  /** One clause: what answering this changes in the model. */
  readonly impact: string;
  /** 2–5 tap-able candidate answers. */
  readonly candidates: readonly ClarifyCandidateAnswer[];
}

/**
 * Banned-class postcheck — the "bare request for more details" that the
 * retired clarifier's fallback templates emitted ("Could you provide more
 * details about: X?"). A question in this class with no candidate answers
 * is a dead end by definition. Structural, not semantic: it matches the
 * generic-detail ASK SHAPES, not any topic vocabulary.
 */
const BANNED_BARE_DETAIL_PATTERNS: readonly RegExp[] = [
  /\b(?:can|could|would) you (?:please )?(?:provide|give|share|add)\b.{0,24}\b(?:more|further|additional) (?:details?|context|information|specifics)\b/i,
  /\b(?:more|further|additional) (?:details?|context|information|specifics)\b.{0,24}\b(?:please|\?)/i,
  /\btell me more\b/i,
  /\belaborate\b/i,
];

export function isBannedBareDetailRequest(text: string): boolean {
  return BANNED_BARE_DETAIL_PATTERNS.some((re) => re.test(text));
}

export const CLARIFY_V2_MIN_CANDIDATES = 2;
export const CLARIFY_V2_MAX_CANDIDATES = 5;

export type QuestionShapeViolation =
  | 'too_few_candidates'
  | 'too_many_candidates'
  | 'banned_bare_detail_request'
  | 'missing_impact_clause'
  | 'empty_question_text'
  | 'candidate_missing_copy';

/**
 * Structural shape validator — the doctrine invariants as a checkable
 * contract. Returns every violation (empty array = valid). Applied to
 * every question this module emits (see `composeClarifyQuestions`'s
 * throw-on-violation below) and available to the future LLM-authored
 * variant as its egress postcheck.
 */
export function validateQuestionShape(q: ClarifyQuestion): readonly QuestionShapeViolation[] {
  const violations: QuestionShapeViolation[] = [];
  if (q.text.trim().length === 0) violations.push('empty_question_text');
  if (q.candidates.length < CLARIFY_V2_MIN_CANDIDATES) violations.push('too_few_candidates');
  if (q.candidates.length > CLARIFY_V2_MAX_CANDIDATES) violations.push('too_many_candidates');
  if (isBannedBareDetailRequest(q.text)) violations.push('banned_bare_detail_request');
  if (q.impact.trim().length === 0) violations.push('missing_impact_clause');
  if (
    q.candidates.some(
      (c) => c.id.trim().length === 0 || c.label.trim().length === 0 || c.message.trim().length === 0,
    )
  ) {
    violations.push('candidate_missing_copy');
  }
  return violations;
}

/**
 * The per-dimension question templates. Candidate `message` strings are
 * chosen so that each one deterministically satisfies its own dimension's
 * detector battery when appended to any brief (template-invariant test).
 */
const QUESTION_TEMPLATES: Readonly<Record<ClarifyDimension, ClarifyQuestion>> = {
  goal: {
    dimension: 'goal',
    text: 'What outcome would make this decision a success?',
    impact: 'This sets the objective the model optimises for.',
    candidates: [
      {
        id: 'cv2_goal_revenue',
        label: 'Goal: grow revenue',
        message: 'The goal is to increase revenue.',
      },
      {
        id: 'cv2_goal_cost',
        label: 'Goal: cut costs',
        message: 'The goal is to reduce costs.',
      },
      {
        id: 'cv2_goal_risk',
        label: 'Goal: reduce risk',
        message: 'The goal is to reduce risk to the business.',
      },
    ],
  },
  options: {
    dimension: 'options',
    text: 'What alternatives are you weighing this against?',
    impact: 'Each alternative becomes an option the analysis compares.',
    candidates: [
      {
        id: 'cv2_options_nothing',
        label: 'Alternative: do nothing',
        message: 'The main alternative is doing nothing and keeping things as they are.',
      },
      {
        id: 'cv2_options_smaller',
        label: 'Alternative: smaller version',
        message: 'The main alternative is a scaled-down version of the same plan.',
      },
      {
        id: 'cv2_options_delay',
        label: 'Alternative: delay',
        message: 'The main alternative is delaying the decision for now.',
      },
    ],
  },
  timeframe: {
    dimension: 'timeframe',
    text: 'What timeframe does this decision need to play out over?',
    impact: 'This anchors the horizon the options are judged against.',
    candidates: [
      {
        id: 'cv2_timeframe_quarter',
        label: 'Timeframe: this quarter',
        message: 'The decision needs to play out within this quarter.',
      },
      {
        id: 'cv2_timeframe_year',
        label: 'Timeframe: this year',
        message: 'The decision needs to play out within this year.',
      },
      {
        id: 'cv2_timeframe_longer',
        label: 'Timeframe: longer',
        message: 'The decision plays out long-term, over more than a year.',
      },
    ],
  },
  quantities: {
    dimension: 'quantities',
    text: 'Roughly what scale is at stake — budget, headcount, or revenue?',
    impact: 'Rough numbers let the analysis weigh the options against each other.',
    candidates: [
      {
        id: 'cv2_quantities_small',
        label: 'Scale: under £10k',
        message: 'The stakes are small — under £10,000.',
      },
      {
        id: 'cv2_quantities_medium',
        label: 'Scale: tens of thousands',
        message: 'The stakes are in the tens of thousands of pounds.',
      },
      {
        id: 'cv2_quantities_large',
        label: 'Scale: £100k or more',
        message: 'The stakes are large — £100,000 or more.',
      },
    ],
  },
};

/**
 * Compose questions for the given missing dimensions, in the order
 * supplied (callers pass rubric-priority order), capped by `budget`.
 *
 * Fail-loud contract: every emitted question is run through
 * `validateQuestionShape`; a violation throws, because with deterministic
 * templates a violation is a build-time authoring bug, never a runtime
 * condition to degrade around. (The future LLM variant must instead
 * filter-and-log at its own boundary.)
 */
export function composeClarifyQuestions(
  missingDimensions: readonly ClarifyDimension[],
  budget: number,
): readonly ClarifyQuestion[] {
  const selected = missingDimensions.slice(0, Math.max(0, budget));
  return selected.map((dimension) => {
    const q = QUESTION_TEMPLATES[dimension];
    const violations = validateQuestionShape(q);
    if (violations.length > 0) {
      throw new Error(
        `clarify_v2 question template for '${dimension}' violates the doctrine shape: ${violations.join(', ')}`,
      );
    }
    return q;
  });
}
