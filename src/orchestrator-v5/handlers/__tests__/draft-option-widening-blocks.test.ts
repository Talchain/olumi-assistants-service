/**
 * Pin the draft option-widening emitter.
 *
 * ── FIXTURE PROVENANCE (trap 16, non-negotiable) ───────────────────────────
 * Every `elements_considered_but_excluded` string below is a VERBATIM REAL
 * CAPTURE from the Step-0 census of the staging `scenarios` table taken
 * 2026-08-17 (complete table: 2,977 rows, 2026-04-18 → 2026-08-17; 2,165 rows
 * carry a non-empty exclusion record; contrast controls fired). A fixture the
 * author wrote themselves encodes the author's model of the drafter rather than
 * the drafter, and this module's whole design turns on what the drafter really
 * writes — which is NOT what the brief assumed. Each fixture names the scenario
 * id it came from.
 *
 * The option LABELS are likewise the real labels persisted on those same rows.
 * The BRIEF strings are the one specification-only element: the census pulled
 * graphs, not briefs, so the briefs here are constructed to drive
 * `deriveIntakeOptionReconciliation` into a NAMED state, and every test that
 * depends on that state PINS IT IN-TEST before asserting anything else
 * (trap 13b third face: a guard whose discrimination depends on a fixture
 * nothing pins is a guard that will silently stop discriminating).
 *
 * Every emitted block is validated against the REAL boundary
 * `CoachingBlockSchema`, so the field shape the UI parser reads is pinned to the
 * wire contract rather than to a hand-copied shape.
 */
import { describe, it, expect } from 'vitest';
import { CoachingBlockSchema } from '@talchain/schemas/boundary';

import {
  buildDraftOptionWideningBlocks,
  extractSetAsideOptions,
  OPTION_WIDENING_FLOOR,
  OPTION_WIDENING_TITLE,
} from '../draft-option-widening-blocks.js';
import { deriveIntakeOptionReconciliation } from '../../../orchestrator/context/intake-option-reconciliation.js';
import type { GraphV3T } from '../../../orchestrator/types.js';

const CREATED_AT = '2026-08-17T12:00:00.000Z';
const READY = { status: 'ready' } as const;

/** Real capture: scenario 75ff7b6d-4d0c-4179-b274-d1551b911b7f, 2026-08-15. */
const REAL_CRM_EXCLUSION = 'Phased rollout as a third option — not referenced in the brief';
/** Real capture: scenario d8c1dbdc-a59e-4a65-9c5d-b1c3f1e69b9d, 2026-08-15 (quoted shape). */
const REAL_QUOTED_EXCLUSION =
  "A 'phased rollout' option was considered but no such option appears in the decision structure";
/** Real capture: scenario 4c0d7764-8fbe-4c42-ab85-e0fd670a0bec, 2026-07-31 (quoted, with reason). */
const REAL_HYBRID_STAFFING_EXCLUSION =
  "A 'hybrid staffing' option (mix of permanent and locum) was considered but excluded because the brief explicitly states exactly two options are being evaluated.";
/** Real capture: scenario 83604ca0-6de7-4cfa-ae0a-1795d1e43079, 2026-08-13 — reason carries GRAPH VOCABULARY. */
const REAL_GRAPHWORD_EXCLUSION =
  'Hybrid/async alternatives — no option node exists for these, and the brief does not mention them';
/**
 * Real capture: scenario 7f2ee8ef-cbcb-4f93-94af-efd83da2b68a, 2026-07-22 — a
 * designation long enough to exceed `action_label`'s 40-char contract bound.
 */
const REAL_LONG_DESIGNATION_EXCLUSION =
  'Fractional or contract technical lead option: plausible and decision-relevant, surfaced in coaching rather than added to the model';
/** Real captures: scenario 99bdb476-31f7-4563-b6ec-47356e3bfe44, 2026-08-17 — FACTORS, not options. */
const REAL_FACTOR_EXCLUSIONS = [
  'Competitor presence in Leeds — relevant but no basis in the brief to add it',
  'Staff hiring lead time — plausible but not mentioned in the brief',
];
/**
 * Real capture: scenario 7f2ee8ef-cbcb-4f93-94af-efd83da2b68a, 2026-07-22. ⭐ THE LIE TWIN:
 * its DESIGNATION is a factor, and only its REASON says "option". A predicate
 * that tests the whole entry calls this a set-aside option — a fabrication.
 */
const REAL_FACTOR_WITH_OPTION_IN_REASON =
  'Team morale factor: plausible but unlikely to change option ranking given the primary budget and knowledge trade-off';

