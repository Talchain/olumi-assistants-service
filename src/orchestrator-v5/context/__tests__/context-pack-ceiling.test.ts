/**
 * Context/Memory V5 — defect 3: the whole-pack context ceiling's POLICY rows.
 *
 * Deletion 8: the eight behavioural rows that drove `assembleContextPack` /
 * `enforceContextPackCeiling` (oldest-first trim, retention floor, never-trimmed
 * sections, `v5.context_truncation`) were removed with
 * `context-pack-assembler.ts`, which no served lane calls. What remains pins
 * the policy declaration in `context-policy.ts`, which is still exported.
 */

import { describe,expect,it } from 'vitest';

import {
CONTEXT_PACK_CEILING_CUT_ORDER,
CONTEXT_POLICY,
} from '../context-policy.js';

// ⚠ Deletion 8: the cut these rows describe was EXECUTED by the deleted
// assembler's `enforceContextPackCeiling`. The policy still declares it; these
// rows pin that declaration, not a live cut.
describe('whole-pack context ceiling — the declared cut order is the EXECUTED one', () => {
  it('declares conversation as a ceiling-cut section', () => {
    expect(CONTEXT_PACK_CEILING_CUT_ORDER).toContain('conversation');
  });

  it('the policy row DERIVES its cut_rank from that same const (no hand-written mirror)', () => {
    const conversation = CONTEXT_POLICY.coach_converse.sections.find((s) => s.name === 'conversation');
    expect(conversation).toBeDefined();
    expect(conversation!.cut_rank).toBe(
      (CONTEXT_PACK_CEILING_CUT_ORDER as readonly string[]).indexOf('conversation'),
    );
  });

  it('every section NOT in the cut order still declares cut_rank null', () => {
    for (const section of CONTEXT_POLICY.coach_converse.sections) {
      if ((CONTEXT_PACK_CEILING_CUT_ORDER as readonly string[]).includes(section.name)) continue;
      expect(section.cut_rank, `${section.name} is not a cut section`).toBeNull();
    }
  });

  it('the conversation row declares the cut it now HAS (no longer telemetry_only)', () => {
    const conversation = CONTEXT_POLICY.coach_converse.sections.find((s) => s.name === 'conversation');
    // The cut is driven by the WHOLE-PACK total, not by this section's own
    // char_budget — `enforced` would be a false guarantee (nothing cuts the
    // conversation at 34,000 chars). The executor that made `telemetry_only`
    // false (`enforceContextPackCeiling`) went with the assembler in deletion 8.
    expect(conversation!.enforcement).toBe('enforced_by_total');
    expect(CONTEXT_POLICY.coach_converse.total_char_budget).not.toBeNull();
  });
});
