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
}

export interface AgentGuidanceRecord {
  readonly v: 1;
  /** Keyed by {@link guidanceKey}. Insertion order = recency (oldest first); bounded by {@link MAX_GUIDANCE_ENTRIES}. */
  readonly entries: Readonly<Record<string, AgentGuidanceEntry>>;
}

export interface AgentGuidanceSnapshot {
  readonly snapshot_timing: typeof AGENT_GUIDANCE_SNAPSHOT_TIMING;
  readonly agent_guidance: AgentGuidanceRecord;
}

export const EMPTY_AGENT_GUIDANCE: AgentGuidanceRecord = Object.freeze({ v: 1 as const, entries: Object.freeze({}) });

/** 5 contract rows plus per-item Strengthen entries: far below this; the oldest go first. */
export const MAX_GUIDANCE_ENTRIES = 32;

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
      const e = v as { status?: unknown; state_key_hash?: unknown; turn_id?: unknown } | null;
      if (!KEY.test(k) || e === null || typeof e !== 'object') continue;
      if (typeof e.status !== 'string' || !STATUSES.has(e.status)) continue;
      if (typeof e.state_key_hash !== 'string' || !HASH.test(e.state_key_hash)) continue;
      out[k] = { status: e.status as AgentGuidanceStatus, state_key_hash: e.state_key_hash, turn_id: typeof e.turn_id === 'string' ? e.turn_id : null };
    }
    return { v: 1, entries: out };
  } catch {
    return EMPTY_AGENT_GUIDANCE;
  }
}

/** The record with `key` set to `entry`, moved to the newest position, oldest entries dropped past the bound. */
export function withEntry(record: AgentGuidanceRecord, key: string, entry: AgentGuidanceEntry): AgentGuidanceRecord {
  const rest = Object.entries(record.entries).filter(([k]) => k !== key);
  const all = [...rest, [key, entry] as const];
  return { v: 1, entries: Object.fromEntries(all.slice(Math.max(0, all.length - MAX_GUIDANCE_ENTRIES))) };
}
