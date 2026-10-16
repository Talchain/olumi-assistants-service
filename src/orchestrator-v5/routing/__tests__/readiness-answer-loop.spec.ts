/**
 * THE READINESS ANSWER LOOP — the turn-by-turn route from a blocked model to a
 * running analysis.
 *
 * ⭐ WHAT THIS SUITE EXISTS TO PIN, and why it is worth a file of its own.
 *
 * The product could already DERIVE every question it needed to ask. What it
 * could not do was let anyone ANSWER one. The witnessed fresh-guest journey
 * (2026-08-20, UI `2b6ec553` / CEE `19a60fd`) ended in a refusal on every route,
 * and the only working path was typing a sentence — `Set the <option> option's
 * effect on <factor> to <n>` — that nobody would discover.
 *
 * ⚠ EVERY EXPECTATION HERE IS DERIVED FROM THE PRODUCER, NEVER TRANSCRIBED.
 * The option and factor labels, the issue codes, the blocker ids and the chip
 * messages are all read out of `assessCanonicalAnalysisReadiness` and
 * `buildConfigureOptionAdvisedFormat` at test time. A self-authored fixture
 * silently encodes the author's model of the producer rather than the producer
 * (trap 16-inverse), and this loop's whole job is to carry the producer's own
 * words to the user.
 *
 * The graph is a REAL DATED CAPTURE (`witness-2026-08-17/j4-wrong-entity-write
 * .json`, deployed CEE `8be62df`, scenario J4), varied only by CLEARING or
 * SETTING option interventions in memory. The capture file itself is never
 * edited — it is a historic record (trap 14b).
 */

import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';



const CAPTURE = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/witness-2026-08-17/j4-wrong-entity-write.json', import.meta.url),
    'utf8',
  ),
) as { draft_graph: { nodes: Array<Record<string, unknown>>; edges: unknown[] } };

type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

/**
 * ⚠ THE INTERVENTION SHAPE IS DERIVED FROM THE CAPTURE, NEVER AUTHORED HERE.
 *
 * My first draft of this fixture wrote `{ [factorId]: 0.5 }` — a bare number —
 * and the "two configured options must proceed" assertion went RED. The real
 * shape is an OBJECT (`{ value, source, target_match, value_confidence,
 * reasoning }`), and the factor must be one the option is actually EDGE-
 * CONNECTED to. A self-authored fixture outside the producer's reachable
 * domain proves nothing about the producer (trap 16-inverse) — and here it
 * would have made a correct implementation look broken. The donor prototype is
 * cloned out of the capture's own configured options.
 */
function interventionFor(factorId: string, value: number): Record<string, unknown> {
  const donor = (CAPTURE.draft_graph.nodes as Array<Record<string, any>>).find(
    (n) => n.kind === 'option' && Object.keys(n.interventions ?? {}).length > 0,
  );
  const proto = structuredClone(Object.values(donor!.interventions)[0]) as Record<string, any>;
  proto.value = value;
  if (proto.target_match) proto.target_match.node_id = factorId;
  return { [factorId]: proto };
}

/** The first factor this option genuinely points at in the capture's edges. */
function firstConnectedFactor(graph: Graph, optionId: string): string | undefined {
  const factors = new Set(graph.nodes.filter((n) => n.kind === 'factor').map((n) => String(n.id)));
  for (const edge of graph.edges) {
    const source = String(edge.source ?? edge.from);
    const target = String(edge.target ?? edge.to);
    if (source === optionId && factors.has(target)) return target;
  }
  return undefined;
}

/**
 * The capture with the FIRST `configuredCount` options given a real effect
 * value, and the rest cleared. Option order is the capture's own node order.
 */
function graphWithConfiguredOptions(configuredCount: number): Graph {
  const graph = structuredClone(CAPTURE.draft_graph) as Graph;
  let index = 0;
  for (const node of graph.nodes) {
    if (node.kind !== 'option') continue;
    const factorId = firstConnectedFactor(graph, String(node.id));
    node.interventions =
      index < configuredCount && factorId !== undefined ? interventionFor(factorId, 0.5) : {};
    index += 1;
  }
  return graph;
}

/** Every option unconfigured — the witnessed fresh-draft arm (6 blockers). */


/**
 * Exactly ONE option left unconfigured.
 *
 * ⭐⭐ THE CASE THAT WOULD HAVE SHIPPED A LOOP THAT WORKS UNTIL THE LAST STEP.
 * `repairProposal` — and therefore `unresolved_inputs` — is built ONLY when
 * `blockingIssues.length >= 2` (`analysis-ready-helper.ts`). This loop
 * CONVERGES TOWARD ONE BLOCKER, so a loop reading `unresolved_inputs` is
 * correct for questions 1..n-1 and goes BLANK at question n. Any corpus that
 * never runs to completion passes it. This is the guard that does not.
 */






describe('readiness answer loop — the blocked model gets an answerable route', () => {
















  it('⭐ THE LADDER: admission flips at TWO configured options, and the proposal vanishes at ONE blocker', () => {
    // This table IS the design, and every row is derived by executing the
    // authority over the capture — not transcribed from a note.
    //
    //   configured | blocking | repairProposal | willProceed
    //       0      |    6     |       6        |   false
    //       1      |    5     |       5        |   false
    //       2      |    4     |       4        |   TRUE     <- finish line
    //       5      |    1     |      NULL      |   TRUE     <- blank-out
    //
    // Two facts the loop is built on: the user needs TWO answers, not six
    // (`PLOT_MIN_COMPARISON_OPTIONS`), and `unresolved_inputs` is GONE at the
    // last question.
    const rows = [0, 1, 2, 3, 5].map((configured) => {
      const graph = graphWithConfiguredOptions(configured);
      const assessment = assessCanonicalAnalysisReadiness(graph);
      return {
        configured,
        blocking: assessment.blockingIssues.length,
        hasProposal: assessment.repairProposal !== null,
        willProceed: resolveRunAdmission(graph).willProceed,
      };
    });
    expect(rows).toEqual([
      { configured: 0, blocking: 6, hasProposal: true, willProceed: false },
      { configured: 1, blocking: 5, hasProposal: true, willProceed: false },
      { configured: 2, blocking: 4, hasProposal: true, willProceed: true },
      { configured: 3, blocking: 3, hasProposal: true, willProceed: true },
      { configured: 5, blocking: 1, hasProposal: false, willProceed: true },
    ]);
  });






});
