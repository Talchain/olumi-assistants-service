/**
 * System B — fresh-facade return-session continuity at the routing seam.
 *
 * Evidence rung: deterministic composed harness. It uses the production
 * context reader, rolling-summary injector, ContextPack assembler and router;
 * it manually joins the turn-executor functions and therefore does not claim
 * turn-executor, route-v2, HTTP, deployed, persistence-RPC, process-restart,
 * no-cache or live-model proof. Process-global prompt/config caches may remain
 * warm between the independently created session and summary facades.
 */

import { describe, expect, it } from 'vitest';

import {
  DurableReturnSessionBackend,
  loadReturnSessionContinuityCase,
  runFreshFacadeReturnSession,
  scoreReturnSessionContinuity,
  type ReturnSessionMutant,
} from '../scorer/return-session-continuity.js';

const kase = loadReturnSessionContinuityCase();

describe('return-session continuity — shared durable bytes, fresh facades', () => {
  it('pins every summary entry to an existing supporting turn with a distinct slot prefix', () => {
    const turnsById = new Map(kase.turns.map((turn) => [turn.turn_id, turn]));
    const prefixes = new Set<string>();

    for (const entries of Object.values(kase.summary.slots)) {
      prefixes.add(entries[0]!.sources[0]!.turn_id.slice(0, 8));
      for (const entry of entries) {
        for (const source of entry.sources) {
          const turn = turnsById.get(source.turn_id);
          expect(turn, `missing summary source ${source.turn_id}`).toBeDefined();
          const sourceText = turn![source.speaker].toLowerCase();
          for (const witness of source.witnesses) {
            expect(sourceText).toContain(witness.toLowerCase());
          }
        }
      }
    }

    expect(prefixes.size).toBe(Object.keys(kase.summary.slots).length);
    expect(JSON.stringify(kase.turns)).not.toContain('TENSION-SAFFRON');
    expect(JSON.stringify(kase.graph)).not.toContain('TENSION-SAFFRON');

    const summary = DurableReturnSessionBackend.current(kase).primarySummary();
    const frame = summary?.slots.find((slot) => slot.slot === 'FRAME')?.entries[0];
    const resolved = summary?.slots.find((slot) => slot.slot === 'RESOLVED')?.entries[0];
    expect(frame?.source_turn_ids).toEqual([
      '11000001-0000-4000-8000-000000000001',
    ]);
    expect(frame?.source_speakers).toEqual(['user', 'assistant']);
    expect(resolved?.source_speakers).toEqual(['assistant']);
  });

  it('reconstructs the same authoritative reasoning fabric through two fresh facade sets', async () => {
    const backend = DurableReturnSessionBackend.current(kase);
    const durableBytesBefore = backend.snapshotBytes();
    expect(backend.hashes.graph_hash_at_analysis).toBe(backend.hashes.current_graph_hash);
    expect(Object.isFrozen(backend.primaryFacts())).toBe(true);
    expect(backend.primaryFacts().every((row) => Object.isFrozen(row.fact))).toBe(true);
    expect(JSON.stringify(backend.factRows)).toContain(kase.other_scenario.fact_canary);

    const first = await runFreshFacadeReturnSession(backend);
    expect(backend.snapshotBytes()).toBe(durableBytesBefore);
    const afterReload = await runFreshFacadeReturnSession(backend);
    expect(backend.snapshotBytes()).toBe(durableBytesBefore);

    expect(first.runtime_id).not.toBe(afterReload.runtime_id);
    expect(first.session_store_instance_id).not.toBe(afterReload.session_store_instance_id);
    expect(first.summary_store_instance_id).not.toBe(afterReload.summary_store_instance_id);
    expect(first.routedUserMessage).toBe(afterReload.routedUserMessage);
    expect(first.contextPack).toEqual(afterReload.contextPack);
    expect(first.graph_compaction_via).toBe('strict_parse');
    expect(afterReload.graph_compaction_via).toBe('strict_parse');
    expect(JSON.stringify(afterReload.context.prior_facts)).not.toContain(
      kase.other_scenario.fact_canary,
    );
    expect(afterReload.routedUserMessage).not.toContain(
      kase.other_scenario.fact_canary,
    );
    expect(scoreReturnSessionContinuity(kase, first, 'current')).toEqual({
      pass: true,
      failures: [],
    });
    expect(scoreReturnSessionContinuity(kase, afterReload, 'current')).toEqual({
      pass: true,
      failures: [],
    });

    expect(afterReload.contextPack.conversation.window).toMatchObject({
      shown: 8,
      available: 20,
      summarised: 12,
    });
    const summaryWatermark = kase.turns.find(
      (turn) => turn.n === kase.summary.updated_turn_number,
    )!;
    expect(afterReload.summaryInjection).toMatchObject({
      lagTurns: 8,
      summarisedTurns: 12,
      section: {
        current_to_turn_id: summaryWatermark.turn_id,
        lag_turns: 8,
        stale: true,
      },
    });
    expect(afterReload.summaryInjection.section?.note).toContain(
      'the latest 8 turns are shown verbatim',
    );
    expect(afterReload.contextPack.conversation_summary).toMatchObject({
      current_to_turn_id: summaryWatermark.turn_id,
      lag_turns: 8,
      stale: true,
    });
    for (const entries of Object.values(kase.summary.slots)) {
      const prefix = entries[0]!.sources[0]!.turn_id.slice(0, 8);
      expect(afterReload.contextPack.conversation_summary?.text).toContain(
        `[t:${prefix}]`,
      );
      expect(afterReload.routedUserMessage).toContain(`[t:${prefix}]`);
    }
    expect(afterReload.routedUserMessage).toContain('[t:44000005]');
    expect(afterReload.contextPack.conversation_summary?.text).toContain('TENSION-SAFFRON');
    expect(afterReload.contextPack.recent_changes).toEqual([
      expect.objectContaining({
        action: 'factor_value_updated',
        target_label: 'Support capacity',
      }),
    ]);
    expect(afterReload.contextPack.graph.edges).toEqual([
      expect.objectContaining({
        from: 'factor_support_capacity',
        to: 'goal_safe_launch',
        strength: 0.64,
        exists: 0.87,
      }),
    ]);
    expect(afterReload.routedUserMessage).toContain('moderate positive link');
    expect(afterReload.contextPack.analysis?.leading_option).toMatchObject({
      label: kase.analysis.leading_option_label,
      probability: kase.analysis.win_probabilities[kase.analysis.leading_option_id],
    });
  });

  it('keeps every durable read scenario-scoped and excludes client-supplied controls', async () => {
    const observation = await runFreshFacadeReturnSession(
      DurableReturnSessionBackend.current(kase),
    );

    expect(observation.reads.length).toBeGreaterThan(5);
    expect(
      observation.reads.every(
        (read) =>
          read.requested_scenario_id === kase.scenario_id &&
          read.resolved_scenario_id === kase.scenario_id,
      ),
    ).toBe(true);
    expect(observation.routedUserMessage).not.toContain(kase.client_claims.history);
    expect(observation.routedUserMessage).not.toContain(kase.other_scenario.brief);
    expect(observation.routedUserMessage).not.toContain(kase.other_scenario.graph_label);
  });
});

