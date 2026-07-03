/**
 * Anti-rederivation guard — context-frame containment (T4 Slice 1–3 follow-up).
 *
 * Freezes the exact population of src/ files that may reference the context
 * derivation authorities (`deriveAnalysisFreshness`,
 * `selectCanonicalAnalysisState`, `projectRecentChanges`). Context derivation
 * is single-sourced through the canonical context frame
 * (src/orchestrator-v5/context/frame/build-frame.ts, built once per turn at
 * the turn-executor finalise seam) and the approved assembly seams pinned
 * below. A NEW ad-hoc derivation call site is a build-red event, not a
 * convenience.
 *
 * Why identity + per-file counts (not a total-count ratchet): a total allows
 * swaps — one tolerated site migrates while a brand-new ad-hoc caller appears
 * elsewhere, total unchanged, gate green. Pinning {file → count} catches both
 * swaps and same-file growth. (The repo's shell ratchet,
 * scripts/check-forbidden-boundary-patterns.sh, documents exactly this
 * limitation of per-pattern totals.)
 *
 * Runs in the required CI unit gate (vitest.required.config.ts includes
 * tests/unit/**).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCAN_ROOT = 'src';

const EXCLUDED: readonly RegExp[] = [
  /\/__tests__\//,
  /\.test\.tsx?$/,
  /^src\/generated\//,
  /^src\/_archive\//,
];

// Comment-only filter — mirrors scripts/check-forbidden-boundary-patterns.sh
// scope_filter: a line whose first non-space token opens or continues a
// comment is not a reference. (A code line with a trailing comment still
// counts — the false-positive direction is the safe one.)
const COMMENT_ONLY = /^\s*(\/\/|\/\*|\*)/;

export function countReferences(source: string, ident: string): number {
  const re = new RegExp(`\\b${ident}\\b`);
  return source.split('\n').filter((l) => !COMMENT_ONLY.test(l) && re.test(l)).length;
}

function walk(relDir: string, out: string[]): void {
  for (const entry of readdirSync(join(REPO_ROOT, relDir), { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      walk(rel, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(rel);
    }
  }
}

function scanRepo(ident: string): Record<string, number> {
  const files: string[] = [];
  walk(SCAN_ROOT, files);
  const result: Record<string, number> = {};
  for (const rel of files.sort()) {
    if (EXCLUDED.some((re) => re.test(rel))) continue;
    const count = countReferences(readFileSync(join(REPO_ROOT, rel), 'utf-8'), ident);
    if (count > 0) result[rel] = count;
  }
  return result;
}

/**
 * THE FROZEN POPULATION. Non-comment lines referencing the identifier
 * (imports + calls + definition), per file. Changing this map is a reviewed
 * act in the same PR, never a convenience.
 */
const EXPECTED: Record<string, Record<string, number>> = {
  deriveAnalysisFreshness: {
    'src/orchestrator-v5/context/freshness.ts': 1, // authority (definition)
    'src/orchestrator-v5/build-turn-context.ts': 2, // approved seam (routing/coaching freshness)
    'src/orchestrator-v5/context/canonical-analysis-state.ts': 2, // approved seam (canonical-state composition)
    'src/orchestrator-v5/turn-executor.ts': 3, // approved assembly seam (frozen file)
    'src/orchestrator-v5/handlers/chip-click-dispatch.ts': 3, // TOLERATED ad-hoc debt — do not add more
    'src/orchestrator-v5/handlers/edit-graph-dispatch.ts': 2, // TOLERATED ad-hoc debt — do not add more
  },
  selectCanonicalAnalysisState: {
    'src/orchestrator-v5/context/canonical-analysis-state.ts': 1, // authority (definition)
    'src/orchestrator-v5/context/context-pack-assembler.ts': 2, // approved seam
    'src/orchestrator-v5/turn-executor.ts': 3, // approved assembly seam (frozen file)
  },
  projectRecentChanges: {
    'src/orchestrator-v5/context/recent-changes.ts': 1, // authority (definition)
    'src/orchestrator-v5/context/context-pack-assembler.ts': 2, // approved seam
  },
};

const guidance = (ident: string): string => `
NEW ad-hoc \`${ident}\` reference detected outside the approved context-assembly seams
(or an approved seam's reference count changed).

Context derivation is single-sourced through the canonical context frame
(src/orchestrator-v5/context/frame/build-frame.ts, built once per turn at the
turn-executor finalise seam) and the approved seams pinned in this test.
Do NOT re-derive freshness / canonical state / recent changes at your call site:
  - read the value from the CanonicalContextFrame / turn context you already hold, or
  - thread it from build-turn-context / the context-pack assembler.

The pre-existing ad-hoc sites (chip-click-dispatch.ts x2 call sites,
edit-graph-dispatch.ts x1 call site) are FROZEN as tolerated debt pending the
turn-executor frame-threading migration (see
Docs/t4/context-frame-consumer-migration-audit.md). They are not precedent.

If a reviewer agrees a new derivation seam is genuinely required, update the
EXPECTED map in tests/unit/orchestrator-v5/context/anti-rederivation-callsite-pin.test.ts
in the SAME PR and record the justification in the entry's comment. Never widen
it to hide growth.`;

describe('anti-rederivation call-site pin', () => {
  for (const [ident, expected] of Object.entries(EXPECTED)) {
    it(`\`${ident}\` is referenced only by the pinned files, with pinned per-file counts`, () => {
      expect(scanRepo(ident), guidance(ident)).toEqual(expected);
    });
  }

  // Scanner self-tests (mirrors the shell ratchet's --self-test philosophy):
  // prove the detector fires on code and NOT on comments, and that the word
  // boundary keeps `projectRecentChanges` from matching its Frame projection.
  it('scanner fires on code lines and ignores comment-only lines', () => {
    expect(countReferences('const x = deriveAnalysisFreshness([], null);', 'deriveAnalysisFreshness')).toBe(1);
    expect(countReferences("import { deriveAnalysisFreshness } from './freshness.js';", 'deriveAnalysisFreshness')).toBe(1);
    expect(countReferences(' * see deriveAnalysisFreshness for details', 'deriveAnalysisFreshness')).toBe(0);
    expect(countReferences('// deriveAnalysisFreshness', 'deriveAnalysisFreshness')).toBe(0);
    expect(countReferences('/* deriveAnalysisFreshness */', 'deriveAnalysisFreshness')).toBe(0);
  });

  it('word boundary: projectRecentChangesToFrame is NOT a projectRecentChanges reference', () => {
    expect(countReferences('projectRecentChangesToFrame(frame, changes)', 'projectRecentChanges')).toBe(0);
    expect(countReferences('projectRecentChanges(facts)', 'projectRecentChanges')).toBe(1);
  });
});
