/**
 * THIN CORE STRUCTURE FEEDBACK: only a withheld item the AI can fix by re-expressing what the model already holds comes back
 * to it, with how; a missing-information reason never does. SYNTHETIC wording (the served P04 shape, not its words).
 */
import { describe, expect, it } from 'vitest';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { mapLivingModel } from '../mapper.js';
import { structureFeedback } from '../structure.js';
import { KNOWN_ANSWER, OPTION_EFFECTS, RESTATED } from './fixtures.js';

const feedbackOf = (m: LivingModelT) => structureFeedback(m, mapLivingModel(m));
const reasons = (m: LivingModelT) => mapLivingModel(m).withheld.map((w) => [w.id, w.reason]);

describe('structure feedback: the mapper\'s verdict, as a fix the AI can make without a new figure', () => {
  it('⭐ P04 shape: each option→factor link comes back with its fix; the other withheld reasons do not', () => {
    expect(reasons(RESTATED)).toEqual(expect.arrayContaining([['a_level', 'link_endpoint_unknown'], ['b_level', 'link_endpoint_unknown'],
      ['level_w', 'exact_not_drawable'], ['w', 'chance_rests_on_withheld']]));
    const fb = feedbackOf(RESTATED);
    expect(fb.map((f) => [f.id, f.reason])).toEqual([['a_level', 'link_endpoint_unknown'], ['b_level', 'link_endpoint_unknown']]);
    expect(fb[0]!.fix).toContain('Option a\'s effect is linked to factor w_level');
    expect(fb[0]!.fix).toContain('link the option to w instead');
  });

  it('the re-expressed model (each option linked to the aim) gives no feedback, and reaches the exact sum', () => {
    expect(feedbackOf(OPTION_EFFECTS)).toEqual([]);
    expect(mapLivingModel(OPTION_EFFECTS).graph.nodes.find((n) => n.id === 'w')).toHaveProperty('nonlinear_identity');
  });

  it('control: the known-answer model gives no feedback', () => {
    expect(feedbackOf(KNOWN_ANSWER)).toEqual([]);
  });

  it.each<[string, (m: LivingModelT) => void, string]>([
    ['a factor\'s level unknown', (m) => { m.factors[0]!.value = null; }, 'factor_level_unknown'],
    ['a link\'s sign unknown', (m) => { m.links[0]!.effect.sign = null; }, 'link_sign_unknown'],
    ['a bare range on a link', (m) => { Object.assign(m.links[0]!.effect, { form: 'range', value: null, low: 40, high: 60 }); }, 'link_range_no_law'],
    ['no target', (m) => { m.aims[0]!.target = null; }, 'no_level_target'],
    ['an option\'s level unknown', (m) => { m.options[1]!.settings[0]!.value = null; }, 'setting_not_convertible'],
  ])('missing information is an ask for the person, never feedback: %s', (_, edit, reason) => {
    const m = structuredClone(KNOWN_ANSWER);
    edit(m);
    expect(reasons(m).map(([, r]) => r)).toContain(reason);
    expect(feedbackOf(m)).toEqual([]);
  });

  it('an option linked to the goal itself, waiting on the goal\'s level today, is written the right way: no feedback', () => {
    const m = structuredClone(OPTION_EFFECTS);
    m.aims[0]!.target!.current = null;
    expect(reasons(m)).toEqual(expect.arrayContaining([['a_w', 'link_endpoint_unknown'], ['b_w', 'link_endpoint_unknown']]));
    expect(feedbackOf(m)).toEqual([]);
  });

  it('a change is sent back only over what it writes: an encoding the saved model already withholds is not', () => {
    const fixed = structuredClone(RESTATED);
    fixed.links[1]!.effect.value = 20;
    expect(structureFeedback(fixed, mapLivingModel(fixed), mapLivingModel(RESTATED).withheld)).toEqual([]);
    expect(structureFeedback(RESTATED, mapLivingModel(RESTATED), mapLivingModel(OPTION_EFFECTS).withheld)).toHaveLength(2);
  });

  it('a link or a setting naming nothing in the model comes back with its fix', () => {
    const m = structuredClone(KNOWN_ANSWER);
    m.links.push({ ...m.links[0]!, id: 'ghost_g', from: 'ghost' });
    m.options[1]!.settings.push({ ...m.options[1]!.settings[0]!, factor_id: 'phantom' });
    expect(feedbackOf(m).map((f) => [f.id, f.reason])).toEqual([['push:phantom', 'setting_not_convertible'], ['ghost_g', 'link_endpoint_unknown']]);
  });
});
