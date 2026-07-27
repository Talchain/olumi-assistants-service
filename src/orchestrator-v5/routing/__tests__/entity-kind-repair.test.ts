/**
 * Entity-kind REPAIR contract — the newcomer-journey P1 edit-path defect.
 *
 * DEFECT (live, cee-staging, reproduced 2026-07-26/27 across builds 6cfb0e57,
 * 75088207, bbadf05e, cf10c553, 9aa8fb2b): an ordinary "add a hard constraint
 * on <outcome>" turn failed roughly half the time. The routing model resolved
 * the RIGHT graph id and then mislabelled its `kind`, and the validator
 * refused the turn on the label rather than on the target.
 *
 * The Render-log evidence for the 20 consecutive refusals, which is what these
 * fixtures are built from (`safe_details`, verbatim):
 *
 *   12×  {"handler_id":"add_constraint","proposed_kind":"constraint",
 *         "accepted_kinds":["node","goal"]}
 *    8×  {"entity_id":"out_tco_efficiency","proposed_kind":"goal",
 *         "resolved_kind":"node"}
 *
 * Both are the same user request. The first was refused by the registry check
 * (the user's own word "constraint" primes the model's label); the second by
 * the graph cross-check. In the second the entity_id is the REAL outcome node
 * the user named, and `add_constraint` accepts that node's real wire kind —
 * so the request was valid and was thrown away on a bad label.
 *
 * CONTRACT: when the proposed id RESOLVES, the graph's kind is authoritative.
 * Adopt it and carry on. Refuse only when the entity's REAL kind is one the
 * handler cannot act on, or when the id resolves to nothing.
 *
 * The graph fixture is the real failing draft (scenario c731c0f1 /
 * caseINF.s1), node-for-node, including the near-duplicate sibling
 * `fac_tco_horizon` "Three-Year TCO Multiplier" that correlated 6/6 with
 * failure in the walk evidence.
 */

import { describe, expect, it } from 'vitest';

import { buildGraphLookup } from '../graph-lookup-adapter.js';
import { HANDLER_VALIDATION_REGISTRY } from '../validation-registry.js';
import { validateToolCall, type GraphLookup } from '../validator.js';
import type { EntityKind, ProposalAction, ProposalEntity } from '../types.js';
import type { GraphStateIngress } from '../../../types/graph-state-ingress.js';

// ---------------------------------------------------------------------------
// Fixtures — the real failing draft graph, verbatim from
// acceptance-evidence/g-cee-1-constraint-verdict/raw-2026-07-27-post-713/
// caseINF.s1.draft2.response.json (draft_graph.nodes).
// ---------------------------------------------------------------------------

const NEAR_DUPLICATE_SIBLING = {
  id: 'fac_tco_horizon',
  kind: 'factor',
  label: 'Three-Year TCO Multiplier',
};

const BASE_NODES = [
  { id: 'dec_laptops', kind: 'decision', label: 'Engineering Team Laptop Selection' },
  { id: 'fac_build_perf', kind: 'factor', label: 'Build and Compile Performance' },
  { id: 'fac_onboarding_friction', kind: 'factor', label: 'Platform Onboarding Friction' },
  { id: 'fac_team_size', kind: 'factor', label: 'Engineering Team Size' },
  { id: 'fac_toolchain_compat', kind: 'factor', label: 'Toolchain Compatibility' },
  { id: 'fac_unit_cost', kind: 'factor', label: 'Hardware Unit Cost per Device' },
  {
    id: 'goal_laptop_decision',
    kind: 'goal',
    label: 'Maximise Engineering Team Effectiveness Over Three Years',
  },
  { id: 'opt_dell', kind: 'option', label: 'Standardise on Dell XPS' },
  { id: 'opt_macbook', kind: 'option', label: 'Standardise on MacBook Pro' },
  {
    id: 'opt_status_quo',
    kind: 'option',
    label: 'Defer and Keep Current Machines (Status Quo)',
  },
  { id: 'out_dev_productivity', kind: 'outcome', label: 'Developer Productivity Gain' },
  { id: 'out_tco_efficiency', kind: 'outcome', label: 'Three-Year TCO Efficiency' },
  { id: 'risk_onboarding_delay', kind: 'risk', label: 'Onboarding and Transition Delay' },
  { id: 'risk_toolchain_disruption', kind: 'risk', label: 'Toolchain Disruption Risk' },
];

