/**
 * ⭐ SLICE C3 — "PROPOSE MY READING → APPROVE": the user's own words become a typed band the user approves.
 *
 * Measured on Paul's served transcript (27 Sep): he typed "our customers' price sensitivity is very high, and we've
 * seen our churn increase by 15%…". The Agent called propose_link_strength and was refused `strength_not_stated`,
 * because `bandTheUserWrote` accepts only the literal band words. It asked him to pick a band; he replied "Isn't it
 * obvious that 'very high' is the same as 'very strong'?"; refused again; only "update it to very strong" worked —
 * four turns for one action.
 *
 * RULING (ChatGPT 5854968869 P3B): "ordinary language may be mapped to a proposed typed interpretation for explicit
 * approval rather than requiring the user's exact enum wording". Genuine two-way ambiguity must still ask once.
 *
 * So the Agent may give the user's exact phrase as `from_words` with its reading in `strength`. It is admitted ONLY
 * when that phrase is written, verbatim, in THIS turn's typed words, neither asked nor denied — the Agent cannot
 * invent the user's words — and the proposal carries the reading (`interpretation`), so the approve button says
 * "Record as very strong (your "very high")" and the user approves the reading itself.
 *
 * Every event the Agent sends is parsed by the REAL boundary schema (`OrchestratorTurnPayloadSchema`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OrchestratorTurnPayloadSchema } from '@talchain/schemas/boundary';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { AGENT_TOOLS } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { APPROVAL_LABEL_MAX, approvalChipsFor } from '../approval-chips.js';

const SCENARIO = '550e8400-e29b-41d4-a716-4466554400c3';
// Paul's own words, verbatim from the served transcript of 27 Sep.
const PAUL = 'Talking to the team, our customers’ price sensitivity is very high, and we’ve seen our churn increase by 15% when we made our last price increase.';
const PAUL_ASCII = "Talking to the team, our customers' price sensitivity is very high, and we've seen our churn increase by 15% when we made our last price increase.";
const said = (text: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: text, user_turn_text: text });
const READING = { from_label: 'Price sensitivity', to_label: 'Monthly churn', strength: 'very strong' as const, from_words: 'very high', rationale: 'Price sensitivity is very high; churn rose 15% after the last price rise.' };

type Edge = { from: string; to: string; strength: { mean: number; std: number }; exists_probability: number; effect_direction: 'positive' | 'negative'; provenance?: { source: string }; defaulted?: boolean };
const NODES = [
  { id: 'dec', kind: 'decision', label: 'Pricing decision' },
  { id: 'ps', kind: 'factor', label: 'Price sensitivity' },
  { id: 'churn', kind: 'factor', label: 'Monthly churn' },
];

/** One stored graph; both link writers modelled only as far as their contracts state them. */
function world(withLink: boolean) {
  let edges: Edge[] = withLink
    ? [{ from: 'ps', to: 'churn', strength: { mean: 0.3, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'cee_hypothesis' }, defaulted: true }]
    : [];
  let rev = 1;
  const sent: Record<string, unknown>[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: NODES, edges }, graph_hash: `h${rev}` } };
    sent.push(body as Record<string, unknown>);
    const ev = (body as { event?: Record<string, unknown> }).event ?? {};
    if (ev['kind'] === 'edge_strength_edit') {
      const mag = Number(ev['magnitude']);
      edges = edges.map((x) => (x.from === ev['from'] && x.to === ev['to'] ? { ...x, strength: { ...x.strength, mean: mag }, provenance: { source: 'user_specified' }, defaulted: false } : x));
      rev += 1;
      return { status: 200, json: { assistant_text: 'Updated.', graph_hash: `h${rev}` } };
    }
    if (ev['kind'] === 'structural_add_edge') {
      const mag = Number(ev['magnitude']);
      edges = [...edges, { from: String(ev['from']), to: String(ev['to']), strength: { mean: mag, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'user_specified' } }];
      rev += 1;
      return { status: 200, json: { assistant_text: 'Connected.', graph_hash: `h${rev}` } };
    }
    throw new Error(`unexpected dispatch ${path}`);
  };
  return { d, sent, edges: () => edges };
}

