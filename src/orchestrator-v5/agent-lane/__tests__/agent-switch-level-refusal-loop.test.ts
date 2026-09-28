/**
 * ⛔ A NEW SWITCH'S LEVEL THAT MEANS "ON" IS ON, AND A REFUSED ONE IS FIXED IN ONE HOP (MG lane; served DL run
 * pj-20260927T233309Z on CEE e09b8c2, journey A step A05).
 *
 * The user said: Let's add the grandfathering of existing customers: "£59 for new Pro customers; grandfather existing
 * customers". The Agent called `propose_new_option` SIX times; every call was refused `switch_level_not_on` and the turn
 * hit hop_limit (~20 s, "I was not able to finish that"). A06 ("just add it with your assumptions") re-modelled the
 * switch as a GRADED factor at 100%, so the refused level was almost certainly `{ value: 100, unit: '%…' }` — "fully
 * on" (UNVERIFIED: the served `_agent.tool_calls` kept identity only, never the arguments).
 *
 * SPEC. A new switch's ON is 1. A level that MEANS on is taken as on, with no figure dropped: a bare 1; `true`; EXACTLY
 * 100 in a percent-class unit (`classifyUnitScaleClass`, never a word list). Every other figure is refused, never
 * rounded ({1,'%'} is a user's 1% — VERIFIER-S1 — and stays refused). A refusal names the exact next call (the same
 * arguments with `level` removed from that acts_on entry) and, for a partial share or another quantity, the graded
 * alternative.
 *
 * FIXTURE: Paul's persisted graph before the grandfathering add (scenario a295e4a1), the model A05 acted on.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const PAUL = (() => {
  const fx = JSON.parse(readFileSync(new URL('../../routing/__tests__/fixtures/paul-a295e4a1-before-grandfathering.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  const { _provenance: _p, ...graph } = fx;
  return graph;
})();
const A05 = 'Let’s add the grandfathering of existing customers: "£59 for new Pro customers; grandfather existing customers".';
const GRANDFATHER = '£59 for new Pro customers; grandfather existing customers';
const SWITCH = 'Existing customers grandfathered';
const SWITCH_KEY = 'existing_customers_grandfathered';
const ctx = { scenario_id: '6b0d1c2b-3a4f-4e5d-8c6b-7a8f9e0d2c01', authenticated_user_id: null, request_id: 'r', user_text: A05, user_turn_text: A05 };

type Result = { ok?: boolean; refusal?: string; detail?: string; conflict_fields?: string[]; switch_level_conflicts?: unknown[] };
const setup = () => {
  const sent: { path: string; body: unknown }[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(PAUL), graph_hash: 'h0' } };
    sent.push({ path, body });
    // Every inner request answers 500 (`not_prepared`): what is bound here is what was SENT, and whether a refusal came first.
    return { status: 500, json: {} };
  };
  return { caps: createAgentCapabilities(d, new ProposalStore()), sent };
};
/** The A05 shape: the £59 price the user stated, and the switch the option turns on, with the level under test. */
/** `kind: null` leaves kind out of the new factor (a graded factor). */
const a05 = (switchEntries: Record<string, unknown>[] = [{}], kind: 'switch' | null = 'switch') => ({
  label: GRANDFATHER,
  acts_on: [
    { factor_label: 'Pro plan price', direction: 'positive', level: { value: 59, unit: 'GBP per month' } },
    ...switchEntries.map((e) => ({ factor_label: SWITCH, direction: 'positive', ...e })),
  ],
  new_factors: [{ label: SWITCH, ...(kind !== null ? { kind } : {}),
    affects: [{ label: 'Monthly churn', direction: 'negative' }, { label: 'MRR', direction: 'negative' }] }],
  rationale: 'The user asked for it.',
});
const withLevel = (level: unknown) => a05([{ level }]);
/** The switch's intervention on the option the user named — bound by option label and factor key, never by position. */
const switchLevelSent = (sent: { body: unknown }[]) => {
  const params = (sent[0]?.body as { chip?: { parameters?: { label?: string; interventions?: { factor_key?: string }[] } } } | undefined)?.chip?.parameters;
  if (params?.label !== GRANDFATHER) return undefined;
  return params.interventions?.filter((i) => i.factor_key === SWITCH_KEY);
};
const REMOVE_LEVEL = `remove "level" from the acts_on entry for "${SWITCH}" in "${GRANDFATHER}"`;
const GRADED = `declare "${SWITCH}" as a graded factor instead`;

