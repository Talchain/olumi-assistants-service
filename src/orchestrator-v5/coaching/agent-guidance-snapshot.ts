/**
 * ⭐ AGENT GUIDANCE STATE — what the Agent lane offered, and what the user pressed, durably (AI HARNESS G1;
 * programme-docs#85, Paul's approval 1 Oct: "Stateful guidance uses ONE mechanism: existing coaching_state storage →
 * deterministic selection in Harness → Panel renders it").
 *
 * Paul's 1 Oct test: "Strengthen the model" came back on the reply to its own press, again and again. The next-step
 * chips were a static list with no memory, and the only cross-turn record was in process `Map`s that a restart loses.
 *
 * STORAGE, no migration: the SAME `v5_conversation_turns.coaching_state` JSONB column, on the Agent's own answer row
 * (which wrote NULL there before), under a self-describing envelope `{snapshot_timing: 'agent_guidance', ...}`. The
 * route-v2 reader (`readMostRecentCoachingState`) reads only `pre_dispatch` snapshots, so these rows never shadow
 * V5's coaching state; `readMostRecentAgentGuidance` reads only these.
 *
 * CONTENT-FREE, like the column's other writer: policy ids (Reasoning Coach contract rows, e.g. `RC-STRENGTHEN-ITEM`,
 * plus an item id where the row is per item), a closed status enum, a 12-hex state hash and a turn id. Never words.
 *
 * Optional and additive: a scenario with no such row reads as {@link EMPTY_AGENT_GUIDANCE}; any drift parses to it.
 */
import { createHash } from 'node:crypto';

export const AGENT_GUIDANCE_SNAPSHOT_TIMING = 'agent_guidance' as const;

/** Reasoning Coach contract: per policy row (and per item for RC-STRENGTHEN-ITEM). */
export type AgentGuidanceStatus = 'offered' | 'pressed' | 'completed' | 'dismissed';

const STATUSES: ReadonlySet<string> = new Set<AgentGuidanceStatus>(['offered', 'pressed', 'completed', 'dismissed']);

export interface AgentGuidanceEntry {
  readonly status: AgentGuidanceStatus;
  /** {@link stateKeyHash} of the state the status was recorded in. */
  readonly state_key_hash: string;
  readonly turn_id: string | null;
  /**
   * When the status was recorded (ISO-8601). The ONLY order: JSONB does not keep object-key order (CODEX_CLI_OVERFLOW on
   * #2459), so recency, eviction and the cross-row merge all read this, never key position.
   */
  readonly at: string;
}

export interface AgentGuidanceRecord {
  readonly v: 1;
  /** Keyed by {@link guidanceKey}; bounded by {@link MAX_GUIDANCE_ENTRIES}, the oldest `at` evicted first. */
  readonly entries: Readonly<Record<string, AgentGuidanceEntry>>;
}

export interface AgentGuidanceSnapshot {
  readonly snapshot_timing: typeof AGENT_GUIDANCE_SNAPSHOT_TIMING;
  readonly agent_guidance: AgentGuidanceRecord;
}

export const EMPTY_AGENT_GUIDANCE: AgentGuidanceRecord = Object.freeze({ v: 1 as const, entries: Object.freeze({}) });

/** 5 contract rows plus per-item Strengthen entries: far below this; the oldest go first. */
export const MAX_GUIDANCE_ENTRIES = 32;

/** How many of the newest guidance-carrying answer rows the reader merges (concurrent tabs; a bounded read). */
export const AGENT_GUIDANCE_MERGE_WINDOW = 20;

const KEY = /^[A-Za-z0-9_.:-]{1,128}$/;
const HASH = /^[0-9a-f]{12}$/;

export function guidanceKey(policyId: string, itemId?: string): string {
  return itemId === undefined ? policyId : `${policyId}:${itemId}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(rec).sort().filter((k) => rec[k] !== undefined).map((k) => [k, canonical(rec[k])]));
  }
  return value;
}

/** sha256 of the canonical JSON (sorted keys, `undefined` members dropped), first 12 hex. */
export function stateKeyHash(slice: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(slice ?? null))).digest('hex').slice(0, 12);
}

export function toAgentGuidanceSnapshot(record: AgentGuidanceRecord): AgentGuidanceSnapshot {
  return { snapshot_timing: AGENT_GUIDANCE_SNAPSHOT_TIMING, agent_guidance: record };
}

/** Pure + total. Anything that is not a well-formed agent-guidance envelope reads as empty; bad entries are skipped. */
export function parseAgentGuidanceSnapshot(raw: unknown): AgentGuidanceRecord {
  try {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_AGENT_GUIDANCE;
    const env = raw as Record<string, unknown>;
    if (env.snapshot_timing !== AGENT_GUIDANCE_SNAPSHOT_TIMING) return EMPTY_AGENT_GUIDANCE;
    const rec = env.agent_guidance as { v?: unknown; entries?: unknown } | null | undefined;
    if (rec === null || typeof rec !== 'object' || rec.v !== 1) return EMPTY_AGENT_GUIDANCE;
    const entries = rec.entries;
    if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) return EMPTY_AGENT_GUIDANCE;
    const out: Record<string, AgentGuidanceEntry> = {};
    for (const [k, v] of Object.entries(entries as Record<string, unknown>)) {
      const e = v as { status?: unknown; state_key_hash?: unknown; turn_id?: unknown; at?: unknown } | null;
      if (!KEY.test(k) || e === null || typeof e !== 'object') continue;
      if (typeof e.status !== 'string' || !STATUSES.has(e.status)) continue;
      if (typeof e.state_key_hash !== 'string' || !HASH.test(e.state_key_hash)) continue;
      out[k] = { status: e.status as AgentGuidanceStatus, state_key_hash: e.state_key_hash, turn_id: typeof e.turn_id === 'string' ? e.turn_id : null, at: typeof e.at === 'string' ? e.at : '' };
    }
    return { v: 1, entries: out };
  } catch {
    return EMPTY_AGENT_GUIDANCE;
  }
}

const newestFirst = (a: readonly [string, AgentGuidanceEntry], b: readonly [string, AgentGuidanceEntry]): number =>
  a[1].at === b[1].at ? (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) : a[1].at > b[1].at ? -1 : 1;

/** The record with `key` set to `entry`; past the bound the oldest `at` goes first. */
export function withEntry(record: AgentGuidanceRecord, key: string, entry: AgentGuidanceEntry): AgentGuidanceRecord {
  const all = [...Object.entries(record.entries).filter(([k]) => k !== key), [key, entry] as const].sort(newestFirst);
  return { v: 1, entries: Object.fromEntries(all.slice(0, MAX_GUIDANCE_ENTRIES)) };
}

/**
 * Several answer rows' records → one: per key, the entry with the latest `at` wins. Two tabs that read the same prior
 * record and each press a different step write competing snapshots; merged, neither press is lost (CODEX_CLI_OVERFLOW
 * P1 on #2459). Pure.
 */
export function mergeAgentGuidance(records: readonly AgentGuidanceRecord[]): AgentGuidanceRecord {
  const merged = new Map<string, AgentGuidanceEntry>();
  for (const r of records) {
    for (const [k, e] of Object.entries(r.entries)) {
      const prior = merged.get(k);
      if (prior === undefined || e.at > prior.at) merged.set(k, e);
    }
  }
  const all = [...merged.entries()].sort(newestFirst);
  return { v: 1, entries: Object.fromEntries(all.slice(0, MAX_GUIDANCE_ENTRIES)) };
}
