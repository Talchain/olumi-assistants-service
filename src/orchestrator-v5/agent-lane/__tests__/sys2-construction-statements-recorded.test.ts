/**
 * ⭐ AIE 6183705670 (1) + (3), the ADMISSION first losses in the pre-H0/H1 captures (head c515cfcb, arm C; diagnosis only):
 * D3r1's drafter kept its target and range statements, and D5r1's kept the Support/Sales/Product attribution, yet each registered
 * graph held NO `user_statements` (0 nodes, as captured). A draft's verified statements are now RECORDED on their subjects at
 * construction, as the statement door records a press, so the saved model, a cold reopen and the AI's input hold the user's own
 * sentences, with their speakers. Rows: those actual raws through the real `buildModelFromBrief`, the drafter answering with the
 * captured first and repair passes. Controls: a refused or unbindable statement records nothing; the analysis hash is unmoved.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { userStatementsOn } from '../../statement-door/statements.js';
import { sameCohortStatementOf } from '../../goal-target/cohort-forecast-write.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Rec = Record<string, any>;
const D3 = JSON.parse(readFileSync('tests/fixtures/sys2/pre-h0h1-d3r1.json', 'utf8')) as { brief: string; call1_text: string; call2_text: string; _source: Rec };
const D5 = JSON.parse(readFileSync('tests/fixtures/sys2/pre-h0h1-d5r1.json', 'utf8')) as typeof D3;
const AT = '2026-10-15T03:11:52.000Z';
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(AT)); });
afterEach(() => { vi.useRealTimers(); });

async function registered(c: typeof D3, edit: (raw: Rec) => Rec = (r) => r): Promise<Rec> {
  let graph: Rec | undefined;
  const answers = [c.call1_text, c.call2_text].map((t) => JSON.stringify(edit(JSON.parse(t))));
  let call = 0;
  const result = await buildModelFromBrief('6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c', c.brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: answers[Math.min(call++, answers.length - 1)]!, status: 'completed' })) as never) as Rec;
  if (result.ok !== true || graph === undefined) throw new Error(JSON.stringify(result).slice(0, 2000));
  return graph;
}
const saidOn = (g: Rec, label: string): [string, string[]][] => userStatementsOn((g.nodes as Rec[]).find((n) => n.label === label))
  .map((r) => [r.field, r.statements.map((s) => s.quote)]);

describe('AIE 6183705670: construction statements are recorded on their subjects (the door\'s record)', () => {
  it('PRECONDITION (as captured): both registered graphs held no user_statements', () => {
    expect([D3._source.registered.user_statements_on_any_node, D5._source.registered.user_statements_on_any_node]).toEqual([0, 0]);
  });

  it('D3r1: the target and the stated levels are recorded on their nodes, with the recording time', async () => {
    const g = await registered(D3);
    const goal = (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
    expect(saidOn(g, goal.label)).toContainEqual(['target', ['We want monthly recurring revenue to rise by at least 15% within three months.']]);
    expect(saidOn(g, 'Paying customers today')).toEqual([['level', ['We have 400 paying customers at £20 per customer per month.']]]);
    expect(userStatementsOn(goal).every((r) => r.recorded_at === AT && r.attest?.recorded_by === 'construction')).toBe(true);
  });

  it('CONTROL: a construction record is never a PRESS: a goal relation held now from the brief is not the same-people answer', async () => {
    const sameNow = (r: Rec): Rec => ({ ...r, statements: [...r.statements, { quote: 'We want monthly recurring revenue to rise by at least 15% within three months.',
      subject: { kind: 'goal', label: r.goal.metric, to_label: null, factor_label: null }, field: 'relation', form: 'holds_now', value: null, low: null, high: null,
      unit: null, qualifier: null, conditions: null }] });
    const g = await registered(D3, sameNow);
    const goal = (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
    expect(saidOn(g, goal.label).map(([f]) => f)).toContain('relation'); // recorded (retained) ...
    expect(sameCohortStatementOf(g)).toBeUndefined(); // ... but never read as the card's answer
  });

  it('D5r1 (3): the Support/Sales/Product sentence is recorded, whole and with its speakers, on each subject it was bound to', async () => {
    const g = await registered(D5);
    const attribution = JSON.parse(D5.call2_text).statements[0].quote as string;
    expect(attribution).toMatch(/^Support says .* Sales believes .* Product /);
    for (const label of ['Release reliability', 'Packaging clarity', 'Customer loss from feature freeze']) {
      expect(saidOn(g, label), label).toContainEqual(['relation', [attribution]]);
    }
  });

  it('CONTROLS: a refused statement, or one whose subject is not in the model, records nothing; the analysis hash is unmoved', async () => {
    const misquote = (r: Rec): Rec => ({ ...r, statements: r.statements.map((s: Rec) => ({ ...s, quote: `${s.quote.slice(0, -1)} (paraphrase).` })) });
    const g = await registered(D3, misquote);
    expect((g.nodes as Rec[]).filter((n) => n.user_statements !== undefined)).toEqual([]);
    const unbound = (r: Rec): Rec => ({ ...r, statements: r.statements.map((s: Rec) => ({ ...s, subject: { ...s.subject, label: 'Not in this model' } })) });
    expect(((await registered(D5, unbound)).nodes as Rec[]).filter((n) => n.user_statements !== undefined)).toEqual([]);
    const withRecords = await registered(D3);
    expect(computeAnalysisAffectingGraphHash(withRecords as never)).toBe(computeAnalysisAffectingGraphHash(g as never));
  });
});
