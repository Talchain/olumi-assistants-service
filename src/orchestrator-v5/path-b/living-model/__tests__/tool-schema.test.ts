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
});
