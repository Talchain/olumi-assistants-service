/**
 * ⭐ THE RETIRED RECOMMENDATION VERB, AND THE LEAK ITS RETIREMENT COULD HAVE
 * OPENED.
 *
 * PAUL'S RULING, 21 Sep 2026, VERBATIM: "It's not a leading option. It's the
 * option from the causal analysis that either is most likely to happen or, if
 * we can provide this, is most likely to achieve the user's goal. We are a
 * reasoning enhancement tool, not a causal analysis tool. We are giving them
 * information to improve their critical and creative thinking, not
 * recommending options."
 *
 * ⛔ WHY THIS FILE IS A LEAK GUARD AND NOT A COPY TEST.
 *
 * The superseded sentence was READ as well as written.
 * `context/withheld-history-redaction.ts` carries a `favour` pattern because
 * "the analysis currently favours …" was a LIVE LEAK on the POST-#713 walk: a
 * stored sentence that has to be scrubbed out of the model's own history when a
 * LATER turn withholds the leader claim. Measured on this branch by RUNNING the
 * exported readers before the guard was extended:
 *
 *     "…the analysis currently favours X…"     alarm=false  history=TRUE
 *     "…X came out highest on your goal…"      alarm=false  history=false  ⛔
 *
 * So changing the emitter ALONE moves the history reader TRUE→false and
 * re-opens exactly the leak that pattern closes. The assertions below run the
 * REAL composers through the REAL readers, so they fail if the emitter and the
 * guards ever part company again.
 *
 * ⭐ ASSERT SURVIVAL, NOT THE CONSTANT. Nothing here re-types the sentence and
 * compares a literal — that would be another hand-maintained copy which keeps
 * passing while the composers drift away from it (CLAUDE.md trap 13b). Every
 * assertion composes with the exported composer and reads the exported reader.
 */
import { describe, it, expect } from 'vitest';
import {
  RESULT_STANDING_VERB,
  RESULT_STANDING_EXEMPLARS,
  composeResultStandingSentence,
  composeRunnerUpStandingSentence,
} from '../goal-referenced-result-phrasing.js';
import { textNamesLeadingOption } from '../leading-option-egress-guard.js';
import { historyAssertsLeaderClaim } from '../../context/withheld-history-redaction.js';

/**
 * The sentences the product emitted on dated builds, reproduced verbatim.
 *
 * ⚠ APPEND-ONLY RECORD (CLAUDE.md trap 14b). These are bytes a real user was
 * shown — the POST-#713 walk's `case5.clarify` leak and the runner-up standing
 * sentence that stood until `09a1b3a5`. They are the POSITIVE CONTROLS: if the
 * readers stop seeing the first one, the redactor has lost the coverage that
 * made it worth having, and every assertion about the replacement is being made
 * by an instrument that no longer discriminates.
 */
const SUPERSEDED_LIVE_SENTENCES = Object.freeze({
  favours:
    'Based on this model, the analysis currently favours Standardise on MacBook Pro, with a probability of 56%.',
  secondPlace: 'Standardise on Dell XPS sits in second place, with a probability of 26%.',
});

/**
 * Ordinary coaching prose that asserts NO ordering between options.
 *
 * ⚠ THE CONTRAST CONTROL, and it is the half that makes the coverage claims
 * mean anything: a reader that fired on everything would satisfy every
 * `toBe(true)` below while scrubbing legitimate coaching out of the model's
 * history. Absence is only proven when the target reads true AND this reads
 * false in the same run.
 */
const NO_ORDERING_CLAIM = Object.freeze([
  'Two of your assumptions have no evidence attached yet, so the model is resting on them.',
  'What would firm this up is real enterprise figures from your pipeline.',
  'One useful thing to check is the link from delivery risk to successful launch.',
]);

