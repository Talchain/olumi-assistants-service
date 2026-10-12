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
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { edgeBandFromMagnitude } from '../../format/edge-strength-bands.js';
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
const args = { rationale: 'served mixed set', links: SIX.map((l) => ({ from_label: label(l.from), to_label: label(l.to),
  strength: l.kept ? edgeBandFromMagnitude(Math.abs(edgeOf(FX.before.graph, l).strength.mean)) : 'moderate' })) };

/**
 * `variant`: one moved link (developer_hires → productivity) was drawn by the user but never sized, so moving it leaves it
 * unsized (the canonical adoption writer's prior change). Its INTENT is `set`, its STORED outcome is a placeholder: this is
 * what tells a heading counted from the stored outcome apart from one counted from intent.
 */
function world(variant = false) {
  const VARIANT = 'developer_hires::productivity';
  const before = structuredClone(FX.before.graph);
  if (variant) {
    const e = before.edges.find((x) => key(x) === VARIANT)!;
    e.provenance = { source: 'user_specified', mean_projected: true };
  }
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
        if (!variant || key(e) !== VARIANT) return structuredClone(e);
        const was = before.edges.find((x) => key(x) === VARIANT)!;
        return { ...structuredClone(e), provenance: { ...was.provenance, reviewed_by_user: { intent: 'confirm', at: '2026-10-12T00:17:53.645Z' } } };
      }) };
      hash = FX.after.graph_hash;
      return { status: 'committed', graph_hash: hash, receipt: null, already_applied: false, committed_levels: [] };
    },
  });
  return { caps, sent, graph: () => graph };
}

async function approveServedSet(variant = false) {
  const w = world(variant);
  const p = await w.caps.proposeLinkStrengths!(ctx, args);
  expect(p.ok, JSON.stringify(p)).toBe(true);
  const out = await w.caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
  expect(out, JSON.stringify(out)).toMatchObject({ ok: true, applied: true });
  return { w, p, receipt: String(out.follow_up) };
}

const UNSIZED_REVIEWED = '"Tech lead hires" → "Code review leadership" and "Code review leadership" → "Code quality deterioration"';
const NEXT_STEP = 'Give a figure, or ask Olumi to estimate it.';
const DISCLOSURE = `Your reviews of ${UNSIZED_REVIEWED} are recorded. They are not sized yet, so their values are unchanged. ${NEXT_STEP}`;
/**
 * Expectation (b)'s own instrument: the four element matchers the live witness applies to a receipt that confirms a
 * placeholder (`recovery/live/live-journey.mjs` batchAReceipt, copied verbatim 12 Oct). A receipt the witness cannot read
 * as carrying all four fails (b) on staging, whatever this spec says.
 */
const WITNESS_B = {
  review_recorded: /review(?:ed)?\b[^.]{0,60}\b(?:recorded|noted|kept)|recorded (?:your|the) review|\breviewed\b/i,
  not_sized_yet: /(?:isn['’]t|is not|not) (?:yet )?sized(?: yet)?|nobody has (?:sized|set)|whose strength nobody has set/i,
  values_unchanged: /values? (?:are |is |stay |stays )?unchanged|unchanged|kept as it is/i,
  give_a_figure: /Give a figure, or ask Olumi to estimate it\.?/i,
};

describe('served mixed link set: the receipt follows the stored outcome', () => {
  it('the fixture is the served approval: same offer, same six writes, same stored outcome', async () => {
    const { w, p } = await approveServedSet();
    expect(String(p.public_label)).toBe(FX.served_offer_label);
    const links = (w.sent[0]!.link_strengths as { from: string; to: string; intent: string; magnitude: number }[]);
    expect(links.map((l) => [key(l), l.intent])).toEqual(SIX.map((l) => [key(l), l.kept ? 'confirm_current' : 'set']));
    // Bound by identity: four links now sized as Olumi's estimates, the two reviewed links still nobody's.
    expect(SIX.map((l) => [key(l), linkSizing(edgeOf(w.graph(), l))]))
      .toEqual(SIX.map((l) => [key(l), l.kept ? 'placeholder' : 'olumi_accepted']));
  });

  it('RED: the heading counts strengths and reviews from the stored outcome, discloses the unsized links once, and offers the next step', async () => {
    const { receipt } = await approveServedSet();
    expect(receipt).not.toBe(FX.served_receipt);
    expect(receipt).not.toContain('Recorded these 6 link strengths');
    expect(receipt.startsWith('Recorded 4 link strengths and your reviews of 2 links: ')).toBe(true);
    expect(receipt.endsWith(DISCLOSURE)).toBe(true);
    expect(receipt.split(NEXT_STEP)).toHaveLength(2);
    for (const [element, re] of Object.entries(WITNESS_B)) expect(re.test(receipt), element).toBe(true);
    // Other links WERE sized: never the whole model unchanged.
    expect(receipt).not.toMatch(/model[’']s values are unchanged|model is (?:exactly )?(?:as it was|unchanged)|nothing (?:was )?changed/i);
    // "You accepted Olumi's estimate" only for the four links stored as Olumi's accepted estimates.
    const accepted = receipt.match(/You accepted Olumi[’']s estimate for how much ("[^"]+") changes ("[^"]+")/g) ?? [];
    expect(accepted).toHaveLength(4);
    for (const s of accepted) expect(s).not.toMatch(/"Tech lead hires" changes "Code review leadership"|"Code review leadership" changes "Code quality deterioration"/);
    expect(receipt).not.toContain('—');
    expect(receipt).not.toMatch(/your own/i);
  });

  it('RED (intent ≠ stored outcome): a moved link that stays unsized is counted as a change, not a strength, and disclosed', async () => {
    const { w, receipt } = await approveServedSet(true);
    expect(linkSizing(edgeOf(w.graph(), { from: 'developer_hires', to: 'productivity' }))).toBe('placeholder');
    expect(receipt.startsWith('Recorded 3 link strengths, the change to 1 link and your reviews of 2 links: ')).toBe(true);
    expect(receipt).toContain('"Developer hires" → "productivity" changed; it isn’t sized in the model yet');
    expect(receipt.endsWith(DISCLOSURE)).toBe(true);
    expect(receipt.split(NEXT_STEP)).toHaveLength(2);
    expect(receipt).not.toMatch(/Olumi[’']s estimate for how much "Developer hires" changes "productivity"/);
  });
});
