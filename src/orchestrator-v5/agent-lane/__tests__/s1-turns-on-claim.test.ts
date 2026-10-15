/**
 * ⭐ Science table row T11 (AIE 6180618773; C5) on served marketing, CEE 7f5659fd, turn 10 ("What would most strengthen this
 * model?"): "How much does campaign plan quality really change conversion rate? The comparison turns on it." beside a Run whose
 * own explanation says "Sensitivity has not been measured", under "The comparison rests on a link nobody has sized yet." and
 * "Until it is sized, Olumi can't compare the options on your goal." Each claimed more than THIS Run established.
 * For an unsized link the question is the AIE's exact words, the why is the AIE's path sentence (only with the goal it names),
 * and the comparison is said to turn on the link only when THIS Run measured that. Two briefs: marketing and served D1.
 */
import { describe, expect, it } from 'vitest';
import { renderCopy, S1_TURNS_ON_CLAUSE } from '../guidance/render.js';
import type { GuidanceSignals } from '../guidance/types.js';

const BRIEFS = [
  { name: 'marketing 7f5659fd', link: { link_id: 'campaign_plan_quality->conversion_rate', from_label: 'Campaign plan quality', to_label: 'Conversion rate',
    link_sizing: 'placeholder' as const, option_ids: ['hire_marketing_manager'], goal_distance: 1 }, goal: 'Conversion rate', from: 'campaign plan quality', to: 'conversion rate' },
  { name: 'served D1', link: { link_id: 'sprint_capacity_for_ai_reporting->ai_reporting_module_availability', from_label: 'Sprint capacity for AI reporting',
    to_label: 'AI reporting module availability', link_sizing: 'placeholder' as const, option_ids: ['o1'], goal_distance: 1 }, goal: 'Quarterly revenue',
    from: 'sprint capacity for AI reporting', to: 'AI reporting module availability' },
];

describe.each(BRIEFS)('T11 S1 on $name: the AIE\'s words, and a sensitivity claim only where THIS Run measured it', ({ link, goal, from, to }) => {
  const S1 = { policy_id: 'RC-STRENGTHEN-ITEM', variant: 'S1', item: link.link_id } as const;
  const signals = (sensitivity: GuidanceSignals['run.decision_sensitivity'], goalLabel: string | null = goal): GuidanceSignals =>
    ({ 'turn.request': 'turn', 'model.goal_path_links': [link], 'model.placeholder_goal_links': [link.link_id], 'model.goal_label': goalLabel,
      ...(sensitivity === undefined ? {} : { 'run.decision_sensitivity': sensitivity }) }) as GuidanceSignals;
  const ASKS = `How much does ${from} change ${to}? Olumi has not yet established a size for this link.`;

  it('RED (served marketing shape): sensitivity not measured → the AIE\'s exact question, title and why; no claim the comparison turns on it', () => {
    for (const s of [{ status: 'not_measured' as const }, { status: 'none_measurable' as const }, { status: 'pending' as const }, undefined]) {
      const copy = renderCopy(S1, signals(s));
      expect(copy.question).toBe(`${ASKS} This Run did not measure its influence on the comparison.`);
      expect(copy.title).toBe('A link on the path to your goal has no size yet.');
      // Labels mid-sentence are lower-cased by the renderer's own rule (`midSentence`).
      expect(copy.why).toBe(`This link connects ${from} to ${to} on the model's path to ${goal.toLowerCase()}; its effect remains a provisional assumption.`);
      expect(`${copy.title} ${copy.why} ${copy.question}`).not.toMatch(/turns on it|rests on|can't compare|really change/);
    }
  });

  it('CONTRAST: with no goal label, the path sentence (which names the goal) is not said', () => {
    expect(renderCopy(S1, signals({ status: 'not_measured' }, null)).why).toBeNull();
  });

  it('CONTRAST: THIS Run measured sensitivity and ranks the link\'s source factor first → it measured the influence, and says the comparison turns on it', () => {
    const fromId = link.link_id.slice(0, link.link_id.indexOf('->'));
    const copy = renderCopy(S1, signals({ status: 'measured', most_sensitive: { factor_id: fromId, label: link.from_label } }));
    expect(copy.question).toBe(`${ASKS}${S1_TURNS_ON_CLAUSE}`);
  });

  it('CONTRAST: measured, but another factor (or the link\'s target) is most sensitive → no claim either way about its influence', () => {
    const toId = link.link_id.slice(link.link_id.indexOf('->') + 2);
    for (const factor_id of ['budget', toId]) {
      const copy = renderCopy(S1, signals({ status: 'measured', most_sensitive: { factor_id, label: factor_id } }));
      expect(copy.question).toBe(ASKS);
    }
  });
});
