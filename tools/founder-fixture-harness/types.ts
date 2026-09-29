/**
 * Founder-fixture wire harness — shared types.
 *
 * The fixture (`artefacts/founder-fixture/` in `Talchain/olumi-programme-docs`)
 * is a SPECIFICATION, not a suggestion. This harness runs it and decides
 * ACCEPTANCE.md section A's six deterministic criteria.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THREE-VALUED VERDICT IS THE WHOLE POINT.
 *
 * `NOT_ASSESSED` is a FIRST-CLASS OUTCOME, never a soft pass. Several of the
 * six criteria have limbs the wire cannot decide at all — a rendered badge, a
 * sentence's semantic responsiveness. A harness that silently narrowed its
 * scope to what it can see, and reported the remainder as PASS, would be the
 * exact failure this programme keeps paying for.
 *
 * So the composition rule is deliberately PESSIMISTIC:
 *
 *     any limb FAIL          → criterion FAIL
 *     every limb PASS        → criterion PASS
 *     otherwise              → criterion NOT_ASSESSED
 *
 * A criterion carrying a permanently-undecidable limb (C1's badge, C2's
 * surface, C6's semantics) therefore can NEVER read PASS from the wire. That
 * is correct, and it is the honest statement of what a wire harness is: it can
 * REFUTE those criteria and it cannot certify them. Every limb still carries
 * its own verdict, so the decidable half's PASS is visible and usable — it is
 * just never laundered into a claim about the whole criterion.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { WireBody } from '../golden-journey-harness/observation.js';

export type Verdict = 'PASS' | 'FAIL' | 'NOT_ASSESSED';

/** Why a limb is decidable — or why it is not. Printed in the report. */
export type Decidability =
  /** Decidable from the turn payload alone. */
  | 'wire'
  /** Needs the rendered DOM. A wire harness can never decide it. */
  | 'dom-only'
  /** Needs a human or an explicit rubric. Not machine-decidable at all. */
  | 'semantic'
  /** Decidable on the wire, but only when an optional instrument is available. */
  | 'wire-conditional';

export interface LimbResult {
  /** e.g. `C1.wire.unrequested-arm`. Stable across runs — reports diff on it. */
  readonly id: string;
  /** The question THIS limb answers, in one sentence. Never merged with a sibling's. */
  readonly question: string;
  readonly decidability: Decidability;
  readonly verdict: Verdict;
  /** Every line is evidence a reader can check. Empty is a smell, not a pass. */
  readonly evidence: readonly string[];
}

export type CriterionId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6';

export interface CriterionResult {
  readonly id: CriterionId;
  /** Verbatim from ACCEPTANCE.md section A. */
  readonly claim: string;
  readonly verdict: Verdict;
  readonly limbs: readonly LimbResult[];
}

/**
 * Turns 8 and 9, and section B's rate-shaped quantities.
 *
 * These are RECORDED, never decided. SCRIPT.md: "Turns 8 and 9 are MEASUREMENT
 * ONLY for now: no fix is in flight for either, and neither gates a wave."
 * ACCEPTANCE.md section B: "n >= 5 fresh runs ... before any rollback
 * decision."
 */
export interface Measurement {
  readonly id: string;
  readonly what: string;
  readonly value: string;
  /** Why this is not a verdict. Printed beside every measurement. */
  readonly why_not_decided: string;
}

/** How the harness reached this turn's state. PROTOCOL.md rule 7. */
export type StateClass = 'fresh' | 'restored' | 'replayed';

export interface TurnSent {
  readonly index: number;
  /** The exact bytes put on the wire. */
  readonly message: string;
  /** sha256 of `message`. For turn 1 this is asserted against the fixture's own file hash. */
  readonly sha256: string;
}

export interface TurnCapture {
  /** 1-based, matching SCRIPT.md. Turn 1 is the brief. */
  readonly index: number;
  /** SCRIPT.md's own description of what the turn probes. */
  readonly probes: string;
  readonly sent: TurnSent;
  readonly httpStatus: number;
  readonly body: WireBody | undefined;
  readonly elapsedMs: number;
  /** Set when the turn never reached the orchestrator. */
  readonly transportError?: string;
  /**
   * True for turn 11 only: the harness discarded every client-side handle it
   * held (nothing but the scenario id survives) before sending. See
   * `RunContext.reload_semantics` for what that does and does not prove.
   */
  readonly afterReload?: boolean;
}

export interface BuildIdentity {
  readonly service: string;
  /** The SHA as the deployed service reported it, or `undefined` if it could not be established. */
  readonly sha: string | undefined;
  /** How it was derived AT RUN TIME. Never a value passed in by the caller. */
  readonly derivedFrom: string;
  readonly note?: string;
}

/** Whether an instrument can actually see. Trap 13: an absence probe needs a positive control. */
export interface DetectorStatus {
  readonly id: string;
  readonly available: boolean;
  /** The positive control fired — the instrument can see a PRESENCE. */
  readonly positiveControl: 'fired' | 'did-not-fire' | 'not-run';
  /** The negative control stayed silent — the instrument is not stuck ON. */
  readonly negativeControl: 'silent' | 'fired' | 'not-run';
  readonly source: string;
  readonly reason?: string;
}

export interface RunContext {
  readonly startedAt: string;
  readonly mode: 'live' | 'replay';
  readonly stateClass: StateClass;
  readonly briefSha256: string;
  readonly briefBytes: number;
  readonly briefPath: string;
  readonly ceeBaseUrl: string;
  readonly origin: string;
  readonly scenarioId: string;
  readonly builds: readonly BuildIdentity[];
  readonly detectors: readonly DetectorStatus[];
  /**
   * What turn 11 measured. A wire harness holds no localStorage, so its
   * "reload" is not the user's reload — see the constant in `script.ts`.
   */
  readonly reload_semantics: string;
}

export interface HarnessOutcome {
  readonly context: RunContext;
  readonly turns: readonly TurnCapture[];
  readonly criteria: readonly CriterionResult[];
  readonly measurements: readonly Measurement[];
  /** Anything that stopped a criterion being decided, collected for the headline. */
  readonly caveats: readonly string[];
}

/** Composition rule — see the module header. Exported so a test can pin it. */
export function composeVerdict(limbs: readonly LimbResult[]): Verdict {
  if (limbs.length === 0) return 'NOT_ASSESSED';
  if (limbs.some((l) => l.verdict === 'FAIL')) return 'FAIL';
  if (limbs.every((l) => l.verdict === 'PASS')) return 'PASS';
  return 'NOT_ASSESSED';
}
