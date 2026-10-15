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
import { answeredAsk, askedSubjects } from '../ask.js';
import { doorRowFor, ROLE_TABLE as TABLE, rowKey, type RoleRow } from '../role-table.js';

type Rec = Record<string, any>;
const G = (JSON.parse(readFileSync('tests/fixtures/risk-occurrence/served-hiring-post3007-read01-20261014.json', 'utf8')) as Rec).body.graph as Rec;
const RISK: DoorSubject = { kind: 'risk', id: 'code_quality_deterioration', field: 'occurrence' };
const SAID = 'I’d say there’s about a 30% chance it slips within the next 3 months.';
/** The test-only row's subject: a field no signed row reads for a risk, so the real rows never answer for it. */
const RISK_T: DoorSubject = { ...RISK, field: 'relation' };
const ASK = { subject: RISK, words: 'How likely is ‘Code quality deterioration’ to happen at least once within 3 months?' };
afterEach(() => { for (let i = TABLE.length - 1; i >= 0; i -= 1) if (TABLE[i]!.signed_by === 'test-only') TABLE.splice(i, 1); });
/** A test-only row: a percent figure, read by a trivial reader. */
const ROW: RoleRow = { field: 'relation', unit: '%', forms: ['point'], carrier: 'risk_occurrence', maxStatements: 1, signed_by: 'test-only',
  applies: (s) => s.kind === 'risk', writer: { approve: () => ({ refused: 'test-only' }), holds: () => false },
    read: (q) => { const m = /(\d+)%/.exec(q); return m === null ? { refused: `“${q}” states no chance.` } : { form: 'point', low: Number(m[1]), high: Number(m[1]), qualifier: 'about' }; },
    readingWords: (s, _sub, label) => `your estimate of about ${s[0]!.low}% that ‘${label}’ happens`,
    assumptions: () => ['How strongly it affects the model is a separate assumption.'],
    recordedWords: (s, _sub, label) => `Recorded your estimate: about ${s[0]!.low}% that ‘${label}’ happens.` };
const testRow = () => { TABLE.push(ROW); };