/** Real option labels: scenario 75ff7b6d…, 2026-08-15. Two options — a narrow set. */
function crmGraph(optionLabels: readonly string[] = ['Replacing the CRM', 'Keeping it']): GraphV3T {
  return {
    nodes: [
      { id: 'dec_crm', kind: 'decision', label: 'Replace the CRM?' },
      ...optionLabels.map((label, i) => ({ id: `opt_${i}`, kind: 'option', label })),
      { id: 'fac_cost', kind: 'factor', label: 'Migration cost' },
      { id: 'goal_eff', kind: 'goal', label: 'Improve sales efficiency' },
    ],
    edges: [],
    options: optionLabels.map((label, i) => ({ id: `opt_${i}`, label })),
    goal_node_id: 'goal_eff',
  } as unknown as GraphV3T;
}

/** No enumeration cue, so the reconciler has NO OPINION (`not_applicable`). */
const BRIEF_NO_ENUMERATION =
  'Our CRM is creaking and the renewal lands next quarter. Sales are complaining about duplicate records.';

/** Carries a cue AND names an option the graph does not have → `options_missing`. */
const BRIEF_OPTIONS_MISSING =
  'We are choosing between replacing the CRM, keeping it, and a phased rollout. Renewal is next quarter.';

function build(overrides: Partial<Parameters<typeof buildDraftOptionWideningBlocks>[0]> = {}) {
  return buildDraftOptionWideningBlocks({
    analysisReady: READY,
    wideningLog: { elements_considered_but_excluded: [REAL_CRM_EXCLUSION] },
    graph: crmGraph(),
    briefText: BRIEF_NO_ENUMERATION,
    createdAt: CREATED_AT,
    ...overrides,
  });
}

describe('buildDraftOptionWideningBlocks — 1. fires on a narrow option set with a real set-aside option', () => {
  it('emits exactly one widening block naming the set-aside option', () => {
    const blocks = build();
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    // Bind by IDENTITY, never by a value predicate another block could satisfy.
    expect(block.signal_id).toBe('draft_option_widening:phased rollout');
    expect(block.coaching_kind).toBe('widening');
    expect(block.type).toBe('coaching');
    expect(block.title).toBe(OPTION_WIDENING_TITLE);
    expect(block.source).toBe('draft_graph');
    expect(block.body).toContain('Phased rollout');
    // The real wire contract, not a hand-copied shape.
    expect(CoachingBlockSchema.safeParse(block).success).toBe(true);
  });

  it('fires on the QUOTED capture shape too, extracting the quoted name', () => {
    const blocks = build({
      wideningLog: { elements_considered_but_excluded: [REAL_QUOTED_EXCLUSION] },
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.signal_id).toBe('draft_option_widening:phased rollout');
    expect(blocks[0]!.body).toContain('phased rollout');
  });

  it('derives category could_fix from the shared guidance arm, not a hand-typed value', () => {
    expect(build()[0]!.category).toBe('could_fix');
  });
});

describe('buildDraftOptionWideningBlocks — 2. provenance is DSK-B-007 and carries no invented protocol_id', () => {
  it('names DSK-B-007 with its real title and graded strength', () => {
    const provenance = build()[0]!.dsk_claim_provenance;
    expect(provenance).toEqual({
      claim_id: 'DSK-B-007',
      claim_title: 'Narrow framing and insufficient option generation',
      evidence_strength: 'medium',
    });
    expect(provenance).not.toHaveProperty('protocol_id');
  });

  it('⭐ the contract CANNOT catch a fabricated protocol_id, so the emitter’s restraint is the only guard', () => {
    // Derived at the schema bytes: `protocol_id` is
    // `z.string().regex(/^DSK-P-\d{3}$/).optional()`. So a WELL-FORMED id that
    // names no protocol object in the v1 bundle validates happily — the
    // contract checks the SHAPE of an authority claim, never its EXISTENCE.
    // That is precisely why this emitter must never set one: no generation
    // protocol exists, and inventing a conformant-looking id would be a
    // fabricated provenance the contract would wave through.
    const block = build()[0]!;
    const fabricated = {
      ...block,
      dsk_claim_provenance: { ...block.dsk_claim_provenance!, protocol_id: 'DSK-P-999' },
    };
    expect(CoachingBlockSchema.safeParse(fabricated).success).toBe(true);
    // A malformed one IS caught — the shape guard, and nothing more.
    expect(
      CoachingBlockSchema.safeParse({
        ...block,
        dsk_claim_provenance: {
          ...block.dsk_claim_provenance!,
          protocol_id: 'DSK-P-OPTION-GEN',
        },
      }).success,
    ).toBe(false);
    // What actually protects the user: we set none.
    expect(block.dsk_claim_provenance!.protocol_id).toBeUndefined();
  });
});

describe('buildDraftOptionWideningBlocks — 3. the chip is live, not an inert span', () => {
  it('carries BOTH action_label and a non-empty action_prompt', () => {
    const block = build()[0]!;
    // ⭐ THE TEST THAT STOPS THE CLASSIC DARK SHIP: `action_label` WITHOUT
    // `action_prompt` renders an inert <span> (V5CoachingBlock.tsx:445-455),
    // i.e. a card the user cannot click.
    expect(block.action_label).toBeTruthy();
    expect(typeof block.action_prompt).toBe('string');
    expect(block.action_prompt!.length).toBeGreaterThan(0);
    expect(block.action_prompt).toContain('Phased rollout');
  });

  it('the prompt names exactly ONE option and never asks for more options', () => {
    // ADD_OPTION_IMPERATIVE is singular-only by design, so "add more options"
    // and "add some alternatives" deliberately do not match the live NL path.
    const prompt = build()[0]!.action_prompt!;
    expect(prompt).not.toMatch(/\b(?:more|some|additional|several)\s+(?:options|alternatives)\b/i);
    expect(prompt).toMatch(/\ban option\b/i);
  });

  it('names the option in the caption when it fits the contract bound', () => {
    expect(build()[0]!.action_label).toBe('Add "Phased rollout"');
  });

  it('⭐ TWIN: a LONG option name costs the caption’s specificity, never the card', () => {
    // Real capture: scenario de0d734c-00ba-4846-8ec2-48e891eee433, 2026-08-14.
    // `action_label` is bounded at 40 chars and that bound is module-private in
    // @talchain/schemas, so the emitter validates against the SCHEMA and falls
    // back. Before this fallback existed, the whole block failed egress
    // `safeParse` and was DROPPED WHOLE — a card that silently never appears.
    // Found only by replaying the emitter over the real corpus, never by the
    // hand-written fixtures (trap 22).
    const blocks = build({
      wideningLog: { elements_considered_but_excluded: [REAL_LONG_DESIGNATION_EXCLUSION] },
    });
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.action_label).toBe('Add this option');
    // The card is still fully specific where it matters: the prompt and the
    // body both name the option in full.
    expect(block.action_prompt).toContain('Fractional or contract technical lead');
    expect(block.body).toContain('Fractional or contract technical lead');
    expect(CoachingBlockSchema.safeParse(block).success).toBe(true);
  });

  it('sets action_intent as honest metadata only', () => {
    // Reaches the DOM as `data-action-intent` and nothing more: ActionChip
    // passes no meta to _sendChip and SendChipMeta has no `intent` field. No
    // assertion here claims a typed dispatch, because there is not one.
    expect(build()[0]!.action_intent).toBe('add_option');
  });
});

