/**
 * ⛔ A FACTOR THE BRIEF NAMES IS NOT A BASELINE THE BRIEF STATES (DL #70 5851742282; AI Quality 5851742609).
 *
 * Served eng-hiring (MG construction sweep, 27 Sep): "hire two senior engineers or four junior engineers … salary
 * spend under £400k" registered 0 seniors, 0 juniors and £0 salary as `brief_extraction` — the user's own figures —
 * because admission stamps from the FACTOR's provenance. The rows below drive the REAL `buildModelFromBrief` with the
 * banked wire candidate (model call faked, nothing live) and read what it registers, by factor label.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CandidateModel } from '../admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { withdrawUnstatedBaselineStamps } from '../stated-by-user.js';
import { deriveInferredValues } from '../../coaching/inferred-value-disclosure.js';

const SCENARIO = '66666666-6666-4666-8666-666666666666';
const UNSTATED = 'Should I hire a Tech lead or two developers to increase velocity?';
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));

/** The banked wire candidate, with today's level of each factor given as the builder gives it: known, explicit. */
function candidateWith(baselines: Record<string, number>): CandidateModel {
  const c = (fixture('live-hiring-envelope-candidate-20260923.json') as { candidate: CandidateModel }).candidate;
  return {
    ...c,
    factors: c.factors.map((f) => (f.label in baselines
      ? { ...f, provenance: 'explicit', baseline_known: true, baseline_value: baselines[f.label]! }
      : f)),
  };
}

async function registeredBaselines(brief: string, baselines: Record<string, number>): Promise<Record<string, Record<string, unknown>>> {
  const registered: unknown[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) registered.push((body as { graph: unknown }).graph);
    return { status: 200, json: { registered: true } };
  };
  const fn = vi.fn(async () => ({ text: JSON.stringify(candidateWith(baselines)) })) as unknown as CallStructuredModel;
  const out = await buildModelFromBrief(SCENARIO, brief, d, fn);
  expect(out.ok, JSON.stringify(out).slice(0, 300)).toBe(true);
  expect(registered).toHaveLength(1);
  const nodes = (registered[0] as { nodes: { kind: string; label: string; observed_state?: Record<string, unknown> }[] }).nodes;
  const byLabel: Record<string, Record<string, unknown>> = {};
  for (const label of Object.keys(baselines)) {
    const hit = nodes.filter((n) => n.kind === 'factor' && n.label === label);
    expect(hit, `exactly one factor "${label}"`).toHaveLength(1);
    byLabel[label] = hit[0]!.observed_state ?? {};
  }
  return byLabel;
}

const figureOf = (os: Record<string, unknown>): unknown => os.raw_value ?? os.value;

