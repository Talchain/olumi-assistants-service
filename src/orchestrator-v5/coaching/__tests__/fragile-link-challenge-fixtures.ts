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
 */
import { readFileSync } from 'node:fs';

import type { CapturedAnalysis, RunTurnCoachingFinal } from '../../agent-lane/analysis-coaching-pass-through.js';
import { runTurnCoaching } from '../../agent-lane/analysis-coaching-pass-through.js';
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
}

export interface TrimmedRunTurnFixture {
  readonly _provenance: Record<string, unknown>;
  readonly scenario_id: string;
  readonly turns: Readonly<Record<string, TrimmedRunTurn>>;
}

export type FixtureLetter = 'A' | 'B';

export const FIXTURE_FILES: Readonly<Record<FixtureLetter, string>> = {
  A: 'c19-8428207-A.run-turns.trimmed.json',
  B: 'c19-8428207-B.run-turns.trimmed.json',
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
      },
      capture_note: 'Each capture is reconstructed from the same served turn (see fragile-link-challenge-fixtures.ts).',
    },
    contract_version: RUN_TURN_COACHING_CONTRACT.version,
    explicit_run: run('B', 't2', 'explicit_run'),
    auto_first_pass: run('B', 't2', 'auto_first_pass'),
    permitted_explicit_run: run('A', 't5', 'explicit_run'),
  };
}
