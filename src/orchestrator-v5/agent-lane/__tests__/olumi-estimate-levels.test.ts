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

  it('the tool tells the Agent when a figure is its own, and that it is shown as Olumi\'s', () => {
    const src = readFileSync(new URL('../runtime/agent-tools.ts', import.meta.url), 'utf8');
    expect(src).toContain('true ONLY when this figure is your own suggestion, not the user\\u2019s');
    expect(src).toContain('It is recorded and shown as Olumi\\u2019s estimate, never as the user\\u2019s. Needs basis.');
  });
});
