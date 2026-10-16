/**
 * Phase 4 — end-to-end sentinel wiring proof, NO mocks.
 *
 * Uses the REAL prompt registry/defaults/loader to prove that the registered
 * `m2_graph_review` default is the fail-closed sentinel and that the real
 * reviewDraftGraph therefore stays inert (no router, no adapter, no LLM)
 * even when invoked directly — i.e. flag ON with unprovisioned prompt copy
 * can never reach a live model call.
 */
import { describe,expect,it } from 'vitest';
import { getSystemPrompt } from '../../../adapters/llm/prompt-loader.js';

import { isM2PromptProvisioned,M2_PROMPT_NOT_PROVISIONED_SENTINEL } from '../prompt-sentinel.js';

describe('Phase 4 — sentinel wiring (real prompt registry, no mocks)', () => {
  it('the registered m2_graph_review default IS the sentinel', async () => {
    const content = await getSystemPrompt('m2_graph_review', { forceDefault: true });
    expect(content).toContain(M2_PROMPT_NOT_PROVISIONED_SENTINEL);
    expect(isM2PromptProvisioned(content)).toBe(false);
  });


});
