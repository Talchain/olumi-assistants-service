/**
 * Test support for the run-turn fragile-link challenge: loads the TRIMMED,
 * served agent-lane wire fixtures (c19, CEE `8428207`, `POST /agent/v1/turn`)
 * and turns one Run turn into the pass-through's two inputs.
 *
 * ⚠ THE CAPTURE IS RECONSTRUCTED, AND SAYS SO. The source files hold the ROUTE
 * response only, not the internal `/orchestrate/v2/turn` run response the
 * Runtime hands to `captureAnalysis`. The capture is therefore built from the
 * same turn's `analysis_state` + `analysis_result` — the same run (identical
 * scenario, hash and computed_at), which is exactly what the identity checks
 * bind. Every value is the served wire's, byte-for-byte; nothing is invented.
 *
 * Fixtures beyond c19 A/B (each file's `_provenance.why_this_fixture` says why):
 *   · C   — c19 scenario A's typed Run on the approved model: a NEAR TIE with one fragile edge.
 *   · c16 — CEE `fd312b5`: fragile edges on a clear winner (the DSK-P-003 badge's positive control).
 *   · c10 — CEE `d2afc2c`: NO fragile edge, robust_edges present, a near tie (the no-flagged-link card).
 *   · c11 — CEE `0415b19`: NO fragile edge, robust_edges present, not a near tie (the same card).
 *   · paul    — CEE `bdd43f4`: Paul's manual test 1a298d6d (scenario cbd15f83), the AUTOMATIC first pass,
 *               leader withheld for a limit that could not be checked. Served a fragile-link card.
 *   · pricing — CEE `06325c6`: the same brief shape; t1 automatic first pass and t2 explicit Run, both
 *               withheld for the limit. Both served a fragile-link card.
 *   · hiring  — CEE `4809203`: NO limit problem; t1 automatic pass withheld only because nobody asked,
 *               t2 explicit near tie. Both served a fragile-link card (controls that must keep it).
 *   · hiring_tie — CEE `3829c96` (R&C served check, 26 Sep 01:03Z): the same brief, t1 automatic first
 *               pass, a NEAR TIE with ZERO fragile rows (9 robust). Served NO card
 *               (`edge_sensitivity_not_evidenced`): the confinement drops `display_verdict`.
 */
import { readFileSync } from 'node:fs';

import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';

import type { CapturedAnalysis, RunTurnCoachingFinal } from '../../agent-lane/analysis-coaching-pass-through.js';
import { runTurnCoaching } from '../../agent-lane/analysis-coaching-pass-through.js';
import { buildAnalysisResultBlock } from '../../compose.js';
import { buildAutoRunProvenance } from '../../context/run-initiator.js';
import { RUN_TURN_COACHING_CONTRACT, type RunTurnTrigger } from '../fragile-link-challenge.js';

export interface TrimmedRunTurn {
  readonly tools_called: readonly string[];
  readonly graph_hash: string;
  readonly analysis_state: { readonly run_state: { readonly kind: string; readonly computed_at: string } } & Record<string, unknown>;
  readonly analysis_ready: { readonly options: readonly { readonly option_id: string; readonly label: string }[] } & Record<string, unknown>;
  readonly analysis_result: {
    readonly type: 'analysis_result';
    readonly computed_against_hash: string;
    readonly enrichment: { readonly robustness: { readonly fragile_edges: readonly Record<string, unknown>[] } & Record<string, unknown> } & Record<string, unknown>;
  } & Record<string, unknown>;
  /** The run-turn card signal_ids the SERVED build emitted on this turn (newer fixtures only). */
  readonly served_run_turn_cards?: readonly string[];
}

export interface TrimmedRunTurnFixture {
  readonly _provenance: Record<string, unknown>;
  readonly scenario_id: string;
  readonly turns: Readonly<Record<string, TrimmedRunTurn>>;
}

export type FixtureLetter = 'A' | 'B' | 'C' | 'c16' | 'c10' | 'c11' | 'paul' | 'pricing' | 'hiring' | 'hiring_tie';

export const FIXTURE_FILES: Readonly<Record<FixtureLetter, string>> = {
  A: 'c19-8428207-A.run-turns.trimmed.json',
  B: 'c19-8428207-B.run-turns.trimmed.json',
  C: 'c19-8428207-C.run-turns.trimmed.json',
  c16: 'c16-fd312b5-A.run-turns.trimmed.json',
  c10: 'c10-d2afc2c-A.run-turns.trimmed.json',
  c11: 'c11-0415b19-A.run-turns.trimmed.json',
  paul: 'cbd15f83-bdd43f4-paul.run-turns.trimmed.json',
  pricing: 'pricing-7212945c-06325c6.run-turns.trimmed.json',
  hiring: 'hiring-fc9312a3-4809203.run-turns.trimmed.json',
  hiring_tie: 'hiring-be08d688-3829c96.run-turns.trimmed.json',
};

export const PAYLOAD_FILE = 'fragile-link-challenge.payload.json';

export function fixtureUrl(name: string): URL {
  return new URL(`./fixtures/${name}`, import.meta.url);
}

export function loadRunTurnFixture(letter: FixtureLetter): TrimmedRunTurnFixture {
  return JSON.parse(readFileSync(fixtureUrl(FIXTURE_FILES[letter]), 'utf8')) as TrimmedRunTurnFixture;
}

