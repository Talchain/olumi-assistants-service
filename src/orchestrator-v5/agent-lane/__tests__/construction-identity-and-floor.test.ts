/**
 * #1710's two remaining binding items, through `buildModelFromBrief`:
 *
 * 1. ⛔ RETRY ADOPTION PRESERVES IDENTITY, NOT COUNTS. Independent review at
 *    78b07e8b: a retry with the SAME brief-stated counts but a SWAPPED option or
 *    relationship was adopted and registered once. Same counts are not the same
 *    decision.
 * 2. ⛔ THE CAP GOVERNS MODEL-PROPOSED ENRICHMENT ONLY. Release Control: when the
 *    user's material PLUS required structural scaffolding alone exceeds 12/20,
 *    admit the model unchanged and report it oversized — never refuse, truncate
 *    or retry it.
 *
 * Every fixture carries a vacuity guard computed by the real gate, so a case
 * cannot pass because its fixture stopped meaning what it says.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { assessConstructionSize } from '../construction-size-gate.js';
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

describe('⛔ the cap never overrides the user’s material plus its required scaffolding', () => {
  it('RED: user-stated material ≤ 12 but material + scaffolding > 12 → ADMITTED unchanged, no retry, reported oversized', async () => {
    const elevenOptions = Array.from({ length: 11 }, (_, i) => `User option ${i + 1}`);
    const c = candidate({ extraFactors: 0, options: elevenOptions });
    // Vacuity guards: the user's OWN stated nodes fit the cap; the floor (their
    // material plus the goal/decision scaffolding) does not. At the old rule this
    // took the retry/refusal path.
    const v = sizeOf(c);
    expect(v.brief_stated_nodes).toBeLessThanOrEqual(12);
    expect(v.floor_nodes).toBeGreaterThan(12);

    const s = structuredSequence(c);
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn);
    expect(s.calls, 'no retry: there is nothing model-proposed to shed').toHaveLength(1);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(registered(dp.paths)).toBe(1);
  });
});
