import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const served = JSON.parse(readFileSync(new URL('./fixtures/served-w3-520aab46-cold-read-f074916.json', import.meta.url), 'utf8'));

describe('the existing cold-read goal unit reason reaches AI context', () => {
  it('states the unit change and withholds the old saved figures', async () => {
    const read = { ...served, analysis_result: null, analysis_state: { ...served.analysis_state,
      run_state: { kind: 'complete_stale', computed_at: '2026-09-30T11:02:22.019Z', cause: 'graph_changed' },
      requires_rerun: true,
    }, current_read: { analysis_ready: { freshness: 'stale', freshness_reason: 'your goal’s unit changed' } } };
    const dispatch: InternalDispatch = async () => ({ status: 200, json: read });
    const state = await createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState({
      scenario_id: '520aab46-9ed5-4819-9d7f-498d16603943', authenticated_user_id: null, request_id: 'unit-stale-context',
    }) as Record<string, any>;
    expect(state.analysis).toMatchObject({ earlier_analysis: 'complete_stale',
      freshness_reason: 'your goal’s unit changed', requires_rerun: true });
    expect(state.analysis.saved_run_options).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain('0.2469');
  });
});
