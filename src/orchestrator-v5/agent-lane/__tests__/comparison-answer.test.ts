/**
 * "Ask about this comparison" (`comparison-answer.ts`; Compare audit scope, lease #85 5949274551). Every pair is a SERVED
 * cold graph read (`fixtures/comparison/*.json`, trimmed to graph + analysis_state + current_read, each with its source path
 * and sha256), and the over-drop corpus is the audit's 123 served ordinary Agent replies. Rows bind by identity: the exact
 * string back when nothing fails, the plan's own code line when something does, the corpus reply by its file.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMPARISON_BLOCK_RULE, comparisonBlockOf, enforceComparisonAnswer } from '../comparison-answer.js';
import { rerunPlanForGraph, RERUN_NO_CHANGE_LINES } from '../rerun-explanation.js';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

type Node = { id: string; kind: string; label: string };
type Read = { _source: string; json: { graph: { nodes: Node[] }; current_read: { run_delta?: Record<string, unknown> } } };
const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/comparison/${name}.json`, import.meta.url), 'utf8')) as Read;
const planOf = (r: Read) => rerunPlanForGraph(r.json.current_read.run_delta, r.json.graph, false);
const labelsOf = (r: Read) => r.json.graph.nodes.map((n) => n.label);
const enforce = (reply: string, r: Read) => enforceComparisonAnswer(reply, planOf(r), labelsOf(r));

const C1_COMPLETE = read('c1-complete');
const C1_PARTIAL = read('c1-partial');
const C2_PARTIAL = read('c2-partial');
const C2_COMPLETE = read('c2-complete');
const C0 = read('c0');
const C3 = read('c3');
const NO_PAIR = read('stale-no-pair');

/** The served pair's own change, named the way the user would: a link by its ends, anything else by its label. */
const changedThing = (r: Read) => {
  const row = (r.json.current_read.run_delta!.input_changes as { link?: { from: string; to: string }; label_after?: string }[])[0]!;
  const label = (id: string) => r.json.graph.nodes.find((n) => n.id === id)!.label;
  return row.link !== undefined ? `how much ${label(row.link.from)} changes ${label(row.link.to)}` : row.label_after!;
};
const causal = (r: Read) => `Your change to ${changedThing(r)} caused the difference between the two runs.`;
const WHY = 'The comparison now rests on that estimate.';

