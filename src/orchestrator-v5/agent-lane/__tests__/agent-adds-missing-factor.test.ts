/**
 * ⭐ AN OPTION THAT CHANGES SOMETHING THE MODEL LACKS: THE FACTOR IS ADDED IN THE SAME CHANGE (DL 5843303596; contract:
 * Runtime 5843960061/5843994112, Canonical's ruling 5843972346 as corrected 5843988693).
 *
 * Served on CEE fbb12b8 (DL (F) run f-20260926T063632Z, F4 FAIL → Runtime): "Please add two more options to compare:
 * "Test £54 versus £59 by customer cohort before rollout" and "Keep £49 and add a paid AI add-on". Add both." Only the
 * cohort option was added; the model has no add-on factor, so the add-on could not be.
 *
 * FIXTURE: that run's served graph (turn F7's read) WITHOUT the add-on option the later answer added — the model as it
 * stood when the add-on was asked for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { planNewFactors, planNewOption } from '../propose-new-option.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { AGENT_TOOLS } from '../runtime/agent-tools.js';
import { statedTodayLevelsFor } from '../../handlers/add-option-authorship-context.js';

type Node = { id: string; kind: string; label: string; category?: string };
const served = JSON.parse(readFileSync(new URL('./fixtures/served-f4-before-addon-fbb12b8.json', import.meta.url), 'utf8')) as { nodes: Node[]; edges: unknown[] };
const F4 = 'Please add two more options to compare: "Test £54 versus £59 by customer cohort before rollout" and "Keep £49 and add a paid AI add-on". Add both. The add-on raises MRR.';
const ADDON = { label: 'AI add-on price', affects: [{ label: 'Monthly recurring revenue (MRR)', direction: 'positive' as const }] };
const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400c7', authenticated_user_id: null, request_id: 'r', user_text: F4 };

describe('planNewFactors — a new factor must be new, change something the model has, and say which way', () => {
  it('the add-on price, raising MRR → planned with a batch key and the goal as its target', () => {
    const r = planNewFactors(served.nodes, [ADDON]);
    expect(r).toEqual({ ok: true, factors: [{ key: 'ai_add_on_price', label: 'AI add-on price',
      affects: [{ node_id: 'monthly_recurring_revenue_mrr', label: 'Monthly recurring revenue (MRR)', effect_direction: 'positive' }] }] });
  });

  it('refusals, each with nothing prepared: a name the model has; no target; an unknown target; a lever as target; no direction', () => {
    const refusal = (x: unknown) => (planNewFactors(served.nodes, [x as never]) as { refusal?: string }).refusal;
    expect(refusal({ ...ADDON, label: 'Pro plan price' })).toBe('new_factor_label_taken');
    expect(refusal({ ...ADDON, affects: [] })).toBe('new_factor_affects_nothing');
    expect(refusal({ ...ADDON, affects: [{ label: 'Add-on revenue', direction: 'positive' }] })).toBe('no_such_target');
    expect(refusal({ ...ADDON, affects: [{ label: 'Pro plan price', direction: 'positive' }] })).toBe('target_is_a_lever');
    expect(refusal({ ...ADDON, affects: [{ label: 'Monthly recurring revenue (MRR)' }] })).toBe('new_factor_direction_unstated');
  });

  it('CONTRAST: an observable factor or a risk the model has is a valid target', () => {
    expect(planNewFactors(served.nodes, [{ ...ADDON, affects: [{ label: 'AI feature adoption rate', direction: 'positive' }] }]).ok).toBe(true);
    expect(planNewFactors(served.nodes, [{ ...ADDON, affects: [{ label: 'Price-sensitive churn', direction: 'negative' }] }]).ok).toBe(true);
  });
});

describe('the planner links a new factor only where the builder will (#1982 review N1: builder `isAffectsTarget`)', () => {
  const withCategory = (label: string, category: string | undefined) => served.nodes.map((n) => {
    if (n.label !== label) return n;
    const { category: _c, ...rest } = n;
    return category === undefined ? rest : { ...rest, category };
  });
  const to = (label: string) => [{ ...ADDON, affects: [{ label, direction: 'positive' as const }] }];

  it('RED: a factor the model records with NO category (or any other than observable/external) → refused with the reason, before anything is sent', () => {
    for (const cat of [undefined, 'derived', 'unknown']) {
      const r = planNewFactors(withCategory('AI feature adoption rate', cat), to('AI feature adoption rate')) as { refusal?: string; detail?: string };
      expect(r.refusal, String(cat)).toBe('target_not_linkable');
      expect(r.detail).toContain('Ask whether "AI add-on price" changes the goal, an outcome or a risk instead.');
    }
  });

  it('CONTRAST: the same factor as observable or external is a target, as the builder accepts', () => {
    for (const cat of ['observable', 'external']) {
      expect(planNewFactors(withCategory('AI feature adoption rate', cat), to('AI feature adoption rate')).ok, cat).toBe(true);
    }
  });
});

describe('planNewOption links the option to a factor this same change adds', () => {
  const addOn = { label: 'Keep £49 and add a paid AI add-on', acts_on: [{ factor_label: 'AI add-on price', direction: 'positive' as const }], rationale: 'x' };

  it('RED (served F4): with the add-on declared, the option acts on it — no "no such factor"', () => {
    const nf = planNewFactors(served.nodes, [ADDON]);
    const plan = planNewOption(served.nodes, { ...addOn, newFactors: nf.ok ? nf.factors : [] });
    expect(plan).toEqual(expect.objectContaining({ ok: true, actsOn: [], newActsOn: [{ key: 'ai_add_on_price', label: 'AI add-on price', direction: 'positive' }] }));
  });

  it('CONTRAST: undeclared, it is still refused — and the refusal offers new_factors, never an unrelated link', () => {
    const plan = planNewOption(served.nodes, addOn) as { refusal?: string; detail?: string };
    expect(plan.refusal).toBe('no_such_factor');
    expect(plan.detail).toContain('new_factors');
  });
});

describe('propose_new_option sends ONE change carrying the option AND the factor it needs', () => {
  const setup = () => {
    const sent: { path: string; body: unknown }[] = [];
    const d: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: served, graph_hash: 'h0' } };
      sent.push({ path, body });
      return { status: 500, json: {} };
    };
    return { caps: createAgentCapabilities(d, new ProposalStore()), sent };
  };
  const call = {
    label: 'Keep £49 and add a paid AI add-on',
    acts_on: [{ factor_label: 'AI add-on price', direction: 'positive' }],
    new_factors: [ADDON],
    rationale: 'the user asked for it',
  };

  it('RED (served F4; needs Canonical\'s builder): the typed turn carries new_factors and the option names it by factor_key', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx, call as never);
    const params = (sent[0]?.body as { chip?: { parameters?: Record<string, unknown> } } | undefined)?.chip?.parameters;
    expect(params, JSON.stringify(r)).toBeDefined();
    expect(params!['new_factors']).toEqual([{ key: 'ai_add_on_price', label: 'AI add-on price',
      affects: [{ node_id: 'monthly_recurring_revenue_mrr', effect_direction: 'positive' }] }]);
    // The link to the new factor is Olumi's: the user's words never name "AI add-on price" (U3 part 2, DL 5849023213 (2)).
    expect(params!['interventions']).toEqual([{ factor_key: 'ai_add_on_price', value: null, source: 'cee_hypothesis' }]);
  });

  it('the size limit counts each new factor and what it affects — refused before anything is sent (#1974 review N2)', async () => {
    const { caps, sent } = setup();
    // 4 options × (option + decision link + 3 factors) = 20; 4 new factors × (node + 3 targets) = 16; 36 > 32.
    const targets = [{ label: 'Monthly recurring revenue (MRR)', direction: 'positive' }, { label: 'Active Pro subscribers', direction: 'positive' }, { label: 'Monthly churn', direction: 'negative' }];
    const nf = [1, 2, 3, 4].map((i) => ({ label: `Add-on ${i} price`, affects: targets }));
    const options = [1, 2, 3, 4].map((i) => ({ label: `Add-on ${i}`, acts_on: [
      { factor_label: 'Pro plan price', direction: 'positive' }, { factor_label: 'AI feature adoption rate', direction: 'positive' }, { factor_label: `Add-on ${i} price`, direction: 'positive' },
    ] }));
    const r = await caps.proposeNewOption(ctx, { options, new_factors: nf, rationale: 'x' } as never) as { refusal?: string; detail?: string };
    expect(r.refusal, JSON.stringify(r)).toBe('too_many_links');
    expect(sent, 'without the new factors the count would be 20 and it would have been sent').toEqual([]);
  });

  it('the preview asks for the new factor\'s value today, and never says the analysis will (#1974 review N1)', async () => {
    const src = readFileSync(new URL('../runtime/agent-capabilities.ts', import.meta.url), 'utf8');
    expect(src).toContain('Ask the user what it is today');
    expect(src, 'the old claim: readiness raises nothing once a level is set').not.toContain('not set yet \\u2014 the analysis will ask for it');
  });

  it('a factor declared for no option is refused before anything is sent', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx, { ...call, acts_on: [{ factor_label: 'Pro plan price', direction: 'positive' }] } as never) as { refusal?: string };
    expect(r.refusal).toBe('new_factor_unused');
    expect(sent).toEqual([]);
  });

  it('a bad new factor refuses the whole change before anything is sent', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx, { ...call, new_factors: [{ ...ADDON, affects: [{ label: 'Monthly recurring revenue (MRR)' }] }] } as never) as { refusal?: string };
    expect(r.refusal).toBe('new_factor_direction_unstated');
    expect(sent).toEqual([]);
  });
});

/**
 * ⭐ A1 — A NEW FACTOR THE OPTION SWITCHES ON (Canonical #70 5854919806 item 1). The Agent says so with the ONE typed
 * member `kind: 'switch'`; the option's level on it is then exactly 1 in the same change (its today-0 is written by the
 * confirm, as Olumi's). A figure that is not "on" contradicts the kind and is refused, never rounded to on; an unknown
 * kind is refused, never read as either. Without `kind` the wire is byte-identical (the RED (served F4) row above).
 */
