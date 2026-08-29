/**
 * PRODUCER pin for `validate_graph`'s served-prompt + model attribution.
 *
 * Pass 2 is a real LLM call on every draft turn behind
 * `CEE_VALIDATION_PIPELINE_ENABLED` (measured ACTIVE), served by a model NOBODY
 * CHOSE FOR IT: `getAdapter('validate_graph')` routes through
 * TASK_TO_CONFIG_KEY → 'validation' → o4-mini. It contributed nothing to the
 * diagnostic trace, so a draft whose edge parameters came back wrong was
 * attributed entirely to `draft_graph`. Recording the model is how anyone finds
 * out whether the small model matters — without new benchmarking.
 *
 * The companion consumer suite lives at
 * `src/orchestrator-v5/diagnostics/__tests__/pipeline-prompt-attribution.test.ts`
 * and would stay green if this call site never recorded; this file is the half
 * that can see that.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CallOpts } from '../../../src/adapters/llm/types.js';

const SNAPSHOT_CONTENT = 'BOUND BYTES — resolved through getSystemPromptSnapshot.';
// ⚠ DELIBERATELY DIFFERENT from SNAPSHOT_CONTENT. With both mocks returning the
// same string, "the call was sent the snapshot's bytes" holds whichever path
// ran — a guard agreeing with itself, and it passed at pristine. Distinct bytes
// make the assertion discriminate: the bound case must see SNAPSHOT_CONTENT and
// the degraded case must see this.
const FALLBACK_CONTENT = 'FALLBACK BYTES — re-resolved through getSystemPrompt.';

// ⚠ BOTH loader entry points are mocked. A `vi.mock` factory REPLACES the
// module, so a factory naming only `getSystemPrompt` would leave
// `getSystemPromptSnapshot` undefined — the call site would throw, degrade to
// the fallback, and this suite would silently test the UNBOUND path while
// appearing to test the bound one (CLAUDE.md trap 12). The snapshot mock is
// per-test controllable so the degradation case can be driven deliberately
// rather than by accident.
const getSystemPromptSnapshot = vi.fn();
vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue(FALLBACK_CONTENT),
  getSystemPromptSnapshot: (op: string) => getSystemPromptSnapshot(op),
}));

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({
    name: 'openai',
    model: 'o4-mini',
    chat: vi.fn(),
  }),
  getMaxTokensFromConfig: vi.fn().mockReturnValue(16_384),
}));

vi.mock('../../../src/utils/json-extractor.js', () => ({
  extractJsonFromResponse: vi.fn((content: string) => ({
    json: JSON.parse(content),
    wasExtracted: false,
  })),
}));

vi.mock('../../../src/utils/telemetry.js', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  emit: vi.fn(),
}));

const { callValidateGraph } = await import(
  '../../../src/cee/validation-pipeline/validate-graph.js'
);
const { PromptAttributionCollector } = await import(
  '../../../src/orchestrator/pipeline/prompt-attribution.js'
);
const { getAdapter } = await import('../../../src/adapters/llm/router.js');

const CALL_OPTS: CallOpts = { requestId: 'req-validate-attrib', timeoutMs: 30_000 };

const NODES = [{ id: 'fac_x', kind: 'factor', label: 'X' }] as never;
const EDGES = [{ from: 'fac_x', to: 'out_y' }] as never;

function validPass2Response() {
  return {
    edges: [
      {
        from: 'fac_x',
        to: 'out_y',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.8,
        reasoning: 'Direct causal link in the brief',
        basis: 'brief_explicit',
        needs_user_input: false,
      },
    ],
    model_notes: [],
  };
}

function chatReturning(parsed: unknown, overrides: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({
    content: JSON.stringify(parsed),
    latencyMs: 30_092,
    model: 'o4-mini',
    usage: { input_tokens: 900, output_tokens: 4560 },
    stopReason: 'stop',
    ...overrides,
  });
}

function boundSnapshot() {
  return {
    content: SNAPSHOT_CONTENT,
    meta: {
      taskId: 'validate_graph',
      source: 'store',
      promptId: 'validate_graph_default',
      prompt_version: 'validate_graph_default@v4',
      prompt_hash: 'validatehash02',
    },
  };
}

describe('validate_graph (Pass 2) — served-prompt and model attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSystemPromptSnapshot.mockResolvedValue(boundSnapshot());
  });

  it('records the served prompt identity AND the o4-mini model on a successful Pass 2', async () => {
    const chat = chatReturning(validPass2Response());
    vi.mocked(getAdapter).mockReturnValue({
      name: 'openai',
      model: 'o4-mini',
      chat,
    } as never);
    const attribution = new PromptAttributionCollector();

    await callValidateGraph('a brief', NODES, EDGES, CALL_OPTS, attribution);

    expect(chat).toHaveBeenCalledTimes(1);
    const snapshot = attribution.snapshot();

    const identity = snapshot.prompt_identity.find((p) => p.task_id === 'validate_graph');
    expect(identity).toBeDefined();
    expect(identity!.hash).toBe('validatehash02');
    expect(identity!.version).toBe('validate_graph_default@v4');
    // The loader's OWN verdict, threaded verbatim. Hardcoding `'pms'` here (as
    // two sibling sites do) would LABEL a hardcoded-default prompt as
    // store-managed on the turns where the store missed.
    expect(identity!.source).toBe('store');

    const call = snapshot.llm_calls.find((c) => c.role === 'validate_graph');
    expect(call).toBeDefined();
    // ⚠ THE FINDING THIS FIELD EXISTS TO SURFACE: a small model nobody chose,
    // running on every draft turn.
    expect(call!.model).toBe('o4-mini');
    expect(call!.provider).toBe('openai');
    expect(call!.input_tokens).toBe(900);
    expect(call!.output_tokens).toBe(4560);
  });

  it('sends the SNAPSHOT bytes, so the recorded hash names the prompt the model saw', async () => {
    const chat = chatReturning(validPass2Response());
    vi.mocked(getAdapter).mockReturnValue({
      name: 'openai',
      model: 'o4-mini',
      chat,
    } as never);

    await callValidateGraph('a brief', NODES, EDGES, CALL_OPTS, new PromptAttributionCollector());

    // BOUND, not merely present. The separate-read pattern this replaced
    // (bytes from `getSystemPrompt`, meta from a second `getSystemPromptMeta`)
    // can disagree when the cache moves between the two reads — and a divergent
    // digest in `prompt_identity` CERTIFIES bytes that were never sent, which
    // is worse than reporting nothing.
    expect(chat.mock.calls[0]![0].system).toBe(SNAPSHOT_CONTENT);
  });

  it('records the call and NO identity when the snapshot could not bind — and does NOT fail the draft', async () => {
    // The snapshot's only failure mode over the plain loader is its hash
    // invariant. Pass 2 runs on every draft turn, so letting that throw would
    // trade a real capability for an observability one.
    getSystemPromptSnapshot.mockRejectedValue(
      new Error('Prompt snapshot invariant failed for \'validate_graph\''),
    );
    const chat = chatReturning(validPass2Response());
    vi.mocked(getAdapter).mockReturnValue({
      name: 'openai',
      model: 'o4-mini',
      chat,
    } as never);
    const attribution = new PromptAttributionCollector();

    const result = await callValidateGraph(
      'a brief',
      NODES,
      EDGES,
      CALL_OPTS,
      attribution,
    );

    // The DRAFT still works — the bytes re-resolved through the old path, and
    // the distinct fixture proves it was that path and not the snapshot's.
    expect(result.edges).toHaveLength(1);
    expect(chat.mock.calls[0]![0].system).toBe(FALLBACK_CONTENT);

    const snapshot = attribution.snapshot();
    // OPPOSITE-DIRECTION TWIN of case 1. An unbound resolution must never be
    // attributed: no hash, no identity, no placeholder digest.
    expect(snapshot.prompt_identity.some((p) => p.task_id === 'validate_graph')).toBe(false);
    // …and the absence is of the IDENTITY only. The model is still knowable and
    // still recorded, so the trace says "model known, prompt not" rather than
    // going silent about a call that definitely happened.
    const call = snapshot.llm_calls.find((c) => c.role === 'validate_graph');
    expect(call).toBeDefined();
    expect(call!.model).toBe('o4-mini');
  });

  it('attributes a TRUNCATED Pass 2 — recorded before the guard that throws', async () => {
    const chat = chatReturning(validPass2Response(), { stopReason: 'length' });
    vi.mocked(getAdapter).mockReturnValue({
      name: 'openai',
      model: 'o4-mini',
      chat,
    } as never);
    const attribution = new PromptAttributionCollector();

    await expect(
      callValidateGraph('a brief', NODES, EDGES, CALL_OPTS, attribution),
    ).rejects.toThrow(/truncated/);

    // A budget-exhausted Pass 2 is precisely the failure someone needs the
    // model and the cap attributed for. Recording after the truncation guard
    // would leave the trace silent on the outcome it is most needed for.
    const snapshot = attribution.snapshot();
    expect(snapshot.prompt_identity.some((p) => p.task_id === 'validate_graph')).toBe(true);
    expect(snapshot.llm_calls.some((c) => c.role === 'validate_graph')).toBe(true);
  });

  it('runs unchanged when no collector is threaded (guarded no-op)', async () => {
    const chat = chatReturning(validPass2Response());
    vi.mocked(getAdapter).mockReturnValue({
      name: 'openai',
      model: 'o4-mini',
      chat,
    } as never);

    const result = await callValidateGraph('a brief', NODES, EDGES, CALL_OPTS);

    expect(result.edges).toHaveLength(1);
  });
});
