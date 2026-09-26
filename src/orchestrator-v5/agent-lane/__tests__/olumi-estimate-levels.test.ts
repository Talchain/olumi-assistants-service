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
  return { caps: createAgentCapabilities(d, new ProposalStore()), sent };
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
    await caps.proposeNewOption(ctxSaying('Add an option: raise to £64 with the AI release.'), suggested({ value: 64, unit: '£', estimate: true, basis: 'x' }) as never);
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
    expect(priceLevelSent(sent)).not.toHaveProperty('source');
  });

  it('CONTRAST: a bare number in the name is not a price ("Hire 2 developers" never blocks an estimate of 64 on a £ factor)', async () => {
    const { caps, sent } = setup();
    await caps.proposeNewOption(ctxSaying(ADD_ALL), { ...suggested({ value: 64, unit: '£', estimate: true, basis: 'x' }), label: 'Raise the price and hire 2 developers' } as never);
    expect(priceLevelSent(sent)).toEqual(expect.objectContaining({ raw_value: 64, source: 'cee_hypothesis' }));
  });

  it('⛔ the governing text permits what C2 adds, in every place it is stated (#1982 review B1)', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    const tools = readFileSync(new URL('../runtime/agent-tools.ts', import.meta.url), 'utf8');
    // Levels: the user's figure, or Olumi's own marked estimate for an option Olumi suggested — never "ONLY the user's".
    expect(route).toContain('your own suggested figure, marked `estimate` with its basis, which is recorded and shown as Olumi\\u2019s estimate, never as theirs');
    expect(tools).toContain('your own suggested figure with estimate: true and a basis, recorded and shown as Olumi\\u2019s estimate. Never a placeholder.');
    for (const text of [route, tools]) {
      expect(text).not.toContain('ONLY for a figure the user stated');
      expect(text).not.toContain('never invent one');
      expect(text).not.toContain('Never invent a level or a direction');
    }
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
