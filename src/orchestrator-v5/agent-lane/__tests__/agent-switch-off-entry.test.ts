/**
 * ⭐ A NEW SWITCH LISTED AT 0 UNDER AN OPTION THAT LEAVES IT OFF IS NOT AN ENTRY (MG lane; served DL run
 * pj-20260928T011147Z on CEE 84440ff, journey A step A03).
 *
 * The user asked: Please add two options to compare: "Improve trial-to-Pro conversion" and "Retention intervention for
 * at-risk accounts". The Agent called `propose_new_option` FIVE times; every call was refused `switch_level_not_on` with
 * `conflict_fields: ["not_one"]` (~23 s), and the reply said the retention switch's "level must be omitted rather than set
 * to zero". Inferred (UNVERIFIED: the served record keeps no arguments): ONE change, TWO options, ONE new switch — and the
 * switch listed at 0 under the conversion option, meaning "this option leaves it off". #2172's refusal said to remove
 * `level` from that entry; a bare switch entry means ON, so the model would not, and looped.
 *
 * SPEC. A NEW switch (this change's `new_factors`, kind 'switch') listed at EXACTLY 0 (a bare 0, or 0 in a percent-class
 * unit) under an option means that option does not act on it — ONLY when another option in the SAME change turns it on.
 * Then the entry is dropped (no intervention, no link) and said (`switch_off_entries_dropped`, option + factor). Where no
 * option turns it on, it is refused, and the detail says: list it under the option that turns it on, and leave it out of
 * the others. Every other refusal stands, and a factor the model already has is never touched. A refused 0 is fixed by
 * removing the ENTRY, never its level.
 *
 * FIXTURE: Paul's persisted graph (scenario a295e4a1) with the two options A03 asked for removed — the model A03 acted on.
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
const SWITCH = 'Retention intervention in place';
const SWITCH_KEY = 'retention_intervention_in_place';
const A03 = `Please add two options to compare: "${CONV}" and "${RET}".`;
const BEFORE_A03: Graph = (() => {
  const fx = JSON.parse(readFileSync(new URL('../../routing/__tests__/fixtures/paul-a295e4a1-before-grandfathering.json', import.meta.url), 'utf8')) as Graph & { _provenance?: unknown };
  const { _provenance: _p, ...graph } = fx;
  const gone = new Set(graph.nodes.filter((x) => x.label === CONV || x.label === RET).map((x) => x.id));
  if (gone.size !== 2) throw new Error('the fixture must hold both A03 options, removed here');
  return { ...graph, nodes: graph.nodes.filter((x) => !gone.has(x.id)), edges: graph.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)) };
})();
const SCENARIO = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e03';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: A03, user_turn_text: A03 };

type Iv = { factor_id?: string; factor_key?: string; value: unknown; source?: unknown };
type Entry = { label?: string; option_id?: string; interventions?: Iv[] };
type Result = {
  ok?: boolean; refusal?: string; detail?: string; conflict_fields?: string[];
  switch_off_entries_dropped?: { option: string; factor: string }[]; switch_off_entries_note?: string;
  options?: { label: string; acts_on: string[] }[]; levels_not_set?: { option: string; factor: string; value: unknown }[];
};

/** The product answers with the hold for the batch it was sent (its `gmh_` handle over the first option's id). */
const setup = (graph: Graph = BEFORE_A03) => {
  const sent: { path: string; body: unknown }[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(graph), graph_hash: 'h0' } };
    sent.push({ path, body });
    const p = (body as { chip?: { parameters?: { option_id?: string; options?: { option_id?: string }[] } } }).chip?.parameters;
    const oid = p?.options?.[0]?.option_id ?? p?.option_id;
    return { status: 200, json: { suggested_actions: [{ id: gmHeldProposalRef(SCENARIO, `node:${oid}`), label: 'Approve 6 changes', message: 'Yes, add both.' }] } };
  };
  return { caps: createAgentCapabilities(d, new ProposalStore()), sent };
};
/** The option entry that was SENT for an option, by its label — never by position. */
const sentOption = (sent: { body: unknown }[], label: string): Entry | undefined => {
  const p = (sent[0]?.body as { chip?: { parameters?: Entry & { options?: Entry[] } } } | undefined)?.chip?.parameters;
  return (p?.options ?? (p !== undefined ? [p] : [])).find((o) => o.label === label);
};
const onSwitch = (e: Entry | undefined) => (e?.interventions ?? []).filter((i) => i.factor_key === SWITCH_KEY);