const parsesOnTheWire = (body: Record<string, unknown>) => {
  const r = OrchestratorTurnPayloadSchema.safeParse(body);
  expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
};

describe('⭐ propose_link_strength: the user\'s own words are proposed as a typed band they approve (C3)', () => {
  it('RED (1): "very high" + strength "very strong" + from_words → ONE proposal carrying the reading; approve → edge_strength_edit at very strong\'s midpoint (0.85)', async () => {
    for (const text of [PAUL, PAUL_ASCII]) {
      const w = world(true);
      const store = new ProposalStore();
      const caps = createAgentCapabilities(w.d, store);
      const p = await caps.proposeLinkStrength!(said(text), READING as never);
      expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
      expect(typeof p.proposal_id).toBe('string');
      expect(p.interpretation, 'the tool result names the reading').toEqual({
        field: 'band', from_words: 'very high', reading: 'very strong', shown_as: 'Record as very strong (your "very high")',
      });
      // The STORED proposal carries the same reading, so what is approved is what was shown.
      expect(store.get(String(p.proposal_id))?.interpretation).toEqual(p.interpretation);
      expect(String(p.public_label)).toMatch(/very strong/);
      expect(String(p.public_label)).toContain('your "very high"');
      expect(w.sent, 'a proposal writes nothing').toEqual([]);
      const r = await caps.authoriseChange(said('Yes.'), { proposal_id: String(p.proposal_id) });
      expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true }));
      expect(w.sent).toHaveLength(1);
      parsesOnTheWire(w.sent[0]!);
      expect(w.sent[0]!['event']).toEqual({ kind: 'edge_strength_edit', from: 'ps', to: 'churn', intent: 'set', direction_intent: 'preserve', magnitude: 0.85, expected: { mean: 0.3, effect_direction: 'positive' } });
      expect(w.edges()[0]!.provenance?.source).toBe('user_specified');
    }
  });

  it('CONTRAST (2, anti-fabrication): the same call when the user never wrote "very high" → strength_not_stated, nothing proposed, nothing sent', async () => {
    for (const text of ['Price sensitivity matters.', 'Our churn rose by 15% after the last price rise.', 'Yes.', '']) {
      const w = world(true);
      const store = new ProposalStore();
      const p = await createAgentCapabilities(w.d, store).proposeLinkStrength!(said(text), READING as never);
      expect(p, `${JSON.stringify(text)} → ${JSON.stringify(p)}`).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'strength_not_stated' }));
      expect(p).not.toHaveProperty('proposal_id');
      expect(p).not.toHaveProperty('interpretation');
      expect(store.outstanding(SCENARIO, null)).toEqual([]);
      expect(w.sent).toEqual([]);
    }
  });

  it('CONTRAST (2b): "very high" written only in an EARLIER turn, and this turn is "Yes." → refused (this turn\'s words only)', async () => {
    const w = world(true);
    const store = new ProposalStore();
    const ctx = { ...said('Yes.'), user_text: `${PAUL}\nYes.` };
    const p = await createAgentCapabilities(w.d, store).proposeLinkStrength!(ctx, READING as never);
    expect(p.refusal).toBe('strength_not_stated');
    expect(store.outstanding(SCENARIO, null)).toEqual([]);
  });

  it('CONTRAST (3): a band the user wrote literally ("it\'s very strong") → the unchanged path: a proposal WITHOUT an interpretation', async () => {
    for (const extra of [{}, { from_words: 'very strong' }]) {
      const w = world(true);
      const store = new ProposalStore();
      const { from_words: _fw, ...literal } = READING;
      const p = await createAgentCapabilities(w.d, store).proposeLinkStrength!(said('The link from price sensitivity to churn — it’s very strong.'), { ...literal, ...extra } as never);
      expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
      expect(p).not.toHaveProperty('interpretation');
      expect(store.get(String(p.proposal_id))).not.toHaveProperty('interpretation');
      expect(String(p.public_label)).not.toContain('your "');
    }
  });

  it('(4) the user\'s words ASKED or DENIED are no reading of theirs → refused, nothing proposed', async () => {
    for (const text of ['Is it very high?', 'It’s not very high.', "It's not very high.", 'Is our price sensitivity very high', 'I doubt price sensitivity is very high.']) {
      const w = world(true);
      const store = new ProposalStore();
      const p = await createAgentCapabilities(w.d, store).proposeLinkStrength!(said(text), READING as never);
      expect(p.refusal, text).toBe('strength_not_stated');
      expect(store.outstanding(SCENARIO, null)).toEqual([]);
      expect(w.sent).toEqual([]);
    }
  });

  it('(4b) from_words must be whole words the user wrote, and cannot re-read a band the user named literally as another band', async () => {
    for (const [text, strength, fromWords] of [
      [PAUL, 'very strong', 'ery hig'], // not whole words
      [PAUL, 'very strong', '  '], // no words at all
      ['Price sensitivity has a strong effect on churn.', 'very strong', 'strong effect'], // the user said strong, not very strong
      ['Price sensitivity has a very strong effect on churn.', 'strong', 'very strong effect'], // "very strong" never grounds strong
    ] as const) {
      const w = world(true);
      const p = await createAgentCapabilities(w.d, new ProposalStore()).proposeLinkStrength!(said(text), { ...READING, strength, from_words: fromWords } as never);
      expect(p.refusal, `${strength} from "${fromWords}"`).toBe('strength_not_stated');
      expect(w.sent).toEqual([]);
    }
  });

  it('(4c) a reading that fits: case and spacing differences in from_words are the same words', async () => {
    const w = world(true);
    const p = await createAgentCapabilities(w.d, new ProposalStore()).proposeLinkStrength!(said(PAUL), { ...READING, from_words: 'Very   HIGH' } as never);
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect((p.interpretation as { from_words: string }).from_words).toBe('Very   HIGH');
  });

  it('(4d) the reading is part of the proposal\'s identity: an altered reading on a stored proposal is refused (integrity_failed)', async () => {
    const w = world(true);
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeLinkStrength!(said(PAUL), READING as never);
    const stored = store.get(String(p.proposal_id))!;
    const tampered = new ProposalStore();
    tampered.put({ ...stored, interpretation: { ...stored.interpretation!, from_words: 'extremely high' } });
    expect(tampered.authorise({ proposal_id: stored.proposal_id, scenario_id: SCENARIO, authenticated_user_id: null, current_graph_identity_hash: stored.base_graph_identity_hash }).status).toBe('integrity_failed');
  });
});

