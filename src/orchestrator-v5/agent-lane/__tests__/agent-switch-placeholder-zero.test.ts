/**
 * ⭐ A PLACEHOLDER 0 ON THE ONE ENTRY NAMING A NEW SWITCH IS NO LEVEL, WHERE "OFF" WOULD MAKE THE CHANGE MEAN NOTHING (MG,
 * switch-loop step 5; OpenAI Runtime #72 5865857191, corrected 5865861134; DL ranking 5865911113 item 3).
 *
 * After step 3 (#2200), 41 served journey-A turns on 16 builds still refused `switch_level_not_on` (`not_one`): 98
 * refusals, 25 turns that proposed nothing. Runtime's replay ledger: the model re-sends BYTE-IDENTICAL arguments whose level
 * is `{value: 0, unit: "", estimate: false, basis: ""}` — every field its empty default. MG's gate on c35f1c7 (runs
 * `c2217/run-20260928T074228Z-{1,2,3}`, `_agent.tool_calls[].rejected_levels`): 4 turns, 12 refusals, each `{value: 0}` on
 * the ONLY entry naming the switch, under the option that turns it on —
 *   · A07/A08 (one option): "Grandfather existing customers" under "£59 for new Pro customers; grandfather existing
 *     customers" (5 + 2 refusals, then the option was given up);
 *   · A03 (two options): the retention switch under "Retention intervention for at-risk accounts", that option's ONLY entry
 *     (3 and 2 refusals); the call that finally held had the retention option acting on the switch alone.
 *
 * SPEC. A level that says nothing but 0 (no unit, no `estimate: true`, no basis, no other key) on the ONLY acts_on entry
 * in the change that names a new switch is read as NO level — the option turns the switch on — where "off" would be
 * incoherent: the change adds ONE option, or the switch is that option's ONLY entry. Said in the result; the one-call reply
 * is kept. Unchanged: a 0 that says more; a switch two entries name; and #2200's shape (a 0 under an option that also acts
 * on something else, in a change of several options), where "this option leaves it off" is a reading.
 *
 * FIXTURE: Paul's persisted graph (scenario a295e4a1) with the two A03 options removed, as `agent-switch-off-entry.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { gmHeldProposalRef } from '../../handlers/edit-graph-referee-gate.js';
import { composeProposalReply } from '../proposal-reply.js';

type Node = { id: string; kind: string; label: string; category?: string; observed_state?: Record<string, unknown> };
type Graph = { nodes: Node[]; edges: { from: string; to: string }[] };
const CONV = 'Improve trial-to-Pro conversion';
const RET = 'Retention intervention for at-risk accounts';
const RET_SWITCH = 'Retention intervention deployed';
const RET_KEY = 'retention_intervention_deployed';
const GRANDFATHER = '£59 for new Pro customers; grandfather existing customers';
const GF_SWITCH = 'Grandfather existing customers';
const GF_KEY = 'grandfather_existing_customers';
const BEFORE_A03: Graph = (() => {
  const fx = JSON.parse(readFileSync(new URL('../../routing/__tests__/fixtures/paul-a295e4a1-before-grandfathering.json', import.meta.url), 'utf8')) as Graph & { _provenance?: unknown };
  const { _provenance: _p, ...graph } = fx;
  const gone = new Set(graph.nodes.filter((x) => x.label === CONV || x.label === RET).map((x) => x.id));
  if (gone.size !== 2) throw new Error('the fixture must hold both A03 options, removed here');
  return { ...graph, nodes: graph.nodes.filter((x) => !gone.has(x.id)), edges: graph.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)) };
})();
const SCENARIO = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e05';
const ctx = (text: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: text, user_turn_text: text });
const A03 = `Please add two options to compare: "${CONV}" and "${RET}".`;
const A07 = `Let’s add the grandfathering of existing customers: "${GRANDFATHER}".`;

type Iv = { factor_id?: string; factor_key?: string; value: unknown; source?: unknown };
type Entry = { label?: string; option_id?: string; interventions?: Iv[] };
type Result = {
  ok?: boolean; refusal?: string; detail?: string; conflict_fields?: string[];
  switch_placeholder_levels_read_as_on?: { option: string; factor: string }[]; switch_placeholder_levels_note?: string;
  switch_off_entries_dropped?: { option: string; factor: string }[];
  options?: { label: string; acts_on: string[] }[]; option?: { label: string; acts_on: string[] };
  levels_not_set?: { option: string; factor: string; value: unknown }[];
};

/** The product answers with the hold for the batch it was sent (its `gmh_` handle over the first option's id). */
const setup = (graph: Graph = BEFORE_A03) => {
  const sent: { path: string; body: unknown }[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(graph), graph_hash: 'h0' } };
    sent.push({ path, body });
    const p = (body as { chip?: { parameters?: { option_id?: string; options?: { option_id?: string }[] } } }).chip?.parameters;
    const oid = p?.options?.[0]?.option_id ?? p?.option_id;
    return { status: 200, json: { suggested_actions: [{ id: gmHeldProposalRef(SCENARIO, `node:${oid}`), label: 'Approve changes', message: 'Yes.' }] } };
  };
  return { caps: createAgentCapabilities(d, new ProposalStore()), sent };
};
/** The option entry that was SENT for an option, by its label — never by position. */
const sentOption = (sent: { body: unknown }[], label: string): Entry | undefined => {
  const p = (sent[0]?.body as { chip?: { parameters?: Entry & { options?: Entry[] } } } | undefined)?.chip?.parameters;
  return (p?.options ?? (p !== undefined ? [p] : [])).find((o) => o.label === label);
};
const on = (e: Entry | undefined, key: string) => (e?.interventions ?? []).filter((i) => i.factor_key === key);

