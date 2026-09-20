/**
 * The projection from the turn's one context read to the four states the
 * conversation layer must tell apart.
 *
 * ⭐ WHY THE ENRICHMENT FIXTURE IS CAPTURE-DERIVED, AND WHAT THAT MEANS HERE.
 * Five of the six defects the previous account shipped in this layer shared
 * one shape: a self-authored fixture that confirmed the author's model of a
 * producer instead of testing against it. Twice in a row a field combination
 * was invented (`range.range_min`), passed every test, and refused every real
 * factor on the wire.
 *
 * So `ENRICHMENT_SHAPE` below is the SHAPE of a real ISL response taken from
 * `output/.../evidence/olumi-debug-a039817e-20260920.json`
 * (`payloads.isl_response`): the key names, the nesting, and which fields are
 * present are the producer's. EVERY DIGIT AND LABEL IS REPLACED — this repo is
 * public and the capture carries real pricing. That is the rule the failures
 * taught: a fixture asserting "this is the shape the wire carries" needs a
 * capture; a fixture asserting "this is a case that must be handled" does not,
 * and the deliberately-constructed cases further down are exactly that.
 */

import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { reconcileScenarioAnalysisFacts } from '../../context/reconcile-scenario-analysis-facts.js';
import { createReadResultsTool, READ_RESULTS_NO_ANALYSIS, READ_RESULTS_RECORD_UNREADABLE } from '../read-tools.js';
import type { EnrichedTurnContext } from '../../build-turn-context.js';
import { projectTurnContext, REPLACEMENT_HISTORY_TURN_CAP } from '../turn-context-view.js';

// A real UUID: `HandlerFactSchema` requires `result.scenario_id` to BE one,
// and the scenario carrier's validator parses every candidate through that
// schema. The first draft of this fixture used a readable slug and was
// silently rejected as `durable_contract_invalid` — the attested set came back
// degraded and three assertions failed for a reason that had nothing to do
// with the code under test. Derived by running the schema, not assumed.
const SCENARIO = '11111111-2222-4333-8444-555555555555';
const GRAPH_HASH = 'hash-of-the-graph-on-screen';

/**
 * Key names and nesting from the capture; values invented. `near_tie` really
 * does carry all three of `gap` / `is_tie` / `threshold` on the wire, and
 * `option_comparison[]` really does carry both `id`/`label` AND
 * `option_id`/`option_label`.
 */
const ENRICHMENT_SHAPE = {
  analysis_status: 'completed',
  option_comparison: [
    {
      id: 'aaaa1111',
      label: 'Option A',
      option_id: 'aaaa1111',
      option_label: 'Option A',
      status: 'computed',
      outcome: {
        p10: 0.1,
        p50: 0.4,
        p90: 0.8,
        std: 0.3,
        mean: 0.4,
        n_samples: 10000,
        validity_ratio: 1,
        n_valid_samples: 10000,
        percentiles_source: 'samples',
      },
      downside: { p05: -0.08, cvar_10: -0.11 },
    },
  ],
  robustness: { near_tie: { gap: 0.5, is_tie: false, threshold: 0.1 } },
} as const;

/**
 * Every field here is REQUIRED by `HandlerFactSchema` — `fact_version`, the
 * UUID scenario id, `leading_option_id` and `summary` included. Omitting any
 * of them makes the durable contract invalid and the carrier degrade, which
 * looks exactly like a projection bug and is not one.
 */
function runAnalysisFact(over: Record<string, unknown> = {}): HandlerFact {
  return {
    fact_version: 1,
    fact_type: 'run_analysis',
    noop: false,
    result: {
      scenario_id: SCENARIO,
      leading_option_id: 'aaaa1111',
      summary: 'the analysis ran',
      graph_hash_at_run: GRAPH_HASH,
      computed_at: '2026-09-20T10:00:00.000Z',
      enrichment: ENRICHMENT_SHAPE,
      ...over,
    },
  } as unknown as HandlerFact;
}

