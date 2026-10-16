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

import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

// ── Mocks — must be declared before imports ────────────────────────────────
vi.mock('../../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You are editing a graph.'),
  // The edit/review lanes resolve prompt bytes AND identity in ONE bound
  // `getSystemPromptSnapshot` call. A mock factory REPLACES the module, so
  // omitting this export hands the code under test `undefined` (trap 12).
  // Content and meta mirror the two mocks above deliberately: production
  // binds them to one resolution, and the mock must not model them as
  // independently divergent.
  getSystemPromptSnapshot: vi.fn().mockResolvedValue({
    content: 'You are editing a graph.',
    meta: { source: 'default', prompt_version: 'v2' },
  }),
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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { log } from '../../../../src/utils/telemetry.js';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * LEG 2 — the ADD-ONLY shape, driven through `handleEditGraph` on the VERBATIM
 * graph from a live staging capture.
 *
 * This is deliberately at the HANDLER, not at the detector: a sibling review
 * this week passed a spec that stopped one adapter short of the served turn and
 * a live defect survived it. `handleEditGraph`'s `assistantText` /
 * `suggestedActions` / `appliedChanges` are what the V5 dispatcher projects
 * onto the wire, so this is the closest a unit test gets to the served turn.
 *
 * Capture: staging build `69d6e6e`, golden-journey run
 * `20260811T012704Z-fresh-5e036e` (2026-08-11). User typed "Change Annual CRM
 * Spend to £63,000."; the edit_graph LLM renamed the factor to embed (£63,000)
 * and left `observed_state` byte-identical at raw_value 50000 / "£50k".
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('handleEditGraph — LEG 2: an ADDED label quantity the model does not hold', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    infoSpy = vi.spyOn(log, 'info').mockImplementation(() => log);
  });
  afterEach(() => infoSpy.mockRestore());

  const capture = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          '../../../../src/orchestrator-v5/__tests__/fixtures/label-value-divergence-capture-5e036e.json',
          import.meta.url,
        ),
      ),
      'utf8',
    ),
  ) as {
    _provenance: Record<string, unknown>;
    pre_graph: { nodes: Record<string, unknown>[]; edges: unknown[] };
  };

  it('CONTROL — the fixture is the captured payload, and the model holds £50k', () => {
    expect(capture._provenance.run).toBe('20260811T012704Z-fresh-5e036e');
    const node = capture.pre_graph.nodes.find((n) => n.id === 'fac_annual_crm_cost');
    expect(node).toBeDefined();
    expect(node!.label).toBe('Annual CRM Spend');
    expect((node!.observed_state as Record<string, unknown>).raw_value).toBe(50000);
    expect(node!.display_value).toBe('£50k');
  });
});
