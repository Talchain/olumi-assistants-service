import { entryKey, type GuidanceState, type PolicyId } from '../guidance/index.js';
import type { GuidanceRecord } from '../guidance/types.js';
import type { GuidanceWire } from './guidance-wire.js';

/** Events on the final answer, never copy, labels, raw item ids, or pre-dispatch coaching state. */
export interface AnswerGuidance {
  readonly version: 1;
  readonly entries: Readonly<Record<string, { readonly status: GuidanceRecord['status']; readonly state_key_hash: string }>>;
}
export const GUIDANCE_HISTORY_LIMIT = 20;
const KEY = /^(RC-WIDEN|RC-WHAT-CHANGES|RC-PREMORTEM|RC-COACH-EDITS|RC-STRENGTHEN-ITEM:[0-9a-f]{12})$/;
const HASH = /^[0-9a-f]{12}$/;
const STATUSES = new Set(['offered', 'pressed', 'completed', 'dismissed']);
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Closed, bounded metadata. Invalid is unreadable, never an empty history. */
export function parseAnswerGuidance(value: unknown): AnswerGuidance | null {
  if (!record(value) || Object.keys(value).length !== 2 || value.version !== 1 || !record(value.entries)) return null;
  const pairs = Object.entries(value.entries);
  if (pairs.length > 3) return null;
  for (const [key, item] of pairs) {
    if (!KEY.test(key) || !record(item) || Object.keys(item).length !== 2
      || typeof item.status !== 'string' || !STATUSES.has(item.status)
      || typeof item.state_key_hash !== 'string' || !HASH.test(item.state_key_hash)) return null;
  }
  return value as unknown as AnswerGuidance;
}

/** Newest first; the latest event for each existing selector key wins. No new cooldown policy. */
export function guidanceHistoryOf(values: readonly unknown[]): GuidanceState | null {
  const out: Record<string, GuidanceRecord> = {};
  for (const value of values.slice(0, GUIDANCE_HISTORY_LIMIT)) {
    const parsed = parseAnswerGuidance(value);
    if (parsed === null) return null;
    for (const [key, event] of Object.entries(parsed.entries)) if (!(key in out)) out[key] = event;
  }
  return out;
}

/** Only a method the route actually handled may settle an offer. Item presses name the actual held card's target. */
export interface HandledGuidancePress { readonly policy_id: PolicyId; readonly item?: string }
export function guidanceOnAnswer(wire: GuidanceWire | undefined, history: GuidanceState | null,
  press?: HandledGuidancePress): AnswerGuidance | undefined {
  const entries: Record<string, AnswerGuidance['entries'][string]> = {};
  for (const row of [wire?.slot1, wire?.slot2]) {
    if (row === undefined) continue;
    const key = entryKey(row.policy_id, row.policy_id === 'RC-STRENGTHEN-ITEM' ? row.item : undefined);
    if (KEY.test(key) && HASH.test(row.state_key_hash)) entries[key] = { status: 'offered', state_key_hash: row.state_key_hash };
  }
  if (press !== undefined && history !== null) {
    const key = entryKey(press.policy_id, press.policy_id === 'RC-STRENGTHEN-ITEM' ? press.item : undefined);
    const offered = history[key];
    if (offered?.status === 'offered' && typeof offered.state_key_hash === 'string' && HASH.test(offered.state_key_hash)) {
      entries[key] = { status: 'pressed', state_key_hash: offered.state_key_hash };
    }
  }
  return Object.keys(entries).length === 0 ? undefined : { version: 1, entries };
}
