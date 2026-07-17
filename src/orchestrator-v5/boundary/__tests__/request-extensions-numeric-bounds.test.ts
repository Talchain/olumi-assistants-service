/**
 * W2E-2 — numeric-bounds enforcement at the /orchestrate/v2/turn ingress
 * (path a: UI-supplied graph_state).
 *
 * The graph_state ingress schema is deliberately permissive (passthrough) for
 * SHAPE, but numeric graph values must respect the vendored @talchain/schemas
 * contract ranges before they can flow to PLoT/ISL:
 *   - edge exists_probability ∈ [0, 1]          (contract: min 0 / max 1)
 *   - edge strength.mean ∈ [-1, 1]              (contract StrengthSchema)
 *   - edge strength.std > 0                     (contract: positive)
 *   - node observed_state.std > 0               (contract: positive)
 *   - every number anywhere in graph_state must be finite (no NaN/Infinity)
 *
 * Where the contract is silent (e.g. observed_state.value) only finiteness is
 * enforced — no invented ranges.
 *
 * This file covers the REJECT half of the path-(a) split: values with no safe
 * interpretation, which reject with the same INGRESS_CONTRACT_VIOLATION
 * BoundaryError shape the structural parse uses. The REPAIR half (sigma <= 0,
 * which is repaired to the contract floor rather than bricking a persisted
 * scenario) lives in request-extensions-persisted-state-repair.test.ts. The
 * doctrine behind the split is documented in src/validators/numeric-bounds.ts.
 *
 * PII invariant: rejection messages must not echo factor labels or the
 * offending numeric values.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRequestExtensions } from '../request-extensions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, '..', '..', '..', '..', 'tests', 'fixtures', 'golden', 'ui-turn-with-graph.json');

const REQUEST_ID = 'test-req-bounds';

type IssueList = Array<{ path: string; message: string; code: string }>;

function bodyWithEdge(edge: Record<string, unknown>) {
  return {
    graph_state: {
      nodes: [
        { id: 'fac_1', kind: 'factor', label: 'SensitiveLabelA' },
        { id: 'goal_1', kind: 'goal', label: 'SensitiveLabelB' },
      ],
      edges: [{ from: 'fac_1', to: 'goal_1', ...edge }],
    },
  };
}

function bodyWithNode(node: Record<string, unknown>) {
  return {
    graph_state: {
      nodes: [{ id: 'fac_1', kind: 'factor', label: 'SensitiveLabelA', ...node }],
      edges: [],
    },
  };
}

function expectBoundsRejection(body: unknown, expectedPathFragment: string) {
  const result = parseRequestExtensions(body, REQUEST_ID);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.error).toBe('INGRESS_CONTRACT_VIOLATION');
    expect(result.error.boundary).toBe('B1');
    expect(result.error.direction).toBe('ingress');
    const details = result.error.details as { field?: string; issues?: IssueList };
    expect(details.field).toBe('graph_state');
    expect(details.issues && details.issues.length).toBeTruthy();
    const paths = (details.issues ?? []).map((i) => i.path).join('|');
    expect(paths).toContain(expectedPathFragment);
    // PII invariant: no factor labels and no raw offending values in the error.
    const serialised = JSON.stringify(result.error);
    expect(serialised).not.toContain('SensitiveLabel');
    expect(serialised).not.toMatch(/1\.4|-0\.1|-7|Infinity|NaN/);
  }
}

describe('parseRequestExtensions — numeric bounds on graph_state (W2E-2)', () => {
  it('rejects edge exists_probability above 1 (prob 1.4)', () => {
    expectBoundsRejection(
      bodyWithEdge({ exists_probability: 1.4, strength: { mean: 0.5, std: 0.1 } }),
      'edges.0.exists_probability',
    );
  });

  it('rejects edge exists_probability below 0 (prob -0.1)', () => {
    expectBoundsRejection(
      bodyWithEdge({ exists_probability: -0.1, strength: { mean: 0.5, std: 0.1 } }),
      'edges.0.exists_probability',
    );
  });

  it('rejects edge strength.mean outside [-1, 1] (weight -7)', () => {
    expectBoundsRejection(
      bodyWithEdge({ strength: { mean: -7, std: 0.1 } }),
      'edges.0.strength.mean',
    );
  });

  it('rejects NaN edge strength.mean (NaN weight)', () => {
    expectBoundsRejection(
      bodyWithEdge({ strength: { mean: Number.NaN, std: 0.1 } }),
      'edges.0.strength.mean',
    );
  });

  // NOTE: non-positive strength.std / observed_state.std are deliberately NOT
  // rejected on this path — they are REPAIRED to the contract floor. See the
  // PERSISTED-STATE REPAIR doctrine (src/validators/numeric-bounds.ts header):
  // the UI re-sends persisted canvas state on every turn, so rejecting a saved
  // std=0 bricks the scenario permanently. Coverage lives in
  // request-extensions-persisted-state-repair.test.ts.

  it('rejects Infinity node value (Infinity observed_state.value)', () => {
    expectBoundsRejection(
      bodyWithNode({ observed_state: { value: Number.POSITIVE_INFINITY } }),
      'nodes.0.observed_state.value',
    );
  });

  // (see the repair note above — observed_state.std <= 0 is repaired, not
  // rejected, on the UI graph_state path)

  it('rejects non-finite numbers in passthrough numeric fields (node intercept: Infinity)', () => {
    expectBoundsRejection(
      bodyWithNode({ intercept: Number.NEGATIVE_INFINITY }),
      'nodes.0.intercept',
    );
  });

  // ── Regression: valid inputs are byte-identical ────────────────────────────

  it('valid golden request round-trips graph_state unchanged (byte-identical)', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as {
      graph_state: unknown;
    };
    const result = parseRequestExtensions(fixture, REQUEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.graphState).not.toBeNull();
      // Byte-identical: same keys, same order, same values.
      expect(JSON.stringify(result.value.graphState)).toBe(
        JSON.stringify(fixture.graph_state),
      );
    }
  });

  it('accepts boundary values exactly at the contract limits', () => {
    const body = bodyWithEdge({
      exists_probability: 1,
      strength: { mean: -1, std: 0.001 },
    });
    const result = parseRequestExtensions(body, REQUEST_ID);
    expect(result.ok).toBe(true);
    const zero = bodyWithEdge({
      exists_probability: 0,
      strength: { mean: 1, std: 0.001 },
    });
    expect(parseRequestExtensions(zero, REQUEST_ID).ok).toBe(true);
  });

  it('leaves contract-silent numeric fields unbounded apart from finiteness', () => {
    // observed_state.value has no contract range — a large magnitude is fine.
    const result = parseRequestExtensions(
      bodyWithNode({ observed_state: { value: 5_000_000 } }),
      REQUEST_ID,
    );
    expect(result.ok).toBe(true);
  });
});