describe('return-session continuity — degraded summary joins the preceding fallback', () => {
  it('a missing stored summary retains the fetched hot window without a false summary claim', async () => {
    const observation = await runFreshFacadeReturnSession(
      DurableReturnSessionBackend.current(kase),
      { summaryMode: 'missing' },
    );

    expect(observation.summaryInjection).toEqual({
      section: null,
      lagTurns: null,
      summarisedTurns: null,
    });
    expect(observation.contextPack.conversation_summary).toBeUndefined();
    expect(observation.contextPack.conversation.window).toMatchObject({
      shown: 20,
      available: 20,
    });
    expect(observation.contextPack.conversation.window?.summarised).toBeUndefined();
    expect(observation.routedUserMessage).toContain('ORCHID-12');
    expect(observation.routedUserMessage).not.toContain('TENSION-SAFFRON');
    expect(observation.visibleAnswer).not.toContain('TENSION-SAFFRON');
    expect(observation.visibleAnswer).toContain(
      'no verified tension summary is available this turn',
    );
    expect(
      scoreReturnSessionContinuity(kase, observation, 'current', 'missing'),
    ).toEqual({ pass: true, failures: [] });
  });

  it('a zero-coverage floor discloses zero and retains the fetched hot window', async () => {
    const observation = await runFreshFacadeReturnSession(
      DurableReturnSessionBackend.current(kase),
      { summaryMode: 'zero_coverage' },
    );

    expect(observation.summaryInjection.summarisedTurns).toBe(0);
    expect(observation.summaryInjection.section?.note).toContain(
      'conversation summary not yet generated',
    );
    expect(observation.contextPack.conversation.window).toMatchObject({
      shown: 20,
      available: 20,
      summarised: 0,
    });
    expect(observation.routedUserMessage).toContain('ORCHID-12');
    expect(observation.routedUserMessage).not.toContain('TENSION-SAFFRON');
    expect(observation.visibleAnswer).not.toContain('TENSION-SAFFRON');
    expect(observation.visibleAnswer).toContain(
      'no verified tension summary is available this turn',
    );
    expect(
      scoreReturnSessionContinuity(kase, observation, 'current', 'zero_coverage'),
    ).toEqual({ pass: true, failures: [] });
  });
});

