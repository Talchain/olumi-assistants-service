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
 * other figure uses the Run's licensed goal-chance display); the goal's declared level target; a constraint's side. With no
 * licensed boundary the values travel as `delta_only`, with no verdict word.
 *
 * NOT COMPARED, by construction: structural influence, e-values, driver rank, robustness labels and fragile edges move
 * with the numerical frame even when headlines do not (bank 2, F1), so they are listed and never compared.
 */
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { StructuralChallengeClaimV1, StructuralChallengeResultV1 } from '@talchain/schemas';
import type { RunDeltaNoiseVerdictLiteral } from '@talchain/schemas/boundary';

import { readOptionResultSources, runWithheldGoalFigures } from '../../orchestrator/context/option-result-source.js';
import { collectProducerCertifiedConstraintIds, collectProducerNotDecisionGradeConstraintIds } from '../../orchestrator/context/constraint-feasibility.js';
import { isRecommendableOption } from '../tools/handlers/recommendable-option.js';
import { identicalArmGroups, sameArm, sameStat, usableArmsFromRows, type ArmOutcome } from './identical-arms-core.js';
import { targetTestabilityOf } from '../admission/target-testability.js';
import { sameUnit } from '../agent-lane/reconciling-product.js';
import { normalizeRunGoalUnit } from '../context/run-goal-unit.js';
import { RunInputSnapshotSchema } from '@talchain/schemas/orchestrator';
import { readStoredGoalCertainty, type StoredGoalCertainty } from '../tools/handlers/run-goal-certainty.js';
import { goalChanceDisplayForAgent } from '../goal-target/goal-chance-licence.js';
import { withReadTimeHorizonGate } from '../goal-target/goal-horizon-verdict.js';
import { mayPresentComparedRunLeader } from './compared-run-leader.js';
import { deriveBuildsEquality, readRunEchoes, type RunEchoes } from './build-run-delta.js';
import { leadNoise, meanChangeNoise, proportionChangeNoise } from './structural-challenge-noise.js';

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
  readonly constraints: ReadonlyMap<string, number | null>;
}

/** Validate every carrier, including copies that measurement precedence will not consume. */
function submittedIdentities(enrichment: Rec, fact: HandlerFact) {
  const snapshot = RunInputSnapshotSchema.safeParse((fact as { result?: Rec }).result?.input_snapshot);
  if (!snapshot.success) return null;
  const options = new Set(snapshot.data.options.map((o) => o.option_id));
  const excluded = new Set(snapshot.data.options_not_sent.map((o) => o.option_id));
  if ([...options].some((id) => excluded.has(id))) return null;
  const constraints = new Map(snapshot.data.constraints.map((c) => [c.constraint_id, c.node_id]));
  const nested = isRec(enrichment.results) ? enrichment.results : {};
  const brief = isRec(enrichment.decision_brief) ? enrichment.decision_brief : {};
  for (const source of [enrichment.option_comparison, enrichment.results, nested.option_comparison,
    nested.options, nested.option_results, brief.options]) {
    if (!Array.isArray(source)) continue;
    const seen = new Set<string>();
    for (const row of source) {
      if (!isRec(row) || typeof row.option_id !== 'string' || !options.has(row.option_id)
        || excluded.has(row.option_id) || seen.has(row.option_id)) return null;
      seen.add(row.option_id);
      if (row.constraint_probabilities !== undefined) {
        if (!isRec(row.constraint_probabilities)
          || Object.keys(row.constraint_probabilities).some((id) => !constraints.has(id))) return null;
      }
    }
  }
  const leader = (fact as { result?: Rec }).result?.leading_option_id;
  if (leader != null && (typeof leader !== 'string' || !options.has(leader))) return null;
  if (enrichment.constraint_results !== undefined) {
    if (!Array.isArray(enrichment.constraint_results)) return null;
    for (const row of enrichment.constraint_results) {
      if (!isRec(row) || typeof row.constraint_id !== 'string' || !constraints.has(row.constraint_id)
        || (row.node_id !== undefined && row.node_id !== constraints.get(row.constraint_id))
        || (row.option_id !== undefined && (typeof row.option_id !== 'string' || !options.has(row.option_id)))) return null;
    }
  }
  return { options, constraints };
}

