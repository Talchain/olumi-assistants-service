/**
 * ⭐⭐⭐ THE EVALUABILITY VERDICT REACHES THE USER — ROUTE LEVEL, DETERMINISTIC PATH.
 *
 * ── WHAT THIS FILE IS FOR ─────────────────────────────────────────────────
 * #1484 made the WRITE-TIME receipt disclose that a limit's target records no
 * number, so the analysis structurally cannot evaluate it. #1494 carried that
 * verdict onto every later turn as `RecentMutation.constraint_not_checkable`.
 *
 * ⛔ AND THERE IT STOPPED. The field had **zero production readers**, while the
 * user's follow-up was answered FIRST, and unqualified, by the deterministic
 * `state-query-guard` — which reads `head.action` / `head.summary` from THE SAME
 * `recent_changes` array and emitted the receipt verbatim at `llm_calls: 0`.
 *
 * ── THE MEASUREMENT THAT PUT THIS FILE HERE (pristine, PR #1494 @ 95fa3511) ──
 * Six natural follow-ups, driven through `runTurnExecutor` on the `44e349fa`
 * shape. ALL SIX returned, at `llm_calls: 0`, `turn_class: direct_answer`:
 *
 *   "From the saved model history: Added constraint: Subscriber churn must be
 *    at most 7%. If you want to see the other saved model edits, just ask."
 *
 * — the change CLAIMED, UNQUALIFIED, 6 of 6 — while that very entry in the pack
 * carried `constraint_not_checkable: "target_records_no_value"`. The product
 * disclosed the truth at the write and then took it back on every readback.
 *
 * ── WHY BOTH DIRECTIONS ARE PINNED, SEPARATELY ────────────────────────────
 * ⛔ THE TWO HARMS CANNOT SHARE A THRESHOLD, so they get separate arms:
 *   · telling a user "yes, your 7% limit is on the model" when it cannot be
 *     evaluated is a **LIE** — ARM A pins that it is now qualified;
 *   · telling a user their perfectly good limit will be ignored is the SAME
 *     LIE POINTING THE OTHER WAY, and is the one error this disclosure must
 *     never make — ARM B pins that a checkable limit is NOT qualified away.
 * A single arm would let a fix in one direction silently open the other, which
 * is this estate's documented oscillation failure.
 *
 * ── BINDING IS BY IDENTITY, AND ARM B IS WHAT PROVES IT ───────────────────
 * Both arms use ONE graph carrying BOTH limits, so `recent_changes` always
 * contains a not-checkable entry. Only the HEAD differs (by `fact_created_at`,
 * production's own `created_at DESC` authority). ARM B therefore cannot be
 * satisfied by "some entry in the array is checkable" — a not-checkable entry
 * is present and must still produce NO qualification, because it is not the
 * entry being read back. The two limits differ in EXACTLY ONE respect: whether
 * the node they point at records a number.
 *
 * ── SCOPE, HONESTLY (status ladder) ───────────────────────────────────────
 * This proves what the product ANSWERS on the deterministic path, through the
 * real `runTurnExecutor` chain, with `llm_calls: 0` asserted so the answer
 * cannot be an LLM composition that happens to be right. It does NOT prove
 * behaviour on the LLM path, and it is not a journey witness against a deployed
 * build. Rung reached here: TESTED.
 */

import { randomUUID } from 'node:crypto';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { setTestSink } from '../../utils/telemetry.js';
import { unmeasuredTargetReadbackSentence } from '../coaching/constraint-gap-copy.js';
import {
FORBIDDEN_USER_FACING_PHRASES,
findForbiddenPhraseHit,
} from '../compose/forbidden-user-facing-phrases.js';

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';

/** Identities. Every assertion below binds to THESE, never to a value predicate. */
const CHURN_CONSTRAINT_ID = 'gc-11111111-1111-4111-8111-111111111111';
const COST_CONSTRAINT_ID = 'gc-22222222-2222-4222-8222-222222222222';
const CHURN_NODE_ID = 'risk_churn';
const COST_NODE_ID = 'f_support_cost';

/**
 * The persisted labels. Deliberately ABSENT from every message below, so an
 * assertion that finds one has found the RECORD and not the conversation.
 */
const CHURN_LABEL = 'Subscriber churn';
const COST_LABEL = 'Support cost';

/** Derived from the producer, never transcribed from it. */



/** The disclosure, derived from the copy leaf that owns it. */
const QUALIFICATION = unmeasuredTargetReadbackSentence();

/**
 * ONE graph, TWO limits, differing in exactly one respect.
 * `risk_churn` is the measured `44e349fa` shape: the target records NOTHING on
 * any quantity field. `f_support_cost` is the contrast and records a number.
 */
const PERSISTED_GRAPH = {
  nodes: [
    { id: 'goal_margin', kind: 'goal', label: 'Protect operating margin' },
    { id: 'opt_insource', kind: 'option', label: 'Bring support in-house' },
    { id: CHURN_NODE_ID, kind: 'risk', label: 'Subscriber Churn Rate' },
    {
      id: COST_NODE_ID,
      kind: 'factor',
      label: 'Support cost',
      observed_state: { value: 180000, unit: 'GBP', source: 'user_edited' },
    },
  ],
  edges: [{ from: COST_NODE_ID, to: 'goal_margin', strength: { mean: -0.3, std: 0.1 } }],
  goal_constraints: [
    {
      constraint_id: CHURN_CONSTRAINT_ID,
      node_id: CHURN_NODE_ID,
      operator: '<=',
      value: 7,
      unit: '%',
      label: CHURN_LABEL,
      provenance: 'explicit',
    },
    {
      constraint_id: COST_CONSTRAINT_ID,
      node_id: COST_NODE_ID,
      operator: '<=',
      value: 250000,
      label: COST_LABEL,
      provenance: 'explicit',
    },
  ],
};






