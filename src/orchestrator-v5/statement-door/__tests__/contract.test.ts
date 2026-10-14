/**
 * ⭐ SYSTEM 1 contract (PR-0): one subject by graph identity, one per-statement verifier, the binding rule (words, selection,
 * Olumi's preceding ask; never elimination) and the one card template, on the served hiring post3007 graph. A test-only table
 * row stands in for SYSTEM 4's signed rows, which each migration adds.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyStatement, verifyStatements } from '../../agent-lane/user-statements.js';
import { resolveSubject, subjectKey, type DoorSubject } from '../subject.js';
import { readStatement, statementBoundTo } from '../read.js';
import { doorCardWords, DOOR_APPROVE } from '../card.js';
import { ROLE_TABLE } from '../role-table.js';
import { askedSubjects } from '../ask.js';

type Rec = Record<string, any>;
const G = (JSON.parse(readFileSync('tests/fixtures/risk-occurrence/served-hiring-post3007-read01-20261014.json', 'utf8')) as Rec).body.graph as Rec;
const RISK: DoorSubject = { kind: 'risk', id: 'code_quality_deterioration', field: 'occurrence' };
const SAID = 'I’d say there’s about a 30% chance it slips within the next 3 months.';
const ASK = { subject: RISK, words: 'How likely is ‘Code quality deterioration’ to happen at least once within 3 months?' };
afterEach(() => { delete ROLE_TABLE.occurrence; });
/** A test-only row: a percent figure, read by a trivial reader (SYSTEM 4's signed row replaces it in M1). */
const testRow = () => {
  ROLE_TABLE.occurrence = { field: 'occurrence', unit: '%', forms: ['point'], carrier: 'risk_occurrence', maxStatements: 1, signed_by: 'test-only',
    read: (q) => { const m = /(\d+)%/.exec(q); return m === null ? { refused: `“${q}” states no chance.` } : { form: 'point', low: Number(m[1]), high: Number(m[1]), qualifier: 'about' }; },
    readingWords: (s, _sub, label) => `your estimate of about ${s[0]!.low}% that ‘${label}’ happens`,
    assumptions: () => ['How strongly it affects the model is a separate assumption.'],
    recordedWords: (s, _sub, label) => `Recorded your estimate: about ${s[0]!.low}% that ‘${label}’ happens.` };
};

