/**
 * Agent lane — the `get_canonical_state` capability.
 *
 * The Agent calls this before saying anything about what the model contains. It
 * reads Olumi's PERSISTED state and returns it in the rich vocabulary, so the
 * Agent never has to infer meaning from an analysis-shaped graph.
 *
 * ⭐ AUTHORITY IS CHECKED HERE, ON EVERY CALL, AGAINST THE REQUEST'S OWN
 * AUTHENTICATED SUBJECT — not against anything the Agent or the client supplied.
 * The `agent_session_id` is a correlation token and is verified, never trusted
 * (see `session-binding.ts`). A caller that cannot be matched to the scenario's
 * owner gets `not_found`, which is deliberately indistinguishable from a
 * scenario that does not exist: the estate's existing scenario routes answer the
 * same way, and telling an unauthorised caller that a scenario exists is itself a
 * disclosure.
 *
 * ⭐ WHAT IT DELIBERATELY DOES NOT DO: it never reports an absent value as a
 * number. An unknown baseline is returned as `{ kind: 'unknown' }`, because the
 * whole reason the Agent is asked to call this is so it stops guessing.
 */

import type { Magnitude } from '../rich-model.js';
import type { SessionBindingRegistry } from '../session-binding.js';

export interface PersistedScenarioRead {
  /** `null` when the scenario is unowned (a guest scenario). */
  readonly user_id: string | null;
  readonly graph: unknown;
  readonly brief_text: string | null;
  readonly graph_identity_hash: string | null;
}

export interface CanonicalStateDeps {
  /** Reuses the existing store read; `undefined` when no such scenario exists. */
  readScenario(scenario_id: string): Promise<PersistedScenarioRead | undefined>;
  /** Reuses the existing pure analysis read. Optional so a caller may omit it. */
  readAnalysis?(scenario_id: string): Promise<unknown>;
  readonly sessions: SessionBindingRegistry;
}

export interface CanonicalStateRequest {
  readonly scenario_id: string;
  readonly agent_session_id: string;
  /** Resolved by CEE from the request's verified identity. NEVER from the body. */
  readonly authenticated_user_id: string | null;
}

export interface CanonicalEntityView {
  /** Stable canonical identity. The Agent must not have to infer ids from labels. */
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  /** User-facing magnitude: raw value when one is stored, otherwise the model value. */
  readonly baseline: Magnitude;
  /** Backwards-compatible alias for the analytical model value. */
  readonly value: number | null;
  /** The value used by the analytical model, which may be normalised. */
  readonly model_value: number | null;
  /** The original user-facing magnitude when the persisted graph carries one. */
  readonly raw_value: number | null;
  readonly unit: string | null;
  /** Declared frame used to interpret a normalised model value. */
  readonly cap: number | null;
  readonly declared_scale: string | null;
  /** Provenance of the value itself, distinct from who introduced the entity. */
  readonly value_source: string;
  readonly authored_by: string;
}

export type CanonicalStateResult =
  | {
      readonly ok: true;
      readonly scenario_id: string;
      readonly graph_identity_hash: string | null;
      readonly brief: string | null;
      readonly entities: readonly CanonicalEntityView[];
      readonly analysis: unknown;
      /** Present only when the model is empty, so the Agent says so plainly. */
      readonly empty: boolean;
    }
  | { readonly ok: false; readonly refusal: 'not_found'; readonly detail: string };

const NOT_FOUND = {
  ok: false as const,
  refusal: 'not_found' as const,
  detail:
    'No readable decision model for that scenario. This is the same answer for a scenario that ' +
    'does not exist and one you cannot read, deliberately.',
};

/** An observed value is only a number when the stored graph actually carries one. */
function observedStateOf(node: Record<string, unknown>): Record<string, unknown> {
  const observed = node.observed_state;
  return observed !== null && typeof observed === 'object'
    ? observed as Record<string, unknown>
    : {};
}

function finiteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function baselineOf(node: Record<string, unknown>): Magnitude {
  const observed = observedStateOf(node);
  const value = finiteNumber(observed.raw_value) ?? finiteNumber(observed.value);
  if (value !== null) {
    const unit = observed.unit;
    return typeof unit === 'string'
      ? { kind: 'point', value, unit }
      : { kind: 'point', value };
  }
  return { kind: 'unknown' };
}

function authorshipOf(node: Record<string, unknown>): string {
  const p = node.provenance;
  if (typeof p === 'string') return p;
  if (p !== null && typeof p === 'object') {
    const source = (p as Record<string, unknown>).source;
    if (typeof source === 'string') return source;
  }
  // ⚠ Absence is NOT neutral and must not be read as "the user said it". The
  // shared contract is explicit that a consumer must not read absence as any
  // value, so it is reported as unattested.
  return 'unattested';
}

export function canonicalEntityViewOf(node: Record<string, unknown>): CanonicalEntityView {
  const observed = observedStateOf(node);
  return {
    id: typeof node.id === 'string' ? node.id : '',
    label: typeof node.label === 'string' ? node.label : String(node.id ?? ''),
    kind: typeof node.kind === 'string' ? node.kind : 'unknown',
    baseline: baselineOf(node),
    value: finiteNumber(observed.value),
    model_value: finiteNumber(observed.value),
    raw_value: finiteNumber(observed.raw_value),
    unit: typeof observed.unit === 'string' ? observed.unit : null,
    cap: finiteNumber(observed.cap) ?? finiteNumber(node.cap),
    declared_scale:
      typeof observed.declared_scale === 'string'
        ? observed.declared_scale
        : (typeof node.declared_scale === 'string' ? node.declared_scale : null),
    value_source: typeof observed.source === 'string' ? observed.source : 'unattested',
    authored_by: authorshipOf(node),
  };
}

export async function getCanonicalState(
  req: CanonicalStateRequest,
  deps: CanonicalStateDeps,
): Promise<CanonicalStateResult> {
  // 1. The session must already be bound to THIS user and THIS scenario.
  const refusal = deps.sessions.check(
    req.agent_session_id,
    req.authenticated_user_id,
    req.scenario_id,
  );
  if (refusal !== null) return NOT_FOUND;

  // 2. The scenario must exist and be readable by this subject.
  const scenario = await deps.readScenario(req.scenario_id);
  if (scenario === undefined) return NOT_FOUND;
  if (scenario.user_id !== req.authenticated_user_id) return NOT_FOUND;

  // 3. Read the persisted state. An absent graph is reported as empty, never
  //    as a model with no factors — those are different statements.
  const graph = scenario.graph;
  const nodes =
    graph !== null && typeof graph === 'object' && Array.isArray((graph as Record<string, unknown>).nodes)
      ? ((graph as Record<string, unknown>).nodes as Record<string, unknown>[])
      : [];

  const entities: CanonicalEntityView[] = nodes.map(canonicalEntityViewOf);

  const analysis = deps.readAnalysis === undefined ? null : await deps.readAnalysis(req.scenario_id);

  return {
    ok: true,
    scenario_id: req.scenario_id,
    graph_identity_hash: scenario.graph_identity_hash,
    brief: scenario.brief_text,
    entities,
    analysis,
    empty: nodes.length === 0,
  };
}
