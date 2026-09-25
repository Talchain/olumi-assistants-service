/**
 * ⛔ A SIZE RETRY THAT CANNOT BE ADOPTED IS A REFUSAL WITH A MINUTE'S DELAY.
 *
 * The size retry was a fresh generation from the brief alone. Adoption then requires every option, fact and
 * relationship the user stated to survive BY NAME (`keepsEveryUserStatedIdentity`, #1710), and a fresh generation
 * renames them ("Hire two senior engineers" → "hire 2 senior engineers" → "two senior engineers").
 *
 * MEASURED offline on 9417228's build-model with gpt-5.6-terra, the eng-hiring brief ("two senior engineers or four
 * junior engineers … under £400k"), 8 real first drafts, PAIRED:
 *   - shipped retry (regenerate from the brief):   within limits 8/8, keeps user identity 0/8 → never adoptable;
 *   - retry that EDITS its own first draft:        within limits 8/8, keeps user identity 8/8, shrank 8/8.
 * Live: 2 of 14 eng-hiring builds were refused as model_too_large after a retry (~135 s, no model).
 * Evidence: programme-docs `evidence/ai-quality-20260925` (size-refusal/).
 *
 * So a size-only retry now receives its first draft and is asked to remove only what it added, copying every kept
 * item exactly. A retry with construction issues keeps its existing repair input (unchanged, not measured here).
 */
import { describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const SCENARIO = '55555555-5555-4555-8555-555555555555';
const BRIEF = 'Should we hire two senior engineers or four junior engineers to ship the new platform by Q3?';
const factor = (label: string, provenance = 'ai_proposed') => ({
  label, role: 'observable', baseline_known: false, baseline_value: null, unit: null, provenance, plausible_max: 100,
});
const link = (from: string, to: string, provenance = 'inferred') => ({ from, to, direction: 'positive', provenance });
function candidate(extra: number) {
  const names = Array.from({ length: extra }, (_, i) => `Speculative factor ${i}`);
  return {
    goal: { metric: 'Platform delivered by Q3', operator: '>=', value: 1, unit: null, horizon_months: 9, provenance: 'explicit' },
    constraints: [],
    options: ['Hire two senior engineers', 'Hire four junior engineers'].map((label) => ({ label, provenance: 'explicit', changes: ['Delivery capacity'], interventions: [] })),
    factors: [factor('Delivery capacity', 'inferred'), ...names.map((n) => factor(n))],
    risks: [], outcomes: [{ label: 'Platform delivered by Q3', provenance: 'inferred' }],
    links: [link('Delivery capacity', 'Platform delivered by Q3'), ...names.map((n) => link(n, 'Platform delivered by Q3'))],
    unknowns: [],
  };
}
function sequence(...payloads: unknown[]) {
  const reqs: { instructions: string; input: string }[] = [];
  const fn = vi.fn(async (req: { instructions: string; input: string }) => {
    reqs.push(req); return { text: JSON.stringify(payloads[Math.min(reqs.length - 1, payloads.length - 1)]) };
  }) as unknown as CallStructuredModel;
  return { fn, reqs };
}
const dispatch = (async (path: string) => path.endsWith('/graph/register')
  ? { status: 200, json: { model_version: { version_number: 1 } } }
  : path.endsWith('/graph') ? { status: 200, json: { graph: { nodes: [] } } } : { status: 200, json: { versions: [] } }) as unknown as InternalDispatch;

describe('a size retry EDITS its own first draft', () => {
  it('the retry receives the first draft, and is told to copy every kept item exactly', async () => {
    const first = candidate(20);
    const s = sequence(first, candidate(3));
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dispatch, s.fn);
    expect(out['size_retried'], 'PRECONDITION: the first draft was oversized').toBe(true);
    expect(s.reqs).toHaveLength(2);
    const retry = s.reqs[1]!;
    expect(retry.input.startsWith(BRIEF), 'the brief still leads').toBe(true);
    expect(retry.input, 'the first draft itself, so kept labels can be copied').toContain(JSON.stringify(first));
    expect(retry.instructions).toMatch(/Copy every item you keep EXACTLY/);
    // The budget and the protect-the-brief rule still travel (construction-compact-first-model.test.ts pins those).
    expect(retry.instructions).toMatch(/not negotiable|must not be dropped/i);
  });

  it('CONTROL: a compact first draft makes no retry at all', async () => {
    const s = sequence(candidate(3));
    await buildModelFromBrief(SCENARIO, BRIEF, dispatch, s.fn);
    expect(s.reqs).toHaveLength(1);
  });

  it('an edited retry that keeps every user-stated item by name is ADOPTED', async () => {
    const first = candidate(20);
    const edited = { ...first, factors: first.factors.slice(0, 3), links: first.links.slice(0, 3) };
    const out = await buildModelFromBrief(SCENARIO, BRIEF, dispatch, sequence(first, edited).fn);
    expect(out.ok).toBe(true);
    expect(out['size_retried']).toBe(true);
    expect(out['within_compact_limits']).toBe(true);
  });
});
