/**
 * A goal's OWN current level is not a parameter the leader claim rests on.
 *
 * THE FINDING (Model Generation, olumi-programme-docs #70 5845326220, EXECUTED on a
 * machine-authored variant of Paul's `cbd15f83`): one chat sentence — "our MRR is
 * £12,000" — recorded the goal's current level as the user's, and the mode flipped
 * `quantified_provisional` → `comparative_leader`. A named winner was licensed by a
 * number that does not change which option leads.
 *
 * THE RULING (AI Quality, #70 5845381471, corrected 5845401108), measured WIRE-LOCAL on
 * the SERVED request shape (every node carries PLoT's `epsilon_std`, every observed
 * factor its PU) — `quality-evidence/goal-baseline-ranking-20260926/probe3.py`:
 *   · the goal's baseline at 0.48 → win-% and outcome means byte-identical to the served
 *     row, because ISL takes a non-root's base only from a parameter uncertainty and PLoT
 *     sends none for a goal (factor PUs are `kind === 'factor'` only; constraint PUs skip
 *     the goal);
 *   · CONTRAST, same shape: a non-root FACTOR's baseline (churn 0.04 → 0.90) DOES move
 *     the ranking — so the exclusion is the goal's, not every non-root's.
 *
 * The goal's current level still matters to the goal-TARGET claim (P(goal)), which
 * `goal_target_stated` gates, and it is still counted in the whole-model census.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  censusConfidenceParameters,
  resolveAnalysisAdmission,
  semanticVerdictCause,
} from '../analysis-admission.js';
import { classifyValueSource } from '../../../cee/graph-readiness/obligation-provenance.js';

/** A real captured draft (the module's worked capture) — not the author's model of one. */
const WORKED_CAPTURE = 'src/cee/context-integrity/__tests__/fixtures/live-4day-week.cold-read.json';
const GOAL = 'goal_4day_success';
const INTERVENED_FACTOR = 'fac_4day_adoption';
/** The stamp a user-typed figure carries. */
const TYPED = 'user';

function capture(): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(WORKED_CAPTURE, 'utf8')) as { graph: unknown };
  const graph = JSON.parse(JSON.stringify(parsed.graph)) as Record<string, unknown>;
  // The capture's ONE user-stated parameter is `out_csat`'s baseline. Remove it, so the
  // only authored figure in each arm below is the one the arm places.
  delete (nodeOf(graph, 'out_csat') as { observed_state?: unknown }).observed_state;
  return graph;
}

function nodeOf(graph: Record<string, unknown>, id: string): Record<string, unknown> {
  const found = (graph.nodes as Record<string, unknown>[]).find((n) => n.id === id);
  if (!found) throw new Error(`fixture drift: ${id} is absent from ${WORKED_CAPTURE}`);
  return found;
}

describe("the goal's own current level does not license a named winner", () => {
  it('PRECONDITIONS: the stamp classifies as authored, the goal is a goal, the capture starts all-Olumi', () => {
    expect(classifyValueSource(TYPED)).toBe('user_stated');
    const graph = capture();
    expect(nodeOf(graph, GOAL).kind).toBe('goal');
    expect(nodeOf(graph, GOAL).observed_state, 'the capture carries no goal level').toBeUndefined();
    expect(censusConfidenceParameters(graph).confidence_parameters_user_stated).toBe(0);
  });

  it("⭐ the user stating the goal's current level leaves the leader withheld", () => {
    const graph = capture();
    nodeOf(graph, GOAL).observed_state = { value: 0.6, source: TYPED };
    const signals = censusConfidenceParameters(graph);

    // THE DEFECT ASSERTION FIRST: at the base this reads `comparative_leader`.
    expect(resolveAnalysisAdmission(graph).permitted_analysis_mode).toBe('quantified_provisional');
    expect(signals.material_parameters_user_stated).toBe(0);

    // CONTROL (same run): the census DID read the stamp — the whole-model count moved by
    // exactly one — so the verdict above is the materiality rule's doing, not blindness.
    expect(signals.confidence_parameters_user_stated).toBe(1);
    // And the refusal names the true cause: the user HAS set something, off the comparison.
    expect(semanticVerdictCause(signals)).toBe('user_stated_not_material');
  });

  it('CONTRAST: the SAME stamp on a factor an option sets licenses the leader', () => {
    const graph = capture();
    nodeOf(graph, INTERVENED_FACTOR).observed_state = { value: 0, source: TYPED };
    const signals = censusConfidenceParameters(graph);

    expect(signals.confidence_parameters_user_stated, 'the same 1-stamp cell').toBe(1);
    expect(signals.material_parameters_user_stated).toBe(1);
    expect(resolveAnalysisAdmission(graph).permitted_analysis_mode).toBe('comparative_leader');
  });

  it('CONTRAST: a user-stated link INTO the goal still licenses — only the baseline is excluded', () => {
    const graph = capture();
    const intoGoal = (graph.edges as Record<string, unknown>[]).filter((e) => e.to === GOAL);
    expect(intoGoal.length, 'precondition: the capture has links into its goal').toBeGreaterThan(0);
    intoGoal[0]!.provenance = { source: 'user_specified' };
    expect(classifyValueSource('user_specified')).toBe('user_stated');

    expect(censusConfidenceParameters(graph).material_parameters_user_stated).toBe(1);
    expect(resolveAnalysisAdmission(graph).permitted_analysis_mode).toBe('comparative_leader');
  });

  it("the goal's level is never OFFERED as a figure that would unlock the leader", () => {
    // Offering it would be a refusal whose remedy does nothing — the harm the offered
    // list exists to prevent. A machine-authored goal level must not be listed …
    const graph = capture();
    nodeOf(graph, GOAL).observed_state = { value: 0.6, source: 'cee_inference' };
    const offered = censusConfidenceParameters(graph).material_parameters_awaiting_user_node_ids;

    expect(offered).not.toContain(GOAL);
    // … while the factor whose value WOULD unlock it still is (bound by identity).
    expect(offered).toContain(INTERVENED_FACTOR);
  });
});
