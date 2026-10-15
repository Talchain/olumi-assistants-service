/**
 * ⭐ S5 (DL 15 Oct): an edit's figure that contradicts a count in the option's own name is read, and a name is PROPOSED (never
 * applied here). Served bytes: the hiring e2e on CEE c1e944a4 (scenario e9e63843), where the canvas set "Hire two developers" to
 * 3 developers and a reopen kept "Hire two developers" beside raw_value 3.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { optionLabelCountClash, optionRenameCardOf } from '../option-label-count.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/s5-hiring-rename-e2e-c1e944a4.json', import.meta.url), 'utf8')) as Rec;
const cellOf = (g: Rec, option: string, factor: string): Rec => g.nodes.find((n: Rec) => n.id === option).interventions[factor];
const labelOf = (g: Rec, id: string): string => g.nodes.find((n: Rec) => n.id === id).label;

describe('the served hiring edit: the name says two, the level now says 3', () => {
  it('PRECONDITION: the served receipt and the committed cell', () => {
    expect(FX.receipt).toBe('"Hire two developers" now sets "Developer hires from today" to 3 developers.');
    expect(labelOf(FX.after_edit, 'hire_two_developers')).toBe('Hire two developers');
    expect(cellOf(FX.after_edit, 'hire_two_developers', 'developer_hires_from_today')).toMatchObject({ raw_value: 3, unit: 'developers' });
  });

  it('RED: the clash is read and the name proposed in its own style, nothing else changed', () => {
    const cell = cellOf(FX.after_edit, 'hire_two_developers', 'developer_hires_from_today');
    expect(optionLabelCountClash(labelOf(FX.after_edit, 'hire_two_developers'), cell.unit, cell.raw_value))
      .toEqual({ said: 2, now: 3, proposed: 'Hire three developers' });
  });

  it('CONTRAST: the option whose name agrees with its level ("Hire one developer" at 1) has no clash', () => {
    const cell = cellOf(FX.after_edit, 'hire_one_developer', 'developer_hires_from_today');
    expect(optionLabelCountClash(labelOf(FX.after_edit, 'hire_one_developer'), cell.unit, cell.raw_value)).toBeUndefined();
  });

  it('CONTRAST: before the edit the name and level agreed', () => {
    const cell = cellOf(FX.before_edit, 'hire_two_developers', 'developer_hires_from_today');
    expect(optionLabelCountClash('Hire two developers', cell.unit, cell.raw_value)).toBeUndefined();
  });
});

describe('the reading is narrow: one count, of the level\'s own unit, a whole number', () => {
  it.each([
    ['Hire one developer', 'developers', 2, 'Hire two developers'],
    ['Hire two developers', 'developers', 1, 'Hire one developer'],
    ['Run 2 campaigns', 'campaigns', 4, 'Run 4 campaigns'],
    ['Hire two Tech Leads', 'Tech Leads', 1, 'Hire one Tech Lead'],
    ['Open three stores', 'stores', 25, 'Open 25 stores'],
  ])('RED: %s at %s %s → %s', (label, unit, now, proposed) => {
    expect(optionLabelCountClash(label, unit, now)?.proposed).toBe(proposed);
  });
  it.each([
    ['a count of another quantity than the level\'s unit', 'Hire two developers', 'weeks', 3],
    ['no count in the name', 'Hire a Tech Lead', 'Tech Leads', 2],
    ['two counts of the unit', 'Hire two developers or three developers', 'developers', 4],
    ['a fractional level', 'Hire two developers', 'developers', 2.5],
    ['a count that is not the unit\'s', 'Two-year plan with developers', 'developers', 3],
  ])('CONTRAST: %s → nothing offered', (_n, label, unit, now) => {
    expect(optionLabelCountClash(label, unit, now)).toBeUndefined();
  });
});

describe('the card a committed edit owes (`optionRenameCardOf`), on two served briefs', () => {
  it('RED (hiring, served after-edit bytes): ONE card, its words naming the clash, the proposed name the user can accept', () => {
    expect(optionRenameCardOf(FX.after_edit, 'hire_two_developers', 'developer_hires_from_today')).toEqual({
      option_id: 'hire_two_developers', expected_label: 'Hire two developers', label: 'Hire three developers',
      words: '‘Hire two developers’ now sets ‘Developer hires from today’ to 3 developers, but its name still says two. '
        + 'Rename it ‘Hire three developers’?' });
  });
  it('CONTRAST (hiring): the edit that leaves the name true ("Hire one developer" at 1) owes no card', () => {
    expect(optionRenameCardOf(FX.after_edit, 'hire_one_developer', 'developer_hires_from_today')).toBeUndefined();
  });

  const CAP = (JSON.parse(readFileSync(new URL('./fixtures/capacity-post3017-turn01-read.json', import.meta.url), 'utf8')) as Rec).j.graph as Rec;
  const setTo = (g: Rec, option: string, raw: number): Rec => {
    const c = structuredClone(g);
    cellOf(c, option, 'additional_specialists').raw_value = raw;
    return c;
  };
  it('RED (capacity, served read after #3017): "Add two specialists" set to 3 → "Add three specialists"', () => {
    expect(optionRenameCardOf(setTo(CAP, 'add_two_specialists', 3), 'add_two_specialists', 'additional_specialists')?.label)
      .toBe('Add three specialists');
  });
  it('CONTRAST (capacity): "Add one specialist" set to 2 would take another option\'s name → no card (a rename never makes two)', () => {
    expect(labelOf(CAP, 'add_two_specialists')).toBe('Add two specialists');
    expect(optionRenameCardOf(setTo(CAP, 'add_one_specialist', 2), 'add_one_specialist', 'additional_specialists')).toBeUndefined();
  });
});