/** An attested `complete` carrier, built the way production builds one. */
function attestedSet(facts: readonly HandlerFact[]) {
  return reconcileScenarioAnalysisFacts({
    scenarioId: SCENARIO,
    hotWindowFacts: [],
    hotWindowFactsWithIdentity: [],
    durableRead: {
      status: 'ok',
      scenario_id: SCENARIO,
      query_limit: 21,
      total_count: facts.length,
      facts: facts.map((fact, index) => ({
        fact,
        fact_row_id: `analysis-fact-${index}`,
        fact_created_at: `2026-09-20T12:00:${String(59 - index).padStart(2, '0')}.000Z`,
      })),
    },
  });
}

/**
 * `prior_facts` is an ARRAY that also carries two named members
 * (`HandlerFactsWithRecentMutationHistory`). Built here rather than passed as a
 * bare `[]` so the fixture is the shape production hands the projection.
 */
function factsWindow(facts: readonly HandlerFact[] = []) {
  return Object.assign([...facts], {
    recent_mutation_facts: [] as readonly HandlerFact[],
    recent_changes_status: 'complete' as const,
  });
}

function contextWith(over: Partial<EnrichedTurnContext>): EnrichedTurnContext {
  return {
    session_id: SCENARIO,
    prior_turns: [],
    prior_facts: factsWindow(),
    prior_facts_read_ok: true,
    ...over,
  } as unknown as EnrichedTurnContext;
}

/** The sentence `read_results` actually hands the model for a given snapshot. */
async function resultOf(snapshot: ReturnType<typeof projectTurnContext>['snapshot']): Promise<string> {
  const outcome = await createReadResultsTool({ getAnalysis: () => snapshot }).execute({});
  if (outcome.type !== 'result') throw new Error(`expected a result, got ${outcome.type}`);
  return outcome.content;
}

describe('the four states a conversation layer must tell apart', () => {
  it('STATE 1 — read succeeded and nothing has been analysed: a null snapshot, which licenses "never computed"', () => {
    const view = projectTurnContext(
      contextWith({ scenario_analysis_fact_set: attestedSet([]) }),
      GRAPH_HASH,
      null,
    );
    expect(view.snapshot).toBeNull();
    expect(view.freshness.freshness).toBe('none');
    expect(view.freshness.reason).toBe('no_successful_run_analysis_fact');
  });

  it('STATE 2 — a successful run matching the current graph is CURRENT, and carries the producer bytes', () => {
    const view = projectTurnContext(
      contextWith({ scenario_analysis_fact_set: attestedSet([runAnalysisFact()]) }),
      GRAPH_HASH,
      null,
    );
    expect(view.snapshot).not.toBeNull();
    expect(view.snapshot?.freshness).toBe('fresh');
    expect(view.snapshot?.recordReadOk).toBe(true);
    // ⚠ DEEP equality, not reference: `freezeComplete` runs every fact
    // through `cloneAndFreezeJson`, so the carrier hands back a frozen COPY.
    // A `toBe` here fails on correct code — which it did, on the first run of
    // this spec. Deep-equality against the whole producer object is still an
    // identity binding at the object level (trap 19): no other object in this
    // fixture could satisfy it.
    expect(view.snapshot?.enrichment).toEqual(ENRICHMENT_SHAPE);
    expect(view.snapshot?.computedAt).toBe('2026-09-20T10:00:00.000Z');
  });

  it('STATE 3 — the graph moved since the run: STALE, and the figures still come through', () => {
    const view = projectTurnContext(
      contextWith({ scenario_analysis_fact_set: attestedSet([runAnalysisFact()]) }),
      'a-different-hash-because-the-user-edited',
      null,
    );
    expect(view.snapshot?.freshness).toBe('stale');
    expect(view.snapshot?.enrichment).toEqual(ENRICHMENT_SHAPE);
  });

  it('STATE 4 — a DEGRADED carrier is "could not look", NEVER "nothing is there"', () => {
    const degraded = reconcileScenarioAnalysisFacts({
      scenarioId: SCENARIO,
      hotWindowFacts: [],
      hotWindowFactsWithIdentity: [],
      // Omission is an unavailable durable port, never an empty fact set.
    });
    expect(degraded.status).toBe('degraded');

    const view = projectTurnContext(
      contextWith({ scenario_analysis_fact_set: degraded }),
      GRAPH_HASH,
      null,
    );
    // The snapshot is NOT null: null would be read as state 1 downstream and
    // would license the false "never computed" sentence.
    expect(view.snapshot).not.toBeNull();
    expect(view.snapshot?.recordReadOk).toBe(false);
    expect(view.snapshot?.enrichment).toBeNull();
    expect(view.freshness.reason).toBe('derivation_failed');
    expect(view.freshness.freshness).toBe('unknown');
    // ⚠ The distinguishing assertion: it must NOT claim the scenario is empty.
    expect(view.freshness.freshness).not.toBe('none');
  });

  it('STATE 4 — a FAILED context read is the same answer, reached the other way', () => {
    const view = projectTurnContext(null, GRAPH_HASH, null);
    expect(view.snapshot?.recordReadOk).toBe(false);
    expect(view.freshness.reason).toBe('derivation_failed');
    expect(view.history).toEqual([]);
  });

  it('an UNATTESTED fact set fails weak — a hand-built object cannot buy trust', () => {
    // The attestation exists so a caller cannot manufacture `status:
    // 'complete'` and turn omitted validation into permission. Proven here by
    // handing the projection an object of exactly the right SHAPE that never
    // came from the authority boundary.
    const forged = {
      status: 'complete',
      source: 'scenario',
      facts: [runAnalysisFact()],
      total_count: 1,
    } as never;
    const view = projectTurnContext(
      contextWith({ scenario_analysis_fact_set: forged }),
      GRAPH_HASH,
      null,
    );
    expect(view.snapshot?.recordReadOk).toBe(false);
    expect(view.snapshot?.enrichment).toBeNull();
  });
});

