/**
 * ⛔ A CHANGE THE PRODUCT REFUSES WITH ITS OWN SENTENCE IS SAID, NEVER "COULD NOT" (#1990 review, Runtime follow-up).
 *
 * The typed add-option turn can come back 200 with no hold and the product's own refusal sentence (for example the
 * same-levels refusal, when the model moved between the Agent's read and the turn). The Agent is handed that sentence
 * to relay; a bare "could not be prepared" left the user with nothing to act on.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const paulGraph = JSON.parse(readFileSync(new URL('./fixtures/paul-cbd15f83-stored-graph.json', import.meta.url), 'utf8')) as unknown;
const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400c9', authenticated_user_id: null, request_id: 'r', user_text: 'Add an option: raise to £61 at release.' };
const option = {
  label: 'Raise to £61 at release',
  acts_on: [{ factor_label: 'Pro plan price', direction: 'positive', level: { value: 61, unit: '£' } }],
  rationale: 'the user asked for it',
};
const productSaid = 'That option would set exactly the same levels as "Raise Pro to £61", so the analysis could not tell them apart. I haven’t added it.';

const withTurnReply = (json: Record<string, unknown>) => {
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: paulGraph, graph_hash: 'h0' } };
    return { status: 200, json };
  };
  return createAgentCapabilities(d, new ProposalStore());
};

describe('the product\'s own refusal of a typed add-option is relayed', () => {
  it('RED: 200 with no hold and the product\'s sentence → the Agent is given that sentence', async () => {
    const r = await withTurnReply({ assistant_text: productSaid, suggested_actions: [] }).proposeNewOption(ctx, option as never) as { ok?: boolean; refusal?: string; detail?: string };
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('not_prepared');
    expect(r.detail).toContain(`Olumi said: "${productSaid}"`);
  });

  it('CONTRAST: no sentence at all → the plain "could not prepare" line, unchanged', async () => {
    const r = await withTurnReply({ suggested_actions: [] }).proposeNewOption(ctx, option as never) as { detail?: string };
    expect(r.detail).toBe('Olumi could not prepare that as one change, so nothing was added. Tell the user plainly; do not retry it in other words.');
  });
});
