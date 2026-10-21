import { tool } from '@openai/agents';
import { describe, expect, it } from 'vitest';
import { BuildModelParams } from '../../tools/draft-tool.js';

/** What the AI actually receives: the strict JSON schema the SDK sends for the draft tool, never the source comments. */
const sent = JSON.stringify(tool({ name: 'build_model_from_brief', description: 'd', parameters: BuildModelParams, execute: async () => '' }).parameters);

describe('thin core: the link-unit convention reaches the AI in the tool schema it is sent', () => {
  it('KA1 served 20 Oct: a link\'s unit is the `to` item\'s own unit, never "per +1 …"', () => {
    expect(sent).toContain('never add \\"per …\\"');
    expect(sent).toContain('The change in `to` for each +1 of `from`, in the unit of `to`.');
  });

  it('an exact effect is told apart from a stated figure, in the schema the AI is sent', () => {
    expect(sent).toContain('exact: the person says it is exactly this, with no variation');
  });

  it('R2 on 6e4d2305: an option\'s own effect is a link from the option; a party is named word for word; a condition is someone\'s prerequisite', () => {
    expect(sent).toContain('or an option id when the person states that option');
    expect(sent).toContain('exactly as the user names them, word for word');
    expect(sent).toContain('prerequisite: a requirement that must actually be met first');
    expect(sent).toContain('An open question about whether, how fully or how soon an effect happens is a challenge, or an assumption when the result is worked out under it; never a prerequisite.');
    expect(sent).toContain('assumption: a concrete modelling premise the result is actually worked out under');
    expect(sent).toContain('Decide by what it does to the calculation, never by who raised it.');
  });

  // Served F2 (CEE f51249ba, 21 Oct): the drafter copied the mitigation's "0 = not in place, 1 = in place" into the switch's
  // unit, so the mapper rightly refused the switch (a unit says a quantity) and the whole risk was lost.
  it('a step an option switches on has no unit, told plainly, with no "0 = … 1 = …" text the AI could copy into one', () => {
    expect(sent).toContain('Always null for something that is simply on or off');
    expect(sent).toContain('The step is on or off, so its factor has no unit (null)');
    expect(sent).not.toMatch(/\d\s*=\s*not in place|\d\s*=\s*in place/);
  });
});
