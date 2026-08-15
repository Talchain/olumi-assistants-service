/**
 * Unit tests for the shared "what to validate" beat
 * (V5-LANE-B-STRUCTURAL-01).
 *
 * Pins both variants:
 *  - the in-flow gate variant (`describeValidationPriority`) — exact strings
 *    so the #256 advice-gate output is provably byte-stable after the
 *    extraction;
 *  - the standalone append-after-LLM variant
 *    (`composeStandaloneValidationPriority`) — names both link endpoints, no
 *    "that link" dangling reference;
 * plus the decision ladder with the coarse dedup heuristic
 * (`decideValidationBeat`) and the display-safety guards.
 */

import { describe, it, expect } from 'vitest';

import {
  composeStandaloneValidationPriority,
  decideValidationBeat,
  describeValidationPriority,
  isCleanDisplayLabel,
  isRenderableValidationEdge,
  VALIDATE_LINK_EVIDENCE,
} from '../validation-priority.js';

const EDGE = {
  from_label: 'Local Senior Hire Programme',
  to_label: 'Q3 Roadmap Delivery Capacity',
} as const;

describe('describeValidationPriority (in-flow gate variant — #256 byte-stability)', () => {
  it('link rung: returns the exact #256 constant referencing "that link"', () => {
    expect(describeValidationPriority(true, 'Engineering Capacity')).toBe(
      VALIDATE_LINK_EVIDENCE,
    );
    expect(VALIDATE_LINK_EVIDENCE).toBe(
      'One useful confidence check is real-world support for that link rather than the current model estimate, since the robustness check flagged it as sensitive.',
    );
  });

  it('driver rung: quotes the label in the exact #256 sentence', () => {
    expect(describeValidationPriority(false, 'Engineering Capacity')).toBe(
      "The evidence that would most improve confidence is firmer support for 'Engineering Capacity', since it carries the most weight in this result.",
    );
  });

  it('no signal: returns null (omit, never filler)', () => {
    expect(describeValidationPriority(false, null)).toBeNull();
  });
});

describe('composeStandaloneValidationPriority (append-after-LLM variant)', () => {
  it('link rung names BOTH endpoints — no "that link" dangling reference', () => {
    const beat = composeStandaloneValidationPriority(EDGE, 'Engineering Capacity');
    expect(beat).toEqual({
      variant: 'link',
      from_label: 'Local Senior Hire Programme',
      to_label: 'Q3 Roadmap Delivery Capacity',
      text: "One useful confidence check is real-world support for the link from 'Local Senior Hire Programme' to 'Q3 Roadmap Delivery Capacity' rather than the current model estimate, since the robustness check flagged it as sensitive.",
    });
    expect(beat!.text).not.toMatch(/\bthat link\b/);
  });

  it('driver fallback matches the in-flow driver sentence exactly', () => {
    const beat = composeStandaloneValidationPriority(null, 'Engineering Capacity');
    expect(beat).toEqual({
      variant: 'driver',
      driver_label: 'Engineering Capacity',
      text: describeValidationPriority(false, 'Engineering Capacity'),
    });
  });

  it('omits on no signal', () => {
    expect(composeStandaloneValidationPriority(null, null)).toBeNull();
  });

  it('ID guard: slug-shaped endpoint label downgrades to the driver rung', () => {
    const beat = composeStandaloneValidationPriority(
      { from_label: 'fac_local_hire_1', to_label: 'Q3 Roadmap Delivery Capacity' },
      'Engineering Capacity',
    );
    expect(beat?.variant).toBe('driver');
  });

  it('ID guard: slug-shaped driver label → null', () => {
    expect(
      composeStandaloneValidationPriority(null, 'fac_engineering_capacity_1'),
    ).toBeNull();
  });

  it('blank labels are never rendered', () => {
    expect(
      composeStandaloneValidationPriority({ from_label: '  ', to_label: 'B' }, '   '),
    ).toBeNull();
  });
});

describe('isRenderableValidationEdge / isCleanDisplayLabel', () => {
  it('requires both endpoint labels non-empty', () => {
    expect(isRenderableValidationEdge(EDGE)).toBe(true);
    expect(isRenderableValidationEdge({ from_label: '', to_label: 'B' })).toBe(false);
    expect(isRenderableValidationEdge({ from_label: 'A', to_label: ' ' })).toBe(false);
  });

  it('isCleanDisplayLabel rejects empties and ID-shaped tokens', () => {
    expect(isCleanDisplayLabel('Engineering Capacity')).toBe(true);
    expect(isCleanDisplayLabel('')).toBe(false);
    expect(isCleanDisplayLabel(null)).toBe(false);
    expect(isCleanDisplayLabel(undefined)).toBe(false);
    expect(isCleanDisplayLabel('fac_engineering_capacity_1')).toBe(false);
  });
});

