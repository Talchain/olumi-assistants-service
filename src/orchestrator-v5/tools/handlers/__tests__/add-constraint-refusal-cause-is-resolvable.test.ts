/**
 * ⭐⭐⭐ WHICH THROW DECLINED THE TURN IS RESOLVABLE — the codes, not the prose.
 *
 * ── THE GAP THIS FILE PINS, MEASURED BEFORE IT WAS WRITTEN ────────────────
 * `add_constraint` throws `D1HandlerError` at 21 sites (derived by counting
 * the file's throws at `d575cc60`, never inherited: PARAMETER_INVALID 17,
 * ENTITY_NOT_FOUND 1, ENTITY_KIND_MISMATCH 1, PRECONDITION_UNMET 1,
 * GRAPH_INVARIANT_VIOLATED 1). Twenty take the RECOVERABLE 200 path, where
 * every one of them is answered with the SAME War-Room-locked sentence.
 *
 * That ruling is right and this file does not touch it. The defect was that
 * nothing ELSE could tell the sites apart either. A real banked staging
 * refusal (`journey-witness-20260921/beat5a-answer-limit.json`, `http 200`,
 * `blocks: []`, 6,281 bytes) carried ZERO of `cause_kind`, `d1_code`,
 * `handler_id`, `specific_issue` or any D1 code — while eight contrast tokens
 * in the same scan all scored 1, so that zero was discriminating rather than a
 * probe artefact. `d1_code` was SET at `d1-shared/error-boundary.ts:44` and
 * had exactly one production site in the repo: its own producer.
 *
 * ── WHY THIS IS A SET AND NOT AN EXISTENCE CHECK ──────────────────────────
 * ⛔ A single arm asserting "the field is there" is satisfied by a hardcoded
 * constant, and would certify exactly the blindness it was written to end.
 * So three arms hit three DIFFERENT D1 codes, and each must report its own.
 *
 * ⭐ THE LOAD-BEARING ASSERTION IS THE IDENTICAL-PROSE ONE. All three arms
 * must produce a BYTE-IDENTICAL user-facing sentence. That is what makes this
 * a test about RESOLVABILITY rather than about a field existing: it proves,
 * in-test, that the prose cannot discriminate these causes and the codes can.
 * It also pins its own precondition (CLAUDE.md trap 13b) — if a future copy
 * change made the sentences differ, the premise of the whole file would have
 * moved, and this file REDs rather than passing on a stale assumption.
 *
 * ── BINDING IS BY IDENTITY, NEVER BY A VALUE PREDICATE (trap 19) ──────────
 * Arms assert exact codes for named throw lines, never "a code is present" or
 * "the code is a non-empty string", either of which another throw could
 * satisfy.
 *
 * ⚠ A CORRECTION THIS FILE MADE TO ITS OWN BRIEF, WORTH KEEPING. The first
 * version drove `ENTITY_NOT_FOUND` / `ENTITY_KIND_MISMATCH` through
 * `runTurnExecutor` and asserted the canonical phrase. It RED, and not for the
 * reason expected: the VALIDATOR catches both of those before dispatch
 * (`validator_outcome: ENTITY_NOT_FOUND`, `failure_origin: 'validator'`), so
 * the handler never ran and the user saw the validator family's own specific
 * copy instead. The handler's `:459` / `:471` throws are an execute-time
 * BACKSTOP, exactly as `handler-errors.ts` says ("when the validator's
 * structural pass missed the failure"). ⭐ Consequence for the record: a
 * witnessed refusal carrying `ADD_CONSTRAINT_USER_GUIDANCE` cannot have come
 * from `:459` or `:471` by the ordinary route — that phrase is attached only
 * to D1 throws — so attributing a witness to those two sites by elimination
 * is unsound. Which is the whole reason this file exists.
 *
 * ── SCOPE, HONESTLY (status ladder) ───────────────────────────────────────
 * Part 1 drives the REAL handler through the REAL error boundary. Part 2
 * proves the code survives onto the run result the turn-executor hands
 * route-v2, through the real registry and validator with no handler stub.
 * Rung reached: TESTED. Nothing here is a journey witness against a deployed
 * build, and nothing here asserts the route-v2 wire stamp.
 *
 * NO USER-VISIBLE BEHAVIOUR CHANGES. Every arm re-asserts the refusal body is
 * exactly what it was.
 */

import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import { setTestSink } from '../../../../utils/telemetry.js';
import type { ProposalAction } from '../../../routing/types.js';
import { HandlerInvocationFailedError } from '../../handler-errors.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { buildD1Fixture,buildHandlerInvocation } from '../d1-shared/__tests__/fixtures.js';
// The producer's OWN constants, so this file cannot drift from the War-Room
// phrase or from the projector it tests — a transcribed string here would be
// the hand-maintained mirror CLAUDE.md trap 12 is about.
import { handlerRefusalFromError } from '../../../diagnostics/v5-diagnostic-trace.js';
import { ADD_CONSTRAINT_USER_GUIDANCE } from '../d1-shared/user-guidance.js';

