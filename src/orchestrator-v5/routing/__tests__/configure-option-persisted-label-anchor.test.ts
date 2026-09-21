/**
 * ROADMAP 2.308 / S1 — the configure-option gate's LABEL ANCHOR must be
 * reachable on the live wire.
 *
 * Diagnosis `PHASE0-EVIDENCE-2026-07-28/diagnosis-2308-addoption-deadend.md`
 * §2b/§2c, at deployed CEE `a5a3e22`: `detectConfigureOptionIntent` accepts
 * either the literal word "option(s)" or a known option LABEL as its anchor,
 * and triggers 4 (`effect_vocab`) and 5 (`option_value_set`) sit BELOW the
 * mandatory `if (!anchored) return NO_MATCH`. The labels were projected from
 * `extensions.graphState`, which the UI NEVER sends (platform invariant: the
 * UI sends a turn, never a graph), while the persisted graph that would supply
 * them was loaded 340 lines later INSIDE `if (editIntentDetected)` — a block
 * whose condition is computed FROM this detection. Circular by construction:
 * by the time CEE had the labels, the decision that needed them was made.
 *
 * The fixtures below are the diagnosis's own remedy messages, verbatim. Their
 * pristine verdicts were measured against the REAL module at the deployed SHA
 * (§2c) and re-measured in this lane before the fix:
 *
 *   #5 `effect_vocab`      — labels flip NO_MATCH → match
 *   #6 `option_value_set`  — labels flip NO_MATCH → match
 *   #7 `option_value_set`  — labels flip NO_MATCH → match
 *
 * NEGATIVE ARM (load-bearing — this is what keeps the blast radius small):
 * remedy #2 `Set Customer Retention Investment to £40,000` is a plain FACTOR
 * value edit. It carries a VALUE_SET_PAYLOAD and no option word, so it is
 * label-decidable in principle — but the labels are OPTION labels and the
 * message names a FACTOR, so the verdict must stay NO_MATCH with the real
 * labels present. If that ever flips, every "set X to N" reroutes off
 * `set_factor_value` into the edit LLM (the blast radius the diagnosis
 * explicitly refused: "Do NOT instead delete the `if (!anchored) return
 * NO_MATCH` line").
 */

import { describe, it, expect, vi } from 'vitest';

import {
  detectConfigureOptionIntent,
  resolveConfigureOptionIntent,
  projectOptionLabels,
} from '../configure-option-intent.js';

/** The scenario's real option labels (diagnosis §4, persisted staging graph). */
const SCENARIO_2308_OPTION_LABELS = [
  'Launch Customer Retention Programme',
  'Content-led growth',
  'Hybrid',
  'Sales-led growth',
  'Self-serve growth',
  'Status quo',
] as const;

/** Remedy messages, verbatim from the re-walk (diagnosis §2c / §7). */
const REMEDY_5 =
  'Set the effect value of Launch Customer Retention Programme on Customer Retention Investment to 1';
const REMEDY_6 =
  'Under Launch Customer Retention Programme, set Customer Retention Investment to 1 and Customer Churn Rate to 0.2';
const REMEDY_7 =
  'Under Launch Customer Retention Programme, set Customer Retention Investment to £40,000';
const REMEDY_2 = 'Set Customer Retention Investment to £40,000';
const PROBE_P1 =
  "Set the Launch Customer Retention Programme option's effect on Customer Retention Investment to 1";

const LABEL_DECIDABLE: readonly (readonly [string, string])[] = [
  ['remedy #5', REMEDY_5],
  ['remedy #6', REMEDY_6],
  ['remedy #7', REMEDY_7],
];

// ---------------------------------------------------------------------------
// 1. The detector reports, on its own no-match verdict, whether a LABEL anchor
//    would have decided it. Derived by re-running the SAME classifier with the
//    anchor granted — never a second, mirrorable predicate (trap 12).
// ---------------------------------------------------------------------------

