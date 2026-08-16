/**
 * ANALYSIS-STATE AUTHORITY, STEP 3 — compose `AnalysisStateV1` (schemas 0.46.0).
 *
 * WHAT THIS IS. One composed verdict per turn answering "what is the state of
 * the analysis, and what may a surface claim about it". Today every surface
 * derives its own answer from a different subset of the payload and the
 * derivations disagree — the estate has shipped a confirmation that withheld a
 * leading option while the coaching sentence beneath it named one. A verdict
 * composed ONCE by the producer is the structural fix: every surface reads the
 * same fields, so two surfaces cannot disagree about a fact neither derives.
 *
 * WHAT THIS IS NOT. It computes nothing new. Every member is a projection of a
 * value the turn had already computed — the canonical analysis state
 * (`context/canonical-analysis-state.ts`), the freshness derivation, the
 * readiness payload, the constraint-feasibility entitlement, and the engine's
 * own robustness signals as they appear on the wire. No LLM call, no engine
 * call, no store read, no graph walk. That is a deliberate constraint, not an
 * accident of scope: a composed verdict that re-derives its inputs would be a
 * seventh authority rather than the single one.
 *
 * ─── PRODUCER OF RECORD, per contract member ────────────────────────────────
 *
 *   run_state            CanonicalAnalysisState.freshness / .status
 *                        + FreshnessDerivation.reason (cause axes)
 *                        + FreshnessDerivation.refusal_declared (the `refused`
 *                          branch — see below)
 *   readiness.status     CanonicalAnalysisState.status
 *   readiness.blockers   the wire blockers, mapped by `blockerIssue` — the
 *                        SAME mapper #983's canonical readiness assessor uses,
 *                        imported rather than re-implemented, so the two can
 *                        never disagree about what a blocker means
 *   leader_claim         CEE `MAY_NAME_LEADING_OPTION` entitlement (threaded as
 *                        `mayNameLeadingOption`, already required on every V5
 *                        exit and read fail-closed) ∧ the engine's own
 *                        `near_tie` separation
 *   robustness           the engine's `enrichment.robustness` as it ships
 *   the five predicates  CanonicalAnalysisState — copied, never recomputed
 *   contradictions       CanonicalAnalysisState.contradictions
 *
 * ─── `refused`, and why it is signalled rather than inferred ────────────────
 *
 * `refused` says: THIS TURN DECLINED TO ANALYSE, so any result on screen is
 * from an earlier run whose currency this turn does not vouch for. Today that
 * situation is expressed by three signals that do not add up to one state —
 * a `blocked` readiness, a clamped `unknown` freshness, and the instruction to
 * retain the prior result — and the contradiction that produces is the defect
 * this contract exists to close.
 *
 * The refusal is carried EXPLICITLY on the freshness derivation
 * (`refusal_declared`) rather than inferred from `freshness_reason`, because
 * `clampRefusalFreshness` EARLY-RETURNS an already-stale or already-unknown
 * derivation untouched. On that path the refusal reason never appears, so a
 * reason-sniffing implementation reports `complete_stale` and the product goes
 * on vouching for a result the turn refused to stand behind. The explicit flag
 * is set on BOTH clamp branches; the early-return case has its own test.
 *
 * ─── STATED LIMITS (visible in a green suite, not assumed closed) ───────────
 *
 * L-A. `running` has NO PRODUCER at this step and is therefore never emitted.
 *      CEE turns are synchronous: by the time this composes, the run has
 *      finished, failed, been refused, or was never attempted. Emitting
 *      `running` would require an async run registry that does not exist.
 * L-B. `robustness.factors_that_flip_leader` is NEVER emitted. Absent means
 *      "the flip analysis was not computed"; `[]` would mean "it was computed
 *      and nothing flips" — opposite claims. The only flip evidence reachable
 *      here is keyed by factor LABEL and the contract requires IDs, so either
 *      value would be a fabricated finding.
 * L-C. `leader_claim.permitted` FAILS CLOSED when the separation half is
 *      unknown, carrying `withheld_reason: 'separation_unavailable'`. The
 *      contract defines `permitted` as a conjunction true only when BOTH
 *      halves hold, and an unknown half is not a held half. CONSEQUENCE, named
 *      here because step 7 is where it bites: on a turn that displays a PRIOR
 *      analysis without re-shipping its `analysis_result` block, the separation
 *      half is unreadable at this seam, so `permitted` is false. Nothing
 *      consumes this field yet; a UI conjunct built on it (step 7) must first
 *      settle whether the separation verdict should be persisted with the fact.
 * L-D. The three DISCLOSED LIMITS the contract itself pins (L1 permitted vs
 *      withheld_reason, L2 usability vs run_state, L3 contradictions semantics)
 *      stay disclosed. This producer invents no cross-field rule the
 *      adjudication has not ratified — in particular it does NOT force the
 *      usability booleans to agree with `run_state`; they are copied from the
 *      canonical verdict as computed.
 */