describe('R1/R2 — a level that MEANS on is on: sent at 1, structural (no source), in ONE call, no refusal', () => {
  it.each([
    ["{ 100, '%' }", { value: 100, unit: '%' }],
    ["{ 100, '% of existing Pro customers' } (A05's likely shape)", { value: 100, unit: '% of existing Pro customers' }],
    ["{ 100, 'percent' }", { value: 100, unit: 'percent' }],
    ["{ 100, 'per cent' }", { value: 100, unit: 'per cent' }],
    ["{ 100, '%', estimate: true } (Olumi's reading of \"grandfather existing customers\")", { value: 100, unit: '%', estimate: true, basis: 'all existing customers keep their price' }],
  ])('R1 RED: a new switch at %s → accepted; the option turns it on at 1 with no source', async (_name, level) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, withLevel(level) as never) as Result;
    expect(r.refusal, JSON.stringify(r)).not.toBe('switch_level_not_on');
    expect(sent).toHaveLength(1);
    expect(switchLevelSent(sent), JSON.stringify(r)).toEqual([{ factor_key: SWITCH_KEY, value: 1 }]);
  });

  it.each([
    ['{ value: true }', { value: true }],
    ['{ value: true, estimate: true }', { value: true, estimate: true, basis: 'the option turns it on' }],
  ])('R2 RED: a new switch at %s → accepted as 1', async (_name, level) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, withLevel(level) as never) as Result;
    expect(r.refusal, JSON.stringify(r)).not.toBe('switch_level_not_on');
    expect(switchLevelSent(sent), JSON.stringify(r)).toEqual([{ factor_key: SWITCH_KEY, value: 1 }]);
  });

  it('RED: 100% and true send the same on-level, byte for byte, as no level and a bare 1', async () => {
    const levels: string[] = [];
    for (const entries of [[{}], [{ level: { value: 1 } }], [{ level: { value: 100, unit: '%' } }], [{ level: { value: true } }]]) {
      const { caps, sent } = setup();
      await caps.proposeNewOption(ctx as never, a05(entries) as never);
      levels.push(JSON.stringify(switchLevelSent(sent)));
    }
    expect(new Set(levels).size, levels.join(' | ')).toBe(1);
    expect(levels[0]).toBe(JSON.stringify([{ factor_key: SWITCH_KEY, value: 1 }]));
  });
});

describe('R3 — every other figure is refused, never rounded to on, with nothing sent', () => {
  it.each([
    ["{ 1, '%' } (a user's 1% — VERIFIER-S1)", { value: 1, unit: '%' }, ['unit']],
    ["{ 50, '%' } (a partial share)", { value: 50, unit: '%' }, ['unit', 'not_one']],
    ["{ 99.9, '%' }", { value: 99.9, unit: '%' }, ['unit', 'not_one']],
    ["{ 150, '%' }", { value: 150, unit: '%' }, ['unit', 'not_one']],
    ["{ 59, 'GBP' } (an amount)", { value: 59, unit: 'GBP' }, ['unit', 'not_one']],
    ["{ 100 } with no unit (could be £100)", { value: 100 }, ['not_one']],
    ["{ 100, 'GBP' }", { value: 100, unit: 'GBP' }, ['unit', 'not_one']],
    ["{ 100, 'pp' } (percentage points, not a share)", { value: 100, unit: 'pp' }, ['unit', 'not_one']],
    ["{ 100, 'bps' }", { value: 100, unit: 'bps' }, ['unit', 'not_one']],
    // A bare { 0 } on the only entry is a placeholder, read as on (switch-loop step 5: `agent-switch-placeholder-zero.test.ts`).
    ["{ 0, '%' }", { value: 0, unit: '%' }, ['unit', 'not_one']],
    ["{ 'yes' }", { value: 'yes' }, ['non_number']],
    ["{ '100%' } (a string)", { value: '100%' }, ['non_number']],
    ["{ true, '%' }", { value: true, unit: '%' }, ['unit']],
    ["a level that is 'yes', not an object", 'yes', ['not_object']],
    ['a level that is 0, not an object', 0, ['not_object']],
    ["{ 100, '%', estimate: 'yes' } (not a boolean)", { value: 100, unit: '%', estimate: 'yes' }, ['estimate']],
  ])('R3 CONTRAST: a new switch at %s → refused switch_level_not_on, nothing sent, and the fields that fired', async (_name, level, fields) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, withLevel(level) as never) as Result;
    expect(r.refusal, JSON.stringify(r)).toBe('switch_level_not_on');
    expect(r.conflict_fields).toEqual(fields);
    expect(sent).toEqual([]);
  });
});

