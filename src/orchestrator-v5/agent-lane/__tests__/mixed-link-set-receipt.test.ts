/**
 * ⭐ A MIXED LINK SET'S RECEIPT SAYS WHAT WAS STORED (Batch A live check (b) FAIL, PL 6115623359; DL lease to SYS1).
 *
 * Served (UI c5310483 / CEE c87608e4, run 2026-10-12T001307Z hiring, "Record these links"): one approval sized four links
 * as Olumi's estimates and recorded only a review of two links nobody has sized. The receipt began "Recorded these 6 link
 * strengths", never said the two were still unsized, and gave no next step. The fixture is that served approval: the
 * graph read just before it, the graph read just after it (the stored outcome), and the served words.
 *
 * Contract: the heading counts from the STORED outcome (strengths sized, changes to unsized links, reviews), every link
 * still unsized is said to be unsized, a review-only link's value is said to be unchanged (never the whole model's), and
 * A's next step is offered once.
 *
 * ⭐ D1 (DL ruling 12 Oct, recovery Batch D, amending Batch A ruling 1/5 · L4 (c) for a placeholder only): a placeholder has
 * no current band, so Olumi's band now SIZES the served set's two kept 0.5 placeholders (the first test below, on the served
 * bytes). A review of an unsized link remains where the approval cannot size it: a link the user drew but never sized
 * (`source: user_specified` + a projected mean). The receipt contract is pinned on that shape, the two kept links drawn so.
 */
import { D1_PENDING_FIRST_ESTIMATE } from '../runtime/agent-capabilities.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { edgeBandFromMagnitude } from '../../format/edge-strength-bands.js';
import { formatEdgeStrengthConfirmed, formatEdgeStrengthUnchanged } from '../../tools/handlers/d1-shared/format-confirmation.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

type Edge = { from: string; to: string; strength: { mean: number; std: number }; provenance?: Record<string, unknown> } & Record<string, unknown>;
type Graph = { nodes: { id: string; label: string }[]; edges: Edge[] } & Record<string, unknown>;
const FX = JSON.parse(readFileSync('tests/fixtures/c-mixed-receipt/served-hiring-20261012T001307Z.json', 'utf8')) as {
  before: { graph: Graph; graph_hash: string }; after: { graph: Graph; graph_hash: string };
  served_offer_label: string; served_receipt: string };
const SCENARIO = 'd7bf82e7-3f3b-45ca-adfb-e82f9c1c000b';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'c-mixed-receipt', user_text: 'Please suggest strengths.',
  user_turn_text: 'Please suggest strengths.' };
const label = (id: string): string => FX.before.graph.nodes.find((n) => n.id === id)!.label;
const key = (e: { from: string; to: string }): string => `${e.from}::${e.to}`;
/** The served six, in the served order, with the band each was proposed at (moved to moderate, or kept at its band). */
const SIX: { from: string; to: string; kept: boolean }[] = [
  { from: 'current_mid_weight_developers', to: 'productivity', kept: false },
  { from: 'tech_lead_hires', to: 'code_review_leadership', kept: true },
  { from: 'developer_hires', to: 'productivity', kept: false },
  { from: 'developer_hires', to: 'code_quality_deterioration', kept: false },
  { from: 'code_review_leadership', to: 'code_quality_deterioration', kept: true },
  { from: 'code_quality_deterioration', to: 'productivity', kept: false },
];
const edgeOf = (g: Graph, l: { from: string; to: string }): Edge => g.edges.find((e) => key(e) === key(l))!;
/** The served links at these SIX positions, as the Agent offered them (all six by default). */
const argsFor = (at: readonly number[] = SIX.map((_, i) => i)) => ({ rationale: 'served mixed set', links: at.map((i) => SIX[i]!)
  // ⛔ INPUT CHANGE (#3002 r2, the three tiers): each stub link carries the AI's own claim user_stated, as a prompt-following AI gives it: true when it quotes the user; false with Olumi's own basis when it does not.
  .map((l) => ({ user_stated: false, basis: 'Olumi’s own estimate from the model', from_label: label(l.from), to_label: label(l.to),
    strength: l.kept ? edgeBandFromMagnitude(Math.abs(edgeOf(FX.before.graph, l).strength.mean)) : 'moderate' })) });

