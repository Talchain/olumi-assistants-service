import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { log } from '../../../utils/telemetry.js';
import { correctionWorld, type Rec } from './corrections-stage2-world.js';
import { applyStatementCorrection, statementCorrectionWords, userStatementRecord, userStatementFor, type StatementCorrectionRequest } from '../../statement-door/statements.js';
import { createProposal } from '../proposal.js';
import { applyStatementRecordEdit, approvedStatementRecordOf } from '../../goal-target/cohort-forecast-write.js';
import { rangeLawAdopted, rangeLawSubject } from '../../intervention-range.js';
import { doorAsks } from '../../statement-door/door.js';

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

describe.each(cases)('$name: sourced reading and subject review are separate', row => {
  it.each(['legacy', 'incomplete'] as const)('%s persisted wording still requires the complete own card', async form => {
    const f = fixture(row), w = await correctionWorld(f.graph, f.message);
    const card = await w.offer('propose_statement', { correction: f.request });
    const original = w.proposals.get(String(card.proposal_id))!;
    const approved = approvedStatementRecordOf(original.operations[0]!)!.correction!;
    const complete = statementCorrectionWords(approved, true);
    const proposal = createProposal({ ...original, public_label: form === 'legacy' ? complete : complete.split('\n')[0]! });
    const restored = w.restoreCard(proposal, { ...card, proposal_id: proposal.proposal_id, public_label: proposal.public_label });
    const result = await w.press(proposal.proposal_id, restored);
    expect(result).toMatchObject(form === 'legacy' ? { ok: true, applied: true } : { ok: false, refusal: 'invalid_statement' });
    expect(w.writes).toHaveLength(form === 'legacy' ? 1 : 0);
  });

  it.each(['missing', 'partial', 'another speaker'] as const)('%s source shows the reading without inventing human authorship or an approval', async fault => {
    const f = fixture(row), message = fault === 'another speaker' ? `A colleague said: “${f.message}”` : f.message;
    const w = await correctionWorld(f.graph, message);
    const correction: Rec = { ...f.request };
    if (fault === 'missing') delete correction.quote;
    if (fault === 'partial') correction.quote = f.message.slice(0, f.message.indexOf(','));
    const review = await w.offer('propose_statement', { correction });
    expect(review).toMatchObject({ ok: false, mutated: false, refusal: 'correction_not_stated' });
    expect(review.public_label).toContain('Review Olumi’s proposed correction');
    expect(review.public_label).toContain(`Olumi’s reading: ${f.request.edits[0]!.reading_words}`);
    expect(review.public_label).toContain(fault === 'missing' ? 'Olumi has not identified source words for this reading.' : 'Olumi could not verify the proposed words as a complete statement in the current conversation.');
    if (fault !== 'missing') expect(review.public_label).toContain(message);
    expect(review.public_label).not.toContain('Recorded words — you:');
    expect(review).not.toHaveProperty('proposal_id'); expect(w.chips('propose_statement', review)).toEqual([]);
    expect(w.proposals.size()).toBe(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
  });

  it('a complete current source line survives quote typography as an explicitly approved Olumi reading', async () => {
    const f = fixture(row), message = f.message.replace('; keep', ' — keep');
    const w = await correctionWorld(f.graph, message);
    const card = await w.offer('propose_statement', { correction: { ...f.request, quote: message.replace(' — ', ' - ') } });
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false });
    expect(card.public_label).toContain('Review Olumi’s proposed correction');
    expect(card.public_label).toContain('Approving authorises only this displayed change as an Olumi reading');
    expect(card.public_label).toContain(message);
    expect(w.writes).toHaveLength(0);
    const pid = String(card.proposal_id), restored = w.restoreCard(w.proposals.get(pid)!, card);
    expect(await w.press(pid, restored, false)).toMatchObject({ ok: false, mutated: false });
    expect(await w.press(pid, restored)).toMatchObject({ ok: true, applied: true });
    expect(w.registers).toHaveLength(1); expect(w.writes).toHaveLength(1);
    expect(userStatementFor(w.graph(), f.subject)!.statements[0]).toMatchObject({ speaker: 'user', source: message, quote: message, reading: 'olumi' });
    expect((await w.cold()).body.graph).toEqual(w.graph());
    expect(await w.press(pid, restored)).toMatchObject({ ok: true, already_applied: true });
    expect(w.writes).toHaveLength(1);
  });

  it.each(['another', 'unbound'] as const)('%s asks about the actual binding without approving or retargeting', async binding => {
    const f = fixture(row), quote = binding === 'another' ? 'For Energy use, retract the earlier account.' : 'Retract the earlier account.';
    f.graph.nodes.push({ id: 'energy', kind: 'factor', label: 'Energy use' });
    const w = await correctionWorld(f.graph, quote);
    const review = await w.offer('propose_statement', { correction: { quote, edits: [f.request.edits[0]] } });
    expect(review).toMatchObject({ ok: false, mutated: false, refusal: 'unrelated_correction' });
    expect(review.public_label).toBe(binding === 'another'
      ? `Olumi reads these words as referring to “Energy use”, rather than “${row.factor}”. Which item should this correction concern?`
      : 'Olumi could not establish which item these words concern. Which item should this correction concern?');
    expect(review).not.toHaveProperty('proposal_id'); expect(w.chips('propose_statement', review)).toEqual([]);
    expect(w.proposals.size()).toBe(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
    // Selection cannot override a source that positively names another item.
    Object.assign(w.ctx, { grounded_selection: { element_ids: ['report'], unresolved: 'none' } });
    if (binding === 'another') {
      expect(await w.offer('propose_statement', { correction: { quote, edits: [f.request.edits[0]] } })).toMatchObject({ ok: false, refusal: 'unrelated_correction' });
      expect(w.proposals.size()).toBe(0);
    }
    // A fresh supported correction still needs its own complete displayed card and separate approval.
    Object.assign(w.ctx, { user_turn_text: f.message, user_text: f.message });
    const card = await w.offer('propose_statement', { correction: { ...f.request, edits: [f.request.edits[0]] } });
    expect(card).toMatchObject({ ok: true, mutated: false }); expect(w.writes).toHaveLength(0);
    const pid = String(card.proposal_id), restored = w.restoreCard(w.proposals.get(pid)!, card);
    expect(await w.press(pid, restored, false)).toMatchObject({ ok: false, mutated: false });
    expect(await w.press(pid, restored)).toMatchObject({ ok: true, applied: true });
    expect(w.writes).toHaveLength(1);
    expect(w.graph().nodes.find((n: Rec) => n.id === 'energy')).toEqual(f.graph.nodes.find((n: Rec) => n.id === 'energy'));
  });
});

