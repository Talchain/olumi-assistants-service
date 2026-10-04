/**
 * SCI-DEEP v1 — THE CLAIM-BY-CLAIM COMPARISON for "Test without this link".
 * (PTL ruling programme-docs #87/5972622586; contract @talchain/schemas 0.76.0 `StructuralChallengeResultV1`.)
 *
 * PURE AND TOTAL. No I/O, no LLM, no clock. It consumes two `run_analysis` facts made by the ONE Run handler — the
 * selected Run (A) and the same input with one link removed (B), the latter never persisted — and says, per conclusion of
 * A, whether it HOLDS, CHANGES, or cannot be compared. It is the consequence producer's sibling (`build-run-delta.ts`):
 * same echo readers, same per-Run leader authority (`mayPresentComparedRunLeader`), same noise doctrine (independent-run
 * form, via `structural-challenge-noise.ts`). Everything it reads from `enrichment` is AFTER CEE's claim withholds, so a
 * withheld figure is simply missing here and is never turned into 0.
 *
 * MATERIALITY (PTL §6). A claim CHANGES only when the difference is signal-qualified AND it crosses that claim's own
 * licensed boundary: the leader; an EARNED exact-0/1 goal certainty (CEE's only licensed category for P(goal) — every
 * other figure is spoken as "in about N% of model runs"); the goal's declared level target; a constraint's side. With no
 * licensed boundary the values travel as `delta_only`, with no verdict word.
 *
 * NOT COMPARED, by construction: structural influence, e-values, driver rank, robustness labels and fragile edges move
 * with the numerical frame even when headlines do not (bank 2, F1), so they are listed and never compared.
 */
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { RunDeltaNoiseVerdictLiteral, RunDeltaBuildsEqualityLiteral } from '@talchain/schemas/boundary';

import { runWithheldGoalFigures, winnerOptionResultSource } from '../../orchestrator/context/option-result-source.js';
import { mayPresentComparedRunLeader } from './compared-run-leader.js';
import { deriveBuildsEquality, readRunEchoes, type RunEchoes } from './build-run-delta.js';
import { leadNoise, meanChangeNoise, proportionChangeNoise } from './structural-challenge-noise.js';

// ── The 0.76.0 contract, as CEE produces it. ────────────────────────────────────────────────────────────────────────
// ⚠ TEMPORARY MIRROR: CEE vendors only PUBLISHED schema tarballs; when @talchain/schemas 0.76.0 is published these
// types are replaced by `StructuralChallengeResultV1` and the dispatch strict-parses with its schema (the validating
// boundary). Field-for-field identical to src/boundary/structural-challenge.ts on olumi-schemas#86 @71da209 (APPROVED).
export type StructuralChallengeVerdict = 'holds' | 'changes' | 'delta_only' | 'not_comparable';
export type StructuralChallengeBasis =
  | 'leader_changed' | 'certainty_boundary_crossed' | 'target_crossed' | 'constraint_side_changed'
  | 'leader_same' | 'certainty_kept' | 'same_side_of_target' | 'constraint_side_same' | 'unaffected_by_construction'
  | 'within_noise' | 'no_licensed_boundary' | 'not_noise_qualified'
  | 'frame_changed' | 'unit_changed' | 'identity_status_changed' | 'ranking_status_changed'
  | 'withheld_on_one_side' | 'missing_on_one_side';
