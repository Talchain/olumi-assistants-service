/**
 * INV-P6 — system-inferred structure must never manufacture a user obligation.
 *
 * ## STATE-CLASS AND PROVENANCE OF THE CORPUS, stated rather than implied
 *
 * Every arm is DERIVED FROM ONE REAL CAPTURE (`live-4day-week.cold-read.json`)
 * by REMOVING configuration or by adding an edge in the exact shape the repair
 * emits. Nothing here is a graph written from the author's head.
 *
 * ⚠ AND THE REASON THAT MATTERS: the four in-tree cold reads are FULLY
 * CONFIGURED (4/4, 5/5, 4/4, 3/3 options ready — measured by
 * `scripts/readiness-authority-probe.ts` at this tip), so **the corpus contains
 * ZERO instances of the harm this file is about.** A test written against the
 * captures as they stand would pass while proving nothing — a guard agreeing with
 * itself. The removals below are what make the class observable at all, and per P9
 * they are declared as a SEEDED witness, not a patient one.
 *
 * The repair-edge arm reproduces the shape `repair-authored-edge.ts:26-28` records
 * verbatim from a live probe, so it is a replay of a measured emission rather than
 * a guess about one.
 *
 * ## EVERY RULE CARRIES ITS OPPOSITE-DIRECTION TWIN
 *
 * The failure mode designed against is shipping the exact inverse of the defect
 * being closed. So each rule is asserted in BOTH directions in the SAME run:
 *   - an AI-drafted gap must NOT be demanded  ⇄  a user-stated gap MUST still be;
 *   - a repair-authored link must NOT be demanded  ⇄  a drafted link that the user
 *     has since valued MUST still be;
 *   - `unresolved_inputs` must shrink  ⇄  it must NOT shrink to nothing when a
 *     genuine user obligation exists.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { resolveRunAdmission } from '../../../orchestrator-v5/tools/handlers/analysis-ready-core.js';
import { assessRouteAdmission } from '../canonical-readiness.js';
import {
  DECLARED_VALUE_SOURCE_STAMPS,
  classifyValueSource,
  obligationFor,
  structureProvenance,
  structureProvenanceOfEffect,
} from '../obligation-provenance.js';

const CAPTURE = 'src/cee/context-integrity/__tests__/fixtures/live-4day-week.cold-read.json';

interface Node {
  id?: string;
  kind?: string;
  is_baseline?: boolean;
  interventions?: Record<string, unknown>;
  observed_state?: Record<string, unknown>;
  [k: string]: unknown;
}

function capture(): { nodes: Node[]; edges: Array<Record<string, unknown>>; [k: string]: unknown } {
  const parsed = JSON.parse(readFileSync(CAPTURE, 'utf8')) as { graph: Record<string, unknown> };
  // Structured clone so one arm's mutation cannot leak into another's — the
  // in-place stamping this file exercises makes shared objects a real hazard.
  return JSON.parse(JSON.stringify(parsed.graph));
}

/** Strip the named options' interventions — what a partly-configured fresh draft is. */
function withUnconfiguredOptions(optionIds: readonly string[]): Record<string, unknown> {
  const graph = capture();
  graph.nodes = graph.nodes.map((node) =>
    node.kind === 'option' && optionIds.includes(node.id ?? '')
      ? { ...node, interventions: {} }
      : node,
  );
  // The canonical top-level `options[]` is what the semantic projection reads, so
  // it has to be stripped in step with the nodes or the arm is inconsistent.
  if (Array.isArray(graph.options)) {
    graph.options = (graph.options as Array<Record<string, unknown>>).map((option) =>
      optionIds.includes(String(option.option_id ?? option.id))
        ? { ...option, interventions: {} }
        : option,
    );
  }
  return graph;
}

/**
 * Restamp an option's remaining interventions as the user's own, so the arm
 * carries a genuine USER-STATED gap. This is the TWIN's engine: without it every
 * arm would read `ai_drafted`/`unattributed` and the suite could not tell a
 * working filter from a filter that suppresses everything.
 */
