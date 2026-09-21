/**
 * A draft turn is not one LLM call — and until now the trace said it was.
 *
 * `draft_graph` is the structural draft. Two more real calls run on the same
 * turn: the post-draft coaching pass (~19.8 s, ungated) and `validate_graph`
 * (o4-mini, behind CEE_VALIDATION_PIPELINE_ENABLED). Neither rides
 * `DraftGraphResult` — the only channel the trace builder reads — so both were
 * invisible, and a reader debugging a bad draft was pointed at the draft prompt
 * for output two other prompts and two other models had produced.
 *
 * ── WHAT THIS FILE PROVES, AND WHAT IT DOES NOT ───────────────────────────
 * These cases drive the REAL builders with a snapshot produced by the REAL
 * `PromptAttributionCollector`, so the collector's own honesty rules are under
 * test rather than restated. They prove the BUILDER's contract given its input.
 * They do NOT prove production threads that input — the two PRODUCER sites are
 * pinned separately, and deliberately, in:
 *   - `cee/unified-pipeline/stages/__tests__/coaching-pass-attribution.test.ts`
 *   - `tests/unit/cee.validation-pipeline/validate-graph-attribution.test.ts`
 * A builder-only suite would stay green if nothing ever called `record()`,
 * which is the shape that once let an always-`[]` `llm_calls` ship as tested.
 *
 * ── BINDING ───────────────────────────────────────────────────────────────
 * Every assertion finds its record BY `task_id` / `role`, never by array index
 * or length. Two different calls both being "present" is not the claim; the
 * claim is that THIS task's prompt and THIS task's model are recorded, and an
 * index-bound assertion is satisfied by whichever record happens to land there.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PromptAttributionCollector } from '../../../orchestrator/pipeline/prompt-attribution.js';

const ORIGINAL_ENV = { ...process.env };

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST_ID = 'req-attribution-1';

/**
 * A collector holding one bound coaching record and one bound validate_graph
 * record — the shape a real draft turn produces when both calls ran and both
 * prompts resolved.
 */
function collectorWithBothCalls(): PromptAttributionCollector {
  const collector = new PromptAttributionCollector();
  collector.record({
    taskId: 'draft_coaching',
    role: 'draft_coaching',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    inputTokens: 4100,
    outputTokens: 380,
    latencyMs: 19_800,
    stopReason: 'end_turn',
    promptHash: 'coachinghash01',
    promptVersion: 'coaching_system@code',
    promptId: 'coaching_system@code',
    promptSource: 'code',
  });
  collector.record({
    taskId: 'validate_graph',
    role: 'validate_graph',
    provider: 'openai',
    model: 'o4-mini',
    inputTokens: 900,
    outputTokens: 4560,
    latencyMs: 30_092,
    stopReason: 'stop',
    promptHash: 'validatehash02',
    promptVersion: 'validate_graph_default@v4',
    promptId: 'validate_graph_default',
    promptSource: 'store',
  });
  return collector;
}

async function loadBuilders() {
  process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
  vi.resetModules();
  return import('../v5-diagnostic-trace.js');
}