/**
 * `variant`: one moved link (developer_hires → productivity) was drawn by the user but never sized, so moving it leaves it
 * unsized (the canonical adoption writer's prior change). Its INTENT is `set`, its STORED outcome is a placeholder: this is
 * what tells a heading counted from the stored outcome apart from one counted from intent.
 */
function world(variant = false, servedBytes = false) {
  const VARIANT = 'developer_hires::productivity';
  // D1: unless the served bytes are asked for, the two kept links are links the user drew but never sized, the one
  // placeholder shape whose approval stays a review (Olumi's adoption cannot size it).
  const drawn = new Set([...(variant ? [VARIANT] : []), ...(servedBytes ? [] : SIX.filter((l) => l.kept).map(key))]);
  const before = structuredClone(FX.before.graph);
  for (const e of before.edges) if (drawn.has(key(e))) e.provenance = { source: 'user_specified', mean_projected: true };
  let graph = before; let hash = FX.before.graph_hash;
  const sent: Record<string, unknown>[] = [];
  const dispatch: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: hash } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  const caps = createAgentCapabilities(dispatch, new ProposalStore(), undefined, 'full', undefined, {
    commitOptionLevels: async (input) => {
      sent.push(input as unknown as Record<string, unknown>);
      // The stored outcome is the SERVED read after the approval; the variant link is written as that writer writes it.
      graph = { ...structuredClone(FX.after.graph), edges: FX.after.graph.edges.map((e) => {
        if (!drawn.has(key(e))) return structuredClone(e);
        const was = before.edges.find((x) => key(x) === key(e))!;
        return { ...structuredClone(e), provenance: { ...was.provenance, reviewed_by_user: { intent: 'confirm', at: '2026-10-12T00:17:53.645Z' } } };
      }) };
      hash = FX.after.graph_hash;
      return { status: 'committed', graph_hash: hash, receipt: null, already_applied: false, committed_levels: [] };
    },
  });
  return { caps, sent, graph: () => graph };
}

async function approveServedSet(variant = false, at?: readonly number[]) {
  const w = world(variant);
  const p = await w.caps.proposeLinkStrengths!(ctx, argsFor(at));
  expect(p.ok, JSON.stringify(p)).toBe(true);
  const out = await w.caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
  expect(out, JSON.stringify(out)).toMatchObject({ ok: true, applied: true });
  return { w, p, receipt: String(out.follow_up) };
}

const NEXT_STEP = 'Give a figure, or ask Olumi to estimate it.';
const REVIEW = 'Review recorded; this link is still unsized. Its values are unchanged.';
/** The AIE's text contract (#94 6115788987), said in full for the served approval. */
const EXPECTED_RECEIPT = 'Recorded 4 link strengths and 2 reviews. '
  + '"Current mid-weight developers" → "productivity" as moderate; "Developer hires" → "productivity" as moderate; '
  + '"Developer hires" → "Code quality deterioration" as moderate; "Code quality deterioration" → "productivity" as moderate. '
  + 'You accepted Olumi\'s estimate for how much "Current mid-weight developers" changes "productivity". '
  + 'You accepted Olumi\'s estimate for how much "Developer hires" changes "productivity". '
  + 'You accepted Olumi\'s estimate for how much "Developer hires" changes "Code quality deterioration". '
  + 'You accepted Olumi\'s estimate for how much "Code quality deterioration" changes "productivity". '
  + 'Olumi’s estimates stay marked as Olumi’s, not yours: your approval applied them, it did not make them your judgement. '
  + `"Tech lead hires" → "Code review leadership": ${REVIEW} "Code review leadership" → "Code quality deterioration": ${REVIEW} ${NEXT_STEP}`;
