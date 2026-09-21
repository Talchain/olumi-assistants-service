/**
 * B1 ingress drift-detection: when the BoundaryErrorSchema no longer accepts
 * the shape our factory produces (a future §6.4 tightening vs. our
 * construction), validateIngress MUST:
 *   - never throw past the boundary
 *   - emit a `boundary.validation` event with failure_class='schema_drift'
 *   - return a typed, hardcoded fallback BoundaryError
 *
 * We simulate drift by mocking BoundaryErrorSchema.safeParse to fail on the
 * drift check (but pass on any downstream re-validation). This is the only
 * way to exercise the drift branch without literally shipping a broken
 * factory.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock BEFORE importing validators/b1 so the import picks up the mock.
vi.mock('@talchain/schemas/boundary', async () => {
  const actual = await vi.importActual<typeof import('@talchain/schemas/boundary')>(
    '@talchain/schemas/boundary',
  );
  return {
    ...actual,
    BoundaryErrorSchema: {
      safeParse: vi.fn(),
    },
  };
});

import { validateIngress } from '../../../src/validators/b1.js';
import { setTestSink } from '../../../src/utils/telemetry.js';
import { BoundaryErrorSchema } from '@talchain/schemas/boundary';

type Ev = { event: string; data: Record<string, unknown> };

describe('validateIngress — drift detection', () => {
  let events: Ev[] = [];

  beforeEach(() => {
    events = [];
    setTestSink((event, data) => events.push({ event, data }));
    vi.mocked(BoundaryErrorSchema.safeParse).mockReset();
  });

  it('corrupt BoundaryError (schema drift) → typed fallback, never throws', () => {
    // Force the drift check to fail as if the schema had been tightened.
    vi.mocked(BoundaryErrorSchema.safeParse).mockReturnValue({
      success: false,
      // Zod's error .issues shape is all we read.
      error: { issues: [{ path: ['retryable'], message: 'drifted', code: 'custom' }] },
    } as unknown as ReturnType<typeof BoundaryErrorSchema.safeParse>);

    // Invalid ingress payload — any ingress failure triggers the drift path.
    const result = validateIngress({ wrong: 'shape' }, 'req-drift-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Must be the hardcoded fallback, not the candidate.
      expect(result.error.error).toBe('INTERNAL_ERROR');
      expect(result.error.boundary).toBe('B1');
      expect(result.error.direction).toBe('ingress');
      expect(result.error.retryable).toBe(false);
      expect(result.error.request_id).toBe('req-drift-1');
      expect(result.error.details).toEqual({ reason: 'boundary_error_schema_drift' });
    }

    // Must emit the drift-detection telemetry event.
    const drift = events.find((e) => e.data.failure_class === 'schema_drift');
    expect(drift).toBeDefined();
    expect(drift?.event).toBe('boundary.validation');
    expect(drift?.data.pass).toBe(false);
    expect(drift?.data.error_code).toBe('INTERNAL_ERROR');
    expect(drift?.data.drift_issue_count).toBe(1);
  });

  it('non-drift ingress failure → normal INGRESS_CONTRACT_VIOLATION', () => {
    // Drift check passes → normal path.
    vi.mocked(BoundaryErrorSchema.safeParse).mockReturnValue({
      success: true,
      data: {} as never,
    } as unknown as ReturnType<typeof BoundaryErrorSchema.safeParse>);

    const result = validateIngress({ wrong: 'shape' }, 'req-normal-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error).toBe('INGRESS_CONTRACT_VIOLATION');
    }

    const drift = events.find((e) => e.data.failure_class === 'schema_drift');
    expect(drift).toBeUndefined();
  });
});
