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
 * own robustness signals from either this response body or the exact current
 * run-analysis fact already selected by final freshness. No LLM call, no
 * engine call, no store read, no graph walk. That is a deliberate constraint,
 * not an accident of scope: a composed verdict that re-derives its inputs
 * would be a seventh authority rather than the single one.
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
 *   robustness           the engine's `enrichment.robustness` from this body,
 *                        else the exact current fact selected by freshness
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
 * L-A. `running` HAS EXACTLY ONE PRODUCER, AND ITS SCOPE IS NARROW.
 *      ⚠ THIS LIMIT USED TO READ "`running` has NO PRODUCER at this step and is
 *      therefore never emitted … emitting it would require an async run
 *      registry that does not exist". The first clause is now false and the
 *      second was always narrower than it sounded, so both are corrected here
 *      rather than deleted (trap 14).
 *
 *      The general claim it made is still TRUE: a synchronous turn cannot
 *      discover, at compose time, that some OTHER request's run is in flight.
 *      No registry exists and this producer does not invent one.
 *
 *      What it missed is the ONE case where the turn composing the verdict is
 *      itself the turn that STARTED the run: a fresh admissible draft schedules
 *      a provisional auto-run (`handlers/auto-run-after-draft.ts`, ROADMAP
 *      2.1271). That turn does not need a registry — it knows, from its own
 *      admission decision, that a run is beginning. `autoRunInFlight` carries
 *      exactly that knowledge and nothing wider: it is threaded ONLY by the
 *      draft exit, ONLY when the same `resolveRunAdmission` verdict that gates
 *      the scheduler said the run will proceed, and it carries the START
 *      instant as an observation rather than a compose-time clock read.
 *
 *      So the arm is emitted iff the composing turn is the run's own trigger.
 *      Every other turn still cannot say `running`, and still does not.
 * L-B. `robustness.factors_that_flip_leader` is NEVER emitted. Absent means
 *      "the flip analysis was not computed"; `[]` would mean "it was computed
 *      and nothing flips" — opposite claims. The only flip evidence reachable
 *      here is keyed by factor LABEL and the contract requires IDs, so either
 *      value would be a fabricated finding.
 * L-C. `leader_claim.permitted` FAILS CLOSED when the separation half is
 *      unknown, carrying `withheld_reason: 'separation_unavailable'`. The
 *      contract defines `permitted` as a conjunction true only when BOTH
 *      halves hold, and an unknown half is not a held half.
 *
 *      A response-body analysis result is the first source. A block-less
 *      deterministic follow-up may use the robustness carried by the exact
 *      current run-analysis fact already selected by final freshness. That
 *      carrier is positional and hot/final-wire scoped: stale, unavailable,
 *      malformed or unselected facts supply nothing, and it is NOT a durable
 *      >20-history authority. Durable convergence remains a separate exit.
 *
 *      Egress then distinguishes DESIGNATION from EVIDENCE. `permitted=true`
 *      licenses categorical designation only on `complete_current`. A valid
 *      withheld reason may retain an exact producer-attested numerical
 *      comparison with a same-unit qualification; it never upgrades that
 *      comparison into “Option A is the leader”.
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

/**
 * ⭐ TWO DIFFERENT FACTS WEAR THE SAME `withheld_reason` FIELD (S6, 2026-08-26).
 *
 * WIRE-WITNESSED on the stale route: `leader_claim.permitted: false,
 * withheld_reason: 'separation_unavailable'` shipped beside
 * `claim_safety.may_name_leading_option: true`, while the prose named the
 * leader. Read as a permission that reads as a contradiction. It is not one:
 *
 *   - `constraint_verdict_withheld` / `options_do_not_separate` mean
 *     **WE LOOKED AND DECLINED**. A leader must not be named.
 *   - `separation_unavailable` means **WE DID NOT ESTABLISH SEPARATION.** It is
 *     not evidence of a tie, but it also cannot license a categorical leader:
 *     the final contract requires both entitlement and established separation.
 *     Independently attested numerical evidence may remain available without
 *     upgrading that absence into a designation.
 *
 * Collapsing those two into "withheld" is what makes the capture look like a
 * contradiction, and it is the read a consumer makes by default because the
 * FIELD IS CALLED `withheld_reason`. The kind below is the producer's own
 * declaration of which it means, so a consumer never has to infer it from the
 * code string.
 *
 * `may_name_leading_option` remains the entitlement INPUT; `permitted` is the
 * final designation authority after combining that input with separation. A
 * final consumer must not let the earlier, broader input resurrect permission.
 * The reason classification below remains useful for truthful copy:
 * `not_evaluated` is not the same claim as `withheld`, even though neither
 * licenses a categorical designation.
 */
