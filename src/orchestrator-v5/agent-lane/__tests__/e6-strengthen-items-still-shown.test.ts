/**
 * Batch R round 2 (independent check of #2970 @ 964b4b8a, recovery/bR/check-R/CHECK-R.md, BLOCKING P1).
 *
 * E6's item-level rule (`shownItemUnchanged`) hid the WHOLE Strengthen policy whenever any previously shown item was
 * unchanged. It therefore hid two rows that staging's selector shows: a previously shown item whose value has since
 * changed, and a newly measured S2 factor. That rule is removed. The rule that stays is per item: a shown (offered)
 * item is not said again on the same state (`SETTLED` gains `offered`), and a cooled item falls through to the next
 * candidate in pick order (`selection.cooldown_scope`).
 *
 * This is the checker's reproduction, in both domains. Rows are bound by identity: policy, variant, item and state key.
 */
import { describe, expect, it } from 'vitest';
import { entryKey, selectGuidance } from '../guidance/select.js';
import type { GuidanceSignals, GuidanceState } from '../guidance/types.js';

const STRENGTHEN = 'RC-STRENGTHEN-ITEM';

function signalsFor(domain: 'hiring' | 'marketing') {
  const a = `${domain}_a`; const b = `${domain}_b`;
  const base = {
    'turn.request': 'turn', 'open.decision_point': false,
    'model.goal_path_links': [
      { link_id: a, from_label: domain === 'hiring' ? 'Team capacity' : 'Ad spend',
        to_label: domain === 'hiring' ? 'Launch delivery' : 'Qualified leads',
        link_sizing: 'olumi_estimate', goal_distance: 1, option_ids: [], value_hash: 'original_a' },
      { link_id: b, from_label: domain === 'hiring' ? 'Onboarding' : 'Partner events',
        to_label: domain === 'hiring' ? 'Launch delivery' : 'Qualified leads',
        link_sizing: 'olumi_estimate', goal_distance: 2, option_ids: [], value_hash: 'original_b' },
    ],
    'model.goal_path_factors': [], 'model.placeholder_goal_links': [],
    'run.decision_sensitivity': { status: 'not_measured' },
  };
  return { a, b, base };
}
const asSignals = (v: unknown) => v as GuidanceSignals;
const offered = (item: string, state_key_hash: string) =>
  ({ [entryKey(STRENGTHEN, item)]: { status: 'offered', state_key_hash } }) as unknown as GuidanceState;

describe('Strengthen items shown before still appear when they change, and a newly measured S2 factor appears (as on staging)', () => {
  for (const domain of ['hiring', 'marketing'] as const) {
    it(`${domain}: shown A, then A removed and B shown, then A restored with a CHANGED value: A appears again under its new key`, () => {
      const { a, b, base } = signalsFor(domain);
      const rowA = selectGuidance(asSignals(base), {}).slot1;
      expect([rowA?.policy_id, rowA?.item], 'POSITIVE CONTROL: A is the first Strengthen item').toEqual([STRENGTHEN, a]);
      const histA = offered(a, rowA!.state_key_hash);
      const removed = structuredClone(base);
      removed['model.goal_path_links'] = removed['model.goal_path_links'].filter(l => l.link_id !== a);
      const rowB = selectGuidance(asSignals(removed), histA).slot1;
      expect([rowB?.policy_id, rowB?.item]).toEqual([STRENGTHEN, b]);
      const histAB = { ...histA, ...offered(b, rowB!.state_key_hash) } as GuidanceState;
      const changed = structuredClone(base);
      changed['model.goal_path_links'][0]!.value_hash = 'new_a';
      const again = selectGuidance(asSignals(changed), histAB);
      expect([again.slot1?.policy_id, again.slot1?.item], JSON.stringify(again.suppressed)).toEqual([STRENGTHEN, a]);
      expect(again.slot1!.state_key_hash, 'a new state key, not the shown one').not.toBe(rowA!.state_key_hash);
      // CONTRAST (said once per state): on the UNCHANGED state, neither shown item is said again.
      expect(selectGuidance(asSignals(base), histAB).slot1?.policy_id).not.toBe(STRENGTHEN);
    });

    it(`${domain}: shown S3L item A, then a newly measured S2 factor: the S2 factor appears`, () => {
      const { a, base } = signalsFor(domain);
      const rowA = selectGuidance(asSignals(base), {}).slot1;
      expect([rowA?.policy_id, rowA?.item]).toEqual([STRENGTHEN, a]);
      const histA = offered(a, rowA!.state_key_hash);
      const factor = `${domain}_sensitive`;
      const measured = {
        ...structuredClone(base),
        'model.goal_path_factors': [{ factor_id: factor, label: domain === 'hiring' ? 'Time to productivity' : 'Lead conversion',
          value_authorship: 'olumi_estimate', goal_distance: 1, value_hash: 'sensitive' }],
        'run.decision_sensitivity': { status: 'measured', most_sensitive: { factor_id: factor, label: 'Sensitivity', range: 'olumi_assumed' } },
      };
      const next = selectGuidance(asSignals(measured), histA);
      expect([next.slot1?.policy_id, next.slot1?.variant, next.slot1?.item], JSON.stringify(next.suppressed))
        .toEqual([STRENGTHEN, 'S2', factor]);
    });

    it(`${domain}: CONTRAST: a shown item is not said again on the same state; the next item in pick order is`, () => {
      const { a, b, base } = signalsFor(domain);
      const rowA = selectGuidance(asSignals(base), {}).slot1!;
      const next = selectGuidance(asSignals(base), offered(a, rowA.state_key_hash)).slot1;
      expect([next?.policy_id, next?.item]).toEqual([STRENGTHEN, b]);
    });
  }
});
