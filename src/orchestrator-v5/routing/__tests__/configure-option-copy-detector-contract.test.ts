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
} from '../../configure-option-chip-text.js';
import { composeBody } from '../../compose/validation-failure-responses.js';
import type { ComposeContext } from '../../compose/types.js';
import type {
  HandlerValidationRegistry,
  ValidationError,
} from '../validator.js';
import { buildUnconfiguredOptionsNotice } from '../../handlers/gm-held-execute.js';

// ---------------------------------------------------------------------------
// Exemplar extraction — quoted phrases the copy tells the user to type.
// ---------------------------------------------------------------------------

/**
 * Extract every advised exemplar from a piece of assistant copy: a straight-
 * quoted ('…' or "…") phrase introduced by "say" or "for example". This is
 * the copy grammar both advised sites use; extraction from the LIVE copy is
 * what makes this a derived contract rather than a hand-maintained mirror.
 */
function extractAdvisedExemplars(copy: string): string[] {
  const out: string[] = [];
  const pattern = /(?:\bsay\b|\bfor example\b)[,:]?\s+(?:'([^']+)'|"([^"]+)")/gi;
  for (const m of copy.matchAll(pattern)) {
    const exemplar = m[1] ?? m[2];
    if (typeof exemplar === 'string' && exemplar.trim().length > 0) {
      out.push(exemplar.trim());
    }
  }
  return out;
}

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
