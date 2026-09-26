/**
 * #1710's two remaining binding items, through `buildModelFromBrief`:
 *
 * 1. ⛔ RETRY ADOPTION PRESERVES IDENTITY, NOT COUNTS. Independent review at
 *    78b07e8b: a retry with the SAME brief-stated counts but a SWAPPED option or
 *    relationship was adopted and registered once. Same counts are not the same
 *    decision.
 * 2. ⛔ THE CAP GOVERNS MODEL-PROPOSED ENRICHMENT ONLY. Release Control: when the
 *    user's material PLUS required structural scaffolding alone exceeds the limits,
 *    admit the model unchanged and report it oversized — never refuse, truncate
 *    or retry it.
 *
 * Every fixture carries a vacuity guard computed by the real gate, so a case
 * cannot pass because its fixture stopped meaning what it says.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { COMPACT_LIMITS, assessConstructionSize } from '../construction-size-gate.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const SCENARIO = '33333333-3333-4333-8333-333333333333';
const BRIEF = 'Should I hire a Tech lead or two developers to increase velocity?';

const factor = (label: string, provenance = 'ai_proposed') => ({
  label, role: 'observable', baseline_known: false, baseline_value: null, unit: null, provenance, plausible_max: 100,
});
const link = (from: string, to: string, provenance = 'inferred') => ({ from, to, direction: 'positive', provenance });

function candidate(opts: { extraFactors: number; options?: string[]; explicitLinks?: [string, string][] }) {
  const names = Array.from({ length: opts.extraFactors }, (_, i) => `Secondary factor ${i}`);
  const options = opts.options ?? ['Hire a tech lead', 'Hire two developers'];
  return {
    goal: { metric: 'Velocity', operator: '>=', value: 20, unit: 'points', horizon_months: 6, provenance: 'explicit' },
    constraints: [],
    options: options.map((label) => ({ label, provenance: 'explicit', changes: ['Delivery capacity'], interventions: [] })),
    factors: [factor('Delivery capacity', 'inferred'), ...names.map((n) => factor(n))],
    risks: [],
    outcomes: [{ label: 'Velocity', provenance: 'inferred' }],
    links: [
      ...(opts.explicitLinks ?? []).map(([f, t]) => link(f, t, 'explicit')),
      link('Delivery capacity', 'Velocity'),
      ...names.map((n) => link(n, 'Velocity')),
    ],
    unknowns: [],
  };
}
/** The one question for two user options nothing tells apart (`admit-model.ts`, DL #70 5842361028 / 5842400604). */
const STATED_TWINS = 'What makes "Hire a tech lead" different from "Hire two developers"? As drafted, nothing the model holds tells them apart, so the analysis cannot compare them yet.';
const sizeOf = (c: unknown) => assessConstructionSize(admitCandidateModel(c as CandidateModel, {}));

function structuredSequence(...payloads: readonly unknown[]) {
  const calls: string[] = [];
  const fn = vi.fn(async (req: { instructions: string }) => {
    const idx = calls.length;
    calls.push(req.instructions);
    return { text: JSON.stringify(payloads[Math.min(idx, payloads.length - 1)]) };
  }) as unknown as CallStructuredModel;
  return { fn, calls };
}
function dispatcher() {
  const paths: string[] = [];
  const d: InternalDispatch = async (path) => {
    paths.push(path);
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  return { d, paths };
}
const registered = (paths: readonly string[]) => paths.filter((p) => p.endsWith('/graph/register')).length;

describe('⛔ a retry is adopted only if every user-stated identity survives', () => {
  it('RED: a same-count retry with a SWAPPED OPTION is not adopted — nothing is written', async () => {
    const first = candidate({ extraFactors: 15 });
    const retry = candidate({ extraFactors: 2, options: ['Hire a tech lead', 'Outsource to an agency'] });
    // Vacuity guards: the first is oversized and NOT user-exempt; the retry is
    // smaller; brief-stated COUNTS are equal while the IDENTITIES differ.
    const s1 = sizeOf(first); const s2 = sizeOf(retry);
    expect(s1.within).toBe(false);
    expect(s1.user_material_exceeds_limit).toBe(false);
    expect(s2.nodes).toBeLessThan(s1.nodes);
    expect(s2.brief_stated_nodes).toBe(s1.brief_stated_nodes);
    expect(s2.brief_stated_keys.nodes).not.toEqual(s1.brief_stated_keys.nodes);

    const s = structuredSequence(first, retry);
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn);
    expect(s.calls).toHaveLength(2);
    expect(out.ok).toBe(false);
    expect(out.refusal).toBe('model_too_large');
    expect(registered(dp.paths)).toBe(0);
  });

  it('RED: a same-count retry with a SWAPPED RELATIONSHIP is not adopted — nothing is written', async () => {
    const first = candidate({ extraFactors: 15, explicitLinks: [['Delivery capacity', 'Velocity'], ['Secondary factor 0', 'Velocity']] });
    const retry = candidate({ extraFactors: 2, explicitLinks: [['Delivery capacity', 'Velocity'], ['Secondary factor 1', 'Velocity']] });
    const s1 = sizeOf(first); const s2 = sizeOf(retry);
    expect(s1.within).toBe(false);
    expect(s1.user_material_exceeds_limit).toBe(false);
    expect(s2.nodes).toBeLessThan(s1.nodes);
    expect(s2.brief_stated_edges).toBe(s1.brief_stated_edges);
    expect(s2.brief_stated_keys.edges).not.toEqual(s1.brief_stated_keys.edges);

    const s = structuredSequence(first, retry);
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn);
    expect(out.ok).toBe(false);
    expect(out.refusal).toBe('model_too_large');
    expect(registered(dp.paths)).toBe(0);
  });

  it('CONTRAST: a smaller retry that keeps every stated identity IS adopted', async () => {
    const first = candidate({ extraFactors: 15 });
    const retry = candidate({ extraFactors: 2 });
    const s = structuredSequence(first, retry);
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(registered(dp.paths)).toBe(1);
  });
});