function withUserStatedOption(graph: Record<string, unknown>, optionId: string): Record<string, unknown> {
  const nodes = (graph.nodes as Node[]).map((node) => {
    if (node.id !== optionId) return node;
    return {
      ...node,
      interventions: { fac_impl_spend: { value: 0.4, source: 'user_specified' } },
    };
  });
  return { ...graph, nodes };
}

describe('classifyValueSource — the declared vocabularies, exhaustively', () => {
  it('classifies every declared stamp, and never returns unattributed for one', () => {
    expect(DECLARED_VALUE_SOURCE_STAMPS.length).toBeGreaterThan(10);
    const unclassified = DECLARED_VALUE_SOURCE_STAMPS.filter(
      (stamp) => classifyValueSource(stamp) === 'unattributed',
    );
    expect(unclassified).toEqual([]);
  });

  it('reads the user\'s own stamps as user_stated', () => {
    for (const stamp of ['user_specified', 'user_override', 'panel_elicited', 'brief_extraction']) {
      expect(classifyValueSource(stamp)).toBe('user_stated');
      expect(obligationFor(classifyValueSource(stamp))).toBe('required');
    }
  });

  it('reads the system\'s own stamps as not-the-user', () => {
    expect(classifyValueSource('cee_hypothesis')).toBe('ai_drafted');
    expect(classifyValueSource('cee_inference')).toBe('ai_drafted');
    expect(classifyValueSource('domain_knowledge')).toBe('ai_drafted');
    expect(classifyValueSource('cee_repair')).toBe('system_repaired');
    for (const stamp of ['cee_hypothesis', 'cee_inference', 'domain_knowledge', 'cee_repair']) {
      expect(obligationFor(classifyValueSource(stamp))).toBe('offered');
    }
  });

  it('NEVER GUESSES: an absent or unrecognised stamp is unattributed, per the contract\'s own instruction', () => {
    // `@talchain/schemas` ObservedStateSchema.source: "Absence means the producer
    // stamped no provenance — a consumer MUST NOT read absence as any particular
    // class; classify unknown/absent as neutral, never guess."
    expect(classifyValueSource(undefined)).toBe('unattributed');
    expect(classifyValueSource(null)).toBe('unattributed');
    expect(classifyValueSource('')).toBe('unattributed');
    expect(classifyValueSource('user_invented_by_a_lane')).toBe('unattributed');
    // ⚠ THE SUBSTRING TRAP, PINNED. `mapToV3ProvenanceSource` coerced anything
    // CONTAINING "user" to `user_specified`, which would turn a withdrawn
    // obligation back into an obligation. This file matches on membership only.
    expect(classifyValueSource('user_declined')).toBe('unattributed');
    expect(classifyValueSource('not_a_user_value')).toBe('unattributed');
  });
});

describe('structureProvenance — read from the producer, not from display fields', () => {
  it('reads a factor\'s own observed_state stamp', () => {
    const graph = capture();
    const inferred = graph.nodes.find((n) => n.id === 'fac_impl_spend');
    // Real capture: observed_state.source === 'cee_inference'.
    expect(structureProvenance(inferred, graph)).toBe('ai_drafted');
  });

  it('does NOT infer authorship from a prior, or from NodeV3.provenance', () => {
    const graph = capture();
    // Real capture: `fac_market_labour` carries `prior {0.3, 0.7} uniform` and
    // `provenance: "ai_inferred"` — a display value, declared response-only. It has
    // NO `observed_state` and therefore no producer-written value stamp, so the
    // honest answer is `unattributed`. A rule that read the prior, or read
    // `provenance`, would answer `ai_drafted` here and would be guessing.
    const priorOnly = graph.nodes.find((n) => n.id === 'fac_market_labour');
    expect(priorOnly?.prior).toBeDefined();
    expect(structureProvenance(priorOnly, graph)).toBe('unattributed');
  });

  it('an option\'s user-stated effect makes the option user-stated', () => {
    const graph = withUserStatedOption(capture(), 'opt_phased');
    const option = (graph.nodes as Node[]).find((n) => n.id === 'opt_phased');
    expect(structureProvenance(option, graph)).toBe('user_stated');
  });
});