describe.each(cases)('$name: correction uses the existing subject context', row => {
  it.each(['selection', 'question'] as const)('%s survives its own card, native press and cold read', async origin => {
    const f = fixture(row), message = `Retract “${row.withdrawn}”; keep the earlier report.`;
    f.graph.nodes[0].goal_horizon_months = 6;
    const edit = f.request.edits[origin === 'selection' ? 0 : 1]!;
    const w = await correctionWorld(f.graph, message);
    if (origin === 'selection') Object.assign(w.ctx, { grounded_selection: { element_ids: [edit.subject.id], unresolved: 'none' } });
    else {
      const ask = doorAsks(f.graph).find(a => a.subject.id === edit.subject.id && a.subject.field === edit.subject.field);
      expect(ask).toBeDefined();
      Object.assign(w.ctx, { preceding_assistant_text: ask!.words });
    }
    const card = await w.offer('propose_statement', { correction: { quote: message, edits: [edit] } });
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false });
    const pid = String(card.proposal_id), proposal = w.proposals.get(pid)!, restored = w.restoreCard(proposal, card);
    expect(restored.get(pid)).toEqual(proposal);
    expect(card.public_label).toContain(`For ${origin === 'selection' ? row.factor : row.risk}`);
    expect(w.writes).toHaveLength(0);
    // A pending-card press need not carry the selection or question from the preparation turn.
    Object.assign(w.ctx, { grounded_selection: undefined, preceding_assistant_text: undefined });
    expect(await w.press(pid, restored, false)).toMatchObject({ ok: false, mutated: false });
    expect(await w.press(pid, restored)).toMatchObject({ ok: true, applied: true });
    const saved = structuredClone(w.graph()), record = userStatementFor(saved, edit.subject)!;
    expect(record.statements[0]).toMatchObject({ quote: message, source: message, speaker: 'user', reading: 'olumi' });
    expect(record.statements[1]).toEqual(userStatementFor(f.graph, edit.subject)!.statements[0]);
    expect(saved.nodes.find((n: Rec) => n.id === 'report').observed_state).toEqual(f.graph.nodes[1].observed_state);
    expect(withoutRef(saved.nodes.find((n: Rec) => n.id === 'dissent'))).toEqual(f.graph.nodes[4]);
    expect(await w.press(pid, restored)).toMatchObject({ ok: true, already_applied: true });
    expect(w.writes).toHaveLength(1);
    const cold = await w.cold(); expect(cold.body.graph).toEqual(saved);
    expect(userStatementFor(cold.body.graph, edit.subject)).toEqual(record);
  });

  it.each(['absent', 'another named', 'multiple selected', 'no source', 'other speaker', 'AI-supplied context'])('%s cannot author this subject', async fault => {
    const f = fixture(row), plain = `Retract “${row.withdrawn}”; keep the earlier report.`;
    f.graph.nodes.push({ id: 'energy', kind: 'factor', label: 'Energy use' });
    const quote = fault === 'another named' ? `For Energy use, ${plain}` : plain;
    const w = await correctionWorld(f.graph, quote);
    if (!['absent', 'AI-supplied context'].includes(fault)) Object.assign(w.ctx, {
      grounded_selection: { element_ids: fault === 'multiple selected' ? ['report', 'energy'] : ['report'], unresolved: 'none' },
    });
    if (fault === 'no source') Object.assign(w.ctx, { user_turn_text: undefined, unverified_user_text: quote });
    if (fault === 'other speaker') Object.assign(w.ctx, { user_turn_text: `A colleague said: “${quote}”` });
    const card = await w.offer('propose_statement', { correction: { quote, edits: [f.request.edits[0]],
      ...(fault === 'AI-supplied context' ? { binding_context: { selection: { element_ids: ['report'], unresolved: 'none' } } } : {}) } });
    expect(card).toMatchObject({ ok: false, mutated: false,
      refusal: ['no source', 'other speaker'].includes(fault) ? 'correction_not_stated' : 'unrelated_correction' });
    expect(w.proposals.size()).toBe(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
  });

  it('the frozen context is covered by card integrity, and malformed persisted context is refused natively', async () => {
    const f = fixture(row), quote = `Retract “${row.withdrawn}”; keep the earlier report.`, w = await correctionWorld(f.graph, quote);
    Object.assign(w.ctx, { grounded_selection: { element_ids: ['report'], unresolved: 'none' } });
    const card = await w.offer('propose_statement', { correction: { quote, edits: [f.request.edits[0]] } });
    expect(card.ok).toBe(true);
    const pid = String(card.proposal_id), restored = w.restoreCard(w.proposals.get(pid)!, card);
    const correction = (restored.get(pid)!.operations[0]!.value as Rec).correction;
    expect(applyStatementCorrection(f.graph, { ...correction, binding_context: { asks: 'invalid' } })).toEqual({ refused: 'invalid_statement' });
    correction.binding_context.selection.element_ids = ['different-subject'];
    expect(await w.press(pid, restored)).toMatchObject({ ok: false, mutated: false });
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
  });
});

