import { describe, expect, it } from 'vitest';
import { readStatement } from '../../statement-door/read.js';
import { doorRowFor } from '../../statement-door/role-table.js';
import { userStatementsOn } from '../../statement-door/statements.js';
import { applyStatementRecordEdit } from '../../goal-target/cohort-forecast-write.js';

const graph = () => ({ nodes: [
  { id: 'goal', kind: 'goal', label: 'Understand distribution', goal_threshold_unit: 'qualitative', goal_threshold_frame: 'level' },
  { id: 'notification', kind: 'factor', label: 'Notification effect',
    observed_state: { value: 0.2, raw_value: 20, unit: '%', source: 'cee_inference' } },
  { id: 'staff', kind: 'factor', label: 'Staff availability' },
], edges: [] });
const subject = { kind: 'factor' as const, id: 'notification', field: 'measure' as const };
const quote = 'Notification effect covers a supplier claim of 12% relative reduction from an external study, not percentage points.';
const words = 'a supplier claim of 12% relative reduction from an external study';
const read = (g = graph()) => readStatement(g, subject, 'Notification effect', [{ quote, reading_words: words }], { now: quote });

describe('qualitative correction carriers: retained wording and operative changes are separate', () => {
  it('the existing factor definition row can retain a clarified relative claim without converting its number', () => {
    const before = graph(), result = read(before);
    expect(result.kind, JSON.stringify(result)).toBe('read');
    if (result.kind !== 'read') throw new Error('No reading');
    const approved = doorRowFor(subject, before)!.writer.approve(result.reading, before);
    if ('refused' in approved) throw new Error(approved.refused);
    expect(approved.member).toBe('statement_record');
    const write = applyStatementRecordEdit(before, approved.payload as never);
    expect(write.kind, JSON.stringify(write)).toBe('mutated');
    if (write.kind !== 'mutated') throw new Error('No write');
    const after = write.mutatedGraph as ReturnType<typeof graph>;
    expect(after.nodes.find(n => n.id === 'notification')?.observed_state).toEqual(before.nodes[1]!.observed_state);
    expect(after.edges).toEqual(before.edges);
    const record = userStatementsOn(after.nodes.find(n => n.id === 'notification'));
    expect(record).toHaveLength(1);
    expect(record[0]!.statements[0]).toMatchObject({ quote, source: quote, speaker: 'user', reading: 'olumi' });
    expect(userStatementsOn(after.nodes.find(n => n.id === 'staff'))).toEqual([]);
  });

  it('the record writer keeps its stale-node protection', () => {
    const before = graph(), result = read(before);
    if (result.kind !== 'read') throw new Error('No reading');
    const approved = doorRowFor(subject, before)!.writer.approve(result.reading, before);
    if ('refused' in approved) throw new Error(approved.refused);
    const changed = graph();
    changed.nodes[1]!.observed_state!.raw_value = 24;
    expect(applyStatementRecordEdit(changed, approved.payload as never)).toEqual({ kind: 'refused', reason: 'node_changed' });
  });

  it('the quantitative goal-measure adapter does not express a qualitative change of aim', () => {
    const corrected = 'Understand distribution now means understanding conflicting priorities before testing a route change.';
    const result = readStatement(graph(), { kind: 'goal', id: 'goal', field: 'measure' }, 'Understand distribution',
      [{ quote: corrected, reading_words: 'understanding conflicting priorities' }], { now: corrected });
    expect(result.kind).toBe('refused');
  });
});