describe('A1 — propose_new_option sends a new SWITCH switched on, in the same change', () => {
  const setup = () => {
    const sent: { path: string; body: unknown }[] = [];
    const d: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: served, graph_hash: 'h0' } };
      sent.push({ path, body });
      return { status: 500, json: {} };
    };
    return { caps: createAgentCapabilities(d, new ProposalStore()), sent };
  };
  const SWITCH = { label: 'AI add-on offered', kind: 'switch', affects: [{ label: 'Monthly recurring revenue (MRR)', direction: 'positive' }] };
  const call = (level?: Record<string, unknown>, kind: unknown = 'switch') => ({
    label: 'Keep £49 and offer a paid AI add-on',
    acts_on: [{ factor_label: 'AI add-on offered', direction: 'positive', ...(level !== undefined ? { level } : {}) }],
    new_factors: [{ ...SWITCH, kind }],
    rationale: 'the user asked for it',
  });
  const paramsOf = (sent: { body: unknown }[]) =>
    (sent[0]?.body as { chip?: { parameters?: Record<string, unknown> } } | undefined)?.chip?.parameters;

  it('RED: the wire declares the switch and the option switches it ON (level 1) — never a null level', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx, call() as never);
    const params = paramsOf(sent);
    expect(params, JSON.stringify(r)).toBeDefined();
    expect(params!['new_factors']).toEqual([{ key: 'ai_add_on_offered', label: 'AI add-on offered',
      affects: [{ node_id: 'monthly_recurring_revenue_mrr', effect_direction: 'positive' }], kind: 'switch' }]);
    // ⛔ AIQ (c) (#70 5859422189; DL CHANGES_REQUIRED on #2132 @510bfa00): the ON level is structural, never Olumi's
    // estimate — no `source`, so it is stored as every non-estimate level is (the builder's `user_specified`).
    expect(params!['interventions']).toEqual([{ factor_key: 'ai_add_on_offered', value: 1 }]);
  });

  it('RED: a level of exactly 1 is on and is sent; any other figure for a switch is refused with nothing sent', async () => {
    const on = setup();
    await on.caps.proposeNewOption(ctx, call({ value: 1 }) as never);
    expect((paramsOf(on.sent)!['interventions'] as unknown[])[0]).toEqual({ factor_key: 'ai_add_on_offered', value: 1 });
    // 100% means on (MG, served A05 pj-20260927T233309Z: agent-switch-level-refusal-loop.test.ts); every other share is refused.
    for (const value of [50, 0, 0.5, 1, 150]) {
      const { caps, sent } = setup();
      const r = await caps.proposeNewOption(ctx, call({ value, unit: '%' }) as never) as { refusal?: string; detail?: string };
      expect(r.refusal, String(value)).toBe('switch_level_not_on');
      // ⛔ A 0 is never fixed by removing its level (a bare switch entry means ON; served A03, agent-switch-off-entry.test.ts):
      // with no option turning the switch on, the detail says to list it under the option that turns it on.
      if (value === 0) expect(r.detail).toContain('No option in this change turns "AI add-on offered" on; list it under the option that turns it on');
      else expect(r.detail).toContain('remove "level" from the acts_on entry for "AI add-on offered"');
      if (value !== 0) expect(r.detail, String(value)).toContain('declare "AI add-on offered" as a graded factor instead');
      expect(sent).toEqual([]);
    }
  });

  /**
   * ⛔ A SWITCH HAS NO LEVEL OF ITS OWN (independent verification, round 2). Before this, only the NUMBER was compared
   * with 1: £1/month, 1% or 1 hire — and a figure that is not a number at all — were taken as ON, the unit or string
   * dropped without a word and today-0 written as Olumi's; and 100% was refused while 1% was accepted. Every level
   * that does not mean on now carries a figure the switch cannot keep, so it is refused and nothing is sent. (100% — the
   * whole of a share — MEANS on since the served A05 loop: agent-switch-level-refusal-loop.test.ts.)
   */
  it.each([
    ['£1/month', { value: 1, unit: '£/month' }],
    ['1%', { value: 1, unit: '%' }],
    ['1 hire', { value: 1, unit: 'hire' }],
    ["'0.5' (a string)", { value: '0.5' }],
    ["'50%' (a string)", { value: '50%' }],
    ["2 as Olumi's estimate", { value: 2, estimate: true, basis: 'a guess' }],
    ["1% as Olumi's estimate", { value: 1, unit: '%', estimate: true, basis: 'a guess' }],
    ["an estimate with no figure", { estimate: true, basis: 'a guess' }],
  ])('RED: a switch given %s is refused with nothing sent — its figure is never dropped and read as on', async (_name, level) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx, call(level) as never) as { refusal?: string; detail?: string };
    expect(r.refusal).toBe('switch_level_not_on');
    expect(sent).toEqual([]);
    // Why, in the user's terms: a switch has no level; say it is on under this option; the exact next call names this entry.
    expect(r.detail).toContain('A switch has no level of its own');
    expect(r.detail).toContain('tell the user it is on under this option');
    expect(r.detail).toContain('call propose_new_option again with exactly the same arguments, except remove "level" from the acts_on entry for "AI add-on offered"');
  });

  it('CONTRAST: a bare 1 (no unit, no estimate) is on and is sent — as is a level that says estimate: false', async () => {
    for (const level of [undefined, { value: 1 }, { value: 1, estimate: false }, { value: 1, unit: '' }, { value: 1, estimate: true, basis: 'the option turns it on' }]) {
      const { caps, sent } = setup();
      const r = await caps.proposeNewOption(ctx, call(level) as never);
      expect(paramsOf(sent)?.['interventions'], JSON.stringify(r)).toEqual([{ factor_key: 'ai_add_on_offered', value: 1 }]);
    }
  });

  /**
   * ⛔ AIQ CONDITION (c) (#70 5859422189; DL CHANGES_REQUIRED on #2132 @510bfa00): on a new switch's accepted
   * `{ 1, estimate: true }`, the STORED on-level carries no estimate stamp. The on-state is structural — the option turns
   * the switch on — never Olumi's estimate: `cee_hypothesis` there marked the option as resting on Olumi's figure, which
   * can make results provisional and withhold a leader over a structural 1. Only the today-0 is Olumi's (`cee_inference`,
   * written by the confirm: agent-add-option-held-seam). It is stored exactly as a 1 the user's own words name is.
   */
  it('RED (AIQ c): the ON level carries no estimate stamp, whether or not the user\'s words name the switch — both store identically', async () => {
    const named = { ...ctx, user_turn_text: 'Add the AI add-on offered as an option.' };
    const stored: string[] = [];
    for (const [c, level] of [[ctx, { value: 1, estimate: true, basis: 'the option turns it on' }], [named, { value: 1, estimate: true, basis: 'the option turns it on' }], [named, { value: 1 }]] as const) {
      const { caps, sent } = setup();
      const r = await caps.proposeNewOption(c as never, call(level) as never);
      const iv = (paramsOf(sent)?.['interventions'] as Record<string, unknown>[] | undefined)?.[0];
      expect(iv, JSON.stringify(r)).toBeDefined();
      expect(iv, 'the on-state is structural, never Olumi\'s estimate').not.toHaveProperty('source');
      stored.push(JSON.stringify(iv));
    }
    expect(new Set(stored).size, stored.join(' | ')).toBe(1);
  });

  it('RED: an unknown kind is refused before anything is sent — never read as switch or graded', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx, call(undefined, 'boolean') as never) as { refusal?: string };
    expect(r.refusal).toBe('new_factor_kind_invalid');
    expect(sent).toEqual([]);
  });

  it('CONTRAST: kind "graded" is the default — the wire carries no kind and the level stays null, exactly as with kind absent', async () => {
    const graded = setup();
    await graded.caps.proposeNewOption(ctx, call(undefined, 'graded') as never);
    const absent = setup();
    await absent.caps.proposeNewOption(ctx, { ...call(), new_factors: [{ label: SWITCH.label, affects: SWITCH.affects }] } as never);
    // The option id is minted fresh per call (`mintOptionId`); everything else must be the same bytes.
    const withoutId = (x: Record<string, unknown> | undefined) => { const { option_id: _id, ...rest } = x ?? {}; return JSON.stringify(rest); };
    expect(withoutId(paramsOf(graded.sent))).toBe(withoutId(paramsOf(absent.sent)));
    expect(paramsOf(graded.sent)!['interventions']).toEqual([{ factor_key: 'ai_add_on_offered', value: null, source: 'cee_hypothesis' }]);
    expect(JSON.stringify(paramsOf(graded.sent))).not.toContain('switch');
  });

  /**
   * ⛔ EVERY ENTRY THAT NAMES THE SWITCH IS READ, AND A FACTOR IS NAMED ONCE PER OPTION (independent verification of A1
   * round 2, VERIFIER-S1 at the r2 head; the same line is on staging, CEE #2107). The level check read only the FIRST
   * acts_on entry naming the switch (`.find`): a bare entry followed by `{ value: 1, unit: '%' }` was sent, held,
   * approved and committed — today-0 written as Olumi's, the option at a bare 1, the user's "1%" dropped without a word —
   * while the reverse order was refused. The result hung on entry order.
   */
  it.each([
    ['bare first, then 1%', [{}, { level: { value: 1, unit: '%' } }]],
    ['1% first, then bare', [{ level: { value: 1, unit: '%' } }, {}]],
    ['bare 1 first, then 1%', [{ level: { value: 1 } }, { level: { value: 1, unit: '%' } }]],
  ])('RED: the switch named twice (%s) is refused as a switch conflict naming the 1%, nothing sent — whatever the order', async (_name, entries) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx, { ...call(), acts_on: (entries as Record<string, unknown>[]).map((e) => ({ factor_label: 'AI add-on offered', direction: 'positive', ...e })) } as never) as
      { ok?: boolean; refusal?: string; detail?: string; switch_level_conflicts?: unknown[] };
    expect(r.refusal, JSON.stringify(r)).toBe('switch_level_not_on');
    expect(r.switch_level_conflicts).toEqual([{ option: 'Keep £49 and offer a paid AI add-on', factor: 'AI add-on offered', value: 1, unit: '%' }]);
    expect(r.detail).toContain('it was given a level: 1%.');
    expect(sent).toEqual([]);
  });

  /**
   * ⛔ ONE ENTRY PER FACTOR IN ONE OPTION — refused whatever the entries say, even two identical bare 1s. The planner keeps
   * the FIRST entry's direction and the level reader the LAST entry's figure, so for any factor, whichever the Agent wrote
   * second decided silently. The only order-free rule is one entry per factor; the refusal costs one more call and sends
   * nothing. Bound by the factor each entry RESOLVES to, never by its spelling.
   */
  it.each([
    ['the new switch, two bare 1s', [
      { factor_label: 'AI add-on offered', direction: 'positive', level: { value: 1 } },
      { factor_label: 'AI add-on offered', direction: 'positive', level: { value: 1 } }], 'AI add-on offered'],
    ['the new switch, twice with no level', [
      { factor_label: 'AI add-on offered', direction: 'positive' },
      { factor_label: ' ai ADD-ON offered ', direction: 'positive' }], 'AI add-on offered'],
    ['an existing factor with two figures (the last one used to win)', [
      { factor_label: 'AI add-on offered', direction: 'positive' },
      { factor_label: 'Pro plan price', direction: 'positive', level: { value: 54, unit: 'GBP per month' } },
      { factor_label: 'Pro plan price', direction: 'positive', level: { value: 59, unit: 'GBP per month' } }], 'Pro plan price'],
    ['an existing factor spelt two ways, opposite directions (the first one used to win)', [
      { factor_label: 'AI add-on offered', direction: 'positive' },
      { factor_label: 'Pro plan price', direction: 'positive' },
      { factor_label: '  pro plan PRICE', direction: 'negative' }], 'Pro plan price'],
  ])('RED: a factor named twice in one option (%s) is refused as duplicate_acts_on, nothing sent', async (_name, actsOn, factor) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx, { ...call(), acts_on: actsOn } as never) as { ok?: boolean; refusal?: string; detail?: string; duplicate_acts_on?: unknown[] };
    expect(r.refusal, JSON.stringify(r)).toBe('duplicate_acts_on');
    expect(r.duplicate_acts_on).toEqual([{ option: 'Keep £49 and offer a paid AI add-on', factor, entries: 2 }]);
    expect(r.detail).toContain(`"${factor}" is named 2 times in "Keep £49 and offer a paid AI add-on"`);
    expect(r.detail).toContain('Nothing was prepared.');
    expect(sent).toEqual([]);
  });

  it('CONTRAST: the same factor in two DIFFERENT options is not a duplicate — one change is sent carrying both', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx, { options: [
      { label: 'Keep £49 and offer a paid AI add-on', acts_on: [{ factor_label: 'AI add-on offered', direction: 'positive' }, { factor_label: 'Pro plan price', direction: 'positive' }] },
      { label: 'Push AI adoption at the current price', acts_on: [{ factor_label: 'Pro plan price', direction: 'positive' }, { factor_label: 'AI feature adoption rate', direction: 'positive' }] },
    ], new_factors: [SWITCH], rationale: 'x' } as never) as { refusal?: string };
    expect(r.refusal, JSON.stringify(r)).not.toBe('duplicate_acts_on');
    const options = paramsOf(sent)?.['options'] as { label: string; interventions: { factor_id?: string; factor_key?: string; value: unknown }[] }[] | undefined;
    expect(options?.map((o) => o.label), JSON.stringify(r)).toEqual(['Keep £49 and offer a paid AI add-on', 'Push AI adoption at the current price']);
    // Pro plan price is linked once in EACH option; the switch is on (1) in the one that names it.
    expect(options!.map((o) => o.interventions.filter((i) => i.factor_id === 'pro_plan_price').length)).toEqual([1, 1]);
    expect(options![0]!.interventions.filter((i) => i.factor_key === 'ai_add_on_offered')).toEqual([{ factor_key: 'ai_add_on_offered', value: 1 }]);
  });

  /**
   * ⛔ SERVED (OpenAI Runtime #70 5859406197; X3 runs 192916Z / 193756Z / 194514Z on CEE cd489f1): journey A's
   * add-two-options was NOT DONE in 3/3 runs. `propose_new_option` was refused `switch_level_not_on`, told "call again
   * with no level", and sent a level again. The rule refused ANY estimate on a new switch, so `{ value: 1, estimate: true }`
   * — "just add it with your assumptions" — could never land. A numeric 1 with no unit IS on, whoever's word it is: the
   * option turns the switch on, and its today-0 stays Olumi's stamp. Which field the model sent is UNVERIFIED (the served
   * artefacts keep no tool arguments), so every refusal now also says which parts of the level were not a bare 1.
   */
  const ANNUAL = { label: 'Annual plan offered', kind: 'switch', affects: [{ label: 'Monthly recurring revenue (MRR)', direction: 'positive' }] };
  const twoSwitchOptions = (level: Record<string, unknown>, graded = false) => ({
    options: [
      { label: 'Keep £49 and offer a paid AI add-on', acts_on: [{ factor_label: 'AI add-on offered', direction: 'positive', level }] },
      { label: 'Keep £49 and offer an annual plan', acts_on: [{ factor_label: 'Annual plan offered', direction: 'positive', level }] },
    ],
    new_factors: [SWITCH, ANNUAL].map((f) => { const { kind: _k, ...rest } = f; return graded ? rest : { ...rest, kind: 'switch' }; }),
    rationale: 'the user asked for both, with Olumi\u2019s assumptions',
  });
  const optionsSent = (sent: { body: unknown }[]) =>
    paramsOf(sent)?.['options'] as { label: string; interventions: { factor_key?: string; value: unknown }[] }[] | undefined;

  it('RED (served shape): two options, each with a new switch given { value: 1, estimate: true } → ONE change sent, both switches on, no refusal', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx, twoSwitchOptions({ value: 1, estimate: true, basis: 'the option turns it on' }) as never) as { ok?: boolean; refusal?: string };
    // This harness answers every inner request 500 (`not_prepared`): what matters here is that the ONE change was SENT,
    // with no refusal before it. The real route (agent-add-option-held-seam) holds, approves and commits it.
    expect(r.refusal, JSON.stringify(r)).toBe('not_prepared');
    expect(sent).toHaveLength(1);
    const options = optionsSent(sent);
    expect(options?.map((o) => o.label), JSON.stringify(r)).toEqual(['Keep £49 and offer a paid AI add-on', 'Keep £49 and offer an annual plan']);
    expect(options!.map((o) => o.interventions.filter((i) => i.factor_key !== undefined))).toEqual([
      [{ factor_key: 'ai_add_on_offered', value: 1 }],
      [{ factor_key: 'annual_plan_offered', value: 1 }],
    ]);
    expect((paramsOf(sent)!['new_factors'] as { kind?: string }[]).map((f) => f.kind)).toEqual(['switch', 'switch']);
  });

  it('CONTRAST (served shape): a bare 1 for each switch sends the same levels, byte for byte, as { value: 1, estimate: true }', async () => {
    const estimate = setup();
    await estimate.caps.proposeNewOption(ctx, twoSwitchOptions({ value: 1, estimate: true, basis: 'the option turns it on' }) as never);
    const bare = setup();
    await bare.caps.proposeNewOption(ctx, twoSwitchOptions({ value: 1 }) as never);
    const levels = (sent: { body: unknown }[]) => JSON.stringify(optionsSent(sent)?.map((o) => o.interventions.filter((i) => i.factor_key !== undefined)));
    expect(levels(estimate.sent)).toBe(levels(bare.sent));
    expect(levels(bare.sent)).not.toContain('source');
  });

  it.each([
    ["{ 1, '%' }", { value: 1, unit: '%' }, ['unit']],
    ["'0.5'", { value: '0.5' }, ['non_number']],
    ['{ 2, estimate: true }', { value: 2, estimate: true, basis: 'a guess' }, ['not_one', 'estimate']],
    ["{ 1, '%', estimate: true }", { value: 1, unit: '%', estimate: true, basis: 'a guess' }, ['unit', 'estimate']],
    ['a level that is not an object', 1, ['not_object']],
    ["{ 1, estimate: 'yes' } (not a boolean)", { value: 1, estimate: 'yes' }, ['estimate']],
  ])('CONTRAST: a new switch given %s in the served shape is still refused, nothing sent, and says which parts fired', async (_name, level, fields) => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx, twoSwitchOptions(level as never) as never) as { refusal?: string; detail?: string; conflict_fields?: unknown };
    expect(r.refusal, JSON.stringify(r)).toBe('switch_level_not_on');
    expect(r.conflict_fields).toEqual(fields);
    expect(r.detail).toContain('A switch has no level of its own');
    expect(r.detail).toContain('call propose_new_option again with exactly the same arguments, except remove "level" from the acts_on entry for');
    expect(sent).toEqual([]);
  });

  it('CONTRAST: the served shape named twice in one option ({ 1, estimate: true } twice) is still refused as duplicate_acts_on', async () => {
    const { caps, sent } = setup();
    const level = { value: 1, estimate: true, basis: 'the option turns it on' };
    const r = await caps.proposeNewOption(ctx, { ...call(), acts_on: [
      { factor_label: 'AI add-on offered', direction: 'positive', level },
      { factor_label: 'AI add-on offered', direction: 'positive', level }] } as never) as { refusal?: string };
    expect(r.refusal, JSON.stringify(r)).toBe('duplicate_acts_on');
    expect(sent).toEqual([]);
  });

  it('CONTRAST: a GRADED new factor given { 1, estimate: true } is never written — no level, never 0, never 1, no kind on the wire', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx, twoSwitchOptions({ value: 1, estimate: true, basis: 'a guess' }, true) as never) as { refusal?: string };
    expect(r.refusal, JSON.stringify(r)).toBe('not_prepared');
    expect(sent).toHaveLength(1);
    const options = optionsSent(sent);
    expect(options!.map((o) => o.interventions.filter((i) => i.factor_key !== undefined).map((i) => i.value))).toEqual([[null], [null]]);
    expect(JSON.stringify(paramsOf(sent))).not.toContain('switch');
  });
});

