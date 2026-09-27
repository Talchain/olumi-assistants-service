/**
 * PLACEHOLDER-ZERO — an unvalued quantitative root ancestor of the goal is a
 * `missing_value` blocker, not a silent 0.0 (P0, AI Quality #70 5860353792).
 *
 * ISL's rule (Inference-Service-Layer `src/services/robustness_analyzer_v2.py`,
 * staging c7d750ba, `defaulted_root_node_ids` + `_defaulted_roots_reaching`):
 * a node with no causal parents, no `observed_state.value`, no
 * ParameterUncertainty, and not intervened on by EVERY option is sampled at
 * 0.0; when it has an unblocked path to the goal ISL says so with
 * `GOAL_ANCESTOR_DATA_GAP`, which CEE buckets 'D' (dropped). The run then
 * measures the status quo — and every option that does not set the factor —
 * from zero.
 *
 * ⭐ THE CORPUS IS NOT THE AUTHOR'S. Every graph below is a served
 * `draft_graph` copied byte-for-byte from a real capture, and the expected
 * factor set is ISL's OWN warning from the same turn
 * (`served.isl_goal_ancestor_data_gap`), never a list typed here. The one
 * deliberate difference is the switch exemption, pinned by its own case.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  assessCanonicalAnalysisReadiness,
  buildCanonicalAnalysisReadyFromGraph,
} from '../analysis-ready-helper.js';
import { resolveRunAdmission } from '../../../orchestrator-v5/tools/handlers/analysis-ready-core.js';

interface Fixture {
  readonly _source: { readonly capture: string; readonly sha256: string };
  readonly served: {
    readonly status: string;
    readonly may_run: boolean;
    readonly blocker_count: number;
    readonly isl_goal_ancestor_data_gap: readonly string[];
  };
  readonly graph: Record<string, unknown>;
}

const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string): Fixture =>
  JSON.parse(readFileSync(join(here, 'fixtures', 'placeholder-zero', `${name}.json`), 'utf8')) as Fixture;

const LEVEL_CODE = 'MISSING_FACTOR_LEVEL';

const levelIssueFactorIds = (graph: unknown): string[] =>
  assessCanonicalAnalysisReadiness(graph)
    .blockingIssues.filter((issue) => issue.code === LEVEL_CODE)
    .map((issue) => issue.factor_id ?? '')
    .sort();

const wireFactorOnlyMissingValue = (graph: unknown): string[] =>
  ((buildCanonicalAnalysisReadyFromGraph(graph)?.blockers ?? []) as Array<{
    blocker_type?: string; option_id?: string; factor_id?: string;
  }>)
    .filter((b) => b.blocker_type === 'missing_value' && b.option_id === undefined)
    .map((b) => b.factor_id ?? '')
    .sort();

describe('placeholder-zero — a goal root ancestor with no status-quo level blocks the Run', () => {
  describe('journey A run2-final (pj-20260927T214311Z/A17): served needs_user_input yet ran by exclusion', () => {
    const fx = load('journey-a-run2-final-214311Z');

    it('precondition: the capture is the served false-admission (ISL named 3 placeholder roots; may_run was true)', () => {
      expect(fx.served.status).toBe('needs_user_input');
      expect(fx.served.may_run).toBe(true);
      expect(fx.served.isl_goal_ancestor_data_gap).toEqual([
        'fac_new_pro_customer_price',
        'fac_share_of_existing_pro_customers_grandfathered',
        'fac_trial_to_pro_conversion',
      ]);
    });

    it('readiness names EXACTLY the factors ISL defaulted to 0.0, each as a factor-scoped level blocker', () => {
      expect(levelIssueFactorIds(fx.graph)).toEqual([...fx.served.isl_goal_ancestor_data_gap].sort());
      const issue = assessCanonicalAnalysisReadiness(fx.graph).blockingIssues.find(
        (i) => i.code === LEVEL_CODE && i.factor_id === 'fac_new_pro_customer_price',
      );
      expect(issue).toBeDefined();
      expect(issue?.option_id).toBeUndefined();
      expect(issue?.repairability).toBe('human_input_required');
      expect(issue?.factor_label).toBe('New Pro customer price');
      // The Run is refused on it, so it can never read as "Olumi can fill".
      expect(issue?.obligation).toBe('required');
    });

    it('the wire carries a factor-only missing_value blocker per factor, and may_run is false', () => {
      expect(wireFactorOnlyMissingValue(fx.graph)).toEqual([...fx.served.isl_goal_ancestor_data_gap].sort());
      const wire = buildCanonicalAnalysisReadyFromGraph(fx.graph);
      expect(wire?.status).toBe('needs_user_input');
      expect(wire?.may_run).toBe(false);
    });

    it('the Run is refused: excluding the options cannot waive a level every remaining arm reads', () => {
      const admission = resolveRunAdmission(fx.graph);
      expect(admission.willProceed).toBe(false);
    });
  });

  // R&C 5860728395 and Canonical 5860714282: journey A's other final runs, where
  // the roots' existing blockers carry option ids and the exclusion waiver admitted
  // the Run. Bound to admission, not `status` (already needs_user_input at base).
  describe.each([
    ['journey-a-run2-final-214809Z', 'pj-20260927T214809Z/A15'],
    ['journey-a-run2-final-213830Z', 'pj-20260927T213830Z/A17'],
  ])('journey A %s (%s): the waiver admitted a Run over placeholder roots', (name) => {
    const fx = load(name);
    const withRootsValued = (): unknown => ({
      ...fx.graph,
      nodes: (fx.graph.nodes as Array<Record<string, unknown>>).map((node) =>
        fx.served.isl_goal_ancestor_data_gap.includes(String(node.id))
          ? { ...node, observed_state: { ...(node.observed_state as object | undefined), value: 1 } }
          : node),
    });

    it('precondition: served may_run true while ISL named its placeholder roots', () => {
      expect(fx.served.may_run).toBe(true);
      expect(fx.served.isl_goal_ancestor_data_gap.length).toBeGreaterThan(0);
    });

    it('readiness names exactly ISL\'s roots, and the Run is refused', () => {
      expect(levelIssueFactorIds(fx.graph)).toEqual([...fx.served.isl_goal_ancestor_data_gap].sort());
      expect(resolveRunAdmission(fx.graph).willProceed).toBe(false);
    });

    it('CONTRAST: the same graph with those roots valued — the Run proceeds', () => {
      expect(levelIssueFactorIds(withRootsValued())).toEqual([]);
      expect(resolveRunAdmission(withRootsValued()).willProceed).toBe(true);
    });
  });

  describe('journey E brief (pj-20260927T213009Z/E01): served READY while ISL defaulted an observable root', () => {
    const fx = load('journey-e-brief-213009Z');

    it('precondition: served ready, ISL named current_annual_salary_spend', () => {
      expect(fx.served.status).toBe('ready');
      expect(fx.served.isl_goal_ancestor_data_gap).toEqual(['current_annual_salary_spend']);
    });

    it('readiness names the observable root and refuses the Run', () => {
      expect(levelIssueFactorIds(fx.graph)).toEqual(['current_annual_salary_spend']);
      expect(buildCanonicalAnalysisReadyFromGraph(fx.graph)?.status).toBe('needs_user_input');
      expect(resolveRunAdmission(fx.graph).willProceed).toBe(false);
    });
  });

  describe('CONTROL journey A run1 (pj-20260927T214311Z/A02): no data gap', () => {
    const fx = load('journey-a-run1-control-214311Z');

    it('precondition: served ready with no ISL data gap', () => {
      expect(fx.served.status).toBe('ready');
      expect(fx.served.isl_goal_ancestor_data_gap).toEqual([]);
    });

    it('stays ready, mints no level blocker, and the Run proceeds', () => {
      expect(levelIssueFactorIds(fx.graph)).toEqual([]);
      expect(buildCanonicalAnalysisReadyFromGraph(fx.graph)?.status).toBe('ready');
      expect(resolveRunAdmission(fx.graph).willProceed).toBe(true);
    });
  });

  describe('EXEMPTION journey A brief (pj-20260927T222214Z/A01): a 0/1 switch the status quo leaves off', () => {
    const fx = load('journey-a-brief-switch-222214Z');

    it('precondition: ISL named the switch; served ready', () => {
      expect(fx.served.status).toBe('ready');
      expect(fx.served.isl_goal_ancestor_data_gap).toEqual(['feature_release_delivered']);
    });

    it('0 is a real status-quo level for a switch ("not released"), so no level blocker and the Run proceeds', () => {
      expect(levelIssueFactorIds(fx.graph)).toEqual([]);
      expect(buildCanonicalAnalysisReadyFromGraph(fx.graph)?.status).toBe('ready');
      expect(resolveRunAdmission(fx.graph).willProceed).toBe(true);
    });
  });

  describe('A PRIOR GIVES A LEVEL ONLY WHEN PLoT SAMPLES IT (plot-lite-service 22f3d94, translator-v3.ts second pass)', () => {
    const fx = load('journey-a-run2-final-214311Z');
    const FACTOR = 'fac_new_pro_customer_price';
    const withNode = (patch: Record<string, unknown>): unknown => ({
      ...fx.graph,
      nodes: (fx.graph.nodes as Array<Record<string, unknown>>).map((node) =>
        node.id === FACTOR ? { ...node, ...patch } : node),
    });

    // A non-finite bound and a spread with no value are refused earlier by
    // GraphV3 itself (`range_max` must be a number; `observed_state.value` is
    // required), so they never reach this rule.
    it.each([
      ['a uniform range PLoT samples', { prior: { distribution: 'uniform', range_min: 49, range_max: 69 } }, false],
      ['a normal prior (PLoT skips the family)', { prior: { distribution: 'normal', range_min: 49, range_max: 69 } }, true],
      ['a degenerate range (PLoT declines a point)', { prior: { distribution: 'uniform', range_min: 59, range_max: 59 } }, true],
      ['a stated value', { observed_state: { value: 59 } }, false],
      ['a V1 data.value level (the PLoT normaliser promotes it)', { data: { value: 59 } }, false],
    ])('%s → level gap: %s', (_name, patch, gap) => {
      expect(levelIssueFactorIds(withNode(patch)).includes(FACTOR)).toBe(gap);
    });
  });

  describe('EVERY OPTION SETS IT is not a level (AI Quality #72 5860802299, served PLoT 22f3d94 + ISL d1cef9a)', () => {
    // AIQ's EXEC: carry-on read £80,358.51 with such a root unvalued, £75,000.00 with it valued at £49.
    const fx = load('journey-a-run1-control-214311Z');
    const ROOT = 'new_customer_price';
    const withRootSetEverywhere = (observed?: { value: number }): Record<string, unknown> => {
      const nodes = (fx.graph.nodes as Array<Record<string, unknown>>).map((node) =>
        node.kind === 'option'
          ? { ...node, interventions: { ...(node.interventions as object | undefined), [ROOT]: { value: 0.245, source: 'brief_extraction' } } }
          : node);
      const optionIds = nodes.filter((node) => node.kind === 'option').map((node) => String(node.id));
      // Each option→root edge copies the capture's own option→factor edge shape.
      const edges = fx.graph.edges as Array<Record<string, unknown>>;
      const optionEdge = edges.find((edge) => optionIds.includes(String(edge.from)))!;
      return {
        ...fx.graph,
        nodes: [...nodes, { id: ROOT, kind: 'factor', label: 'New customer price', ...(observed ? { observed_state: observed } : {}) }],
        edges: [
          ...edges,
          ...optionIds.map((id) => ({ ...optionEdge, from: id, to: ROOT })),
          { from: ROOT, to: 'mrr', strength: { mean: 0.3, std: 0.05 }, exists_probability: 1, effect_direction: 'positive' },
        ],
      };
    };

    it('A: unvalued and set by every option, the status quo still reads it at 0, so it blocks the Run', () => {
      const graph = withRootSetEverywhere();
      expect(levelIssueFactorIds(graph)).toEqual([ROOT]);
      expect(resolveRunAdmission(graph).willProceed).toBe(false);
    });

    it('B (control): the same root with a stated level — no level blocker, and the Run proceeds', () => {
      const graph = withRootSetEverywhere({ value: 0.245 });
      expect(levelIssueFactorIds(graph)).toEqual([]);
      expect(resolveRunAdmission(graph).willProceed).toBe(true);
    });
  });
});