describe('decideValidationBeat — dedup ladder (coarse heuristic, biased to under-suppression)', () => {
  const NEUTRAL_ANSWER =
    'The leading option stays ahead because the model weighs delivery speed heavily.';

  it('appends the link beat when the answer covers neither labels nor vocabulary', () => {
    const d = decideValidationBeat({
      answerText: NEUTRAL_ANSWER,
      fragileEdge: EDGE,
      topDriverLabel: 'Engineering Capacity',
    });
    expect(d.mechanism).toBe('appended');
    if (d.mechanism === 'appended') expect(d.beat.variant).toBe('link');
  });

  it('both labels WITHOUT vocabulary → still appends (labels alone are not a validation priority)', () => {
    const d = decideValidationBeat({
      answerText:
        'Local Senior Hire Programme strengthens Q3 Roadmap Delivery Capacity in this model.',
      fragileEdge: EDGE,
      topDriverLabel: null,
    });
    expect(d.mechanism).toBe('appended');
  });

  it('vocabulary WITHOUT both labels → still appends', () => {
    const d = decideValidationBeat({
      answerText:
        'It is worth validating the hiring assumptions behind Local Senior Hire Programme.',
      fragileEdge: EDGE,
      topDriverLabel: null,
    });
    expect(d.mechanism).toBe('appended');
  });

  it('both labels AND vocabulary, distinct driver available → driver beat appended', () => {
    const d = decideValidationBeat({
      answerText:
        'Check whether Local Senior Hire Programme really lifts Q3 Roadmap Delivery Capacity before deciding.',
      fragileEdge: EDGE,
      topDriverLabel: 'Engineering Capacity',
    });
    expect(d.mechanism).toBe('appended');
    if (d.mechanism === 'appended') expect(d.beat.variant).toBe('driver');
  });

  it('both labels AND vocabulary, driver also present in the answer → dedup_skipped with link evidence', () => {
    const d = decideValidationBeat({
      answerText:
        'Engineering Capacity dominates; verify that Local Senior Hire Programme lifts Q3 Roadmap Delivery Capacity.',
      fragileEdge: EDGE,
      topDriverLabel: 'Engineering Capacity',
    });
    expect(d).toEqual({
      mechanism: 'dedup_skipped',
      variant: 'link',
      from_label: 'Local Senior Hire Programme',
      to_label: 'Q3 Roadmap Delivery Capacity',
    });
  });

  it('link skipped, driver equals an endpoint label → no distinct priority, dedup_skipped', () => {
    const d = decideValidationBeat({
      answerText:
        'Verify that Local Senior Hire Programme lifts Q3 Roadmap Delivery Capacity.',
      fragileEdge: EDGE,
      topDriverLabel: 'Q3 Roadmap Delivery Capacity',
    });
    expect(d.mechanism).toBe('dedup_skipped');
  });

  it('no link; driver present AND vocabulary present → dedup_skipped with driver evidence', () => {
    const d = decideValidationBeat({
      answerText:
        'The result rests on Engineering Capacity, which is worth checking against real delivery data.',
      fragileEdge: null,
      topDriverLabel: 'Engineering Capacity',
    });
    expect(d).toEqual({
      mechanism: 'dedup_skipped',
      variant: 'driver',
      driver_label: 'Engineering Capacity',
    });
  });

  it('no link; driver present WITHOUT vocabulary → appends driver beat', () => {
    const d = decideValidationBeat({
      answerText: 'Engineering Capacity drives most of the gap between the options.',
      fragileEdge: null,
      topDriverLabel: 'Engineering Capacity',
    });
    expect(d.mechanism).toBe('appended');
    if (d.mechanism === 'appended') expect(d.beat.variant).toBe('driver');
  });

  it('label matching is case-insensitive', () => {
    const d = decideValidationBeat({
      answerText:
        'verify that LOCAL SENIOR HIRE PROGRAMME lifts q3 roadmap delivery capacity.',
      fragileEdge: EDGE,
      topDriverLabel: null,
    });
    expect(d.mechanism).toBe('dedup_skipped');
  });

  it('nothing renderable → omitted with reason', () => {
    const d = decideValidationBeat({
      answerText: NEUTRAL_ANSWER,
      fragileEdge: null,
      topDriverLabel: null,
    });
    expect(d).toEqual({ mechanism: 'omitted', reason: 'no_renderable_signal' });
  });
});