describe('SYSTEM 1 contract: one subject, one verifier, one binding rule, one card', () => {
  it('a subject resolves by graph identity, or by ONE exact label; never a guess', () => {
    expect(resolveSubject(G, { kind: 'risk', id: 'code_quality_deterioration', field: 'occurrence' })).toEqual({ kind: 'resolved', subject: RISK, label: 'Code quality deterioration' });
    expect(resolveSubject(G, { kind: 'risk', label: 'Code quality deterioration', field: 'occurrence' })).toMatchObject({ kind: 'resolved', subject: RISK });
    expect(resolveSubject(G, { kind: 'risk', label: 'Code quality', field: 'occurrence' })).toEqual({ kind: 'unresolved', reason: 'not_found' });
    expect(resolveSubject(G, { kind: 'factor', id: 'code_quality_deterioration', field: 'level' })).toEqual({ kind: 'unresolved', reason: 'not_found' });
    expect(resolveSubject(G, { kind: 'risk', id: 'code_quality_deterioration', field: 'likelihood' })).toEqual({ kind: 'unresolved', reason: 'unknown_field' });
    expect(resolveSubject(G, { kind: 'link', id: 'code_quality_deterioration', to_id: 'productivity', field: 'effect' }))
      .toMatchObject({ kind: 'resolved', subject: { kind: 'link', id: 'code_quality_deterioration', to_id: 'productivity', field: 'effect' } });
    expect(subjectKey(RISK)).toBe('risk|code_quality_deterioration|||occurrence');
  });

  it('the per-statement verifier is the all-or-nothing one, statement by statement (parity), and refuses on its own', () => {
    const rules = { subject: { quantity: 'occurrence' }, unit: '%', forms: ['point' as const], figuresIn: () => [{ low: 30, high: 30 }] };
    const one = verifyStatement({ quote: SAID, form: 'point', value: 30 }, { now: SAID }, rules);
    expect(one).toMatchObject({ kind: 'verified', statement: { quote: SAID, low: 30, high: 30, speaker: 'user', reading: 'olumi' } });
    expect(verifyStatements([{ quote: SAID, form: 'point', value: 30 }], { now: SAID }, rules)).toEqual({ kind: 'verified', statements: [(one as Rec).statement] });
    expect(verifyStatement({ quote: 'a 30% chance it slips', form: 'point', value: 30 }, { now: SAID }, rules)).toMatchObject({ kind: 'refused', refusal: 'statement_not_found' });
    expect(verifyStatement({ quote: SAID, form: 'point', value: 30 }, { now: 'Yes.', unverified: SAID }, rules)).toMatchObject({ kind: 'refused', refusal: 'origin_unknown' });
    expect(verifyStatement({ quote: SAID, form: 'point', value: 40 }, { now: SAID }, rules)).toMatchObject({ kind: 'refused', refusal: 'figure_not_in_quote' });
  });

  it('binding: its words, the user’s selection, or Olumi’s preceding ask in the ask’s own words; never elimination', () => {
    expect(statementBoundTo(G, RISK, SAID)).toBe('unbound');
    expect(statementBoundTo(G, RISK, 'There’s a 30% chance code quality deterioration happens within 3 months.')).toBe('bound');
    expect(statementBoundTo(G, RISK, SAID, { selection: { element_ids: [RISK.id], unresolved: 'none' } })).toBe('bound');
    expect(statementBoundTo(G, RISK, SAID, { preceding_ask: `The analysis can’t run yet. ${ASK.words}`, asks: [ASK] })).toBe('bound');
    expect(askedSubjects('Your results are ready.', [ASK])).toEqual([]);
    const other: DoorSubject = { kind: 'factor', id: 'leadership_coverage', field: 'level' };
    expect(statementBoundTo(G, RISK, SAID, { preceding_ask: 'What is ‘Leadership coverage’ today?', asks: [{ subject: other, words: 'What is ‘Leadership coverage’ today?' }] })).toBe('another');
  });

  it('ONE reading through the table row, ONE card template and ONE button; a field with no signed row stays off the door', () => {
    expect(readStatement(G, RISK, 'Code quality deterioration', [SAID], { now: SAID })).toMatchObject({ kind: 'refused', refusal: 'no_table_row' });
    testRow();
    const ctx = { preceding_ask: ASK.words, asks: [ASK] };
    const v = readStatement(G, RISK, 'Code quality deterioration', [SAID], { now: SAID }, ctx);
    expect(v.kind).toBe('read');
    if (v.kind !== 'read') return;
    expect(doorCardWords(v.reading)).toBe(`From your words: “${SAID}”. Olumi reads this as your estimate of about 30% that ‘Code quality deterioration’ happens. `
      + 'How strongly it affects the model is a separate assumption. Record this reading?');
    expect(v.reading.statements[0]).toMatchObject({ subject: { quantity: 'occurrence', node_id: RISK.id }, qualifier: 'about', low: 30 });
    expect(DOOR_APPROVE).toEqual({ label: 'Record what you said', message: 'Yes, record what I said.' });
    // Refusals keep the words: not this field, not this subject, not their words.
    expect(readStatement(G, RISK, 'Code quality deterioration', ['It might slip.'], { now: 'It might slip.' }, ctx)).toMatchObject({ kind: 'refused', refusal: 'not_this_field' });
    expect(readStatement(G, RISK, 'Code quality deterioration', [SAID], { now: SAID })).toMatchObject({ kind: 'refused', refusal: 'not_this_subject' });
    expect(readStatement(G, RISK, 'Code quality deterioration', [SAID], { now: 'Yes.', unverified: SAID }, ctx)).toMatchObject({ kind: 'refused', refusal: 'origin_unknown' });
  });
});