describe('structureProvenanceOfEffect — the option×factor relationship', () => {
  it('a repair-authored option→factor edge makes the effect the SYSTEM\'s', () => {
    const graph = withUnconfiguredOptions(['opt_phased']);
    // The shape `fixStatusQuoConnectivity` emits, replayed from the probe output
    // recorded verbatim at `graph/repair-authored-edge.ts:26-28`.
    (graph.edges as Array<Record<string, unknown>>).push({
      from: 'opt_phased',
      to: 'fac_market_labour',
      provenance: { source: 'cee_hypothesis', reasoning: 'Status-quo option wired to factor' },
      origin: 'repair',
    });
    expect(structureProvenanceOfEffect(graph, 'opt_phased', 'fac_market_labour')).toBe(
      'system_repaired',
    );
    expect(obligationFor('system_repaired')).toBe('offered');
  });

  it('TWIN — the SAME edge without the repair origin is not system_repaired', () => {
    const graph = withUnconfiguredOptions(['opt_phased']);
    (graph.edges as Array<Record<string, unknown>>).push({
      from: 'opt_phased',
      to: 'fac_market_labour',
      provenance: { source: 'cee_hypothesis', reasoning: 'Status-quo option wired to factor' },
      origin: 'ai',
    });
    expect(structureProvenanceOfEffect(graph, 'opt_phased', 'fac_market_labour')).not.toBe(
      'system_repaired',
    );
  });

  it('the WEAKEST end wins — a user-stated option against an unattributed factor is not the user\'s obligation', () => {
    const graph = withUserStatedOption(withUnconfiguredOptions([]), 'opt_phased');
    // `fac_market_labour` carries no producer stamp at all.
    expect(structureProvenanceOfEffect(graph, 'opt_phased', 'fac_market_labour')).toBe(
      'unattributed',
    );
  });

  it('TWIN — both ends user-stated IS the user\'s obligation', () => {
    const graph = withUserStatedOption(withUnconfiguredOptions([]), 'opt_phased');
    const nodes = (graph.nodes as Node[]).map((node) =>
      node.id === 'fac_4day_adoption'
        ? { ...node, observed_state: { value: 0.2, source: 'user_override' } }
        : node,
    );
    const withUserFactor = { ...graph, nodes };
    expect(structureProvenanceOfEffect(withUserFactor, 'opt_phased', 'fac_4day_adoption')).toBe(
      'user_stated',
    );
    expect(obligationFor('user_stated')).toBe('required');
  });
});

