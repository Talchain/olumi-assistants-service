/**
 * SELECTION-AWARE ANSWERING (hop 4b) — `_grounded_selection` ON THE TRUE WIRE.
 *
 * The executor suite proves the field reaches `TurnExecutorRunResult`. That is
 * a different claim from "the user's browser receives it": between the two sit
 * the dispatch ctx thread, a defensive strip, strict `OlumiResponseSchema`
 * egress validation, the claim-safety wire gate and the Layer-3 egress scan.
 * `OlumiResponseSchema` is `.strict()`, so an undeclared root key does not
 * merely go missing — it FAILS validation and drops the whole turn to the
 * typed fallback envelope. The strip → validate → re-attach mechanic exists
 * precisely to stop that, and it is only observable HERE.
 *
 * So these tests drive the REAL route (`app.inject` through
 * `/orchestrate/v2/turn`, the harness from `route-v2-answer-shape-fallback
 * .test.ts`) with `runTurnExecutor` mocked, and read the HTTP RESPONSE BODY.
 *
 * WHAT IS PINNED, AND WHY EACH ONE EXISTS
 * ---------------------------------------
 *  1. THE FIELD ARRIVES — exact ids, exact `unresolved`, on the 200 body.
 *
 *  2. ⭐ INERTNESS — "no reader ⇒ no behaviour change". The SAME mocked turn is
 *     run twice, once with `groundedSelection` on the run result and once
 *     without, and the two bodies are asserted IDENTICAL apart from that single
 *     key. This is the whole basis on which an un-consumed sidecar ships
 *     unconditionally: if the field could perturb anything else on the wire, it
 *     would not be inert and it would need a flag.
 *
 *  3. ABSENCE IS A MISSING KEY — never `null`, never a present-but-undefined
 *     key. Asserted with `'_grounded_selection' in body === false`, because
 *     `toBeUndefined()` cannot tell those two apart and the byte-identity claim
 *     rests on the difference.
 *
 *  4. THE RE-ATTACH BLOCK IS THE SOLE AUTHORITY — a `_grounded_selection` the
 *     executor illegally attached to `response` is STRIPPED and never reaches
 *     the wire, and when both are present the ctx-threaded value WINS. Without
 *     the pair, the strip test could pass because nothing ever attaches.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const configHolder = {
  cee: {
    timingDebugEnabled: false,
    turnDebugEnabled: false,
    contextSummaryEnabled: false,
    coachingStatePackEnabled: false,
  },
  features: {
    optionShortcutRepair: true,
    diagnosticTraceEnabled: false,
    reasoningCaptureEnabled: false,
  },
};
vi.mock('../../../src/config/index.js', () => ({
  config: configHolder,
  isProduction: () => false,
}));

const runTurnExecutorMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: runTurnExecutorMock,
}));

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';

const FACTOR_ID = 'factor_salary';
const OPTION_ID = 'opt_local';

/**
 * A SINGLE-SENTENCE answer on purpose: the F1 egress synthesiser only shapes
 * multi-sentence prose, so this body carries no `_answer_shape` and the
 * inertness comparison below is not confounded by a second sidecar.
 */
const ANSWER = 'Salary is the dominant driver here.';

/**
 * A successful substantive run result. `groundedSelection` and any illegal
 * body-attached sidecar are supplied per-test, so every arm differs from every
 * other in exactly one declared way.
 */
function mkRun(
  runExtra: Record<string, unknown> = {},
  responseExtra: Record<string, unknown> = {},
) {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: ANSWER,
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
      ...responseExtra,
    },
    analysisReady: { status: 'ready', goal_node_id: 'goal', options: [] },
    effectiveGraph: null,
    answerKind: 'substantive' as const,
    telemetry: {
      stages_completed: ['orient', 'compose'],
      response_emitted: true as const,
      llm_calls_used: 1,
      commit_performed: true,
      failure_type: null,
      wall_clock_ms: 5,
      turn_class: 'explore',
      intent_class: 'converse',
      coaching_mode: 'reframe',
      validation_error_code: null,
    },
    ...runExtra,
  };
}

