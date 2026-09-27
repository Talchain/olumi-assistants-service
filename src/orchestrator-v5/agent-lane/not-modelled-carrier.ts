/**
 * ⭐ SLICE A7 — WHAT OF THE BRIEF DID NOT REACH THE MODEL, CARRIED FROM THE GRAPH READ ONTO THE AGENT TURN
 * (DL #70 5855437928; Canonical 5855435365).
 *
 * The graph read route (`assist.v1.scenario-graph.ts`) derives `not_modelled` from the very bytes it returns — a pure
 * function of (brief_text, graph). The Agent lane reads that route for its own state (`readGraph`) and for the
 * response (`readBackState`), and dropped the manifest both times. This module is the only place the lane touches it.
 *
 * ⛔ DERIVED AT READ — NEVER HERE, NEVER STORED. Nothing below computes a verdict or re-reads the brief: the turn
 * carries the read's own manifest exactly as it arrived, beside the `graph_hash` of that same read, and the Agent is
 * given a projection of it. A persisted copy would start lying the moment the graph moves.
 *
 * ⛔ ABSENCE STAYS ABSENCE. A read with no manifest (an older route, a failed read) yields `undefined` on both
 * surfaces — never an empty manifest, which would say "we looked and nothing was lost" about a scenario nobody looked at.
 */
import {
  NOT_MODELLED_SCHEMA,
  type NotModelledItem,
  type NotModelledManifest,
  type StatedKind,
} from '../../cee/context-integrity/not-modelled-manifest.js';

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The read's manifest, when it is one. Checked on exactly the fields the lane reads, so a payload that is not a
 * `not_modelled.v1` manifest is not carried at all rather than half-carried or thrown on.
 */
function isNotModelledManifest(v: unknown): v is NotModelledManifest {
  if (!isObject(v) || v.schema !== NOT_MODELLED_SCHEMA) return false;
  if (v.status !== 'derived' && v.status !== 'unavailable') return false;
  const q = v.quantities;
  if (q !== null && !(isObject(q) && Array.isArray(q.items))) return false;
  return isObject(v.stated_kinds) && Array.isArray(v.stated_kinds.unsourced) && Array.isArray(v.not_tracked);
}

export function notModelledOfRead(v: unknown): NotModelledManifest | undefined {
  return isNotModelledManifest(v) ? v : undefined;
}

/** The typed carrier on the turn wire (`_not_modelled`): the manifest exactly as read, bound to that read's graph_hash. */
export interface NotModelledTurnCarrier {
  /** The graph_hash of the SAME read the manifest came from — omitted when that read carried none. */
  readonly graph_hash?: string;
  readonly manifest: NotModelledManifest;
}

export function notModelledTurnCarrier(manifest: NotModelledManifest | undefined, graphHash: string | undefined): NotModelledTurnCarrier | undefined {
  if (manifest === undefined) return undefined;
  return { ...(graphHash !== undefined ? { graph_hash: graphHash } : {}), manifest };
}

/**
 * The compact projection the Agent is given: only what the model does NOT carry, and the manifest's own statement of
 * what it cannot see. `status` travels with it so an `unavailable` read is never read as "nothing is missing", and
 * `items` is omitted (not emptied) when the read could not look.
 */
export interface NotModelledContext {
  readonly status: NotModelledManifest['status'];
  readonly unavailable_reason?: NotModelledManifest['unavailable_reason'];
  /** The read's own items whose verdict is not `in_model`, verbatim and in the read's order. */
  readonly items?: readonly NotModelledItem[];
  /** Present only when the read reported truncation — the list above is then not the whole of it. */
  readonly truncated?: true;
  readonly stated_kinds: { readonly unsourced: readonly StatedKind[] };
  readonly not_tracked: readonly string[];
}

export function notModelledContext(m: NotModelledManifest): NotModelledContext {
  return {
    status: m.status,
    ...(m.status === 'unavailable' ? { unavailable_reason: m.unavailable_reason } : {}),
    ...(m.quantities !== null
      ? {
        items: m.quantities.items.filter((i) => i.verdict !== 'in_model'),
        ...(m.quantities.truncated === true ? { truncated: true as const } : {}),
      }
      : {}),
    stated_kinds: { unsourced: m.stated_kinds.unsourced },
    not_tracked: m.not_tracked,
  };
}