/** Current measurements follow the existing carrier precedence; submitted identities attest no measurements. */
function optionRows(enrichment: Rec, fact: HandlerFact): Map<string, OptionRow> | null {
  const submitted = submittedIdentities(enrichment, fact);
  if (submitted === null) return null;
  const rows = new Map<string, OptionRow>();
  const goalWithheld = runWithheldGoalFigures(enrichment);
  const certified = collectProducerCertifiedConstraintIds(enrichment);
  const uncertified = collectProducerNotDecisionGradeConstraintIds(enrichment);
  const constraintsComputed = enrichment.constraints_status === undefined || enrichment.constraints_status === 'computed';
  const nested = isRec(enrichment.results) ? enrichment.results : {};
  const current = Array.isArray(enrichment.option_comparison)
    ? enrichment.option_comparison : nested.option_comparison;
  const source = Array.isArray(current) ? current : readOptionResultSources(enrichment)[0] ?? [];
  for (const o of source) {
    if (!isRec(o) || typeof o.option_id !== 'string') return null;
    const outcome = isRec(o.outcome) ? o.outcome : {};
    // A present valid-draw count is authoritative: zero/malformed cannot fall back to the sample budget.
    const n = num(outcome.n_valid_samples !== undefined ? outcome.n_valid_samples : outcome.n_samples);
    const computed = isRecommendableOption(o) && n !== null && Number.isSafeInteger(n) && n > 0;
    const constraints = new Map<string, number | null>([...submitted.constraints.keys()].map((id) => [id, null]));
    if (isRec(o.constraint_probabilities)) {
      for (const [id, p] of Object.entries(o.constraint_probabilities)) {
        constraints.set(id, computed && constraintsComputed && certified.has(id) && !uncertified.has(id) ? num(p) : null);
      }
    }
    rows.set(o.option_id, {
      win: computed ? num(o.win_probability) : null,
      goal: computed && !goalWithheld ? num(o.probability_of_goal) : null,
      mean: computed ? num(outcome.mean) : null,
      sd: computed ? num(outcome.std) : null,
      n: computed ? n : null,
      constraints,
    });
  }
  // Submitted identities attest membership, never measurements.
  for (const id of submitted.options) {
    if (!rows.has(id)) rows.set(id, { win: null, goal: null, mean: null, sd: null, n: null, constraints: new Map([...submitted.constraints.keys()].map((constraint) => [constraint, null])) });
  }
  return rows;
}

function constraintNodes(enrichment: Rec, fact: HandlerFact): Map<string, string> | null {
  return submittedIdentities(enrichment, fact)?.constraints ?? null;
}

function identityStatus(enrichment: Rec): string {
  const evals = Array.isArray(enrichment.identity_evaluations) ? enrichment.identity_evaluations : [];
  return JSON.stringify(evals.filter(isRec).map((e) => [e.node_id, e.evaluated === true]).sort());
}

const rankingStatus = (enrichment: Rec) => (typeof enrichment.option_comparison_status === 'string' ? enrichment.option_comparison_status : null);

/** The Run's own recorded certainty decision for one option: earned / not earned / not recorded. */
function earnedCertainty(fact: HandlerFact, optionId: string, value: number): boolean {
  const certainty = (fact as { result?: { goal_certainty?: unknown } }).result?.goal_certainty;
  const decisions = readStoredGoalCertainty(certainty);
  const matching = decisions?.filter((d) => d.option_id === optionId);
  return matching?.length === 1 && matching[0].probability_of_goal === value && matching[0].earned === true;
}

/** Internal rendering carrier: the recorded decisions, never added to the published result or persisted. */
export interface StructuralChallengeCertainty {
  readonly baseline: StoredGoalCertainty | undefined;
  readonly alternative: StoredGoalCertainty | undefined;
  /** Each bound Run's shared screen/Agent display, never reconstructed from comparison quantities. */
  readonly baselineDisplay?: Readonly<Record<string, string>>;
  readonly alternativeDisplay?: Readonly<Record<string, string>>;
}

function licensedTarget(fact: HandlerFact, graph: unknown, goalId: string, target: number | null): boolean {
  if (target === null || !isRec(graph) || !Array.isArray(graph.nodes)) return false;
  const result = (fact as { result?: Rec }).result;
  if (!result || !isRec(result.enrichment) || runWithheldGoalFigures(result.enrichment)) return false;
  const testability = targetTestabilityOf(graph);
  if (testability.kind !== 'testable' || testability.goal_id !== goalId) return false;
  const snapshot = RunInputSnapshotSchema.safeParse(result.input_snapshot);
  const goals = graph.nodes.filter((n) => isRec(n) && n.id === goalId);
  if (!snapshot.success || snapshot.data.goal === null || snapshot.data.goal.node_id !== goalId || goals.length !== 1) return false;
  const goal = goals[0] as Rec;
  const level = isRec(goal.observed_state) ? goal.observed_state : {};
  const unit = normalizeRunGoalUnit(snapshot.data.goal.unit);
  return snapshot.data.goal.frame === 'level' && snapshot.data.goal.target_raw === target
    && goal.goal_threshold_frame === 'level' && goal.goal_threshold_raw === target
    && unit !== undefined && sameUnit(unit, goal.goal_threshold_unit)
    && sameUnit(unit, level.unit);
}

