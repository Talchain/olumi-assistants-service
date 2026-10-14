/**
 * ⛔ AN ADMITTED RUN CAN STILL BE WAITING ON THE USER (AI Conversation #70 5849012990 U3; DL 5849023213 (1)). Served on
 * CEE 79c299a (`bf5-ui-PROVENANCE-e63c89a0-79c299a-1901` turns[4]): after one approval, "Keep £49 and add a paid AI
 * add-on" acted on AI feature availability with no level. Readiness ADMITTED the run and DEMANDED that one level of the
 * user (`missing_value`), yet the receipt read only "Saved … run it again", so the Run went ahead with the option
 * partly specified and nothing asked. The receipt now names every level readiness demands of the user, as the
 * question they can answer, whenever the same readback's Run control admits a run (a refusal already names it).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readinessViewOf } from '../readiness-view.js';

const capture = JSON.parse(readFileSync(new URL('./fixtures/served-u3-receipt-79c299a.json', import.meta.url), 'utf8')) as {
  assistant_text: string; analysis_ready: { may_run: boolean; status: string }; graph: unknown;
};

/** A local, explicitly labelled AI held-state premise; captured bytes stay untouched. */
function withHeldFixtureLevel(graph: unknown, factorId: string, value: number): unknown {
  const g = graph as { nodes: Record<string, unknown>[] };
  if (!g.nodes.some((n) => n.id === factorId)) throw new Error(`overlay target ${factorId} is not in the capture`);
  return { ...g, nodes: g.nodes.map((n) => (n.id === factorId
    ? { ...n, observed_state: { ...(n.observed_state as object | undefined), value, raw_value: value, source: 'cee_inference', extractionType: 'inferred' } }
    : n)) };
}

/**
 * Positive receipt overlay: explicitly hold paid add-on price and AI feature availability at zero as fixture AI
 * assumptions. They establish the admitted-Run prerequisite independently of every option's setting; the option's
 * missing AI-availability intervention is still asked. The original captured graph remains unknown and is untouched.
 */
const served = { ...capture, graph: withHeldFixtureLevel(
  withHeldFixtureLevel(capture.graph, 'fac_paid_ai_add_on_price', 0), 'ai_feature_availability', 0) };
const ADD_ON = 'Keep £49 and add a paid AI add-on';
const ASK = `One level is not set yet: what does "${ADD_ON}" set AI feature availability to?`;

describe('the receipt asks for a level readiness still needs from the user, even when the run is admitted', () => {
  it('CONTROL (served readback): the run is admitted AND readiness demands that level of the user', () => {
    const view = readinessViewOf(served.graph);
    expect(view.may_run).toBe(true);
    // The verdict carries it as MISSING_OPTION_VALUE (it OFFERS help rather than blocking; admission counts it as
    // demanded of the user); the view names it as a level not set, by the verdict's own labels.
    expect(view.levels_not_set).toEqual([{ option: ADD_ON, factor: 'AI feature availability' }]);
    // What the user read on served: nothing asked.
    expect(served.assistant_text).not.toContain('AI feature availability');
  });

  it('RED (served turns[4]): the receipt line asks what the option sets AI feature availability to', async () => {
    const { postWriteAskLine } = await import('../../../routes/agent-v1-turn.js');
    expect(postWriteAskLine(served.graph, served.analysis_ready)).toBe(ASK);
  }, 60_000);

  it('RED: the Agent route puts it in the reply beside "run it again", from THIS turn\'s readback', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(route).toContain('const askLine = wroteThisTurn ? postWriteAskLine(readbackGraph, analysisReady) : null;');
    // S-D (#2743): a held change that went without the user is said AFTER these lines, never instead of them.
    expect(route).toMatch(/staleLine, readinessLine, askLine, \.\.\.heldLapseLines\]\.filter\(/);
  });

  it('CONTRAST: a button that does not admit a run, or a refused run, adds no ask here (the refusal sentence names the need)', async () => {
    const { postWriteAskLine } = await import('../../../routes/agent-v1-turn.js');
    expect(postWriteAskLine(served.graph, { may_run: false, status: 'blocked' })).toBeNull();
    expect(postWriteAskLine(served.graph, undefined)).toBeNull();
  }, 60_000);

  it('CONTRAST: nothing demanded of the user → nothing asked', async () => {
    const { postWriteAskLine } = await import('../../../routes/agent-v1-turn.js');
    const g = served.graph as { nodes: Record<string, unknown>[] };
    // Give the option its level: the demand is gone.
    const filled = { ...g, nodes: g.nodes.map((n) => (n.label === ADD_ON
      ? { ...n, interventions: { ...(n.interventions as Record<string, unknown>), ai_feature_availability: { value: 0.5, source: 'user_specified', target_match: { node_id: 'ai_feature_availability', match_type: 'exact_id', confidence: 'high' } } } }
      : n)) };
    expect(readinessViewOf(filled).levels_not_set).toEqual([]);
    expect(postWriteAskLine(filled, served.analysis_ready)).toBeNull();
  }, 60_000);
});
