/**
 * SC-24 — THE INPUT A RUN WAS SENT, captured from the PLoT request itself (lease DL #75 5915191128 / 5915306950).
 *
 * Contract: `RunAnalysisResult.input_snapshot` (`RunInputSnapshotSchema`, @talchain/schemas SC-24 train, schemas #76
 * @ 5a595309 `src/orchestrator/run-input-snapshot.ts`). Until CEE vendors that release the shape is mirrored as a
 * TYPE here (no second validator: the spec parses this module's output with the contract's own zod module), and the
 * write onto the Run fact lands with the vendor bump — `RunAnalysisResultSchema` is `.strict()` on 0.64.0.
 *
 * WHY THE REQUEST AND NOT THE GRAPH. CEE transforms a copy of the persisted graph about ten ways before PLoT (option
 * gating, the Olumi-proposed filter, carried baselines / caps / spreads, wire-scale interventions, a derived goal
 * direction). "What changed between Run A and Run B" is a diff of two recorded INPUTS, so the snapshot is read from
 * the finished `plotPayload`, between building it and `plotClient.run` — never from a later graph read.
 *
 * RULES (schemas #76 header; AIQ 5914731075; P0 SHARED DATA 5914750268):
 *   - every member copies what the Run was SENT; a member it was not sent is ABSENT, never inferred or defaulted
 *     (a missing unit never becomes GBP; a missing direction stays absent);
 *   - `raw` + `unit` are the AUTHORED figure (the node's own `raw_value` / `goal_threshold_raw` and unit fields, as
 *     sent); `encoded` is the number PLoT received;
 *   - `goal.unit` IS `goal_threshold_unit` exactly — the Run-attested goal unit P0's currentness gate reads.
 *
 * Pure. Never throws. Returns `null` when the request cannot be represented inside the contract's bounds (the Run
 * then simply carries no snapshot — never a truncated one that would diff as a change).
 */
import { createHash } from 'node:crypto';
import { stableStringify } from '../../../orchestrator/context/stable-stringify.js';

type Raw = number | string | boolean;
type Comparator = '>=' | '<=' | '>' | '<';

export interface RunInputGoal {
  readonly node_id: string;
  readonly label?: string;
  readonly target_raw?: number;
  readonly unit?: string;
  readonly operator?: Comparator;
  readonly direction?: 'maximise' | 'minimise';
  readonly frame?: string;
}
export interface RunInputSetting {
  readonly factor_id: string;
  readonly label?: string;
  readonly raw?: Raw;
  readonly unit?: string;
  readonly encoded: number;
  readonly held?: true;
  readonly kind?: string;
}
export interface RunInputOption {
  readonly option_id: string;
  readonly label?: string;
  readonly is_baseline?: true;
  readonly settings: readonly RunInputSetting[];
}
export interface RunInputOptionNotSent {
  readonly option_id: string;
  readonly label?: string;
  readonly reason: 'not_analysable' | 'olumi_proposed';
}
export interface RunInputFactor {
  readonly factor_id: string;
  readonly label?: string;
  readonly raw?: Raw;
  readonly unit?: string;
  readonly encoded?: number;
  readonly source?: string;
}
export interface RunInputConstraint {
  readonly constraint_id: string;
  readonly node_id: string;
  readonly label?: string;
  readonly operator: '>=' | '<=';
  readonly raw: number;
  readonly unit?: string;
  readonly frame?: string;
}
export interface RunInputLink {
  readonly from: string;
  readonly to: string;
  readonly mean: number;
  readonly std?: number;
  readonly exists_probability?: number;
}
export interface RunInputSnapshot {
  readonly snapshot_version: 1;
  readonly sent_digest: string;
  readonly goal: RunInputGoal | null;
  readonly options: readonly RunInputOption[];
  readonly options_not_sent: readonly RunInputOptionNotSent[];
  readonly factors: readonly RunInputFactor[];
  readonly constraints: readonly RunInputConstraint[];
  readonly links: readonly RunInputLink[];
}

