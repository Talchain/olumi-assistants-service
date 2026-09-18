/**
 * THE BUILDER + PLUMBING PINS for the run-level participation disclosure.
 *
 * Three jobs, and they are not interchangeable:
 *   1. the COPY a user reads, pinned by hand — a derived guard proves agreement,
 *      never correctness (trap 12d);
 *   2. the ZERO RULE — an absent disclosure and a disclosure of absence are
 *      different claims, and only the first is honest on an ordinary run;
 *   3. the PLUMBING — grammar, budget, registration and salvage. A disclosure
 *      missing any one of these composes correctly and is INERT in production:
 *      the egress rejects it and the user silently receives the locked template.
 */
import { describe, it, expect } from 'vitest';

import {
  buildAnalysisParticipationDisclosure,
  ANALYSIS_PARTICIPATION_DISCLOSURE_RE_SRC,
  ANALYSIS_PARTICIPATION_DISCLOSURE_MAX_CHARS,
  PARTICIPATION_DISCLOSURE_SURVIVES_EGRESS,
} from '../analysis-participation-disclosure.js';
import {
  isAllowedRunAnalysisAssistantText,
  TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS,
  TEMPLATE_SUFFIX_DISCLOSURE_EXCLUSIONS,
} from '../analysis-result-headline.js';
import { passesAssistantTextContentDefences } from '../assistant-text-defences.js';
import { textAssertsLeadingOption } from '../../compose/leading-option-egress-guard.js';
import { findStabilityAssertion } from '../../compose/defaulted-value-egress.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';

const REGISTERED_NAME = 'ANALYSIS_PARTICIPATION_DISCLOSURE_RE_SRC';
const FALLBACK = 'Ran analysis on your current scenario.';

/** Shorthand: the guard's shape, with `n` ids and `m` pruned edges. */
const counts = (n: number, m: number) => ({
  excludedNodeIds: Array.from({ length: n }, (_, i) => `fac_${i}`),
  prunedEdgeCount: m,
});

const EXACT = new RegExp(`^(?:${ANALYSIS_PARTICIPATION_DISCLOSURE_RE_SRC})$`);

describe('the copy a user reads — pinned by hand, not derived', () => {
  it('1 node, 1 edge', () => {
    expect(buildAnalysisParticipationDisclosure(counts(1, 1))).toBe(
      ' This analysis ran on a reduced model: 1 part of your model is kept out of the' +
        ' calculation, which also leaves out 1 connection to it.',
    );
  });

  it('1 node, several edges', () => {
    expect(buildAnalysisParticipationDisclosure(counts(1, 4))).toBe(
      ' This analysis ran on a reduced model: 1 part of your model is kept out of the' +
        ' calculation, which also leaves out 4 connections to it.',
    );
  });

  it('several nodes, several edges', () => {
    expect(buildAnalysisParticipationDisclosure(counts(2, 3))).toBe(
      ' This analysis ran on a reduced model: 2 parts of your model are kept out of the' +
        ' calculation, which also leaves out 3 connections to them.',
    );
  });

  it('several nodes, ONE edge — the pronoun follows the NODES, not the edges', () => {
    expect(buildAnalysisParticipationDisclosure(counts(3, 1))).toBe(
      ' This analysis ran on a reduced model: 3 parts of your model are kept out of the' +
        ' calculation, which also leaves out 1 connection to them.',
    );
  });

  it('⭐ no incident edge ⇒ the edge clause is ABSENT, not "0 connections"', () => {
    expect(buildAnalysisParticipationDisclosure(counts(1, 0))).toBe(
      ' This analysis ran on a reduced model: 1 part of your model is kept out of the' +
        ' calculation.',
    );
    expect(buildAnalysisParticipationDisclosure(counts(2, 0))).not.toContain('connection');
  });

  it('⭐ it does not say the USER removed the connections — they marked a node', () => {
    // The distinction this whole module exists to make. "which also leaves out"
    // attributes the edges to the EXCLUSION; anything in the second person would
    // send the user looking for an act they never performed.
    const text = buildAnalysisParticipationDisclosure(counts(1, 2));
    expect(text).toContain('which also leaves out');
    expect(text).not.toMatch(/\byou\b/i);
    expect(text).not.toMatch(/\bremoved\b/i);
    expect(text).not.toMatch(/\bdeleted\b/i);
  });

  it('⭐ it states what happened, never what to conclude', () => {
    const text = buildAnalysisParticipationDisclosure(counts(2, 3));
    expect(text).not.toMatch(/\bshould\b/i);
    expect(text).not.toMatch(/\bmay be (?:wrong|unreliable)\b/i);
    expect(text).not.toMatch(/\btherefore\b/i);
  });
});

describe('⛔ THE ZERO RULE — nothing withheld ⇒ not one byte', () => {
  it('no excluded node ⇒ empty string', () => {
    expect(buildAnalysisParticipationDisclosure(counts(0, 0))).toBe('');
  });

  it('⭐ no excluded node but a non-zero edge count ⇒ STILL empty', () => {
    // Not a state the guard can produce (edges are pruned only BY a dropped
    // node). Gating on the NODES is the direction that fails silent rather than
    // announcing a consequence with no cause.
    expect(buildAnalysisParticipationDisclosure(counts(0, 5))).toBe('');
  });

  it('a negative or non-finite edge count degrades to the node-only sentence', () => {
    expect(buildAnalysisParticipationDisclosure({ excludedNodeIds: ['a'], prunedEdgeCount: -3 }))
      .toBe(
        ' This analysis ran on a reduced model: 1 part of your model is kept out of the' +
          ' calculation.',
      );
    expect(
      buildAnalysisParticipationDisclosure({ excludedNodeIds: ['a'], prunedEdgeCount: Number.NaN }),
    ).toContain('1 part of your model');
  });
});

