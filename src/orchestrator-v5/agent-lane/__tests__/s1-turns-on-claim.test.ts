/**
 * ⭐ System 4 row 11 (served marketing, CEE 7f5659fd, turn 10, "What would most strengthen this model?"):
 * "How much does campaign plan quality really change conversion rate? The comparison turns on it." beside a Run whose own
 * explanation says "Sensitivity has not been measured". The clause is a sensitivity claim: it is said ONLY when THIS Run
 * measured decision sensitivity and ranks the link's source factor as its most sensitive driver.
 */
import { describe, expect, it } from 'vitest';
import { renderCopy, S1_TURNS_ON_CLAUSE } from '../guidance/render.js';
import type { GuidanceSignals } from '../guidance/types.js';

const LINK = { link_id: 'campaign_plan_quality->conversion_rate', from_label: 'Campaign plan quality', to_label: 'Conversion rate',
  link_sizing: 'placeholder' as const, option_ids: ['hire_marketing_manager'], goal_distance: 1 };
const S1 = { policy_id: 'RC-STRENGTHEN-ITEM', variant: 'S1', item: LINK.link_id } as const;
const signals = (sensitivity: GuidanceSignals['run.decision_sensitivity']): GuidanceSignals =>
  ({ 'turn.request': 'turn', 'model.goal_path_links': [LINK], 'model.placeholder_goal_links': [LINK.link_id],
    ...(sensitivity === undefined ? {} : { 'run.decision_sensitivity': sensitivity }) }) as GuidanceSignals;
const QUESTION = 'How much does campaign plan quality really change conversion rate?';

describe('RC-STRENGTHEN-ITEM S1 claims the comparison turns on a link only when THIS Run measured that', () => {
  it('RED (served marketing shape): sensitivity not measured → the question alone, no "turns on it" claim', () => {
    for (const s of [{ status: 'not_measured' as const }, { status: 'none_measurable' as const }, { status: 'pending' as const }, undefined]) {
      const copy = renderCopy(S1, signals(s));
      expect(copy.question).toBe(QUESTION);
      expect(copy.title).toBe('The comparison rests on a link nobody has sized yet.');
    }
  });

  it('CONTRAST: THIS Run measured sensitivity and ranks the link\'s source factor first → the clause is kept', () => {
    const copy = renderCopy(S1, signals({ status: 'measured', most_sensitive: { factor_id: 'campaign_plan_quality', label: 'Campaign plan quality' } }));
    expect(copy.question).toBe(`${QUESTION}${S1_TURNS_ON_CLAUSE}`);
  });

  it('CONTRAST: measured, but another factor (or the link\'s target) is the most sensitive → no claim about this link', () => {
    for (const factor_id of ['budget', 'conversion_rate']) {
      const copy = renderCopy(S1, signals({ status: 'measured', most_sensitive: { factor_id, label: factor_id } }));
      expect(copy.question).toBe(QUESTION);
    }
  });
});
