/**
 * ⭐ S2 THE LEAD THROUGH THE HIRING-TIMES CARD (DL boundary ruling 21:43Z 14 Oct), on Paul's legacy-code construction (scenario
 * c1494f4d; HIRING's persisted drafter answer, real construction, his 7–8 months saved through the real team-time write). The
 * ‘Legacy-code reduction’ option acts through its RATIO carrier (r = 510/450), offered "from now" (lead 0). His words "We could
 * start the legacy work in 1 month, and it takes about a month to bed in." → ONE card → the press → the carrier holds L = 2 with
 * his statements, and k = 1 + (r−1)·(6−2)/6 sizes the link. Real capabilities, real writer, real materialiser; only the
 * read route and the register are doubled.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../../agent-lane/runtime/build-model.js';
import { createAgentCapabilities } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { withEventShareDate } from '../event-by-date-model.js';
import { applyTeamShareEdit } from '../team-share-write.js';
import { baselineContributionMoments, ratioLinkMoments } from '../event-by-date-share.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/paul-legacy-c1494f4d-raw-20261014.json', import.meta.url), 'utf8')) as
  { brief: string; raw_text: string };
const LEGACY = 'event_option_2', SWITCH = 'event_capacity_2', R = 510 / 450;
const SAID = 'We could start the legacy work in 1 month, and it takes about a month to bed in.';
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
const TEAM = [{ speaker: 'user', quote: 'At least 7 months', source: 'At least 7 months', subject: { quantity: 'months_to_finish' }, form: 'lower_bound',
  low: 7, unit: 'months', reading: 'olumi' }, { speaker: 'user', quote: '8 months', source: '8 months', subject: { quantity: 'months_to_finish' },
  form: 'upper_bound', high: 8, unit: 'months', qualifier: 'likely', qualifier_in_quote: false, answering: 'the likely upper end', reading: 'olumi' }];

async function paulsModel(): Promise<Rec> {
  let graph: Rec | undefined;
  const built = await buildModelFromBrief('c1494f4d-13f9-4216-ac62-35871c7ff207', FX.brief, (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
  }) as never, (async () => ({ text: FX.raw_text, status: 'completed' })) as never) as Rec;
  expect(built.ok).toBe(true);
  const dated = withEventShareDate(graph!, '2027-04-14', '2026-10-14') as Rec;
  const team = applyTeamShareEdit(dated, { goal_id: 'event_goal', team_id: 'event_team', low_months: 7, high_months: 8, deadline: '2027-04-14',
    reference_date: '2026-10-14', statements: TEAM } as never, computeAnalysisAffectingGraphHash(dated as never)!);
  if (team.kind !== 'mutated') throw new Error(JSON.stringify(team));
  return team.mutatedGraph as Rec;
}

function world(initial: Rec) {
  let g = structuredClone(initial);
  let registers = 0;
  const caps = createAgentCapabilities(async (path, body) => {
    if (path.endsWith('/graph/register')) { registers += 1; g = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 2 } } }; }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(g), graph_hash: computeAnalysisAffectingGraphHash(g as never),
      graph_identity_hash: computeGraphIdentityHash(g as never) } };
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    throw new Error(path);
  }, new ProposalStore(), undefined, 'full', undefined, { now: () => new Date('2026-10-14T12:00:00Z') });
  return { caps, graph: () => g, registers: () => registers };
}
const ctx = (said: string): Rec => ({ scenario_id: 'c1494f4d-13f9-4216-ac62-35871c7ff207', authenticated_user_id: null, request_id: 'r', turn_id: 't',
  user_text: said, user_turn_text: said });
const timing = (quote: string): Rec => ({ options: [{ option_id: LEGACY, starts: [{ quote }] }] });
const press = async (w: ReturnType<typeof world>, card: Rec): Promise<Rec> => await w.caps.authoriseChange({ ...ctx('Yes, use these hiring times.'),
  typed_approval_of: String(card.proposal_id) } as never, { proposal_id: String(card.proposal_id) }) as Rec;

describe('the lead through the hiring-times card: the user’s start + settling-in becomes the ONE lead k reads', () => {
  it('PRECONDITION: the legacy option acts through its ratio carrier, “from now” (lead 0), sized by k = r', async () => {
    const c = node(await paulsModel(), SWITCH).observed_state.extra_share_by_date;
    expect(c).toMatchObject({ capacity_ratio: R, lead_low: 0, lead_high: 0, ratio_sizing: { k: R } });
    expect(c).not.toHaveProperty('lead_statements');
  });

  it('RED→GREEN: his sentence → ONE card → the press → L = 2 with his words; k = 1 + (r−1)·4/6 sizes the link', async () => {
    const w = world(await paulsModel());
    const card = await w.caps.proposeHiringTimes!(ctx(SAID) as never, timing(SAID) as never) as Rec;
    expect(card).toMatchObject({ ok: true, mutated: false });
    expect(card.public_label).toBe(`Use this timing for ‘Legacy-code reduction’? You said “${SAID}”. Full effect 2 months from now: your start in 1 month, `
      + 'then your settling-in time of about 1 month (Olumi’s reading of your words). Olumi assumes the change is fully in place once that settling-in ends.');
    expect(w.registers()).toBe(0);
    expect(await press(w, card)).toMatchObject({ ok: true, mutated: true, applied: true });
    const g = w.graph(), c = node(g, SWITCH).observed_state.extra_share_by_date;
    const k = 1 + (R - 1) * (6 - 2) / 6;
    expect(c).toMatchObject({ capacity_ratio: R, lead_low: 2, lead_high: 2, lead_reading: { start: { low: 1, role: 'stated' },
      onboarding: { low: 1, role: 'derived' }, assumption: 'full_effect_after_onboarding' } });
    expect(c.lead_statements.map((s: Rec) => [s.subject.quantity, s.subject.option_id, s.quote])).toEqual([['effect_start', LEGACY, SAID], ['onboarding', LEGACY, SAID]]);
    expect(c.ratio_sizing.k).toBeCloseTo(k, 12);
    const team = node(g, 'event_team').observed_state, coefficient = g.edges.find((e: Rec) => e.from === 'event_team').strength;
    const expected = ratioLinkMoments(k, baselineContributionMoments({ mean: team.value, sd: team.std }, coefficient));
    expect(g.edges.find((e: Rec) => e.from === SWITCH).strength).toEqual({ mean: expected.mean, std: expected.sd });
    // A duplicate press writes nothing twice.
    expect(await press(w, card)).toMatchObject({ ok: true, already_applied: true });
    expect(w.registers()).toBe(1);
  });

  it('CONTRASTS: a range is kept as his and k fails closed (said); a bound is refused with its ask; nothing written', async () => {
    const w = world(await paulsModel());
    const range = 'We could start the legacy work in 1 to 2 months.';
    const card = await w.caps.proposeHiringTimes!(ctx(range) as never, timing(range) as never) as Rec;
    expect(card.public_label).toContain('Olumi can’t show a chance for it until this is one time: say when it would take full effect.');
    await press(w, card);
    expect(node(w.graph(), SWITCH).observed_state.extra_share_by_date).toMatchObject({ lead_low: 1, lead_high: 2 });
    expect(w.graph().edges.find((e: Rec) => e.from === SWITCH).defaulted).toBe(true);
    const w2 = world(await paulsModel()), before = JSON.stringify(w2.graph());
    const within = 'We could start the legacy work within 2 months.';
    expect(await w2.caps.proposeHiringTimes!(ctx(within) as never, timing(within) as never)).toMatchObject({ ok: false, refusal: 'lead_is_a_bound' });
    expect(await w2.caps.proposeHiringTimes!({ ...ctx('Yes.'), unverified_user_text: SAID } as never, timing(SAID) as never))
      .toMatchObject({ ok: false, refusal: 'origin_unknown' });
    expect(JSON.stringify(w2.graph())).toBe(before);
    expect(w2.registers()).toBe(0);
  });
});