/** The A03 shape: conversion acts on a factor the model has, with a level, and lists the switch with `convSwitch`. */
const conversion = (convSwitch: Record<string, unknown>[]) => ({ label: CONV, acts_on: [
  { factor_label: 'Monthly new Pro subscribers', direction: 'positive', level: { value: 90, unit: 'subscribers per month', estimate: true, basis: 'a modest conversion uplift' } },
  ...convSwitch.map((e) => ({ factor_label: SWITCH, direction: 'positive', ...e })),
] });
const retention = (retEntries: Record<string, unknown>[] = [{ factor_label: SWITCH, direction: 'positive' }]) => ({ label: RET, acts_on: retEntries });
const NEW_SWITCH = [{ label: SWITCH, kind: 'switch', affects: [{ label: 'Monthly churn', direction: 'negative' }] }];
const a03 = (offLevel: unknown, retEntries?: Record<string, unknown>[]) => ({
  options: [conversion([{ level: offLevel }]), retention(retEntries)],
  new_factors: NEW_SWITCH,
  rationale: 'The user asked to compare both.',
});

describe('R1/R2 — a new switch at exactly 0 under an option, turned on by another option in the change → that entry is dropped', () => {
  it.each([
    ['{ value: 0 } (A03)', { value: 0 }],
    ["{ value: 0, unit: '%' }", { value: 0, unit: '%' }],
    ["{ value: 0, unit: '% of at-risk accounts' }", { value: 0, unit: '% of at-risk accounts' }],
    ['{ value: 0, estimate: true } (Olumi’s reading that it leaves it off)', { value: 0, estimate: true, basis: 'conversion work does not touch retention' }],
  ])('RED: %s → ok, held; retention turns the switch on at 1; conversion sends NO intervention on it; the drop is said', async (_name, offLevel) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, a03(offLevel) as never) as Result;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(onSwitch(sentOption(sent, RET))).toEqual([{ factor_key: SWITCH_KEY, value: 1 }]);
    expect(onSwitch(sentOption(sent, CONV)), JSON.stringify(sentOption(sent, CONV))).toEqual([]);
    // CONTRAST: conversion still acts on the factor it does change.
    expect(sentOption(sent, CONV)?.interventions?.some((i) => i.factor_id === 'monthly_new_pro_subscribers')).toBe(true);
    expect(r.switch_off_entries_dropped).toEqual([{ option: CONV, factor: SWITCH }]);
    expect(r.switch_off_entries_note).toContain('leaves the switch off');
    // What the Agent shows the user: conversion acts on what it changes, not on the switch.
    expect(r.options?.find((o) => o.label === CONV)?.acts_on).toEqual(['Monthly new Pro subscribers']);
    expect(r.options?.find((o) => o.label === RET)?.acts_on).toEqual([SWITCH]);
  });

  it.each([
    ['a bare 1', [{ factor_label: SWITCH, direction: 'positive', level: { value: 1 } }]],
    ["exactly 100%", [{ factor_label: SWITCH, direction: 'positive', level: { value: 100, unit: '%' } }]],
    ['{ 1, estimate: true }', [{ factor_label: SWITCH, direction: 'positive', level: { value: 1, estimate: true, basis: 'it turns it on' } }]],
  ])('RED: the other option turns it on with %s → the 0 entry is dropped all the same', async (_name, retEntries) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, a03({ value: 0 }, retEntries) as never) as Result;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(onSwitch(sentOption(sent, CONV))).toEqual([]);
    expect(onSwitch(sentOption(sent, RET))).toEqual([{ factor_key: SWITCH_KEY, value: 1 }]);
  });

  it('CONTRAST: an option that names the switch twice (bare AND at 0) is two answers — refused as before, nothing sent, never resolved by dropping one', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, { options: [conversion([{}, { level: { value: 0 } }]), retention()], new_factors: NEW_SWITCH, rationale: 'x' } as never) as Result;
    expect(r.refusal, JSON.stringify(r)).toBe('switch_level_not_on');
    expect(r.detail).toContain(`keep ONE acts_on entry for "${SWITCH}" in "${CONV}", with no "level"`);
    expect(sent).toEqual([]);
  });

  it('CONTRAST: the same change with no 0 entry at all → the same options sent, and nothing said as dropped', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, { options: [conversion([]), retention()], new_factors: NEW_SWITCH, rationale: 'x' } as never) as Result;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(onSwitch(sentOption(sent, CONV))).toEqual([]);
    expect(onSwitch(sentOption(sent, RET))).toEqual([{ factor_key: SWITCH_KEY, value: 1 }]);
    expect(r).not.toHaveProperty('switch_off_entries_dropped');
  });

  it('the one-call reply (PJ-C1) is not lost to the note: a whole_request result carrying it is still composed', () => {
    const held = {
      ok: true, mutated: false, proposal_id: 'gmh_0123456789ab', public_label: 'Approve 6 changes',
      held_message: `Yes, add option '${CONV}' and add option '${RET}', with '${SWITCH}' on.`,
      base_revision: 'a'.repeat(64),
      options: [{ label: CONV, linked_from: 'Decision: MRR', acts_on: ['Monthly new Pro subscribers'], levels: [] }, { label: RET, linked_from: 'Decision: MRR', acts_on: [SWITCH], levels: [] }],
      note: 'Nothing has changed yet.',
    };
    const withNote = { ...held, switch_off_entries_dropped: [{ option: CONV, factor: SWITCH }], switch_off_entries_note: '…' };
    expect(composeProposalReply('propose_new_option', { whole_request: true }, held, A03)).not.toBeNull();
    expect(composeProposalReply('propose_new_option', { whole_request: true }, withNote, A03)).toBe(composeProposalReply('propose_new_option', { whole_request: true }, held, A03));
    // CONTRAST: a key with no template still falls back to the second call.
    expect(composeProposalReply('propose_new_option', { whole_request: true }, { ...held, some_other_note: '…' }, A03)).toBeNull();
  });
});