describe('the assessor stamps every issue, and only required ones become an ASK', () => {
  it('every blocking issue carries provenance AND obligation', () => {
    const assessment = assessCanonicalAnalysisReadiness(withUnconfiguredOptions(['opt_phased']));
    expect(assessment.blockingIssues.length).toBeGreaterThan(0);
    for (const issue of assessment.blockingIssues) {
      expect(issue.provenance, `issue ${issue.issue_id} (${issue.code}) has no provenance`).toBeDefined();
      expect(issue.obligation, `issue ${issue.issue_id} (${issue.code}) has no obligation`).toBeDefined();
    }
  });

  it('the stamps are on the SAME objects the wire payload carries (not a stamped copy)', () => {
    const assessment = assessCanonicalAnalysisReadiness(withUnconfiguredOptions(['opt_phased']));
    const wire = assessment.analysisReady?.readiness_issues ?? [];
    expect(wire.length).toBeGreaterThan(0);
    for (const issue of wire) expect(issue.obligation).toBeDefined();
  });

  it('an AI-drafted / unattributed gap reaches unresolved_inputs MARKED offered, never as a bare demand', () => {
    // Two unconfigured options over factors with no user stamp → the gaps are the
    // system's own, so they may be offered but never demanded.
    const assessment = assessCanonicalAnalysisReadiness(
      withUnconfiguredOptions(['opt_phased', 'opt_full_rollout']),
    );
    const offered = assessment.blockingIssues.filter((i) => i.obligation === 'offered');
    expect(offered.length).toBeGreaterThan(0);
    const inputs = assessment.repairProposal?.unresolved_inputs ?? [];
    // ⚠ COMPLETENESS FIRST. The proposal claims `complete: true`, whose
    // machine-checkable form is one input per blocker. A version of this rule that
    // DROPPED offered inputs broke that invariant while keeping the flag — a payload
    // that looks more complete and is less true. So the assertion is that every
    // blocker is still listed AND that each carries its obligation.
    if (assessment.repairProposal) {
      expect(inputs.length).toBe(assessment.blockingIssues.length);
    }
    const byId = new Map(inputs.map((input) => [input.issue_id, input]));
    for (const issue of offered) {
      const input = byId.get(issue.issue_id);
      if (!input) continue; // structural issues without a required-input mapping
      expect(input.obligation, `offered issue ${issue.issue_id} was listed as a bare demand`).toBe(
        'offered',
      );
      expect(input.provenance).toBe(issue.provenance);
    }
  });

  it('TWIN — a USER-STATED gap is still demanded, so the filter is not "suppress everything"', () => {
    const graph = withUnconfiguredOptions(['opt_phased', 'opt_full_rollout']);
    // Give both ends of ONE pair a user stamp: the option has a user-set effect on
    // another factor, and the target factor's own value is the user's.
    const nodes = (graph.nodes as Node[]).map((node) => {
      if (node.id === 'opt_phased') {
        return { ...node, interventions: { fac_impl_spend: { value: 0.4, source: 'user_specified' } } };
      }
      if (node.id === 'fac_4day_adoption') {
        return { ...node, observed_state: { value: 0.2, source: 'user_override' } };
      }
      return node;
    });
    const assessment = assessCanonicalAnalysisReadiness({ ...graph, nodes });
    // ⚠ BOUND BY IDENTITY, NOT BY COUNT. `required.length > 0` would pass on any
    // structural blocker the arm happens to carry (`EDGE_LIMIT_EXCEEDED` alone
    // satisfies it), so the assertion would hold with the provenance filter
    // suppressing every option-value obligation. It names the option AND the
    // category, so only the user-stated gap can satisfy it.
    const userStatedOptionGaps = assessment.blockingIssues.filter(
      (issue) =>
        issue.obligation === 'required' &&
        issue.category === 'option_values' &&
        issue.option_id === 'opt_phased',
    );
    expect(
      userStatedOptionGaps.map((i) => i.code),
      'the user-stated gap on opt_phased lost its obligation',
    ).not.toEqual([]);
    for (const gap of userStatedOptionGaps) expect(gap.provenance).toBe('user_stated');
    // And the ask survives: the user-stated obligation reaches `unresolved_inputs`
    // whenever the proposal exists at all, named by the same option id.
    if (assessment.repairProposal) {
      expect(
        assessment.repairProposal.unresolved_inputs.some(
          (i) => i.option_id === 'opt_phased' && i.obligation === 'required',
        ),
      ).toBe(true);
    }
  });

  it('structural blockers keep their obligation — a model that cannot be computed is not an "offer"', () => {
    const graph = capture();
    // Remove the goal: the model genuinely cannot be analysed and the user must act.
    graph.nodes = graph.nodes.filter((node) => node.kind !== 'goal');
    const assessment = assessCanonicalAnalysisReadiness(graph);
    const structural = assessment.blockingIssues.filter((i) => i.category === 'graph_structure');
    expect(structural.length).toBeGreaterThan(0);
    for (const issue of structural) expect(issue.obligation).toBe('required');
  });
});