import type {
  AnalysisBlocker,
  AnalysisLeaderClaim,
  AnalysisRobustness,
  AnalysisRunState,
  AnalysisStateV1,
} from '@talchain/schemas/boundary';

import { blockerIssue } from '../../orchestrator/tools/analysis-ready-helper.js';
import type { CanonicalAnalysisState } from '../context/canonical-analysis-state.js';
import type { FreshnessDerivation } from '../context/freshness.js';
import { readRawRobustnessSignals } from '../coaching/pick-raw-robustness.js';
import type { RawRobustnessSignals } from '../coaching/pick-raw-robustness.js';

/**
 * The readiness status this producer emits when the turn supplied no readiness
 * at all. CEE-owned vocabulary (the contract's `readiness.status` is a free
 * string by design — the vocabulary lives with the producer). It says exactly
 * what is true: no readiness verdict was supplied on this turn. It is NOT a
 * synonym for `blocked`, and a consumer must not treat it as one.
 */
export const READINESS_STATUS_UNSUPPLIED = 'unknown';

/** `blocked_reason` emitted when a blocked verdict arrived without one. */
export const BLOCKED_REASON_UNSPECIFIED = 'analysis_blocked_unspecified';

/** `reason_code` emitted when a refusal arrived without a specific reason. */
export const REFUSAL_REASON_UNSPECIFIED = 'analysis_refused_unspecified';

/** `withheld_reason` codes. Producer-owned; a consumer maps them to its copy. */
export const WITHHELD_CONSTRAINT_VERDICT = 'constraint_verdict_withheld';
export const WITHHELD_NEAR_TIE = 'options_do_not_separate';
export const WITHHELD_SEPARATION_UNAVAILABLE = 'separation_unavailable';

/** `separation` statements. Producer-owned; absence means "not computed". */
export const SEPARATION_SEPARATED = 'separated';
export const SEPARATION_NEAR_TIE = 'near_tie';