// ⭐ SWITCH-LOOP STEP 2 (#2194's `rejected_levels`, served `a8cffcf`, OpenAI): the model wrote the switch's ON with a word
// for its STATE as the unit — MG pj-20260928T040509Z A05 `{1, unit: "enabled", estimate: true}`, DL pj-20260928T040536Z
// A07 `{1, unit: "binary"}` — and each was refused, costing a call (and, after the refusal, a contradicting `{0}`). Two
// runs, two words: the test is inverted (DL #72 5863189058). A 1 is refused only when its unit reads as a QUANTITY.
describe('R8 — a 1 in a unit that names the switch\'s STATE is on; a 1 in a quantity stays refused', () => {
  it.each([
    ["{ 1, 'enabled', estimate: true } (served MG A05)", { value: 1, unit: 'enabled', estimate: true, basis: 'the option grandfathers existing customers' }],
    ["{ 1, 'binary' } (served DL A07)", { value: 1, unit: 'binary' }],
    ["{ 1, 'Enabled' }", { value: 1, unit: 'Enabled' }],
    ["{ 1, 'on/off' }", { value: 1, unit: 'on/off' }],
    ["{ true, 'boolean' }", { value: true, unit: 'boolean' }],
    ["{ 1, 'active' }", { value: 1, unit: 'active' }],
  ])('R8 RED: a new switch at %s → accepted in ONE call; the option turns it on at 1 with no source', async (_name, level) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, withLevel(level) as never) as Result;
    expect(r.refusal, JSON.stringify(r)).not.toBe('switch_level_not_on');
    expect(sent).toHaveLength(1);
    expect(switchLevelSent(sent), JSON.stringify(r)).toEqual([{ factor_key: SWITCH_KEY, value: 1 }]);
  });

  it.each([
    ["{ 1, 'GBP' } (an amount)", { value: 1, unit: 'GBP' }, ['unit']],
    ["{ 1, '£' }", { value: 1, unit: '£' }, ['unit']],
    ["{ 1, 'GBP per month' }", { value: 1, unit: 'GBP per month' }, ['unit']],
    ["{ 1, 'hire' } (a count)", { value: 1, unit: 'hire' }, ['unit']],
    ["{ 1, 'enabled users' } (a state word beside a count)", { value: 1, unit: 'enabled users' }, ['unit']],
    ["{ 1, 'customers' } (a count the unit classifier does not list)", { value: 1, unit: 'customers' }, ['unit']],
    ["{ 1, 'per month' } (a rate)", { value: 1, unit: 'per month' }, ['unit']],
    ["{ 1, '0/1' } (digits: fails closed)", { value: 1, unit: '0/1' }, ['unit']],
    ["{ 2, 'binary' } (not one)", { value: 2, unit: 'binary' }, ['unit', 'not_one']],
    ["{ 0.5, 'enabled' } (a partial state)", { value: 0.5, unit: 'enabled' }, ['unit', 'not_one']],
  ])('R8 CONTRAST: a new switch at %s → refused as before, nothing sent', async (_name, level, fields) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, withLevel(level) as never) as Result;
    expect(r.refusal, JSON.stringify(r)).toBe('switch_level_not_on');
    expect(r.conflict_fields).toEqual(fields);
    expect(sent).toEqual([]);
  });
});