describe('R3 — no option in the change turns the switch on → refused, and the detail says where to list it', () => {
  const NOWHERE = `No option in this change turns "${SWITCH}" on; list it under the option that turns it on`;
  it.each([
    ['the only option lists it at 0', { options: [conversion([{ level: { value: 0 } }])], new_factors: NEW_SWITCH, rationale: 'x' }],
    ['one option at 0, the other does not list it', a03({ value: 0 }, [{ factor_label: 'Monthly churn', direction: 'negative' }])],
    ['both options list it at 0', a03({ value: 0 }, [{ factor_label: SWITCH, direction: 'positive', level: { value: 0 } }])],
    ["one at { 0, '%' }, the other at 0", a03({ value: 0, unit: '%' }, [{ factor_label: SWITCH, direction: 'positive', level: { value: 0 } }])],
  ])('RED: %s → switch_level_not_on, nothing sent; the detail names the switch and says to list it under the option that turns it on', async (_name, args) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, args as never) as Result;
    expect(r.refusal, JSON.stringify(r)).toBe('switch_level_not_on');
    expect(sent).toEqual([]);
    expect(r.detail).toContain(NOWHERE);
    expect(r.detail).toContain('and leave it out of the others');
    expect(r.detail).not.toContain(`remove "level" from the acts_on entry for "${SWITCH}"`);
  });

  it('the single-option refusal keeps its conflict_fields (names only)', async () => {
    const { caps } = setup();
    const r = await caps.proposeNewOption(ctx as never, { options: [conversion([{ level: { value: 0 } }])], new_factors: NEW_SWITCH, rationale: 'x' } as never) as Result;
    expect(r.conflict_fields).toEqual(['not_one']);
  });

  it('ONE HOP: following that detail (the switch bare under retention, left out of conversion) is held — no second refusal', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, { options: [conversion([]), retention()], new_factors: NEW_SWITCH, rationale: 'x' } as never) as Result;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(onSwitch(sentOption(sent, RET))).toEqual([{ factor_key: SWITCH_KEY, value: 1 }]);
  });
});