/**
 * Expectation (b)'s own instrument: the four element matchers the live witness applies to a receipt that confirms a
 * placeholder (`recovery/live/live-journey.mjs` batchAReceipt :885–888, copied 12 Oct after the DL's update accepting
 * "still unsized" and "not been sized" for the AIE's wording).
 */
const WITNESS_B = {
  review_recorded: /review(?:ed)?\b[^.]{0,60}\b(?:recorded|noted|kept)|recorded (?:your|the) review|\breviewed\b/i,
  not_sized_yet: /(?:isn['’]t|is not|not) (?:yet )?sized(?: yet)?|still unsized|not been sized|nobody has (?:sized|set)|whose strength nobody has set/i,
  values_unchanged: /values? (?:are |is |stay |stays )?unchanged|unchanged|kept as it is/i,
  give_a_figure: /Give a figure, or ask Olumi to estimate it\.?/i,
};
const itemsOf = (label: string): string => label.slice(label.indexOf(': '));

describe('served mixed link set: preview and receipt follow the stored outcome', () => {
  it('RED (D1, the served bytes): the two links Olumi kept "as it is" are 0.5 placeholders, so Olumi\'s band now SIZES them; no review is offered', async () => {
    const w = world(false, true);
    const p = await w.caps.proposeLinkStrengths!(ctx, argsFor());
    expect(p.ok, JSON.stringify(p)).toBe(true);
    // RED on staging 9bac9729: "Record 4 link strengths and 2 reviews: …, whose strength nobody has set yet (kept as it is); …".
    expect(String(p.public_label).startsWith('Record these 6 link strengths: ')).toBe(true);
    expect(String(p.public_label)).not.toMatch(/\breviews?\b(?! leadership)|nobody has set|kept as it is/i);
    const links = (p as unknown as { links: Record<string, unknown>[] }).links;
    for (const i of [1, 4]) {
      expect(linkSizing(edgeOf(FX.before.graph, SIX[i]!)), `${key(SIX[i]!)}: precondition`).toBe('placeholder');
      expect(links[i], key(SIX[i]!)).toMatchObject({ becomes: { band: 'strong' }, keeps_current_strength: false,
        whose: 'Olumi\u2019s first estimate for a link nobody had sized', sizing_after_approval: 'olumi_accepted' });
    }
  });

  it('the fixture is the served approval (D1: its two kept links drawn by the user): the same six offered items, the same six writes, the same stored outcome', async () => {
    const { w, p, receipt } = await approveServedSet();
    // D1 (AIE AMEND, 12 Oct): the served items, with the one amended phrase for Olumi's first estimate on the offer.
    expect(itemsOf(String(p.public_label))).toBe(itemsOf(FX.served_offer_label)
      .replaceAll('Olumi\u2019s first estimate for a link nobody had sized', D1_PENDING_FIRST_ESTIMATE));
    expect(String(p.public_label)).toContain(`as moderate, ${D1_PENDING_FIRST_ESTIMATE}`);
    // Never after a confirmed write: the approval's receipt does not say the estimate is still to be applied.
    expect(receipt).not.toContain('not yet been applied');
    const links = (w.sent[0]!.link_strengths as { from: string; to: string; intent: string; magnitude: number }[]);
    expect(links.map((l) => [key(l), l.intent])).toEqual(SIX.map((l) => [key(l), l.kept ? 'confirm_current' : 'set']));
    // Bound by identity: four links now sized as Olumi's estimates, the two reviewed links still nobody's.
    expect(SIX.map((l) => [key(l), linkSizing(edgeOf(w.graph(), l))]))
      .toEqual(SIX.map((l) => [key(l), l.kept ? 'placeholder' : 'olumi_accepted']));
  });

  it('RED: the consent preview counts 4 strengths and 2 reviews, as the receipt will', async () => {
    const { p } = await approveServedSet();
    expect(String(p.public_label)).not.toBe(FX.served_offer_label);
    expect(String(p.public_label).startsWith('Record 4 link strengths and 2 reviews: ')).toBe(true);
    expect(String(p.public_label)).not.toMatch(/Record these 6 link strengths/);
  });

  it('RED: the receipt counts from the stored outcome, says each review-only link is still unsized with its own values unchanged, then the next action once', async () => {
    const { receipt } = await approveServedSet();
    expect(receipt).not.toBe(FX.served_receipt);
    expect(receipt).toBe(EXPECTED_RECEIPT);
    for (const [element, re] of Object.entries(WITNESS_B)) expect(re.test(receipt), element).toBe(true);
    expect(receipt.split(NEXT_STEP)).toHaveLength(2);
    // Other links WERE sized: never the whole model unchanged.
    expect(receipt).not.toMatch(/model[’']s values are unchanged|model is (?:exactly )?(?:as it was|unchanged)|nothing (?:was )?changed/i);
    // "You accepted Olumi's estimate" never for a review-only link.
    expect(receipt).not.toMatch(/estimate for how much "(?:Tech lead hires" changes "Code review leadership|Code review leadership" changes "Code quality deterioration)"/);
    expect(receipt).not.toContain('—');
    expect(receipt).not.toMatch(/your own/i);
  });

  it('RED (intent ≠ stored outcome): a moved link that stays unsized is counted as a change, not a strength', async () => {
    const { w, p, receipt } = await approveServedSet(true);
    expect(linkSizing(edgeOf(w.graph(), { from: 'developer_hires', to: 'productivity' }))).toBe('placeholder');
    expect(String(p.public_label).startsWith('Record 3 link strengths, 1 change to an unsized link and 2 reviews: ')).toBe(true);
    expect(receipt.startsWith('Recorded 3 link strengths, 1 change to an unsized link and 2 reviews. ')).toBe(true);
    expect(receipt).toContain('"Developer hires" → "productivity" changed; it isn’t sized in the model yet');
    expect(receipt.endsWith(`"Tech lead hires" → "Code review leadership": ${REVIEW} "Code review leadership" → "Code quality deterioration": ${REVIEW} ${NEXT_STEP}`)).toBe(true);
    expect(receipt.split(NEXT_STEP)).toHaveLength(2);
    expect(receipt).not.toMatch(/Olumi[’']s estimate for how much "Developer hires" changes "productivity"/);
  });
});

/**
 * A′ check round 1 (DL relay, 12 Oct): the contract held only for a MIXED set. One review, or reviews alone, still read
 * "Recorded your review of this link: … reviewed, kept as it is." with no word that the link is still unsized and no next
 * step, and the single-link receipts still said the MODEL's values were unchanged. Every set shape is pinned here from the
 * same served approval: SIX positions 1 and 4 are the two reviewed links nobody has sized.
 */
const T_C = '"Tech lead hires" → "Code review leadership"';
const C_Q = '"Code review leadership" → "Code quality deterioration"';
const KEPT_ITEM = ', whose strength nobody has set yet (kept as it is)';
const WHOLE_MODEL = /model[’']s values|model is (?:exactly )?(?:as it was|unchanged)|nothing (?:was )?changed/i;
const witnessed = (text: string): void => {
  for (const [element, re] of Object.entries(WITNESS_B)) expect(re.test(text), `${element}: ${text}`).toBe(true);
  expect(text.split(NEXT_STEP), 'the next action once').toHaveLength(2);
  expect(text).not.toMatch(WHOLE_MODEL);
  expect(text).not.toContain('—');
  expect(text).not.toMatch(/your own/i);
};

describe('every set shape: each review-only link says it is still unsized, its own values unchanged, then the next action once', () => {
  it('RED: ONE review is counted as a review and carries the contract (was "Recorded your review of this link: … reviewed, kept as it is.")', async () => {
    const { w, p, receipt } = await approveServedSet(false, [1]);
    expect(linkSizing(edgeOf(w.graph(), SIX[1]!))).toBe('placeholder');
    expect(String(p.public_label)).toBe(`Record 1 review: ${T_C}${KEPT_ITEM}`);
    expect(receipt).toBe(`Recorded 1 review. ${T_C}: ${REVIEW} ${NEXT_STEP}`);
    witnessed(receipt);
  });

  it('RED: ALL reviews are counted as reviews and each carries the contract (was "Recorded your reviews of these 2 links: …")', async () => {
    const { w, p, receipt } = await approveServedSet(false, [1, 4]);
    for (const i of [1, 4]) expect(linkSizing(edgeOf(w.graph(), SIX[i]!))).toBe('placeholder');
    expect(String(p.public_label)).toBe(`Record 2 reviews: ${T_C}${KEPT_ITEM}; ${C_Q}${KEPT_ITEM}`);
    expect(receipt).toBe(`Recorded 2 reviews. ${T_C}: ${REVIEW} ${C_Q}: ${REVIEW} ${NEXT_STEP}`);
    witnessed(receipt);
  });

  it('CONTROL (held on f7aae41): reviews beside a change that leaves a link unsized carry the contract, the change is listed once', async () => {
    const { w, p, receipt } = await approveServedSet(true, [1, 2, 4]);
    expect(linkSizing(edgeOf(w.graph(), SIX[2]!))).toBe('placeholder');
    expect(String(p.public_label)).toBe(`Record 1 change to an unsized link and 2 reviews: ${T_C}${KEPT_ITEM}; `
      + `"Developer hires" → "productivity", whose strength nobody has set yet; ${C_Q}${KEPT_ITEM}`);
    expect(receipt).toBe('Recorded 1 change to an unsized link and 2 reviews. "Developer hires" → "productivity" changed; it isn’t sized in the model yet. '
      + `${T_C}: ${REVIEW} ${C_Q}: ${REVIEW} ${NEXT_STEP}`);
    witnessed(receipt);
  });

  it('CONTROL (bytes unchanged from f7aae41): a set of Olumi\'s estimates alone names no review and no next step', async () => {
    const { w, p, receipt } = await approveServedSet(false, [0, 2, 3, 5]);
    for (const i of [0, 2, 3, 5]) expect(linkSizing(edgeOf(w.graph(), SIX[i]!))).toBe('olumi_accepted');
    expect(String(p.public_label).startsWith('Record these 4 link strengths: ')).toBe(true);
    expect(String(p.public_label)).not.toMatch(/review|nobody has set/i);
    expect(receipt).toBe('Recorded these 4 link strengths: '
      + '"Current mid-weight developers" → "productivity" as moderate; "Developer hires" → "productivity" as moderate; '
      + '"Developer hires" → "Code quality deterioration" as moderate; "Code quality deterioration" → "productivity" as moderate. '
      + 'You accepted Olumi\'s estimate for how much "Current mid-weight developers" changes "productivity". '
      + 'You accepted Olumi\'s estimate for how much "Developer hires" changes "productivity". '
      + 'You accepted Olumi\'s estimate for how much "Developer hires" changes "Code quality deterioration". '
      + 'You accepted Olumi\'s estimate for how much "Code quality deterioration" changes "productivity". '
      + 'Olumi’s estimates stay marked as Olumi’s, not yours: your approval applied them, it did not make them your judgement.');
    expect(receipt).not.toContain(NEXT_STEP);
  });

  it('RED: the single-link receipts say THIS link\'s values are unchanged, never the model\'s (format-confirmation :722, :747)', () => {
    const labels = { fromLabel: '"Tech lead hires"', toLabel: '"Code review leadership"' };
    const confirmed = formatEdgeStrengthConfirmed({ ...labels, sizing: 'placeholder' });
    expect(confirmed).toBe('Your review of the link between "Tech lead hires" and "Code review leadership" is recorded. '
      + `It has not been sized yet. Its values are unchanged. ${NEXT_STEP}`);
    witnessed(confirmed);
    const unchanged = formatEdgeStrengthUnchanged({ ...labels, mean: 0.5, unsized: true });
    expect(unchanged).toBe(`The link between "Tech lead hires" and "Code review leadership" has not been sized yet. Its values are unchanged. ${NEXT_STEP}`);
    expect(unchanged).not.toMatch(WHOLE_MODEL);
    expect(unchanged.split(NEXT_STEP)).toHaveLength(2);
  });
});

/**
 * A′ round 2 (DL, 12 Oct): the single-link receipt's label-less fallback (`agent-capabilities.ts` after
 * `formatEdgeStrengthConfirmed`) said "its strength stays as it was" of a placeholder, as though a strength existed. It
 * now follows the stored sizing: a placeholder says the contract; a sized link keeps its sentence.
 */
describe('single link whose endpoint label cannot be read after the write: the fallback follows the stored sizing', () => {
  const PR = { from_label: 'Price', to_label: 'Revenue' };
  const said = 'Price has a strong effect on Revenue.';
  const c = { ...ctx, user_text: said, user_turn_text: said };
  function single(provenance: Record<string, unknown>, mean = 0.5) {
    let revision = 0;
    let graph = { nodes: [{ id: 'price', kind: 'factor', label: 'Price' } as Record<string, unknown>, { id: 'revenue', kind: 'goal', label: 'Revenue' }],
      edges: [{ from: 'price', to: 'revenue', strength: { mean, std: 0.125 }, exists_probability: 1, effect_direction: 'positive', provenance }] };
    const dispatch: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: `h${revision}` } };
      const event = (body as { event: Record<string, unknown> }).event;
      expect(event).toMatchObject({ kind: 'edge_strength_edit', from: 'price', to: 'revenue', intent: 'confirm_current' });
      const e = graph.edges[0]!;
      // The review is recorded; the price node comes back without a label (the fallback's only way in).
      graph = { nodes: [{ id: 'price', kind: 'factor' }, graph.nodes[1]!],
        edges: [{ ...e, provenance: { ...e.provenance, reviewed_by_user: { intent: 'confirm', at: '2026-10-12T00:00:00.000Z' } } }] };
      revision += 1;
      return { status: 200, json: { assistant_text: 'Recorded.', graph_hash: `h${revision}` } };
    };
    const caps = createAgentCapabilities(dispatch, new ProposalStore(), undefined, 'full', undefined, {});
    return { caps, edge: () => graph.edges[0]! };
  }
  const approve = async (provenance: Record<string, unknown>, mean = 0.5) => {
    const w = single(provenance, mean);
    const p = await w.caps.proposeLinkStrength!(c, { ...PR, strength: 'strong', rationale: 'A′ round 2 fallback' });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const out = await w.caps.authoriseChange(c, { proposal_id: String(p.proposal_id) });
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, applied: true });
    return { w, followUp: String(out.follow_up) };
  };

  it('RED: a reviewed placeholder says it is still unsized, its values unchanged, then the next action (was "its strength stays as it was")', async () => {
    // D1 (DL 12 Oct, Batch D): a placeholder in the named band is now SIZED by it; it stays a review only where its default
    // already IS the band's midpoint (0.55 for "strong"), so that is the reviewed placeholder here.
    const { w, followUp } = await approve({ source: 'user_specified', mean_projected: true }, 0.55);
    expect(linkSizing(w.edge())).toBe('placeholder');
    expect(followUp).toBe(`${REVIEW} ${NEXT_STEP}`);
    witnessed(followUp);
    expect(followUp).not.toMatch(/strength stays/);
  });

  it('CONTROL: a sized link keeps "its strength stays as it was"', async () => {
    const { w, followUp } = await approve({ source: 'cee_hypothesis', magnitude: 'olumi_estimate' });
    expect(linkSizing(w.edge())).toBe('olumi_accepted');
    expect(followUp).toBe('Recorded your review of this link; its strength stays as it was.');
  });
});
