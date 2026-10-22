import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { log } from '../../../utils/telemetry.js';
import { correctionWorld, type Rec } from './corrections-stage2-world.js';
import { applyStatementCorrection, claimRecordFor, claimRecordsOn, statementCorrectionWords, userStatementRecord, userStatementFor, type StatementCorrectionRequest } from '../../statement-door/statements.js';
import { saidByOf } from '../user-statements.js';
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
  it('keeps mixed-record unknown words visible and byte-for-byte unchanged through the checked write and cold read', async () => {
    const f = fixture(row), unknown = { speaker: 'unknown' as const, quote: 'The night team disputes the explanation.',
      source: 'The night team disputes the explanation.', form: 'describes' as const, reading: 'olumi' as const,
      subject: { quantity: 'reported_account', node_id: 'report' }, conditions: 'Only the late shift was observed.' };
    f.graph.nodes[1].user_statements[0].statements.push(unknown);
    const w = await correctionWorld(f.graph, f.message);
    const card = await w.offer('propose_statement', { correction: f.request });
    expect(card).toMatchObject({ ok: true, mutated: false });
    expect(card.public_label).toContain(`Recorded words — speaker/source unknown: “${unknown.source}”`);
    const pid = String(card.proposal_id), proposal = w.proposals.get(pid)!, restored = w.restoreCard(proposal, card);
    expect(await w.press(pid, restored)).toMatchObject({ ok: true, applied: true });
    const node = w.graph().nodes.find((n: Rec) => n.id === 'report');
    expect(claimRecordsOn(node)[0]!.statements.filter(s => s.speaker === 'unknown')).toEqual([unknown]);
    expect(userStatementFor(w.graph(), f.subject)!.statements.every(s => s.speaker === 'user')).toBe(true);
    const correction = approvedStatementRecordOf(proposal.operations[0]!)!.correction!;
    expect(applyStatementCorrection(w.graph(), correction)).toMatchObject({ unchanged: true });
    const lost = structuredClone(w.graph());
    lost.nodes.find((n: Rec) => n.id === 'report').user_statements[0].statements = userStatementFor(lost, f.subject)!.statements;
    expect(applyStatementCorrection(lost, correction)).toEqual({ refused: 'node_changed' });
    expect((await w.cold()).body.graph).toEqual(w.graph());
    expect(await w.press(pid, restored)).toMatchObject({ ok: true, already_applied: true });
    expect(w.writes).toHaveLength(1);
  });

  // ⭐ DL-3 19 Oct (verifier joined diagnosis R07/C3, a stale result): a correction retires the cards it supersedes. RED before this change:
  // the older card that records the corrected-away source stayed awaiting approval beside the correction card, and was offered again.
  it('a correction card retires the older unapproved card that writes the corrected subject; a card on another subject stays', async () => {
    const f = fixture(row), w = await correctionWorld(f.graph, f.message);
    const older = (path: string): string => {
      const p = createProposal({ scenario_id: w.ctx.scenario_id, user_id: null, base_graph_identity_hash: 'earlier',
        operations: [{ op: 'set_factor_value', path, value: { value: 70, unit: '%', authored_by: 'user_stated' } }],
        provenance: { authored_by: 'model_proposed', basis: 'an earlier turn' }, validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: `Record 1 figure you gave: ${path}` });
      w.proposals.put(p);
      return p.proposal_id;
    };
    const stale = older('report'), unrelated = older('dissent');
    const card = await w.offer('propose_statement', { correction: f.request });
    expect(card).toMatchObject({ ok: true, mutated: false });
    const awaiting = w.proposals.outstanding(w.ctx.scenario_id, null).map(o => o.proposal_id);
    expect(awaiting).toContain(String(card.proposal_id));
    expect(awaiting).not.toContain(stale);
    expect(awaiting).toContain(unrelated);
  });
  // ⭐ Codex approach review (8b, the retirement fix): a compound correction writes EVERY edit's subject, not only its first (`op.path`).
  // RED before: a newer correction of its SECOND subject left the older compound card awaiting approval beside it.
  it('a correction of a compound card\u2019s second subject retires that card; the newer correction saves through the real register route and reads back cold', async () => {
    const f = fixture(row), w = await correctionWorld(f.graph, f.message);
    const compound = await w.offer('propose_statement', { correction: f.request });
    const older = w.proposals.get(String(compound.proposal_id))!;
    const restored = w.restoreCard(older, compound);
    const second = await w.offer('propose_statement', { correction: { ...f.request, edits: [f.request.edits[1]!] } });
    expect(second).toMatchObject({ ok: true, mutated: false });
    const awaiting = w.proposals.outstanding(w.ctx.scenario_id, null).map(o => o.proposal_id);
    expect(awaiting).toContain(String(second.proposal_id));
    expect(awaiting, 'the compound card writes the corrected subject too').not.toContain(older.proposal_id);
    expect(await w.press(String(second.proposal_id))).toMatchObject({ ok: true, applied: true });
    expect(w.writes).toHaveLength(1);
    expect((await w.cold()).status).toBe(200);
    expect(await w.press(older.proposal_id, restored), 'a restored copy of the retired card writes nothing').toMatchObject({ ok: false });
    expect(w.writes).toHaveLength(1);
  });
  it('CONTROL: a refused correction retires nothing', async () => {
    const f = fixture(row), w = await correctionWorld(f.graph, f.message);
    const p = createProposal({ scenario_id: w.ctx.scenario_id, user_id: null, base_graph_identity_hash: 'earlier',
      operations: [{ op: 'set_factor_value', path: 'report', value: { value: 70, unit: '%', authored_by: 'user_stated' } }],
      provenance: { authored_by: 'model_proposed', basis: 'an earlier turn' }, validation: { admitted: true, loss_count: 0, refusals: [] },
      public_label: 'Record 1 figure you gave: report' });
    w.proposals.put(p);
    const refused = await w.offer('propose_statement', { correction: { ...f.request, edits: [{ ...f.request.edits[0]!,
      subject: { ...f.request.edits[0]!.subject, id: 'no_such_subject' } }] } });
    expect(refused).toMatchObject({ ok: false });
    expect(w.proposals.outstanding(w.ctx.scenario_id, null).map(o => o.proposal_id)).toContain(p.proposal_id);
  });

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

  it('persisted review-only fields cannot replace complete approval wording', async () => {
    const f = fixture(row), w = await correctionWorld(f.graph, f.message);
    const card = await w.offer('propose_statement', { correction: f.request });
    expect(card).toMatchObject({ ok: true, mutated: false });
    const original = w.proposals.get(String(card.proposal_id))!, operations = structuredClone(original.operations);
    const view = { readings: ['an unverified correction'], source_state: 'reported' as const, source_words: f.message };
    Object.assign((operations[0]!.value as Rec).correction, view);
    const public_label = statementCorrectionWords(view);
    const forged = createProposal({ ...original, operations, public_label });
    const restored = w.restoreCard(forged, { ...card, proposal_id: forged.proposal_id, public_label });
    expect(await w.press(forged.proposal_id, restored)).toMatchObject({ ok: false, mutated: false, refusal: 'invalid_statement' });
    expect(w.registers).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
  });

  it.each(['missing', 'partial', 'another speaker', 'unknown speaker'] as const)('%s source shows the reading without inventing human authorship or an approval', async fault => {
    const f = fixture(row), message = fault === 'another speaker' ? `A colleague said: “${f.message}”`
      : fault === 'unknown speaker' ? `'${f.message}'` : f.message;
    const w = await correctionWorld(f.graph, message);
    const correction: Rec = { ...f.request };
    if (fault === 'another speaker') correction.speaker = 'other';
    if (fault === 'unknown speaker') correction.speaker = 'unknown';
    if (fault === 'missing') delete correction.quote;
    if (fault === 'partial') correction.quote = f.message.slice(0, f.message.indexOf(','));
    const review = await w.offer('propose_statement', { correction });
    if (fault !== 'missing') {
      // ⭐ GATE → LABEL (DL-3 change 1): a labelled card, never a refusal. Its source is said as established: the user's own words
      // (an excerpt shows their complete line), else "speaker/source unknown" — never "you" for another's or unknown words.
      expect(review, JSON.stringify(review)).toMatchObject({ ok: true, mutated: false });
      expect(review.public_label).toContain(`Olumi’s reading: ${f.request.edits[0]!.reading_words}`);
      if (fault === 'partial') expect(review.public_label).toContain(`Recorded words — you: “${message}”`);
      else {
        expect(review.public_label).not.toContain('Recorded words — you:');
        expect(review.public_label).toContain(`Recorded words — speaker/source unknown: “${message}”`);
      }
      expect(review.public_label).toContain('it does not make it something you said');
      expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
      return;
    }
    expect(review).toMatchObject({ ok: false, mutated: false, refusal: 'correction_not_stated' });
    expect(review.public_label).toContain('Review the correction’s source');
    expect(review.public_label).toContain(`Olumi’s reading: ${f.request.edits[0]!.reading_words}`);
    // Missing words are structure, not a reading: still a non-authorising review with no card.
    expect(review.public_label).toContain('Olumi could not find words of your own stating this correction. This review does not authorise a change.');
    expect(review.public_label).not.toContain('Recorded words — you:');
    expect(review).not.toHaveProperty('proposal_id'); expect(w.chips('propose_statement', review)).toEqual([]);
    expect(w.proposals.size()).toBe(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
  });

  // DL-3 01:53Z; PL-P2-NEGATIVE-0205: inherited defect, lean core C2/#3392. Keep the real assertions runnable and report the failure.
  it('KNOWN BASE DEFECT (lean core C2): another-speaker review cannot become a user-source card by requoting the whole reported line', async () => {
    const f = fixture(row), message = `A colleague said: “${f.message}”`;
    const w = await correctionWorld(f.graph, message);
    // ⭐ GATE → LABEL: both are cards whose source is the reported, unresolved speaker; the press never makes them the user's.
    const review = await w.offer('propose_statement', { correction: f.request });
    expect(review, JSON.stringify(review)).toMatchObject({ ok: true, mutated: false });
    expect(review.public_label).not.toContain('Recorded words — you:');
    const requote = await w.offer('propose_statement', { correction: { ...f.request, quote: message } });
    expect(requote, JSON.stringify(requote)).toMatchObject({ ok: true, mutated: false });
    expect(requote.public_label).not.toContain('Recorded words — you:');
    expect(requote.public_label).toContain(`Recorded words — speaker/source unknown: “${message}”`);
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
    expect(await w.press(String(requote.proposal_id))).toMatchObject({ ok: true, applied: true });
    expect(saidByOf(claimRecordFor(w.graph(), f.subject)!.statements[0]!)).toBe('unknown');
    expect(userStatementFor(w.graph(), f.subject)?.statements.some(s => s.quote === message) ?? false).toBe(false);
  });

  // Founder 05:46 evidence row (DL-3): the AI's EXPLICIT speaker=user reading of the whole reported line never makes it the user's card.
  it('C2: an EXPLICIT speaker=user requote of the whole reported line still prepares no user-source card', async () => {
    const f = fixture(row), message = `A colleague said: “${f.message}”`;
    const w = await correctionWorld(f.graph, message);
    const requote = await w.offer('propose_statement', { correction: { ...f.request, quote: message, speaker: 'user' } });
    // ⭐ GATE → LABEL: a card, and its source is still never the user's (the reported line ends in another speaker's words).
    expect(requote, JSON.stringify(requote)).toMatchObject({ ok: true, mutated: false });
    expect(requote.public_label).not.toContain('Recorded words — you:');
    expect(requote.public_label).toContain('Recorded words — speaker/source unknown:');
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
    expect(await w.press(String(requote.proposal_id))).toMatchObject({ ok: true, applied: true });
    expect(userStatementFor(w.graph(), f.subject)?.statements.some(s => s.quote === message) ?? false).toBe(false);
    // CONTRAST: the user's own complete line, read as theirs, still prepares the card.
    const own = await correctionWorld(f.graph, f.message);
    expect(await own.offer('propose_statement', { correction: { ...f.request, speaker: 'user' } })).toMatchObject({ ok: true, mutated: false });
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
    // ⭐ GATE → LABEL: a card for the item the AI named, saying the item is Olumi's reading (and which item the words matched
    // instead); never retargeted, nothing written before its press.
    expect(review, JSON.stringify(review)).toMatchObject({ ok: true, mutated: false });
    expect(review.public_label).toContain(`Olumi’s reading: these words concern “${row.factor}”.${binding === 'another'
      ? ` Olumi’s item reader matched them to “Energy use” instead; approve only if “${row.factor}” is the item you mean.` : ''}`);
    expect(w.proposals.get(String(review.proposal_id))!.operations.map(o => o.path)).toEqual(['report']);
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
    // A selection never hides that the words name another item.
    Object.assign(w.ctx, { grounded_selection: { element_ids: ['report'], unresolved: 'none' } });
    if (binding === 'another') {
      expect((await w.offer('propose_statement', { correction: { quote, edits: [f.request.edits[0]] } })).public_label)
        .toContain('Olumi’s item reader matched them to “Energy use” instead');
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
  it('one item’s preceding question never binds unmentioned targets bundled beside it', async () => {
    const f = fixture(row), message = 'Retract the earlier account.';
    f.graph.nodes[0].goal_horizon_months = 6;
    const ask = doorAsks(f.graph).find(a => a.subject.id === f.other.id && a.subject.field === f.other.field);
    expect(ask).toBeDefined();
    const w = await correctionWorld(f.graph, message);
    Object.assign(w.ctx, { preceding_assistant_text: ask!.words });
    const result = await w.offer('propose_statement', { correction: { ...f.request, quote: message } });
    // ⭐ GATE → LABEL: the question about one item binds only that item; the other item is labelled Olumi's reading on the card.
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    expect(result.public_label).toContain(`Olumi’s reading: these words concern “${row.factor}”.`);
    expect(w.registers).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
  });

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
    // ⭐ GATE → LABEL: a card for the item the AI named, never another; its source says what was established. Context never authors.
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false });
    expect(w.proposals.get(String(card.proposal_id))!.operations.map(o => o.path)).toEqual(['report']);
    if (fault === 'no source') expect(card.public_label).toContain('Olumi’s proposed reading — source unverified:');
    if (fault === 'other speaker') expect(card.public_label).toContain('Recorded words — speaker/source unknown:');
    if (['no source', 'other speaker'].includes(fault)) expect(card.public_label).not.toContain('Recorded words — you:');
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
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
  ['empty edits', 'correction_not_stated', 'correction.edits_nonempty'],
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

// ⭐ GATE → LABEL: a partial quote or an unrelated source is a labelled card, so it logs no refusal diagnostic and leaks no text.
it.each(['partial quote', 'unrelated source'] as const)('labelled card, no refusal diagnostic: %s keeps text private', async fault => {
  const f = fixture(cases[0]!), secret = 'PRIVATE_SOURCE_AND_READING_CANARY_7d92';
  const message = fault === 'unrelated source' ? 'Revenue rose last year; the current filing is not complete.' : f.message;
  const args: Rec = { correction: structuredClone(f.request) };
  args.correction.quote = fault === 'partial quote' ? message.slice(0, message.indexOf(',')) : message;
  args.correction.edits[0].reading_words = secret;
  const w = await correctionWorld(f.graph, `${message} ${secret}.`);
  const spy = vi.spyOn(log, 'info').mockImplementation(() => undefined as never);
  try {
    const result = await w.offer('propose_statement', args);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    const events = spy.mock.calls.map(([event]) => event as Rec).filter(e => e.diagnostic_source === 'statement_preparation');
    expect(events).toHaveLength(0);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
    expect(w.registers).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
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
    // ⭐ GATE → LABEL: the binder's verdict is frozen as the edit's LABEL on the card (no refusal, no diagnostic, no logged text).
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    const edits = ((w.proposals.get(String(result.proposal_id))!.operations[0]!.value as Rec).correction as Rec).edits as Rec[];
    expect(edits[index]!.labels).toEqual(binder === 'another' ? { binding: 'olumi_reading', bound_label: 'Energy use' } : { binding: 'olumi_reading' });
    expect(spy.mock.calls.map(([e]) => e as Rec).filter(e => e.diagnostic_source === 'statement_preparation')).toHaveLength(0);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(words);
    expect(w.graph()).toEqual(f.graph); expect(w.writes).toHaveLength(0);
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
    expect(chips[0]!.label).toBe('Approve Olumi’s reading');
    expect(chips[0]!.message).toBe('Approve only the displayed correction as Olumi’s reading.');
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

  it('an unrelated dated revenue quote retires nothing without its own press, and its card says each item is Olumi’s reading', async () => {
    const f = fixture(row), quote = 'Revenue was £2m as of 2026-09-01; the filing deadline is next month.';
    const w = await correctionWorld(f.graph, quote);
    const result = await w.offer('propose_statement', { correction: { ...f.request, quote } });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    expect(result.public_label).toContain(`Olumi’s reading: these words concern “${row.factor}”.`);
    expect(result.public_label).toContain(`Olumi’s reading: these words concern “${row.risk}”.`);
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
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
    const firstOps = JSON.stringify(w.proposals.get(String(first.proposal_id))!.operations);
    const applied = await w.press(String(first.proposal_id));
    expect(applied).toMatchObject({ ok: true, applied: true });
    const message = `For ${row.factor}, retract “about 40 people” too; we do not know the headcount.`;
    const second = await correctionWorld(w.graph(), message);
    const card = await second.offer('propose_statement', { correction: { quote: message, edits: [{ subject,
      retirement: { quote: 'about 40 people', scope: 'whole', disposition: 'retracted' }, retained: [], reading_words: 'headcount unknown' }] } });
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false });
    const cardOps = JSON.stringify(second.proposals.get(String(card.proposal_id))!.operations);
    const result = await second.press(String(card.proposal_id));
    expect(result).toMatchObject({ ok: true, applied: true });
    for (const response of [first, applied, card, result]) expect(JSON.stringify(response)).not.toContain('holds an approval');
    // ⭐ DISCRIMINATING (Codex BLOCK @94b330bd P2: a mutant treating a correction's own record as protected survived the old-phrase
    // check): neither card claims an approval in today's words, neither saved operation carries the approval label, and no history
    // receipt is invented.
    for (const shown of [first, card]) expect(String(shown.public_label)).not.toContain('This replaces a record you approved on its card');
    for (const ops of [firstOps, cardOps]) {
      expect(ops).toContain('"correction"'); // positive control: the saved operation is the correction itself
      expect(ops).not.toContain('"approved":true');
    }
    expect((claimRecordFor(second.graph(), subject)?.history ?? []).some((st) => st.attested !== undefined)).toBe(false);
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
    // ⭐ GATE → LABEL: a card that says the adoption it replaces stays in history and no longer applies; nothing changes before its press.
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    expect(result.public_label).toContain('This replaces a record you approved on its card. That approval stays in its history and no longer applies once this correction is approved.');
    expect(w.registers).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
    expect(rangeLawAdopted(w.graph(), 'option', { factor_id: 'report', low: 40, high: 60 })).toBe(true);
    // Its press: the adoption is a historical receipt on the retired claim, and no longer applies.
    expect(await w.press(String(result.proposal_id))).toMatchObject({ ok: true, applied: true });
    expect(rangeLawAdopted(w.graph(), 'option', { factor_id: 'report', low: 40, high: 60 })).toBe(false);
    expect(claimRecordFor(w.graph(), subject)!.history?.[0]).toMatchObject({ status: 'superseded', quote: source, attested: { range_law: 'equal_tail', low: 40, high: 60 } });
  });

  it.each([{ fingerprint: 'held-approval' }, { retained_flag: false }])('B1 refuses other writers’ attestation, including %j', async extra => {
    const f = fixture(row);
    f.graph.nodes[1].user_statements[0].attest = { recorded_by: 'approval', ...extra };
    const w = await correctionWorld(f.graph, f.message), result = await w.offer('propose_statement', { correction: f.request });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    expect(result.public_label).toContain('This replaces a record you approved on its card. That approval stays in its history');
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
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
    expect(result.public_label).toContain('Your original source remains in the history, and Olumi’s interpretation stays separate from it.');
    expect(result.public_label).not.toMatch(/Subject:|field:|Retire as|Recorded figure\/bounds|subject_key|recorded_by|\{"/u);
  });
});

// DEV exposed source/binding classes; these independent domains contain no pilot wording.
describe.each(cases)('$name: complete correction source and held identity', row => {
  it.each(['quoted term', 'quoted retraction', 'full label', 'unknown earlier speaker'] as const)(
    '%s reaches one approved native write and a complete cold read', async form => {
      const f = fixture(row);
      const message = form === 'quoted term' ? `${f.message} By 'current' I mean the report for this shift.`
        : form === 'quoted retraction' ? f.message.replace(/[“”]/g, "'")
          : `For ${row.factor}, the earlier universal account was an assumption. Withdraw it and retain the local delay as a report.`;
      const edit = f.request.edits[0]!;
      let unknown: Rec | undefined;
      if (form === 'unknown earlier speaker') {
        const node = f.graph.nodes[1], record = node.user_statements[0];
        unknown = { ...record.statements[0], speaker: 'unknown' };
        record.statements = [unknown];
        expect(userStatementFor(f.graph, f.subject)).toBeUndefined();
      }
      const w = await correctionWorld(f.graph, message);
      const card = await w.offer('propose_statement', { correction: { quote: message, edits: [edit] } });
      expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false });
      expect(card.public_label).toContain(message);
      expect(card.public_label).toContain('Olumi’s reading:');
      expect(w.writes).toHaveLength(0);
      const pid = String(card.proposal_id), restored = w.restoreCard(w.proposals.get(pid)!, card);
      expect(await w.press(pid, restored, false)).toMatchObject({ ok: false, mutated: false });
      expect(await w.press(pid, restored)).toMatchObject({ ok: true, applied: true });
      expect(w.registers).toHaveLength(1); expect(w.writes).toHaveLength(1);
      const current = userStatementFor(w.graph(), f.subject)!;
      expect(current.statements[0]).toMatchObject({ speaker: 'user', source: message, quote: message, reading: 'olumi' });
      if (unknown !== undefined) {
        expect(current.statements.every(s => s.speaker === 'user')).toBe(true);
        expect(claimRecordsOn(w.graph().nodes[1])[0]!.statements.filter(s => s.speaker === 'unknown')).toEqual([unknown]);
        expect(current.attest).toMatchObject({ recorded_by: 'correction', retained_0_origin: 'unknown' });
      }
      const saved = structuredClone(w.graph());
      expect((await w.cold()).body.graph).toEqual(saved);
      expect(await w.press(pid, restored)).toMatchObject({ ok: true, already_applied: true });
      expect(w.writes).toHaveLength(1);
    });

  it.each([false, true])('a source shared by two indistinguishable same-field accounts still asks which item without a write / quoted=%s', async quoted => {
    const f = fixture(row), duplicate = structuredClone(f.graph.nodes[1]);
    duplicate.id = 'second_report'; duplicate.label = row.factor;
    duplicate.user_statements[0].subject_key = 'factor|second_report|||relation';
    duplicate.user_statements[0].statements[0].subject.node_id = duplicate.id;
    f.graph.nodes.push(duplicate);
    const message = quoted ? `Retract the earlier account “${f.graph.nodes[1].user_statements[0].statements[0].quote}”.` : 'Retract the earlier account.';
    const w = await correctionWorld(f.graph, message);
    const review = await w.offer('propose_statement', { correction: { quote: message, edits: [f.request.edits[0]] } });
    // ⭐ GATE → LABEL: a card for the item the AI named (never its indistinguishable twin), saying the item is Olumi's reading.
    expect(review, JSON.stringify(review)).toMatchObject({ ok: true, mutated: false });
    expect(review.public_label).toContain(`Olumi’s reading: these words concern “${row.factor}”.`);
    expect(w.proposals.get(String(review.proposal_id))!.operations.map(o => o.path)).toEqual(['report']);
    expect(w.registers).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
  });
});

it.each([
  { name: 'Training reserve', value: 150000, scale: 3000000, otherWork: false },
  { name: 'Training reserve', value: 150000, scale: 3000000, otherWork: true },
  { name: 'Research reserve', value: 420000, scale: 9000000, otherWork: false },
  { name: 'Research reserve', value: 420000, scale: 9000000, otherWork: true },
])('goal target normalisation preserves other work: $name / otherWork=$otherWork', async ({ name, value, scale, otherWork }) => {
  const graph: Rec = { nodes: [
    { id: 'goal', kind: 'goal', label: name, goal_threshold_unit: 'GBP', scale_frame: scale,
      description: 'The team disputes the timetable; this remains an open assumption.',
      goal_horizon: { deadline: '2027-04-01' }, goal_deadline_as_stated: 'before the next annual review' },
    { id: 'capacity', kind: 'factor', label: 'Available capacity', observed_state: { value: 0.4, raw_value: 40, unit: '%', source: 'cee_inference' } },
    { id: 'option', kind: 'option', label: 'Explore contributions', interventions: { capacity: { value: 0.6, raw_value: 60, unit: '%' } } },
    { id: 'later', kind: 'outcome', label: 'Later extension', analysis_participation: 'retained_excluded',
      description: 'An extension remains an ambition, conditional on what the team learns.' },
  ], edges: [ { from: 'capacity', to: 'goal', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' } ] };
  if (otherWork) graph.nodes[0].future_reasoning = { source: 'Human note', disagreement: 'Retain this tension' };
  const measures = 'Resources available for the immediate work';
  const message = `If we could secure at least £${value} for ${measures}, we could retain the extra support for ${name}.`;
  const w = await correctionWorld(graph, message), offered = await w.offer('propose_goal_target', {
    value, unit: 'GBP', constraint_type: 'at_least', measures,
  });
  if (otherWork) {
    expect(offered).toMatchObject({ ok: false, mutated: false, refusal: 'target_would_change_other_work' });
    expect(w.registers).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(graph); return;
  }
  expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
  expect(w.writes).toHaveLength(0);
  const pid = String(offered.proposal_id), restored = w.restoreCard(w.proposals.get(pid)!, offered, 'propose_goal_target');
  expect(await w.press(pid, restored, false)).toMatchObject({ ok: false, mutated: false });
  expect(await w.press(pid, restored)).toMatchObject({ ok: true, applied: true });
  expect(w.registers).toHaveLength(1); expect(w.writes).toHaveLength(1);
  const goal = w.graph().nodes.find((n: Rec) => n.id === 'goal');
  expect(goal).toMatchObject({ goal_threshold_raw: value, goal_threshold_unit: 'GBP', goal_direction: '>=',
    description: graph.nodes[0].description, goal_horizon: graph.nodes[0].goal_horizon });
  expect(goal).not.toHaveProperty('scale_frame');
  expect(goal.goal_threshold_cap).toBeGreaterThan(0);
  expect(goal.goal_threshold * goal.goal_threshold_cap).toBeCloseTo(value, 8);
  expect(w.graph().goal_constraints).toContainEqual(expect.objectContaining({ node_id: 'goal', value, operator: '>=', value_frame: 'level' }));
  for (const id of ['capacity', 'option', 'later']) expect(withoutRef(w.graph().nodes.find((n: Rec) => n.id === id))).toEqual(graph.nodes.find((n: Rec) => n.id === id));
  const saved = structuredClone(w.graph()); expect((await w.cold()).body.graph).toEqual(saved);
  expect(await w.press(pid, restored)).toMatchObject({ ok: true, already_applied: true }); expect(w.writes).toHaveLength(1);
});

it.each(['warehouse', 'laboratory'].flatMap(domain => [
  { domain, cue: 'quoted', extra: false, selected: false }, { domain, cue: 'quoted', extra: false, selected: true },
  { domain, cue: 'labels', extra: false, selected: false }, { domain, cue: 'labels', extra: true, selected: false },
  { domain, cue: 'unquoted source', extra: false, selected: false },
]))('$domain: a bundled correction binds only named items or quoted old bytes / cue=$cue / extra=$extra / selected=$selected', async ({ domain, cue, extra, selected }) => {
  const first = { kind: 'factor' as const, id: 'first', field: 'relation' as const };
  const second = { kind: 'factor' as const, id: 'second', field: 'relation' as const };
  const earlier = ['Elif reported that customers enter only if every update comes from one reviewer.',
    'Orin assumed that the same reviewer could handle every follow-up.'];
  const record = (subject: typeof first, quote: string) => userStatementRecord(subject,
    [{ speaker: 'unknown', quote, source: quote, form: 'describes', reading: 'olumi', subject: { quantity: domain, node_id: subject.id } }],
    '2026-08-01T00:00:00Z', { recorded_by: 'construction' });
  const graph: Rec = { nodes: [{ id: 'goal', kind: 'goal', label: 'Understand service conditions' },
    { id: 'first', kind: 'factor', label: `${domain} arrival assurance`, user_statements: [record(first, earlier[0]!)] },
    { id: 'second', kind: 'factor', label: `${domain} follow-up coverage`, user_statements: [record(second, earlier[1]!)] }], edges: [] };
  const third = { kind: 'factor' as const, id: 'third', field: 'relation' as const };
  earlier.push('Noor stated that equipment was unavailable.');
  graph.nodes.push({ id: 'third', kind: 'factor', label: 'Forklift and crane booking', user_statements: [record(third, earlier[2]!)] });
  const message = cue === 'quoted'
    ? `Withdraw the earlier accounts “${earlier[0]}” and “${earlier[1]}”. Keep other work unchanged.`
    : cue === 'labels' ? `For ${graph.nodes[1].label} and ${graph.nodes[2].label}, the earlier account was wrong. Withdraw those statements.`
      : 'Elif clarified that reviewer updates were a preference, not a universal condition. Orin withdraws the same-reviewer assumption.';
  const request = { quote: message, edits: (extra ? [first, second, third] : [first, second]).map((subject, i) => ({ subject,
    retirement: { quote: earlier[i]!, scope: 'whole', disposition: 'retracted' }, retained: [],
    reading_words: i === 0 ? 'reported preference, not a universal condition' : 'the same-reviewer assumption is withdrawn' })) };
  const w = await correctionWorld(graph, message);
  if (selected) Object.assign(w.ctx, { grounded_selection: { element_ids: ['first'], unresolved: 'none' } });
  const card = await w.offer('propose_statement', { correction: request });
  if (extra || cue === 'unquoted source') {
    // ⭐ GATE → LABEL: an item the words do not name is labelled Olumi's reading on the card; nothing is written before its press.
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false });
    expect(card.public_label).toContain(`Olumi’s reading: these words concern “${extra ? 'Forklift and crane booking' : graph.nodes[1].label}”.`);
    expect(w.registers).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(graph); return;
  }
  expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false }); expect(w.writes).toHaveLength(0);
  const pid = String(card.proposal_id), restored = w.restoreCard(w.proposals.get(pid)!, card);
  expect(await w.press(pid, restored, false)).toMatchObject({ ok: false, mutated: false });
  expect(await w.press(pid, restored)).toMatchObject({ ok: true, applied: true });
  expect(w.registers).toHaveLength(1); expect(w.writes).toHaveLength(1);
  for (const [i, subject] of [first, second].entries()) {
    const node = w.graph().nodes.find((n: Rec) => n.id === subject.id);
    expect(claimRecordsOn(node)[0]!.statements.filter(s => s.speaker === 'unknown')).toEqual(graph.nodes[i + 1].user_statements[0].statements);
    expect(userStatementFor(w.graph(), subject)!.statements[0]).toMatchObject({ speaker: 'user', quote: message, source: message, reading: 'olumi' });
  }
  expect(withoutRef(w.graph().nodes.find((n: Rec) => n.id === 'third'))).toEqual(graph.nodes[3]);
  const saved = structuredClone(w.graph()); expect((await w.cold()).body.graph).toEqual(saved);
  expect(await w.press(pid, restored)).toMatchObject({ ok: true, already_applied: true }); expect(w.writes).toHaveLength(1);
});


