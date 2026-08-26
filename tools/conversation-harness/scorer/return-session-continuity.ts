/**
 * System B return-session continuity harness.
 *
 * This module owns no memory, graph, analysis, or provenance semantics. It
 * reconnects the existing production readers and projections around a durable
 * in-memory persistence fake, then replaces the session and summary facades
 * on each run. The result is a fresh-facade return proof at the model-input
 * seam, plus deliberate ablations that demonstrate which production carriers
 * make the proof pass. Process-global prompt/config caches deliberately remain
 * warm, so this is not a process-restart or no-cache claim.
 * It manually composes the functions used by turn-executor; it does not execute
 * turn-executor, route-v2, the HTTP boundary, persistence RPCs, or a live model.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { z } from 'zod';

import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../../src/adapters/llm/types.js';
import {
  buildTurnContext,
  type EnrichedTurnContext,
} from '../../../src/orchestrator-v5/build-turn-context.js';
import {
  GraphStateIngressSchema,
  type GraphStateIngress,
} from '../../../src/orchestrator-v5/boundary/request-extensions.js';
import { buildAnalysisFromPriorFacts } from '../../../src/orchestrator-v5/context/analysis-fallback.js';
import {
  canonicalStateFromFreshness,
  summariseCoachingStatePack,
} from '../../../src/orchestrator-v5/context/canonical-analysis-state.js';
import {
  compactGraphForContextPack,
  compactSelectedGraphForContextPack,
} from '../../../src/orchestrator-v5/context/compact-graph-for-contextpack.js';
import { selectContextGraphSnapshot } from '../../../src/orchestrator-v5/context/context-graph-snapshot.js';
import {
  assembleContextPackWithSummary,
  CONTEXT_PACK_RECENT_TURNS_CAP,
  type ContextPack,
} from '../../../src/orchestrator-v5/context/context-pack-assembler.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { formatProbability } from '../../../src/orchestrator-v5/format/format-analysis-value.js';
import {
  buildUserMessage,
  routeWithToolUse,
} from '../../../src/orchestrator-v5/routing/route-with-tool-use.js';
import type { SessionTurnWithContent } from '../../../src/orchestrator-v5/session/conversation-content.js';
import type { SessionStore } from '../../../src/orchestrator-v5/session/store.js';
import { makeMessagePayload } from '../../../src/orchestrator-v5/__tests__/fixtures.js';
import {
  loadConversationSummaryForInjection,
  type SummaryInjectionOutcome,
} from '../../../src/orchestrator-v5/rolling-summary/inject.js';
import type { RollingSummaryStorePort } from '../../../src/orchestrator-v5/rolling-summary/store-adapter.js';
import {
  ROLLING_SUMMARY_SLOTS,
  SUMMARY_SCHEMA_VERSION,
  type RollingSummary,
  type RollingSummarySlot,
} from '../../../src/orchestrator-v5/rolling-summary/summary-types.js';
import type { HandlerFactWithTurn } from '../../../src/orchestrator-v5/types/handler-fact.js';
import {
  createMockSessionStore,
  makeSessionTurnRow,
} from '../../../tests/utils/mock-session-store.js';
import {
  loadCanonicalRoutingPromptEvidence,
  visibleAnswerFromRoutingResult,
} from './canonical-state-precedence.js';

const TurnFixtureSchema = z.object({
  n: z.number().int().min(1).max(99),
  turn_id: z.string().uuid(),
  user: z.string().min(1),
  assistant: z.string().min(1),
}).strict();

const GraphFixtureSchema = z.object({
  nodes: z.array(z.object({
    id: z.string().min(1),
    kind: z.string().min(1),
    label: z.string().min(1),
  }).passthrough()).min(1),
  edges: z.array(z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    strength: z.object({
      mean: z.number().finite(),
      std: z.number().finite().nonnegative(),
    }).strict(),
    effect_direction: z.enum(['positive', 'negative']),
    exists_probability: z.number().min(0).max(1),
  }).passthrough()),
  goal_constraints: z.array(z.object({
    constraint_id: z.string().min(1),
    node_id: z.string().min(1),
    operator: z.enum(['>=', '<=']),
    value: z.number().finite(),
    label: z.string().min(1),
    source_quote: z.string().min(1),
  }).passthrough()).min(1),
}).passthrough();

const SummarySourceSchema = z.object({
  turn_id: z.string().uuid(),
  speaker: z.enum(['user', 'assistant']),
  witnesses: z.array(z.string().min(1)).min(1),
}).strict();

const SummaryEntrySchema = z.object({
  text: z.string().min(1),
  sources: z.array(SummarySourceSchema).min(1),
}).strict();

const SummarySlotsSchema = z.object({
  FRAME: z.array(SummaryEntrySchema),
  CONSTRAINTS: z.array(SummaryEntrySchema),
  RESOLVED: z.array(SummaryEntrySchema),
  OPEN: z.array(SummaryEntrySchema),
}).strict();

export const ReturnSessionContinuityCaseSchema = z.object({
  schema: z.literal('return_session_continuity_case.v1'),
  id: z.string().min(1),
  scenario_id: z.string().uuid(),
  other_scenario_id: z.string().uuid(),
  question: z.string().min(1),
  brief: z.string().min(1),
  graph: GraphFixtureSchema,
  turns: z.array(TurnFixtureSchema).length(20),
  summary: z.object({
    updated_turn_number: z.number().int().min(1).max(20),
    version: z.number().int().positive(),
    slots: SummarySlotsSchema,
  }).strict(),
  accepted_change: z.object({
    turn_number: z.number().int().min(1).max(20),
    target_id: z.string().min(1),
    target_label: z.string().min(1),
    before_value: z.number().finite(),
    after_value: z.number().finite(),
    unit: z.string().min(1),
  }).strict(),
  analysis: z.object({
    turn_number: z.number().int().min(1).max(20),
    leading_option_id: z.string().min(1),
    leading_option_label: z.string().min(1),
    other_option_id: z.string().min(1),
    win_probabilities: z.record(z.number().min(0).max(1)),
    computed_at: z.string().datetime(),
  }).strict(),
  other_scenario: z.object({
    brief: z.string().min(1),
    graph_label: z.string().min(1),
    fact_canary: z.string().min(1),
  }).strict(),
  client_claims: z.object({
    history: z.string().min(1),
  }).strict(),
}).strict();

export type ReturnSessionContinuityCase = z.infer<
  typeof ReturnSessionContinuityCaseSchema
>;

export type SummaryMode = 'healthy' | 'missing' | 'zero_coverage';
export type AnalysisMode = 'current' | 'stale';
export type ReturnSessionMutant =
  | 'none'
  | 'drop_graph_and_brief'
  | 'drop_causal_edge'
  | 'drop_summary_wire'
  | 'drop_facts'
  | 'drop_fact_row_filter'
  | 'cross_scenario_read'
  | 'drop_precedence_instruction'
  | 'echo_obsolete_as_current';

export interface ReturnSessionRunOptions {
  readonly summaryMode?: SummaryMode;
  readonly mutant?: ReturnSessionMutant;
}

interface ScenarioRecord {
  readonly graph: GraphStateIngress | null;
  readonly brief: string | null;
  readonly turns: readonly SessionTurnWithContent[];
  readonly summary: RollingSummary | null;
  readonly facts: readonly HandlerFactWithTurn[];
}

export interface DurableHashRelationship {
  readonly graph_hash_at_analysis: string;
  readonly current_graph_hash: string;
}

export interface DurableReadObservation {
  readonly runtime_id: string;
  readonly channel: string;
  readonly requested_scenario_id: string;
  readonly resolved_scenario_id: string;
}

/**
 * Durable bytes shared by independently created session and summary facades.
 * No facade instance is shared by two calls to
 * {@link runFreshFacadeReturnSession}; process-global prompt/config caches are
 * outside this evidence rung and may remain warm.
 */
