/**
 * ⛔ THE PRODUCER HALF OF THE decision_review SKIP (independent review of #1744,
 * 5796462881, mutant M5).
 *
 * `chip-click-dispatch.ts` skips the legacy (Anthropic) decision_review ONLY when the
 * run_analysis request carries `chip.id === AGENT_RUN_ANALYSIS_CHIP_ID`. The consumer
 * side is pinned; the producer was not: changing ONLY what `runAnalysis` sends left
 * 451 tests in 60 files green while decision_review ran again on every Agent analysis.
 * This drives the REAL `runAnalysis` and asserts the request it dispatches carries the
 * SAME constant the dispatcher matches on, on the chip-click path the dispatcher reads.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { AGENT_RUN_ANALYSIS_CHIP_ID } from '../../handlers/agent-chip-ids.js';

const ctx = { scenario_id: '3c2d1e0f-4a5b-4c6d-8e7f-9a0b1c2d3e4f', authenticated_user_id: 'user-a', request_id: 'r' };

describe('the Agent’s run_analysis names itself to the dispatcher', () => {
  it('RED: the dispatched request carries chip.id === AGENT_RUN_ANALYSIS_CHIP_ID, as a run_analysis chip click', async () => {
    const sent: { path: string; body: Record<string, unknown> }[] = [];
    const dispatch: InternalDispatch = async (path, body) => {
      sent.push({ path, body: body as Record<string, unknown> });
      return { status: 200, json: { analysis_ready: { status: 'ready' }, blocks: [] } };
    };
    const caps = createAgentCapabilities(dispatch, new ProposalStore());
    await caps.runAnalysis(ctx, { reason: 'compare the options' });
    const runs = sent.filter((s) => s.path === '/orchestrate/v2/turn');
    expect(runs).toHaveLength(1);
    const body = runs[0].body as { source?: unknown; chip?: { id?: unknown; action_type?: unknown } };
    expect(body.chip?.id).toBe(AGENT_RUN_ANALYSIS_CHIP_ID);
    expect(body.chip?.action_type).toBe('run_analysis');
    // The dispatcher's deterministic chip branch is taken only for a non-composer source.
    expect(body.source).toBe('chip_click');
  });
});