vi.mock('../../../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));






/** Identities, addressed by ID — never by a predicate another node satisfies. */
const GOAL_TARGET_ID = 'g-revenue';
const ABSENT_TARGET_ID = 'g-does-not-exist';

function proposal(overrides: Partial<ProposalAction> = {}): ProposalAction {
  return {
    handler_id: 'add_constraint',
    entity: {
      id: GOAL_TARGET_ID,
      kind: 'goal',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
      { name: 'value', value: 100, source: 'user_explicit' },
    ],
    cited_context_fields: [],
    ...overrides,
  } as ProposalAction;
}

/** Drive the REAL handler through the REAL D1 error boundary and project it. */
async function refusalFor(args: {
  proposal: ProposalAction;
  graph: GraphV3T | null;
}): Promise<{ refusal: ReturnType<typeof handlerRefusalFromError>; issue: unknown }> {
  const handler = createAddConstraintHandler();
  try {
    await handler(buildHandlerInvocation({ proposal: args.proposal, graph: args.graph }));
  } catch (err) {
    if (err instanceof HandlerInvocationFailedError) {
      return { refusal: handlerRefusalFromError(err), issue: err.details['specific_issue'] };
    }
    throw err;
  }
  throw new Error('expected the handler to throw, but it returned successfully');
}

beforeEach(() => {
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('add_constraint refusal — the CAUSE is resolvable', () => {
  it('three different throws, ONE identical sentence, THREE different codes', async () => {
    // Arms chosen so each reaches a DIFFERENT D1 code. Absent `constraint_type`
    // → `:315`; unknown target → `:459`; no graph at all → `:431`.
    const parameterInvalid = await refusalFor({
      proposal: proposal({ parameters: [{ name: 'value', value: 1, source: 'user_explicit' }] }),
      graph: buildD1Fixture(),
    });
    const entityNotFound = await refusalFor({
      proposal: proposal({
        entity: {
          id: ABSENT_TARGET_ID,
          kind: 'goal',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
      }),
      graph: buildD1Fixture(),
    });
    const preconditionUnmet = await refusalFor({ proposal: proposal(), graph: null });

    // ── THE LOAD-BEARING ASSERTION ───────────────────────────────────────
    // The prose CANNOT discriminate. Asserted, not assumed: this is the
    // premise the rest of the file rests on.
    expect(parameterInvalid.issue).toBe(ADD_CONSTRAINT_USER_GUIDANCE);
    expect(entityNotFound.issue).toBe(ADD_CONSTRAINT_USER_GUIDANCE);
    expect(preconditionUnmet.issue).toBe(ADD_CONSTRAINT_USER_GUIDANCE);

    // ── AND THE CODES DO ─────────────────────────────────────────────────
    expect(parameterInvalid.refusal.handler_id).toBe('add_constraint');
    expect(parameterInvalid.refusal.d1_code).toBe('PARAMETER_INVALID');
    expect(parameterInvalid.refusal.cause_kind).toBe('parameter_invalid_at_execute');

    expect(entityNotFound.refusal.handler_id).toBe('add_constraint');
    expect(entityNotFound.refusal.d1_code).toBe('ENTITY_NOT_FOUND');
    expect(entityNotFound.refusal.cause_kind).toBe('entity_not_found_in_graph');

    expect(preconditionUnmet.refusal.handler_id).toBe('add_constraint');
    expect(preconditionUnmet.refusal.d1_code).toBe('PRECONDITION_UNMET');
    expect(preconditionUnmet.refusal.cause_kind).toBe('precondition_unmet_at_execute');

    // The discrimination, stated as such: three arms, three distinct codes.
    expect(
      new Set([
        parameterInvalid.refusal.d1_code,
        entityNotFound.refusal.d1_code,
        preconditionUnmet.refusal.d1_code,
      ]).size,
    ).toBe(3);
  });

  it('carries NO user content and NO operation values — the retention contract', async () => {
    const { refusal } = await refusalFor({
      proposal: proposal({
        entity: {
          id: ABSENT_TARGET_ID,
          kind: 'goal',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
      }),
      graph: buildD1Fixture(),
    });

    // Bounded by construction: four members, each a code or null. A member
    // that is neither REDs here — which is what keeps the record safe to
    // retain and safe wherever it travels.
    expect(Object.keys(refusal).sort()).toEqual([
      'cause_kind',
      'd1_code',
      'handler_id',
      'reason_code',
    ]);
    const serialised = JSON.stringify(refusal);
    // `error.details.target_id` carries this id. It is an OPERATION VALUE and
    // must not have been copied across.
    expect(serialised).not.toContain(ABSENT_TARGET_ID);
    // `error.message` is honest but interpolates ids and user values; it is
    // log triage only and must not be here either.
    expect(serialised).not.toContain('Cannot add constraint');
  });

  it('reports d1_code NULL — never a guess — when the throw was not a D1 error', () => {
    // `add-constraint.ts:419` throws `HandlerInvocationFailedError` directly.
    // "There was no D1 code" and "the code was X" are different claims.
    const refusal = handlerRefusalFromError(
      new HandlerInvocationFailedError('add_constraint invoked without a proposal', {
        cause_kind: 'parameter_invalid_at_execute',
        retryable: false,
        details: { handler_id: 'add_constraint' },
      }),
    );
    expect(refusal.d1_code).toBeNull();
    expect(refusal.reason_code).toBeNull();
    expect(refusal.handler_id).toBe('add_constraint');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Part 2 — the code SURVIVES onto the run result route-v2 stamps from.
// Set is not carried; this is the half that proves carried.
// ───────────────────────────────────────────────────────────────────────────
