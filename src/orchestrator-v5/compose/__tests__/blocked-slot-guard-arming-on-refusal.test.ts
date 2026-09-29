/**
 * POPULATING `blockers` ON A REFUSAL **ARMS** A GUARD RATHER THAN BYPASSING ONE
 * — and this suite measures what it does when armed.
 *
 * ## Why this exists
 *
 * `turn-executor.ts:12750` feeds `analysisReadyForTurn?.blockers` to
 * {@link applyBlockedSlotClaimGuard}. While the refusal carrier dropped
 * `blockers`, that guard short-circuited `no_blockers` on every refusal turn —
 * it was a NO-OP on exactly the payloads it was written to police. Carrying the
 * producer's rows switches it on.
 *
 * That is the correct direction (the guard removes a claim that a value exists
 * where the payload's own readiness says it does not), **but this guard has a
 * measured history of the opposite failure**: PR #1007 targeted the same defect
 * and shipped its exact inverse, replacing ordinary TRUE prose and destroying
 * the reply around it — *"I already ran the analysis at 1,000 samples…"* became
 * a generic refusal. So arming it is a claim that needs evidence, not an
 * assumption.
 *
 * ## What is asserted
 *
 * 1. The guard was genuinely INERT before (positive control: with no blockers
 *    it reports `no_blockers` and returns the text unchanged).
 * 2. Armed, it CORRECTS a fabricated slot claim — the defect it exists for.
 * 3. Armed, it LEAVES ALONE the templated refusal copy the chip arm actually
 *    ships, and ordinary true prose. This is the #1007 regression direction and
 *    is the load-bearing half.
 */

import { describe, it, expect } from 'vitest';

import { applyBlockedSlotClaimGuard } from '../blocked-slot-claim-guard.js';
import { buildCanonicalAnalysisReadyFromGraph, buildAnalysisRefusalReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';

const v3Edge = (id: string, from: string, to: string) => ({
  id, from, to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive' as const,
});

const FRESH_DRAFT = {
  version: '1',
  nodes: [
    { id: 'dec_crm', kind: 'decision', label: 'CRM decision' },
    { id: 'goal_revenue', kind: 'goal', label: 'Annual recurring revenue', goal_threshold: 0.8 },
    { id: 'fac_licence', kind: 'factor', label: 'Annual CRM Licence Cost', category: 'controllable', observed_state: { value: 0.4, cap: 1 } },
    { id: 'opt_hubspot', kind: 'option', label: 'Move to HubSpot' },
    { id: 'opt_stay', kind: 'option', label: 'Stay as we are' },
  ],
  edges: [
    v3Edge('e1', 'dec_crm', 'opt_hubspot'), v3Edge('e2', 'dec_crm', 'opt_stay'),
    v3Edge('e3', 'opt_hubspot', 'fac_licence'), v3Edge('e4', 'opt_stay', 'fac_licence'),
    v3Edge('e5', 'fac_licence', 'goal_revenue'),
  ],
};

/** The refusal carrier as it now ships, with the producer's own blocker rows. */
function refusalCarrier() {
  const wire = buildCanonicalAnalysisReadyFromGraph(FRESH_DRAFT);
  return buildAnalysisRefusalReadiness('MISSING_OPTION_VALUE', wire) as {
    blockers?: unknown;
  };
}

/**
 * The copy the chip arm actually ships on this refusal. Template-composed and
 * LLM-free (`compose/recoverable-handler-response.ts` makes no model call), so
 * there is no fabricated claim in it for the guard to find.
 */
const TEMPLATED_REFUSAL_COPY =
  "I can't run the analysis yet. Some options don't have effect values, so there's nothing to compare them on. Add a value and I'll run it.";

describe('arming the blocked-slot claim guard on a refusal turn', () => {
  it('POSITIVE CONTROL: the guard really was inert before this change', () => {
    // Precondition pinned in-test — without this, every assertion below could
    // pass on a guard that never runs at all (CLAUDE.md trap 13).
    const out = applyBlockedSlotClaimGuard({
      assistantText: 'Your model already reflects Annual CRM Licence Cost at 12%.',
      blockers: undefined,
      persistedGraph: FRESH_DRAFT,
    });
    expect(out.mode).toBe('no_blockers');
    expect(out.changed).toBe(false);
  });

  it('ARMED: it now CORRECTS a fabricated claim about a blocked slot — the defect it exists for', () => {
    const carrier = refusalCarrier();
    // The carried rows are what arms it.
    expect(Array.isArray(carrier.blockers) && carrier.blockers.length > 0).toBe(true);

    const fabricated =
      'Your model already reflects Annual CRM Licence Cost at 12% for Move to HubSpot, so no change is needed there.';
    const out = applyBlockedSlotClaimGuard({
      assistantText: fabricated,
      blockers: carrier.blockers,
      persistedGraph: FRESH_DRAFT,
    });

    expect(out.mode).not.toBe('no_blockers');
    expect(out.changed).toBe(true);
    // It does not merely delete: it names the slot so an answer can be accepted.
    expect(out.text).not.toBe(fabricated);
    expect(out.text.length).toBeGreaterThan(0);
  });

  it('⭐ THE #1007 REGRESSION DIRECTION: armed, it leaves the shipped refusal copy untouched', () => {
    const carrier = refusalCarrier();
    const out = applyBlockedSlotClaimGuard({
      assistantText: TEMPLATED_REFUSAL_COPY,
      blockers: carrier.blockers,
      persistedGraph: FRESH_DRAFT,
    });
    // Byte-identical. The refusal must survive its own blockers.
    expect(out.text).toBe(TEMPLATED_REFUSAL_COPY);
    expect(out.changed).toBe(false);
  });

  it('⭐ THE #1007 REGRESSION DIRECTION: armed, it leaves ORDINARY TRUE prose untouched', () => {
    const carrier = refusalCarrier();
    for (const trueText of [
      'Your model already contains 5 nodes.',
      'I have not run the analysis yet, so there are no results to show.',
      'You have two options on the canvas: Move to HubSpot and Stay as we are.',
    ]) {
      const out = applyBlockedSlotClaimGuard({
        assistantText: trueText,
        blockers: carrier.blockers,
        persistedGraph: FRESH_DRAFT,
      });
      expect(out.text).toBe(trueText);
      expect(out.changed).toBe(false);
    }
  });
});
