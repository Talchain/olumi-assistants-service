/**
 * S4 TIME as a system: the supported time class is the code's own boundary (`goal-target/time-class.ts`).
 * The invariant pinned here: a detection can only WITHHOLD and say so. It never licenses, computes or adds a chance.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import fixture from '../../../../tests/fixtures/ceiling-stock-t3.json';
import { timeClassOf, unsupportedTimeSentence, type UnsupportedTimeKind } from '../time-class.js';
import { goalHorizonVerdict, withholdGoalFiguresForUntestedHorizon } from '../goal-horizon-verdict.js';
import { goalHorizonWithholdDetail } from '../goal-horizon-detail.js';
import { applyGoalHorizonEdit } from '../goal-horizon-write.js';
import { recogniseCeilingStock } from '../../agent-lane/ceiling-stock.js';
import { identityReadingWithinTimeClass } from '../../agent-lane/identity-reading.js';

type Rec = Record<string, any>;
const T3 = fixture.brief;
const ONSET_PHRASE = 'starting in month 3';

describe('the grammar: an onset verb beside a month reference, or a named seasonal / gradual shape', () => {
  it.each<[string, UnsupportedTimeKind, string]>([
    ['We could rent a second depot, starting in month 3, which lifts the ceiling by 600.', 'scheduled_start', 'starting in month 3'],
    ['The second depot starts from the third month.', 'scheduled_start', 'starts from the third month'],
    ['The new crew begins after 4 months.', 'scheduled_start', 'begins after 4 months'],
    ['The lift kicks in at month six.', 'scheduled_start', 'kicks in at month six'],
    ['The new price takes effect in month 2.', 'scheduled_start', 'takes effect in month 2'],
    ['The partner channel comes online 3 months in.', 'scheduled_start', 'comes online 3 months in'],
    ['Sign-ups begin in\nmonth 12.', 'scheduled_start', 'begin in month 12'],
    ['Demand is seasonal.', 'seasonal', 'seasonal'],
    ['Riders peak in the summer months.', 'seasonal', 'in the summer months'],
    ['Take-up rises each summer.', 'seasonal', 'each summer'],
    ['The depot is staffed every other month.', 'seasonal', 'every other month'],
    ['Sign-ups ramp up once the campaign is live.', 'gradual_build_up', 'ramp up'],
    ['We will phase in the new price.', 'gradual_build_up', 'phase in'],
    ['Membership gradually grows after launch.', 'gradual_build_up', 'gradually grows'],
    ['The change takes effect at the beginning of month 3.', 'scheduled_start', 'takes effect at the beginning of month 3'],
    ['The campaign starts in three months.', 'scheduled_start', 'starts in three months'],
    ['The new depot is available from month 2 onwards.', 'scheduled_start', 'from month 2 onwards'],
    ['Demand peaks each December.', 'seasonal', 'each December'],
    ['Demand varies over the seasons.', 'seasonal', 'over the seasons'],
    ['The lift increases gradually over six months.', 'gradual_build_up', 'increases gradually'],
    ['We gradually add capacity over six months.', 'gradual_build_up', 'gradually add'],
  ])('%s', (text, kind, words) => {
    expect(timeClassOf(text)).toEqual({ supported: false, shapes: [{ kind, words }] });
  });

  it('the served T3-shaped brief (the ceiling-stock fixture) is outside the class and quotes the user verbatim', () => {
    const shapes = timeClassOf(T3).shapes;
    expect(shapes).toEqual([{ kind: 'scheduled_start', words: ONSET_PHRASE }]);
    expect(T3).toContain(ONSET_PHRASE);
  });

  it.each([
    'We should review in month 3.',
    'We want to hit 500 within 12 months.',
    'Our bike-share scheme has 1,500 registered riders today and adds about 60 new riders a month.',
    'We start with 200 customers.',
    'Our project review starts in month 3.',
    'We would hold a review meeting starting in month 3.',
    'We are not seasonal: demand stays constant throughout the year.',
    "It isn't seasonal.",
    'We have no seasonal pattern.',
    'We will not phase in the new price; it applies in full immediately.',
    'Each March we hold our AGM.',
    'We would open for 4 Saturday sessions each quarter.',
    'Starting from 1,500 riders today, we add 60 a month.',
    'The project starts in 2027.',
    'Revenue starts at £10,000 a month.',
    'We begin in month 1 with 50 riders.',
    'It starts from the first month.',
    'We want to stay under that ceiling, without turning anyone away, over the next ten months.',
    '',
    '   ',
  ])('a brief inside the class is not refused: %j', text => {
    expect(timeClassOf(text)).toEqual({ supported: true, shapes: [] });
  });

  it('no brief is the supported class (an absent brief never withholds)', () => {
    for (const absent of [undefined, null]) expect(timeClassOf(absent)).toEqual({ supported: true, shapes: [] });
  });

  it('a full stop inside a month name does not split a shape across sentences, and shapes are listed as written', () => {
    const t = timeClassOf('Demand is seasonal. The crew begins after 2 months, then we phase in the new price.');
    expect(t.shapes.map(s => s.kind)).toEqual(['seasonal', 'scheduled_start', 'gradual_build_up']);
  });

  it('a corpus from outside this file: no recorded brief in the repo is refused except by a named, genuine timing phrase', () => {
    const briefs = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(path); continue; }
        if (!entry.name.endsWith('.json') || !/fixtures/.test(path)) continue;
        let parsed: unknown;
        try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
        const visit = (o: unknown): void => {
          if (Array.isArray(o)) { o.forEach(visit); return; }
          if (o === null || typeof o !== 'object') return;
          for (const [k, v] of Object.entries(o)) {
            if (['brief', 'brief_text', 'storedBrief'].includes(k) && typeof v === 'string' && v.length > 40) briefs.add(v);
            else visit(v);
          }
        };
        visit(parsed);
      }
    };
    walk(fileURLToPath(new URL('../../../../', import.meta.url)));
    // The corpus must be a real corpus (a zero-brief walk would pass vacuously): hundreds of briefs, and the positive control present.
    expect(briefs.size).toBeGreaterThan(150);
    expect(briefs.has(T3)).toBe(true);
    const refused = [...briefs].flatMap(b => timeClassOf(b).shapes.map(s => `${s.kind}:${s.words.toLowerCase()}`));
    expect([...new Set(refused)].sort()).toEqual(EXPECTED_CORPUS_REFUSALS);
  });
});

/** The corpus's one refusal is the T3 ceiling-stock brief itself (the positive control). "4 Saturday sessions each quarter" (r5-verified-probes) is a frequency, not a season, and is NOT refused. */
const EXPECTED_CORPUS_REFUSALS: string[] = ['scheduled_start:starting in month 3'];

