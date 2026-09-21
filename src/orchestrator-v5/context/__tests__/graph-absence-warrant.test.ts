/**
 * P0 — "I don't actually have a model started yet" said to a user looking at a
 * completed analysis.
 *
 * WITNESSED ON DEPLOYED STAGING: a guest built a model from a brief, a full
 * Monte Carlo analysis completed (12 nodes / 18 edges, leading option 51%,
 * "Analysis complete." on screen), and the assistant then denied the model's
 * existence three times — once from its own `[Review model gaps]` chip.
 *
 * ── THE COLLAPSE ───────────────────────────────────────────────────────────
 * `supabase-store.loadGraphAndBriefText` returns `{ graph: null }` for TWO
 * different facts, and `fetchPersistedScenarioState` mints `ok_absent` for
 * both:
 *
 *   · the scenario row exists and `scenarios.graph` is genuinely NULL
 *     → a real fresh user, and "no Living Model exists yet" is TRUE;
 *   · the model exists but this read did not produce it
 *     → "no Living Model exists yet" is a CONFIDENT FALSE CLAIM about the
 *       user's own work.
 *
 * `ok_absent` reaches the model as `graph_context.status: 'absent'`, whose
 * code-owned prompt contract says "no Living Model exists yet" — so the
 * product asserts the lie rather than merely failing to answer.
 *
 * ── THE DISCRIMINATOR, AND WHY IT IS EVIDENCE RATHER THAN A GUESS ──────────
 * A SUCCESSFUL `run_analysis` fact is POSITIVE PROOF that a model existed:
 * the analyse path is UI → CEE → PLoT → ISL and CEE reloads its OWN persisted
 * graph to run it, so an analysis cannot have completed over an absent graph.
 * `graph: null` beside such a fact is therefore not "no model" — it is a model
 * this read failed to produce, which is exactly `unavailable`.
 *
 * The warrant requires POSITIVE evidence and never absence alone (the estate's
 * standing rule for read-state degradation), so a genuine fresh user — who has
 * no analysis fact — is untouched. That is the CONTROL direction below, and it
 * is asserted in the same run as the failure direction.
 *
 * ⚠ BINDING IS BY IDENTITY, NEVER BY A VALUE PREDICATE ANOTHER STATE COULD
 * SATISFY. Every assertion names the exact read status and the exact selector
 * status. A `noop`/failed `run_analysis` fact is asserted NOT to escalate, so
 * the tests bind to `isSuccessfulRunAnalysisFact`'s judgement rather than to
 * "some run_analysis fact is present".
 */

import { describe, expect, it } from 'vitest';
import type { HandlerFact, SessionTurn } from '@talchain/schemas/orchestrator';

import { buildTurnContext } from '../../build-turn-context.js';
import { createNoopSessionStore } from '../../session/__tests__/fixtures.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { selectContextGraphSnapshot } from '../context-graph-snapshot.js';

const BASE = makeMessagePayload({
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  message: 'can you review my model?',
});

/** A minimal but schema-shaped persisted graph — the "healthy" control. */
const PERSISTED_GRAPH = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Grow revenue' },
    { id: 'opt_a', kind: 'option', label: 'Hire two engineers' },
  ],
  edges: [],
};

function makeSessionTurn(turnId: string): SessionTurn {
  return {
    id: `row-${turnId}`,
    scenario_id: BASE.scenario_id,
    user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    turn_id: turnId,
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: `sha256:${turnId}`,
    response_emitted: true,
    llm_calls_used: 1,
    duration_ms: 100,
    created_at: '2026-08-30T00:00:00.000Z',
  };
}

/**
 * The witnessed fact: an analysis that COMPLETED. `analysis_status: 'computed'`
 * is the producer's own canonical success value — taken from the producer, not
 * from this test's reading of what success ought to mean.
 */
function makeSuccessfulRunAnalysisFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: BASE.scenario_id,
      leading_option_id: 'opt_a',
      summary: 'Analysis completed.',
      graph_hash_at_run: 'abcdef0123456789',
      computed_at: '2026-08-30T00:00:00.000Z',
      enrichment: { analysis_status: 'computed' },
    },
  };
}

/** The discriminating twin: a run_analysis fact that did NOT succeed. */
function makeFailedRunAnalysisFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: BASE.scenario_id,
      leading_option_id: null,
      summary: 'Analysis failed.',
      graph_hash_at_run: 'abcdef0123456789',
      computed_at: '2026-08-30T00:00:00.000Z',
      enrichment: { analysis_status: 'failed' },
    },
  };
}