describe('the served pairs are what the rows say they are (controls)', () => {
  it.each([
    [C1_COMPLETE, 'C1_attributable', 'complete'], [C1_PARTIAL, 'C1_attributable', 'partial'], [C2_PARTIAL, 'C2_unpaired', 'partial'],
    [C2_COMPLETE, 'C2_unpaired', 'complete'], [C0, 'C0_identical', 'complete'], [C3, 'C3_engine_drift', 'complete'],
  ] as const)('%#: %s', (r, wireCase, coverage) => {
    expect(r._source).toMatch(/^output\/r3-successor-996ec64d\/f5\//u);
    expect(r.json.current_read.run_delta).toMatchObject({ attribution_case: wireCase, input_coverage: coverage });
  });
  it('the stale read carries no pair', () => {
    expect((NO_PAIR.json as { analysis_state: { run_state: { kind: string } } }).analysis_state.run_state.kind).toBe('complete_stale');
    expect(NO_PAIR.json.current_read.run_delta).toBeUndefined();
  });
});

describe('the comparison block: the read\'s own pair, in Olumi\'s words, with what may be said', () => {
  it('IDENTITY: endpoints, case and coverage are the read\'s; what_changed is the plan\'s code line; no leader, no figure', () => {
    const d = C1_COMPLETE.json.current_read.run_delta as { endpoints: { prior: { computed_at: string }; current: { computed_at: string } } };
    const block = comparisonBlockOf(C1_COMPLETE.json.current_read.run_delta, planOf(C1_COMPLETE));
    expect(block).toEqual({
      endpoints: { prior: { computed_at: d.endpoints.prior.computed_at }, current: { computed_at: d.endpoints.current.computed_at } },
      attribution_case: 'C1_attributable', input_coverage: 'complete',
      what_changed: planOf(C1_COMPLETE)!.codeLine,
      cause_licensed: true, movement_licensed: true, beyond_noise: false, rule: COMPARISON_BLOCK_RULE,
    });
    expect(JSON.stringify(block)).not.toMatch(/win_probabilit|leader|run_id/u);
  });
  it.each([
    ['C1 + partial coverage: no cause, and no matched figures → no movement', C1_PARTIAL, false, false, 'no_matched_figures'],
    ['C2 + partial', C2_PARTIAL, false, true, undefined],
    ['C2 + complete', C2_COMPLETE, false, true, undefined],
    ['C0', C0, false, true, undefined],
    ['C3 (engine drift)', C3, false, true, undefined],
  ] as const)('%s', (_n, r, cause, movement, unavailable) => {
    const block = comparisonBlockOf(r.json.current_read.run_delta, planOf(r))!;
    expect(block.cause_licensed).toBe(cause);
    expect(block.movement_licensed).toBe(movement);
    expect(block.movement_unavailable).toBe(unavailable);
    expect(block.what_changed).toBe(planOf(r)!.codeLine);
  });
  it('R5 (input half): no pair → no block', () => {
    expect(planOf(NO_PAIR)).toBeNull();
    expect(comparisonBlockOf(NO_PAIR.json.current_read.run_delta, planOf(NO_PAIR))).toBeUndefined();
  });
});

describe('the backstop on the narrator\'s own words', () => {
  it('R1 CONTROL: C1 + complete licenses the cause → the reply is returned as the SAME string', () => {
    const reply = `${causal(C1_COMPLETE)} ${WHY}`;
    const out = enforce(reply, C1_COMPLETE);
    expect(out.text).toBe(reply);
    expect(out.dropped).toEqual([]);
  });
  it.each([
    ['R2: C1 on PARTIAL coverage (the coverage-blind mutant passes this)', C1_PARTIAL],
    ['R2: C2 on partial coverage', C2_PARTIAL],
    ['R2: C2 on complete coverage', C2_COMPLETE],
  ] as const)('%s → the cause sentence is dropped and Olumi\'s code line appended', (_n, r) => {
    const reply = `${causal(r)} ${WHY}`;
    const out = enforce(reply, r);
    expect(out.failed).toEqual(['CA-NO-CAUSE-UNLICENSED']);
    expect(out.dropped).toEqual([causal(r)]);
    expect(out.text).toBe(`${WHY}\n\n${planOf(r)!.fallback}`);
  });
  it('R3 GATE CONTROL: the served "Nothing has changed yet." about a held write, beside a pair WITH rows → kept, same string', () => {
    const served = JSON.parse(readFileSync(new URL('./fixtures/comparison/b8-05-s2-say.json', import.meta.url), 'utf8')) as { assistant_text: string };
    expect(served.assistant_text).toContain('Nothing has changed yet.');
    expect(planOf(C2_PARTIAL)!.inputs.change_labels).toHaveLength(1);
    expect(enforce(served.assistant_text, C2_PARTIAL).text).toBe(served.assistant_text);
  });
  it.each([
    ['R4: a named change', C2_PARTIAL],
    ['R4: a recorded change no template can name (served `presence` row)', C2_COMPLETE],
  ] as const)('%s → "nothing changed between the two runs" is dropped', (_n, r) => {
    const reply = `Nothing changed between the two runs. ${WHY}`;
    const out = enforce(reply, r);
    expect(out.failed).toEqual(['CA-NO-CONTRARY-SAME']);
    expect(out.text).toBe(`${WHY}\n\n${planOf(r)!.fallback}`);
  });
  it('R4 CONTROL: with NO recorded row (C0) the same sentence is true and kept', () => {
    const reply = `Nothing changed between the two runs. ${WHY}`;
    expect(enforce(reply, C0).text).toBe(reply);
  });
  it('R5: no pair → the causal claim is dropped (fail-closed) and NOTHING is appended', () => {
    const reply = `${causal(C1_COMPLETE)} ${WHY}`;
    const out = enforceComparisonAnswer(reply, planOf(NO_PAIR), labelsOf(NO_PAIR));
    expect(out.failed).toEqual(['CA-NO-CAUSE-UNLICENSED']);
    expect(out.text).toBe(WHY);
  });
  it('R5: no pair and nothing left → Olumi says it can\'t tell', () => {
    expect(enforceComparisonAnswer(causal(C1_COMPLETE), null, labelsOf(NO_PAIR)).text).toBe(RERUN_NO_CHANGE_LINES.unknown);
  });
  it('movement: no matched figures (C1 partial) drops "rose"; a pair with matched figures keeps it', () => {
    const reply = `Its chance rose since the last run. ${WHY}`;
    expect(enforce(reply, C1_PARTIAL).failed).toEqual(['CA-NO-MOVEMENT-UNLICENSED']);
    expect(enforce(reply, C2_PARTIAL).text).toBe(reply);
  });
  it('a list keeps its marker on the line\'s first kept sentence; a line left empty goes', () => {
    const reply = `Why:\n- ${causal(C2_PARTIAL)} ${WHY}\n- Ask me what would change it.`;
    expect(enforce(reply, C2_PARTIAL).text).toBe(`Why:\n- ${WHY}\n- Ask me what would change it.\n\n${planOf(C2_PARTIAL)!.fallback}`);
  });
});

describe('R6: the audit\'s 123 SERVED ordinary replies (over-drop guard)', () => {
  const corpus = JSON.parse(readFileSync(new URL('./fixtures/comparison/ordinary-replies.json', import.meta.url), 'utf8')) as {
    _files_scanned: number; replies: { f: string; t: string; labels: string[] }[];
  };
  it('the corpus is the audit\'s: 1,021 files → 123 unique ordinary replies', () => {
    expect(corpus._files_scanned).toBe(1021);
    expect(corpus.replies).toHaveLength(123);
  });
  it('no pair: every reply is returned as the SAME string', () => {
    const changed = corpus.replies.filter((r) => enforceComparisonAnswer(r.t, null, r.labels).text !== r.t).map((r) => r.f);
    expect(changed).toEqual([]);
  });
  it.each([['C1 + complete', C1_COMPLETE], ['C2 + partial', C2_PARTIAL], ['C2 + complete', C2_COMPLETE]] as const)(
    'a pair with rows (%s): exactly ONE reply changes, the real "unchanged inputs" comparison claim', (_n, pair) => {
      const changed = corpus.replies.filter((r) => enforceComparisonAnswer(r.t, planOf(pair), r.labels).text !== r.t);
      expect(changed.map((r) => r.f)).toEqual(['inv-d1/02-s1-run.json']);
      expect(enforceComparisonAnswer(changed[0]!.t, planOf(pair), changed[0]!.labels).dropped)
        .toEqual(['This rerun still cannot put an option forward; unchanged inputs provide repeatability, not new validation.']);
    });
  it.each([['C0', C0], ['C3', C3]] as const)('a pair with no rows (%s): no reply changes', (_n, pair) => {
    expect(corpus.replies.filter((r) => enforceComparisonAnswer(r.t, planOf(pair), r.labels).text !== r.t)).toEqual([]);
  });
});

describe('the CURRENT MODEL STATE carries the block from the SAME graph read (input half)', () => {
  const ctx = { scenario_id: '34276a19-0000-4000-8000-0000000000c1', authenticated_user_id: 'user-a', request_id: 'r' };
  const capsOver = async (r: Read) =>
    createAgentCapabilities(async () => ({ status: 200, json: r.json as unknown as Record<string, unknown> }), new ProposalStore());
  it('IDENTITY: state.comparison is exactly the block of the read\'s current_read.run_delta', async () => {
    const st = await (await capsOver(C2_PARTIAL)).getCanonicalState(ctx as never) as Record<string, unknown>;
    expect(st.ok).toBe(true);
    expect(st.comparison).toEqual(comparisonBlockOf(C2_PARTIAL.json.current_read.run_delta, planOf(C2_PARTIAL)));
    expect((st.comparison as { what_changed: string }).what_changed).toContain('Split Sprint Capacity');
  });
  it('R5 (input half): a stale read with no pair → no comparison key at all', async () => {
    const st = await (await capsOver(NO_PAIR)).getCanonicalState(ctx as never) as Record<string, unknown>;
    expect(st.ok).toBe(true);
    expect('comparison' in st).toBe(false);
  });
});
