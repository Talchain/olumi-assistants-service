/**
 * ⭐ THE AGENT READS WHO SIZED EACH LINK BY F1b's ONE RULE (`linkSizing`), NEVER FROM `defaulted` (AI HARNESS; DL
 * 5936996041 on R3 DEFECT 2 5936673643).
 *
 * Served on CEE `b410b1c5` (R3 F5, 1 Oct, scenario 799d1a5d): "fix them all" — the Agent called the two parts→limit links
 * "Olumi's placeholders" and re-sized them, though both were `olumi_estimate`, and left the two REAL placeholders unsized.
 * Its view of a link carried `defaulted: true` on every sized link (construction sets it on estimates too) and its
 * prompt said `defaulted` "means no one has estimated its strength yet". The fixture is that served graph.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { HOST_TOOL_CONTRACT } from '../coach-route-v0_2.js';
import { composeProposalReply } from '../proposal-reply.js';
import { approvalChipsFor, linkStrengthCardFor } from '../approval-chips.js';
import { offeredApproveChipOnRow, proposalPendingAction, rehydrateProposals } from '../durable-proposal.js';
import served from './fixtures/m1-s1-served-graphs.json';
import type { InfluenceBand } from '../../format/influence-bands.js';

const F = JSON.parse(readFileSync(new URL('./fixtures/served-799d1a5d-cold-s1-graph.json', import.meta.url), 'utf8')) as {
  graph: { nodes: { id: string; label: string }[]; edges: { from: string; to: string; provenance?: { magnitude?: string } }[] };
  graph_hash: string;
};
const SCENARIO = '550e8400-e29b-41d4-a716-446655440799';
const d: InternalDispatch = async (path) => (path.endsWith('/graph') ? { status: 200, json: { graph: F.graph, graph_hash: F.graph_hash } } : { status: 500, json: {} });
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: 'fix them all', user_turn_text: 'fix them all' };
const label = (id: string) => F.graph.nodes.find((n) => n.id === id)!.label;
const REAL_PLACEHOLDERS = ['ai_reporting_module_completion->enterprise_deal_close_probability', 'trial_flow_bug_resolution->profile_completion_rate'];
const PARTS_ESTIMATES = ['ai_reporting_module_completion->sprint_initiatives_tackled_properly', 'trial_flow_bug_resolution->sprint_initiatives_tackled_properly'];
type Link = { from: string; to: string; sizing?: string; defaulted?: unknown; holds_by_definition?: unknown };

describe('get_canonical_state: every link says who sized it (served 799d1a5d)', () => {
  it('RED: the placeholders the Agent can see are EXACTLY the two real ones; the two parts→limit links read as Olumi\'s estimate', async () => {
    // Precondition: on the stored graph every sized link carries `defaulted`, estimates included — it cannot separate them.
    const stored = F.graph.edges.filter((e) => [...REAL_PLACEHOLDERS, ...PARTS_ESTIMATES].includes(`${e.from}->${e.to}`));
    expect(stored.every((e) => (e as { defaulted?: unknown }).defaulted === true)).toBe(true);
    const s = await createAgentCapabilities(d, new ProposalStore()).getCanonicalState(ctx);
    expect(s.ok, JSON.stringify(s)).toBe(true);
    const links = (s as unknown as { links: Link[] }).links;
    const key = (l: Link) => `${l.from}->${l.to}`;
    // Science 393023 LICENCE (a)/(b), 7 Oct: two → six placeholders; the parts/limit Olumi estimates stay sized.
    expect(links.filter((l) => l.sizing === 'placeholder').map(key).sort()).toEqual([...REAL_PLACEHOLDERS,
      'ai_reporting_module_completion->revenue_lost_to_rushed_ai_delivery',
      'enterprise_prospect_contract_value->expected_enterprise_revenue',
      'expected_revenue_per_completed_trial_profile->expected_trial_profile_revenue',
      'trial_signup_starts->expected_trial_profile_revenue',
    ].sort());
    for (const k of PARTS_ESTIMATES) expect(links.find((l) => key(l) === k)?.sizing, k).toBe('olumi_estimate');
    // `defaulted` is no sizing mark, so the Agent no longer sees it at all.
    expect(links.some((l) => 'defaulted' in l)).toBe(false);
    // A link that holds by definition is arithmetic: it carries no sizing.
    for (const l of links.filter((x) => x.holds_by_definition === true)) expect(l).not.toHaveProperty('sizing');
  });

  it('the prompt defines `sizing` and no longer tells the Agent that `defaulted` means unsized', () => {
    const host = HOST_TOOL_CONTRACT;
    expect(host).toContain('`placeholder` (nobody has sized it yet: only these are placeholders)');
    expect(host).not.toContain('`defaulted` means no one has estimated its strength yet');
  });
});

describe('propose_link_strengths says when it replaces an estimate (served 799d1a5d)', () => {
  const propose = (keys: readonly string[]) => createAgentCapabilities(d, new ProposalStore()).proposeLinkStrengths!(ctx, {
    links: keys.map((k) => { const [from, to] = k.split('->'); return { from_label: label(from!), to_label: label(to!), strength: 'very strong' }; }),
    rationale: 'fix them all',
  }) as Promise<{ ok: boolean; links?: { was: { sizing?: string } }[]; note?: string; refusal?: string; detail?: string }>;

  it('RED: re-sizing the two parts→limit links reports them as ALREADY Olumi\'s estimate, never placeholders', async () => {
    const r = await propose(PARTS_ESTIMATES);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.links!.map((l) => l.was.sizing)).toEqual(['olumi_estimate', 'olumi_estimate']);
    expect(r.note).toContain('REPLACES an earlier estimate');
    expect(r.note).toContain('never call them placeholders');
  });

  it('CONTROL: sizing the two real placeholders reports them as placeholders and says nothing about replacing an estimate', async () => {
    const r = await propose(REAL_PLACEHOLDERS);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.links!.map((l) => l.was.sizing)).toEqual(['placeholder', 'placeholder']);
    expect(r.note).not.toContain('REPLACES an earlier estimate');
  });
});

/**
 * ⭐ THE REPLY THE USER READS (CODEX_CLI_OVERFLOW + DL CR 5937945418 on #2475): a lone `propose_link_strengths` call marked
 * `whole_request` is answered by the composer with NO second model call, so the capability's note never reaches the user.
 * The composer must say a re-estimate from the typed `was.sizing`, `whose` and `keeps_current_strength`.
 */
