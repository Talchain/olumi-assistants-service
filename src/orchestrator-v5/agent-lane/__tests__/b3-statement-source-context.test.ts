/** B3's projection reaches the existing real-route provider boundary; transport replies are native fixtures only. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { capture, captureDir, findState, object, type Turn } from '../../../routes/__tests__/context-contract/provider-harness.js';

const turns: Turn[] = ['Run-explanation', 'ordinary-converse', 'selected-converse', 'chip-converse', 'drawn-link',
  'pre-mortem', 'widen-options', 'widen-risks', 'tool-continuation'];
const pins: Record<string, string[]> = {};

describe('B3: complete source facts in the actual serialized request', () => {
  it.each(turns)('%s retains the declaration and scoped comparison input facts', async turn => {
    const w = await capture(turn, 'run2');
    pins[turn] = w.calls.map(c => c.sha256);
    // Bank exact request bytes even for a failing reversal; never rewrite a shared fixture from this test.
    if (captureDir !== undefined) {
      mkdirSync(captureDir, { recursive: true });
      writeFileSync(`${captureDir}/b3-current-sha256.json`, `${JSON.stringify(pins, null, 2)}\n`);
    }
    expect(w.calls.length).toBeGreaterThan(0);
    for (const c of w.calls) {
      const facts = object(findState(c.payloads).run_facts);
      expect(object(facts.capability)).toMatchObject({ declaration_version: 1, authority: 'cee_source_contract', engine_attestation: 'unverified' });
      expect(object(object(facts.input_basis).factor_starting_values).coverage).toBe('material_factor_starting_values_only');
      expect(facts).not.toHaveProperty('may_run');
      expect(c.sentBody.split('Lead with the supported current finding or precise limitation')).toHaveLength(2);
    }
  }, 60000);

  it('the interpreter receives the full saved source, conditions, negation and reading, without approval from storage', async () => {
    let expectedRecord: unknown;
    let expectedNodeId: unknown;
    const w = await capture('Run-explanation', 'run2', { readSnapshot: async snapshot => {
      const goal = snapshot.graph.nodes.find(n => n.kind === 'goal')!;
      expectedNodeId = goal.id;
      const quote = 'I do not agree that the change is assured if onboarding slips';
      expectedRecord = { subject_key: `goal|${goal.id}|||measure`, field: 'measure', recorded_at: '2026-10-15T01:00:00Z',
        attest: { recorded_by: 'construction' }, statements: [{ speaker: 'user', quote,
          source: `Our support lead expects improvement. ${quote}.`, subject: { quantity: 'measure', node_id: goal.id },
          form: 'describes', negated: true, conditions: 'if onboarding slips', period: 'six weeks',
          answering: 'What remains disputed?', reading: 'olumi' }] };
      goal.user_statements = [expectedRecord];
      return snapshot;
    } });
    for (const c of w.calls) {
      expect(object(findState(c.payloads).run_facts).user_statements).toContainEqual({
        node_id: expectedNodeId, record: expectedRecord,
        approval_evidence: { status: 'unknown', missing: 'bound_statement_approval_receipt' },
      });
    }
  }, 60000);
});
