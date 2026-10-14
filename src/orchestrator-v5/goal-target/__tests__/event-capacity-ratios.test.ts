/** `eventCapacityRatios` on Paul's persisted drafter answer (c1494f4d): each option's ratio through the stated capacity chain. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eventCapacityRatios } from '../event-by-date-model.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/paul-legacy-c1494f4d-raw-20261014.json', import.meta.url), 'utf8')) as { raw_text: string };
const draft = (): Rec => JSON.parse(FX.raw_text) as Rec;

describe('an option\'s capacity ratio through the brief\'s own product identity', () => {
  it('⭐ legacy 25% → 15% frees feature time 75% → 85% (the stated −1 per 1 link): r = 510/450; two more developers: r = 600/450', () => {
    const r = eventCapacityRatios(draft() as never);
    expect([...r.keys()]).toEqual([1, 2]);
    expect(r.get(1)).toEqual({ ratio: (6 * 85) / (6 * 75), capacity: 'Feature development capacity',
      factors: [{ label: 'Mid-weight developers', today: 6, withOption: 6 }, { label: 'Time on feature work', today: 75, withOption: 85 }],
      // The drafter's identity is Olumi's reading (not quoted from the brief); the 15% is Olumi's proposed setting.
      identity_stated: false, settings: [{ label: 'Time on legacy fixes', value: 15, unit: '% of development time', olumis: true }] });
    expect(r.get(2)!.ratio).toBeCloseTo(8 / 6, 12);
  });

  it('CONTRAST: an identity whose outcome does not reach the goal gives no ratio', () => {
    const d = draft();
    d.links = d.links.filter((l: Rec) => !(l.from === 'Feature development capacity' && l.to === 'Next feature launch deadline'));
    expect(eventCapacityRatios(d as never).size).toBe(0);
  });

  it('CONTRAST: a setting that is not absolute, or a factor with no stated baseline, gives no ratio (fail closed)', () => {
    const relative = draft();
    relative.options[1].interventions[0].value_kind = 'delta';
    expect(eventCapacityRatios(relative as never).has(1)).toBe(false);
    const noBaseline = draft();
    noBaseline.factors.find((f: Rec) => f.label === 'Time on feature work').baseline_known = false;
    expect(eventCapacityRatios(noBaseline as never).size).toBe(0);
  });
});