describe('the composed reply says when it replaces Olumi\'s estimate (served 799d1a5d)', () => {
  type Edge = (typeof F.graph.edges)[number] & { provenance?: Record<string, unknown> };
  // Paul's approval of an estimate's band (#2257's `reviewed_by_user`): the link reads `olumi_accepted`.
  const accepted = (k: string) => ({ ...F.graph, edges: F.graph.edges.map((e: Edge) => (`${e.from}->${e.to}` === k
    ? { ...e, provenance: { ...e.provenance, reviewed_by_user: { intent: 'confirm', at: '2026-10-01T09:25:00.000Z' } } } : e)) });
  const composed = async (asked: readonly (readonly [string, InfluenceBand])[], graph: unknown = F.graph) => {
    const dg: InternalDispatch = async (path) => (path.endsWith('/graph') ? { status: 200, json: { graph, graph_hash: F.graph_hash } } : { status: 500, json: {} });
    const args = {
      links: asked.map(([k, strength]) => { const [from, to] = k.split('->'); return { from_label: label(from!), to_label: label(to!), strength }; }),
      rationale: 'fix them all', whole_request: true,
    };
    const result = await createAgentCapabilities(dg, new ProposalStore()).proposeLinkStrengths!(ctx, args);
    expect((result as { ok?: unknown }).ok, JSON.stringify(result)).toBe(true);
    return { result: result as unknown as { links: { was: { sizing?: unknown } }[]; already?: string[] }, text: composeProposalReply('propose_link_strengths', args, result, 'fix them all') };
  };
  const pairOf = (k: string) => { const [from, to] = k.split('->'); return `\u2018${label(from!)}\u2019 \u2192 \u2018${label(to!)}\u2019`; };
  const REPLACES = 'already held Olumi\u2019s estimate';

  it('RED: moving the two parts\u2192limit estimates says, by name, that each REPLACES Olumi\'s estimate (never a placeholder)', async () => {
    const { text } = await composed(PARTS_ESTIMATES.map((k) => [k, 'very strong'] as const));
    expect(text).not.toBeNull();
    expect(text).toContain(`These links ${REPLACES}, which this replaces: ${pairOf(PARTS_ESTIMATES[0]!)} (strong); ${pairOf(PARTS_ESTIMATES[1]!)} (strong).`);
    expect(text!.toLowerCase()).not.toContain('placeholder');
  });

  it('an ACCEPTED estimate moved is replaced too; one kept in its band is "already" and is not named', async () => {
    const one = await composed([[PARTS_ESTIMATES[0]!, 'very strong']], accepted(PARTS_ESTIMATES[0]!));
    expect(one.result.links.map((l) => l.was.sizing)).toEqual(['olumi_accepted']);
    expect(one.text).toContain(`${pairOf(PARTS_ESTIMATES[0]!)} (strong) ${REPLACES}: this replaces that estimate.`);
    // The accepted one kept at its own band changes nothing (`already`); only the moved estimate is named.
    const mixed = await composed([[PARTS_ESTIMATES[0]!, 'strong'], [PARTS_ESTIMATES[1]!, 'very strong']], accepted(PARTS_ESTIMATES[0]!));
    expect(mixed.result.already).toHaveLength(1);
    expect(mixed.text).toContain(`${pairOf(PARTS_ESTIMATES[1]!)} (strong) ${REPLACES}: this replaces that estimate.`);
    expect(mixed.text).not.toContain(pairOf(PARTS_ESTIMATES[0]!) + ' (strong) ' + REPLACES);
  });

  it('CONTROL: keeping the estimates in their band replaces nothing, so no replacement line', async () => {
    const { result, text } = await composed(PARTS_ESTIMATES.map((k) => [k, 'strong'] as const));
    expect(result.links.map((l) => l.was.sizing)).toEqual(['olumi_estimate', 'olumi_estimate']);
    expect(text).not.toBeNull();
    expect(text).not.toContain(REPLACES);
  });

  it('CONTROL: sizing the two real placeholders replaces nothing, so no replacement line', async () => {
    const { result, text } = await composed(REAL_PLACEHOLDERS.map((k) => [k, 'strong'] as const));
    expect(result.links.map((l) => l.was.sizing)).toEqual(['placeholder', 'placeholder']);
    // Science 393023 LICENCE ruling 3 (DL 6049287136 P0), re-derived:
    // a placeholder already held Olumi's estimate → this offers the first estimate for a link nobody had sized.
    expect(text).toContain('For links nobody had sized, this offers Olumi\u2019s first estimate');
    expect(text).not.toContain('Olumi\u2019s estimates stay marked as Olumi\u2019s');
    expect(text).not.toContain(REPLACES);
  });

  it.each([
    ['missing', (l: Record<string, unknown>) => { const { whose: _w, ...rest } = l; return rest; }],
    ['null', (l: Record<string, unknown>) => ({ ...l, whose: null })],
    ['an unknown literal', (l: Record<string, unknown>) => ({ ...l, whose: 'Olumi' })],
  ])('FAIL-CLOSED: a moved estimate whose `whose` is %s keeps the second call (no attribution, no note)', async (_n, edit) => {
    const { result, text } = await composed(PARTS_ESTIMATES.map((k) => [k, 'very strong'] as const));
    expect(text).toContain(REPLACES);
    const untyped = { ...result, links: result.links.map((l) => edit(l as unknown as Record<string, unknown>)) };
    expect(composeProposalReply('propose_link_strengths', { whole_request: true, links: [] }, untyped, 'fix them all')).toBeNull();
  });

  it('FAIL-CLOSED: a link whose sizing before is not typed keeps the second call', async () => {
    const { result } = await composed(PARTS_ESTIMATES.map((k) => [k, 'very strong'] as const));
    const untyped = { ...result, links: result.links.map((l) => ({ ...l, was: { ...l.was, sizing: undefined } })) };
    expect(composeProposalReply('propose_link_strengths', { whole_request: true, links: [] }, untyped, 'fix them all')).toBeNull();
  });
});