describe('⭐ the approve button shows the reading the user approves (C3)', () => {
  it('RED (5): the chip for (1) names "very strong" within APPROVAL_LABEL_MAX, and its detail says your "very high"', async () => {
    const w = world(true);
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeLinkStrength!(said(PAUL), READING as never);
    const calls = [{ name: 'propose_link_strength', ok: true, mutated: false, proposal_id: String(p.proposal_id) }];
    const chips = approvalChipsFor(calls, (id) => ({ proposal: store.get(id), result: id === p.proposal_id ? p : undefined }));
    const approve = chips[0]!;
    expect(approve.id).toBe(`agent-approve-proposal:${String(p.proposal_id)}`);
    expect(approve.label.length).toBeLessThanOrEqual(APPROVAL_LABEL_MAX);
    expect(approve.label).toMatch(/very strong/);
    expect(approve.detail).toContain('your "very high"');
    expect(approve.message).toBe('Yes, record that.');
  });

  it('(5b) a longer phrase keeps the button short ("Record as very strong") and the full reading in detail', async () => {
    const LONG = 'Honestly our customers are extremely sensitive to price, far more than we expected.';
    const w = world(true);
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeLinkStrength!(said(LONG), { ...READING, from_words: 'extremely sensitive to price' } as never);
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const [approve] = approvalChipsFor([{ name: 'propose_link_strength', ok: true, mutated: false, proposal_id: String(p.proposal_id) }], (id) => ({ proposal: store.get(id), result: p }));
    expect(approve!.label).toBe('Record as very strong');
    expect(approve!.detail).toBe('Record as very strong (your "extremely sensitive to price")');
  });

  it('CONTRAST (5c): a literal band keeps today\'s button, with no detail', async () => {
    const w = world(true);
    const store = new ProposalStore();
    const { from_words: _fw, ...literal } = READING;
    const p = await createAgentCapabilities(w.d, store).proposeLinkStrength!(said('It is very strong.'), literal as never);
    const [approve] = approvalChipsFor([{ name: 'propose_link_strength', ok: true, mutated: false, proposal_id: String(p.proposal_id) }], (id) => ({ proposal: store.get(id), result: p }));
    expect(approve!.label).toBe('Record this link');
    expect(approve).not.toHaveProperty('detail');
  });

  it('(5d) the button never trusts a result whose reading differs from the stored proposal\'s', async () => {
    const w = world(true);
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeLinkStrength!(said(PAUL), READING as never);
    const forged = { ...p, interpretation: { ...(p.interpretation as object), shown_as: 'Record as slight (your "very high")' } };
    const [approve] = approvalChipsFor([{ name: 'propose_link_strength', ok: true, mutated: false, proposal_id: String(p.proposal_id) }], (id) => ({ proposal: store.get(id), result: forged }));
    expect(approve!.label).toBe('Record this link');
    expect(approve).not.toHaveProperty('detail');
  });
});