describe('the sentence: the user\'s own words, one plain sentence, no em dash', () => {
  it.each<[UnsupportedTimeKind, string, string]>([
    ['scheduled_start', ONSET_PHRASE, "You said ‘starting in month 3’. Olumi can't yet model when a change starts, so it won't give a chance for month 10."],
    ['seasonal', 'seasonal', "You said ‘seasonal’. Olumi can't yet model how something changes by season, so it won't give a chance for month 10."],
    ['gradual_build_up', 'ramp up', "You said ‘ramp up’. Olumi can't yet model a gradual build-up, so it won't give a chance for month 10."],
  ])('%s', (kind, words, expected) => {
    expect(unsupportedTimeSentence({ kind, words }, 10)).toBe(expected);
  });
});

// ── the invariant: a detection can only withhold and say so ─────────────────────────────────────────────────────
const goalNode = (extra: Rec = {}): Rec => ({ id: 'g', kind: 'goal', label: 'Riders served', goal_threshold_unit: 'riders', goal_horizon_months: 9, ...extra });
const accumulationGraph = (): Rec => ({ nodes: [
  goalNode({ nonlinear_identity: { operation: 'product', factor_ids: ['at_h', 'price'], stated_in_brief: true } }),
  { id: 'at_h', kind: 'outcome', nonlinear_identity: { operation: 'accumulation', factor_ids: ['today', 'leave', 'sign_up'],
    horizon_months: 9, rate_scale: 0.01, stated_in_brief: true } },
  { id: 'today', kind: 'factor', label: 'Riders today', observed_state: { raw_value: 300, source: 'brief_extraction' } },
  { id: 'leave', kind: 'factor', label: 'Monthly leave share', observed_state: { raw_value: 2, source: 'brief_extraction' } },
  { id: 'sign_up', kind: 'factor', label: 'Sign-ups a month', observed_state: { raw_value: 40, source: 'brief_extraction' } },
  { id: 'price', kind: 'factor', label: 'Price', observed_state: { raw_value: 5 } },
  { id: 'a', kind: 'option', label: 'Rent a second depot' }, { id: 'b', kind: 'option', label: 'Add a Sunday crew' },
], edges: [] });
const bareGraph = (): Rec => ({ nodes: [goalNode(), { id: 'a', kind: 'option', label: 'Rent a second depot' }, { id: 'b', kind: 'option', label: 'Add a Sunday crew' }], edges: [] });
const noMonthGraph = (): Rec => ({ nodes: [goalNode({ goal_horizon_months: undefined }),
  { id: 'a', kind: 'option', label: 'Rent a second depot' }, { id: 'b', kind: 'option', label: 'Add a Sunday crew' }], edges: [] });
