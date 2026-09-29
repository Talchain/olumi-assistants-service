/**
 * ROADMAP 2.11 / P1-3 — copy↔detector CONTRACT pin.
 *
 * The honest-path promise is only honest if the phrasings the assistant
 * ADVISES the user to type are phrasings the deterministic configure-option
 * gate (`detectConfigureOptionIntent`) actually matches. Round-3 review
 * (PR #487) proved the first cut broke that promise: the misroute clarify
 * advised "the acquisition option sets Setup Cost to £2m" (detector: NO
 * match — LLM-router-dependent, the exact lying-loop class this PR exists
 * to kill), and the GM needs-encoding notice advised nothing deterministic
 * at all.
 *
 * This suite derives the advised exemplars FROM THE SHIPPED COPY (trap-12:
 * derive, don't mirror): it invokes the real copy producers, extracts every
 * quoted phrase introduced by "say"/"for example", and runs the SHIPPED
 * detector over each with an EMPTY option-label list (the strongest claim:
 * no label anchor is needed for the advised phrasing to route). A future
 * copy edit that drops or weakens an advised exemplar fails here loudly —
 * either the detector stops matching, or the positive control below trips
 * because the copy no longer advises anything extractable.
 */

import { describe, it, expect } from 'vitest';

import { detectConfigureOptionIntent } from '../configure-option-intent.js';
import {
  buildConfigureOptionChip,
  CONFIGURE_OPTION_GENERIC_CHIP,
  buildConfigureOptionAdvisedFormat,
} from '../../configure-option-chip-text.js';
import { composeBody } from '../../compose/validation-failure-responses.js';
import type { ComposeContext } from '../../compose/types.js';
import type {
  HandlerValidationRegistry,
  ValidationError,
} from '../validator.js';
import { buildUnconfiguredOptionsNotice } from '../../handlers/gm-held-execute.js';
// ⭐ ROADMAP 2.427 — the extractor now SHIPS, and this suite consumes the
// shipped one. It used to be defined locally here, which made the test and the
// production check a hand-maintained pair with nothing keeping them equal
// (trap 12, inside the very file that exists to abolish mirrors).
import {
  extractAdvisedExemplars,
  findNonRoutableConfigureAdvice,
} from '../configure-option-advice.js';
import {
  composeConfigureOptionClarifyResponse,
  CONFIGURE_OPTION_EXAMPLE_VALUE,
} from '../../compose/configure-option-clarify-response.js';

