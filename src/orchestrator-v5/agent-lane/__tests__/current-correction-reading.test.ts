import { describe, expect, it } from 'vitest';
import { projectModelContext } from '../runtime/agent-capabilities.js';
import { userStatementOf } from '../user-statements.js';
import { recordedMeasureOf } from '../../statement-door/fields/measure.js';
import { subjectKey } from '../../statement-door/subject.js';
import { claimRecordFor, prepareStatementCorrection, userStatementFor, userStatementRecord, withUserStatement } from '../../statement-door/statements.js';

type Rec = Record<string, any>;
const subject = { kind: 'goal' as const, id: 'coverage', field: 'measure' as const };
const original = 'Coverage is measured in staff hours, mostly on nights.';
function corrected(retained: string[], retired: string, old = original) {
  const g: Rec & { nodes: unknown[] } = { nodes: [{ id: 'coverage', kind: 'goal', label: 'Coverage',
    goal_threshold_raw: 10, goal_threshold_unit: '%', goal_threshold_frame: 'change_rel',
    goal_target_basis: { quantity_frame: 'level', target_frame: 'change_rel', target_raw: 10, reference: 'today',
      denominator: "today's staff hours", period_months: 3, period_kind: 'at_end', effect_unit: '% of staff hours',
      effects_at_period_end: true, source: 'olumi_reading' },
  }], edges: [] };
  // This is an existing stored record, not a new quote that the person must repeat to keep it.
  const held = userStatementOf({ quote: old, source: old, speaker: 'user', reading: 'olumi', form: 'describes',
    subject: { quantity: subjectKey(subject), node_id: subject.id } });
  if (held === undefined) throw new Error('Malformed stored source fixture');
  const before = withUserStatement(g, userStatementRecord(subject, [held], '2026-10-17T12:00:00Z',
    { recorded_by: 'construction' }), subject)!;
  const quote = `For Coverage, withdraw “${retired}”; keep ${retained.some(s => s.length > 300)
    ? 'the complete measurement description before that phrase, as listed on the card'
    : retained.length ? retained.map(s => `“${s}”`).join(' and ') : 'nothing from the earlier account'}.`;
  const result = prepareStatementCorrection(before, { quote, edits: [{ subject,
    retirement: { quote: retired, scope: retained.length ? 'part' : 'whole', disposition: 'retracted' }, retained,
    reading_words: 'The listed parts remain; the specified earlier account is withdrawn.' }] }, { now: quote }, '2026-10-17T13:00:00Z');
  if ('refused' in result) throw new Error(result.refused);
  return { before: before as Rec, graph: result.candidate as Rec, quote, old };
}
const view = (graph: Rec): Rec => projectModelContext({ nodes: graph.nodes, edges: graph.edges, raw: graph,
  analysis_state: undefined, analysis_ready: false } as never);
const materialView = (graph: Rec): Rec => view(graph).recorded_reasoning.find((n: Rec) => n.id === subject.id);
const recordView = (graph: Rec): Rec => {
  const material = materialView(graph);
  const { field, ...current } = material.current_retained.find((r: Rec) => r.field === subject.field);
  return { field, current_retained: current, source_record: material.user_statements.find((r: Rec) => r.field === field) };
};

describe('N6: current retained words and complete earlier source remain distinct', () => {
  it.each([
    { retired: 'mostly on nights', retained: 'staff hours', measure: 'staff hours' },
    { retired: 'staff hours', retained: 'mostly on nights', measure: undefined },
  ])('a source correction retaining $retained never reactivates $retired', ({ retired, retained, measure }) => {
    const w = corrected([retained], retired), snapshot = structuredClone(w.graph);
    expect(recordedMeasureOf(w.graph.nodes[0])).toBe(measure);
    const held = userStatementFor(w.graph, subject)!;
    expect(held.statements[1]!.quote).toBe(original);
    expect(recordView(w.graph)).toEqual({ field: 'measure', current_retained: {
      spans: [{ text: retained, origin: 'held_user_statement' }], complete: true,
    }, source_record: held });
    expect(w.graph).toEqual(snapshot);
  });

  it.each([0, 200, 201, 451])('retained text of length %s survives the actual correction encoder and cold read', length => {
    const span = ('staff hours with the full qualifications '.repeat(20)).slice(0, length);
    const old = length ? `Coverage means ${span}, mostly on nights.` : original;
    const w = corrected(length ? [span] : [], length ? 'mostly on nights' : old, old);
    const cold = JSON.parse(JSON.stringify(w.graph));
    cold.nodes[0].user_statements[0].attest = Object.fromEntries(Object.entries(cold.nodes[0].user_statements[0].attest).reverse());
    const snapshot = structuredClone(cold);
    expect(recordView(cold).current_retained).toEqual({ spans: length ? [{ text: span, origin: 'held_user_statement' }] : [], complete: true });
    expect(recordView(cold).source_record).toEqual(claimRecordFor(cold, subject));
    if (length) expect(recordView(cold).source_record.statements[1].quote).toBe(old);
    expect(cold).toEqual(snapshot);
  });

  it('unknown retained origin is preserved and cannot license a user-supplied measure', () => {
    const w = corrected(['staff hours'], 'mostly on nights');
    w.graph.nodes[0].user_statements[0].attest.retained_0_origin = 'unknown';
    expect(recordView(w.graph).current_retained).toEqual({ spans: [{ text: 'staff hours', origin: 'unknown' }], complete: true });
    expect(recordedMeasureOf(w.graph.nodes[0])).toBeUndefined();
    expect(recordView(w.graph).source_record).toEqual(claimRecordFor(w.graph, subject));
  });

  it.each(['missing piece', 'unrecognised origin', 'invalid count'])('%s cannot restore the old quote as current', fault => {
    const span = ('staff hours with complete qualifications '.repeat(10)).slice(0, 201);
    const w = corrected([span], 'mostly on nights', `Coverage means ${span}, mostly on nights.`);
    const attest = w.graph.nodes[0].user_statements[0].attest;
    if (fault === 'missing piece') delete attest.retained_0_part_1;
    if (fault === 'unrecognised origin') attest.retained_0_origin = 'not evidenced';
    if (fault === 'invalid count') attest.retained_count = Number.MAX_SAFE_INTEGER;
    expect(recordView(w.graph).current_retained).toEqual({ spans: [], complete: false });
    expect(recordedMeasureOf(w.graph.nodes[0])).toBeUndefined();
    expect(recordView(w.graph).source_record).toEqual(claimRecordFor(w.graph, subject));
  });

  it('a non-correction record keeps its complete source and measure in the shared reasoning projection', () => {
    const { before } = corrected(['staff hours'], 'mostly on nights');
    expect(materialView(before).user_statements).toEqual(before.nodes[0].user_statements);
    expect(materialView(before).current_retained).toBeUndefined();
    expect(recordedMeasureOf(before.nodes[0])).toBe('staff hours');
  });
});
