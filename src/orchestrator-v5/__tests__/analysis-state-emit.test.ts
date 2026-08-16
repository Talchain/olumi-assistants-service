/**
 * ANALYSIS-STATE AUTHORITY, STEP 3 — `analysis_state` (AnalysisStateV1) on the wire.
 *
 * These tests are written RED-FIRST against the OBSERVABLE wire behaviour of
 * `finaliseV5Response`, not against the composer's internals, because the claim
 * the step makes is a claim about what a consumer receives. At the PR base
 * every assertion below fails with `analysis_state` undefined; that is the
 * signature this file exists to flip.
 *
 * BINDING BY IDENTITY (trap 19). Every assertion names its object — a run-state
 * `kind`, a `factor_id`, a `withheld_reason` code — never a value predicate
 * another object could satisfy. The blocker assertions in particular match on
 * `factor_id`, never on message text, because two blockers on one turn can
 * share a message and differ in scope.
 *
 * THE DISCRIMINATING PAIRS, stated so a reviewer can check them rather than
 * take them on trust:
 *   * `refused` vs `blocked` — the two states a naive implementation collapses.
 *     A mutant mapping `refused` onto `blocked` must RED the two refusal tests
 *     and leave the genuinely-blocked test GREEN. Both directions are asserted.
 *   * `refused` on a derivation the clamp EARLY-RETURNS (already stale/unknown).
 *     This is the case a reason-string sniffer cannot see, and it is the reason
 *     the refusal signal is carried explicitly rather than inferred from
 *     `freshness_reason`. An implementation that reads only the reason passes
 *     the first refusal test and REDs this one.
 *   * `leader_claim.permitted` — the CONJUNCTION. Entitlement-only and
 *     separation-only implementations each pass half the matrix; all four cells
 *     are asserted.
 */

import { describe, it, expect } from 'vitest';
import { OlumiResponseSchema, AnalysisStateV1Schema } from '@talchain/schemas/boundary';
import type { OlumiResponse } from '@talchain/schemas/boundary';

import { finaliseV5Response } from '../response-finaliser.js';
import {
  clampRefusalFreshness,
  type AnalysisReadyPayload,
} from '../compose/analysis-ready-emit.js';
import type { FreshnessDerivation } from '../context/freshness.js';
import { BASE_FINALISED_HEALTHY_TURN } from './__fixtures__/base-finalised-healthy-turn.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────

function freshDerivation(): FreshnessDerivation {
  return {
    freshness: 'fresh',
    reason: 'graph_hash_match',
    selected_fact_index: 0,
    graph_hash_at_run: 'hash_abc',
    current_graph_hash: 'hash_abc',
    computed_at: '2026-08-16T12:00:00.000Z',
  };
}

function staleDerivation(
  reason: FreshnessDerivation['reason'] = 'graph_hash_diverged',
): FreshnessDerivation {
  return {
    freshness: 'stale',
    reason,
    selected_fact_index: 0,
    graph_hash_at_run: 'hash_abc',
    current_graph_hash: 'hash_xyz',
    computed_at: '2026-08-16T12:00:00.000Z',
  };
}

function noRunDerivation(): FreshnessDerivation {
  return {
    freshness: 'none',
    reason: 'no_successful_run_analysis_fact',
    selected_fact_index: null,
    graph_hash_at_run: null,
    current_graph_hash: 'hash_abc',
    computed_at: null,
  };
}

function unknownDerivation(
  reason: FreshnessDerivation['reason'],
): FreshnessDerivation {
  return {
    freshness: 'unknown',
    reason,
    selected_fact_index: 0,
    graph_hash_at_run: null,
    current_graph_hash: 'hash_abc',
    computed_at: '2026-08-16T12:00:00.000Z',
  };
}

function readyPayload(): AnalysisReadyPayload {
  return {
    status: 'ready',
    goal_node_id: 'goal_productivity',
    options: [
      {
        option_id: 'opt_status_quo',
        label: 'Status quo',
        status: 'ready',
        interventions: { fac_headcount: 0 },
        is_baseline: true,
      },
    ],
  };
}

