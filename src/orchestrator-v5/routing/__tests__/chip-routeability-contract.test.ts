/**
 * V5 Chip Routeability Contract.
 *
 * Lane invariant: every chip or suggested action V5 emits — and every
 * node-targeted (factor/risk/outcome/decision/action) explanation question the
 * user can type back verbatim — must route and validate, instead of dying in
 * the validator with ENTITY_KIND_MISMATCH and the generic "I wasn't sure what
 * you meant" dead-end (the V5 Live AI Experience Failure Audit's P0).
 *
 * Root cause: factor / risk / outcome / decision / action nodes all collapse to
 * the wire entity kind 'node' (`toEntityKind`, graph-lookup-adapter.ts). The two
 * no-op explanation handlers (explain_results, explain_from_structure) used to
 * accept only ['goal', 'option'], so a node target was rejected. Both handlers
 * IGNORE the proposal entity and explain the whole structure/analysis, so the
 * fix adds 'node' to their accepted_entity_kinds.
 *
 * Scope of this contract test — read precisely, it does not over-claim:
 *   - it proves every node class that collapses to 'node' (factor/risk/outcome/
 *     decision/action) now routes + validates on both explain handlers;
 *   - for EMITTED chips it proves only the surface it actually exercises: the
 *     manually-maintained EMITTED_EXECUTABLE_ACTION_TYPES set, plus whatever the
 *     one real `tryPostAnalysisAdviceGate` emission path returns. It does NOT
 *     auto-derive the chip surface from source, so a new executable chip added
 *     in chip-generator.ts (or anywhere off the advice-gate path) will NOT fail
 *     this test unless EMITTED_EXECUTABLE_ACTION_TYPES is updated too. That set
 *     is the forcing function: any new target-bearing executable chip must be
 *     added there with explicit target-kind coverage (see the guardrail block).
 *
 * Validator-authority note: the graph-resolved kind cross-check (Point B) and
 * the existence check only run when a graph lookup is present — the normal
 * production path. On a graph-absent (frame-stage) turn the widened structural
 * gate alone admits a node proposal; that is acceptable ONLY because these two
 * handlers ignore the entity, and is bounded to them — it is not a general
 * validator bypass. The cases below exercise the graph-backed path so the
 * preserved authority is explicit.
 *
 * 'edge' is intentionally OUT of scope for this lane: the validator skips the
 * existence + kind cross-check for edges, so accepting 'edge' on a no-op
 * explain handler would have zero existence validation. Edge/link explanation
 * is a separate follow-up. 'edge' and 'constraint' therefore stay rejected.
 */

import { describe, it, expect } from 'vitest';

import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import type { EntityKind, ProposalAction, ProposalEntity } from '../types.js';
import { buildGraphLookup } from '../graph-lookup-adapter.js';
import { HANDLER_VALIDATION_REGISTRY } from '../validation-registry.js';
import { validateToolCall, type GraphLookup } from '../validator.js';
import {
  tryPostAnalysisAdviceGate,
  type AdviceGateAnalysis,
} from '../post-analysis-advice-gate.js';
import type { GraphPatchBlockData } from '../../../orchestrator/types.js';

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

// The two scenario-wide explanation handlers this lane widened.
// ⚠ ROADMAP 2.229 fix 2 — the line here used to read "what_would_flip is
// deliberately excluded (kept at ['goal', 'option'])". That exclusion was the
// remaining half of the P0 and has now been closed: what_would_flip accepts
// 'node' too. This constant still names only the two explain handlers because
// the per-handler cases below are written about THEM; what_would_flip's own
// kind coverage lives in tools/handlers/__tests__/what-would-flip.test.ts.
const EXPLAIN_HANDLERS = ['explain_results', 'explain_from_structure'] as const;

// Representative graph: goal + 2 options + one of each node class that
// collapses to wire-kind 'node' (decision / factor / outcome / risk / action —
// the full set `toEntityKind` maps to 'node' in graph-lookup-adapter.ts).
function mkGraph(): GraphStateIngress {
  const nodes = [
    { id: 'goal_1', kind: 'goal', label: 'Successful launch' },
    { id: 'opt_a', kind: 'option', label: 'Hire two senior engineers locally' },
    { id: 'opt_b', kind: 'option', label: 'Hire one senior engineer overseas' },
    { id: 'dec_1', kind: 'decision', label: 'Hiring decision' },
    { id: 'fac_churn', kind: 'factor', label: 'Customer churn' },
    { id: 'out_1', kind: 'outcome', label: 'Launch outcome' },
    { id: 'risk_1', kind: 'risk', label: 'Delivery risk' },
    { id: 'act_1', kind: 'action', label: 'Kick off hiring' },
  ];
  return { nodes, edges: [] } as unknown as GraphStateIngress;
}

