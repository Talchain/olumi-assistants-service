/**
 * F6 — the defaulted-value EGRESS INVARIANT.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CELL THIS EXISTS FOR
 *
 * `tryPostAnalysisAdviceGate` requires a leading option for most of its
 * classes. With `leading_option_id: null` it returns
 * `matched: false, reason: 'data_unavailable_for_class',
 * missing_inputs: ['leading_option']` and control falls through to the GENERIC
 * LLM ROUTER — where `composeRobustnessVerdict` never runs, so the stability
 * collapse and the disclosure that ride it never happen. Defaults present plus
 * no leading option is therefore the exact input cell where every
 * composer-level fix is structurally blind, and it is pinned by name below.
 *
 * ⭐ THE PRECONDITION IS PINNED IN-TEST (CLAUDE.md trap 13b). Each cell asserts
 * that the payload it is about to use REALLY carries defaulted assumptions at
 * the producer's nested path AND a null leading option — so a green result is
 * provably this code's doing, and cannot be a fixture that quietly stopped
 * reproducing the condition.
 *
 * ⚠ THE SIGNAL IS PRODUCER-GROUNDED. Every arm derives its
 * `DefaultedAssumptionsSignal` by running the real selector over a VERBATIM
 * captured enrichment envelope, never by hand-constructing the signal. A
 * hand-built signal would re-import the exact defect F6 fixes: a fixture that
 * encodes the author's model of the producer rather than the producer
 * (CLAUDE.md trap 16-inverse).
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  applyDefaultedValueEgress,
  enumerateSentences,
  findStabilityAssertion,
  isAnalysisBearing,
} from '../defaulted-value-egress.js';
import {
  buildDefaultedAssumptionsDisclosure,
  DEFAULTED_DISCLOSURE_TAIL,
  pickLatestDefaultedAssumptions,
  type DefaultedAssumptionsSignal,
} from '../../coaching/pick-defaulted-assumptions.js';
import {
  composeExplainResultsFallback,
  composeWhatWouldFlipFallback,
} from '../../tools/handlers/explanation-fallback.js';

// ── producer-grounded signal ────────────────────────────────────────────────

function loadCapture(name: 'session-a' | 'session-b2'): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      new URL(`./fixtures/dsk-walk/${name}.enrichment.json`, import.meta.url),
      'utf8',
    ),
  ) as Record<string, unknown>;
}

/**
 * The Codex cell: a `run_analysis` fact carrying the captured enrichment
 * VERBATIM and `leading_option_id: null` — the state that sends the turn down
 * the generic router.
 */
function codexCellFacts(enrichment: unknown): any {
  return [
    {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: 's1',
        leading_option_id: null,
        computed_at: '2026-08-13T19:30:00.000Z',
        enrichment,
      },
    },
  ];
}

const CAPTURE = loadCapture('session-a');
const SIGNAL = pickLatestDefaultedAssumptions(codexCellFacts(CAPTURE));
const DISCLOSURE = SIGNAL === null ? '' : buildDefaultedAssumptionsDisclosure(SIGNAL);

function occurrences(text: string, needle: string): number {
  if (needle.length === 0) return 0;
  let n = 0;
  let i = text.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = text.indexOf(needle, i + needle.length);
  }
  return n;
}

describe('F6 egress — the Codex cell (defaults present, no leading option)', () => {
  it('PRECONDITION — the payload really carries defaults nested AND a null leading option', () => {
    const brief = CAPTURE['decision_brief'] as Record<string, unknown>;
    expect(Array.isArray(brief['defaulted_assumptions'])).toBe(true);
    expect(Object.hasOwn(CAPTURE, 'defaulted_assumptions')).toBe(false);
    expect(codexCellFacts(CAPTURE)[0].result.leading_option_id).toBeNull();

    // And the selector really produces a signal from it — without this, every
    // assertion below would pass vacuously on a null signal.
    expect(SIGNAL).not.toBeNull();
    expect(SIGNAL!.count).toBe(1);
    expect(DISCLOSURE).toContain(DEFAULTED_DISCLOSURE_TAIL);
  });

  /**
   * THE DEPLOYED WITNESS, verbatim (13 Aug 2026, CEE `a3d74857`) — the sentence
   * the generic router can still produce because no composer gated it.
   */
  const DEPLOYED_WITNESS =
    "'replace our current CRM with HubSpot next quarter' currently leads, with a "
    + "probability of 96%. 'migrate to Salesforce instead' is the most likely "
    + 'contender to overtake it, with a probability of 2%. This result looks stable, '
    + 'so smaller changes are less likely to flip the outcome on their own.';

  it('discloses EXACTLY ONCE on the generic-router answer', () => {
    const out = applyDefaultedValueEgress(DEPLOYED_WITNESS, SIGNAL);

    expect(out.changed).toBe(true);
    expect(out.disclosureAdded).toBe(true);
    expect(occurrences(out.text, DEFAULTED_DISCLOSURE_TAIL)).toBe(1);
  });

  it('stands down the stability assertion over the defaulted inputs', () => {
    const out = applyDefaultedValueEgress(DEPLOYED_WITNESS, SIGNAL);

    expect(out.text).not.toContain('This result looks stable');
    expect(out.text).not.toContain('less likely to flip');
    expect(out.suppressed).toHaveLength(1);
  });

  it('keeps the recited probabilities — the caveat qualifies, it does not withhold', () => {
    const out = applyDefaultedValueEgress(DEPLOYED_WITNESS, SIGNAL);

    expect(out.text).toContain('probability of 96%');
    expect(out.text).toContain('probability of 2%');
  });
});