export interface AnalysisStateComposeInput {
  /**
   * The turn's canonical analysis verdict. `null` ⇒ this producer has no
   * verdict to supply and emits NOTHING — contract-licensed absence, which
   * means "no verdict was supplied" and is distinct from every emitted state.
   */
  readonly canonical: CanonicalAnalysisState | null;
  /** The freshness derivation the canonical verdict was built from. */
  readonly freshness?: FreshnessDerivation;
  /** The readiness payload this turn ships, for `blocked_reason` and blockers. */
  readonly readiness?: {
    readonly status?: unknown;
    readonly blocked_reason?: unknown;
    readonly blockers?: readonly unknown[];
  };
  /**
   * CEE's constraint entitlement for this turn (`MAY_NAME_LEADING_OPTION`),
   * threaded from the dispatch path. Fail-closed: anything other than an
   * explicit `true` is read as "not entitled".
   */
  readonly mayNameLeadingOption?: boolean;
  /** The engine's own robustness signals as they appear on this turn's wire. */
  readonly rawRobustness: RawRobustnessSignals | null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Zod's `.datetime()` (no options) accepts UTC only — a `Z` suffix, no offset.
 * A `computed_at` that does not satisfy it cannot ride a `complete_*` branch,
 * so the verdict degrades VISIBLY rather than failing egress validation and
 * destroying the turn.
 */
const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function utcIsoOrNull(value: unknown): string | null {
  const s = readNonEmptyString(value);
  if (s === null || !UTC_ISO.test(s)) return null;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

/**
 * Map the wire blockers onto the contract's blocker shape.
 *
 * DERIVED, NOT MIRRORED: `blockerIssue` is the mapper #983's canonical
 * readiness assessor already uses to turn a wire blocker into a
 * code/category/message/repairability issue. Importing it means the wire
 * contract and the assessor cannot drift into two different answers about what
 * `missing_connection` means. `issue_id` is dropped — it is the assessor's
 * internal correlation handle and the contract's blocker is `.strict()`.
 */
export function mapWireBlockers(
  blockers: readonly unknown[] | undefined,
  status: string,
): AnalysisBlocker[] {
  if (!Array.isArray(blockers) || blockers.length === 0) return [];
  const out: AnalysisBlocker[] = [];
  blockers.forEach((blocker, index) => {
    const issue = blockerIssue(blocker, index, status);
    if (issue === null) return;
    const { issue_id: _correlationHandle, ...rest } = issue;
    out.push(rest);
  });
  return out;
}

function composeRunState(input: AnalysisStateComposeInput): AnalysisRunState {
  const canonical = input.canonical as CanonicalAnalysisState;
  const freshness = input.freshness;

  // 1. REFUSAL FIRST. A refusal turn also carries a `blocked` readiness (the
  //    refusal builder emits one), so testing `blocked` before `refused` would
  //    collapse the new state into the old one — the exact conflation this
  //    contract exists to end. Order is load-bearing and is pinned by a test.
  if (freshness?.refusal_declared === true) {
    return {
      kind: 'refused',
      reason_code:
        readNonEmptyString(input.readiness?.blocked_reason) ?? REFUSAL_REASON_UNSPECIFIED,
    };
  }

  // 2. The MODEL is unanalysable — a statement about the model, not a failure
  //    of the engine.
  if (canonical.status === 'blocked') {
    return {
      kind: 'blocked',
      reason_code:
        readNonEmptyString(input.readiness?.blocked_reason) ?? BLOCKED_REASON_UNSPECIFIED,
      blockers: mapWireBlockers(input.readiness?.blockers, 'blocked'),
    };
  }

  // 3. Nothing has ever run.
  if (canonical.freshness === 'none') return { kind: 'never_run' };

  const computedAt = utcIsoOrNull(canonical.computed_at);

  if (canonical.freshness === 'fresh') {
    // A complete branch REQUIRES a timestamp. Without a usable one the honest
    // verdict is that the producer cannot classify the fact, not a fabricated
    // "now" — a synthesised timestamp would be read as provenance.
    return computedAt !== null
      ? { kind: 'complete_current', computed_at: computedAt }
      : { kind: 'unknown_degraded', cause: 'legacy_fact' };
  }

  if (canonical.freshness === 'stale') {
    if (computedAt === null) return { kind: 'unknown_degraded', cause: 'legacy_fact' };
    // The two causes carry DIFFERENT remedies: re-running after a graph change
    // recomputes against new structure, whereas an options change invalidates
    // the comparison itself. Collapsing them loses the only actionable half.
    return {
      kind: 'complete_stale',
      computed_at: computedAt,
      cause:
        canonical.freshness_reason === 'analysed_options_diverged'
          ? 'options_changed'
          : 'graph_changed',
    };
  }

  // 4. `unknown` — the honest absence of a verdict, emitted in preference to
  //    guessing one. Each cause carries a different honest sentence.
  switch (canonical.freshness_reason) {
    case 'legacy_fact_missing_hash':
      return { kind: 'unknown_degraded', cause: 'legacy_fact' };
    case 'current_graph_hash_unavailable':
      return { kind: 'unknown_degraded', cause: 'no_graph_this_turn' };
    case 'analysis_refused_currency_unverified':
      return { kind: 'unknown_degraded', cause: 'refusal_unverified' };
    default:
      // `derivation_failed` (the fact store could not be read) and
      // `invariant_failed` (a persisted fact failed its own integrity check)
      // are both "the store did not give us something we could classify".
      return { kind: 'unknown_degraded', cause: 'store_unreadable' };
  }
}

function composeLeaderClaim(input: AnalysisStateComposeInput): AnalysisLeaderClaim {
  const entitled = input.mayNameLeadingOption === true;
  const raw: RawRobustnessSignals | null = input.rawRobustness;
  const separationKnown = raw !== null;
  const separates = separationKnown && !raw.near_tie_is_tie;

  const claim: {
    permitted: boolean;
    withheld_reason?: string;
    separation?: string;
  } = { permitted: entitled && separates };

  if (!claim.permitted) {
    // ONE reason, chosen by which half failed first, so a consumer is never
    // told "the options do not separate" about a turn whose CEE verdict
    // withheld the claim for an unrelated reason.
    claim.withheld_reason = !entitled
      ? WITHHELD_CONSTRAINT_VERDICT
      : separationKnown
        ? WITHHELD_NEAR_TIE
        : WITHHELD_SEPARATION_UNAVAILABLE;
  }
  // ABSENCE IS DISTINCT: omitted means no separation statement was computed,
  // never "the options do not separate".
  if (separationKnown) {
    claim.separation = raw.near_tie_is_tie ? SEPARATION_NEAR_TIE : SEPARATION_SEPARATED;
  }
  return claim;
}

function composeRobustness(input: AnalysisStateComposeInput): AnalysisRobustness {
  const level = input.rawRobustness?.level ?? null;
  // See L-B: `factors_that_flip_leader` is deliberately never emitted.
  return level !== null ? { aggregate_level: level } : {};
}

/**
 * Compose the turn's `analysis_state`, or `undefined` when there is no verdict
 * to supply.
 *
 * Pure and allocation-light: it reads already-computed values and builds one
 * object. It performs no I/O and calls no model.
 */
export function composeAnalysisStateV1(
  input: AnalysisStateComposeInput,
): AnalysisStateV1 | undefined {
  const canonical = input.canonical;
  if (canonical === null) return undefined;

  const readinessStatus =
    readNonEmptyString(canonical.status) ?? READINESS_STATUS_UNSUPPLIED;

  return {
    run_state: composeRunState(input),
    readiness: {
      status: readinessStatus,
      // An EMPTY list here is a positive claim: readiness was assessed and
      // nothing is blocking. It is distinct from `analysis_state` being absent.
      blockers: mapWireBlockers(input.readiness?.blockers, readinessStatus),
    },
    leader_claim: composeLeaderClaim(input),
    robustness: composeRobustness(input),
    // The five predicates are COPIED from the canonical verdict, never
    // recomputed: a consumer that re-derives them re-opens the divergence this
    // contract closes, and so would a second derivation here.
    usable_for_prose: canonical.usableForProse,
    usable_for_chips: canonical.usableForChips,
    usable_for_followup: canonical.usableForFollowupContext,
    requires_rerun: canonical.requiresRerun,
    blocked_unusable: canonical.blockedUnusable,
    // The producer's OWN self-report. Empty means it found none — never a
    // consistency guarantee (contract limit L3, left disclosed).
    contradictions: [...canonical.contradictions],
  };
}

/**
 * Read the engine's robustness signals off the response body as it will ship.
 *
 * Read from the WIRE rather than from the fact so the verdict describes what
 * the consumer actually receives: when the withheld-claim projection has
 * redacted `near_tie`, the separation half is genuinely unknown to the
 * consumer, and `leader_claim` must say so rather than assert a separation the
 * payload no longer carries.
 */
export function readRawRobustnessFromResponseBody(
  response: unknown,
): RawRobustnessSignals | null {
  if (response == null || typeof response !== 'object') return null;
  const blocks = (response as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return null;
  for (const block of blocks) {
    if (block == null || typeof block !== 'object') continue;
    const enrichment = (block as { enrichment?: unknown }).enrichment;
    if (enrichment == null || typeof enrichment !== 'object') continue;
    const signals = readRawRobustnessSignals(
      (enrichment as Record<string, unknown>)['robustness'],
    );
    if (signals !== null) return signals;
  }
  return null;
}
