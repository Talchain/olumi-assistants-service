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

import { describe, expect, it } from 'vitest';

import { resolveRunAnalysisTargetEntity } from '../run-analysis-target.js';
import { HANDLER_VALIDATION_REGISTRY } from '../validation-registry.js';
import { toEntityKind } from '../graph-lookup-adapter.js';

const OPTION = { id: 'opt_open', kind: 'option', label: 'Open a second bakery' };
const DECISION = { id: 'dec_hiring', kind: 'decision', label: 'Engineering Hiring Decision' };
const GOAL = { id: 'goal_profit', kind: 'goal', label: 'Bakery profit' };
const FACTOR = { id: 'fac_capex', kind: 'factor', label: 'Capital expenditure' };

describe('resolveRunAnalysisTargetEntity', () => {
  it('reproduces the pre-route entity byte-for-byte, including the label', () => {
    // ⚠ EXACT, not a subset. The pre-route stamped precisely these five
    // fields; `toEqual` REDs if the extraction added, dropped or renamed one.
    expect(resolveRunAnalysisTargetEntity([DECISION, GOAL, FACTOR, OPTION])).toEqual({
      id: 'opt_open',
      kind: 'option',
      label: 'Open a second bakery',
      resolution_status: 'resolved',
      resolution_method: 'context_inference',
    });
  });

  it('omits `label` entirely when the option has none — never an empty string', () => {
    const out = resolveRunAnalysisTargetEntity([{ id: 'opt_bare', kind: 'option' }]);
    expect(out).toEqual({
      id: 'opt_bare',
      kind: 'option',
      resolution_status: 'resolved',
      resolution_method: 'context_inference',
    });
    expect(out === null ? [] : Object.keys(out)).not.toContain('label');
  });

  it('picks the FIRST option, so the pre-route and the repair pick the same one', () => {
    // The two call sites must not be able to disagree about which option they
    // named on the same graph; that would be one rule with two answers.
    const nodes = [DECISION, OPTION, { id: 'opt_hold', kind: 'option', label: 'Hold' }];
    expect(resolveRunAnalysisTargetEntity(nodes)?.id).toBe('opt_open');
  });

  it('DECLINES on every graph with no option node', () => {
    expect(resolveRunAnalysisTargetEntity([DECISION, GOAL, FACTOR])).toBeNull();
    expect(resolveRunAnalysisTargetEntity([])).toBeNull();
    expect(resolveRunAnalysisTargetEntity(undefined)).toBeNull();
    // A malformed node is not a target either: no id, or a non-string id.
    expect(resolveRunAnalysisTargetEntity([{ kind: 'option', label: 'no id' }])).toBeNull();
    expect(resolveRunAnalysisTargetEntity([{ id: '', kind: 'option' }])).toBeNull();
    expect(resolveRunAnalysisTargetEntity([{ id: 7, kind: 'option' }])).toBeNull();
    expect(resolveRunAnalysisTargetEntity([null, undefined, 'opt_open'])).toBeNull();
  });

  it('the kind it emits is one the registry ACCEPTS — derived, not asserted', () => {
    // ⚠ DERIVED FROM THE REGISTRY (trap 12), so a future narrowing of
    // `accepted_entity_kinds` REDs here instead of shipping a repair that
    // still fails validation.
    const accepted = HANDLER_VALIDATION_REGISTRY.run_analysis?.accepted_entity_kinds;
    expect(accepted).toBeDefined();
    const entity = resolveRunAnalysisTargetEntity([DECISION, OPTION]);
    expect(entity).not.toBeNull();
    expect(accepted).toContain(entity!.kind);
  });

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
