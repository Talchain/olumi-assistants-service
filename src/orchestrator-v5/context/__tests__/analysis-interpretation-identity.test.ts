import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { describe, expect, it } from 'vitest';

import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import {
  compareAnalysisInterpretationBinding,
  compareAnalysisRunFactIdentity,
  validateAnalysisRunFactIdentity,
} from '../analysis-interpretation-identity.js';
import type {
  AnalysisInterpretationBinding,
  AnalysisInterpretationPolicy,
  AnalysisRunFactIdentity,
} from '../analysis-interpretation-identity.js';
import { deriveAnalysisFreshness } from '../freshness.js';
import {
  computeAnalysisAffectingGraphHash,
  computeAnalysisAffectingGraphHashSha256,
} from '../graph-hash.js';
import { computeGraphIdentityHash } from '../graph-identity.js';

// Synthetic data. Hashes below come from the established producer projection.
const GRAPH = {
  nodes: [{ id: 'factor', kind: 'factor', observed_state: { value: 0.5 } }],
  edges: [],
} as GraphStateIngress;
const CHANGED_GRAPH = {
  nodes: [{ id: 'factor', kind: 'factor', observed_state: { value: 0.6 } }],
  edges: [],
} as GraphStateIngress;
const SHORT = computeAnalysisAffectingGraphHash(GRAPH)!;
const FULL = computeAnalysisAffectingGraphHashSha256(GRAPH)!;
const OTHER_SHORT = computeAnalysisAffectingGraphHash(CHANGED_GRAPH)!;
const OTHER_FULL = computeAnalysisAffectingGraphHashSha256(CHANGED_GRAPH)!;
const IDENTITY: AnalysisRunFactIdentity = Object.freeze({
  scenario_id: 'scenario-a',
  graph_hash_at_run: SHORT,
  computed_at: '2026-09-06T20:00:00.000Z',
});
// These names are fixture values, not declarations of supported product policy.
const POLICY: AnalysisInterpretationPolicy = Object.freeze({
  contract_version: 'fixture-contract-a',
  policy_version: 'fixture-policy-a',
});
const BINDING: AnalysisInterpretationBinding = Object.freeze({ run_fact: IDENTITY, ...POLICY });

