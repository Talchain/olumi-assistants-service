/**
 * D4 (c)(2) (post-F; DL 12 Oct, AIE #94 6133027121): a goal-net carrier whose monthly change is Olumi's conversion of the
 * brief's own no-change forecast is confirmed on its OWN card: the AIE's quote line, Olumi's model of the forecast (its
 * words ⛔ PENDING AIE, #94 6133140173), then the AIE's question. Its Yes, and only its, accepts that model:
 *   · the monthly change stays OLUMI'S figure, accepted (`user_confirmed`; never a human figure), its quote kept as source;
 *   · the carrier is licensed by admission's own rule on the postimage (every input now a human act);
 *   · the readback binds that whole postimage.
 * Built on the design brief ("in 3 months", diagnosis only). 0 provider calls.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { forecastSourceOf } from '../../../cee/provenance/provenance-of.js';
import { proposeProductIdentity } from '../identity-proposal.js';
import { applyIdentityConfirmEdit, identityConfirmPostimageIsScoped, identityConfirmReadingToken } from '../../system-events/identity-confirm-edit.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

type Rec = Record<string, any>;
const fx = JSON.parse(readFileSync(new URL('./fixtures/t6-d4-drafts.json', import.meta.url), 'utf8')) as { brief: string; drafts: { raw_text: string }[] };
const DESIGN = fx.brief.replace('next quarter', 'in 3 months').replace('by the end of that quarter', 'by the end of month 3');
const TODAY = 'Median delivery cycle today';
const NET = 'No-change cycle increase per month';
const CARD = 'From your message: ‘Without a change, we expect it to reach 10 weeks in 3 months.’ '
  + "Olumi's model of this forecast: from today's 8 weeks, ‘median delivery cycle’ rises by about 0.67 weeks each month, reaching 10 weeks by month 3. "
  + "Do you want to use Olumi's model of this forecast for ‘median delivery cycle’ by month 3?";

function draft(netProvenance: 'inferred' | 'explicit' = 'inferred'): Rec {
  const m = JSON.parse(fx.drafts[1]!.raw_text) as Rec;
  m.factors = m.factors.filter((f: Rec) => !/no-change/i.test(f.label));
  m.factors.push({ label: TODAY, role: 'observable', baseline_known: true, baseline_evidence: null, baseline_value: 8, unit: 'weeks', provenance: 'explicit', plausible_max: 20 });
  m.factors.push({ label: NET, role: 'external', baseline_known: netProvenance === 'explicit', baseline_evidence: null, baseline_value: 2 / 3, unit: 'weeks per month', provenance: netProvenance, plausible_max: 5 });
  m.links = m.links.filter((l: Rec) => !/no-change/i.test(l.from));
  m.links.push({ from: TODAY, to: 'median delivery cycle', direction: 'positive', provenance: 'inferred', effect_amount: 1, effect_per_source_change: 1, effect_provenance: 'inferred', definitional: true, basis: null });
  m.links.push({ from: NET, to: 'median delivery cycle', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null });
  m.identities = [{ outcome: 'median delivery cycle', operation: 'accumulation', factors: [TODAY, NET], provenance: 'inferred', reading: 'net' }];
  return m;
}
async function stored(brief = DESIGN, m: Rec = draft()): Promise<Rec> {
  let graph: Rec | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = GraphV3.parse((body as Rec).graph) as Rec; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const r = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', brief, dispatch, (async () => ({ text: JSON.stringify(m) })) as unknown as CallStructuredModel) as Rec;
  expect(r.ok).toBe(true);
  return graph!;
}
const node = (g: Rec, label: string): Rec => g.nodes.find((n: Rec) => n.label === label);
/** The stock's 8 credited as the user's (the state D4's construction does not yet reach: DL, the third blocker). */
function withUsersToday(g: Rec): Rec {
  const out = structuredClone(g);
  const os = node(out, TODAY).observed_state;
  delete os.user_material_unverified;
  Object.assign(os, { source: 'brief_extraction', extractionType: 'explicit' });
  return out;
}
function yes(g: Rec): Rec {
  const card = proposeProductIdentity(g)!;
  const reading = { outcome_id: card.outcome_id, factor_ids: [...card.factor_ids], words: card.words };
  return applyIdentityConfirmEdit({ ...reading, persistedGraph: structuredClone(g), expected_graph_hash: computeAnalysisAffectingGraphHash(g as never) as string,
    reading_token: identityConfirmReadingToken(reading) }) as Rec;
}

