/**
 * PROMOTION GATE — the grandfather RATCHET.
 *
 * The gate cannot land red: `decision_review` v14 is ALREADY promoted (pre-gate)
 * and has no passing eval — that is precisely the drift component 13 encodes. A
 * required CI check that reddens on the current, legitimately-imperfect baseline
 * is a standing-red everyone learns to ignore (trap 7). So pre-gate promotions
 * are grandfathered — VISIBLY, and locked to their exact hash.
 *
 * This is the same discipline as `scripts/ci/typecheck-baseline.txt` and
 * `forbidden-boundary-baseline.txt`: a frozen baseline that can only SHRINK.
 *
 * It fails loud on drift IN BOTH DIRECTIONS — the trap-12 rule for any
 * hand-maintained mirror:
 *   - a grandfathered task whose PROMOTED HASH has moved ⇒ the grandfather is
 *     void; a new promotion needs a passing eval (or a deliberate baseline edit).
 *   - a grandfathered task that now HAS a passing eval (GATED_PASS) ⇒ the entry
 *     is stale; it must be removed so the ratchet tightens.
 *   - a grandfather entry for a task with no manifest row ⇒ stale reference.
 *
 * It can ONLY downgrade a BLOCK to a tolerated (grandfathered) state at the exact
 * recorded hash. It can never turn a BLOCK into a pass for a NEW hash — which is
 * the entire structural win: new drift cannot be grandfathered by accident.
 */

import type { FinalResult, FinalRow, GateResult, GrandfatherEntry } from './types.js';

export function applyGrandfather(
  gate: GateResult,
  baseline: readonly GrandfatherEntry[],
): FinalResult {
  const baselineByTask = new Map(baseline.map((e) => [e.task, e]));
  const rowByTask = new Map(gate.rows.map((r) => [r.task, r]));
  const baselineErrors: string[] = [];
  const usedEntries = new Set<string>();

  const rows: FinalRow[] = gate.rows.map((row) => {
    if (row.decision !== 'BLOCK') return { ...row, grandfathered: false };
    const gf = baselineByTask.get(row.task);
    if (!gf) return { ...row, grandfathered: false };
    usedEntries.add(row.task);
    if (gf.promotedHash !== row.promotedHash) {
      // The prompt moved since it was grandfathered — the grandfather no longer
      // describes what is promoted. This is a NEW promotion; it needs a passing
      // eval. Do NOT tolerate it.
      baselineErrors.push(
        `grandfather for "${row.task}" pins hash ${gf.promotedHash}, but the manifest now serves ` +
          `${row.promotedHash} — the grandfather no longer applies. Either commit a passing eval report ` +
          'for the new hash, or (if this promotion is deliberately still un-evalled) update the baseline entry ON PURPOSE.',
      );
      return { ...row, grandfathered: false };
    }
    return { ...row, grandfathered: true };
  });

  // Staleness sweep: every baseline entry must still be doing a job.
  for (const entry of baseline) {
    const row = rowByTask.get(entry.task);
    if (!row) {
      baselineErrors.push(
        `grandfather entry for "${entry.task}" references a task with no manifest row — remove the stale entry.`,
      );
      continue;
    }
    if (row.decision === 'GATED_PASS') {
      baselineErrors.push(
        `grandfather entry for "${entry.task}" is STALE — the task now has a passing eval (GATED_PASS). ` +
          'Remove the entry so the ratchet tightens; a prompt that has been evaluated must not stay grandfathered.',
      );
    }
    if (row.decision === 'UNGATED') {
      baselineErrors.push(
        `grandfather entry for "${entry.task}" is STALE — the task has no pack (UNGATED), so there is nothing to grandfather. Remove it.`,
      );
    }
  }

  const unresolvedBlocks = rows.filter((r) => r.decision === 'BLOCK' && !r.grandfathered);
  const ok = unresolvedBlocks.length === 0 && baselineErrors.length === 0;

  return { ok, rows, baselineErrors };
}
