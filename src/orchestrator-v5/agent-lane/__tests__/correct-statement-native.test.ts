import { describe, expect, it } from 'vitest';
import { correctionWorld, type Rec } from './corrections-stage2-world.js';
import { userStatementRecord, userStatementFor } from '../../statement-door/statements.js';
import { applyStatementRecordEdit, approvedStatementRecordOf } from '../../goal-target/cohort-forecast-write.js';
import type { StatementCorrectionRequest } from '../../statement-door/fields/correction.js';

const cases = [
  { name: 'distribution', factor: 'Dispatch updates', risk: 'Service disruption', retained: 'delayed scans', withdrawn: 'the entire shift has stopped' },
  { name: 'laboratory', factor: 'Sample log', risk: 'Quality concern', retained: 'delayed labels', withdrawn: 'all batches are contaminated' },
];
function fixture(row: typeof cases[number]) {
  const old = `${row.factor} and ${row.risk} report ${row.retained} and ${row.withdrawn}.`;
  const message = `For ${row.factor} and ${row.risk}, retract “${row.withdrawn}”; keep “${row.retained}” as the report.`;
  const subject = { kind: 'factor' as const, id: 'report', field: 'relation' as const };
  const other = { kind: 'risk' as const, id: 'risk', field: 'holds_now' as const };
  const record = (s: typeof subject | typeof other) => userStatementRecord(s, [{ speaker: 'user', source: old, quote: old,
    form: 'describes', subject: { quantity: 'reported_account', node_id: s.id }, reading: 'olumi' }], '2026-08-01T00:00:00Z', { recorded_by: 'construction' });
  const graph: Rec = { nodes: [
    { id: 'goal', kind: 'goal', label: 'Reliable handling' },
    { id: 'report', kind: 'factor', label: row.factor, provenance: 'from_brief', user_statements: [record(subject)],
      observed_state: { value: 0.6, raw_value: 60, unit: '%', source: 'cee_inference' } },
    { id: 'risk', kind: 'risk', label: row.risk, provenance: 'unverified_brief', already_true_quote: old, user_statements: [record(other)] },
    { id: 'option', kind: 'option', label: 'Explore process changes', interventions: { report: { value: 0.8, raw_value: 80, unit: '%' } } },
    { id: 'dissent', kind: 'outcome', label: 'Team reservation', description: 'The evening team disputes the proposed mechanism.', provenance: 'from_brief' },
  ], edges: [ { from: 'option', to: 'report', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'report', to: 'goal', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
    { from: 'risk', to: 'goal', strength: { mean: -0.3, std: 0.1 }, exists_probability: 0.6, effect_direction: 'negative' } ] };
  const retirement = { quote: row.withdrawn, scope: 'part' as const, disposition: 'retracted' as const };
  const request: StatementCorrectionRequest = { quote: message, edits: [
    { subject, retirement, retained: [row.retained], reading_words: 'reported delay; the universal claim is withdrawn' },
    { subject: other, retirement, retained: [row.retained], reading_words: 'reported delay; the universal claim is withdrawn',
      legacy: { field: 'already_true_quote', expected: old, replacement: null } },
  ] };
  return { graph, message, subject, other, request };
}
const withoutRef = ({ ref: _ref, ...node }: Rec) => node;

describe.each(cases)('$name: correct_statement on the existing native operation', row => {
  it('proposal → persisted own card → one real register → full readback → cold native read', async () => {
    const f = fixture(row), w = await correctionWorld(f.graph, f.message);
    const result = await w.offer('propose_statement', { correction: f.request });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    expect(w.writes).toHaveLength(0);
    const pid = String(result.proposal_id), proposal = w.proposals.get(pid)!;
    expect(proposal.operations.map(o => o.op)).toEqual(['set_statement_record']);
    const chips = w.chips('propose_statement', result);
    expect(chips[0]!.id).toBe(`agent-approve-proposal:${pid}`);
    expect(chips[0]!.detail).toBe(result.public_label);
    expect(result.public_label).toContain(row.withdrawn);
    expect(result.public_label).toContain(`Keep explicitly: “${row.retained}”`);
    expect(result.public_label).toContain('Current evidence claim:');
    const restored = w.restoreCard(proposal, result);
    expect(restored.get(pid)).toEqual(proposal);
    const applied = await w.press(pid, restored);
    expect(applied, JSON.stringify({ applied, responses: w.responses })).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(w.registers).toHaveLength(1); expect(w.writes).toHaveLength(1);
    for (const s of [f.subject, f.other]) {
      const statements = userStatementFor(w.graph(), s)!.statements;
      expect(userStatementFor(w.graph(), s)!.attest).toEqual({ recorded_by: 'correction', disposition: 'retracted', scope: 'part' });
      expect(statements[0]).toMatchObject({ source: f.message, quote: f.message,
        speaker: 'user', reading: 'olumi', conditions: row.retained, subject: { node_id: s.id } });
      expect(statements[1]).toMatchObject({ source: f.graph.nodes[1].user_statements[0].statements[0].source,
        speaker: 'user', reading: 'olumi', qualifier: row.retained, subject: { node_id: s.id } });
    }
    expect(w.graph().nodes.find((n: Rec) => n.id === 'risk')).not.toHaveProperty('already_true_quote');
    for (const id of ['option', 'dissent']) expect(withoutRef(w.graph().nodes.find((n: Rec) => n.id === id))).toEqual(f.graph.nodes.find((n: Rec) => n.id === id));
    const saved = structuredClone(w.graph()), cold = await w.cold();
    expect(cold.status, JSON.stringify(cold.body)).toBe(200);
    expect(cold.body.graph).toEqual(saved);
    expect(w.writes).toHaveLength(1);
    expect(await w.press(pid, restored)).toMatchObject({ ok: true, already_applied: true });
    expect(w.writes).toHaveLength(1);
  });

  it('an unrelated dated revenue quote cannot retire either record', async () => {
    const f = fixture(row), quote = 'Revenue was £2m as of 2026-09-01; the filing deadline is next month.';
    const w = await correctionWorld(f.graph, quote);
    const result = await w.offer('propose_statement', { correction: { ...f.request, quote } });
    expect(result.ok).toBe(false); expect(w.writes).toHaveLength(0);
    expect(w.graph()).toEqual(f.graph);
  });

  it('retained source is kept without making the user repeat its original wording', async () => {
    const f = fixture(row), message = `For ${row.factor} and ${row.risk}, retract “${row.withdrawn}”. Keep the original delay report with its source.`;
    const w = await correctionWorld(f.graph, message);
    const result = await w.offer('propose_statement', { correction: { ...f.request, quote: message } });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((await w.press(String(result.proposal_id))).ok).toBe(true);
    const kept = userStatementFor(w.graph(), f.subject)!.statements[1]!;
    expect(kept.source).toBe(f.graph.nodes[1].user_statements[0].statements[0].source);
    expect(kept.quote).toBe(kept.source);
    expect(kept.qualifier).toBe(row.retained);
  });

  it('historical and retracted remain distinguishable on a cold read', async () => {
    const f = fixture(row), message = `For ${row.factor} and ${row.risk}, mark “${row.withdrawn}” historical. Keep the earlier delay report.`;
    const request = structuredClone(f.request) as Rec;
    request.quote = message;
    for (const edit of request.edits) edit.retirement.disposition = 'historical';
    const w = await correctionWorld(f.graph, message), result = await w.offer('propose_statement', { correction: request });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((await w.press(String(result.proposal_id))).ok).toBe(true);
    const cold = await w.cold(); expect(cold.status).toBe(200);
    for (const s of [f.subject, f.other]) expect(userStatementFor(cold.body.graph, s)!.attest)
      .toEqual({ recorded_by: 'correction', disposition: 'historical', scope: 'part' });
    expect(w.writes).toHaveLength(1);
  });

  it('a legacy claim with unknown original source does not gain a manufactured human quote', async () => {
    const f = fixture(row), graph = structuredClone(f.graph);
    delete graph.nodes[2].user_statements;
    const w = await correctionWorld(graph, f.message);
    const result = await w.offer('propose_statement', { correction: { quote: f.message, edits: [f.request.edits[1]] } });
    expect(result.ok, JSON.stringify(result)).toBe(true); expect((await w.press(String(result.proposal_id))).ok).toBe(true);
    const retained = userStatementFor(w.graph(), f.other)!.statements[1]!;
    expect(retained.source).toBe(f.message); expect(retained.quote).toBe(f.message);
    expect(retained.conditions).toContain('original source is unverified');
    expect(retained).not.toHaveProperty('low'); expect(retained).not.toHaveProperty('high');
  });

  it('a clarified relative claim replaces the old effect record without sizing the link', async () => {
    const f = fixture(row), graph = structuredClone(f.graph);
    const source = `${row.factor} reduces Reliable handling by 12%, without specifying the reference.`;
    const subject = { kind: 'link' as const, id: 'report', to_id: 'goal', field: 'effect' as const };
    graph.nodes[1].user_statements.push(userStatementRecord(subject, [{ source, quote: source, speaker: 'user', reading: 'olumi',
      form: 'point', low: 12, high: 12, unit: '%', subject: { quantity: 'effect', node_id: 'report' } }], '2026-08-01T00:00:00Z', { recorded_by: 'construction' }));
    const message = `For ${row.factor} and Reliable handling, the 12% is a relative claim from an external study; the study baseline is unavailable.`;
    const w = await correctionWorld(graph, message);
    const result = await w.offer('propose_statement', { correction: { quote: message, edits: [{ subject,
      retirement: { quote: source, scope: 'whole', disposition: 'historical' }, retained: [], reading_words: 'relative claim; external study; baseline unknown' }] } });
    expect(result.ok, JSON.stringify(result)).toBe(true); expect((await w.press(String(result.proposal_id))).ok).toBe(true);
    expect(w.graph().edges).toEqual(graph.edges);
    expect(userStatementFor(w.graph(), subject)!.statements).toEqual([expect.objectContaining({ quote: message, form: 'describes', reading: 'olumi' })]);
    expect(userStatementFor(w.graph(), subject)!.statements[0]).not.toHaveProperty('low');
    expect(w.graph().nodes.find((n: Rec) => n.id === 'report').observed_state).toEqual(graph.nodes[1].observed_state);
  });

  it.each(['missing', 'empty'])('a partial retraction with a %s retained list refuses', async mode => {
    const f = fixture(row), w = await correctionWorld(f.graph, f.message);
    const request = structuredClone(f.request) as Rec;
    if (mode === 'missing') delete request.edits[0].retained; else request.edits[0].retained = [];
    const result = await w.offer('propose_statement', { correction: request });
    expect(result.ok).toBe(false); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
  });

  it('the native reducer refuses a stale expected record; a press writes nothing', async () => {
    const f = fixture(row), w = await correctionWorld(f.graph, f.message);
    const result = await w.offer('propose_statement', { correction: f.request });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const pid = String(result.proposal_id), approved = approvedStatementRecordOf(w.proposals.get(pid)!.operations[0]!)!;
    w.change(g => { g.nodes.find((n: Rec) => n.id === 'report').user_statements[0].recorded_at = '2026-08-02T00:00:00Z'; });
    expect(applyStatementRecordEdit(w.graph(), approved)).toEqual({ kind: 'refused', reason: 'node_changed' });
    expect(await w.press(pid)).toMatchObject({ ok: false, mutated: false, refusal: 'superseded' }); expect(w.writes).toHaveLength(0);
  });

  it('free-text approval is not this card’s own press', async () => {
    const f = fixture(row), w = await correctionWorld(f.graph, f.message);
    const result = await w.offer('propose_statement', { correction: f.request });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((await w.press(String(result.proposal_id), w.proposals, false)).ok).toBe(false);
    expect(w.writes).toHaveLength(0);
  });

  it('another operation beside correction is refused rather than omitted', async () => {
    const f = fixture(row), w = await correctionWorld(f.graph, f.message);
    const result = await w.offer('propose_statement', { correction: f.request, subject: f.subject, statements: [{ quote: f.message }] });
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'mixed_statement_changes' });
    expect(w.writes).toHaveLength(0);
  });
});
