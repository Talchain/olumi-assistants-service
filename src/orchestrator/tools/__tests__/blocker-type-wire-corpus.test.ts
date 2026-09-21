/**
 * THE OUTSIDE-THE-LIST HALF. A derived guard proves the copies AGREE; it can
 * never prove the list is RIGHT.
 *
 * `blocker-type-vocabulary-derived.test.ts` derives the mapper's table from
 * `AnalysisBlockerType`, so the two can no longer disagree. That is necessary
 * and it is structurally blind to a SHORT authority: if the enum itself were
 * missing a member the product really emits, every derived guard stays green,
 * because they all agree with the same short list. (The estate has measured this
 * exact shape once already — a canonical magnitude map missing `thousand` left
 * every derived guard green, and only a hand-written corpus noticed.)
 *
 * So this spec enumerates from somewhere the enum's author cannot reach: the
 * BYTES THE PRODUCT ACTUALLY EMITTED, banked in this repo's committed wire
 * captures. Nothing here is copied from a TypeScript source.
 *
 * ⚠ THE CAPTURES ARE EVIDENCE, NOT FIXTURES (trap 14b). They are read and never
 * written. One of them says so in its own first key: "HISTORIC WIRE CAPTURE —
 * APPEND ONLY, NEVER EDIT … rewriting one to keep a test green would falsify the
 * record." If a future change would require editing a capture to keep this spec
 * green, that is a FINDING TO REPORT, not an edit to make.
 *
 * ⚠⚠ THE LIMIT OF THIS CORPUS, STATED PRECISELY, BECAUSE A CAPTURE PROVES ONLY
 * WHAT IT WAS POINTED AT (trap 16). Measured at this tip across 133 committed
 * JSON files under the roots below: 38 `blocker_type` occurrences in 8 capture
 * files, and EVERY ONE OF THEM IS `missing_value`. The other three published
 * members — `ambiguous_value`, `missing_connection`, `constraint_dropped` —
 * have NEVER been wire-witnessed in committed evidence; they exist only in
 * hand-authored `.ts` written alongside the enum. So this corpus genuinely
 * certifies the mapper over `missing_value` and over the FIVE-member status
 * vocabulary (all five ARE witnessed here), and it certifies nothing about the
 * other three blocker types. It will catch the day a capture lands carrying a
 * token the mapper cannot name — which is the drift a derived guard cannot see.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { blockerIssue } from '../analysis-ready-helper.js';
import { AnalysisReadyStatus } from '../../../schemas/analysis-ready.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * The evidence roots this corpus reads. This is a SEARCH SCOPE, not a list of
 * expected values — nothing here states what the captures should contain, so it
 * cannot mirror the vocabulary it is checking. A capture added under any of
 * these roots is picked up with no edit to this file.
 */
const EVIDENCE_ROOTS = [
  'Docs/v5/evidence',
  'src/orchestrator-v5/__tests__/fixtures',
  'src/orchestrator-v5/compose/__tests__/fixtures',
  'tests/unit/ci/fixtures',
  'tests/fixtures',
  'acceptance-evidence',
  'tools/fixtures',
] as const;

/** Floors derived by measurement at this tip, asserted as `>=` so the corpus may
 *  only GROW. A shrink REDs — which is the append-only property, enforced. */
const MIN_CAPTURE_FILES = 8;
const MIN_BLOCKER_OCCURRENCES = 38;

interface Observed {
  readonly blockerTypes: Map<string, number>;
  readonly statuses: Map<string, number>;
  readonly filesWithBlockers: string[];
  readonly jsonFilesRead: number;
}

function collectJsonFiles(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // a root that does not exist contributes nothing; the floors catch a wholesale loss
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectJsonFiles(full, out);
    else if (entry.name.endsWith('.json')) out.push(full);
  }
}

function observeCorpus(): Observed {
  const files: string[] = [];
  for (const root of EVIDENCE_ROOTS) collectJsonFiles(join(REPO_ROOT, root), files);

  const blockerTypes = new Map<string, number>();
  const statuses = new Map<string, number>();
  const filesWithBlockers: string[] = [];
  let jsonFilesRead = 0;

  const bump = (map: Map<string, number>, key: string): void => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  const walk = (node: unknown, found: { any: boolean }): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, found);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'blocker_type' && typeof value === 'string') {
        bump(blockerTypes, value);
        found.any = true;
      }
      if (key === 'status' && typeof value === 'string') bump(statuses, value);
      walk(value, found);
    }
  };

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    jsonFilesRead += 1;
    const found = { any: false };
    walk(parsed, found);
    if (found.any) filesWithBlockers.push(file);
  }

  return { blockerTypes, statuses, filesWithBlockers, jsonFilesRead };
}

const CORPUS = observeCorpus();

describe('wire-capture corpus — the mapper is checked against bytes, not against the enum', () => {
  it('NON-VACUITY: the corpus actually read captures and actually found blockers', () => {
    // An absence probe that found nothing is indistinguishable from one that
    // could not look (trap 13). Every assertion below is worthless without this.
    expect(CORPUS.jsonFilesRead).toBeGreaterThan(0);
    expect(CORPUS.filesWithBlockers.length).toBeGreaterThanOrEqual(MIN_CAPTURE_FILES);

    const total = [...CORPUS.blockerTypes.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(MIN_BLOCKER_OCCURRENCES);
  });

  it('every blocker_type ever recorded on the wire is one this mapper can name', () => {
    expect(CORPUS.blockerTypes.size).toBeGreaterThan(0);

    for (const [observed, count] of CORPUS.blockerTypes) {
      const issue = blockerIssue(
        {
          option_id: 'opt_corpus',
          option_label: 'Corpus Option',
          factor_id: 'fac_corpus',
          factor_label: 'Corpus Factor',
          blocker_type: observed,
        },
        0,
        'needs_user_input',
      );

      expect(
        issue,
        `blocker_type "${observed}" appears ${count}× in committed wire captures but the readiness authority cannot map it`,
      ).not.toBeNull();
      // Recorded on the wire means the product genuinely emitted it, so it is a
      // real gap and must not surface as an internal fault.
      expect(issue?.code, `blocker_type "${observed}"`).not.toBe('INTERNAL_ERROR');
    }
  });

  it('every analysis-ready status recorded on the wire parses under the published enum', () => {
    const published = new Set<string>(AnalysisReadyStatus.options);
    const witnessed = [...CORPUS.statuses.keys()].filter((s) => published.has(s));

    // All five published members are witnessed in these captures, so this is a
    // genuinely discriminating corpus for the STATUS vocabulary — unlike the
    // blocker vocabulary, where only `missing_value` has ever been seen.
    expect(witnessed.length).toBe(published.size);

    for (const status of witnessed) {
      expect(AnalysisReadyStatus.safeParse(status).success, `status "${status}"`).toBe(true);
    }
  });

  it('records what the corpus can and cannot certify, so the gap is visible not assumed', () => {
    // Deliberately asserts the SHAPE of the evidence rather than hiding it: the
    // day a second blocker_type is witnessed, this REDs and whoever is here must
    // re-read the scope note at the top rather than inherit it.
    expect([...CORPUS.blockerTypes.keys()].sort()).toEqual(['missing_value']);
  });
});