describe('the forecast card: the user\'s sentence, Olumi\'s model of it, the AIE\'s question', () => {
  it('design brief: exactly these words, on the goal\'s own carrier', async () => {
    const card = proposeProductIdentity(await stored())!;
    expect(card).toMatchObject({ outcome_id: 'median_delivery_cycle', operation: 'sum', factor_ids: ['median_delivery_cycle_at_month_3'] });
    expect(card.words).toBe(CARD);
  });
  it('CONTROL: a monthly change the user stated keeps the general card, unchanged', async () => {
    const card = proposeProductIdentity(await stored(DESIGN.replace('Without a change, we expect it to reach 10 weeks in 3 months.',
      'Without a change, it grows by 2/3 of a week every month.'), draft('explicit')));
    expect(card?.words ?? '').not.toContain('From your message');
  });
  it('a quote too long for the door: the general card, whose Yes still asks for the change (never a silent accept)', async () => {
    const g = withUsersToday(await stored());
    node(g, NET).observed_state.forecast_source.quote = `Without a change, we expect it to reach 10 weeks in 3 months. ${'x'.repeat(400)}`;
    const card = proposeProductIdentity(g)!;
    expect(card.words.startsWith('Olumi reads ‘median delivery cycle’ as ‘median delivery cycle at month 3’.')).toBe(true);
    expect([yes(g).kind, yes(g).reason]).toEqual(['refused', 'operand_level_missing']);
  });
});

describe('its Yes accepts Olumi\'s model: the change stays Olumi\'s, the carrier is licensed, the readback binds it all', () => {
  it('Yes: carrier licensed; the change user_confirmed with its quote and value kept; zero confirmed; the goal\'s reading confirmed', async () => {
    const before = withUsersToday(await stored());
    const r = yes(before);
    expect(r.kind).toBe('mutated');
    const after = r.mutatedGraph as Rec;
    const carrier = after.nodes.find((n: Rec) => n.id === 'median_delivery_cycle_at_month_3');
    expect(carrier.nonlinear_identity).toEqual({ ...before.nodes.find((n: Rec) => n.id === carrier.id).nonlinear_identity, stated_in_brief: true });
    expect(node(after, NET).observed_state).toEqual({ ...node(before, NET).observed_state, source: 'user_confirmed' });
    expect(forecastSourceOf(node(after, NET))).toEqual({ quote: 'Without a change, we expect it to reach 10 weeks in 3 months.', origin: 'brief' });
    expect(after.nodes.find((n: Rec) => /net_zero_rate$/.test(n.id)).observed_state.source).toBe('user_confirmed');
    expect(after.nodes.find((n: Rec) => n.id === 'median_delivery_cycle').nonlinear_identity).toMatchObject({ operation: 'sum', stated_in_brief: true });
    expect(identityConfirmPostimageIsScoped(before, projectGraphForPersistence(after), 'median_delivery_cycle')).toBe(true);
    expect(proposeProductIdentity(after), 'confirmed: never offered again').toBeNull();
  });
  it.each([
    ['the change not accepted', (g: Rec) => { node(g, NET).observed_state.source = 'cee_inference'; }],
    ['the carrier not licensed', (g: Rec) => { g.nodes.find((n: Rec) => n.id === 'median_delivery_cycle_at_month_3').nonlinear_identity.stated_in_brief = false; }],
    ['the change\'s value moved', (g: Rec) => { node(g, NET).observed_state.raw_value = 1; }],
  ])('NEGATIVE readback: %s → not the confirmed postimage', async (_, tamper) => {
    const before = withUsersToday(await stored());
    const after = projectGraphForPersistence(yes(before).mutatedGraph) as Rec;
    tamper(after);
    expect(identityConfirmPostimageIsScoped(before, after, 'median_delivery_cycle')).toBe(false);
  });
});
