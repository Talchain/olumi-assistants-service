/**
 * V5 staging assurance — Supabase fact / hash / graph reads (MANUAL ONLY).
 *
 * Closes the HTTP-only blind spot the audit identified: the replay spine
 * cannot see handler-fact persistence, the persisted graph, or the
 * run-time graph hash. These reads use the service-role client from
 * `./supabase.ts` to prove, from the system of record, what the wire
 * cannot show:
 *   - graphless run_analysis persisted ZERO handler facts;
 *   - draft-first run_analysis persisted a `run_analysis` fact carrying a
 *     `graph_hash_at_run`;
 *   - a deterministic mutation actually changed the persisted factor value.
 *
 * Shapes verified against live cee-staging (project etmmuzwxtcjipwphdola):
 *   - v5_handler_facts: columns scenario_id, action_type, noop, payload;
 *     payload = { result, fact_type, fact_version };
 *     payload.result.graph_hash_at_run is the run-time hash.
 *   - scenarios.graph (JSONB) holds nodes[]; a factor node is
 *     { id, kind:'factor', label, observed_state:{ value, raw_value, unit, cap, ... } }.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface HandlerFactSummary {
  readonly total: number;
  /** action_type → count (e.g. { run_analysis: 1, set_factor_value: 1 }). */
  readonly byActionType: Readonly<Record<string, number>>;
  /** Count of facts flagged noop=true. */
  readonly noopCount: number;
}

/**
 * Summarise the handler facts persisted for a scenario. `total === 0`
 * proves the graphless run_analysis short-circuited before persisting any
 * fact (the null-graph-recoverable contract: fail BEFORE PLoT, BEFORE any
 * fact). Returns total:0 on a missing table (tolerated) so the caller can
 * still classify the check rather than crashing.
 */
