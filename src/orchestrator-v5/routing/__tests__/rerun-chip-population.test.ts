/**
 * ⭐⭐ ROADMAP 2.621 — THE RE-RUN CHIP POPULATION, SWEPT RATHER THAN SAMPLED.
 *
 * `chip_action_rerun_analysis` is minted in SEVEN places in non-test `src/`.
 * That is one fewer than it was: the structural-edit split disclosure now
 * consumes the exported `RERUN_ACTION` instead of carrying an eighth copy.
 *
 * ⚠ WHY A SWEEP AND NOT THE GUARD IT REPLACES. The deleted guard read TWO of
 * the eight definitions out of their source and compared them to a third. That
 * is agreement-checking: it answers "do these copies match?" and can never
 * answer "is this list complete?" (CLAUDE.md trap 12d). A ninth mint — the
 * failure that actually costs something — was invisible to it. This file
 * ENUMERATES the population from source, so a ninth is discovered, not
 * assumed away.
 *
 * ── THE PROPERTY THAT IS LOAD-BEARING, AND WHY IT IS THIS ONE ──────────────
 * `commit.ts` suppresses competing run-analysis offers while a confirmation is
 * outstanding by keying on the PAIR (`id`, `action_type`). A mint that shares
 * the id but carries a different `action_type` would slip past that
 * suppression and put a second consent offer beside an unanswered confirm —
 * silently, with nothing red. So the swept invariant is the pair, asserted for
 * EVERY definition, and it is asserted through `commit.ts`'s OWN predicate
 * rather than a restatement of its set.
 *
 * ── THE LABEL DRIFT IS RECORDED, NOT SILENTLY TOLERATED ────────────────────
 * Two of the seven read "Rerun analysis" against everyone else's "Re-run
 * analysis". Unifying them is a USER-VISIBLE COPY change with a cross-repo
 * dimension (a journey-replay spec records that the UI ships "Rerun analysis"),
 * so this lane does not take it. What it does instead is make the divergence
 * an object: the diverging files are named, and a THIRD spelling — or a new
 * file joining the drift — fails here rather than being found by a future
 * reviewer for the third time.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RERUN_ACTION } from '../stale-rerun-guard.js';
import { isCompetingRunAnalysisSuggestionChip } from '../../commit.js';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CHIP_ID = 'chip_action_rerun_analysis';

interface Mint {
  readonly file: string;
  readonly label: string;
  readonly message: string;
  readonly actionType: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === 'generated') continue;
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      walk(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every definition of the chip in non-test source.
 *
 * ⚠ `readFileSync` + a regex, deliberately: the near-twin ids
 * (`..._gm_stale`, `..._after_mutation`) mean a bare id search over-collects,
 * and the estate carries a NUL sentinel in one handler that makes plain
 * `grep` blind (CLAUDE.md trap 17), so a shell sweep is not the safer option
 * here. The anchor is the exact `id: '<id>',` line followed by its object
 * fields, which is how all seven are written.
 */
function collectMints(): Mint[] {
  const pattern = new RegExp(
    `id:\\s*'${CHIP_ID}',\\s*\\n` +
      `\\s*label:\\s*'([^']*)',\\s*\\n` +
      `\\s*message:\\s*'([^']*)',\\s*\\n` +
      `\\s*action_type:\\s*'([^']*)'`,
    'g',
  );
  const mints: Mint[] = [];
  for (const file of walk(SRC_ROOT)) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes(`id: '${CHIP_ID}',`)) continue;
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(src)) !== null) {
      mints.push({
        file: relative(SRC_ROOT, file),
        label: m[1]!,
        message: m[2]!,
        actionType: m[3]!,
      });
    }
  }
  return mints;
}

/**
 * Files whose copy uses the unhyphenated spelling. NOT an allowance for new
 * drift — the assertions below fail if this stops matching what is on disk in
 * EITHER direction, so adding a spelling reds and fixing one reds too (and
 * the fix is then to delete the entry in the same change).
 */
const KNOWN_UNHYPHENATED_SPELLING: readonly string[] = [
  'orchestrator-v5/compose/chip-generator.ts',
  'orchestrator-v5/turn-executor.ts',
];

describe('⭐⭐ ROADMAP 2.621 — every mint of the re-run chip, swept from source', () => {
  it('the sweep finds mints at all — a zero-hit sweep would make every assertion vacuous', () => {
    const mints = collectMints();
    expect(mints.length).toBeGreaterThan(0);
    // The exporter is one of them, so the sweep is provably looking at the
    // same population the rest of the estate consumes.
    expect(mints.map((m) => m.file)).toContain('orchestrator-v5/routing/stale-rerun-guard.ts');
  });

  it('⭐ EVERY mint carries the action_type that makes it suppressible during a hold', () => {
    // The load-bearing invariant. A mint sharing the id but not the type would
    // escape `commit.ts`'s hold-time suppression and place a competing consent
    // offer beside an unanswered confirm. Asked of commit.ts's OWN predicate,
    // so this moves with the suppression set instead of mirroring it.
    for (const mint of collectMints()) {
      expect(mint.actionType, `${mint.file} action_type`).toBe(RERUN_ACTION.action_type);
      expect(
        isCompetingRunAnalysisSuggestionChip({
          id: CHIP_ID,
          label: mint.label,
          message: mint.message,
          action_type: mint.actionType,
        } as Parameters<typeof isCompetingRunAnalysisSuggestionChip>[0]),
        `${mint.file} must be suppressible while a hold is live`,
      ).toBe(true);
    }
  });

  it('⭐ DISCRIMINATING CONTROL — the predicate above really can say NO', () => {
    // Without this, "every mint is suppressible" could be satisfied by a
    // predicate that returns true for everything.
    expect(
      isCompetingRunAnalysisSuggestionChip({
        id: CHIP_ID,
        label: RERUN_ACTION.label,
        message: RERUN_ACTION.message,
        action_type: 'explain_results',
      } as Parameters<typeof isCompetingRunAnalysisSuggestionChip>[0]),
    ).toBe(false);
    expect(
      isCompetingRunAnalysisSuggestionChip({
        id: 'chip_action_rerun_analysis_gm_stale',
        label: RERUN_ACTION.label,
        message: RERUN_ACTION.message,
        action_type: RERUN_ACTION.action_type,
      } as Parameters<typeof isCompetingRunAnalysisSuggestionChip>[0]),
    ).toBe(false);
  });

  it('⚠ the label/message drift is EXACTLY the two recorded files — a third fails here', () => {
    const drifted = [
      ...new Set(
        collectMints()
          .filter((m) => m.label !== RERUN_ACTION.label || m.message !== RERUN_ACTION.message)
          .map((m) => m.file),
      ),
    ].sort();
    // Both directions red: a new diverging file, or a fixed one left listed.
    expect(drifted).toEqual([...KNOWN_UNHYPHENATED_SPELLING].sort());
  });

  it('and the split disclosure is NOT among them — it consumes the export', () => {
    // The eighth copy, deleted. Bound by file identity, not by a count that a
    // different deletion elsewhere could also satisfy.
    expect(collectMints().map((m) => m.file)).not.toContain(
      'orchestrator-v5/handlers/structural-edit-split-disclosure.ts',
    );
  });
});