describe('F6 egress — direction twin: a run WITHOUT defaults gains nothing', () => {
  const NO_DEFAULTS = (() => {
    const capture = loadCapture('session-a');
    const brief = capture['decision_brief'] as Record<string, unknown>;
    delete brief['defaulted_assumptions'];
    return pickLatestDefaultedAssumptions(codexCellFacts(capture));
  })();

  it('PRECONDITION — the twin really has no signal', () => {
    expect(NO_DEFAULTS).toBeNull();
  });

  /**
   * BYTE-IDENTICAL BY REFERENCE. `toBe` rather than `toEqual` deliberately: it
   * proves no new string was built, so no future refactor can begin rewriting
   * text on runs that defaulted nothing and still pass this test.
   */
  it('returns the input text by REFERENCE, inventing no caveat', () => {
    const text =
      "'A' currently leads, with a probability of 96%. This result looks stable, so "
      + 'smaller changes are less likely to flip the outcome on their own.';
    const out = applyDefaultedValueEgress(text, NO_DEFAULTS);

    expect(out.text).toBe(text);
    expect(out.changed).toBe(false);
    expect(out.mode).toBe('no_defaults');
    expect(out.text).not.toContain(DEFAULTED_DISCLOSURE_TAIL);
  });

  it('does not suppress a stability assertion on an undefaulted run', () => {
    const text = 'This result looks stable, so this view should hold under reasonable variation.';

    expect(applyDefaultedValueEgress(text, NO_DEFAULTS).text).toBe(text);
  });
});

