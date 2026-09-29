/**
 * Single-consumption-site pin for the cage-owned withheld flip-threshold slot.
 *
 * `RUN_DELTA_FLIP_THRESHOLDS_NOT_COMPUTED` (compose/claim-safety-cage.ts) is
 * the ONLY sanctioned way to emit the ratified Tier-3 deny key
 * `flip_thresholds`, and it is approved for exactly ONE consumer: the
 * `run_delta` producer. The cage owns the literal so the producer carries none
 * and `tier3-leak-guard.static.guard.test.ts` stays MAXIMALLY STRICT — no
 * allow-list entry, no exemption, no weakening of the scan.
 *
 * ⚠⚠ WHY THIS GUARD EXISTS AT ALL, AND IT IS NOT ABOUT IMPORT HYGIENE.
 * The contract annotates the field "may be empty (no flip rows on either
 * side)", and Brief 4 §5 rules for this exact field **"Absence: not 'no
 * tipping point.'"** So the empty array is NOT a neutral placeholder — read
 * naively it ASSERTS there are no flip thresholds. The producer emits it
 * because the per-factor stability-band join is DEFERRED and it never looked.
 * **Populating this slot is a claim-safety change, not a wiring change**, and
 * a second consumer — or a producer that starts filling it — must go through a
 * fresh claim-safety review (Brief 4 §9). This guard makes that a failing gate
 * instead of a silent drift.
 *
 * Same mechanic and same shape as
 * `reduced-samples-disclosure-single-site.guard.test.ts`, deliberately: this is
 * the second instance of the cage-owns-the-literal pattern, and the two should
 * stay recognisably identical so a reader who knows one knows the other.
 *
 * Auto-enrols in the required CI gate by living under tests/contract/.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

import { stripCommentsFile } from '../../scripts/ci/strip-source-comments.mjs';
import { RUN_DELTA_FLIP_THRESHOLDS_NOT_COMPUTED } from '../../src/orchestrator-v5/compose/claim-safety-cage.js';

const CONSTANT_NAME = 'RUN_DELTA_FLIP_THRESHOLDS_NOT_COMPUTED';

const SRC_ROOT = fileURLToPath(new URL('../../src', import.meta.url));

/** Repo-relative (from src/) files allowed to mention the constant. */
const OWNER_FILE = 'orchestrator-v5/compose/claim-safety-cage.ts';
const SOLE_CONSUMER_FILE = 'orchestrator-v5/coaching/build-run-delta.ts';

/** The ratified Tier-3 deny key this constant exists to keep out of producers. */
const DENY_KEY = 'flip_thresholds';

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

describe('run_delta flip_thresholds — single consumption site (claim-safety pin)', () => {
  // Matching runs on the COMMENT-STRIPPED view: a comment naming the constant
  // is documentation, not a consumption site, and must not demand a review.
  const scanned = walkTsFiles(SRC_ROOT).map((abs) => ({
    rel: relative(SRC_ROOT, abs).split('\\').join('/'),
    source: stripCommentsFile(abs),
  }));
  const referencingFiles = scanned.filter(({ source }) => source.includes(CONSTANT_NAME));

  it('scans a real population (non-vacuous: owner + consumer both present)', () => {
    const rels = referencingFiles.map((f) => f.rel);
    expect(rels).toContain(OWNER_FILE);
    expect(rels).toContain(SOLE_CONSUMER_FILE);
  });

  it(`only the cage (owner) and the run_delta producer reference ${CONSTANT_NAME}`, () => {
    for (const { rel } of referencingFiles) {
      expect(
        rel === OWNER_FILE || rel === SOLE_CONSUMER_FILE,
        `${rel}: references ${CONSTANT_NAME} but is not the cage owner or the single approved ` +
          `consumer. Emitting the Tier-3 key from a new site requires a fresh claim-safety ` +
          `review (Brief 4 §9) — do not add the import; take the review.`,
      ).toBe(true);
    }
  });

  it('the sole consumer references the constant exactly twice (one import, one spread)', () => {
    const consumer = referencingFiles.find((f) => f.rel === SOLE_CONSUMER_FILE);
    expect(consumer).toBeDefined();
    const occurrences = consumer!.source.split(CONSTANT_NAME).length - 1;
    expect(
      occurrences,
      `build-run-delta.ts must reference ${CONSTANT_NAME} exactly twice (import + single ` +
        `spread). Found ${occurrences} — a second emission site widens the reviewed surface.`,
    ).toBe(2);
  });

  /**
   * ⭐ THE ONE THAT ACTUALLY PROTECTS THE CLAIM. The point of routing through
   * the cage is that NO producer carries the deny-key literal. If
   * `build-run-delta.ts` ever writes `flip_thresholds:` directly, the Tier-3
   * static scan would red — but it would red with a message about allow-listing,
   * and the tempting fix is an allow-list entry. This says the quiet part: the
   * producer must carry the literal ZERO times, and the remedy is the cage.
   */
  it('the producer carries the Tier-3 deny-key literal ZERO times', () => {
    const consumer = referencingFiles.find((f) => f.rel === SOLE_CONSUMER_FILE);
    expect(consumer).toBeDefined();
    const occurrences = consumer!.source.split(DENY_KEY).length - 1;
    expect(
      occurrences,
      `build-run-delta.ts carries the Tier-3 deny key \`${DENY_KEY}\` ${occurrences} time(s) in ` +
        `code. It must carry ZERO: the cage owns the literal (${CONSTANT_NAME}) precisely so the ` +
        `static Tier-3 scan can stay maximally strict. The remedy is the cage constant, NOT an ` +
        `allow-list entry.`,
    ).toBe(0);
    // Positive control: the OWNER does carry it, so a zero above is a real
    // absence in the producer and not a broken scan (CLAUDE.md trap 13).
    const owner = scanned.find((f) => f.rel === OWNER_FILE);
    expect(owner).toBeDefined();
    expect(owner!.source.split(DENY_KEY).length - 1).toBeGreaterThan(0);
  });

  it('the cage constant is frozen, and its array is frozen too', () => {
    expect(Object.isFrozen(RUN_DELTA_FLIP_THRESHOLDS_NOT_COMPUTED)).toBe(true);
    expect(Object.isFrozen(RUN_DELTA_FLIP_THRESHOLDS_NOT_COMPUTED.flip_thresholds)).toBe(true);
    expect(RUN_DELTA_FLIP_THRESHOLDS_NOT_COMPUTED.flip_thresholds).toEqual([]);
  });
});