/** Runtime's replay-ledger shape: every field its empty default. */
const LEDGER = { value: 0, unit: '', estimate: false, basis: '' };

/** A07's one-option shape: the £59 the user stated, and the grandfather switch with the level under test. */
const a07 = (level: unknown, extra: Record<string, unknown>[] = []) => ({
  label: GRANDFATHER,
  acts_on: [
    { factor_label: 'Pro plan price', direction: 'positive', level: { value: 59, unit: 'GBP per month' } },
    { factor_label: GF_SWITCH, direction: 'positive', ...(level === undefined ? {} : { level }) },
    ...extra,
  ],
  new_factors: [{ label: GF_SWITCH, kind: 'switch', affects: [{ label: 'Monthly churn', direction: 'negative' }] }],
  rationale: 'The user asked for it.',
});
const RET_NEW = [{ label: RET_SWITCH, kind: 'switch', affects: [{ label: 'Monthly churn', direction: 'negative' }] }];
/** A03's served shape: conversion acts on a factor the model has; retention lists ONLY its switch, at the level under test. */
const a03 = (retLevel: unknown, convSwitch: Record<string, unknown>[] = []) => ({
  options: [
    { label: CONV, acts_on: [
      { factor_label: 'Monthly new Pro subscribers', direction: 'positive', level: { value: 90, unit: 'subscribers per month', estimate: true, basis: 'a modest conversion uplift' } },
      ...convSwitch.map((e) => ({ factor_label: RET_SWITCH, direction: 'positive', ...e })),
    ] },
    { label: RET, acts_on: [{ factor_label: RET_SWITCH, direction: 'positive', level: retLevel }] },
  ],
  new_factors: RET_NEW,
  rationale: 'The user asked to compare both.',
});

