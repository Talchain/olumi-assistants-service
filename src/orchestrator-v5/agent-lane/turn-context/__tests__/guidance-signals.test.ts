/**
 * AI HARNESS T2: the Reasoning Coach's signals, assembled from the OWNERS' readers, checked against the contract's
 * SERVED cases (programme-docs `rc/reasoning-coach-20261001` @24883c2d: "for served cases also derive the signals from
 * `source.capture` with your own readers and compare to `state`"). The captures are served Agent responses from R3's
 * F5 runs on 1 Oct, so the corpus comes from the wire, not from this author. Plus CODEX_CLI_OVERFLOW's CR on #2465
 * (5935763452): an omitted licence is unlicensed, a malformed graph is no model, and a value change moves its hash.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleGuidanceSignals, type GuidanceSignalInputs, type GuidanceSignals } from '../guidance-signals.js';
import { detectSameLeverOptions } from '../../../../cee/structure/index.js';

type Case = { id: string; capture: string; capture_sha256: string; capture_sha_matches_case: boolean; body: Record<string, any>; expected_state: Record<string, unknown> };
const F = JSON.parse(readFileSync(new URL('./fixtures/rc-served-signal-cases.json', import.meta.url), 'utf8')) as { cases: Case[] };
const byId = (id: string): Case => F.cases.find((c) => c.id === id)!;

/** Inputs, not derivations: the request kind, the persisted guidance and the explicit request come from the turn. */
const INPUT_KEYS = new Set(['turn.request', 'guidance', 'user.explicit_request']);
const HEX12 = /^[0-9a-f]{12}$/;

const inputsOf = (c: Case): GuidanceSignalInputs => ({
  request: c.expected_state['turn.request'] as GuidanceSignalInputs['request'],
  // The decision point is the reply's specific controls: every chip but the static next steps (as served).
  offeredSpecific: (c.body.suggested_action_ids as string[]).filter((id) => !id.startsWith('agent-next-')).map((id) => ({ id })),
  graph: c.body.draft_graph,
  analysisState: c.body.analysis_state,
  analysisResult: c.body.analysis_result,
  optionParticipation: c.body.option_participation,
  // The licence the served wire's leader gate read on this Run. The slim capture carries no `analysis_ready`, so the
  // owner's full read (`leaderLicenceFromState`) is the wiring's input, not this check's.
  leaderLicensed: c.body.analysis_state?.leader_claim?.permitted === true,
});

/** The contract's own members of a goal-path entry: `value_hash` is checked on its own below. */
const withoutHashes = (k: string, v: unknown): unknown =>
  (k === 'model.goal_path_links' || k === 'model.goal_path_factors') && Array.isArray(v)
    ? v.map(({ value_hash: _h, ...rest }: { value_hash?: string }) => rest) : v;

describe('guidance signals from served captures (RC derivation check)', () => {
  it('the corpus is the contract\'s: 9 served cases, each capture byte-identical to the one the case names', () => {
    expect(F.cases).toHaveLength(9);
    expect(F.cases.every((c) => c.capture_sha_matches_case)).toBe(true);
  });

  for (const c of F.cases) {
    it(`RED ${c.id}: every derived signal equals the case's state`, () => {
      const got = assembleGuidanceSignals(inputsOf(c)) as unknown as Record<string, unknown>;
      const derived = Object.keys(c.expected_state).filter((k) => !INPUT_KEYS.has(k));
      expect(derived.length, 'vacuity: the case states derived signals').toBeGreaterThan(15);
      for (const k of derived) expect(withoutHashes(k, got[k]), k).toEqual(c.expected_state[k]);
      const entries = [...(got['model.goal_path_links'] as { value_hash: string }[]), ...(got['model.goal_path_factors'] as { value_hash: string }[])];
      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) expect(e.value_hash).toMatch(HEX12);
    });
  }

  it('CONTRAST: F1\'s same-lever detector on the canonical shape as stored sees no levers; the projection is what supplies the overlap', () => {
    const c = byId('A-STALE-SILENT');
    expect(detectSameLeverOptions(c.body.draft_graph, 0.6).detected).toBe(false);
    expect(assembleGuidanceSignals(inputsOf(c))['model.same_lever']).toBe(true);
  });
});

