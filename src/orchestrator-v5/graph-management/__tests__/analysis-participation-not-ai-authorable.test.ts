import { describe, it, expect } from 'vitest';
import { aiEditableFieldRoots } from '@talchain/schemas/orchestrator';
import { ALLOWED_NODE_FIELD_ROOTS } from '../field-safety.js';
import { transformNodeToV3 } from '../../../cee/transforms/schema-v3.js';

/**
 * COLLAB Track A — NO MODEL MAY EXCLUDE A USER'S CONTRIBUTION.
 *
 * `analysis_participation` decides whether a person's contribution reaches the
 * calculation. If a model could write it, the model could silently remove a
 * human's input from their own analysis — the exact inversion of "humans remain
 * the authors". CEE mints this field in response to a human gesture; nothing
 * else may.
 *
 * ⚠ THE POSTURE IS CURRENTLY TRUE BY OMISSION ON BOTH PATHS, WHICH IS EXACTLY
 * WHY IT NEEDS PINNING. Nothing anywhere NAMES this field and refuses it; it is
 * safe because two separate mechanisms happen not to include it, and either
 * could be relaxed by a change that looks entirely reasonable in isolation:
 *
 *   · the EDIT path (`update_node`) is deny-by-default — `field-safety.ts`
 *     derives its allowlist from the shared contract's classed table, and this
 *     root is not a row in it. Adding a row is a one-line change in another
 *     repo.
 *   · the DRAFT path rebuilds each node FIELD BY FIELD (`transformNodeToV3`),
 *     so a model-emitted value is dropped because nothing copies it. A single
 *     `...node` spread — the obvious "preserve additive fields" tidy-up, and a
 *     pattern used on several sibling objects in `cee-v3.ts` — would silently
 *     make it model-authorable with no other visible effect.
 *
 * Both cases below are therefore DISCRIMINATING: each pairs the claim with a
 * sibling that MUST go the other way, so neither can pass by the mechanism
 * simply having stopped working.
 */

describe('analysis_participation is not AI-authorable — edit path', () => {
  it('is absent from the node field roots a model may update', () => {
    // DERIVED from the shared contract's classed table, not mirrored here.
    expect(ALLOWED_NODE_FIELD_ROOTS.has('analysis_participation')).toBe(false);
    expect(aiEditableFieldRoots('node').has('analysis_participation')).toBe(false);

    // DISCRIMINATION: the allowlist is genuinely populated and genuinely
    // permissive about ordinary fields, so the `false` above is a decision and
    // not an empty set.
    expect(ALLOWED_NODE_FIELD_ROOTS.has('label')).toBe(true);
    expect(ALLOWED_NODE_FIELD_ROOTS.size).toBeGreaterThan(5);
  });

  /**
   * A FIRING GUARD IS THE GUARD WORKING. If the shared contract ever grants
   * this root, this test REDs and the DECISION has to be recorded — it must not
   * be resolved by re-pinning the list. The only correct resolutions are to
   * withdraw the grant, or to state in writing why a model may now remove a
   * person's contribution from their own calculation.
   */
  it('stays absent from the whole AI-editable surface, on every entity', () => {
    for (const entity of ['node', 'edge'] as const) {
      expect(aiEditableFieldRoots(entity).has('analysis_participation')).toBe(false);
    }
  });
});

describe('analysis_participation is not AI-authorable — draft path', () => {
  it('drops a model-emitted participation value while carrying the model\'s legitimate fields', () => {
    const drafted = transformNodeToV3({
      id: 'factor_a',
      kind: 'factor',
      label: 'Monthly churn',
      // A model trying to exclude a user's contribution.
      analysis_participation: 'retained_excluded',
    } as never) as Record<string, unknown>;

    // THE CLAIM: the model's attempt does not reach the node.
    expect(drafted).not.toHaveProperty('analysis_participation');
    expect(drafted.analysis_participation).toBeUndefined();

    // THE DISCRIMINATION: the transform is running and IS carrying the fields
    // a model legitimately authors, in the same call. Without this, the claim
    // above would also pass if the transform had returned an empty object.
    expect(drafted.id).toBe('factor_a');
    expect(drafted.label).toBe('Monthly churn');
    expect(drafted.kind).toBe('factor');
  });

  it('drops it even when the model also sets a legitimate sibling in the same node', () => {
    const drafted = transformNodeToV3({
      id: 'factor_b',
      kind: 'factor',
      label: 'Hiring rate',
      category: 'controllable',
      analysis_participation: 'included',
    } as never) as Record<string, unknown>;

    expect(drafted).not.toHaveProperty('analysis_participation');
    // The sibling the model MAY author survives the same transform — so the
    // drop above is this field's, not the transform refusing everything.
    expect(drafted.category).toBe('controllable');
  });
});