it.each([
  ['missing quote', 'correction_not_stated', 'correction.quote_present'],
  ['partial quote', 'correction_not_stated', 'correction.quote_whole_current_turn'],
  ['empty edits', 'correction_not_stated', 'correction.edits_nonempty'],
  ['unrelated source', 'unrelated_correction', 'correction.postimage.unrelated_correction.unbound'],
  ['ordinary subject', 'subject_not_found', 'propose_statement.subject_not_found'],
])('refusal source diagnostic: %s keeps text private and changes no verdict', async (fault, refusal, check) => {
  const f = fixture(cases[0]!), secret = 'PRIVATE_SOURCE_AND_READING_CANARY_7d92';
  const message = fault === 'unrelated source' ? 'Revenue rose last year; the current filing is not complete.' : f.message;
  const args: Rec = { correction: structuredClone(f.request) };
  args.correction.quote = message;
  args.correction.edits[0].reading_words = secret;
  args.correction[secret] = secret; // Neither an arbitrary key nor its value may become a logged field.
  if (fault === 'missing quote') delete args.correction.quote;
  if (fault === 'partial quote') args.correction.quote = message.slice(0, message.indexOf(','));
  if (fault === 'empty edits') args.correction.edits = [];
  if (fault === 'ordinary subject') {
    delete args.correction;
    args.subject = { kind: 'factor', id: secret, field: 'measure' };
    args.statements = [{ quote: message, reading_words: secret, [secret]: secret }];
  }
  const w = await correctionWorld(f.graph, `${message} ${secret}.`);
  const spy = vi.spyOn(log, 'info').mockImplementation(() => undefined as never);
  try {
    const result = await w.offer('propose_statement', args);
    expect(result).toMatchObject({ ok: false, mutated: false, refusal });
    expect(result).not.toHaveProperty('failed_checks'); // Observations are not a new AI input or permission.
    const events = spy.mock.calls.map(([event]) => event as Rec).filter(e => e.diagnostic_source === 'statement_preparation');
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event).toMatchObject({ event: 'v5.agent.tool_refusal_diagnostic', tool: 'propose_statement', refusal, failed_checks: [check],
      variant: fault === 'ordinary subject' ? 'statement' : 'correction', agent_mode: 'full' });
    const quoted = fault === 'ordinary subject' ? event.statements[0] : event.correction;
    const quote = fault === 'ordinary subject' ? message : args.correction.quote ?? '';
    expect(quoted).toMatchObject({ quote_length: quote.length, quote_sha256: createHash('sha256').update(quote).digest('hex'),
      quote_is_whole_current_statement: !['missing quote', 'partial quote'].includes(fault) });
    expect(quoted).not.toHaveProperty('quote_found_in_current_turn'); // No second quote-normalisation rule.
    expect(event.correction.edits.every((e: Rec) => e.subject_id_present)).toBe(true);
    expect(JSON.stringify(event)).not.toContain(secret);
    expect(JSON.stringify(event)).not.toContain(message);
    expect(w.graph()).toEqual(f.graph);
    expect(w.proposals.size()).toBe(0); expect(w.registers).toHaveLength(0); expect(w.writes).toHaveLength(0);
  } finally { spy.mockRestore(); }
});

