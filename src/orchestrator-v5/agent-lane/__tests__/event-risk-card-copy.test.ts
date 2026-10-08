import { describe, expect, it } from 'vitest';
import { productHoldRecord } from '../proposal-object/record.js';
import { GM_HELD_HANDLER_ID, buildGmHeldPublicCopy } from '../../handlers/edit-graph-referee-gate.js';
import { describeChangeset } from '../../handlers/describe-changeset.js';
import { hypothesisEdgeValue } from '../../routing/add-option-transaction.js';
import { readStatedEventRisk } from '../../routing/stated-event-risk.js';
import type { PendingAction } from '../../session/pending-action.js';
import type { PatchOperation } from '../../../orchestrator/types.js';

const graph = { nodes: [{ id: 'goal', kind: 'goal', label: 'weekly bookings' }], edges: [] };
const operations: PatchOperation[] = [
  { op: 'add_node', path: 'risk_dev', value: { id: 'risk_dev', kind: 'risk', label: 'Key developer might leave' } },
  { op: 'add_edge', path: 'risk_dev::goal', value: hypothesisEdgeValue('risk_dev', 'goal', 'negative') },
];
function hold(member?: unknown): PendingAction {
  const changeset = describeChangeset(operations, graph)!;
  const copy = buildGmHeldPublicCopy(changeset.subject, changeset.items);
  return {
    id: '11111111-1111-4111-8111-111111111111', scenario_id: '11111111-1111-4111-8111-111111111112',
    chip_id: 'gmh_aaaaaaaaaaaa',
    action: { kind: 'apply_proposed_change', proposal_ref: 'gmh_aaaaaaaaaaaa',
      public_label: copy.label, public_message: copy.message,
      inline_patch: { handler_id: GM_HELD_HANDLER_ID, operations, ...(member !== undefined ? { user_event_risk: member } : {}) } },
    preconditions: { graph_hash: 'fixed-hash' }, expires_at_turn_count: 4,
    emitted_at_iso: '2026-10-07T09:00:00.000Z', expires_at_iso: '2099-01-01T00:00:00.000Z',
  };
}
const record = (member?: unknown) => productHoldRecord(hold(member), graph, Date.parse('2026-10-07T10:00:00Z'))!;
const member = (text: string) => ({ risk_id: 'risk_dev', ...readStatedEventRisk(text)! });

describe('event-risk approval card', () => {
  it('ER-1a-range: states the held likelihood once without changing the consent words', () => {
    const control = record();
    const result = record(member('maybe 10–30% in the next 6 months'));
    const line = 'It may happen: about 10–30% within 6 months, as you said.';
    expect(result.approve_action.detail).toBe(`${control.approve_action.detail}\n${line}`);
    expect(result.approve_action.label).toBe(control.approve_action.label);
    expect(result.approve_action.message).toBe(control.approve_action.message);
  });
  it('ER-1a-single: uses a single percentage and a month', () => {
    expect(record(member('maybe 20% within a month')).approve_action.detail)
      .toContain('It may happen: about 20% within a month, as you said.');
  });
  it('ER-1a-binding: the digest binds a changed likelihood on the same held revision', () => {
    expect(record(member('maybe 10–30% within 6 months')).digest).not.toBe(record(member('maybe 20–40% within 6 months')).digest);
  });
  it('ER-1a-control: no member preserves the entire current record, including detail and digest', () => {
    expect(record()).toMatchSnapshot();
    expect(record({ risk_id: 'risk_dev', event_risk: { version: 1 }, quote: '20%' })).toEqual(record());
  });
});
