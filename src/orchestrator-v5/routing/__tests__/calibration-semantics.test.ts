/**
 * `calibration-semantics` — the ONE deterministic probability layer.
 *
 * TWO KINDS OF GUARD, SHIPPED TOGETHER (CLAUDE.md trap 12d):
 *
 *  A. DERIVED — every routing phrase resolves to the identical number the
 *     canonical `CERTAINTY_TERMS` map holds, and the threshold-marker list
 *     is a proven SUPERSET of CQE's two comparator alternations. These
 *     catch DRIFT between copies. They are structurally blind to a term
 *     that is missing from BOTH sides.
 *
 *  B. A HAND-WRITTEN CORPUS — real sentences, including the ones CQE
 *     measurably cannot see. This is the only guard that can notice a list
 *     is SHORT. Deleting either kind leaves a defect class unobserved.
 */
import { describe, it, expect } from 'vitest';

import {
  CALIBRATION_PHRASES,
  THRESHOLD_MARKER_SOURCE_FOR_TESTS,
  classifyCalibrationMessage,
  detectProbabilityPhrase,
  detectThreshold,
  formatProbabilityPercent,
  buildCalibrationPreviewText,
  buildCalibrationConfirmMessage,
  resolveFactorLabelForConsentPreview,
} from '../calibration-semantics.js';
import { CERTAINTY_TERMS } from '../../../cee/belief-elicitation/index.js';
import {
  COMPARATOR_ATLEAST_SOURCE,
  COMPARATOR_ATMOST_SOURCE,
} from '../../context/cqe/rules.js';
import { extractQuantities } from '../../context/cqe/extract-quantities.js';

const CAPTURED_A =
  'I think monthly churn staying below 3% in December is pretty likely. Please set that estimate and show me the number you will use before applying it.';

// ---------------------------------------------------------------------------
// A. DERIVED GUARDS
// ---------------------------------------------------------------------------
describe('DERIVED: the routing phrase table cannot drift from the canonical map', () => {
  it('every routing phrase resolves to the SAME number CERTAINTY_TERMS holds', () => {
    expect(CALIBRATION_PHRASES.size).toBeGreaterThan(0);
    for (const [phrase, value] of CALIBRATION_PHRASES) {
      // Iterating the routing map and reading the canonical one is the whole
      // point: a value edited in belief-elicitation propagates, and a value
      // that ever diverges REDs here.
      expect(CERTAINTY_TERMS[phrase]).toBe(value);
    }
  });

  it('the routing table is a strict SUBSET of the canonical map (nothing invented locally)', () => {
    const canonical = new Set(Object.keys(CERTAINTY_TERMS));
    for (const phrase of CALIBRATION_PHRASES.keys()) {
      expect(canonical.has(phrase)).toBe(true);
    }
  });

  it('"pretty likely" is 0.70 on BOTH paths — the number the witnessed defect never reached', () => {
    expect(CERTAINTY_TERMS['pretty likely']).toBe(0.7);
    expect(CALIBRATION_PHRASES.get('pretty likely')).toBe(0.7);
  });
});

describe('DERIVED: the threshold-marker list is a SUPERSET of CQE comparator grammar', () => {
  const cqeAlternatives = [
    ...COMPARATOR_ATMOST_SOURCE.split('|'),
    ...COMPARATOR_ATLEAST_SOURCE.split('|'),
  ];

  it('CQE has alternatives to check (positive control for the assertion below)', () => {
    expect(cqeAlternatives.length).toBeGreaterThan(8);
  });

  it.each(cqeAlternatives)(
    'routing carries CQE alternative %s',
    (alternative) => {
      // Union assertion, importable and therefore derivable. If CQE ever
      // grows a comparator word routing does not carry, this REDs — which is
      // exactly the direction the 5 Aug defect ran in reverse.
      expect(THRESHOLD_MARKER_SOURCE_FOR_TESTS).toContain(alternative);
    },
  );
});

// ---------------------------------------------------------------------------
// B. THE HAND-WRITTEN CORPUS — what derivation cannot see
// ---------------------------------------------------------------------------
describe('CORPUS: threshold markers CQE measurably cannot see', () => {
  it('MEASURES the gap rather than asserting it: CQE sets a comparator for "under" and NOT for "below"', () => {
    // This is the root cause of the witnessed defect, pinned as a fact
    // rather than as prose. If CQE's lexicon is fixed later this test REDs
    // and the note above it must be rewritten — which is the correct
    // outcome, not a nuisance.
    const withUnder = extractQuantities('monthly churn staying under 3%');
    const withBelow = extractQuantities('monthly churn staying below 3%');
    expect(withUnder[0]?.comparator).toBe('at_most');
    expect(withBelow[0]?.comparator).toBeNull();
    // ...and BOTH carry the same number, which is why the sentence with
    // "below" looked to routing exactly like an explicit value.
    expect(withUnder[0]?.value).toBe(0.03);
    expect(withBelow[0]?.value).toBe(0.03);
  });

  const THRESHOLD_CASES: ReadonlyArray<readonly [string, number, 'at_least' | 'at_most']> = [
    ['churn staying below 3%', 0.03, 'at_most'],
    ['churn staying above 3%', 0.03, 'at_least'],
    ['margin under 12%', 0.12, 'at_most'],
    ['margin over 12%', 0.12, 'at_least'],
    ['costs at most 20%', 0.2, 'at_most'],
    ['costs at least 20%', 0.2, 'at_least'],
    ['uptime no lower than 99%', 0.99, 'at_least'],
    ['error rate no higher than 2%', 0.02, 'at_most'],
    ['spend beneath 40', 40, 'at_most'],
    ['spend beyond 40', 40, 'at_least'],
  ];

  it.each(THRESHOLD_CASES)('reads %s as a threshold', (message, value, comparator) => {
    const t = detectThreshold(message);
    expect(t).not.toBeNull();
    expect(t!.value).toBeCloseTo(value, 10);
    expect(t!.comparator).toBe(comparator);
  });

  it('a plain value is NOT a threshold — the ordinary numeric path must keep owning it', () => {
    expect(detectThreshold('Set Monthly Churn Rate to 3%.')).toBeNull();
    expect(detectThreshold('Raise the budget to £50,000.')).toBeNull();
  });
});