describe('return-session continuity — prior-analysis currency survives facade reconstruction', () => {
  it('pins the current arm to equal hashes before checking routed behaviour', async () => {
    const backend = DurableReturnSessionBackend.current(kase);
    const durableBytesBefore = backend.snapshotBytes();
    const [analysis, accepted] = backend.primaryFacts();

    expect(backend.hashes.graph_hash_at_analysis).toBe(backend.hashes.current_graph_hash);
    expect(accepted!.fact.fact_type).toBe('set_factor_value');
    expect(analysis!.fact.fact_type).toBe('run_analysis');
    expect(
      (analysis!.fact.result as { graph_hash_at_run?: unknown }).graph_hash_at_run,
    ).toBe(backend.hashes.graph_hash_at_analysis);
    expect(accepted!.fact_created_at < analysis!.fact_created_at).toBe(true);

    const observation = await runFreshFacadeReturnSession(backend);
    expect(backend.snapshotBytes()).toBe(durableBytesBefore);
    const freshness = observation.context.persisted_analysis_freshness;

    expect(freshness.graph_hash_at_run).not.toBeNull();
    expect(freshness.graph_hash_at_run).toBe(freshness.current_graph_hash);
    expect(freshness.freshness).toBe('fresh');
    expect(observation.contextPack.coaching_context?.freshness).toBe('fresh');
    expect(
      observation.contextPack.display_graph.nodes.find(
        (node) => node.id === kase.accepted_change.target_id,
      ),
    ).toMatchObject({ display_value: '42 specialists' });
    expect(observation.routedUserMessage).toContain(
      '"display_value": "42 specialists"',
    );
    expect(scoreReturnSessionContinuity(kase, observation, 'current').pass).toBe(true);
  });

  it('pins the stale arm to unequal hashes before checking routed behaviour', async () => {
    const backend = DurableReturnSessionBackend.stale(kase);
    const durableBytesBefore = backend.snapshotBytes();
    const [laterChange, analysis, accepted] = backend.primaryFacts();

    expect(backend.hashes.graph_hash_at_analysis).not.toBe(
      backend.hashes.current_graph_hash,
    );
    expect(accepted!.fact.fact_type).toBe('set_factor_value');
    expect(analysis!.fact.fact_type).toBe('run_analysis');
    expect(laterChange!.fact.fact_type).toBe('set_factor_value');
    expect(
      (analysis!.fact.result as { graph_hash_at_run?: unknown }).graph_hash_at_run,
    ).toBe(backend.hashes.graph_hash_at_analysis);
    expect(accepted!.fact_created_at < analysis!.fact_created_at).toBe(true);
    expect(analysis!.fact_created_at < laterChange!.fact_created_at).toBe(true);

    const observation = await runFreshFacadeReturnSession(backend);
    expect(backend.snapshotBytes()).toBe(durableBytesBefore);
    const freshness = observation.context.persisted_analysis_freshness;
    const persistedGraph = observation.context.persistedGraph as {
      readonly nodes?: ReadonlyArray<{
        readonly id?: unknown;
        readonly observed_state?: { readonly value?: unknown };
      }>;
    } | null;
    const persistedFactor = persistedGraph?.nodes?.find(
      (node) => node.id === kase.accepted_change.target_id,
    );

    expect(freshness.graph_hash_at_run).not.toBeNull();
    expect(freshness.current_graph_hash).not.toBeNull();
    expect(freshness.graph_hash_at_run).not.toBe(freshness.current_graph_hash);
    expect(freshness.freshness).toBe('stale');
    expect(observation.contextPack.coaching_context?.freshness).toBe('stale');
    expect(observation.routedUserMessage).toContain('analysis_not_current_note');
    expect(observation.routedUserMessage).toContain(
      'these figures are from an earlier analysis run and are not licensed as current',
    );
    expect(observation.visibleAnswer).toContain('Prior analysis: stale.');
    expect(observation.visibleAnswer).not.toContain('Prior analysis: current.');
    expect(persistedFactor?.observed_state?.value).toBe(48);
    expect(
      observation.contextPack.display_graph.nodes.find(
        (node) => node.id === kase.accepted_change.target_id,
      ),
    ).toMatchObject({ display_value: '48 specialists' });
    expect(observation.routedUserMessage).toContain(
      '"display_value": "48 specialists"',
    );
    expect(observation.visibleAnswer).toContain(
      'Support capacity changed from 42 to 48 specialists after that analysis.',
    );
    expect(scoreReturnSessionContinuity(kase, observation, 'stale').pass).toBe(true);

    const afterSecondFacadeSet = await runFreshFacadeReturnSession(backend);
    expect(backend.snapshotBytes()).toBe(durableBytesBefore);
    expect(afterSecondFacadeSet.contextPack).toEqual(observation.contextPack);
    expect(
      scoreReturnSessionContinuity(kase, afterSecondFacadeSet, 'stale').pass,
    ).toBe(true);

    const runnerUpProbability = observation.contextPack.display_analysis?.runner_up
      ?.win_probability;
    expect(runnerUpProbability).toBe('32%');
    const misboundDisplay = {
      ...observation,
      contextPack: {
        ...observation.contextPack,
        display_analysis: {
          ...observation.contextPack.display_analysis!,
          leading_option: {
            ...observation.contextPack.display_analysis!.leading_option!,
            win_probability: runnerUpProbability!,
          },
        },
      },
    };
    expect(
      scoreReturnSessionContinuity(kase, misboundDisplay, 'stale').failures,
    ).toContain('display-safe leading analysis is not bound to its persisted probability');

    const lyingVisibleAnswer = {
      ...observation,
      visibleAnswer: observation.visibleAnswer.replace(
        'Prior analysis: stale.',
        'Prior analysis: current.',
      ),
    };
    const lyingScore = scoreReturnSessionContinuity(
      kase,
      lyingVisibleAnswer,
      'stale',
    );
    expect(lyingScore.pass).toBe(false);
    expect(lyingScore.failures).toContain(
      'stale context was presented as current in the visible answer',
    );
  });

  it('rejects a stored analysis fact bound to any hash but the analysis-time graph', async () => {
    const observation = await runFreshFacadeReturnSession(
      DurableReturnSessionBackend.current(kase),
    );
    const wrongHashObservation = structuredClone(observation);
    const storedAnalysis = wrongHashObservation.context.prior_facts.find(
      (fact) => fact.fact_type === 'run_analysis',
    );
    expect(storedAnalysis).toBeDefined();
    (storedAnalysis!.result as { graph_hash_at_run: string }).graph_hash_at_run =
      '0000000000000000';

    const score = scoreReturnSessionContinuity(
      kase,
      wrongHashObservation,
      'current',
    );
    expect(score.pass).toBe(false);
    expect(score.failures).toContain(
      'stored analysis hash was not bound to the durable analysis-time graph',
    );
  });
});