// The envelope the Run gate receives (`run-analysis.ts`): the enrichment itself, option_comparison at its top level.
const response = (): Rec => ({ option_comparison: [
  { option_id: 'a', probability_of_goal: 0.62, win_probability: 0.7 }, { option_id: 'b', probability_of_goal: 0.41, win_probability: 0.3 }],
  // This Run's evaluation of the declared product and accumulation carriers: what makes the verdict `computed_at_h` for the carrier graph.
  identity_evaluations: [{ node_id: 'g', evaluated: true, operation: 'product', factor_ids: ['at_h', 'price'] },
    { node_id: 'at_h', evaluated: true, operation: 'accumulation', factor_ids: ['today', 'leave', 'sign_up'], horizon_months: 9 }],
  inference_warnings: [] });
// Each option's goal probability as the response carries it (absent / null = no figure), so a retained value is compared by VALUE and id.
const figureMap = (r: unknown): Record<string, number> => Object.fromEntries(((r as Rec).option_comparison ?? [])
  .filter((o: Rec) => typeof o.probability_of_goal === 'number').map((o: Rec) => [o.option_id, o.probability_of_goal]));
const figures = (r: unknown): number => Object.keys(figureMap(r)).length;
const WITHHELD = 'GOAL_FIGURES_HORIZON_NOT_TESTED';
const warningOf = (r: Rec): Rec | undefined => (r.inference_warnings ?? []).find((w: Rec) => w.code === WITHHELD);

