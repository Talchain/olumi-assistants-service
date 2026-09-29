/**
 * S3-L1 — retire the vestigial valueless V4 `ProposedChange` mint on the
 * edit-lane propose-and-confirm hold.
 *
 * ## What this pins (the acceptance test, at the bytes)
 *
 * The propose-and-confirm branch of `handleEditGraph` (edit-graph.ts) used to
 * return a `pendingProposal.proposed_changes` payload built from the V4
 * `ProposedChange` shape (`{description, element_label, action_type}` —
 * orchestrator/types.ts). That shape carries NO value field, and on the live V5
 * path nothing ever reads the pending back: the V5 edit dispatcher does not
 * persist it, read it back, or thread it (edit-graph-dispatch.ts:738-757). It
 * was write-only / vestigial. `propose-handoff.ts` further proves the branch
 * only fires when the message carries NO value or direction — so there is
 * nothing for the payload to carry in the first place. The value-bearing hold
 * is the V5 carrier (`orchestrator-v5/types/proposed-change.ts` →
 * `inline_patch.operations`), populated by the chip proposed-change synthesis
 * and gm-held, NOT by this branch.
 *
 * S3-L1 stops minting the write-only V4 payload. This file is the RED-first pin:
 * before the retire the branch returned `pendingProposal` + `proposedChanges`;
 * after it, it returns neither. The propose branch still fires (still surfaces
 * the "ask for the specifics" copy) — that is the positive control proving the
 * absence assertions can see the presence they deny.
 *
 * ## Positive controls (trap-13: an absence assertion that cannot see a
 *    presence is vacuous)
 *
 *  1. `routeMetadata.outcome === 'proposal_created'` — ONLY the propose branch
 *     sets this. It proves the undefined `pendingProposal` comes from THIS
 *     branch, not from a clarify / no-op / error path that also returns nothing.
 *  2. The LLM adapter THROWS if called. The propose branch returns
 *     deterministically BEFORE `getSystemPrompt('edit_graph')`, so a green test
 *     proves we never reached the LLM lane — i.e. this is genuinely the
 *     deterministic propose-and-confirm hold, the exact surface that carried the
 *     vestigial mint.
 */
import { describe, it, expect, vi } from 'vitest';

import { handleEditGraph } from '../edit-graph.js';
import type { ConversationContext } from '../../types.js';
import type { LLMAdapter } from '../../../adapters/llm/types.js';

/** A valid GraphV3 carrying a real option label ("Migrate Now") to resolve. */
function buildGraph() {
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Platform Migration' },
      { id: 'opt_a', kind: 'option', label: 'Migrate Now' },
      {
        id: 'fac_setup',
        kind: 'factor',
        label: 'Setup and Migration Complexity',
        observed_state: { value: 0.2, baseline: 0.2, unit: 'index' },
      },
      { id: 'goal_g', kind: 'goal', label: 'Total Cost' },
    ],
    edges: [
      { from: 'dec_x', to: 'opt_a', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_a', to: 'fac_setup', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_setup', to: 'goal_g', strength: { mean: -0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
    ],
  };
}

function buildContext(): ConversationContext {
  return {
    graph: buildGraph(),
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: 'scn-l1',
  } as unknown as ConversationContext;
}

/**
 * An adapter that FAILS LOUD if the edit LLM is ever called. The
 * propose-and-confirm branch returns before the prompt is loaded, so reaching
 * this throw would mean the test drove a different (LLM) path and its
 * assertions about the propose hold would be measuring the wrong branch.
 */
function throwingAdapter(): LLMAdapter {
  return {
    name: 'never',
    model: 'test-model',
    chat: vi.fn(() => {
      throw new Error('edit LLM must NOT be called on the propose-and-confirm branch');
    }),
  } as unknown as LLMAdapter;
}

/**
 * A value-less, direction-less configure request. `messageCarriesValueOrDirection`
 * is false, so `shouldHandOffProposeToLlmLane` returns false and the
 * deterministic propose-and-confirm branch terminates the turn — the exact
 * branch that minted the vestigial V4 payload.
 */
const VALUELESS_CONFIGURE = 'Configure the Migrate Now option';

async function runProposeBranch(description = VALUELESS_CONFIGURE) {
  return handleEditGraph(buildContext(), description, throwingAdapter(), 'req-l1', 'turn-l1');
}

describe('S3-L1 — the propose-and-confirm hold no longer mints the vestigial V4 ProposedChange', () => {
  it('POSITIVE CONTROL — the deterministic propose branch fires (never reaches the LLM)', async () => {
    const result = await runProposeBranch();

    // Branch identity: only the propose-and-confirm branch sets this outcome.
    expect(result.routeMetadata?.outcome).toBe('proposal_created');
    // It still surfaces the user-facing "ask for the specifics" hold copy.
    expect(result.assistantText).toBeTruthy();
    // And it did not apply anything (it is a hold, not an apply).
    expect(result.appliedGraph).toBeNull();
    expect(result.wasRejected).toBe(false);
  });

  it('RETIRE — returns NO `pendingProposal` round-trip payload (write-only on V5)', async () => {
    const result = await runProposeBranch();

    // Reachability guard: prove we are on the propose branch (else the absence
    // below is vacuous — some other path also returns no pendingProposal).
    expect(result.routeMetadata?.outcome).toBe('proposal_created');

    // The retire: the valueless V4 round-trip payload is gone.
    expect(result).not.toHaveProperty('pendingProposal');
    expect(result.pendingProposal).toBeUndefined();
  });

  it('RETIRE — returns NO top-level `proposedChanges` payload either', async () => {
    const result = await runProposeBranch();

    expect(result.routeMetadata?.outcome).toBe('proposal_created');
    expect(result).not.toHaveProperty('proposedChanges');
    expect(result.proposedChanges).toBeUndefined();
  });
});