describe('SYSTEM 1 contract: one subject, one verifier, one binding rule, one card', () => {
  it('a subject resolves by graph identity, or by ONE exact label; never a guess', () => {
    expect(resolveSubject(G, { kind: 'risk', id: 'code_quality_deterioration', field: 'occurrence' })).toEqual({ kind: 'resolved', subject: RISK, label: 'Code quality deterioration' });
    expect(resolveSubject(G, { kind: 'risk', label: 'Code quality deterioration', field: 'occurrence' })).toMatchObject({ kind: 'resolved', subject: RISK });
    expect(resolveSubject(G, { kind: 'risk', label: 'Code quality', field: 'occurrence' })).toEqual({ kind: 'unresolved', reason: 'not_found' });
    expect(resolveSubject(G, { kind: 'factor', id: 'code_quality_deterioration', field: 'level' })).toEqual({ kind: 'unresolved', reason: 'not_found' });
    expect(resolveSubject(G, { kind: 'risk', id: 'code_quality_deterioration', field: 'likelihood' })).toEqual({ kind: 'unresolved', reason: 'unknown_field' });
    // An option's setting of a node is `level` on {option_id, node} (agreed with PROMPT), never a field of its own.
    expect(resolveSubject(G, { kind: 'risk', id: 'code_quality_deterioration', field: 'setting' })).toEqual({ kind: 'unresolved', reason: 'unknown_field' });
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

  it('a stated 0 is a figure only where the field allows it (a level or target: "0% now"); elsewhere it is refused as before', () => {
    const NONE = 'We spend 0% of the budget on contractors today.';
    const rules = { subject: { quantity: 'level' }, unit: '%', forms: ['point' as const], figuresIn: () => [{ low: 0, high: 0 }] };
    expect(verifyStatement({ quote: NONE, form: 'point', value: 0 }, { now: NONE }, rules)).toMatchObject({ kind: 'refused', refusal: 'statement_malformed' });
    expect(verifyStatement({ quote: NONE, form: 'point', value: 0 }, { now: NONE }, { ...rules, allowsZero: true }))
      .toMatchObject({ kind: 'verified', statement: { quote: NONE, low: 0, high: 0 } });
    expect(verifyStatement({ quote: NONE, form: 'point', value: 5 }, { now: NONE }, { ...rules, allowsZero: true })).toMatchObject({ kind: 'refused', refusal: 'figure_not_in_quote' });
  });

  it('ONE dispatch by subject, keyed by (field, carrier): the one row that applies; none or two is no row (fail closed)', () => {
    expect(doorRowFor(RISK_T, G)).toBeUndefined();
    testRow();
    expect(doorRowFor(RISK_T, G)).toBe(ROW);
    expect(doorRowFor({ kind: 'factor', id: 'leadership_coverage', field: 'relation' }, G), 'a row applies to its own subjects only').toBeUndefined();
    expect(doorRowFor({ ...RISK, field: 'level' }, G)).toBeUndefined();
    TABLE.push({ ...ROW, carrier: 'levels' });
    expect(doorRowFor(RISK_T, G), 'two rows apply: no row, never a choice').toBeUndefined();
    expect(new Set(TABLE.map(rowKey)).size).toBe(TABLE.length);
  });

  it('each statement binds to the ask it answered, when Olumi said exactly one ask in those words; an unsaid ask binds nothing', () => {
    const goalAsk = { subject: { kind: 'goal' as const, id: 'productivity', field: 'target' as const }, words: 'What does success look like?', turn_id: 't1' };
    const asks = [goalAsk, { ...ASK, turn_id: 't2' }];
    expect(answeredAsk('How likely is ‘Code quality deterioration’ to happen at least once within 3 months?', asks)).toEqual({ ...ASK, turn_id: 't2' });
    expect(statementBoundTo(G, RISK, SAID, { asks }, ASK.words)).toBe('bound');
    // An EARLIER ask than the last reply's: still the one it answered.
    expect(statementBoundTo(G, goalAsk.subject, 'The same people.', { preceding_ask: ASK.words, asks }, goalAsk.words)).toBe('bound');
    expect(statementBoundTo(G, RISK, SAID, { preceding_ask: ASK.words, asks }, goalAsk.words), 'it answered another subject’s ask').toBe('another');
    expect(statementBoundTo(G, RISK, SAID, { preceding_ask: ASK.words, asks }, 'An ask Olumi never said.'), 'never falls back to the last reply').toBe('unbound');
    testRow();
    const v = readStatement(G, RISK_T, 'Code quality deterioration', [{ quote: SAID, answering: ASK.words }], { now: SAID }, { asks });
    expect(v).toMatchObject({ kind: 'read', reading: { statements: [{ quote: SAID, answering: ASK.words }] } });
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
    expect(readStatement(G, RISK_T, 'Code quality deterioration', [SAID], { now: SAID })).toMatchObject({ kind: 'refused', refusal: 'no_table_row' });
    testRow();
    const ctx = { preceding_ask: ASK.words, asks: [ASK] };
    const v = readStatement(G, RISK_T, 'Code quality deterioration', [SAID], { now: SAID }, ctx);
    expect(v.kind).toBe('read');
    if (v.kind !== 'read') return;
    expect(doorCardWords(v.reading)).toBe(`From your message: “${SAID}” Olumi reads this as your estimate of about 30% that ‘Code quality deterioration’ happens. `
      + 'Record this reading? How strongly it affects the model is a separate assumption.');
    expect(v.reading.statements[0]).toMatchObject({ subject: { quantity: 'relation', node_id: RISK.id }, qualifier: 'about', low: 30 });
    expect(DOOR_APPROVE).toEqual({ label: 'Record what you said', message: 'Yes, record what I said.' });
    // Refusals keep the words: not this field, not this subject, not their words.
    expect(readStatement(G, RISK_T, 'Code quality deterioration', ['It might slip.'], { now: 'It might slip.' }, ctx)).toMatchObject({ kind: 'refused', refusal: 'not_this_field' });
    expect(readStatement(G, RISK_T, 'Code quality deterioration', [SAID], { now: SAID })).toMatchObject({ kind: 'refused', refusal: 'not_this_subject' });
    expect(readStatement(G, RISK_T, 'Code quality deterioration', [SAID], { now: 'Yes.', unverified: SAID }, ctx)).toMatchObject({ kind: 'refused', refusal: 'origin_unknown' });
  });
});