function lookupFor(nodes: ReadonlyArray<Record<string, unknown>>): GraphLookup {
  const result = buildGraphLookup({ nodes, edges: [] } as unknown as GraphStateIngress);
  if (result.kind !== 'ok') throw new Error(`expected ok adapter result, got ${result.kind}`);
  return result.lookup;
}

/** The graph shape that FAILED 6/6 in the walk evidence. */
const GRAPH_WITH_NEAR_DUPLICATE = lookupFor([...BASE_NODES, NEAR_DUPLICATE_SIBLING]);
/** The graph shape that LANDED 5/5 in the walk evidence. */
const GRAPH_WITHOUT_NEAR_DUPLICATE = lookupFor(BASE_NODES);

function constraintProposal(
  entity: { id: string; kind: EntityKind } & Partial<ProposalEntity>,
  handlerId = 'add_constraint',
): ProposalAction {
  return {
    handler_id: handlerId,
    entity: {
      resolution_status: 'resolved',
      resolution_method: 'id_match',
      ...entity,
    },
    // The real turn: "Add a hard constraint: Three-Year TCO Efficiency must be
    // at least 0.6."
    parameters: [
      { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
      { name: 'value', value: 0.6, source: 'user_explicit' },
    ],
    cited_context_fields: [],
  } as unknown as ProposalAction;
}

// ---------------------------------------------------------------------------
// (a) The two live failure modes, byte-for-byte from the Render telemetry.
// ---------------------------------------------------------------------------

describe('entity-kind repair — the two live failure modes now land', () => {
  it("Point A (12/20 live): proposed_kind 'constraint' on the real outcome id is repaired, not refused", () => {
    const result = validateToolCall(
      constraintProposal({
        id: 'out_tco_efficiency',
        kind: 'constraint',
        label: 'Three-Year TCO Efficiency',
      }),
      GRAPH_WITH_NEAR_DUPLICATE,
      HANDLER_VALIDATION_REGISTRY,
    );

    expect(result.valid).toBe(true);
    if (result.valid) {
      // The handler must receive the GRAPH's kind, not the model's guess.
      expect(result.proposal.entity.kind).toBe('node');
      // The id is never altered — repair changes the label, never the target.
      expect(result.proposal.entity.id).toBe('out_tco_efficiency');
      expect(result.kind_repair).toEqual({
        handler_id: 'add_constraint',
        entity_id: 'out_tco_efficiency',
        proposed_kind: 'constraint',
        resolved_kind: 'node',
      });
    }
  });

  it("Point B (8/20 live): proposed_kind 'goal' against resolved_kind 'node' is repaired, not refused", () => {
    const result = validateToolCall(
      constraintProposal({
        id: 'out_tco_efficiency',
        kind: 'goal',
        label: 'Three-Year TCO Efficiency',
      }),
      GRAPH_WITH_NEAR_DUPLICATE,
      HANDLER_VALIDATION_REGISTRY,
    );

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.proposal.entity.kind).toBe('node');
      expect(result.kind_repair?.proposed_kind).toBe('goal');
      expect(result.kind_repair?.resolved_kind).toBe('node');
    }
  });

  it('a correctly-labelled proposal is untouched and records no repair', () => {
    const result = validateToolCall(
      constraintProposal({ id: 'out_tco_efficiency', kind: 'node' }),
      GRAPH_WITH_NEAR_DUPLICATE,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.kind_repair).toBeUndefined();
      expect(result.proposal.entity.kind).toBe('node');
    }
  });
});

// ---------------------------------------------------------------------------
// (b) The 6/6 graph-shape correlate — the fixture PAIR.
//
// In the walk evidence every FAIL graph carried a near-duplicate label sharing
// the "Three-Year TCO …" prefix and every LAND graph did not, which made the
// edit turn's success a function of draft non-determinism. The verdict must
// no longer depend on the presence of that sibling.
// ---------------------------------------------------------------------------

