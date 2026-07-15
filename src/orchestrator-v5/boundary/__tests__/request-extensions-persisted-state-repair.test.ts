/**
 * W2E-2 review fix — PERSISTED-STATE REPAIR vs NEW-CLAIM REJECTION on the
 * UI `graph_state` ingress path (path a).
 *
 * The W2E-2 ingress gate as first shipped hard-rejected any turn whose
 * canvas carried sigma <= 0. That bricks real users: the UI re-sends its
 * persisted canvas on EVERY turn, so a scenario already saved with std=0
 * becomes permanently unusable — every turn 422s with a non-actionable
 * error. std=0 is genuinely reachable and persisted:
 *
 *   - DecisionGuideAI src/canvas/conversation/useConversation.ts (buildRequest)
 *       `const std = typeof strengthStdValue === 'number'
 *                      ? Math.max(0, strengthStdValue) : undefined`
 *     floors strengthStd at ZERO (not >0), so a canvas std of 0 — or any
 *     negative legacy value — goes on the wire as `strength.std = 0`.
 *   - DecisionGuideAI src/canvas/utils/applyDraftResult.ts:99 takes
 *       `e.strength.std` VERBATIM from a CEE draft response, so CEE's own
 *     draft path can write std=0 into the canvas that is then persisted.
 *   - `observed_state` is passed through verbatim (useConversation.ts:1694)
 *     with no clamp at all.
 *
 * Doctrine (orchestrator ruling, documented in validators/numeric-bounds.ts):
 *   - std <= 0 has an unambiguous safe reading ("no uncertainty stated") →
 *     REPAIR to the contract floor, record telemetry, let the turn proceed.
 *   - NaN / ±Infinity are meaningless, and a probability outside [0,1] cannot
 *     be safely interpreted (1.4 could mean 1.0 or 0.14) → stay HARD REJECTS.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { parseRequestExtensions } from '../request-extensions.js';
import { setTestSink } from '../../../utils/telemetry.js';
import { TelemetryEvents } from '../../../utils/telemetry.js';

const REQUEST_ID = 'test-req-repair';

type Captured = { event: string; data: Record<string, unknown> };

function captureTelemetry(): Captured[] {
  const events: Captured[] = [];
  setTestSink((event, data) => events.push({ event, data }));
  return events;
}

afterEach(() => setTestSink(null));

/**
 * A REAL persisted-canvas shape, as the UI's buildRequest emits it after
 * `Math.max(0, strengthStd)` floors a zero/negative std to 0. This body is
 * what re-enters CEE on every single turn for an affected scenario.
 */
function persistedCanvasWithZeroStd() {
  return {
    graph_state: {
      nodes: [
        { id: 'fac_1', kind: 'factor', label: 'SensitiveLabelA' },
        { id: 'goal_1', kind: 'goal', label: 'SensitiveLabelB' },
      ],
      edges: [
        {
          from: 'fac_1',
          to: 'goal_1',
          strength: { mean: 0.5, std: 0 },
          exists_probability: 0.8,
          edge_type: 'directed',
        },
      ],
    },
  };
}

