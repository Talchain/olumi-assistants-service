/**
 * ArtifactStore tests: persist/reload round-trip, bounded size, idempotent
 * re-append, log-safety (bodies never logged), and stub-client Supabase
 * behaviour. Both implementations share the pure toArtifactRows core, so cap
 * semantics are asserted once and conflict semantics per impl.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return {
    ...actual,
    emit: vi.fn(),
    log: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

import { emit, log } from '../../../utils/telemetry.js';
import type { DeferArtifact } from '../../dual-draft/merge.js';
import { mergeProposals } from '../../dual-draft/merge.js';
import { PROPOSAL_CAP } from '../../dual-draft/proposals.js';
import {
  ARTIFACT_FIELD_CAPS,
  MAX_ARTIFACTS_PER_TURN,
} from '../artifacts/types.js';
import { truncateForStorage, toArtifactRows } from '../artifacts/store.js';
import { InMemoryArtifactStore } from '../artifacts/memory-store.js';
import { SupabaseArtifactStore, M2_ARTIFACTS_TABLE } from '../artifacts/supabase-store.js';
import { baseGraph } from './adversarial-fixtures.js';

function artifact(index: number, overrides: Partial<DeferArtifact> = {}): DeferArtifact {
  return {
    type: 'added_evidence_gap',
    question: `What is unknown #${index}?`,
    rationale: null,
    evidence_pointer: `draft: gap ${index}`,
    ...overrides,
  };
}

function input(artifacts: readonly DeferArtifact[], turnId = 'turn-1') {
  return {
    requestId: 'req-1',
    scenarioId: 'scen-1',
    turnId,
    graphHash: 'abcd1234abcd1234',
    artifacts,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('contract pins', () => {
  it('MAX_ARTIFACTS_PER_TURN equals the merge PROPOSAL_CAP (drift guard)', () => {
    expect(MAX_ARTIFACTS_PER_TURN).toBe(PROPOSAL_CAP);
  });
});

describe('truncateForStorage', () => {
  it('trims and passes through under-cap text', () => {
    expect(truncateForStorage('  hello  ', 10)).toEqual({ value: 'hello', truncated: false });
  });
  it('caps over-length text with a trailing ellipsis at exactly the cap', () => {
    const res = truncateForStorage('x'.repeat(600), 500);
    expect(res.truncated).toBe(true);
    expect(res.value).toHaveLength(500);
    expect(res.value.endsWith('…')).toBe(true);
  });
});

describe('InMemoryArtifactStore — persist/reload round trip', () => {
  it('appends real merge artifacts and reads them back with provenance + order', async () => {
    const out = mergeProposals(baseGraph(), [
      { type: 'added_evidence_gap', delta: { question: 'Churn baseline?' }, evidence_pointer: 'draft: churn' },
      { type: 'uncertainty_flag', delta: { question: 'Price elasticity?' }, evidence_pointer: 'draft: price' },
      {
        type: 'added_option',
        delta: { node: { id: 'opt_p', kind: 'option', label: 'Partner route' } },
        evidence_pointer: 'brief: partnership',
      },
    ]);
    expect(out.artifacts).toHaveLength(3);

    const store = new InMemoryArtifactStore();
    const res = await store.appendArtifacts(input(out.artifacts));
    expect(res).toEqual({ appended: 3, dropped_over_cap: 0, truncated_fields: 0, rejected_invalid: 0 });

    const rows = await store.readByTurn('scen-1', 'turn-1');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.proposal_type)).toEqual([
      'added_evidence_gap',
      'uncertainty_flag',
      'added_option',
    ]);
    expect(rows.map((r) => r.artifact_index)).toEqual([0, 1, 2]);
    expect(rows[0]).toMatchObject({
      request_id: 'req-1',
      scenario_id: 'scen-1',
      turn_id: 'turn-1',
      graph_hash: 'abcd1234abcd1234',
      question: 'Churn baseline?',
      evidence_pointer: 'draft: churn',
      status: 'deferred',
    });
  });

  it('re-appending the same turn is idempotent (appended: 0, no duplicates)', async () => {
    const store = new InMemoryArtifactStore();
    await store.appendArtifacts(input([artifact(0), artifact(1)]));
    const again = await store.appendArtifacts(input([artifact(0), artifact(1)]));
    expect(again.appended).toBe(0);
    expect(await store.readByTurn('scen-1', 'turn-1')).toHaveLength(2);
  });

  it('caps rows per turn: 9 artifacts → 8 appended + dropped_over_cap 1', async () => {
    const store = new InMemoryArtifactStore();
    const res = await store.appendArtifacts(
      input(Array.from({ length: 9 }, (_, i) => artifact(i))),
    );
    expect(res.appended).toBe(8);
    expect(res.dropped_over_cap).toBe(1);
    expect(await store.readByTurn('scen-1', 'turn-1')).toHaveLength(8);
  });

  it('truncates over-cap fields deterministically and counts them', async () => {
    const store = new InMemoryArtifactStore();
    const res = await store.appendArtifacts(
      input([
        artifact(0, {
          question: 'q'.repeat(ARTIFACT_FIELD_CAPS.question + 100),
          rationale: 'r'.repeat(ARTIFACT_FIELD_CAPS.rationale + 100),
          evidence_pointer: 'e'.repeat(ARTIFACT_FIELD_CAPS.evidence_pointer + 100),
        }),
      ]),
    );
    expect(res).toMatchObject({ appended: 1, truncated_fields: 3 });
    const [row] = await store.readByTurn('scen-1', 'turn-1');
    expect(row.question).toHaveLength(ARTIFACT_FIELD_CAPS.question);
    expect(row.rationale).toHaveLength(ARTIFACT_FIELD_CAPS.rationale);
    expect(row.evidence_pointer).toHaveLength(ARTIFACT_FIELD_CAPS.evidence_pointer);
  });

  it('rejects unknown types and empty-after-trim required fields (SQL CHECK parity)', async () => {
    const store = new InMemoryArtifactStore();
    const res = await store.appendArtifacts(
      input([
        artifact(0, { type: 'mystery_type' }),
        artifact(1, { question: '   ' }),
        artifact(2, { evidence_pointer: ' \t ' }),
        artifact(3),
      ]),
    );
    expect(res).toEqual({ appended: 1, dropped_over_cap: 0, truncated_fields: 0, rejected_invalid: 3 });
  });

  it('readByScenario supports status filter + limit, ordered (created_at, artifact_index)', async () => {
    const store = new InMemoryArtifactStore();
    await store.appendArtifacts(input([artifact(0), artifact(1)], 'turn-1'));
    await store.appendArtifacts(input([artifact(2)], 'turn-2'));
    const all = await store.readByScenario('scen-1');
    expect(all.map((r) => r.turn_id)).toEqual(['turn-1', 'turn-1', 'turn-2']);
    expect(await store.readByScenario('scen-1', { limit: 2 })).toHaveLength(2);
    expect(await store.readByScenario('scen-1', { statuses: ['surfaced'] })).toHaveLength(0);
    expect(await store.readByScenario('scen-other')).toHaveLength(0);
  });
});

describe('log-safety — artifact bodies never reach log or telemetry arguments', () => {
  const SENTINEL = 'REDACTION_SENTINEL_9f3a';

  function failingStubClient() {
    const result = Promise.resolve({ data: null, error: { code: '42P01', message: 'relation missing' } });
    return {
      from: () => ({
        upsert: () => ({ select: () => result }),
      }),
    } as never;
  }

  it('SupabaseArtifactStore logs counts/ids only, even on failure paths', async () => {
    const store = new SupabaseArtifactStore(failingStubClient());
    await store.appendArtifacts(
      input([
        artifact(0, {
          question: `Is ${SENTINEL} known?`,
          rationale: `because ${SENTINEL}`,
          evidence_pointer: `brief: ${SENTINEL}`,
        }),
      ]),
    );
    const allLogArgs = [
      ...(log.debug as ReturnType<typeof vi.fn>).mock.calls,
      ...(log.info as ReturnType<typeof vi.fn>).mock.calls,
      ...(log.warn as ReturnType<typeof vi.fn>).mock.calls,
      ...(log.error as ReturnType<typeof vi.fn>).mock.calls,
      ...(emit as unknown as ReturnType<typeof vi.fn>).mock.calls,
    ];
    expect(allLogArgs.length).toBeGreaterThan(0); // the failure path did log
    expect(JSON.stringify(allLogArgs)).not.toContain(SENTINEL);
  });
});

describe('SupabaseArtifactStore — stub-client behaviour', () => {
  it('targets cee_m2_artifacts with the composite conflict key and ignoreDuplicates', async () => {
    const upsert = vi.fn(() => ({ select: () => Promise.resolve({ data: [{ id: '1' }], error: null }) }));
    const from = vi.fn(() => ({ upsert }));
    const store = new SupabaseArtifactStore({ from } as never);

    const res = await store.appendArtifacts(input([artifact(0)]));
    expect(from).toHaveBeenCalledWith(M2_ARTIFACTS_TABLE);
    expect(upsert).toHaveBeenCalledWith(expect.any(Array), {
      onConflict: 'scenario_id,turn_id,artifact_index',
      ignoreDuplicates: true,
    });
    expect(res.appended).toBe(1);
  });

  it('duplicate-skipped rows are reported via the returned row count, not assumed', async () => {
    const upsert = vi.fn(() => ({ select: () => Promise.resolve({ data: [], error: null }) }));
    const store = new SupabaseArtifactStore({ from: () => ({ upsert }) } as never);
    const res = await store.appendArtifacts(input([artifact(0), artifact(1)]));
    expect(res.appended).toBe(0); // both conflicted server-side
  });

  it('errors and timeouts swallow to zero-counts; the store never throws', async () => {
    const hanging = { from: () => ({ upsert: () => ({ select: () => new Promise(() => {}) }) }) };
    const store = new SupabaseArtifactStore(hanging as never, { timeoutMs: 10 });
    const res = await store.appendArtifacts(input([artifact(0)]));
    expect(res).toMatchObject({ appended: 0 });

    const readStore = new SupabaseArtifactStore(
      {
        from: () => ({
          select: () => ({
            eq: () => ({
              order: () => ({ order: () => Promise.resolve({ data: null, error: { code: 'x' } }) }),
            }),
          }),
        }),
      } as never,
    );
    expect(await readStore.readByScenario('scen-1')).toEqual([]);
  });

  it('append with zero valid rows never touches the client', async () => {
    const from = vi.fn();
    const store = new SupabaseArtifactStore({ from } as never);
    const res = await store.appendArtifacts(input([artifact(0, { question: ' ' })]));
    expect(res).toMatchObject({ appended: 0, rejected_invalid: 1 });
    expect(from).not.toHaveBeenCalled();
  });
});

describe('toArtifactRows — determinism', () => {
  it('same input → deep-equal rows and accounting', () => {
    const payload = input([artifact(0), artifact(1, { rationale: 'why' })]);
    expect(toArtifactRows(payload)).toEqual(toArtifactRows(payload));
  });
});
