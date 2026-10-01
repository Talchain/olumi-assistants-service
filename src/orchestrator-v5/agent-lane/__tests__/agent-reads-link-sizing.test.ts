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
    expect(links.filter((l) => l.sizing === 'placeholder').map(key).sort()).toEqual([...REAL_PLACEHOLDERS].sort());
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
  const composed = async (asked: readonly (readonly [string, string])[], graph: unknown = F.graph) => {
    const dg: InternalDispatch = async (path) => (path.endsWith('/graph') ? { status: 200, json: { graph, graph_hash: F.graph_hash } } : { status: 500, json: {} });
    const args = {
      links: asked.map(([k, strength]) => { const [from, to] = k.split('->'); return { from_label: label(from!), to_label: label(to!), strength }; }),
      rationale: 'fix them all', whole_request: true,
    };
    const result = await createAgentCapabilities(dg, new ProposalStore()).proposeLinkStrengths!(ctx, args);
    expect((result as { ok?: unknown }).ok, JSON.stringify(result)).toBe(true);
    return { result: result as { links: { was: { sizing?: unknown } }[]; already?: string[] }, text: composeProposalReply('propose_link_strengths', args, result, 'fix them all') };
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
    expect(text).toContain('Olumi\u2019s estimates stay marked as Olumi\u2019s');
    expect(text).not.toContain(REPLACES);
  });

  it('FAIL-CLOSED: a link whose sizing before is not typed keeps the second call', async () => {
    const { result } = await composed(PARTS_ESTIMATES.map((k) => [k, 'very strong'] as const));
    const untyped = { ...result, links: result.links.map((l) => ({ ...l, was: { ...l.was, sizing: undefined } })) };
    expect(composeProposalReply('propose_link_strengths', { whole_request: true, links: [] }, untyped, 'fix them all')).toBeNull();
  });
});
