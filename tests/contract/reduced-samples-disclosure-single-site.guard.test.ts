/**
 * Single-consumption-site pin for the cage-owned reduced-samples presence
 * check (claim-safety ruling on parallel-briefs/W2-CLAIM-SAFETY-CASE.md,
 * Option B + the folded-in Option-A pin — 2026-07-11).
 *
 * `hasReducedSamplesDisclosure` (compose/claim-safety-cage.ts) is the ONLY
 * sanctioned way to presence-test the Tier-3 warning channel for the
 * SAMPLES_REDUCED_FOR_COMPLEXITY disclosure, and it is approved for exactly
 * ONE consumer: the run_analysis handler's deterministic caveat selection.
 * A second consumer widens the reviewed surface and requires a fresh
 * claim-safety review (Brief 4 §9) — this guard makes that a failing gate
 * instead of a silent drift, the same mechanic as
 * tier3-leak-guard.static.guard.test.ts.
 *
 * Auto-enrols in the required CI gate by living under tests/contract/.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

import { stripCommentsFile } from '../../scripts/ci/strip-source-comments.mjs';

const HELPER_NAME = 'hasReducedSamplesDisclosure';

const SRC_ROOT = fileURLToPath(new URL('../../src', import.meta.url));

/** Repo-relative (from src/) files allowed to mention the helper name. */
const OWNER_FILE = 'orchestrator-v5/compose/claim-safety-cage.ts';
const SOLE_CONSUMER_FILE = 'orchestrator-v5/tools/handlers/run-analysis.ts';

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

describe('reduced-samples disclosure — single consumption site (claim-safety pin)', () => {
  // Matching runs on the COMMENT-STRIPPED view (scripts/ci/
  // strip-source-comments.mjs): a comment naming the helper — e.g. a design
  // note explaining that presence-testing is capped to run-analysis — is
  // documentation, not a consumption site, and must not demand a
  // claim-safety review (the source-scanning-guard footgun,
  // positive-controlled 2026-07-20).
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

  it(`only the cage (owner) and run-analysis (sole approved consumer) reference ${HELPER_NAME}`, () => {
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
      `run-analysis.ts must reference ${HELPER_NAME} exactly twice (import + single call site). ` +
        `Found ${occurrences} — a second call site widens the reviewed surface (Brief 4 §9).`,
    ).toBe(2);
  });
});
