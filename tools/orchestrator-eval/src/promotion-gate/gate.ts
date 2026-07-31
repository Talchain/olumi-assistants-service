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

import { hashCanonicalFile } from './manifest.js';
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
 * fail-closed floor. Re-derived from the dimensions — NOT read off the report's
 * `verdict` — so a report that claims PASS while a required dim failed is caught.
 *
 * The floor (every clause is a distinct guarantee-theatre trap):
 *   - zero dims                              ⇒ fail (a report that measured nothing cannot pass)
 *   - zero MEASURED dims (all not_applicable) ⇒ fail (examined nothing — trap 13)
 *   - any dim `fail`                         ⇒ fail
 *   - any REQUIRED dim `not_applicable`       ⇒ fail (brief §2: NA-on-required = BLOCK)
 *   - report.verdict !== 'PASS'              ⇒ fail (the report itself did not certify)
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
  if (report.verdict !== 'PASS') {
    return { ok: false, reason: `report verdict is ${report.verdict}, not PASS` };
  }
  return { ok: true, reason: `${measured.length} required/measured dimension(s) clear the floor` };
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
}

export const DEFAULT_MAX_REPORT_AGE_DAYS = 90;

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

    // Skew guard: the pack's canonical export must hash to the manifest's served
    // hash. If they disagree, the git export and the recorded promotion pointer
    // are out of sync — block rather than match reports against a hash the repo
    // itself contradicts.
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