describe('model.same_lever is the contract\'s rule over F1\'s overlap (RC @24883c2d)', () => {
  const graph = (a: Record<string, number>, b: Record<string, number>, extra: Record<string, unknown>[] = []) => ({
    nodes: [
      { id: 'g', kind: 'goal', label: 'Goal' },
      { id: 'cap', kind: 'factor', label: 'AI capacity', observed_state: { value: 0.5 } },
      { id: 'hrs', kind: 'factor', label: 'Hours', observed_state: { value: 10 } },
      { id: 'sq', kind: 'option', label: 'Carry on', is_baseline: true, interventions: { cap: 0.5, hrs: 10 } },
      { id: 'a', kind: 'option', label: 'A', interventions: a },
      { id: 'b', kind: 'option', label: 'B', interventions: b },
      ...extra,
    ],
    edges: [{ from: 'cap', to: 'g' }, { from: 'hrs', to: 'g' }],
  });
  const sameLever = (g: unknown, participation?: unknown): boolean =>
    assembleGuidanceSignals({ request: 'turn', offeredSpecific: [], graph: g, analysisState: undefined, analysisResult: undefined, optionParticipation: participation, leaderLicensed: false })['model.same_lever'];

  it('amount only (both up from the status quo): same lever', () => {
    expect(sameLever(graph({ cap: 0.8, hrs: 12 }, { cap: 0.9, hrs: 14 }))).toBe(true);
  });
  it('RED (D1): opposite allocations of one resource are a trade-off, not one lever', () => {
    expect(sameLever(graph({ cap: 1, hrs: 12 }, { cap: 0, hrs: 14 }))).toBe(false);
  });
  it('RED (D2/D3): an option left out of the comparison never counts', () => {
    const g = graph({ cap: 0.8, hrs: 12 }, { cap: 0.1, hrs: 5 }, [{ id: 'c', kind: 'option', label: 'C (Olumi)', interventions: { cap: 0.9, hrs: 14 } }]);
    expect(sameLever(g)).toBe(true);
    expect(sameLever(g, [{ option_id: 'c', state: 'excluded_olumi_proposed' }])).toBe(false);
  });
  it('a target an option leaves at the baseline does not count as moving the same way', () => {
    expect(sameLever(graph({ cap: 0.5, hrs: 12 }, { cap: 0.9, hrs: 14 }))).toBe(false);
  });
});

describe('the leader is read only under the owner\'s licence (CODEX_CLI_OVERFLOW P1 on #2465)', () => {
  const c = byId('A-WHAT-CHANGES-NONE-MEASURABLE-SILENT');
  const permittedClaim = { ...c.body.analysis_state, leader_claim: { permitted: true, withheld_reason: 'separation_unavailable' } };

  it('RED: an OMITTED licence is unlicensed, even when leader_claim says permitted', () => {
    const { leaderLicensed: _omit, ...rest } = inputsOf(c);
    const out = assembleGuidanceSignals({ ...rest, analysisState: permittedClaim, analysisResult: { leading_option_id: 'opt_a' } } as unknown as GuidanceSignalInputs);
    expect(out['run.leader_licensed']).toBe(false);
    expect(out['run.leader_option_id']).toBeNull();
  });

  it('RED: unlicensed, the leader\'s identity is never READ; licensed (control), it is', () => {
    let identityReads = 0;
    const inner = { get leading_option_id() { identityReads += 1; return 'opt_a'; } };
    const block = { get leading_option_id() { identityReads += 1; return 'opt_a'; }, data: inner };
    const unlicensed = assembleGuidanceSignals({ ...inputsOf(c), analysisState: permittedClaim, analysisResult: block, leaderLicensed: false });
    expect(unlicensed['run.leader_option_id']).toBeNull();
    expect(identityReads, 'no read of the identity without the licence').toBe(0);
    const licensed = assembleGuidanceSignals({ ...inputsOf(c), analysisState: permittedClaim, analysisResult: block, leaderLicensed: true });
    expect(licensed['run.leader_option_id']).toBe('opt_a');
    expect(identityReads).toBeGreaterThan(0);
  });
});

