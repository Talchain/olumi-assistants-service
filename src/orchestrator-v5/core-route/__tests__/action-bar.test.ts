/**
 * The panel's action bar on a core scenario (`action-bar.ts`, DL 93d79c3e 09:24Z): the one ranker over a served graph read,
 * keeping only what a core press serves (the pre-mortem). Over a SERVED read body (capacity, CEE c1e944a4), whose own legacy
 * bar is the contrast: the ranking is the same read's, only the filter differs.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { coreActionBarOf } from '../action-bar.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/s9-range-delta/capacity-c1e944a4-read10-C.json', import.meta.url), 'utf8')).body as Json;
const SID = 'scn_capacity';
const ids = (bar: Json | undefined) => (bar === undefined ? [] : [...bar.priority, ...bar.standard, ...bar.more].map((o: Json) => o.action_id));
const body = (): Json => { const { action_bar: _served, ...rest } = structuredClone(SERVED); return rest; };

describe('the core action bar: the one ranker, only what a core press serves', () => {
  it('a served read: the pre-mortem alone, enabled, pressing the id the core route already answers; the same read\'s legacy bar offers more', () => {
    expect(ids(SERVED.action_bar), 'contrast: the legacy bar on this read').toEqual(expect.arrayContaining(['review', 'what_changes', 'strengthen', 'pre_mortem']));
    const bar = coreActionBarOf(SID, body())!;
    expect(ids(bar)).toEqual(['pre_mortem']);
    expect(bar.standard).toEqual([expect.objectContaining({ action_id: 'pre_mortem', press_id: 'agent-next-pre-mortem', enabled: true,
      why_now: 'Imagine this went badly and find the most likely causes.' })]);
    expect(bar.priority).toEqual([]);
    expect(bar.more).toEqual([]);
    expect(bar).not.toHaveProperty('bias_risk');
    expect(bar.revision.graph_hash).toBe(SERVED.graph_hash);
  });

  it('the turn\'s read and the reload rank alike: the fields only one of them carries change nothing', () => {
    const reload = { ...body(), analysis_result: { ...body().analysis_result, summary: '' }, conversation_turns: [{ role: 'user', content: 'hi' }] };
    expect(JSON.stringify(coreActionBarOf(SID, reload))).toBe(JSON.stringify(coreActionBarOf(SID, body())));
  });

  it('a precondition the person can change keeps the action, disabled with its reason: no goal yet', () => {
    const b = body();
    b.graph = { ...b.graph, nodes: b.graph.nodes.filter((n: Json) => n.kind !== 'goal') };
    expect(coreActionBarOf(SID, b)!.standard).toEqual([expect.objectContaining({ action_id: 'pre_mortem', enabled: false,
      disabled_reason: 'Needs a goal in the model first.' })]);
  });

  it('⛔ nothing to offer is NO bar, never an empty one (an empty bar would hide the method strip): no graph yet', () => {
    expect(coreActionBarOf(SID, { ...body(), graph: null, graph_hash: null })).toBeUndefined();
  });
});