// ⭐ SWITCH-LOOP STEP 4 (DL #72 5864154474; served pj-20260928T053022Z A06 on a94fcb9, OpenAI): the model spelled the
// switch's states INSIDE the unit — `{1, unit: "binary (0=no, 1=yes)", estimate: true}` — and the digit test read the
// glossary's own 0 and 1 as an amount: refused ×4 (`["unit","estimate"]`), then the reply gave up the option. A 0 or 1
// bound to a word by "=" or ":" names a STATE when that word reads as no quantity; every other digit still refuses.
describe('R10 — a unit that spells its own states ("0=no, 1=yes") names the switch; its 1 is on', () => {
  it.each([
    ['{ 1, "binary (0=no, 1=yes)", estimate: true } (served DL A06, ×4)', { value: 1, unit: 'binary (0=no, 1=yes)', estimate: true }],
    ['{ 1, "boolean (1 = on, 0 = off)" }', { value: 1, unit: 'boolean (1 = on, 0 = off)' }],
    ['{ 1, "flag: yes=1, no=0" }', { value: 1, unit: 'flag: yes=1, no=0' }],
    ['{ true, "binary (0=no, 1=yes)" }', { value: true, unit: 'binary (0=no, 1=yes)' }],
  ])('R10 RED: a new switch at %s → accepted in ONE call; the option turns it on at 1 with no source', async (_name, level) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, withLevel(level) as never) as Result;
    expect(r.refusal, JSON.stringify(r)).not.toBe('switch_level_not_on');
    expect(sent).toHaveLength(1);
    expect(switchLevelSent(sent), JSON.stringify(r)).toEqual([{ factor_key: SWITCH_KEY, value: 1 }]);
  });

  it('R10 (the DL\'s second question): { 1, estimate: true } with no unit is on — the estimate alone never refuses', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, withLevel({ value: 1, estimate: true }) as never) as Result;
    expect(r.refusal, JSON.stringify(r)).not.toBe('switch_level_not_on');
    expect(switchLevelSent(sent)).toEqual([{ factor_key: SWITCH_KEY, value: 1 }]);
  });

  it.each([
    ['{ 1, "hires (0=none, 1=one)" } (a count beside its glossary)', { value: 1, unit: 'hires (0=none, 1=one)' }, ['unit']],
    ['{ 1, "GBP (1=£1)" } (the pair binds a figure, not a word)', { value: 1, unit: 'GBP (1=£1)' }, ['unit']],
    ['{ 1, "% (1=yes)" } (a user\'s 1%)', { value: 1, unit: '% (1=yes)' }, ['unit']],
    ['{ 1, "binary (0=no, 1=customer)" } (a glossary word that is a count: fails closed)', { value: 1, unit: 'binary (0=no, 1=customer)' }, ['unit']],
    ['{ 1, "binary (0=no, 2=yes)" } (a code that is not 0 or 1)', { value: 1, unit: 'binary (0=no, 2=yes)' }, ['unit']],
    ['{ 1, "1 hire (0=no, 1=yes)" } (a figure outside the glossary)', { value: 1, unit: '1 hire (0=no, 1=yes)' }, ['unit']],
    ['{ 2, "binary (0=no, 1=yes)" } (not one)', { value: 2, unit: 'binary (0=no, 1=yes)' }, ['unit', 'not_one']],
  ])('R10 CONTRAST: a new switch at %s → refused as before, nothing sent', async (_name, level, fields) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, withLevel(level) as never) as Result;
    expect(r.refusal, JSON.stringify(r)).toBe('switch_level_not_on');
    expect(r.conflict_fields).toEqual(fields);
    expect(sent).toEqual([]);
  });
});

