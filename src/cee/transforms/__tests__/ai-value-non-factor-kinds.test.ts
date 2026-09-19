/**
 * ROW: AI-PROPOSED VALUES ON NON-FACTOR KINDS REACH THE WIRE, MARKED AS THE AI'S.
 *
 * USER OUTCOME: a person sees the value the AI proposed for a RISK or an
 * OUTCOME — clearly marked as the AI's suggestion, not their own — instead of
 * seeing nothing.
 *
 * ⚠ THE ORIGINAL DIAGNOSIS WAS WRONG ABOUT THE MECHANISM AND IS CORRECTED HERE.
 * The brief reported "a hard gate drops `display_value` for every kind except
 * `factor`, so a value on a risk/outcome is DROPPED before it can reach a
 * surface". Measured at this tip, that is FALSE in its load-bearing half:
 *
 *   · `observed_state` is built from `isFactorData(node.data) && value !==
 *     undefined` (`schema-v3.ts:364`). `isFactorData` is `!('interventions' in
 *     data)` (`schema-v2.ts:85`) — it does NOT read `kind`. A risk carrying
 *     `data.value` therefore ALREADY reaches the wire with its number.
 *   · the LLM-authored `display_value` PASSTHROUGH (`:633`) is likewise gated
 *     on `isFactorData`, not on `kind`.
 *
 * The one genuinely kind-gated limb is the display_value SYNTHESIS FALLBACK
 * (`:643`), which declines to render a human-readable string for any kind but
 * `factor`. So the defect is NARROWER and different in nature: the number
 * arrives, and the sentence a human reads does not. A risk ships
 * `observed_state.value: 0.3` and NO `display_value` — the canvas has a
 * quantity it cannot render as words.
 *
 * These tests pin the discriminating pair the fix must satisfy.
 */
import { describe, it, expect } from 'vitest';
import {
  transformNodeToV3,
  DISPLAY_VALUE_SYNTHESIS_INCLUDED_KINDS,
  DISPLAY_VALUE_SYNTHESIS_EXCLUDED_KINDS,
} from '../schema-v3.js';
import type { V1Node } from '../schema-v2.js';
import { NodeKindV3 } from '../../../schemas/cee-v3.js';

/** A node carrying an AI-INFERRED quantity, parameterised only by kind. */
function nodeWithInferredValue(kind: string, id: string): V1Node {
  return {
    id,
    kind,
    label: `${kind} carrying an AI-proposed quantity`,
    data: {
      value: 0.3,
      unit: '%',
      raw_value: 30,
      extractionType: 'inferred',
    },
  } as unknown as V1Node;
}