function blockedPayload(): AnalysisReadyPayload {
  return {
    status: 'blocked',
    blocked_reason: 'model_structure_invalid',
    goal_node_id: 'goal_productivity',
    options: [],
    blockers: [
      {
        option_id: 'opt_tech_lead',
        option_label: 'Hire a tech lead',
        factor_id: 'fac_headcount',
        factor_label: 'Headcount',
        blocker_type: 'missing_value',
        message: 'legacy message the contract does not carry',
        suggested_action: 'add_value',
      },
      {
        factor_id: 'fac_role_type',
        factor_label: 'Role type',
        blocker_type: 'missing_connection',
        message: 'legacy message the contract does not carry',
        suggested_action: 'add_edge',
      },
    ],
  } as AnalysisReadyPayload;
}

function refusalPayload(): AnalysisReadyPayload {
  // The exact shape `buildAnalysisRefusalReadiness` produces.
  return {
    options: [],
    goal_node_id: '',
    status: 'blocked',
    blocked_reason: 'parameter_invalid_at_execute',
  };
}

interface ResponseOpts {
  readonly robustnessLevel?: string;
  readonly nearTieIsTie?: boolean;
  readonly withAnalysisBlock?: boolean;
}

function baseResponse(opts: ResponseOpts = {}): OlumiResponse {
  const withBlock = opts.withAnalysisBlock !== false;
  return {
    response_version: 2,
    assistant_text: 'A comparison of the options.',
    stage_indicator: 'analyse',
    blocks: withBlock
      ? [
          {
            // The WIRE block shape (`type`, not the CEE-internal `block_type`)
            // — derived from OlumiResponseSchema, so the conformance tests
            // below exercise a body the strict schema actually accepts rather
            // than passing vacuously on a body it rejects for an unrelated
            // reason.
            type: 'analysis_result',
            summary: 'Comparison complete',
            leading_option_id: 'opt_tech_lead',
            enrichment: {
              robustness: {
                ...(opts.robustnessLevel !== undefined
                  ? { level: opts.robustnessLevel }
                  : {}),
                near_tie: { is_tie: opts.nearTieIsTie === true },
              },
            },
          },
        ]
      : [],
    suggested_actions: [],
    insights: [],
  } as unknown as OlumiResponse;
}

type FinaliserCtx = Parameters<typeof finaliseV5Response>[1];

function finalise(
  response: OlumiResponse,
  ctx: {
    analysisReady?: AnalysisReadyPayload;
    freshness?: FreshnessDerivation;
    mayNameLeadingOption?: boolean;
  },
): Record<string, unknown> {
  return finaliseV5Response(response, ctx as FinaliserCtx) as unknown as Record<
    string,
    unknown
  >;
}

function stateOf(body: Record<string, unknown>): Record<string, unknown> {
  const state = body.analysis_state;
  expect(state, 'analysis_state must be present on this turn').toBeDefined();
  return state as Record<string, unknown>;
}

function runStateOf(body: Record<string, unknown>): Record<string, unknown> {
  return stateOf(body).run_state as Record<string, unknown>;
}


// ─── The cross-tree capture's inputs, kept byte-identical to
//     `scripts/capture-finalised-healthy-turn.ts`. The script is what was run
//     on the PR base to produce `BASE_FINALISED_HEALTHY_TURN`; these mirror it
//     so the in-suite comparison is against the same input, not a lookalike.
//     A drift between the two shows up immediately as a failed deep-equal.

function captureInputReadiness(): AnalysisReadyPayload {
  return {
    status: 'ready',
    goal_node_id: 'goal_productivity',
    options: [
      {
        option_id: 'opt_status_quo',
        label: 'Make No New Hire (Status Quo)',
        status: 'ready',
        interventions: { fac_role_type: 0, fac_headcount: 0 },
        is_baseline: true,
      },
      {
        option_id: 'opt_tech_lead',
        label: 'Hire a Tech Lead',
        status: 'ready',
        interventions: { fac_role_type: 1, fac_headcount: 0.2 },
      },
    ],
  };
}

