/** Agent construction: one records extraction, deterministic compile, canonical registration. */
import { buildVNextDraftRecordsSchema, DRAFT_RECORD_REQUIRED_LINKS, DRAFT_RECORD_STATED_KINDS, DRAFT_RECORD_UNRESOLVED, type DraftRecordSet } from '../../../cee/draft/records/grammar.js';
import { V_NEXT_DRAFT_RECORDS_INSTRUCTION } from '../../../cee/draft/records/instruction-vnext.js';
import { reconcileStatedDispositions } from '../../../cee/draft/records/stated-dispositions.js';
import { replayRecordSet } from '../../../cee/draft/records/replay.js';
import type { RecordConstraintCandidate } from '../../../cee/draft/records/projector.js';
import { runCompoundGoals } from '../../../cee/unified-pipeline/stages/repair/compound-goals.js';
import { sameRecordConstraintEvidence, type RecordConstraintDisposition } from '../../../cee/compound-goal/record-constraint-carrier.js';
import { projectGraphAndOptionsToV3, transformGraphToV3 } from '../../../cee/transforms/schema-v3.js';
import type { V1Graph } from '../../../cee/transforms/schema-v2.js';
import type { GoalConstraintT } from '../../../schemas/assist.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { CompileStageEvent, CompileStageName } from '../../../cee/unified-pipeline/types.js';
import { PROPOSED_BY_OLUMI } from '../olumi-option-marker.js';
import { assessConstructionSize } from '../construction-size-gate.js';
import { goalScopeLoss, unstatedGoalScope, type InferenceClass } from '../admit-model.js';
import { structuralFactorCategories } from '../../../validators/graph-validator.js';
import { budgetFor } from '../model-budgets.js';
import { FRESH_READ } from '../turn-read-cache.js';
import { clampForPersist, refitFramesForStatedEffects } from '../refit-frames.js';
import { holdStatedGoalAttributes } from '../stated-by-user.js';
import { constructionOperationId, deadlineOpenQuestion, goalScopePendingAction, strictForTheDrafter, findConstructionVersion, type CallStructuredModel, type ConstructionTrace } from './build-model.js';
import type { InternalDispatch } from './agent-capabilities.js';
import type { ToolResult } from './agent-tools.js';

type JsonSchema = Record<string, unknown>;
function object(value: unknown): value is JsonSchema {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The typed escape a required link takes (fix (a)): a one-member enum, the only keyword family this grammar already sends. */
const UNRESOLVED_LINK: JsonSchema = { type: 'string', enum: [DRAFT_RECORD_UNRESOLVED] };

/**
 * OpenAI STRICT requires every key; original optionality becomes explicit nullability.
 *
 * ⭐ FIX (a): A REQUIRED LINK IS NEVER NULL ON ITS OWNING KIND. `stated_items[]` is one variant per owning kind
 * (`DRAFT_RECORD_REQUIRED_LINKS`: goal, figure, cause) plus one for every other kind, each the SAME nullable item with
 * its `kind` enum narrowed. On an owning variant each owned link is required and non-null: an enum link widens its own
 * enum with `"unresolved"` (`direction`), any other type takes `anyOf [the real type, "unresolved"]`. Every other
 * field, and every field on the other kinds, is byte-for-byte the nullable shape it was. Built from the unchanged
 * `buildVNextDraftRecordsSchema()`, so `omitOptionalRecordNulls` and the seam guard read the same base grammar.
 */
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
  const strict = nullable(buildVNextDraftRecordsSchema());
  const statedItems = (strict.properties as Record<string, JsonSchema>).stated_items!;
  const item = statedItems.items as JsonSchema;
  const properties = item.properties as Record<string, JsonSchema>;
  const linked = (key: string): JsonSchema => {
    const real = (properties[key]!.anyOf as JsonSchema[]).find((branch) => branch.type !== 'null')!;
    return Array.isArray(real.enum) ? { ...real, enum: [...real.enum, DRAFT_RECORD_UNRESOLVED] } : { anyOf: [real, UNRESOLVED_LINK] };
  };
  const variant = (kinds: readonly string[], links: readonly string[]): JsonSchema => ({
    ...item,
    properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => [key,
      key === 'kind' ? { ...value, enum: [...kinds] } : links.includes(key) ? linked(key) : value])),
  });
  const owners = Object.keys(DRAFT_RECORD_REQUIRED_LINKS);
  statedItems.items = { anyOf: [
    ...Object.entries(DRAFT_RECORD_REQUIRED_LINKS).map(([kind, links]) => variant([kind], links)),
    variant(DRAFT_RECORD_STATED_KINDS.filter((kind) => !owners.includes(kind)), []),
  ] };
  return strictForTheDrafter(strict);
}

