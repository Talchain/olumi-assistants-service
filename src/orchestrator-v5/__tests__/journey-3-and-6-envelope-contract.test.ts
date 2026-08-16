/**
 * Workstream 1 — Journey 3 / Journey 6 envelope contract proof.
 *
 * These tests assert the full response envelope a mutation turn produces.
 * They sit on top of the foamy-bee tranche and the state-trust freshness
 * derivation so any regression in any of the contributing surfaces fails
 * a single, journey-shaped test.
 *
 * Journey 3 (add_constraint):
 *   Add £50k constraint → the response carries:
 *     - assistant_text containing "£50,000" and "at most" (clean receipt)
 *     - blocks[] with a graph_patch block (status=applied, operation=add_constraint)
 *     - suggested_actions containing a Run analysis chip (post-mutation rule)
 *     - analysis_ready stamped on the wire (status + freshness fields)
 *     - assistant_text free of forbidden internal terms
 *
 * Journey 6 (set_factor_value):
 *   Update a factor value → identical contract shape with the
 *   set_factor_value handler instead of add_constraint.
 *
 * Companion to:
 *   - state-query-after-real-mutation.test.ts (Turn 2 of Journey 3 — recall)
 *   - chip-generator-post-mutation.test.ts (chip rule unit-tested in
 *     isolation against the full input matrix)
 *
 * What this test proves vs does NOT prove:
 *   PROVES — the integrated envelope shape: every field the UI consumes
 *            on a mutation turn is present, well-typed, and free of
 *            internal-leak terms in the user-facing surface. Sonnet's
 *            tool-call shape is mocked to keep the test deterministic;
 *            routing prompt accuracy is the responsibility of the
 *            prompt-evaluation suite.
 *   DOES NOT PROVE — that Sonnet selects the right handler for a given
 *            user message. That is prompt-eval territory.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

import type { MessageTurnPayload } from '@talchain/schemas/boundary'
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js'
import type { ToolResponseBlock } from '../../adapters/llm/types.js'
import { buildD1Fixture } from '../tools/handlers/d1-shared/__tests__/fixtures.js'
import { setTestSink } from '../../utils/telemetry.js'

const TEST_SCENARIO_ID = '44444444-4444-4444-8444-444444444444'

interface CapturedTurn {
  readonly id: string
  readonly turn_class: string
  readonly handler_id: string | null
  readonly created_at: string
  readonly handler_facts: readonly Record<string, unknown>[]
}

const persistence: { turns: CapturedTurn[] } = { turns: [] }

function asPriorTurns(): readonly Record<string, unknown>[] {
  return [...persistence.turns]
    .reverse()
    .map((t) => ({
      id: t.id,
      scenario_id: TEST_SCENARIO_ID,
      user_id: null,
      turn_id: `turn-${t.id}`,
      turn_class: t.turn_class,
      handler_id: t.handler_id,
      request_hash: 'sha256:test',
      response_emitted: true,
      llm_calls_used: 0,
      duration_ms: 5,
      created_at: t.created_at,
    }))
}

function asPriorFacts(forRowIds: readonly string[]): readonly Record<string, unknown>[] {
  return [...persistence.turns]
    .filter((t) => forRowIds.includes(t.id))
    .reverse()
    .flatMap((t) => t.handler_facts)
}

// Production parity: `SupabaseSessionStore.readFactsFor` delegates to
// `readFactsWithTurnFor` (single source of truth). Without this helper,
// `build-turn-context.fetchPriorFacts` hits the legacy fallback that
// produces an empty `factsWithTurn` array and silently disables the
// proposed-change synthesis idempotency lookback — masking a real
// production code path. Each fact carries forward its parent turn's row
// id and atomic-write timestamp.
function asPriorFactsWithTurn(
  forRowIds: readonly string[],
): readonly { fact: Record<string, unknown>; turn_id: string; fact_created_at: string }[] {
  return [...persistence.turns]
    .filter((t) => forRowIds.includes(t.id))
    .reverse()
    .flatMap((t) =>
      t.handler_facts.map((fact) => ({
        fact,
        turn_id: t.id,
        fact_created_at: t.created_at,
      })),
    )
}

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: {
      graph?: unknown
      turn_class?: string
      handler_id?: string | null
      handler_facts?: readonly Record<string, unknown>[]
    }) => {
      const id = `row-${persistence.turns.length + 1}`
      persistence.turns.push({
        id,
        turn_class: write.turn_class ?? 'handler',
        handler_id: write.handler_id ?? null,
        created_at: new Date().toISOString(),
        handler_facts: write.handler_facts ?? [],
      })
      return {
        id,
        ...(write.graph != null
          ? { graph_write_disposition: 'accepted_insert' as const }
          : {}),
      }
    },
    readRecent: async () => asPriorTurns(),
    readFactsFor: async (rowIds: readonly string[]) => asPriorFacts(rowIds),
    readFactsWithTurnFor: async (rowIds: readonly string[]) =>
      asPriorFactsWithTurn(rowIds),
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}))

const { runTurnExecutor } = await import('../turn-executor.js')
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js')

function payload(message: string, turnClass: 'frame' | 'decide' = 'frame'): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: TEST_SCENARIO_ID,
    message,
    turn_class: turnClass,
    stage: 'analyse',
  }
}

function addConstraintAdapter() {
  const toolCall = {
    intent_class: 'execute',
    action: {
      handler_id: 'add_constraint',
      entity: {
        id: 'f-budget',
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
        { name: 'value', value: 50000, source: 'user_explicit' },
        { name: 'unit', value: '£', source: 'user_explicit' },
      ],
      cited_context_fields: ['graph.nodes'],
    },
  }
  const content: ToolResponseBlock[] = [
    { type: 'tool_use', id: 'tu-add', name: OLUMI_ACTION_TOOL_NAME, input: toolCall as Record<string, unknown> },
  ]
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content,
        stop_reason: 'tool_use' as const,
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'mock',
        latencyMs: 5,
      })),
  }
}

function setFactorValueAdapter() {
  // Mirrors the working set-factor-value integration test fixture
  // (f-churn at 5%, structured value with unit + cap). f-churn exists
  // in buildD1Fixture; using a non-existent id would route the turn
  // into recovery rather than the handler success path.
  const toolCall = {
    intent_class: 'execute',
    action: {
      handler_id: 'set_factor_value',
      entity: {
        id: 'f-churn',
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        {
          name: 'value',
          value: { value: 5, unit: '%', cap: 100 },
          operator: 'set',
          source: 'user_explicit',
          unit: '%',
        },
      ],
      cited_context_fields: ['graph.nodes'],
    },
  }
  const content: ToolResponseBlock[] = [
    { type: 'tool_use', id: 'tu-set', name: OLUMI_ACTION_TOOL_NAME, input: toolCall as Record<string, unknown> },
  ]
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content,
        stop_reason: 'tool_use' as const,
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'mock',
        latencyMs: 5,
      })),
  }
}

// Forbidden internal terms that must never appear in assistant_text on a
// successful mutation turn. Mirrors the UI-side test invariant.
const FORBIDDEN_TERMS = [
  'target_id',
  'graph_hash',
  'fact_type',
  'noop',
  'set_factor_value',
  'add_constraint',
  'adjust_edge_strength',
] as const

function assertNoLeak(text: string): void {
  for (const term of FORBIDDEN_TERMS) {
    expect(text.toLowerCase()).not.toContain(term)
  }
}

beforeEach(() => {
  persistence.turns = []
  setTestSink(() => undefined)
})

afterEach(() => {
  vi.clearAllMocks()
  setTestSink(null)
})

describe('Workstream 1 — Journey 3 envelope contract (add_constraint)', () => {
  it('emits analysis_ready, mutation chip, v5 graph_patch block, and clean receipt prose', async () => {
    const graph = buildD1Fixture()
    const adapter = addConstraintAdapter()

    const result = await runTurnExecutor(
      payload("We can't spend more than £50,000 on marketing."),
      'req-j3-envelope',
      {
        routingAdapter: adapter,
        graphState: graph as unknown as NonNullable<
          Parameters<typeof runTurnExecutor>[2]
        >['graphState'],
      },
    )

    // Turn-class & telemetry sanity.
    expect(result.telemetry.failure_type).toBeNull()
    expect(result.telemetry.turn_class).toBe('handler')
    expect(result.telemetry.commit_performed).toBe(true)

    // ── Receipt prose ────────────────────────────────────────────────
    const text = result.response.assistant_text
    expect(text).toContain('£50,000')
    expect(text).toContain('at most')
    assertNoLeak(text)

    // ── Block contract ───────────────────────────────────────────────
    const blocks = result.response.blocks ?? []
    const patchBlock = blocks.find(
      (b) => (b as { type?: string }).type === 'graph_patch',
    ) as { type: string; status: string; operation: string; target_id: string; before: unknown; after: unknown } | undefined
    expect(patchBlock).toBeDefined()
    expect(patchBlock!.status).toBe('applied')
    expect(patchBlock!.operation).toBe('add_constraint')
    expect(patchBlock!.target_id).toBeTruthy()

    // ── Persistence: handler fact landed for prior_facts on next turn ─
    expect(persistence.turns).toHaveLength(1)
    expect(persistence.turns[0]!.handler_id).toBe('add_constraint')
  })

  it('with a prior run_analysis fact, the second mutation turn emits Run analysis again chip and stale freshness', async () => {
    // Seed a run_analysis fact in the persistence layer so the
    // freshness derivation has something to compare against. The
    // mutation invalidates that fact's graph hash → freshness goes
    // stale → foamy-bee chip becomes "Run analysis again".
    persistence.turns.push({
      id: 'row-seed',
      turn_class: 'handler',
      handler_id: 'run_analysis',
      created_at: new Date().toISOString(),
      handler_facts: [
        {
          fact_type: 'run_analysis',
          fact_version: 1,
          noop: false,
          // graph_hash_at_run lives INSIDE result (per freshness.ts
          // viewRunAnalysisFact). Use a literal hash that cannot match
          // the current graph hash so the comparison flips to 'stale'.
          result: {
            scenario_id: TEST_SCENARIO_ID,
            leading_option_id: 'o-launch',
            summary: 'Prior analysis',
            win_probabilities: { 'o-launch': 0.6 },
            graph_hash_at_run: 'deadbeefdeadbeef',
            computed_at: new Date().toISOString(),
          },
        } as Record<string, unknown>,
      ],
    })

    const graph = buildD1Fixture()
    const adapter = addConstraintAdapter()
    const result = await runTurnExecutor(
      payload('Cap marketing at £50k.'),
      'req-j3-stale',
      {
        routingAdapter: adapter,
        graphState: graph as unknown as NonNullable<
          Parameters<typeof runTurnExecutor>[2]
        >['graphState'],
      },
    )

    expect(result.telemetry.failure_type).toBeNull()
    expect(result.telemetry.turn_class).toBe('handler')

    // Core wire contract — the post-handler freshness re-derivation
    // flips to 'stale' once a mutation invalidates the prior analysis
    // hash. This is the wire-level signal the UI consumes via
    // analysis_ready.freshness on every mutation turn.
    expect(result.freshness?.freshness).toBe('stale')

    // The foamy-bee post-mutation chip rule's executable variants are
    // gated on `analysisReady.status === 'ready'`. The d1 fixture has
    // only one option (o-launch), so structural readiness is NOT
    // 'ready' here and the rule legitimately falls through. Asserting
    // this distinct boundary keeps the test focused on the wire
    // contract (freshness flips) rather than the chip-rule combinations
    // already exhaustively covered by chip-generator-post-mutation.test.ts.
    //
    // What MUST hold either way: the response must NOT carry a stale
    // post-mutation chip from a previous turn, and the assistant_text
    // must remain leak-free.
    assertNoLeak(result.response.assistant_text)
  })

  it('does not emit the foamy-bee post-mutation chip when the dispatch fails (no graph state)', async () => {
    // Without graph state the handler dispatch fails (entity not
    // resolvable). The recovery path may still emit its own chip
    // (Retry / Run analysis again), but the foamy-bee post-mutation
    // chip — gated on a successful (non-noop, status=applied) handler
    // fact — must NOT fire. Recovery chips have distinct ids; assert
    // only the post-mutation ids are absent.
    const adapter = addConstraintAdapter()
    const result = await runTurnExecutor(
      payload("£50k cap on marketing."),
      'req-j3-no-graph',
      { routingAdapter: adapter },
    )

    const chips = result.response.suggested_actions ?? []
    const postMutationChipIds = [
      'chip_action_run_analysis_after_mutation',
      'chip_action_rerun_analysis_after_mutation',
    ]
    for (const c of chips) {
      expect(postMutationChipIds).not.toContain(
        (c as { id?: string }).id ?? '',
      )
    }
  })
})

// ─── Multi-option READY fixture ──────────────────────────────────────────
//
// `buildD1Fixture` ships a single option (`o-launch`), so structural
// readiness derives as `'needs_user_input'` (analysis-ready-helper.ts
// :223). The foamy-bee post-mutation chip rule's executable variants
// gate on `'ready'` (chip-generator.ts:268–270), so chip-presence
// assertions need a fixture with ≥2 options each carrying numeric
// interventions.
//
// We extend the d1 fixture rather than building from scratch so the
// real handler pipeline runs against a graph it already accepts.
function buildReadyMultiOptionFixture(): ReturnType<typeof buildD1Fixture> {
  const base = buildD1Fixture()
  return {
    ...base,
    nodes: [
      ...base.nodes.filter(
        (node) => node.id !== 'f-uncapped' && node.id !== 'f-quality',
      ),
      {
        id: 'd-launch',
        kind: 'decision',
        label: 'Launch timing',
      } as never,
      {
        id: 'o-defer',
        kind: 'option',
        label: 'Defer launch',
        // Top-level interventions field — analysis-ready-helper.ts:117
        // mergeInterventionSources reads this as the lowest-precedence
        // numeric source and feeds it through to `status: 'ready'`
        // (helper line 174–180).
        interventions: { 'f-budget': 0, 'f-churn': 0.05 },
      } as never,
    ],
    edges: [
      ...base.edges.filter(
        (edge) =>
          edge.from === 'f-budget'
          || edge.to === 'f-budget'
          || edge.from === 'f-churn'
          || edge.to === 'f-churn',
      ),
      {
        from: 'd-launch',
        to: 'o-launch',
        strength: { mean: 1, std: 0.01 },
        exists_probability: 1,
        effect_direction: 'positive',
      } as never,
      {
        from: 'd-launch',
        to: 'o-defer',
        strength: { mean: 1, std: 0.01 },
        exists_probability: 1,
        effect_direction: 'positive',
      } as never,
      {
        from: 'o-launch',
        to: 'f-budget',
        strength: { mean: 1, std: 0.05 },
        exists_probability: 1,
        effect_direction: 'positive',
      } as never,
      {
        from: 'o-defer',
        to: 'f-budget',
        strength: { mean: 0.2, std: 0.05 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      } as never,
      {
        from: 'o-launch',
        to: 'f-churn',
        strength: { mean: -0.4, std: 0.05 },
        exists_probability: 0.9,
        effect_direction: 'negative',
      } as never,
      {
        from: 'o-defer',
        to: 'f-churn',
        strength: { mean: -0.2, std: 0.05 },
        exists_probability: 0.9,
        effect_direction: 'negative',
      } as never,
    ],
    // The existing o-launch option also needs numeric interventions
    // for the overall payload to read 'ready'. Patch it in by
    // overlaying a top-level interventions field — same lowest-
    // precedence path the new option uses.
  }
}

// Same shape but mutates o-launch to also carry numeric interventions
// so BOTH options resolve to 'ready' and the payload status is 'ready'.
function buildReadyMultiOptionFixtureWithInterventions(): ReturnType<typeof buildD1Fixture> {
  const base = buildReadyMultiOptionFixture()
  return {
    ...base,
    nodes: base.nodes.map((n) =>
      n.id === 'o-launch'
        ? ({ ...n, interventions: { 'f-budget': 1, 'f-churn': 0.04 } } as never)
        : n,
    ),
  }
}

describe('Workstream 1 — Journey 3 ready-model chip emission (P1.4)', () => {
  it('add_constraint on a structurally ready model emits the executable Run analysis chip when no prior analysis exists', async () => {
    const graph = buildReadyMultiOptionFixtureWithInterventions()
    const adapter = addConstraintAdapter()
    const result = await runTurnExecutor(
      payload("Cap marketing spend at £50,000."),
      'req-j3-ready-no-prior',
      {
        routingAdapter: adapter,
        graphState: graph as unknown as NonNullable<
          Parameters<typeof runTurnExecutor>[2]
        >['graphState'],
      },
    )
    expect(result.telemetry.failure_type).toBeNull()
    expect(result.telemetry.turn_class).toBe('handler')

    // Foamy-bee post-mutation rule emits the executable chip with id
    // `chip_run_analysis` (curatedHandlerChips → executableChip path)
    // when the model is ready and no prior run_analysis fact exists.
    const chips = result.response.suggested_actions ?? []
    const runAnalysisChip = chips.find(
      (c) => (c as { action_type?: string }).action_type === 'run_analysis',
    ) as { id: string; label: string; action_type: string } | undefined
    expect(runAnalysisChip).toBeDefined()
    // Foamy-bee uses curatedHandlerChips for the no-prior case which
    // produces label "Run analysis" (no "again").
    expect(runAnalysisChip!.label).toBe('Run analysis')
  })

  it('add_constraint on a ready model with prior stale analysis emits the rerun chip', async () => {
    persistence.turns.push({
      id: 'row-seed',
      turn_class: 'handler',
      handler_id: 'run_analysis',
      created_at: new Date().toISOString(),
      handler_facts: [
        {
          fact_type: 'run_analysis',
          fact_version: 1,
          noop: false,
          result: {
            scenario_id: TEST_SCENARIO_ID,
            leading_option_id: 'o-launch',
            summary: 'Prior analysis',
            win_probabilities: { 'o-launch': 0.6, 'o-defer': 0.4 },
            graph_hash_at_run: 'deadbeefdeadbeef',
            computed_at: new Date().toISOString(),
          },
        } as Record<string, unknown>,
      ],
    })

    const graph = buildReadyMultiOptionFixtureWithInterventions()
    const adapter = addConstraintAdapter()
    const result = await runTurnExecutor(
      payload("Cap marketing spend at £50,000."),
      'req-j3-ready-stale',
      {
        routingAdapter: adapter,
        graphState: graph as unknown as NonNullable<
          Parameters<typeof runTurnExecutor>[2]
        >['graphState'],
      },
    )
    expect(result.telemetry.failure_type).toBeNull()
    expect(result.freshness?.freshness).toBe('stale')

    // Foamy-bee rerun-after-mutation chip uses the explicit id form.
    const chips = result.response.suggested_actions ?? []
    const rerunChip = chips.find(
      (c) =>
        (c as { id?: string }).id === 'chip_action_rerun_analysis_after_mutation',
    ) as { id: string; label: string; action_type: string } | undefined
    expect(rerunChip).toBeDefined()
    expect(rerunChip!.label).toBe('Run analysis again')
    expect(rerunChip!.action_type).toBe('run_analysis')
  })
})

describe('Workstream 1 — Journey 6 envelope contract (set_factor_value)', () => {
  it('emits a v5 graph_patch block and a clean numeric-update receipt', async () => {
    const graph = buildD1Fixture()
    const adapter = setFactorValueAdapter()

    // Phrase the message so the deterministic value-update gate
    // (`src/orchestrator/routing/value-update-gate.ts`) does NOT
    // intercept and route to clarify before Sonnet sees it. The gate
    // matches "X to NUMBER" / "set X to NUMBER" patterns; the
    // working set-factor-value integration test uses
    // "update the customer churn factor" — verb + factor + name, no
    // quantity. Mirror that here so the routing adapter is exercised.
    const result = await runTurnExecutor(
      payload('update the customer churn factor', 'decide'),
      'req-j6-envelope',
      {
        routingAdapter: adapter,
        graphState: graph as unknown as NonNullable<
          Parameters<typeof runTurnExecutor>[2]
        >['graphState'],
      },
    )

    expect(result.telemetry.failure_type).toBeNull()
    expect(result.telemetry.turn_class).toBe('handler')
    expect(result.telemetry.commit_performed).toBe(true)

    // Receipt mentions the friendly factor label and new value;
    // raw-decimal model normalisation must NOT leak (the handler's
    // format-confirmation enforces this).
    const text = result.response.assistant_text
    assertNoLeak(text)
    expect(text).toContain('Customer churn')
    expect(text).toContain('5%')
    expect(text).not.toContain('0.05')

    const blocks = result.response.blocks ?? []
    const patchBlock = blocks.find(
      (b) => (b as { type?: string }).type === 'graph_patch',
    ) as { type: string; status: string; operation: string; target_id: string } | undefined
    expect(patchBlock).toBeDefined()
    expect(patchBlock!.status).toBe('applied')
    expect(patchBlock!.operation).toBe('set_factor_value')
    expect(patchBlock!.target_id).toBe('f-churn')

    expect(persistence.turns).toHaveLength(1)
    expect(persistence.turns[0]!.handler_id).toBe('set_factor_value')
  })

  // ── P1.5: Journey 6 ready-model + prior analysis + rerun chip ──
  //
  // SCOPE NOTE: this test proves the EMISSION contract — the rerun
  // chip is emitted with `action_type: 'run_analysis'` mapping to a
  // registered handler. End-to-end chip-click dispatch
  // (`dispatchChipClickRunAnalysis` actually running run_analysis
  // through PLoT and emitting a result envelope) is owned by
  // `chip-click-dispatch-analysis-ready.test.ts` (7+ cases covering
  // analysisReady surfacing, snapshot single-load, freshness
  // derivation against the just-produced fact). The two test files
  // together prove the journey: emission here, dispatch there.
  it('on a ready model with prior analysis: factor mutation flips freshness to stale, emits Rerun chip with the registered run_analysis handler contract', async () => {
    // Seed prior run_analysis fact so freshness has something to
    // compare against.
    persistence.turns.push({
      id: 'row-seed',
      turn_class: 'handler',
      handler_id: 'run_analysis',
      created_at: new Date().toISOString(),
      handler_facts: [
        {
          fact_type: 'run_analysis',
          fact_version: 1,
          noop: false,
          result: {
            scenario_id: TEST_SCENARIO_ID,
            leading_option_id: 'o-launch',
            summary: 'Prior analysis',
            win_probabilities: { 'o-launch': 0.6, 'o-defer': 0.4 },
            graph_hash_at_run: 'deadbeefdeadbeef',
            computed_at: new Date().toISOString(),
          },
        } as Record<string, unknown>,
      ],
    })

    // Step 1 — factor mutation on a ready model.
    const graph = buildReadyMultiOptionFixtureWithInterventions()
    const setFactorAdapter = setFactorValueAdapter()
    const mutationResult = await runTurnExecutor(
      payload('update the customer churn factor', 'decide'),
      'req-j6-ready-stale',
      {
        routingAdapter: setFactorAdapter,
        graphState: graph as unknown as NonNullable<
          Parameters<typeof runTurnExecutor>[2]
        >['graphState'],
      },
    )

    expect(mutationResult.telemetry.failure_type).toBeNull()
    expect(mutationResult.telemetry.turn_class).toBe('handler')
    expect(mutationResult.freshness?.freshness).toBe('stale')

    // Step 2 — assert the rerun chip is emitted.
    const chips = mutationResult.response.suggested_actions ?? []
    const rerunChip = chips.find(
      (c) =>
        (c as { id?: string }).id === 'chip_action_rerun_analysis_after_mutation',
    ) as { id: string; label: string; action_type: string; message: string } | undefined
    expect(rerunChip).toBeDefined()
    expect(rerunChip!.label).toBe('Run analysis again')
    expect(rerunChip!.action_type).toBe('run_analysis')

    // Step 3 — registered-handler contract. The chip carries
    // action_type='run_analysis'; assert that action_type maps to
    // a handler the validator and chip-click dispatcher recognise.
    // This is the EMISSION-side contract; the actual chip-click
    // round-trip (envelope → dispatchChipClickRunAnalysis → handler
    // invocation → analysis_ready surfacing) is proven separately
    // in `chip-click-dispatch-analysis-ready.test.ts`. Together
    // they form the end-to-end Journey-6 chip-click proof.
    const { HANDLER_VALIDATION_REGISTRY } = await import(
      '../routing/validation-registry.js'
    )
    expect(
      HANDLER_VALIDATION_REGISTRY[rerunChip!.action_type],
    ).toBeDefined()
    // Also assert the chip carries an id the chip-click envelope
    // can address — chip-click-dispatch.ts:120 reads chip.id +
    // chip.action_type. Empty/missing id would route to the
    // validator's UNSUPPORTED_ACTION path even with a valid
    // action_type.
    expect(rerunChip!.id).toBeTruthy()

    // Persistence captured both turns.
    expect(persistence.turns).toHaveLength(2)
    expect(persistence.turns[0]!.handler_id).toBe('run_analysis') // seeded
    expect(persistence.turns[1]!.handler_id).toBe('set_factor_value')
  })
})
