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
    //
    // 0.58.0 → 0.59.0 (`goal_target_edit`, the structured success-target edit),
    // RE-DERIVED on 25 Sep against the PUBLISHED registry tarball (sha1
    // `4c22e40f…`, gitHead `195b64c4`, the schemas #67 merge), not the earlier
    // local pack. Both published tarballs unpacked; every `dist` file that
    // mentions `edge_strength_edit` compared, leading whitespace stripped, LOST
    // and NEW in the same run:
    //   the FILE SET is identical (the same five files);
    //   enums.js 3 → 3, turn-payload.d.ts 19 → 19, turn-payload.js 11 → 11,
    //   fixtures/index.js 3 → 3: ZERO lost, ZERO new;
    //   enums.d.ts 1 → 1, and the one line DIFFERS — the `SystemEventKind`
    //   literal. Proven APPEND-ONLY by STRING EQUALITY: 0.58's literal with
    //   `, "goal_target_edit"` inserted after `"finding_dissent"` EQUALS 0.59's.
    // Controls: POSITIVE — `package.json` differs between the tarballs, so the
    // comparator sees a change; NEGATIVE — the same insertion after
    // `"feedback"` (present in 0.58) does NOT equal 0.59's literal.
    //
    // 0.59.0 → 0.60.0 (schemas #68, gitHead `2a451c7e`), RE-DERIVED on 27 Sep
    // against the PUBLISHED registry tarball (sha1 `e30caa38…`). THIS BUMP DOES
    // TOUCH THE MEMBER, and the line comparator above is BLIND to it, so it is
    // recorded rather than inferred from a zero:
    //   the line comparator (dist lines naming `edge_strength_edit`): the FILE
    //   SET is identical (the same five files) and every file is ZERO lost,
    //   ZERO new — but `band` sits on its own line, which never names the kind;
    //   a FULL diff of `dist/boundary/turn-payload.js` has ZERO removed lines
    //   and exactly two added CODE lines — `import { StrengthBand }` and
    //   `band: StrengthBand.optional(),` inside the strict member; the `.d.ts`
    //   diff likewise has ZERO removed lines (it adds `band?:` only);
    //   `SystemEventKind` (enums.d.ts / enums.js) is unchanged — no new kind;
    //   the producer fixture gains `band: 'very_strong'` (maximality).
    // So the member gains ONE OPTIONAL key and nothing else: every field, the
    // intent/direction vocabularies and the root superRefine this suite
    // exercises are unchanged, and every pre-0.60.0 event still parses.
    // The pin bump itself was adoption only; CEE now READS `band` — the band
    // reader (`system-events/edge-strength-edit.ts`, `edge-band-reader.test.ts`).
    //
    // 0.60.0 → 0.61.0 (schemas #69, main `4d039fab`, R1), RE-DERIVED on 28 Sep
    // against the PUBLISHED tarball (sha1 `caba31ec…`): the FILE SET naming
    // `edge_strength_edit` is identical (the same five files); `turn-payload.js`,
    // `enums.js` and `enums.d.ts` are byte-unchanged (so `SystemEventKind` is too);
    // `turn-payload.d.ts` changes 36 removed / 72 added lines, EVERY one a node
    // field inlined 36× (`goal_threshold_frame` gains `change_abs`/`change_rel`,
    // `quantity_frame` is new) and NONE names a strength, band, intent or
    // magnitude; the fixtures add only `quantity_frame` and `frame_verdict`.
    // Control: `package.json` differs between the tarballs. The member is untouched.
    //
    // 0.61.0 → 0.62.0 (schemas #70, main `c9aee435`, Shared Data row 1), RE-DERIVED on 29 Sep against the PUBLISHED
    // tarball (sha1 `da4eee3a…`): the FILE SET naming `edge_strength_edit` is identical (the same six files). Every
    // changed line that names a strength or band is an IMPORT LIST (`turn-payload.js` appends `FactorValueEditIntent`;
    // `fixtures/index.js` appends `ObservedStateReviewSchema`); `turn-payload.d.ts`'s 2441 changed lines name none
    // (they inline `reviewed_by_user` into every node's observed_state). The member, its intents and `band` are untouched.
    //
    // 0.62.0 → 0.63.0 (schemas #71, main `855a53b4`, goal certainty), RE-DERIVED on 29 Sep against the PUBLISHED
    // tarball (sha1 `0089b2c3…`): the FILE SET naming `edge_strength_edit` is identical (the same six files), and no
    // changed line in any changed file names a strength or a band (contrast: `handler-results.js` gains `goal_certainty`).
    //
    // 0.63.0 → 0.64.0 (schemas #73, main `5eb351c7`, node `proposed_by` in the hash vocabulary), RE-DERIVED on 29 Sep
    // against the PUBLISHED tarballs (sha1 `0089b2c3…` → `26500d2b…`): the FILE SET naming `edge_strength_edit` is
    // identical (the same six files), and 0 changed lines name a strength or a band (the diff is the node vocabulary,
    // the generated constants, the adoption manifest and package.json).
    //
    // 0.64.0 → 0.68.0 (schemas #75/#77/#76: TEMPORAL range, unit reading + stable refs, SC-24; tag `v0.68.0`, main
    // `fcdb0952`), RE-DERIVED on 30 Sep against the PUBLISHED tarballs (sha1 `26500d2b…` → `5a401a9a…`): the FILE SET
    // naming `edge_strength_edit` is identical (the same six files); `enums.*` and `turn-payload.js` are byte-unchanged.
    // Of the changed lines, 3 name a strength: an IMPORT LIST in `fixtures/index.js` (appends UnitReading/EntityRef/
    // RefHighWater schemas) and one SC-24 input-row fixture (`field: 'strength'`), neither the member nor its band.
    //
    // 0.68.0 → 0.69.0 (schemas #78, MG F1: semantic node fields, `option_status_edit`, goal_target_edit metadata; main
    // `5b0ca7f5`), RE-DERIVED on 1 Oct against the PUBLISHED tarballs (sha1 `5a401a9a…` → `939f5c9e…`): the FILE SET
    // naming `edge_strength_edit` is identical (the same five dist files). Of the changed lines in them, 2 pairs name a
    // strength: the `SystemEventKind` declaration (appends `option_status_edit` after `goal_target_edit`) and the
    // fixtures IMPORT LIST (appends GoalHorizon/GoalStatedAs/CountNoun schemas) — neither the member nor its band.
    //
    // 0.69.0 → 0.70.0 (schemas #80, F1b: Run snapshot link band/sizing, `sizing` input row, typed empty win shares; main
    // `cace462d`), RE-DERIVED on 1 Oct against the PUBLISHED tarballs (sha1 `939f5c9e…` → `a987224c…`): the FILE SET
    // naming `edge_strength_edit` is identical (the same five dist files); `enums.*` and `turn-payload.*` are
    // byte-unchanged; the one changed file is `fixtures/index.js`, and 0 of its changed lines name a strength.
    //
    // 0.70.0 → 0.71.0 (schemas #81, F1b: Run snapshot `residual_digest` — `complete` means verified; main `56888181`),
    // RE-DERIVED on 1 Oct against the PUBLISHED tarballs (sha1 `a987224c…` → `c783076e…`): the FILE SET naming
    // `edge_strength_edit` is identical and all five files are byte-unchanged; 0 changed dist lines name a strength or a
    // band (contrast: the same diff finds `residual_digest`).
    //
    // 0.71.0 → 0.72.0 (schemas #82, F1b: Run snapshot link `authorship_digest`; main `cd1e868e`), RE-DERIVED on 1 Oct
    // against the PUBLISHED tarballs (sha1 `c783076e…` → `fd389b22…`): the FILE SET naming `edge_strength_edit` is
    // identical and all five files are byte-unchanged; 0 changed dist lines name a strength or a band (contrast: the
    // same diff finds 42 lines naming `authorship_digest`).
    //
    // 0.72.0 → 0.73.0 (schemas #83, F1b: Run snapshot FACTOR `authorship_digest`; main `b447da6f`), RE-DERIVED on 2 Oct
    // against the PUBLISHED tarballs (sha1 `fd389b22…` → `ab0b2c9a…`): the FILE SET naming `edge_strength_edit` is identical and
    // all five files are byte-unchanged; 0 changed dist lines name a strength or a band (contrast: the same diff finds 42
    // lines naming `authorship_digest`).
    //
    // 0.73.0 → 0.75.0 (0.74.0 ModelVersionDiffV2 + 0.75.0 DecisionFlipBlockV1, schemas #85; main `55a72e62`), RE-DERIVED on
    // 2 Oct against the PUBLISHED tarballs (sha1 `ab0b2c9a…` → `b608fb22…`): the FILE SET naming `edge_strength_edit` is
    // identical; four files are byte-unchanged and `dist/fixtures/index.js` differs with 0 changed lines naming it. The
    // 40 changed dist lines naming a strength or a band are MOVED, not changed (each text appears equally often on both
    // sides: 20/20). Contrast: the same diff finds 18 changed lines naming `DecisionFlip`/`decision_flip`.
    // 0.75.0 → 0.76.0 (SCI-DEEP structural challenge), re-derived from the supplied published archives:
    // all four boundary files above are byte-identical; the fixture registry changes, but its edge_strength_edit
    // lines are identical. The existing reader assertions below still exercise the current package.
    // 0.76.0 → 0.77.0 (schemas #88, `stated_relationship_not_used` notice kind; main `b0378e7f`), RE-DERIVED on 5 Oct
    // against the PUBLISHED tarballs (sha1 `57f6764c…` for 0.77.0): the FILE SET naming `edge_strength_edit` is identical;
    // four files are byte-unchanged and `dist/fixtures/index.js` differs; 0 changed dist lines name a strength or a band
    // (contrast: the same diff finds 19 changed lines naming `stated_relationship`).
    // 0.77.0 → 0.78.0 (schemas #89: `natural_effect` + `effect` + `delivered_record`; main `28f4eccc`), RE-DERIVED on
    // 6 Oct against the PUBLISHED tarballs (0.77.0 sha1 `57f6764c…`, 0.78.0 sha1 `29c008b0…`): the FILE SET naming
    // `edge_strength_edit` is identical (5 files); four are byte-unchanged and `dist/fixtures/index.js` differs, with 0
    // changed lines naming `edge_strength_edit`. The 286 changed dist lines naming a strength or a band are inferred type
    // expansions (`RunInputField` with 'effect'; the delivered Phase 3 block types in handler-fact / handler-results /
    // blocks .d.ts) and comments — none in an edge_strength_edit file (contrast: 56 changed lines name `natural_effect`,
    // 14 name `delivered_record`).
    expect(SCHEMA_PACKAGE_VERSION).toBe('0.78.0');
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
      // 0.59.0 appends `goal_target_edit` the same way — proven append-only
      // by string equality at the vendored bytes (see the version pin above).
      'goal_target_edit',
      // 0.69.0 appends `option_status_edit` (MG F1 T6) the same way.
      'option_status_edit',
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
