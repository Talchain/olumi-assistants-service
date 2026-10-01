/**
 * ⭐ PAUL'S SPRINT TOTAL IS THE SUM OF ITS PARTS (joint RCA 5929651862 item 2; DL ruling (ii) 5929790081; L1 lease 5929818182).
 * Served `96c6f5f4` (1 Oct manual test, turn 1): "Total sprint capacity allocated" is fed only by the two sprint-capacity
 * levers, both "% of upcoming sprint", under a ≤ 100% level limit — every R3-2 condition for a sum. But admission had
 * relabelled the limit's unit "% of upcoming sprint" → "%" (`agent_lane_limit_pct_of_level_v1`), so `findSumTallies`
 * compared the parts with "%" and minted nothing: the total stayed a guessed causal sink at Olumi's 0%, its limit unscored.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { findSumTallies } from '../admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { PARTS_IDENTITY_UNMODELLED_REASON, placeholderPartsFinding, sizedLinkTest } from '../../../orchestrator/context/placeholder-parts.js';
import { projectModelContext } from '../runtime/agent-capabilities.js';
import { howStronglyWords } from '../strength-authorship-words.js';

type Rec = Record<string, any>;
const SERVED = (JSON.parse(readFileSync(new URL('./fixtures/served-paul-sprint-96c6f5f4.json', import.meta.url), 'utf8')) as { graph: Rec }).graph;
const TOTAL = 'total_sprint_capacity_allocated';
const PARTS = ['ai_reporting_sprint_capacity', 'signup_bug_fix_sprint_capacity'];

describe('R3-2 sum mint survives the limit-unit relabel', () => {
  it('precondition: the served limit was relabelled "% of upcoming sprint" → "%", and both parts are "% of upcoming sprint"', () => {
    const c = SERVED.goal_constraints.find((x: Rec) => x.node_id === TOTAL);
    expect(c).toMatchObject({ operator: '<=', value_frame: 'level', unit: '%' });
    expect(c.provenance_unit_relabelled.pre_normalisation_unit).toBe('% of upcoming sprint');
    for (const p of PARTS) expect(SERVED.nodes.find((n: Rec) => n.id === p).observed_state.unit).toBe('% of upcoming sprint');
  });
  it('RED (served 96c6f5f4): the total is minted as the sum of its two levers', () => {
    const sums = findSumTallies(SERVED.nodes, SERVED.edges, SERVED.goal_constraints);
    expect(sums.map((s) => ({ node_id: s.node_id, factor_ids: [...s.factor_ids].sort() }))).toEqual([{ node_id: TOTAL, factor_ids: [...PARTS].sort() }]);
  });
  it('control: a part in ANOTHER unit still mints nothing (the sum of hours and % is not a total)', () => {
    const nodes = SERVED.nodes.map((n: Rec) => (n.id === PARTS[0] ? { ...n, observed_state: { ...n.observed_state, unit: 'hours' } } : n));
    expect(findSumTallies(nodes, SERVED.edges, SERVED.goal_constraints)).toEqual([]);
  });
  it('control: a limit whose unit names a DIFFERENT quantity than the tally mints nothing', () => {
    const constraints = SERVED.goal_constraints.map((c: Rec) => (c.node_id === TOTAL
      ? { ...c, unit: 'hours', provenance_unit_relabelled: { ...c.provenance_unit_relabelled, pre_normalisation_unit: 'hours' } } : c));
    expect(findSumTallies(SERVED.nodes, SERVED.edges, constraints)).toEqual([]);
  });
});

// ── END TO END: construction → registered graph → the limit gate (0 LLM; the drafter's output is the seeded fixture) ──

const SEEDED = (JSON.parse(readFileSync(new URL('./fixtures/drafted-sprint-total-seeded.json', import.meta.url), 'utf8')) as { candidate: unknown }).candidate;
const DRAFT_TOTAL = 'total_sprint_capacity_allocated';
const DRAFT_PARTS = ['sprint_capacity_on_ai_reporting', 'sprint_capacity_on_integration_fix'];
async function registered(candidate: unknown = SEEDED): Promise<Rec> {
  return (await built(candidate)).graph;
}
async function built(candidate: unknown = SEEDED): Promise<{ graph: Rec; result: Rec }> {
  let graph: Rec | null = null;
  const fn = vi.fn(async () => ({ text: JSON.stringify(candidate) })) as unknown as CallStructuredModel;
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = (body as { graph: Rec }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [] } } };
    return { status: 200, json: { versions: [] } };
  }) as unknown as InternalDispatch;
  const result = await buildModelFromBrief('96c6f5f4-0000-4000-8000-000000000001', 'sprint brief', dispatch, fn) as unknown as Rec;
  if (graph === null) throw new Error('nothing registered');
  return { graph, result };
}
const optionsOf = (g: Rec): Rec[] => g.nodes.filter((n: Rec) => n.kind === 'option' && n.interventions && Object.keys(n.interventions).length > 0);

describe('construction: the total of the sprint levers is their SUM, and its limit is scored (RCA item 2)', () => {
  it('RED: the total is registered with nonlinear_identity sum over both levers', async () => {
    const g = await registered();
    const total = g.nodes.find((n: Rec) => n.id === DRAFT_TOTAL);
    expect(total.nonlinear_identity).toMatchObject({ operation: 'sum' });
    expect([...total.nonlinear_identity.factor_ids].sort()).toEqual([...DRAFT_PARTS].sort());
  });
  it('RED: each part link is its definition — +1 per 1, β = 1 (frames 100/100), certain, at the spread floor', async () => {
    const g = await registered();
    for (const p of DRAFT_PARTS) {
      const e = g.edges.find((x: Rec) => x.from === p && x.to === DRAFT_TOTAL);
      expect(e).toMatchObject({ strength: { mean: 1, std: 0.001 }, exists_probability: 1, effect_direction: 'positive' });
      expect(e.provenance).toMatchObject({ definitional: true, magnitude: 'olumi_estimate',
        natural_effect: { amount: 1, per_source_change: 1, strength_mean: 1 } });
    }
  });
  it('RED: the ≤ 100% limit is SCORED for every option (no parts / identity withhold)', async () => {
    const g = await registered();
    const options = optionsOf(g);
    expect(options.length).toBeGreaterThanOrEqual(2);
    for (const o of options) expect(placeholderPartsFinding(DRAFT_TOTAL, g.nodes, g.edges, [o])).toBeNull();
  });
  it('control: a PRODUCT identity on the same shape is still withheld (it cannot be added up on links)', async () => {
    const g = await registered();
    const nodes = g.nodes.map((n: Rec) => (n.id === DRAFT_TOTAL ? { ...n, nonlinear_identity: { ...n.nonlinear_identity, operation: 'product' } } : n));
    expect(placeholderPartsFinding(DRAFT_TOTAL, nodes, g.edges, [optionsOf(g)[0]])).toMatchObject({ reason: PARTS_IDENTITY_UNMODELLED_REASON });
  });
  it('control: a SUM whose part link is a guess (one of two not definitional) is still withheld', async () => {
    const g = await registered();
    const edges = g.edges.map((e: Rec) => (e.from === DRAFT_PARTS[0] && e.to === DRAFT_TOTAL
      ? { ...e, provenance: { ...e.provenance, definitional: undefined } } : e));
    expect(placeholderPartsFinding(DRAFT_TOTAL, g.nodes, edges, [optionsOf(g)[0]])).toMatchObject({ reason: PARTS_IDENTITY_UNMODELLED_REASON });
  });
});

// ── DL #2445 condition 1 (CODEX 5930239704; MG reader sweep output/mg-0ebb952a/cond1-readers.md): a definition is
// arithmetic — never "Olumi's estimate", never a placeholder to ask about, never the user's own parameter. ──

const PERCENT = JSON.parse(JSON.stringify(SEEDED).split('% of upcoming sprint capacity').join('%')) as Rec;
const partEdges = (g: Rec): Rec[] => g.edges.filter((e: Rec) => e.to === DRAFT_TOTAL && DRAFT_PARTS.includes(e.from));
const TOTAL_LABEL = 'Total sprint capacity allocated';

describe('a part of a total is fixed by definition on every reader (DL #2445 condition 1)', () => {
  it('RED (C1): no open question asks how much a part changes its total; the sum sentence stays (control)', async () => {
    const { result } = await built();
    const qs = (result.open_questions ?? []) as string[];
    expect(qs.filter((q) => q.includes(`change "${TOTAL_LABEL}"`))).toEqual([]);
    expect(qs.some((q) => q.includes(TOTAL_LABEL))).toBe(true);
  });

  it('RED (C2/C3): a total in plain "%" still scores its limit, and its parts read as sized', async () => {
    const g = await registered(PERCENT);
    expect(partEdges(g)).toHaveLength(2);
    for (const e of partEdges(g)) expect(e.provenance).toMatchObject({ definitional: true, natural_effect: { amount_unit: '%' } });
    for (const o of optionsOf(g)) expect(placeholderPartsFinding(DRAFT_TOTAL, g.nodes, g.edges, [o])).toBeNull();
    const sized = sizedLinkTest(g.nodes);
    for (const e of partEdges(g)) expect(sized(e)).toBe(true);
  });

  it('control (C2/C3): the SAME link without the definition is still unsized, and the limit is withheld', async () => {
    const g = await registered(PERCENT);
    const edges = g.edges.map((e: Rec) => (partEdges(g).includes(e) ? { ...e, provenance: { ...e.provenance, definitional: undefined } } : e));
    const sized = sizedLinkTest(g.nodes);
    for (const e of edges.filter((x: Rec) => x.to === DRAFT_TOTAL && DRAFT_PARTS.includes(x.from))) expect(sized(e)).toBe(false);
    expect(placeholderPartsFinding(DRAFT_TOTAL, g.nodes, edges, [optionsOf(g)[0]])).not.toBeNull();
  });

  it('RED (N1): a part link the drafter marked as stated in the brief is still Olumi\'s reading, not the user\'s', async () => {
    const drafted = JSON.parse(JSON.stringify(SEEDED)) as Rec;
    for (const l of drafted.links) if (l.to === TOTAL_LABEL) l.provenance = 'explicit';
    const g = await registered(drafted);
    expect(partEdges(g)).toHaveLength(2);
    for (const e of partEdges(g)) expect(e.provenance).toMatchObject({ source: 'cee_hypothesis', definitional: true });
  });

  it('RED (C5): the Agent reads each part link as `by_definition`; an ordinary link keeps its own source (control)', async () => {
    const g = await registered();
    const ctx = projectModelContext({ nodes: g.nodes, edges: g.edges, raw: g, analysis_state: undefined, analysis_ready: undefined } as never) as Rec;
    const links = ctx.links as Rec[];
    const parts = links.filter((l) => l.to === DRAFT_TOTAL && DRAFT_PARTS.includes(l.from));
    expect(parts).toHaveLength(2);
    for (const l of parts) expect(l).toMatchObject({ source: 'by_definition', holds_by_definition: true });
    const ordinary = links.filter((l) => l.to !== DRAFT_TOTAL && l.source !== undefined);
    expect(ordinary.length).toBeGreaterThan(0);
    for (const l of ordinary) expect(l.source).not.toBe('by_definition');
  });
});

describe('howStronglyWords: who sized a link, with a definition as its own class (C4)', () => {
  const def = { provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', definitional: true } };
  const est = { provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } };
  const yours = { provenance: { source: 'user_specified', magnitude: 'user_stated' } };
  const ph = { provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } };
  it.each([
    ['RED: a definition alone', [def], 'how strongly is fixed by definition: one for one.'],
    ['control: an estimate alone', [est], 'how strongly is Olumi\'s estimate.'],
    ['control: the user\'s own', [yours], 'how strongly is as you stated it.'],
    ['control: a placeholder', [ph], 'how strongly is not known yet: Olumi used a placeholder strength, not an estimate.'],
    ['RED: definition + estimate', [def, est], 'how strongly is partly fixed by definition and partly Olumi\'s estimate, not a measurement.'],
    ['RED: the user\'s + a definition (nothing guessed)', [yours, def], 'how strongly is partly as you stated it and partly fixed by definition.'],
    ['control: estimate + placeholder (unchanged words)', [est, ph], 'how strongly is partly Olumi\'s estimate and partly a placeholder, not a measurement.'],
  ])('%s', (_name, edges, words) => {
    expect(howStronglyWords(edges)).toBe(words);
  });
});
