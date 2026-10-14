import { isGuidanceVariant } from './guidance-history.js';
/**
 * ⭐ THE ONE ADAPTER from #2465's guidance signals to RC's selector leaf (`agent-lane/guidance`). Built by SCIENCE/DSK in
 * T3 (`method-turn.ts` @eb921dc1, seam (1) agreed AI HARNESS 5938348370) and LIFTED here unchanged for the T2 wiring
 * (DL 5939211254 → AI HARNESS lease 5940322790), so T2 and T3 share one adapter: T3 imports it from here at rebase.
 *
 * The same named signals, with the four fields whose wire form differs narrowed to the leaf's types: a null goal label
 * is ABSENT (the leaf's copy renderer reads it as text), a goal horizon keeps only its typed members, the persisted
 * guidance record keeps only content-free entries, and an explicit request is a policy id or nothing. The press's pick
 * becomes `user.selected_option_id`, and the Run's key `run.run_key` when the caller has one (RC-WHAT-CHANGES keys on
 * it). Pure.
 */
import { POLICY } from '../guidance/policy.js';
import type { GuidanceSignals as SelectorSignals, GuidanceState, PolicyId } from '../guidance/index.js';
import type { GuidanceRecord } from '../guidance/types.js';
import type { GuidanceSignals as TurnSignals } from './guidance-signals.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);

const POLICY_IDS: ReadonlySet<string> = new Set(POLICY.rows.map((r) => r.policy_id));
const RECORD_STATUSES: ReadonlySet<string> = new Set(['offered', 'pressed', 'completed', 'dismissed']);

function horizonOf(v: unknown): SelectorSignals['model.goal_horizon'] {
  if (v === null) return null;
  const r = rec(v);
  if (r === undefined) return undefined;
  return {
    ...(typeof r.deadline === 'string' ? { deadline: r.deadline } : {}),
    ...(typeof r.months === 'number' && Number.isFinite(r.months) ? { months: r.months } : {}),
  };
}

/** The persisted guidance record, content-free as on disk (`{status, state_key_hash, turn_id}`); anything else is dropped. */
function guidanceStateOf(entries: Readonly<Record<string, unknown>>): GuidanceState {
  const out: Record<string, GuidanceRecord> = {};
  for (const [key, value] of Object.entries(entries)) {
    const r = rec(value);
    if (r === undefined || typeof r.status !== 'string' || !RECORD_STATUSES.has(r.status)) continue;
    out[key] = {
      status: r.status as GuidanceRecord['status'],
      ...(typeof r.state_key_hash === 'string' ? { state_key_hash: r.state_key_hash } : {}),
      ...(typeof r.turn_id === 'string' ? { turn_id: r.turn_id } : {}),
      ...(isGuidanceVariant(key, r.variant_id) ? { variant_id: r.variant_id } : {}),
      ...(typeof r.slot === 'number' && Number.isInteger(r.slot) && r.slot >= 1 && r.slot <= 3 ? { slot: r.slot } : {}),
    };
  }
  return out;
}

export function selectorSignalsOf(s: TurnSignals, pick: string | null, runKey?: string): SelectorSignals {
  const {
    'model.goal_label': goalLabel,
    'model.goal_horizon': horizon,
    guidance,
    'user.explicit_request': asked,
    ...rest
  } = s;
  return {
    ...rest,
    ...(goalLabel !== null ? { 'model.goal_label': goalLabel } : {}),
    'model.goal_horizon': horizonOf(horizon),
    guidance: guidanceStateOf(guidance),
    'user.explicit_request': typeof asked === 'string' && POLICY_IDS.has(asked) ? (asked as PolicyId) : null,
    'user.selected_option_id': pick,
    ...(runKey !== undefined ? { 'run.run_key': runKey } : {}),
  };
}