function qualifiedLead(rows: ReadonlyMap<string, OptionRow>, id: string, expected: readonly string[]): RunDeltaNoiseVerdictLiteral {
  const share = rows.get(id)?.win;
  if (rows.size !== expected.length || expected.some((option) => !rows.has(option)) || share == null) return 'not_noise_qualified';
  const others = [...rows].filter(([option]) => option !== id);
  if (others.length === 0 || others.some(([, row]) => row.win === null)) return 'not_noise_qualified';
  const verdicts = others.map(([, row]) => leadNoise(share, row.win as number, Math.min(rows.get(id)?.n ?? 0, row.n ?? 0)));
  return verdicts.includes('not_noise_qualified') ? 'not_noise_qualified' : verdicts.every((v) => v === 'signal') ? 'signal' : 'within_noise';
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
  /** The candidate side's entitlement, when it is narrower than the baseline's (its own result-bound licence). */
  readonly candidateMayNameLeader?: boolean;
  /** The removed link's target and everything it reaches (`structuralChallengeEligibility`). */
  readonly reachable: ReadonlySet<string>;
  readonly goalNodeId: string;
  /** The goal's declared LEVEL target in the outcome's own unit; null when none (or stated as a change). */
  readonly goalLevelTarget: number | null;
  readonly baselineGraph?: unknown;
  readonly candidateGraph?: unknown;
}

export type CompareStructuralChallengeOutput =
  | {
      readonly ok: true;
      readonly pair_provenance: NonNullable<StructuralChallengeResultV1['pair_provenance']>;
      readonly claims: readonly StructuralChallengeClaimV1[];
      readonly certainty: StructuralChallengeCertainty;
      /** Every arm of the candidate RESULT is identical, and the baseline's arms are not: the difference between the
       *  options rests entirely on the removed link. CEE-local rendering carrier; never on the published result. */
      readonly identical_arms: boolean;
      /** Otherwise, the candidate's groups of identical arms (each blocks the candidate leader). CEE-local. */
      readonly identical_groups: readonly (readonly string[])[];
      /** The other members of the group holding the ENTITLED baseline leader, when the baseline separates them from
       *  it: the leader's edge over them rests entirely on the removed link. Empty otherwise. CEE-local. */
      readonly leader_same_as: readonly string[];
    }
  | { readonly ok: false; readonly reason: 'baseline_unreadable' | 'candidate_unparseable' };

// The ONE identical-arms rule (tolerance, statistics, draw count, per-arm usability) lives in `identical-arms-core.ts`,
// shared with gate 1 v2's Run-time withhold. This file adds only the fact readers.
export { IDENTICAL_ARMS_RELATIVE_TOLERANCE } from './identical-arms-core.js';

/**
 * Every submitted arm's outcome, or null when ANY arm is unusable: a missing row, a non-computed status (the same
 * gate `optionRows` applies), no positive valid-draw count, or a non-finite mean/std. Strict: positive claims only.
 */
function usableArmOutcomes(fact: HandlerFact): ArmOutcome[] | null {
  const result = (fact as { result?: Rec }).result;
  const enrichment = isRec(result?.enrichment) ? result.enrichment : null;
  if (enrichment === null) return null;
  const submitted = submittedIdentities(enrichment, fact);
  if (submitted === null || submitted.options.size < 2) return null;
  const nested = isRec(enrichment.results) ? enrichment.results : {};
  const current = Array.isArray(enrichment.option_comparison) ? enrichment.option_comparison : nested.option_comparison;
  const source = Array.isArray(current) ? current : readOptionResultSources(enrichment)[0] ?? [];
  const rows = new Map<string, Rec>();
  for (const o of source) if (isRec(o) && typeof o.option_id === 'string') rows.set(o.option_id, o);
  const arms: ArmOutcome[] = [];
  for (const id of submitted.options) {
    const row = rows.get(id);
    if (row === undefined || !isRecommendableOption(row) || !isRec(row.outcome)) return null;
    const n = num(row.outcome.n_valid_samples);
    if (n === null || !Number.isSafeInteger(n) || n <= 0 || num(row.outcome.mean) === null || num(row.outcome.std) === null) return null;
    arms.push({ id, outcome: row.outcome });
  }
  return arms;
}

