/**
 * The source scan behind the contract field guard's ORPHAN detector.
 *
 * Kept apart from `src/schemas/contract-field-guard.ts` (the pure detectors) for
 * two reasons: the detectors must stay importable with no filesystem in them so
 * a corpus can feed them synthetic universes, and `src/` must not import from
 * `scripts/` — `tsconfig.build.json` includes only `src/**`, so that import
 * would break the dist build.
 */
import { readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { stripCommentsFile } from "./strip-source-comments.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..", "..");
export const SRC_DIR = join(REPO_ROOT, "src");

/** The file that DECLARES the fields. Counting it would give every field a hit. */
export const DECLARATION_FILE = join(SRC_DIR, "schemas", "cee-v3.ts");

/**
 * ⭐ THE GUARD'S OWN MODULE, EXCLUDED — AND THIS IS NOT HOUSEKEEPING.
 *
 * The decisions ledger inside it records WHY a field is an orphan, in prose that
 * necessarily names the field. Those names are string literals, which the
 * comment stripper deliberately keeps. So recording a decision about an orphan
 * ADDS AN OCCURRENCE OF IT and the orphan stops being found — the finding
 * vanishes, the decision goes stale, and the guard REDs on the very entry that
 * documents it. Measured exactly that way while this was being built: the
 * stale-direction ratchet fired on `orphan:analysis_participation` because the
 * ledger entry describing it was the only occurrence left in the tree.
 *
 * An instrument whose own output is inside the corpus it measures cannot
 * measure. Excluded here, and `assertScanIsSound` proves the exclusion is still
 * doing something rather than having quietly become a no-op.
 */
export const GUARD_MODULE = join(SRC_DIR, "schemas", "contract-field-guard.ts");

function isScannable(path: string): boolean {
  if (!path.endsWith(".ts")) return false;
  if (path.endsWith(".test.ts") || path.endsWith(".spec.ts") || path.endsWith(".d.ts")) return false;
  const parts = path.split(sep);
  if (parts.includes("__tests__") || parts.includes("_archive")) return false;
  return true;
}

/** Every non-test source file, INCLUDING the two that are excluded from counting. */
export function walkSource(dir: string = SRC_DIR): string[] {
  const out: string[] = [];
  const recurse = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) recurse(full);
      else if (isScannable(full)) out.push(full);
    }
  };
  recurse(dir);
  return out.sort();
}

export interface ScanResult {
  readonly occurrences: ReadonlyMap<string, number>;
  readonly filesWalked: number;
  readonly filesCounted: number;
  /** Files deliberately excluded from counting — printed so the scope is visible. */
  readonly excluded: readonly string[];
}

/**
 * Count, per identifier token, how many counted files mention it OUTSIDE A
 * COMMENT.
 *
 * ⚠ THE CLAIM THIS SUPPORTS, EXACTLY. This is a token index, not a dataflow
 * analysis: it cannot tell `node.label` from `block.label`. It is therefore
 * SOUND IN ONE DIRECTION ONLY — a count of zero means the token is genuinely
 * absent, so there is certainly no writer and no reader; a non-zero count means
 * nothing at all. The orphan detector makes no claim about non-zero fields for
 * that reason.
 *
 * String literals are KEPT (only comments are stripped) because a real use often
 * lives in one — `Object.keys(...).includes('scale_frame')`, a log key, a
 * property read by string. Blanking them would manufacture false orphans, which
 * is the one error this must not make.
 *
 * No shell, no glob, no `grep`: this estate's false zeros come from an unquoted
 * glob or a pattern dialect where target AND contrast both read zero.
 */
const scanCache = new Map<string, ScanResult>();

export function scanSourceTokens(files: readonly string[] = walkSource()): ScanResult {
  // Memoised: the guard spec walks the tree in more than one describe block, and
  // a full strip+tokenise of src/ costs ~6s. Keyed on the exact file list, so a
  // different list is never served a cached answer.
  const key = files.join("\u0000");
  const hit = scanCache.get(key);
  if (hit) return hit;

  const excluded = [DECLARATION_FILE, GUARD_MODULE];
  const counted = files.filter((f) => !excluded.includes(f));
  const occurrences = new Map<string, number>();
  const ident = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  for (const file of counted) {
    const seen = new Set<string>();
    // `stripCommentsFile` is the repo's mtime-memoised stripper — an edited file
    // is always re-stripped, never served stale.
    for (const m of stripCommentsFile(file).matchAll(ident)) seen.add(m[0]);
    for (const tok of seen) occurrences.set(tok, (occurrences.get(tok) ?? 0) + 1);
  }
  const result: ScanResult = {
    occurrences,
    filesWalked: files.length,
    filesCounted: counted.length,
    excluded,
  };
  scanCache.set(key, result);
  return result;
}

/**
 * Controls, run before any result is believed. Each one is a way this scan has
 * actually failed or could silently fail, and each returns a REASON rather than
 * a boolean so the failure names itself.
 */
export function assertScanIsSound(files: readonly string[], scan: ScanResult): string | null {
  if (files.length === 0) {
    return "scanned 0 source files — a vacuous pass would report every field as an orphan";
  }
  // Positive control: the scan must be able to SEE a token that is everywhere.
  const control = scan.occurrences.get("kind") ?? 0;
  if (control === 0) {
    return `positive control failed — token 'kind' found in 0 of ${scan.filesCounted} counted files; the scan is blind and its output is not evidence`;
  }
  // The exclusions must still MATCH something. If either path moves, the
  // exclusion silently becomes a no-op and the orphan detector silently dies.
  for (const path of scan.excluded) {
    if (!files.includes(path)) {
      return `excluded path is not in the walked set and the exclusion is therefore a no-op: ${path}`;
    }
  }
  // Negative control: a token that cannot exist must read zero. If this is
  // non-zero the index is matching something other than identifiers.
  const absurd = scan.occurrences.get("zzz_contract_field_guard_absent_token") ?? 0;
  if (absurd !== 0) {
    return `negative control failed — a token that appears nowhere read ${absurd}; the index is not matching identifiers`;
  }
  return null;
}