describe('Move 1 — the offer names its own consequence', () => {
  it('a blocker the exclusion answers is stamped waived_by_exclusion, and the offer lists the excluded ids', () => {
    const graph = withUnconfiguredOptions(['opt_phased']);
    const admission = resolveRunAdmission(graph);
    if (!admission.willProceed) {
      // Not reachable on this arm at this tip — assert the honest alternative
      // rather than silently passing: nothing may claim a waiver it did not make.
      for (const issue of admission.assessment.blockingIssues) {
        expect(issue.waived_by_exclusion).not.toBe(true);
      }
      return;
    }
    const waived = admission.assessment.blockingIssues.filter((i) => i.waived_by_exclusion === true);
    expect(waived.length).toBeGreaterThan(0);
    const route = assessRouteAdmission(graph);
    expect(route.scaffold_plan.excluded_option_ids ?? []).toContain('opt_phased');
    expect(route.readiness_issues.some((i) => i.waived_by_exclusion === true)).toBe(true);
  });

  it('TWIN — a strictly-ready model claims NO waiver', () => {
    const admission = resolveRunAdmission(capture());
    for (const issue of admission.assessment.blockingIssues) {
      expect(issue.waived_by_exclusion).not.toBe(true);
    }
  });
});

describe('the route publishes ONE admission answer', () => {
  it('may_run is the run path\'s own predicate, never a re-derivation', () => {
    for (const graph of [capture(), withUnconfiguredOptions(['opt_phased'])]) {
      expect(assessRouteAdmission(graph).may_run).toBe(resolveRunAdmission(graph).willProceed);
    }
  });

  it('D4 — the option DENOMINATOR is a fact about the model, not about its analysability', () => {
    const graph = capture();
    // Precondition pinned in-test: the arm really does carry three option nodes, so
    // a `0 of 0` result cannot be excused as an empty model.
    expect(graph.nodes.filter((n) => n.kind === 'option').map((n) => n.id)).toEqual([
      'opt_full_rollout',
      'opt_phased',
      'opt_status_quo',
    ]);
    graph.nodes = graph.nodes.filter((node) => node.kind !== 'goal');
    const route = assessRouteAdmission(graph);
    // Was `0 of 0` on a model plainly carrying three options.
    expect(route.options_total).toBe(3);
    // TWIN — the NUMERATOR is not inflated: none of them is ready on a goal-less graph.
    expect(route.options_ready).toBe(0);
  });

  it('TWIN — a healthy model\'s denominator is unchanged by the floor', () => {
    const route = assessRouteAdmission(capture());
    expect(route.options_total).toBe(3);
    expect(route.options_ready).toBe(3);
  });

  it('the headline never QUOTES a demand the user does not owe', () => {
    // ⚠ NOT A COPY PROXY. Asserting the absence of a phrase like "not ready" would
    // be a predicate over prose (trap 22) and would break on any rewording. The
    // structural property is: `blocker_reason` must never be the MESSAGE of an
    // `offered` blocker — because that is the sentence the panel shows as the
    // user's obstacle, and an offered gap is not the user's to answer.
    const graph = withUnconfiguredOptions(['opt_phased', 'opt_full_rollout']);
    const route = assessRouteAdmission(graph);
    const offeredMessages = route.readiness_issues
      .filter((issue) => issue.obligation === 'offered' || issue.waived_by_exclusion === true)
      .map((issue) => issue.message);
    // Precondition pinned: the arm really does raise offered blockers, so a pass
    // cannot come from an empty set.
    expect(offeredMessages.length).toBeGreaterThan(0);
    expect(route.blocker_reason).toBeDefined();
    expect(offeredMessages).not.toContain(route.blocker_reason);
  });

  it('TWIN — a REQUIRED blocker IS the headline, so the rule is not "never explain"', () => {
    const graph = capture();
    graph.nodes = graph.nodes.filter((node) => node.kind !== 'goal');
    const route = assessRouteAdmission(graph);
    const required = route.readiness_issues.filter(
      (issue) => issue.obligation === 'required' && issue.waived_by_exclusion !== true,
    );
    expect(required.length).toBeGreaterThan(0);
    expect(required.map((i) => i.message)).toContain(route.blocker_reason);
  });
});
