/**
 * G3 (VERIFY-2da89781 T02/T03): a user names the OPTION ("the corporate deal"), not its switch factor ("Corporate deal active").
 * `statementBoundTo` binds a link's statement by that option's name only when the option sets that ONE factor and the statement
 * names the link's target too. Contrasts: an option that sets two factors, another option's name, no target named. Pure.
 */
import { describe, expect, it } from 'vitest';
import { statementBoundTo } from '../read.js';

type Rec = Record<string, unknown>;
const graph = (dealSets: Rec): Rec => ({
  nodes: [
    { id: 'goal', kind: 'goal', label: 'weekday attendance' },
    { id: 'deal_on', kind: 'factor', label: 'Corporate deal active' },
    { id: 'flyers', kind: 'factor', label: 'Flyers delivered' },
    { id: 'deal', kind: 'option', label: 'Corporate wellness deal', interventions: dealSets },
    { id: 'drop', kind: 'option', label: 'Flyer drop', interventions: { flyers: 1 } },
  ],
  edges: [{ from: 'deal_on', to: 'goal' }, { from: 'flyers', to: 'goal' }],
});
const LINK = { kind: 'link', id: 'deal_on', to_id: 'goal', field: 'effect' } as const;
const SAID = 'The corporate deal could lift weekday attendance by somewhere between 4 and 7 points.';

describe('a link is bound by the ONE option that sets its source, and its named target', () => {
  it('⭐ the option sets only this factor, and the target is named: bound', () => {
    expect(statementBoundTo(graph({ deal_on: 1 }), LINK, SAID)).toBe('bound');
  });
  it('CONTRAST: the option sets TWO factors, so its name points at no one link: not bound', () => {
    expect(statementBoundTo(graph({ deal_on: 1, flyers: 1 }), LINK, SAID)).not.toBe('bound');
  });
  it('CONTRAST: another option\'s name never binds this link', () => {
    expect(statementBoundTo(graph({ deal_on: 1 }), LINK, 'The flyer drop could lift weekday attendance by somewhere between 4 and 7 points.')).not.toBe('bound');
  });
  it('CONTRAST: the option named but not the target: not bound', () => {
    expect(statementBoundTo(graph({ deal_on: 1 }), LINK, 'The corporate deal could add somewhere between 4 and 7 points.')).not.toBe('bound');
  });
});
