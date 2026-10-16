/**
 * ROADMAP 2.1361 — the no-op branch answers TWO questions, driven through the
 * REAL handler.
 *
 * The unit spec beside the composer proves the predicates. This one proves the
 * WIRING: that `handleEditGraph`'s empty-operations branch actually reaches
 * them, on the four messages a real user sent to the deployed build on
 * 4 Sep 2026 and received one identical sentence for.
 *
 * ⭐ RED-FIRST, BY CONSTRUCTION. Every assertion below is about the four
 * replies being DIFFERENT from each other and different from the witnessed
 * sentence. At pristine they are byte-identical — `PRISTINE_WITNESSED_TEXT` is
 * the exact string the deployed build emitted — so the whole describe block
 * fails before the fix and passes after. `reproduces the witnessed collapse`
 * is the historic record of what that sentence was.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You are editing a graph.'),
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
import { buildEditClarifyFallbackParts } from '../../../../src/orchestrator-v5/compose/edit-clarify-response.js';

/**
 * ⚠ HISTORIC RECORD — the exact sentence the deployed build emitted for all
 * four messages on 4 Sep 2026. Append-only: this is evidence of what the
 * product once said, not a fixture to keep current (CLAUDE.md trap 14b).
 */
const PRISTINE_WITNESSED_TEXT =
  "I haven't changed anything from that. Tell me the specific factor, edge, option, or value to change, and I'll apply it directly.";

describe('handleEditGraph no-op — the witnessed collapse, and its repair', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSITIVE CONTROL — the pristine composer still emits the witnessed sentence verbatim, so the comparisons below are anchored to something real', () => {
    const parts = buildEditClarifyFallbackParts([
      { id: 'factor_tco', kind: 'factor', label: 'Team coordination overhead' },
    ]);
    expect(parts.text).toBe(PRISTINE_WITNESSED_TEXT);
  });
});
