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

  // DL 21 Oct (Codex r4 on #3522): a limit, an option's status and an outcome had no words in the core model; and a served
  // brief authored a factor for an option itself being taken.
  it('a limit, a ruled-out option and an outcome are told to the AI; an option itself being taken is never a factor', () => {
    expect(sent).toContain('A limit the person must stay within on this quantity, beside the aim');
    expect(sent).toContain('"enum":["<=",">=","<",">"]');
    expect(sent).toContain('infeasible when the person rules the option out but keeps it in view');
    expect(sent).toContain('"enum":["feasible","infeasible","removed"]');
    expect(sent).toContain('outcome for a result that other factors lead to and that in turn moves the aim');
    expect(sent).toContain('"enum":["factor","outcome"]');
    expect(sent).toContain('Never a factor for the option itself being taken');
    expect(sent).toContain('The only on or off setting is a step a risk\'s mitigation names, set to 1.');
  });
});