describe('a malformed graph is no model, never zero options (CODEX_CLI_OVERFLOW P1 on #2465)', () => {
  const good = {
    nodes: [{ id: 'g', kind: 'goal', label: 'MRR' }, { id: 'f', kind: 'factor', label: 'Price' }, { id: 'o1', kind: 'option', label: 'Raise price', interventions: { f: 1 } }],
    edges: [{ from: 'f', to: 'g' }],
  };
  const signals = (graph: unknown): GuidanceSignals =>
    assembleGuidanceSignals({ request: 'turn', offeredSpecific: [], graph, analysisState: undefined, analysisResult: undefined, leaderLicensed: false });

  it('CONTROL: the readable graph has its goal, its option and its path', () => {
    const out = signals(good);
    expect(out['model.goal_present']).toBe(true);
    expect(out['model.non_sq_option_ids']).toEqual(['o1']);
    expect(out['model.goal_path_links'].map((l) => l.link_id)).toEqual(['f->g']);
  });

  const broken: Array<[string, unknown]> = [
    ['edges not an array', { ...good, edges: 'x' }],
    ['an edge that is not a record', { ...good, edges: [...good.edges, 'x'] }],
    ['an edge with no ends', { ...good, edges: [...good.edges, {}] }],
    ['an edge to a node that does not exist', { ...good, edges: [...good.edges, { from: 'f', to: 'ghost' }] }],
    ['an option with no kind', { ...good, nodes: [...good.nodes.slice(0, 2), { id: 'o1', label: 'Raise price', interventions: { f: 1 } }] }],
    ['a duplicated node id', { ...good, nodes: [...good.nodes, { id: 'o1', kind: 'factor', label: 'Dup' }] }],
  ];
  for (const [what, graph] of broken) {
    it(`RED: a goal with ${what} reads as NO model — no goal, no options, nothing for widen to fire on`, () => {
      const out = signals(graph);
      expect(out['model.goal_present']).toBe(false);
      expect(out['model.non_sq_option_ids']).toEqual([]);
      expect(out['model.goal_path_links']).toEqual([]);
      expect(out['model.same_lever']).toBe(false);
    });
  }

  it('TOTAL: no model, a malformed graph or a missing run reads as nothing to coach, never a throw', () => {
    for (const graph of [undefined, null, 'x', { nodes: 'x' }, { nodes: [{ kind: 'goal' }], edges: [{}] }]) {
      const out = signals(graph);
      expect(out['model.goal_present']).toBe(false);
      expect(out['model.goal_path_links']).toEqual([]);
      expect(out['run.decision_sensitivity']).toEqual({ status: 'not_measured' });
    }
  });
});

describe('a stored-value change moves that item\'s hash, and nothing else does (CODEX_CLI_OVERFLOW P2 on #2465)', () => {
  const c = byId('A-STRENGTHEN-PLACEHOLDER-P1');
  const base = assembleGuidanceSignals(inputsOf(c));
  const link = base['model.goal_path_links'][0]!;
  const factor = base['model.goal_path_factors'][0]!;
  const edited = (edit: (g: { nodes: Record<string, any>[]; edges: Record<string, any>[] }) => void): GuidanceSignals => {
    const g = structuredClone(c.body.draft_graph) as { nodes: Record<string, any>[]; edges: Record<string, any>[] };
    edit(g);
    return assembleGuidanceSignals({ ...inputsOf(c), graph: g });
  };
  /** An identity-bound per-item key: the contract's {item_id, link_sizing} plus the stored value. */
  const keyOf = (s: GuidanceSignals, id: string) => {
    const l = s['model.goal_path_links'].find((x) => x.link_id === id)!;
    return JSON.stringify({ item_id: l.link_id, link_sizing: l.link_sizing, value_hash: l.value_hash });
  };

  it('RED: a link\'s strength mean 0.2 → 0.8 changes its value_hash (and its key); every other signal is identical', () => {
    const [from, to] = link.link_id.split('->');
    const before = edited((g) => { const e = g.edges.find((x) => x.from === from && x.to === to)!; e.strength = { ...e.strength, mean: 0.2 }; });
    const after = edited((g) => { const e = g.edges.find((x) => x.from === from && x.to === to)!; e.strength = { ...e.strength, mean: 0.8 }; });
    expect(keyOf(after, link.link_id)).not.toBe(keyOf(before, link.link_id));
    const strip = (s: GuidanceSignals) => JSON.stringify({ ...s, 'model.goal_path_links': s['model.goal_path_links'].map((l) => (l.link_id === link.link_id ? { ...l, value_hash: '' } : l)) });
    expect(strip(after)).toBe(strip(before));
  });

  it('RED: a factor\'s stored value change moves its value_hash', () => {
    const after = edited((g) => { const n = g.nodes.find((x) => x.id === factor.factor_id)!; n.observed_state = { ...(n.observed_state ?? {}), value: 12345 }; });
    expect(after['model.goal_path_factors'].find((f) => f.factor_id === factor.factor_id)!.value_hash).not.toBe(factor.value_hash);
  });

  it('CONTROL: a description or label-free edit leaves every hash as it was', () => {
    const after = edited((g) => { g.nodes[0]!.description = 'reworded'; });
    expect(after['model.goal_path_links'].map((l) => l.value_hash)).toEqual(base['model.goal_path_links'].map((l) => l.value_hash));
    expect(after['model.goal_path_factors'].map((f) => f.value_hash)).toEqual(base['model.goal_path_factors'].map((f) => f.value_hash));
  });
});
