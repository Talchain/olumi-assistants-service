import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyGrammarRedraw } from '../grammar-redraw.js';
import { buildRedrawDisclosure, readDraftStructureFacts, withRedrawDisclosure } from '../draft-structure.js';
import type { UnifiedPipelineResult } from '../../unified-pipeline/types.js';

/**
 * ⛔⛔ THE PRODUCT TEST FINDING, from independent review:
 *
 *   > "The redraw is a silent change to the team's causal model. The user is
 *   > never told that a second draft was made, or what changed."
 *
 * `redraw_spent` reached only the trace. The doctrine requires any automatic
 * model change to be VISIBLE. This is the same charter gap I spent the day
 * finding in other lanes' work and missed in my own.
 */
const wire = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.wire.json`, import.meta.url), 'utf8'));
const BOTH = wire('wire-both-mechanisms');
const READY = wire('wire-ready-control');
const ok = (body: unknown): UnifiedPipelineResult =>
  ({ statusCode: 200, body }) as unknown as UnifiedPipelineResult;
const AFFORDABLE_MS = 20_000;

const edgesOnly = readDraftStructureFacts({
  nodes: [{ id: 'o', kind: 'option' }, { id: 'r', kind: 'risk' }],
  edges: [{ from: 'o', to: 'r' }],
  analysis_ready: { status: 'x', options: [] },
});
const targetsOnly = readDraftStructureFacts({
  nodes: [{ id: 'o', kind: 'option' }],
  edges: [],
  analysis_ready: { status: 'x', options: [{ id: 'o', status: 'needs_user_mapping', unresolved_targets: ['49'] }] },
});

describe('the sentence names only what the first draw actually did', () => {
  it('an edges-only first draw is described as edges only', () => {
    const d = buildRedrawDisclosure(edgesOnly);
    expect(d).toContain('linked options straight to risks');
    expect(d).not.toContain('no factor to attach it to');
  });

  it('a targets-only first draw is described as targets only', () => {
    const d = buildRedrawDisclosure(targetsOnly);
    expect(d).toContain('no factor to attach it to');
    expect(d).not.toContain('linked options straight to risks');
  });

  it('a draw with both is described as both', () => {
    const d = buildRedrawDisclosure(readDraftStructureFacts(BOTH));
    expect(d).toContain('linked options straight to risks');
    expect(d).toContain('no factor to attach it to');
  });

  it('⛔ a CLEAN draw produces no sentence — there was no change to disclose', () => {
    expect(buildRedrawDisclosure(readDraftStructureFacts(READY))).toBe('');
    expect(buildRedrawDisclosure(readDraftStructureFacts(null))).toBe('');
  });
});

describe('what the sentence may not contain', () => {
  const d = buildRedrawDisclosure(readDraftStructureFacts(BOTH));

  it('⛔ no node ids — the safety scanner flags them and the user never chose them', () => {
    const ids = (BOTH as { nodes: { id: string }[] }).nodes.map((n) => n.id);
    for (const id of ids) expect(d).not.toContain(id);
  });

  it('⛔ no offending token echoed back — that is the "49" mistake again', () => {
    for (const t of readDraftStructureFacts(BOTH).unresolvableTargets) expect(d).not.toContain(t);
  });

  it('⛔ it does NOT claim the model was fixed', () => {
    // The second draw is not known to be correct — only to break fewer of the
    // model's own rules. "I fixed it" would be a claim we cannot support.
    expect(d.toLowerCase()).not.toContain('fixed');
    expect(d.toLowerCase()).not.toContain('corrected');
    expect(d).toContain('drafted this model twice');
  });

  it('⭐ it says nothing of theirs was dropped, and invites correction', () => {
    expect(d).toContain('Nothing you wrote was dropped');
    expect(d).toContain('tell me if anything here does not match your thinking');
  });
});

describe('attachment — fails open, mutates nothing', () => {
  it('appends to the draft’s own rendered summary', () => {
    const out = withRedrawDisclosure({ coaching: { summary: 'Existing summary.' } }, 'DISCLOSED.');
    expect((out as { coaching: { summary: string } }).coaching.summary).toBe('Existing summary. DISCLOSED.');
  });

  it('does not mutate the body it was given', () => {
    const body = { coaching: { summary: 'Existing.' } };
    const before = JSON.stringify(body);
    withRedrawDisclosure(body, 'DISCLOSED.');
    expect(JSON.stringify(body)).toBe(before);
  });

  it('⛔ an unreadable body or missing coaching returns the SAME object', () => {
    // A disclosure that could break a shippable draft would be worse than the
    // silence it replaces.
    const noCoaching = { nodes: [] };
    expect(withRedrawDisclosure(noCoaching, 'D')).toBe(noCoaching);
    expect(withRedrawDisclosure(null, 'D')).toBe(null);
    const body = { coaching: { summary: 'x' } };
    expect(withRedrawDisclosure(body, '')).toBe(body);   // nothing to say ⇒ untouched
  });
});

describe('end to end: a shipped redraw is disclosed, a clean draw is not', () => {
  it('⭐ the shipped second draw CARRIES the sentence', async () => {
    const second = ok({ ...(READY as object), coaching: { summary: 'The model compares three options.' } });
    const out = (await applyGrammarRedraw({
      first: ok(BOTH), requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => second,
    })).result;
    const summary = (out.body as { coaching: { summary: string } }).coaching.summary;
    expect(summary).toContain('The model compares three options.');   // the drafter's own words survive
    expect(summary).toContain('I drafted this model twice');
  });

  it('⛔ a CLEAN first draw is untouched — same object, no sentence', async () => {
    const first = ok({ ...(READY as object), coaching: { summary: 'Only this.' } });
    const out = (await applyGrammarRedraw({
      first, requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => ok(READY),
    })).result;
    expect(out).toBe(first);
    expect((out.body as { coaching: { summary: string } }).coaching.summary).toBe('Only this.');
  });

  it('⛔ a redraw that LOSES discloses nothing — there was no change', async () => {
    // Saying "I drafted this twice" when the first draw shipped would be a false
    // claim about their model.
    const first = ok({ ...(BOTH as object), coaching: { summary: 'First.' } });
    const out = (await applyGrammarRedraw({
      first, requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => ok(BOTH),
    })).result;
    expect(out).toBe(first);
    expect((out.body as { coaching: { summary: string } }).coaching.summary).toBe('First.');
  });
});
