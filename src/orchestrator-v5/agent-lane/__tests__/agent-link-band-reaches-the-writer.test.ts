/**
 * A6e — THE BAND THE USER NAMED REACHES THE LINK WRITER, IN-PROCESS, AND NEVER ON THE WIRE.
 *
 * `propose_link_strength` is the one producer CEE can prove is BAND-origin: it runs only when the user named the band
 * (`bandTheUserWrote`), and it picks `set` (the band's midpoint) or `confirm_current` (the link already sits in the
 * band — "keep the figure, record it as theirs", AIQ 5855430153). The writer turns a named band into the band's own
 * spread (std = width/√12) — but the `edge_strength_edit` event is shared with the UI's slider, β field and
 * "Confirm this estimate", which carry exact FIGURES, and it has no field saying which (the event is `.strict()`).
 *
 * So the approval carries the band the way an approved adoption already rides this dispatch
 * (`approved-adoption-context.ts`): an AsyncLocalStorage identity that survives `app.inject()` and is unreachable
 * from outside the process. These rows pin that the band is present for the Agent's write, absent for any other
 * sender, bound to this link, and never added to the wire event.
 */
import { describe, expect, it } from 'vitest';
import { OrchestratorTurnPayloadSchema } from '@talchain/schemas/boundary';

import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { statedLinkBandFor } from '../stated-link-band-context.js';
import { sizedByApproval } from '../../../cee/magnitude/link-sizing.js';

const SCENARIO = '550e8400-e29b-41d4-a716-4466554400a6';
const VERY_STRONG = 'Price sensitivity drives monthly churn very strongly. Record that link as very strong, as my own estimate.';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: VERY_STRONG, user_turn_text: VERY_STRONG };

type Edge = { from: string; to: string; strength: { mean: number; std: number }; exists_probability: number; effect_direction: 'positive' | 'negative'; provenance?: Record<string, unknown>; defaulted?: boolean };
const graphWith = (mean: number) => ({
  nodes: [
    { id: 'dec', kind: 'decision', label: 'Pricing decision' },
    { id: 'price_sensitivity', kind: 'risk', label: 'Price sensitivity' },
    { id: 'monthly_churn', kind: 'factor', label: 'Monthly churn' },
  ],
  edges: [{ from: 'price_sensitivity', to: 'monthly_churn', strength: { mean, std: 0.00375 }, exists_probability: 0.8, effect_direction: 'positive', provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' }, defaulted: true } as Edge],
});

/** A recording dispatch: it applies the event the way the writer's contract states it, and records the band it SEES. */
function world(initial: ReturnType<typeof graphWith>) {
  let g = JSON.parse(JSON.stringify(initial)) as ReturnType<typeof graphWith>;
  let rev = 1;
  const sent: Record<string, unknown>[] = [];
  const bandSeen: unknown[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: g, graph_hash: `h${rev}` } };
    sent.push(body as Record<string, unknown>);
    const b = body as { scenario_id: string; event: Record<string, unknown> };
    const ev = b.event;
    bandSeen.push(statedLinkBandFor(b.scenario_id, String(ev['from']), String(ev['to']), ev['magnitude']));
    const mag = Number(ev['magnitude']);
    // R11 (AIQ #72 5872082179): a `set` that changes the strength stamps it the user's; a `confirm_current` is REVIEW —
    // the writer keeps the provenance and records `reviewed_by_user` (before R11 this fake stamped both `user_specified`).
    const provenanceAfter = (x: Edge) => (ev['intent'] === 'confirm_current'
      // L4 (DL 5929790081): …and a confirm on a placeholder sizes it (`sizedByApproval`), as the real writer does.
      ? { ...sizedByApproval(x.provenance ?? {}, x), reviewed_by_user: { intent: 'confirm', at: '2026-09-28T15:00:00.000Z' } }
      : { source: 'user_specified' });
    g = { ...g, edges: g.edges.map((x) => (x.from === ev['from'] && x.to === ev['to'] ? { ...x, strength: { ...x.strength, mean: mag }, provenance: provenanceAfter(x) } : x)) };
    rev += 1;
    return { status: 200, json: { assistant_text: 'Updated.', graph_hash: `h${rev}` } };
  };
  return { d, sent, bandSeen };
}

async function recordVeryStrong(mean: number) {
  const w = world(graphWith(mean));
  const store = new ProposalStore();
  const caps = createAgentCapabilities(w.d, store);
  const p = await caps.proposeLinkStrength!(ctx, { from_label: 'Price sensitivity', to_label: 'Monthly churn', strength: 'very strong', rationale: 'The user said so.' });
  expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
  const r = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
  expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true }));
  return { w, p, store };
}

describe('the band the user named rides the approval to the writer', () => {
  it('⭐ RED (Paul 08bf9a1f): "very strong" on Olumi’s 0.0075 placeholder → the writer sees band "very strong" for exactly this link (set)', async () => {
    const { w } = await recordVeryStrong(0.0075);
    expect(w.sent).toHaveLength(1);
    expect((w.sent[0]!['event'] as Record<string, unknown>)['intent']).toBe('set');
    expect(w.bandSeen).toEqual(['very strong']);
  });

  it('⭐ RED: the link already sits in the named band (0.85) → confirm_current, and the writer sees the band too', async () => {
    const { w } = await recordVeryStrong(0.85);
    expect((w.sent[0]!['event'] as Record<string, unknown>)['intent']).toBe('confirm_current');
    expect(w.bandSeen).toEqual(['very strong']);
  });

  it('the band is stored ON the approved proposal (content-hashed with it), and the wire event is unchanged and still parses', async () => {
    const { w, p, store } = await recordVeryStrong(0.0075);
    const op = store.get(String(p.proposal_id))?.operations[0];
    expect(op?.value).toEqual(expect.objectContaining({ band: 'very strong' }));
    expect(w.sent[0]!['event']).toEqual({
      kind: 'edge_strength_edit', from: 'price_sensitivity', to: 'monthly_churn', intent: 'set', direction_intent: 'preserve',
      magnitude: 0.85, expected: { mean: 0.0075, effect_direction: 'positive' },
    });
    const parsed = OrchestratorTurnPayloadSchema.safeParse(w.sent[0]);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it('CONTRAST: the same event sent by anything else (the UI) carries no band', async () => {
    const w = world(graphWith(0.0075));
    await w.d('/orchestrate/v2/turn', {
      kind: 'system_event', turn_id: 't', scenario_id: SCENARIO, stage: 'frame',
      event: { kind: 'edge_strength_edit', from: 'price_sensitivity', to: 'monthly_churn', intent: 'set', direction_intent: 'preserve', magnitude: 0.85, expected: { mean: 0.0075, effect_direction: 'positive' } },
    });
    expect(w.bandSeen).toEqual([undefined]);
  });

  it('CONTRAST: outside the approval the context is gone', async () => {
    await recordVeryStrong(0.0075);
    expect(statedLinkBandFor(SCENARIO, 'price_sensitivity', 'monthly_churn', 0.85)).toBeUndefined();
  });
});