/** Each submitted arm of this fact usable ON ITS OWN (`usableArmsFromRows`): an unusable arm never hides a pair. */
function individuallyUsableArms(fact: HandlerFact, trustedDrawsOnly = false): ArmOutcome[] {
  const result = (fact as { result?: Rec }).result;
  const enrichment = isRec(result?.enrichment) ? result.enrichment : null;
  const submitted = enrichment === null ? null : submittedIdentities(enrichment, fact);
  if (enrichment === null || submitted === null) return [];
  const nested = isRec(enrichment.results) ? enrichment.results : {};
  const current = Array.isArray(enrichment.option_comparison) ? enrichment.option_comparison : nested.option_comparison;
  const source = Array.isArray(current) ? current : readOptionResultSources(enrichment)[0] ?? [];
  return usableArmsFromRows(source, [...submitted.options], { trustedDrawsOnly });
}

/**
 * Every submitted arm of this Run carries the same outcome distribution. Read from the RESULT, never from graph
 * structure: with no option reaching the goal, ISL evaluates every arm on the same draws, so the arms come out identical.
 */
export function runArmsIdentical(fact: HandlerFact): boolean {
  const arms = usableArmOutcomes(fact);
  return arms !== null && arms.every((arm) => sameArm(arms[0].outcome, arm.outcome));
}

/**
 * Groups (two or more, submitted order) of usable arms that come out identical. An identical pair splits its wins
 * (ISL shares ties), so ANY such group means the Run's win shares cannot name a leader (DL ruling, #2575).
 */
export function runIdenticalArmGroups(fact: HandlerFact): string[][] {
  return identicalArmGroups(individuallyUsableArms(fact));
}

/** Affirmatively distinct: every arm usable, and some arm's mean or std differs beyond the tolerance. */
export function runArmsDistinct(fact: HandlerFact): boolean {
  const arms = usableArmOutcomes(fact);
  if (arms === null) return false;
  return arms.some((arm) => !sameStat(arms[0].outcome.mean, arm.outcome.mean) || !sameStat(arms[0].outcome.std, arm.outcome.std));
}

/** The entitled baseline leader's identical companions in the candidate, each affirmatively distinct in the baseline. */
function leaderSameAs(baselineFact: HandlerFact, claims: readonly StructuralChallengeClaimV1[], groups: readonly (readonly string[])[]): string[] {
  const leader = claims.find((c) => c.kind === 'leader');
  const named = leader?.kind === 'leader' ? leader.baseline_option_id : null;
  const group = named === null ? undefined : groups.find((g) => g.includes(named));
  const arms = usableArmOutcomes(baselineFact);
  if (group === undefined || arms === null) return [];
  const outcome = new Map(arms.map((a) => [a.id, a.outcome]));
  const mine = outcome.get(named as string);
  const others = group.filter((id) => id !== named);
  return mine !== undefined && others.every((id) => { const o = outcome.get(id); return o !== undefined && !sameArm(mine, o); }) ? others : [];
}

const identicalCarriers = (identicalArms: boolean, groups: readonly (readonly string[])[]) =>
  ({ identical_arms: identicalArms, identical_groups: identicalArms ? [] : groups });

function deltaOnlyBasis(noise: RunDeltaNoiseVerdictLiteral): StructuralChallengeClaimV1['basis'] {
  return noise === 'within_noise' ? 'within_noise' : noise === 'not_noise_qualified' ? 'not_noise_qualified' : 'no_licensed_boundary';
}