describe('RED — served A07 (one option): the placeholder 0 on the grandfather switch is read as on, in ONE call', () => {
  it.each([
    ['Runtime\'s ledger shape { 0, "", false, "" }', LEDGER],
    ['the served rejected_levels shape { 0 }', { value: 0 }],
    ['{ 0, unit: "  ", estimate: null }', { value: 0, unit: '  ', estimate: null }],
  ])('%s → held; the switch is on at 1 under the option; the £59 is still sent; the reading is said', async (_name, level) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx(A07) as never, a07(level) as never) as Result;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(on(sentOption(sent, GRANDFATHER), GF_KEY)).toEqual([{ factor_key: GF_KEY, value: 1 }]);
    expect(sentOption(sent, GRANDFATHER)?.interventions?.some((i) => i.factor_id === 'pro_plan_price' && i.value !== null)).toBe(true);
    expect(r.switch_placeholder_levels_read_as_on).toEqual([{ option: GRANDFATHER, factor: GF_SWITCH }]);
    expect(r.switch_placeholder_levels_note).toContain('a placeholder, not a figure');
  });

  it('BYTE-IDENTICAL to the call the refusal asked for (the entry with no level key): the same batch is sent', async () => {
    const placeholder = setup();
    await placeholder.caps.proposeNewOption(ctx(A07) as never, a07(LEDGER) as never);
    const bare = setup();
    const r = await bare.caps.proposeNewOption(ctx(A07) as never, a07(undefined) as never) as Result;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r).not.toHaveProperty('switch_placeholder_levels_read_as_on');
    // Each call mints its own turn id and option id; every other byte of the batch is the same.
    const minted = (sent: unknown[]) => {
      const text = JSON.stringify(sent);
      const ids = [...new Set([...text.matchAll(/"(?:turn_id|option_id)":"([^"]+)"/g)].map((m) => m[1]!))];
      expect(ids.length).toBeGreaterThanOrEqual(2);
      return ids.reduce((t, id, i) => t.split(id).join(`<minted ${i}>`), text);
    };
    expect(minted(placeholder.sent)).toBe(minted(bare.sent));
  });
});

describe('RED — served A03 (two options): the retention switch, its option\'s ONLY entry, at a placeholder 0 → on under retention', () => {
  it.each([['LEDGER', LEDGER], ['{ 0 }', { value: 0 }]])('%s → held; retention turns it on at 1; conversion does not touch it', async (_name, level) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx(A03) as never, a03(level) as never) as Result;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(on(sentOption(sent, RET), RET_KEY)).toEqual([{ factor_key: RET_KEY, value: 1 }]);
    expect(on(sentOption(sent, CONV), RET_KEY)).toEqual([]);
    expect(r.switch_placeholder_levels_read_as_on).toEqual([{ option: RET, factor: RET_SWITCH }]);
    expect(r.options?.find((o) => o.label === RET)?.acts_on).toEqual([RET_SWITCH]);
  });
});

describe('unchanged — a 0 that says more is a reading, refused exactly as before (one option)', () => {
  it.each([
    ["{ 0, '%' }", { value: 0, unit: '%' }, ['unit', 'not_one']],
    ["{ 0, 'binary' }", { value: 0, unit: 'binary' }, ['unit', 'not_one']],
    ["{ 0, 'GBP' }", { value: 0, unit: 'GBP' }, ['unit', 'not_one']],
    ['{ 0, estimate: true, basis }', { value: 0, estimate: true, basis: 'it stays off' }, ['not_one', 'estimate']],
    ['{ 0, estimate: false, basis } (a basis is a reading)', { value: 0, estimate: false, basis: 'it stays off' }, ['not_one']],
    ['{ 0, another key }', { value: 0, note: 'off' }, ['not_one']],
    ["{ '0' } (a string)", { value: '0' }, ['non_number']],
    ['a level that is 0, not an object', 0, ['not_object']],
  ])('%s → switch_level_not_on, nothing sent, nothing read', async (_name, level, fields) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx(A07) as never, a07(level) as never) as Result;
    expect(r.refusal, JSON.stringify(r)).toBe('switch_level_not_on');
    expect(r.conflict_fields).toEqual(fields);
    expect(sent).toEqual([]);
  });
});