export interface RunTurnCase {
  readonly fixture: TrimmedRunTurnFixture;
  readonly turn: TrimmedRunTurn;
  readonly captured: CapturedAnalysis;
  readonly final: RunTurnCoachingFinal;
}

/** One served Run turn as (capture, final readback). Fresh clones every call. */
export function runTurnCase(letter: FixtureLetter, turnKey: string, trigger?: RunTurnTrigger): RunTurnCase {
  const fixture = loadRunTurnFixture(letter);
  const turn = fixture.turns[turnKey];
  if (turn === undefined) throw new Error(`fixture ${letter} has no turn ${turnKey}`);
  const captured: CapturedAnalysis = {
    scenario_id: fixture.scenario_id,
    status: 200,
    analysis_state: structuredClone(turn.analysis_state),
    analysis_ready: structuredClone(turn.analysis_ready),
    blocks: [structuredClone(turn.analysis_result)],
    ...(trigger !== undefined ? { trigger } : {}),
  };
  const final: RunTurnCoachingFinal = {
    scenarioId: fixture.scenario_id,
    graphHash: turn.graph_hash,
    analysisState: structuredClone(turn.analysis_state),
    analysisResult: structuredClone(turn.analysis_result),
  };
  return { fixture, turn, captured, final };
}

/**
 * The same served run as the AUTOMATIC first pass would carry it: the turn's
 * result re-built by the REAL block builder (`buildAnalysisResultBlock`) from a
 * run fact stamped automatic, so the readback is the confined shape
 * (`unrequested-analysis-confinement.ts`: robustness keeps only fragile_edges,
 * robust_edges and near_tie; near_tie loses its option ids; no
 * win_probabilities; leader withheld). Capture and readback are that one block.
 */
export function firstPassCase(
  letter: FixtureLetter,
  turnKey: string,
  /** Applied to a clone of the served result BEFORE the block builder confines it. */
  mutateSource: (result: Record<string, any>) => void = () => {},
): RunTurnCase {
  const base = runTurnCase(letter, turnKey, 'auto_first_pass');
  const result = structuredClone(base.turn.analysis_result) as Record<string, any> & { enrichment: Record<string, unknown> };
  mutateSource(result);
  const fact = RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: base.fixture.scenario_id,
      computed_at: base.turn.analysis_state.run_state.computed_at,
      graph_hash_at_run: base.turn.graph_hash,
      leading_option_id: result.leading_option_id,
      summary: result.summary,
      win_probabilities: result.win_probabilities,
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
      enrichment: { ...structuredClone(result.enrichment), run_provenance: buildAutoRunProvenance('11111111-1111-4111-8111-111111111111') },
    },
  });
  const block = buildAnalysisResultBlock(fact, base.turn.analysis_ready);
  return {
    ...base,
    captured: { ...base.captured, blocks: [structuredClone(block)] },
    final: { ...base.final, analysisResult: structuredClone(block) },
  };
}

/**
 * The committed payload, regenerated from the REAL producer + pass-through.
 * Deterministic: no clock, no randomness — the block identity is derived from
 * the run's own hash and computed_at.
 */
export function buildFragileLinkChallengePayload(): Record<string, unknown> {
  const run = (letter: FixtureLetter, turnKey: string, trigger: RunTurnTrigger) => {
    const c = runTurnCase(letter, turnKey, trigger);
    return runTurnCoaching(c.captured, c.final);
  };
  const a = loadRunTurnFixture('A');
  const b = loadRunTurnFixture('B');
  const c16 = loadRunTurnFixture('c16');
  return {
    _provenance: {
      generated_by: 'src/orchestrator-v5/coaching/__tests__/fragile-link-challenge.test.ts (golden payload test)',
      producer: 'runTurnCoaching (agent-lane/analysis-coaching-pass-through.ts) -> buildFragileLinkChallenge (coaching/fragile-link-challenge.ts)',
      served_build: 'CEE 8428207aa3e5524bb7c2ca482b9694af4b40f246 (staging)',
      route: 'POST /agent/v1/turn',
      inputs: {
        explicit_run: { fixture: FIXTURE_FILES.B, turn: 't2', trigger: 'explicit_run', source: b._provenance.source_file, source_sha256: b._provenance.source_sha256 },
        auto_first_pass: { fixture: FIXTURE_FILES.B, turn: 't2', trigger: 'auto_first_pass', source: b._provenance.source_file, source_sha256: b._provenance.source_sha256 },
        permitted_explicit_run: { fixture: FIXTURE_FILES.A, turn: 't5', trigger: 'explicit_run', source: a._provenance.source_file, source_sha256: a._provenance.source_sha256 },
        clear_winner_explicit_run: { fixture: FIXTURE_FILES.c16, turn: 't5', trigger: 'explicit_run', source: c16._provenance.source_file, source_sha256: c16._provenance.source_sha256 },
      },
      capture_note: 'Each capture is reconstructed from the same served turn (see fragile-link-challenge-fixtures.ts).',
    },
    contract_version: RUN_TURN_COACHING_CONTRACT.version,
    explicit_run: run('B', 't2', 'explicit_run'),
    auto_first_pass: run('B', 't2', 'auto_first_pass'),
    permitted_explicit_run: run('A', 't5', 'explicit_run'),
    // The one input that shows DSK-P-003's clear winner: the only badged card in the payload.
    clear_winner_explicit_run: run('c16', 't5', 'explicit_run'),
  };
}
