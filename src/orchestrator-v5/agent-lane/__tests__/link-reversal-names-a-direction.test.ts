/**
 * ⛔ THE WORDS FOR A REVERSAL MUST SAY A DIRECTION (DL #2203 verdict, named residual; Runtime follow-up).
 *
 * #2203 binds `direction_from_words` to the user's TURN (`wordsTheUserWrote`), not to a direction. On the served A16
 * text ("Get on and update it to very strong. And the potential churn increase"), a model that sends
 * `direction: 'positive'` with `direction_from_words: 'update it to very strong'` passes: the phrase is written and
 * said. The preview would read "REVERSE its direction … (your "update it to very strong")": visible, wrong on its
 * face, but approvable.
 *
 * The rule: the quoted phrase must itself SAY which way. That is either a movement the reversal agrees with ("pushes MRR
 * up" for positive), or that the link runs the other way ("the other way", "opposite", "backwards"). The band
 * matcher's own closed word set is the precedent. A miss only makes the Agent ask; a false hit still shows the user
 * the words and the REVERSE preview before any approval.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { directionTheWordsSay } from '../stated-by-user.js';

const SCENARIO = '550e8400-e29b-41d4-a716-4466554400c7';
const RISK = 'Competitors undercut price or discount AI features';
const A16 = 'Get on and update it to very strong. And the potential churn increase';
const said = (text: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: text, user_turn_text: text });

/** The served A16 link: the risk LOWERS MRR (−0.5, Olumi's estimate). */
function caps() {
  const graph = {
    nodes: [
      { id: 'dec', kind: 'decision', label: 'Price decision' },
      { id: 'risk_competitors', kind: 'risk', label: RISK },
      { id: 'mrr', kind: 'goal', label: 'MRR' },
    ],
    edges: [{ from: 'risk_competitors', to: 'mrr', strength: { mean: -0.5, std: 0.125 }, exists_probability: 1, effect_direction: 'negative', provenance: { source: 'cee_hypothesis' }, defaulted: true }],
  };
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h1' } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  const proposals = new ProposalStore();
  return { c: createAgentCapabilities(d, proposals), proposals };
}

const reverse = (turn: string, words: string, direction: 'positive' | 'negative' = 'positive') => {
  const w = caps();
  return w.c.proposeLinkStrength!(said(turn), { from_label: RISK, to_label: 'MRR', strength: 'very strong', direction, direction_from_words: words, rationale: turn })
    .then((p) => ({ p, outstanding: w.proposals.outstanding(SCENARIO, null) }));
};

describe('⛔ a reversal\'s quoted words must say which way', () => {
  it('⭐ RED (the DL\'s exact residual): A16\'s own "update it to very strong" quoted as the reversal → refused, nothing prepared', async () => {
    const { p, outstanding } = await reverse(A16, 'update it to very strong');
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, refusal: 'direction_not_stated' }));
    expect(outstanding).toEqual([]);
  });

  it('RED: words saying the OTHER movement than the reversal asked for ("pushes MRR down" for positive) → refused', async () => {
    const turn = 'Competitors undercutting us pushes MRR down, and the effect is very strong.';
    const { p } = await reverse(turn, 'pushes MRR down', 'positive');
    expect(p).toEqual(expect.objectContaining({ ok: false, refusal: 'direction_not_stated' }));
  });

  it('CONTROL: words that say the movement asked for ("actually pushes MRR up") → prepared, REVERSE said plainly', async () => {
    const turn = 'I think we have it backwards: competitors undercutting us actually pushes MRR up, and the effect is very strong.';
    const { p } = await reverse(turn, 'actually pushes MRR up');
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true }));
    expect(String(p.public_label)).toContain('REVERSE its direction so that it raises');
  });

  it('CONTROL: "the other way" says a reversal without naming a movement → prepared', async () => {
    const turn = 'That risk runs the other way for us, and very strong.';
    const { p } = await reverse(turn, 'runs the other way');
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true }));
  });

  it('the matcher: which way a phrase says, as a table (a miss is null, never a guess)', () => {
    const rows: [string, ReturnType<typeof directionTheWordsSay>][] = [
      ['update it to very strong', null],
      ['very strong', null],
      ['the potential churn increase', null],
      ['actually pushes MRR up', 'positive'],
      ['it raises MRR', 'positive'],
      ['increases revenue', 'positive'],
      ['pushes MRR down', 'negative'],
      ['it reduces MRR', 'negative'],
      ['lowers it', 'negative'],
      ['it pushes the other way', 'reverse'],
      ['the opposite effect', 'reverse'],
      ['we have it backwards', 'reverse'],
      ['raises it, not lowers it', null],
      ['it does not raise MRR', null],
    ];
    for (const [words, want] of rows) expect([words, directionTheWordsSay(words)]).toEqual([words, want]);
  });
});
