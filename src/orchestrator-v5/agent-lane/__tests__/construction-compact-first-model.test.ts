/**
 * The compact first model, THROUGH `buildModelFromBrief`.
 *
 * `construction-size-gate.test.ts` pins the verdict. This pins the behaviour the
 * user gets: one bounded retry, an honest refusal, no truncation, and — the case
 * that must not be got wrong — the user's own oversized model still admitted.
 *
 * Separate file from `build-model-capability.test.ts` on purpose: that file is
 * edited by open PR #1691, and this lane's changes should not land in its hunks.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { COMPACT_LIMITS, assessConstructionSize } from '../construction-size-gate.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const SCENARIO = '22222222-2222-4222-8222-222222222222';
const BRIEF = 'Should I hire a Tech lead or two developers to increase velocity?';

const factor = (label: string, provenance = 'ai_proposed') => ({
  label, role: 'observable', baseline_known: false, baseline_value: null,
  unit: null, provenance, plausible_max: 100,
});
const link = (from: string, to: string) => ({ from, to, direction: 'positive', provenance: 'inferred' });

/** A candidate whose ADMITTED size is driven by `extraFactors`. */
function candidate(extraFactors: number) {
  const names = Array.from({ length: extraFactors }, (_, i) => `Secondary factor ${i}`);
  return {
    goal: { metric: 'Velocity', operator: '>=', value: 20, unit: 'points', horizon_months: 6, provenance: 'explicit' },
    constraints: [],
    options: [
      { label: 'Hire a tech lead', provenance: 'explicit', changes: ['Delivery capacity'], interventions: [] },
      { label: 'Hire two developers', provenance: 'explicit', changes: ['Delivery capacity'], interventions: [] },
    ],
    factors: [factor('Delivery capacity', 'inferred'), ...names.map((n) => factor(n))],
    risks: [],
    outcomes: [{ label: 'Velocity', provenance: 'inferred' }],
    links: [link('Delivery capacity', 'Velocity'), ...names.map((n) => link(n, 'Velocity'))],
    unknowns: [],
  };
}

/** Feeds a sequence of candidates, one per structured call, and counts the calls. */
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

describe('a compact first model registers with no retry', () => {
  it('admits, registers once, and reports it was within budget', async () => {
    const s = structuredSequence(candidate(3));
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn);
    expect(out.ok).toBe(true);
    expect(out['within_compact_limits']).toBe(true);
    expect(out['size_retried']).toBe(false);
    expect(s.calls).toHaveLength(1);
    expect(registered(dp.paths)).toBe(1);
  });
});

describe('an oversized first model gets exactly ONE bounded retry', () => {
  it('adopts a compact retry, registers it, and says a retry happened', async () => {
    const s = structuredSequence(candidate(20), candidate(3));
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn);
    expect(out.ok).toBe(true);
    expect(out['size_retried']).toBe(true);
    expect(out['within_compact_limits']).toBe(true);
    expect(s.calls).toHaveLength(2);
    expect(registered(dp.paths)).toBe(1); // ONE graph write, not two
  });

  it('passes the budget and the protect-the-brief rule in the retry instruction', async () => {
    const s = structuredSequence(candidate(20), candidate(3));
    await buildModelFromBrief(SCENARIO, BRIEF, dispatcher().d, s.fn);
    const retry = s.calls[1]!;
    expect(retry).toContain(`${COMPACT_LIMITS.maxNodes} nodes and ${COMPACT_LIMITS.maxEdges} links`);
    expect(retry).toMatch(/not negotiable|must not be dropped/i);
    expect(retry).toContain('`unknowns`');
    // The first pass's rules still hold — the delta is APPENDED, not a replacement.
    expect(retry).toContain('DECISION-CRITICAL');
  });

  it('NEVER retries twice — still oversized means refuse, not keep asking', async () => {
    const s = structuredSequence(candidate(20), candidate(20));
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn);
    expect(out.ok).toBe(false);
    expect(out['refusal']).toBe('model_too_large');
    expect(s.calls).toHaveLength(2);
    expect(registered(dp.paths)).toBe(0); // nothing written
  });
});

describe('⛔ the refusal is explicit, and writes nothing', () => {
  it('reports the counts, the limits, and what was added beyond the brief', async () => {
    const s = structuredSequence(candidate(20), candidate(20));
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn);
    expect(out['refusal']).toBe('model_too_large');
    expect(out['limits']).toEqual(COMPACT_LIMITS);
    expect(Number(out['nodes'])).toBeGreaterThan(COMPACT_LIMITS.maxNodes);
    expect(Number(out['added_beyond_brief'])).toBeGreaterThan(0);
    expect(out['retried']).toBe(true);
    expect(out.mutated).toBe(false);
    expect(registered(dp.paths)).toBe(0);
  });

  it('carries NO graph — a refusal cannot be mistaken for a smaller model', async () => {
    const s = structuredSequence(candidate(20), candidate(20));
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dispatcher().d, s.fn);
    expect(out['graph']).toBeUndefined();
    for (const [, v] of Object.entries(out)) {
      // The only arrays a refusal may carry are diagnostics, never nodes/edges.
      if (Array.isArray(v)) expect(v.every((x) => typeof x !== 'object' || x === null)).toBe(true);
    }
  });
});

