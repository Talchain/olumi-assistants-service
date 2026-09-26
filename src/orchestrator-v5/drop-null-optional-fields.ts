/**
 * THE PERSISTED BYTES MUST BE READABLE BY EVERY STRICT READER.
 *
 * THE DEFECT THIS CLOSES (served, CEE `319dde1`, 26 Sep 2026 01:42Z — Canvas
 * witness 5842091415). The UI clears a user-set factor's stamp by sending
 * `extractionType: null` (node-level AND inside `observed_state`) through
 * `POST /graph/register`. The register's ingress parse is lenient, so those
 * bytes were stored as-is. `GraphV3` declares both fields `.optional()` — a
 * `null` fails it — and every system-event adapter re-reads the persisted graph
 * through `GraphV3.safeParse` and FAILS CLOSED on a parse failure
 * (`persisted_graph_invalid` → 500 `system_event_commit_failed`). One register
 * therefore poisoned the scenario: every later canvas edit returned 500, and
 * readiness read "unknown".
 *
 * THE RULE. A key whose schema accepts ABSENCE but rejects `null` cannot hold
 * `null` in a graph any reader will accept, so `null` there can only mean
 * "no value" — which the contract spells as absence. Such keys are dropped.
 * Nothing is invented: a `null` on a REQUIRED key is left alone (the bytes stay
 * as invalid as they came), and no value is ever changed or added.
 *
 * THE FIELD SET IS DERIVED FROM THE SCHEMA, never hand-listed, so a field added
 * to `NodeV3` / `ObservedStateV3` / `EdgeV3` / `OptionV3` / `GraphV3` is covered
 * the day it lands.
 *
 * It runs LAST inside `projectGraphForPersistence`, the one definition of the
 * persisted form (after `normaliseOptionInterventionContract`, which gives
 * `interventions: null` its meaning, `{}`), so the register route and `commitDirectAnswer` (every other
 * graph writer) share it, and every hash is derived from the projected bytes.
 * A graph with nothing to drop is returned as the ORIGINAL reference.
 */
import type { ZodTypeAny } from 'zod';

import { EdgeV3, GraphV3, NodeV3, ObservedStateV3, OptionV3 } from '../schemas/cee-v3.js';
import { log } from '../utils/telemetry.js';

function nullDroppableKeys(shape: Record<string, ZodTypeAny>): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const [key, schema] of Object.entries(shape)) {
    if (schema.safeParse(undefined).success && !schema.safeParse(null).success) keys.add(key);
  }
  return keys;
}

const GRAPH_KEYS = nullDroppableKeys(GraphV3.shape);
const NODE_KEYS = nullDroppableKeys(NodeV3.shape);
const OBSERVED_STATE_KEYS = nullDroppableKeys(ObservedStateV3.shape);
const EDGE_KEYS = nullDroppableKeys(EdgeV3.shape);
const OPTION_KEYS = nullDroppableKeys(OptionV3.shape);

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Delete every `null` whose key is in `keys`; returns the dropped key names. */
function dropIn(obj: Rec, keys: ReadonlySet<string>): string[] {
  const dropped: string[] = [];
  for (const key of Object.keys(obj)) {
    if (obj[key] === null && keys.has(key)) {
      delete obj[key];
      dropped.push(key);
    }
  }
  return dropped;
}

function hasDroppable(graph: Rec): boolean {
  const any = (obj: unknown, keys: ReadonlySet<string>): boolean =>
    isRec(obj) && Object.keys(obj).some((k) => obj[k] === null && keys.has(k));
  if (any(graph, GRAPH_KEYS)) return true;
  for (const n of Array.isArray(graph.nodes) ? graph.nodes : []) {
    if (any(n, NODE_KEYS) || (isRec(n) && any(n.observed_state, OBSERVED_STATE_KEYS))) return true;
  }
  for (const e of Array.isArray(graph.edges) ? graph.edges : []) if (any(e, EDGE_KEYS)) return true;
  for (const o of Array.isArray(graph.options) ? graph.options : []) if (any(o, OPTION_KEYS)) return true;
  return false;
}

export interface DropNullOptionalContext {
  readonly scenarioId?: string;
  readonly turnId?: string;
  readonly source?: string;
}

/**
 * Return the graph with every schema-optional `null` removed: a CLONE when
 * anything was dropped, otherwise the original reference. Fail-open — a clone
 * failure returns the input unchanged (unreachable for DB-JSON graphs).
 */
export function dropNullOptionalGraphFields<T>(graph: T, ctx: DropNullOptionalContext = {}): T {
  if (!isRec(graph) || !hasDroppable(graph)) return graph;
  let clone: Rec;
  try {
    clone = JSON.parse(JSON.stringify(graph)) as Rec;
  } catch {
    return graph;
  }
  const dropped: Array<{ at: string; keys: string[] }> = [];
  const note = (at: string, keys: string[]) => {
    if (keys.length > 0) dropped.push({ at, keys });
  };
  note('graph', dropIn(clone, GRAPH_KEYS));
  for (const n of Array.isArray(clone.nodes) ? clone.nodes : []) {
    if (!isRec(n)) continue;
    const id = typeof n.id === 'string' ? n.id : '?';
    note(`node:${id}`, dropIn(n, NODE_KEYS));
    if (isRec(n.observed_state)) note(`node:${id}.observed_state`, dropIn(n.observed_state, OBSERVED_STATE_KEYS));
  }
  for (const e of Array.isArray(clone.edges) ? clone.edges : []) {
    if (!isRec(e)) continue;
    note(`edge:${String(e.from)}->${String(e.to)}`, dropIn(e, EDGE_KEYS));
  }
  for (const o of Array.isArray(clone.options) ? clone.options : []) {
    if (!isRec(o)) continue;
    note(`option:${typeof o.id === 'string' ? o.id : '?'}`, dropIn(o, OPTION_KEYS));
  }
  try {
    // Redacted: ids and key names only — never values.
    log.info(
      {
        event: 'v5.graph_persist.null_optional_dropped',
        scenario_id: ctx.scenarioId,
        turn_id: ctx.turnId,
        ...(ctx.source !== undefined ? { source: ctx.source } : {}),
        dropped,
      },
      '[persist] dropped null on schema-optional graph fields so every strict reader can read the stored bytes',
    );
  } catch {
    // observability must never undo the repair
  }
  return clone as T;
}
