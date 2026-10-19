/**
 * ⭐ LEAN CORE P2 on the two chat paths a fresh Codex review found open on #3395 @6fd4abb3 (CODEX-REVIEW-3395 B1, B2): the AI's own
 * speaker reading (`QUOTE_SPEAKER`) reaches the ONE statement verifier (`verifyStatement`, which only subtracts credit) through the
 * real tool dispatch. B1: the statement door (`propose_statement` statements). B2: an assumption the AI claims as the user's figure
 * WITH its statement (`propose_assumptions`), whose human credit now goes through that same verifier. Synthetic words only.
 */
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';

type Rec = Record<string, unknown>;
const SCENARIO = '33333333-3333-4333-8333-333333333333';
const graph = { nodes: [
  { id: 'goal', kind: 'goal', label: 'Launch readiness' },
  { id: 'invest', kind: 'factor', label: 'Investment spend', observed_state: { value: 0.2, raw_value: 20, unit: '%', source: 'cee_inference' } },
  { id: 'effort', kind: 'factor', label: 'Team effort', observed_state: { value: 30, raw_value: 30, unit: 'hours a week', source: 'cee_inference' } },
], edges: [
  { from: 'invest', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  { from: 'effort', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
] };
const world = () => {
  const store = new ProposalStore();
  const caps = createAgentCapabilities(async (path) => {
    if (!path.endsWith('/graph')) throw new Error(`No write or Run is authorised here: ${path}`);
    return { status: 200, json: { graph: structuredClone(graph), graph_hash: 'h0' } };
  }, store);
  return { caps, store };
};
const ctx = (said: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'p2-paths', user_text: said, user_turn_text: said,
  verified_user_messages: [said], user_text_complete: true });

describe('B1: the statement door hands the AI speaker reading to the ONE verifier', () => {
  const REPORT = 'A colleague said: Investment spend covers setup and ongoing operations.';
  const OWN = 'Investment spend covers setup and ongoing operations.';
  const ask = (said: string, speaker: string) => dispatchTool('propose_statement', JSON.stringify({
    subject: { kind: 'factor', id: 'invest', label: 'Investment spend', field: 'measure' },
    statements: [{ quote: said, speaker, reading_words: 'setup and ongoing operations' }],
  }), ctx(said) as never, world().caps);

  it.each(['other', 'unknown'])('a report the AI reads as "%s" prepares no "your words" card', async (speaker) => {
    const r = await ask(REPORT, speaker) as Rec;
    expect(r, JSON.stringify(r)).toMatchObject({ ok: false, mutated: false, refusal: 'statement_not_found' });
    expect(r).not.toHaveProperty('proposal_id');
  });

  it('CONTRAST: the user\'s own words, read as theirs, prepare the card', async () => {
    const r = await ask(OWN, 'user') as Rec;
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, mutated: false });
    expect(String(r.public_label)).toContain(OWN);
  });
});

describe('B2: an assumption claimed as the user\'s figure WITH its statement is theirs only through the ONE verifier', () => {
  const REPORT = 'A colleague said: Team effort is 40 hours a week.';
  const OWN = 'Team effort is 40 hours a week.';
  // ⭐ GATE → LABEL (change 1; Codex amendment 1): the report is the card's LABEL, never a refusal and never the user's figure. The
  // protection these rows guarded stays: no "your figure", no "you gave", and the write is human material whose role is unverified
  // (`user_material_unverified`, read as never yours and never Olumi's), quoted with its source.
  it.each(['other', 'unknown'])('a reported revision the AI reads as "%s" is a labelled card, never "your figure"', async (speaker) => {
    const { caps, store } = world();
    const r = await dispatchTool('propose_assumptions', JSON.stringify({ assumptions: [{
      factor_label: 'Team effort', value: 40, unit: 'hours a week', basis: 'the user gave 40 hours', user_stated: true, revise: true,
      statements: [{ quote: REPORT, speaker, form: 'point', value: 40 }] }] }), ctx(REPORT) as never, caps) as Rec;
    const source = `Recorded words — speaker/source unknown: “${REPORT}”`;
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, mutated: false, assumptions: [{ factor: 'Team effort', value: 40, replaces: 30,
      user_material_unverified: true, not_the_users_statement: source }] });
    expect((r.assumptions as Rec[])[0]).not.toHaveProperty('your_figure');
    expect(r.public_label).toBe(`${source}. The quoted source is retained as shown; approving does not make it your own statement of the figure. `
      + 'Revise 1 value: Team effort: 30 hours a week → 40 hours a week (not verified as a figure you stated)');
    // NEGATIVE: a reported figure is Olumi's reading of the binding, never a change the user asked for.
    expect(r.public_label).not.toContain('you asked to change');
    const p = store.get(String(r.proposal_id))!;
    expect(p.provenance.authored_by).toBe('model_proposed');
    expect(p.operations).toEqual([expect.objectContaining({ op: 'set_factor_value', path: 'effort',
      value: expect.objectContaining({ value: 40, user_material_unverified: true, confirmation: { source: REPORT, quote: REPORT } }) })]);
  });

  it('CONTRAST: the user\'s own revision, read as theirs, prepares the card as theirs', async () => {
    const { caps, store } = world();
    const r = await dispatchTool('propose_assumptions', JSON.stringify({ assumptions: [{
      factor_label: 'Team effort', value: 40, unit: 'hours a week', basis: 'the user gave 40 hours', user_stated: true, revise: true,
      statements: [{ quote: OWN, speaker: 'user', form: 'point', value: 40 }] }] }), ctx(OWN) as never, caps) as Rec;
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, mutated: false, assumptions: [{ factor: 'Team effort', value: 40, replaces: 30, your_figure: true }] });
    expect(store.get(String(r.proposal_id))!.operations).toEqual([expect.objectContaining({ op: 'set_factor_value', path: 'effort',
      value: expect.objectContaining({ value: 40, authored_by: 'user_stated' }) })]);
  });
});
