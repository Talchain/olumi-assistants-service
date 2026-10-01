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
import { InterventionRangeSchema } from '@talchain/schemas';
import { RunInputSnapshotSchema, type RunInputSnapshot } from '@talchain/schemas/orchestrator';
import { normalizeRunGoalUnit } from '../../context/run-goal-unit.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { edgeBandFromMagnitude, strengthBandFromEdgeBand } from '../../format/edge-strength-bands.js';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const text = (v: unknown, max = 200): string | undefined =>
  typeof v === 'string' && v.trim().length > 0 ? v.slice(0, max) : undefined;
const label = (v: unknown): string | undefined => (typeof v === 'string' ? v.slice(0, 200) : undefined);

/** Deterministic JSON: object keys sorted, so equal inputs digest equally whatever their insertion order. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (isRec(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** sha256 of the request CEE sends PLoT, `request_id` excluded (it differs on every call, the inputs need not). */
export function sentDigest(plotPayload: Rec): string {
  const { request_id: _requestId, ...inputs } = plotPayload;
  return createHash('sha256').update(stableStringify(inputs)).digest('hex');
}

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
  const factors = nodes.flatMap((n) => {
    const id = text(n.id);
    const os = isRec(n.observed_state) ? n.observed_state : null;
    if (id === undefined || os === null || id === goalId) return [];
    const encoded = finite(os.value);
    // The AUTHORED figure only: a normalised `value` is never recorded as the user's raw (contract header).
    const raw = finite(os.raw_value) ?? text(os.display_value);
    if (raw === undefined && encoded === undefined) return [];
    return [{
      factor_id: id,
      ...(label(n.label) !== undefined ? { label: label(n.label) } : {}),
      ...(raw !== undefined ? { raw } : {}),
      ...(text(os.unit, 64) !== undefined ? { unit: text(os.unit, 64) } : {}),
      ...(encoded !== undefined ? { encoded } : {}),
      ...(text(os.source, 64) !== undefined ? { source: text(os.source, 64) } : {}),
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
    if (c.operator !== '>=' && c.operator !== '<=') return [];
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
    const p = finite(e.exists_probability);
    const persisted = input.persistedEdges === undefined ? undefined : persistedByPair.get(`${from}\u0000${to}`) ?? undefined;
    return [{
      from,
      to,
      mean,
      ...(finite(strength.std) !== undefined ? { std: finite(strength.std) } : {}),
      ...(p !== undefined && p >= 0 && p <= 1 ? { exists_probability: p } : {}),
      band: strengthBandFromEdgeBand(edgeBandFromMagnitude(Math.abs(mean))),
      ...(persisted !== undefined ? { sizing: linkSizing(persisted) } : {}),
    }];
  });

  const candidate = {
    snapshot_version: 1 as const,
    sent_digest: sentDigest(input.plotPayload),
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
  // The contract's bounds and one-row-per-input rules decide; a refusal records NO snapshot (never a partial one).
  const parsed = RunInputSnapshotSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