describe('⭐ propose_model_change: a NEW link\'s band from the user\'s own words (C3)', () => {
  const NEW_LINK = { from_label: 'Price sensitivity', to_label: 'Monthly churn', direction: 'positive' as const, strength: 'very strong' as const, from_words: 'very high', rationale: 'x' };

  it('RED (6): "very high" + from_words → a proposal carrying the reading; approve → structural_add_edge at 0.85', async () => {
    const w = world(false);
    const store = new ProposalStore();
    const caps = createAgentCapabilities(w.d, store);
    const p = await caps.proposeModelChange(said(PAUL), NEW_LINK as never);
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(p.interpretation).toEqual({ field: 'band', from_words: 'very high', reading: 'very strong', shown_as: 'Record as very strong (your "very high")' });
    expect(store.get(String(p.proposal_id))?.interpretation).toEqual(p.interpretation);
    const [approve] = approvalChipsFor([{ name: 'propose_model_change', ok: true, mutated: false, proposal_id: String(p.proposal_id) }], (id) => ({ proposal: store.get(id), result: p }));
    expect(approve!.label.length).toBeLessThanOrEqual(APPROVAL_LABEL_MAX);
    expect(approve!.label).toMatch(/very strong/);
    expect(approve!.detail).toContain('your "very high"');
    const r = await caps.authoriseChange(said('Yes.'), { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true }));
    parsesOnTheWire(w.sent[0]!);
    expect(w.sent[0]!['event']).toEqual(expect.objectContaining({ kind: 'structural_add_edge', from: 'ps', to: 'churn', magnitude: 0.85, effect_direction: 'positive' }));
  });

  it('CONTRAST (6b): from_words the user never wrote, or asked about → strength_not_stated, nothing proposed', async () => {
    for (const text of ['Price sensitivity drives churn.', 'Is price sensitivity very high?']) {
      const w = world(false);
      const store = new ProposalStore();
      const p = await createAgentCapabilities(w.d, store).proposeModelChange(said(text), NEW_LINK as never);
      expect(p.refusal, text).toBe('strength_not_stated');
      expect(store.outstanding(SCENARIO, null)).toEqual([]);
      expect(w.sent).toEqual([]);
    }
  });
});

describe('the Agent is told how to propose its reading, and when to ask', () => {
  it('both link tools declare `from_words` as the user\'s exact phrase', () => {
    for (const name of ['propose_link_strength', 'propose_model_change']) {
      const tool = AGENT_TOOLS.find((t) => t.name === name)!;
      const props = (tool.parameters as { properties: Record<string, { type?: string; description?: string }>; required?: string[] }).properties;
      expect(props['from_words']?.type, name).toBe('string');
      expect(String(props['from_words']?.description), name).toMatch(/exact phrase/);
      expect((tool.parameters as { required?: string[] }).required ?? [], name).not.toContain('from_words');
    }
  });

  it('the route\'s instructions: propose a reading with from_words; ask only when the words fit two bands or name none; never re-ask an answered question', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(route).toContain('propose your reading with `from_words`');
    expect(route).toMatch(/Ask only when their words fit two bands equally \(for example \\u201cfairly strong\\u201d, between moderate and strong\) or name no strength at all/);
    expect(route).toMatch(/never ask again a question the user has already answered/);
  });
});