describe('the result sentence states a measurement, not a recommendation', () => {
  it('never uses the retired recommendation verb, in any inflection', () => {
    const emitted = [
      composeResultStandingSentence('Option A', 'Annual recurring revenue', ', with a probability of 62%'),
      composeResultStandingSentence('Option A', null, ', with a probability of 62%'),
      composeRunnerUpStandingSentence('Option B', ', with a probability of 24%'),
    ];
    for (const sentence of emitted) {
      expect(sentence, 'a recommendation verb reached the user').not.toMatch(/\bfavou?r(?:s|ed|ing|ite)?\b/i);
      expect(sentence, 'league-table framing with no stated referent').not.toMatch(/\bsits in second place\b/i);
      expect(sentence).not.toMatch(/\bperforms best\b/i);
      expect(sentence).not.toMatch(/\bleading option\b/i);
      expect(sentence).not.toMatch(/\brecommend(?:s|ed|ation)?\b/i);
      expect(sentence).not.toMatch(/\bwinner\b/i);
    }
  });

  it('POSITIVE CONTROL: those same matchers DO reject the superseded sentences', () => {
    // Without this, the assertions above could be passing by testing nothing.
    expect(SUPERSEDED_LIVE_SENTENCES.favours).toMatch(/\bfavou?r(?:s|ed|ing|ite)?\b/i);
    expect(SUPERSEDED_LIVE_SENTENCES.secondPlace).toMatch(/\bsits in second place\b/i);
  });

  it('names what the option came out highest ON, and never invents a referent', () => {
    const named = composeResultStandingSentence('Option A', 'Annual recurring revenue', '');
    expect(named).toContain('Annual recurring revenue');
    const unnamed = composeResultStandingSentence('Option A', null, '');
    expect(unnamed).toContain('your goal');
    // A wrong goal is worse than a generic one: the reader cannot tell it is wrong.
    expect(unnamed).not.toContain('Annual recurring revenue');
    // A blank or whitespace goal is an ABSENT goal, not a referent.
    expect(composeResultStandingSentence('Option A', '   ', '')).toContain('your goal');
  });

  it('states the runner-up’s OWN share and never the subtraction', () => {
    const runner = composeRunnerUpStandingSentence('Option B', ', with a probability of 24%');
    expect(runner).toContain('came out highest less often');
    expect(runner).not.toMatch(/percentage points?/i);
    expect(runner).not.toMatch(/\bmargin\b/i);
  });
});

describe('the guards can see what the composers emit', () => {
  it('⭐ THE LEAK GUARD: every composed sentence is visible to the egress alarm', () => {
    expect(RESULT_STANDING_EXEMPLARS.length).toBeGreaterThan(0);
    for (const sentence of RESULT_STANDING_EXEMPLARS) {
      expect(
        textNamesLeadingOption(sentence),
        `the egress alarm is blind to ${JSON.stringify(sentence)} — LEADER_CLAIM_PATTERNS no longer follows RESULT_STANDING_VERB`,
      ).toBe(true);
    }
  });

  it('⭐ THE LEAK GUARD: and to the withheld-history redactor, which calls it', () => {
    // `historyAssertsLeaderClaim` is a strict superset BY CALLING the alarm
    // reader, so this is what actually stops a withheld leader reaching the
    // user through the model's own stored history on a later turn.
    for (const sentence of RESULT_STANDING_EXEMPLARS) {
      expect(
        historyAssertsLeaderClaim(sentence),
        `the history redactor is blind to ${JSON.stringify(sentence)} — a withheld leader would survive in stored history`,
      ).toBe(true);
    }
  });

  it('the superseded phrasing stays covered too (the record is not de-guarded)', () => {
    // Retiring the emitter must not retire the pattern: history persisted from
    // builds that DID emit it is still replayed into the model.
    expect(historyAssertsLeaderClaim(SUPERSEDED_LIVE_SENTENCES.favours)).toBe(true);
  });

  it('CONTRAST CONTROL: prose with no ordering claim is spared by both readers', () => {
    // If this ever goes true, every coverage assertion above is vacuous AND the
    // redactor has started scrubbing legitimate coaching.
    for (const sentence of NO_ORDERING_CLAIM) {
      expect(textNamesLeadingOption(sentence), `alarm over-fires on ${JSON.stringify(sentence)}`).toBe(false);
      expect(historyAssertsLeaderClaim(sentence), `redactor over-fires on ${JSON.stringify(sentence)}`).toBe(false);
    }
  });

  it('the matcher is DERIVED from the verb, not hand-copied beside it', () => {
    // Bind by identity: the exemplar must contain the constant the guard's
    // pattern is built from, so a reword cannot leave one of them behind.
    for (const sentence of RESULT_STANDING_EXEMPLARS) {
      expect(sentence).toContain(RESULT_STANDING_VERB);
    }
  });
});
