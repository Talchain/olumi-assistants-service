import { createHash } from 'node:crypto';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { FRESH_READ } from '../turn-read-cache.js';
import type { InternalDispatch } from './agent-capabilities.js';
import type { ToolResult } from './agent-tools.js';

/** The same scenario and brief always identify the same construction operation. */
export function constructionOperationId(scenarioId: string, brief: string): string {
  const h = createHash('sha256').update(`agent_construction:${scenarioId}:${brief}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export interface ConstructionVersion {
  readonly version_id: string;
  readonly version_number: number;
  readonly mutation_id: string | null;
  readonly creation_kind: string;
  readonly source_turn_id: string;
}

/** Recover an already committed construction by its canonical turn identity. */
export async function findConstructionVersion(
  dispatch: InternalDispatch,
  scenarioId: string,
  brief: string,
): Promise<ConstructionVersion | null> {
  const turnId = registrationTurnId(scenarioId, constructionOperationId(scenarioId, brief));
  let cursor: string | undefined;
  // A construction is the first version; bound this history read to five pages.
  for (let page = 0; page < 5; page += 1) {
    const r = await dispatch(`/assist/v1/scenarios/${scenarioId}/versions`, {
      limit: 200,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (r.status !== 200) return null;
    const versions = Array.isArray(r.json.versions) ? (r.json.versions as Array<Record<string, unknown>>) : [];
    const hit = versions.find((v) => (v.creation as { source_turn_id?: unknown } | undefined)?.source_turn_id === turnId);
    if (hit !== undefined) {
      const creation = hit.creation as { kind?: unknown; mutation_id?: unknown; source_turn_id?: unknown };
      return {
        version_id: String(hit.version_id),
        version_number: Number(hit.sequence),
        mutation_id: typeof creation.mutation_id === 'string' ? creation.mutation_id : null,
        creation_kind: String(creation.kind),
        source_turn_id: String(creation.source_turn_id),
      };
    }
    cursor = typeof r.json.next_cursor === 'string' ? r.json.next_cursor : undefined;
    if (cursor === undefined) return null;
  }
  return null;
}

/**
 * The one graph validation and canonical registration door for every constructor.
 * It preserves the existing create-only CAS check and replay recovery. A success
 * is reported only after the registration route accepts the graph or the exact
 * operation's earlier version is recovered.
 */
export async function registerConstructedGraph(input: {
  scenarioId: string;
  brief: string;
  graph: unknown;
  dispatch: InternalDispatch;
}): Promise<ToolResult> {
  const { scenarioId, brief, graph, dispatch } = input;
  const parsed = GraphV3.safeParse(graph);
  if (!parsed.success) {
    return {
      ok: false, mutated: false, refusal: 'admitted_graph_invalid',
      issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')),
    };
  }
  if (parsed.data.nodes.length === 0) {
    return {
      ok: false, mutated: false, refusal: 'construction_empty',
      detail: 'The brief did not produce any source-grounded model entities. Nothing was saved; ask for the missing context and try again.',
    };
  }

  // The first read protects a user edit made while construction was running.
  // Registration's explicit-null CAS check closes the remaining read/write gap.
  const stillEmpty = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph`, { ...FRESH_READ });
  if (stillEmpty.status === 200) {
    const g = (stillEmpty.json.graph ?? {}) as { nodes?: unknown[] };
    if (Array.isArray(g.nodes) && g.nodes.length > 0) {
      return {
        ok: false, mutated: false, refusal: 'model_already_exists',
        detail: 'While that model was being built, something was added to this one — so nothing was written, and '
          + 'your own change is untouched. Ask me to propose a change to the model you now have.',
      };
    }
  }

  const reg = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph/register`, {
    graph,
    brief_text: brief,
    operation_id: constructionOperationId(scenarioId, brief),
    expected_graph_identity_hash: null,
  });
  const regCode = (reg.json.details as { code?: unknown } | undefined)?.code;
  if (reg.status === 409 && regCode === 'GRAPH_STALE') {
    const prior = await findConstructionVersion(dispatch, scenarioId, brief);
    if (prior !== null) return { ok: true, mutated: false, replayed: true, model_version: prior };
    return {
      ok: false, mutated: false, refusal: 'model_already_exists',
      detail: 'While that model was being built, something was added to this one — so nothing was written, and '
        + 'your own change is untouched. Ask me to propose a change to the model you now have.',
    };
  }
  if (reg.status === 409 && regCode === 'OPERATION_ID_REUSED') {
    const prior = await findConstructionVersion(dispatch, scenarioId, brief);
    if (prior !== null) return { ok: true, mutated: false, replayed: true, model_version: prior };
  }
  if (reg.status !== 200) {
    return {
      ok: false, mutated: false, refusal: 'registration_refused',
      http: reg.status, detail: String(reg.json.message ?? '').slice(0, 200),
    };
  }

  const modelVersion = (reg.json as { model_version?: unknown }).model_version;
  const replayed = (reg.json as { replayed?: unknown }).replayed === true;
  return {
    ok: true, mutated: true,
    ...(modelVersion === undefined ? {} : { model_version: modelVersion }),
    ...(replayed ? { replayed: true } : {}),
  };
}