describe('pipeline prompt attribution — coaching pass + validate_graph reach the trace', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('records the coaching pass and validate_graph ALONGSIDE draft_graph on a successful draft', async () => {
    const mod = await loadBuilders();
    const trace = mod.buildV5DiagnosticTrace({
      startedAt: Date.now() - 60_000,
      persistenceMs: 42,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      commitResult: { committed: true } as never,
      draftResult: {
        latencyMs: 62_640,
        toolLLMTelemetry: {
          tool: 'draft_graph',
          model: 'claude-sonnet-4-6',
          provider: 'anthropic',
          input_tokens: 2200,
          output_tokens: 1800,
          latency_ms: 62_523,
          stop_reason: 'end_turn',
          thinking_enabled: false,
          structured_outputs_used: true,
          prompt_hash: 'draftgraphhash00',
          prompt_version: 'draft_graph_default@v31',
        },
      } as never,
      promptAttribution: collectorWithBothCalls().snapshot(),
    });

    expect(trace).toBeDefined();
    const tasks = trace!.prompt_identity.map((p) => p.task_id);

    // ALONGSIDE, not instead of. A replay that overwrote rather than appended
    // would trade one blind spot for another, and an assertion that only
    // counted entries could not tell the two apart.
    expect(tasks).toContain('draft_graph');

    const coaching = trace!.prompt_identity.find((p) => p.task_id === 'draft_coaching');
    expect(coaching).toBeDefined();
    expect(coaching!.hash).toBe('coachinghash01');
    expect(coaching!.version).toBe('coaching_system@code');
    // `code`, NOT `pms`. This prompt is a constant in coaching-pass.ts with no
    // store row; labelling it store-managed would be the exact class of untruth
    // the attribution exists to remove.
    expect(coaching!.source).toBe('code');

    const validate = trace!.prompt_identity.find((p) => p.task_id === 'validate_graph');
    expect(validate).toBeDefined();
    expect(validate!.hash).toBe('validatehash02');
    expect(validate!.source).toBe('store');

    // The MODEL half of the question. `validate_graph` runs on a small model
    // nobody chose for it; the trace is how anyone finds that out.
    const coachingCall = trace!.llm_calls.find((c) => c.role === 'draft_coaching');
    expect(coachingCall).toBeDefined();
    expect(coachingCall!.model).toBe('claude-sonnet-4-6');
    expect(coachingCall!.latency_ms).toBe(19_800);

    const validateCall = trace!.llm_calls.find((c) => c.role === 'validate_graph');
    expect(validateCall).toBeDefined();
    expect(validateCall!.model).toBe('o4-mini');
    expect(validateCall!.provider).toBe('openai');

    // The draft's own call survives the append.
    expect(trace!.llm_calls.some((c) => c.role === 'draft_graph')).toBe(true);
  });

  it('carries what ran before the failure onto the ERROR trace', async () => {
    const mod = await loadBuilders();
    // No `toolLLMTelemetry`: the structural draft surfaced nothing on this
    // failure. The coaching/validate records must still land — they are
    // recorded outside that guard precisely because these calls happen whether
    // or not the draft's own telemetry made it out.
    const trace = mod.buildErrorV5DiagnosticTrace({
      startedAt: Date.now() - 40_000,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      error: new Error('cee.validation_pipeline.truncated'),
      promptAttribution: collectorWithBothCalls().snapshot(),
    });

    expect(trace).toBeDefined();
    const validate = trace!.prompt_identity.find((p) => p.task_id === 'validate_graph');
    expect(validate).toBeDefined();
    expect(validate!.hash).toBe('validatehash02');
    const validateCall = trace!.llm_calls.find((c) => c.role === 'validate_graph');
    expect(validateCall).toBeDefined();
    expect(validateCall!.model).toBe('o4-mini');
    // The coaching pass ran too, and its record is not collateral of the
    // validate one — found by its own task_id.
    expect(
      trace!.prompt_identity.some((p) => p.task_id === 'draft_coaching'),
    ).toBe(true);
  });

  it('an UNBOUND prompt records the call and NO identity — the honest-absence twin', async () => {
    const mod = await loadBuilders();
    const collector = new PromptAttributionCollector();
    // `getSystemPromptSnapshot` failed its hash invariant, so validate-graph.ts
    // degraded to the plain loader and passed no hash. The model is still known.
    collector.record({
      taskId: 'validate_graph',
      role: 'validate_graph',
      provider: 'openai',
      model: 'o4-mini',
      inputTokens: 900,
      outputTokens: 120,
      latencyMs: 5_000,
      stopReason: 'stop',
      promptHash: undefined,
      promptVersion: undefined,
      promptId: undefined,
      promptSource: undefined,
    });

    const trace = mod.buildErrorV5DiagnosticTrace({
      startedAt: Date.now() - 6_000,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      error: new Error('boom'),
      promptAttribution: collector.snapshot(),
    });

    expect(trace).toBeDefined();
    // OPPOSITE DIRECTION of the two cases above. A collector that invented a
    // placeholder digest to keep the shapes symmetrical would certify bytes
    // that were never resolved — worse than the silence it replaced.
    expect(trace!.prompt_identity.some((p) => p.task_id === 'validate_graph')).toBe(false);
    // …and the absence is specifically of the IDENTITY, not of the record. The
    // call is still there, so the trace says "model known, prompt not" rather
    // than saying nothing at all.
    const call = trace!.llm_calls.find((c) => c.role === 'validate_graph');
    expect(call).toBeDefined();
    expect(call!.model).toBe('o4-mini');
  });

  it('an empty collector adds nothing — neither call ran, and the trace says so', async () => {
    const mod = await loadBuilders();
    const collector = new PromptAttributionCollector();
    // POSITIVE CONTROL for the three cases above: this same harness, this same
    // builder, with nothing recorded. Proves the assertions there are observing
    // the collector rather than something the builder emits regardless.
    expect(collector.isEmpty()).toBe(true);

    const trace = mod.buildErrorV5DiagnosticTrace({
      startedAt: Date.now() - 1_000,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      error: new Error('early failure, before any pipeline LLM call'),
      promptAttribution: collector.snapshot(),
    });

    expect(trace).toBeDefined();
    expect(trace!.prompt_identity.some((p) => p.task_id === 'draft_coaching')).toBe(false);
    expect(trace!.llm_calls.some((c) => c.role === 'draft_coaching')).toBe(false);
    expect(trace!.llm_calls.some((c) => c.role === 'validate_graph')).toBe(false);
  });
});