describe.each(cases)('$name: shared speaker reading in the correction review', row => {
  it.each(['other', 'unknown'] as const)('%s reading only removes source credit and gives a non-authorising review', async speaker => {
    const f = fixture(row), w = await correctionWorld(f.graph, f.message);
    const review = await w.offer('propose_statement', { correction: { ...f.request, speaker } });
    // ⭐ GATE → LABEL: the reading only removes source credit — a card whose source is "speaker/source unknown", never "you".
    expect(review, JSON.stringify(review)).toMatchObject({ ok: true, mutated: false });
    expect(review.public_label).toContain(`Recorded words — speaker/source unknown: “${f.message}”`);
    expect(review.public_label).not.toContain('Recorded words — you:');
    expect(w.registers).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
  });
});


it.each(cases)('$name: unknown words alone never author a correction without a new typed source', async row => {
  const f = fixture(row), node = f.graph.nodes[1], earlier = node.user_statements[0].statements[0];
  node.user_statements[0].statements = [{ ...earlier, speaker: 'unknown' }];
  const w = await correctionWorld(f.graph, '');
  Object.assign(w.ctx, { user_turn_text: undefined, user_text: earlier.source, unverified_user_text: earlier.source,
    verified_user_messages: [earlier.source] });
  const result = await w.offer('propose_statement', { correction: { ...f.request, quote: earlier.quote, edits: [f.request.edits[0]] } });
  // ⭐ GATE → LABEL: a card whose source is unverified (no typed words hold it), never the user's; nothing written before its press.
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
  expect(result.public_label).toContain(`Olumi’s proposed reading — source unverified: “${earlier.quote}”`);
  expect(result.public_label).not.toContain('Recorded words — you:');
  expect(w.registers).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
  expect(userStatementFor(w.graph(), f.subject)).toBeUndefined();
});


