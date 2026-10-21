/**
 * Unit tests for the shared "what to validate" beat
 * (V5-LANE-B-STRUCTURAL-01).
 *
 * Pins the standalone variant (`composeStandaloneValidationPriority`) — exact
 * strings, names both link endpoints (no "that link" dangling reference) — and
 * the display-safety guards.
 */

import { describe, it, expect } from 'vitest';

import {
  composeStandaloneValidationPriority,
  isCleanDisplayLabel,
  isRenderableValidationEdge,
} from '../validation-priority.js';

const EDGE = {
  from_label: 'Local Senior Hire Programme',
  to_label: 'Q3 Roadmap Delivery Capacity',
} as const;

describe('composeStandaloneValidationPriority (standalone variant)', () => {
  it('link rung names BOTH endpoints — no "that link" dangling reference', () => {
    const beat = composeStandaloneValidationPriority(EDGE, 'Engineering Capacity');
    expect(beat).toEqual({
      variant: 'link',
      from_label: 'Local Senior Hire Programme',
      to_label: 'Q3 Roadmap Delivery Capacity',
      text: "One useful confidence check is real-world support for the link from 'Local Senior Hire Programme' to 'Q3 Roadmap Delivery Capacity' rather than the current model estimate, since the robustness check flagged it as fragile.",
    });
    expect(beat!.text).not.toMatch(/\bthat link\b/);
  });

  it('driver rung: quotes the label in the exact sentence', () => {
    const beat = composeStandaloneValidationPriority(null, 'Engineering Capacity');
    expect(beat).toEqual({
      variant: 'driver',
      driver_label: 'Engineering Capacity',
      text: "The evidence that would most improve confidence is firmer support for 'Engineering Capacity', since it carries the most weight in this result.",
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