describe('unchanged — where "off" is a reading, or the switch is named twice', () => {
  it('#2200\'s shape: a placeholder 0 under CONVERSION (which also acts on something else), retention not listing it → refused as before', async () => {
    const { caps, sent } = setup();
    const args = a03(LEDGER, [{ level: LEDGER }]);
    args.options[1] = { label: RET, acts_on: [{ factor_label: 'Monthly churn', direction: 'negative', level: undefined as never }] };
    delete (args.options[1].acts_on[0] as { level?: unknown }).level;
    const r = await caps.proposeNewOption(ctx(A03) as never, args as never) as Result;
    expect(r.refusal, JSON.stringify(r)).toBe('switch_level_not_on');
    expect(sent).toEqual([]);
    expect(r).not.toHaveProperty('switch_placeholder_levels_read_as_on');
  });

  it('both options list the switch at a placeholder 0, each as its only entry → refused (which one turns it on?)', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx(A03) as never, {
      options: [
        { label: CONV, acts_on: [{ factor_label: RET_SWITCH, direction: 'positive', level: LEDGER }] },
        { label: RET, acts_on: [{ factor_label: RET_SWITCH, direction: 'positive', level: LEDGER }] },
      ],
      new_factors: RET_NEW, rationale: 'x',
    } as never) as Result;
    expect(r.refusal, JSON.stringify(r)).toBe('switch_level_not_on');
    expect(sent).toEqual([]);
  });

  it('one option names the switch twice (placeholder 0 AND bare) → two answers, refused as before', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx(A07) as never, a07(LEDGER, [{ factor_label: GF_SWITCH, direction: 'positive' }]) as never) as Result;
    expect(r.refusal, JSON.stringify(r)).toBe('switch_level_not_on');
    expect(r.detail).toContain(`keep ONE acts_on entry for "${GF_SWITCH}" in "${GRANDFATHER}", with no "level"`);
    expect(sent).toEqual([]);
  });

  it('another option turns the switch on → conversion\'s placeholder 0 is dropped as OFF (#2200), never read as on', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx(A03) as never, a03(undefined, [{ level: LEDGER }]) as never) as Result;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(on(sentOption(sent, CONV), RET_KEY)).toEqual([]);
    expect(on(sentOption(sent, RET), RET_KEY)).toEqual([{ factor_key: RET_KEY, value: 1 }]);
    expect(r.switch_off_entries_dropped).toEqual([{ option: CONV, factor: RET_SWITCH }]);
    expect(r).not.toHaveProperty('switch_placeholder_levels_read_as_on');
  });

  it('a factor the MODEL ALREADY HAS at a placeholder 0 is untouched: no switch reading (base behaviour, levels_not_set)', async () => {
    const EXISTING = 'fac_grandfather_existing_customers';
    const graph: Graph = { ...BEFORE_A03,
      nodes: [...BEFORE_A03.nodes, { id: EXISTING, kind: 'factor', label: GF_SWITCH, category: 'observable', observed_state: { value: 0, raw_value: 0, source: 'cee_inference' } }],
      edges: [...BEFORE_A03.edges, { from: EXISTING, to: 'monthly_churn' }] };
    const { caps } = setup(graph);
    const { new_factors: _n, ...args } = a07(LEDGER);
    const r = await caps.proposeNewOption(ctx(A07) as never, args as never) as Result;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r).not.toHaveProperty('switch_placeholder_levels_read_as_on');
    expect(r.levels_not_set?.filter((l) => l.factor === GF_SWITCH)).toEqual([expect.objectContaining({ option: GRANDFATHER, value: 0 })]);
  });
});

describe('the one-call reply (PJ-C1) is kept: the reading adds no second model call', () => {
  it('a whole_request result carrying the reading composes exactly as the same result without it', () => {
    const held = {
      ok: true, mutated: false, proposal_id: 'gmh_0123456789ab', public_label: 'Approve 4 changes',
      held_message: `Yes, add option '${GRANDFATHER}', with '${GF_SWITCH}' on.`, base_revision: 'a'.repeat(64),
      option: { label: GRANDFATHER, linked_from: 'Decision: MRR', acts_on: ['Pro plan price', GF_SWITCH] }, levels: [],
      note: 'Nothing has changed yet.',
    };
    const withReading = { ...held, switch_placeholder_levels_read_as_on: [{ option: GRANDFATHER, factor: GF_SWITCH }], switch_placeholder_levels_note: '…' };
    expect(composeProposalReply('propose_new_option', { whole_request: true, label: GRANDFATHER }, held, A07)).not.toBeNull();
    expect(composeProposalReply('propose_new_option', { whole_request: true, label: GRANDFATHER }, withReading, A07)).toBe(composeProposalReply('propose_new_option', { whole_request: true, label: GRANDFATHER }, held, A07));
  });
});
