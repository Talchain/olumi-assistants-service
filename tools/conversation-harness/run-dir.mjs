/**
 * Run-dir preparation (conversation-harness) — guarantees every run starts in a
 * CLEAN dir (C-hygiene: unique clean run dirs).
 *
 * Why: runner.mjs used to mkdir -p and write INTO an existing run dir. A rerun
 * reusing an arm name (prompt-eval.sh base-1/cand-1 across evals) left STALE
 * turn dirs from a previous — possibly longer — journey in place, and
 * score-run.ts's defensive loader appends any extra on-disk turn dirs to the
 * scored set: stale turns silently polluted the new run's scores.
 *
 * Safety: only a dir this harness owns is ever deleted — it must be empty or
 * carry the runner's own run-log.txt marker. Anything else (a typo'd --arm
 * pointing at real data) refuses loudly instead of rm -rf'ing it.
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ensure `runDir` exists, is empty, and has the turns/ (and optionally l0/)
 * skeleton. Throws if the dir exists with content NOT produced by this runner.
 */
export function prepareRunDir(runDir, { wantL0 = false } = {}) {
  if (existsSync(runDir)) {
    const entries = readdirSync(runDir);
    const ownedMarker = entries.includes('run-log.txt');
    if (entries.length > 0 && !ownedMarker) {
      throw new Error(
        `run dir ${runDir} exists with content but no run-log.txt marker — refusing to clean a dir this runner does not own (pick another --arm/--out)`,
      );
    }
    // Owned (or empty) -> remove stale content wholesale; a half-deleted dir
    // is worse than none.
    rmSync(runDir, { recursive: true, force: true });
  }
  mkdirSync(join(runDir, 'turns'), { recursive: true });
  if (wantL0) mkdirSync(join(runDir, 'l0'), { recursive: true });
  return runDir;
}