it.each(cases)('$name: function words in a saved sentence never name the item for a new correction', async row => {
  const subject = { kind: 'factor' as const, id: 'report', field: 'relation' as const };
  const held = `Our ${row.factor.toLowerCase()} arrive late whenever the scanners fail.`;
  const graph: Rec = { nodes: [{ id: 'goal', kind: 'goal', label: 'Reliable handling' },
    { id: 'report', kind: 'factor', label: row.factor, user_statements: [userStatementRecord(subject,
      [{ speaker: 'user', quote: held, source: held, form: 'describes', reading: 'olumi', subject: { quantity: 'reported_account', node_id: 'report' } }], '2026-08-01T00:00:00Z')] },
    { id: 'energy', kind: 'factor', label: 'Energy use' }], edges: [] };
  const message = 'Please withdraw the earlier claim, it was wrong.';
  const w = await correctionWorld(graph, message), result = await w.offer('propose_statement', { correction: { quote: message,
    edits: [{ subject, retirement: { quote: held, scope: 'whole', disposition: 'retracted' }, retained: [], reading_words: 'the earlier account is withdrawn' }] } });
  // ⭐ GATE → LABEL: function words never NAME the item: the card says the item is Olumi's reading; nothing written before its press.
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
  expect(result.public_label).toContain(`Olumi’s reading: these words concern “${row.factor}”.`);
  expect(w.registers).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(graph);
});

