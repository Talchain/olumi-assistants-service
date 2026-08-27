/**
 * THE CONSEQUENCE PRODUCER — builds the WIRE `run_delta` block from two
 * persisted `run_analysis` facts.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ WHY THIS FILE EXISTS. `@talchain/schemas` has carried
 * `OlumiResponseSchema.run_delta` since 0.39.0, and its header states the
 * architecture verbatim: *"CEE emits ONE `run_delta` per completed rerun,
 * carried on the turn envelope beside `analysis_ready`. The UI renders it with
 * ZERO client-side computation: every number, tag and entitlement below is
 * producer-computed."* Until this file, CEE had **zero writers** of that field
 * (measured: `run_delta` occurrences in CEE `src/` = 0, against
 * `analysis_result` = 175) and the UI had zero renderers. The contract was
 * agreed and unimplemented at both ends.
 *
 * ⭐ THE SAFETY PROPERTY, STATED AS A PROPERTY AND NOT AS AN ASIDE.
 * **There is no LLM anywhere on this path.** Every field below is computed by
 * pure code from two persisted producer envelopes. A deployed drive on
 * 2026-08-27 caught the model making a confident, precisely-quantified and
 * TOPOLOGICALLY FALSE claim about which routes pass through a node — exact on
 * the quantities, wrong on the structure. That failure mode cannot reach this
 * block, and it must be kept that way: **this file emits no structural or
 * topological claim of any kind.** `edit_list` (deferred to slice two) is
 * projection FIELD PATHS derived from the graph bytes, never a model-authored
 * description of what changed.
 *
 * ⚠ TWO TYPES NAMED `RunDelta` USED TO EXIST ACROSS THIS BOUNDARY.
 * This file builds the WIRE type (`@talchain/schemas/boundary` `RunDelta`),
 * which answers *"what does the wire carry, and what is the producer ENTITLED
 * to claim?"*. The CEE-internal `ContentSafeRunDelta`
 * (`coaching/compare-runs.ts`) answers *"what may this turn SAY in prose?"* and
 * is deliberately redacted to labels and integer percentage points. Do not
 * converge them; see the disambiguation block on `ContentSafeRunDelta`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURE AND TOTAL. No I/O, no LLM, no clock, no config read, no DB read — it
 * consumes `prior_facts`, which the turn has already loaded. Replaying it over
 * two captured facts gives the same answer forever, which is what makes a
 * capture auditable.
 *
 * EVERY MEMBER IS DERIVED FROM A PRODUCER ECHO, NEVER SELF-REPORTED. The
 * contract is explicit that pair provenance comes from *"PRODUCER ECHOES on the
 * two persisted facts (PLoT's `seed_used` echo, `graph_hash_at_run`,
 * `_meta.builds`, `n_samples`) — never from CEE's own 'I sent the seed' record
 * (a self-reported pin is a guard agreeing with itself)"*. This file reads all
 * four off the persisted envelopes and compares them.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import {
  RunDeltaSchema,
  type RunDelta,
  type RunDeltaAttributionCaseLiteral,
  type RunDeltaBuildsEqualityLiteral,
  type RunDeltaNoiseVerdictLiteral,
  type RunDeltaWinProbabilityDelta,
} from '@talchain/schemas/boundary';

import {
  isUsableWinProbability,
  winnerOptionResultSource,
} from '../../orchestrator/context/option-result-source.js';
import { RUN_DELTA_FLIP_THRESHOLDS_NOT_COMPUTED } from '../compose/claim-safety-cage.js';
import { readMayNameLeadingOptionVerdictForFact } from '../context/claim-safety-read.js';

import { projectRunFact, selectTwoNewestRunAnalysisFacts } from './compare-runs.js';

/**
 * Why no delta was produced. A DISCRIMINATED reason rather than a bare `null`,
 * for two reasons: the caller emits it as telemetry (this module stays pure),
 * and a test can pin WHICH refusal fired. A bare null makes "we had no pair"
 * and "we had a pair but could not honestly classify it" one byte — and those
 * are different facts about the product.
 */