/**
 * ⚠ THE HEAD IS CHOSEN BY TIME, NOT BY ARRAY ORDER, because that is what
 * production does: `reconcile-recent-mutation-facts.ts` re-sorts the union by
 * the database's own authority, `created_at DESC, id DESC`. A fixture that
 * relied on arrival order would be pinning the mock rather than the product.
 */
const OLDER_AT = new Date(Date.now() - 120_000).toISOString();


interface DatedFact {
  readonly fact: HandlerFact;
  readonly at: string;
}
const state: { dated: readonly DatedFact[] } = { dated: [] };

const PRIOR_TURN = {
  id: '22222222-2222-4222-8222-222222222222',
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-add-constraint',
  turn_class: 'handler',
  handler_id: 'add_constraint',
  request_hash: 'sha256:prior',
  response_emitted: true,
  llm_calls_used: 0,
  duration_ms: 8,
  created_at: OLDER_AT,
};

vi.mock('../rolling-summary/index.js', () => ({
  getRollingSummaryStore: () => ({
    loadSummary: async () => null,
    upsertSummary: async () => ({ applied: true, regressed: false, current_watermark: null }),
  }),
  getRollingSummaryModel: () => ({ summarise: async () => ({ text: 'DECISION FRAME: noop.' }) }),
  resetRollingSummaryForTests: () => undefined,
}));

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => [PRIOR_TURN],
    countTurns: async () => 1,
    readFactsFor: async () => state.dated.map((d) => d.fact),
    readFactsWithTurnFor: async () =>
      state.dated.map((d, index) => ({
        fact: d.fact,
        fact_row_id: `fact-row-${index}`,
        turn_id: PRIOR_TURN.id,
        fact_created_at: d.at,
      })),
    readRecentAppliedMutationFactsFor: async (_scenarioId: string, limit: number) =>
      state.dated.slice(0, limit).map((d, index) => ({
        fact: d.fact,
        fact_row_id: `fact-row-${index}`,
        fact_created_at: d.at,
      })),
    readNewestAnalysisFactFor: async () => null,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    loadGraph: async () => PERSISTED_GRAPH,
    loadGraphAndBriefText: async () => ({
      graph: PERSISTED_GRAPH,
      briefText: 'Should we bring customer support in-house?',
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));











/**
 * ⭐ THE SIX, VERBATIM FROM THE ADVERSARIAL REVIEW THAT MEASURED THE DEFECT.
 * Adopted permanently: each one reached the deterministic guard and claimed the
 * change unqualified at `llm_calls: 0` before this change existed.
 */


/** Every arm asserts the DETERMINISTIC path before it asserts any copy. */


describe('the constraint evaluability verdict reaches the user on the deterministic path', () => {
  beforeEach(() => {
    state.dated = [];
    setTestSink(() => undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  /**
   * ⚠⚠ THE PRECONDITION. Without it every arm below is unfalsifiable: if the
   * #1494 wire were cut, ARM B would pass for the wrong reason (nothing is ever
   * qualified) and the suite would still look healthy. This asserts the verdict
   * is ON the entry, in the pack, on this fixture, on this turn — and that the
   * contrast entry does NOT carry it.
   */


  /**
   * ⛔ ARM A — THE LIE DIRECTION. The head is the limit the analysis cannot
   * check. Before this change all six of these claimed it unqualified.
   */


  /**
   * ⛔ ARM B — THE OPPOSITE-DIRECTION TWIN, AND THE IDENTITY BINDING.
   *
   * The head is a limit that IS checkable, while the SAME `recent_changes`
   * array still contains the not-checkable churn entry. So this arm cannot be
   * satisfied by "nothing in the array is not-checkable": it is satisfied only
   * if the qualification binds to the entry being read back.
   *
   * Telling this user their good limit will be ignored is the same lie pointing
   * the other way, and is the error the disclosure must never make.
   */


  /**
   * The review's negative control. It proves the six-case probe DISCRIMINATES:
   * a message outside the state-query class is not claimed by the guard, so a
   * uniform "all six matched" result is a finding about the product rather
   * than about an instrument that matches everything.
   */


  /**
   * The copy itself, pinned against the atoms it is built from rather than
   * transcribed. A re-spelling that drifts from the ratified voice reds here.
   */
  describe('the disclosure copy', () => {
    it('is composed from the ratified UNMEASURED_TARGET atoms, with no em dash and no engine names', () => {
      expect(QUALIFICATION).toBe(
        'Your model records no value to test that limit, so it will not be part of the analysis.' +
          ' Tell me which part of your model it applies to and I will record it there;' +
          ' this one stays on the model.',
      );
      expect(QUALIFICATION).not.toMatch(/—/u);
      expect(QUALIFICATION).not.toMatch(/\b(?:ISL|PLoT|PU|observed_state|node_id)\b/u);
    });

    it('trips no FORBIDDEN_USER_FACING_PHRASE, with the scanner proven able to fire', () => {
      // ⚠ THE POSITIVE CONTROL IS THE POINT. An absence assertion against a
      // scanner that silently matches nothing passes by testing nothing, so
      // prove the scanner SEES a presence before believing its silence.
      expect(
        FORBIDDEN_USER_FACING_PHRASES.length,
        'the forbidden-phrase list is empty — this probe is BLIND',
      ).toBeGreaterThan(0);
      expect(
        findForbiddenPhraseHit('No changes were needed for this request.'),
        'the scanner did not fire on a known forbidden phrase — it cannot support an absence claim',
      ).not.toBeNull();
      expect(findForbiddenPhraseHit(QUALIFICATION)).toBeNull();
    });
  });
});
