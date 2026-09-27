/**
 * ⛔ A TOOL'S ARGUMENTS ARE AN OBJECT, OR NOTHING RUNS (X2 contract, Codex-Capabilities #70 5858831838, draft #2123).
 *
 * `dispatchTool` parsed the model's raw arguments and cast the result straight to an object. JSON `null` (valid JSON,
 * so no parse error) then reached `authorise_change` (`args.proposal_id`) and `offer_public_research` (`args.query`)
 * and crashed them instead of refusing; an array, a number or a string reached every capability as its "arguments".
 * The rule: whatever parses to anything but a plain object is refused at the parse boundary, for EVERY tool, with the
 * same refusal as unparsable text — and no capability is reached.
 */
import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS, dispatchTool, type AgentCapabilities, type AgentToolContext } from '../runtime/agent-tools.js';

const ctx: AgentToolContext = { scenario_id: '11111111-1111-4111-8111-111111111111', authenticated_user_id: 'owner', request_id: 'args-object' };

/** Every capability a stub that records its call; `offer_public_research` is handled by the dispatcher itself. */
function recordingCaps() {
  const called: string[] = [];
  const caps = new Proxy({} as AgentCapabilities, {
    get: (_t, prop) => (typeof prop === 'string'
      ? async (_c: unknown, a: unknown) => { called.push(prop); return { ok: true, mutated: false, echoed: a }; }
      : undefined),
  });
  return { caps, called };
}

const NOT_OBJECTS = ['null', '[]', '[{"proposal_id":"prop_x"}]', '42', '"prop_x"', 'true'] as const;

describe('a tool call whose arguments are not an object is refused before any capability runs', () => {
  it.each(AGENT_TOOLS.map((t) => t.name))('RED: %s refuses every non-object argument, and nothing is called', async (name) => {
    for (const raw of NOT_OBJECTS) {
      const { caps, called } = recordingCaps();
      const r = await dispatchTool(name, raw, ctx, caps);
      expect(r, `${name} ${raw}`).toMatchObject({ ok: false, mutated: false, refusal: 'unparsable_arguments' });
      expect(called, `${name} ${raw}: no capability reached`).toEqual([]);
    }
  });

  it('CONTROL: an object (even an empty one) still reaches its capability', async () => {
    const { caps, called } = recordingCaps();
    await dispatchTool('authorise_change', '{"proposal_id":"prop_x"}', ctx, caps);
    await dispatchTool('get_canonical_state', '{}', ctx, caps);
    expect(called).toEqual(['authoriseChange', 'getCanonicalState']);
  });

  it('CONTROL: text that is not JSON keeps its refusal', async () => {
    const { caps, called } = recordingCaps();
    await expect(dispatchTool('authorise_change', '{"proposal_id":', ctx, caps)).resolves.toMatchObject({ ok: false, refusal: 'unparsable_arguments' });
    expect(called).toEqual([]);
  });
});
