/**
 * ⭐ THE ADOPTION MARKER IS WRITTEN BY THE ADOPTION ALONE (AIQ 5922034166; CODEX CEE BUDDY 5922079681; DL 5922063185).
 *
 * `user_assumption` + `reviewed_by_user` is how the approved adoption records Olumi's figure, accepted
 * (`isAcceptedOlumiEstimate`). Both same-value review writers — the canvas confirm (`set_factor_value`'s `reviewOnly`,
 * driven here through the REAL `applyFactorValueEdit`) and the chat restatement (`stampUserEditProvenance` after the
 * REAL `canonicaliseValueOps`) — used to record that same review on ANY figure that was not `user_override`, so a
 * confirm of the user's own assumption forged the marker and the figure read as Olumi's. Rows, per writer:
 *   · BARE (the user's own figure, marked as their assumption) + a same-value confirm → no review, still the user's;
 *   · ADOPTED + a same-value confirm → the marker kept byte for byte, still Olumi's, accepted;
 *   · CONTROL: Olumi's `cee_inference` figure + the same confirm → reviewed, as before (the rows are not vacuous).
 */
import { describe, expect, it } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

import { applyFactorValueEdit } from '../factor-value-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { canonicaliseValueOps, stampUserEditProvenance } from '../../../orchestrator/canonicalise-value-ops.js';
import { observedValueAuthorship } from '../../../cee/transforms/provenance-display.js';
import type { PatchOperation } from '../../../orchestrator/types.js';

const SCENARIO_ID = '0938f068-2b83-4a77-9b47-def252ac03f0';
const TARGET = 'monthly_churn';
const AT = '2026-09-30T23:00:00.000Z';
type Os = Record<string, unknown> & { source?: string; reviewed_by_user?: { intent?: string; at?: string } };

/** The brief's 3.2 % (`explicit`), marked as the user's own assumption — no review. */
const BARE: Os = { unit: '%', value: 0.032, raw_value: 3.2, source: 'user_assumption', extractionType: 'explicit' };
/** Olumi's 3.2 %, adopted through an approved proposal: the writer's own stored pair. */
const ADOPTED: Os = { unit: '%', value: 0.032, raw_value: 3.2, source: 'user_assumption', reviewed_by_user: { intent: 'confirm', at: AT } };
/** Olumi's own unconfirmed estimate. */
const OLUMIS: Os = { unit: '%', value: 0.032, raw_value: 3.2, source: 'cee_inference', extractionType: 'inferred' };

function graphWith(observed: Os): Record<string, unknown> {
  return {
    goal_node_id: 'mrr',
    nodes: [
      { id: 'mrr', kind: 'goal', label: 'MRR' },
      { id: TARGET, kind: 'factor', label: 'Monthly churn', provenance: 'ai_inferred', observed_state: structuredClone(observed) },
      { id: 'o-hold', kind: 'option', label: 'Hold price' },
    ],
    edges: [{ from: TARGET, to: 'mrr', strength: { mean: -0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' }],
  };
}
const nodeOf = (g: unknown) => (g as { nodes: Array<{ id: string; observed_state?: Os }> }).nodes.find((n) => n.id === TARGET)!;

async function canvasConfirm(observed: Os): Promise<{ os: Os; same: boolean }> {
  const base = graphWith(observed);
  // SD-1 (#2617): the confirm a client sends is the SET of the number the factor shows, plus the intent: DGAI #2543's
  // builder (`factorValueEdit.ts:636-655`) on this capless percent sends the stored raw_value and unit verbatim, so a
  // confirm is checked against the stored figure. The rows still pin the adoption marker, not the event's shape.
  const payload = { kind: 'system_event', scenario_id: SCENARIO_ID, turn_id: '77777777-7777-4777-8777-777777777777', stage: 'analyse',
    event: { kind: 'factor_value_edit', target_id: TARGET, field: 'value', intent: 'confirm_current', value: 3.2, raw_value: 3.2, unit: '%' } } as unknown as SystemEventTurnPayload;
  const r = await applyFactorValueEdit({ payload, event: payload.event as never, requestId: 'req-confirm', persistedGraph: base, priorFacts: [] } as never);
  expect(r.kind, JSON.stringify(r)).toBe('mutated');
  const g = (r as { mutatedGraph: unknown }).mutatedGraph;
  return { os: nodeOf(g).observed_state!, same: computeAnalysisAffectingGraphHash(g as never) === computeAnalysisAffectingGraphHash(base as never) };
}

function chatRestatement(observed: Os): Os {
  const graph = graphWith(observed);
  const ops = [{ op: 'update_node', path: TARGET, value: { observed_state: { value: 0.032, raw_value: 3.2, unit: '%' } } }] as unknown as PatchOperation[];
  const [out] = stampUserEditProvenance(canonicaliseValueOps(ops, graph).operations, ops, graph as never, () => false);
  return ((out!.value as Record<string, unknown>).observed_state ?? {}) as Os;
}

describe('the canvas confirm (set_factor_value reviewOnly)', () => {
  it('RED: the user\'s own assumption, confirmed, gets no review and stays THEIRS', async () => {
    const { os, same } = await canvasConfirm(BARE);
    expect(os.source).toBe('user_assumption');
    expect(os).not.toHaveProperty('reviewed_by_user');
    expect(observedValueAuthorship(os)).toEqual({ source: 'user', provenance: 'user_set' });
    expect(same).toBe(true);
  });

  it('the adopted figure, confirmed again, keeps its marker byte for byte and stays Olumi\'s', async () => {
    const { os } = await canvasConfirm(ADOPTED);
    expect(os.reviewed_by_user).toEqual({ intent: 'confirm', at: AT });
    expect(observedValueAuthorship(os)).toEqual({ source: 'assumption', provenance: 'ai_inferred' });
  });

  it('CONTROL: Olumi\'s unconfirmed estimate, confirmed, is reviewed as before', async () => {
    const { os } = await canvasConfirm(OLUMIS);
    expect(os.source).toBe('cee_inference');
    expect(os.reviewed_by_user?.intent).toBe('confirm');
  });
});

describe('the chat restatement (stampUserEditProvenance after canonicaliseValueOps)', () => {
  it('RED: the user\'s own assumption, restated, gets no review and stays THEIRS', () => {
    const os = chatRestatement(BARE);
    expect(os.source).toBe('user_assumption');
    expect(os).not.toHaveProperty('reviewed_by_user');
    expect(observedValueAuthorship(os)).toEqual({ source: 'user', provenance: 'user_set' });
  });

  it('the adopted figure, restated, keeps its marker and stays Olumi\'s', () => {
    const os = chatRestatement(ADOPTED);
    expect(os.reviewed_by_user).toEqual({ intent: 'confirm', at: AT });
    expect(observedValueAuthorship(os)).toEqual({ source: 'assumption', provenance: 'ai_inferred' });
  });

  it('CONTROL: Olumi\'s unconfirmed estimate, restated, is reviewed as before', () => {
    const os = chatRestatement(OLUMIS);
    expect(os.source).toBe('cee_inference');
    expect(os.reviewed_by_user?.intent).toBe('confirm');
  });
});