describe('scenario-scoped run-fact identity', () => {
  it('preserves two distinct same-graph runs from the untruncated persisted-facts capture', () => {
    // Minimal binding projection, not a synthetic timestamp or a browser test.
    // Programme docs commit a831f631174dd515c052ed4f9aea249f2b2719f2:
    // artefacts/founder-evidence-2026-09-06/wire-variant/
    // variant-CEE-78aa1ef-UI-11b995d9-20260906T1748Z.persisted-facts.json
    // SHA-256: 70496dd01907a10f84a723c590738d453dc17d54bc65eb43c3a38d3e3c073f17
    // Scenario is the capture envelope's scope; the projected run_facts rows
    // themselves carry the two hash/time values below. No transcript is copied.
    const captured = {
      scenario_id: '5fca0326-e5aa-43ad-9fe3-a1772ab689e2',
      graph_hash_at_run: '06bbc717bbf85867',
      computed_at: '2026-09-06T17:50:03.871Z',
    };
    expect(validateAnalysisRunFactIdentity(captured)).toEqual({ status: 'confirmed', identity: captured });
    expect(compareAnalysisRunFactIdentity(captured, {
      ...captured, computed_at: '2026-09-06T17:50:11.035Z',
    })).toEqual({ status: 'mismatch', reason: 'computed_at_conflict' });
  });

  it('accepts the canonical producer tuple without rewriting it', () => {
    expect(SHORT).toMatch(/^[0-9a-f]{16}$/);
    expect(FULL).toMatch(/^[0-9a-f]{64}$/);
    expect(SHORT).toBe(FULL.slice(0, 16));
    const result = validateAnalysisRunFactIdentity(IDENTITY);
    expect(result).toEqual({ status: 'confirmed', identity: IDENTITY });
    if (result.status === 'confirmed') expect(result.identity).not.toBe(IDENTITY);
  });

  it.each([undefined, null, [], 'not an identity'])('does not confirm absent or invalid identity %j', (input) => {
    expect(validateAnalysisRunFactIdentity(input)).toEqual({ status: 'unconfirmed', reason: 'missing_identity' });
  });

  it.each(['scenario_id', 'graph_hash_at_run', 'computed_at'] as const)('rejects a missing %s', (field) => {
    expect(validateAnalysisRunFactIdentity({ ...IDENTITY, [field]: undefined })).toEqual({
      status: 'unconfirmed', reason: 'missing_identity_field', field,
    });
  });

  it.each(['scenario_id', 'graph_hash_at_run', 'computed_at'] as const)('does not trim or coerce %s', (field) => {
    for (const value of [' ', ` ${IDENTITY[field]}`, 123, {}]) {
      expect(validateAnalysisRunFactIdentity({ ...IDENTITY, [field]: value })).toEqual({
        status: 'unconfirmed', reason: 'invalid_identity_field', field,
      });
    }
  });

  it.each([
    ['same scenario, changed graph', { graph_hash_at_run: OTHER_SHORT }, 'graph_hash_at_run_conflict'],
    ['different scenario, same graph and time', { scenario_id: 'scenario-b' }, 'scenario_id_conflict'],
    ['same-graph rerun one millisecond later', { computed_at: '2026-09-06T20:00:00.001Z' }, 'computed_at_conflict'],
  ])('distinguishes %s', (_name, change, reason) => {
    expect(compareAnalysisRunFactIdentity(IDENTITY, { ...IDENTITY, ...change })).toEqual({ status: 'mismatch', reason });
  });

  it('matches a repeated fact but leaves retry/execution identity unconfirmed', () => {
    const original = { ...IDENTITY, request_id: 'request-a', summary: 'original output' };
    const ambiguousRetry = { ...IDENTITY, request_id: 'request-b', summary: 'different output' };
    expect(compareAnalysisRunFactIdentity(original, ambiguousRetry)).toEqual({
      status: 'match', reason: 'same_run_fact_binding', identity: IDENTITY, execution_identity: 'unconfirmed',
    });
    // This is only binding equality. A caller cannot deduplicate executions or
    // resolve conflicting payloads using this tuple comparison.
  });

  it('does not treat a retry with a missing timestamp as the same fact', () => {
    expect(compareAnalysisRunFactIdentity(IDENTITY, { ...IDENTITY, computed_at: undefined })).toEqual({
      status: 'unconfirmed', reason: 'missing_identity_field', field: 'computed_at', side: 'right',
    });
    expect(compareAnalysisRunFactIdentity(undefined, IDENTITY)).toEqual({
      status: 'unconfirmed', reason: 'missing_identity', side: 'left',
    });
  });

  it.each([
    ['same projection, full representation', FULL],
    ['conflicting full hash', OTHER_FULL],
    ['same prefix, conflicting full suffix', `${FULL.slice(0, -1)}${FULL.endsWith('0') ? '1' : '0'}`],
    ['unrelated scenario graph identity', computeGraphIdentityHash(GRAPH)!.value],
    ['uppercase token', SHORT.toUpperCase()],
    ['partial prefix', SHORT.slice(0, 8)],
    ['opaque legacy marker', 'h_run'],
  ])('explicitly rejects %s instead of guessing a full/short bridge', (_name, hash) => {
    expect(compareAnalysisRunFactIdentity(IDENTITY, { ...IDENTITY, graph_hash_at_run: hash })).toEqual({
      status: 'unconfirmed', reason: 'unsupported_hash_representation', field: 'graph_hash_at_run', side: 'right',
    });
  });

  it.each([
    'not-a-date', '2026-02-30T20:00:00.000Z', '2026-09-06',
    '2026-09-06T20:00:00Z', '2026-09-06T22:00:00.000+02:00',
    '2026-09-06T20:00:00.0001Z',
  ])('does not repair, round or restamp a timestamp: %s', (computed_at) => {
    expect(validateAnalysisRunFactIdentity({ ...IDENTITY, computed_at })).toEqual({
      status: 'unconfirmed', reason: 'unsupported_timestamp_representation', field: 'computed_at',
    });
  });

  it('keeps historical binding when the real freshness derivation reports a changed current graph', () => {
    const fact = {
      fact_type: 'run_analysis', fact_version: 1, noop: false,
      result: { ...IDENTITY, enrichment: { analysis_status: 'completed' } },
    } as HandlerFact;
    expect(deriveAnalysisFreshness([fact], SHORT).freshness).toBe('fresh');
    expect(deriveAnalysisFreshness([fact], OTHER_SHORT)).toMatchObject({
      freshness: 'stale', reason: 'graph_hash_diverged',
      graph_hash_at_run: SHORT, computed_at: IDENTITY.computed_at,
    });
    const restored = JSON.parse(JSON.stringify(BINDING));
    expect(compareAnalysisInterpretationBinding(BINDING, restored, [POLICY])).toMatchObject({
      status: 'match', reason: 'same_interpretation_binding', identity: IDENTITY,
    });
    expect(fact.result).toMatchObject(IDENTITY);
    expect(BINDING.run_fact).toBe(IDENTITY);
  });
});