function captureInputFreshness(): FreshnessDerivation {
  return {
    freshness: 'fresh',
    reason: 'graph_hash_match',
    selected_fact_index: 0,
    graph_hash_at_run: 'abc123',
    current_graph_hash: 'abc123',
    computed_at: '2026-08-16T12:00:00.000Z',
  };
}

function captureInputResponse(): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: 'Hiring a tech lead scores highest on the modelled goal.',
    stage_indicator: 'analyse',
    blocks: [
      {
        type: 'analysis_result',
        summary: 'Comparison complete',
        leading_option_id: 'opt_tech_lead',
        enrichment: {
          robustness: {
            level: 'high',
            near_tie: { is_tie: false, gap: 0.19 },
          },
        },
      },
    ],
    suggested_actions: [],
    insights: [],
  } as unknown as OlumiResponse;
}

// ─── run_state — the seven-branch verdict ─────────────────────────────────

describe('analysis_state.run_state', () => {
  it('emits kind=complete_current with the selected fact timestamp on a fresh turn', () => {
    const body = finalise(baseResponse(), {
      analysisReady: readyPayload(),
      freshness: freshDerivation(),
      mayNameLeadingOption: true,
    });
    expect(runStateOf(body)).toEqual({
      kind: 'complete_current',
      computed_at: '2026-08-16T12:00:00.000Z',
    });
  });

  it('emits kind=complete_stale with cause=graph_changed when the graph hash diverged', () => {
    const body = finalise(baseResponse(), {
      analysisReady: readyPayload(),
      freshness: staleDerivation('graph_hash_diverged'),
      mayNameLeadingOption: true,
    });
    expect(runStateOf(body)).toEqual({
      kind: 'complete_stale',
      computed_at: '2026-08-16T12:00:00.000Z',
      cause: 'graph_changed',
    });
  });

  it('emits cause=options_changed — NOT graph_changed — when the analysed options diverged', () => {
    // The two causes carry different remedies; collapsing them to one "stale"
    // loses the only thing a consumer could act on.
    const body = finalise(baseResponse(), {
      analysisReady: readyPayload(),
      freshness: staleDerivation('analysed_options_diverged'),
      mayNameLeadingOption: true,
    });
    expect(runStateOf(body).cause).toBe('options_changed');
  });

  it('emits kind=never_run when no successful analysis fact exists', () => {
    const body = finalise(baseResponse({ withAnalysisBlock: false }), {
      analysisReady: readyPayload(),
      freshness: noRunDerivation(),
      mayNameLeadingOption: true,
    });
    expect(runStateOf(body)).toEqual({ kind: 'never_run' });
  });

  it.each([
    ['derivation_failed', 'store_unreadable'],
    ['invariant_failed', 'store_unreadable'],
    ['legacy_fact_missing_hash', 'legacy_fact'],
    ['current_graph_hash_unavailable', 'no_graph_this_turn'],
  ] as const)(
    'maps unknown freshness reason %s to unknown_degraded cause %s',
    (reason, cause) => {
      const body = finalise(baseResponse(), {
        analysisReady: readyPayload(),
        freshness: unknownDerivation(reason),
        mayNameLeadingOption: true,
      });
      expect(runStateOf(body)).toEqual({ kind: 'unknown_degraded', cause });
    },
  );

  it('emits kind=blocked with the payload reason when the MODEL is unanalysable', () => {
    const body = finalise(baseResponse({ withAnalysisBlock: false }), {
      analysisReady: blockedPayload(),
      freshness: noRunDerivation(),
      mayNameLeadingOption: false,
    });
    const runState = runStateOf(body);
    expect(runState.kind).toBe('blocked');
    expect(runState.reason_code).toBe('model_structure_invalid');
  });
});

// ─── refused — the new state, and the pair that discriminates it ──────────

