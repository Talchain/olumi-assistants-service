/**
 * ⭐ DL 05:46Z (capacity e2e on c1e944a4, judge item 7): "Each additional specialist resolves about 20 tickets per week, between
 * 10 and 30." kept its 10–30 as the user's, but the POINT 20 was stored as cee_inference / unverified ("Not confirmed from your
 * brief"). First loss, measured gate by gate on the served raw e4ff6039: the drafter's one statement is form range (value 20,
 * low 10, high 30), which the map refuses (it never pairs figures); the frame needs the implicit "per specialist"; and the next
 * sentence (a definition of OTHER quantities) tripped the next-sentence bound rule. Rows: the served raw through the real build;
 * controls keep a correction, a mismatched pair, a definition about this factor and a same-frame repeat refused. D3r1: its £20.
 * DL ruling 15 Oct ~06:2xZ: a neighbouring sentence bounds a figure only if it speaks about THAT figure (statements about other
 * subjects with no figure in this frame do not; a repeat outside this frame is another claim). Merge after the capture.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { admitCandidateModel } from '../admit-model.js';
import { verifiedFactorLevel } from '../verified-option-setting.js';

type Rec = Record<string, any>;
const SERVED = JSON.parse(readFileSync('tests/fixtures/sys2/served-capacity-e4ff6039.json', 'utf8')) as { brief: string; raw_text: string };
const RAW = JSON.parse(SERVED.raw_text) as Rec;
const D3 = JSON.parse(readFileSync('tests/fixtures/sys2/pre-h0h1-d3r1.json', 'utf8')) as { brief: string; call2_text: string };
const LABEL = 'Tickets resolved per additional specialist';
const SENTENCE = 'Each additional specialist resolves about 20 tickets per week, between 10 and 30.';
const DEFINITION = 'Total weekly support capacity is defined as the existing 80 tickets per week plus the additional specialist capacity.';
const factor = (r: Rec): never => r.factors.find((f: Rec) => f.label === LABEL) as never;
const node = (r: Rec, brief: string): Rec => admitCandidateModel(r as never, {}, brief).nodes.find((n) => n.label === LABEL) as Rec;

async function registered(): Promise<Rec> {
  let graph: Rec | undefined;
  const result = await buildModelFromBrief('8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e', SERVED.brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: SERVED.raw_text, status: 'completed' })) as never) as Rec;
  if (result.ok !== true || graph === undefined) throw new Error(JSON.stringify(result).slice(0, 2000));
  return graph;
}

describe('a point the user states inside a range is theirs (DL 05:46Z, capacity e2e)', () => {
  it('PRECONDITION (served e4ff6039): the only statement for it is form range, and the next sentence is the definition', () => {
    expect(RAW.statements.filter((s: Rec) => s.subject.label === LABEL).map((s: Rec) => [s.form, s.value, s.low, s.high, s.quote]))
      .toEqual([['range', 20, 10, 30, SENTENCE]]);
    expect(SERVED.brief).toContain(`${SENTENCE} ${DEFINITION}`);
  });

  it('RED: the 20 is the user\'s verified level through the real build, beside their 10–30 range', async () => {
    expect(verifiedFactorLevel(RAW as never, factor(RAW), SERVED.brief)).toBe(true);
    const g = await registered();
    const n = (g.nodes as Rec[]).find((x) => x.label === LABEL)!;
    expect(n.observed_state).toMatchObject({ raw_value: 20, source: 'brief_extraction', extractionType: 'explicit',
      range: { low: 10, high: 30, source: 'user_override', source_quote: SENTENCE } });
    expect(n.observed_state.user_material_unverified).toBeUndefined();
  });

  // S4 SHORTCUT (Paul 15 Oct 09:15Z; DL): the drafter's statement is trusted as filed; the neighbour, definition and frame
  // controls below are switched off. A correction is the drafter's to file (its own statement), never the host's word reading.
  it('S4 SHORTCUT: a correction as the next sentence no longer refuses the drafter\'s point', () => {
    const brief = SERVED.brief.replace(DEFINITION, 'Actually it is at most 25 tickets per week per specialist.');
    expect(verifiedFactorLevel(RAW as never, factor(RAW), brief)).toBe(true);
    expect(node(RAW, brief).observed_state.source).toBe('brief_extraction');
  });

  it('CONTROL (kept): a range whose ends the quote does not write is not trusted', () => {
    const r = { ...RAW, statements: RAW.statements.map((s: Rec) => (s.subject.label === LABEL ? { ...s, low: 5 } : s)) };
    expect(verifiedFactorLevel(r as never, factor(r), SERVED.brief)).toBe(false);
  });

  it('S4 SHORTCUT: a definition the map holds as about this factor no longer withholds the drafter\'s level', () => {
    const r = { ...RAW, statements: RAW.statements.map((s: Rec) => (s.field === 'relation' ? { ...s, subject: { ...s.subject, label: LABEL } } : s)) };
    expect(verifiedFactorLevel(r as never, factor(r), SERVED.brief)).toBe(true);
  });

  it('D3r1 (second brief): "£20 per customer per month" is theirs; "10–20% churn" is a different-frame repeat, the goal sentence is about the goal', () => {
    const raw = JSON.parse(D3.call2_text) as Rec;
    expect(D3.brief).toContain('could cause 10–20% churn');
    const nodes = admitCandidateModel(raw as never, {}, D3.brief).nodes as unknown as Rec[];
    expect(nodes.find((n) => n.label === 'Monthly price')?.observed_state).toMatchObject({ raw_value: 20, source: 'brief_extraction' });
    // S4 SHORTCUT: the ambiguity check is off; the drafter's own statement of today's 400 is the user's.
    expect(nodes.find((n) => n.label === 'Paying customers today')?.provenance).toBe('from_brief');
  });

  it('S4 SHORTCUT (D3r1): a same-frame repeat no longer refuses the drafter\'s £20', () => {
    const raw = JSON.parse(D3.call2_text) as Rec;
    const brief = D3.brief.replace('could cause 10–20% churn', 'could cause churn even at £20 per customer per month');
    const price = raw.factors.find((f: Rec) => f.label === 'Monthly price') as never;
    expect(verifiedFactorLevel(raw as never, price, D3.brief)).toBe(true);
    expect(verifiedFactorLevel(raw as never, price, brief)).toBe(true);
  });
});