// Positive control for the extractor itself (trap-13: an absence/coverage
// assertion is vacuous unless the mechanism provably sees a presence).
describe('extractAdvisedExemplars — positive control', () => {
  it('sees single-quoted, double-quoted, and multiple exemplars', () => {
    expect(
      extractAdvisedExemplars("Nothing changed. Say 'configure the X option' and go."),
    ).toEqual(['configure the X option']);
    expect(
      extractAdvisedExemplars('Try it, for example "configure my option: set Cost to 5".'),
    ).toEqual(['configure my option: set Cost to 5']);
    expect(extractAdvisedExemplars('No advice here at all.')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The live copy producers (the real modules, real inputs).
// ---------------------------------------------------------------------------

const REGISTRY: HandlerValidationRegistry = {
  run_analysis: {
    handler_id: 'run_analysis',
    accepted_entity_kinds: ['option'],
    confirmation_template: 'ok',
  },
};
const CTX: ComposeContext = { handlerRegistry: REGISTRY };

function misrouteClarifyCopy(handlerId: string): string {
  const error: ValidationError = {
    code: 'OPTION_INTERVENTION_MISROUTE',
    message: 'refused',
    details: { handler_id: handlerId },
  };
  return composeBody(error, CTX).body.assistant_text;
}

interface AdvisedCopySource {
  readonly name: string;
  readonly copy: string;
}

/** Every shipped copy surface that advises a configure-option phrasing. */
function advisedCopySources(): AdvisedCopySource[] {
  return [
    {
      name: 'validation-failure adjust_edge_strength misroute clarify',
      copy: misrouteClarifyCopy('adjust_edge_strength'),
    },
    {
      name: 'GM needs-encoding notice (single option)',
      copy: buildUnconfiguredOptionsNotice(['Acquire Small German Competitor']) ?? '',
    },
    {
      name: 'GM needs-encoding notice (multiple options)',
      copy: buildUnconfiguredOptionsNotice(['Option A', 'Option B', 'Option C']) ?? '',
    },
  ];
}

// ---------------------------------------------------------------------------
// The contract: every advised exemplar matches the shipped detector.
// ---------------------------------------------------------------------------

describe('configure-option copy ↔ detector contract', () => {
  for (const source of advisedCopySources()) {
    it(`${source.name}: advises at least one exemplar the detector matches (empty labels)`, () => {
      // Positive control per source: the copy must actually advise an
      // extractable exemplar. If a copy edit removes the quoted advice,
      // this fails loudly instead of the suite passing on nothing.
      const exemplars = extractAdvisedExemplars(source.copy);
      expect(exemplars.length, `no advised exemplar found in: ${source.copy}`).toBeGreaterThan(0);

      for (const exemplar of exemplars) {
        const detection = detectConfigureOptionIntent(exemplar, []);
        expect(
          detection.matched,
          `advised exemplar does not route deterministically: '${exemplar}' (in ${source.name})`,
        ).toBe(true);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // ⭐ ROADMAP 2.427 — the two surfaces the original contract could not see.
  // ─────────────────────────────────────────────────────────────────────

  /**
   * The recovery copy is now reachable on the FAILURE path (before 2.427 its
   * only consumer was route-v2's pre-edit-lane intercept), which makes it the
   * copy a user reads at exactly the moment they are most likely to type the
   * advised sentence back.
   *
   * It is asserted DIFFERENTLY from the sources above, and the difference is
   * itself the finding: this copy advises with "in this form: …" and no
   * quotation marks, so `extractAdvisedExemplars` — whose grammar is
   * "say '…'" / 'for example "…"' — sees NOTHING in it. Routing it through the
   * quote-extraction path would have produced a source whose positive control
   * fires on emptiness, i.e. a test that proves nothing. So the claim is made
   * against the producer instead, which is a stronger claim anyway: the
   * sentence in the copy IS `buildConfigureOptionAdvisedFormat`'s output, and
   * that output routes.
   */
  it('2.427 recovery copy advises the shipped format, and that format routes', () => {
    const optionLabel = 'Cloud-Native CRM';
    const factorLabel = 'Adoption Complexity';
    const copy = composeConfigureOptionClarifyResponse({
      optionLabel,
      factorLabels: [factorLabel, 'Feature Richness'],
      stage: 'analyse',
      // The composer derives termination from the message; this suite is about
      // the FIRST-ASK copy, so the message must not read as an answer.
      message: `Configure ${optionLabel}`,
    }).assistant_text;

    // Derived from the builder AND from the shipped example value, never
    // transcribed: a change to the advised phrasing or to the example number
    // moves both halves of this assertion together.
    //
    // ⚠ THE VALUE WAS `'<0-1>'` UNTIL 2026-08-16 AND THAT PLACEHOLDER REACHED
    // REAL USER COPY (NEW-5). The value slot now carries a concrete number, so
    // the advised sentence is directly copyable rather than a template the user
    // must expand by hand. Deriving it from the exported constant is what stops
    // this contract from re-pinning a literal that has moved.
    const advised = buildConfigureOptionAdvisedFormat(
      optionLabel,
      factorLabel,
      CONFIGURE_OPTION_EXAMPLE_VALUE,
    );
    expect(copy).toContain(advised);
    // The example is a real number, not a placeholder — pinned against the
    // CLASS so any future `<...>` slot REDs here too.
    expect(CONFIGURE_OPTION_EXAMPLE_VALUE).not.toMatch(/[<>]/);

    // And the thing it advises is a thing the product accepts.
    expect(detectConfigureOptionIntent(advised, []).matched).toBe(true);
    expect(
      detectConfigureOptionIntent(
        buildConfigureOptionAdvisedFormat(optionLabel, factorLabel, '0.7'),
        [],
      ).matched,
    ).toBe(true);
  });

  /**
   * THE SURFACE THIS CONTRACT WAS BLIND TO. On the no-op branch the edit LLM's
   * own `coaching.summary` reaches `assistant_text` verbatim
   * (`edit-graph.ts`, the R10 preservation path). That prose is not in the
   * repo, so no amount of deriving from shipped copy can cover it — the check
   * has to run at RUNTIME, and `findNonRoutableConfigureAdvice` is it.
   *
   * Pinned here rather than only in `configure-option-advice.test.ts` because
   * THIS is the file a future copy change is read against, and the property is
   * the same one: nothing the product advises may fail to route.
   */
  it('2.427 LLM-authored advice: option-referring advice that would not route is caught', () => {
    const optionLabels = ['Cloud-Native CRM'];

    // The exact phrasing PR #487's round-3 review caught shipping (see this
    // file's header). Precondition pinned so the case cannot decay into
    // agreeing with itself if the detector later widens.
    const broken = 'the acquisition option sets Setup Cost to £2m';
    expect(
      detectConfigureOptionIntent(broken, optionLabels).matched,
      'precondition broken: this exemplar now routes and can no longer prove the loop',
    ).toBe(false);
    expect(
      findNonRoutableConfigureAdvice(`Nothing changed. Say '${broken}' to proceed.`, optionLabels),
    ).toBe(broken);

    // The real captured advice sentence (deployed `98f2476`, `P2_2_confirm`)
    // must survive untouched — the guard exists to catch a broken loop, not to
    // discard working clarifying questions.
    expect(
      findNonRoutableConfigureAdvice(
        "If you want to set them now, say 'configure the Cloud-Native CRM option'.",
        optionLabels,
      ),
    ).toBeNull();
  });

  it('the shared configure chips route deterministically via the chip prefix', () => {
    // Both chip surfaces (options_not_configured composer, GM applied
    // receipt) build from these two constructors — deriving here covers
    // every consumer by construction.
    const labelled = buildConfigureOptionChip('Acquire Small German Competitor');
    expect(detectConfigureOptionIntent(labelled.message, [])).toEqual({
      matched: true,
      trigger: 'chip_prefix',
    });
    expect(detectConfigureOptionIntent(CONFIGURE_OPTION_GENERIC_CHIP.message, [])).toEqual({
      matched: true,
      trigger: 'chip_prefix',
    });
  });
});
