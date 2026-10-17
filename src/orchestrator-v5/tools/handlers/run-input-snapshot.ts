/**
 * SC-24 — THE INPUT A RUN WAS SENT, recorded on its fact (`@talchain/schemas` 0.68.0 `RunInputSnapshotSchema`).
 *
 * Design: SC-24 v2 (programme-docs #84 5913851822 / 5914416431; lease DL #75 5914474485). One Run-unit carrier:
 * AIQ 5912905493 + 5914731075, P0 SHARED DATA 5914750268 — `goal` below is the Run-attested goal unit P0's
 * currentness gate reads.
 *
 * ⭐ CAPTURED FROM THE REQUEST, NOT THE GRAPH. `run-analysis.ts` transforms a copy of the persisted graph about ten
 * ways before PLoT (option gating, the Olumi-proposed filter, the participation guard, wire-scale interventions, the
 * carried baselines/caps/spreads). This builder reads the values that were actually dispatched — the final wire
 * options, the wire graph and the request's own goal/limit members — so "what changed between two Runs" is a diff of
 * two real inputs, never a reconstruction.
 *
 * RULES (AIQ 5914731075, P0 SHARED DATA 5914750268):
 *   - a member the Run was not sent is ABSENT — never inferred or defaulted (a missing unit never becomes GBP);
 *   - `raw` + `unit` are the AUTHORED figure (`raw_value` / `goal_threshold_raw` / `goal_threshold_unit` as stored);
 *     `encoded` is the number PLoT received;
 *   - bounded: if the request exceeds a contract bound, NO snapshot is recorded (a truncated list would read as
 *     complete) — the Run is unaffected and its delta reports `not_recorded`.
 *
 * Pure. A snapshot the contract refuses is dropped (logged by the caller), never allowed to fail the Run.
 */

import { createHash } from 'node:crypto';
import { sentDigest } from './run-input-digest.js';
export { sentDigest } from './run-input-digest.js';
import { InterventionRangeSchema } from '@talchain/schemas';
import { RunInputSnapshotSchema, type RunInputSnapshot } from '@talchain/schemas/orchestrator';
import { normalizeRunGoalUnit } from '../../context/run-goal-unit.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { edgeBandFromMagnitude, strengthBandFromEdgeBand } from '../../format/edge-strength-bands.js';
import { factorAuthorshipDigest, linkAuthorshipDigest, residualDigest } from './run-input-residual.js';
import { STATED_LEVEL_STD } from './stated-level-spread.js';
import { effectiveLinkExistenceProbability } from '../../goal-target/held-user-links.js';
import { z } from 'zod';
import { GoalPeriod } from '@talchain/schemas';
import { askedQuestionOf, dispatchedQuestionOf } from '../../goal-target/run-question-scope.js';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const text = (v: unknown, max = 200): string | undefined =>
  typeof v === 'string' && v.trim().length > 0 ? v.slice(0, max) : undefined;
const label = (v: unknown): string | undefined => (typeof v === 'string' ? v.slice(0, 200) : undefined);

/**
 * The Run's execution identity (`RunAnalysisResult.run_id`): one per turn that ran it, and the SAME on a replay of
 * that turn, so a re-delivered turn is never compared with itself while two intentional Runs stay distinct.
 */
export function runIdFor(input: { scenarioId: string; turnId: string; graphHashAtRun: string | null }): string {
  return createHash('sha256')
    .update(`run_analysis\n${input.scenarioId}\n${input.turnId}\n${input.graphHashAtRun ?? ''}`)
    .digest('hex');
}

const optionIdOf = (opt: Rec): string | undefined => text(opt.option_id) ?? text(opt.id);

const COMPARATORS = new Set(['>=', '<=', '>', '<']);