async function readStateFor(opts: {
  readonly graph: unknown | null;
  readonly facts: readonly HandlerFact[];
  /** What the CALLER sent this turn. Null models the deployed V5 UI, which
   *  sends a turn and never a graph — the witnessed configuration. */
  readonly requestGraph?: unknown | null;
}) {
  const store = createNoopSessionStore({
    loadGraphResult: opts.graph,
    priorTurns: opts.facts.length > 0 ? [makeSessionTurn('t1')] : [],
    facts: opts.facts,
  });
  const ctx = await buildTurnContext(BASE, 'req-blindfix', { sessionStore: store });
  const read = ctx.persistedGraphRead;
  // The whole test is about WHICH read state was minted; a missing read state
  // would make every status assertion below vacuously comparable to undefined.
  expect(read).toBeDefined();
  return {
    read: read!,
    // The exact downstream consumer that turns the read state into the token
    // the model reads. Asserting the selector — not just the read state — is
    // what makes this a claim about what the ASSISTANT is told.
    selection: selectContextGraphSnapshot({
      canonicalRead: read,
      requestGraph: opts.requestGraph ?? null,
    }),
  };
}

describe('whole-model absence — "could not load it" is not "you do not have one"', () => {
  it('FAILURE DIRECTION: a null graph beside a COMPLETED analysis reads as unavailable, never absent', async () => {
    const { read, selection } = await readStateFor({
      graph: null,
      facts: [makeSuccessfulRunAnalysisFact()],
    });

    // The READ is not falsified — it genuinely succeeded and found nothing.
    // What is withdrawn is the ENTITLEMENT to call that "no model".
    expect(read.status).toBe('ok_absent');
    expect(read.status === 'ok_absent' && read.absenceWarranted).toBe(false);

    // What the model is actually told. `unavailable`'s code-owned contract
    // (GRAPH_CONTEXT_INSTRUCTION) says: "do not turn this into a claim that no
    // model exists". `absent`'s says "no Living Model exists yet" — the lie.
    expect(selection.status).toBe('unavailable');
    // Identity, not merely "not absent": the reason names THIS withdrawal, so
    // an unavailable arising from some other cause cannot satisfy it.
    expect(selection.reason).toBe('canonical_absence_unwarranted');
  });

  it('RESCUE PATH PRESERVED: a caller-supplied graph is still promoted provisionally', async () => {
    // The regression guard for this fix's own first revision, which returned a
    // `degraded` read and thereby suppressed this promotion. Where the caller
    // sent a usable graph we can still answer this user truthfully from their
    // own bytes, and that is strictly better than an unavailable verdict — so
    // the first-touch rescue keeps precedence over the withdrawal.
    const { read, selection } = await readStateFor({
      graph: null,
      facts: [makeSuccessfulRunAnalysisFact()],
      requestGraph: PERSISTED_GRAPH,
    });

    // Same withdrawn entitlement as the failure direction above...
    expect(read.status === 'ok_absent' && read.absenceWarranted).toBe(false);
    // ...and yet the caller's graph still wins, exactly as before this change.
    expect(selection.status).toBe('provisional');
    expect(selection.reason).toBe('persisted_absent_request_valid');
  });

  it('CONTROL DIRECTION: a genuine fresh user (no analysis has ever run) is UNCHANGED', async () => {
    const { read, selection } = await readStateFor({ graph: null, facts: [] });

    // The legitimate counterpart. A fresh user must still get the correct,
    // welcoming empty-state behaviour, which `absent` is what produces.
    expect(read.status).toBe('ok_absent');
    expect(read.status === 'ok_absent' && read.absenceWarranted).toBe(true);
    expect(selection.status).toBe('absent');
    expect(selection.reason).toBe('persisted_absent_no_request');
  });

  it('CONTROL: a run_analysis fact that did NOT succeed does not escalate', async () => {
    // Binds the warrant to `isSuccessfulRunAnalysisFact` rather than to the
    // mere presence of a run_analysis fact. A failed analysis is not proof a
    // model was ever persisted, so this must stay the fresh-user answer.
    const { read, selection } = await readStateFor({
      graph: null,
      facts: [makeFailedRunAnalysisFact()],
    });

    expect(read.status).toBe('ok_absent');
    expect(selection.status).toBe('absent');
  });

  it('CONTROL: a healthy persisted graph is canonical, analysis fact or not', async () => {
    // Proves the warrant is scoped to the ABSENT case and does not degrade a
    // healthy turn — the "do not hedge everywhere" requirement.
    const withFact = await readStateFor({
      graph: PERSISTED_GRAPH,
      facts: [makeSuccessfulRunAnalysisFact()],
    });
    expect(withFact.read.status).toBe('ok_present');
    expect(withFact.selection.status).toBe('canonical');

    const withoutFact = await readStateFor({ graph: PERSISTED_GRAPH, facts: [] });
    expect(withoutFact.read.status).toBe('ok_present');
    expect(withoutFact.selection.status).toBe('canonical');
  });
});
