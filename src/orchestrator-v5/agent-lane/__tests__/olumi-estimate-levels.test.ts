/**
 * ⭐ OLUMI'S OWN SUGGESTED LEVEL ON A NEW OPTION LANDS IN THE SAME APPROVAL — AS OLUMI'S ESTIMATE (C2; contract
 * Runtime #70 5844173937; ChatGPT 5839692762 A: "suggested levels only as EXPLICIT Olumi hypotheses shown in the preview").
 *
 * The grounding fix records a level as the user's only when they wrote the figure; anything else was left unset. On
 * Paul's natural path — the Agent suggests options, the user says "add all of them" — options whose figures only the
 * Agent named then landed with no level, and running them needed a second approval. The Agent may now send its own
 * figure with `estimate: true` and a basis: it is stamped `cee_hypothesis` (the literal an adopted Olumi level already
 * carries) and said as Olumi's, never the user's.
 *
 * FIXTURE: Paul's own stored graph (`cbd15f83`): Pro plan price in "GBP per month" on a 200 range.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { HOST_TOOL_CONTRACT } from '../coach-route-v0_2.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const paulGraph = JSON.parse(readFileSync(new URL('./fixtures/paul-cbd15f83-stored-graph.json', import.meta.url), 'utf8')) as unknown;
const ctxSaying = (user_text: string) => ({ scenario_id: '550e8400-e29b-41d4-a716-4466554400c7', authenticated_user_id: null, request_id: 'r', user_text });
const setup = () => {
  const sent: { path: string; body: unknown }[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: paulGraph, graph_hash: 'h0' } };
    sent.push({ path, body });
    return { status: 500, json: {} };
  };
  const store = new ProposalStore();
  return { caps: createAgentCapabilities(d, store), sent, store };
};
type Iv = { factor_id: string; value: unknown; raw_value?: unknown; source?: unknown };
const priceLevelSent = (sent: { body: unknown }[]) =>
  ((sent[0]?.body as { chip?: { parameters?: { interventions?: Iv[] } } } | undefined)?.chip?.parameters?.interventions ?? [])
    .find((x) => x.factor_id === 'pro_plan_price');
const suggested = (level: Record<string, unknown>) => ({
  label: 'Raise to £64 with the AI release',
  acts_on: [{ factor_label: 'Pro plan price', direction: 'positive', level }],
  rationale: 'Olumi suggested it; the user asked to add all of them',
});
const ADD_ALL = 'Add all of the options you suggested.';

describe('a level is the user\'s, Olumi\'s disclosed estimate, or unset — never silently either', () => {
  it('RED: Olumi\'s own figure with a basis → sent as cee_hypothesis, and the preview says it is Olumi\'s estimate', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctxSaying(ADD_ALL), suggested({ value: 64, unit: '£', estimate: true, basis: 'a step above the £59 option' }) as never) as { levels?: { stated_by?: string; basis?: string }[] };
    const iv = priceLevelSent(sent);
    expect(iv, JSON.stringify(sent[0]?.body)).toEqual(expect.objectContaining({ raw_value: 64, source: 'cee_hypothesis' }));
    expect(iv!.value).toBeCloseTo(64 / 200, 10);
    void r;
  });

  it('CONTRAST: the user wrote £64 → theirs, with no source sent (the builder\'s default, byte-identical to today)', async () => {
    const { caps, sent } = setup();
    // LEAN CORE (#3392, USER_QUOTE): the AI cites the span the user typed; its estimate flag never relabels their figure.
    await caps.proposeNewOption(ctxSaying('Add an option: raise to £64 with the AI release.'), suggested({ value: 64, unit: '£', estimate: true, basis: 'x',
      quote: 'Add an option: raise to £64 with the AI release.' }) as never);
    const iv = priceLevelSent(sent);
    expect(iv?.raw_value).toBe(64);
    expect(iv).not.toHaveProperty('source');
  });

  it('CONTRAST: "estimate" with no basis is not an explicit hypothesis → unset, and said', async () => {
    const { caps, sent } = setup();
    await caps.proposeNewOption(ctxSaying(ADD_ALL), suggested({ value: 64, unit: '£', estimate: true }) as never);
    expect(priceLevelSent(sent)?.value).toBeNull();
  });

  it('CONTRAST: neither written nor marked as Olumi\'s → unset (the grounding rule, unchanged)', async () => {
    const { caps, sent } = setup();
    await caps.proposeNewOption(ctxSaying(ADD_ALL), suggested({ value: 64, unit: '£' }) as never);
    expect(priceLevelSent(sent)?.value).toBeNull();
  });

  it('RED (#1982 review N2): an estimate that contradicts the option\'s own name ("Test £54" at 64) → sent unset (the route row [q3] shows it is said)', async () => {
    const { caps, sent } = setup();
    await caps.proposeNewOption(ctxSaying(ADD_ALL), { ...suggested({ value: 64, unit: '£', estimate: true, basis: 'a step above the £59 option' }), label: 'Test £54 at release' } as never);
    expect(priceLevelSent(sent)?.value, JSON.stringify(sent[0]?.body)).toBeNull();
    // No level and no figure. On a level-less link `source` names who made the LINK (U3 part 2, DL 5849023213 (2)):
    // this turn's words do not name Pro plan price, so the link is Olumi's.
    expect(priceLevelSent(sent)).toEqual({ factor_id: 'pro_plan_price', value: null, source: 'cee_hypothesis' });
  });

  it('CONTRAST: a bare number in the name is not a price ("Hire 2 developers" never blocks an estimate of 64 on a £ factor)', async () => {
    const { caps, sent } = setup();
    await caps.proposeNewOption(ctxSaying(ADD_ALL), { ...suggested({ value: 64, unit: '£', estimate: true, basis: 'x' }), label: 'Raise the price and hire 2 developers' } as never);
    expect(priceLevelSent(sent)).toEqual(expect.objectContaining({ raw_value: 64, source: 'cee_hypothesis' }));
  });

  it('A2h unknown-history option level is never Olumi\'s, even with an estimate label and basis: recorded with its origin unverified (G3, W15)', async () => {
    const { caps, sent } = setup();
    await caps.proposeNewOption({ ...ctxSaying(ADD_ALL), unverified_user_text: 'Raise Pro plan price to £64.' },
      suggested({ value: 64, unit: '£', estimate: true, basis: 'a step above the £59 option' }) as never);
    // G3 (Codex #3392 r1 B3, W15): the £64 is USER MATERIAL of unknown origin (retained words), so it is recorded with its origin
    // unverified (was: left unset), never Olumi's (K3, kept: never `cee_hypothesis` without the marker) and never the user's.
    expect(priceLevelSent(sent), JSON.stringify(sent)).toMatchObject({ raw_value: 64, source: 'cee_hypothesis', user_material_unverified: true });
  });

  it('A2h unknown-history assumption revision cannot become Olumi authored', async () => {
    const { caps, sent } = setup();
    const out = await caps.proposeAssumptions({ ...ctxSaying('Use that price.'), unverified_user_text: 'Pro plan price is £64.' },
      { assumptions: [{ user_stated: true, factor_label: 'Pro plan price', value: 64, unit: 'GBP per month', basis: 'retained context', revise: true }] });
    expect(out).toMatchObject({ ok: false, mutated: false, refusal: 'origin_unknown' });
    expect(sent).toEqual([]);
  });

  it('A2h unknown-history intervention cannot become Olumi authored', async () => {
    const { caps, sent, store } = setup();
    const out = await caps.proposeOptionInterventions!({ ...ctxSaying('Use that price.'), unverified_user_text: 'Raise Pro plan price to £64.' },
      { interventions: [{ option_label: 'Raise to £59 at Release', factor_label: 'Pro plan price', value: 64, unit: 'GBP per month', user_stated: false, basis: 'retained context' }] } as never);
    // G3: the £64 is USER MATERIAL of unknown origin (retained words), so it is proposed with its origin unverified (was: refused),
    // never Olumi's (K3, kept) and never the user's. Nothing is sent before approval.
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, mutated: false, interventions: [{ stated_by: 'origin_unverified' }] });
    expect((store.get(String(out.proposal_id))!.operations[0]!.value as { authored_by?: string }).authored_by).toBe('unknown');
    expect(sent).toEqual([]);
  });

  it('⛔ the governing text permits what C2 adds, in every place it is stated (#1982 review B1)', () => {
    const route = HOST_TOOL_CONTRACT;
    const tools = readFileSync(new URL('../runtime/agent-tools.ts', import.meta.url), 'utf8');
    // Levels: the user's figure, or Olumi's own marked estimate for an option Olumi suggested — never "ONLY the user's".
    expect(route).toContain('your own suggested figure, marked `estimate` with its basis, which is recorded and shown as Olumi\u2019s estimate, never as theirs');
    expect(tools).toContain('your own suggested figure with estimate: true and a basis, recorded and shown as Olumi\\u2019s estimate. Never a placeholder.');
    for (const text of [route, tools]) {
      expect(text).not.toContain('ONLY for a figure the user stated');
      expect(text).not.toContain('Never invent a level or a direction');
    }
    // AIE #94 6136098330: the deadline rule must still forbid an invented level.
    expect(tools).toContain('Never invent or silently replace a reference, unit or level');
    // A new factor's direction: ONE rule, stated the same way in the prompt, the tool, and the field.
    const rule = 'where it is plain from the option itself (a paid add-on adds revenue); if it is unclear, ask';
    expect(route).toContain(rule);
    expect(tools.split(rule).length - 1, 'tool description and the affects field').toBe(2);
    expect(tools).not.toContain('From the user; never guessed.');
  });

  it('the tool tells the Agent when a figure is its own, and that it is shown as Olumi\'s', () => {
    const src = readFileSync(new URL('../runtime/agent-tools.ts', import.meta.url), 'utf8');
    expect(src).toContain('true ONLY when this figure is your own suggestion, not the user\\u2019s');
    expect(src).toContain('It is recorded and shown as Olumi\\u2019s estimate, never as the user\\u2019s. Needs basis.');
  });
});
