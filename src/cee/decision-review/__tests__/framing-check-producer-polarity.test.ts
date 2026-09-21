/**
 * `framing_check` — the producer's own polarity instruction must not contradict
 * its own inclusion rule.
 *
 * ## Why this file exists (P7: derive from the instruction that WRITES the field)
 *
 * `framing_check` is the FRAME half of the reasoning framework
 * (frame → ideate → analyse → decide → act → learn). Two prompts write it:
 *
 *   - the LIVE monolith, `src/prompts/defaults.ts` (`decision_review_default`),
 *     served whenever `CEE_DECISION_REVIEW_DECOMPOSE` is false — which is the
 *     default (`config/index.ts`, `decisionReviewDecompose: booleanString
 *     .default(false)`);
 *   - the DARK decomposed R4 fragment, `DECOMPOSE_R4_CALIBRATION_PROMPT`,
 *     served only behind that flag.
 *
 * Both carry the SAME inclusion rule: emit the key ONLY when the options do not
 * address the stated goal, or the goal is framed as an action rather than an
 * outcome. It follows that `addresses_goal` can only ever be **false** when the
 * object is present — if the options do address the goal, the key is omitted.
 *
 * **The R4 fragment's only worked example said `"addresses_goal": true`**, one
 * line below the comment stating the opposite. The historic
 * `src/prompts/Versions /decision_review_prompt_v4_1.txt` did the same twice.
 * So the single most explicit signal a model receives about this field's
 * polarity told it to invert the field. Any consumer keying off
 * `addresses_goal === false` would then go dark on exactly the payloads that
 * carry a framing concern — an inverted gate, the failure class this estate has
 * paid for repeatedly.
 *
 * ## What this file is NOT
 *
 * It is not a guard on a consumer, because **there is no consumer**. Derived
 * 17 Aug 2026 at CEE `2ceb65f9` / UI `81b5c966`, contrast-controlled in the
 * same sweep: `\.framing_check` reaches 3 files in CEE `src/**` (the
 * `composeFragments` passthrough, the `performShapeCheck` warning, and the
 * `output_has_framing_check` telemetry counter), **zero of them a block
 * builder**, while `\.pre_mortem` reaches 9 including two real builders
 * (`compose/phase3-blocks.ts:2417`, `:2631`). In the UI the key appears in two
 * comments and no code. Building the consumer is forked on three items outside
 * a build lane's authority — no `coaching_kind`/`card_kind`/`exercise_kind`
 * member admits a framing block at the `@talchain/schemas` 0.46.0 pin (all
 * three enums are `.strict()`), no `data/dsk/v1.json` claim grounds
 * goal-vs-outcome framing, and no route accepts a goal reframe so
 * `suggested_reframe` cannot be offered without asking what we cannot accept.
 *
 * What this file pins is that **when that consumer is built, the field it reads
 * will not be inverted at source.** Fixing the instruction is cheap now and
 * un-fixable later without re-running an eval.
 *
 * ## Scope, stated so it is not over-read
 *
 * The R4 fragment is a code constant in THIS repo, registered in the prompt
 * estate (`src/prompts/estate.ts`, gated on `CEE_DECISION_REVIEW_DECOMPOSE`,
 * `defaultsTo: false`) — so editing it changes NO live behaviour and cannot be
 * served until Paul flips that flag. The monolith path actually served today is
 * the PMS row whose canonical bytes are `Prompts/canonical/decision_review.txt`;
 * this PR does not touch it, and the third assertion below states the reason it
 * needs no change: it carries no worked example, so it carries no contradiction.
 */

import { describe, expect, it } from 'vitest';

import { DECOMPOSE_R4_CALIBRATION_PROMPT } from '../decompose-prompts.js';
import { getDefaultPrompts } from '../../../prompts/loader.js';
import { registerAllDefaultPrompts } from '../../../prompts/defaults.js';
import { composeFragments } from '../decompose.js';
import { performShapeCheck } from '../shape-check.js';

registerAllDefaultPrompts();

/**
 * The `framing_check` SECTION of a prompt, located BY IDENTITY (its own JSON
 * key) rather than by grepping the whole prompt for `addresses_goal` — the
 * field name appears only here today, but a value predicate another part of the
 * prompt could satisfy is not a binding (CLAUDE.md trap 19).
 *
 * Returns `null` when the key is absent, so a caller can tell "no section" from
 * "empty section". Every test below asserts the extraction is non-empty BEFORE
 * asserting anything about its contents: an extractor that silently returns ''
 * agrees with every assertion about what a string does not contain.
 */