describe('analysis_state.run_state — the refused state', () => {
  it('emits kind=refused, never blocked, when THIS TURN declined to analyse', () => {
    const body = finalise(baseResponse({ withAnalysisBlock: false }), {
      analysisReady: refusalPayload(),
      freshness: clampRefusalFreshness(freshDerivation()),
      mayNameLeadingOption: false,
    });
    const runState = runStateOf(body);
    expect(runState.kind).toBe('refused');
    expect(runState.reason_code).toBe('parameter_invalid_at_execute');
  });

  it('carries NO timestamp on a refusal — the branch declines to make a currency claim', () => {
    const body = finalise(baseResponse({ withAnalysisBlock: false }), {
      analysisReady: refusalPayload(),
      freshness: clampRefusalFreshness(freshDerivation()),
      mayNameLeadingOption: false,
    });
    expect('computed_at' in runStateOf(body)).toBe(false);
  });

  it('emits kind=refused even when the clamp EARLY-RETURNS on an already-stale derivation', () => {
    // The discriminating case. `clampRefusalFreshness` returns a stale/unknown
    // derivation untouched, so its `reason` is NOT the refusal reason — an
    // implementation that sniffs `freshness_reason` reports `complete_stale`
    // here and the product goes on vouching for a result this turn refused to
    // stand behind.
    const clamped = clampRefusalFreshness(staleDerivation());
    expect(clamped.reason).toBe('graph_hash_diverged'); // precondition, pinned in-test
    const body = finalise(baseResponse({ withAnalysisBlock: false }), {
      analysisReady: refusalPayload(),
      freshness: clamped,
      mayNameLeadingOption: false,
    });
    expect(runStateOf(body).kind).toBe('refused');
  });

  it('does NOT emit refused for a genuinely blocked model (the other half of the pair)', () => {
    const body = finalise(baseResponse({ withAnalysisBlock: false }), {
      analysisReady: blockedPayload(),
      freshness: noRunDerivation(),
      mayNameLeadingOption: false,
    });
    expect(runStateOf(body).kind).toBe('blocked');
  });
});

// ─── readiness ────────────────────────────────────────────────────────────

describe('analysis_state.readiness', () => {
  it('carries the producer status verbatim', () => {
    const body = finalise(baseResponse(), {
      analysisReady: readyPayload(),
      freshness: freshDerivation(),
      mayNameLeadingOption: true,
    });
    expect((stateOf(body).readiness as Record<string, unknown>).status).toBe('ready');
  });

  it('maps each wire blocker to a contract blocker, preserving per-factor scope BY ID', () => {
    const body = finalise(baseResponse({ withAnalysisBlock: false }), {
      analysisReady: blockedPayload(),
      freshness: noRunDerivation(),
      mayNameLeadingOption: false,
    });
    const readiness = stateOf(body).readiness as {
      blockers: Array<Record<string, unknown>>;
    };
    expect(readiness.blockers).toHaveLength(2);

    const headcount = readiness.blockers.find((b) => b.factor_id === 'fac_headcount');
    expect(headcount, 'the fac_headcount blocker must survive the mapping').toBeDefined();
    expect(headcount).toMatchObject({
      code: 'MISSING_OPTION_VALUE',
      category: 'option_values',
      repairability: 'human_input_required',
      option_id: 'opt_tech_lead',
      option_label: 'Hire a tech lead',
      factor_id: 'fac_headcount',
      factor_label: 'Headcount',
    });

    const roleType = readiness.blockers.find((b) => b.factor_id === 'fac_role_type');
    expect(roleType, 'the fac_role_type blocker must survive the mapping').toBeDefined();
    expect(roleType).toMatchObject({
      code: 'MISSING_OPTION_CONNECTION',
      category: 'option_mapping',
      factor_id: 'fac_role_type',
    });
    // ABSENCE IS DISTINCT: this blocker is not option-scoped, so the key must
    // be absent rather than empty.
    expect('option_id' in (roleType as object)).toBe(false);
  });

  it('emits an EMPTY blocker list — a positive "nothing is blocking" claim — on a ready model', () => {
    const body = finalise(baseResponse(), {
      analysisReady: readyPayload(),
      freshness: freshDerivation(),
      mayNameLeadingOption: true,
    });
    expect((stateOf(body).readiness as { blockers: unknown[] }).blockers).toEqual([]);
  });
});