/**
 * ⛔ THE RULE IS WHERE THE MODEL WRITES A LEVEL (OpenAI Runtime #70 5859406197, proposed fix 1). The switch's "give it no
 * level" sat only on `new_factors.kind`; the model writes a level in `acts_on[].level`, which said nothing about switches.
 * Both acts_on forms (one option, several) share the one ACTS_ON schema, so each is read here.
 */
describe('the acts_on level the model writes says a new switch takes no level', () => {
  const RULE = "never give a level for a factor you add in new_factors with kind 'switch'";
  const levelDoc = (path: 'single' | 'several'): string => {
    const p = (AGENT_TOOLS.find((t) => t.name === 'propose_new_option')!.parameters as { properties: Record<string, any> }).properties;
    const actsOn = path === 'single' ? p['acts_on'] : p['options'].items.properties['acts_on'];
    return String(actsOn.items.properties['level'].description ?? '');
  };
  it.each(['single', 'several'] as const)('RED: the %s-option acts_on level description carries the rule', (path) => {
    expect(levelDoc(path).toLowerCase()).toContain(RULE);
  });
});

/**
 * ⭐ PJ-A1 £49 (DL #70 5860365834; AIQ 5860384275 / 5860839793) — A NEW GRADED FACTOR'S TODAY LEVEL IS TAKEN ONLY FROM THE
 * USER'S OWN WORDS, AND NEVER RIDES THE WIRE. The Agent may give `new_factors[].today`; the capability keeps it only when
 * `figureTheUserWrote` finds that figure in the user's typed words, frames it as admission frames a stated baseline, and
 * hands it to the hold through the in-process authorship context — read here INSIDE the dispatch, exactly where route-v2
 * reads it. The chip's `parameters` are byte-identical with or without it.
 */