describe('parseRequestExtensions — persisted-state repair (W2E-2 review fix)', () => {
  it('completes the turn for a persisted canvas carrying edge strength.std = 0', () => {
    const result = parseRequestExtensions(persistedCanvasWithZeroStd(), REQUEST_ID);
    // TODAY: this is `false` — the scenario is bricked on every turn.
    expect(result.ok).toBe(true);
  });

  it('repairs edge strength.std = 0 up to the contract floor (> 0)', () => {
    const result = parseRequestExtensions(persistedCanvasWithZeroStd(), REQUEST_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const edge = (result.value.graphState as { edges: Array<Record<string, any>> }).edges[0];
    expect(edge.strength.std).toBeGreaterThan(0);
    // Unrelated values are untouched by the repair.
    expect(edge.strength.mean).toBe(0.5);
    expect(edge.exists_probability).toBe(0.8);
  });

  it('repairs a negative edge strength.std', () => {
    const body = persistedCanvasWithZeroStd();
    body.graph_state.edges[0].strength.std = -0.2;
    const result = parseRequestExtensions(body, REQUEST_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const edge = (result.value.graphState as { edges: Array<Record<string, any>> }).edges[0];
    expect(edge.strength.std).toBeGreaterThan(0);
  });

  it('repairs node observed_state.std <= 0', () => {
    const body = {
      graph_state: {
        nodes: [
          {
            id: 'fac_1',
            kind: 'factor',
            label: 'SensitiveLabelA',
            observed_state: { value: 0.5, std: 0 },
          },
        ],
        edges: [],
      },
    };
    const result = parseRequestExtensions(body, REQUEST_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = (result.value.graphState as { nodes: Array<Record<string, any>> }).nodes[0];
    expect(node.observed_state.std).toBeGreaterThan(0);
    expect(node.observed_state.value).toBe(0.5);
  });

  it('emits a repair telemetry event naming the field path — and no PII', () => {
    const events = captureTelemetry();
    const result = parseRequestExtensions(persistedCanvasWithZeroStd(), REQUEST_ID);
    expect(result.ok).toBe(true);

    const repairs = events.filter((e) => e.event === TelemetryEvents.IngressNumericRepair);
    expect(repairs.length).toBe(1);
    expect(repairs[0].data.field).toBe('graph_state');
    expect(repairs[0].data.path).toBe('edges.0.strength.std');
    expect(repairs[0].data.request_id).toBe(REQUEST_ID);

    // PII rule: never the label, never the offending decision value.
    const serialised = JSON.stringify(repairs[0]);
    expect(serialised).not.toContain('SensitiveLabel');
  });

  it('does NOT mutate the caller\'s input object (repair is copy-on-write)', () => {
    const body = persistedCanvasWithZeroStd();
    parseRequestExtensions(body, REQUEST_ID);
    expect(body.graph_state.edges[0].strength.std).toBe(0);
  });

  // ── The split: meaningless / uninterpretable values still hard-reject ──────

  it('still REJECTS a probability outside [0,1] (cannot infer 1.0 vs 0.14)', () => {
    const body = persistedCanvasWithZeroStd();
    body.graph_state.edges[0].exists_probability = 1.4;
    const result = parseRequestExtensions(body, REQUEST_ID);
    expect(result.ok).toBe(false);
  });

  it('still REJECTS a non-finite number (Infinity is meaningless)', () => {
    const body = persistedCanvasWithZeroStd();
    body.graph_state.edges[0].strength.mean = Number.POSITIVE_INFINITY;
    const result = parseRequestExtensions(body, REQUEST_ID);
    expect(result.ok).toBe(false);
  });

  it('still REJECTS NaN', () => {
    const body = persistedCanvasWithZeroStd();
    body.graph_state.edges[0].strength.mean = Number.NaN;
    const result = parseRequestExtensions(body, REQUEST_ID);
    expect(result.ok).toBe(false);
  });

  it('a thrown ingress error names the field path and the bound (actionable)', () => {
    const body = persistedCanvasWithZeroStd();
    body.graph_state.edges[0].exists_probability = 1.4;
    const result = parseRequestExtensions(body, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const details = result.error.details as {
      field?: string;
      issues?: Array<{ path: string; message: string }>;
    };
    expect(details.field).toBe('graph_state');
    const issue = (details.issues ?? []).find((i) => i.path === 'edges.0.exists_probability');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('[0, 1]');
    // Renderable by the UI's existing CEE-validation-error handling: the same
    // INGRESS_CONTRACT_VIOLATION / details.issues[] shape as a structural fail.
    expect(result.error.error).toBe('INGRESS_CONTRACT_VIOLATION');
    expect(JSON.stringify(result.error)).not.toContain('SensitiveLabel');
  });
});