describe('return-session continuity — ablations prove the floor has teeth', () => {
  const mutants: ReadonlyArray<{
    readonly mutant: Exclude<ReturnSessionMutant, 'none'>;
    readonly expectedFailure: RegExp;
  }> = [
    {
      mutant: 'drop_graph_and_brief',
      expectedFailure: /persisted brief missing|canonical graph node missing/,
    },
    {
      mutant: 'drop_causal_edge',
      expectedFailure: /causal edge|causal relationship missing/,
    },
    {
      mutant: 'drop_summary_wire',
      expectedFailure: /unresolved tension missing/,
    },
    {
      mutant: 'drop_facts',
      expectedFailure: /accepted change fact missing|prior analysis winner missing/,
    },
    {
      mutant: 'drop_fact_row_filter',
      expectedFailure: /foreign out-of-window fact/,
    },
    {
      mutant: 'cross_scenario_read',
      expectedFailure: /escaped the requested scenario|other-scenario/,
    },
    {
      mutant: 'drop_precedence_instruction',
      expectedFailure: /canonical-over-conversation instruction missing/,
    },
    {
      mutant: 'echo_obsolete_as_current',
      expectedFailure: /visible answer promoted or omitted obsolete transcript/,
    },
  ];

  it.each(mutants)('$mutant is rejected', async ({ mutant, expectedFailure }) => {
    const observation = await runFreshFacadeReturnSession(
      DurableReturnSessionBackend.current(kase),
      { mutant },
    );
    const score = scoreReturnSessionContinuity(kase, observation, 'current');

    expect(score.pass).toBe(false);
    expect(score.failures.join('\n')).toMatch(expectedFailure);
  });
});
