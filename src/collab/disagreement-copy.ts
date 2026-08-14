/**
 * COLLAB — the interrogation copy. CODE-OWNED AND PINNED.
 *
 * ── WHY THIS IS A MODULE AND NOT A PROMPT ─────────────────────────────────
 * The sentences below are what the product says to a team about their own
 * disagreement. They are generated HERE, deterministically, from facts this
 * service derived — never asked of a model. A model asked to "describe the
 * disagreement" will, sooner or later, resolve it: it will call one view
 * better-reasoned, or split the difference, or say the panel "broadly agrees".
 * Each of those is the averaging failure this whole feature exists to prevent,
 * arriving through the one channel that is not type-checked. Pinned copy cannot
 * do it, and a test can prove it cannot.
 *
 * ── THE RULE EVERY SENTENCE HERE OBEYS ────────────────────────────────────
 * Each sentence is EITHER a restatement of a derived fact ("Grace said 0.85,
 * Ada said 0.20") OR a question put to the team. Never an interpretation, a
 * judgement, or a claim about which view is better supported — those are
 * exactly the assertions the product cannot verify and the team has not made.
 * ⚠ When adding copy, ask which of the two categories the sentence is in. If it
 * is neither, it does not belong here.
 *
 * ── AND WHAT IS ABSENT, BY CONSTRUCTION ───────────────────────────────────
 * No sentence in this module contains a mean, a midpoint, a "recommended", a
 * "consensus", a "majority", or a winner — and `disagreement-copy.test.ts`
 * asserts that over EVERY string this module can emit, not over a sample.
 */

import type { EvidenceStance } from './types.js';

/**
 * The shape of a target's divergence. This is a DESCRIPTION of the answers, not
 * a score of them: `aligned` is not "good" and `split` is not "bad". A clean
 * alignment can be four people repeating one briefing, and a wide split can be
 * the most valuable thing in the room.
 */
export type DivergenceShape = 'no_answers' | 'single_view' | 'aligned' | 'split';

/** Facts the copy may use. Everything here is DERIVED, never asserted. */
export interface DisagreementFacts {
  /** The owner's own words for the target, as the panel was asked. */
  readonly label: string;
  /** Distinct participants who gave a number. */
  readonly answering: number;
  /** Distinct numeric values among them. */
  readonly distinctValues: number;
  /** How many of those participants also gave words. */
  readonly withStatedBasis: number;
  /** Participants who explicitly declined. */
  readonly declined: number;
  /** Pieces of evidence attached to this target. */
  readonly evidenceCount: number;
  /** Whether any attached evidence CHALLENGES a position. */
  readonly hasChallenge: boolean;
}

/**
 * The question the product puts to the team about one target.
 *
 * Returns null when there is nothing to interrogate — an absent question is
 * better than a filler one, and a screen that always has something to say
 * teaches people to stop reading it.
 */
export function interrogationQuestion(
  shape: DivergenceShape,
  facts: DisagreementFacts,
): string | null {
  switch (shape) {
    case 'no_answers':
      return null;

    case 'single_view':
      // Deliberately NOT "get more answers": one considered view may be the
      // right amount of input, and the product does not know. It states what is
      // true and leaves the judgement where it belongs.
      return 'Only one person answered this. Their view stands as they gave it — nobody has agreed with it or challenged it.';

    case 'aligned':
      // ⭐ AGREEMENT IS INTERROGATED TOO, AND THIS IS THE SCIENTIFIC POINT OF
      // THE WHOLE SURFACE. A panel that agrees may have reasoned independently
      // and converged, or may have all read the same briefing — those are very
      // different states and they look identical in the numbers. Only the team
      // can tell them apart, so the product asks rather than congratulating.
      return facts.withStatedBasis > 0
        ? 'Everyone who answered gave the same number. Worth one question before you rely on it: did you reach it independently, or from the same source?'
        : 'Everyone who answered gave the same number, and nobody said why. Did you reach it independently, or from the same source?';

    case 'split':
      if (facts.hasChallenge) {
        // The strongest hook available: someone has already done the work of
        // saying what is wrong with a position, in their own words.
        return 'These views differ, and someone has challenged one of them. Read the challenge against what each person said, then decide which you are acting on.';
      }
      if (facts.withStatedBasis === 0) {
        return 'These answers differ and none of them says why. Ask what each is based on before you use any of them.';
      }
      if (facts.withStatedBasis < facts.answering) {
        return 'These answers differ, and only some of them say why. The ones without a reason are the ones you cannot interrogate yet.';
      }
      return 'These answers differ and each says why. The disagreement is in the reasons — compare what each person is assuming, rather than picking a number.';
  }
}

/**
 * The plain statement of the divergence, put above the positions.
 *
 * ⚠ It never says "disagree" about people who merely gave different numbers on
 * a scale — two people 0.02 apart have not had an argument. It reports the
 * count of distinct answers, which is what was measured.
 */
export function divergenceHeadline(shape: DivergenceShape, facts: DisagreementFacts): string {
  switch (shape) {
    case 'no_answers':
      return facts.declined > 0
        ? 'Nobody gave a number for this. That is itself an answer about how knowable it is.'
        : 'Nobody has answered this yet.';
    case 'single_view':
      return 'One person answered this.';
    case 'aligned':
      return `${facts.answering} people answered, and gave the same number.`;
    case 'split':
      return `${facts.answering} people answered, with ${facts.distinctValues} different numbers between them. They are kept as they were given and are not combined.`;
  }
}

/** How a stance reads in a sentence. Fixed strings, never model-chosen. */
export const STANCE_PHRASE: Readonly<Record<EvidenceStance, string>> = {
  supports: 'supports',
  challenges: 'challenges',
  qualifies: 'qualifies',
};

/**
 * The standing sentence about what applying a position does — and does not do.
 *
 * ⚠ SINGLE SOURCE. The reveal already tells the owner that applying one answer
 * does not remove the others; this surface must not invent a second, subtly
 * different promise about the same mechanism. Two authorities on one user-facing
 * guarantee is CLAUDE.md trap 21, and the symptom is a product that contradicts
 * itself across two screens.
 */
export const DISSENT_SURVIVES_APPLY =
  'Applying one of these to your model does not remove the others. They stay recorded here, attributed, exactly as they were given.';

/**
 * Words that would mean this surface had resolved the disagreement for the
 * team. Asserted ABSENT across every string the module can emit.
 *
 * ⚠ THIS LIST IS THE ORACLE AND IT IS HAND-WRITTEN ON PURPOSE. Deriving it from
 * the copy would make it agree with the copy by construction — a guard agreeing
 * with itself (CLAUDE.md 13b). It is the one place in this feature where a
 * hand-maintained list is the CORRECT instrument, because its job is to
 * disagree with the thing it checks.
 */
export const FORBIDDEN_RESOLUTION_WORDS: readonly string[] = [
  'average',
  'mean',
  'median',
  'midpoint',
  'consensus',
  'recommended',
  'winner',
  'majority',
  'best estimate',
  'combined',
  'aggregate',
  'we suggest',
  'you should use',
];
