/**
 * Guards for the resume reader — the piece that lets a chip click reach
 * `executeValueBatch` at all.
 *
 * ⭐ THE ROUND TRIP IS THE TEST. The proposal under test is not hand-written: it
 * is built by the real flow from the same dated capture the batch suite uses,
 * put through `JSON.parse(JSON.stringify(...))` to reproduce the JSON/JSONB
 * boundary it actually crosses, and read back. A hand-written fixture would
 * encode my model of the producer rather than the producer.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { selectValueBatchMembership } from '../readiness-value-batch.js';
import { prepareValueBatchOffer } from '../readiness-value-batch-flow.js';
import { readValueBatchResume } from '../readiness-value-batch-resume.js';
import type { PendingAction } from '../../session/pending-action.js';

const CAPTURE = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/witness-2026-08-17/j4-wrong-entity-write.json', import.meta.url),
    'utf8',
  ),
) as { draft_graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } };

function zeroConfiguredGraph() {
  const g = structuredClone(CAPTURE.draft_graph) as { nodes: Array<Record<string, unknown>> };
  for (const n of g.nodes) if (n.kind === 'option') n.interventions = {};
  return g;
}

/** Build a real pending action through the real flow, then cross the JSON boundary. */
async function realPending(): Promise<PendingAction> {
  const graph = zeroConfiguredGraph();
  const assessment = assessCanonicalAnalysisReadiness(graph);
  const cells = selectValueBatchMembership(assessment).cells;
  const out = await prepareValueBatchOffer(
    { assessment, graph, currentGraphHash: 'h', scenarioId: 's', brief: undefined },
    async () => ({
      content: JSON.stringify({
        estimates: cells.map((c, i) => ({
          option_id: c.option_id,
          factor_id: c.factor_id,
          // A mixed set on purpose: real proposals carry both.
          ...(i === 0
            ? { value: null, declined_reason: 'No basis in the brief.' }
            : { value: 0.6, reasoning: 'From the brief.', confidence: 'medium' as const }),
        })),
      }),
    }),
  );
  if (out.kind !== 'offer') throw new Error(`expected an offer, got ${out.kind}`);
  return JSON.parse(JSON.stringify(out.offer.pending)) as PendingAction;
}

const mutate = (p: PendingAction, f: (proposal: any) => void): PendingAction => {
  const clone = JSON.parse(JSON.stringify(p)) as any;
  f(clone.action.inline_patch.proposal);
  return clone as PendingAction;
};

describe('value batch resume — the round trip survives', () => {
  it('reads back a proposal the flow actually built, across the JSON boundary', async () => {
    const pending = await realPending();
    const read = readValueBatchResume(pending);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(read.proposal.complete).toBe(true);
    expect(read.proposal.cells.length).toBeGreaterThan(0);
    // PRECONDITION: the fixture really does carry both a decline and a value,
    // so the cases below are not passing on a one-shaped proposal.
    expect(read.proposal.cells.some((c) => c.value === null)).toBe(true);
    expect(read.proposal.cells.some((c) => typeof c.value === 'number')).toBe(true);
  });

  it('⭐ DISCRIMINATING PAIR: this handler reads ok, a different handler reads not_value_batch', async () => {
    const pending = await realPending();
    expect(readValueBatchResume(pending).kind).toBe('ok');
    const other = JSON.parse(JSON.stringify(pending)) as any;
    other.action.inline_patch.handler_id = 'readiness_multi_repair_v1';
    expect(readValueBatchResume(other as PendingAction).kind).toBe('not_value_batch');
  });
});

describe('value batch resume — it validates, it does not repair', () => {
  it('⭐ a null value whose declined_reason was lost is INVALID, not silently blank', async () => {
    // The honesty invariant, re-asserted on the way back in. This is the case a
    // lossy round trip actually produces, and repairing it would turn an honest
    // refusal into a blank the user cannot act on.
    const pending = await realPending();
    const broken = mutate(pending, (p) => {
      const declined = p.cells.find((c: any) => c.value === null);
      expect(declined).toBeDefined();
      delete declined.declined_reason;
    });
    expect(readValueBatchResume(broken).kind).toBe('invalid');
  });

  it('an unknown key is INVALID — a normalisation must not weaken the membership check', async () => {
    const pending = await realPending();
    expect(readValueBatchResume(mutate(pending, (p) => { p.smuggled = true; })).kind).toBe('invalid');
    expect(readValueBatchResume(mutate(pending, (p) => { p.cells[0].smuggled = true; })).kind).toBe('invalid');
  });

  it('a value outside the model unit is INVALID', async () => {
    const pending = await realPending();
    const broken = mutate(pending, (p) => {
      const valued = p.cells.find((c: any) => typeof c.value === 'number');
      valued.value = 85;
    });
    expect(readValueBatchResume(broken).kind).toBe('invalid');
  });

  it('a duplicate cell is INVALID — apply-time membership would be ambiguous', async () => {
    const pending = await realPending();
    const broken = mutate(pending, (p) => { p.cells.push(JSON.parse(JSON.stringify(p.cells[0]))); });
    expect(readValueBatchResume(broken).kind).toBe('invalid');
  });

  it('a wrong proposal_version or a missing complete flag is INVALID', async () => {
    const pending = await realPending();
    expect(readValueBatchResume(mutate(pending, (p) => { p.proposal_version = 'something_else'; })).kind).toBe('invalid');
    expect(readValueBatchResume(mutate(pending, (p) => { delete p.complete; })).kind).toBe('invalid');
  });
});