describe('R4 — a factor the MODEL ALREADY HAS (an existing switch) listed at 0 is untouched: exactly as at base', () => {
  // The switch as A1 commits one: Olumi's today-0, affecting monthly churn. It is a factor the model has, not a new one.
  const EXISTING = 'fac_retention_intervention_in_place';
  const withExistingSwitch: Graph = {
    ...BEFORE_A03,
    nodes: [...BEFORE_A03.nodes, { id: EXISTING, kind: 'factor', label: SWITCH, category: 'observable',
      observed_state: { value: 0, raw_value: 0, source: 'cee_inference', extractionType: 'inferred' } }],
    edges: [...BEFORE_A03.edges, { from: EXISTING, to: 'monthly_churn' }],
  };
  it('BASE BEHAVIOUR: conversion at { value: 0 }, retention bare → not refused; conversion is still LINKED to it with its level unset (said in levels_not_set); nothing said as dropped', async () => {
    const { caps, sent } = setup(withExistingSwitch);
    const r = await caps.proposeNewOption(ctx as never, { options: [conversion([{ level: { value: 0 } }]), retention()], rationale: 'x' } as never) as Result;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    // Base: the 0 is not the user's figure, so its level is left unset and the link is Olumi's (U3 link author).
    expect(sentOption(sent, CONV)?.interventions?.filter((i) => i.factor_id === EXISTING)).toEqual([{ factor_id: EXISTING, value: null, source: 'cee_hypothesis' }]);
    expect(sentOption(sent, RET)?.interventions?.filter((i) => i.factor_id === EXISTING)).toEqual([{ factor_id: EXISTING, value: null, source: 'cee_hypothesis' }]);
    expect(r.levels_not_set?.filter((l) => l.factor === SWITCH)).toEqual([expect.objectContaining({ option: CONV, factor: SWITCH, value: 0 })]);
    expect(r.options?.find((o) => o.label === CONV)?.acts_on).toContain(SWITCH);
    expect(r).not.toHaveProperty('switch_off_entries_dropped');
  });
});

describe('R5 — a refused 0 is fixed by removing the ENTRY, never its level', () => {
  it("RED: conversion at { 0, 'GBP' } (not a switch-off: an amount's unit), retention turns it on → refused; the detail says remove the whole entry from conversion, not its level", async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, a03({ value: 0, unit: 'GBP' }) as never) as Result;
    expect(r.refusal, JSON.stringify(r)).toBe('switch_level_not_on');
    expect(sent).toEqual([]);
    expect(r.detail).toContain(`remove the whole acts_on entry for "${SWITCH}" from "${CONV}"`);
    expect(r.detail).not.toContain(`remove "level" from the acts_on entry for "${SWITCH}" in "${CONV}"`);
    expect(r.detail).not.toContain('graded factor');
  });

  it('ONE HOP: after that refusal, the named next call (the entry removed from conversion) is held — no second refusal', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, { options: [conversion([]), retention()], new_factors: NEW_SWITCH, rationale: 'x' } as never) as Result;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(onSwitch(sentOption(sent, CONV))).toEqual([]);
  });
});

describe('CONTRAST — every other refusal stands in the two-option change (the drop is exactly 0, nothing else)', () => {
  it.each([
    ["{ 1, '%' }", { value: 1, unit: '%' }, ['unit']],
    ["{ 50, '%' }", { value: 50, unit: '%' }, ['unit', 'not_one']],
    ["{ 59, 'GBP' }", { value: 59, unit: 'GBP' }, ['unit', 'not_one']],
    ["{ 'yes' }", { value: 'yes' }, ['non_number']],
    ["{ '0' } (a string)", { value: '0' }, ['non_number']],
    ["{ 0, 'GBP' }", { value: 0, unit: 'GBP' }, ['unit', 'not_one']],
    ["{ 0, estimate: 'yes' }", { value: 0, estimate: 'yes' }, ['not_one', 'estimate']],
    ['a level that is 0, not an object', 0, ['not_object']],
  ])('conversion at %s, retention turns it on → still refused switch_level_not_on, nothing sent', async (_name, level, fields) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, a03(level) as never) as Result;
    expect(r.refusal, JSON.stringify(r)).toBe('switch_level_not_on');
    expect(r.conflict_fields).toEqual(fields);
    expect(sent).toEqual([]);
  });
});
