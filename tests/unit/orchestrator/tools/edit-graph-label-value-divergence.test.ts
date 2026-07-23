/**
 * P0 — label edits that carry a changed quantitative value must not silently
 * corrupt the model with a success-claiming receipt.
 *
 * Live critique (user-seat, build e7f312d, scenario 7b0f2246): the user asked
 * "change the raise option from $49 to $39"; after a clarifier the reply was
 * "Updated the raise option label from $49 to $39" but the option's
 * `fac_price` intervention stayed 0.49 — the label now says $39 while every
 * re-run computes $49. The edit_graph LLM emits a LABEL-ONLY `update_node`
 * (renames the label to embed $39) and touches no intervention; the
 * deterministic receipt treats a label-only update as cosmetic ("Renamed …")
 * and claims success.
 *
 * Doctrine (b): apply the label (what the op asked) but DISCLOSE the
 * divergence honestly — never silently mutate the modelled value (a different
 * consent class). The bare success claim must become impossible; a typed
 * configure affordance must be offered.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks — must be declared before imports ────────────────────────────────
vi.mock('../../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You are editing a graph.'),
}));

vi.mock('../../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === 'cee') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ceeTarget, ceeProp) {
              if (ceeProp === 'maxRepairRetries') return 1;
              if (ceeProp === 'patchPreValidationEnabled') return false;
              if (ceeProp === 'patchBudgetEnabled') return false;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import { handleEditGraph } from '../../../../src/orchestrator/tools/edit-graph.js';
import { log } from '../../../../src/utils/telemetry.js';
import type { ConversationContext } from '../../../../src/orchestrator/types.js';
import type { LLMAdapter } from '../../../../src/adapters/llm/types.js';
import type { PLoTClient, ValidatePatchResult } from '../../../../src/orchestrator/plot-client.js';

// ── Helpers ────────────────────────────────────────────────────────────────
function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
        { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 0.49, unit: 'GBP', cap: 100 } },
        {
          id: 'opt_raise',
          kind: 'option',
          label: 'Raise price to $49',
          interventions: {
            fac_price: {
              value: 0.49,
              raw_value: 49,
              source: 'user_specified',
              target_match: { node_id: 'fac_price', match_type: 'exact_id', confidence: 'high' },
            },
          },
        },
      ],
      edges: [
        {
          from: 'fac_price',
          to: 'goal_revenue',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'positive',
        },
        {
          from: 'opt_raise',
          to: 'fac_price',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'positive',
        },
      ],
    } as unknown as ConversationContext['graph'],
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: 'test-scenario',
    ...overrides,
  };
}

function makeAdapter(responseJson: unknown): LLMAdapter {
  return {
    name: 'test',
    model: 'test-model',
    chat: vi.fn().mockResolvedValue({ content: JSON.stringify(responseJson) }),
    draftGraph: vi.fn(),
    repairGraph: vi.fn(),
    suggestOptions: vi.fn(),
    clarifyBrief: vi.fn(),
    critiqueGraph: vi.fn(),
    explainDiff: vi.fn(),
  } as unknown as LLMAdapter;
}

function makePlotClientSuccess(): PLoTClient {
  const result: ValidatePatchResult = { kind: 'success', data: { verdict: 'accepted' } };
  return {
    run: vi.fn().mockResolvedValue({}),
    validatePatch: vi.fn().mockResolvedValue(result),
  } as unknown as PLoTClient;
}

// The exact leaking shape: a LABEL-ONLY rename that embeds a changed price.
const LABEL_ONLY_PRICE_RENAME = {
  op: 'update_node',
  path: 'opt_raise',
  value: { label: 'Raise price to $39' },
  old_value: { label: 'Raise price to $49' },
};

describe('handleEditGraph — label edit with a diverged modelled value (P0)', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    infoSpy = vi.spyOn(log, 'info').mockImplementation(() => log);
  });
  afterEach(() => infoSpy.mockRestore());

  it('discloses the divergence instead of claiming a bare success', async () => {
    const adapter = makeAdapter({
      operations: [LABEL_ONLY_PRICE_RENAME],
      warnings: [],
      coaching: { summary: 'Updated the raise option label from $49 to $39.', rerun_recommended: false },
    });

    const result = await handleEditGraph(
      makeContext(),
      'the raise one — change it to $39',
      adapter,
      'req-div-1',
      'turn-1',
      { plotClient: makePlotClientSuccess() },
    );

    expect(result.wasRejected).toBe(false);
    expect(result.assistantText).toBeTruthy();
    const text = (result.assistantText ?? '').toLowerCase();
    // The disclosure must make the model/label divergence explicit.
    expect(text).toMatch(/modelled value|display text only/);
    expect(text).toMatch(/unchanged|still/);
    // It must name BOTH the old and new numbers so the user sees the gap.
    expect(result.assistantText).toContain('$39');
    expect(result.assistantText).toContain('$49');
  });

  it('offers a typed configure affordance to actually change the value', async () => {
    const adapter = makeAdapter({
      operations: [LABEL_ONLY_PRICE_RENAME],
      warnings: [],
      coaching: { summary: 'Updated the raise option label from $49 to $39.', rerun_recommended: false },
    });

    const result = await handleEditGraph(
      makeContext(),
      'the raise one — change it to $39',
      adapter,
      'req-div-2',
      'turn-2',
      { plotClient: makePlotClientSuccess() },
    );

    const actions = result.suggestedActions ?? [];
    expect(actions.length).toBeGreaterThan(0);
    // A configure chip whose replayed prompt routes to the configure-option lane.
    const configure = actions.find((a) => /configure/i.test(a.label) || /help me configure/i.test(a.prompt));
    expect(configure).toBeDefined();
  });

  it('applied-changes receipt does not read as a completed value change', async () => {
    const adapter = makeAdapter({
      operations: [LABEL_ONLY_PRICE_RENAME],
      warnings: [],
      coaching: { summary: 'Updated the raise option label from $49 to $39.', rerun_recommended: false },
    });

    const result = await handleEditGraph(
      makeContext(),
      'the raise one — change it to $39',
      adapter,
      'req-div-3',
      'turn-3',
      { plotClient: makePlotClientSuccess() },
    );

    const receipt = result.appliedChanges;
    expect(receipt).toBeDefined();
    // A bare "Renamed …" success is exactly the leak — it must be gone.
    expect(receipt!.summary).not.toMatch(/^Renamed "/);
    expect(receipt!.summary.toLowerCase()).toMatch(/display text only|modelled value/);
    // Nothing modelled changed → no rerun should be recommended.
    expect(receipt!.rerun_recommended).toBe(false);
  });
});

describe('handleEditGraph — negative control: pure rename with no number stays plain', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    infoSpy = vi.spyOn(log, 'info').mockImplementation(() => log);
  });
  afterEach(() => infoSpy.mockRestore());

  it('a label rename carrying no numeric change is not treated as a divergence', async () => {
    const adapter = makeAdapter({
      operations: [
        {
          op: 'update_node',
          path: 'opt_raise',
          value: { label: 'Raise the headline price' },
          old_value: { label: 'Raise price to $49' },
        },
      ],
      warnings: [],
      coaching: { summary: 'Renamed the option.', rerun_recommended: false },
    });

    const result = await handleEditGraph(
      makeContext(),
      'rename the raise option',
      adapter,
      'req-neg-1',
      'turn-neg-1',
      { plotClient: makePlotClientSuccess() },
    );

    // Old label had $49 but the new label has no number → not a divergence
    // (removing an annotation is not a value change). No phantom disclosure.
    const text = (result.assistantText ?? '').toLowerCase();
    expect(text).not.toMatch(/modelled value|display text only/);
    const actions = result.suggestedActions ?? [];
    expect(actions.find((a) => /configure/i.test(a.label))).toBeUndefined();
  });
});
