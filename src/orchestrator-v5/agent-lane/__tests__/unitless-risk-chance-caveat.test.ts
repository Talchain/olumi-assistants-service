/** PR-1, Science goals §(r)(b): an Olumi-added omitted risk is visible beside the chance, with its own direction. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as screenLinesModule from '../goal-chance-screen-lines.js';
import { type GoalChanceScreenLine } from '../goal-chance-screen-lines.js';
import { composeReplyShape, sentenceMultiset } from '../reply/compose-reply.js';

// Namespace reads give assertion REDs on the unchanged base, rather than a missing-export collection failure.
const desired = screenLinesModule as unknown as {
  unitlessRiskChanceCaveatForAgent?: (graph: unknown) => string | undefined;
  withUnitlessRiskChanceCaveat?: (text: string, lines: readonly GoalChanceScreenLine[], caveat?: string) => string;
};
const unitlessRiskChanceCaveatForAgent = (g: unknown): string | undefined => {
  expect(desired.unitlessRiskChanceCaveatForAgent, 'the exclusion omission has a deterministic producer').toBeTypeOf('function');
  return desired.unitlessRiskChanceCaveatForAgent!(g);
};
const withUnitlessRiskChanceCaveat = (text: string, lines: readonly GoalChanceScreenLine[], caveat?: string): string => {
  expect(desired.withUnitlessRiskChanceCaveat, 'the exclusion omission is inserted before reply composition').toBeTypeOf('function');
  return desired.withUnitlessRiskChanceCaveat!(text, lines, caveat);
};

type Rec = Record<string, any>;
const risk = (id = 'backlash', label = 'Client backlash', change: Rec = {}): Rec => ({
  id, label, kind: 'risk', provenance: 'ai_inferred', analysis_participation: 'retained_excluded', ...change,
});
const goal = { id: 'goal', label: 'Monthly revenue', kind: 'goal' };
function link(from: string, to = 'goal', direction?: unknown, change: Rec = {}): Rec {
  // Omitted argument is the negative default; explicitly undefined represents a link without a sign.
  const sign = arguments.length < 3 ? 'negative' : direction;
  return { from, to, ...(sign === undefined ? {} : { effect_direction: sign }), ...change };
}
const graph = (risks: Rec[] = [risk()], edges: Rec[] = [link('backlash')], otherNodes: Rec[] = []): Rec => ({
  nodes: [goal, ...risks, ...otherNodes], edges,
});
const HIGH = "It doesn't yet include ‘Client backlash’, so it may be too high.";
const MOVE = "It doesn't yet include ‘Client backlash’, so it may move when they're included.";

describe('RED on base: one omission caveat from the persisted exclusion and authorship carrier', () => {
  it('one negative omitted risk: omission and too-high words, once', () => {
    const g = graph();
    const before = JSON.stringify(g);
    expect(unitlessRiskChanceCaveatForAgent(g)).toBe(HIGH);
    expect(JSON.stringify(g), 'a reader never stamps or changes the graph').toBe(before);
  });

  it.each([
    [2, '(and 1 other risk Olumi added)'],
    [3, '(and 2 other risks Olumi added)'],
  ])('%i excluded risks yield one caveat with the correct other-risk count', (count, others) => {
    const risks = Array.from({ length: count }, (_, i) => risk(`risk-${i}`, i === 0 ? 'Client backlash' : `Extra risk ${i}`));
    expect(unitlessRiskChanceCaveatForAgent(graph(risks, risks.map(r => link(r.id)))))
      .toBe(`It doesn't yet include ‘Client backlash’ ${others}, so it may be too high.`);
  });

  it('zero exclusions: no caveat, including an included Olumi risk', () => {
    expect(unitlessRiskChanceCaveatForAgent(graph([risk('backlash', 'Client backlash', { analysis_participation: 'included' })])))
      .toBeUndefined();
    expect(unitlessRiskChanceCaveatForAgent(graph([]))).toBeUndefined();
    expect(unitlessRiskChanceCaveatForAgent(undefined)).toBeUndefined();
  });

  it.each(['from_brief', 'user_set', 'explicit', undefined])('a user/unknown-authorship risk (%s) never contributes to the caveat', provenance => {
    expect(unitlessRiskChanceCaveatForAgent(graph([risk('backlash', 'Client backlash', { provenance })])))
      .toBeUndefined();
  });

  it('a non-risk excluded by the existing producer is not a unitless-risk omission', () => {
    expect(unitlessRiskChanceCaveatForAgent(graph([risk('backlash', 'Client backlash', { kind: 'factor' })])))
      .toBeUndefined();
  });

  it('other producers/user risks do not inflate the number or change this rule’s direction', () => {
    expect(unitlessRiskChanceCaveatForAgent(graph([
      risk(), risk('user', 'Supplier risk', { provenance: 'from_brief' }),
      risk('factor', 'Demand', { kind: 'factor' }), risk('included', 'Capacity risk', { analysis_participation: 'included' }),
    ], [link('backlash'), link('user', 'goal', 'positive'), link('factor', 'goal', 'positive')])))
      .toBe(HIGH);
  });
});

describe('RED on base: too high only when every excluded risk’s goal-path sign is negative', () => {
  it('an indirect positive × negative path points down, regardless of an unrelated positive dead end', () => {
    expect(unitlessRiskChanceCaveatForAgent(graph([risk()], [
      link('backlash', 'churn', 'positive'), link('churn'), link('backlash', 'dead-end', 'positive'),
    ], [{ id: 'churn', kind: 'factor' }, { id: 'dead-end', kind: 'factor' }]))).toBe(HIGH);
  });

  it('all goal paths negative permits too high; a positive second path switches to may move', () => {
    const g = graph([risk()], [link('backlash'), link('backlash', 'churn', 'positive'), link('churn')], [{ id: 'churn', kind: 'factor' }]);
    expect(unitlessRiskChanceCaveatForAgent(g)).toBe(HIGH);
    g.edges[2].effect_direction = 'positive';
    expect(unitlessRiskChanceCaveatForAgent(g)).toBe(MOVE);
  });

  it('mixed excluded-risk directions give one may-move caveat', () => {
    expect(unitlessRiskChanceCaveatForAgent(graph([risk(), risk('gain', 'Unexpected demand')], [link('backlash'), link('gain', 'goal', 'positive')])))
      .toBe("It doesn't yet include ‘Client backlash’ (and 1 other risk Olumi added), so it may move when they're included.");
  });

  it.each([
    ['explicit unknown sign', [link('backlash', 'goal', 'unknown', { strength: { mean: -0.5 } })]],
    ['no sign', [link('backlash', 'goal', undefined)]],
    ['zero strength', [link('backlash', 'goal', undefined, { strength: { mean: 0 } })]],
    ['no goal path', []],
  ])('%s never licences too high', (_row, edges) => {
    expect(unitlessRiskChanceCaveatForAgent(graph([risk()], edges))).toBe(MOVE);
  });

  it('an unknown link on one indirect goal path keeps the direction open', () => {
    expect(unitlessRiskChanceCaveatForAgent(graph([risk()], [
      link('backlash'), link('backlash', 'churn', undefined), link('churn'),
    ], [{ id: 'churn', kind: 'factor' }]))).toBe(MOVE);
  });

  it('a stated negative sign takes precedence over a positive placeholder mean', () => {
    expect(unitlessRiskChanceCaveatForAgent(graph([risk()], [link('backlash', 'goal', 'negative', { strength: { mean: 0.5 } })])))
      .toBe(HIGH);
  });

  it('a finite signed strength can carry a direction when no direction field exists', () => {
    expect(unitlessRiskChanceCaveatForAgent(graph([risk()], [link('backlash', 'goal', undefined, { strength: { mean: -0.5 } })])))
      .toBe(HIGH);
  });
});

describe('RED on base: the omission is carried beside the exact evidence before reply composition', () => {
  const first: GoalChanceScreenLine = { option_id: 'raise', label: 'Raise prices', figure: 'about 47%',
    chance: '‘Raise prices’: about 47% chance of meeting your goal, in this model.', depends: 'It depends most on demand.' };
  const second: GoalChanceScreenLine = { option_id: 'keep', label: 'Keep prices', figure: 'about 34%',
    chance: '‘Keep prices’: about 34% chance of meeting your goal, in this model.', depends: '' };

  it('one caveat directly follows all screen chance findings and their joined depends-on evidence', () => {
    const evidence = `${first.chance} ${first.depends} ${second.chance}`;
    const text = `The analysis ran.\n\n${evidence}\n\nWhich assumption should we test?`;
    expect(withUnitlessRiskChanceCaveat(text, [first, second], HIGH))
      .toBe(`The analysis ran.\n\n${evidence} ${HIGH}\n\nWhich assumption should we test?`);
  });

  it('accepted narrator own words and their spread note still get the caveat immediately after the evidence', () => {
    const note = 'This option could fall further short.';
    const line = { ...first, depends: '', spread_note: note };
    const said = `**Raise prices**: about 47%. ${note}`;
    expect(withUnitlessRiskChanceCaveat(`${said}\n\nWhich assumption should we test?`, [line], HIGH))
      .toBe(`${said} ${HIGH}\n\nWhich assumption should we test?`);
  });

  it('an immediately following driver on another line stays with its chance before the omission', () => {
    const said = '**Raise prices**: about 47%.';
    const text = `${said}\n\n${first.depends}\n\nWhich assumption should we test?`;
    expect(withUnitlessRiskChanceCaveat(text, [first], HIGH))
      .toBe(`${said}\n\n${first.depends} ${HIGH}\n\nWhich assumption should we test?`);
  });

  it('canonical evidence with restyled quotes still gets the omission beside it', () => {
    const said = second.chance.replace(/‘|’/g, '"');
    expect(withUnitlessRiskChanceCaveat(`${said}\n\nWhich assumption should we test?`, [second], HIGH))
      .toBe(`${said} ${HIGH}\n\nWhich assumption should we test?`);
  });

  it('styled event-by-date canonical evidence keeps the omission immediately after its finding, before support', () => {
    const line: GoalChanceScreenLine = { option_id: 'launch', label: 'Carry on as now', figure: 'about 47%',
      chance: '‘Carry on as now’: about 47% chance of launching by 7 April 2027, in this model.', depends: '' };
    const said = line.chance.replace('‘Carry on as now’', '**“Carry on as now”**').replace('about 47%', '**about 47%') + '**';
    const support = 'This supporting explanation records the delivery assumptions.';
    const text = `${said}\n\n${support}\n\nWhich assumption should we test?`;
    expect(screenLinesModule.withScreenLinesOwed(text, [line]), 'the existing chance reader already accepts this styling')
      .toEqual({ text, added: 0 });
    expect(withUnitlessRiskChanceCaveat(text, [line], HIGH))
      .toBe(`${said} ${HIGH}\n\n${support}\n\nWhich assumption should we test?`);
  });

  it('no displayed chances still says the omission, before the questions toggle', () => {
    const text = 'The chance is not ready.\n\nQuestions this model does not answer yet: Demand has no size.';
    expect(withUnitlessRiskChanceCaveat(text, [], MOVE))
      .toBe(`The chance is not ready.\n\n${MOVE}\n\nQuestions this model does not answer yet: Demand has no size.`);
  });

  it('zero exclusions does not add text; an already-carried omission is not said twice', () => {
    expect(withUnitlessRiskChanceCaveat(second.chance, [second])).toBe(second.chance);
    const said = `${second.chance} ${HIGH}`;
    expect(withUnitlessRiskChanceCaveat(said, [second], HIGH)).toBe(said);
  });
});

describe('RED on base: composer places the typed omission directly after all chance evidence', () => {
  it('two chance findings precede the omission, which remains visible and the ask remains last', () => {
    const first = '‘Raise prices’: about 47% chance of meeting your goal, in this model.';
    const second = '‘Keep prices’: about 34% chance of meeting your goal, in this model.';
    const ask = 'Which assumption should we test first?';
    const text = [first, second, HIGH, ask, '',
      'This supporting explanation records the sensitivity assumptions and their original evidence for later review by the team.'].join('\n');
    const out = composeReplyShape({ text, obligations: [
      { role: 'evidence', text: first, lead: true }, { role: 'evidence', text: second, lead: true },
      { role: 'caveat', text: HIGH, after_lead_evidence: true }, { role: 'ask', text: ask },
    ] });
    expect(out.outcome).toBe('shaped');
    expect(out.shape?.headline).toBe(first);
    expect(out.shape?.bullets).toEqual([second, HIGH, ask]);
    expect(out.shape?.detail).not.toContain(HIGH);
    expect(sentenceMultiset(out.text)).toEqual(sentenceMultiset(text));
  });

  it('live and replay source bind the omission reader, insertion helper and caveat obligation before the one last writer', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(route.match(/unitlessRiskChanceCaveatForAgent\(/g)?.length ?? 0, 'both final readbacks derive the omission').toBeGreaterThanOrEqual(2);
    expect(route.match(/withUnitlessRiskChanceCaveat\(/g)?.length ?? 0, 'both final readbacks insert the omission before composition').toBeGreaterThanOrEqual(2);
    expect(route.match(/after_lead_evidence:\s*true/g)?.length ?? 0, 'both final readbacks type the omission as an after-evidence caveat').toBeGreaterThanOrEqual(2);
  });
});