describe('PJ-A1 £49 — propose_new_option carries a new graded factor\'s today level only when the user wrote it', () => {
  const SAID = `${F4} We already sell the add-on at £5 a month to a pilot group.`;
  const setup = () => {
    const sent: { path: string; body: unknown }[] = [];
    const carried: unknown[] = [];
    const d: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: served, graph_hash: 'h0' } };
      sent.push({ path, body });
      const b = body as { scenario_id?: string; turn_id?: string };
      carried.push(statedTodayLevelsFor(String(b.scenario_id), String(b.turn_id)));
      return { status: 500, json: {} };
    };
    return { caps: createAgentCapabilities(d, new ProposalStore()), sent, carried };
  };
  const call = (today?: unknown, kind?: 'switch') => ({
    label: 'Keep £49 and add a paid AI add-on',
    acts_on: [{ factor_label: 'AI add-on price', direction: 'positive', ...(kind === 'switch' ? { level: { value: 1 } } : {}) }],
    new_factors: [{ ...ADDON, ...(kind !== undefined ? { kind } : {}), ...(today !== undefined ? { today } : {}) }],
    rationale: 'the user asked for it',
  });
  const paramsOf = (sent: { body: unknown }[]) =>
    (sent[0]?.body as { chip?: { parameters?: Record<string, unknown> } } | undefined)?.chip?.parameters;

  it('RED: the user wrote £5 → the context names the add-on price\'s today level, framed as a stated baseline; the wire carries nothing new', async () => {
    const withToday = setup();
    await withToday.caps.proposeNewOption({ ...ctx, user_text: SAID }, call({ value: 5, unit: 'GBP/month' }) as never);
    expect(withToday.carried).toEqual([[{ label: 'AI add-on price',
      observed_state: { value: 0.5, raw_value: 5, cap: 10, declared_scale: 'unit_interval', unit: 'GBP/month', source: 'brief_extraction' } }]]);
    const without = setup();
    await without.caps.proposeNewOption({ ...ctx, user_text: SAID }, call() as never);
    expect(without.carried).toEqual([[]]);
    // The option id is minted per call; everything else on the wire is byte-identical.
    const wire = (x: { body: unknown }[]) => JSON.stringify({ ...paramsOf(x), option_id: '<minted>' });
    expect(wire(withToday.sent)).toBe(wire(without.sent));
    expect(JSON.stringify(paramsOf(withToday.sent))).not.toMatch(/today|observed_state|brief_extraction/);
  });

  // DL #72 5862394804: a bare count grounded any unit. "300 active Pro subscribers" is written about another quantity in
  // the model, so it is never the add-on price's £300 today (`figureTheUserWroteFor`, bound to the entity).
  it('⭐ RED: "300 active Pro subscribers" never grounds a new factor\'s today of £300: the figure is about another quantity', async () => {
    const { caps, sent, carried } = setup();
    await caps.proposeNewOption({ ...ctx, user_text: `${F4} We have 300 active Pro subscribers.` }, call({ value: 300, unit: 'GBP/month' }) as never);
    expect(sent).toHaveLength(1);
    expect(carried).toEqual([[]]);
  });

  it.each([
    ['a figure the user never wrote (7)', { value: 7, unit: 'GBP/month' }, undefined],
    ['a money figure the user wrote only as a percentage', { value: 4, unit: 'GBP' }, undefined],
    ['a non-number', { value: '5', unit: 'GBP/month' }, undefined],
    ['a negative level', { value: -5, unit: 'GBP/month' }, undefined],
    ['a today level for a SWITCH (its today is Olumi\'s off)', { value: 5, unit: 'GBP/month' }, 'switch' as const],
  ])('CONTRAST: %s → nothing is carried; the change is still sent', async (_name, today, kind) => {
    const { caps, sent, carried } = setup();
    await caps.proposeNewOption({ ...ctx, user_text: `${SAID} Keep churn under 4%.` }, call(today, kind) as never);
    expect(sent).toHaveLength(1);
    expect(carried).toEqual([[]]);
  });

  /**
   * ⭐ A1 £59 (DL 5861782245; served CEE 0db4f43, DL run pj-20260928T013016Z A05): with an accepted today level the frame is
   * known in the proposal, so the option's own level on the new graded factor rides the SAME change, on the frame today's
   * level uses (built over the largest figure this change carries), the user's when they wrote it and Olumi's estimate
   * otherwise. Bound on the wire by the new factor's batch key.
   */
  // `today: null` = no today level given.
  const withLevel = (level: unknown, today: unknown = { value: 5, unit: 'GBP/month' }) => ({
    ...call(today === null ? undefined : today),
    // A name with no figure of its own: "Keep £49 …" would contradict any estimate for the add-on (`contradictsItsName`).
    label: 'Add a paid AI add-on',
    acts_on: [{ factor_label: 'AI add-on price', direction: 'positive', ...(level !== undefined ? { level } : {}) }],
  });
  const ivsOf = (sent: { body: unknown }[]) => paramsOf(sent)?.['interventions'];
  const TODAY_5_ON_100 = { value: 0.05, raw_value: 5, cap: 100, declared_scale: 'unit_interval', unit: 'GBP/month', source: 'brief_extraction' };

  it('[A1-59] RED: the user wrote today £5 and the option\'s £12 → ONE sent change carries the option\'s 12 on today\'s frame (0–100), the user\'s', async () => {
    const { caps, sent, carried } = setup();
    await caps.proposeNewOption({ ...ctx, user_text: `${SAID} The add-on would be £12 a month under this option.` }, withLevel({ value: 12, unit: 'GBP/month' }) as never);
    expect(carried).toEqual([[{ label: 'AI add-on price', observed_state: TODAY_5_ON_100 }]]);
    expect(ivsOf(sent)).toEqual([{ factor_key: 'ai_add_on_price', value: 0.12, raw_value: 12, unit: 'GBP/month' }]);
  });

  it('[A1-59] RED: Olumi\'s own figure (estimate, with a basis) → the same change and frame, stamped as Olumi\'s estimate', async () => {
    const { caps, sent, carried } = setup();
    await caps.proposeNewOption({ ...ctx, user_text: SAID }, withLevel({ value: 12, unit: 'GBP/month', estimate: true, basis: 'Olumi’s suggested launch price' }) as never);
    expect(carried).toEqual([[{ label: 'AI add-on price', observed_state: TODAY_5_ON_100 }]]);
    expect(ivsOf(sent)).toEqual([{ factor_key: 'ai_add_on_price', value: 0.12, raw_value: 12, unit: 'GBP/month', source: 'cee_hypothesis' }]);
  });

  it.each([
    ['no today level (unchanged: no range yet)', { value: 12, unit: 'GBP/month' }, null, []],
    ['a figure the user never wrote, with no estimate', { value: 12, unit: 'GBP/month' }, undefined, [{ label: 'AI add-on price', observed_state: TODAY_5_ON_100 }]],
    ['a non-number', { value: '12', unit: 'GBP/month' }, undefined, [{ label: 'AI add-on price', observed_state: { ...TODAY_5_ON_100, value: 0.5, cap: 10 } }]],
    ['a figure in another kind of unit', { value: 12, unit: '%' }, undefined, [{ label: 'AI add-on price', observed_state: TODAY_5_ON_100 }]],
  ])('[A1-59] CONTRAST: %s → the option\'s level is not set (a link with no level); the change is still sent', async (_name, level, today, carriedToday) => {
    const { caps, sent, carried } = setup();
    await caps.proposeNewOption({ ...ctx, user_text: SAID }, withLevel(level, today) as never);
    expect(sent).toHaveLength(1);
    expect(carried).toEqual([carriedToday]);
    expect(ivsOf(sent)).toEqual([{ factor_key: 'ai_add_on_price', value: null, source: 'cee_hypothesis' }]);
  });

  it('the tool tells the model: today\'s level for a factor it adds ONLY if the user stated it — never an estimate, never 0', () => {
    const p = (AGENT_TOOLS.find((t) => t.name === 'propose_new_option')!.parameters as { properties: Record<string, any> }).properties;
    const today = p['new_factors'].items.properties['today'];
    expect(today.properties.value.type).toBe('number');
    expect(String(today.description)).toContain('ONLY if the user stated it');
    expect(String(today.description)).toMatch(/never your own estimate, never a placeholder or 0/i);
  });
});