describe('a detection can only WITHHOLD and say so', () => {
  const states: Array<[string, () => Rec, string]> = [
    ['the carrier computed month H', accumulationGraph, 'computed_at_h'],
    ['no carrier for the held month', bareGraph, 'withhold'],
    ['no held month at all', noMonthGraph, 'no_horizon'],
  ];
  it.each(states)('%s: the verdict this fixture stands for', (_name, graph, verdict) => {
    expect(goalHorizonVerdict(graph(), response())).toBe(verdict);
  });

  it('timeClassOf returns only {supported, shapes}: nothing it carries can size, credit or license anything', () => {
    const t = timeClassOf(T3);
    expect(Object.keys(t).sort()).toEqual(['shapes', 'supported']);
    for (const s of t.shapes) expect(Object.keys(s).sort()).toEqual(['kind', 'words']);
  });

  it('computed at H + a stated onset: the chance is withheld and the user\'s own words are said (never a licensed or added figure)', () => {
    const before = response();
    expect(figures(withholdGoalFiguresForUntestedHorizon(structuredClone(before), accumulationGraph(), 'We could rent a depot, starting in month 3.'))).toBe(0);
    const out = withholdGoalFiguresForUntestedHorizon(structuredClone(before), accumulationGraph(), 'We could rent a depot, starting in month 3.') as Rec;
    expect(warningOf(out)?.say).toBe("You said ‘starting in month 3’. Olumi can't yet model when a change starts, so it won't give a chance for month 9.");
    expect(warningOf(out)?.message).toBe(warningOf(out)?.say);
  });

  it('CONTRAST computed at H, same graph and response, a brief inside the class: bytes unchanged (same object)', () => {
    const before = response();
    for (const brief of ['We should review in month 3.', 'We want to stay under the ceiling over the next ten months.', '', undefined, null]) {
      expect(withholdGoalFiguresForUntestedHorizon(before, accumulationGraph(), brief)).toBe(before);
    }
    expect(withholdGoalFiguresForUntestedHorizon(before, accumulationGraph())).toBe(before);
  });

  it('no held month + a stated onset: nothing is withheld and nothing is added (no detection can make a chance appear or a warning invent a month)', () => {
    const before = response();
    expect(withholdGoalFiguresForUntestedHorizon(before, noMonthGraph(), 'The crew begins after 2 months.')).toBe(before);
  });

  it('no carrier + a stated onset: exactly what was withheld before is withheld; only the sentence is the user\'s own words', () => {
    const plain = withholdGoalFiguresForUntestedHorizon(structuredClone(response()), bareGraph()) as Rec;
    const said = withholdGoalFiguresForUntestedHorizon(structuredClone(response()), bareGraph(), 'The crew begins after 2 months.') as Rec;
    expect(figures(plain)).toBe(0);
    expect(figures(said)).toBe(0);
    const bytes = (r: Rec): string => JSON.stringify(r).replaceAll(warningOf(r)!.say, 'SAY');
    expect(bytes(said)).toBe(bytes(plain));
    expect(warningOf(said)?.say).toBe("You said ‘begins after 2 months’. Olumi can't yet model when a change starts, so it won't give a chance for month 9.");
  });

  it('MONOTONE: over every (state, brief) pair a shape-bearing brief never leaves a figure the same state without it did not carry, and never a different value', () => {
    const briefs = [T3, 'Demand is seasonal.', 'Sign-ups ramp up.', 'We should review in month 3.', undefined];
    let pairs = 0;
    for (const [name, graph] of states) {
      const without = figureMap(withholdGoalFiguresForUntestedHorizon(structuredClone(response()), graph()));
      for (const brief of briefs) {
        const withBrief = figureMap(withholdGoalFiguresForUntestedHorizon(structuredClone(response()), graph(), brief));
        for (const [id, value] of Object.entries(withBrief)) expect(without[id], `${name} ${brief} ${id}`).toBe(value);
        pairs += 1;
      }
    }
    expect(pairs).toBe(states.length * briefs.length);
    // Non-vacuous: the computed state really carries two figures without a shape, and none with one.
    expect(Object.keys(figureMap(withholdGoalFiguresForUntestedHorizon(structuredClone(response()), accumulationGraph())))).toEqual(['a', 'b']);
    expect(figureMap(withholdGoalFiguresForUntestedHorizon(structuredClone(response()), accumulationGraph(), T3))).toEqual({});
  });

  it('the horizon detail names the stated shape only when a month is held, else the generic or no sentence', () => {
    expect(goalHorizonWithholdDetail(bareGraph(), 'The crew begins after 2 months.')).toContain('You said ‘begins after 2 months’.');
    expect(goalHorizonWithholdDetail(bareGraph())).toBe("Your goal is for month 9, and this model only has today's numbers.");
    expect(goalHorizonWithholdDetail(noMonthGraph(), 'The crew begins after 2 months.')).toBeNull();
  });
});

describe('the same boundary at the card sites: a refused brief is offered no ceiling or identity reading', () => {
  const held = (): Rec => {
    const goal = fixture.graph.nodes.find((n: Rec) => n.kind === 'goal') as Rec;
    const result = applyGoalHorizonEdit(fixture.graph as never, { goal_id: goal.id, deadline: '2027-08-10', expected_deadline: null,
      reference_date: '2026-10-10', stated_months: 10 });
    if (result.kind !== 'mutated') throw new Error(JSON.stringify(result));
    return result.mutatedGraph as Rec;
  };
  const withoutOnset = T3.replace(`, ${ONSET_PHRASE},`, ',');

  it('CONTRAST (positive control): the same fixture with the onset removed IS recognised, so the null below is the boundary, not the fixture', () => {
    expect(withoutOnset).not.toContain(ONSET_PHRASE);
    expect(recogniseCeilingStock(held(), withoutOnset)).not.toBeNull();
    expect(identityReadingWithinTimeClass(held(), withoutOnset)).not.toBeNull();
  });
  it('the T3 brief with its month-3 start: no ceiling-stock recognition and no identity reading', () => {
    expect(recogniseCeilingStock(held(), T3)).toBeNull();
    expect(identityReadingWithinTimeClass(held(), T3)).toBeNull();
  });
  it('"review in month 3" is not an onset: the reading is offered exactly as before', () => {
    const reviewed = T3.replace(ONSET_PHRASE, 'with a review in month 3');
    expect(timeClassOf(reviewed).supported).toBe(true);
    expect(recogniseCeilingStock(held(), reviewed)).not.toBeNull();
    expect(recogniseCeilingStock(held(), reviewed)).toEqual(recogniseCeilingStock(held(), withoutOnset));
  });
});