// ─── leader_claim — the conjunction, all four cells ───────────────────────

describe('analysis_state.leader_claim', () => {
  it('permitted=true only when the CEE entitlement holds AND the options separate', () => {
    const body = finalise(baseResponse({ robustnessLevel: 'high', nearTieIsTie: false }), {
      analysisReady: readyPayload(),
      freshness: freshDerivation(),
      mayNameLeadingOption: true,
    });
    const claim = stateOf(body).leader_claim as Record<string, unknown>;
    expect(claim.permitted).toBe(true);
    expect('withheld_reason' in claim).toBe(false);
    expect(claim.separation).toBe('separated');
  });

  it('permitted=false with withheld_reason=options_do_not_separate on a near tie', () => {
    const body = finalise(baseResponse({ robustnessLevel: 'low', nearTieIsTie: true }), {
      analysisReady: readyPayload(),
      freshness: freshDerivation(),
      mayNameLeadingOption: true,
    });
    const claim = stateOf(body).leader_claim as Record<string, unknown>;
    expect(claim.permitted).toBe(false);
    expect(claim.withheld_reason).toBe('options_do_not_separate');
    expect(claim.separation).toBe('near_tie');
  });

  it('permitted=false with withheld_reason=constraint_verdict_withheld when CEE withheld it', () => {
    const body = finalise(baseResponse({ robustnessLevel: 'high', nearTieIsTie: false }), {
      analysisReady: readyPayload(),
      freshness: freshDerivation(),
      mayNameLeadingOption: false,
    });
    const claim = stateOf(body).leader_claim as Record<string, unknown>;
    expect(claim.permitted).toBe(false);
    expect(claim.withheld_reason).toBe('constraint_verdict_withheld');
  });

  it('permitted=false with withheld_reason=separation_unavailable when no separation was computed', () => {
    // FAIL-CLOSED. The contract defines `permitted` as a conjunction that is
    // true only when BOTH halves hold; an unknown statistical half is not a
    // held half. ABSENCE IS DISTINCT — `separation` is omitted, never
    // fabricated as "no separation".
    const body = finalise(baseResponse({ withAnalysisBlock: false }), {
      analysisReady: readyPayload(),
      freshness: freshDerivation(),
      mayNameLeadingOption: true,
    });
    const claim = stateOf(body).leader_claim as Record<string, unknown>;
    expect(claim.permitted).toBe(false);
    expect(claim.withheld_reason).toBe('separation_unavailable');
    expect('separation' in claim).toBe(false);
  });
});

// ─── robustness — two named fields, and one honest absence ───────────────

describe('analysis_state.robustness', () => {
  it('carries the engine aggregate level when the turn computed one', () => {
    const body = finalise(baseResponse({ robustnessLevel: 'high' }), {
      analysisReady: readyPayload(),
      freshness: freshDerivation(),
      mayNameLeadingOption: true,
    });
    expect((stateOf(body).robustness as Record<string, unknown>).aggregate_level).toBe(
      'high',
    );
  });

  it('OMITS aggregate_level when nothing computed one — absent is not "not robust"', () => {
    const body = finalise(baseResponse({ withAnalysisBlock: false }), {
      analysisReady: readyPayload(),
      freshness: freshDerivation(),
      mayNameLeadingOption: true,
    });
    expect('aggregate_level' in (stateOf(body).robustness as object)).toBe(false);
  });

  it('DISCLOSED LIMIT — factors_that_flip_leader is never emitted at step 3', () => {
    // Absent means "the flip analysis was NOT COMPUTED"; `[]` would mean it was
    // computed and nothing flips. The only flip evidence reachable at this seam
    // is keyed by factor LABEL, and the contract requires IDs, so emitting
    // either value would be a fabricated finding. This test pins the gap so it
    // is visible in a green suite rather than assumed closed; it REDs if a
    // later change starts emitting the field without an id-bearing producer.
    for (const opts of [{ robustnessLevel: 'high' }, { withAnalysisBlock: false }]) {
      const body = finalise(baseResponse(opts), {
        analysisReady: readyPayload(),
        freshness: freshDerivation(),
        mayNameLeadingOption: true,
      });
      expect('factors_that_flip_leader' in (stateOf(body).robustness as object)).toBe(
        false,
      );
    }
  });
});