/** The contract's bounds (schemas #76): over any of them the Run carries no snapshot rather than a partial one. */
const MAX = { options: 50, notSent: 50, factors: 500, constraints: 100, links: 2000, settings: 200, id: 200, label: 200, unit: 64, kind: 32, frame: 32, source: 64 } as const;
const COMPARATORS: readonly string[] = ['>=', '<=', '>', '<'];

type Rec = Record<string, unknown>;
const rec = (x: unknown): Rec | null => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Rec) : null);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const id = (x: unknown): string | undefined => (typeof x === 'string' && x.length >= 1 && x.length <= MAX.id ? x : undefined);
const text = (x: unknown, max: number): string | undefined => (typeof x === 'string' && x.length >= 1 && x.length <= max ? x : undefined);
/** A label is display text: longer than the contract allows is cut, never dropped (it is not an input value). */
const label = (x: unknown): string | undefined => (typeof x === 'string' ? x.slice(0, MAX.label) : undefined);
const raw = (x: unknown): Raw | undefined =>
  finite(x) || typeof x === 'boolean' ? x : typeof x === 'string' && x.length >= 1 && x.length <= 200 ? x : undefined;
/** Only a member that was sent: `undefined` keys are dropped so an absent field stays absent on the wire. */
function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** sha256 of the request CEE sent PLoT, request id excluded: equal digests mean identical inputs. */
export function sentDigest(plotPayload: Rec): string {
  const { request_id: _requestId, ...sent } = plotPayload;
  return createHash('sha256').update(stableStringify(sent), 'utf8').digest('hex');
}