describe('⛔ identity is the FULL stated text and the stated direction (Panel pre-review 5791588889)', () => {
  it('RED (B1): two options that share a 33-character prefix are two identities — a retry dropping one is not adopted', async () => {
    const london = 'Hire a senior engineer in London office';
    const berlin = 'Hire a senior engineer in Berlin office';
    const first = candidate({ extraFactors: 15, options: [london, berlin] });
    const retry = candidate({ extraFactors: 2, options: [london] });
    const s1 = sizeOf(first); const s2 = sizeOf(retry);
    // Vacuity guards: both labels are truncated by admission to the SAME label,
    // so a label-keyed identity cannot tell them apart.
    const labels = admitCandidateModel(first as unknown as CandidateModel, {}).nodes.filter((n) => n.kind === 'option').map((n) => n.label);
    expect(new Set(labels).size).toBe(1);
    expect(s1.within).toBe(false);
    expect(s1.user_material_exceeds_limit).toBe(false);
    expect(s2.nodes).toBeLessThan(s1.nodes);

    const s = structuredSequence(first, retry);
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn);
    expect(s.calls).toHaveLength(2);
    expect(out.ok).toBe(false);
    expect(out.refusal).toBe('model_too_large');
    expect(registered(dp.paths)).toBe(0);
  });

  it('RED (B2): a retry that FLIPS the sign of a stated relationship is not adopted', async () => {
    const first = candidate({ extraFactors: 15, explicitLinks: [['Secondary factor 0', 'Velocity']] });
    const retry = candidate({ extraFactors: 2, explicitLinks: [['Secondary factor 0', 'Velocity']] });
    for (const l of (retry.links as { from: string; to: string; direction: string; provenance: string }[])) {
      if (l.from === 'Secondary factor 0' && l.provenance === 'explicit') l.direction = 'negative';
    }
    const s1 = sizeOf(first); const s2 = sizeOf(retry);
    expect(s1.within).toBe(false);
    expect(s1.user_material_exceeds_limit).toBe(false);
    expect(s2.nodes).toBeLessThan(s1.nodes);
    // Vacuity guard: the flip survives admission onto the registered edge.
    const dir = (c: unknown) => admitCandidateModel(c as CandidateModel, {}).edges
      .filter((e) => (e as { provenance?: { source?: string } }).provenance?.source === 'brief_extraction')
      .map((e) => (e as { effect_direction?: string }).effect_direction);
    expect(dir(first)).toContain('positive');
    expect(dir(retry)).toContain('negative');

    const s = structuredSequence(first, retry);
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn);
    expect(out.ok).toBe(false);
    expect(out.refusal).toBe('model_too_large');
    expect(registered(dp.paths)).toBe(0);
  });

  it('RED (B3): an ADOPTED retry names what it left out — nothing vanishes silently', async () => {
    const first = candidate({ extraFactors: 15 });
    const retry = candidate({ extraFactors: 2 });
    (retry as { unknowns: string[] }).unknowns = ['Does team morale matter here?'];
    const s = structuredSequence(first, retry);
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn) as Record<string, unknown>;
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(registered(dp.paths)).toBe(1);
    const left = out.left_out_to_stay_compact as { kind: string; label: string }[] | undefined;
    expect(left?.map((x) => x.label).sort()).toEqual(Array.from({ length: 13 }, (_, i) => `Secondary factor ${i + 2}`).sort());
    // The stated 6-month deadline is asked first (construction-goal-losses-are-said.test.ts), then what the retry parked.
    // This fixture's two USER options both act on "Delivery capacity" with no level, so nothing the model holds tells
    // them apart: they are kept and asked about once, ahead of the parked questions (construction-no-identical-options.test.ts).
    expect(out.open_questions).toEqual(['Does "Velocity" get there within 6 months? The model holds no deadline yet, so no result answers that.', STATED_TWINS, 'Does team morale matter here?']);
    expect((out.not_represented as string[]).join(' ')).toMatch(/13 item\(s\) from the first draft were left out/);
  });

  it('RED: a first pass already within budget still returns the questions it parked in `unknowns`', async () => {
    const c = candidate({ extraFactors: 2 });
    (c as { unknowns: string[] }).unknowns = ['Is the bottleneck coordination or capacity?', 'What does onboarding cost the current team?'];
    const s = structuredSequence(c);
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn) as Record<string, unknown>;
    expect(s.calls, 'vacuity: no retry — this is the common path').toHaveLength(1);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.open_questions).toEqual(['Does "Velocity" get there within 6 months? The model holds no deadline yet, so no result answers that.', STATED_TWINS, 'Is the bottleneck coordination or capacity?', 'What does onboarding cost the current team?']);
  });

  it('CONTRAST: a first model within the limit reports nothing left out', async () => {
    const s = structuredSequence(candidate({ extraFactors: 2 }));
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn) as Record<string, unknown>;
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(s.calls).toHaveLength(1);
    expect(out.left_out_to_stay_compact).toBeUndefined();
  });
});