export interface StructuralChallengeLeaderClaim {
  readonly kind: 'leader';
  readonly baseline_option_id: string | null;
  readonly alternative_option_id: string | null;
  readonly noise_verdict: RunDeltaNoiseVerdictLiteral;
  readonly verdict: StructuralChallengeVerdict;
  readonly basis: StructuralChallengeBasis;
  readonly invariant_by_construction: boolean;
}
export interface StructuralChallengeQuantityClaim {
  readonly kind: 'goal_probability' | 'outcome_level' | 'constraint_probability';
  readonly option_id: string;
  readonly constraint_id: string | null;
  readonly baseline: number | null;
  readonly alternative: number | null;
  readonly target: number | null;
  /** Only on constraint_probability, and only with a declared probability boundary; CEE declares none in v1. */
  readonly constraint_boundary: { readonly probability_threshold: number; readonly operator: '>=' | '<=' | '>' | '<' } | null;
  readonly noise_verdict: RunDeltaNoiseVerdictLiteral;
  readonly verdict: StructuralChallengeVerdict;
  readonly basis: StructuralChallengeBasis;
  readonly invariant_by_construction: boolean;
}
export type StructuralChallengeClaim = StructuralChallengeLeaderClaim | StructuralChallengeQuantityClaim;
export type StructuralChallengeStatus = 'completed' | 'unsupported' | 'failed' | 'timed_out' | 'stale' | 'withheld';
export interface StructuralChallengeBaseline {
  readonly scenario_id: string;
  readonly run_id: string;
  readonly graph_hash_at_run: string;
  readonly seed_used: string | number;
  readonly n_samples: number;
  readonly sent_digest: string;
}
export interface StructuralChallengeAlternative {
  readonly op: 'remove_link';
  readonly from_id: string;
  readonly to_id: string;
  readonly origin: 'user_selected' | 'olumi_suggested';
  readonly sizing: 'user' | 'placeholder' | 'olumi_estimate' | 'olumi_accepted' | 'unmarked';
}
export interface StructuralChallengeResult {
  readonly method: 'full_recompute_unpaired_v1';
  readonly perturbation_class: 'topology';
  readonly status: StructuralChallengeStatus;
  readonly reason: string | null;
  readonly baseline: StructuralChallengeBaseline;
  readonly alternative: StructuralChallengeAlternative;
  readonly attribution_case: 'C2_unpaired';
  readonly pair_provenance: {
    readonly seed_equal: boolean;
    readonly hash_equal: boolean;
    readonly builds_equal: RunDeltaBuildsEqualityLiteral;
    readonly n_equal: boolean;
  } | null;
  readonly claims: readonly StructuralChallengeClaim[];
  readonly not_compared: readonly string[];
  readonly retention: 'not_retained';
  readonly recompute_key: string;
}

/**
 * Listed on every completed result (contract S2), plus the other diagnostics this method does not compare. Flip
 * thresholds are left off: the contract makes them optional, and naming a ratified Tier-3 key here would make this
 * producer a claim-safety site (tier3-leak-guard) for a field it never reads.
 */
export const NOT_COMPARED = [
  'structural_influence', 'e_values', 'driver_rank', 'robustness_label', 'fragile_edges',
  'factor_sensitivity', 'path_decomposition', 'evpi',
] as const;

// ── Readers over the stored envelope ───────────────────────────────────────────────────────────────────────────────
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

interface OptionRow {
  readonly win: number | null;
  readonly goal: number | null;
  readonly mean: number | null;
  readonly sd: number | null;
  readonly n: number | null;
  readonly constraints: ReadonlyMap<string, number>;
}

/**
 * Identity-bound option rows from the ONE ordered-source reader (`winnerOptionResultSource`), keyed by `option_id` only
 * (never a label fallback). A Run that WITHHELD its goal figures carries no goal figure here at all.
 */
function optionRows(enrichment: Rec): Map<string, OptionRow> {
  const rows = new Map<string, OptionRow>();
  const goalWithheld = runWithheldGoalFigures(enrichment);
  for (const o of winnerOptionResultSource(enrichment)) {
    if (!isRec(o) || typeof o.option_id !== 'string' || o.option_id.length === 0) continue;
    const outcome = isRec(o.outcome) ? o.outcome : {};
    const constraints = new Map<string, number>();
    if (isRec(o.constraint_probabilities)) {
      for (const [id, p] of Object.entries(o.constraint_probabilities)) {
        const v = num(p);
        if (v !== null) constraints.set(id, v);
      }
    }
    rows.set(o.option_id, {
      win: num(o.win_probability),
      goal: goalWithheld ? null : num(o.probability_of_goal),
      mean: num(outcome.mean),
      sd: num(outcome.std),
      n: num(outcome.n_valid_samples) ?? num(outcome.n_samples),
      constraints,
    });
  }
  return rows;
}