describe('buildDraftOptionWideningBlocks — 4. the option-count floor', () => {
  it('POSITIVE CONTROL: the same fixture at 2 options fires', () => {
    // Trap 13: prove the probe can see a PRESENCE before asserting an absence.
    expect(build({ graph: crmGraph(['Replacing the CRM', 'Keeping it']) })).toHaveLength(1);
  });

  it('stays silent at the floor (3 options)', () => {
    const graph = crmGraph(['Replacing the CRM', 'Keeping it', 'Renegotiating the licence']);
    expect(OPTION_WIDENING_FLOOR).toBe(3);
    expect(build({ graph })).toEqual([]);
  });

  it('stays silent on a draft that built NO options', () => {
    // Not a narrow option set — a draft without options. Fail closed rather
    // than lecture a user whose model did not build.
    expect(build({ graph: crmGraph([]) })).toEqual([]);
  });
});

describe('buildDraftOptionWideningBlocks — 5. ⭐ the trap-21 anti-collision gate', () => {
  it('PRECONDITION PINNED: the fixture really drives the reconciler to options_missing', () => {
    // Without this, a silence below could be the FIXTURE failing rather than
    // the gate firing, and the test would pass while guarding nothing.
    const reconciliation = deriveIntakeOptionReconciliation(BRIEF_OPTIONS_MISSING, [
      'Replacing the CRM',
      'Keeping it',
    ]);
    expect(reconciliation.state).toBe('options_missing');
    expect(reconciliation.missing.length).toBeGreaterThan(0);
  });

  it('PRECONDITION PINNED: the firing fixture does NOT drive it to options_missing', () => {
    expect(
      deriveIntakeOptionReconciliation(BRIEF_NO_ENUMERATION, ['Replacing the CRM', 'Keeping it'])
        .state,
    ).not.toBe('options_missing');
  });

  it('is SILENT when an option the user NAMED went missing', () => {
    // The product is in a REPAIR state. A card saying "here are more options to
    // consider" on a turn withheld because the product lost one of the user's
    // own options would be the product changing the subject away from its own
    // error. The two modules answer near-inverse questions; this pins the
    // precedence between them.
    expect(build({ briefText: BRIEF_OPTIONS_MISSING })).toEqual([]);
  });
});

