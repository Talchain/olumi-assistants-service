/**
 * ⭐ DSK-P-003 (Consider-the-Opposite) REACHES THE OPENAI RUN.
 *
 * RC's fast-path directive: an explicit Run must end in ONE useful next reasoning
 * action, and names this intervention. It was never reachable on this path —
 * `selectGroundedCounterCase` is called only from `orchestrator-v5/compose.ts`
 * (the Conventional pipeline), and the Agent lane imported neither it nor
 * `lens-selector.ts`.
 *
 * ⭐ THE FIXTURE IS NOT SELF-AUTHORED. `real-robustness-enrichment.json` is the
 * enrichment captured verbatim from a REAL Agent-lane run against served
 * `16d868a` — 12 fragile edges, real ids and labels. A self-authored fixture is
 * not evidence about the wire, and this exercise only matters if it fires on what
 * the product actually emits.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const REAL = JSON.parse(
  readFileSync(new URL('./fixtures/real-robustness-enrichment.json', import.meta.url), 'utf8'),
);

const SCENARIO = '550e8400-e29b-41d4-a716-446655440000';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'u', request_id: 'r' };

function dispatchWith(enrichment: unknown): InternalDispatch {
  return async (path) => {
    if (path === '/orchestrate/v2/turn') {
      return { status: 200, json: {
        assistant_text: 'The analysis has run.',
        analysis_ready: { status: 'ready', may_run: true, blockers: [], options: [] },
        blocks: [
          ...(enrichment === undefined ? [] : [{ type: 'analysis_enrichment', enrichment }]),
          { type: 'analysis_result', summary: 'a result' },
        ],
      } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
}

describe('the explicit Run ends in one grounded next reasoning action', () => {
  it('⭐ surfaces the counter case, naming the REAL fragile link from a served run', async () => {
    const caps = createAgentCapabilities(dispatchWith(REAL), new ProposalStore());
    const r = await caps.runAnalysis(ctx, { reason: 'run it' });
    expect(r.ok).toBe(true);
    const text = String(r.consider_the_opposite ?? '');
    // Bound to the exercise's own words and to the ACTUAL labels in the served
    // enrichment — not to "some string is present".
    expect(text).toMatch(/^Take the opposite view for a moment/);
    expect(text).toContain('Revenue Growth');
    expect(text).toContain('Revenue Is Flat and Churn Is Rising');
  });

  it('⛔ it OFFERS, and never claims the result is in doubt', async () => {
    const caps = createAgentCapabilities(dispatchWith(REAL), new ProposalStore());
    const r = await caps.runAnalysis(ctx, { reason: 'run it' });
    const text = String(r.consider_the_opposite ?? '');
    // DSK-P-003's own contraindication: it must not import a magnitude claim.
    expect(text).not.toMatch(/likely to (overturn|flip|reverse)/i);
    expect(text).toMatch(/Make the strongest case that this link does not hold/);
  });

  it('⛔ CONTROL: no enrichment -> the field is ABSENT, not an empty string', async () => {
    const caps = createAgentCapabilities(dispatchWith(undefined), new ProposalStore());
    const r = await caps.runAnalysis(ctx, { reason: 'run it' });
    expect(r.consider_the_opposite).toBeUndefined();
    expect(r.ok).toBe(true); // the run itself is unaffected
  });

  it('⛔ CONTROL: a malformed enrichment never breaks the run', async () => {
    const caps = createAgentCapabilities(dispatchWith({ robustness: { fragile_edges: 'not-an-array' } }), new ProposalStore());
    const r = await caps.runAnalysis(ctx, { reason: 'run it' });
    expect(r.ok).toBe(true);
    expect(r.consider_the_opposite).toBeUndefined();
  });
});