function constraintNodes(enrichment: Rec): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of Array.isArray(enrichment.constraint_results) ? enrichment.constraint_results : []) {
    if (isRec(c) && typeof c.constraint_id === 'string' && typeof c.node_id === 'string') out.set(c.constraint_id, c.node_id);
  }
  return out;
}

function identityStatus(enrichment: Rec): string {
  const evals = Array.isArray(enrichment.identity_evaluations) ? enrichment.identity_evaluations : [];
  return JSON.stringify(evals.filter(isRec).map((e) => [e.node_id, e.evaluated === true]).sort());
}

const rankingStatus = (enrichment: Rec) => (typeof enrichment.option_comparison_status === 'string' ? enrichment.option_comparison_status : null);

/** The Run's own recorded certainty decision for one option: earned / not earned / not recorded. */
function earnedCertainty(fact: HandlerFact, optionId: string, value: number): boolean {
  const certainty = (fact as { result?: { goal_certainty?: unknown } }).result?.goal_certainty;
  if (!Array.isArray(certainty)) return false;
  return certainty.some((d) => isRec(d) && d.option_id === optionId && d.probability_of_goal === value && d.earned === true);
}

const leaderOf = (fact: HandlerFact): string | null => {
  const id = (fact as { result?: { leading_option_id?: unknown } }).result?.leading_option_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

const isCertain = (p: number) => p === 0 || p === 1;

// ── The comparison ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface CompareStructuralChallengeInput {
  readonly baselineFact: HandlerFact;
  readonly candidateFact: HandlerFact;
  /** The turn may name a leader (the same input `buildRunDelta` takes); per-Run verdicts narrow it further. */
  readonly turnMayNameLeader: boolean;
  /** The removed link's target and everything it reaches (`structuralChallengeEligibility`). */
  readonly reachable: ReadonlySet<string>;
  readonly goalNodeId: string;
  /** The goal's declared LEVEL target in the outcome's own unit; null when none (or stated as a change). */
  readonly goalLevelTarget: number | null;
}

export type CompareStructuralChallengeOutput =
  | {
      readonly ok: true;
      readonly pair_provenance: NonNullable<StructuralChallengeResult['pair_provenance']>;
      readonly claims: readonly StructuralChallengeClaim[];
    }
  | { readonly ok: false; readonly reason: 'baseline_unreadable' | 'candidate_unparseable' };

function deltaOnlyBasis(noise: RunDeltaNoiseVerdictLiteral): StructuralChallengeBasis {
  return noise === 'within_noise' ? 'within_noise' : noise === 'not_noise_qualified' ? 'not_noise_qualified' : 'no_licensed_boundary';
}