export type LeaderClaimReasonKind = 'not_evaluated' | 'withheld' | 'unknown';

/**
 * The SINGLE source for both the code list and the classification. Every code
 * this producer can emit appears here exactly once with its kind.
 *
 * ⚠⚠ THE GUARANTEE THIS COMMENT USED TO STATE WAS FALSE, AND IS CORRECTED
 * RATHER THAN DELETED (trap 14). It read: "minting a fourth code without
 * classifying it is a type error at the mint site rather than an unclassified
 * reason reaching a consumer." Measured by minting a fourth `WITHHELD_*`
 * constant and classifying it nowhere: `pnpm typecheck` **exit 0, zero
 * errors** — the type below is `Record<string, …>`, an OPEN index signature, so
 * there is no mint site to fail. A positive control (an injected type error in
 * this same file) exited 2, so the probe could see a presence.
 *
 * ⭐ WHERE IT ACTUALLY FAILS NOW, and it is a TEST, not the compiler: the
 * COMPLETENESS case in `__tests__/leader-claim-not-evaluated.test.ts` derives
 * the minted list from this module's own namespace (every exported
 * `WITHHELD_*` string) and asserts each is classified here. Proven by the
 * mutant pair: it passes at pristine and REDs on the unclassified fourth code
 * that the previous hand-written list survived.
 *
 * Runtime was never at risk either way — an unclassified code falls to
 * `'unknown'` and fail-closed. It was the GUARANTEE that was wrong, which is
 * the same "documented limit that reads as considered" defect this file is
 * correcting one level up.
 */
export const LEADER_CLAIM_REASON_KINDS: Readonly<
  Record<string, Exclude<LeaderClaimReasonKind, 'unknown'>>
> = {
  [WITHHELD_CONSTRAINT_VERDICT]: 'withheld',
  [WITHHELD_NEAR_TIE]: 'withheld',
  [WITHHELD_SEPARATION_UNAVAILABLE]: 'not_evaluated',
};

/**
 * Classify a `withheld_reason`. An unrecognised code is `'unknown'` and is
 * NEVER folded into either real kind: a consumer must not read a code this
 * producer did not mint as a licence to name a leader, nor as a positive claim
 * that the separation was evaluated.
 *
 * ⚠ `hasOwnProperty.call`, NOT a bare index read. A bare
 * `LEADER_CLAIM_REASON_KINDS[reason]` resolves INHERITED keys, so
 * `'constructor'` / `'toString'` / `'__proto__'` returned a prototype member
 * where this signature promises a `LeaderClaimReasonKind` — the `?? 'unknown'`
 * fallback never fired. Fail-closed held (no prototype member equals
 * `'withheld'`), so the runtime impact was nil and the TYPE claim was the
 * defect. This is the guard the subsystem already uses for exactly this lookup
 * at `orchestrator/context/constraint-feasibility.ts:937`; new code diverging
 * from it is how one subsystem ends up with two answers to one question.
 */
export function leaderClaimReasonKind(reason: string | null | undefined): LeaderClaimReasonKind {
  if (typeof reason !== 'string') return 'unknown';
  return Object.prototype.hasOwnProperty.call(LEADER_CLAIM_REASON_KINDS, reason)
    ? LEADER_CLAIM_REASON_KINDS[reason]!
    : 'unknown';
}

/**
 * Did the product actually evaluate the separation on THIS payload?
 *
 * ⚠⚠ READS THE PAYLOAD, NOT THE REASON CODE — AND THE FIRST VERSION READ THE
 * CODE, WHICH MADE THE EXACT FALSE CLAIM THIS MODULE EXISTS TO PREVENT.
 * It was `leaderClaimReasonKind(reason) === 'withheld'`. The reason code CANNOT
 * answer this question, because `composeLeaderClaim` chooses `!entitled` FIRST:
 * in the cell `entitled=false ∧ separationKnown=false` the claim carries
 * `constraint_verdict_withheld` — a "we looked and declined" code — while
 * `rawRobustness` is null and nothing was measured. Executed at `d097e596`:
 * `{rawRobustness: null, separationWasActuallyEvaluated: false,
 * separationWasEvaluated_says: TRUE}`. Same defect class as the witnessed one,
 * opposite sign. (The code string itself is correct for its own question and is
 * unchanged: `!entitled` genuinely is the first failing half.)
 *
 * ⭐ THE PAYLOAD IS THE AUTHORITY, and this producer already states it: the
 * `separation` field is emitted IFF the separation was computed, and its
 * ABSENCE is the deliberate signal for "not computed" (see `ABSENCE IS
 * DISTINCT` in `composeLeaderClaim`). That is a fact about what was measured;
 * the reason code is a fact about which half failed first. Two questions.
 *
 * FAIL-CLOSED: a missing, non-string, or unminted `separation` value cannot
 * support a positive claim that anything was measured.
 */
