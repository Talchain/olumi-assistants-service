/**
 * ⭐ ONE READINESS TRUTH FOR A LEVEL GAP (Canonical consumer-parity probe, served CEE 62b1ba4, 28 Sep 2026).
 *
 * #2164 made a goal root with no status-quo level a factor-scoped `MISSING_FACTOR_LEVEL` issue whose ask is "What is X
 * today…?". On the served build the readiness route and the Agent said exactly that, but `analysis_state.readiness`
 * (the read route, the turn payload and every panel that reads it) re-derived the blocker from its wire `blocker_type`
 * (`missing_value` → `MISSING_OPTION_VALUE`) and re-minted the sentence: "Choose the missing effect value for X" —
 * a different question (an option's effect, not today's level) under a different code. The assessor's issue is the
 * authority; the wire blocker is its lossy projection, so a factor-only blocker the authority itemised takes the
 * authority's code and sentence, joined by identity (`factor_id`, no `option_id`).
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { analysisStateWireBlockers } from '../analysis-state-v1.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/served-level-gap-analysis-ready-62b1ba4.json', import.meta.url), 'utf8'));
const ready = fx.analysis_ready as unknown as { status: string; blockers: unknown[]; readiness_issues: unknown[] };
const blockers = () => analysisStateWireBlockers(ready as never, ready.status);
const factorOnly = (id: string) => blockers().filter((b) => b.factor_id === id && b.option_id === undefined);

describe('analysis_state carries the authority\'s level ask for a factor-only gap (served 62b1ba4)', () => {
  it('precondition: the served authority itemised both level gaps as factor-only MISSING_FACTOR_LEVEL', () => {
    const codes = (ready.readiness_issues as Array<{ code: string; option_id?: string; factor_id?: string }>)
      .filter((i) => i.option_id === undefined).map((i) => `${i.code}:${i.factor_id}`).sort();
    expect(codes).toEqual(['MISSING_FACTOR_LEVEL:fac_at_risk_account_retention', 'MISSING_FACTOR_LEVEL:fac_trial_to_pro_conversion']);
  });

  for (const id of ['fac_trial_to_pro_conversion', 'fac_at_risk_account_retention']) {
    it(`RED: ${id} is MISSING_FACTOR_LEVEL with the "today" ask, never "Choose the missing effect value"`, () => {
      const rows = factorOnly(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].code).toBe('MISSING_FACTOR_LEVEL');
      expect(rows[0].message).toMatch(/ today, before any option changes it\?/);
      expect(rows[0].message).not.toMatch(/missing effect value/);
    });
  }

  it('CONTROL: the option-scoped blockers keep their own code and sentence', () => {
    const scoped = blockers().filter((b) => b.option_id !== undefined).map((b) => `${b.code}:${b.option_id}:${b.factor_id}`).sort();
    expect(scoped).toEqual([
      'MISSING_OPTION_VALUE:d7984718:fac_trial_to_pro_conversion',
      'MISSING_OPTION_VALUE:e7128d22:fac_at_risk_account_retention',
    ]);
    for (const b of blockers().filter((x) => x.option_id !== undefined)) expect(b.message).toMatch(/needs a numeric value for option/);
  });

  it('CONTROL: no issue list → the wire blocker is mapped as before (no invented code)', () => {
    const bare = analysisStateWireBlockers({ ...ready, readiness_issues: [] } as never, ready.status);
    expect(bare.filter((b) => b.option_id === undefined).map((b) => b.code)).toEqual(['MISSING_OPTION_VALUE', 'MISSING_OPTION_VALUE']);
  });

  it('keeps the count: one wire row per stated blocker, nothing appended', () => {
    expect(blockers()).toHaveLength(ready.blockers.length);
  });
});