export function compareStructuralChallenge(input: CompareStructuralChallengeInput): CompareStructuralChallengeOutput {
  const a: RunEchoes | null = readRunEchoes(input.baselineFact);
  if (a === null) return { ok: false, reason: 'baseline_unreadable' };
  const b: RunEchoes | null = readRunEchoes(input.candidateFact);
  if (b === null) return { ok: false, reason: 'candidate_unparseable' };

  const pair_provenance = {
    seed_equal: a.seedUsed === b.seedUsed,
    hash_equal: a.graphHashAtRun === b.graphHashAtRun,
    builds_equal: deriveBuildsEquality(a, b),
    n_equal: a.nSamples === b.nSamples,
  } as const;

  const rowsA = optionRows(a.enrichment);
  const rowsB = optionRows(b.enrichment);
  const goalReached = input.reachable.has(input.goalNodeId);
  const identityChanged = identityStatus(a.enrichment) !== identityStatus(b.enrichment);
  const claims: StructuralChallengeClaim[] = [];

  // ── Leader ─────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const entitledA = mayPresentComparedRunLeader(input.turnMayNameLeader, input.baselineFact);
    const entitledB = mayPresentComparedRunLeader(input.turnMayNameLeader, input.candidateFact);
    const idA = entitledA ? leaderOf(input.baselineFact) : null;
    const idB = entitledB ? leaderOf(input.candidateFact) : null;
    const base = { kind: 'leader' as const, baseline_option_id: idA, alternative_option_id: idB };
    if (idA === null || idB === null) {
      claims.push({ ...base, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'withheld_on_one_side', invariant_by_construction: false });
    } else if (rankingStatus(a.enrichment) !== rankingStatus(b.enrichment)) {
      claims.push({ ...base, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'ranking_status_changed', invariant_by_construction: false });
    } else {
      const shares = [...rowsB.values()].map((r) => r.win ?? 0).sort((x, y) => y - x);
      const noise = leadNoise(rowsB.get(idB)?.win ?? 0, idB === idA ? (shares[1] ?? 0) : (rowsB.get(idA)?.win ?? 0), b.nSamples);
      if (noise !== 'signal') {
        // Every leader HOLDS needs a signal-qualified lead (contract C2), the unaffected one included.
        claims.push({ ...base, noise_verdict: noise, verdict: 'delta_only', basis: deltaOnlyBasis(noise), invariant_by_construction: false });
      } else if (!goalReached && idA === idB) {
        // The removed link cannot reach the goal: the leader holds by construction (never robustness evidence, C6).
        claims.push({ ...base, noise_verdict: noise, verdict: 'holds', basis: 'unaffected_by_construction', invariant_by_construction: true });
      } else if (idA === idB) {
        claims.push({ ...base, noise_verdict: noise, verdict: 'holds', basis: 'leader_same', invariant_by_construction: false });
      } else {
        claims.push({ ...base, noise_verdict: noise, verdict: 'changes', basis: 'leader_changed', invariant_by_construction: false });
      }
    }
  }

  const optionIds = [...rowsA.keys()].filter((id) => rowsB.has(id)).sort();

  // ── Goal probability, per option ──────────────────────────────────────────────────────────────────────────────
  for (const optionId of optionIds) {
    const pA = rowsA.get(optionId)?.goal ?? null;
    const pB = rowsB.get(optionId)?.goal ?? null;
    const base = { kind: 'goal_probability' as const, option_id: optionId, constraint_id: null, baseline: pA, alternative: pB, target: null, constraint_boundary: null };
    if (pA === null || pB === null) {
      if (pA === null && pB === null) continue; // no goal figure on either side: no claim to test
      const withheld = runWithheldGoalFigures(pA === null ? a.enrichment : b.enrichment);
      claims.push({ ...base, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: withheld ? 'withheld_on_one_side' : 'missing_on_one_side', invariant_by_construction: false });
      continue;
    }
    if (identityChanged) {
      claims.push({ ...base, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'identity_status_changed', invariant_by_construction: false });
      continue;
    }
    const noise = proportionChangeNoise(pA, pB, a.nSamples, b.nSamples);
    if (!goalReached && noise !== 'signal') {
      claims.push({ ...base, noise_verdict: noise, verdict: 'holds', basis: 'unaffected_by_construction', invariant_by_construction: true });
      continue;
    }
    const crossed = (isCertain(pA) || isCertain(pB)) && pA !== pB;
    const crossedLicensed = crossed
      && (!isCertain(pA) || earnedCertainty(input.baselineFact, optionId, pA))
      && (!isCertain(pB) || earnedCertainty(input.candidateFact, optionId, pB));
    const kept = isCertain(pA) && pA === pB
      && earnedCertainty(input.baselineFact, optionId, pA) && earnedCertainty(input.candidateFact, optionId, pB);
    if (crossedLicensed && noise === 'signal') {
      claims.push({ ...base, noise_verdict: noise, verdict: 'changes', basis: 'certainty_boundary_crossed', invariant_by_construction: false });
    } else if (kept && noise !== 'not_noise_qualified') {
      claims.push({ ...base, noise_verdict: noise, verdict: 'holds', basis: 'certainty_kept', invariant_by_construction: false });
    } else {
      claims.push({ ...base, noise_verdict: noise, verdict: 'delta_only', basis: noise === 'signal' ? 'no_licensed_boundary' : deltaOnlyBasis(noise), invariant_by_construction: false });
    }
  }

  // ── Outcome level, per option ─────────────────────────────────────────────────────────────────────────────────
  for (const optionId of optionIds) {
    const rA = rowsA.get(optionId) as OptionRow;
    const rB = rowsB.get(optionId) as OptionRow;
    if (rA.mean === null && rB.mean === null) continue;
    const target = input.goalLevelTarget;
    const base = { kind: 'outcome_level' as const, option_id: optionId, constraint_id: null, baseline: rA.mean, alternative: rB.mean, target, constraint_boundary: null };
    if (rA.mean === null || rB.mean === null) {
      claims.push({ ...base, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'missing_on_one_side', invariant_by_construction: false });
      continue;
    }
    if (identityChanged) {
      claims.push({ ...base, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'identity_status_changed', invariant_by_construction: false });
      continue;
    }
    const noise = rA.sd !== null && rB.sd !== null && rA.n !== null && rB.n !== null
      ? meanChangeNoise({ mean: rA.mean, sd: rA.sd, n: rA.n }, { mean: rB.mean, sd: rB.sd, n: rB.n })
      : 'not_noise_qualified';
    if (!goalReached && noise !== 'signal') {
      claims.push({ ...base, noise_verdict: noise, verdict: 'holds', basis: 'unaffected_by_construction', invariant_by_construction: true });
      continue;
    }
    const sA = target === null ? 0 : Math.sign(rA.mean - target);
    const sB = target === null ? 0 : Math.sign(rB.mean - target);
    if (target !== null && sA !== 0 && sB !== 0 && sA !== sB && noise === 'signal') {
      claims.push({ ...base, noise_verdict: noise, verdict: 'changes', basis: 'target_crossed', invariant_by_construction: false });
    } else if (target !== null && sA !== 0 && sA === sB && noise !== 'not_noise_qualified') {
      claims.push({ ...base, noise_verdict: noise, verdict: 'holds', basis: 'same_side_of_target', invariant_by_construction: false });
    } else {
      claims.push({ ...base, noise_verdict: noise, verdict: 'delta_only', basis: noise === 'signal' ? 'no_licensed_boundary' : deltaOnlyBasis(noise), invariant_by_construction: false });
    }
  }

  // ── Constraint probability, per option and constraint (no licensed side rule in v1: delta_only unless invariant) ──
  const nodesA = constraintNodes(a.enrichment);
  for (const optionId of optionIds) {
    const cA = (rowsA.get(optionId) as OptionRow).constraints;
    const cB = (rowsB.get(optionId) as OptionRow).constraints;
    for (const constraintId of [...cA.keys()].filter((id) => cB.has(id)).sort()) {
      const pA = cA.get(constraintId) as number;
      const pB = cB.get(constraintId) as number;
      const noise = proportionChangeNoise(pA, pB, a.nSamples, b.nSamples);
      const node = nodesA.get(constraintId);
      const base = { kind: 'constraint_probability' as const, option_id: optionId, constraint_id: constraintId, baseline: pA, alternative: pB, target: null, constraint_boundary: null };
      if (node !== undefined && !input.reachable.has(node) && noise !== 'signal') {
        claims.push({ ...base, noise_verdict: noise, verdict: 'holds', basis: 'unaffected_by_construction', invariant_by_construction: true });
      } else {
        claims.push({ ...base, noise_verdict: noise, verdict: 'delta_only', basis: noise === 'signal' ? 'no_licensed_boundary' : deltaOnlyBasis(noise), invariant_by_construction: false });
      }
    }
  }

  return { ok: true, pair_provenance, claims };
}
