/**
 * ⭐ THE MODEL IS TOLD THAT THE CANVAS'S "Slight" IS `weak`, AND ASKS IN THE CANVAS'S WORDS (Canvas #70 5847910497).
 *
 * Served on UI `cd6a82e4` + CEE `92c2e34` (Canvas witness `slight-cd6a82e4-92c2e34-b`, OpenAI only):
 *   user   "The link from Monthly Pro plan price to Price-driven churn is slight."
 *   model  (no tool call) "Does 'slight' mean weak in the model's bands?"
 *   user   "Yes."
 *   tool   propose_link_strength { strength: 'weak' } → refused `strength_not_stated` ("Yes." names no band — correct)
 *   model  "Please say 'weak', 'moderate', 'strong', or 'very strong'…" — a word the canvas never shows.
 * `bandTheUserWrote` already grounds "slight" in band position (#2008); the gap was that the model did not know it.
 * Whether the model now calls the tool on the first turn is model behaviour: the served witness is its proof. These rows
 * pin what the model is TOLD and what the user is ASKED — the two things this change owns.
 */
import { describe, it, expect } from 'vitest';
import { AGENT_TOOLS, SLIGHT_IS_WEAK } from '../runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { HOST_TOOL_CONTRACT } from '../coach-route-v0_2.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440078';
const graph = {
  nodes: [
    { id: 'dec', kind: 'decision', label: 'Price decision' },
    { id: 'price', kind: 'factor', label: 'Monthly Pro plan price' },
    { id: 'churn', kind: 'factor', label: 'Price-driven churn' },
    { id: 'mrr', kind: 'goal', label: 'MRR' },
    { id: 'subs', kind: 'factor', label: 'Pro subscribers' },
  ],
  edges: [
    { from: 'price', to: 'churn', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'cee_hypothesis' }, defaulted: true },
    { from: 'churn', to: 'mrr', strength: { mean: -0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative', provenance: { source: 'cee_hypothesis' }, defaulted: true },
  ],
};
const d: InternalDispatch = async (path) => (path.endsWith('/graph') ? { status: 200, json: { graph, graph_hash: 'h1' } } : { status: 500, json: {} });
const said = (text: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: text, user_turn_text: text });
const LINK = { from_label: 'Monthly Pro plan price', to_label: 'Price-driven churn', strength: 'weak' as const, rationale: 'The user said so.' };
const tool = (name: string) => AGENT_TOOLS.find((t) => t.name === name)!;

describe('the model is told "Slight" IS `weak`, and asks for a band in the canvas\'s words', () => {
  it('RED: both link tools say the canvas\'s Slight is `weak`, never to ask whether it is, and to ask with the canvas\'s words', () => {
    for (const name of ['propose_link_strength', 'propose_model_change']) {
      const description = String(tool(name).description);
      expect(description, name).toContain(SLIGHT_IS_WEAK);
      expect(description, name).toMatch(/lowest band Slight: when the user calls a link slight, that IS `weak`/);
      expect(description, name).toMatch(/never ask whether slight means weak/);
      expect(description, name).toMatch(/slight, moderate, strong or very strong/);
    }
    // The host instruction lists the words too, and it outranks a tool description: it says the same.
    expect(HOST_TOOL_CONTRACT).toMatch(/call propose_link_strength with their word \(weak, moderate, strong or very strong; the canvas calls weak “slight”, so a link the user calls slight is weak — never ask whether slight means weak\)/);
    // The wire value is unchanged: the enum stays the product's four bands.
    expect((tool('propose_link_strength').parameters as { properties: Record<string, { enum?: string[] }> }).properties['strength']?.enum)
      .toEqual(['weak', 'moderate', 'strong', 'very strong']);
  });

  it('RED (the served follow-up): "Yes." names no band → refused, and the user is asked with slight, never with weak', async () => {
    const p = await createAgentCapabilities(d, new ProposalStore()).proposeLinkStrength!(said('Yes.'), LINK);
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'strength_not_stated' }));
    expect(String(p.detail)).toContain('slight, moderate, strong or very strong');
    expect(String(p.detail)).not.toContain('weak,');
  });

  it('RED (R&C #70 5847917821): an unreadable band is refused, and the user is asked in the canvas\'s words; the enum value is named only as the tool\'s', async () => {
    const p = await createAgentCapabilities(d, new ProposalStore()).proposeLinkStrength!(said('It is slight.'), { ...LINK, strength: 'tiny' as never });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'unreadable_strength' }));
    expect(String(p.detail)).toContain('in the canvas\u2019s words: slight, moderate, strong or very strong');
    expect(String(p.detail)).toContain('weak (the canvas\u2019s Slight)');
  });

  it('CONTROL (passes at base, #2008): the served first turn "… is slight." with `weak` prepares the change as the user\'s', async () => {
    const p = await createAgentCapabilities(d, new ProposalStore()).proposeLinkStrength!(
      said('The link from Monthly Pro plan price to Price-driven churn is slight.'), LINK);
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(p).toHaveProperty('proposal_id');
  });

  it('CONTRAST: "Lower the link … slightly." is a change, not a band the user named → refused, nothing prepared', async () => {
    const p = await createAgentCapabilities(d, new ProposalStore()).proposeLinkStrength!(
      said('Lower the link from Monthly Pro plan price to Price-driven churn slightly.'), LINK);
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, refusal: 'strength_not_stated' }));
    expect(p).not.toHaveProperty('proposal_id');
  });
});

describe('what the user READS about a link says "slight", never the enum\'s `weak` (joined run, UI cd6a82e4 + CEE 5f941f2)', () => {
  // Served: the model prepared the change on the first turn, but the receipt the user read was
  // "Recorded … as weak (0.1 on Olumi's 0 - 1 scale)" beside a canvas pill that says Slight.
  it('RED: a link-strength preview, the tool result the model relays and the receipt label all say slight', async () => {
    const p = await createAgentCapabilities(d, new ProposalStore()).proposeLinkStrength!(
      said('The link from Monthly Pro plan price to Price-driven churn is slight.'), LINK);
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true }));
    const r = p as unknown as { public_label: string; note: string; link: { was: { band: string }; becomes: { band: string } } };
    // The public label is what the approval's "Recorded …" receipt is made from.
    expect(r.public_label).toContain('as slight, as your own estimate');
    expect(r.public_label, 'band words only (AIQ 5923931082)').not.toMatch(/0\.1|0–1/);
    expect(r.note).toContain('recorded as slight');
    expect(r.link.becomes.band).toBe('slight');
    expect(r.link.was.band).toBe('strong');
    expect(JSON.stringify(r)).not.toMatch(/\bweak\b/);
  });

  it('RED: a NEW link at the lowest band is labelled slight too', async () => {
    const p = await createAgentCapabilities(d, new ProposalStore()).proposeModelChange(
      said('Monthly Pro plan price has a slight effect on Pro subscribers.'),
      { from_label: 'Monthly Pro plan price', to_label: 'Pro subscribers', direction: 'negative', strength: 'weak', rationale: 'The user said so.' });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true }));
    expect(String((p as { public_label?: unknown }).public_label)).toBe('Connect "Monthly Pro plan price" to "Pro subscribers" (negative) as slight, your own estimate');
  });

  it('CONTRAST: the other bands read exactly as before', async () => {
    const p = await createAgentCapabilities(d, new ProposalStore()).proposeLinkStrength!(
      said('The link from Monthly Pro plan price to Price-driven churn is very strong.'), { ...LINK, strength: 'very strong' as const });
    expect(String((p as { public_label?: unknown }).public_label)).toContain('as very strong, as your own estimate');
  });
});