export function separationWasEvaluated(
  claim: { readonly separation?: unknown } | null | undefined,
): boolean {
  if (claim === null || typeof claim !== 'object') return false;
  const separation = (claim as { readonly separation?: unknown }).separation;
  return typeof separation === 'string' && SEPARATION_STATEMENTS.has(separation);
}

/** `separation` statements. Producer-owned; absence means "not computed". */
export const SEPARATION_SEPARATED = 'separated';
export const SEPARATION_NEAR_TIE = 'near_tie';

/**
 * The separation statements this producer can emit, DERIVED from the constants
 * above rather than retyped, so `separationWasEvaluated` cannot drift from what
 * `composeLeaderClaim` actually writes (trap 12). Membership is what licenses
 * the positive claim "a separation was computed on this payload".
 */
const SEPARATION_STATEMENTS: ReadonlySet<string> = new Set([
  SEPARATION_SEPARATED,
  SEPARATION_NEAR_TIE,
]);

/**
 * STEP 4 / ROADMAP 2.1264 — the freshness derivation that is TRUE of a turn
 * exit which carried no analysis context at all.
 *
 * WHY A DERIVATION AND NOT A HAND-WRITTEN `run_state`. Every value in the
 * emitted verdict — the run state, the five usability predicates, the
 * contradiction list — then comes out of the ONE implementation that computes
 * them for every other turn (`assembleCanonicalState`, reached via
 * `canonicalStateFromFreshness`) rather than out of a second literal that a
 * future change to the predicate rules would silently leave behind. A
 * hand-built minimal object here would be the hand-maintained mirror (trap 12)
 * sitting directly beside the code it mirrors.
 *
 * ⚠ WHEN IT IS REACHED — NARROWED BY THE PR #1004 REVIEW, AND THE OLD TEXT WAS
 * OVER-BROAD (trap 14). It used to say this derivation covers "the clarify-family
 * exits", full stop. It does not, and must not: those exits now carry the
 * persisted-graph derivation their own claim-safety read produced
 * (`TurnExitStamp.exitFreshness`), because on a POST-ANALYSIS clarification turn
 * this state would DEGRADE a verdict CEE already knew was current — the
 * self-inflicted degradation the review blocked. This derivation is the LAST
 * resort: no canonical state, no per-turn derivation, and no exit derivation
 * either, i.e. genuinely nothing was looked at (today: the `system_event` family,
 * which passes a `null` payload to the resolver, and non-route callers).
 *
 * WHY EACH MEMBER IS TRUE of that residual case, not merely convenient:
 *   - `freshness: 'unknown'`      the turn classified nothing;
 *   - `reason: 'current_graph_hash_unavailable'` no graph was in scope, so the
 *                                current graph hash genuinely could not be
 *                                computed. `composeRunState` maps exactly this
 *                                reason to `unknown_degraded` /
 *                                `no_graph_this_turn`, whose contract text is
 *                                "no graph was in scope, so there was nothing
 *                                to classify";
 *   - `selected_fact_index: null` no fact was selected, which is what drives
 *                                every usability predicate to false;
 *   - the three remaining members are null because there is no fact and no
 *                                graph to take a hash or a timestamp from.
 *
 * ⚠ AND WHAT IT IS DELIBERATELY *NOT*: `never_run`. The step-4 brief asked for
 * `never_run` on these exits. The vendored contract declares that state as "No
 * analysis has ever been run for this model", licensing a consumer to render
 * the pre-analysis affordance — a claim about the SCENARIO'S WHOLE HISTORY that
 * an exit with no fact read cannot support. On a scenario that does hold a
 * completed analysis it would send the UI to the pre-analysis affordance over a
 * real result: the contradiction class this contract exists to close,
 * manufactured by its own fix. `never_run` stays reserved for the case a fact
 * read actually returned nothing (`freshness: 'none'`), which is the only place
 * the positive claim is earned.
 *
 * ⭐ AND THAT PLACE NOW EXISTS ON THESE EXITS. With `exitFreshness` threaded, a
 * graph-less exit on a never-analysed scenario DOES have a real fact read behind
 * it and DOES emit `never_run` — the brief's requested state, arrived at by
 * earning the claim rather than by asserting it.
 *
 * ⚠ HOLD IT LOCALLY — NEVER ASSIGN IT TO `ctx.freshness`.
 * `current_graph_hash_unavailable` is a member of
 * `FRESHNESS_ONLY_SYNTHESIS_REASONS`, so a turn whose `ctx.freshness` carries
 * it ALSO gets a synthesised freshness-only `analysis_ready` block whose status
 * is `blocked`. Threading this derivation onto the context would therefore add
 * a second top-level key and a fabricated blocked claim to every clarification
 * turn. Pinned by a named test with a positive control on the synthesis path.
 */
