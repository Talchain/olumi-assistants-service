/**
 * ⛔ DO NOT MERGE — MG BASELINE V1 RESTORE REHEARSAL (DL #72 5869259374).
 *
 * This file lives only on the never-merged draft restore PR. That PR puts the five construction-surface files back to
 * their Baseline v1 blobs (CEE `d202fc5db141d646045ac77f67b0b08a8230454b`) on top of CURRENT staging; this spec then
 * proves, with 0 LLM calls, that the restored tree builds the reference construction request: the instructions, output
 * schema and tool-surface hashes equal the manifest's
 * (olumi-programme-docs `mg/baseline-v1-20260928` programme/2026-09-28/MG-BASELINE-V1-MANIFEST.md).
 * Served witness for the instructions hash: `_provider_calls[].prompt_sha256` on 27/27 first-build calls.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import { BUILD_INSTRUCTIONS, buildCandidateSchema } from '../runtime/build-model.js';
import { agentPromptIdentity } from '../runtime/prompt-identity.js';
import { toolsFor } from '../runtime/agent-tools.js';
import { budgetFor } from '../model-budgets.js';

const sha = (x: unknown): string => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');

describe('Baseline v1: the restored tree sends the reference construction request', () => {
  it('construction instructions = the served ledger hash', () => {
    expect(agentPromptIdentity('agent.construct', BUILD_INSTRUCTIONS).prompt_sha256)
      .toBe('33c25766bee5e776dac8603529501eb76de8a776db1aeb108307b00e8930326d');
  });

  it('output schema (whole_candidate) = the manifest hash', () => {
    expect(sha(buildCandidateSchema())).toBe('8b99fd091b63ded3260d99c593258c698be89d916df91a34594dd71dc39e10c4');
  });

  it('tool surface (full mode) and the build tool = the manifest hashes', () => {
    expect(sha(toolsFor('full'))).toBe('f05f96080b29b40f2df5f6fa61a00d528d2a2e6375d97ad00385d72ef4a20f49');
    expect(sha(toolsFor('full').find((t) => t.name === 'build_model_from_brief'))).toBe('c1f3643a5001007877b2a1c67ee7c33bc85f971424d55589eba683f3e637830b');
  });

  it('model, effort and budget = the manifest', () => {
    expect(budgetFor('gpt-5.6-terra', 'whole')).toMatchObject({ model: 'gpt-5.6-terra', max_output_tokens: 12000, reasoning_effort: 'medium' });
    expect(budgetFor('gpt-5.6-terra', 'conversation')).toMatchObject({ model: 'gpt-5.6-terra', max_output_tokens: 3400, reasoning_effort: 'low' });
  });
});
