/**
 * orchestrator-eval — the chassis.
 *
 * `runFixture` is the whole loop: assemble the fixture's raw analysis through
 * the PRODUCTION formatter, score every candidate deterministically, and check
 * each verdict against the fixture's `expected` map. `loadFixtures` reads the
 * checked-in fixture set. Both are pure / IO-light so the CLI and the vitest
 * suite share the exact same path.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleAnalysis } from './assemble.js';
import { scoreCandidate } from './scorer.js';
import type { FixtureReport, OrchestratorEvalFixture, ScoreResult } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The checked-in fixture directory (tools/orchestrator-eval/fixtures). */
export const FIXTURES_DIR = join(HERE, '..', 'fixtures');

/** Load every `*.json` fixture from `dir`, sorted by filename. */
export function loadFixtures(dir: string = FIXTURES_DIR): OrchestratorEvalFixture[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as OrchestratorEvalFixture);
}

/** Assemble + score one fixture; report assembly fidelity and per-candidate agreement. */
export function runFixture(fixture: OrchestratorEvalFixture): FixtureReport {
  const assembled = assembleAnalysis(fixture.analysis);
  const leading = assembled?.leading_option;
  const winProb = leading?.win_probability ?? null;
  const targetFit = leading?.target_fit ?? null;
  const goalFitProse = assembled?.goal_fit ?? null;

  // The fix, observed on the assembled output: win% and target-fit are two
  // distinct rendered values (not the same number reused for both).
  const distinguishesWinFromTargetFit =
    winProb !== null && targetFit !== null && winProb !== targetFit;

  const scores: ScoreResult[] = fixture.candidates.map((c) =>
    scoreCandidate(fixture.analysis, c),
  );

  const agreement: Record<string, boolean> = {};
  for (const s of scores) {
    const expected = fixture.expected[s.candidate];
    // Unlisted candidates are informational (agreement defaults to true).
    agreement[s.candidate] = expected === undefined ? true : s.pass === expected;
  }
  const ok = Object.values(agreement).every(Boolean);

  return {
    fixtureId: fixture.id,
    assembly: { leadingWinProbability: winProb, leadingTargetFit: targetFit, goalFitProse, distinguishesWinFromTargetFit },
    scores,
    agreement,
    ok,
  };
}
