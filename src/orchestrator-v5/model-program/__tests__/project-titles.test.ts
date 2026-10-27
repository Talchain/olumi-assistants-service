/**
 * SHORT TITLES AND COACHING QUESTIONS (Paul, approved 27 Oct 2026). The drafter now writes a short title for the situation
 * and Olumi's coaching questions (at most three), and each goal, limit and risk label is a short title, the person's words
 * staying in its quote. The projection draws them:
 *  1. the question card's label is the title, the question beneath it as its description; a model saved before titles draws
 *     its question as the label, exactly as before (Paul's saved hiring model);
 *  2. Olumi's coaching questions ride on the question card, at most the three the first screen shows; none, no field;
 *  6. a goal card's description is the person's own words (its quote); Olumi's working aim has none. Limit cards and risks
 *     keep the figure sentence their description already holds.
 * Mutants (each RED on its row): the label back to the question; no description; no coaching_questions or no cap of three;
 * no goal description. Expectations are written by hand from the fixtures (synthetic club; Paul's saved hiring model).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CanonicalModel, withDeclaredTiming, type CanonicalModelT } from '../canonical.js';
import { compile } from '../compile.js';
import { DECISION_NODE_ID, project } from '../project.js';
import { at, club, CLUB_BRIEF } from '../../model-program-turn/__tests__/bakery.fixture.js';

type Rec = Record<string, any>;
const projected = (m: CanonicalModelT, brief: string) => project(m, compile(m, { sourceText: brief }), { brief });
const nodeOf = (p: ReturnType<typeof project>, id: string) => (p.graph.nodes as Rec[]).find((n) => n.id === id)!;
const paul = () => {
  const s = JSON.parse(readFileSync(new URL('../../model-program-turn/__tests__/hiring-paul-1027.saved.json', import.meta.url), 'utf8')) as { brief: string; canonical: unknown };
  return { brief: s.brief, model: CanonicalModel.parse(withDeclaredTiming(s.canonical)) };
};
const COACHING = [
  'What would 340 members let the club do that it cannot do now?',
  'What else could bring in more joins besides a promotion?',
  'How sure are you that 10 leave each month, whatever you do?',
  'Which members would a promotion bring in?',
];
const titled = (): CanonicalModelT => ({ ...club(), title: 'Promotion or carry on?', coaching_questions: [...COACHING] });

describe('1 · the question card is named by the short title, the question beneath it', () => {
  it('club: label is the title, description the question', () => {
    const card = nodeOf(projected(titled(), CLUB_BRIEF), DECISION_NODE_ID);
    expect([card.kind, card.label, card.description]).toEqual(['decision', 'Promotion or carry on?', 'Should the club run a promotion?']);
  });

  it('contrast: Paul\'s hiring model, saved before titles, opens with title null and draws its question as the label, with no description or coaching questions', () => {
    const { brief, model } = paul();
    expect([model.title, model.coaching_questions]).toEqual([null, []]);
    expect(nodeOf(projected(model, brief), DECISION_NODE_ID)).toEqual({ id: DECISION_NODE_ID, kind: 'decision', label: model.question });
  });
});

describe('2 · Olumi\'s coaching questions ride on the question card', () => {
  it('club: the first three, in order; none given, no field', () => {
    expect(nodeOf(projected(titled(), CLUB_BRIEF), DECISION_NODE_ID).coaching_questions).toEqual(COACHING.slice(0, 3));
    expect(nodeOf(projected({ ...titled(), coaching_questions: [] }, CLUB_BRIEF), DECISION_NODE_ID)).not.toHaveProperty('coaching_questions');
  });
});

describe('6 · a goal card holds its short title, and the person\'s own words beneath it', () => {
  it('Paul\'s hiring goal and the club\'s goal: description is the quote, exactly', () => {
    const { brief, model } = paul();
    expect(nodeOf(projected(model, brief), 'increase_productivity')).toMatchObject({ label: 'Increase productivity by at least 10%', description: 'increase productivity by at least 10%' });
    expect(nodeOf(projected(titled(), CLUB_BRIEF), 'reach_340')).toMatchObject({ label: 'Reach 340 members within three months', description: 'reach 340 members within three months' });
  });

  it('contrast: Olumi\'s working aim has no quote, so no description', () => {
    const m = titled();
    m.goals = [{ ...m.goals[0]!, label: 'Members in three months', author: 'olumi', quote: null, ...at }];
    expect(nodeOf(projected(m, CLUB_BRIEF), 'reach_340')).not.toHaveProperty('description');
  });

  it('contrast: a limit card keeps its figure sentence as its description, beside the person\'s words as its source quote', () => {
    const { brief, model } = paul();
    const card = nodeOf(projected(model, brief), 'mp:limit:maintain_code_quality');
    expect(card.description).toMatch(/^Maintaining code quality /);
    expect(card.source_quote).toBe('while maintaining code quality');
  });
});
