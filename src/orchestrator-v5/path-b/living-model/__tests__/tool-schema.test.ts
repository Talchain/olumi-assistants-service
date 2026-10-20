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
    expect(sent).toContain('prerequisite: something that must hold or be resolved before the listed items apply');
    expect(sent).toContain('assumption: a premise the result is worked out under and must be said beside it');
  });
});