describe('⭐ the window trap — the defect this projection exists to avoid', () => {
  it('finds an analysis that has aged OUT of the turn window, because it reads the scenario carrier', () => {
    // ═══════════════════════════════════════════════════════════════════════
    // THE DISCRIMINATING TEST. `prior_facts` is a ~20-turn window; the
    // scenario carrier is not. `build-turn-context.ts` records what reading
    // the window cost once already: "a `run_analysis` fact whose parent turn
    // had aged out was invisible and the 'no analysis ⇒ nothing to withhold'
    // branch fired on a scenario that DOES have a withheld analysis."
    //
    // Here the analysis exists ONLY in the scenario carrier — `prior_facts` is
    // empty, exactly as it would be for a user who analysed their model and
    // then had a long conversation. A projection reading the window would
    // return a null snapshot and the product would tell them their analysis
    // never happened.
    //
    // This case cannot be reached by any fixture with fewer than twenty turns,
    // which is every other fixture in this suite — so without this test the
    // regression would be invisible.
    // ═══════════════════════════════════════════════════════════════════════
    const view = projectTurnContext(
      contextWith({
        prior_facts: factsWindow(),
        prior_facts_read_ok: true,
        scenario_analysis_fact_set: attestedSet([runAnalysisFact()]),
      }),
      GRAPH_HASH,
      null,
    );
    expect(view.snapshot?.enrichment).toEqual(ENRICHMENT_SHAPE);
    expect(view.snapshot?.freshness).toBe('fresh');
  });

  it('CONTRAST — the window alone does NOT feed the projection', () => {
    // The paired half. If the projection ever reverted to reading
    // `prior_facts`, the test above would still pass (the carrier is
    // populated) — so this asserts the other direction: a fact present ONLY in
    // the window must not be picked up, because the window is not the
    // authority for this question. One of the pair proves the carrier is read;
    // the other proves the window is not.
    const view = projectTurnContext(
      contextWith({
        prior_facts: factsWindow([runAnalysisFact()]) as never,
        prior_facts_read_ok: true,
        scenario_analysis_fact_set: attestedSet([]),
      }),
      GRAPH_HASH,
      null,
    );
    expect(view.snapshot).toBeNull();
  });
});

