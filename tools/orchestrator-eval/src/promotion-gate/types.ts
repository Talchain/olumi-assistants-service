/**
 * PROMOTION GATE (Harness H2) — shared types.
 *
 * The gate makes an eval PASS a structural precondition of promoting a prompt
 * version. It reads the git source-of-truth (the manifest + the canonical
 * exports + the committed promotion reports) and refuses — at CI time — any
 * commit that promotes a prompt WITH an eval pack to a served hash that has no
 * committed, in-date, HASH-MATCHED, PASSING report.
 *
 * WHY THESE TYPES, AND WHAT THEY DELIBERATELY DO NOT TRUST
 * -------------------------------------------------------
 * A promotion report carries a `verdict` field, but the gate NEVER trusts it on
 * its own — it re-derives the fail-closed floor from `dims`. A report that
 * CLAIMS `verdict: 'PASS'` while a required dimension failed or went
 * not-applicable is exactly the guarantee-theatre this programme hunts, and the
 * gate's floor exists to catch it. See `passesFloor` in `gate.ts`.
 *
 * The version identity is the per-response prompt HASH (`promptSha16` =
 * sha256(prompt text)[:16], the manifest's own `cee_content_hash_16` /
 * `src/prompts/loader.ts:33`), NEVER a version POINTER. Trap 12c: on this
 * platform a pointer read 120 while turns were served 119. A hash cannot lie
 * about which bytes it measured.
 */

/** A dimension's status inside a promotion report. Mirrors the pack's own
 * three-state model (`../types.ts` DimensionStatus) — NA is not a pass. */
export type PromotionReportDimStatus = 'pass' | 'fail' | 'not_applicable';

/** One scored dimension carried in a committed promotion report. */
export interface PromotionReportDim {
  readonly name: string;
  readonly status: PromotionReportDimStatus;
  /**
   * REQUIRED dimensions must be affirmatively MEASURED to certify a pass. A
   * required dim that is `fail` OR `not_applicable` blocks (brief §2: "any
   * null/NA-on-a-required dim = BLOCK"). A non-required dim is conditionally
   * applicable (e.g. "disclose the infeasible winner" only applies when the
   * winner is infeasible) — its NA does not block, but it also cannot, on its
   * own, satisfy the floor.
   */
  readonly required: boolean;
  /** Human-readable evidence for the report reader. */
  readonly detail?: string;
}

/**
 * A committed promotion report — the evidence the gate consumes. Produced by a
 * pack against the SERVED prompt (never a fixture), one file per report under
 * the promotion-reports directory.
 */
export interface PromotionReport {
  readonly schemaVersion: 1;
  /** PMS task key — must match a manifest entry's key and a pack's task. */
  readonly task: string;
  /** sha256(served prompt text)[:16]. The identity the gate hash-matches. */
  readonly promptSha16: string;
  /** ISO timestamp — the "in-date" check measures age against this. */
  readonly generatedAt: string;
  /** The pack's own fail-closed verdict. RE-DERIVED by the gate, never trusted. */
  readonly verdict: 'PASS' | 'BLOCK';
  /** Number of independent samples the verdict rests on (n<3 cannot certify). */
  readonly sampleSize: number;
  readonly dims: readonly PromotionReportDim[];
  /** Free-form provenance (source captures, model, run cost, notes). */
  readonly evidence?: Readonly<Record<string, unknown>>;
}

/** A pack that can produce a promotion verdict for a task. DISCOVERED from the
 * filesystem, never hand-listed — see `packs.ts`. */
export interface PackDescriptor {
  readonly task: string;
  /** The canonical export of the served prompt this pack evaluates. */
  readonly canonicalPromptPath: string;
  /** The pack's own directory, for reporting/provenance. */
  readonly packDir: string;
}

/** One PMS prompt as recorded in the git manifest. */
export interface ManifestPromptEntry {
  readonly task: string;
  readonly servedVersion: number;
  /** cee_content_hash_16 — the promoted hash the gate matches reports against. */
  readonly servedHash: string;
  /** The canonical export path recorded for this prompt (for the skew guard). */
  readonly canonicalFile: string;
  readonly servedHashVerified: boolean;
}

export type GateDecision = 'GATED_PASS' | 'BLOCK' | 'UNGATED';

/**
 * Why a gated promotion is blocked. Each is a DISTINCT vacuity failure the gate
 * exists to distinguish — a gate that cannot tell "passed" from "never ran" is
 * the theatre this lane is built against.
 */
export type GateBlockKind =
  | 'NO_REPORT' // has a pack, no committed report for the promoted hash at all
  | 'HASH_MISMATCH' // reports exist for the task, none for the PROMOTED hash (stale report)
  | 'EXPIRED' // hash-matched report is older than the freshness window
  | 'EVAL_FAILED' // hash-matched, in-date report does not clear the fail-closed floor
  | 'MANIFEST_EXPORT_SKEW'; // canonical export hash != manifest served hash (git skew)

export interface GateRow {
  readonly task: string;
  readonly hasPack: boolean;
  /** The manifest's promoted hash for this task's served version. */
  readonly promotedHash: string;
  readonly servedVersion: number;
  readonly decision: GateDecision;
  readonly blockKind?: GateBlockKind;
  readonly reason: string;
  /** The promptSha16 of the report that was matched (if any) — for the reader. */
  readonly matchedReportSha16?: string;
}

export interface GateResult {
  readonly rows: readonly GateRow[];
  readonly gatedPass: readonly string[];
  readonly blocked: readonly string[];
  readonly ungated: readonly string[];
}

/**
 * One frozen grandfather entry: a prompt already promoted (pre-gate) WITHOUT a
 * passing eval. It is tolerated ONLY at the exact hash recorded, so the ratchet
 * can shrink but never silently widen — the same discipline as
 * `scripts/ci/typecheck-baseline.txt` and `forbidden-boundary-baseline.txt`.
 */
export interface GrandfatherEntry {
  readonly task: string;
  readonly promotedHash: string;
  readonly reason: string;
  readonly recordedAt: string;
}

export interface FinalRow extends GateRow {
  /** True when a BLOCK was tolerated by an exact-hash grandfather entry. */
  readonly grandfathered: boolean;
}

export interface FinalResult {
  /** The one field CI needs. True ⇒ no un-grandfathered BLOCK and no baseline drift. */
  readonly ok: boolean;
  readonly rows: readonly FinalRow[];
  /** Fatal baseline-integrity problems (stale/mismatched grandfather entries). */
  readonly baselineErrors: readonly string[];
}