export class DurableReturnSessionBackend {
  readonly records: ReadonlyMap<string, ScenarioRecord>;
  readonly factRows: readonly HandlerFactWithTurn[];
  readonly reads: DurableReadObservation[] = [];
  readonly hashes: DurableHashRelationship;

  private constructor(
    readonly kase: ReturnSessionContinuityCase,
    readonly analysisMode: AnalysisMode,
  ) {
    const graphAtAnalysis = GraphStateIngressSchema.parse(structuredClone(kase.graph));
    const graph = analysisMode === 'stale'
      ? graphAfterLaterSemanticChange(kase, graphAtAnalysis)
      : graphAtAnalysis;
    const facts = buildDurableFactRows(kase, graphAtAnalysis, analysisMode);
    const primary: ScenarioRecord = {
      graph: deepFreeze(graph),
      brief: kase.brief,
      turns: deepFreeze(toPersistedTurns(kase, analysisMode)),
      summary: deepFreeze(toRollingSummary(kase)),
      facts: deepFreeze(facts),
    };
    const otherGraph = GraphStateIngressSchema.parse({
      nodes: [{
        id: 'other_goal',
        kind: 'goal',
        label: kase.other_scenario.graph_label,
      }],
      edges: [],
    });
    const otherFacts = deepFreeze([buildForeignFactRow(kase)]);
    const other: ScenarioRecord = {
      graph: deepFreeze(otherGraph),
      brief: kase.other_scenario.brief,
      turns: deepFreeze([] as SessionTurnWithContent[]),
      summary: null,
      facts: otherFacts,
    };
    this.records = new Map([
      [kase.scenario_id, deepFreeze(primary)],
      [kase.other_scenario_id, deepFreeze(other)],
    ]);
    this.factRows = deepFreeze([...primary.facts, ...other.facts]);
    const graphHashAtAnalysis = requiredAnalysisHash(graphAtAnalysis);
    const currentGraphHash = requiredAnalysisHash(graph);
    this.hashes = deepFreeze({
      graph_hash_at_analysis: graphHashAtAnalysis,
      current_graph_hash: currentGraphHash,
    });
    assertFixtureChannelsAreIndependent(kase, primary);
    assertDurableChronology(kase, primary, analysisMode, this.hashes);
    assertSummarySources(kase);
  }

  static current(kase: ReturnSessionContinuityCase): DurableReturnSessionBackend {
    return new DurableReturnSessionBackend(kase, 'current');
  }

  static stale(kase: ReturnSessionContinuityCase): DurableReturnSessionBackend {
    return new DurableReturnSessionBackend(kase, 'stale');
  }

  snapshotBytes(): string {
    return JSON.stringify({
      analysis_mode: this.analysisMode,
      hashes: this.hashes,
      records: [...this.records.entries()],
      fact_rows: this.factRows,
    });
  }

  primaryFacts(): readonly HandlerFactWithTurn[] {
    return this.records.get(this.kase.scenario_id)?.facts ?? [];
  }

  primarySummary(): RollingSummary | null {
    return this.records.get(this.kase.scenario_id)?.summary ?? null;
  }
}

export interface ReturnSessionObservation {
  readonly runtime_id: string;
  readonly durable_analysis_mode: AnalysisMode;
  readonly durable_hashes: DurableHashRelationship;
  readonly session_store_instance_id: string;
  readonly summary_store_instance_id: string;
  readonly context: EnrichedTurnContext;
  readonly contextPack: ContextPack;
  readonly graph_compaction_via: 'strict_parse' | 'structural_fallback' | 'absent';
  readonly summaryInjection: SummaryInjectionOutcome;
  readonly userMessage: string;
  readonly routedUserMessage: string;
  readonly routedSystem: string;
  readonly visibleAnswer: string;
  readonly reads: readonly DurableReadObservation[];
}

export interface ReturnSessionScore {
  readonly pass: boolean;
  readonly failures: readonly string[];
}

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

export function loadReturnSessionContinuityCase(
  name = 'return-session-continuity-case.json',
): ReturnSessionContinuityCase {
  return ReturnSessionContinuityCaseSchema.parse(
    JSON.parse(readFileSync(fixturePath(name), 'utf8')),
  );
}