export const NO_ANALYSIS_CONTEXT_DERIVATION: FreshnessDerivation = Object.freeze({
  freshness: 'unknown',
  reason: 'current_graph_hash_unavailable',
  selected_fact_index: null,
  graph_hash_at_run: null,
  current_graph_hash: null,
  computed_at: null,
});

export interface AnalysisStateComposeInput {
  /**
   * The turn's canonical analysis verdict. `null` ⇒ this producer has no
   * verdict to supply and emits NOTHING — contract-licensed absence, which
   * means "no verdict was supplied" and is distinct from every emitted state.
   *
   * ⚠ THE V5 FINALISER NO LONGER PASSES `null` (ROADMAP 2.1264): a turn exit
   * with no analysis context now composes a verdict from
   * {@link NO_ANALYSIS_CONTEXT_DERIVATION} instead, so that absence on the WIRE
   * means only "this CEE build predates the field". The `null` branch stays
   * because this composer is not V5-only property, and it stays under test
   * rather than becoming untested dead code.
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
  /**
   * The engine's robustness from this response body, or from the exact current
   * run-analysis fact selected by the final freshness derivation.
   */
  readonly rawRobustness: RawRobustnessSignals | null;
  /**
   * ROADMAP 2.1271 — THE ONE PRODUCER OF `run_state.kind === 'running'`.
   *
   * Present iff THIS turn has itself started a provisional analysis that is now
   * in flight (today: the fresh-draft auto-run). See L-A above for why that is
   * the only case a synchronous turn can honestly claim, and
   * `orchestrator/route-v2.ts`'s draft exit for the single threading site.
   *
   * `startedAt` MUST be the instant the run was started, as a UTC ISO-8601
   * string. It is validated with the same {@link utcIsoOrNull} the
   * `complete_*` branches use, and for the same reason: the contract declares
   * `started_at` as `z.string().datetime()` at RUNTIME (the generated `.d.ts`
   * widens it to `string`, so TypeScript alone will NOT stop a bad value — it
   * would fail egress validation and destroy the turn). An unusable timestamp
   * therefore FALLS THROUGH to the ordinary derivation rather than being
   * replaced by a fabricated `now`: a synthesised start instant would be read
   * as provenance, and the contract's own text forbids inferring a finish time
   * from it.
   */
  readonly autoRunInFlight?: { readonly startedAt: string };
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

  // 2b. A RUN THIS TURN STARTED IS IN FLIGHT (ROADMAP 2.1271).
  //
  // ⚠ THE POSITION IS LOAD-BEARING IN BOTH DIRECTIONS AND IS PINNED BY TESTS.
  //
  // BELOW refusal and blocked. Those two describe THIS TURN'S refusal and THE
  // MODEL'S unanalysability, and neither can co-occur with a proceeding run
  // under the sanctioned threading (`willProceed` is false on an inadmissible
  // model). If either combination ever did become reachable, the refusal /
  // blocked statement is the truer one — it says why nothing useful can come
  // back — so the fail-safe direction is to let them win.
  //
  // ABOVE `never_run` and above every `complete_*` / `unknown_*` branch, and
  // for two different reasons:
  //   · `never_run` claims "no analysis has ever been run … a consumer renders
  //     the pre-analysis affordance" (contract text). On a draft whose
  //     provisional run is already in flight that invites the user to start an
  //     analysis that is running — the exact mild dishonesty this arm removes.
  //   · a `complete_*` verdict would present an EARLIER run's numbers as this
  //     turn's outcome. The contract's own `running` text settles it: "Any
  //     result currently on screen is from an EARLIER run: a consumer may keep
  //     showing it but must mark it as superseded-pending, and must not present
  //     it as the outcome of the run now in flight."
  //
  // An unusable timestamp falls through rather than fabricating one — see
  // `autoRunInFlight`'s docstring.
  const runStartedAt = utcIsoOrNull(input.autoRunInFlight?.startedAt);
  if (runStartedAt !== null) return { kind: 'running', started_at: runStartedAt };

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
  const tie = raw?.near_tie_is_tie ?? null;
  const separationKnown = typeof tie === 'boolean';
  const separates = tie === false;

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
    claim.separation = tie ? SEPARATION_NEAR_TIE : SEPARATION_SEPARATED;
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
  const analysisBlocks = blocks.filter(
    (block): block is Record<string, unknown> =>
      block != null &&
      typeof block === 'object' &&
      (block as { readonly type?: unknown }).type === 'analysis_result',
  );
  // More than one analysis block is an ambiguous wire authority. A caller may
  // not select whichever robustness object happens to appear first.
  if (analysisBlocks.length !== 1) return null;
  const enrichment = analysisBlocks[0]?.['enrichment'];
  if (enrichment == null || typeof enrichment !== 'object') return null;
  return readRawRobustnessSignals(
    (enrichment as Record<string, unknown>)['robustness'],
  );
}