export function compareStructuralChallenge(input: CompareStructuralChallengeInput): CompareStructuralChallengeOutput {
  // Both stored endpoints are read on their supplied graphs; neither the hash nor a stored display licences a deadline edit.
  const gatedFact = (fact: HandlerFact, graph: unknown): HandlerFact => fact.fact_type === 'run_analysis'
    ? { ...fact, result: withReadTimeHorizonGate(fact.result, graph, fact.result.enrichment) } : fact;
  input = { ...input, baselineFact: gatedFact(input.baselineFact, input.baselineGraph),
    candidateFact: gatedFact(input.candidateFact, input.candidateGraph) };
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

  const rowsA = optionRows(a.enrichment, input.baselineFact);
  const rowsB = optionRows(b.enrichment, input.candidateFact);
  const nodesA = constraintNodes(a.enrichment, input.baselineFact);
  const nodesB = constraintNodes(b.enrichment, input.candidateFact);
  if (rowsA === null || nodesA === null) return { ok: false, reason: 'baseline_unreadable' };
  if (rowsB === null || nodesB === null || [...nodesA].some(([id, node]) => nodesB.has(id) && nodesB.get(id) !== node)) {
    return { ok: false, reason: 'candidate_unparseable' };
  }
  const snapshotA = RunInputSnapshotSchema.safeParse((input.baselineFact as { result?: Rec }).result?.input_snapshot);
  const snapshotB = RunInputSnapshotSchema.safeParse((input.candidateFact as { result?: Rec }).result?.input_snapshot);
  if (snapshotA.success && snapshotA.data.goal?.node_id !== input.goalNodeId) return { ok: false, reason: 'baseline_unreadable' };
  if (snapshotB.success && snapshotB.data.goal?.node_id !== input.goalNodeId) return { ok: false, reason: 'candidate_unparseable' };
  const bindingDifference = snapshotA.success && snapshotB.success && snapshotA.data.goal && snapshotB.data.goal
    ? snapshotA.data.goal.frame !== snapshotB.data.goal.frame ? 'frame_changed'
      : snapshotA.data.goal.unit !== snapshotB.data.goal.unit && !sameUnit(snapshotA.data.goal.unit, snapshotB.data.goal.unit) ? 'unit_changed' : null
    : null;
  const goalReached = input.reachable.has(input.goalNodeId);
  const identityChanged = identityStatus(a.enrichment) !== identityStatus(b.enrichment);
  const claims: StructuralChallengeClaimV1[] = [];
  const candidateArmsIdentical = runArmsIdentical(input.candidateFact);
  const candidateGroups = runIdenticalArmGroups(input.candidateFact);

  // ── Leader ─────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const entitledA = mayPresentComparedRunLeader(input.turnMayNameLeader, input.baselineFact);
    const entitledB = mayPresentComparedRunLeader(input.candidateMayNameLeader ?? input.turnMayNameLeader, input.candidateFact);
    const idA = entitledA ? leaderOf(input.baselineFact) : null;
    // Identical arms split their wins, whatever shares the Run carries: ANY identical group means no candidate leader
    // is named (DL condition 1; DL ruling on partial disconnection, #2575).
    const idB = idA !== null && entitledB && candidateGroups.length === 0 ? leaderOf(input.candidateFact) : null;
    const base = { kind: 'leader' as const, baseline_option_id: idA, alternative_option_id: idB };
    if (idA === null || idB === null) {
      claims.push({ ...base, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'withheld_on_one_side', invariant_by_construction: false });
    } else if (bindingDifference !== null || identityChanged) {
      claims.push({ ...base, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: bindingDifference ?? 'identity_status_changed', invariant_by_construction: false });
    } else if (rankingStatus(a.enrichment) !== rankingStatus(b.enrichment)) {
      claims.push({ ...base, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'ranking_status_changed', invariant_by_construction: false });
    } else {
      // Missing win shares cannot supply evidence for a clear lead. In particular, never substitute 0 for an
      // absent runner-up and thereby manufacture a signal-qualified HOLDS verdict.
      const submitted = (fact: HandlerFact) => {
        const snapshot = RunInputSnapshotSchema.safeParse((fact as { result?: Rec }).result?.input_snapshot);
        return snapshot.success ? snapshot.data.options.map((o) => o.option_id) : [];
      };
      const roster = [...new Set([...rowsA.keys(), ...rowsB.keys(), ...submitted(input.baselineFact), ...submitted(input.candidateFact)])];
      const noises = [qualifiedLead(rowsA, idA, roster), qualifiedLead(rowsB, idB, roster)];
      const noise = noises.includes('not_noise_qualified') ? 'not_noise_qualified' : noises.every((n) => n === 'signal') ? 'signal' : 'within_noise';
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

  const optionIds = [...rowsA.keys()].sort();

  // ── Goal probability, per option ──────────────────────────────────────────────────────────────────────────────
  for (const optionId of optionIds) {
    const pA = rowsA.get(optionId)?.goal ?? null;
    const pB = rowsB.get(optionId)?.goal ?? null;
    const base = { kind: 'goal_probability' as const, option_id: optionId, constraint_id: null, baseline: pA, alternative: pB, target: null, constraint_boundary: null };
    if (pA === null || pB === null) {
      const withheld = runWithheldGoalFigures(pA === null ? a.enrichment : b.enrichment);
      claims.push({ ...base, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: withheld ? 'withheld_on_one_side' : 'missing_on_one_side', invariant_by_construction: false });
      continue;
    }
    if (bindingDifference !== null || identityChanged) {
      claims.push({ ...base, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: bindingDifference ?? 'identity_status_changed', invariant_by_construction: false });
      continue;
    }
    const noise = proportionChangeNoise(pA, pB, rowsA.get(optionId)?.n ?? 0, rowsB.get(optionId)?.n ?? 0);
    if (!goalReached && noise === 'within_noise') {
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
    const rB = rowsB.get(optionId);
    const target = licensedTarget(input.baselineFact, input.baselineGraph, input.goalNodeId, input.goalLevelTarget)
      && licensedTarget(input.candidateFact, input.candidateGraph, input.goalNodeId, input.goalLevelTarget) ? input.goalLevelTarget : null;
    const base = { kind: 'outcome_level' as const, option_id: optionId, constraint_id: null, baseline: rA.mean, alternative: rB?.mean ?? null, target, constraint_boundary: null };
    if (rA.mean === null || rB === undefined || rB.mean === null) {
      claims.push({ ...base, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'missing_on_one_side', invariant_by_construction: false });
      continue;
    }
    if (bindingDifference !== null || identityChanged) {
      claims.push({ ...base, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: bindingDifference ?? 'identity_status_changed', invariant_by_construction: false });
      continue;
    }
    const noise = rA.sd !== null && rB.sd !== null && rA.n !== null && rB.n !== null
      ? meanChangeNoise({ mean: rA.mean, sd: rA.sd, n: rA.n }, { mean: rB.mean, sd: rB.sd, n: rB.n })
      : 'not_noise_qualified';
    if (!goalReached && noise === 'within_noise') {
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
  for (const optionId of optionIds) {
    const cA = (rowsA.get(optionId) as OptionRow).constraints;
    const cB = rowsB.get(optionId)?.constraints;
    for (const constraintId of [...cA.keys()].sort()) {
      const pA = cA.get(constraintId) ?? null;
      const pB = cB?.get(constraintId) ?? null;
      const node = nodesA.get(constraintId);
      const base = { kind: 'constraint_probability' as const, option_id: optionId, constraint_id: constraintId, baseline: pA, alternative: pB, target: null, constraint_boundary: null };
      const missingBinding = node !== undefined && !nodesB.has(constraintId);
      if (pA === null || pB === null || missingBinding) {
        claims.push({ ...base, alternative: missingBinding ? null : pB, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'missing_on_one_side', invariant_by_construction: false });
        continue;
      }
      if (identityChanged) {
        claims.push({ ...base, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'identity_status_changed', invariant_by_construction: false });
        continue;
      }
      const noise = proportionChangeNoise(pA, pB, rowsA.get(optionId)?.n ?? 0, rowsB.get(optionId)?.n ?? 0);
      if (node !== undefined && nodesB.get(constraintId) === node && !input.reachable.has(node) && noise === 'within_noise') {
        claims.push({ ...base, noise_verdict: noise, verdict: 'holds', basis: 'unaffected_by_construction', invariant_by_construction: true });
      } else {
        claims.push({ ...base, noise_verdict: noise, verdict: 'delta_only', basis: noise === 'signal' ? 'no_licensed_boundary' : deltaOnlyBasis(noise), invariant_by_construction: false });
      }
    }
  }

  return { ok: true, pair_provenance, claims, certainty: {
    baseline: readStoredGoalCertainty((input.baselineFact as { result?: Rec }).result?.goal_certainty),
    alternative: readStoredGoalCertainty((input.candidateFact as { result?: Rec }).result?.goal_certainty),
    baselineDisplay: goalChanceDisplayForAgent(input.baselineFact.result),
    alternativeDisplay: goalChanceDisplayForAgent(input.candidateFact.result),
  }, ...identicalCarriers(candidateArmsIdentical && runArmsDistinct(input.baselineFact), candidateGroups),
  // Attribution is AFFIRMATIVE: only groups whose arms carry their valid-draw counts (Codex #2574 r3 P1).
  leader_same_as: leaderSameAs(input.baselineFact, claims, identicalArmGroups(individuallyUsableArms(input.candidateFact, true))) };
}