describe('F6 egress — no double emission with the deterministic composers', () => {
  const projection: any = {
    leading_option: { label: 'Adopt HubSpot', probability: 0.96 },
    runner_up: { label: 'Migrate to Salesforce', probability: 0.02 },
    margin_pp: 94,
    robustness_band: 'stable',
    top_drivers: [{ factor_label: 'Market Conditions' }],
  };

  /**
   * The deterministic composers already push the disclosure themselves. Running
   * the egress layer over their output is the double-emission risk this asserts
   * away — and it is the reason the layer is applied to EVERY path rather than
   * only to the generic route.
   */
  it.each([
    ['explain_results', () => composeExplainResultsFallback(projection, null, null, SIGNAL)],
    ['what_would_flip', () => composeWhatWouldFlipFallback(projection, null, null, SIGNAL)],
  ])('%s — composer discloses once, egress adds nothing', (_name, compose) => {
    const composed = compose();

    // PRECONDITION: the composer really did disclose. Without this the
    // "egress added nothing" assertion could pass because there was nothing
    // to disclose in the first place.
    expect(occurrences(composed, DEFAULTED_DISCLOSURE_TAIL)).toBe(1);

    const out = applyDefaultedValueEgress(composed, SIGNAL);

    expect(out.disclosureAdded).toBe(false);
    expect(occurrences(out.text, DEFAULTED_DISCLOSURE_TAIL)).toBe(1);
  });

  it('collapses a SECOND disclosure back to exactly one', () => {
    const doubled = `${DISCLOSURE} ${DISCLOSURE}`;
    // Precondition: the input really is doubled.
    expect(occurrences(doubled, DEFAULTED_DISCLOSURE_TAIL)).toBe(2);

    const out = applyDefaultedValueEgress(`A leads with a probability of 96%. ${doubled}`, SIGNAL);

    expect(occurrences(out.text, DEFAULTED_DISCLOSURE_TAIL)).toBe(1);
    expect(out.duplicatesRemoved).toBe(1);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PINNED CORPORA — an honest record of a BOUNDED matcher.
 *
 * CLAUDE.md trap 22f's ruling: where a natural-language predicate cannot be
 * settled, pin the known set explicitly with a test asserting EXACTLY that set,
 * so the suite stays green for the right reason and REDs if the set grows OR
 * shrinks. Both directions matter — a widened matcher that starts eating
 * legitimate sentences is as much a regression as a narrowed one that stops
 * catching the lie (trap 22b: one predicate, two opposite harms).
 */
describe('F6 egress — KNOWN-SUPPRESSED corpus (exact set)', () => {
  const SUPPRESSED = [
    'This result looks stable, so smaller changes are less likely to flip the outcome on their own.',
    'This result looks very stable, so this view should hold under reasonable variation.',
    'This result looks fairly stable, but it is worth checking the main assumptions before deciding.',
    'This result looks fragile, so even small adjustments could shift it.',
    'The picture appears fragile, so even small adjustments could shift it.',
    "Each option's own score is individually stable, so this is a genuine dead heat rather than noise in the estimates.",
    'The result is sensitive to small movements in the strongest drivers, so the leading option could change without much shifting.',
    'The results are robust to the assumptions we tested.',
    'These findings appear very stable.',
  ] as const;

  it.each(SUPPRESSED)('suppresses: %s', (sentence) => {
    expect(findStabilityAssertion(sentence)).not.toBeNull();
  });

  it('the set is EXACTLY this size — a change here is a deliberate act', () => {
    expect(SUPPRESSED).toHaveLength(9);
  });
});

describe('F6 egress — KNOWN-KEPT corpus (exact set): near misses that must survive', () => {
  /**
   * ⭐ THESE ARE THE OVER-SUPPRESSION TWINS. Each mentions stability or
   * robustness but makes NO claim about the run's result, so dropping it would
   * be the other half of trap 22b — a gap traded for a mangled answer. They are
   * the reason the patterns anchor their SUBJECT to the result family rather
   * than matching the bare word.
   */
  const KEPT = [
    'We could stabilise the wholesale flour price by signing a longer contract.',
    'Market Conditions has no value set, so it is the least stable input here.',
    'A more robust dataset would let us narrow these ranges.',
    'Would you like to test how stable this looks under a different assumption?',
    'The analysis used a default value for Market Conditions.',
    'Stability is one of the things this analysis reports.',
  ] as const;

  it.each(KEPT)('keeps: %s', (sentence) => {
    expect(findStabilityAssertion(sentence)).toBeNull();
  });

  it('the set is EXACTLY this size — a change here is a deliberate act', () => {
    expect(KEPT).toHaveLength(6);
  });
});

describe('F6 egress — the sentence splitter is decimal-safe', () => {
  /**
   * CLAUDE.md trap 22's sharpest instance: a guard "correct and pointed at the
   * wrong bytes" because the window was cut at the first `[.!?]`, which is also
   * the decimal point. A splitter that fails this would mangle every recited
   * probability this layer exists to police.
   */
  it('does not split inside a decimal or a currency amount', () => {
    expect(enumerateSentences('The budget is £1.5 million in year 2.')).toEqual([
      'The budget is £1.5 million in year 2.',
    ]);
  });

  it('splits on real sentence boundaries', () => {
    expect(enumerateSentences('A leads at 96%. B trails at 2%.')).toEqual([
      'A leads at 96%.',
      'B trails at 2%.',
    ]);
  });

  it('round-trips every sentence’s own bytes', () => {
    const text = 'A leads at 96%. This result looks stable, so smaller changes are less likely to flip the outcome on their own.';
    expect(enumerateSentences(text).join(' ')).toBe(text);
  });
});

describe('F6 egress — the analysis-bearing gate', () => {
  it('a non-analysis answer is left untouched, so the caveat never becomes boilerplate', () => {
    const receipt = "Let me know what you'd like me to do next, and I'll take it from there.";
    const out = applyDefaultedValueEgress(receipt, SIGNAL);

    expect(out.text).toBe(receipt);
    expect(out.mode).toBe('not_analysis_bearing');
  });

  it('a recited probability makes an answer analysis-bearing', () => {
    expect(isAnalysisBearing('A leads with a probability of 96%.')).toBe(true);
  });

  it('a stability assertion makes an answer analysis-bearing even with no figure', () => {
    expect(isAnalysisBearing('This result looks stable.')).toBe(true);
  });

  it('an edit receipt is not analysis-bearing', () => {
    expect(isAnalysisBearing("I've added 'Market Conditions' to the graph.")).toBe(false);
  });
});

describe('F6 egress — the builder and its invariant tail cannot drift apart', () => {
  /**
   * The egress layer recognises the canonical disclosure by
   * `DEFAULTED_DISCLOSURE_TAIL`. If the builder's words moved and the tail did
   * not, recognition would fail SILENTLY and in the worst direction: the layer
   * would stop seeing the composers' disclosure and append a second one.
   */
  it.each([1, 2, 4])('every %i-count permutation ends with the tail', (count) => {
    const signal: DefaultedAssumptionsSignal = {
      count,
      named: ['Market Conditions', 'Wholesale Flour Price', 'Demand'].slice(0, Math.min(count, 3)),
    };

    expect(buildDefaultedAssumptionsDisclosure(signal).endsWith(DEFAULTED_DISCLOSURE_TAIL)).toBe(
      true,
    );
  });
});
