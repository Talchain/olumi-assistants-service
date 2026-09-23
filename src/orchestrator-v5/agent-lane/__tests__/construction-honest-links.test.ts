/**
 * ⛔ THE FIRST MODEL MUST REACH ITS GOAL THROUGH LINKS SOMEBODY STATED.
 *
 * Measured on served 553254d, Paul's brief "Should I hire a Tech lead or two
 * developers to increase velocity?": the compact contract returned 6 nodes —
 * decision, goal, 2 options, 2 factors — with option -> factor edges and NO
 * factor -> goal link. The goal was orphaned, readiness said ORPHAN_NODE /
 * NO_PATH_TO_GOAL, and the analysis refused after the user approved values.
 *
 * The release ruling (#63 5793252993) forbids the obvious repair — a
 * default-positive factor -> goal edge — because a sign nobody stated is a
 * fabricated belief. So the fix is the construction CONTRACT: every kept factor
 * carries its own link toward the goal, with a direction read from the brief or
 * from stated causal reasoning (Olumi's hypothesis, machine provenance), and
 * where the direction cannot be stated the link is `unknown` and the question is
 * asked. And Release Control's envelope (5792626729) replaces "as few as
 * possible".
 *
 * The banked candidate below is REAL wire output (see its `_provenance`), not a
 * self-authored fixture: it is the one draw of six that was refused, because the
 * drafter restated each option's `changes` as `links` and admission counted the
 * same option -> factor connection twice.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUILD_INSTRUCTIONS,
  buildCandidateSchema,
  buildModelFromBrief,
  type CallStructuredModel,
} from '../runtime/build-model.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { COMPACT_LIMITS, assessConstructionSize } from '../construction-size-gate.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const SCENARIO = '44444444-4444-4444-8444-444444444444';
const BRIEF = 'Should I hire a Tech lead or two developers to increase velocity?';
const BANKED = (
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'live-hiring-envelope-candidate-20260923.json'), 'utf8')) as {
    candidate: CandidateModel;
  }
).candidate;

const STRUCTURAL_CODES = ['ORPHAN_NODE', 'NO_PATH_TO_GOAL'];
const structuralBlockers = (graph: { nodes: readonly unknown[]; edges: readonly unknown[] }) =>
  assessCanonicalAnalysisReadiness({ nodes: graph.nodes, edges: graph.edges })
    .issues.map((i) => i.code)
    .filter((c) => STRUCTURAL_CODES.includes(c));

function optionsReachingGoal(a: { nodes: readonly { id: string; kind: string }[]; edges: readonly { from: string; to: string }[] }) {
  const goal = a.nodes.find((n) => n.kind === 'goal')!;
  const out = new Map<string, string[]>();
  for (const e of a.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const reaches = (s: string) => {
    const seen = new Set([s]);
    const stack = [s];
    while (stack.length > 0) {
      const x = stack.pop()!;
      if (x === goal.id) return true;
      for (const y of out.get(x) ?? []) if (!seen.has(y)) { seen.add(y); stack.push(y); }
    }
    return false;
  };
  const options = a.nodes.filter((n) => n.kind === 'option');
  return { total: options.length, reaching: options.filter((o) => reaches(o.id)).length };
}

describe('the construction contract states the link requirement', () => {
  it('every kept factor needs its own link toward the goal', () => {
    expect(BUILD_INSTRUCTIONS).toContain('EVERY FACTOR YOU KEEP NEEDS ITS OWN LINK TOWARD THE GOAL');
    // The exact measured failure: `changes` connects an option TO a factor, never onward.
    expect(BUILD_INSTRUCTIONS).toContain('it does NOT connect the factor to anything');
  });

  it('a direction is a stated hypothesis, never a default — and an unknown one is ASKED', () => {
    expect(BUILD_INSTRUCTIONS).toContain('ITS DIRECTION MUST BE STATED, NOT DEFAULTED');
    expect(BUILD_INSTRUCTIONS).toContain('Olumi\'s hypothesis, not the user\'s claim');
    expect(BUILD_INSTRUCTIONS).toContain('set its direction to "unknown" AND add a question to `unknowns`');
    const links = (buildCandidateSchema()['properties'] as Record<string, { items: { properties: Record<string, { description?: string }> } }>)['links']!;
    expect(links.items.properties['direction']!.description).toMatch(/unknown.*`unknowns`/);
  });

  it('aims for Release Control’s envelope, with the gate’s own ceilings', () => {
    expect(BUILD_INSTRUCTIONS).toContain('normally 3 to 5 options');
    expect(BUILD_INSTRUCTIONS).toContain('roughly 4 to 8 factors');
    expect(BUILD_INSTRUCTIONS).toContain(`${COMPACT_LIMITS.maxNodes} nodes and ${COMPACT_LIMITS.maxEdges} links`);
  });
});

describe('⛔ admission does NOT invent a factor -> goal link (#63 ruling)', () => {
  it('a factor fed only by options stays dead-ended and the blocker stays visible', () => {
    // The served 553254d shape: option -> factor, nothing onward.
    const orphaned = {
      goal: { metric: 'Velocity', operator: '>=', value: 20, unit: 'points', horizon_months: null, provenance: 'explicit' },
      constraints: [],
      options: [
        { label: 'Hire a Tech Lead', provenance: 'explicit', changes: ['Tech lead headcount'], interventions: [] },
        { label: 'Hire Two Developers', provenance: 'explicit', changes: ['Developer headcount'], interventions: [] },
      ],
      factors: [
        { label: 'Tech lead headcount', role: 'controllable', baseline_known: false, baseline_value: null, unit: null, provenance: 'inferred', plausible_max: 10 },
        { label: 'Developer headcount', role: 'controllable', baseline_known: false, baseline_value: null, unit: null, provenance: 'inferred', plausible_max: 50 },
      ],
      risks: [],
      outcomes: [],
      links: [],
    } as unknown as CandidateModel;
    const a = admitCandidateModel(orphaned, {});
    const goal = a.nodes.find((n) => n.kind === 'goal')!;
    expect(a.edges.filter((e) => e.to === goal.id)).toEqual([]);
    expect(structuralBlockers(a).length).toBeGreaterThan(0);
  });
});

describe('the banked live candidate is admitted whole and analysable in structure', () => {
  const a = admitCandidateModel(BANKED, {});

  it('keeps ONE edge per option -> factor connection, the canonical structural one', () => {
    const pairs = a.edges.map((e) => `${e.from}->${e.to}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    const kind = new Map(a.nodes.map((n) => [n.id, n.kind]));
    const optionToFactor = a.edges.filter((e) => kind.get(e.from) === 'option' && kind.get(e.to) === 'factor');
    expect(optionToFactor.length).toBeGreaterThan(0);
    for (const e of optionToFactor) {
      expect({ mean: e.strength.mean, std: e.strength.std, p: e.exists_probability, dir: e.effect_direction })
        .toEqual({ mean: 1, std: 0.01, p: 1, dir: 'positive' });
    }
  });

  it('records each dropped duplicate — nothing silent', () => {
    const recorded = a.loss.filter((l) => (l as { after?: unknown }).after === 'structural').map((l) => l.field_path).sort();
    expect(recorded).toEqual([
      'edges[hire_a_tech_lead::tech_leads_hired]',
      'edges[hire_two_developers::developers_hired]',
      'edges[maintain_current_staffing::existing_team_continuity]',
      'edges[pilot_developer_hire::developers_hired]',
    ]);
  });

  it('every option reaches the goal, with no ORPHAN_NODE / NO_PATH_TO_GOAL', () => {
    expect(optionsReachingGoal(a)).toEqual({ total: 4, reaching: 4 });
    expect(structuralBlockers(a)).toEqual([]);
  });

  it('keeps both of the user’s options, by identity', () => {
    const userOptions = a.nodes.filter((n) => n.kind === 'option' && n.provenance === 'from_brief').map((n) => n.label).sort();
    expect(userOptions).toEqual(['Hire Two Developers', 'Hire a Tech Lead']);
  });

  it('sits inside the envelope and the gate', () => {
    const v = assessConstructionSize(a);
    expect(v.within).toBe(true);
    expect(v.by_kind['option']).toBeGreaterThanOrEqual(3);
    expect(v.by_kind['factor']).toBeGreaterThanOrEqual(4);
  });

  it('builds through buildModelFromBrief in ONE call and registers once', async () => {
    const calls: string[] = [];
    const fn = vi.fn(async (req: { instructions: string }) => {
      calls.push(req.instructions);
      return { text: JSON.stringify(BANKED) };
    }) as unknown as CallStructuredModel;
    const paths: string[] = [];
    const d: InternalDispatch = async (path) => {
      paths.push(path);
      return { status: 200, json: { registered: true } };
    };
    const out = await buildModelFromBrief(SCENARIO, BRIEF, d, fn);
    expect(out.ok, JSON.stringify(out).slice(0, 300)).toBe(true);
    expect(out['size_retried']).toBe(false);
    expect(calls).toHaveLength(1);
    expect(paths.filter((p) => p.endsWith('/graph/register'))).toHaveLength(1);
  });
});