describe('what the tools actually say — the sentence the user gets', () => {
  it('an unreadable record says SO, and does not claim nothing was computed', async () => {
    const view = projectTurnContext(null, GRAPH_HASH, null);
    const out = await resultOf(view.snapshot);
    expect(out).toBe(READ_RESULTS_RECORD_UNREADABLE);
    // The precise harm, pinned as a string: the old wiring emitted the
    // sentence below on exactly this input, with an instruction to repeat it.
    expect(out).not.toBe(READ_RESULTS_NO_ANALYSIS);
    expect(out).not.toContain('never computed');
  });

  it('CONTRAST — a genuinely empty scenario still gets the "never computed" sentence, which is TRUE there', async () => {
    // Without this control the assertion above would pass on a tool that had
    // simply stopped emitting READ_RESULTS_NO_ANALYSIS at all — which would be
    // a different defect, not a fix.
    const view = projectTurnContext(
      contextWith({ scenario_analysis_fact_set: attestedSet([]) }),
      GRAPH_HASH,
      null,
    );
    const out = await resultOf(view.snapshot);
    expect(out).toBe(READ_RESULTS_NO_ANALYSIS);
  });

  it('a current analysis reaches the model as figures, not as silence', async () => {
    const view = projectTurnContext(
      contextWith({ scenario_analysis_fact_set: attestedSet([runAnalysisFact()]) }),
      GRAPH_HASH,
      null,
    );
    const out = await resultOf(view.snapshot);
    const content = out;
    expect(content).toContain('ANALYSIS IS CURRENT');
    expect(content).not.toContain('NO ANALYSIS HAS BEEN RUN');
    // The producer's own separation verdict, reported rather than inferred.
    expect(content).toContain('0.5');
  });
});

describe('history is a reference window, and says what it is', () => {
  const turnRow = (i: number) =>
    ({
      user_message: `user says ${i}`,
      assistant_message: `assistant says ${i}`,
    }) as never;

  it('arrives newest-first and is handed to the model OLDEST-first', () => {
    // The store's convention and the model's are opposite. Getting this
    // backwards reverses the conversation without erroring — it just makes the
    // model answer the wrong question.
    const view = projectTurnContext(
      contextWith({ prior_turns: [turnRow(3), turnRow(2), turnRow(1)] }),
      GRAPH_HASH,
      null,
    );
    expect(view.history.map((m) => m.content)).toEqual([
      'user says 1',
      'assistant says 1',
      'user says 2',
      'assistant says 2',
      'user says 3',
      'assistant says 3',
    ]);
  });

  it('is capped, and the cap keeps the NEWEST turns', () => {
    const rows = Array.from({ length: REPLACEMENT_HISTORY_TURN_CAP + 5 }, (_, i) =>
      turnRow(100 - i),
    );
    const view = projectTurnContext(contextWith({ prior_turns: rows }), GRAPH_HASH, null);
    expect(view.history).toHaveLength(REPLACEMENT_HISTORY_TURN_CAP * 2);
    // Newest turn is `turnRow(100)`, which must survive the cap and land LAST.
    expect(view.history.at(-1)?.content).toBe('assistant says 100');
  });

  it('skips a missing half rather than inventing one', () => {
    // Rows written before this controller persisted the user half hold a NULL
    // `user_message`. A placeholder there would read as something the user
    // said, which is a fabrication route.
    const view = projectTurnContext(
      contextWith({
        prior_turns: [{ user_message: null, assistant_message: 'only the reply survived' } as never],
      }),
      GRAPH_HASH,
      null,
    );
    expect(view.history).toEqual([{ role: 'assistant', content: 'only the reply survived' }]);
  });
});