export interface RunInputSnapshotInput {
  /** The options SUBMITTED to PLoT, in order (post gate + Olumi filter). */
  readonly submittedOptions: ReadonlyArray<Rec>;
  /** Per submitted option: the ORIGINAL intervention objects (user units), keyed by factor id. */
  readonly rawObjectsPerOption: ReadonlyArray<Rec>;
  /** Per submitted option: the wire number PLoT received, keyed by factor id. */
  readonly wirePerOption: ReadonlyArray<Readonly<Record<string, number>>>;
  /** Factor ids CEE HELD at their current value, per option id (the status-quo scaffold). */
  readonly heldFactorIdsByOptionId: ReadonlyMap<string, ReadonlySet<string>>;
  /** Options the Run did not compare, and why. */
  readonly optionsNotSent: ReadonlyArray<{ option_id: string; label: string | null; reason: 'not_analysable' | 'olumi_proposed' | 'infeasible' | 'removed' }>;
  /** The graph PLoT received. */
  readonly wireGraph: unknown;
  /** The request PLoT received (goal_node_id, goal_constraints, goal_direction live here). */
  readonly plotPayload: Rec;
  /**
   * 0.70.0 (R3 DEFECT 3): the edges of the graph this Run was built from — who sized each link is provenance, never on
   * the wire, so it is read here. Absent = sizing not recorded (an older caller); never inferred.
   */
  readonly persistedEdges?: ReadonlyArray<unknown>;
  /**
   * 0.73.0: the factor ids whose σ THIS Run's `carryStatedLevelSpread` set (`statedLevelNodeIds` on the graph it carried).
   * Only those σ are authorship (`run-input-residual.ts` exception 4); absent = none (a stored σ is never assumed carried).
   */
  readonly statedLevelCarriedIds?: ReadonlySet<string>;
}

