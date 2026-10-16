/** C5: a new deliverable cannot silently replace the saved goal. Initial construction is still available for new scenarios. */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/funding-0b62faab-served-draft.json', import.meta.url), 'utf8'));
describe('C5 truthful unsupported deliverable correction', () => {
  it.each([fx.deliver_turn, 'We need an MVP version ready to pilot with initial customers within 6 months.'])(
    'keeps the complete request and saved model; no redraft/provider/card/write: %s', async message => {
      const graph = structuredClone(fx.graph);
      let writes = 0;
      const provider = vi.fn(async () => { throw new Error('A saved correction must not draft a whole model'); });
      const dispatch: InternalDispatch = async path => {
        if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'held', brief_text: fx.brief_text } };
        if (path.endsWith('/graph/register')) writes++;
        throw new Error(`Unexpected dispatch: ${path}`);
      };
      const proposals = new ProposalStore();
      const caps = createAgentCapabilities(dispatch, proposals, provider);
      const deliverable = message === fx.deliver_turn ? 'a high-quality MVP' : 'an MVP version ready to pilot with initial customers';
      const result = await caps.proposeGoalDeadline!({ scenario_id: fx.scenario_id, authenticated_user_id: null, request_id: 'c5-deadline',
        user_turn_text: message, user_text: `${fx.brief_text}\n${message}`, user_text_complete: true, verified_user_messages: [message] },
      { deadline_words: 'within 6 months', deliverable, rationale: message });
      expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'unsupported_goal_change' });
      expect(result.detail).toContain('complete request and its conditions');
      expect(result.detail).toContain('qualitative reasoning');
      expect(result).not.toHaveProperty('proposal_id');
      expect(provider).not.toHaveBeenCalled(); expect(writes).toBe(0); expect(proposals.size()).toBe(0);
      expect(graph).toEqual(fx.graph);
    });
});