describe('CORPUS: probability phrases', () => {
  it('recognises the witnessed phrase', () => {
    expect(detectProbabilityPhrase(CAPTURED_A)).toEqual({
      phrase: 'pretty likely',
      value: 0.7,
    });
  });

  it('LONGEST match wins — a compound phrase is never truncated to its head', () => {
    // "very likely" (0.85) contains "likely" (0.70). Reading the shorter one
    // would silently offer the wrong number with full confidence.
    expect(detectProbabilityPhrase('that outcome is very likely')?.value).toBe(0.85);
    expect(detectProbabilityPhrase('that outcome is highly unlikely')?.value).toBe(0.1);
  });

  const NON_CALIBRATION: readonly string[] = [
    'Is that possible?',
    'Maybe later.',
    'I never ran the analysis.',
    'Which option is probably best?',
    'Set Monthly Churn Rate to 3%.',
    'What is driving the result?',
  ];

  it.each(NON_CALIBRATION)(
    'does NOT hijack an ordinary turn: %s',
    (message) => {
      expect(classifyCalibrationMessage(message).kind).toBe('none');
    },
  );
});

// ---------------------------------------------------------------------------
// THE CLASSIFICATION THE WHOLE DEFECT TURNS ON
// ---------------------------------------------------------------------------
describe('EVENT PROBABILITY vs THRESHOLD', () => {
  it('the captured prompt is a probability ABOUT a threshold — 0.70 is the estimate, 0.03 is the bound', () => {
    const c = classifyCalibrationMessage(CAPTURED_A);
    expect(c.kind).toBe('probability_of_threshold');
    if (c.kind !== 'probability_of_threshold') throw new Error('unreachable');
    expect(c.probability.value).toBe(0.7);
    expect(c.threshold.value).toBe(0.03);
    expect(c.threshold.comparator).toBe('at_most');
  });

  it('a bare qualitative set carries no threshold', () => {
    const c = classifyCalibrationMessage('Set AI Chatbot Deployment to pretty likely.');
    expect(c.kind).toBe('probability_only');
  });
});

describe('the preview copy', () => {
  it('says explicitly that the threshold is NOT the value — the sentence the witnessed build never produced', () => {
    const c = classifyCalibrationMessage(CAPTURED_A);
    const text = buildCalibrationPreviewText(c, 'Monthly Churn Rate');
    expect(text).toContain('70%');
    expect(text).toContain('3%');
    expect(text).toContain('not that Monthly Churn Rate equals 3%');
    expect(text).toContain('Nothing has been changed');
  });

  it('never invents a factor name it could not resolve', () => {
    const c = classifyCalibrationMessage(CAPTURED_A);
    expect(buildCalibrationPreviewText(c, null)).toContain('that factor');
  });

  it("the confirm chip's replay message carries an EXPLICIT number, so confirming travels the ordinary numeric path", () => {
    const c = classifyCalibrationMessage('Set AI Chatbot Deployment to pretty likely.');
    expect(buildCalibrationConfirmMessage(c, 'AI Chatbot Deployment')).toBe(
      'Set AI Chatbot Deployment to 70%.',
    );
  });
});

describe('formatProbabilityPercent', () => {
  it.each([
    [0.7, '70%'],
    [0.85, '85%'],
    [0.05, '5%'],
    [0.75, '75%'],
    [0.155, '15.5%'],
  ])('%s -> %s', (value, expected) => {
    expect(formatProbabilityPercent(value)).toBe(expected);
  });
});

describe('resolveFactorLabelForConsentPreview', () => {
  const graph = {
    nodes: [
      { id: 'g', kind: 'goal', label: 'Revenue' },
      { id: 'f1', kind: 'factor', label: 'AI Chatbot Deployment' },
      { id: 'f2', kind: 'factor', label: 'Monthly Churn Rate' },
      { id: 'o', kind: 'option', label: 'Ship it' },
    ],
  };

  it('resolves a single named factor', () => {
    expect(
      resolveFactorLabelForConsentPreview('Set AI Chatbot Deployment to pretty likely.', graph),
    ).toBe('AI Chatbot Deployment');
  });

  it('returns null when TWO factors are named — never guesses which one', () => {
    expect(
      resolveFactorLabelForConsentPreview(
        'Set AI Chatbot Deployment and Monthly Churn Rate to pretty likely.',
        graph,
      ),
    ).toBeNull();
  });

  it('returns null when the named node is not a factor', () => {
    expect(resolveFactorLabelForConsentPreview('Set Revenue to pretty likely.', graph)).toBeNull();
  });

  it('returns null on no graph', () => {
    expect(resolveFactorLabelForConsentPreview('Set X to pretty likely.', null)).toBeNull();
  });
});