describe('detectConfigureOptionIntent — labelAnchorWouldDecide', () => {
  for (const [name, message] of LABEL_DECIDABLE) {
    it(`${name}: no-match with empty labels, and reports the label anchor would decide`, () => {
      const detection = detectConfigureOptionIntent(message, []);
      expect(detection.matched).toBe(false);
      expect(
        detection.matched === false ? detection.labelAnchorWouldDecide : null,
        `${name} must advertise that an option LABEL would flip its verdict`,
      ).toBe(true);
    });
  }

  it('a message already anchored by the literal word "option" does NOT need labels', () => {
    const detection = detectConfigureOptionIntent(PROBE_P1, []);
    expect(detection).toEqual({ matched: true, trigger: 'effect_vocab' });
  });

  it('a message with no configure/effect/value payload does NOT need labels', () => {
    // Remedy #8 — the canvas's own `0 → 1` notation, no assignment verb.
    const detection = detectConfigureOptionIntent(
      'Launch Customer Retention Programme: Customer Retention Investment 0 → 1',
      [],
    );
    expect(detection.matched).toBe(false);
    expect(detection.matched === false ? detection.labelAnchorWouldDecide : null).toBe(false);
  });

  it('a question shape never needs labels (the suppressor is above the anchor)', () => {
    const detection = detectConfigureOptionIntent('What did you configure on my options?', []);
    expect(detection.matched).toBe(false);
    expect(detection.matched === false ? detection.labelAnchorWouldDecide : null).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The resolver — the S1 seam. Request labels first (free); the persisted
//    read happens ONLY when it could change the verdict.
// ---------------------------------------------------------------------------

describe('resolveConfigureOptionIntent — persisted label anchor', () => {
  for (const [name, message] of LABEL_DECIDABLE) {
    it(`${name}: reaches the edit lane once the PERSISTED option labels are consulted`, async () => {
      const loadPersistedOptionLabels = vi.fn(async () => [...SCENARIO_2308_OPTION_LABELS]);
      const resolution = await resolveConfigureOptionIntent({
        message,
        // THE LIVE WIRE: the UI sends no graph_state, so the request-derived
        // label list is empty on every real turn (diagnosis §2b, verified
        // against all eight captured request bodies).
        requestOptionLabels: [],
        loadPersistedOptionLabels,
      });
      expect(loadPersistedOptionLabels).toHaveBeenCalledTimes(1);
      expect(resolution.detection.matched, `${name} must claim the edit lane`).toBe(true);
      expect(resolution.optionLabelSource).toBe('persisted');
      expect(resolution.persistedRead).toBe('labels');
    });
  }

  it('remedy #5 resolves to the effect_vocab trigger', async () => {
    const resolution = await resolveConfigureOptionIntent({
      message: REMEDY_5,
      requestOptionLabels: [],
      loadPersistedOptionLabels: async () => [...SCENARIO_2308_OPTION_LABELS],
    });
    expect(resolution.detection).toEqual({ matched: true, trigger: 'effect_vocab' });
  });

  for (const [name, message] of [
    ['remedy #6', REMEDY_6],
    ['remedy #7', REMEDY_7],
  ] as const) {
    it(`${name} resolves to the option_value_set trigger`, async () => {
      const resolution = await resolveConfigureOptionIntent({
        message,
        requestOptionLabels: [],
        loadPersistedOptionLabels: async () => [...SCENARIO_2308_OPTION_LABELS],
      });
      expect(resolution.detection).toEqual({ matched: true, trigger: 'option_value_set' });
    });
  }

  // ---- the negative arm: blast radius stays where the diagnosis put it ----

  it('remedy #2 (a plain FACTOR value edit) stays NO_MATCH even with the real option labels', async () => {
    const resolution = await resolveConfigureOptionIntent({
      message: REMEDY_2,
      requestOptionLabels: [],
      loadPersistedOptionLabels: async () => [...SCENARIO_2308_OPTION_LABELS],
    });
    expect(
      resolution.detection.matched,
      'a factor-value edit must stay on set_factor_value, not the edit LLM',
    ).toBe(false);
  });

  // ---- the read is not added to turns whose verdict it cannot change ----

  it('does NOT read the persisted graph when the message is already anchored', async () => {
    const loadPersistedOptionLabels = vi.fn(async () => [...SCENARIO_2308_OPTION_LABELS]);
    const resolution = await resolveConfigureOptionIntent({
      message: PROBE_P1,
      requestOptionLabels: [],
      loadPersistedOptionLabels,
    });
    expect(loadPersistedOptionLabels).not.toHaveBeenCalled();
    expect(resolution.detection).toEqual({ matched: true, trigger: 'effect_vocab' });
    expect(resolution.optionLabelSource).toBe('request');
    expect(resolution.persistedRead).toBe('not_attempted');
  });

  it('does NOT read the persisted graph for a conversational turn', async () => {
    const loadPersistedOptionLabels = vi.fn(async () => [...SCENARIO_2308_OPTION_LABELS]);
    await resolveConfigureOptionIntent({
      message: 'Thanks, that makes sense. What happens next?',
      requestOptionLabels: [],
      loadPersistedOptionLabels,
    });
    expect(loadPersistedOptionLabels).not.toHaveBeenCalled();
  });

  it('does NOT read the persisted graph when the request already carried labels that decide', async () => {
    const loadPersistedOptionLabels = vi.fn(async () => [...SCENARIO_2308_OPTION_LABELS]);
    const resolution = await resolveConfigureOptionIntent({
      message: REMEDY_6,
      requestOptionLabels: [...SCENARIO_2308_OPTION_LABELS],
      loadPersistedOptionLabels,
    });
    expect(loadPersistedOptionLabels).not.toHaveBeenCalled();
    expect(resolution.detection).toEqual({ matched: true, trigger: 'option_value_set' });
    expect(resolution.optionLabelSource).toBe('request');
  });

  it('a persisted read that yields nothing degrades to the pristine verdict, not a throw', async () => {
    const resolution = await resolveConfigureOptionIntent({
      message: REMEDY_6,
      requestOptionLabels: [],
      loadPersistedOptionLabels: async () => [],
    });
    expect(resolution.detection.matched).toBe(false);
    expect(resolution.optionLabelSource).toBe('request');
    // Review correction (#796): an option-less graph is a read that HAPPENED.
    // Reporting it as `request`/not-attempted made the route's read-frequency
    // meter under-count the reads it exists to measure.
    expect(resolution.persistedRead).toBe('empty');
  });

  it('reports a FAILED read distinctly, so the meter cannot silently under-count', async () => {
    const resolution = await resolveConfigureOptionIntent({
      message: REMEDY_6,
      requestOptionLabels: [],
      loadPersistedOptionLabels: async () => {
        throw new Error('supabase down');
      },
    });
    expect(resolution.detection.matched).toBe(false);
    expect(resolution.optionLabelSource).toBe('request');
    expect(resolution.persistedRead).toBe('failed');
  });

  it('every persistedRead value other than not_attempted means a round-trip happened', async () => {
    // Derived exhaustiveness: the three "a read happened" outcomes are the
    // ones the meter must see, and `not_attempted` is the only free verdict.
    const outcomes = await Promise.all([
      resolveConfigureOptionIntent({
        message: REMEDY_6,
        requestOptionLabels: [],
        loadPersistedOptionLabels: async () => [...SCENARIO_2308_OPTION_LABELS],
      }),
      resolveConfigureOptionIntent({
        message: REMEDY_6,
        requestOptionLabels: [],
        loadPersistedOptionLabels: async () => [],
      }),
      resolveConfigureOptionIntent({
        message: REMEDY_6,
        requestOptionLabels: [],
        loadPersistedOptionLabels: async () => {
          throw new Error('boom');
        },
      }),
      resolveConfigureOptionIntent({
        message: 'Thanks, that makes sense.',
        requestOptionLabels: [],
        loadPersistedOptionLabels: async () => [...SCENARIO_2308_OPTION_LABELS],
      }),
    ]);
    expect(outcomes.map((r) => r.persistedRead)).toEqual([
      'labels',
      'empty',
      'failed',
      'not_attempted',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. The option-label projection — ONE derivation, used for both the request
//    graph_state and the persisted graph (trap 12: the route previously
//    inlined this filter/map at the call site).
// ---------------------------------------------------------------------------

describe('projectOptionLabels', () => {
  it('keeps option nodes with string labels and drops everything else', () => {
    expect(
      projectOptionLabels([
        { id: 'opt_a', kind: 'option', label: 'Launch Customer Retention Programme' },
        { id: 'fac_a', kind: 'factor', label: 'Customer Retention Investment' },
        { id: 'opt_b', kind: 'option' },
        { id: 'opt_c', kind: 'option', label: 42 },
        { id: 'opt_d', kind: 'option', label: '   ' },
        null,
        'not-a-node',
      ]),
    ).toEqual(['Launch Customer Retention Programme']);
  });

  it('returns an empty list for null/undefined (the live-wire graph_state)', () => {
    expect(projectOptionLabels(null)).toEqual([]);
    expect(projectOptionLabels(undefined)).toEqual([]);
  });
});
