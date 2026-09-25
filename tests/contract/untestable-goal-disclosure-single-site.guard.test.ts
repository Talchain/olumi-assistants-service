/**
 * Single-consumption-site pin for the cage-owned untestable-goal presence check.
 *
 * `hasUntestableGoalDisclosure` (compose/claim-safety-cage.ts) presence-tests
 * PLoT's Tier-3 warning channel for GOAL_DIRECTION_UNATTESTED /
 * GOAL_THRESHOLD_NOT_CONVERTIBLE. Same claim-safety class as the reduced-samples
 * check (presence of the CODE only, nothing read from the entries), and pinned
 * the same way (reduced-samples-disclosure-single-site.guard.test.ts): it is
 * approved for exactly ONE consumer, the run_analysis headline builder, where it
 * can only WITHDRAW the "against your goal" claim. A second consumer widens the
 * reviewed surface and needs a fresh claim-safety review (Brief 4 §9), so it
 * fails here instead of drifting silently.
 *
 * Auto-enrols in the required CI gate by living under tests/contract/.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

import { stripCommentsFile } from '../../scripts/ci/strip-source-comments.mjs';

const HELPER_NAME = 'hasUntestableGoalDisclosure';

const SRC_ROOT = fileURLToPath(new URL('../../src', import.meta.url));

/** Repo-relative (from src/) files allowed to mention the helper name. */
const OWNER_FILE = 'orchestrator-v5/compose/claim-safety-cage.ts';
const SOLE_CONSUMER_FILE = 'orchestrator-v5/coaching/analysis-result-headline.ts';

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walkTsFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('untestable-goal disclosure — single consumption site (claim-safety pin)', () => {
  // Matching runs on the COMMENT-STRIPPED view, so a comment naming the helper
  // is documentation, not a consumption site.
  const referencingFiles = walkTsFiles(SRC_ROOT)
    .map((abs) => ({
      rel: relative(SRC_ROOT, abs).split('\\').join('/'),
      source: stripCommentsFile(abs),
    }))
    .filter(({ source }) => source.includes(HELPER_NAME));

  it('scans a real population (non-vacuous: owner + consumer both present)', () => {
    const rels = referencingFiles.map((f) => f.rel);
    expect(rels).toContain(OWNER_FILE);
    expect(rels).toContain(SOLE_CONSUMER_FILE);
  });

  it(`only the cage (owner) and the headline builder (sole approved consumer) reference ${HELPER_NAME}`, () => {
    for (const { rel } of referencingFiles) {
      expect(
        rel === OWNER_FILE || rel === SOLE_CONSUMER_FILE,
        `${rel}: references ${HELPER_NAME} but is not the cage owner or the single approved ` +
          `consumer. Presence-testing the Tier-3 warning channel from a new site requires a ` +
          `fresh claim-safety review (Brief 4 §9) — do not add the import; take the review.`,
      ).toBe(true);
    }
  });

  it('the sole consumer references the helper exactly twice (one import, one call)', () => {
    const consumer = referencingFiles.find((f) => f.rel === SOLE_CONSUMER_FILE);
    expect(consumer).toBeDefined();
    const occurrences = consumer!.source.split(HELPER_NAME).length - 1;
    expect(
      occurrences,
      `analysis-result-headline.ts must reference ${HELPER_NAME} exactly twice (import + single call site). ` +
        `Found ${occurrences} — a second call site widens the reviewed surface (Brief 4 §9).`,
    ).toBe(2);
  });
});
