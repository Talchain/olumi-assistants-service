/**
 * ⭐ THE QUALITATIVE HOME REACHES THE AI'S WORKING INPUT (DL-3 05:21Z; BUDDY-A 05:30Z §3): a factor's definition the user's press
 * recorded (`FACTOR_DEFINITION_ROW`, #3348) is in `get_canonical_state`'s entity, as their words with the question each answers
 * kept apart, so a cold reopen holds it. Construction's own brief records are not added (every sent body would change). SYNTHETIC.
 */
import { describe, expect, it } from 'vitest';
import { projectEntity } from '../runtime/agent-capabilities.js';
import { CONSTRUCTION_ATTEST, userStatementRecord, withUserStatement } from '../../statement-door/statements.js';

type Json = Record<string, any>;
const SUBJECT = { kind: 'factor' as const, id: 'budget', field: 'measure' as const };
const ASK = 'Does the £400,000 limit on ‘Marketing budget’ cover the agency fees as well as the media spend?';
const answer = { speaker: 'user', quote: 'Yes, it covers both.', source: 'Yes, it covers both.', answering: ASK, form: 'describes', unit: '',
  reading: 'olumi', subject: { quantity: 'measure', node_id: 'budget' } };
const factor = (): Json => ({ id: 'budget', kind: 'factor', label: 'Marketing budget',
  observed_state: { value: 0.8, raw_value: 400000, unit: '£', cap: 500000, source: 'brief_extraction' } });
const holding = (statement: Json, attest?: typeof CONSTRUCTION_ATTEST): Json => (withUserStatement({ nodes: [factor()], edges: [] } as never,
  userStatementRecord(SUBJECT, [statement as never], '2026-10-17T00:00:00.000Z', attest), SUBJECT) as Json).nodes[0];

describe('a factor’s recorded definition in the AI’s working input', () => {
  it('⭐ the press-recorded answer: the user’s words, with Olumi’s question kept apart', () => {
    expect(projectEntity(holding(answer) as never).user_statements).toEqual([{ field: 'measure', said: ['Yes, it covers both.'], answering: [ASK], speaker: 'user' }]);
  });

  it('⭐ named words, answering nothing: the words alone', () => {
    const quote = 'Our marketing budget covers both the agency fees and the media spend.';
    const { answering: _a, ...named } = answer;
    expect(projectEntity(holding({ ...named, quote, source: quote }) as never).user_statements).toEqual([{ field: 'measure', said: [quote], speaker: 'user' }]);
  });

  it('⛔ CONTRAST: construction’s brief record is not added, and a factor with no record has none', () => {
    expect(projectEntity(holding(answer, CONSTRUCTION_ATTEST) as never).user_statements).toBeUndefined();
    expect(projectEntity(factor() as never).user_statements).toBeUndefined();
  });
});
