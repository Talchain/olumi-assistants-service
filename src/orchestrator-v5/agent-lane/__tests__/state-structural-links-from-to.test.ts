/**
 * ⭐ PJ-C1 TOKENS, LEVER 2 (DL #72 5866036457): A STRUCTURAL LINK IS SAID BY ITS ENDS ONLY.
 *
 * Measured on served A09 (`c35f1c7`, `pj-20260928T074951Z`, 18,284 input tokens): the state's 26 links took 5,533
 * characters, and 13 of them were structural. Those are decision → option (6) and option → factor (7). Every one read
 * `{mean: 1, std: 0.01}`, "very strong", existence 1, positive: 2,838 characters, re-sent on every model call. Those
 * values are the engine's structure, not a strength anyone judged.
 *
 * The DL's row: no reply or tool argument ever read those values.
 *   - Replies: over 1,295 distinct served replies (every pj-* capture of 27–28 Sep, 1,557 files), 0 sentences name
 *     both ends of a structural link together with a strength word. The CONTRAST, causal links, gives 349. Five raw
 *     hits were excluded: in each, an option shares its label with a factor, so the sentence names the factor.
 *     (`scratchpad/lever2-corpus.py`.)
 *   - Tool arguments: no Agent tool takes a numeric strength. `propose_link_strength` takes band WORDS and labels, and
 *     reads the link's current strength from the graph, never from the state (row below).
 *
 * The rule: a link from the decision or from an option, carrying the fixed structure (mean 1, std 0.01 or none,
 * existence 1 or none, not negative), is `{from, to}`. Any other link from an option keeps its full form, and so does
 * every causal link.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AGENT_TOOLS, dispatchTool } from '../runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

type Graph = { nodes: Array<Record<string, unknown> & { id: string; kind: string }>; edges: Array<Record<string, unknown> & { from: string; to: string }> };
const F8 = JSON.parse(readFileSync(new URL('./fixtures/served-f8-run-graph-d6b09c0.json', import.meta.url), 'utf8')) as Graph;
const C05 = (JSON.parse(readFileSync(new URL('./fixtures/served-journey-c-c05-budget-651a7fd.json', import.meta.url), 'utf8')) as { graph: Graph }).graph;

async function stateOf(graph: Graph): Promise<{ links: Array<Record<string, unknown>> }> {
  const d: InternalDispatch = async (path) => (path.endsWith('/graph')
    ? { status: 200, json: { graph: JSON.parse(JSON.stringify(graph)), graph_hash: 'h0', graph_identity_hash: { value: 'id-h0' } } }
    : { status: 500, json: {} });
  const caps = createAgentCapabilities(d, new ProposalStore());
  const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400c3', authenticated_user_id: null, request_id: 'r', user_text: 'x', user_turn_text: 'x' };
  return (await dispatchTool('get_canonical_state', '{}', ctx as never, caps)) as never;
}
const kindsOf = (g: Graph) => new Map(g.nodes.map((n) => [n.id, n.kind] as const));

describe('⭐ PJ-C1 lever 2: a structural link is said by its ends only', () => {
  for (const [name, graph] of [['served F8', F8], ['served journey C (C05)', C05]] as const) {
    it(`RED (${name}): every decision → option and option → factor link is exactly {from, to}`, async () => {
      const kind = kindsOf(graph);
      const structural = graph.edges.filter((e) => kind.get(e.from) === 'decision' || kind.get(e.from) === 'option');
      expect(structural.length, 'precondition: the served graph has structural links').toBeGreaterThan(0);
      expect(structural.every((e) => (e.strength as { mean?: number } | undefined)?.mean === 1), 'precondition: all carry the fixed structure').toBe(true);
      const { links } = await stateOf(graph);
      const said = links.filter((l) => kind.get(String(l.from)) === 'decision' || kind.get(String(l.from)) === 'option');
      expect(said).toEqual(structural.map((e) => ({ from: e.from, to: e.to })));
    });

    it(`CONTROL (${name}): every causal link keeps its strength, band and source`, async () => {
      const kind = kindsOf(graph);
      const { links } = await stateOf(graph);
      const causal = links.filter((l) => kind.get(String(l.from)) !== 'decision' && kind.get(String(l.from)) !== 'option');
      expect(causal.length).toBeGreaterThan(0);
      for (const l of causal) {
        expect(l, JSON.stringify(l)).toHaveProperty('strength');
        // Science 393023 LICENCE ruling 3, re-derived: a placeholder (nobody sized it) projects no band; every other keeps it.
        if ((l as { sizing?: unknown }).sizing === 'placeholder') expect(l).not.toHaveProperty('band');
        else expect(l).toHaveProperty('band');
      }
    });
  }

  it('CONTRAST: a link from an option with any other strength, existence or sign keeps its full form', async () => {
    const kind = kindsOf(F8);
    const target = F8.edges.find((e) => kind.get(e.from) === 'option')!;
    for (const change of [
      { strength: { mean: 0.6, std: 0.1 } },
      { exists_probability: 0.8 },
      { effect_direction: 'negative' },
    ]) {
      const g = structuredClone(F8);
      Object.assign(g.edges.find((e) => e.from === target.from && e.to === target.to)!, change);
      const { links } = await stateOf(g);
      const l = links.find((x) => x.from === target.from && x.to === target.to)!;
      expect(Object.keys(l).length, JSON.stringify(change)).toBeGreaterThan(2);
    }
  });

  it('no Agent tool takes a numeric strength: a strength is a band WORD, so no argument can carry the structure’s 1 or 0.01', () => {
    const numericStrength: string[] = [];
    const walk = (tool: string, schema: unknown, path: string): void => {
      if (schema === null || typeof schema !== 'object') return;
      const s = schema as { type?: unknown; properties?: Record<string, unknown>; items?: unknown };
      for (const [k, v] of Object.entries(s.properties ?? {})) {
        const t = (v as { type?: unknown }).type;
        if (/strength|mean|std/i.test(k) && (t === 'number' || t === 'integer' || (Array.isArray(t) && t.includes('number')))) numericStrength.push(`${tool}.${path}${k}`);
        walk(tool, v, `${path}${k}.`);
      }
      if (s.items !== undefined) walk(tool, s.items, `${path}[].`);
    };
    for (const t of AGENT_TOOLS) walk(t.name, t.parameters, '');
    expect(numericStrength).toEqual([]);
    const pls = AGENT_TOOLS.find((t) => t.name === 'propose_link_strength')!;
    expect((pls.parameters as { properties: Record<string, { enum?: string[] }> }).properties.strength!.enum).toEqual(['weak', 'moderate', 'strong', 'very strong']);
  });

  it('MEASURED (served F8): the links the model reads shrink', async () => {
    const kind = kindsOf(F8);
    const { links } = await stateOf(F8);
    const now = JSON.stringify(links).length;
    const full = JSON.stringify(links.map((l) => {
      if (kind.get(String(l.from)) !== 'decision' && kind.get(String(l.from)) !== 'option') return l;
      return { ...l, source: 'cee_hypothesis', direction: 'positive', strength: { mean: 1, std: 0.01 }, band: 'very strong', exists_probability: 1 };
    })).length;
    expect(now).toBeLessThan(full);
    console.log(`[F8] links ${full} → ${now} chars (−${(100 * (full - now) / full).toFixed(1)}%)`);
  });
});