/** The snapshot, or `null` when it cannot be recorded honestly (over a bound, or refused by the contract). */
export function buildRunInputSnapshot(input: RunInputSnapshotInput): RunInputSnapshot | null {
  const graph = isRec(input.wireGraph) ? input.wireGraph : {};
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const edges = Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const nodeById = new Map<string, Rec>();
  for (const n of nodes) {
    const id = text(n.id);
    if (id !== undefined) nodeById.set(id, n);
  }

  // ── goal ────────────────────────────────────────────────────────────────
  // A Run sent no goal (`goal_node_id` absent or null) is goal-free: `goal: null`. An EXPLICIT goal id that is not a
  // usable id, or names no node PLoT was sent, is malformed: record NO snapshot rather than relabel the Run goal-free
  // (#2377's currentness gate would then read it fresh — P0 SHARED DATA 5917660267).
  const sentGoalId = input.plotPayload.goal_node_id;
  const goalId = sentGoalId === undefined || sentGoalId === null ? undefined : text(sentGoalId);
  if (sentGoalId !== undefined && sentGoalId !== null && (goalId === undefined || !nodeById.has(goalId))) return null;
  const goalNode = goalId !== undefined ? nodeById.get(goalId) : undefined;
  const goalUnit = normalizeRunGoalUnit(goalNode?.goal_threshold_unit);
  const goal =
    goalId === undefined
      ? null
      : {
          node_id: goalId,
          ...(label(goalNode?.label) !== undefined ? { label: label(goalNode?.label) } : {}),
          ...(finite(goalNode?.goal_threshold_raw) !== undefined ? { target_raw: finite(goalNode?.goal_threshold_raw) } : {}),
          // The ONE Run-goal-unit rule #2377's currentness gate compares with (bytes kept; absent/over 64 → absent).
          ...(goalUnit !== undefined ? { unit: goalUnit } : {}),
          ...(typeof goalNode?.goal_direction === 'string' && COMPARATORS.has(goalNode.goal_direction)
            ? { operator: goalNode.goal_direction }
            : {}),
          ...(input.plotPayload.goal_direction === 'minimise' || input.plotPayload.goal_direction === 'maximise'
            ? { direction: input.plotPayload.goal_direction }
            : {}),
          ...(text(goalNode?.goal_threshold_frame, 32) !== undefined ? { frame: text(goalNode?.goal_threshold_frame, 32) } : {}),
        };

  // ── options and their settings ─────────────────────────────────────────
  // An option PLoT was sent with no id cannot be diffed against another Run: record no snapshot rather than invent an
  // id (`option_0` would read as a real option, and a reorder would diff as a change).
  if (input.submittedOptions.some((opt) => optionIdOf(opt) === undefined)) return null;
  // A stated range that was SENT but whose author cannot be shown (0.68 requires `source`): no snapshot, rather than a
  // setting that silently drops the range and lets a range-only change read "complete".
  let unrecordableRange = false;
  const options = input.submittedOptions.map((opt, i) => {
    const optionId = optionIdOf(opt)!;
    const wire = input.wirePerOption[i] ?? {};
    const raws = input.rawObjectsPerOption[i] ?? {};
    const held = input.heldFactorIdsByOptionId.get(optionId);
    // TEMPORAL 0.66 `options[].intervention_ranges`: what PLoT received for this option, keyed by factor id.
    const sentRanges = isRec(opt.intervention_ranges) ? opt.intervention_ranges : {};
    const settings = Object.keys(wire)
      .sort()
      .flatMap((factorId) => {
        const encoded = finite(wire[factorId]);
        if (encoded === undefined) return [];
        const obj = raws[factorId];
        const o = isRec(obj) ? obj : {};
        const raw = finite(o.raw_value) ?? text(o.display_value) ?? (typeof o.value === 'boolean' ? o.value : undefined);
        // The range AS SENT ({low, high, meaning}), carrying its author from the option's own stated range object.
        const sentRange = sentRanges[factorId];
        let range: ReturnType<typeof InterventionRangeSchema.parse> | undefined;
        if (sentRange !== undefined) {
          const authored = isRec(o.range) ? o.range : {};
          const parsed = InterventionRangeSchema.safeParse({
            ...(isRec(sentRange) ? sentRange : {}),
            source: authored.source,
            ...(authored.source_quote !== undefined ? { source_quote: authored.source_quote } : {}),
          });
          if (parsed.success) range = parsed.data;
          else unrecordableRange = true;
        }
        return [{
          factor_id: factorId,
          ...(label(nodeById.get(factorId)?.label) !== undefined ? { label: label(nodeById.get(factorId)?.label) } : {}),
          ...(raw !== undefined ? { raw } : {}),
          ...(text(o.unit, 64) !== undefined ? { unit: text(o.unit, 64) } : {}),
          encoded,
          ...(held?.has(factorId) ? { held: true as const } : {}),
          ...(range !== undefined ? { range } : {}),
        }];
      });
    return {
      option_id: optionId,
      ...(label(opt.label) !== undefined ? { label: label(opt.label) } : {}),
      ...(opt.is_baseline === true ? { is_baseline: true as const } : {}),
      settings,
    };
  });
  if (unrecordableRange) return null;

  // ── factor values ──────────────────────────────────────────────────────
  const carried = input.statedLevelCarriedIds ?? new Set<string>();
  const factors = nodes.flatMap((n) => {
    const id = text(n.id);
    const isGoal = id === goalId;
    const os: Rec | null = isRec(n.observed_state) ? n.observed_state : isGoal ? {} : null;
    // A goal is also a measured quantity. Retain its authored current level in the existing value carrier;
    // `goal.target_raw` remains the target, never this level. An entry with no value explicitly records coverage
    // of an absent goal level; no entry means an older snapshot did not record it, never a known absence.
    if (id === undefined || os === null) return [];
    const encoded = finite(os.value);
    // The AUTHORED figure only: a normalised `value` is never recorded as the user's raw (contract header).
    const raw = finite(os.raw_value) ?? text(os.display_value);
    if (raw === undefined && encoded === undefined && !isGoal) return [];
    return [{
      factor_id: id,
      ...(label(n.label) !== undefined ? { label: label(n.label) } : {}),
      ...(raw !== undefined ? { raw } : {}),
      ...(text(os.unit, 64) !== undefined ? { unit: text(os.unit, 64) } : {}),
      ...(encoded !== undefined ? { encoded } : {}),
      ...(text(os.source, 64) !== undefined ? { source: text(os.source, 64) } : {}),
      // 0.73.0 (F1b lease #85 5945475375): the factor's authorship as the request carried it, so the diff can credit a
      // user's value edit pairwise instead of reading `partial` (`run-input-residual.ts` exception 4).
      authorship_digest: factorAuthorshipDigest(n, carried.has(id) && os.std === STATED_LEVEL_STD),
    }];
  });

  // ── limits ─────────────────────────────────────────────────────────────
  const rawConstraints = Array.isArray(input.plotPayload.goal_constraints)
    ? input.plotPayload.goal_constraints.filter(isRec)
    : [];
  const constraints = rawConstraints.flatMap((c) => {
    const constraintId = text(c.constraint_id);
    const nodeId = text(c.node_id);
    const raw = finite(c.value);
    if (constraintId === undefined || nodeId === undefined || raw === undefined) return [];
    // Recovery Batch C (ruling 16; schemas 0.83.0): a strict `>` / `<` is recorded AS SENT, never dropped or coerced.
    if (c.operator !== '>=' && c.operator !== '<=' && c.operator !== '>' && c.operator !== '<') return [];
    return [{
      constraint_id: constraintId,
      node_id: nodeId,
      ...(label(c.label) !== undefined ? { label: label(c.label) } : {}),
      operator: c.operator,
      raw,
      ...(text(c.unit, 64) !== undefined ? { unit: text(c.unit, 64) } : {}),
      ...(text(c.value_frame, 32) !== undefined ? { frame: text(c.value_frame, 32) } : {}),
    }];
  });

  // ── links ──────────────────────────────────────────────────────────────
  // 0.70.0 (R3 DEFECT 3; AIQ 5918134795): a link's mean/std/exists_probability are the engine's numbers and never a
  // row figure, so the link is also recorded in the user's terms: the BAND its sent strength sits in (CEE's cuts, the
  // contract's literal) and WHO SIZED it (`linkSizing` on the graph this Run was built from — one edge per pair, or
  // none recorded).
  const persistedByPair = new Map<string, Rec | null>();
  for (const pe of (input.persistedEdges ?? []).filter(isRec)) {
    const k = `${String(pe.from)}\u0000${String(pe.to)}`;
    persistedByPair.set(k, persistedByPair.has(k) ? null : pe);
  }
  const links = edges.flatMap((e) => {
    const from = text(e.from);
    const to = text(e.to);
    const strength = isRec(e.strength) ? e.strength : {};
    const mean = finite(strength.mean);
    if (from === undefined || to === undefined || mean === undefined) return [];
    const p = effectiveLinkExistenceProbability(e);
    const persisted = input.persistedEdges === undefined ? undefined : persistedByPair.get(`${from}\u0000${to}`) ?? undefined;
    return [{
      from,
      to,
      mean,
      ...(finite(strength.std) !== undefined ? { std: finite(strength.std) } : {}),
      ...(p !== undefined ? { exists_probability: p } : {}),
      band: strengthBandFromEdgeBand(edgeBandFromMagnitude(Math.abs(mean))),
      ...(persisted !== undefined ? { sizing: linkSizing(persisted) } : {}),
      // 0.72.0 (DL ruling #2482 r3): the link's authorship as the request carried it, so the diff can tell pairwise
      // whether an authorship change is the one a `sizing` row states (`run-input-residual.ts`).
      authorship_digest: linkAuthorshipDigest(e),
    }];
  });

  const recorded = {
    goal,
    options,
    options_not_sent: input.optionsNotSent.map((o) => ({
      option_id: o.option_id,
      ...(o.label !== null ? { label: o.label.slice(0, 200) } : {}),
      reason: o.reason,
    })),
    factors,
    constraints,
    links,
  };
  // 0.71.0 (DL ruling #2482 5939864517): every analysis input this snapshot does NOT record, digested
  // (`run-input-residual.ts`) — a pair is `complete` only when both ends carry one and they are equal.
  const residual = residualDigest(input.plotPayload, recorded, carried);
  const candidate = {
    snapshot_version: 1 as const,
    sent_digest: sentDigest(input.plotPayload),
    ...(residual !== null ? { residual_digest: residual } : {}),
    ...recorded,
  };
  // The contract's bounds and one-row-per-input rules decide; a refusal records NO snapshot (never a partial one).
  const parsed = RunInputSnapshotSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** Descriptive evidence on the existing Run fact, independent of permission to show any result. */
export const RUN_QUESTION_EVIDENCE_KEY = '__cee_evaluated_question';
const QuestionSideSchema = z.object({
  quantity: z.object({ node_id: z.string().min(1).max(200), label: z.string().max(200).optional() }).strict(),
  target: z.number().finite().optional(), comparator: z.enum(['>=', '>', '<=', '<']).optional(),
  unit: z.string().max(64).optional(), frame: z.string().max(32).optional(),
  horizon: z.object({ months: z.number().finite().optional(), deadline: z.string().max(200).optional(), as_stated: z.string().max(4000).optional() }).strict().optional(),
  reference: z.string().max(4000).optional(), period: GoalPeriod.optional(),
  option_ids: z.array(z.string().min(1).max(200)).max(200).optional(), baseline: z.number().finite().optional(),
  encoded_target: z.number().finite().optional(), encoded_baseline: z.number().finite().optional(),
}).strict();
const RecordedQuestionSchema = z.object({
  run_id: z.string().min(1).max(200),
  evaluated_scenario_revision: z.number().int().nonnegative().refine(Number.isSafeInteger).nullable(),
  graph_hash_at_run: z.string().min(1).nullable(), sent_digest: z.string().regex(/^[a-f0-9]{64}$/u),
  asked: QuestionSideSchema.nullable(), calculated: QuestionSideSchema.nullable(),
  // null records a known absence on this request; an absent record is historical evidence not retained.
  dispatched_goal_threshold: z.number().finite().nullable(), dispatched_goal_baseline: z.number().finite().nullable(),
}).strict();
export type RecordedRunQuestion = z.infer<typeof RecordedQuestionSchema>;

/** The saved read and FINAL request, captured before dispatch. Never a licence or an output-statistic inference. */
export function recordRunQuestion(input: {
  runId: string; revision: number | undefined; graphHashAtRun: string | null;
  savedGraph: unknown; dispatchedRequest: Rec; inputSnapshot: RunInputSnapshot | null;
}): RecordedRunQuestion | undefined {
  const snapshot = input.inputSnapshot;
  if (snapshot === null || snapshot.sent_digest !== sentDigest(input.dispatchedRequest)) return undefined;
  const goalId = typeof input.dispatchedRequest.goal_node_id === 'string' ? input.dispatchedRequest.goal_node_id : undefined;
  const dispatched = dispatchedQuestionOf(input.dispatchedRequest);
  const threshold = dispatched?.encoded_target ?? null;
  // A raw target can ride the graph without a scoring threshold. It belongs to ASKED, never to a performed comparison.
  const calculated = dispatched === null ? null : { ...dispatched, ...(threshold === null ? { target: undefined } : {}) };
  const parsed = RecordedQuestionSchema.safeParse({ run_id: input.runId,
    evaluated_scenario_revision: input.revision ?? null, graph_hash_at_run: input.graphHashAtRun,
    sent_digest: snapshot.sent_digest,
    asked: goalId === undefined ? null : askedQuestionOf(input.savedGraph, goalId), calculated,
    dispatched_goal_threshold: threshold, dispatched_goal_baseline: dispatched?.encoded_baseline ?? null });
  return parsed.success ? parsed.data : undefined;
}

/** Only the selected fact's own revision and dispatched-input digest can bind this descriptive record. */
export function readRecordedRunQuestion(value: unknown, identity: {
  runId: string | null; revision?: number | null; graphHashAtRun?: unknown; inputSnapshot: unknown;
}): RecordedRunQuestion | undefined {
  const parsed = RecordedQuestionSchema.safeParse(value);
  if (!parsed.success || !isRec(identity.inputSnapshot)) return undefined;
  const r = parsed.data;
  const goal = isRec(identity.inputSnapshot.goal) ? identity.inputSnapshot.goal : undefined;
  const calculated = r.calculated;
  if (calculated !== null) {
    const ids = Array.isArray(identity.inputSnapshot.options)
      ? identity.inputSnapshot.options.filter(isRec).map(option => option.option_id) : undefined;
    // Shared retained fields must agree. The baseline/threshold encodings are separate actual request fields;
    // never derive them from these raw values or force an invalid dispatch to look consistent.
    if (goal === undefined || calculated.quantity.node_id !== goal.node_id
      || (calculated.target !== undefined && calculated.target !== goal.target_raw)
      || calculated.unit !== goal.unit || calculated.frame !== goal.frame
      || JSON.stringify(calculated.option_ids) !== JSON.stringify(ids)) return undefined;
    const factors = Array.isArray(identity.inputSnapshot.factors) ? identity.inputSnapshot.factors.filter(isRec) : [];
    const baselines = factors.filter(factor => factor.factor_id === goal.node_id);
    if ((calculated.baseline !== undefined && (baselines.length !== 1 || baselines[0]!.raw !== calculated.baseline))
      || r.dispatched_goal_threshold !== (calculated.encoded_target ?? null)
      || r.dispatched_goal_baseline !== (calculated.encoded_baseline ?? null)
      || (r.dispatched_goal_threshold === null && calculated.target !== undefined)) return undefined;
  } else if (r.dispatched_goal_threshold !== null || r.dispatched_goal_baseline !== null) {
    return undefined;
  }
  return r.run_id === identity.runId && (identity.revision == null || r.evaluated_scenario_revision === identity.revision)
    && r.sent_digest === identity.inputSnapshot.sent_digest
    && (identity.graphHashAtRun === undefined || r.graph_hash_at_run === identity.graphHashAtRun) ? r : undefined;
}
