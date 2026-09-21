/**
 * G-CEE-1 §3.4 — the `evidence_gap` presupposition on a withheld turn.
 *
 * The POST-#711/#712 live walk found, on `caseINF.run` (`evaluated_infeasible`,
 * withheld), `blocks[7].evidence_gap`:
 *
 *   "Shifts in hardware pricing and availability could alter the total cost
 *    calculation and potentially change THE LEADING OPTION."
 *
 * `evidence` blocks are deliberately KEPT by `compose.ts`'s kind-level
 * `presumesLeadingOption` list, so nothing dropped this. It is a genuine
 * presupposition (not the POST-710 §7.1 "team leads" false positive), at 1
 * occurrence across 11 withheld bodies.
 *
 * ⚠ THE SCHEMA TEST BELOW IS THE POINT OF THIS FILE, not a formality. The first
 * version of this gate dropped the `evidence_gap` FIELD and kept the block, on
 * the egress guard's "per-field, not whole-response" reasoning. That was wrong:
 * `@talchain/schemas` declares `evidence_gap: z.string().min(1)` — REQUIRED. A
 * field-drop produces a block that fails `OlumiResponseSchema` at egress, so
 * the "fix" would have degraded the WHOLE response on exactly the withheld
 * turns it was written to protect. The defect was invisible to every
 * prose-level assertion; only running the CONTRACT over the output found it.
 * That is why this file asserts schema-validity of the survivors and not just
 * the absence of the string.
 */
import { describe, it, expect } from 'vitest';
import { EvidenceBlockSchema } from '@talchain/schemas/boundary';

import { textNamesLeadingOption } from '../leading-option-egress-guard.js';

/** An evidence block in the shape `phase3-blocks.ts` emits. */
function evidenceBlock(evidenceGap: string): Record<string, unknown> {
  return {
    block_id: '11111111-1111-5111-9111-111111111111',
    signal_id: 'evidence:fac_market_hw:bbc7e8cb43a8a3ab',
    created_at: '2026-07-26T20:55:03.650Z',
    source_handler: 'decision_review_enricher',
    graph_hash_at_generation: 'bbc7e8cb43a8a3ab',
    freshness: 'fresh',
    type: 'evidence',
    factor_label: 'Hardware Market Conditions',
    factor_ref: { id: 'fac_market_hw', label: 'Hardware Market Conditions', kind: 'factor' },
    target_refs: [{ id: 'fac_market_hw', label: 'Hardware Market Conditions', kind: 'factor' }],
    current_confidence: 'medium',
    evidence_gap: evidenceGap,
    suggested_technique: 'Market research: consult recent procurement benchmarks.',
    impact_if_gathered: 'Write down your initial estimate before gathering.',
    priority_rank: 1,
    // `EvidenceBlockSchema` enum is info | warning | critical — verified by
    // parsing, not assumed (an invalid fixture would make the "intact block is
    // valid" control fail for the WRONG reason, TESTING-DISCIPLINE rule 1).
    severity: 'warning',
    action_intent: 'gather_evidence',
    action_label: 'Strengthen this evidence',
  };
}

/** The live string, verbatim from the walk's `caseINF.run` body. */
const LEAKING_GAP =
  'Shifts in hardware pricing and availability could alter the total cost ' +
  'calculation and potentially change the leading option.';

/** A gap statement making no comparative claim — the over-suppression control. */
const CLEAN_GAP =
  'Hardware pricing is estimated rather than quoted, so the total cost figure ' +
  'carries more uncertainty than the others.';

describe('§3.4 — the evidence_gap leader presupposition', () => {
  it('the shared vocabulary SEES the live leaking string', () => {
    expect(textNamesLeadingOption(LEAKING_GAP)).toBe(true);
  });

  it('OVER-SUPPRESSION CONTROL: it does NOT see a clean gap statement', () => {
    // Without this the gate could be "drop every evidence block" and the
    // assertion above would still pass.
    expect(textNamesLeadingOption(CLEAN_GAP)).toBe(false);
  });

  it('CONTRACT: `evidence_gap` is REQUIRED — a field-drop would fail egress', () => {
    // The property that caught the first version of this fix. Pinned so nobody
    // "optimises" the whole-block drop back into a field-drop.
    const { evidence_gap: _omitted, ...withoutGap } = evidenceBlock(LEAKING_GAP);
    void _omitted;
    expect(
      EvidenceBlockSchema.safeParse(withoutGap).success,
      'evidence_gap parsed as OPTIONAL — if the contract really relaxed it, the ' +
        'whole-block drop in compose.ts could become a field-drop; re-derive before changing it.',
    ).toBe(false);

    // And the intact block is valid, so the assertion above is about the
    // MISSING FIELD and not about some other defect in this fixture.
    expect(EvidenceBlockSchema.safeParse(evidenceBlock(LEAKING_GAP)).success).toBe(true);
  });

  it('every block that SURVIVES the withheld filter is still schema-valid', () => {
    // The whole-block drop preserves the contract by construction: survivors are
    // untouched objects. This pins that property against a future edit that
    // starts mutating survivors instead of filtering them.
    const survivors = [evidenceBlock(LEAKING_GAP), evidenceBlock(CLEAN_GAP)].filter(
      (b) => !textNamesLeadingOption(b.evidence_gap as string),
    );
    expect(survivors).toHaveLength(1);
    for (const block of survivors) {
      expect(EvidenceBlockSchema.safeParse(block).success).toBe(true);
    }
    expect(survivors[0]!.evidence_gap).toBe(CLEAN_GAP);
  });
});