function rowUuid(n: number): string {
  return `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function turnTimestamp(n: number): string {
  return `2026-08-25T09:${String(n).padStart(2, '0')}:00.000Z`;
}

const LATER_SEMANTIC_CHANGE_TURN = 18;
const LATER_SEMANTIC_CHANGE_VALUE = 48;

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return value;
}

function requiredAnalysisHash(graph: GraphStateIngress): string {
  const hash = computeAnalysisAffectingGraphHash(graph);
  if (hash === null) throw new Error('fixture canonical graph has no analysis hash');
  return hash;
}

function graphAfterLaterSemanticChange(
  kase: ReturnSessionContinuityCase,
  graphAtAnalysis: GraphStateIngress,
): GraphStateIngress {
  const raw = structuredClone(graphAtAnalysis) as {
    nodes: Array<{
      id: string;
      observed_state?: { value?: number; raw_value?: number; [key: string]: unknown };
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  const target = raw.nodes.find((node) => node.id === kase.accepted_change.target_id);
  if (target?.observed_state === undefined) {
    throw new Error('stale fixture factor has no observed state to change');
  }
  target.observed_state = {
    ...target.observed_state,
    value: LATER_SEMANTIC_CHANGE_VALUE,
    raw_value: LATER_SEMANTIC_CHANGE_VALUE,
  };
  return GraphStateIngressSchema.parse(raw);
}

function staleTurnOverride(turn: ReturnSessionContinuityCase['turns'][number]): {
  readonly user: string;
  readonly assistant: string;
} | null {
  if (turn.n !== LATER_SEMANTIC_CHANGE_TURN) return null;
  return {
    user: `Accept the later support-capacity update from 42 to ${LATER_SEMANTIC_CHANGE_VALUE} specialists.`,
    assistant: 'The later semantic model change was applied and recorded after the analysis.',
  };
}

function toPersistedTurns(
  kase: ReturnSessionContinuityCase,
  analysisMode: AnalysisMode,
): readonly SessionTurnWithContent[] {
  return [...kase.turns].reverse().map((turn) => {
    const isAnalysis = turn.n === kase.analysis.turn_number;
    const isInitialMutation = turn.n === kase.accepted_change.turn_number;
    const isLaterMutation = analysisMode === 'stale' &&
      turn.n === LATER_SEMANTIC_CHANGE_TURN;
    const copy = isLaterMutation ? staleTurnOverride(turn)! : turn;
    return makeSessionTurnRow({
      id: rowUuid(turn.n),
      scenario_id: kase.scenario_id,
      turn_id: turn.turn_id,
      turn_class: isAnalysis || isInitialMutation || isLaterMutation
        ? 'handler'
        : 'direct_answer',
      handler_id: isAnalysis
        ? 'run_analysis'
        : isInitialMutation || isLaterMutation
          ? 'set_factor_value'
          : null,
      request_hash: `sha256:return-session-${turn.n}`,
      created_at: turnTimestamp(turn.n),
      user_message: copy.user,
      assistant_message: copy.assistant,
    });
  });
}

function summaryText(
  slots: ReturnSessionContinuityCase['summary']['slots'],
): string {
  return ROLLING_SUMMARY_SLOTS.map(
    (slot) => `${slot}: ${slots[slot].map((entry) => entry.text).join(' ')}`,
  ).join('\n');
}

function toRollingSummary(kase: ReturnSessionContinuityCase): RollingSummary {
  const updated = kase.summary.updated_turn_number;
  return {
    text: summaryText(kase.summary.slots),
    slots: ROLLING_SUMMARY_SLOTS.map((slot) => ({
      slot,
      entries: kase.summary.slots[slot].map((entry) => ({
        text: entry.text,
        source_turn_ids: [...new Set(entry.sources.map((source) => source.turn_id))],
        source_speakers: [...new Set(entry.sources.map((source) => source.speaker))],
      })),
    })),
    updated_turn_id: kase.turns.find((turn) => turn.n === updated)!.turn_id,
    updated_turn_created_at: turnTimestamp(updated),
    version: kase.summary.version,
    generator: 'incremental',
    schema_version: SUMMARY_SCHEMA_VERSION,
  };
}

function toZeroCoverageSummary(kase: ReturnSessionContinuityCase): RollingSummary {
  const newest = kase.turns.at(-1)!;
  const slots = ROLLING_SUMMARY_SLOTS.map((slot) => ({
    slot,
    entries: slot === 'FRAME'
      ? [{
          text: 'Northstar return frame only; no conversation history was absorbed.',
          source_turn_ids: [] as readonly string[],
        }]
      : [],
  }));
  return {
    text: 'DECISION FRAME: Northstar return frame only; no conversation history was absorbed.',
    slots,
    updated_turn_id: newest.turn_id,
    updated_turn_created_at: turnTimestamp(newest.n),
    version: kase.summary.version + 1,
    generator: 'floor',
    schema_version: SUMMARY_SCHEMA_VERSION,
  };
}

function factorValueFact(change: {
  readonly target_id: string;
  readonly target_label: string;
  readonly before_value: number;
  readonly after_value: number;
  readonly unit: string;
}): HandlerFact {
  return {
    fact_type: 'set_factor_value',
    fact_version: 1,
    noop: false,
    result: {
      target_id: change.target_id,
      status: 'applied',
      before: {
        value: change.before_value,
        raw_value: change.before_value,
        label: change.target_label,
        unit: change.unit,
      },
      after: {
        value: change.after_value,
        raw_value: change.after_value,
        label: change.target_label,
        unit: change.unit,
      },
    },
  } as HandlerFact;
}

function buildForeignFactRow(
  kase: ReturnSessionContinuityCase,
): HandlerFactWithTurn {
  return {
    fact: factorValueFact({
      target_id: 'foreign_factor_canary',
      target_label: kase.other_scenario.fact_canary,
      before_value: 7,
      after_value: 9,
      unit: 'foreign-units',
    }),
    // This parent row is durable but belongs to another scenario and is not
    // among the requested scenario's twenty persisted parent turn rows.
    turn_id: '20000000-0000-4000-8000-000000000001',
    fact_created_at: '2026-08-25T10:01:00.000Z',
  };
}

function analysisFact(
  kase: ReturnSessionContinuityCase,
  graphAtAnalysis: GraphStateIngress,
): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: kase.scenario_id,
      leading_option_id: kase.analysis.leading_option_id,
      summary: 'Prior Northstar analysis persisted before the session facade was rebuilt.',
      win_probabilities: kase.analysis.win_probabilities,
      graph_hash_at_run: requiredAnalysisHash(graphAtAnalysis),
      computed_at: kase.analysis.computed_at,
      enrichment: { analysis_status: 'computed' },
    },
  } as HandlerFact;
}

function buildDurableFactRows(
  kase: ReturnSessionContinuityCase,
  graphAtAnalysis: GraphStateIngress,
  mode: AnalysisMode,
): readonly HandlerFactWithTurn[] {
  const accepted = factorValueFact(kase.accepted_change);
  const analysis = analysisFact(kase, graphAtAnalysis);
  const rows: HandlerFactWithTurn[] = [
    {
      fact: analysis,
      turn_id: rowUuid(kase.analysis.turn_number),
      fact_created_at: turnTimestamp(kase.analysis.turn_number),
    },
    {
      fact: accepted,
      turn_id: rowUuid(kase.accepted_change.turn_number),
      fact_created_at: turnTimestamp(kase.accepted_change.turn_number),
    },
  ];
  if (mode === 'stale') {
    rows.unshift({
      fact: factorValueFact({
        target_id: kase.accepted_change.target_id,
        target_label: kase.accepted_change.target_label,
        before_value: kase.accepted_change.after_value,
        after_value: LATER_SEMANTIC_CHANGE_VALUE,
        unit: kase.accepted_change.unit,
      }),
      turn_id: rowUuid(LATER_SEMANTIC_CHANGE_TURN),
      fact_created_at: turnTimestamp(LATER_SEMANTIC_CHANGE_TURN),
    });
  }
  return rows;
}

function resolveScenarioId(
  kase: ReturnSessionContinuityCase,
  requested: string,
  mutant: ReturnSessionMutant,
): string {
  return mutant === 'cross_scenario_read' && requested === kase.scenario_id
    ? kase.other_scenario_id
    : requested;
}

function createSessionStoreFacade(
  backend: DurableReturnSessionBackend,
  runtimeId: string,
  mutant: ReturnSessionMutant,
): { readonly id: string; readonly store: SessionStore } {
  const id = randomUUID();
  const read = (channel: string, requested: string): ScenarioRecord => {
    const resolved = resolveScenarioId(backend.kase, requested, mutant);
    backend.reads.push({
      runtime_id: runtimeId,
      channel,
      requested_scenario_id: requested,
      resolved_scenario_id: resolved,
    });
    const record = backend.records.get(resolved);
    if (!record) throw new Error(`durable fake has no scenario ${resolved}`);
    return record;
  };
  const factRowsForParentRows = (
    rowIds: readonly string[],
  ): readonly HandlerFactWithTurn[] => {
    if (mutant === 'drop_facts') return [];
    if (mutant === 'drop_fact_row_filter') return backend.factRows;
    const wanted = new Set(rowIds);
    return backend.factRows.filter((row) => wanted.has(row.turn_id));
  };
  const logParentFactRead = (channel: string): void => {
    const requested = backend.kase.scenario_id;
    backend.reads.push({
      runtime_id: runtimeId,
      channel,
      requested_scenario_id: requested,
      resolved_scenario_id: resolveScenarioId(backend.kase, requested, mutant),
    });
  };

  const store = createMockSessionStore({
    readRecent: async (scenarioId, limit) => {
      const turns = read('session.readRecent', scenarioId).turns;
      return turns.slice(0, limit ?? turns.length);
    },
    countTurns: async (scenarioId) => read('session.countTurns', scenarioId).turns.length,
    readFactsWithTurnFor: async (rowIds) => {
      logParentFactRead('session.readFactsWithTurnFor');
      return factRowsForParentRows(rowIds);
    },
    readFactsFor: async (rowIds) => {
      logParentFactRead('session.readFactsFor');
      return factRowsForParentRows(rowIds)
        .map((row) => row.fact);
    },
    readNewestAnalysisFactFor: async (scenarioId) => {
      const record = read('session.readNewestAnalysisFactFor', scenarioId);
      if (mutant === 'drop_facts') return null;
      return record.facts.find((row) => row.fact.fact_type === 'run_analysis')?.fact ?? null;
    },
    loadGraphAndBriefText: async (scenarioId) => {
      const record = read('session.loadGraphAndBriefText', scenarioId);
      if (mutant === 'drop_graph_and_brief') return { graph: null, briefText: null };
      return { graph: record.graph, briefText: record.brief };
    },
    loadGraph: async (scenarioId) => read('session.loadGraph', scenarioId).graph,
    readMostRecentPendingActions: async (scenarioId) => {
      read('session.readMostRecentPendingActions', scenarioId);
      return [];
    },
    readMostRecentCoachingState: async (scenarioId) => {
      read('session.readMostRecentCoachingState', scenarioId);
      return null;
    },
    hasPriorTurns: async (scenarioId) => read('session.hasPriorTurns', scenarioId).turns.length > 0,
  });
  return { id, store };
}

function createSummaryStoreFacade(
  backend: DurableReturnSessionBackend,
  runtimeId: string,
  mode: SummaryMode,
  mutant: ReturnSessionMutant,
): { readonly id: string; readonly store: RollingSummaryStorePort } {
  const id = randomUUID();
  const store: RollingSummaryStorePort = {
    upsertSummary: async () => {
      throw new Error('return-session harness is read-only');
    },
    loadSummary: async (scenarioId) => {
      const resolved = resolveScenarioId(backend.kase, scenarioId, mutant);
      backend.reads.push({
        runtime_id: runtimeId,
        channel: 'summary.loadSummary',
        requested_scenario_id: scenarioId,
        resolved_scenario_id: resolved,
      });
      if (mode === 'missing') return null;
      if (mode === 'zero_coverage') return toZeroCoverageSummary(backend.kase);
      return backend.records.get(resolved)?.summary ?? null;
    },
  };
  return { id, store };
}

function textResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    } as ChatWithToolsResult['usage'],
    model: 'return-session-fixture-router',
    latencyMs: 1,
  };
}

function expectedVisibleAnswer(
  kase: ReturnSessionContinuityCase,
  analysisMode: AnalysisMode,
  summaryMode: SummaryMode,
): string {
  const constraint = kase.graph.goal_constraints[0]!;
  const analysisLine = analysisMode === 'current'
    ? `Current analysis: ${kase.analysis.leading_option_label} is the modelled leading option.`
    : `Previous analysis: ${kase.analysis.leading_option_label} led before the model changed; no current leader is asserted.`;
  const tensionLine = summaryMode === 'healthy'
    ? `Open tension: ${kase.summary.slots.OPEN[0]!.text}`
    : 'Open tension: no verified tension summary is available this turn; do not reconstruct one.';
  const acceptedChangeLines = [
    `Accepted change: ${kase.accepted_change.target_label} changed from ${kase.accepted_change.before_value} to ${kase.accepted_change.after_value} ${kase.accepted_change.unit}.`,
  ];
  if (analysisMode === 'stale') {
    acceptedChangeLines.push(
      `Later accepted change: ${kase.accepted_change.target_label} changed from ${kase.accepted_change.after_value} to ${LATER_SEMANTIC_CHANGE_VALUE} ${kase.accepted_change.unit} after that analysis.`,
    );
  }
  return [
    analysisLine,
    `Recorded constraint: ${constraint.label} — ${constraint.source_quote}`,
    tensionLine,
    ...acceptedChangeLines,
    `Prior analysis: ${analysisMode}.`,
    'Not current: PROJECT-COMET-OBSOLETE is discussion history, not saved state.',
  ].join('\n');
}

/**
 * Create fresh session and summary facades in the same process, read the
 * durable scenario by id, manually compose the production ContextPack
 * functions and route it through the adapter seam.
 */
export async function runFreshFacadeReturnSession(
  backend: DurableReturnSessionBackend,
  options: ReturnSessionRunOptions = {},
): Promise<ReturnSessionObservation> {
  const summaryMode = options.summaryMode ?? 'healthy';
  const mutant = options.mutant ?? 'none';
  const runtimeId = randomUUID();
  const readsStart = backend.reads.length;
  const sessionFacade = createSessionStoreFacade(
    backend,
    runtimeId,
    mutant,
  );
  const summaryFacade = createSummaryStoreFacade(
    backend,
    runtimeId,
    summaryMode,
    mutant,
  );

  const payload = {
    ...makeMessagePayload({
      scenario_id: backend.kase.scenario_id,
      turn_id: randomUUID(),
      stage: 'analyse',
      turn_class: 'review',
      source: 'composer',
      message: backend.kase.question,
    }),
    // This is an intentionally hostile, non-contract extra. buildTurnContext
    // accepts only the typed payload and reads history from the fresh server
    // facade. Its absence from the routed bytes is the client-history
    // contamination proof. No request graph is supplied: request-vs-persisted
    // graph authority belongs to turn-executor, outside this harness boundary.
    conversation_history: [{ role: 'assistant', content: backend.kase.client_claims.history }],
  } as unknown as MessageTurnPayload;

  const context = await buildTurnContext(payload, `return-${runtimeId}`, {
    sessionStore: sessionFacade.store,
  });
  const summaryInjection = await loadConversationSummaryForInjection({
    scenarioId: backend.kase.scenario_id,
    windowTurnsNewestFirst: context.prior_turns,
    windowDepth: CONTEXT_PACK_RECENT_TURNS_CAP,
    requestId: `return-${runtimeId}`,
    summaryStore: summaryFacade.store,
  });

  const authoritativeGraph = GraphStateIngressSchema.safeParse(context.persistedGraph).data ?? null;
  const graphForProjection = mutant === 'drop_causal_edge' && authoritativeGraph !== null
    ? { ...authoritativeGraph, edges: [] }
    : authoritativeGraph;
  const brief = context.scenarioBriefText;
  const facts = mutant === 'drop_facts' ? [] : context.prior_facts;
  const selected = selectContextGraphSnapshot({
    canonicalRead:
      authoritativeGraph === null
        ? { status: 'ok_absent' }
        : { status: 'ok_present', graph: authoritativeGraph },
    requestGraph: null,
  });
  const compact =
    mutant === 'drop_causal_edge'
      ? compactGraphForContextPack(graphForProjection, { requestId: `return-${runtimeId}` })
      : compactSelectedGraphForContextPack(selected, { requestId: `return-${runtimeId}` });
  const compactedGraph = compact.kind === 'compacted' ? compact.compact : null;
  const compactedConstraints = graphForProjection?.goal_constraints ?? null;
  const analysis = buildAnalysisFromPriorFacts(
    facts,
    authoritativeGraph?.nodes
      .filter((node) => node.kind === 'option')
      .map((node) => ({ id: node.id, label: node.label })),
  );
  const canonical = canonicalStateFromFreshness(context.persisted_analysis_freshness);
  const summaryWireIsCut = mutant === 'drop_summary_wire';
  const { contextPack } = assembleContextPackWithSummary({
    payload,
    priorTurns: context.prior_turns,
    priorTurnsTotal: context.prior_turns_total,
    priorFacts: facts,
    priorFactsReadOk: context.prior_facts_read_ok,
    brief,
    // The strict parse above consumed the graph loaded through the fresh
    // persisted-session facade. State that authority explicitly; omission is
    // intentionally `unavailable` and would invalidate this harness's claim.
    graphContext: { status: 'canonical' },
    graph: compactedGraph ? undefined : authoritativeGraph,
    compactedGraph,
    compactedConstraints,
    analysis,
    analysisStalenessReason:
      context.persisted_analysis_freshness.freshness === 'fresh'
        ? null
        : 'The model has changed since this analysis was run.',
    coachingContext: summariseCoachingStatePack(canonical),
    conversationSummary:
      summaryWireIsCut ? undefined : summaryInjection.section ?? undefined,
    summarisedTurns:
      summaryWireIsCut ? undefined : summaryInjection.summarisedTurns,
  });
  const userMessage = buildUserMessage(contextPack, backend.kase.question);

  const calls: ChatWithToolsArgs[] = [];
  const truthfullyCurrentResponse = expectedVisibleAnswer(
    backend.kase,
    backend.analysisMode,
    summaryMode,
  );
  const response = mutant === 'echo_obsolete_as_current'
    ? truthfullyCurrentResponse.replace(
        'Not current: PROJECT-COMET-OBSOLETE is discussion history, not saved state.',
        'Current selection: PROJECT-COMET-OBSOLETE and Full national launch.',
      )
    : truthfullyCurrentResponse;
  const adapter = {
    chatWithTools: async (args: ChatWithToolsArgs): Promise<ChatWithToolsResult> => {
      calls.push(args);
      return textResult(response);
    },
  };
  const canonicalPrompt = loadCanonicalRoutingPromptEvidence();
  const result = await routeWithToolUse(contextPack, backend.kase.question, {
    requestId: `return-route-${runtimeId}`,
    sessionId: backend.kase.scenario_id,
    adapter,
    systemPromptOverride:
      mutant === 'drop_precedence_instruction'
        ? 'Answer the user without a state precedence rule.'
        : canonicalPrompt.text,
  });
  const visible = visibleAnswerFromRoutingResult(result);
  if (calls.length !== 1) {
    throw new Error(`return-session route invoked adapter ${calls.length} times`);
  }

  return {
    runtime_id: runtimeId,
    durable_analysis_mode: backend.analysisMode,
    durable_hashes: backend.hashes,
    session_store_instance_id: sessionFacade.id,
    summary_store_instance_id: summaryFacade.id,
    context,
    contextPack,
    graph_compaction_via: compact.kind === 'compacted' ? compact.via : 'absent',
    summaryInjection,
    userMessage,
    routedUserMessage: String(calls[0]!.messages[0]!.content),
    routedSystem: JSON.stringify(calls[0]!.system),
    visibleAnswer: visible.text,
    reads: backend.reads.slice(readsStart),
  };
}

export function scoreReturnSessionContinuity(
  kase: ReturnSessionContinuityCase,
  observation: ReturnSessionObservation,
  expectedAnalysisMode: AnalysisMode,
  expectedSummaryMode: SummaryMode = 'healthy',
): ReturnSessionScore {
  const failures: string[] = [];
  const prompt = observation.routedUserMessage;
  const constraint = kase.graph.goal_constraints[0]!;
  const expectedEdge = kase.graph.edges[0]!;
  const expectedFreshness = expectedAnalysisMode === 'current' ? 'fresh' : 'stale';
  const expectedFactorValue = expectedAnalysisMode === 'current'
    ? kase.accepted_change.after_value
    : LATER_SEMANTIC_CHANGE_VALUE;
  const expectedFactorDisplay = `${expectedFactorValue} ${kase.accepted_change.unit}`;
  const accepted = observation.contextPack.recent_changes.find(
    (change) =>
      change.action === 'factor_value_updated' &&
      change.target_label === kase.accepted_change.target_label &&
      change.summary.includes(String(kase.accepted_change.before_value)) &&
      change.summary.includes(String(kase.accepted_change.after_value)),
  );
  const laterAccepted = observation.contextPack.recent_changes.find(
    (change) =>
      change.action === 'factor_value_updated' &&
      change.target_label === kase.accepted_change.target_label &&
      change.summary.includes(String(kase.accepted_change.after_value)) &&
      change.summary.includes(String(LATER_SEMANTIC_CHANGE_VALUE)),
  );

  if (observation.durable_analysis_mode !== expectedAnalysisMode) {
    failures.push('scorer analysis expectation did not match the durable backend variant');
  }

  requireText(failures, prompt, kase.brief, 'persisted brief missing');
  for (const node of kase.graph.nodes) {
    requireText(failures, prompt, node.label, `canonical graph node missing: ${node.id}`);
  }
  const canonicalFactor = observation.contextPack.graph.nodes.find((node) => {
    const candidate = node as { id?: unknown };
    return candidate.id === kase.accepted_change.target_id;
  }) as { value?: unknown; unit?: unknown } | undefined;
  const displayedFactor = observation.contextPack.display_graph.nodes.find((node) => {
    const candidate = node as { id?: unknown };
    return candidate.id === kase.accepted_change.target_id;
  }) as { display_value?: unknown } | undefined;
  if (
    canonicalFactor?.value !== expectedFactorValue ||
    canonicalFactor.unit !== kase.accepted_change.unit
  ) {
    failures.push('canonical factor current value was not retained in structured state');
  }
  if (displayedFactor?.display_value !== expectedFactorDisplay) {
    failures.push('display graph was not bound to the canonical factor current value');
  } else {
    requireText(
      failures,
      prompt,
      `"display_value": "${expectedFactorDisplay}"`,
      'canonical factor current value was not routed through the display graph',
    );
  }
  requireText(failures, prompt, constraint.label, 'named constraint missing');
  requireText(failures, prompt, constraint.source_quote, 'constraint provenance missing');
  const projectedEdge = observation.contextPack.graph.edges.find((candidate) => {
    const edge = candidate as { from?: unknown; to?: unknown };
    return edge.from === expectedEdge.from && edge.to === expectedEdge.to;
  }) as { strength?: unknown; exists?: unknown } | undefined;
  if (
    projectedEdge?.strength !== expectedEdge.strength.mean ||
    projectedEdge.exists !== expectedEdge.exists_probability
  ) {
    failures.push('causal edge or its persisted strength/existence was not retained');
  }
  requireText(
    failures,
    prompt,
    'moderate positive link',
    'display-safe causal relationship missing from routed prompt',
  );
  if (expectedSummaryMode === 'healthy') {
    requireText(
      failures,
      prompt,
      kase.summary.slots.OPEN[0]!.text,
      'unresolved tension missing',
    );
  } else {
    forbidText(
      failures,
      prompt,
      kase.summary.slots.OPEN[0]!.text,
      'unverified summary-only tension reached the degraded prompt',
    );
    forbidText(
      failures,
      observation.visibleAnswer,
      'TENSION-SAFFRON',
      'degraded visible answer fabricated the unavailable tension',
    );
    requireText(
      failures,
      observation.visibleAnswer,
      'no verified tension summary is available this turn',
      'degraded visible answer did not disclose the missing tension summary',
    );
  }
  if (expectedAnalysisMode === 'stale') {
    if (laterAccepted === undefined) {
      failures.push('later accepted change fact missing from stale durable history');
    } else {
      requireText(
        failures,
        prompt,
        laterAccepted.summary,
        'later accepted change was projected but not routed to the model',
      );
    }
    requireText(
      failures,
      observation.visibleAnswer,
      `changed from ${kase.accepted_change.after_value} to ${LATER_SEMANTIC_CHANGE_VALUE} ${kase.accepted_change.unit} after that analysis`,
      'stale visible answer omitted the later accepted model change',
    );
  }
  if (
    accepted?.target_label !== kase.accepted_change.target_label ||
    !accepted.summary.includes(String(kase.accepted_change.before_value)) ||
    !accepted.summary.includes(String(kase.accepted_change.after_value))
  ) {
    failures.push('accepted change fact missing or not bound to its before/after values');
  } else {
    requireText(
      failures,
      prompt,
      accepted.summary,
      'accepted change was projected but not routed to the model',
    );
  }
  const persistedAnalysisFact = observation.context.prior_facts.find(
    (fact) => fact.fact_type === 'run_analysis',
  );
  const analysisResult = persistedAnalysisFact?.result as
    | { leading_option_id?: unknown; graph_hash_at_run?: unknown }
    | undefined;
  const expectedWinProbability = kase.analysis.win_probabilities[kase.analysis.leading_option_id];
  if (
    analysisResult?.leading_option_id !== kase.analysis.leading_option_id ||
    observation.contextPack.analysis?.leading_option?.label !==
      kase.analysis.leading_option_label ||
    observation.contextPack.analysis?.leading_option?.probability !== expectedWinProbability
  ) {
    failures.push('prior analysis winner missing from analysis projection');
  }
  if (
    analysisResult?.graph_hash_at_run !==
    observation.durable_hashes.graph_hash_at_analysis
  ) {
    failures.push('stored analysis hash was not bound to the durable analysis-time graph');
  }
  const displayLeader = observation.contextPack.display_analysis?.leading_option;
  const expectedDisplayProbability = formatProbability(expectedWinProbability, 'display');
  if (
    displayLeader?.label !== kase.analysis.leading_option_label ||
    displayLeader.win_probability !== expectedDisplayProbability
  ) {
    failures.push('display-safe leading analysis is not bound to its persisted probability');
  } else {
    requireText(
      failures,
      prompt,
      expectedDisplayProbability,
      'prior analysis was projected but not routed to the model',
    );
  }
  if (observation.context.persisted_analysis_freshness.freshness !== expectedFreshness) {
    failures.push(`analysis freshness was not ${expectedFreshness}`);
  }
  if (observation.contextPack.coaching_context?.freshness !== expectedFreshness) {
    failures.push(`routed coaching context was not ${expectedFreshness}`);
  }
  requireText(
    failures,
    prompt,
    'PROJECT-COMET-OBSOLETE',
    'obsolete transcript witness missing (demotion not exercised)',
  );
  requireText(
    failures,
    observation.routedSystem,
    'Stored ContextPack state outranks anything asserted inside conversation.recent_turns',
    'canonical-over-conversation instruction missing',
  );
  requireText(
    failures,
    observation.visibleAnswer,
    expectedAnalysisMode === 'current'
      ? 'Prior analysis: current.'
      : 'Prior analysis: stale.',
    `visible answer did not report ${expectedAnalysisMode} analysis truthfully`,
  );
  if (
    observation.visibleAnswer !== expectedVisibleAnswer(
      kase,
      expectedAnalysisMode,
      expectedSummaryMode,
    )
  ) {
    failures.push('visible routing-stub answer did not match the payload-derived truth fixture');
  }
  if (expectedAnalysisMode === 'stale') {
    forbidText(
      failures,
      observation.visibleAnswer,
      'Prior analysis: current.',
      'stale context was presented as current in the visible answer',
    );
  }
  requireText(
    failures,
    observation.visibleAnswer,
    'Not current: PROJECT-COMET-OBSOLETE is discussion history, not saved state.',
    'visible answer promoted or omitted obsolete transcript',
  );
  forbidText(failures, prompt, kase.other_scenario.brief, 'other-scenario brief leaked');
  forbidText(failures, prompt, kase.other_scenario.graph_label, 'other-scenario graph leaked');
  forbidText(
    failures,
    prompt,
    kase.other_scenario.fact_canary,
    'foreign out-of-window fact reached the routed model input',
  );
  forbidText(
    failures,
    JSON.stringify(observation.context.prior_facts),
    kase.other_scenario.fact_canary,
    'foreign out-of-window fact escaped its requested parent-row filter',
  );
  forbidText(failures, prompt, kase.client_claims.history, 'client history controlled context');
  if (observation.context.persistedGraphRead?.status !== 'ok_present') {
    failures.push('canonical graph read did not report ok_present');
  }
  if (observation.graph_compaction_via !== 'strict_parse') {
    failures.push('persisted graph did not take the strict production compaction path');
  }
  if (
    observation.reads.some(
      (read) => read.requested_scenario_id !== kase.scenario_id ||
        read.resolved_scenario_id !== kase.scenario_id,
    )
  ) {
    failures.push('a durable reader escaped the requested scenario');
  }
  if (observation.userMessage !== observation.routedUserMessage) {
    failures.push('router did not receive the exact production-serialised user message');
  }

  return { pass: failures.length === 0, failures };
}

function requireText(
  failures: string[],
  haystack: string,
  needle: string,
  failure: string,
): void {
  if (!haystack.includes(needle)) failures.push(failure);
}

function forbidText(
  failures: string[],
  haystack: string,
  needle: string,
  failure: string,
): void {
  if (haystack.includes(needle)) failures.push(failure);
}

function assertFixtureChannelsAreIndependent(
  kase: ReturnSessionContinuityCase,
  primary: ScenarioRecord,
): void {
  const graphText = JSON.stringify(primary.graph);
  const turnsText = JSON.stringify(primary.turns);
  const summary = primary.summary;
  if (summary === null) throw new Error('primary fixture summary is absent');
  const summaryTextValue = JSON.stringify(summary);
  const open = kase.summary.slots.OPEN[0]!.text;
  const openMarker = 'TENSION-SAFFRON';
  const constraint = kase.graph.goal_constraints[0]!;

  if (
    !summaryTextValue.includes(open) ||
    !summaryTextValue.includes(openMarker) ||
    graphText.includes(openMarker) ||
    turnsText.includes(openMarker)
  ) {
    throw new Error('unresolved-tension witness is not summary-only');
  }
  if (
    !graphText.includes(constraint.source_quote) ||
    turnsText.includes(constraint.source_quote) ||
    summaryTextValue.includes(constraint.source_quote)
  ) {
    throw new Error('constraint-provenance witness is not graph-only');
  }
  if (!turnsText.includes('PROJECT-COMET-OBSOLETE') || graphText.includes('PROJECT-COMET-OBSOLETE')) {
    throw new Error('obsolete witness is not transcript-only');
  }
  if (!turnsText.includes('ORCHID-12') || graphText.includes('ORCHID-12')) {
    throw new Error('degraded-fallback witness is not transcript-only');
  }
  const primaryBytes = JSON.stringify({
    brief: primary.brief,
    graph: primary.graph,
    turns: primary.turns,
    summary: primary.summary,
    facts: primary.facts,
  });
  for (const canary of [
    kase.other_scenario.brief,
    kase.other_scenario.graph_label,
    kase.other_scenario.fact_canary,
    kase.client_claims.history,
  ]) {
    if (primaryBytes.includes(canary)) {
      throw new Error(`negative-control canary leaked into primary fixture: ${canary}`);
    }
  }
}

function factTimestamp(
  rows: readonly HandlerFactWithTurn[],
  type: HandlerFact['fact_type'],
  predicate: (fact: HandlerFact) => boolean = () => true,
): string {
  const row = rows.find((candidate) =>
    candidate.fact.fact_type === type && predicate(candidate.fact));
  if (row === undefined) throw new Error(`durable fixture is missing ${type} fact`);
  return row.fact_created_at;
}

function assertDurableChronology(
  kase: ReturnSessionContinuityCase,
  primary: ScenarioRecord,
  mode: AnalysisMode,
  hashes: DurableHashRelationship,
): void {
  const acceptedAt = factTimestamp(primary.facts, 'set_factor_value', (fact) => {
    const result = fact.result as { before?: { value?: unknown }; after?: { value?: unknown } };
    return result.before?.value === kase.accepted_change.before_value &&
      result.after?.value === kase.accepted_change.after_value;
  });
  const analysisAt = factTimestamp(primary.facts, 'run_analysis');
  const storedAnalysis = primary.facts.find(
    (row) => row.fact.fact_type === 'run_analysis',
  )?.fact.result as { graph_hash_at_run?: unknown } | undefined;
  if (storedAnalysis?.graph_hash_at_run !== hashes.graph_hash_at_analysis) {
    throw new Error(
      'stored run_analysis hash does not match the durable analysis-time graph hash',
    );
  }
  if (acceptedAt >= analysisAt) {
    throw new Error('accepted change must be durably recorded before analysis');
  }
  if (mode === 'current') {
    if (hashes.graph_hash_at_analysis !== hashes.current_graph_hash) {
      throw new Error('current durable backend did not pin equal analysis/current hashes');
    }
    if (primary.facts.length !== 2) {
      throw new Error('current durable backend contains an unexpected fact row');
    }
    return;
  }
  const laterChangeAt = factTimestamp(primary.facts, 'set_factor_value', (fact) => {
    const result = fact.result as { before?: { value?: unknown }; after?: { value?: unknown } };
    return result.before?.value === kase.accepted_change.after_value &&
      result.after?.value === LATER_SEMANTIC_CHANGE_VALUE;
  });
  if (analysisAt >= laterChangeAt) {
    throw new Error('stale durable backend lacks a later semantic change after analysis');
  }
  if (hashes.graph_hash_at_analysis === hashes.current_graph_hash) {
    throw new Error('stale durable backend did not pin unequal analysis/current hashes');
  }
}

function assertSummarySources(kase: ReturnSessionContinuityCase): void {
  const turnsById = new Map(kase.turns.map((turn) => [turn.turn_id, turn]));
  if (turnsById.size !== kase.turns.length) {
    throw new Error('durable fixture turn ids are not unique');
  }
  const slotPrefixes = new Set<string>();
  for (const slot of ROLLING_SUMMARY_SLOTS) {
    const entries = kase.summary.slots[slot];
    if (entries.length === 0) throw new Error(`summary slot ${slot} is empty`);
    const firstSource = entries[0]!.sources[0]!;
    slotPrefixes.add(firstSource.turn_id.slice(0, 8));
    for (const entry of entries) {
      for (const source of entry.sources) {
        const turn = turnsById.get(source.turn_id);
        if (turn === undefined) {
          throw new Error(`summary slot ${slot} cites an absent turn ${source.turn_id}`);
        }
        if (turn.n > kase.summary.updated_turn_number) {
          throw new Error(`summary slot ${slot} cites a turn newer than its watermark`);
        }
        const sourceText = turn[source.speaker].toLocaleLowerCase('en');
        for (const witness of source.witnesses) {
          if (!sourceText.includes(witness.toLocaleLowerCase('en'))) {
            throw new Error(
              `summary slot ${slot} source ${source.turn_id} lacks witness ${witness}`,
            );
          }
        }
      }
    }
  }
  if (slotPrefixes.size !== ROLLING_SUMMARY_SLOTS.length) {
    throw new Error('summary slots do not have distinct supporting-turn UUID prefixes');
  }
}

// Exhaustiveness guard: adding a rolling-summary slot forces this harness to
// decide how a durable return-session fixture should populate it.
const _summarySlotExhaustiveness: Record<RollingSummarySlot, true> = {
  FRAME: true,
  CONSTRAINTS: true,
  RESOLVED: true,
  OPEN: true,
};
void _summarySlotExhaustiveness;
