/**
 * The two quote checks T2A5 (#3002) built, exported alone so HIRING's relation and level checks reuse them: a pure
 * extraction, no caller changes. One row per rule, each with its contrast.
 */
import { describe, expect, it } from 'vitest';
import { namesBothEnds, wholeStatementIn } from '../input-claim-context.js';

const nodes = [{ id: 'price', label: 'Price' }, { id: 'mrr', label: 'MRR' }, { id: 'quality', label: 'Quality' }];

describe('wholeStatementIn: the quote is a WHOLE statement of the message', () => {
  it('a whole sentence, verbatim, is whole: alone, first, or after a full stop', () => {
    expect(wholeStatementIn('Price has a weak effect on MRR.', 'Price has a weak effect on MRR.')).toBe(true);
    expect(wholeStatementIn('Price has a weak effect on MRR. Quality is strong.', 'Price has a weak effect on MRR.')).toBe(true);
    expect(wholeStatementIn('Quality is strong. Price has a weak effect on MRR', 'Price has a weak effect on MRR')).toBe(true);
  });
  it('a fragment is not whole', () => {
    expect(wholeStatementIn('Price has a weak effect on MRR, and our evidence is strong.', 'Price has a weak effect on MRR')).toBe(false);
  });
  it('a colon keeps its speaker: the words after "Alice says:" are not whole; the full sentence is', () => {
    const message = 'Alice says: Price has a weak effect on MRR.';
    expect(wholeStatementIn(message, 'Price has a weak effect on MRR.')).toBe(false);
    expect(wholeStatementIn(message, message)).toBe(true);
  });
  it('one spelling: typographic quotes and runs of space match their plain form', () => {
    expect(wholeStatementIn('Price’s effect on MRR is  weak.', "Price's effect on MRR is weak.")).toBe(true);
  });
  it('⭐ T1 HOST P07: a person’s quoted words, closed after the full stop, are whole with their speaker; a sentence after them is too', () => {
    const message = "We fit kitchens. Sam, site lead: 'Crews start early only if parts arrive the day before.' He assumes the van is free.";
    expect(wholeStatementIn(message, "Sam, site lead: 'Crews start early only if parts arrive the day before.'")).toBe(true);
    expect(wholeStatementIn(message.replace(/'/g, '’').replace("lead: ’", 'lead: ‘'), "Sam, site lead: 'Crews start early only if parts arrive the day before.'")).toBe(true);
    expect(wholeStatementIn(message, 'He assumes the van is free.')).toBe(true);
    const two = "Sam, site lead: 'Crews start early only if parts arrive the day before. A late van wastes the morning.' He agrees.";
    expect(wholeStatementIn(two, "Sam, site lead: 'Crews start early only if parts arrive the day before. A late van wastes the morning.'")).toBe(true);
  });
  it('CONTRAST: the quoted words without their speaker, or a quoted fragment mid-sentence, are still not whole', () => {
    const message = "We fit kitchens. Sam, site lead: 'Crews start early only if parts arrive the day before.' He assumes the van is free.";
    expect(wholeStatementIn(message, 'Crews start early only if parts arrive the day before.')).toBe(false);
    expect(wholeStatementIn(message, "'Crews start early only if parts arrive the day before.'")).toBe(false);
    expect(wholeStatementIn("Sam said 'parts first' and left.", "Sam said 'parts first'")).toBe(false);
  });
  it('words the message never holds, and a non-string quote, are not whole', () => {
    expect(wholeStatementIn('Please size the links.', 'Price has a weak effect on MRR.')).toBe(false);
    expect(wholeStatementIn('Price has a weak effect on MRR.', undefined)).toBe(false);
    expect(wholeStatementIn('Price has a weak effect on MRR.', '')).toBe(false);
  });
});

describe('namesBothEnds: the text names both ends of the directed link', () => {
  it('both labels named → binds; the same text does not bind a link it names one end of', () => {
    expect(namesBothEnds('Price has a weak effect on MRR.', nodes, 'price', 'mrr')).toBe(true);
    expect(namesBothEnds('Price has a weak effect on MRR.', nodes, 'quality', 'mrr')).toBe(false);
  });
  it('one named end never binds', () => {
    expect(namesBothEnds('Price is weak.', nodes, 'price', 'mrr')).toBe(false);
  });
});
