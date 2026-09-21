/**
 * B1 — ROADMAP 2.1003. The wrong-object regression fixture.
 *
 * RED-first. Measured at pristine `6b8698a4` BY EXECUTION before any fix was
 * written (the recorded output is quoted in each test):
 *
 *   resolveEditTarget('Change the Salesforce annual licence fee to £30,000')
 *     -> { match_type: 'exact_label', confidence: 'high',
 *          resolved_target: { id: 'fac_annual_crm_cost', … } }
 *   determineEditResolutionMode(same)  ->  'auto_apply'
 *
 * i.e. the user named "Salesforce", nothing in the graph is Salesforce, and
 * the product silently auto-applies to a DIFFERENT node.
 *
 * ⚠ WHAT THIS FIXTURE DOES **NOT** CLAIM. The brief's "4 of 6" current-staging
 * rate is UNVERIFIED and is not asserted here; the audit's live nonexistent-
 * target control ("Customer Support Staffing Buffer") refused correctly. This
 * is a regression case for a reproducible source defect, not a rate claim.
 */
import { describe, it, expect } from 'vitest';

import { resolveEditTarget, determineEditResolutionMode, classifyEditIntent } from '../edit-graph.js';

const CRM_ID = 'fac_annual_crm_cost';
const CRM_LABEL = 'Annual CRM Licence Cost';
const WRONG_OBJECT_MESSAGE = 'Change the Salesforce annual licence fee to £30,000';
const RIGHT_OBJECT_MESSAGE = 'Change the annual CRM licence cost to £30,000';

function context() {
  return {
    graph: {
      nodes: [
        { id: CRM_ID, label: CRM_LABEL, kind: 'factor' },
        { id: 'fac_sales_cycle', label: 'Sales Cycle Length', kind: 'factor' },
        { id: 'goal_1', label: 'Improve Net Revenue Retention', kind: 'goal' },
      ],
      edges: [],
    },
  } as never;
}

describe('B1 — the token-overlap identity gap: measured, stamped, NOT yet fixed', () => {
  it('PRECONDITION: the fixture reproduces the captured identity gap', () => {
    // Trap 13b, third face — a discriminator whose fixture silently stops
    // reproducing the target identity is a green test with no power.
    const nodes = (context() as unknown as { graph: { nodes: Array<{ label: string }> } }).graph.nodes;
    expect(nodes.filter((n) => /salesforce/i.test(n.label))).toHaveLength(0);
    expect(nodes.filter((n) => n.label === CRM_LABEL)).toHaveLength(1);
  });

  it('still RESOLVES to the CRM node (the resolver is unchanged) but is stamped heuristic', () => {
    const r = resolveEditTarget(WRONG_OBJECT_MESSAGE, context());
    // Binding by IDENTITY, not by a value predicate another object could satisfy.
    expect(r.resolved_target?.id).toBe(CRM_ID);
    expect(r.heuristic_match).toBe(true);
  });

  it('THE HARM STILL REPRODUCES — routing is deliberately UNCHANGED, and this pins it', () => {
    // ⚠ THIS TEST ASSERTS THE DEFECT, ON PURPOSE, AND IT IS NOT A BLESSING.
    // A demotion was built and WITHDRAWN when it was measured breaking a
    // legitimate rename (see the withdrawal note in `edit-graph.ts`). Pinning
    // the current behaviour here means the follow-up lane's fix has a RED to
    // turn green, and nobody can claim 2.1003 closed the identity gap.
    expect(determineEditResolutionMode(WRONG_OBJECT_MESSAGE, context())).toBe('auto_apply');
  });

  it('THE ROOT CAUSE, measured: the message is classified structural BY FALLTHROUGH', () => {
    // Not the confidence path the brief derived. `classifyEditIntent` needs
    // `hasValueTarget`, whose vocabulary lacks "fee", so the message defaults
    // to 'structural' — and the structural early-return auto-applies before
    // any confidence/compound/low-impact check runs.
    expect(classifyEditIntent(WRONG_OBJECT_MESSAGE)).toBe('structural');
    // …while the phrasing that names the object CORRECTLY contains "cost",
    // classifies as a parameter update, and is held for confirmation. The
    // product is strictest with the user who got it right.
    expect(classifyEditIntent(RIGHT_OBJECT_MESSAGE)).toBe('parameter_update');
    expect(determineEditResolutionMode(RIGHT_OBJECT_MESSAGE, context())).toBe('propose_and_confirm');
  });

  it('the withdrawn demotion would have broken a legitimate rename (why it is withdrawn)', () => {
    // The class the author did not imagine, kept as a standing guard so the
    // follow-up lane cannot rediscover it the expensive way: a rename
    // token-overlaps its own target at exactly 0.5 and is therefore a
    // heuristic match too. Any future demotion must keep this applying.
    const ctx = {
      graph: { nodes: [{ id: 'fac_setup', label: 'Setup Complexity', kind: 'factor' }], edges: [] },
    } as never;
    const r = resolveEditTarget('Rename the setup factor', ctx);
    expect(r.heuristic_match).toBe(true);
    expect(determineEditResolutionMode('Rename the setup factor', ctx)).toBe('auto_apply');
  });

  it('GREEN half of the discriminating pair: an EXACT-label match is untouched', () => {
    // The honest arm must keep its `high`/exact semantics and must NOT be
    // stamped heuristic. Loosening the demotion for a different arm must not
    // move this assertion — that is what makes the pair discriminate by ARM
    // rather than merely proving sensitivity to something.
    const r = resolveEditTarget(RIGHT_OBJECT_MESSAGE, context());
    expect(r.resolved_target?.id).toBe(CRM_ID);
    expect(r.confidence).toBe('high');
    expect(r.match_type).toBe('exact_label');
    expect(r.heuristic_match).toBeUndefined();
  });

  it('POSITIVE CONTROL (trap 13): a genuinely-present target still resolves and is not refused', () => {
    // Without this the absence assertion is vacuous and "never edit anything"
    // would pass. A refusal would show as match_type 'none' / a null target.
    const r = resolveEditTarget(RIGHT_OBJECT_MESSAGE, context());
    expect(r.match_type).not.toBe('none');
    expect(r.resolved_target).not.toBeNull();
    const mode = determineEditResolutionMode(RIGHT_OBJECT_MESSAGE, context());
    expect(mode).not.toBe('clarify');
    expect(mode).not.toBe('no_edit_answer');
  });

  it('CORRECTED PREMISE, recorded so it is not silently inherited', () => {
    // The brief's §9.4 positive control assumes the honest phrasing "lands".
    // Measured: it does NOT auto-apply — it routes to propose_and_confirm,
    // while the WRONG-object phrasing auto-applies.
    const wrong = resolveEditTarget(WRONG_OBJECT_MESSAGE, context());
    const right = resolveEditTarget(RIGHT_OBJECT_MESSAGE, context());
    expect(wrong.heuristic_match).toBe(true);
    expect(right.heuristic_match).toBeUndefined();
  });

  it('an ambiguous multi-node token match still clarifies (unchanged routing)', () => {
    const ctx = {
      graph: {
        nodes: [
          { id: 'a', label: 'Licence Cost North', kind: 'factor' },
          { id: 'b', label: 'Licence Cost South', kind: 'factor' },
        ],
        edges: [],
      },
    } as never;
    expect(determineEditResolutionMode('Change the licence cost to 5', ctx)).toBe('clarify');
  });
});