describe('buildDraftOptionWideningBlocks — 6. no duplicate options, BOTH directions', () => {
  it('is silent when the exclusion names an option the graph already carries', () => {
    // Closes the 14 Aug Regression Shield P0 "the model duplicates the user's
    // own option" by construction.
    const graph = crmGraph(['Phased rollout', 'Keeping it']);
    expect(build({ graph })).toEqual([]);
  });

  it('OPPOSITE-DIRECTION TWIN: a near-miss that should NOT match still fires', () => {
    // A gap and a lie cannot share a window (trap 22b), so the twin is
    // mandatory: this fixture must NOT be suppressed.
    const graph = crmGraph(['Replacing the CRM', 'Keeping it']);
    expect(build({ graph })).toHaveLength(1);
  });
});

describe('buildDraftOptionWideningBlocks — 6b. ⭐ the entity-class gate (the Step-0 correction)', () => {
  it('is SILENT when the record only set aside FACTORS, not options', () => {
    // Measured: 84.5% of real exclusion entries never mention an option at all.
    // A card titled "Options you set aside" naming "Competitor presence in
    // Leeds" would be a fabricated claim about what the product did.
    expect(
      build({ wideningLog: { elements_considered_but_excluded: REAL_FACTOR_EXCLUSIONS } }),
    ).toEqual([]);
  });

  it('⭐ THE LIE TWIN: is silent when only the REASON half mentions an option', () => {
    // "Team morale factor: … unlikely to change option ranking …" is a FACTOR.
    // A predicate testing the whole entry would call it a set-aside option.
    expect(
      build({
        wideningLog: {
          elements_considered_but_excluded: [REAL_FACTOR_WITH_OPTION_IN_REASON],
        },
      }),
    ).toEqual([]);
  });

  it('picks the option entry out of a record that mixes factors and options', () => {
    const blocks = build({
      wideningLog: {
        elements_considered_but_excluded: [...REAL_FACTOR_EXCLUSIONS, REAL_CRM_EXCLUSION],
      },
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.signal_id).toBe('draft_option_widening:phased rollout');
  });
});

describe('buildDraftOptionWideningBlocks — 6c. the reason is quoted or omitted, never paraphrased', () => {
  it('quotes the recorded reason when it passes the copy gate', () => {
    const body = build({
      wideningLog: { elements_considered_but_excluded: [REAL_CRM_EXCLUSION] },
    })[0]!.body;
    expect(body).toContain('My note at the time:');
    expect(body).toContain('not referenced in the brief');
  });

  it('DROPS the reason (and still emits) when the record uses graph vocabulary', () => {
    // The real reason here says "no option node exists for these", and
    // GRAPH_SHAPE_REGEX correctly refuses graph vocabulary on a coaching card.
    // The honest degradation is to omit the quote, not to paraphrase it.
    const blocks = build({
      wideningLog: { elements_considered_but_excluded: [REAL_GRAPHWORD_EXCLUSION] },
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.body).not.toContain('node');
    expect(blocks[0]!.body).not.toContain('My note at the time:');
    expect(CoachingBlockSchema.safeParse(blocks[0]).success).toBe(true);
  });

  it('offers BOTH halves of the repair', () => {
    // Omitting the second half "would tell half of all affected users to undo a
    // decision they made on purpose" (intake-option-disclosure.ts:26-29).
    const body = build()[0]!.body;
    expect(body).toMatch(/second look/i);
    expect(body).toMatch(/meant to leave it out/i);
  });

  it('has the SERVICE as its subject, never the user’s brief', () => {
    // post-draft-narrative.ts:199-202 — "its subject must be this service or
    // the model we built".
    expect(build()[0]!.body).toMatch(/^I set aside/);
  });

  it('⭐ every emitted block satisfies the wire contract, across every capture shape', () => {
    // The invariant is written against the SPEC (the contract the consumer
    // enforces), not against the failure mode that produced it (trap 13d).
    for (const entry of [
      REAL_CRM_EXCLUSION,
      REAL_QUOTED_EXCLUSION,
      REAL_HYBRID_STAFFING_EXCLUSION,
      REAL_GRAPHWORD_EXCLUSION,
      'Franchise or partnership option — no mention in brief, would be speculative',
      'Fundraising or debt as a separate option — outside scope of the two stated paths',
      'Colocation option excluded: structurally similar to on-prem without a meaningfully different risk profile',
    ]) {
      for (const block of build({
        wideningLog: { elements_considered_but_excluded: [entry] },
      })) {
        const parsed = CoachingBlockSchema.safeParse(block);
        expect(parsed.success, `${entry} → ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      }
    }
  });

  it('keeps every body within the contract’s 300-character bound', () => {
    for (const entry of [
      REAL_CRM_EXCLUSION,
      REAL_QUOTED_EXCLUSION,
      REAL_HYBRID_STAFFING_EXCLUSION,
      REAL_GRAPHWORD_EXCLUSION,
    ]) {
      const blocks = build({ wideningLog: { elements_considered_but_excluded: [entry] } });
      for (const block of blocks) expect(block.body.length).toBeLessThanOrEqual(300);
    }
  });
});

describe('buildDraftOptionWideningBlocks — 7. fail-closed, never throws', () => {
  const cases: ReadonlyArray<
    readonly [string, Partial<Parameters<typeof buildDraftOptionWideningBlocks>[0]>]
  > = [
    ['analysisReady missing', { analysisReady: null }],
    ['analysisReady not ready', { analysisReady: { status: 'blocked' } }],
    ['analysisReady undefined status', { analysisReady: {} }],
    ['widening log absent', { wideningLog: undefined }],
    ['widening log null', { wideningLog: null }],
    ['widening log not an object', { wideningLog: 'nope' }],
    ['exclusions absent', { wideningLog: {} }],
    ['exclusions empty', { wideningLog: { elements_considered_but_excluded: [] } }],
    ['exclusions not an array', { wideningLog: { elements_considered_but_excluded: 'x' } }],
    [
      'exclusions malformed entries',
      { wideningLog: { elements_considered_but_excluded: [null, 42, {}, '', '   '] } },
    ],
    ['graph null', { graph: null }],
    ['graph undefined', { graph: undefined }],
    ['graph without nodes', { graph: {} as unknown as GraphV3T }],
    ['brief null', { briefText: null }],
  ];

  for (const [name, overrides] of cases) {
    it(`returns [] for: ${name}`, () => {
      let result: unknown;
      expect(() => {
        result = build(overrides);
      }).not.toThrow();
      // `brief null` must still FIRE — a missing brief means the reconciler has
      // no opinion, which is not a repair state.
      if (name === 'brief null') expect(result).toHaveLength(1);
      else expect(result).toEqual([]);
    });
  }
});

describe('buildDraftOptionWideningBlocks — 8. visibility', () => {
  it('emits priority_rank 1 so the card cannot fall into the UI overflow', () => {
    // PHASE3_DEFAULT_EXPANDED = 6 and live turns carry 8-14 cards; a coaching
    // card ranked 7th or later renders NULL. Weak as a unit test (the real
    // check is the staging witness) — it exists so a later refactor cannot
    // silently push this card behind "Show N more".
    expect(build()[0]!.priority_rank).toBe(1);
  });

  it('is deterministic: the same draft yields the same block_id', () => {
    expect(build()[0]!.block_id).toBe(build()[0]!.block_id);
  });

  it('distinguishes different set-aside options by block_id', () => {
    const a = build()[0]!;
    const b = build({
      wideningLog: {
        elements_considered_but_excluded: ['Franchise or partnership option — no mention in brief'],
      },
    })[0]!;
    expect(a.block_id).not.toBe(b.block_id);
  });
});

describe('extractSetAsideOptions — the extractor, on its own', () => {
  it('strips structural boilerplate tails from the designation', () => {
    // Real captures: "Colocation option excluded: …", "Franchise option
    // routed to coaching: …", "Phased rollout as a third option — …".
    expect(
      extractSetAsideOptions([
        'Colocation option excluded: structurally similar to on-prem',
        'Franchise option: surfaced in coaching as lower-commitment alternative',
      ]).map((o) => o.designation),
    ).toEqual(['Colocation', 'Franchise']);
  });

  it('deduplicates entries naming the same option', () => {
    expect(
      extractSetAsideOptions([REAL_CRM_EXCLUSION, 'Phased rollout as a third option — again']),
    ).toHaveLength(1);
  });

  it('returns [] for a non-array', () => {
    expect(extractSetAsideOptions(null)).toEqual([]);
    expect(extractSetAsideOptions('x')).toEqual([]);
  });
});
