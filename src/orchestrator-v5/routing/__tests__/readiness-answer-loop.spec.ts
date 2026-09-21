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

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { buildRepairPairChipMessage } from '../../configure-option-chip-text.js';
import { composeReadinessIntakeResponse } from '../readiness-intake.js';
import { selectAnswerableBlockers } from '../readiness-answer-chips.js';

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
function zeroConfiguredGraph(): Graph {
  return graphWithConfiguredOptions(0);
}

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
function finalQuestionGraph(): Graph {
  return graphWithConfiguredOptions(5);
}

function labelOf(graph: Graph, id: string | undefined): string {
  const node = graph.nodes.find((n) => String(n.id) === id);
  return node === undefined ? '' : String(node.label);
}

const STAGE = 'analysing' as Parameters<typeof composeReadinessIntakeResponse>[1];

describe('readiness answer loop — the blocked model gets an answerable route', () => {
  it('PINS THE CENTRE OF GRAVITY: the readiness arm offers at least one chip on an open model', () => {
    // The typed `analysis_readiness` chip routes here correctly and, at
    // pristine, arrives at prose with NO affordance whatsoever. Three branches
    // of this composer return `suggested_actions: []`; that is the whole gap.
    const result = composeReadinessIntakeResponse(zeroConfiguredGraph(), STAGE);
    expect(result.outcome).toBe('readiness_open');
    expect(result.response.suggested_actions.length).toBeGreaterThan(0);
  });

  it('offers the IDENTITY-CARRYING repair chip for MISSING_OPTION_VALUE, naming the producer\'s own option AND factor', () => {
    const graph = zeroConfiguredGraph();
    const assessment = assessCanonicalAnalysisReadiness(graph);
    const missing = assessment.blockingIssues.find((i) => i.code === 'MISSING_OPTION_VALUE');
    expect(missing, 'capture must yield a MISSING_OPTION_VALUE blocker').toBeDefined();
    // BIND BY IDENTITY — the producer's ids, resolved to the producer's labels.
    // Never a value predicate another blocker could satisfy.
    const optionLabel = labelOf(graph, missing!.option_id);
    const factorLabel = labelOf(graph, missing!.factor_id);
    expect(optionLabel.length, 'option label resolves from the capture').toBeGreaterThan(0);
    expect(factorLabel.length, 'factor label resolves from the capture').toBeGreaterThan(0);

    const messages = composeReadinessIntakeResponse(graph, STAGE).response.suggested_actions.map(
      (a) => a.message,
    );
    // The sentence is DERIVED from the estate's single configure-option copy
    // authority, not transcribed here — if that builder changes, this moves
    // with it rather than going quietly stale.
    expect(messages).toContain(buildRepairPairChipMessage(optionLabel, factorLabel));
  });

  it('⭐⭐ THE FABRICATION BOUNDARY: no chip carries a value the PRODUCT chose', () => {
    // ⚠ THIS GUARD EXISTS BECAUSE THE OBVIOUS DESIGN IS THE FORBIDDEN ONE, and
    // the next person to read this file will want to build it.
    //
    // A calibrated row — `Small · 0.25` / `Moderate · 0.5` / `Large · 0.8` —
    // is the natural answer mechanic and turns a typed sentence into a click.
    // The estate has ALREADY ruled against it, in three places
    // (`configure-option-chip-text.ts` on `buildRepairPairChipMessage`,
    // `routing/configure-option-clarify.ts`, and by the conforming example of
    // `compose/repair-value-ask-response.ts`, whose value is documented as
    // "The user's value, verbatim"):
    //
    //   a chip may carry a value the USER has already stated;
    //   a chip may NEVER carry a value the PRODUCT chose,
    //   because it reads as the product's recommendation and puts a
    //   fabricated intervention one click away.
    //
    // So the loop completes the IDENTIFICATION and leaves the number to the
    // user. If that rule is ever revisited, this test is the place it gets
    // revisited — deliberately, with the posture in view, not by accident.
    const graphs = [zeroConfiguredGraph(), graphWithConfiguredOptions(2), finalQuestionGraph()];
    for (const graph of graphs) {
      for (const action of composeReadinessIntakeResponse(graph, STAGE).response.suggested_actions) {
        // `buildConfigureOptionAdvisedFormat` is the value-BEARING sentence.
        // Its shape is `Set the X option's effect on Y to <n>`; a digit after
        // "to" is exactly what the router's writer consumes.
        expect(
          /\boption's effect on\b.*\bto\s+\d/.test(action.message),
          `chip proposes a product-chosen value: ${action.message}`,
        ).toBe(false);
      }
    }
  });

  it('⭐ FINAL QUESTION: still offers an answer chip when repairProposal is NULL (blockingIssues < 2)', () => {
    const graph = finalQuestionGraph();
    const assessment = assessCanonicalAnalysisReadiness(graph);
    // Pin the PRECONDITION in-test, so this can never pass by accident on a
    // graph that happens to still have a proposal (trap 13b).
    expect(assessment.blockingIssues.length).toBe(1);
    expect(assessment.repairProposal, 'the ≥2 gate must genuinely be shut here').toBeNull();

    const result = composeReadinessIntakeResponse(graph, STAGE);
    // ⚠ BIND TO AN *ANSWER* CHIP, NOT TO "any chip". The first version of this
    // assertion read `suggested_actions.length > 0` and PASSED under the
    // mutant that reintroduced the defect — because at this point the run
    // already proceeds, so the Run chip alone satisfied it. A guard that the
    // defect walks straight through is worse than none: it reports coverage
    // it does not provide.
    const answerChips = result.response.suggested_actions.filter((a) =>
      a.id.startsWith('chip_readiness_answer_'),
    );
    expect(answerChips.length, 'the last question must still be answerable').toBeGreaterThan(0);
  });

  it('an OPTION_NEEDS_MAPPING blocker (no factor_id) gets a configure chip, never a fabricated value sentence', () => {
    const graph = zeroConfiguredGraph();
    const assessment = assessCanonicalAnalysisReadiness(graph);
    const mapping = assessment.blockingIssues.find((i) => i.code === 'OPTION_NEEDS_MAPPING');
    expect(mapping, 'capture must yield an OPTION_NEEDS_MAPPING blocker').toBeDefined();
    // The producer does not know which factor this option moves — that is the
    // blocker. A value sentence cannot be composed without inventing the
    // factor, so the loop must ask which factor FIRST.
    expect(mapping!.factor_id).toBeUndefined();

    const optionLabel = labelOf(graph, mapping!.option_id);
    // Configure everything EXCEPT the unmapped option, so it is the one the
    // loop must be asking about.
    const mappingOnly = structuredClone(graphWithConfiguredOptions(6)) as Graph;
    for (const node of mappingOnly.nodes) {
      if (String(node.id) === mapping!.option_id) node.interventions = {};
    }
    const actions = composeReadinessIntakeResponse(mappingOnly, STAGE).response.suggested_actions;
    for (const action of actions) {
      expect(
        action.message.startsWith('Set '),
        `must not compose a value sentence for an unmapped option: ${action.message}`,
      ).toBe(false);
    }
    expect(actions.some((a) => a.message.includes(optionLabel))).toBe(true);
  });

  it('never emits more chips than the deployed 3-chip cap can render', () => {
    // `SuggestedChips` slices to 3 (observed in the deployed bundle,
    // 2026-08-20). Emitting more would silently drop affordances the copy
    // may have promised.
    for (const graph of [zeroConfiguredGraph(), finalQuestionGraph()]) {
      expect(composeReadinessIntakeResponse(graph, STAGE).response.suggested_actions.length)
        .toBeLessThanOrEqual(3);
    }
  });

  it('OFFERS, never DEMANDS — every blocker here is obligation:offered', () => {
    const graph = zeroConfiguredGraph();
    const assessment = assessCanonicalAnalysisReadiness(graph);
    // Precondition pinned in-test: if a `required` blocker ever appears here
    // this assertion is about a different world and must be re-derived.
    expect(assessment.blockingIssues.every((i) => i.obligation === 'offered')).toBe(true);

    const text = composeReadinessIntakeResponse(graph, STAGE).response.assistant_text;
    // `user_stated` and only `user_stated` earns a demand
    // (`obligation-provenance.ts`). Structure OLUMI authored may be OFFERED to
    // the user; it may never be demanded of them.
    for (const demand of [/\byou must\b/i, /\byou need to\b/i, /\brequired\b/i, /\byou have to\b/i]) {
      expect(demand.test(text), `demand phrasing over an offered blocker: ${demand}`).toBe(false);
    }
  });

  it('when the run WILL proceed, it says so, names what it leaves out, and offers the run', () => {
    // ⭐ "TWO ANSWERS, NOT SIX". `PLOT_MIN_COMPARISON_OPTIONS = 2`, so the
    // finish line moves TOWARD the user: with two options configured the
    // comparison runs and exclusion honestly carries the rest. The loop must
    // STOP ASKING here — continuing to ask for values that no longer block
    // anything manufactures an obligation the blockers do not carry.
    const graph = zeroConfiguredGraph();
    const admission = resolveRunAdmission(graph);
    expect(admission.willProceed, 'zero-configured capture must NOT proceed').toBe(false);

    const twoConfigured = graphWithConfiguredOptions(2);
    expect(resolveRunAdmission(twoConfigured).willProceed, 'two configured options must proceed').toBe(true);

    const result = composeReadinessIntakeResponse(twoConfigured, STAGE);
    expect(result.response.suggested_actions.some((a) => a.action_type === 'run_analysis')).toBe(true);
  });

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

  it('the answerable filter binds by BLOCKER CODE, not merely by having an option', () => {
    // ⚠ ADDED BECAUSE A MUTANT SURVIVED. Deleting the code check left every
    // assertion green: structural blockers were still excluded, but only
    // INCIDENTALLY — they carry no `option_id`. A blocker that DOES name an
    // option and DOES need human input, but is not about a missing effect
    // (a constraint review, a unit mismatch), would have been offered a
    // "set the value" chip it cannot answer. Tested on the selector directly,
    // bound by code identity.
    const base = {
      issue_id: 'probe_1',
      option_id: 'opt_1',
      repairability: 'human_input_required',
      message: 'probe',
    } as unknown as Parameters<typeof selectAnswerableBlockers>[0][number];

    const answerable = { ...base, code: 'MISSING_OPTION_VALUE' } as typeof base;
    const notAnswerable = { ...base, code: 'CONSTRAINT_REVIEW_REQUIRED' } as typeof base;

    // Positive control FIRST — without it, "excludes X" could pass on a
    // selector that excludes everything.
    expect(selectAnswerableBlockers([answerable]).map((i) => i.issue_id)).toEqual(['probe_1']);
    expect(selectAnswerableBlockers([notAnswerable])).toEqual([]);
  });

  it('reads as English: every sentence in the composed answer starts with a capital', () => {
    // ⚠ ADDED AFTER READING THE OUTPUT. The suite was fully green while the
    // product emitted "…to run. four options are still unset" — a spelled
    // number opening a sentence. Chip counts, phrasing bans and identity
    // bindings are all blind to it.
    for (const graph of [zeroConfiguredGraph(), graphWithConfiguredOptions(2), finalQuestionGraph()]) {
      const text = composeReadinessIntakeResponse(graph, STAGE).response.assistant_text;
      for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        const trimmed = sentence.trim();
        if (trimmed.length === 0) continue;
        const first = trimmed[0]!;
        if (!/[a-zA-Z]/.test(first)) continue; // bullets, digits — not sentence starts
        expect(first, `lower-case sentence start: "${trimmed.slice(0, 60)}"`).toBe(first.toUpperCase());
      }
    }
  });

  it('DISCRIMINATION CONTROL: a structural blocker gets no value chip', () => {
    // Without this, "offers a chip" could be satisfied by a builder that
    // attaches a value chip to everything. A model with no goal is not
    // answerable with a number, and must not be offered one.
    const graph = structuredClone(CAPTURE.draft_graph) as Graph;
    graph.nodes = graph.nodes.filter((n) => n.kind !== 'goal');
    const result = composeReadinessIntakeResponse(graph, STAGE);
    expect(result.outcome).toBe('goal_missing');
    for (const action of result.response.suggested_actions) {
      expect(action.message.startsWith('Set ')).toBe(false);
    }
  });
});