// Served 137d3a5 (MG pj-20260928T042134Z A07/A08): the grandfather switch at `{0}` in the ONLY option, four times.
// Switch-loop step 5 (Runtime 5865857191): that PLACEHOLDER 0 is now read as on (`agent-switch-placeholder-zero.test.ts`);
// a 0 that says more ({ 0, 'binary' }) keeps this refusal and its exact next call.
describe('R9 — a one-option change that lists its new switch at a 0 that says off is told the exact next call, and that call is held', () => {
  it("R9 RED: { 0, 'binary' } → refused; the detail names the entry with NO \"level\" key (not 0)", async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, withLevel({ value: 0, unit: 'binary' }) as never) as Result;
    expect(r.refusal, JSON.stringify(r)).toBe('switch_level_not_on');
    expect(sent).toEqual([]);
    expect(r.detail).toContain(`except send the acts_on entry for "${SWITCH}" in "${GRANDFATHER}" with NO "level" key at all`);
  });
  it('R9 ONE HOP: following it (the entry with no level) is held, the switch on at 1, in ONE call', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, a05([{}]) as never) as Result;
    // The fixture answers every inner request 500: what is bound is what was SENT, and that no refusal came first.
    expect(r.refusal, JSON.stringify(r)).not.toBe('switch_level_not_on');
    expect(sent).toHaveLength(1);
    expect(switchLevelSent(sent)).toEqual([{ factor_key: SWITCH_KEY, value: 1 }]);
  });
});