export function captureRunInputSnapshot(
  plotPayload: Rec,
  notSent: readonly RunInputOptionNotSent[] = [],
): RunInputSnapshot | null {
  const graph = rec(plotPayload.graph);
  const nodes = (Array.isArray(graph?.nodes) ? graph!.nodes : []).map(rec).filter((n): n is Rec => n !== null);
  const byId = new Map(nodes.filter((n) => typeof n.id === 'string').map((n) => [n.id as string, n]));
  const nodeLabel = (nodeId: string) => label(byId.get(nodeId)?.label);

  // --- goal: the goal node as sent, plus the request's own direction flag when it was sent ---
  let goal: RunInputGoal | null = null;
  const goalId = id(plotPayload.goal_node_id);
  const goalNode = goalId !== undefined ? byId.get(goalId) : undefined;
  if (goalId !== undefined && goalNode !== undefined) {
    const direction = plotPayload.goal_direction;
    goal = defined({
      node_id: goalId,
      label: label(goalNode.label),
      target_raw: finite(goalNode.goal_threshold_raw) ? goalNode.goal_threshold_raw : undefined,
      unit: text(goalNode.goal_threshold_unit, MAX.unit),
      operator: typeof goalNode.goal_direction === 'string' && COMPARATORS.includes(goalNode.goal_direction) ? (goalNode.goal_direction as Comparator) : undefined,
      direction: direction === 'maximise' || direction === 'minimise' ? (direction as 'maximise' | 'minimise') : undefined,
      frame: text(goalNode.goal_threshold_frame, MAX.frame),
    });
  }

  // --- options: what each sent option set, per factor; the authored figure from the option node as sent ---
  const options: RunInputOption[] = [];
  for (const o of Array.isArray(plotPayload.options) ? plotPayload.options : []) {
    const opt = rec(o);
    const optionId = id(opt?.option_id) ?? id(opt?.id);
    if (opt === null || optionId === undefined) return null;
    const node = byId.get(optionId) ?? (typeof opt.id === 'string' ? byId.get(opt.id) : undefined);
    const authored = rec(node?.interventions) ?? {};
    const settings: RunInputSetting[] = [];
    for (const [factorId, encoded] of Object.entries(rec(opt.interventions) ?? {})) {
      if (!finite(encoded) || id(factorId) === undefined) continue; // PLoT is sent numbers; anything else is not a setting
      const stated = rec(authored[factorId]);
      settings.push(defined({
        factor_id: factorId,
        label: nodeLabel(factorId),
        raw: stated !== null ? raw(stated.raw_value) ?? raw(stated.display_value) : undefined,
        unit: stated !== null ? text(stated.unit, MAX.unit) : undefined,
        encoded,
        // The option node states nothing for this factor, yet the Run was sent a value: CEE held it (status quo).
        held: authored[factorId] === undefined ? (true as const) : undefined,
        kind: stated !== null ? text(stated.kind, MAX.kind) : undefined,
      }));
    }
    if (settings.length > MAX.settings) return null;
    options.push(defined({
      option_id: optionId,
      label: label(opt.label) ?? label(node?.label),
      is_baseline: opt.is_baseline === true ? (true as const) : undefined,
      settings,
    }));
  }

  // --- factors: each node's own value as sent ---
  const factors: RunInputFactor[] = [];
  for (const n of nodes) {
    const os = rec(n.observed_state);
    const factorId = id(n.id);
    if (os === null || factorId === undefined) continue;
    factors.push(defined({
      factor_id: factorId,
      label: label(n.label),
      raw: raw(os.raw_value) ?? raw(os.display_value),
      unit: text(os.unit, MAX.unit),
      encoded: finite(os.value) ? os.value : undefined,
      source: text(os.source, MAX.source),
    }));
  }

  // --- limits, as sent (the wire copy may have withheld a frame or an operator: copy what PLoT received) ---
  const constraints: RunInputConstraint[] = [];
  for (const c of Array.isArray(plotPayload.goal_constraints) ? plotPayload.goal_constraints : []) {
    const row = rec(c);
    const constraintId = id(row?.constraint_id);
    const nodeId = id(row?.node_id);
    if (row === null || constraintId === undefined || nodeId === undefined || !finite(row.value)) continue;
    if (row.operator !== '>=' && row.operator !== '<=') continue; // the contract's limit comparators; nothing else is a limit PLoT reads
    constraints.push(defined({
      constraint_id: constraintId,
      node_id: nodeId,
      label: label(row.label),
      operator: row.operator,
      raw: row.value,
      unit: text(row.unit, MAX.unit),
      frame: text(row.value_frame, MAX.frame),
    }));
  }

  // --- links, as sent ---
  const links: RunInputLink[] = [];
  for (const e of Array.isArray(graph?.edges) ? graph!.edges : []) {
    const edge = rec(e);
    const strength = rec(edge?.strength);
    const from = id(edge?.from);
    const to = id(edge?.to);
    if (edge === null || from === undefined || to === undefined || strength === null || !finite(strength.mean)) continue;
    const p = edge.exists_probability;
    links.push(defined({
      from,
      to,
      mean: strength.mean,
      std: finite(strength.std) ? strength.std : undefined,
      exists_probability: finite(p) && p >= 0 && p <= 1 ? p : undefined,
    }));
  }

  if (options.length > MAX.options || notSent.length > MAX.notSent || factors.length > MAX.factors
    || constraints.length > MAX.constraints || links.length > MAX.links) return null;
  const unique = <T>(rows: readonly T[], key: (r: T) => string) => new Set(rows.map(key)).size === rows.length;
  if (!unique(options, (o) => o.option_id) || !unique(notSent, (o) => o.option_id) || !unique(factors, (f) => f.factor_id)
    || !unique(constraints, (c) => c.constraint_id) || !unique(links, (l) => JSON.stringify([l.from, l.to]))) return null;

  return {
    snapshot_version: 1,
    sent_digest: sentDigest(plotPayload),
    goal,
    options,
    options_not_sent: notSent.map((o) => defined({ option_id: o.option_id, label: label(o.label), reason: o.reason })),
    factors,
    constraints,
    links,
  };
}