it.each([
  { words: 'For Energy use, retract the earlier account.', binder: 'another', index: 0 },
  { words: 'Retract the earlier account.', binder: 'unbound', index: 0 },
  { words: 'For Dispatch updates, retract the earlier account.', binder: 'unbound', index: 1 },
])('native diagnostic distinguishes $binder at edit $index', async ({ words, binder, index }) => {
  const f = fixture(cases[0]!);
  f.graph.nodes.push({ id: 'energy', kind: 'factor', label: 'Energy use' });
  const w = await correctionWorld(f.graph, words), spy = vi.spyOn(log, 'info').mockImplementation(() => undefined as never);
  try {
    const result = await w.offer('propose_statement', { correction: { ...f.request, quote: words,
      edits: index === 0 ? [f.request.edits[0]] : f.request.edits } });
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'unrelated_correction' });
    const event = spy.mock.calls.map(([e]) => e as Rec).find(e => e.diagnostic_source === 'statement_preparation')!;
    expect(event).toMatchObject({ request_id: w.ctx.request_id, binder_result: binder, failed_edit_index: index,
      failed_checks: [`correction.postimage.unrelated_correction.${binder}`] });
    expect(JSON.stringify(event)).not.toContain(words);
    expect(JSON.stringify(event)).not.toContain('Energy use');
    expect(w.graph()).toEqual(f.graph); expect(w.proposals.size()).toBe(0); expect(w.writes).toHaveLength(0);
  } finally { spy.mockRestore(); }
});

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
      expect(userStatementFor(w.graph(), s)!.attest).toEqual({ recorded_by: 'correction', disposition: 'retracted', scope: 'part',
        retained_count: 1, retained_0: row.retained, retained_0_origin: 'held_user_statement' });
      expect(statements[0]).toMatchObject({ source: f.message, quote: f.message,
        speaker: 'user', reading: 'olumi', subject: { node_id: s.id } });
      expect(statements[0]).not.toHaveProperty('conditions');
      expect(statements[1]).toEqual(userStatementFor(f.graph, s)!.statements[0]);
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
    expect(kept).toEqual(userStatementFor(f.graph, f.subject)!.statements[0]);
    expect(userStatementFor(w.graph(), f.subject)!.attest!.retained_0).toBe(row.retained);
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
      .toEqual({ recorded_by: 'correction', disposition: 'historical', scope: 'part',
        retained_count: 1, retained_0: row.retained, retained_0_origin: 'held_user_statement' });
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
    expect(retained).not.toHaveProperty('conditions');
    expect(userStatementFor(w.graph(), f.other)!.attest!.retained_0_origin).toBe('unknown');
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

  it('Lane A B3: a second correction applies without claiming the record holds an approval', async () => {
    const f = fixture(row), subject = { kind: 'factor' as const, id: 'report', field: 'level' as const };
    const source = `${row.factor} number about 40 people, mostly on nights.`;
    f.graph.nodes[1].user_statements = [userStatementRecord(subject, [{ source, quote: source, speaker: 'user', reading: 'olumi',
      form: 'point', low: 40, high: 40, unit: 'people', qualifier: 'about', subject: { quantity: row.factor, node_id: 'report' } }],
    '2026-08-01T00:00:00Z', { recorded_by: 'construction' })];
    const firstMessage = `For ${row.factor}, retract “mostly on nights”; keep “about 40 people” as it was.`;
    const w = await correctionWorld(f.graph, firstMessage);
    const first = await w.offer('propose_statement', { correction: { quote: firstMessage, edits: [{ subject,
      retirement: { quote: 'mostly on nights', scope: 'part', disposition: 'retracted' }, retained: ['about 40 people'], reading_words: 'about 40; not mostly nights' }] } });
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const applied = await w.press(String(first.proposal_id));
    expect(applied).toMatchObject({ ok: true, applied: true });
    const message = `For ${row.factor}, retract “about 40 people” too; we do not know the headcount.`;
    const second = await correctionWorld(w.graph(), message);
    const card = await second.offer('propose_statement', { correction: { quote: message, edits: [{ subject,
      retirement: { quote: 'about 40 people', scope: 'whole', disposition: 'retracted' }, retained: [], reading_words: 'headcount unknown' }] } });
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false });
    const result = await second.press(String(card.proposal_id));
    expect(result).toMatchObject({ ok: true, applied: true });
    for (const response of [first, applied, card, result]) expect(JSON.stringify(response)).not.toContain('holds an approval');
    const saved = userStatementFor(second.graph(), subject)!;
    expect(saved.statements).toEqual([expect.objectContaining({ source: message, quote: message, speaker: 'user', reading: 'olumi' })]);
    expect(saved.attest).toEqual({ recorded_by: 'correction', disposition: 'retracted', scope: 'whole', retained_count: 0 });
    expect(userStatementFor((await second.cold()).body.graph, subject)).toEqual(saved);
    expect(userStatementFor(second.graph(), f.other)).toEqual(userStatementFor(f.graph, f.other));
    expect(w.writes).toHaveLength(1); expect(second.writes).toHaveLength(1);
  });

  it.each([200, 201, 451])('N5 × B3: all %i retained characters survive card, apply, cold read and second correction', async length => {
    const f = fixture(row), span = `${row.factor} reports ${row.retained}; the morning team is checking the shared register while the evening team disputes the cause and wants the original evidence preserved before making any further judgement. `.repeat(3).slice(0, length);
    const source = `${span} and ${row.withdrawn}.`, earlier = f.graph.nodes[1].user_statements[0].statements[0];
    earlier.source = source; earlier.quote = source;
    const message = `For ${row.factor}, retract “${row.withdrawn}”; keep the earlier report.`;
    const w = await correctionWorld(f.graph, message), card = await w.offer('propose_statement', { correction: { quote: message,
      edits: [{ subject: f.subject, retirement: { quote: row.withdrawn, scope: 'part', disposition: 'retracted' }, retained: [span], reading_words: 'earlier report only' }] } });
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false });
    expect(String(card.public_label).split('\n').find(line => line.startsWith('Keep explicitly:'))).toBe(`Keep explicitly: “${span}”.`);
    const pid = String(card.proposal_id), proposal = w.proposals.get(pid)!, restored = w.restoreCard(proposal, card);
    expect(restored.get(pid)).toEqual(proposal); expect(w.writes).toHaveLength(0);
    const edit = approvedStatementRecordOf(restored.get(pid)!.operations[0]!)!.correction!.edits[0]!;
    expect(edit.retained).toEqual([span]); expect(edit.retirement.scope).toBe('part');
    expect(edit.record.statements[1]).toEqual(earlier);
    const attest = edit.record.attest!, parts = attest.retained_0_parts;
    const kept = parts === undefined ? attest.retained_0
      : Array.from({ length: Number(parts) }, (_, index) => attest[`retained_0_part_${index}`]).join('');
    expect(kept).toBe(span);
    expect(attest.retained_count).toBe(1); expect(attest.retained_0_origin).toBe('held_user_statement');
    expect(await w.press(pid, restored)).toMatchObject({ ok: true, applied: true });
    const saved = userStatementFor(w.graph(), f.subject)!;
    expect(saved).toEqual(edit.record);
    expect(userStatementFor(w.writes[0]!.graph, f.subject)).toEqual(saved);
    const cold = await w.cold(); expect(cold.status).toBe(200);
    expect(userStatementFor(cold.body.graph, f.subject)).toEqual(saved);
    // The other subject still holds its own report; this correction cannot borrow or rewrite it.
    expect(userStatementFor(cold.body.graph, f.other)).toEqual(userStatementFor(f.graph, f.other));
    const secondMessage = `For ${row.factor}, mark “${row.withdrawn}” historical instead; keep the earlier report.`;
    const second = await correctionWorld(cold.body.graph, secondMessage), next = await second.offer('propose_statement', { correction: {
      quote: secondMessage, edits: [{ subject: f.subject, retirement: { quote: row.withdrawn, scope: 'part', disposition: 'historical' },
        retained: [span], reading_words: 'earlier report only; disputed claim historical' }] } });
    expect(next, JSON.stringify(next)).toMatchObject({ ok: true, mutated: false });
    expect(await second.press(String(next.proposal_id))).toMatchObject({ ok: true, applied: true });
    const resaved = userStatementFor(second.graph(), f.subject)!;
    expect(resaved.attest).toEqual({ ...attest, disposition: 'historical' });
    expect(resaved.statements[0]).toMatchObject({ source: secondMessage, quote: secondMessage, speaker: 'user', reading: 'olumi' });
    expect(resaved.statements[1]).toEqual(earlier);
    const reopened = await second.cold(); expect(reopened.status).toBe(200);
    expect(userStatementFor(reopened.body.graph, f.subject)).toEqual(resaved);
    expect(userStatementFor(reopened.body.graph, f.other)).toEqual(userStatementFor(f.graph, f.other));
    expect(w.writes).toHaveLength(1); expect(second.writes).toHaveLength(1);
  });

  it('Lane A B1: an adopted option range refuses before a card and keeps its own adoption', async () => {
    const f = fixture(row), subject = rangeLawSubject('option', 'report');
    const source = `Explore process changes would bring ${row.factor} to between 40 and 60 people, mostly on nights.`;
    const message = `For Explore process changes and ${row.factor}, retract “mostly on nights”; keep “between 40 and 60 people” as it was.`;
    f.graph.nodes[1].observed_state = { value: 30, raw_value: 30, unit: 'people', source: 'brief_extraction' };
    f.graph.nodes[1].user_statements = [userStatementRecord(subject, [{ source, quote: source, speaker: 'user', reading: 'olumi',
      form: 'range', low: 40, high: 60, unit: 'people', subject: { quantity: row.factor, node_id: 'report', option_id: 'option' } }],
    '2026-08-01T00:00:00Z', { range_law: 'equal_tail', low: 40, high: 60 })];
    f.graph.nodes[3].interventions.report = { value: 50, raw_value: 50, unit: 'people' };
    expect(rangeLawAdopted(f.graph, 'option', { factor_id: 'report', low: 40, high: 60 })).toBe(true);
    const w = await correctionWorld(f.graph, message), result = await w.offer('propose_statement', { correction: { quote: message,
      edits: [{ subject, retirement: { quote: 'mostly on nights', scope: 'part', disposition: 'retracted' }, retained: ['between 40 and 60 people'], reading_words: 'day and night distribution is unknown' }] } });
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'correction_attestation_protected' });
    expect(result).not.toHaveProperty('proposal_id'); expect(w.proposals.size()).toBe(0);
    expect(w.registers).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
    expect(rangeLawAdopted(w.graph(), 'option', { factor_id: 'report', low: 40, high: 60 })).toBe(true);
  });

  it.each([{ fingerprint: 'held-approval' }, { retained_flag: false }])('B1 refuses other writers’ attestation, including %j', async extra => {
    const f = fixture(row);
    f.graph.nodes[1].user_statements[0].attest = { recorded_by: 'approval', ...extra };
    const w = await correctionWorld(f.graph, f.message), result = await w.offer('propose_statement', { correction: f.request });
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'correction_attestation_protected' });
    expect(result).not.toHaveProperty('proposal_id'); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
  });

  it.each(['point', 'range'] as const)('N1/N2 keep the complete retained %s statement, with retention outside its conditions', async form => {
    const f = fixture(row), graph = structuredClone(f.graph), span = form === 'point' ? 'about 40 people' : 'between 40 and 60 people';
    const source = `${row.factor} has ${span}, mostly on nights.`;
    const earlier = { source, quote: source, speaker: 'user' as const, reading: 'olumi' as const,
      form, low: 40, high: form === 'point' ? 40 : 60, unit: 'people', qualifier: 'about', qualifier_in_quote: form === 'point',
      reference: 'counted staff', period: 'this quarter', subject: { quantity: row.factor, node_id: 'report' } };
    graph.nodes[1].user_statements = [userStatementRecord(f.subject, [earlier], '2026-08-01T00:00:00Z', { recorded_by: 'construction' })];
    const message = `For ${row.factor}, retract “mostly on nights”; keep “${span}” as it was.`;
    const w = await correctionWorld(graph, message), result = await w.offer('propose_statement', { correction: { quote: message,
      edits: [{ subject: f.subject, retirement: { quote: 'mostly on nights', scope: 'part', disposition: 'retracted' }, retained: [span], reading_words: 'work pattern unknown' }] } });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const savedOperation = w.proposals.get(String(result.proposal_id))!.operations[0]!.value as Rec;
    expect(savedOperation.correction.edits[0].retained).toEqual([span]);
    expect((await w.press(String(result.proposal_id))).ok).toBe(true);
    const saved = userStatementFor(w.graph(), f.subject)!;
    expect(saved.statements[1]).toEqual(earlier);
    expect(saved.statements[0]).not.toHaveProperty('conditions'); expect(saved.statements[1]).not.toHaveProperty('conditions');
    expect(saved.attest).toMatchObject({ retained_count: 1, retained_0: span, retained_0_origin: 'held_user_statement' });
    expect(userStatementFor((await w.cold()).body.graph, f.subject)).toEqual(saved); expect(w.writes).toHaveLength(1);
  });

  it('N3 records unknown legacy origin structurally through cold reopen, without borrowing another source', async () => {
    const f = fixture(row), graph = structuredClone(f.graph); delete graph.nodes[2].user_statements;
    const w = await correctionWorld(graph, f.message), result = await w.offer('propose_statement', { correction: { quote: f.message, edits: [f.request.edits[1]] } });
    expect(result.ok).toBe(true); expect((await w.press(String(result.proposal_id))).ok).toBe(true);
    const saved = userStatementFor((await w.cold()).body.graph, f.other)!;
    expect(saved.attest).toMatchObject({ retained_count: 1, retained_0: row.retained, retained_0_origin: 'unknown' });
    expect(saved.statements.map(s => ({ source: s.source, quote: s.quote }))).toEqual([
      { source: f.message, quote: f.message }, { source: f.message, quote: f.message }]);
    expect(saved.statements.every(s => s.conditions === undefined)).toBe(true);
  });

  it('N2 keeps the earlier condition as stated rather than substituting the retained words', async () => {
    const f = fixture(row), earlier = f.graph.nodes[1].user_statements[0].statements[0];
    earlier.conditions = 'if the shared register is available';
    const w = await correctionWorld(f.graph, f.message), result = await w.offer('propose_statement', { correction: f.request });
    expect(result.ok).toBe(true); expect((await w.press(String(result.proposal_id))).ok).toBe(true);
    const saved = userStatementFor((await w.cold()).body.graph, f.subject)!;
    expect(saved.statements[0]).not.toHaveProperty('conditions'); expect(saved.statements[1]).toEqual(earlier);
    expect(saved.attest!.retained_0).toBe(row.retained);
  });

  it('N4 explains the correction, kept words and authorship without internal field names', async () => {
    const f = fixture(row), w = await correctionWorld(f.graph, f.message), result = await w.offer('propose_statement', { correction: f.request });
    expect(result.ok).toBe(true);
    expect(result.public_label).toContain(`For ${row.factor}`);
    expect(result.public_label).toContain(`Withdraw “${row.withdrawn}”`);
    expect(result.public_label).toContain(`Keep explicitly: “${row.retained}”`);
    expect(result.public_label).toContain('Your quote stays yours; the reading remains Olumi’s');
    expect(result.public_label).not.toMatch(/Subject:|field:|Retire as|Recorded figure\/bounds|subject_key|recorded_by|\{"/u);
  });
});