describe('a baseline is the user\'s only when the brief states it', () => {
  it('RED: an unstated 0 on a factor the brief names is kept, and is not the user\'s', async () => {
    const os = await registeredBaselines(UNSTATED, { 'Tech leads hired': 0 });
    expect(figureOf(os['Tech leads hired']!)).toBe(0);
    expect(os['Tech leads hired']!.source).toBe('cee_inference');
  });

  it('CONTROL: a 0 the brief states, in digits or as "zero", stays the user\'s', async () => {
    const digits = await registeredBaselines('We have 0 tech leads today. Should I hire a Tech lead or two developers to increase velocity?', { 'Tech leads hired': 0 });
    expect(digits['Tech leads hired']!.source).toBe('brief_extraction');
    const word = await registeredBaselines('We have zero tech leads today. Should I hire a Tech lead or two developers to increase velocity?', { 'Tech leads hired': 0 });
    expect(word['Tech leads hired']!.source).toBe('brief_extraction');
  });

  it('CONTROL (word-number): "three developers" stays the user\'s 3; the same 3 unstated is withdrawn', async () => {
    const stated = await registeredBaselines('We have three developers today. Should I hire a Tech lead or two developers to increase velocity?', { 'Developers hired': 3 });
    expect(stated['Developers hired']!.source).toBe('brief_extraction');
    const unstated = await registeredBaselines(UNSTATED, { 'Developers hired': 3 });
    expect(figureOf(unstated['Developers hired']!)).toBe(3);
    expect(unstated['Developers hired']!.source).toBe('cee_inference');
  });

  // AI Quality F2 on #2073: "two developers" is the level the option "Hire Two Developers" sets, not today's headcount.
  it('RED (F2, option level): the brief\'s "two developers" is the option\'s level, so a baseline of 2 is Olumi\'s', async () => {
    const os = await registeredBaselines(UNSTATED, { 'Developers hired': 2 });
    expect(figureOf(os['Developers hired']!)).toBe(2);
    expect(os['Developers hired']!.source).toBe('cee_inference');
  });

  it('CONTROL (F2): "We have two developers today" writes 2 once more than the option explains, so it stays the user\'s', async () => {
    const os = await registeredBaselines(`We have two developers today. ${UNSTATED}`, { 'Developers hired': 2 });
    expect(os['Developers hired']!.source).toBe('brief_extraction');
  });

  it('SERVED eng-hiring: the three unstated zeros become Olumi\'s; the inferred factor is untouched', () => {
    const f = fixture('served-enghiring-unstated-zero-baselines.json') as { brief: string; nodes: { id: string; kind: string; observed_state?: Record<string, unknown> }[] };
    const out = withdrawUnstatedBaselineStamps(f.nodes, f.brief);
    const byId = Object.fromEntries(out.map((n) => [n.id, n.observed_state ?? {}]));
    for (const id of ['senior_engineers_hired', 'junior_engineers_hired', 'annual_salary_spend']) {
      expect(byId[id]!.source, id).toBe('cee_inference');
      expect(byId[id]!.raw_value, id).toBe(0);
      expect(byId[id]!.cap, id).toBe(f.nodes.find((n) => n.id === id)!.observed_state!.cap);
    }
    expect(out.find((n) => n.id === 'added_delivery_capacity')).toBe(f.nodes.find((n) => n.id === 'added_delivery_capacity'));
  });

  // #2073 review F1 (AIQ 5851906910): source-less, a withdrawn baseline was NOBODY's. "I supplied N values" skipped it,
  // the canvas could say "no source", and the level-limit carry (`levelHasAnAuthor`) refused it. It is Olumi's.
  it('SERVED eng-hiring: every withdrawn baseline is disclosed as Olumi\'s (the one author the disclosure reads)', () => {
    const f = fixture('served-enghiring-unstated-zero-baselines.json') as { brief: string; nodes: { id: string; kind: string; observed_state?: Record<string, unknown> }[] };
    const withdrawn = ['senior_engineers_hired', 'junior_engineers_hired', 'annual_salary_spend'];
    const disclosed = deriveInferredValues({ nodes: withdrawUnstatedBaselineStamps(f.nodes, f.brief) }).map((r) => r.factor_id);
    for (const id of withdrawn) expect(disclosed, id).toContain(id);
    expect(deriveInferredValues({ nodes: f.nodes }).map((r) => r.factor_id).filter((id) => withdrawn.includes(id))).toEqual([]);
  });

  it('SERVED stated 0: "0 channel partners" and "three account executives" stay the user\'s; every node is returned unchanged', () => {
    const f = fixture('served-stated-zero-factor-baseline.json') as { brief: string; nodes: { id: string; observed_state?: Record<string, unknown> }[] };
    expect(f.nodes.find((n) => n.id === 'channel_partner_count')!.observed_state).toMatchObject({ raw_value: 0, source: 'brief_extraction' });
    expect(f.nodes.find((n) => n.id === 'account_executive_headcount')!.observed_state).toMatchObject({ raw_value: 3, source: 'brief_extraction' });
    const out = withdrawUnstatedBaselineStamps(f.nodes, f.brief);
    f.nodes.forEach((n, i) => expect(out[i], n.id).toBe(n));
  });

  it('SERVED word-number: "three account executives" stays the user\'s 3; every node is returned unchanged', () => {
    const f = fixture('served-word-number-baseline-statedzero.json') as { brief: string; nodes: { id: string; observed_state?: Record<string, unknown> }[] };
    expect(f.nodes.find((n) => n.id === 'account_executives')!.observed_state).toMatchObject({ raw_value: 3, source: 'brief_extraction' });
    const out = withdrawUnstatedBaselineStamps(f.nodes, f.brief);
    f.nodes.forEach((n, i) => expect(out[i], n.id).toBe(n));
  });
});
