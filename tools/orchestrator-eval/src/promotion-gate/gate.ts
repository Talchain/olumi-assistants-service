/**
 * PROMOTION GATE — the pure decision function.
 *
 * Given the git source-of-truth (manifest entries), the discovered packs, and
 * the committed promotion reports, decide per prompt whether it may be promoted:
 *
 *   - no pack           ⇒ UNGATED  (promotes as today, but MARKED — visible, not silent)
 *   - pack + passing    ⇒ GATED_PASS
 *   - pack + not passing ⇒ BLOCK, with a SPECIFIC kind
 *
 * This function is FAIL-CLOSED and takes all state as arguments, so the vacuity
 * controls (no report / expired report / wrong-hash report) drive it directly.
 * Grandfathering of pre-existing pre-gate promotions is a SEPARATE layer
 * (`grandfather.ts`) — it must never be able to soften this function.
 *
 * THE ANTI-VACUITY CORE (brief §2, the review's priority): the gate must tell
 * "passed" from "never ran". That is why the block kinds are distinct and why
 * {@link passesFloor} re-derives the verdict from the dimensions instead of
 * trusting the report's own `verdict` field.
 */

import { resolve } from 'node:path';
import { hashCanonicalFile } from './manifest.js';
import { MIN_CERTIFYING_SAMPLE_SIZE } from './types.js';
import type {
  GateBlockKind,
  GateResult,
  GateRow,
  ManifestPromptEntry,
  PackDescriptor,
  PromotionReport,
} from './types.js';

/**
 * A hash-matched, in-date report satisfies the gate ONLY if it clears the
 * fail-closed floor. Re-derived from the dimensions AND the sample size — NOT
 * read off the report's `verdict` — so a report that claims PASS while a
 * required dim failed, or while resting on one sample, is caught.
 *
 * The floor (every clause is a distinct guarantee-theatre trap):
 *   - zero dims                               ⇒ fail (a report that measured nothing cannot pass)
 *   - zero MEASURED dims (all not_applicable)  ⇒ fail (examined nothing — trap 13)
 *   - any dim `fail`                          ⇒ fail
 *   - any REQUIRED dim `not_applicable`        ⇒ fail (brief §2: NA-on-required = BLOCK)
 *   - ZERO required dims MEASURED              ⇒ fail (A2 — see below)
 *   - sampleSize < MIN_CERTIFYING_SAMPLE_SIZE  ⇒ fail (A1 — see below)
 *   - report.verdict !== 'PASS'               ⇒ fail (the report itself did not certify)
 *
 * ⚠ A1 and A2 were added by the adversarial review of #769; both were the exact
 * vacuity class this gate exists to kill, sitting inside the gate itself:
 *
 *   A1 — the floor re-derived EVERYTHING except the sample size, so the one
 *   criterion `types.ts` calls out ("n<3 cannot certify") was delegated straight
 *   back to the report's UNTRUSTED `verdict`. A committed report with
 *   `sampleSize: 1`, `verdict: 'PASS'` and clean dims was a GATED_PASS. The
 *   threshold is now re-derived here, from the SAME constant the report builder
 *   uses — one source, no twin (trap 12).
 *
 *   A2 — a report whose only dimension was a NON-required pass cleared the
 *   floor, contradicting the documented guarantee in `types.ts` that a
 *   conditional dim "cannot, on its own, satisfy the floor". A prose guarantee
 *   nothing enforces is the defect class, not a comment style. It is code now.
 */
