/**
 * ⛔ A LINK THE USER DID NOT NAME IS OLUMI'S (AI Conversation #70 5849012990 U3; DL 5849023213 (2): "a link the Agent
 * added that the user did not name must not be stamped `user_specified`. Name the stamping site before editing.").
 *
 * Served on CEE 79c299a (`bf5-ui-PROVENANCE-e63c89a0-79c299a-1901`): the user typed only the two options' names —
 * 'Please add two more options to compare: "Test £54 versus £59 by customer cohort before rollout" and "Keep £49 and
 * add a paid AI add-on". Add both.' The Agent linked the add-on to AI feature availability and a new Paid AI add-on
 * price, with no level on either, and both links were stored `user_specified`.
 *
 * THE STAMPING SITE is Canonical's builder, `routing/add-option-transaction.ts` `structuralEdgeValue(option, factor,
 * iv.source ?? 'user_specified')`: a level-less link the Agent sends without `source` is the user's by default. The
 * Agent now sends `source: 'cee_hypothesis'` on every level-less link whose factor THIS turn's typed words do not name.
 * A word the user typed as part of an option's name, or one shared with another quantity's label, names nothing.
 *
 * FIXTURE: that run's `turns[0].draft_graph` — the model as it stood when the add was asked for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { buildAddOptionsTransaction } from '../../routing/add-option-transaction.js';
import { factorTheUserNamed } from '../stated-by-user.js';

const served = JSON.parse(readFileSync(new URL('./fixtures/served-u3-before-add-79c299a.json', import.meta.url), 'utf8')) as { nodes: { id: string; kind: string; label: string }[]; edges: unknown[] };
const COHORT = 'Test £54 versus £59 by customer cohort before rollout';
const ADD_ON = 'Keep £49 and add a paid AI add-on';
const SERVED_ASK = `Please add two more options to compare: "${COHORT}" and "${ADD_ON}". Add both.`;
/** The served proposal: the add-on acts on an existing factor and a new one, neither with a level. */
const CALL = {
  options: [
    { label: COHORT, acts_on: [{ factor_label: 'Pro plan price', direction: 'positive' }] },
    { label: ADD_ON, acts_on: [{ factor_label: 'AI feature availability', direction: 'positive' }, { factor_label: 'Paid AI add-on price', direction: 'positive' }] },
  ],
  new_factors: [{ label: 'Paid AI add-on price', affects: [{ label: 'MRR', direction: 'positive' }] }],
  rationale: 'the user asked for both',
};

async function propose(turnText: string, sessionText = turnText) {
  const sent: { path: string; body: unknown }[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: served, graph_hash: 'h0' } };
    sent.push({ path, body });
    return { status: 500, json: {} };
  };
  const caps = createAgentCapabilities(d, new ProposalStore());
  const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400c7', authenticated_user_id: null, request_id: 'r', user_turn_text: turnText, user_text: sessionText };
  const r = await caps.proposeNewOption(ctx, CALL as never);
  const params = (sent[0]?.body as { chip?: { parameters?: Record<string, unknown> } } | undefined)?.chip?.parameters;
  expect(params, JSON.stringify(r)).toBeDefined();
  const options = params!['options'] as { label: string; interventions: Record<string, unknown>[] }[];
  const links = (label: string) => options.find((o) => o.label === label)!.interventions;
  /** The link as the builder will write it: `provenance.source` of the option→factor edge. */
  const built = buildAddOptionsTransaction(params, served as never) as { matched: boolean; operations?: { op: string; path: string; value: { provenance?: { source?: string } } }[] };
  expect(built.matched, JSON.stringify(built)).toBe(true);
  const edgeSource = (factorId: string) => built.operations!.find((o) => o.op === 'add_edge' && o.path.endsWith(`::${factorId}`))?.value.provenance?.source;
  return { links, edgeSource };
}

