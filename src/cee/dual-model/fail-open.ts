/**
 * Reusable "fail open to M1" stage runner (quarantined scaffold — not
 * imported by any live path).
 *
 * Codifies the degrade semantics the MVP implements inline in
 * enrichDraftGraph so future dual-model stages cannot drift from them:
 *
 *   1. the runner NEVER rejects — a throwing stage degrades, it does not
 *      propagate;
 *   2. on any degrade the returned graph is the UPSTREAM graph BY REFERENCE
 *      (the byte-identity guarantee the dispatch relies on) — a stage that
 *      resolves `changed: false` with some other object is normalised back to
 *      the upstream reference;
 *   3. every degrade fires the injected onDegrade hook exactly once; a
 *      throwing hook is swallowed (observability must never break the turn);
 *   4. degrade detail is bounded (FAIL_OPEN_DETAIL_MAX_CHARS) — coded/short
 *      causes only, never unbounded upstream text.
 *
 * The hook is INJECTED so this module imports nothing from utils/telemetry —
 * callers own event naming and emission at wiring time.
 */
import type { StageResult } from './contracts.js';

export const FAIL_OPEN_DETAIL_MAX_CHARS = 200;

export interface FailOpenOptions<TReason extends string> {
  /** Reason recorded when the stage throws (the stage's internal_error analogue). */
  readonly fallbackReason: TReason;
  /** Fired exactly once per degrade (changed=false or throw). Throws are swallowed. */
  readonly onDegrade?: (reason: TReason, detail?: string) => void;
}

function truncateDetail(detail: string | undefined): string | undefined {
  if (detail === undefined) return undefined;
  return detail.length <= FAIL_OPEN_DETAIL_MAX_CHARS
    ? detail
    : detail.slice(0, FAIL_OPEN_DETAIL_MAX_CHARS);
}

function fireDegrade<TReason extends string>(
  opts: FailOpenOptions<TReason>,
  reason: TReason,
  detail?: string,
): void {
  try {
    opts.onDegrade?.(reason, detail);
  } catch {
    // Observability must never break the turn.
  }
}

/**
 * Runs a dual-model stage with fail-open-to-upstream semantics. See module
 * header for the normative contract (pinned by __tests__/fail-open.test.ts).
 */
export async function runStageFailOpen<TGraph, TReason extends string>(
  upstreamGraph: TGraph,
  opts: FailOpenOptions<TReason>,
  stage: (graph: TGraph) => Promise<StageResult<TGraph, TReason>>,
): Promise<StageResult<TGraph, TReason>> {
  try {
    const result = await stage(upstreamGraph);
    if (!result.changed) {
      const detail = truncateDetail(result.detail);
      fireDegrade(opts, result.reason, detail);
      // Normalise: "unchanged" MUST mean "the untouched upstream graph".
      return {
        changed: false,
        reason: result.reason,
        graph: upstreamGraph,
        ...(detail !== undefined && { detail }),
      };
    }
    return result;
  } catch (err) {
    const detail = truncateDetail(err instanceof Error ? err.message : String(err));
    fireDegrade(opts, opts.fallbackReason, detail);
    return {
      changed: false,
      reason: opts.fallbackReason,
      graph: upstreamGraph,
      ...(detail !== undefined && { detail }),
    };
  }
}
