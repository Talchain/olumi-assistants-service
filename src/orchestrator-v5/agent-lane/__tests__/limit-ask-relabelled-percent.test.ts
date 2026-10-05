/**
 * #2576 item B (DL): a limit relabelled "%" → "fraction" by the extractor's own rule is asked about as the user's
 * percent ("at most 4%"), never "at most 0.04 fraction". Through the REAL records build and the served reader.
 */
import { describe, expect, it } from 'vitest';
import type { DraftRecordSet } from '../../../cee/draft/records/grammar.js';
import { buildModelFromRecords } from '../runtime/build-model-from-records.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { openQuestionsForReply } from '../write-outcome.js';
import { limitedLevelAsks } from '../limited-level-ask.js';
import { constructionRecords, strictRecordsWire } from './records-wire-fixture.js';

type Rec = Record<string, any>;
const BRIEF = 'Raise Pro to £59 to lift MRR, with monthly churn under 4%.';
function records(): DraftRecordSet {
  const r = constructionRecords('Raise Pro to £59', 'MRR', 'Monthly churn');
  r.claims[0] = { claim_kind: 'factor', label: 'Monthly churn', value: 3, unit: '%', value_scale: 'raw_count' };
  r.stated_items.push({ kind: 'constraint', source_quote: 'monthly churn under 4%', value: 4, unit: '%', direction: 'ceiling',
    direction_span: { start: 14, end: 19 }, value_span: { start: 20, end: 21 }, applies_to_claim: 0 } as never);
  return r;
}
async function build() {
  const writes: Rec[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { writes.push(body as Rec); return { status: 200, json: {} }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] } } };
  };
  const result = await buildModelFromRecords('11111111-1111-4111-8111-111111111111', BRIEF, dispatch, async () => ({ text: JSON.stringify(strictRecordsWire(records())) }));
  expect(result.ok).toBe(true);
  return { result, graph: writes[0]!.graph as Rec };
}

describe('#2576 item B: a relabelled percent limit is said as the user\'s percent', () => {
  it('the registered row IS the relabelled fraction (identity of the case), and the served question says "at most 4%"', async () => {
    const { result, graph } = await build();
    const rows = graph.goal_constraints as Rec[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ value: 0.04, unit: 'fraction', provenance_unit_relabelled: { rule: 'percent_label_to_fraction_label' } });
    const ask = openQuestionsForReply(result).find((q) => q.includes('"Monthly churn"'));
    expect(ask).toContain('Your limit (at most 4%)');
    expect(ask).not.toContain('fraction');
  });

  it('contrast: a fraction row with NO relabel stamp is said as stored (no rule, no rewrite)', () => {
    const nodes = [{ id: 'f1', kind: 'factor', label: 'Share', observed_state: { unit: 'fraction' } }];
    const base = { constraint_id: 'c1', node_id: 'f1', operator: '<=', value: 0.04, unit: 'fraction', value_frame: 'level' as const };
    expect(limitedLevelAsks({ nodes, goal_constraints: [base] })[0]!.question).toContain('(at most 0.04 fraction)');
    const stamped = { ...base, provenance_unit_relabelled: { rule: 'percent_label_to_fraction_label' } };
    expect(limitedLevelAsks({ nodes, goal_constraints: [stamped] })[0]!.question).toContain('(at most 4%)');
    // Another rule's stamp is not this rule: unchanged.
    const other = { ...base, provenance_unit_relabelled: { rule: 'agent_lane_limit_unit_v1' } };
    expect(limitedLevelAsks({ nodes, goal_constraints: [other] })[0]!.question).toContain('(at most 0.04 fraction)');
  });
});