// ─── the composed predicates — producer of record, not re-derived ────────

describe('analysis_state usability predicates and contradictions', () => {
  it('a fresh, ready run is usable for prose, chips and follow-up, with no rerun', () => {
    const state = stateOf(
      finalise(baseResponse(), {
        analysisReady: readyPayload(),
        freshness: freshDerivation(),
        mayNameLeadingOption: true,
      }),
    );
    expect(state.usable_for_prose).toBe(true);
    expect(state.usable_for_chips).toBe(true);
    expect(state.usable_for_followup).toBe(true);
    expect(state.requires_rerun).toBe(false);
    expect(state.blocked_unusable).toBe(false);
    expect(state.contradictions).toEqual([]);
  });

  it('a stale run drops CHIPS ONLY and asks for a rerun — the predicates are not one flag', () => {
    const state = stateOf(
      finalise(baseResponse(), {
        analysisReady: readyPayload(),
        freshness: staleDerivation(),
        mayNameLeadingOption: true,
      }),
    );
    expect(state.usable_for_prose).toBe(true);
    expect(state.usable_for_chips).toBe(false);
    expect(state.usable_for_followup).toBe(true);
    expect(state.requires_rerun).toBe(true);
  });

  it('a blocked model is unusable for every purpose', () => {
    const state = stateOf(
      finalise(baseResponse({ withAnalysisBlock: false }), {
        analysisReady: blockedPayload(),
        freshness: noRunDerivation(),
        mayNameLeadingOption: false,
      }),
    );
    expect(state.blocked_unusable).toBe(true);
    expect(state.usable_for_prose).toBe(false);
    expect(state.usable_for_chips).toBe(false);
  });

  it('reports the producer\'s OWN detected contradiction rather than resolving it by guess', () => {
    // `status: 'ready'` carrying actionable blockers is a should-never-happen
    // integrity violation the canonical verdict already detects. The wire must
    // carry it, not silently pick a side.
    const contradictory = {
      ...readyPayload(),
      blockers: [
        {
          factor_id: 'fac_headcount',
          factor_label: 'Headcount',
          blocker_type: 'missing_value',
          message: 'x',
          suggested_action: 'add_value',
        },
      ],
    } as AnalysisReadyPayload;
    const state = stateOf(
      finalise(baseResponse(), {
        analysisReady: contradictory,
        freshness: freshDerivation(),
        mayNameLeadingOption: true,
      }),
    );
    expect(state.contradictions).toContain('status_ready_with_actionable_blockers');
  });
});

// ─── contract conformance + the additive guarantee ───────────────────────

