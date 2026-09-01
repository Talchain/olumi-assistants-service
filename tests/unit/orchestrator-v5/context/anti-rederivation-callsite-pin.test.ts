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

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  stripComments,
  stripCommentsFile,
  GUARD_WALK_TIMEOUT_MS,
} from '../../../../scripts/ci/strip-source-comments.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCAN_ROOT = 'src';

const EXCLUDED: readonly RegExp[] = [
  /\/__tests__\//,
  /\.test\.tsx?$/,
  /^src\/generated\//,
  /^src\/_archive\//,
];

// Comment handling: references are counted in the COMMENT-STRIPPED view of
// each file (scripts/ci/strip-source-comments.mjs, the shared literal-aware
// tokeniser — same mechanism as scripts/check-forbidden-boundary-patterns.sh).
// The per-line first-token filter this replaces could not see a TRAILING
// comment on a code line, so an accurate design note like
// `const x = 1; // freshness comes from deriveAnalysisFreshness` counted as a
// reference and broke the pin (positive-controlled 2026-07-20). With
// stripping, EXPECTED below counts exactly the code references — imports,
// calls, definitions — never documentation.
function countReferencesInStripped(stripped: string, ident: string): number {
  const re = new RegExp(`\\b${ident}\\b`);
  return stripped.split('\n').filter((l) => re.test(l)).length;
}