describe('R4 — a refusal is fixable in ONE hop: it names the exact next call, and the graded alternative for a share or an amount', () => {
  it.each([
    ["{ 50, '%' }", { value: 50, unit: '%' }, '50%'],
    ["{ 1, '%' }", { value: 1, unit: '%' }, '1%'],
    ["{ 59, 'GBP' }", { value: 59, unit: 'GBP' }, '59 GBP'],
    ["{ 1, 'hire' }", { value: 1, unit: 'hire' }, '1 hire'],
  ])('R4 RED: %s → the detail names removing "level" from that entry AND declaring the factor graded', async (_name, level, shown) => {
    const { caps } = setup();
    const r = await caps.proposeNewOption(ctx as never, withLevel(level) as never) as Result;
    expect(r.refusal).toBe('switch_level_not_on');
    expect(r.detail).toContain(`it was given a level: ${shown}.`);
    expect(r.detail).toContain(`call propose_new_option again with exactly the same arguments, except ${REMOVE_LEVEL}`);
    expect(r.detail).toContain(GRADED);
    expect(r.detail).toContain('tell the user it is on under this option');
  });

  it("R4 RED: { 1, 'unit' } → the detail names removing \"level\" from that entry", async () => {
    const { caps } = setup();
    const r = await caps.proposeNewOption(ctx as never, withLevel({ value: 1, unit: 'unit' }) as never) as Result;
    expect(r.refusal).toBe('switch_level_not_on');
    expect(r.detail).toContain(`call propose_new_option again with exactly the same arguments, except ${REMOVE_LEVEL}`);
  });

  it.each([
    ["{ 'yes' }", { value: 'yes' }],
    ["a level that is 'yes'", 'yes'],
    ["{ 1, estimate: 'yes' }", { value: 1, estimate: 'yes' }],
  ])('R4 CONTRAST: %s carries no share or amount → the detail names removing "level", and offers no graded factor', async (_name, level) => {
    const { caps } = setup();
    const r = await caps.proposeNewOption(ctx as never, withLevel(level) as never) as Result;
    expect(r.refusal).toBe('switch_level_not_on');
    expect(r.detail).toContain(`except ${REMOVE_LEVEL}`);
    expect(r.detail).not.toContain('graded factor');
  });

  // ⛔ A 0 is not fixed by removing its level — a bare switch entry means ON (served A03, pj-20260928T011147Z). In this
  // ONE-option change the detail names the exact next call (R9: that entry with NO "level" key, not 0); with two options
  // it says to list it under the option that turns it on (`agent-switch-off-entry.test.ts` R3/R5 bind the rest).
  it("R4 CONTRAST (A03): { 0, 'binary' } as the only entry for the switch → the detail never says remove \"level\"; it names the entry with no level key", async () => {
    const { caps } = setup();
    const r = await caps.proposeNewOption(ctx as never, withLevel({ value: 0, unit: 'binary' }) as never) as Result;
    expect(r.refusal).toBe('switch_level_not_on');
    expect(r.detail).not.toContain(REMOVE_LEVEL);
    expect(r.detail).toContain(`send the acts_on entry for "${SWITCH}" in "${GRANDFATHER}" with NO "level" key at all`);
    expect(r.detail).not.toContain('graded factor');
  });

  it.each([
    ["{ 50, '%' }", { value: 50, unit: '%' }],
    ["{ 59, 'GBP' }", { value: 59, unit: 'GBP' }],
    ["{ 1, '%' }", { value: 1, unit: '%' }],
  ])('R4 ONE HOP: after %s is refused, the named next call (same arguments, level removed from that entry) is sent — no second refusal', async (_name, level) => {
    const first = setup();
    const refused = await first.caps.proposeNewOption(ctx as never, withLevel(level) as never) as Result;
    expect(refused.refusal).toBe('switch_level_not_on');
    const next = withLevel(level);
    delete (next.acts_on.find((a) => a.factor_label === SWITCH) as { level?: unknown }).level;
    const second = setup();
    const r = await second.caps.proposeNewOption(ctx as never, next as never) as Result;
    expect(r.refusal, JSON.stringify(r)).not.toBe('switch_level_not_on');
    expect(switchLevelSent(second.sent)).toEqual([{ factor_key: SWITCH_KEY, value: 1 }]);
  });

  it("R4 ONE HOP (graded): after { 50, '%' } is refused, the graded alternative (kind left out) is sent — no second refusal, no level written", async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx as never, a05([{ level: { value: 50, unit: '%' } }], null) as never) as Result;
    expect(r.refusal, JSON.stringify(r)).not.toBe('switch_level_not_on');
    expect(switchLevelSent(sent)?.map((i) => (i as { value?: unknown }).value)).toEqual([null]);
  });

  it("R4 RED (one hop, not two): the switch named twice (bare, then { 1, '%' }) → the detail says keep ONE entry with no level; doing so is sent", async () => {
    const { caps } = setup();
    const r = await caps.proposeNewOption(ctx as never, a05([{}, { level: { value: 1, unit: '%' } }]) as never) as Result;
    expect(r.refusal).toBe('switch_level_not_on');
    expect(r.detail).toContain(`keep ONE acts_on entry for "${SWITCH}" in "${GRANDFATHER}", with no "level"`);
    const next = setup();
    const again = await next.caps.proposeNewOption(ctx as never, a05([{}]) as never) as Result;
    expect(again.refusal, JSON.stringify(again)).not.toMatch(/switch_level_not_on|duplicate_acts_on/);
    expect(switchLevelSent(next.sent)).toEqual([{ factor_key: SWITCH_KEY, value: 1 }]);
  });

  it('R4 RED: two options, each refused on its own switch → ONE refusal names BOTH next-call edits, so one call fixes both', async () => {
    const { caps, sent } = setup();
    const ANNUAL = 'Annual plan offered';
    const OPT2 = '£54 for new Pro customers; offer an annual plan';
    const r = await caps.proposeNewOption(ctx as never, {
      options: [
        { label: GRANDFATHER, acts_on: [{ factor_label: SWITCH, direction: 'positive', level: { value: 50, unit: '%' } }] },
        { label: OPT2, acts_on: [{ factor_label: ANNUAL, direction: 'positive', level: { value: 12, unit: 'months' } }] },
      ],
      new_factors: [
        { label: SWITCH, kind: 'switch', affects: [{ label: 'Monthly churn', direction: 'negative' }] },
        { label: ANNUAL, kind: 'switch', affects: [{ label: 'Monthly churn', direction: 'negative' }] },
      ],
      rationale: 'x',
    } as never) as Result;
    expect(r.refusal).toBe('switch_level_not_on');
    expect(r.detail).toContain(`remove "level" from the acts_on entry for "${SWITCH}" in "${GRANDFATHER}"`);
    expect(r.detail).toContain(`remove "level" from the acts_on entry for "${ANNUAL}" in "${OPT2}"`);
    expect(sent).toEqual([]);
  });
});