describe('analysis_state contract conformance', () => {
  const cases: Array<[string, Parameters<typeof finalise>[1], ResponseOpts]> = [
    [
      'fresh',
      { analysisReady: readyPayload(), freshness: freshDerivation(), mayNameLeadingOption: true },
      { robustnessLevel: 'high' },
    ],
    [
      'stale',
      { analysisReady: readyPayload(), freshness: staleDerivation(), mayNameLeadingOption: true },
      {},
    ],
    [
      'never_run',
      { analysisReady: readyPayload(), freshness: noRunDerivation(), mayNameLeadingOption: true },
      { withAnalysisBlock: false },
    ],
    [
      'blocked',
      { analysisReady: blockedPayload(), freshness: noRunDerivation(), mayNameLeadingOption: false },
      { withAnalysisBlock: false },
    ],
    [
      'refused',
      {
        analysisReady: refusalPayload(),
        freshness: clampRefusalFreshness(freshDerivation()),
        mayNameLeadingOption: false,
      },
      { withAnalysisBlock: false },
    ],
    [
      'unknown_degraded',
      {
        analysisReady: readyPayload(),
        freshness: unknownDerivation('legacy_fact_missing_hash'),
        mayNameLeadingOption: true,
      },
      {},
    ],
  ];

  it.each(cases)('%s state parses against AnalysisStateV1Schema', (_name, ctx, opts) => {
    const body = finalise(baseResponse(opts), ctx);
    expect(() => AnalysisStateV1Schema.parse(stateOf(body))).not.toThrow();
  });

  it.each(cases)('%s response parses against the strict OlumiResponseSchema', (_name, ctx, opts) => {
    const body = finalise(baseResponse(opts), ctx);
    expect(() => OlumiResponseSchema.parse(body)).not.toThrow();
  });
});

describe('additive on the wire', () => {
  // The load-bearing control is CROSS-TREE: `BASE_FINALISED_HEALTHY_TURN` was
  // measured on a separate clone at the PR base (staging `bacf35d5`, schemas
  // 0.44.0) — a tree containing neither the vendor bump nor the emission. A
  // same-tree comparison could only show this lane agreeing with itself.
  function captureHeadBody(): Record<string, unknown> {
    const finalised = finaliseV5Response(
      captureInputResponse(),
      {
        analysisReady: captureInputReadiness(),
        freshness: captureInputFreshness(),
        mayNameLeadingOption: true,
      } as FinaliserCtx,
    );
    const body = JSON.parse(JSON.stringify(finalised)) as Record<string, unknown>;
    const ready = body.analysis_ready as Record<string, unknown> | undefined;
    if (ready && typeof ready.computed_at === 'string') ready.computed_at = '<normalised>';
    return body;
  }

  it('the head body MINUS analysis_state equals the body measured on the PR base', () => {
    const head = captureHeadBody();
    expect(head.analysis_state, 'this turn must emit the new key').toBeDefined();
    const { analysis_state: _new, ...rest } = head;
    expect(rest).toEqual(BASE_FINALISED_HEALTHY_TURN);
  });

  it('POSITIVE CONTROL — the comparison can see a one-character difference', () => {
    // Without this, a deep-equal that silently compared two empty objects, or
    // an assertion pointed at the wrong value, would pass by testing nothing.
    const mutated = {
      ...BASE_FINALISED_HEALTHY_TURN,
      assistant_text: `${String(BASE_FINALISED_HEALTHY_TURN.assistant_text)}!`,
    };
    expect(mutated).not.toEqual(BASE_FINALISED_HEALTHY_TURN);
  });

  it('adds exactly ONE top-level key relative to the PR base', () => {
    const head = captureHeadBody();
    expect(Object.keys(head).sort()).toEqual(
      [...Object.keys(BASE_FINALISED_HEALTHY_TURN), 'analysis_state'].sort(),
    );
  });

  it('the internal refusal flag never reaches the wire', () => {
    // `refusal_declared` rides the freshness derivation, which is stamped onto
    // `analysis_ready` by `attachComputedAt`. That stamper reads NAMED members,
    // so the flag cannot leak — asserted rather than argued.
    const body = finalise(baseResponse({ withAnalysisBlock: false }), {
      analysisReady: refusalPayload(),
      freshness: clampRefusalFreshness(freshDerivation()),
      mayNameLeadingOption: false,
    });
    expect(JSON.stringify(body)).not.toContain('refusal_declared');
  });

  it('omits analysis_state entirely when the producer has no verdict to supply', () => {
    // Absence is a first-class state in the contract — "no verdict was
    // supplied" — and it is what a dispatch path with no analysis context
    // must emit rather than a fabricated default.
    const body = finalise(baseResponse({ withAnalysisBlock: false }), {});
    expect('analysis_state' in body).toBe(false);
  });
});