function lookupFor(graph: GraphStateIngress): GraphLookup {
  const r = buildGraphLookup(graph);
  if (r.kind !== 'ok') throw new Error(`expected ok adapter result, got ${r.kind}`);
  return r.lookup;
}

const LOOKUP = lookupFor(mkGraph());

function mkProposal(
  handlerId: string,
  entity: { id: string; kind: EntityKind } & Partial<ProposalEntity>,
): ProposalAction {
  return {
    handler_id: handlerId,
    entity: {
      label: entity.id,
      resolution_status: 'resolved',
      resolution_method: 'id_match',
      ...entity,
    },
    parameters: [],
    cited_context_fields: [],
  };
}

// ---------------------------------------------------------------------------
// (a) Reproduction — the factor-centric dead-end, now fixed.
// ---------------------------------------------------------------------------
describe('chip routeability — factor-centric explanation now routes (reproduction fixed)', () => {
  for (const handlerId of EXPLAIN_HANDLERS) {
    it(`${handlerId}: a factor-node target routes and validates (was ENTITY_KIND_MISMATCH dead-end)`, () => {
      const result = validateToolCall(
        mkProposal(handlerId, { id: 'fac_churn', kind: 'node', label: 'Customer churn' }),
        LOOKUP,
        HANDLER_VALIDATION_REGISTRY,
      );
      expect(result.valid).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// (b) Node collapse — risk / outcome / decision all resolve to wire-kind node.
// ---------------------------------------------------------------------------
describe('chip routeability — risk/outcome/decision/action targets validate via node support', () => {
  const nodeTargets = [
    { id: 'dec_1', label: 'decision' },
    { id: 'out_1', label: 'outcome' },
    { id: 'risk_1', label: 'risk' },
    { id: 'act_1', label: 'action' },
  ] as const;
  for (const handlerId of EXPLAIN_HANDLERS) {
    for (const { id, label } of nodeTargets) {
      it(`${handlerId}: a ${label}-node target (wire-kind node) routes and validates`, () => {
        const result = validateToolCall(
          mkProposal(handlerId, { id, kind: 'node' }),
          LOOKUP,
          HANDLER_VALIDATION_REGISTRY,
        );
        expect(result.valid).toBe(true);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// (c) Regression — ordinary goal / option explanation still validates.
// ---------------------------------------------------------------------------
describe('chip routeability — ordinary goal/option explanation still validates', () => {
  for (const handlerId of EXPLAIN_HANDLERS) {
    it(`${handlerId}: a goal target still validates`, () => {
      const result = validateToolCall(
        mkProposal(handlerId, { id: 'goal_1', kind: 'goal' }),
        LOOKUP,
        HANDLER_VALIDATION_REGISTRY,
      );
      expect(result.valid).toBe(true);
    });
    it(`${handlerId}: an option target still validates`, () => {
      const result = validateToolCall(
        mkProposal(handlerId, { id: 'opt_a', kind: 'option' }),
        LOOKUP,
        HANDLER_VALIDATION_REGISTRY,
      );
      expect(result.valid).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// (d) Validator authority preserved — genuine ambiguity still fails SAFELY.
//     The fix makes valid emitted actions valid; it does not accept everything.
// ---------------------------------------------------------------------------
describe('chip routeability — genuine ambiguity still fails safely (authority preserved)', () => {
  for (const handlerId of EXPLAIN_HANDLERS) {
    it(`${handlerId}: an unresolved target still fails ENTITY_RESOLUTION_AMBIGUOUS (clarification, not accept)`, () => {
      const result = validateToolCall(
        mkProposal(handlerId, {
          id: 'fac_churn',
          kind: 'node',
          resolution_status: 'unresolved',
          resolution_method: 'kind_inference',
        }),
        LOOKUP,
        HANDLER_VALIDATION_REGISTRY,
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error.code).toBe('ENTITY_RESOLUTION_AMBIGUOUS');
    });

    it(`${handlerId}: a node id absent from the graph still fails ENTITY_NOT_FOUND`, () => {
      const result = validateToolCall(
        mkProposal(handlerId, { id: 'fac_ghost', kind: 'node' }),
        LOOKUP,
        HANDLER_VALIDATION_REGISTRY,
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error.code).toBe('ENTITY_NOT_FOUND');
    });

    // AMENDED 2026-07-27 (entity-kind repair). These two cases previously
    // asserted that a 'node'-labelled proposal aimed at a REAL option/goal id
    // was REFUSED, under the heading "graph cross-check authority". The graph
    // is still the authority — but authority now means its answer is ADOPTED,
    // not that a disagreement is fatal. Both explain handlers accept 'option'
    // and 'goal', so the correct outcome for a correctly-identified target is
    // to serve it with the kind the graph reports.
    //
    // The property the original tests were protecting — "neither can be
    // silently RETARGETED by a 'node' proposal" — is untouched and is asserted
    // directly below: the id never changes, and the handler is told what the
    // entity actually is. The refusal case that genuinely matters (a resolved
    // kind the handler cannot serve) is covered by `what_would_flip` in
    // entity-kind-repair.test.ts and by the constraint/edge cases below.
    it(`${handlerId}: kind 'node' aimed at a REAL option id is repaired to 'option', never retargeted`, () => {
      const result = validateToolCall(
        mkProposal(handlerId, { id: 'opt_a', kind: 'node' }),
        LOOKUP,
        HANDLER_VALIDATION_REGISTRY,
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.proposal.entity.id).toBe('opt_a');
        expect(result.proposal.entity.kind).toBe('option');
        expect(result.kind_repair?.proposed_kind).toBe('node');
        expect(result.kind_repair?.resolved_kind).toBe('option');
      }
    });

    it(`${handlerId}: kind 'node' aimed at a REAL goal id is repaired to 'goal', never retargeted`, () => {
      const result = validateToolCall(
        mkProposal(handlerId, { id: 'goal_1', kind: 'node' }),
        LOOKUP,
        HANDLER_VALIDATION_REGISTRY,
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.proposal.entity.id).toBe('goal_1');
        expect(result.proposal.entity.kind).toBe('goal');
        expect(result.kind_repair?.proposed_kind).toBe('node');
        expect(result.kind_repair?.resolved_kind).toBe('goal');
      }
    });

    it(`${handlerId}: a NARROWER handler still REFUSES a resolved kind it does not accept — repair does not widen the admit-set`, () => {
      // The control for the two amendments above. It used to be carried by
      // what_would_flip (then ['goal','option'], so a factor id was refused
      // however it was labelled) — ROADMAP 2.229 fix 2 widened that handler to
      // accept 'node', which would have left this control passing VACUOUSLY on
      // a handler that now admits the very kind it was asserting was refused.
      //
      // Re-anchored on `set_factor_value`, which accepts ONLY ['node']: a goal
      // id is refused no matter how the proposal labels it. If repair had
      // widened the admit-set rather than merely relabelling, the 'node' case
      // below (goal id proposed as 'node', repaired to 'goal') would pass.
      for (const proposed of ['node', 'goal', 'option'] as const) {
        const result = validateToolCall(
          mkProposal('set_factor_value', { id: 'goal_1', kind: proposed }),
          LOOKUP,
          HANDLER_VALIDATION_REGISTRY,
        );
        expect(result.valid, `set_factor_value must refuse goal_1 proposed as '${proposed}'`).toBe(false);
        if (!result.valid) expect(result.error.code).toBe('ENTITY_KIND_MISMATCH');
      }
    });

    // ROADMAP 2.229 fix 2 — the positive counterpart, in the same place the
    // old control sat, so the widening is visible where the exclusion was:
    // what_would_flip now serves a factor target instead of dead-ending.
    it(`${handlerId}: (sibling pin) what_would_flip now ROUTES a resolved factor target`, () => {
      for (const proposed of ['node'] as const) {
        const result = validateToolCall(
          mkProposal('what_would_flip', { id: 'fac_churn', kind: proposed }),
          LOOKUP,
          HANDLER_VALIDATION_REGISTRY,
        );
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.proposal.entity.id).toBe('fac_churn');
        }
      }
    });

    it(`${handlerId}: a constraint-kind target is still rejected with ENTITY_KIND_MISMATCH`, () => {
      const result = validateToolCall(
        mkProposal(handlerId, { id: 'c_1', kind: 'constraint' }),
        LOOKUP,
        HANDLER_VALIDATION_REGISTRY,
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error.code).toBe('ENTITY_KIND_MISMATCH');
    });

    it(`${handlerId}: an edge-kind target is still rejected (intentional edge gap for this lane)`, () => {
      const result = validateToolCall(
        mkProposal(handlerId, { id: 'e_1', kind: 'edge' }),
        LOOKUP,
        HANDLER_VALIDATION_REGISTRY,
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error.code).toBe('ENTITY_KIND_MISMATCH');
    });
  }
});

// ---------------------------------------------------------------------------
// (e) Emitted-chip routeability invariant.
//
// EMITTED_EXECUTABLE_ACTION_TYPES is a MANUALLY-MAINTAINED list of the
// action_type values V5 attaches to EXECUTABLE chips, observed today in
// compose/chip-generator.ts and routing/post-analysis-advice-gate.ts. It is
// NOT auto-derived from source — keep it in sync by hand. An executable chip
// carries no entity target; on click the target resolves to the scenario's
// goal or option, so each listed action_type must (1) be a registered handler
// and (2) accept both 'goal' and 'option'.
//
// What this proves / does NOT prove:
//   - PROVES: every action_type in the list routes to a handler that accepts
//     the goal/option a clicked chip resolves to; AND every chip the one real
//     `tryPostAnalysisAdviceGate` emission path returns is in the list and
//     validates when clicked (the drift guard below).
//   - DOES NOT prove: that the list is exhaustive of all emission sites. A new
//     executable chip added in chip-generator.ts, or added without updating
//     this list, will not be caught here unless it flows through the advice
//     gate. The list is the forcing function — a future target-bearing chip
//     (one resolving to a 'node' kind) MUST be added here with explicit
//     target-kind coverage and its handler must accept that kind.
// ---------------------------------------------------------------------------
const EMITTED_EXECUTABLE_ACTION_TYPES = [
  'run_analysis',
  'explain_results',
  'what_would_flip',
] as const;

describe('chip routeability — emitted executable chips route and validate when clicked', () => {
  for (const actionType of EMITTED_EXECUTABLE_ACTION_TYPES) {
    it(`"${actionType}" routes to a registered handler that accepts the goal/option it resolves to`, () => {
      const decl = HANDLER_VALIDATION_REGISTRY[actionType];
      expect(decl).toBeDefined();
      expect(decl?.accepted_entity_kinds).toContain('goal');
      expect(decl?.accepted_entity_kinds).toContain('option');
    });
  }

  // Ground the invariant in a REAL emission path: drive the post-analysis
  // advice gate, collect every executable chip it emits, and prove each one
  // validates as a proposal targeting the scenario goal — i.e. it routes and
  // validates when clicked. Guards against the action_type set above drifting.
  const FIXTURE_ANALYSIS: AdviceGateAnalysis = {
    status: 'success',
    leading_option: { label: 'Hire two senior engineers locally' },
    runner_up: { label: 'Hire one senior engineer overseas' },
    top_drivers: [{ factor_label: 'Delivery risk' }, { factor_label: 'Cost overrun risk' }],
    fragile_edges: [{ from_label: 'Delivery risk', to_label: 'Successful launch' }],
  };
  const READY_PAYLOAD_OPEN: AnalysisReadyPayload = {
    goal_node_id: 'goal_1',
    status: 'needs_user_mapping',
    options: [
      { option_id: 'opt_a', label: 'Hire two senior engineers locally', status: 'needs_user_mapping', interventions: {} },
      { option_id: 'opt_b', label: 'Hire one senior engineer overseas', status: 'needs_encoding', interventions: {} },
    ],
  };

  it('every executable chip emitted by the post-analysis advice gate validates when clicked (goal target)', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Tell me what to change.',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    const executable = out.suggested_actions.filter((a) => a.action_type != null);
    expect(executable.length).toBeGreaterThan(0);
    for (const chip of executable) {
      const actionType = chip.action_type as string;
      // drift guard — the emitted action_type is one this contract knows about
      expect(EMITTED_EXECUTABLE_ACTION_TYPES as readonly string[]).toContain(actionType);
      // routes + validates when clicked (resolves to the scenario goal)
      const result = validateToolCall(
        mkProposal(actionType, { id: 'goal_1', kind: 'goal' }),
        LOOKUP,
        HANDLER_VALIDATION_REGISTRY,
      );
      expect(result.valid, `clicked chip "${actionType}" should route and validate`).toBe(true);
    }
  });
});