describe('a level-less link is the user\'s only when this turn\'s words name its factor', () => {
  it('RED (served U3): the add-on\'s two links — AI feature availability and the NEW Paid AI add-on price — are sent as Olumi\'s', async () => {
    const { links } = await propose(SERVED_ASK);
    expect(links(ADD_ON)).toEqual([
      { factor_id: 'ai_feature_availability', value: null, source: 'cee_hypothesis' },
      { factor_key: 'paid_ai_add_on_price', value: null, source: 'cee_hypothesis' },
    ]);
    // The cohort's price link: the user wrote no factor either, only the option's name.
    expect(links(COHORT)).toEqual([{ factor_id: 'pro_plan_price', value: null, source: 'cee_hypothesis' }]);
  });

  it('RED (the stamping site): the builder writes those option→factor links as Olumi\'s, not the user\'s', async () => {
    const { edgeSource } = await propose(SERVED_ASK);
    expect(edgeSource('ai_feature_availability')).toBe('cee_hypothesis');
    expect(edgeSource('pro_plan_price')).toBe('cee_hypothesis');
  });

  it('CONTRAST: when the user names the factors in this turn, the links stay theirs (no source → user_specified at the builder)', async () => {
    const { links, edgeSource } = await propose(`Add "${ADD_ON}": it changes AI feature availability and sets the Paid AI add-on price. And add "${COHORT}" on the Pro plan price.`);
    expect(links(ADD_ON)).toEqual([{ factor_id: 'ai_feature_availability', value: null }, { factor_key: 'paid_ai_add_on_price', value: null }]);
    expect(edgeSource('ai_feature_availability')).toBe('user_specified');
    expect(links(COHORT)).toEqual([{ factor_id: 'pro_plan_price', value: null }]);
  });

  it('CONTRAST: words the user said earlier in the session (the brief) do not name this turn\'s link', async () => {
    const brief = 'We sell a Pro plan at £49. AI feature availability drives signups; a paid AI add-on price is being considered.';
    const { links } = await propose(SERVED_ASK, `${brief}\n${SERVED_ASK}`);
    expect(links(ADD_ON).every((l) => l.source === 'cee_hypothesis')).toBe(true);
  });
});

describe('factorTheUserNamed — the model\'s own labels, no word list; every miss under-claims (served graph)', () => {
  const others = served.nodes.filter((n) => n.kind !== 'option' && n.kind !== 'decision').map((n) => n.label);
  const scope = (factor: string, options: string[] = [COHORT, ADD_ON]) => ({ options, others: [...others, 'Paid AI add-on price'].filter((l) => l !== factor) });

  it('a word typed as part of an OPTION\'s name names no factor; the factor\'s whole label does', () => {
    expect(factorTheUserNamed('Paid AI add-on price', `Add "${ADD_ON}".`, scope('Paid AI add-on price'))).toBe(false);
    expect(factorTheUserNamed('Paid AI add-on price', `Add "${ADD_ON}" with its own Paid AI add-on price.`, scope('Paid AI add-on price'))).toBe(true);
  });

  it('a word another quantity shares names neither ("churn": Monthly churn and Price-sensitive churn; "monthly")', () => {
    expect(factorTheUserNamed('Monthly churn', 'It lowers churn.', scope('Monthly churn'))).toBe(false);
    expect(factorTheUserNamed('Monthly churn', 'It changes the monthly numbers.', scope('Monthly churn'))).toBe(false);
    expect(factorTheUserNamed('Monthly churn', 'It lowers Monthly churn.', scope('Monthly churn'))).toBe(true);
  });

  it('a word that is the factor\'s own counts, in its plain forms ("availability"; "perceive" for Perceived AI feature value)', () => {
    expect(factorTheUserNamed('AI feature availability', 'It improves availability of the AI tools.', scope('AI feature availability'))).toBe(true);
    expect(factorTheUserNamed('Perceived AI feature value', 'It changes how customers perceive it.', scope('Perceived AI feature value'))).toBe(true);
    // "features" alone is shared by AI feature availability and Perceived AI feature value: it names neither.
    expect(factorTheUserNamed('AI feature availability', 'It ships the AI features sooner.', scope('AI feature availability'))).toBe(false);
  });

  it('nothing typed names nothing', () => {
    expect(factorTheUserNamed('AI feature availability', '', scope('AI feature availability'))).toBe(false);
    expect(factorTheUserNamed('AI feature availability', undefined, scope('AI feature availability'))).toBe(false);
  });
});