describe('entity-kind repair — the near-duplicate-sibling correlate no longer decides the verdict', () => {
  for (const proposedKind of ['constraint', 'goal', 'node'] as const) {
    it(`proposed_kind '${proposedKind}' lands identically with and without the near-duplicate sibling`, () => {
      const withSibling = validateToolCall(
        constraintProposal({
          id: 'out_tco_efficiency',
          kind: proposedKind,
          label: 'Three-Year TCO Efficiency',
        }),
        GRAPH_WITH_NEAR_DUPLICATE,
        HANDLER_VALIDATION_REGISTRY,
      );
      const withoutSibling = validateToolCall(
        constraintProposal({
          id: 'out_tco_efficiency',
          kind: proposedKind,
          label: 'Three-Year TCO Efficiency',
        }),
        GRAPH_WITHOUT_NEAR_DUPLICATE,
        HANDLER_VALIDATION_REGISTRY,
      );

      expect(withSibling.valid).toBe(true);
      expect(withoutSibling.valid).toBe(true);
      expect(withSibling.valid && withSibling.proposal.entity.kind).toBe('node');
      expect(withoutSibling.valid && withoutSibling.proposal.entity.kind).toBe('node');
    });
  }

  it('a label_match resolution onto the correct node is not flagged suspicious by the sibling', () => {
    // The repaired entity lists candidates from the bucket it actually lives
    // in, so the Dice check finally discriminates here. The chosen label is an
    // exact match, so no suspicion — the sibling must not manufacture one.
    const result = validateToolCall(
      constraintProposal({
        id: 'out_tco_efficiency',
        kind: 'constraint',
        label: 'Three-Year TCO Efficiency',
        resolution_method: 'label_match',
      }),
      GRAPH_WITH_NEAR_DUPLICATE,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (c) POSITIVE CONTROLS — the refusals that must survive.
//
// Without these the tests above would pass just as well against a validator
// that accepted everything.
// ---------------------------------------------------------------------------

describe('entity-kind repair — positive controls: what must still be refused', () => {
  it('an id that resolves to NOTHING still fails ENTITY_NOT_FOUND', () => {
    const result = validateToolCall(
      constraintProposal({ id: 'out_does_not_exist_xyz', kind: 'node', label: 'Ghost' }),
      GRAPH_WITH_NEAR_DUPLICATE,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('ENTITY_NOT_FOUND');
  });

  it('a hallucinated kind on an UNRESOLVABLE id still fails ENTITY_KIND_MISMATCH (precedence preserved)', () => {
    // Nothing to repair against, so the model's kind stands and the registry
    // check fires first — exactly as before this change.
    const result = validateToolCall(
      constraintProposal({ id: 'ghost_id', kind: 'constraint', label: 'Ghost' }),
      GRAPH_WITH_NEAR_DUPLICATE,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('ENTITY_KIND_MISMATCH');
      expect(result.error.details?.resolved_kind).toBeUndefined();
    }
  });

  it('add_constraint aimed at a REAL option id is still refused — repair never widens the target set', () => {
    const result = validateToolCall(
      constraintProposal({
        id: 'opt_dell',
        kind: 'node',
        label: 'Standardise on Dell XPS',
      }),
      GRAPH_WITH_NEAR_DUPLICATE,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('ENTITY_KIND_MISMATCH');
      // The refusal now names what was actually found, so the composer can
      // say so instead of guessing.
      expect(result.error.details?.resolved_kind).toBe('option');
      expect(result.error.details?.resolved_label).toBe('Standardise on Dell XPS');
      expect(result.error.details?.accepted_kinds).toEqual(['node', 'goal']);
    }
  });

  it('set_factor_value aimed at a REAL option id is still refused whatever the model labels it', () => {
    for (const proposed of ['node', 'goal', 'constraint'] as const) {
      const result = validateToolCall(
        {
          handler_id: 'set_factor_value',
          entity: {
            id: 'opt_macbook',
            kind: proposed,
            resolution_status: 'resolved',
            resolution_method: 'id_match',
          },
          parameters: [{ name: 'value', value: 0.5, source: 'user_explicit' }],
          cited_context_fields: [],
        } as unknown as ProposalAction,
        GRAPH_WITH_NEAR_DUPLICATE,
        HANDLER_VALIDATION_REGISTRY,
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error.code).toBe('ENTITY_KIND_MISMATCH');
    }
  });

  it('an ambiguous resolution still supersedes the kind path (ordering unchanged)', () => {
    const result = validateToolCall(
      constraintProposal({
        id: 'out_tco_efficiency',
        kind: 'constraint',
        resolution_status: 'ambiguous',
      }),
      GRAPH_WITH_NEAR_DUPLICATE,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('ENTITY_RESOLUTION_AMBIGUOUS');
  });

  it('a graph-ABSENT turn is unchanged — no graph, no ground truth, model claim stands', () => {
    const result = validateToolCall(
      constraintProposal({ id: 'out_tco_efficiency', kind: 'constraint' }),
      undefined,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('ENTITY_KIND_MISMATCH');
  });

  it('edge proposals are never repaired — adjust_edge_strength keeps its edge-only gate', () => {
    const nonEdge = validateToolCall(
      {
        handler_id: 'adjust_edge_strength',
        entity: {
          id: 'fac_unit_cost',
          kind: 'node',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
        parameters: [{ name: 'strength', value: 0.5, source: 'user_explicit' }],
        cited_context_fields: [],
      } as unknown as ProposalAction,
      GRAPH_WITH_NEAR_DUPLICATE,
      HANDLER_VALIDATION_REGISTRY,
    );
    // A real node id proposed at an edge-only handler: the graph resolves it to
    // 'node', which adjust_edge_strength does not accept. Still refused.
    expect(nonEdge.valid).toBe(false);
    if (!nonEdge.valid) expect(nonEdge.error.code).toBe('ENTITY_KIND_MISMATCH');
  });
});

// ---------------------------------------------------------------------------
// (d) The repair must not open a hole in a kind-GATED downstream check.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// (d0) MODE SEPARATION — repair must not flatten a RIGHTFUL refusal.
//
// Three distinct edit-path refusal modes were observed on staging. Only the
// first is a defect:
//
//   1. kind-mismatch          WRONGFUL — the target was right, the label wrong.
//                             This file's subject; repaired.
//   2. entity-unresolvable    RIGHTFUL — the id resolves to nothing. Still
//                             ENTITY_NOT_FOUND (see the positive controls).
//   3. scale-clarification    RIGHTFUL — e.g. ">= 0.99" against a node the
//                             draft displays on a 0-100 scale. The service
//                             asks which figure was meant. It must keep asking:
//                             silently coercing 0.99 to 99 is a 100× guess.
//
// Mode 3 is decided in the HANDLER (add-constraint.ts, PROBABILITY_DOMAIN_KIND_SET
// + declaredCap/goal_threshold_cap), which reads the scale from the node's own
// graph metadata — and the scale VARIES between drafts, so it must be read
// back, never assumed. The validator is deliberately scale-agnostic here
// (`AddConstraintValueSchema = z.number().finite()`), and repair touches only
// `entity.kind`. Pinned below so a future "helpful" coercion in the repair path
// has to break a test.
//
// Note the direction of the interaction: repair makes mode 3 MORE reachable,
// not less. A mislabelled proposal used to die at the kind gate with the wrong
// message; it now reaches the handler and the user gets the right question.
//
// The fixture nodes deliberately carry NO observed_state / cap, so no scale is
// hard-coded here. Do not add one — it would be a hand-maintained mirror of a
// per-draft value.
// ---------------------------------------------------------------------------

describe('entity-kind repair — mode separation: value/scale concerns are untouched', () => {
  it('repair rewrites entity.kind and NOTHING else — parameters pass through byte-identical', () => {
    const proposal = constraintProposal({
      id: 'out_tco_efficiency',
      kind: 'constraint',
      label: 'Three-Year TCO Efficiency',
    });
    const result = validateToolCall(
      proposal,
      GRAPH_WITH_NEAR_DUPLICATE,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.proposal.parameters).toEqual(proposal.parameters);
      expect(result.proposal.handler_id).toBe(proposal.handler_id);
      expect(result.proposal.entity.id).toBe(proposal.entity.id);
      expect(result.proposal.entity.label).toBe(proposal.entity.label);
      // The ONLY difference.
      expect(result.proposal.entity.kind).toBe('node');
      expect(proposal.entity.kind).toBe('constraint'); // input not mutated
    }
  });

  it('the validator is scale-agnostic: 0.99 and 99 reach the handler identically', () => {
    // Whether 0.99 or 99 is meant depends on the scale THIS draft assigned the
    // node, which only the handler can read. The validator must not pre-judge
    // it in either direction — and repair must not become a place where a
    // value gets "helpfully" rescaled.
    const verdicts = [0.99, 99].map((value) => {
      const result = validateToolCall(
        {
          handler_id: 'add_constraint',
          entity: {
            id: 'out_tco_efficiency',
            kind: 'constraint',
            resolution_status: 'resolved',
            resolution_method: 'id_match',
          },
          parameters: [
            { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
            { name: 'value', value, source: 'user_explicit' },
          ],
          cited_context_fields: [],
        } as unknown as ProposalAction,
        GRAPH_WITH_NEAR_DUPLICATE,
        HANDLER_VALIDATION_REGISTRY,
      );
      expect(result.valid).toBe(true);
      // The value is forwarded untouched for the handler to adjudicate.
      return result.valid
        ? result.proposal.parameters.find((p) => p.name === 'value')?.value
        : null;
    });
    expect(verdicts).toEqual([0.99, 99]);
  });
});

describe('entity-kind repair — kind-gated prechecks run on the REPAIRED kind', () => {
  it('a repaired set_factor_value proposal still hits the value precheck', () => {
    // Gated on kind === 'node'. Before repair this proposal was refused at the
    // registry check and never reached the precheck; after repair it is
    // admitted, so the precheck MUST run — otherwise the repair would let a
    // malformed value through to the handler.
    const result = validateToolCall(
      {
        handler_id: 'set_factor_value',
        entity: {
          id: 'fac_unit_cost',
          kind: 'constraint', // mislabelled; graph says 'node'
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
        // Missing the `value` parameter entirely — the structural precheck's
        // job. If the precheck were skipped this would validate.
        parameters: [],
        cited_context_fields: [],
      } as unknown as ProposalAction,
      GRAPH_WITH_NEAR_DUPLICATE,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('PARAMETER_INVALID');
  });
});

// ---------------------------------------------------------------------------
// (e) Blast-radius invariant, stated as a test rather than as prose.
//
// The claim in validator.ts is that the set of (handler, GRAPH-RESOLVED kind)
// pairs that can execute is unchanged: a proposal is admitted iff the entity's
// real kind is accepted, regardless of what the model called it. Enumerate it.
// ---------------------------------------------------------------------------

describe('entity-kind repair — admit-set depends only on the graph-resolved kind', () => {
  const ALL_KINDS: readonly EntityKind[] = ['node', 'edge', 'option', 'goal', 'constraint'];
  const REPRESENTATIVES: ReadonlyArray<{ id: string; resolved: EntityKind }> = [
    { id: 'fac_unit_cost', resolved: 'node' },
    { id: 'out_tco_efficiency', resolved: 'node' },
    { id: 'dec_laptops', resolved: 'node' },
    { id: 'risk_toolchain_disruption', resolved: 'node' },
    { id: 'opt_dell', resolved: 'option' },
    { id: 'goal_laptop_decision', resolved: 'goal' },
  ];

  for (const handlerId of Object.keys(HANDLER_VALIDATION_REGISTRY)) {
    const decl = HANDLER_VALIDATION_REGISTRY[handlerId];
    if (!decl) continue;

    it(`${handlerId}: the kind label the model chose never changes the verdict`, () => {
      for (const target of REPRESENTATIVES) {
        const expectedAdmit = decl.accepted_entity_kinds.includes(target.resolved);
        const verdicts = new Set<boolean>();

        for (const proposedKind of ALL_KINDS) {
          // 'edge' is excluded from graph resolution by design, so it is not
          // part of the "same target, different label" family.
          if (proposedKind === 'edge') continue;
          const result = validateToolCall(
            constraintProposal({ id: target.id, kind: proposedKind }, handlerId),
            GRAPH_WITH_NEAR_DUPLICATE,
            HANDLER_VALIDATION_REGISTRY,
          );
          // Narrow to the kind verdict: other codes (PARAMETER_INVALID,
          // PRECONDITION_UNMET) are downstream of the kind gate and are not
          // what this invariant is about.
          const kindRejected = !result.valid && result.error.code === 'ENTITY_KIND_MISMATCH';
          verdicts.add(kindRejected);
        }

        expect(
          verdicts,
          `${handlerId} → ${target.id} (${target.resolved}): verdict varied by proposed label`,
        ).toEqual(new Set([!expectedAdmit]));
      }
    });
  }
});