export type RunDeltaRefusal =
  /** Fewer than two successful `run_analysis` facts in the window. */
  | 'insufficient_runs'
  /** A fact could not be projected (missing/unparseable PLoT envelope). */
  | 'unprojectable_fact'
  /**
   * A producer echo required to DERIVE pair provenance is absent on at least
   * one side. We refuse rather than assume: see `readRunEchoes`.
   */
  | 'echoes_incomplete'
  /**
   * No attribution case in the C0–C4 table is justified by an OBSERVED
   * divergence on this pair. See {@link classifyAttribution}.
   */
  | 'no_honest_attribution_case'
  /**
   * The block this file constructed failed `RunDeltaSchema` — i.e. it violated
   * one of the contract's own fabrication rules. Fail-closed and LOUD: the
   * caller must treat this as a producer defect, never as ordinary absence.
   */
  | 'refused_by_contract';

export type BuildRunDeltaResult =
  | { readonly kind: 'ok'; readonly delta: RunDelta }
  | { readonly kind: 'none'; readonly reason: RunDeltaRefusal };

/**
 * How many standard errors a movement must exceed to be called `signal`.
 *
 * 2 SE is the ~95% two-sided normal approximation to the binomial. It is a
 * CHOICE and it is named here so a reviewer can argue with the number rather
 * than reverse-engineer it from an inequality.
 *
 * ⚠ INDEPENDENT-RUN FORM, deliberately. The contract states the reason:
 * *"the CRN limit means same-seed pairing gives NO variance reduction across
 * edits; the band never assumes it does"*. So the two runs are treated as
 * independent samples and the variances ADD. Assuming pairing would shrink the
 * band and manufacture `signal` verdicts out of noise — the fabrication this
 * whole block exists to refuse.
 */
const NOISE_BAND_SE_MULTIPLE = 2;

/**
 * The normal approximation to the binomial is only defensible when both
 * successes and failures are reasonably numerous; the textbook floor is 5.
 * Below it the band would be wrong in a direction we cannot bound, so the
 * quantity is reported as `not_noise_qualified` — the contract's own state for
 * *"no honest band exists for this quantity on this pair"* — and rendered as
 * direction only.
 *
 * ⚠ THIS GUARD IS WRITTEN AGAINST THE SPEC (the approximation's validity
 * condition), NOT against a failure mode someone happened to hit. A guard
 * shaped like the bug that prompted it shares the bug's blind spot.
 */
const NORMAL_APPROX_MIN_EVENTS = 5;

/** The four PLoT `_meta.builds` members, in a fixed order. */
const BUILD_KEYS = ['ui', 'cee', 'plot', 'isl'] as const;

