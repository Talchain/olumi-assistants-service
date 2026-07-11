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
 *
 * SCAN SOURCE — the LIVE working tree, deliberately (not `git ls-files`).
 * The guard's job is to catch a NEW ad-hoc caller the moment it appears; a
 * brand-new *untracked* `.ts` under src/ referencing one of these authorities
 * is exactly that case, and a `git ls-files` scan would be blind to it until
 * the file was staged. The trade-off: a developer with UNRELATED uncommitted
 * `.ts` under src/ that happens to reference one of these three symbols can
 * see a local red before committing. That is a true signal about their tree,
 * not a false one; CI runs on a clean checkout so it never fires spuriously
 * there. If it ever surprises you locally, the failure diff names the exact
 * file — commit or remove it, or update EXPECTED if the caller is intended.
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
    // 2026-07-08 lane-34: +1 — the GM held-execute resume re-derives wire
    // freshness against the POST-APPLY graph hash after its mid-turn commit
    // (the pre-derived frame value is stale by definition once the confirmed
    // mutation persists; mirrors edit-graph-dispatch's blocked-path
    // re-derivation). Deliberate, reviewed; migrate with the frame-consumer
    // audit, do not add more.
    // 2026-07-11 consent-clarity: +1 — `commitGmHeldResumeAll` ("all of
    // them" over multiple GM holds) re-derives wire freshness against the
    // FINAL post-apply graph hash after its sequential mid-turn applies,
    // for exactly the lane-34 reason above (same seam, plural form).
    // Deliberate, reviewed; migrate with the frame-consumer audit, do not
    // add more.
    'src/orchestrator-v5/turn-executor.ts': 5, // approved assembly seam (frozen file)
    'src/orchestrator-v5/handlers/chip-click-dispatch.ts': 3, // TOLERATED ad-hoc debt — do not add more
    // 2026-07-07 lane-8: +2 — the GM referee gate's pre-edit freshness
    // re-projection (strict persisted-base frame authority for the referee's
    // R2 stale gate; see edit-graph-referee-gate.ts + lane-8 evidence report).
    // Deliberate, reviewed; still ad-hoc debt — migrate with the frame-consumer
    // audit, do not add more.
    // 2026-07-09 overnight-review F5+F6: +1 — the goal-target receipt
    // guard's swap-withheld branch re-derives freshness against
    // `gmFrameBase` (the PRE-edit persisted base — what actually still
    // persists when the write is withheld), mirroring the existing
    // GM-blocked branch's own re-derivation a few lines above for the
    // identical reason (freshness must never reflect a graph that never
    // persisted; wire previously carried `graph: null` alongside a phantom
    // post-edit hash the client could never observe). Deliberate, reviewed;
    // still ad-hoc debt — migrate with the frame-consumer audit, do not add
    // more.
    'src/orchestrator-v5/handlers/edit-graph-dispatch.ts': 5,
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
edit-graph-dispatch.ts x2 call sites) are FROZEN as tolerated debt pending the
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
