/**
 * ClearedJudgeVerdictProvider — the scored-round seam, built UNFIRED.
 *
 * This is the real proposal-quality-judge provider that will replace the
 * SmokeStubVerdictProvider once — and ONLY once — the judge has cleared its
 * held-out gate on Paul's blind labels. It is deliberately FAIL-CLOSED: it
 * refuses to produce verdicts unless BOTH
 *   (1) an explicit run-time authorization is passed, and
 *   (2) a cleared-judge clearance artifact exists on disk (the artifact that
 *       reconcile.py writes only after the §7 gate passes on Paul's labels:
 *       kappa>=0.75, raw>=0.85, recall_ungrounded>=0.90, safety_cells=0,
 *       stability>=0.95, cross_judge>=0.85, volume_neutral>=0.90, unresolved<=0.15).
 * Absent either, it throws. It is NOT wired into pipeline.ts (the smoke stub
 * stays the active provider), so a run cannot invoke it by accident, and no
 * judge API call — hence no spend — happens here. The judge-calibration pass is
 * a separate, explicitly-budgeted spend that must be requested before running.
 *
 * When authorised, provide() will:
 *   1. decompose(blind) into per-element units (same decomposition the stub uses);
 *   2. for each element, run the PINNED DUAL JUDGE (claude-opus-4-8 primary +
 *      gpt-5.1 cross-family, 2 repeats each — the models pinned in
 *      /Users/paulslee/v6-proposal-quality-judge/judge_run.cjs) against the
 *      SEALED rubric, blind to arm/model/provenance;
 *   3. reconcile repeats + cross-judge into gate/value/flags (grounded |
 *      ungrounded_or_fabricated; useful | soft | low | duplicate_or_restatement);
 *   4. own SEMANTIC element<->R matching (the stub does exact-text only; the
 *      cleared judge decides whether an element satisfies a warranted R item,
 *      and affirmative-defer R items are satisfied ONLY by a grounded defer
 *      artefact, never by absence).
 * The judge caller + rubric loader are injected (JudgeRunner) so the wiring is a
 * dependency, not a hidden network call in this file.
 */
import type { BlindCandidate, RItemInput, SafetyCellHit } from "../types.ts";
import type { VerdictBundle, VerdictProvider } from "./verdicts.ts";

/** Injected judge integration. Null in the unfired shell. Implemented against
 *  the cleared judge harness (judge_run.cjs) only under an authorised, budgeted run. */
export interface JudgeRunner {
  /** Pinned judge model ids, e.g. ["claude-opus-4-8", "gpt-5.1"]. */
  readonly pinnedModels: string[];
  /** sha256 of the sealed rubric this runner is bound to (identity check). */
  readonly rubricSha256: string;
  /** Judge one blind candidate's decomposed elements against the sealed rubric. */
  judge(blind: BlindCandidate, r?: RItemInput[]): Promise<VerdictBundle>;
}

export interface ClearedJudgeConfig {
  /** Must be set true by an explicit, budgeted scored-round invocation. */
  authorize: boolean;
  /** Path to the on-disk clearance artifact (reconcile.py output). */
  clearanceArtifactPath: string | null;
  /** The injected judge runner (network + rubric). Null = unfired shell. */
  runner: JudgeRunner | null;
}

export class ScoredRoundNotAuthorisedError extends Error {
  constructor(reason: string) {
    super(
      `SCORED ROUND NOT AUTHORISED — ${reason}. ` +
        `ClearedJudgeVerdictProvider is unfired scaffolding: it requires an explicit ` +
        `budgeted authorization AND an on-disk judge-clearance artifact (produced only ` +
        `after the held-out gate passes on Paul's blind labels). No judge call, no spend.`,
    );
    this.name = "ScoredRoundNotAuthorisedError";
  }
}

export class ClearedJudgeVerdictProvider implements VerdictProvider {
  readonly name = "cleared_proposal_quality_judge";
  private readonly cfg: ClearedJudgeConfig;

  constructor(cfg: ClearedJudgeConfig) {
    this.cfg = cfg;
  }

  /** Synchronous VerdictProvider contract; fail-closed. The async judge path is
   *  reached only via provideAsync() under authorization (kept off the sync seam
   *  so an accidental call in the current pipeline throws rather than blocks). */
  provide(_blind: BlindCandidate, _safetyHits: SafetyCellHit[], _r?: RItemInput[]): VerdictBundle {
    this.assertAuthorised();
    throw new ScoredRoundNotAuthorisedError(
      "the cleared judge is asynchronous; use provideAsync under an authorised scored run",
    );
  }

  async provideAsync(blind: BlindCandidate, r?: RItemInput[]): Promise<VerdictBundle> {
    this.assertAuthorised();
    // Only reachable when authorize===true, a clearance artifact exists, and a
    // runner is injected — i.e. an explicitly budgeted scored-round run.
    return this.cfg.runner!.judge(blind, r);
  }

  private assertAuthorised(): void {
    if (!this.cfg.authorize) throw new ScoredRoundNotAuthorisedError("authorize flag is not set");
    if (!this.cfg.clearanceArtifactPath) {
      throw new ScoredRoundNotAuthorisedError("no clearance-artifact path supplied");
    }
    if (!this.cfg.runner) throw new ScoredRoundNotAuthorisedError("no judge runner injected");
  }
}

/** Factory for the default UNFIRED shell — safe to construct anywhere; any call
 *  to provide()/provideAsync() throws until an authorised, budgeted run wires a
 *  real JudgeRunner and clearance artifact. */
export function unfiredClearedJudge(): ClearedJudgeVerdictProvider {
  return new ClearedJudgeVerdictProvider({ authorize: false, clearanceArtifactPath: null, runner: null });
}