describe('AI-proposed values on non-factor kinds', () => {
  // ── CONTRAST CONTROL: the factor arm must be unchanged by any fix ────────
  it('CONTROL — a factor with an AI-inferred value gets observed_state, a display_value, and AI authorship', () => {
    const out = transformNodeToV3(nodeWithInferredValue('factor', 'fac_churn'));

    expect(out.kind).toBe('factor');
    expect(out.observed_state?.value).toBe(0.3);
    // Authorship: inferred -> cee_inference on the wire, ai_inferred for display.
    expect(out.observed_state?.source).toBe('cee_inference');
    expect(out.observed_state?.extractionType).toBe('inferred');
    expect(out.provenance).toBe('ai_inferred');
    // The human-readable string the canvas renders.
    expect(out.display_value).toBeDefined();
  });

  // ── The number already survives for non-factor kinds (corrects the brief) ─
  it.each(['risk', 'outcome', 'decision'])(
    'a %s with an AI-inferred value ALREADY reaches the wire with its number and AI authorship',
    (kind) => {
      const out = transformNodeToV3(nodeWithInferredValue(kind, `${kind}_node`));

      expect(out.kind).toBe(kind);
      expect(out.observed_state?.value).toBe(0.3);
      expect(out.observed_state?.source).toBe('cee_inference');
      expect(out.provenance).toBe('ai_inferred');
    },
  );

  // ── RED AT PRISTINE: the human-readable string is the part that is missing ─
  it.each(['risk', 'outcome', 'decision'])(
    'a %s with an AI-inferred value renders a display_value (RED at pristine)',
    (kind) => {
      const out = transformNodeToV3(nodeWithInferredValue(kind, `${kind}_node`));

      expect(out.observed_state?.value).toBe(0.3); // precondition: the value IS there
      expect(out.display_value).toBeDefined();
      expect(out.display_value).toContain('30');
    },
  );

  // ── AUTHORSHIP MUST TRAVEL WITH THE WIDENED VALUE ────────────────────────
  it('a risk whose value came FROM THE BRIEF keeps user authorship, not AI authorship', () => {
    const out = transformNodeToV3({
      id: 'risk_stated',
      kind: 'risk',
      label: 'a risk the user quantified',
      data: { value: 0.3, unit: '%', raw_value: 30, extractionType: 'explicit' },
    } as unknown as V1Node);

    expect(out.observed_state?.source).toBe('brief_extraction');
    expect(out.provenance).toBe('from_brief');
    expect(out.display_value).toBeDefined();
  });

  it('a risk with NO value gets NO display_value — nothing is invented', () => {
    const out = transformNodeToV3({
      id: 'risk_bare',
      kind: 'risk',
      label: 'a risk with no quantity at all',
    } as unknown as V1Node);

    expect(out.observed_state).toBeUndefined();
    expect(out.display_value).toBeUndefined();
  });

  // ── TRAP 12: THE HAND-WRITTEN SET MUST FAIL LOUD ON CONTRACT DRIFT ───────
  //
  // `DISPLAY_VALUE_SYNTHESIS_KINDS` is a hand-written list, which is the
  // hand-maintained-mirror defect. Derivation cannot fix it — the decision
  // "may this kind render a synthesised value" is a judgement, not something
  // computable from the enum. What derivation CAN do is refuse to let a kind
  // be added to the contract and silently default to "no display value".
  //
  // This asserts the two sets PARTITION `NodeKindV3` exactly: every kind is
  // explicitly included or explicitly excluded, nothing is in both, and
  // neither set names a kind the contract does not have.
  it('GUARD — the synthesis kind sets partition NodeKindV3 exactly', () => {
    const canonical = new Set<string>(NodeKindV3.options);
    const included = new Set(DISPLAY_VALUE_SYNTHESIS_INCLUDED_KINDS);
    const excluded = new Set(DISPLAY_VALUE_SYNTHESIS_EXCLUDED_KINDS);

    // Precondition: the enum is non-empty, so this guard cannot pass vacuously.
    expect(canonical.size).toBeGreaterThan(0);

    const both = [...included].filter((k) => excluded.has(k));
    expect(both, 'a kind is both included and excluded').toEqual([]);

    const unclassified = [...canonical].filter((k) => !included.has(k) && !excluded.has(k));
    expect(
      unclassified,
      'NodeKindV3 gained a kind that DISPLAY_VALUE_SYNTHESIS_KINDS does not classify — '
        + 'decide explicitly whether it may render a synthesised display_value',
    ).toEqual([]);

    const unknown = [...included, ...excluded].filter((k) => !canonical.has(k));
    expect(unknown, 'a classified kind is not in NodeKindV3').toEqual([]);
  });

  // ── goal STAYS EXCLUDED, AND THAT IS A DECISION, NOT AN OVERSIGHT ─────────
  it('a goal with a baseline gets NO synthesised display_value — its number is a TARGET surface', () => {
    const out = transformNodeToV3({
      id: 'goal_arr',
      kind: 'goal',
      label: 'Grow ARR',
      goal_baseline: 0.3,
      goal_baseline_raw: 30,
      goal_threshold_unit: '%',
    } as unknown as V1Node);

    // The goal limb still builds observed_state from the baseline...
    expect(out.observed_state?.value).toBe(0.3);
    // ...and we deliberately do NOT render it as this node's display value.
    expect(out.display_value).toBeUndefined();
  });
});
