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
    //
    // 0.44.0 → 0.46.0 (the AnalysisStateV1 train, which also carries the
    // never-vendored 0.45.0 `model_building_notices`). RE-DERIVED THE SAME
    // WAY rather than inherited: both tarballs were unpacked and every `dist`
    // file mentioning `edge_strength_edit` was compared. The FILE SET is
    // identical (five files, same paths) and:
    //   dist/boundary/turn-payload.d.ts   BYTE-IDENTICAL
    //   dist/boundary/turn-payload.js     BYTE-IDENTICAL
    //   dist/boundary/enums.d.ts          BYTE-IDENTICAL
    //   dist/boundary/enums.js            BYTE-IDENTICAL
    //   dist/fixtures/index.js            differs, but every
    //     `edge_strength_edit` line is TEXTUALLY IDENTICAL — the delta is the
    //     twelve AnalysisStateV1 fixtures registered elsewhere in the file.
    // The comparator carries a positive control: `package.json` DOES differ
    // between the two tarballs (the version string), so `cmp` is demonstrably
    // able to see a difference and the four identical verdicts are not a
    // comparator that cannot fail.
    //
    // 0.46.0 → 0.48.0 (the `structural_delete` train, which also carries the
    // never-vendored 0.47.0 AnalysisStateV1 cross-checks). RE-DERIVED THE SAME
    // WAY rather than inherited: both tarballs were unpacked and every `dist`
    // file mentioning `edge_strength_edit` was compared. The FILE SET is
    // identical (the same five files) and, measured symmetrically — line
    // numbers stripped from BOTH sides, no filter applied to one side only:
    //   ZERO of 0.46.0's `edge_strength_edit` lines are lost; every one survives
    //   verbatim in 0.48.0.
    // The five files DO differ, and every difference is accounted for:
    //   enums.d.ts        the SystemEventKind type literal is EXACTLY 0.46's
    //                     list with "structural_delete" APPENDED — proven by
    //                     string equality against a constructed expectation,
    //                     so nothing was removed, renamed or reordered;
    //   turn-payload.js   the three pre-existing lines are textually identical
    //                     and merely shifted (468→475, 478→485, 560→710); the
    //                     four "new" hits are COMMENT lines inside the new
    //                     structural_delete block that mention this member;
    //   enums.js /        every `edge_strength_edit` line textually identical;
    //   turn-payload.d.ts
    //   fixtures/index.js every `edge_strength_edit` line textually identical.
    // The comparator carries the same positive control: `package.json` DOES
    // differ between the two tarballs, so `cmp` is demonstrably able to see a
    // difference and these verdicts are not a comparator that cannot fail.
    // 0.50.0 re-vendor (P0 — model_version_receipt egress skew). The delta from
    // 0.48.0 is ONE commit (there is no 0.49.0) and is additions-only across
    // `src/`: 18 files changed, 2853 insertions, and only SIX removed lines,
    // every one of which was enumerated — an import WIDENED (`GraphV3Schema` →
    // `EffectDirection, GraphV3Schema, NodeKind, NodeV3Schema`), the three
    // generated constants asserted just below, one `.describe()` doc string, and
    // `base_graph_hash: z.string().min(1)` → `CanonicalBaseGraphHashSchema`,
    // which is DEFINED as `z.string().min(1)` (turn-payload.ts:734) — a named
    // constant, byte-identical validation, not a tightening. Nothing removed,
    // nothing renamed (`git diff --name-status -M` reports zero R entries).
    // `src/graph.ts` is byte-identical between the two tags.
    // 0.50.0 → 0.54.0 (`option_intervention_edit`, the per-cell option→factor
    // effect carrier). RE-DERIVED THE SAME WAY rather than inherited: BOTH
    // tarballs were pulled from the registry — 0.50.0 sha1 `ed84e38a…`, 0.54.0
    // sha1 `1281c862…`, each matching the registry's own published shasum — and
    // every `dist` file mentioning `edge_strength_edit` was compared.
    //
    // The FILE SET is identical (the same five files). Measured symmetrically,
    // line numbers stripped from BOTH sides:
    //   turn-payload.d.ts  19 → 19 lines, ZERO lost
    //   turn-payload.js    10 → 11 lines, ZERO lost — the one added hit is a
    //                      COMMENT inside the new member's header (`The
    //                      reasoning is \`edge_strength_edit\`'s, unchanged,
    //                      because the two`), the same shape as the four
    //                      comment hits the 0.48.0 entry above records;
    //   enums.js           3 → 3 lines, ZERO lost;
    //   fixtures/index.js  3 → 3 lines, ZERO lost;
    //   enums.d.ts         1 → 1, and the one line DIFFERS — it is the
    //                      `SystemEventKind` literal. Proven APPEND-ONLY by
    //                      STRING EQUALITY, exactly as the 0.48.0 entry did:
    //                      0.50's literal with `, "option_intervention_edit"`
    //                      inserted after `"structural_rename"` is EQUAL to
    //                      0.54's, so nothing was removed, renamed or
    //                      reordered.
    // Same positive control as its predecessors: `package.json` DOES differ
    // between the two tarballs, so the comparator is demonstrably able to see a
    // difference and these verdicts are not a check that cannot fail.
    //
    // 0.54.0 → 0.55.0 (`finding_dissent`, the Reasoning tab's stated
    // disagreement). RE-DERIVED THE SAME WAY rather than inherited: both
    // vendored tarballs were unpacked — 0.54.0 sha256 `8dffea3a…`, 0.55.0
    // sha256 `ea61d924…`, each matching the `.sha256` its own commit ships —
    // and every `dist` file mentioning `edge_strength_edit` was compared.
    //
    // The FILE SET is identical (the same five files). Measured symmetrically,
    // line numbers stripped from BOTH sides, no filter applied to one side
    // only — reported as LOST-from-0.54.0 and NEW-in-0.55.0 in the same run:
    //   turn-payload.d.ts  19 → 19 lines, ZERO lost, ZERO new
    //   turn-payload.js    11 → 11 lines, ZERO lost, ZERO new
    //   enums.js            3 →  3 lines, ZERO lost, ZERO new
    //   fixtures/index.js   3 →  3 lines, ZERO lost, ZERO new
    //   enums.d.ts          1 →  1, and the one line DIFFERS — it is the
    //                      `SystemEventKind` literal. Proven APPEND-ONLY by
    //                      STRING EQUALITY, exactly as the 0.48.0 and 0.54.0
    //                      entries did: 0.54's literal with `, "finding_dissent"`
    //                      inserted after `"option_intervention_edit"` is EQUAL
    //                      to 0.55's, so nothing was removed, renamed or
    //                      reordered.
    // Two controls, because an equality proof that cannot fail proves nothing:
    //   POSITIVE — `package.json` DOES differ between the two tarballs, so the
    //     comparator is demonstrably able to see a difference and the four
    //     ZERO-lost/ZERO-new verdicts are not a check that cannot fail.
    //   NEGATIVE — the same construction with `finding_dissent` inserted after
    //     `"feedback"` instead does NOT equal 0.55's literal, so the append-only
    //     proof genuinely discriminates POSITION and is not satisfied by any
    //     insertion anywhere.
    // The `HandlerFact` union was compared the same way for the sibling guard:
    // 13 → 14 `fact_type` literals, `finding_dissent` the only addition, none
    // removed.
    //
    // So the strict member, the root superRefine and the intent/direction
    // vocabularies this suite exercises are unchanged across the bump.
    expect(SCHEMA_PACKAGE_VERSION).toBe('0.55.0');
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
  it('adds only APPENDED kinds, without removing or renaming any 0.41 kind', () => {
    // The property under test is unchanged and is the one that matters for a
    // pre-0.42 corpus: every 0.41 kind is still present, still spelled the same,
    // still in the same ORDER, and additions only ever arrive at the end.
    // 0.48.0 appends `structural_delete` (P0 L-22) exactly as 0.42.0 appended
    // `edge_strength_edit`; asserted at the vendored bytes by unpacking 0.46.0
    // and 0.48.0 and proving the enum literal is the former with the new member
    // appended. Asserting the prefix separately from the tail keeps the 0.41
    // guarantee legible instead of burying it in one long literal.
    // 0.50.0 appends the three direct-edit members the same way, and the PREFIX
    // assertion below is the load-bearing half: it passing unchanged is
    // independent evidence that the 0.48.0 → 0.50.0 bump removed and renamed
    // NOTHING in this vocabulary — the additions genuinely arrive at the end.
    expect(SystemEventKind.options.slice(0, PRE_042_KINDS.length)).toEqual([...PRE_042_KINDS]);
    // 0.54.0 appends `option_intervention_edit` the same way, and the PREFIX
    // assertion above passing unchanged is again the independent evidence that
    // the bump removed and renamed NOTHING — the addition arrives at the end.
    // 0.55.0 appends `finding_dissent` the same way. Asserted at the vendored
    // bytes, not inferred from a changelog: 0.54's `SystemEventKind` literal
    // with `, "finding_dissent"` appended after `"option_intervention_edit"` is
    // STRING-EQUAL to 0.55's, and a control insertion mid-list is NOT — so the
    // addition is proven to arrive at the end rather than merely to be present.
    expect(SystemEventKind.options.slice(PRE_042_KINDS.length)).toEqual([
      'edge_strength_edit',
      'structural_delete',
      'structural_add',
      'structural_add_edge',
      'structural_rename',
      'option_intervention_edit',
      'finding_dissent',
    ]);
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