describe('the grammar the egress compiles', () => {
  it('the build-time probe ran (a module whose probe was deleted would not export this)', () => {
    expect(PARTICIPATION_DISCLOSURE_SURVIVES_EGRESS).toBe(true);
  });

  it('every shape the builder can emit matches its own published grammar EXACTLY', () => {
    for (const [n, m] of [
      [1, 0],
      [1, 1],
      [1, 9],
      [2, 0],
      [2, 1],
      [2, 3],
      [999999, 999999],
    ] as ReadonlyArray<readonly [number, number]>) {
      const text = buildAnalysisParticipationDisclosure(counts(Math.min(n, 3), m));
      expect(text, `n=${n} m=${m}`).not.toBe('');
      expect(EXACT.test(text), `n=${n} m=${m}: ${text}`).toBe(true);
    }
  });

  it('⭐ the grammar CANNOT match the empty string (the template branch depends on it)', () => {
    expect(EXACT.test('')).toBe(false);
  });

  it('it does not admit a sentence from a neighbouring family (contrast control)', () => {
    expect(
      EXACT.test(
        ' This analysis ran without a value for one option effect, so that option was' +
          ' analysed as leaving that factor unchanged. Set that value and run the analysis' +
          ' again to see whether the comparison changes.',
      ),
    ).toBe(false);
  });

  it('the length budget is derived from the worst case and is not trivially small', () => {
    const worst = buildAnalysisParticipationDisclosure({
      excludedNodeIds: Array.from({ length: 3 }, (_, i) => `n${i}`),
      prunedEdgeCount: 999999,
    });
    expect(worst.length).toBeLessThanOrEqual(ANALYSIS_PARTICIPATION_DISCLOSURE_MAX_CHARS);
    expect(ANALYSIS_PARTICIPATION_DISCLOSURE_MAX_CHARS).toBeGreaterThan(100);
  });
});

describe('⚠ it may not trip the vocabularies that would delete or suppress it', () => {
  const SHAPES = [counts(1, 0), counts(1, 2), counts(2, 0), counts(4, 7)].map((c) =>
    buildAnalysisParticipationDisclosure(c),
  );

  it('asserts no leading option (else `leading-option-egress-guard` replaces the summary)', () => {
    for (const text of SHAPES) expect(textAssertsLeadingOption(text), text).toBe(false);
  });

  it('asserts no stability (else `defaulted-value-egress` suppresses it)', () => {
    for (const text of SHAPES) expect(findStabilityAssertion(text), text).toBeNull();
  });

  it('passes the shared content defences (no forbidden vocab, no ids, no raw decimals)', () => {
    for (const text of SHAPES) expect(passesAssistantTextContentDefences(text), text).toBe(true);
  });
});

describe('⭐ REGISTRATION — the half a green completeness guard cannot see', () => {
  /**
   * The completeness guard's union assertion is BOOKKEEPING: moving this family
   * onto the reasoned-exclusion list keeps it green while the withheld branch
   * stops admitting the sentence and the confirmation salvage stops rescuing
   * it. Green, and wrong. These arms pin the BEHAVIOUR per-family.
   */
  it('is REGISTERED (not excluded), bound to the real export by identity', () => {
    const entry = TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS.find((g) => g.name === REGISTERED_NAME);
    expect(entry, `${REGISTERED_NAME} is not registered`).toBeDefined();
    expect((entry as { source: string }).source).toBe(ANALYSIS_PARTICIPATION_DISCLOSURE_RE_SRC);
    expect(TEMPLATE_SUFFIX_DISCLOSURE_EXCLUSIONS.map((e) => e.name)).not.toContain(REGISTERED_NAME);
  });

  it('it rides LAST, matching the handler’s append order', () => {
    const names = TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS.map((g) => g.name);
    expect(names[names.length - 1]).toBe(REGISTERED_NAME);
  });

  it('⭐ the WITHHELD (locked-template) branch admits `template + disclosure`', () => {
    const disclosure = buildAnalysisParticipationDisclosure(counts(2, 3));
    expect(disclosure).not.toBe('');
    expect(isAllowedRunAnalysisAssistantText(FALLBACK + disclosure)).toBe(true);
  });

  it('⭐ the confirmation SALVAGE rescues it off a rejected summary', () => {
    const template = HANDLER_VALIDATION_REGISTRY.run_analysis.confirmation_template;
    if (typeof template !== 'function') throw new Error('expected function-form template');
    const disclosure = buildAnalysisParticipationDisclosure(counts(2, 3));
    // A summary the allowlist rejects: improvised free text with a raw decimal.
    const rejected = 'Leading option sits at 0.6234 exactly.' + disclosure;
    expect(isAllowedRunAnalysisAssistantText(rejected)).toBe(false);

    const salvaged = template({ assistant_text: rejected });
    expect(salvaged).toContain(disclosure);
    expect(salvaged).not.toContain('0.6234');
  });
});