interface RunEchoes {
  /** PLoT `meta.seed_used`, normalised. PLoT echoes it as a STRING. */
  readonly seedUsed: string;
  /** PLoT `meta.n_samples`. */
  readonly nSamples: number;
  /** CEE-owned `result.graph_hash_at_run`. */
  readonly graphHashAtRun: string;
  /**
   * PLoT `_meta.builds`, or null when absent. Absence is a REACHABLE state —
   * it rides only under PLoT's `UI_CANONICAL_META` env flag — and the contract
   * forbids defaulting it to 'equal'.
   */
  readonly builds: Readonly<Record<string, unknown>> | null;
  /**
   * The byte-for-byte PLoT envelope itself. Carried on this value rather than
   * re-read at the call site so a caller cannot pair one run's echoes with
   * another run's option records — the same construction as `RunProjection`
   * in `compare-runs.ts`: make the coupling a property of one value, not an
   * agreement between two call sites.
   */
  readonly enrichment: Readonly<Record<string, unknown>>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * A finite number from a value PLoT may echo as either a number or a string.
 * Returns null rather than coercing junk: `Number('')` is 0 and `Number(null)`
 * is 0, and a silent 0 here would make two unrelated runs compare `n_equal`.
 */
function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Read the four producer echoes off one persisted fact.
 *
 * Returns null when ANY of the three REQUIRED echoes is missing. That is not
 * defensiveness for its own sake: every `pair_provenance` member is a REQUIRED
 * boolean on the wire, so emitting the block at all is a claim that we compared
 * two real echoed values. With an echo missing we would have to invent a
 * boolean, and both directions lie — `true` fabricates an equality we never
 * observed, `false` asserts a divergence we never observed. Absence of the
 * whole block is contracted and honest; a fabricated boolean is neither.
 *
 * `builds` is the exception and is allowed to be null: the contract models its
 * absence explicitly as the tri-state 'unknown'.
 */
function readRunEchoes(fact: HandlerFact): RunEchoes | null {
  const result = asRecord((fact as { result?: unknown }).result);
  if (result === null) return null;

  const graphHashAtRun =
    typeof result.graph_hash_at_run === 'string' && result.graph_hash_at_run.length > 0
      ? result.graph_hash_at_run
      : null;
  if (graphHashAtRun === null) return null;

  // `enrichment` is the byte-for-byte PLoT envelope (`run-analysis.ts` writes
  // it with no projection and no stripping), so `meta` and `_meta` below are
  // PLoT's own, not a CEE reconstruction.
  const enrichment = asRecord(result.enrichment);
  if (enrichment === null) return null;

  const meta = asRecord(enrichment.meta);
  if (meta === null) return null;

  const seedRaw = meta.seed_used;
  const seedUsed =
    typeof seedRaw === 'string' && seedRaw.trim().length > 0
      ? seedRaw.trim()
      : typeof seedRaw === 'number' && Number.isFinite(seedRaw)
        ? String(seedRaw)
        : null;
  if (seedUsed === null) return null;

  const nSamples = finiteNumber(meta.n_samples);
  if (nSamples === null || nSamples <= 0) return null;

  const underscoreMeta = asRecord(enrichment._meta);
  const builds = underscoreMeta === null ? null : asRecord(underscoreMeta.builds);

  return { seedUsed, nSamples, graphHashAtRun, builds, enrichment };
}

/**
 * Tri-state builds equality.
 *
 * 'equal' is claimed ONLY when both sides carry a non-null build string for
 * BOTH compute-bearing services and those strings match. `plot` and `isl` are
 * the two that can change a number; `ui` and `cee` cannot, and on a
 * CEE-originated run they are routinely null — treating `null === null` as
 * "equal" would assert pipeline equality on ground we never checked, which is
 * the same fabrication as defaulting absence to 'equal', wearing a comparison.
 */
function deriveBuildsEquality(
  prior: RunEchoes,
  current: RunEchoes,
): RunDeltaBuildsEqualityLiteral {
  if (prior.builds === null || current.builds === null) return 'unknown';

  // An OBSERVED difference on any member is a real inequality, including on
  // `ui` / `cee` — a mismatch there is still evidence the pipeline moved.
  for (const key of BUILD_KEYS) {
    const a = prior.builds[key];
    const b = current.builds[key];
    if (typeof a === 'string' && typeof b === 'string' && a !== b) return 'unequal';
  }

  const bothCompute = (['plot', 'isl'] as const).every((key) => {
    const a = prior.builds?.[key];
    const b = current.builds?.[key];
    return typeof a === 'string' && a.length > 0 && typeof b === 'string' && b.length > 0;
  });
  return bothCompute ? 'equal' : 'unknown';
}

/**
 * ═══ THE ATTRIBUTION CLASSIFIER, AND THE RULE BEHIND IT ═══
 *
 * The contract deliberately declines to fix a precedence: *"C2/C3/C4 carry NO
 * cross-rule here: their conditions can co-occur and the design states no
 * precedence — the classifier's precedence is CEE's derivation obligation,
 * deliberately not guessed into the contract"*. So the rule below is DERIVED
 * here and stated so it can be argued with.
 *
 * ⭐ THE RULE: **A CASE IS NAMED ONLY FROM AN OBSERVED DIVERGENCE, NEVER FROM
 * AN UNVERIFIABLE ONE.** `builds_equal: 'unknown'` therefore never *produces* a
 * case; it only *withholds* one.
 *
 * Two consequences, both intended:
 *   1. Naming `C3_engine_drift` merely because we lack the builds echo would
 *      assert a drift we have not observed. We have not seen the engine move;
 *      we have seen that we cannot check. Those are different claims and only
 *      one of them is true.
 *   2. It keeps the enum DISCRIMINATING. `_meta.builds` rides only under PLoT's
 *      `UI_CANONICAL_META` flag, so if 'unknown' produced C3 then — on a
 *      deployment with that flag off — EVERY delta would classify C3 and the
 *      field would carry no information at all. A per-item verdict that returns
 *      the same answer for every item is reporting on the instrument, not on
 *      the world (CLAUDE.md trap 20).
 *
 * ═══ ⛔ DECLARED DEPARTURE FROM THE DESIGN OF RECORD — READ BEFORE "RESTORING" C3 ═══
 *
 * THE DESIGN SAYS C3. `@talchain/schemas` `boundary/run-delta.ts` states it
 * verbatim — *"'unknown' with any other divergence classifies C3 per the
 * table"* — RUN-DELTA-DESIGN §b's table assigns it, and acceptance criterion 8
 * makes it a MUST. **This function does not do that.** On `builds_equal:
 * 'unknown'` it returns C2 or C4 where an OBSERVED divergence exists, and
 * `null` where none does. That is a deliberate departure, recorded here rather
 * than left for someone to find.
 *
 * WHY, ON THE MERITS. `C3_engine_drift` is not a neutral bucket; its copy
 * asserts the engine moved between the two runs. Under `unknown` we have not
 * observed that the engine moved — we have observed that PLoT did not send the
 * echo that would let us check. Naming C3 there is a POSITIVE FALSEHOOD about
 * the pipeline, and it is the same class of claim this whole block refuses
 * everywhere else. It is also non-discriminating: `_meta.builds` rides only
 * under `UI_CANONICAL_META`, which is off in staging, so under the design's
 * rule EVERY delta would classify C3 and the field would carry no information
 * at all.
 *
 * ⚠⚠ AND THE FACT THAT MAKES THIS DECLARATION NECESSARY RATHER THAN OPTIONAL:
 * **THE CONTRACT CANNOT CATCH A MISLABEL HERE.** Measured against the vendored
 * 0.50.0 on the live provenance `{seed≠, hash≠, builds unknown, n=}`:
 *
 *     C0_identical    REFUSED      C2_unpaired      PARSES
 *     C1_attributable REFUSED      C3_engine_drift  PARSES
 *                                  C4_budget_drift  PARSES
 *
 * (Contrast controls: C0 on all-equal PARSES, C1 on `{seed=, hash≠, builds=}`
 * PARSES — so those refusals are about the preconditions, not about the probe.)
 * `refineRunDelta` polices only C0 and C1. **Nothing but this comment and the
 * suite stands between the classifier and a silent divergence** — which is why
 * a reasoned departure must be written down, and why "restoring" C3 to match
 * the design would pass every gate in the repo while making the product lie.
 * If the departure is judged wrong, change it deliberately and re-run the
 * classifier tests; do not restore it because a table said so.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ⚠ WHAT THIS MEANS TODAY, AND WHY IT IS NOT A DEFECT. With `builds_equal`
 * 'unknown', `C0_identical` and `C1_attributable` are both UNREACHABLE — the
 * schema's own `refineRunDelta` requires `builds_equal === 'equal'` for each and
 * would REFUSE TO PARSE otherwise. So no causal connective is constructible.
 * That is the correct outcome and it is enforced by the type system rather than
 * by anyone's discipline.
 *
 * ⚠⚠ THE RECORDED REASON IS IMPRECISE — AND THIS IS NOT A NEW FINDING.
 * `intervening-change.ts` says *"the seed is not pinned on the live path"*,
 * which reads as though PLoT generates a RANDOM seed. It does not, and the
 * RUN-DELTA design of record already said so on 8 Aug 2026 — this restates a
 * known result because the shorter phrasing keeps misleading readers, NOT
 * because anyone discovered it here.
 *
 * `plot-lite-service/src/routes/v2/run.ts` `resolveSeed` (:1301, docstring
 * :1281-1296) derives the seed DETERMINISTICALLY from the graph when the caller
 * omits one — from node `id`/`kind`/`observed_state.value` and edge
 * `from`/`to`/`strength.mean` — and EXPLICITLY EXCLUDES `exists_probability`
 * and `strength.std`.
 *
 * ⚠ CITE THE IMPLEMENTATION, NOT THE VOCABULARY. The authority on what the
 * canonical analysis hash actually covers is CEE's own
 * `context/graph-hash.ts` `computeAnalysisAffectingGraphHash` — it keeps edge
 * `exists_probability` (:274) and BOTH `strength.mean` and `strength.std`
 * (:280-281). `@talchain/schemas` `boundary/graph-hash-contract.ts` is a field
 * VOCABULARY manifest, and `graph-hash.ts` does not import it (zero
 * `CANONICAL_GRAPH_HASH` references, zero `@talchain/schemas` imports) — two
 * hand-maintained lists that agree today by discipline, so a claim about the
 * hash must be read off the implementation. Against the implementation, the
 * hash covers a strict SUPERSET of the seed's inputs. Therefore:
 *   - a FACTOR-VALUE edit moves `observed_state.value`, which is in BOTH, so the
 *     seed moves with it → `seed_equal` false → C2. Right answer, opposite
 *     reason to the recorded one: not sampling randomness, but that the seed is
 *     a deterministic FUNCTION of the field being edited.
 *   - an edit to `exists_probability`, `strength.std`, a prior, a goal
 *     threshold, an intercept or an option field moves the HASH and NOT the
 *     SEED → `seed_equal && !hash_equal`, which is exactly C1's seed/hash
 *     precondition, ALREADY SATISFIED.
 *
 * ⚠⚠ BUT THE GAP IS NOT CEE THREADING ALONE — IT IS THREADING **PLUS A PLoT
 * FLAG**, and this clause is load-bearing for anyone estimating the work.
 * `_meta.builds` rides only under PLoT's `UI_CANONICAL_META`, and PLoT's own
 * comment says that flag **stays off in staging** (`routes/v2/run.ts:4433-4436`,
 * verbatim: "deliberately NOT gated behind UI_CANONICAL_META, which stays off in
 * staging"). With it off, `builds_equal` is permanently 'unknown', C0 and C1 are
 * BOTH unreachable, and the uncertainty-only-edit case above emits NOTHING at
 * all — the classifier withholds rather than inventing a case. So "a wiring gap,
 * not a science gap" is true and incomplete: it is a CEE wiring gap AND a PLoT
 * flag dependency, and the flag is the half nobody owns.
 *
 * ⚠ PARTIAL CONSOLATION, worth knowing before anyone reaches for the flag:
 * PLoT emits `_meta.evidence` (carrying deployed builds) UNCONDITIONALLY, and
 * `plot_build` has ZERO production readers in CEE (1 occurrence, a test
 * fixture). So build DRIFT is observable today, flag-off; build EQUALITY —
 * which is what C1 needs — is not.
 */
function classifyAttribution(provenance: {
  readonly seed_equal: boolean;
  readonly hash_equal: boolean;
  readonly builds_equal: RunDeltaBuildsEqualityLiteral;
  readonly n_equal: boolean;
}): RunDeltaAttributionCaseLiteral | null {
  // Observed divergences first, most fundamental first. Each of these is a
  // fact we measured off two echoes.
  if (!provenance.seed_equal) return 'C2_unpaired';
  if (!provenance.n_equal) return 'C4_budget_drift';
  if (provenance.builds_equal === 'unequal') return 'C3_engine_drift';

  // Past every observed divergence. Only the two VERIFIED cases remain, and
  // both require a positively-confirmed builds equality.
  if (provenance.builds_equal === 'equal') {
    return provenance.hash_equal ? 'C0_identical' : 'C1_attributable';
  }

  // seed, n and hash all agree but builds is unverifiable. Nothing in the table
  // is justified: C0 would claim a verified identity we cannot verify, and C3
  // would claim a drift we have not seen. Withhold the whole block.
  return null;
}

/**
 * Every option whose identity is STRUCTURALLY SAFE, mapped to its win
 * probability.
 *
 * ⚠ WHY NOT `result.win_probabilities`, WHICH IS RIGHT THERE AND ALREADY
 * PERSISTED. Because it is LABEL-KEYED. `run-analysis.ts:2286-2302`
 * (`extractWinProbabilities`) keys that record by `option_label` FIRST and only
 * falls back to `option_id`, so on any ordinary run its keys are DISPLAY
 * STRINGS. `RunDeltaWinProbabilityDeltaSchema.option_id` is identity-bound —
 * *"Option id — identity-bound (trap 19), never a label"* — and feeding labels
 * into it would reintroduce exactly the defect `compare-runs.ts` documents at
 * length: a rename is invisible to the analysis-affecting hash, so two runs
 * that differ only in a label would be reported as different options.
 *
 * ⚠ AND NOT `compactAnalysis(...).summary.options[]` either: that projection
 * carries the SAME `option_id <- option_label` fallback, which is precisely why
 * `readLeaderOptionId` exists to confirm the winner's id against the raw
 * records. Only the raw source plus an explicit id check is safe.
 *
 * A DUPLICATE ID DROPS BOTH ENTRIES. If two records claim one id we cannot tell
 * which is which, and picking either would attach a number to an option by
 * guess. Fail-closed.
 */
function identityBoundWinProbabilities(
  enrichment: Record<string, unknown>,
): ReadonlyMap<string, number> {
  const found = new Map<string, number>();
  const ambiguous = new Set<string>();

  for (const entry of winnerOptionResultSource(enrichment)) {
    const id = entry.option_id;
    if (typeof id !== 'string' || id.length === 0) continue;
    // The SHARED predicate, imported rather than re-implemented: a usable
    // win probability is a finite number in [0, 1]. Re-stating that inequality
    // here would be a second definition free to drift from the first.
    if (!isUsableWinProbability(entry.win_probability)) continue;
    if (found.has(id)) {
      ambiguous.add(id);
      continue;
    }
    found.set(id, entry.win_probability);
  }

  for (const id of ambiguous) found.delete(id);
  return found;
}

/**
 * Per-quantity noise entitlement for one option's win-probability movement.
 *
 * `signal` is claimed only when the movement exceeds
 * {@link NOISE_BAND_SE_MULTIPLE} standard errors of the DIFFERENCE of two
 * independent binomial proportions. Where the normal approximation does not
 * hold, the honest answer is `not_noise_qualified`, never a band we cannot
 * justify.
 */
function noiseVerdictForProportions(
  prior: number,
  current: number,
  priorN: number,
  currentN: number,
): RunDeltaNoiseVerdictLiteral {
  const events = [
    prior * priorN,
    (1 - prior) * priorN,
    current * currentN,
    (1 - current) * currentN,
  ];
  if (events.some((count) => count < NORMAL_APPROX_MIN_EVENTS)) {
    return 'not_noise_qualified';
  }

  const variance =
    (prior * (1 - prior)) / priorN + (current * (1 - current)) / currentN;
  if (!(variance > 0)) return 'not_noise_qualified';

  const standardError = Math.sqrt(variance);
  return Math.abs(current - prior) > NOISE_BAND_SE_MULTIPLE * standardError
    ? 'signal'
    : 'within_noise';
}

/**
 * The wire block, or a discriminated refusal.
 *
 * `mayNameLeadingOption` is the TURN's permission and is the OUTER CONJUNCT
 * only, refined per compared run — the same construction
 * `run-comparison-gate.ts` uses, and for the same reason it was introduced
 * there: this block names TWO runs, and a turn-scoped permission applied alone
 * once let a PREVIOUS run's withheld leader be named under the CURRENT run's
 * verdict. It is REQUIRED, never optional-defaulting-to-true, so a future call
 * site cannot re-open that leak by omission.
 */
export function buildRunDelta(input: {
  readonly priorFacts: readonly HandlerFact[];
  readonly mayNameLeadingOption: boolean;
}): BuildRunDeltaResult {
  const pair = selectTwoNewestRunAnalysisFacts(input.priorFacts);
  if (pair === null) return { kind: 'none', reason: 'insufficient_runs' };

  const priorEchoes = readRunEchoes(pair.prior);
  const currentEchoes = readRunEchoes(pair.current);
  if (priorEchoes === null || currentEchoes === null) {
    return { kind: 'none', reason: 'echoes_incomplete' };
  }

  const priorProjection = projectRunFact(pair.prior);
  const currentProjection = projectRunFact(pair.current);
  if (priorProjection === null || currentProjection === null) {
    return { kind: 'none', reason: 'unprojectable_fact' };
  }

  const pairProvenance = {
    seed_equal: priorEchoes.seedUsed === currentEchoes.seedUsed,
    hash_equal: priorEchoes.graphHashAtRun === currentEchoes.graphHashAtRun,
    builds_equal: deriveBuildsEquality(priorEchoes, currentEchoes),
    n_equal: priorEchoes.nSamples === currentEchoes.nSamples,
  } as const;

  const attributionCase = classifyAttribution(pairProvenance);
  if (attributionCase === null) {
    return { kind: 'none', reason: 'no_honest_attribution_case' };
  }

  // ── Leader ────────────────────────────────────────────────────────────────
  // An id travels ONLY when this turn AND that run's own persisted verdict both
  // entitle the claim. The contract's absence semantics are explicit: *"ABSENCE
  // of an id means 'no entitled leader claim on that side', never 'no leader
  // existed'; a consumer must not name one."*
  const priorEntitled =
    input.mayNameLeadingOption
    && readMayNameLeadingOptionVerdictForFact(pair.prior).may_name_leading_option;
  const currentEntitled =
    input.mayNameLeadingOption
    && readMayNameLeadingOptionVerdictForFact(pair.current).may_name_leading_option;

  const priorLeaderId = priorEntitled ? priorProjection.leader_option_id : null;
  const currentLeaderId = currentEntitled ? currentProjection.leader_option_id : null;

  const leader = {
    // `changed` compares the ENTITLED claims only. When either side is
    // unentitled or carries no confirmed id we cannot tell, and the two errors
    // are not symmetric: a false "your leader changed" rewrites the user's
    // decision, a false "nothing changed" merely withholds. So indeterminate
    // folds to `false`, the same direction `compareRuns` chose.
    changed:
      priorLeaderId !== null
      && currentLeaderId !== null
      && priorLeaderId !== currentLeaderId,
    ...(priorLeaderId !== null ? { prior_leading_option_id: priorLeaderId } : {}),
    ...(currentLeaderId !== null ? { current_leading_option_id: currentLeaderId } : {}),
    // ⚠ DELIBERATELY `not_noise_qualified` IN THIS SLICE, AND IT IS NOT A STUB.
    // The contract's §a rule for THIS field is a claim about whether a LEADER
    // CHANGE is within noise — *"both sides entitled AND margins exceed their SE
    // bands"* — which needs the margin between the top two options and the SE of
    // that margin. Substituting the leading option's own win-probability verdict
    // would answer a DIFFERENT QUESTION under this field's name, which is how
    // two authorities end up contradicting each other inside one response
    // (CLAUDE.md trap 21). `not_noise_qualified` is the contract's own state for
    // *"no honest band exists for this quantity on this pair"*, rendered as
    // direction only. The margin-SE computation lands in slice two.
    noise_verdict: 'not_noise_qualified' as RunDeltaNoiseVerdictLiteral,
  };

  // ── Win probabilities ─────────────────────────────────────────────────────
  // ⚠ THE RAW ENVELOPE, NOT THE PROJECTED SUMMARY. `winnerOptionResultSource`
  // reads PLoT's own option records; the compacted summary has already applied
  // the `option_id <- option_label` fallback this function exists to avoid.
  const priorWins = identityBoundWinProbabilities(priorEchoes.enrichment);
  const currentWins = identityBoundWinProbabilities(currentEchoes.enrichment);

  const winProbabilities: RunDeltaWinProbabilityDelta[] = [];
  for (const [optionId, priorValue] of priorWins) {
    const currentValue = currentWins.get(optionId);
    if (currentValue === undefined) continue;
    winProbabilities.push({
      option_id: optionId,
      prior: priorValue,
      current: currentValue,
      noise_verdict: noiseVerdictForProportions(
        priorValue,
        currentValue,
        priorEchoes.nSamples,
        currentEchoes.nSamples,
      ),
    });
  }
  // Deterministic order so a captured wire body is byte-stable across replays.
  winProbabilities.sort((a, b) => a.option_id.localeCompare(b.option_id));

  const candidate = {
    attribution_case: attributionCase,
    pair_provenance: pairProvenance,
    leader,
    win_probabilities: winProbabilities,
    // ⭐ THE WITHHELD FLIP-THRESHOLD SLOT, TAKEN FROM THE CAGE — NEVER WRITTEN
    // HERE. `flip_thresholds` is a ratified Tier-3 deny key and
    // `claim-safety-cage.ts` is its sole owner, so this producer carries no
    // deny-key literal and the static Tier-3 scan stays maximally strict with
    // no allow-list entry and no exemption.
    //
    // ⚠ AND THE NAME IS THE POINT: `NOT_COMPUTED`, not `EMPTY`. Brief 4 §5 rules
    // for this field "Absence: not 'no tipping point.'" — so an empty array read
    // naively ASSERTS there are no flip thresholds, which is a claim we have not
    // earned. We emit it because the join is deferred and we never looked.
    // Populating it is a claim-safety change, not a wiring change.
    //
    // `edit_list` is OMITTED rather than emptied, and that asymmetry is
    // deliberate: `.min(1).optional()` makes an empty list unrepresentable, so
    // absence is the ONLY way that field can say "underivable". This field has
    // no such protection, which is exactly why the discipline lives in the cage.
    ...RUN_DELTA_FLIP_THRESHOLDS_NOT_COMPUTED,
  };

  // ⭐ THE CONTRACT CHECKS THIS PRODUCER, NOT THE OTHER WAY ROUND.
  // `RunDeltaSchema` is a `superRefine` carrying the fabrication rules (C1's
  // preconditions, C0's, and `edit_list`'s hash rule). Parsing our own output
  // through it means a defect in the classifier above becomes a REFUSAL rather
  // than a false claim on a user's screen. This is not belt-and-braces: it is
  // the doctrine that where a rule can live in the type system it must not live
  // in producer discipline.
  const parsed = RunDeltaSchema.safeParse(candidate);
  if (!parsed.success) return { kind: 'none', reason: 'refused_by_contract' };
  return { kind: 'ok', delta: parsed.data };
}