/**
 * Read the final, consumer-visible leader-claim licence from a response.
 *
 * This is deliberately a reader of the already-composed wire authority, not a
 * second derivation from entitlement, robustness or analysis payloads. The
 * response contract permits ranked leader prose only when BOTH this final
 * licence is true and the final run is current. An earlier broader entitlement
 * cannot overrule either conjunct at composition or egress. Missing or
 * malformed state fails closed: absence is not permission.
 */
export function readFinalLeaderClaimPermission(response: unknown): boolean {
  return readFinalLeaderClaimEgressPolicy(response) === 'designation_permitted';
}

/**
 * The final wire policy for leader language.
 *
 * The response contract distinguishes a categorical designation from the
 * underlying measured data. A near-tie therefore does not license “Option A is
 * the leader”, but a precisely quantified comparison may still be shown when
 * the same unit truthfully discloses why designation is unavailable. The three
 * valid non-permitted reason states are kept distinct so egress never invents a
 * tie, a constraint reason or an unavailable-separation conclusion. Stale,
 * non-current, contradictory or unreadable state has no evidence carve-out at
 * this boundary.
 */
export type FinalLeaderClaimEgressPolicy =
  | 'designation_permitted'
  | 'evidence_only_options_do_not_separate'
  | 'evidence_only_constraint_verdict_withheld'
  | 'evidence_only_separation_unavailable'
  | 'designation_withheld';

export function readFinalLeaderClaimEgressPolicy(
  response: unknown,
): FinalLeaderClaimEgressPolicy {
  if (response == null || typeof response !== 'object') return 'designation_withheld';
  const analysisState = (response as { readonly analysis_state?: unknown }).analysis_state;
  if (analysisState == null || typeof analysisState !== 'object') {
    return 'designation_withheld';
  }
  const runState = (analysisState as { readonly run_state?: unknown }).run_state;
  if (runState == null || typeof runState !== 'object') return 'designation_withheld';
  if ((runState as { readonly kind?: unknown }).kind !== 'complete_current') {
    return 'designation_withheld';
  }
  const leaderClaim = (analysisState as { readonly leader_claim?: unknown }).leader_claim;
  if (leaderClaim == null || typeof leaderClaim !== 'object') {
    return 'designation_withheld';
  }
  const permitted = (leaderClaim as { readonly permitted?: unknown }).permitted;
  const withheldReason = (leaderClaim as { readonly withheld_reason?: unknown }).withheld_reason;
  const separation = (leaderClaim as { readonly separation?: unknown }).separation;
  if (
    permitted === true &&
    withheldReason === undefined &&
    (separation === undefined || separation === SEPARATION_SEPARATED)
  ) {
    return 'designation_permitted';
  }
  if (permitted !== false) return 'designation_withheld';
  if (withheldReason === WITHHELD_NEAR_TIE && separation === SEPARATION_NEAR_TIE) {
    return 'evidence_only_options_do_not_separate';
  }
  if (
    withheldReason === WITHHELD_CONSTRAINT_VERDICT &&
    (separation === undefined ||
      separation === SEPARATION_NEAR_TIE ||
      separation === SEPARATION_SEPARATED)
  ) {
    return 'evidence_only_constraint_verdict_withheld';
  }
  if (withheldReason === WITHHELD_SEPARATION_UNAVAILABLE && separation === undefined) {
    return 'evidence_only_separation_unavailable';
  }
  return 'designation_withheld';
}