export async function summariseHandlerFacts(
  client: SupabaseClient,
  scenarioId: string,
): Promise<HandlerFactSummary> {
  const { data, error } = await client
    .from('v5_handler_facts')
    .select('action_type, noop')
    .eq('scenario_id', scenarioId);
  if (error) {
    throw new Error(`v5_handler_facts read failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ action_type?: string | null; noop?: boolean | null }>;
  const byActionType: Record<string, number> = {};
  let noopCount = 0;
  for (const r of rows) {
    const a = typeof r.action_type === 'string' ? r.action_type : 'unknown';
    byActionType[a] = (byActionType[a] ?? 0) + 1;
    if (r.noop === true) noopCount += 1;
  }
  return { total: rows.length, byActionType, noopCount };
}

/**
 * Read `graph_hash_at_run` from the most recent `run_analysis` fact for a
 * scenario (payload.result.graph_hash_at_run). Returns null when no
 * run_analysis fact exists or the hash is absent.
 */
export async function latestRunAnalysisHash(
  client: SupabaseClient,
  scenarioId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('v5_handler_facts')
    .select('payload, created_at')
    .eq('scenario_id', scenarioId)
    .eq('action_type', 'run_analysis')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(`run_analysis fact read failed: ${error.message}`);
  }
  const row = (data ?? [])[0] as { payload?: unknown } | undefined;
  if (!row || typeof row.payload !== 'object' || row.payload === null) return null;
  const payload = row.payload as { result?: { graph_hash_at_run?: unknown } };
  const hash = payload.result?.graph_hash_at_run;
  return typeof hash === 'string' && hash.length > 0 ? hash : null;
}

// ---------------------------------------------------------------------------
// Persisted graph reads + factor-node resolution.
// ---------------------------------------------------------------------------

export interface GraphNode {
  readonly id: string;
  readonly kind: string;
  readonly label?: string;
  readonly observed_state?: {
    readonly value?: unknown;
    readonly raw_value?: unknown;
    readonly unit?: unknown;
    readonly cap?: unknown;
  };
}

export interface PersistedGraph {
  readonly nodes?: readonly GraphNode[];
  readonly edges?: readonly unknown[];
}

export interface FactorTarget {
  readonly id: string;
  readonly label: string;
  /** Current human-scale value (raw_value preferred; 0 for an unset scale factor). */
  readonly currentValue: number;
  readonly unit: string | null;
  /** Normalisation cap (human-scale upper bound), when the factor defines one. */
  readonly cap: number | null;
}

/**
 * Read the persisted graph (scenarios.graph) for a scenario. Returns null
 * when the row or graph is absent (e.g. graphless scenario).
 */
export async function readPersistedGraph(
  client: SupabaseClient,
  scenarioId: string,
): Promise<PersistedGraph | null> {
  const { data, error } = await client
    .from('scenarios')
    .select('graph')
    .eq('id', scenarioId)
    .maybeSingle();
  if (error) {
    throw new Error(`scenarios.graph read failed: ${error.message}`);
  }
  const graph = (data as { graph?: unknown } | null)?.graph;
  if (!graph || typeof graph !== 'object') return null;
  return graph as PersistedGraph;
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

const PREFERRED_LABELS = ['budget', 'cost', 'spend', 'salary', 'price', 'investment'];

/**
 * Rank candidate mutable factor nodes, best-first. The robust target is a
 * SCALE-DEFINED factor: a real unit (£/$/€/%/engineers/months/… — not the
 * dimensionless `'scale'`) AND a finite `cap`, so a same-scale, in-cap value
 * change is unambiguous and survives the bare-ratio guard (PR #296).
 *
 * Ranking (verified live against cee-staging):
 *   rank 0 — scale-defined, raw_value === 0 (clean/unset): a "Set to £N" SET
 *            applies cleanly (e.g. £0 → £140,000).
 *   rank 1 — scale-defined, |raw_value| >= 1 (clean human-scale value).
 *   rank 2 — scale-defined but raw_value in (0,1): MALFORMED (a sub-1 raw on a
 *            unit factor); a SET fails closed (#296 resolveExistingRawValue
 *            → ambiguous). Tried only as a last scale-defined resort.
 *   rank 3 — non-scale fallback factor (fragile; may no-op).
 * Within a rank, cost/budget/salary labels win. The orchestrator tries
 * candidates in order until one actually changes — robust to LLM-draft
 * nondeterminism where a given draft mints a malformed factor value.
 */
export function pickFactorTargets(graph: PersistedGraph | null): FactorTarget[] {
  const nodes = graph?.nodes ?? [];
  const ranked: Array<{ target: FactorTarget; rank: number; preferred: boolean }> = [];
  for (const n of nodes) {
    if (!n || n.kind !== 'factor' || typeof n.id !== 'string') continue;
    const os = n.observed_state;
    if (!os) continue;
    const raw = asFiniteNumber(os.raw_value);
    const val = asFiniteNumber(os.value);
    const cap = asFiniteNumber(os.cap);
    const unitRaw = typeof os.unit === 'string' ? os.unit.trim() : '';
    const unit = unitRaw.length > 0 ? unitRaw : null;
    const label = typeof n.label === 'string' ? n.label : n.id;
    const preferred = PREFERRED_LABELS.some((p) => label.toLowerCase().includes(p));
    const scaleDefined = !!unit && unit.toLowerCase() !== 'scale' && cap !== null && cap >= 2;
    if (scaleDefined) {
      const r = raw ?? 0;
      const rank = r === 0 ? 0 : Math.abs(r) >= 1 ? 1 : 2;
      ranked.push({ target: { id: n.id, label, currentValue: r, unit, cap }, rank, preferred });
    } else if (raw !== null && Math.abs(raw) >= 1) {
      ranked.push({ target: { id: n.id, label, currentValue: raw, unit, cap }, rank: 3, preferred });
    } else if (val !== null) {
      ranked.push({ target: { id: n.id, label, currentValue: val, unit, cap }, rank: 3, preferred });
    }
  }
  ranked.sort((a, b) => (a.rank - b.rank) || (Number(b.preferred) - Number(a.preferred)));
  return ranked.map((r) => r.target);
}

/** Convenience: the single best candidate (or null). */
export function pickFactorTarget(graph: PersistedGraph | null): FactorTarget | null {
  return pickFactorTargets(graph)[0] ?? null;
}

/**
 * Read the current numeric value of a specific factor node from a freshly
 * read graph (raw_value preferred, else value). Returns null when the node
 * or value is absent.
 */
export function readFactorValue(
  graph: PersistedGraph | null,
  nodeId: string,
): number | null {
  const node = (graph?.nodes ?? []).find((n) => n && n.id === nodeId);
  if (!node || !node.observed_state) return null;
  return asFiniteNumber(node.observed_state.raw_value) ?? asFiniteNumber(node.observed_state.value);
}

/**
 * Choose a mutation target on the factor's own scale: a clearly-different,
 * in-cap integer (so the deterministic value-update accepts it and the
 * bare-ratio guard, PR #296, never fires). When a `cap` is known we move to
 * ~70% of cap (or ~30% if already in the low half); without a cap we
 * double-and-offset a human-scale value. Always returns an integer ≥ 1 that
 * differs from `current` — the check proves the value CHANGED, not what it
 * became.
 */
export function chooseMutationValue(current: number | null, cap: number | null): number {
  const cur = current ?? 0;
  if (cap !== null && Number.isFinite(cap) && cap >= 2) {
    // cap >= 2 is guaranteed by the guard above, so the division is safe.
    const frac = cur / cap;
    let target = Math.round(cap * (frac < 0.5 ? 0.7 : 0.3));
    if (target < 1) target = Math.max(1, Math.round(cap * 0.5));
    if (target > cap) target = Math.round(cap * 0.5);
    if (target === Math.round(cur)) target = target + 1 <= cap ? target + 1 : target - 1;
    return target;
  }
  if (Number.isFinite(cur) && Math.abs(cur) >= 1) {
    const t = Math.round(Math.abs(cur)) * 2 + 7;
    return t === Math.round(cur) ? t + 1 : t;
  }
  return 40000;
}

/**
 * Format a mutation value with the factor's unit so the message is
 * unambiguous to the deterministic value-update extractor (e.g. `£105000`,
 * `30%`, `38 engineers`, or a bare number when the unit is unknown).
 */
export function formatMutationValue(target: number, unit: string | null): string {
  if (!unit) return String(target);
  const u = unit.trim();
  if (u === '£' || u === '$' || u === '€') return `${u}${target}`;
  if (u === '%') return `${target}%`;
  return `${target} ${u}`;
}