async function postTurn(app: FastifyInstance, turnId: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: turnId,
      scenario_id: SCENARIO_ID,
      stage: 'analyse',
      message: 'What should I do next?',
      turn_class: 'decide',
      source: 'composer',
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

describe('route-v2 — `_grounded_selection` on the wire (hop 4b)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    runTurnExecutorMock.mockReset();
  });

  // ── 1. THE FIELD ARRIVES ────────────────────────────────────────────────
  it('a run carrying `groundedSelection` puts `_grounded_selection` on the 200 body, ids intact', async () => {
    runTurnExecutorMock.mockResolvedValue(
      mkRun({ groundedSelection: { element_ids: [FACTOR_ID], unresolved: 'none' } }),
    );
    const { status, body } = await postTurn(app, 'aaaaaaaa-4b00-4aaa-8aaa-aaaaaaaaaa01');
    expect(status).toBe(200);
    // Not merely "defined" — the EXACT ids, because a consumer highlights the
    // canvas with them and a bounded or reordered id matches no node.
    expect(body._grounded_selection).toEqual({ element_ids: [FACTOR_ID], unresolved: 'none' });
    // The turn still validated: `.strict()` did not see the undeclared key,
    // which is what the strip → validate → re-attach mechanic buys.
    expect(body.assistant_text).toBe(ANSWER);
    expect(body.response_version).toBe(2);
  });

  it('DISCRIMINATING PAIR — a different grounded selection produces a different wire value', async () => {
    runTurnExecutorMock.mockResolvedValue(
      mkRun({ groundedSelection: { element_ids: [FACTOR_ID], unresolved: 'none' } }),
    );
    const a = await postTurn(app, 'aaaaaaaa-4b00-4aaa-8aaa-aaaaaaaaaa02');
    runTurnExecutorMock.mockResolvedValue(
      mkRun({ groundedSelection: { element_ids: [OPTION_ID], unresolved: 'not_in_model' } }),
    );
    const b = await postTurn(app, 'aaaaaaaa-4b00-4aaa-8aaa-aaaaaaaaaa03');
    expect(a.body._grounded_selection).toEqual({ element_ids: [FACTOR_ID], unresolved: 'none' });
    expect(b.body._grounded_selection).toEqual({
      element_ids: [OPTION_ID],
      unresolved: 'not_in_model',
    });
    // The inequality is what proves the route carries THIS turn's value rather
    // than a constant. Both fields, because `unresolved` collapsing to one
    // value is the specific mutant this slice's design exists to prevent.
    expect(a.body._grounded_selection).not.toEqual(b.body._grounded_selection);
    expect(a.body._grounded_selection.unresolved).not.toBe(
      b.body._grounded_selection.unresolved,
    );
  });

  it('the three `unresolved` states all survive the wire verbatim', async () => {
    // The wire must not narrow the closed enum: a UI that renders
    // `could_not_check` as "not found" reintroduces exactly the conflation
    // hops 3 and 4 spent their design keeping apart, and it can only avoid
    // that if the distinction actually arrives.
    const seen: string[] = [];
    const states = ['none', 'not_in_model', 'could_not_check'] as const;
    for (const [i, unresolved] of states.entries()) {
      runTurnExecutorMock.mockResolvedValue(
        mkRun({ groundedSelection: { element_ids: [FACTOR_ID], unresolved } }),
      );
      const { body } = await postTurn(app, `aaaaaaaa-4b00-4aaa-8aaa-aaaaaaaaaa1${i}`);
      seen.push(body._grounded_selection.unresolved);
    }
    expect(seen).toEqual([...states]);
    // …and all three are DISTINCT on the wire, not merely present.
    expect(new Set(seen).size).toBe(3);
  });

  // ── 2. ⭐ INERTNESS ──────────────────────────────────────────────────────
  /**
   * ⭐⭐ THE "NO READER ⇒ NO BEHAVIOUR CHANGE" PROOF.
   *
   * The same mocked turn, twice: once with `groundedSelection` on the run
   * result, once without. Everything else — the mock, the payload shape, the
   * config, the route — is identical. The two bodies must differ by EXACTLY the
   * one key.
   *
   * ⚠ ONE FIELD LEGITIMATELY DIFFERS AND IS NORMALISED:
   * `analysis_ready.computed_at` is stamped with `new Date().toISOString()` at
   * finalisation, so it moves between any two requests regardless of this
   * change. It is normalised to a constant BEFORE the comparison, and its
   * presence + ISO shape is asserted in both arms so the normalisation cannot
   * mask a field that vanished. Nothing else is normalised: `turn_id` does not
   * appear in the body, and the assistant text is fixed by the mock.
   */
  it('⭐ INERT — the two bodies are IDENTICAL apart from the single `_grounded_selection` key', async () => {
    runTurnExecutorMock.mockResolvedValue(
      mkRun({ groundedSelection: { element_ids: [FACTOR_ID], unresolved: 'none' } }),
    );
    const withField = await postTurn(app, 'aaaaaaaa-4b00-4aaa-8aaa-aaaaaaaaaa04');
    runTurnExecutorMock.mockResolvedValue(mkRun());
    const withoutField = await postTurn(app, 'aaaaaaaa-4b00-4aaa-8aaa-aaaaaaaaaa05');

    expect(withField.status).toBe(200);
    expect(withoutField.status).toBe(withField.status);

    // PRECONDITION (trap #13): the arms really do differ to begin with, so a
    // comparison that later reports "identical" is reporting on a real delta
    // having been removed rather than on two arms that were never different.
    expect(withField.body._grounded_selection).toBeDefined();
    expect('_grounded_selection' in withoutField.body).toBe(false);

    // The one legitimately-moving field, asserted present and ISO-shaped in
    // BOTH arms before it is normalised — otherwise the normalisation could
    // hide its disappearance.
    for (const b of [withField.body, withoutField.body]) {
      expect(typeof b.analysis_ready?.computed_at).toBe('string');
      expect(b.analysis_ready.computed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      b.analysis_ready.computed_at = 'NORMALISED';
    }

    const strippedA = { ...withField.body };
    delete strippedA._grounded_selection;

    // Deep equality first — the readable failure.
    expect(strippedA).toEqual(withoutField.body);
    // Then BYTE equality, which also pins KEY ORDER: the re-attach spreads the
    // finalised body and appends one key, so removing it must restore the exact
    // serialisation an un-grounded turn produces. `toEqual` alone cannot see a
    // reordering, and a wire body is bytes.
    expect(JSON.stringify(strippedA)).toBe(JSON.stringify(withoutField.body));
  });

  // ── 3. ABSENCE IS A MISSING KEY ─────────────────────────────────────────
  it('a run WITHOUT a grounded selection has NO `_grounded_selection` key at all', async () => {
    runTurnExecutorMock.mockResolvedValue(mkRun());
    const { status, body } = await postTurn(app, 'aaaaaaaa-4b00-4aaa-8aaa-aaaaaaaaaa06');
    expect(status).toBe(200);
    // `in`, not `toBeUndefined()`: a present-but-undefined key serialises away
    // in JSON but is a different object, and `null` would serialise INTO the
    // wire. Only `in` distinguishes all three.
    expect('_grounded_selection' in body).toBe(false);
    expect(JSON.stringify(body)).not.toContain('_grounded_selection');
  });

  it('an explicitly `undefined` `groundedSelection` is treated as absent, not as a null-valued key', async () => {
    // The `run.groundedSelection ? … : {}` guard's other input. A future
    // refactor to `'groundedSelection' in run` would ship `undefined` here.
    runTurnExecutorMock.mockResolvedValue(mkRun({ groundedSelection: undefined }));
    const { status, body } = await postTurn(app, 'aaaaaaaa-4b00-4aaa-8aaa-aaaaaaaaaa07');
    expect(status).toBe(200);
    expect('_grounded_selection' in body).toBe(false);
  });

  // ── 4. THE RE-ATTACH BLOCK IS THE SOLE AUTHORITY ────────────────────────
  it('a BODY-ATTACHED `_grounded_selection` is STRIPPED and never reaches the wire', async () => {
    // The illegal shape: the executor putting the sidecar on `response` instead
    // of surfacing it on the run result. `OlumiResponseSchema` is `.strict()`,
    // so leaving it in place would fail egress validation and drop the turn to
    // the fallback envelope — the defensive strip is what prevents that.
    runTurnExecutorMock.mockResolvedValue(
      mkRun({}, { _grounded_selection: { element_ids: ['smuggled_id'], unresolved: 'none' } }),
    );
    const { status, body } = await postTurn(app, 'aaaaaaaa-4b00-4aaa-8aaa-aaaaaaaaaa08');
    // Still a healthy 200 with the real answer — NOT the fallback envelope.
    expect(status).toBe(200);
    expect(body.assistant_text).toBe(ANSWER);
    // And the smuggled sidecar is gone.
    expect('_grounded_selection' in body).toBe(false);
    expect(JSON.stringify(body)).not.toContain('smuggled_id');
  });

  it('when BOTH are present the ctx-threaded value WINS — the re-attach block is the sole authority', async () => {
    // The discriminating half of the pair. Without it the strip test above
    // could pass because nothing ever attaches anything; here the body-attached
    // value is present AND overwritten, which is the only outcome consistent
    // with `ctx.groundedSelection` being the single authority.
    runTurnExecutorMock.mockResolvedValue(
      mkRun(
        { groundedSelection: { element_ids: [FACTOR_ID], unresolved: 'none' } },
        { _grounded_selection: { element_ids: ['smuggled_id'], unresolved: 'could_not_check' } },
      ),
    );
    const { status, body } = await postTurn(app, 'aaaaaaaa-4b00-4aaa-8aaa-aaaaaaaaaa09');
    expect(status).toBe(200);
    expect(body._grounded_selection).toEqual({ element_ids: [FACTOR_ID], unresolved: 'none' });
    expect(JSON.stringify(body)).not.toContain('smuggled_id');
  });
});
