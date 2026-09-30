/**
 * ⛔ A LIMITED QUANTITY'S BRANCH IS NEVER SAID TO BE "UNCONNECTED" (R3 #75 5903589565; P0 partner 5903714338; DL lease
 * 5903604509). Served cut-costs (`9f75612`, guest `15f48f0b`): the drafter routed downtime only into its "≤ 2 weeks"
 * limit, readiness refused the branch, and the Agent advised connecting downtime to the cost goal — a false cause.
 * Readiness and admission's "cannot reach the goal" ledger now read ONE definition (`graph/limit-sink-branch.ts`).
 *
 * Real path: strict candidate → `buildModelFromBrief` → admission → the `/graph/register` body → the readiness authority.
 * The shape is the live arm's (head draft 1): a lever and an uncertain root ("Migration complexity") feed downtime.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import type { CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { structuralFacts } from '../structural-facts.js';

type Json = Record<string, any>;
const BRIEF = 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £45k; we want to cut costs by 20% '
  + 'without more than 2 weeks of migration downtime risk.';
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

const link = (from: string, to: string, direction: 'positive' | 'negative') =>
  ({ from, to, direction, provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });

function draft(edit: (c: Json) => void = () => {}): CandidateModel {
  const c: Json = {
    goal: { metric: 'Monthly cloud spend', operator: '<=', target_stated: true, frame: 'level', value: 36000, unit: 'GBP/month', horizon_months: null,
      provenance: 'explicit', baseline_known: true, baseline_value: 45000, baseline_provenance: 'explicit', scope: null },
    constraints: [{ metric: 'Migration downtime', operator: '<=', value: 2, unit: 'weeks', provenance: 'explicit', frame: 'level' }],
    options: [
      { label: 'Keep AWS', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
      { label: 'Switch to GCP', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [{ factor_label: 'GCP workload share', value: 100, value_kind: 'absolute', unit: '%', provenance: 'ai_proposed' }] },
    ],
    factors: [
      { label: 'GCP workload share', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
      { label: 'Migration complexity', role: 'observable', baseline_known: false, baseline_value: 50, unit: 'score out of 100', provenance: 'ai_proposed', plausible_max: 100 },
      { label: 'Migration downtime', role: 'observable', baseline_known: false, baseline_value: 1, unit: 'weeks', provenance: 'ai_proposed', plausible_max: 12 },
    ],
    risks: [], outcomes: [],
    links: [
      link('GCP workload share', 'Monthly cloud spend', 'negative'),
      link('GCP workload share', 'Migration downtime', 'positive'),
      link('Migration complexity', 'Migration downtime', 'positive'),
    ],
    identities: [], unknowns: [], decision_question: null,
  };
  edit(c);
  return c as unknown as CandidateModel;
}

async function build(model: CandidateModel): Promise<{ graph: Json; out: Json }> {
  expect(strict(model), JSON.stringify(strict.errors)).toBe(true);
  let graph: unknown = null;
  const call = (async () => ({ text: JSON.stringify(model) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('15f48f0b-0000-4000-8000-000000000001', BRIEF, d, call) as Json;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return { graph: graph as Json, out };
}
const readinessCodes = (g: Json): string[] => ((assessCanonicalAnalysisReadiness(g) as Json).issues ?? []).map((i: Json) => i.code);
/** What the Agent is told cannot reach the goal (`structure.entities_that_cannot_reach_goal`), with the graph's limits. */
const stranded = (g: Json): string[] => [...structuralFacts(g.nodes, g.edges,
  (g.goal_constraints ?? []).map((c: Json) => c.node_id)).entities_that_cannot_reach_goal];

describe('a limited quantity\'s branch is never said to be unconnected (served cut-costs)', () => {
  it('RED (live-arm shape): the downtime branch is admitted, never listed as unable to reach the goal, and readiness passes', async () => {
    const { graph, out } = await build(draft());
    expect((graph.goal_constraints ?? []).length).toBe(1);
    expect(stranded(graph)).toEqual([]);
    expect(JSON.stringify(out)).not.toMatch(/no chain of causes runs from it/);
    expect(readinessCodes(graph)).not.toContain('NO_PATH_TO_GOAL');
  });

  it('CONTROL (the probe sees it): the same branch with no limit is listed as unable to reach the goal, and readiness refuses it', async () => {
    const { graph } = await build(draft((c) => { c.constraints = []; }));
    expect(stranded(graph)).toEqual(expect.arrayContaining(['Migration complexity', 'Migration downtime']));
    expect(readinessCodes(graph)).toContain('NO_PATH_TO_GOAL');
  });
});