/**
 * Every `addresses_goal` VALUE ASSIGNMENT in a section — a line whose own
 * content is `"addresses_goal": <value>`, which is what a model copies as the
 * worked example.
 *
 * ⚠ Anchored to the START OF A LINE deliberately, and the first cut of this file
 * was not: a bare `/"addresses_goal"\s*:\s*true/` over the section also matched
 * the PROHIBITION sentence this PR added (`Never emit "addresses_goal": true`),
 * so the guard REDded on the very fix it exists to protect. A predicate over
 * prose must bind to the construction it means, not to a substring that a
 * sentence about that construction also contains.
 */
function addressesGoalAssignments(section: string): string[] {
  return [...section.matchAll(/^\s*"addresses_goal"\s*:\s*([^,\n]+)/gm)].map((m) => m[1].trim());
}

function framingCheckSection(prompt: string): string | null {
  const start = prompt.indexOf('"framing_check"');
  if (start === -1) return null;
  // To the end of the object: the next line that closes at the contract's
  // two-space indent, or the end of the prompt.
  const rest = prompt.slice(start);
  const end = rest.indexOf('\n  }');
  return end === -1 ? rest : rest.slice(0, end + 4);
}

describe('framing_check producer polarity — DECOMPOSE_R4_CALIBRATION_PROMPT', () => {
  it('declares a framing_check section at all (extraction positive control)', () => {
    const section = framingCheckSection(DECOMPOSE_R4_CALIBRATION_PROMPT);
    expect(section, 'R4 must still ask for framing_check').not.toBeNull();
    expect(
      (section as string).length,
      'extraction returned an empty section — every containment assertion below would pass vacuously',
    ).toBeGreaterThan(80);
  });

  it('every worked "addresses_goal" value is false — never the value its own inclusion rule forbids', () => {
    const section = framingCheckSection(DECOMPOSE_R4_CALIBRATION_PROMPT) as string;
    expect(section.length).toBeGreaterThan(80);
    const assignments = addressesGoalAssignments(section);
    // Positive control on the extractor: if it matched nothing, `every` below
    // would be vacuously true and the guard would certify a deleted field.
    expect(assignments, 'no addresses_goal assignment found — extractor is blind').toHaveLength(1);
    // RED at pristine: the fragment's only worked example was
    // `"addresses_goal": true,`.
    expect(assignments).toEqual(['false']);
  });

  it('states the polarity rule in words, not only by example', () => {
    const section = framingCheckSection(DECOMPOSE_R4_CALIBRATION_PROMPT) as string;
    expect(section.length).toBeGreaterThan(80);
    // The example alone is not enough: a model that ignores the example still
    // needs the rule. Both, so neither is load-bearing on its own.
    expect(section.toLowerCase()).toContain('always false');
    expect(section.toLowerCase()).toContain('never emit "addresses_goal": true');
  });

  it('asks the model to say WHICH of the two framing problems it found', () => {
    const section = framingCheckSection(DECOMPOSE_R4_CALIBRATION_PROMPT) as string;
    expect(section.length).toBeGreaterThan(80);
    // The field fuses two harms with two different remedies — options that do
    // not address the goal (add/replace options) and a goal stated as an action
    // (restate it as an outcome) — under ONE key with no discriminator member.
    // A consumer must not have to classify prose to pick a remedy: that is the
    // natural-language-predicate trap this estate has oscillated on. Until a
    // typed discriminator exists, the minimum is that the producer's own prose
    // says which. `concern` is where it must say it, and it is REQUIRED.
    expect(section).toMatch(/"concern"\s*:\s*"string\s*—\s*REQUIRED/);
    expect(section.toLowerCase()).toContain('a reader must be able to tell which');
  });

  it('the LIVE monolith carries no worked example, so it carries no contradiction', () => {
    // The union half of the invariant: NEITHER writer may show the forbidden
    // value. This passes on the monolith today with no change to it — which is
    // the evidence that this PR did not need to touch the served prompt, not an
    // assumption that it did not.
    const monolith = getDefaultPrompts().decision_review;
    expect(typeof monolith, 'decision_review default must be registered').toBe('string');
    const text = monolith as string;
    // Scoped to the WHOLE prompt, not to a section: the monolith spells the
    // field spec UNQUOTED (`framing_check (object, OPTIONAL):`) and quotes it
    // only in the OUTPUT_SCHEMA stub, so a `"framing_check"`-anchored section
    // extractor lands on the stub and reads past it. Two positive controls, so
    // the negative below cannot pass by looking at the wrong bytes.
    expect(text, 'the monolith must still ask for framing_check').toContain(
      'framing_check (object, OPTIONAL)',
    );
    expect(text, 'the monolith must still declare the boolean').toContain(
      'addresses_goal (boolean)',
    );
    // It declares the field as a TYPE, never as a VALUE — so there is no
    // assignment to be wrong, which is the whole reason the served prompt needs
    // no edit in this PR.
    expect(addressesGoalAssignments(text)).toEqual([]);
  });
});

/**
 * P1 — one seam BEYOND the guard.
 *
 * The guard above is a PROMPT instruction, and a prompt cannot compel a model
 * (CLAUDE.md trap 23: a grammar can forbid a shape, it cannot compel
 * sufficiency). So drive the values the fixed instruction still admits, plus
 * the malformed ones it does not, through the REAL downstream chain —
 * `composeFragments` (the recomposer that decides whether the key rides to the
 * wire) and `performShapeCheck` (the validator) — and assert the SURROUNDING
 * content survives in every case.
 *
 * These are characterisation assertions, deliberately: they record that the
 * recomposer does NOT fail closed on a content-less framing_check, which is
 * exactly why a future emitter must fail closed itself, the way
 * `buildPreMortemExerciseBlock` does (`compose/phase3-blocks.ts`, "Fail closed
 * on a content-less card… a content-less block would ARRIVE and never render").
 */
describe('framing_check — one seam beyond the prompt guard', () => {
  const r1 = { narrative_summary: 'n', story_headlines: { a: 'h' }, readiness_rationale: 'r' };
  const r2 = { evidence_enhancements: {}, key_assumptions: ['k'] };
  const r3 = {
    robustness_explanation: {
      summary: 's',
      primary_risk: 'p',
      stability_factors: [],
      fragility_factors: [],
    },
    scenario_contexts: {},
    flip_thresholds: [],
  };

  it('a PROSE-LESS framing_check is RETAINED by composeFragments (it does not fail closed)', () => {
    const composed = composeFragments(r1, r2, r3, {
      bias_findings: [],
      decision_quality_prompts: [],
      framing_check: { addresses_goal: false },
    });
    expect(composed.framing_check).toEqual({ addresses_goal: false });
    // Surrounding content survives — the seam does not take the review down.
    expect(composed.narrative_summary).toBe('n');
    expect(composed.key_assumptions).toEqual(['k']);
    expect(composed.robustness_explanation).toEqual(r3.robustness_explanation);
  });

  it('a WRONG-TYPED framing_check is dropped and the surrounding review survives intact', () => {
    const composed = composeFragments(r1, r2, r3, {
      bias_findings: [{ type: 'X' }],
      decision_quality_prompts: [{ question: 'Q?' }],
      framing_check: 'your framing is weak',
    });
    expect('framing_check' in composed).toBe(false);
    expect(composed.narrative_summary).toBe('n');
    expect(composed.bias_findings).toEqual([{ type: 'X' }]);
    expect(composed.decision_quality_prompts).toEqual([{ question: 'Q?' }]);
  });

  it('performShapeCheck WARNS on a wrong-typed framing_check without failing the review', () => {
    const composed = composeFragments(r1, r2, r3, {
      bias_findings: [],
      decision_quality_prompts: [],
      framing_check: 'your framing is weak',
    });
    // Re-attach the malformed value past the recomposer, so the validator sees
    // what a monolith response could hand it directly.
    const result = performShapeCheck({ ...composed, framing_check: 'your framing is weak' });
    expect(result.warnings).toContain('framing_check should be an object');
    expect(
      result.errors.filter((e) => e.includes('framing_check')),
      'a malformed OPTIONAL field must cost a warning, never an error',
    ).toEqual([]);
  });
});