export function countReferences(source: string, ident: string): number {
  return countReferencesInStripped(stripComments(source), ident);
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
    const count = countReferencesInStripped(stripCommentsFile(join(REPO_ROOT, rel)), ident);
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
    // System B durable analysis authority: +1 call (import + five calls). The
    // added derivation stays inside the approved TurnExecutor assembly seam and
    // applies the existing freshness rule to the complete scenario-scoped fact
    // snapshot used only by ContextPack/model reasoning. Reusing the hot-window
    // policy result would lose >20-turn return continuity; replacing it would
    // change deterministic policy outside System B ownership.
    'src/orchestrator-v5/turn-executor.ts': 6,
    // 2026-07-22 dead-noop deletion: 3 → 2 — the deterministic no-op explanation
    // chip-click dispatch (`buildProjectionInputs`, removed as dead code
    // post-#619) held one of the three references (its own ad-hoc freshness
    // re-derivation). Deleting it drops a TOLERATED site; the surviving two are
    // the import + the live run_analysis path's re-derivation. Reduction, not
    // growth — the debt shrank.
    'src/orchestrator-v5/handlers/chip-click-dispatch.ts': 2, // TOLERATED ad-hoc debt — do not add more
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
    // 2026-07-20 part-accounting conservation law: +1 — the defect-B
    // substitution fail-closed branch re-derives freshness against
    // `gmFrameBase` (the PRE-edit persisted base). Identical reason and
    // identical shape to the GM-blocked and swap-withheld branches above:
    // when the law blocks a named-target substitution, NOTHING persists, so
    // the wire must not carry a post-edit hash for a graph that never
    // existed. Deliberate, reviewed; still ad-hoc debt — migrate with the
    // frame-consumer audit, do not add more.
    // 2026-08-17 ROADMAP 2.1266 wrong-entity write withhold: +1 — the
    // option-intervention misroute branch re-derives freshness against
    // `gmFrameBase` (the PRE-edit persisted base). Identical reason and
    // identical shape to the swap-withheld and substitution-blocked branches
    // above: the write is withheld, so NOTHING persists, and the wire must not
    // carry `complete_stale`/`graph_changed` off a mutation the store never
    // kept — which is precisely what the J4 t5 witness measured. Deliberate,
    // reviewed; still ad-hoc debt.
    // ⚠ HONEST NOTE, so the next lane inherits the intent and not the number:
    // three branches in this file now run a BYTE-IDENTICAL re-derivation
    // (swap-withheld, substitution-blocked, and this one). The right fix takes
    // this count DOWN by extracting one local helper for all three — it was
    // deliberately NOT done here because it would rewrite two branches this
    // lane does not own (scope-expansion rule). Do that before adding a fourth.
    'src/orchestrator-v5/handlers/edit-graph-dispatch.ts': 7,
    // 2026-08-15 Train C: +2 (import + one call) — edge_strength_edit commits
    // mid-turn, then derives wire freshness against the authoritative analysis
    // hash returned by that atomic commit. The pre-write context frame cannot
    // represent those post-write bytes. Prior facts are observational only:
    // a degraded read yields unknown and never authorises or blocks the write.
    // Deliberate new post-commit seam; migrate with the frame-consumer audit.
    // 2026-08-17 P0 L-22 (structural_delete writer): +1 (one call; the import
    // was already counted above) — `dispatchStructuralDelete` commits mid-turn
    // and then derives wire freshness against the authoritative analysis hash
    // that atomic commit returned, for EXACTLY the Train C reason directly
    // above: a structural removal always moves the analysis-affecting
    // projection, so the pre-write context frame cannot represent the
    // post-write bytes, and any prior analysis is out of date by construction.
    // Prior facts stay observational — a degraded read yields `unknown` and
    // never authorises or blocks the write. Same post-commit seam, third
    // instance; migrate with the frame-consumer audit, do not add more.
    // 2026-09-01 structural_add writer (#1275): +1 (one call; the import was
    // already counted above) — `dispatchStructuralAdd` is the FOURTH instance
    // of the same post-commit seam, and it is admitted for a DERIVED reason
    // rather than by symmetry with its siblings.
    //
    // WHY THIS ONE GENUINELY NEEDS THE DERIVATION. `nodes` and `options[]` are
    // both inside the analysis-affecting hash projection, so an add ALWAYS
    // moves that hash: any prior analysis is out of date by construction and
    // the currency verdict has to move with it. The pre-write context frame
    // therefore cannot represent the post-write bytes — the Train C /
    // structural_delete reason above, in the opposite direction (a removal and
    // an addition both move the projection).
    //
    // ⭐ AND THE CONTRAST THAT SHOWS THIS IS NOT A BLANKET WAIVER FOR THE
    // FAMILY: `dispatchStructuralRename`, added to this same file by #1273,
    // adds NO call here and issues no prior-facts read at all — a rename
    // provably cannot move the analysis hash (`label` is outside the
    // projection, pinned by `structural-rename.test.ts` → "the
    // analysis-affecting hash of the persisted bytes does NOT move"), so there
    // is no currency verdict to re-derive and the round trip would compute a
    // value that is then discarded. Two writers landed a day apart; only the
    // one whose bytes move the hash is admitted here. A future `structural_*`
    // writer must make the same argument at the projection, not cite this row.
    //
    // Prior facts stay observational — a degraded read yields `unknown` and
    // never authorises or blocks the write. Fourth instance of the seam and
    // the last one that should land ad-hoc; migrate with the frame-consumer
    // audit, do not add more.
    'src/orchestrator-v5/system-events/dispatch.ts': 4,
    // 2026-07-22 Lane C3: +2 (import + one call) — the typed add-option
    // transaction pre-route derives the PRE-edit frame freshness for its
    // referee gate against `computeAnalysisAffectingGraphHash(persistedGraph)`
    // (the SAME hash the referee frame + the held pending's `graph_hash`
    // precondition use), exactly mirroring edit-graph-dispatch's own
    // pre-edit frame re-derivation for the free-text edit gate. Consistent by
    // construction; reusing build-turn-context's decision-context freshness
    // would derive against a DIFFERENT hash. Deliberate, reviewed; still
    // ad-hoc debt — migrate with the frame-consumer audit, do not add more.
    'src/orchestrator/route-v2.ts': 2,
    // 2026-08-17 ROADMAP 2.1271: +2 (import + one call) — the scenario-graph
    // READ leg composes a scenario's analysis verdict OUTSIDE a turn, so the
    // guidance above ("read the value from the CanonicalContextFrame / turn
    // context you already hold, or thread it from build-turn-context") has no
    // referent here: there is no turn, no frame and no context to thread from.
    // The seam is a pure composition over `loadPriorFactsWithReadState` +
    // `computeAnalysisAffectingGraphHash(the graph this response is returning)`
    // — the SAME hash function the run path stamps as `graph_hash_at_run`, so
    // `fresh` on this leg means bit-for-bit what it means on a turn. It is NOT
    // a second rule about freshness; it is the one function applied to a
    // non-turn caller, which is why the alternative (hand-building a verdict at
    // the route) would have been the mirror this guard exists to prevent.
    // Deliberate, reviewed, and NOT precedent for a turn-path caller.
    'src/routes/scenario-graph-analysis-read.ts': 2,
  },
  selectCanonicalAnalysisState: {
    'src/orchestrator-v5/context/canonical-analysis-state.ts': 1, // authority (definition)
    'src/orchestrator-v5/context/context-pack-assembler.ts': 2, // approved seam
    // System B durable analysis authority: +1 call (import + three calls).
    // The new call remains inside the already-approved TurnExecutor assembly
    // seam and selects from the complete scenario-scoped fact snapshot solely
    // for ContextPack/model reasoning. It cannot reuse the existing hot-window
    // policy state without either losing >20-turn return continuity or changing
    // chips/recovery/finalisation policy owned by System A. No new caller file
    // or selector implementation is introduced.
    'src/orchestrator-v5/turn-executor.ts': 4,
  },
  projectRecentChanges: {
    'src/orchestrator-v5/context/recent-changes.ts': 1, // authority (definition)
    'src/orchestrator-v5/context/context-pack-assembler.ts': 2, // approved seam
    // 2026-08-11 PR2 L2 (rerun attribution): +2 (import + one call) — the
    // attribution join for the rerun consequence sentence, which must name the
    // authored change that landed between the two compared runs.
    //
    // ⭐ THIS IS THE INVERSE OF THE DEBT THIS PIN GUARDS. The tolerated sites
    // above are call sites that RE-DERIVE context ad-hoc. This one exists
    // specifically so the sentence does NOT re-derive: per-fact-type label
    // extraction, the noop filter, the mutation-vs-read dispatch and the
    // raw-identifier scrub all live in `recent-changes.ts` and are
    // conformance-tested there against the schema's whole `fact_type` union.
    // Re-implementing any of it in the signals layer would be the mirror defect
    // this pin was built to prevent, and would go blind the next time a
    // mutation handler is added. `RecentMutation.target_label`'s own
    // doc-comment declares this seam ("so future deterministic copy paths ...
    // can reference the target without regex-parsing the summary string").
    //
    // Reads the projection only; derives no freshness and no canonical state.
    'src/orchestrator-v5/coaching/intervening-change.ts': 2,
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

The pre-existing ad-hoc sites (chip-click-dispatch.ts x1 call site,
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
    }, GUARD_WALK_TIMEOUT_MS); // full-src tree walk; explicit timeout absorbs parallel-load CPU contention
  }

  // Scanner self-tests (mirrors the shell ratchet's --self-test philosophy):
  // prove the detector fires on code and NOT on comments, and that the word
  // boundary keeps `projectRecentChanges` from matching its Frame projection.
  it('scanner fires on code references and ignores comments (including trailing ones)', () => {
    expect(countReferences('const x = deriveAnalysisFreshness([], null);', 'deriveAnalysisFreshness')).toBe(1);
    expect(countReferences("import { deriveAnalysisFreshness } from './freshness.js';", 'deriveAnalysisFreshness')).toBe(1);
    expect(countReferences('// deriveAnalysisFreshness', 'deriveAnalysisFreshness')).toBe(0);
    expect(countReferences('/* deriveAnalysisFreshness */', 'deriveAnalysisFreshness')).toBe(0);
    expect(
      countReferences('/**\n * see deriveAnalysisFreshness for details\n */', 'deriveAnalysisFreshness'),
    ).toBe(0);
    // The case the old first-token line filter could NOT see — a trailing
    // comment on a code line (the source-scanning-guard footgun):
    expect(
      countReferences('const x = 1; // freshness comes from deriveAnalysisFreshness', 'deriveAnalysisFreshness'),
    ).toBe(0);
    // …while a code reference sharing its line with a trailing comment counts:
    expect(
      countReferences('const y = deriveAnalysisFreshness([], null); // frame seam', 'deriveAnalysisFreshness'),
    ).toBe(1);
  });

  it('word boundary: projectRecentChangesToFrame is NOT a projectRecentChanges reference', () => {
    expect(countReferences('projectRecentChangesToFrame(frame, changes)', 'projectRecentChanges')).toBe(0);
    expect(countReferences('projectRecentChanges(facts)', 'projectRecentChanges')).toBe(1);
  });
});