describe('a retry that is not actually smaller is NOT adopted', () => {
  it('keeps the first model’s counts when the retry grows', async () => {
    const first = candidate(20);
    const bigger = candidate(30);
    const s = structuredSequence(first, bigger);
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dispatcher().d, s.fn);
    expect(out.ok).toBe(false);
    // ⭐ BOUND BY IDENTITY, not by a range. A `toBeLessThan(36)` bound let the
    // mutant "adopt the retry unconditionally" SURVIVE, because both the first
    // model and the worse retry fell inside it. The expected numbers are now
    // derived by admitting the same candidates here.
    const firstSize = assessConstructionSize(
      admitCandidateModel(first as unknown as CandidateModel, {}),
    );
    const biggerSize = assessConstructionSize(
      admitCandidateModel(bigger as unknown as CandidateModel, {}),
    );
    expect(biggerSize.nodes).toBeGreaterThan(firstSize.nodes); // the fixture really is worse
    expect(out['nodes']).toBe(firstSize.nodes);
    expect(out['edges']).toBe(firstSize.edges);
    expect(out['nodes']).not.toBe(biggerSize.nodes);
  });
});

describe('⭐ the cap never overrides the user', () => {
  it('ADMITS an oversized model when the user’s OWN material is what exceeds it', async () => {
    // More options than the node limit, all named by the user themselves.
    const userHeavy = {
      ...candidate(0),
      options: Array.from({ length: COMPACT_LIMITS.maxNodes + 2 }, (_, i) => ({
        label: `User option ${i}`, provenance: 'explicit',
        changes: ['Delivery capacity'], interventions: [],
      })),
    };
    const s = structuredSequence(userHeavy);
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn);
    expect(out.ok).toBe(true);
    expect(registered(dp.paths)).toBe(1);
    expect(out['within_compact_limits']).toBe(false);
    expect(String(out['admitted_over_limit_because'])).toContain('your own stated');
    // ⭐ And it must NOT have burned a second model call trying to shrink the
    // user's own decision.
    expect(s.calls).toHaveLength(1);
  });
});

describe('\u26d4 a retry that LOSES user material is never adopted, even if smaller', () => {
  /**
   * Smaller is not sufficient. A retry that sheds two widened factors while also
   * dropping a relationship the user stated is a WORSE model, and the size numbers
   * alone cannot tell the difference — which is why the adoption check compares the
   * brief-stated counts too.
   */
  const userLinked = () => {
    const c = candidate(14) as unknown as Record<string, unknown>;
    // Mark the option->factor links as the user's own.
    c['links'] = [
      { from: 'Delivery capacity', to: 'Velocity', direction: 'positive', provenance: 'explicit' },
      { from: 'Secondary factor 0', to: 'Velocity', direction: 'positive', provenance: 'explicit' },
    ];
    return c;
  };
  const stripped = () => {
    const c = candidate(2) as unknown as Record<string, unknown>;
    // Compact AND missing one of the user's stated relationships.
    c['links'] = [
      { from: 'Delivery capacity', to: 'Velocity', direction: 'positive', provenance: 'explicit' },
    ];
    return c;
  };

  it('refuses rather than adopting a retry that dropped a user-stated relationship', async () => {
    const s = structuredSequence(userLinked(), stripped());
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn);
    // The retry WAS smaller on both dimensions, so a size-only check would have
    // taken it. It must not have been written.
    expect(s.calls).toHaveLength(2);
    expect(out.ok).toBe(false);
    expect(out['refusal']).toBe('model_too_large');
    expect(registered(dp.paths)).toBe(0);
  });
});

describe('⭐ a retry that only REWORDS the goal is the same decision, and is adopted', () => {
  /**
   * MEASURED on served staging `785185b7` (refusal probe, 2 of 12 hiring draws): the
   * first model came back at 31 links, the compact retry fixed the size and kept both
   * of the user's options, and the retry's goal read "velocity" where the first read
   * "delivery velocity". The goal was keyed on its exact label, so the retry "lost" a
   * user-stated identity and the build was refused `model_too_large`. The user got no
   * model at all. A model has exactly ONE goal (built from `goal.metric`), so a
   * reworded goal is the same goal.
   */
  const withGoal = (extra: number, metric: string) => {
    const c = candidate(extra) as unknown as { goal: { metric: string } };
    c.goal = { ...c.goal, metric };
    return c;
  };

  it('RED: adopts the compact retry and registers it once', async () => {
    const s = structuredSequence(withGoal(14, 'Delivery velocity'), withGoal(2, 'Velocity'));
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn);
    expect(s.calls).toHaveLength(2);
    expect(out.ok, JSON.stringify(out).slice(0, 300)).toBe(true);
    expect(registered(dp.paths)).toBe(1);
  });

  it('CONTRAST: a retry that drops one of the user’s OPTIONS is still refused', async () => {
    const dropped = withGoal(2, 'Velocity') as unknown as { options: unknown[] };
    dropped.options = dropped.options.slice(0, 1);
    const s = structuredSequence(withGoal(14, 'Delivery velocity'), dropped);
    const dp = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dp.d, s.fn);
    expect(out.ok).toBe(false);
    expect(out['refusal']).toBe('model_too_large');
    expect(registered(dp.paths)).toBe(0);
  });
});
