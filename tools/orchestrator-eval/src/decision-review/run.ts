/**
 * orchestrator-eval — decision_review fixture loading, extraction and the
 * fixture-regression loop.
 *
 * Mirrors `src/run.ts` (the routing chassis) so both tasks share one shape:
 * load the checked-in pack, score every recorded candidate, and compare each
 * verdict against the fixture's `expected` map. A disagreement exits non-zero —
 * that disagreement is what proves a dimension still catches the drift it was
 * built to catch.
 *
 * decision_review adds ONE thing the routing loop does not have: a per-candidate
 * `expectedFailedDimensions` pin. With nineteen dimensions, "this candidate
 * fails" is far too weak a statement to prove a specific dimension works — a
 * candidate seeded to trip `no_dashes` could fail for an unrelated reason and
 * the fixture would still agree. Naming the dimension turns each seeded defect
 * into a RED-first proof of THAT dimension.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreDecisionReview } from './scorer.js';
import { assembleDecisionReviewUserMessage, sectionsPresent } from './assemble.js';
import type { ScoreResult } from '../types.js';
import type { ExtractionMode } from '../task-adapter.js';
import type { DecisionReviewEvalFixture } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The checked-in decision_review fixture directory. */
export const DECISION_REVIEW_FIXTURES_DIR = join(HERE, '..', '..', 'fixtures', 'decision-review');

/** Load every `*.json` fixture from `dir`, sorted by filename. */
export function loadDecisionReviewFixtures(
  dir: string = DECISION_REVIEW_FIXTURES_DIR,
): DecisionReviewEvalFixture[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as DecisionReviewEvalFixture);
}

/**
 * Extract the decision_review output object from raw model text.
 *
 * The wire contract is "return ONLY a JSON object, no markdown fences"
 * (`decision_review.txt` OUTPUT_SCHEMA), but real models fence anyway, so
 * fences are tolerated exactly as the runtime's own extractor tolerates them.
 * Anything that does not yield a JSON OBJECT is `raw_unparsed` — flagged, never
 * silently skipped, and scored as a failed turn by the extraction contract.
 */
export function extractDecisionReviewOutput(raw: string): {
  output: Record<string, unknown> | null;
  extraction: ExtractionMode;
} {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return { output: parsed as Record<string, unknown>, extraction: 'json_text' };
    }
  } catch {
    // fall through
  }
  return { output: null, extraction: 'raw_unparsed' };
}

export interface DecisionReviewFixtureReport {
  readonly fixtureId: string;
  /**
   * Assembly fidelity: which PRODUCTION user-message sections this fixture
   * actually exercises, and how large the assembled message is. A fixture that
   * reaches none of the post-v11 sections is measuring the v11 surface no
   * matter what its description claims — so the pack shows it rather than
   * asserting it in prose.
   */
  readonly assembly: {
    readonly sections: readonly string[];
    readonly userMessageChars: number;
    readonly margin: number | null;
  };
  readonly scores: readonly ScoreResult[];
  readonly agreement: Readonly<Record<string, boolean>>;
  /**
   * Per-candidate RED-first agreement: did each candidate fail EXACTLY the
   * dimensions its fixture named? `true` when the fixture named none.
   */
  readonly dimensionAgreement: Readonly<Record<string, boolean>>;
  readonly ok: boolean;
}

/** Assemble + score one fixture; report assembly fidelity and both agreements. */
export function runDecisionReviewFixture(
  fixture: DecisionReviewEvalFixture,
): DecisionReviewFixtureReport {
  const { userMessage, margin } = assembleDecisionReviewUserMessage(fixture.input);

  const scores: ScoreResult[] = fixture.candidates.map((c) =>
    scoreDecisionReview({ output: c.output, input: fixture.input, candidateLabel: c.label }),
  );

  const agreement: Record<string, boolean> = {};
  const dimensionAgreement: Record<string, boolean> = {};
  for (const s of scores) {
    const expected = fixture.expected[s.candidate];
    agreement[s.candidate] = expected === undefined ? true : s.pass === expected;

    const expectedFailed = fixture.expectedFailedDimensions?.[s.candidate];
    if (expectedFailed === undefined || expectedFailed.length === 0) {
      dimensionAgreement[s.candidate] = true;
    } else {
      const failed = new Set(s.dimensions.filter((d) => !d.pass).map((d) => d.name));
      dimensionAgreement[s.candidate] = expectedFailed.every((name) => failed.has(name));
    }
  }

  const ok =
    Object.values(agreement).every(Boolean) && Object.values(dimensionAgreement).every(Boolean);

  return {
    fixtureId: fixture.id,
    assembly: {
      sections: sectionsPresent(userMessage),
      userMessageChars: userMessage.length,
      margin,
    },
    scores,
    agreement,
    dimensionAgreement,
    ok,
  };
}