describe('explicit interpretation policy binding', () => {
  it('requires the same caller-supported contract and policy pair', () => {
    expect(compareAnalysisInterpretationBinding(BINDING, BINDING, [POLICY])).toEqual({
      status: 'match', reason: 'same_interpretation_binding', identity: IDENTITY,
      execution_identity: 'unconfirmed', policy: POLICY,
    });
  });

  it.each(['contract_version', 'policy_version'] as const)('rejects absent, empty and invalid %s', (field) => {
    for (const value of [undefined, null, '']) {
      expect(compareAnalysisInterpretationBinding(BINDING, { ...BINDING, [field]: value }, [POLICY])).toEqual({
        status: 'unconfirmed', reason: 'missing_policy_binding', field, side: 'right',
      });
    }
    for (const value of [1, ' ', ` ${POLICY[field]}`]) {
      expect(compareAnalysisInterpretationBinding({ ...BINDING, [field]: value }, BINDING, [POLICY])).toEqual({
        status: 'unconfirmed', reason: 'invalid_policy_binding', field, side: 'left',
      });
    }
  });

  it('does not infer support from equal versions or an empty supported list', () => {
    expect(compareAnalysisInterpretationBinding(BINDING, BINDING, [])).toEqual({
      status: 'unconfirmed', reason: 'unsupported_policy_binding', side: 'left',
    });
    expect(compareAnalysisInterpretationBinding(BINDING, { ...BINDING, policy_version: 'unknown' }, [POLICY])).toEqual({
      status: 'unconfirmed', reason: 'unsupported_policy_binding', side: 'right',
    });
  });

  it.each(['contract_version', 'policy_version'] as const)('distinguishes supported but different %s', (field) => {
    const changed = { ...POLICY, [field]: 'fixture-other' };
    expect(compareAnalysisInterpretationBinding(BINDING, { ...BINDING, ...changed }, [POLICY, changed])).toEqual({
      status: 'mismatch', reason: `${field}_conflict`,
    });
  });

  it('supports pairs, not independently mixable contract and policy allowlists', () => {
    expect(compareAnalysisInterpretationBinding(BINDING, BINDING, [
      { ...POLICY, policy_version: 'fixture-other' },
      { ...POLICY, contract_version: 'fixture-other' },
    ])).toEqual({ status: 'unconfirmed', reason: 'unsupported_policy_binding', side: 'left' });
  });

  it('does not let a valid policy rescue an absent or wrong-scenario run binding', () => {
    expect(compareAnalysisInterpretationBinding(BINDING, POLICY, [POLICY])).toEqual({
      status: 'unconfirmed', reason: 'missing_identity', side: 'right',
    });
    expect(compareAnalysisInterpretationBinding(BINDING, {
      ...BINDING, run_fact: { ...IDENTITY, scenario_id: 'scenario-b' },
    }, [POLICY])).toEqual({ status: 'mismatch', reason: 'scenario_id_conflict' });
  });
});