describe('Science 393023 LICENCE ruling 3: D1 consent says whether a link had a size', () => {
  const FROM = 'enterprise_prospect_signing_likelihood';
  const TO = 'quarterly_revenue';
  const FIRST = 'Olumi\u2019s first estimate for a link nobody had sized';
  const D1 = served.cases.find((c) => c.id === 'D1-sprint-run')!.graph;
  const fromLabel = D1.nodes.find((n) => n.id === FROM)!.label;
  const toLabel = D1.nodes.find((n) => n.id === TO)!.label;
  const pair = `"${fromLabel}" \u2192 "${toLabel}"`;
  const prepare = async (sized = false, singular = false, named = false) => {
    const graph = structuredClone(D1);
    const edge = graph.edges.find((e) => e.from === FROM && e.to === TO)!;
    expect(edge).toMatchObject({ from: FROM, to: TO, strength: { mean: 0.5, std: 0.125 }, defaulted: true });
    if (sized) {
      edge.strength.std = 0.1;
      edge.provenance = { ...edge.provenance, magnitude: 'olumi_estimate' } as typeof edge.provenance;
      delete (edge as { defaulted?: boolean }).defaulted;
    }
    const dispatch: InternalDispatch = async (path) => {
      expect(path.endsWith('/graph')).toBe(true);
      return { status: 200, json: { graph, graph_hash: 'h-d1-licence-r3' } };
    };
    const store = new ProposalStore();
    const caps = createAgentCapabilities(dispatch, store);
    const words = `${fromLabel} is strong`;
    const userText = named || singular ? words : 'Offer a strength for this link';
    const context = { ...ctx, user_text: userText, user_turn_text: userText };
    const link = { from_label: fromLabel, to_label: toLabel, strength: 'strong' as const, rationale: userText,
      ...(named ? { from_words: words } : {}) };
    const args = singular ? link : { links: [link], whole_request: true };
    const result = singular ? await caps.proposeLinkStrength!(context, link)
      : await caps.proposeLinkStrengths!(context, { links: [link], rationale: userText });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const proposal = store.get(String(result.proposal_id))!;
    // Same-band approval stays a review at 0.5; these rows change words only, never author or magnitude.
    expect(proposal.operations).toEqual([expect.objectContaining({
      op: singular ? 'update_edge' : 'set_link_strength', path: `${FROM}::${TO}`,
      value: expect.objectContaining({ magnitude: 0.5, intent: 'confirm_current', band: 'strong' }),
    })]);
    return { result, proposal, store, args, userText };
  };

  it('RED: unsized prospect → revenue card, whose and Agent note offer a FIRST estimate, never imply a prior size', async () => {
    const { result, proposal } = await prepare();
    expect(proposal.public_label).toContain(`${pair} as strong, ${FIRST}`);
    expect(result.public_label).toBe(proposal.public_label);
    expect(result.links).toEqual([expect.objectContaining({ from: fromLabel, to: toLabel,
      was: { sizing: 'placeholder' }, whose: FIRST, keeps_current_strength: true })]);
    expect(result.note).toContain('For links nobody had sized, this offers Olumi\u2019s first estimate');
    expect(result.note).toContain('only the user\u2019s review, never authorship');
    expect(result.note).not.toContain('Every strength here is Olumi\u2019s estimate');
  });

  it('RED: live and replay approval details carry THIS unsized link’s first-estimate card verbatim', async () => {
    const { result, proposal, store } = await prepare();
    const [chip] = approvalChipsFor([{ name: 'propose_link_strengths', ok: true, mutated: false, proposal_id: proposal.proposal_id }],
      (id) => ({ proposal: store.get(id), result }));
    expect(chip!.detail).toContain(`${pair} as strong, ${FIRST}`);
    expect(chip!.detail).toBe(proposal.public_label);
    const pending = proposalPendingAction(proposal, chip!, { scenario_id: SCENARIO, emitted_at_iso: new Date().toISOString() });
    const restored = new ProposalStore();
    expect(rehydrateProposals([pending], restored, { scenario_id: SCENARIO, user_id: null })).toBe(1);
    expect(offeredApproveChipOnRow([pending], { scenario_id: SCENARIO, user_id: null })?.detail).toBe(chip!.detail);
    expect(linkStrengthCardFor(proposal.proposal_id, restored.get(proposal.proposal_id))).toBe(chip!.detail);
    expect(linkStrengthCardFor('another-proposal', proposal)).toBeUndefined();
  });

  it('RED: composed reply for THIS placeholder offers a first estimate and says kept strength is review', async () => {
    const { result, args, userText } = await prepare();
    const text = composeProposalReply('propose_link_strengths', args, result, userText);
    expect(text).toContain(`${pair} as strong, ${FIRST}`);
    expect(text).toContain('For links nobody had sized, this offers Olumi\u2019s first estimate');
    expect(text).toContain('only your review, never authorship');
    expect(text).not.toContain('Olumi\u2019s estimates stay marked as Olumi\u2019s');
  });

  it('RED: singular same-band placeholder note says nobody sized it; user review receives no authorship', async () => {
    const { result, proposal } = await prepare(false, true);
    expect(proposal.public_label).toContain(`${pair} as strong`);
    expect(proposal.public_label).not.toContain('as your own estimate');
    expect(result.note).toContain('nobody had sized this link; approving records review, never the user\u2019s authorship');
    expect(result.note).not.toMatch(/Olumi[’']s estimate/);
  });

  it('CONTROL: independently sized prospect → revenue keeps Olumi’s estimate across card, whose, note and reply', async () => {
    const { result, proposal, args, userText } = await prepare(true);
    expect(proposal.public_label).toContain(`${pair} as strong, Olumi\u2019s estimate`);
    expect(result.links).toEqual([expect.objectContaining({ whose: 'Olumi\u2019s estimate', was: { band: 'strong', sizing: 'olumi_estimate' } })]);
    expect(result.note).toContain('Every strength here is Olumi\u2019s estimate');
    expect(linkStrengthCardFor(proposal.proposal_id, proposal)).toBe(proposal.public_label);
    expect(composeProposalReply('propose_link_strengths', args, result, userText)).toContain('Olumi\u2019s estimates stay marked as Olumi\u2019s');
    expect((await prepare(true, true)).result.note).toContain('Olumi\u2019s estimate stays Olumi\u2019s');
  });

  it('CONTROL: the user naming a placeholder’s existing band is review, with first-estimate attribution and no user credit', async () => {
    const { result, proposal } = await prepare(false, false, true);
    expect(proposal.public_label).toContain(`${pair} as strong, reviewed by you, kept as it is`);
    expect(result.links).toEqual([expect.objectContaining({ whose: FIRST, keeps_current_strength: true })]);
  });

  it('FAIL-CLOSED: first-estimate attribution on a sized link, or existing-estimate attribution on a placeholder, keeps the second call', async () => {
    for (const sized of [false, true]) {
      const { result, args, userText } = await prepare(sized);
      const links = result.links as Record<string, unknown>[];
      const wrong = { ...result, links: links.map((l) => ({ ...l, whose: sized ? FIRST : 'Olumi\u2019s estimate' })) };
      expect(composeProposalReply('propose_link_strengths', args, wrong, userText)).toBeNull();
    }
  });
});