// Claude r2 L1/L2/L5: a conjunction in a label never names an item or overrides another item's quoted words.
it.each(['L1 unnamed', 'L2 another quoted item', 'L5 named item'] as const)('%s: a label conjunction never authorises the wrong item', async form => {
  const train = { kind: 'factor' as const, id: 'train', field: 'relation' as const };
  const energy = { ...train, id: 'energy' }, report = { ...train, id: 'report' };
  const held = ['New starters need three weeks before they work alone.', 'Energy use doubled over winter.',
    'Our dispatch updates arrive late whenever the scanners fail.'];
  const subjects = [train, energy, report], labels = ['Training and onboarding', 'Energy use', 'Dispatch updates'];
  const graph: Rec = { nodes: [{ id: 'goal', kind: 'goal', label: 'Reliable handling' }, ...subjects.map((subject, i) => ({
    id: subject.id, kind: subject.kind, label: labels[i], user_statements: [userStatementRecord(subject,
      [{ speaker: 'user', quote: held[i]!, source: held[i]!, form: 'describes', reading: 'olumi',
        subject: { quantity: 'reported_account', node_id: subject.id } }], '2026-08-01T00:00:00Z')],
  }))], edges: [] };
  const positive = form === 'L5 named item', subject = positive ? report : train;
  const message = form === 'L1 unnamed' ? 'Please withdraw the earlier claim and keep the rest.'
    : form === 'L2 another quoted item' ? `Withdraw “${held[1]}” and keep the rest.`
      : 'Withdraw the dispatch updates claim and keep the rest.';
  const w = await correctionWorld(graph, message), card = await w.offer('propose_statement', { correction: { quote: message,
    edits: [{ subject, retirement: { quote: held[positive ? 2 : 0], scope: 'whole', disposition: 'retracted' }, retained: [],
      reading_words: 'the earlier account is withdrawn' }] } });
  if (!positive) {
    // ⭐ GATE → LABEL: a label conjunction never NAMES an item: the card writes only the item the AI named, says that item is
    // Olumi's reading (and, for quoted words of another item, which item they matched), and nothing is written before its press.
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false });
    expect(card.public_label).toContain(`Olumi’s reading: these words concern “Training and onboarding”.${form === 'L2 another quoted item'
      ? ' Olumi’s item reader matched them to “Energy use” instead; approve only if “Training and onboarding” is the item you mean.' : ''}`);
    expect(w.proposals.get(String(card.proposal_id))!.operations.map(o => o.path)).toEqual(['train']);
    expect(w.registers).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(graph); return;
  }
  expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false }); expect(w.writes).toHaveLength(0);
  const pid = String(card.proposal_id), restored = w.restoreCard(w.proposals.get(pid)!, card);
  expect(await w.press(pid, restored, false)).toMatchObject({ ok: false, mutated: false });
  expect(await w.press(pid, restored)).toMatchObject({ ok: true, applied: true });
  expect(w.registers).toHaveLength(1); expect(w.writes).toHaveLength(1);
  for (const id of ['train', 'energy']) expect(withoutRef(w.graph().nodes.find((n: Rec) => n.id === id))).toEqual(graph.nodes.find((n: Rec) => n.id === id));
  const saved = structuredClone(w.graph()); expect((await w.cold()).body.graph).toEqual(saved);
  expect(await w.press(pid, restored)).toMatchObject({ ok: true, already_applied: true }); expect(w.writes).toHaveLength(1);
});