export function passesFloor(report: PromotionReport): { ok: boolean; reason: string } {
  const dims = report.dims;
  if (dims.length === 0) {
    return { ok: false, reason: 'report carries ZERO dimensions — a report that measured nothing cannot certify a pass' };
  }
  const measured = dims.filter((d) => d.status !== 'not_applicable');
  if (measured.length === 0) {
    return { ok: false, reason: `report measured ZERO dimensions (all ${dims.length} not_applicable) — examined nothing` };
  }
  const failed = dims.filter((d) => d.status === 'fail').map((d) => d.name);
  if (failed.length > 0) {
    return { ok: false, reason: `failing dimension(s): ${failed.join(', ')}` };
  }
  const requiredNa = dims.filter((d) => d.required && d.status === 'not_applicable').map((d) => d.name);
  if (requiredNa.length > 0) {
    return {
      ok: false,
      reason: `required dimension(s) not measured (not_applicable): ${requiredNa.join(', ')} — cannot certify a floor on data we do not have`,
    };
  }
  // A2: at least one REQUIRED dimension must be affirmatively MEASURED. Without
  // this, a report carrying a single conditional pass certifies a promotion
  // while nothing the prompt MUST do was ever checked.
  const measuredRequired = dims.filter((d) => d.required && d.status !== 'not_applicable');
  if (measuredRequired.length === 0) {
    return {
      ok: false,
      reason:
        `ZERO required dimensions measured (${dims.length} dim(s), none required-and-measured) — ` +
        'a conditional dimension cannot, on its own, satisfy the floor',
    };
  }
  // A1: the sample size is re-derived here, never taken from the report's verdict.
  if (!Number.isFinite(report.sampleSize) || report.sampleSize < MIN_CERTIFYING_SAMPLE_SIZE) {
    return {
      ok: false,
      reason:
        `sample size n=${report.sampleSize} is below the certifying minimum of ${MIN_CERTIFYING_SAMPLE_SIZE} — ` +
        'fewer runs is a compliance rate nobody has estimated, not a score',
    };
  }
  if (report.verdict !== 'PASS') {
    return { ok: false, reason: `report verdict is ${report.verdict}, not PASS` };
  }
  return {
    ok: true,
    reason: `${measuredRequired.length} required dimension(s) measured and clear, n=${report.sampleSize}`,
  };
}

/** Days between two ISO/Date instants (may be fractional). */
function ageDays(generatedAt: string, now: Date): number {
  return (now.getTime() - Date.parse(generatedAt)) / 86_400_000;
}

export interface GateOptions {
  readonly now: Date;
  /** A hash-matched report older than this is EXPIRED even if the hash still
   * matches — the prompt bytes are unchanged, but the model / pack / assembly it
   * was measured against may have moved. Not env-configurable by design. */
  readonly maxReportAgeDays: number;
  /**
   * A5(a): how far AHEAD of `now` a report's `generatedAt` may sit before it is
   * refused outright. A future-dated report can never expire — post-date it far
   * enough and the freshness window becomes permanent, which is the expiry
   * control inverted. Anything beyond honest clock/timezone skew is a BLOCK.
   * REQUIRED, not defaulted: a caller must think about it (a silently-defaulted
   * safety bound is one nobody notices going missing).
   */
  readonly maxFutureSkewDays: number;
}

export const DEFAULT_MAX_REPORT_AGE_DAYS = 90;

/** Generous enough for timezone/clock confusion, far short of useful post-dating. */
export const DEFAULT_MAX_FUTURE_SKEW_DAYS = 1;

/**
 * Compute the gate over injected state. Pure: no fs except hashing the pack's
 * canonical export for the manifest/export skew guard (that read is the whole
 * point — it ties the git export, the manifest hash, and the report identity
 * into ONE value; a test injects packs with real or temp paths).
 */
