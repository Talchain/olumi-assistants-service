/**
 * W2E-2 review fix — finiteness across the WHOLE LLM proposal-parameter
 * channel (path b), not just the one handler the original patch touched.
 *
 * `set_factor_value.value` was guarded by the original W2E-2 patch, but
 * `add_constraint.value` sits on the exact same channel and was a plain
 * `z.number()` — which ACCEPTS ±Infinity in zod 3.x (only NaN is rejected by
 * the base type). An Infinity constraint threshold flows into
 * `graph.goal_constraints` and onward to PLoT.
 *
 * SWEEP SCOPE (complete manifest — every handler declared in
 * HANDLER_VALIDATION_REGISTRY, src/orchestrator-v5/routing/validation-registry.ts,
 * which is the single registry the proposal-parameter validator reads):
 *
 *   handler                 | parameter_schemas          | numeric? | guarded by
 *   ------------------------|----------------------------|----------|-------------------
 *   run_analysis            | (none)                     | —        | n/a
 *   explain_from_structure  | (none)                     | —        | n/a
 *   explain_results         | (none)                     | —        | n/a
 *   what_would_flip         | (none)                     | —        | n/a
 *   set_factor_value        | value                      | YES      | .finite() (W2E-2)
 *   add_constraint          | constraint_type            | no (enum)| n/a
 *                           | value                      | YES      | .finite() (THIS FIX)
 *                           | label, unit                | no (str) | n/a
 *   adjust_edge_strength    | strength                   | YES      | .min(-1).max(1)
 *                           | std                        | YES      | .gt(0).max(0.5)
 *
 * The two adjust_edge_strength schemas are bounded, and a bounded zod number
 * rejects ±Infinity via the range check — pinned by tests below so a future
 * loosening of those bounds cannot silently reopen the hole.
 *
 * Undeclared parameters: the validator only checks names present in
 * `parameter_schemas` (validator.ts:301-313, a documented deferral). That is
 * not a live leak on this channel because every handler reads ONLY declared
 * names — verified by grepping `proposal.parameters` across
 * src/orchestrator-v5/tools/handlers/: set-factor-value.ts:245 ('value'),
 * adjust-edge-strength.ts:172/202 ('strength'/'std'), add-constraint.ts:111
 * ('constraint_type'/'value'/'label'/'unit'). No handler reads an undeclared
 * numeric parameter.
 */

import { describe, it, expect } from 'vitest';

import {
  AddConstraintValueSchema,
  AddConstraintTypeSchema,
} from '../add-constraint.js';
import {
  AdjustEdgeStrengthSchema,
  AdjustEdgeStrengthStdSchema,
} from '../adjust-edge-strength.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../../routing/validation-registry.js';

describe('W2E-2 — AddConstraintValueSchema finiteness (sibling channel)', () => {
  it('rejects +Infinity', () => {
    expect(AddConstraintValueSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });

  it('rejects -Infinity', () => {
    expect(AddConstraintValueSchema.safeParse(Number.NEGATIVE_INFINITY).success).toBe(false);
  });

  it('rejects NaN (already-enforced by z.number(), pinned here)', () => {
    expect(AddConstraintValueSchema.safeParse(Number.NaN).success).toBe(false);
  });

  it('accepts finite values of any magnitude (contract-silent → no range invented)', () => {
    expect(AddConstraintValueSchema.safeParse(5).success).toBe(true);
    expect(AddConstraintValueSchema.safeParse(-273.15).success).toBe(true);
    expect(AddConstraintValueSchema.safeParse(5_000_000).success).toBe(true);
    expect(AddConstraintValueSchema.safeParse(0).success).toBe(true);
  });

  it('still rejects non-numbers (behaviour unchanged)', () => {
    expect(AddConstraintValueSchema.safeParse('5').success).toBe(false);
    expect(AddConstraintValueSchema.safeParse(null).success).toBe(false);
  });
});

describe('W2E-2 sweep — adjust_edge_strength numeric params reject non-finite', () => {
  it('strength rejects ±Infinity and NaN via its [-1, 1] bounds', () => {
    expect(AdjustEdgeStrengthSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
    expect(AdjustEdgeStrengthSchema.safeParse(Number.NEGATIVE_INFINITY).success).toBe(false);
    expect(AdjustEdgeStrengthSchema.safeParse(Number.NaN).success).toBe(false);
    expect(AdjustEdgeStrengthSchema.safeParse(0.5).success).toBe(true);
  });

  it('std rejects ±Infinity and NaN via its (0, 0.5] bounds', () => {
    expect(AdjustEdgeStrengthStdSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
    expect(AdjustEdgeStrengthStdSchema.safeParse(Number.NEGATIVE_INFINITY).success).toBe(false);
    expect(AdjustEdgeStrengthStdSchema.safeParse(Number.NaN).success).toBe(false);
    expect(AdjustEdgeStrengthStdSchema.safeParse(0.1).success).toBe(true);
  });

  it('non-numeric params are unaffected (constraint_type stays an enum)', () => {
    expect(AddConstraintTypeSchema.safeParse('at_least').success).toBe(true);
    expect(AddConstraintTypeSchema.safeParse('exactly').success).toBe(false);
  });
});

/**
 * Completeness ratchet. If a future handler registers a NEW numeric parameter
 * schema on this channel, this test fails until it is proven non-finite-safe.
 * That converts the sweep above from a point-in-time claim into an enforced
 * invariant — the next reviewer does not have to re-run it by hand.
 */
describe('W2E-2 sweep — every numeric parameter on the channel rejects non-finite', () => {
  it('holds for the complete HANDLER_VALIDATION_REGISTRY manifest', () => {
    const offenders: string[] = [];
    for (const [handlerId, decl] of Object.entries(HANDLER_VALIDATION_REGISTRY)) {
      for (const [paramName, schema] of Object.entries(decl.parameter_schemas ?? {})) {
        // Only numeric params are in scope: a schema that rejects a plain
        // finite number isn't a numeric channel at all (enum/string).
        if (!schema.safeParse(1).success && !schema.safeParse({ value: 1 }).success) continue;
        for (const bad of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
          if (schema.safeParse(bad).success) {
            offenders.push(`${handlerId}.${paramName} accepts ${bad}`);
          }
          if (schema.safeParse({ value: bad }).success) {
            offenders.push(`${handlerId}.${paramName} accepts {value:${bad}}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
