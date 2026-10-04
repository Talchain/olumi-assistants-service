/** Offline construction spike. Deliberately has no live-route consumer or flag. */
import { buildDraftRecordsSchema, type DraftRecordSet } from '../../../cee/draft/records/grammar.js';
import { DRAFT_RECORDS_INSTRUCTION } from '../../../cee/draft/records/instruction.js';
import { replayRecordSet } from '../../../cee/draft/records/replay.js';
import { projectGraphAndOptionsToV3 } from '../../../cee/transforms/schema-v3.js';
import type { V1Graph } from '../../../cee/transforms/schema-v2.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { budgetFor } from '../model-budgets.js';
import { FRESH_READ } from '../turn-read-cache.js';
import { constructionOperationId, strictForTheDrafter, findConstructionVersion, type CallStructuredModel } from './build-model.js';
import type { InternalDispatch } from './agent-capabilities.js';
import type { ToolResult } from './agent-tools.js';

type JsonSchema = Record<string, unknown>;
function object(value: unknown): value is JsonSchema {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** OpenAI STRICT requires every key; original optionality becomes explicit nullability. */
export function buildStrictDraftRecordsSchema(): JsonSchema {
  const nullable = (schema: JsonSchema): JsonSchema => {
    const out: JsonSchema = { ...schema };
    if (object(schema.properties)) {
      const required = Array.isArray(schema.required) ? schema.required : [];
      out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => {
        if (!object(value)) return [key, value];
        const child = nullable(value);
        return [key, required.includes(key) ? child : { anyOf: [child, { type: 'null' }] }];
      }));
      out.required = Object.keys(schema.properties);
    }
    if (object(schema.items)) out.items = nullable(schema.items);
    return out;
  };
  return strictForTheDrafter(nullable(buildDraftRecordsSchema()));
}

/** Null means omitted only for a key that the records grammar actually marks optional. */
export function omitOptionalRecordNulls(value: unknown, schema: JsonSchema = buildDraftRecordsSchema()): unknown {
  if (Array.isArray(value) && object(schema.items)) return value.map(item => omitOptionalRecordNulls(item, schema.items as JsonSchema));
  if (!object(value) || !object(schema.properties)) return value;
  const properties = schema.properties;
  const required = Array.isArray(schema.required) ? schema.required : [];
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    if (child === null && key in properties && !required.includes(key)) return [];
    const childSchema = properties[key];
    return [[key, object(childSchema) ? omitOptionalRecordNulls(child, childSchema) : child]];
  }));
}

export async function buildModelFromRecords(
  scenarioId: string,
  brief: string,
  dispatch: InternalDispatch,
  callStructured: CallStructuredModel,
): Promise<ToolResult> {
  const budget = budgetFor('gpt-5.6-terra', 'whole');
  let raw: unknown;
  try {
    const out = await callStructured({
      model: budget.model, instructions: DRAFT_RECORDS_INSTRUCTION, input: brief,
      max_output_tokens: budget.max_output_tokens, reasoning_effort: budget.reasoning_effort,
      schema: buildStrictDraftRecordsSchema(),
    });
    if (out.status === 'incomplete' || out.text.length === 0) return {
      ok: false, mutated: false, refusal: 'no_structured_output',
      ...(out.status === 'incomplete' ? { incomplete_reason: out.incomplete_reason ?? 'unspecified' } : {}),
    };
    raw = omitOptionalRecordNulls(JSON.parse(out.text));
  } catch (err) {
    return { ok: false, mutated: false, refusal: 'construction_failed', detail: String(err).slice(0, 200) };
  }
  // replayRecordSet owns the entire existing compile chain, including the seam's runtime validation.
  const compiled = await replayRecordSet(raw as DraftRecordSet, { brief });
  if (!compiled.ok) return { ok: false, mutated: false, refusal: 'construction_failed', detail: compiled.detail };
  const projected = projectGraphAndOptionsToV3(compiled.graph as V1Graph, { brief });
  const parsed = GraphV3.safeParse(projected.graph);
  if (!parsed.success) return { ok: false, mutated: false, refusal: 'construction_failed', detail: parsed.error.message };
  const graph = parsed.data;
  const stillEmpty = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph`, { ...FRESH_READ });
  const held = stillEmpty.json.graph;
  if (stillEmpty.status === 200 && object(held) && Array.isArray(held.nodes) && held.nodes.length > 0) {
    return { ok: false, mutated: false, refusal: 'model_already_exists' };
  }
  const reg = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph/register`, {
    graph, brief_text: brief, operation_id: constructionOperationId(scenarioId, brief), expected_graph_identity_hash: null,
  });
  const code = object(reg.json.details) ? reg.json.details.code : undefined;
  if (reg.status === 409 && (code === 'GRAPH_STALE' || code === 'OPERATION_ID_REUSED')) {
    const prior = await findConstructionVersion(dispatch, scenarioId, brief);
    if (prior !== null) return { ok: true, mutated: false, replayed: true, model_version: prior };
    if (code === 'GRAPH_STALE') return { ok: false, mutated: false, refusal: 'model_already_exists' };
  }
  if (reg.status !== 200) return { ok: false, mutated: false, refusal: 'registration_refused', http: reg.status };
  return {
    ok: true, mutated: reg.json.replayed !== true, ...(reg.json.replayed === true ? { replayed: true } : {}),
    ...(reg.json.model_version === undefined ? {} : { model_version: reg.json.model_version }),
    nodes: graph.nodes.length, edges: graph.edges.length, readiness: compiled.readiness,
  };
}