export function computePromotionGate(
  manifest: readonly ManifestPromptEntry[],
  packs: readonly PackDescriptor[],
  reports: readonly PromotionReport[],
  opts: GateOptions,
): GateResult {
  const packByTask = new Map(packs.map((p) => [p.task, p]));
  const rows: GateRow[] = [];

  for (const entry of manifest) {
    const pack = packByTask.get(entry.task);
    const promotedHash = entry.servedHash;

    if (!pack) {
      rows.push({
        task: entry.task,
        hasPack: false,
        promotedHash,
        servedVersion: entry.servedVersion,
        decision: 'UNGATED',
        reason: `no eval pack for "${entry.task}" — promotes as today, UNGATED (add a promotion-pack.ts marker to bring it under the gate)`,
      });
      continue;
    }

    // Skew guard, part 1 (A5b): the pack must be scoring the very file the
    // manifest records as this prompt's canonical export. Hashing the pack's
    // path without asserting WHICH path it is leaves a hole: a pack pointed at
    // some other file that happens to carry the promoted hash would satisfy the
    // guard. Over-block direction, and it makes the "one hash, one file" claim
    // literal.
    if (resolve(pack.canonicalPromptPath) !== resolve(entry.canonicalFile)) {
      rows.push(block(entry, promotedHash, 'MANIFEST_EXPORT_SKEW',
        `pack for "${entry.task}" scores canonical file ${pack.canonicalPromptPath}, but the manifest records ` +
          `${entry.canonicalFile} as this prompt's canonical export — the pack and the manifest disagree about WHICH bytes are promoted`));
      continue;
    }

    // Skew guard, part 2: the pack's canonical export must hash to the manifest's
    // served hash. If they disagree, the git export and the recorded promotion
    // pointer are out of sync — block rather than match reports against a hash
    // the repo itself contradicts.
    const canonicalHash = hashCanonicalFile(pack.canonicalPromptPath);
    if (canonicalHash !== promotedHash) {
      rows.push(block(entry, promotedHash, 'MANIFEST_EXPORT_SKEW',
        `canonical export hashes to ${canonicalHash} but the manifest records served hash ${promotedHash} — the git prompt source-of-truth disagrees with itself`));
      continue;
    }

    const forTask = reports.filter((r) => r.task === entry.task);
    const matching = forTask.filter((r) => r.promptSha16 === promotedHash);

    if (matching.length === 0) {
      if (forTask.length > 0) {
        const otherHashes = [...new Set(forTask.map((r) => r.promptSha16))].join(', ');
        rows.push(block(entry, promotedHash, 'HASH_MISMATCH',
          `report(s) exist for "${entry.task}" but for hash(es) ${otherHashes}, NOT the promoted hash ${promotedHash} — a stale-version report does not satisfy the gate`));
      } else {
        rows.push(block(entry, promotedHash, 'NO_REPORT',
          `"${entry.task}" has an eval pack but NO committed promotion report for the promoted hash ${promotedHash}`));
      }
      continue;
    }

    // If several match the hash, the freshest wins.
    const report = [...matching].sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0];
    const age = ageDays(report.generatedAt, opts.now);
    // A5(a): a report dated in the future never expires — checked BEFORE the
    // expiry window, because that window is exactly what post-dating defeats.
    if (age < -opts.maxFutureSkewDays) {
      rows.push({
        ...block(entry, promotedHash, 'FUTURE_DATED',
          `hash-matched report for ${promotedHash} is dated ${report.generatedAt}, ${(-age).toFixed(0)}d in the FUTURE ` +
            `(tolerance ${opts.maxFutureSkewDays}d) — a post-dated report can never expire; refusing it`),
        matchedReportSha16: report.promptSha16,
      });
      continue;
    }
    if (age > opts.maxReportAgeDays) {
      rows.push({
        ...block(entry, promotedHash, 'EXPIRED',
          `hash-matched report for ${promotedHash} is ${age.toFixed(0)}d old (> ${opts.maxReportAgeDays}d window) — re-evaluate before promoting`),
        matchedReportSha16: report.promptSha16,
      });
      continue;
    }

    const floor = passesFloor(report);
    if (!floor.ok) {
      rows.push({
        ...block(entry, promotedHash, 'EVAL_FAILED',
          `hash-matched, in-date report does not clear the fail-closed floor: ${floor.reason}`),
        matchedReportSha16: report.promptSha16,
      });
      continue;
    }

    rows.push({
      task: entry.task,
      hasPack: true,
      promotedHash,
      servedVersion: entry.servedVersion,
      decision: 'GATED_PASS',
      reason: `hash-matched (${promotedHash}), ${age.toFixed(0)}d old, clears the floor: ${floor.reason}`,
      matchedReportSha16: report.promptSha16,
    });
  }

  return {
    rows,
    gatedPass: rows.filter((r) => r.decision === 'GATED_PASS').map((r) => r.task),
    blocked: rows.filter((r) => r.decision === 'BLOCK').map((r) => r.task),
    ungated: rows.filter((r) => r.decision === 'UNGATED').map((r) => r.task),
  };
}

function block(
  entry: ManifestPromptEntry,
  promotedHash: string,
  blockKind: GateBlockKind,
  reason: string,
): GateRow {
  return {
    task: entry.task,
    hasPack: true,
    promotedHash,
    servedVersion: entry.servedVersion,
    decision: 'BLOCK',
    blockKind,
    reason,
  };
}
