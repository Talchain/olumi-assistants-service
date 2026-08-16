/**
 * Schema 0.42 reader-first gate for `edge_strength_edit`.
 *
 * CEE's live B1 boundary parses the ROOT `OrchestratorTurnPayloadSchema`, not
 * the bare event union. That distinction is load-bearing: the strict member
 * owns field shape, while the root superRefine owns sign/direction and
 * confirmation coupling. This suite exercises the same root as production.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { SCHEMA_PACKAGE_VERSION } from '@talchain/schemas';
import {
  OrchestratorTurnPayloadSchema,
  SystemEventKind,
  SystemEventSchema,
} from '@talchain/schemas/boundary';

const TURN_ID_BASE = '11111111-1111-4111-8111-1111111111';
const SCENARIO_ID = '22222222-2222-4222-8222-222222222222';

function systemEventTurn(event: Record<string, unknown>, suffix = '99') {
  return {
    kind: 'system_event',
    turn_id: `${TURN_ID_BASE}${suffix}`,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    event,
  };
}

const VALID_SET_EVENT = {
  kind: 'edge_strength_edit',
  from: 'f-demand',
  to: 'g-growth',
  magnitude: 0.7,
  direction_intent: 'preserve',
  expected: { mean: -0.4, effect_direction: 'negative' },
  intent: 'set',
} as const;

describe('schema 0.42 — root edge_strength_edit contract', () => {
  it('is bound to the exact published reader contract', () => {
    // ⚠ THIS PIN MOVES ONLY WITH EVIDENCE, NEVER TO CLEAR A RED. It exists so a
    // schemas bump is a deliberate act that re-examines this reader, and the
    // only honest way to advance it is to show the reader's own bytes did not
    // move — a changelog saying "additive" is a claim, not a measurement.
    //
    // 0.42.0 → 0.44.0 (the conditional_winners train, which also carries the
    // never-vendored 0.43.0). DERIVED by unpacking both tarballs and diffing
    // every `dist` file that mentions `edge_strength_edit` — five of them:
    //   dist/boundary/turn-payload.d.ts   BYTE-IDENTICAL
    //   dist/boundary/turn-payload.js     BYTE-IDENTICAL
    //   dist/boundary/enums.d.ts          BYTE-IDENTICAL
    //   dist/boundary/enums.js            BYTE-IDENTICAL
    //   dist/fixtures/index.js            differs ONLY in line numbers
    //     (1614→1664, 2393→2464); every edge_strength_edit line is textually
    //     identical, shifted by the two conditional-winner fixtures added above
    //     it in the file.
    // So the strict member, the root superRefine, and the intent/direction
    // vocabularies this suite exercises are unchanged across both releases.
    expect(SCHEMA_PACKAGE_VERSION).toBe('0.44.0');
  });

  it('accepts a valid set event through the ROOT payload schema without rewriting it', () => {
    const payload = systemEventTurn({ ...VALID_SET_EVENT });
    const parsed = OrchestratorTurnPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toStrictEqual(payload);
  });

  it('keeps zero-negative direction representable for a confirm-current event', () => {
    const parsed = OrchestratorTurnPayloadSchema.safeParse(
      systemEventTurn({
        ...VALID_SET_EVENT,
        magnitude: 0,
        expected: { mean: 0, effect_direction: 'negative' },
        intent: 'confirm_current',
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it.each([
    ['non-zero sign/direction disagreement', {
      ...VALID_SET_EVENT,
      expected: { mean: 0.4, effect_direction: 'negative' },
    }],
    ['confirm-current magnitude mismatch', {
      ...VALID_SET_EVENT,
      magnitude: 0.6,
      expected: { mean: -0.4, effect_direction: 'negative' },
      intent: 'confirm_current',
    }],
    ['confirm-current direction change', {
      ...VALID_SET_EVENT,
      magnitude: 0.4,
      direction_intent: 'positive',
      intent: 'confirm_current',
    }],
  ])('rejects the contradictory %s at the ROOT refinement', (_label, event) => {
    // The bare member is deliberately refinement-free so it can remain an
    // option in z.discriminatedUnion. This positive control proves the ROOT,
    // rather than a coincidentally strict local copy, supplies the rejection.
    expect(SystemEventSchema.safeParse(event).success).toBe(true);
    expect(OrchestratorTurnPayloadSchema.safeParse(systemEventTurn(event)).success).toBe(false);
  });

  it.each([
    ['std', 0.1],
    ['operator', 'set'],
    ['source', 'user_override'],
    ['provenance', { source: 'user_specified' }],
    ['edge_id', 'reactflow-edge-1'],
    ['graph', { edges: [] }],
  ])('rejects client-authoritative unknown field %s', (field, value) => {
    const parsed = OrchestratorTurnPayloadSchema.safeParse(
      systemEventTurn({ ...VALID_SET_EVENT, [field]: value }),
    );
    expect(parsed.success).toBe(false);
  });

  it.each([
    ['blank from', { ...VALID_SET_EVENT, from: '' }],
    ['untrimmed to', { ...VALID_SET_EVENT, to: ' g-growth' }],
    ['unicode composite from', { ...VALID_SET_EVENT, from: 'f-demand→g-growth' }],
    ['ascii composite to', { ...VALID_SET_EVENT, to: 'f-demand->g-growth' }],
    ['negative magnitude', { ...VALID_SET_EVENT, magnitude: -0.01 }],
    ['above-one magnitude', { ...VALID_SET_EVENT, magnitude: 1.01 }],
    ['missing expected', (({ expected: _expected, ...rest }) => rest)(VALID_SET_EVENT)],
  ])('rejects malformed input: %s', (_label, event) => {
    expect(OrchestratorTurnPayloadSchema.safeParse(systemEventTurn(event)).success).toBe(false);
  });
});

const PRE_042_KINDS = [
  'patch_accepted',
  'patch_dismissed',
  'direct_graph_edit',
  'factor_value_edit',
  'chip_click',
  'undo',
  'redo',
  'selection_change',
  'feedback',
  'edge_adjudication',
  'prior_range_edit',
] as const;

const PRE_042_EVENTS: ReadonlyArray<Record<string, unknown>> = [
  { kind: 'patch_accepted', patch_id: 'patch-1' },
  { kind: 'patch_dismissed', patch_id: 'patch-2' },
  {
    kind: 'direct_graph_edit',
    target_id: 'f-a',
    operation: 'update_value',
    changed_node_ids: ['f-a'],
    changed_edge_ids: ['edge-a-b'],
    operations: ['update_value'],
    fields_changed: ['observed_state.value'],
    summary: 'Updated one value.',
  },
  {
    kind: 'factor_value_edit',
    target_id: 'f-a',
    value: 0.5,
    raw_value: 50,
    unit: '%',
    field: 'value',
  },
  { kind: 'chip_click', chip_id: 'chip-1' },
  { kind: 'undo' },
  { kind: 'redo' },
  {
    kind: 'selection_change',
    selected: [{ id: 'f-a', kind: 'factor' }],
    cleared: false,
  },
  {
    kind: 'feedback',
    rating: 'down',
    comment: 'Needs more evidence.',
    target: { id: 'block-1', kind: 'block' },
  },
  {
    kind: 'edge_adjudication',
    from: 'f-a',
    to: 'g-b',
    edge_id: 'edge-a-b',
    verdict: 'overridden',
    resolved_strength_mean: -0.45,
  },
  {
    kind: 'prior_range_edit',
    target_id: 'f-a',
    range_min: 0.2,
    range_max: 0.8,
    distribution: 'uniform',
  },
];

describe('schema 0.42 — pre-0.42 system-event corpus is byte-compatible', () => {
  it('adds exactly one kind without removing or renaming any 0.41 kind', () => {
    expect(SystemEventKind.options).toEqual([...PRE_042_KINDS, 'edge_strength_edit']);
  });

  it('reproduces the exact serialized 0.41 root-parse corpus', () => {
    const parsed = PRE_042_EVENTS.map((event, index) => {
      const result = OrchestratorTurnPayloadSchema.safeParse(
        systemEventTurn(event, String(index).padStart(2, '0')),
      );
      expect(result.success, `pre-0.42 event ${event.kind} no longer parses`).toBe(true);
      if (!result.success) throw result.error;
      return result.data;
    });

    // Captured by executing this exact corpus against the clean 0.41.0 pin at
    // CEE base b1401025 before the re-vendor. A structural equality check could
    // miss newly injected defaults; hashing the serialized parsed output pins
    // the byte surface old consumers already observe.
    const digest = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
    expect(digest).toBe('3b2eef2fdc1db7ca08a3d14cbb5b4f951d78f90d9644148865ea631d6e8d3f7c');
  });
});
