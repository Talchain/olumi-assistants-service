/**
 * Batch F, D1 admission (DL 12 Oct, PL 6131102031; T6 RESULT.md "Notes for owners"): an event-by-date model's decision
 * node skipped the grounded decision-statement admission every other model goes through (`decisionEntityFor`). It wrote
 * `decision_question || goal.metric` and stamped it `ai_inferred` whatever it was: the user's own sentence was called
 * Olumi's, and a paraphrase would have been kept as the decision's title.
 * Now the same admission: a verbatim span of the brief is kept, and is the user's (`from_brief`) when its binding earns
 * the brief's claim; anything else falls back to "Decision: <metric>", Olumi's.
 *
 * The corpus is T6's four D1 drafts (`fixtures/t6-d1-drafts.json`; sha-checked): arm B (the AIE's prompt, now F's
 * source) copies the brief's governing sentence verbatim twice; arm A (the old prompt) returns null twice.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import t6 from './fixtures/t6-d1-drafts.json';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

type Rec = Record<string, any>;
const BRIEF = t6.brief;
/** The real construction, as production wires it; the decision node of the graph it registers. */
async function decisionOf(rawText: string, edit: (m: Rec) => void = () => {}): Promise<Rec> {
  const m = structuredClone(JSON.parse(rawText)) as Rec;
  edit(m);
  let registered: Rec | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { registered = (body as Rec).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const call = (async () => ({ text: JSON.stringify(m) })) as unknown as CallStructuredModel;
  const result = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', BRIEF, dispatch, call) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 300)).toBe(true);
  const nodes = registered!.nodes as Rec[];
  expect(nodes.some((n) => n.kind === 'goal' && /done by the deadline$/.test(String(n.label))), 'the control: the event-by-date path').toBe(true);
  return nodes.find((n) => n.kind === 'decision')!;
}
const arm = (a: string) => t6.drafts.filter((d) => d.arm === a);

describe('IDENTITY: T6\'s D1 drafts, byte for byte', () => {
  it('four drafts; B copies the brief\'s governing sentence verbatim, A returns null; all event-by-date', () => {
    for (const d of t6.drafts) expect(createHash('sha256').update(d.raw_text).digest('hex')).toBe(d.raw_sha256);
    expect(arm('B').map((d) => JSON.parse(d.raw_text).decision_question)).toEqual([BRIEF, BRIEF]);
    expect(arm('A').map((d) => JSON.parse(d.raw_text).decision_question)).toEqual([null, null]);
    expect(t6.drafts.map((d) => JSON.parse(d.raw_text).goal.kind)).toEqual(['event_by_date', 'event_by_date', 'event_by_date', 'event_by_date']);
  });
});

describe('the event-by-date decision node goes through the grounded admission', () => {
  for (const d of arm('B')) {
    it(`B ${d.rep}: the brief's own sentence is the decision, verbatim, and the user's (from_brief)`, async () => {
      const decision = await decisionOf(d.raw_text);
      expect([decision.label, decision.provenance]).toEqual([BRIEF, 'from_brief']);
    });
  }
  for (const d of arm('A')) {
    it(`A ${d.rep}: no sentence copied → the main path's fallback, Olumi's`, async () => {
      const decision = await decisionOf(d.raw_text);
      expect([decision.label, decision.provenance]).toEqual([`Decision: ${JSON.parse(d.raw_text).goal.metric}`, 'ai_inferred']);
    });
  }
  it('CONTRAST (design: B r1 with a reworded question): a paraphrase is never the title; the fallback, Olumi\'s', async () => {
    const paraphrase = 'Should we hire a tech lead or two developers?';
    expect(BRIEF).not.toContain(paraphrase);
    const decision = await decisionOf(arm('B')[0]!.raw_text, (m) => { m.decision_question = paraphrase; });
    expect(decision.label).not.toBe(paraphrase);
    expect([decision.label, decision.provenance]).toEqual([`Decision: ${JSON.parse(arm('B')[0]!.raw_text).goal.metric}`, 'ai_inferred']);
  });
});
