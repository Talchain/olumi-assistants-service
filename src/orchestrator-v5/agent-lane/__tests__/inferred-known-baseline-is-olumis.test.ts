/**
 * ⛔ A KNOWN BASELINE THE BUILDER INFERRED IS OLUMI'S, NOT NOBODY'S (AIQ #70 5852160429).
 *
 * Served eng-hiring on CEE `2d0df14` (AIQ run `served-2076-20260927/eh1`): "Senior engineers hired" 0, "Junior engineers
 * hired" 0 and "Annual salary spend" £0 came out `provenance: ai_inferred` with a framed baseline and NO `source`
 * (`{ cap: 10, unit: 'engineers', value: 0, raw_value: 0, declared_scale: 'unit_interval' }`). #2076 cannot reach them:
 * they were never `brief_extraction`. So the run said "I supplied the value behind this" (one) over a model resting on
 * five figures the brief never gave, and the magnitude reader (`knownBaseline`) took the unauthored 0 as today's level.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CandidateModel } from '../admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { deriveInferredValues } from '../../coaching/inferred-value-disclosure.js';
import { knownBaseline, type MagnitudeNode } from '../../../cee/magnitude/link-effect.js';

const SCENARIO = '77777777-7777-4777-8777-777777777777';
const BRIEF = 'Should I hire a Tech lead or two developers to increase velocity?';
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));

type Factor = CandidateModel['factors'][number];
type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown> };

/** The banked wire candidate, each named factor's today given exactly as `patch` says. */
async function registered(brief: string, patch: Record<string, Partial<Factor>>): Promise<Node[]> {
  const c = (fixture('live-hiring-envelope-candidate-20260923.json') as { candidate: CandidateModel }).candidate;
  const candidate = { ...c, factors: c.factors.map((f) => (f.label in patch ? { ...f, ...patch[f.label] } : f)) };
  const graphs: unknown[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) graphs.push((body as { graph: unknown }).graph);
    return { status: 200, json: { registered: true } };
  };
  const fn = vi.fn(async () => ({ text: JSON.stringify(candidate) })) as unknown as CallStructuredModel;
  const out = await buildModelFromBrief(SCENARIO, brief, d, fn);
  expect(out.ok, JSON.stringify(out).slice(0, 300)).toBe(true);
  expect(graphs).toHaveLength(1);
  return (graphs[0] as { nodes: Node[] }).nodes;
}

function factor(nodes: Node[], label: string): Node {
  const hit = nodes.filter((n) => n.kind === 'factor' && n.label === label);
  expect(hit, `exactly one factor "${label}"`).toHaveLength(1);
  return hit[0]!;
}

// The served shape: a headcount the builder says is known to be 0 today, on its own 0..cap frame.
const INFERRED_KNOWN_ZERO = { provenance: 'inferred', baseline_known: true, baseline_value: 0 } as Partial<Factor>;
const PROPOSED_KNOWN_ZERO = { provenance: 'ai_proposed', baseline_known: true, baseline_value: 0 } as Partial<Factor>;

describe('a known baseline the builder inferred is Olumi\'s', () => {
  it('RED: an inferred or proposed known 0 is stamped Olumi\'s, keeps its frame, and is disclosed', async () => {
    const nodes = await registered(BRIEF, { 'Tech leads hired': INFERRED_KNOWN_ZERO, 'Developers hired': PROPOSED_KNOWN_ZERO });
    const lead = factor(nodes, 'Tech leads hired');
    const devs = factor(nodes, 'Developers hired');
    // The frame is the builder's, exactly as before: only the author changes.
    expect(lead.observed_state).toMatchObject({ value: 0, raw_value: 0, cap: 10, declared_scale: 'unit_interval', source: 'cee_inference' });
    expect(devs.observed_state).toMatchObject({ value: 0, raw_value: 0, cap: 20, declared_scale: 'unit_interval', source: 'cee_inference' });
    const disclosed = deriveInferredValues({ nodes }).map((r) => r.factor_id);
    expect(disclosed).toContain(lead.id);
    expect(disclosed).toContain(devs.id);
    // Not today's KNOWN level for the magnitude sentence: it is Olumi's figure.
    expect(knownBaseline(lead as unknown as MagnitudeNode)).toBeUndefined();
  });

  it('CONTROL (S7 disposition `unsupported_unit_conversion`): a 0 the brief states is the user\'s UNVERIFIED claim — kept visible, never Olumi\'s estimate, never today\'s known level', async () => {
    // "We have 0 tech leads today" is a HEADCOUNT; the factor is "Tech leads hired" (hires). Count noun + today ≠ hire: no verified
    // conversion exists, so the receipt gate does not credit it (`brief_extraction`/'explicit'). The figure survives as the user's claim.
    const nodes = await registered(`We have 0 tech leads today. ${BRIEF}`, {
      'Tech leads hired': { provenance: 'explicit', baseline_known: true, baseline_value: 0 } as Partial<Factor>,
    });
    const lead = factor(nodes, 'Tech leads hired');
    expect(lead.observed_state).toMatchObject({ value: 0, raw_value: 0, source: 'cee_inference', user_material_unverified: true });
    expect(lead.observed_state).not.toMatchObject({ source: 'brief_extraction' });
    expect(deriveInferredValues({ nodes }).map((r) => r.factor_id)).not.toContain(lead.id);
    expect(knownBaseline(lead as unknown as MagnitudeNode)).toBeUndefined();
  });

  it('CONTROL (#1767): an UNKNOWN baseline the builder estimated stays capless, as before', async () => {
    const nodes = await registered(BRIEF, {
      'Tech leads hired': { provenance: 'inferred', baseline_known: false, baseline_value: 2 } as Partial<Factor>,
    });
    const os = factor(nodes, 'Tech leads hired').observed_state!;
    expect(os).toMatchObject({ value: 0.2, raw_value: 2, source: 'cee_inference', extractionType: 'inferred' });
    expect(os).not.toHaveProperty('cap');
    expect(os).not.toHaveProperty('declared_scale');
  });
});