/** Null means omitted only for a key that the records grammar actually marks optional. */
export function omitOptionalRecordNulls(value: unknown, schema: JsonSchema = buildVNextDraftRecordsSchema()): unknown {
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

/** A records constraint the existing authority did not carry, by its own stated index and typed reason. */
export interface RecordConstraintNotCarried {
  readonly stated_index: number;
  readonly reason: RecordConstraintDisposition['reason'] | 'record_constraint_target_absent_after_projection';
}

/**
 * ⭐ P2-P1: THE USER'S STATED LIMITS PERSIST WITH THE MODEL. The projector keeps origin-bearing declarations
 * (`constraintCandidates`) apart from the graph, and `replayRecordSet` compiles only the graph, so a records build
 * registered no limit (carried 0 of 1). They are joined HERE, at the build's own join, through the EXISTING
 * compound-goals authority (`runCompoundGoals`, the repair stage the drafting pipeline runs) — the one place that
 * compiles a record declaration's value and frame from the brief. Raw `projection.goalConstraints` are never passed:
 * they carry no attested frame.
 *   · ONLY rows the authority ADMITTED FROM A RECORD are carried (its own disposition, matched by its own evidence
 *     predicate). Its other producers (the regex extractor's label-matched remap, a construction-verdict mint) bind by
 *     label, the identity the records path never inherits — so a limit the records did not locate is not carried.
 *   · The authority runs on a COPY; the compiled graph itself is projected unchanged (no label-bound baseline relay).
 */
export function joinRecordConstraints(
  compiledGraph: unknown,
  candidates: readonly RecordConstraintCandidate[],
  brief: string,
): { graph: V1Graph; constraints: GoalConstraintT[]; notCarried: RecordConstraintNotCarried[] } {
  const graph = compiledGraph as V1Graph;
  if (candidates.length === 0) return { graph, constraints: [], notCarried: [] };
  // The same minimal-context convention `replayRecordSet` uses for the repair substeps it runs (`ctx as any`).
  const ctx: Record<string, unknown> = {
    graph: structuredClone(compiledGraph), effectiveBrief: brief, requestId: 'records-construction',
    recordConstraintCandidates: candidates,
  };
  runCompoundGoals(ctx as any);
  const binding = Array.isArray(ctx.goalConstraints) ? (ctx.goalConstraints as GoalConstraintT[]) : [];
  const dispositions = Array.isArray(ctx.recordConstraintDispositions)
    ? (ctx.recordConstraintDispositions as RecordConstraintDisposition[]) : [];
  const admitted = dispositions.filter((d) => d.reason === 'record_constraint_admitted' && d.canonical_constraint !== undefined);
  const constraints = binding.filter((row) => admitted.some((d) => d.canonical_constraint!.node_id === row.node_id
    && sameRecordConstraintEvidence(d.canonical_constraint!, row)));
  const notCarried = dispositions
    .filter((d) => d.reason !== 'record_constraint_admitted')
    .map((d) => ({ stated_index: d.candidate.stated_index, reason: d.reason }));
  return { graph, constraints, notCarried };
}

/**
 * The compiled constraints name V1 node ids; the registered graph is in V3 ids (`projectedIdsOf`). A constraint whose
 * target is not in the final graph is said, never dropped silently.
 */
function bindConstraintsToProjectedIds(
  idOf: ReadonlyMap<string, string>, projectedNodeIds: ReadonlySet<string>, compiled: { constraints: GoalConstraintT[]; notCarried: RecordConstraintNotCarried[] },
  candidates: readonly RecordConstraintCandidate[],
): { constraints: GoalConstraintT[]; notCarried: RecordConstraintNotCarried[] } {
  const constraints: GoalConstraintT[] = [];
  const notCarried = [...compiled.notCarried];
  for (const row of compiled.constraints) {
    const id = idOf.get(row.node_id) ?? row.node_id;
    if (projectedNodeIds.has(id)) { constraints.push({ ...row, node_id: id }); continue; }
    const owner = candidates.find((c) => c.constraint.node_id === row.node_id);
    if (owner !== undefined) notCarried.push({ stated_index: owner.stated_index, reason: 'record_constraint_target_absent_after_projection' });
  }
  return { constraints, notCarried };
}

/**
 * The projected (V3) id of every compiled (V1) node. `transformGraphToV3` is the id authority
 * `projectGraphAndOptionsToV3` itself calls, index-aligned with its input, so the map is read from it — never guessed
 * from labels.
 */
function projectedIdsOf(v1: V1Graph): Map<string, string> {
  const v3Nodes = transformGraphToV3(structuredClone(v1)).graph.nodes as Array<{ id: string }>;
  return new Map(v1.nodes.map((node, index) => [node.id, v3Nodes[index]?.id ?? node.id]));
}

/** The compiled node's own typed origin (`RecordProvenance.provenance_class`), keyed by its projected id. */
function recordOriginsOf(v1: V1Graph, idOf: ReadonlyMap<string, string>): Map<string, { cls: unknown; unbased: boolean }> {
  return new Map(v1.nodes.map((node) => {
    const provenance = (node as { provenance?: { provenance_class?: unknown; unbased?: unknown } }).provenance;
    return [idOf.get(node.id) ?? node.id, { cls: provenance?.provenance_class, unbased: provenance?.unbased === true }];
  }));
}

/**
 * ⭐ P2-P2: AN OPTION OLUMI ADDED SAYS SO (`proposed_by: 'olumi'`). The licence, the Run's option filter, the analysis
 * hash and the UI all exclude an unapproved suggestion by this mark (`olumi-option-filter.ts`, `option-status-edit.ts:140`,
 * `graph-identity.ts:120`; UI `analysisParticipation.ts:164`), so without it an option the user never named competes
 * as theirs. Read from the record's OWN typed origin — an option minted from an `option_refinement` CLAIM is
 * `ai_inferred`; one minted from a stated item is `stated` — never from a label. The legacy marker's other rules hold:
 * never a baseline (`is_baseline`), and only an option that sets a level (an inert option is not compared anyway).
 */
export function markRecordsOlumiOptions<N extends { readonly id: string; readonly kind?: unknown; readonly is_baseline?: unknown; readonly interventions?: unknown }>(
  nodes: readonly N[], origins: ReadonlyMap<string, { cls: unknown }>,
): N[] {
  const setsALevel = (n: N): boolean => n.interventions !== null && typeof n.interventions === 'object'
    && Object.values(n.interventions as Record<string, unknown>).some((v) =>
      v !== null && typeof v === 'object' && Number.isFinite(Number((v as { value?: unknown }).value)));
  return nodes.map((n) => (n.kind === 'option' && origins.get(n.id)?.cls === 'ai_inferred' && n.is_baseline !== true && setsALevel(n)
    ? { ...n, proposed_by: PROPOSED_BY_OLUMI } : n));
}

/**
 * The size gate's inference class (`admit-model.ts` InferenceClass), from the record's own typed origin: a stated item is
 * the user's (`brief_stated`), a claim built on stated items is the builder's (`builder_inferred`), an unbased claim is
 * Olumi's own addition (`model_proposed`, the honest shed target), and projector scaffolding is the builder's.
 */
function inferenceClassesOf(origins: ReadonlyMap<string, { cls: unknown; unbased: boolean }>): Record<string, InferenceClass> {
  const out: Record<string, InferenceClass> = {};
  for (const [id, origin] of origins) {
    if (origin.cls === 'stated') out[id] = 'brief_stated';
    else if (origin.cls === 'ai_inferred') out[id] = origin.unbased ? 'model_proposed' : 'builder_inferred';
    else if (origin.cls === 'projector_structural') out[id] = 'builder_inferred';
  }
  return out;
}

/**
 * ⭐ PORT 1 (DL WIRING PORTS 3): THE DEADLINE QUESTION, by CALLING its one producer (`deadlineOpenQuestion`,
 * `build-model.ts`) on the SAME brief-side verdict the legacy constructor uses (`holdStatedGoalAttributes`), never a
 * second writer. Its inputs are read from what this build registers: the goal's held `goal_horizon_months`, the metric
 * the goal measures (the quantity it names: the node sharing its `quantity_ref`, by its registered label; the goal's own
 * label when none does), and whether the goal holds the deadline's own words (`goal_deadline_as_stated`; nothing on the
 * records path writes it, so the question never claims the model keeps them). One goal, as legacy's `held` requires.
 */
/**
 * ⭐ PORT 3 (DL WIRING PORTS 2+3; Science: reuse the legacy authority exactly, refit THEN clamp): A USER'S STATED SIZE THE
 * FRAMES CANNOT HOLD is fitted by widening its target (`refitFramesForStatedEffects`), else stored at ±1 with its full β
 * marked (`clampForPersist`, `provenance.clamped_from`; `natural_effect` byte-exact), BEFORE the V3 boundary, so the
 * boundary sees ±1 plus a consistent marker and keeps the bundle (`schema-v3.ts`). The same two calls as the legacy
 * constructor (`build-model.ts`); never a second clamp. A small local adapter gives them the {strength:{mean,std}} view of
 * the V1 edges (and an option's `data.interventions` as `interventions`, for the refit's set-by-option guard). The refit
 * sees the whole graph, as legacy's does; the clamp is applied to the user-stated edges only. Nothing cut: unchanged.
 */
function fitStatedEffects(v1: V1Graph, constraints: readonly GoalConstraintT[]): V1Graph {
  type ViewNode = V1Graph['nodes'][number] & { interventions?: unknown };
  type ViewEdge = Omit<V1Graph['edges'][number], 'strength_mean' | 'strength_std'> & { strength: { mean?: number; std?: number } };
  const userStated = (edge: { provenance?: unknown }): boolean =>
    (edge.provenance as { magnitude?: unknown } | undefined)?.magnitude === 'user_stated';
  const borrowed = new Set<string>();
  const view = {
    nodes: v1.nodes.map((node): ViewNode => {
      const interventions = (node as { data?: { interventions?: unknown } }).data?.interventions;
      if (node.kind !== 'option' || interventions === undefined || 'interventions' in node) return node;
      borrowed.add(node.id);
      return { ...node, interventions };
    }),
    edges: v1.edges.map(({ strength_mean, strength_std, ...edge }): ViewEdge => ({ ...edge, strength: { mean: strength_mean, std: strength_std } })),
    ...(constraints.length > 0 ? { goal_constraints: constraints } : {}),
  };
  const refit = refitFramesForStatedEffects(view);
  const fitted: { nodes: ViewNode[]; edges: ViewEdge[] } = { nodes: refit.graph.nodes as ViewNode[], edges: refit.graph.edges as ViewEdge[] };
  const statedEdges = fitted.edges.filter(userStated);
  const clamped = clampForPersist({ nodes: fitted.nodes, edges: statedEdges });
  if (refit.refits.length === 0 && clamped.edges === statedEdges) return v1;
  let next = 0;
  return {
    ...v1,
    nodes: fitted.nodes.map((node) => {
      if (!borrowed.has(node.id)) return node;
      const { interventions: _borrowed, ...own } = node;
      return own as V1Graph['nodes'][number];
    }),
    edges: fitted.edges.map((edge) => {
      const { strength, ...own } = userStated(edge) ? clamped.edges[next++]! : edge;
      return { ...own, ...(strength.mean !== undefined ? { strength_mean: strength.mean } : {}),
        ...(strength.std !== undefined ? { strength_std: strength.std } : {}) } as V1Graph['edges'][number];
    }),
  };
}

type RegisteredNode = { readonly id: string; readonly kind?: unknown; readonly label?: unknown; readonly goal_horizon_months?: unknown; readonly goal_deadline_as_stated?: unknown };

/**
 * The ONE goal this build registers and the metric it measures (the quantity it names: the node sharing its
 * `quantity_ref`, by its registered label; the goal's own label when none does): legacy's `candidate.goal.metric`.
 * Undefined unless exactly one goal, as legacy's `held` requires.
 */
function recordsGoalAndMetric(v1: V1Graph, idOf: ReadonlyMap<string, string>, graph: { readonly nodes: readonly unknown[] }): { goal: RegisteredNode; metric: unknown; compiledGoal: V1Graph['nodes'][number] | undefined } | undefined {
  const nodes = graph.nodes as ReadonlyArray<RegisteredNode>;
  const goals = nodes.filter((node) => node.kind === 'goal');
  if (goals.length !== 1) return undefined;
  const goal = goals[0]!;
  const compiledGoal = v1.nodes.find((node) => (idOf.get(node.id) ?? node.id) === goal.id);
  const ref = (compiledGoal as { quantity_ref?: unknown } | undefined)?.quantity_ref;
  const measured = ref === undefined ? undefined : v1.nodes.find((node) => node.kind !== 'goal' && node.kind !== 'option' && node.kind !== 'decision'
    && (node as { quantity_ref?: unknown }).quantity_ref === ref);
  const metric = measured === undefined ? goal.label : nodes.find((node) => node.id === (idOf.get(measured.id) ?? measured.id))?.label ?? goal.label;
  return { goal, metric, compiledGoal };
}

function recordsDeadlineQuestion(v1: V1Graph, idOf: ReadonlyMap<string, string>, graph: { readonly nodes: readonly unknown[] }, brief: string): string | undefined {
  const held = recordsGoalAndMetric(v1, idOf, graph);
  if (held === undefined) return undefined;
  const { goal, metric } = held;
  const statedGoal = holdStatedGoalAttributes(graph.nodes as ReadonlyArray<RegisteredNode>, { horizon_months: goal.goal_horizon_months }, brief);
  return deadlineOpenQuestion(statedGoal, metric, goal.goal_horizon_months, typeof goal.goal_deadline_as_stated === 'string');
}

/**
 * ⭐ PORT 2 (DL WIRING PORTS 2+3, C46): THE GOAL'S UNSTATED SCOPE, by CALLING its producers, never a second detector.
 * The drafter's declaration is the goal stated item's `scope` (v-next grammar), bound to the registered goal by the
 * item's own verbatim quote (the goal node's `provenance.source_quote`). It is compiled to the `{ metric, scope }` shape
 * legacy feeds `unstatedGoalScope`; the question and the served action are `goalScopeLoss` and `goalScopePendingAction`.
 * No declaration, a scope the brief stated, or a metric that already names it: no question, no action.
 */
function recordsGoalScope(scenarioId: string, records: DraftRecordSet, v1: V1Graph, idOf: ReadonlyMap<string, string>, graph: { readonly nodes: readonly unknown[] }): { question?: string; pending: ReturnType<typeof goalScopePendingAction> } {
  const held = recordsGoalAndMetric(v1, idOf, graph);
  const quote = (held?.compiledGoal as { provenance?: { source_quote?: unknown } } | undefined)?.provenance?.source_quote;
  if (held === undefined || typeof quote !== 'string') return { pending: {} };
  const declared = records.stated_items.filter((item) => item.kind === 'goal' && item.source_quote === quote && item.scope !== undefined);
  if (declared.length !== 1) return { pending: {} };
  const goal = { metric: String(held.metric ?? ''), scope: declared[0]!.scope! };
  const scope = unstatedGoalScope(goal);
  if (scope === null) return { pending: {} };
  const loss = [goalScopeLoss(goal.metric, held.goal.id, scope)];
  return { question: loss[0]!.reason, pending: goalScopePendingAction(scenarioId, held.goal.id, goal.metric, goal.scope, loss) };
}

export async function buildModelFromRecords(
  scenarioId: string,
  brief: string,
  dispatch: InternalDispatch,
  callStructured: CallStructuredModel,
  observeConstruction?: (trace: ConstructionTrace) => void,
  /** A8a: one typed event per compile stage, in order (see `CompileStageEvent`). An observer never costs the build. */
  observeStage?: (event: CompileStageEvent) => void,
): Promise<ToolResult> {
  // Records construction never makes a generative repair call. Observers cannot cost the build.
  try { observeConstruction?.({ retried: false }); } catch { /* diagnostic only */ }
  const stage = (event: CompileStageEvent): void => { try { observeStage?.(event); } catch { /* diagnostic only */ } };
  /** A refusal at a stage: that stage, failed, typed — and nothing after it. */
  const refuse = (at: CompileStageName, result: ToolResult & { refusal: string }, reason?: string): ToolResult => {
    stage({ stage: at, status: 'failed', refusal: result.refusal, ...(reason !== undefined ? { reason } : {}) });
    return result;
  };
  const budget = budgetFor('gpt-5.6-terra', 'whole');
  let raw: unknown;
  try {
    const out = await callStructured({
      model: budget.model, instructions: V_NEXT_DRAFT_RECORDS_INSTRUCTION, input: brief,
      max_output_tokens: budget.max_output_tokens, reasoning_effort: budget.reasoning_effort,
      schema: buildStrictDraftRecordsSchema(),
    });
    // No usable answer: nothing reached the seam, so the parse stage is where it failed.
    if (out.text.length === 0) return refuse('parsed', {
      ok: false, mutated: false, refusal: 'no_structured_output',
      ...(out.status === 'incomplete' ? { incomplete_reason: out.incomplete_reason ?? 'unspecified', detail: `incomplete: ${out.incomplete_reason ?? 'unspecified'}` } : {}),
    }, out.status === 'incomplete' ? 'incomplete' : 'empty_output');
    if (out.status === 'incomplete') return refuse('parsed', {
      ok: false, mutated: false, refusal: 'construction_failed',
      incomplete_reason: out.incomplete_reason ?? 'unspecified',
      detail: `incomplete: ${out.incomplete_reason ?? 'unspecified'}`,
    }, 'incomplete');
    raw = omitOptionalRecordNulls(JSON.parse(out.text));
  } catch (err) {
    return refuse('parsed', { ok: false, mutated: false, refusal: 'construction_failed', detail: String(err).slice(0, 200) }, 'unparsable_output');
  }
  // replayRecordSet owns the entire existing compile chain, including the seam's runtime validation.
  const compiled = await replayRecordSet(raw as DraftRecordSet, { brief });
  // The seam's own reason, unchanged (`ReplayFailure.reason`), on the typed event.
  if (!compiled.ok) return refuse('parsed', { ok: false, mutated: false, refusal: 'construction_failed', detail: compiled.detail }, compiled.reason);
  stage({ stage: 'parsed', status: 'ok', stated_items: compiled.records.stated_items.length, claims: compiled.records.claims.length });
  // ⭐ P2-A6: each factor's driver role, typed from the compile on the EXISTING V3 `category` field: the lever an option
  // sets is `controllable`; a stated or derived quantity no option sets is `observable` (it holds a level) or
  // `external`. Stamped by the validator's own structural rule, so the stored type and readiness cannot disagree.
  const compiledGraph = compiled.graph as V1Graph;
  const categories = structuralFactorCategories(compiledGraph.nodes, compiledGraph.edges);
  const typed: V1Graph = { ...compiledGraph, nodes: compiledGraph.nodes.map(node => {
    const role = node.kind === 'factor' ? categories.get(node.id)?.category : undefined;
    return role === undefined ? node : { ...node, category: role };
  }) };
  const candidates = compiled.projection.constraintCandidates ?? [];
  const joined = joinRecordConstraints(typed, candidates, brief);
  // PORT 3: the user's stated sizes fitted, else clamped and marked, before the V3 boundary (`fitStatedEffects`).
  const fitted = fitStatedEffects(joined.graph, joined.constraints);
  const projected = projectGraphAndOptionsToV3(fitted, { brief });
  const idOf = projectedIdsOf(fitted);
  const projectedNodes = projected.graph.nodes as Array<{ id: string; kind?: unknown; is_baseline?: unknown; interventions?: unknown }>;
  const limits = bindConstraintsToProjectedIds(idOf, new Set(projectedNodes.map((node) => node.id)), joined, candidates);
  const origins = recordOriginsOf(fitted, idOf);
  const authored = { ...projected.graph, nodes: markRecordsOlumiOptions(projectedNodes, origins) };
  const dispositions = compiled.projection.stated_dispositions ?? [];
  stage({
    stage: 'compiled', status: 'ok', nodes: projectedNodes.length, edges: (projected.graph.edges as unknown[]).length,
    dispositions: {
      carried: dispositions.filter((d) => d.disposition === 'carried').length,
      rejected: dispositions.filter((d) => d.disposition === 'rejected').length,
      asked: dispositions.filter((d) => d.disposition === 'asked').length,
      dropped_refs: compiled.projection.dropped.length,
    },
  });
  const parsed = GraphV3.safeParse(limits.constraints.length > 0
    ? { ...authored, goal_constraints: limits.constraints } : authored);
  // P2-ACCEPT (mapped): the legacy constructor's own code for a graph the product could not then read
  // (`write-outcome.ts` REFUSAL_WORDS.admitted_graph_invalid keys on it), with the same `issues` shape.
  if (!parsed.success) return refuse('validated', {
    ok: false, mutated: false, refusal: 'admitted_graph_invalid',
    issues: parsed.error.issues.slice(0, 5).map((issue) => issue.path.join('.')),
  });
  const graph = parsed.data;
  /**
   * ⭐ P2-P3: THE SAME SIZE GATE AND REFUSAL AS THE LEGACY CONSTRUCTOR, after compile and before any write. One limit
   * (`COMPACT_LIMITS`, via `assessConstructionSize`), counted on the graph that WOULD register; the user's own material
   * over the limit is admitted, never refused. Records construction makes no generative repair call, so nothing is
   * compacted: an oversized draft is refused with zero writes and zero GRAPH_READY frames, and the route's existing
   * reader (`agent-v1-turn.ts`, `offerRebuild`) offers "Build it again".
   */
  const size = assessConstructionSize({ nodes: graph.nodes, edges: graph.edges, inference_classes: inferenceClassesOf(origins),
    ...(graph.goal_constraints !== undefined ? { goal_constraints: graph.goal_constraints } : {}) });
  if (!size.within && !size.user_material_exceeds_limit) {
    return refuse('validated', {
      ok: false, mutated: false, refusal: 'model_too_large', detail: size.detail,
      nodes: size.nodes, edges: size.edges, limits: size.limits, by_kind: size.by_kind,
      added_beyond_brief: size.sheddable_nodes, from_your_brief: size.brief_stated_nodes, retried: false,
    });
  }
  stage({ stage: 'validated', status: 'ok', within_compact_limits: size.within });
  const stillEmpty = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph`, { ...FRESH_READ });
  const held = stillEmpty.json.graph;
  if (stillEmpty.status === 200 && object(held) && Array.isArray(held.nodes) && held.nodes.length > 0) {
    return refuse('registered', {
      ok: false, mutated: false, refusal: 'model_already_exists',
      detail: 'While that model was being built, something was added to this one — so nothing was written, and '
        + 'your own change is untouched. Ask me to propose a change to the model you now have.',
    }, 'populated_before_write');
  }
  const reg = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph/register`, {
    // The compiler's receipt, as the register SIDECAR: the route reconciles it against the bytes it stores and is the
    // only writer of `graph.stated_dispositions` (`schemas/graph-stated-dispositions.ts`).
    stated_dispositions: reconcileStatedDispositions(compiled.projection.stated_dispositions ?? [], graph),
    graph, brief_text: brief, operation_id: constructionOperationId(scenarioId, brief), expected_graph_identity_hash: null,
  });
  const code = object(reg.json.details) ? reg.json.details.code : undefined;
  if (reg.status === 409 && (code === 'GRAPH_STALE' || code === 'OPERATION_ID_REUSED')) {
    const prior = await findConstructionVersion(dispatch, scenarioId, brief);
    if (prior !== null) {
      stage({ stage: 'registered', status: 'ok', replayed: true, model_version: prior });
      return { ok: true, mutated: false, replayed: true, model_version: prior };
    }
    if (code === 'GRAPH_STALE') return refuse('registered', {
      ok: false, mutated: false, refusal: 'model_already_exists',
      detail: 'While that model was being built, something was added to this one — so nothing was written, and '
        + 'your own change is untouched. Ask me to propose a change to the model you now have.',
    }, 'graph_stale');
  }
  if (reg.status !== 200) return refuse('registered', { ok: false, mutated: false, refusal: 'registration_refused', http: reg.status, detail: String(reg.json.message ?? '').slice(0, 200) }, `http_${reg.status}`);
  stage({ stage: 'registered', status: 'ok', replayed: reg.json.replayed === true, model_version: reg.json.model_version ?? null });
  // PORT 1: the deadline question FIRST, ahead of the five-question cap, exactly as the legacy constructor places it.
  const deadline = recordsDeadlineQuestion(fitted, idOf, graph, brief);
  // PORT 2 (C46): the unstated goal scope, ahead of the deadline, exactly as the legacy constructor places it.
  const goalScope = recordsGoalScope(scenarioId, compiled.records, fitted, idOf, graph);
  return {
    ok: true, mutated: true, ...(reg.json.replayed === true ? { replayed: true } : {}),
    ...(reg.json.model_version === undefined ? {} : { model_version: reg.json.model_version }),
    ...goalScope.pending,
    nodes: graph.nodes.length, edges: graph.edges.length, readiness: compiled.readiness,
    // The compact verdict travels with the success, as on the legacy path; records never retries for size.
    within_compact_limits: size.within, size_retried: false,
    ...(size.user_material_exceeds_limit ? { admitted_over_limit_because: 'your own stated options and facts exceed the compact limit' } : {}),
    options: graph.nodes.filter(node => node.kind === 'option').length,
    goal_constraints_carried: graph.goal_constraints?.length ?? 0,
    ...(limits.notCarried.length > 0 ? { goal_constraints_not_carried: limits.notCarried } : {}),
    open_questions: [...(goalScope.question !== undefined ? [goalScope.question] : []), ...(deadline !== undefined ? [deadline] : []),
      ...compiled.ask.items.map(item => item.detail), ...compiled.inventedRootAsks, ...compiled.setAsideDisclosure],
    // Preserve the projector's typed identities and reasons; do not reconstruct them from labels (rule (e)'s included).
    not_represented: compiled.projection.dropped,
  };
}
