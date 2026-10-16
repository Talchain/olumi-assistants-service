/**
 * The one rule for "which entity does `run_analysis` address?".
 *
 * ⚠ THIS FILE'S REASON TO EXIST IS THE EXTRACTION. The rule was previously
 * written inline inside the ROADMAP 2.229 imperative-re-run pre-route in
 * `turn-executor.ts`. Moving it here so the target-repair site can READ it
 * rather than RE-IMPLEMENT it is the whole point of the change; these tests
 * pin the shape the pre-route used to build inline, so the extraction cannot
 * have quietly altered it.
 */

import { describe,expect,it } from 'vitest';


import { toEntityKind } from '../graph-lookup-adapter.js';
import { HANDLER_VALIDATION_REGISTRY } from '../validation-registry.js';






describe('resolveRunAnalysisTargetEntity', () => {










  it('CONTRAST CONTROL — the kinds this repair exists to replace are NOT accepted', () => {
    // Without this the assertion above could pass against a registry that
    // accepted everything, which would make the whole defect impossible and
    // the test vacuous. Derived from the same two sources as the defect.
    const accepted = HANDLER_VALIDATION_REGISTRY.run_analysis!.accepted_entity_kinds;
    for (const nodeKind of ['decision', 'factor', 'outcome', 'risk', 'action']) {
      expect(toEntityKind(nodeKind)).toBe('node');
    }
    expect(accepted).not.toContain('node');
  });
});
