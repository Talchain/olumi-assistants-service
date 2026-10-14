/**
 * ⭐ CAPACITY A′ — THE USER'S "20 TICKETS A WEEK PER SPECIALIST" FITS AT CONSTRUCTION (DL, 12 Oct; AIE 0418).
 *
 * Served A′ (12 Oct 02:01Z, CEE c85817f2): "Your size for how ‘Additional specialists’ moves ‘Additional specialist
 * capacity’ is bigger than this model's scale can hold". The stated pass refused to widen the outcome (125 → 200) because
 * that cut its exact link into the goal, and the goal could not widen: its OWN ≥100 target row counted as a limit naming
 * it. AIE 0418: "the constructor's own raw target row may be rescaled together with its frame through existing
 * goalOwnRows", as the Olumi pass already does.
 *
 * Construction replayed for real (`buildModelFromBrief`) from the SERVED drafter output on that build
 * (`fixtures/capacity-served-drafts-20261011.json` draft 8, c85817f2; read SELECT-only by SYS2). Scripted: the provider.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { frameOf } from '../refit-frames.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/capacity-served-drafts-20261011.json', import.meta.url), 'utf8')) as {
  brief: string; drafts: { scenario_id: string; cee_build: string; candidate: Rec }[] };
const A_PRIME = FX.drafts.find((d) => d.cee_build.startsWith('c85817f2'))!;

async function construct(): Promise<Rec> {
  let graph: Rec | undefined;
  const dispatch = async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
  };
  const drafter = async () => ({ text: JSON.stringify(A_PRIME.candidate), status: 'completed' });
  const result = await buildModelFromBrief('00000000-0000-4000-8000-0000000000a1', FX.brief, dispatch as never, drafter as never) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 2000)).toBe(true);
  expect(graph).toBeDefined();
  return graph!;
}
const byLabel = (g: Rec, label: string): Rec => {
  const n = (g.nodes as Rec[]).find((x) => String(x.label).toLowerCase() === label.toLowerCase());
  expect(n, label).toBeDefined();
  return n!;
};

describe('capacity A′: the stated pass widens the goal with its own target row (goalOwnRows at construction)', () => {
  it('precondition: the served draft states 20 tickets a week per specialist, the 80 today and the ≥100 target', () => {
    const links = A_PRIME.candidate.links as Rec[];
    expect(links.find((l) => l.from === 'Additional specialists' && l.to === 'Additional specialist capacity'))
      .toMatchObject({ effect_amount: 20, effect_per_source_change: 1, effect_provenance: 'explicit' });
    expect(A_PRIME.candidate.goal).toMatchObject({ metric: 'Weekly support capacity', operator: '>=', value: 100, baseline_value: 80 });
  });

  it('RED before: the user\'s 20 per specialist is sized, not cut — goal 125 → 500, outcome 125 → 200, every user figure exact', async () => {
    const g = await construct();
    const goal = byLabel(g, 'Weekly support capacity'), outcome = byLabel(g, 'Additional specialist capacity');
    const specialists = byLabel(g, 'Additional specialists');
    expect(frameOf(goal)).toBe(500);
    expect(frameOf(outcome)).toBe(200);
    const link = (g.edges as Rec[]).find((e) => e.from === specialists.id && e.to === outcome.id)!;
    expect(link.provenance).toMatchObject({ magnitude: 'user_stated', natural_effect: { amount: 20, per_source_change: 1 } });
    expect(link.provenance.clamped_from).toBeUndefined();
    // Its natural size is the user's 20 a week per specialist, on the new frames.
    expect(link.strength.mean * frameOf(outcome)! / frameOf(specialists)!).toBeCloseTo(20, 9);
    expect(Math.abs(link.strength.mean)).toBeLessThanOrEqual(1);
    // No link anywhere is stored cut.
    expect((g.edges as Rec[]).filter((e) => e.provenance?.clamped_from !== undefined)).toEqual([]);
    // The user's figures read the same: the ≥100 target row is raw, and so is today's 80.
    expect((g.goal_constraints as Rec[]).find((r) => r.node_id === goal.id)).toMatchObject({ value: 100 });
    const existing = (g.nodes as Rec[]).find((n) => n.observed_state?.raw_value === 80);
    expect(existing, 'today\'s 80 is held raw').toBeDefined();

    // Evidence for the DL (REPORT, not a fix): does the goal path now license a chance, or does P5 still withhold it?
    const verdict = targetTestabilityOf(g) as Rec;
    if (process.env.SYS1_EVIDENCE) writeFileSync(`${process.env.SYS1_EVIDENCE}/capacity-goal-own-rows.json`, JSON.stringify({
      frames: Object.fromEntries((g.nodes as Rec[]).map((n) => [n.id, frameOf(n) ?? null])),
      goal_edges: (g.edges as Rec[]).filter((e) => (g.nodes as Rec[]).find((n) => n.id === e.from)?.kind !== 'option')
        .map((e) => ({ from: e.from, to: e.to, mean: e.strength?.mean, magnitude: e.provenance?.magnitude ?? null, defaulted: e.defaulted ?? false })),
      verdict,
    }, null, 2));
  });
});