describe('⛔ the cap never overrides the user’s material plus its required scaffolding', () => {
  it('RED (N4): what the BUILDER inferred is not user material — it never exempts a model from the cap', async () => {
    // Paul's real first turn: most nodes arrive classed builder-inferred. Were that
    // class in the floor, the widening itself would be exempt and nothing retried.
    const c = candidate({ extraFactors: 0 });
    const INFERRED = COMPACT_LIMITS.maxNodes + 2;
    (c.factors as unknown[]).push(...Array.from({ length: INFERRED }, (_, i) => factor(`Inferred factor ${i}`, 'inferred')));
    (c.links as unknown[]).push(...Array.from({ length: INFERRED }, (_, i) => link(`Inferred factor ${i}`, 'Velocity')));
    const admitted = admitCandidateModel(c as unknown as CandidateModel, {});
    const inferred = admitted.nodes.filter((n) => admitted.inference_classes[n.id] === 'builder_inferred').length;
    expect(inferred, 'vacuity: the builder-inferred nodes alone exceed the node limit').toBeGreaterThan(COMPACT_LIMITS.maxNodes);
    const v = assessConstructionSize(admitted);
    expect(v.within).toBe(false);
    expect(v.user_material_exceeds_limit).toBe(false);
    expect(v.floor_nodes).toBeLessThanOrEqual(COMPACT_LIMITS.maxNodes);

    const s = structuredSequence(c, c);
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn);
    expect(s.calls, 'the oversized model is retried, not exempted').toHaveLength(2);
    expect(out.ok).toBe(false);
    expect(out.refusal).toBe('model_too_large');
  });

  it('RED: user-stated material ≤ the node limit but material + scaffolding > it → ADMITTED unchanged, no retry, reported oversized', async () => {
    const userOptions = Array.from({ length: COMPACT_LIMITS.maxNodes - 1 }, (_, i) => `User option ${i + 1}`);
    const c = candidate({ extraFactors: 0, options: userOptions });
    // Vacuity guards: the user's OWN stated nodes fit the cap; the floor (their
    // material plus the goal/decision scaffolding) does not. At the old rule this
    // took the retry/refusal path.
    const v = sizeOf(c);
    expect(v.brief_stated_nodes).toBeLessThanOrEqual(COMPACT_LIMITS.maxNodes);
    expect(v.floor_nodes).toBeGreaterThan(COMPACT_LIMITS.maxNodes);
    expect(v.within, 'vacuity: the model really is over the cap').toBe(false);

    const s = structuredSequence(c);
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn);
    expect(s.calls, 'no retry: there is nothing model-proposed to shed').toHaveLength(1);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(registered(dp.paths)).toBe(1);
  });
});
