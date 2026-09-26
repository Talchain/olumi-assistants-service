/**
 * A HELD STATUS QUO IS COMPARED, SO NOTHING MAY SAY IT IS LEFT OUT (served defect, DL browser witness
 * `bf-20260926T054503Z`, turn 0, 05:46:11Z).
 *
 * The run's gate (`gateAnalysableOptions`) splits the options it touches in two: it HOLDS a status quo at the
 * factors' current values and SUBMITS it (#1902 / #1963), and it EXCLUDES an option it cannot analyse. The run's
 * own record keeps them apart (`run-analysis.ts`: `scaffolded_option_ids` = held, `excluded_option_ids` =
 * excluded). The pre-run surfaces did not: `computeScaffoldPlan` merged both into one "touched" list, and that
 * list became the route's `scaffold_plan.excluded_option_ids` and admission's `RUN_WILL_EXCLUDE_OPTIONS` count.
 *
 * On the served graph the Agent told Paul "The analysis can run now; it will leave out "Status Quo" until its
 * levels are set", and admission said "leaving out one option you have not set values for" — while the SAME
 * response's run computed Status Quo (10,000 samples). The fixture is that turn's `draft_graph`, verbatim.
 *
 * The rule: "leave out" is said of exactly the options the gate EXCLUDES — one list, read by the offer, the
 * Agent and admission alike. A held option is compared; its blocker stays waived (it is not the user's task).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assessRouteAdmission } from '../canonical-readiness.js';
import { resolveRunAdmission } from '../../../orchestrator-v5/tools/handlers/analysis-ready-core.js';
import { gateAnalysableOptions } from '../../../orchestrator-v5/tools/handlers/analysable-option-gate.js';
import { resolveAnalysisAdmission } from '../../../orchestrator-v5/admission/analysis-admission.js';
import { readinessSentence, readinessViewOf } from '../../../orchestrator-v5/agent-lane/readiness-view.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(
  readFileSync(new URL('./fixtures/served-held-status-quo.bf-054503-t0.json', import.meta.url), 'utf8'),
) as Json;
const STATUS_QUO = 'status_quo';

/**
 * The same served graph plus one option linked like the others but with NO levels set — the case the gate
 * EXCLUDES while the run still proceeds. Cloned from a served option and every link it has (so it carries every
 * field the contract requires), with its levels removed and a new id and label.
 */
function withUnconfiguredOption(): { graph: Json; id: string } {
  const graph = structuredClone(SERVED);
  const templateId = '59_ai_release';
  const template = (graph.nodes as Json[]).find((n) => n.id === templateId)!;
  const id = 'opt_decide_later';
  graph.nodes.push({ ...structuredClone(template), id, label: 'Decide later', interventions: {} });
  for (const e of (graph.edges as Json[]).filter((x) => x.from === templateId || x.to === templateId)) {
    graph.edges.push({
      ...structuredClone(e),
      ...(e.from === templateId ? { from: id } : {}),
      ...(e.to === templateId ? { to: id } : {}),
      ...(e.id !== undefined ? { id: `${e.id}__decide_later` } : {}),
    });
  }
  return { graph, id };
}

/** What the run will do with this graph, from the run's own gate over admission's own options. */
function gateOf(graph: Json) {
  const options = (resolveRunAdmission(graph).assessment.analysisReady?.options ?? []) as Json[];
  const gate = gateAnalysableOptions({ options, graph, rawPersistedGraph: graph, scaleNetEnabled: true });
  return {
    held: gate.held.map((h) => h.option_id),
    excluded: gate.excluded.map((h) => h.option_id),
    submitted: (gate.options as Json[]).map((o) => o.option_id ?? o.id),
  };
}

const structuralReason = (graph: Json) =>
  resolveAnalysisAdmission(graph).reasons.find((r) => r.field === 'structurally_analysable');

describe('a held status quo is compared, so nothing says it is left out', () => {
  it('PREMISE (served): the run HOLDS Status Quo and submits it, excludes nothing — and the served run computed it', () => {
    expect(SERVED._provenance.run_computed_option_ids).toContain(STATUS_QUO);
    const gate = gateOf(SERVED);
    expect(gate.held).toEqual([STATUS_QUO]);
    expect(gate.excluded).toEqual([]);
    expect(gate.submitted).toContain(STATUS_QUO);
    expect(assessRouteAdmission(SERVED).may_run, 'premise: the run is admitted').toBe(true);
  });

  it('⭐ the route\'s offer does not name Status Quo as left out', () => {
    const plan = assessRouteAdmission(SERVED).scaffold_plan;
    expect(plan.will_scaffold_options, 'unchanged: the run still proceeds with a held option').toBe(true);
    expect(plan.excluded_option_ids ?? []).not.toContain(STATUS_QUO);
  });

  it('⭐ the Agent\'s sentence (served: "…it will leave out "Status Quo" until its levels are set") is plain "can run now"', () => {
    expect(readinessSentence(readinessViewOf(SERVED))).toBe('The analysis can run now.');
  });

  it('⭐ admission does not say "leaving out one option" beside a run that compares every option', () => {
    expect(structuralReason(SERVED)?.code).toBe('READY_TO_COMPARE');
  });

  it('UNCHANGED: the held option\'s gap stays waived — the hold answers it, never the user', () => {
    expect(resolveRunAdmission(SERVED).waivedOptionIds).toContain(STATUS_QUO);
    const view = readinessViewOf(SERVED);
    expect(view.needs_from_user.filter((n) => n.option === 'Status Quo')).toEqual([]);
  });

  it('CONTRAST: an option the run genuinely EXCLUDES is still named, by id, on every surface — and Status Quo still is not', () => {
    const { graph, id } = withUnconfiguredOption();
    const gate = gateOf(graph);
    expect(gate.excluded, 'premise: the gate excludes it').toEqual([id]);
    expect(gate.held).toEqual([STATUS_QUO]);
    const plan = assessRouteAdmission(graph).scaffold_plan;
    expect(plan.excluded_option_ids).toEqual([id]);
    expect(readinessSentence(readinessViewOf(graph))).toBe('The analysis can run now; it will leave out "Decide later" until its levels are set.');
    expect(structuralReason(graph)).toMatchObject({ code: 'RUN_WILL_EXCLUDE_OPTIONS', message: 'Analysis can run, leaving out one option you have not set values for.' });
  });

  it('ONE LIST: the offer names exactly the options the run\'s own gate excludes (served and contrast)', () => {
    for (const graph of [SERVED, withUnconfiguredOption().graph]) {
      expect([...(assessRouteAdmission(graph).scaffold_plan.excluded_option_ids ?? [])].sort()).toEqual([...gateOf(graph).excluded].sort());
    }
  });
});
