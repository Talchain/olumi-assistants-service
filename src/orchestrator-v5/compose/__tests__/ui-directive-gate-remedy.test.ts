/**
 * ROADMAP 2.640 / UI-DIRECTIVE-0.38-DESIGN-2026-08-06 §3.4 — THE GATE-CLOSE
 * REMEDY DIRECTIVE. Pillar P3 (AI agency in the workspace).
 *
 * The capability in one sentence: when a user asks why their model will not run
 * and CEE answers deterministically, the assistant ALSO OPENS the section where
 * the blocker is fixed, instead of only describing it.
 *
 * ⚠ THIS IS THE SECOND AUTHORING PATH CEE HAS EVER HAD. Every directive before
 * this row rode a HANDLER FACT and was stamped `source: 'ladder'`. This one
 * rides a QUESTION answered by the post-analysis advice gate and is stamped
 * `source: 'gate'` — an enum value 0.39.0 reserved for exactly this path and
 * that had no producer until now. Several tests below bind on that stamp,
 * because it is what lets a capture tell a gesture that followed an ACTION from
 * one that followed an ENQUIRY.
 *
 * ⚠ WHERE THE EXPECTATIONS COME FROM (trap 13c — a mutant kit measures whether
 * a test can DETECT a change, never whether the EXPECTATION is right; a full
 * kill-rate against a self-authored oracle is a perfect score on the wrong
 * exam). Every mapping expectation below is derived from BOTH producers' bytes
 * and cites them:
 *   - CEE side: `summariseReadiness` (routing/readiness-summary.ts:65–98) and
 *     the option-status doc comment (schemas/analysis-ready.ts:58–64).
 *   - UI side: the five Model-tab sections (ModelTabBody.tsx:780–845) and
 *     `OptionsSection`'s own header, which states it renders "one row per
 *     intervention: Factor label | baseline … → target value (editable)"
 *     (OptionsSection.tsx:2–7).
 * No mapping row is asserted from this lane's reading of what a field "ought
 * to" mean.
 *
 * ⚠ THE UNMAPPED KINDS ARE THE POINT, NOT A GAP. `goal_threshold_missing`
 * has no section to open (there is no goal section among the five), and
 * `option_needs_mapping` is deliberately undecided pending a derivation of
 * where an option→factor connection is actually created; canonical
 * `model_needs_review` is intentionally too broad to name a section. A directive is an
 * implicit claim that the remedy lives where it points, so an unsettled row
 * emits NOTHING and the user still gets the prose. These are pinned as an
 * EXACT known-unmapped set (trap 22f's honest-gap rule): the suite REDs if the
 * set grows OR shrinks, so closing one of them is a deliberate, visible act.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  UiDirectiveBlockSchema,
  type UiDirectiveBlock,
} from '@talchain/schemas/boundary';

import {
  buildGateRemedySectionDirective,
  REMEDY_SECTION_BY_OPEN_ITEM_KIND,
} from '../ui-directive.js';
import { summariseReadiness } from '../../routing/readiness-summary.js';
import type { ReadinessOpenItem } from '../../routing/readiness-summary.js';
import { tryPostAnalysisAdviceGate } from '../../routing/post-analysis-advice-gate.js';
import { composeDirectAnswerResponse } from '../../compose.js';
import { sanitiseOlumiResponseForEgress } from '../output-safety.js';
import { setTestSink } from '../../../utils/telemetry.js';

// ===========================================================================
// Telemetry capture — every suppression must be observable, never a silent
// no-op (this module's standing rule for the ladder rows applies to the gate
// row too).
// ===========================================================================
let sink: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  sink = [];
  setTestSink((event, data) => sink.push({ event, data }));
});
afterEach(() => setTestSink(null));

const emitted = () => sink.filter((e) => e.event === 'v5.ui_directive.emitted');
const suppressed = (reason: string) =>
  sink.filter(
    (e) => e.event === 'v5.ui_directive.suppressed' && e.data.reason === reason,
  );

/**
 * The set of kinds this lane deliberately leaves without a surface.
 * Asserted as an EXACT set below — not a subset — so that mapping one of them
 * later cannot happen silently.
 */
const KNOWN_UNMAPPED: ReadonlySet<ReadinessOpenItem['kind']> = new Set([
  'goal_node_missing',
  'option_needs_mapping',
  'goal_threshold_missing',
  'model_needs_review',
]);

/** The five section ids the 0.39.0 contract admits (blocks.d.ts:1857). */
const CONTRACT_SECTION_IDS = [
  'options',
  'factors',
  'relationships',
  'risks',
  'modelcard',
] as const;

/**
 * ⚠ The payload `summariseReadiness` accepts is the ORCHESTRATOR structural
 * type (`orchestrator/types.ts:573–643`), NOT the Zod type in
 * `schemas/analysis-ready.ts`. They differ where it matters for a fixture: the
 * option key is `option_id`, not `id`. A fixture built from the Zod shape
 * typechecks nowhere useful and silently describes a payload this producer
 * never sees.
 */
type ReadinessPayload = Parameters<typeof summariseReadiness>[0];

/** Canonical mapping status; raw option count is deliberately non-authoritative. */
const READY_MAPPING: ReadinessPayload = {
  goal_node_id: 'goal_1',
  status: 'needs_user_mapping',
  goal_threshold: 0.7,
  options: [
    {
      option_id: 'opt_a',
      label: 'Hire two senior engineers locally',
      status: 'ready',
      interventions: {},
    },
  ],
} as ReadinessPayload;

const READY_ENCODING: ReadinessPayload = {
  goal_node_id: 'goal_1',
  status: 'needs_encoding',
  goal_threshold: 0.7,
  options: [
    {
      option_id: 'opt_a',
      label: 'Hire two senior engineers locally',
      status: 'needs_encoding',
      interventions: { fac_capacity: 0.5 },
    },
    {
      option_id: 'opt_b',
      label: 'Hire one senior engineer overseas',
      status: 'ready',
      interventions: { fac_capacity: 0.3 },
    },
  ],
} as ReadinessPayload;

const READY_BLOCKED: ReadinessPayload = {
  goal_node_id: '',
  status: 'blocked',
  options: [],
  blockers: [{ blocker_type: 'missing_value' }],
} as ReadinessPayload;

describe('ROADMAP 2.640 — gate-close remedy directive', () => {
  // =========================================================================
  // THE CAPABILITY
  // =========================================================================
  describe('the assistant opens the surface the blocker is fixed on', () => {
    it('opens the options section when the model has too few options to compare', () => {
      const block = buildGateRemedySectionDirective('too_few_options');

      // Bind by IDENTITY, never by "some directive came back" (trap 19).
      expect(block).not.toBeNull();
      expect(block!.type).toBe('ui_directive');
      expect(block!.verb).toBe('open_section');
      expect(block!.ui_target).toEqual({ kind: 'model_section', id: 'options' });
    });

    it('opens the options section when an option is connected but has no numeric values', () => {
      // Producer semantics: "Has raw values (categorical/boolean) awaiting
      // numeric encoding" (analysis-ready.ts:62). The number is typed into the
      // option's intervention row, which OptionsSection renders as editable.
      const block = buildGateRemedySectionDirective('option_needs_encoding');

      expect(block).not.toBeNull();
      expect(block!.ui_target).toEqual({ kind: 'model_section', id: 'options' });
    });

    it('stamps the gesture as gate-authored, not ladder-authored', () => {
      // The whole point of the `source` axis: a capture must be able to tell a
      // gesture that followed an ACTION (ladder) from one that followed an
      // ENQUIRY (gate). If this regressed to 'ladder' the block would still be
      // valid and still work — and the distinction would be silently gone.
      const block = buildGateRemedySectionDirective('too_few_options');

      expect(block!.source).toBe('gate');
      expect(block!.source).not.toBe('ladder');
    });

    it('emits telemetry naming the gate as the gesture source', () => {
      buildGateRemedySectionDirective('too_few_options');

      const events = emitted();
      expect(events).toHaveLength(1);
      expect(events[0].data.source).toBe('gate');
      expect(events[0].data.verb).toBe('open_section');
      // The gate path has no handler fact; it must not borrow one.
      expect(events[0].data.fact_type).toBe('advice_gate_readiness');
    });
  });

  // =========================================================================
  // WIRE SAFETY — the block must survive the strict boundary schema untouched.
  // A gesture that fails egress validation is a capability that never ships.
  // =========================================================================
  describe('the emitted block is wire-legal', () => {
    it('validates against the strict 0.39.0 boundary schema', () => {
      const block = buildGateRemedySectionDirective('too_few_options');

      const parsed = UiDirectiveBlockSchema.safeParse(block);
      expect(parsed.success).toBe(true);
    });

    it('carries no free-text note — zero LLM authorship on this path', () => {
      // The gate composes deterministically. A `note` here would be the one
      // field on this block capable of carrying an invented rationale, and the
      // provenance channel is the last place a fabrication belongs.
      const block = buildGateRemedySectionDirective('too_few_options');

      expect(block).not.toHaveProperty('note');
    });

    it('carries an empty targets array — the target lives in ui_target', () => {
      const block = buildGateRemedySectionDirective('too_few_options');

      expect(block!.targets).toEqual([]);
    });

    it('is byte-identical on repeated calls — the gesture is deterministic', () => {
      const a = buildGateRemedySectionDirective('too_few_options');
      const b = buildGateRemedySectionDirective('too_few_options');

      expect(a).toEqual(b);
    });
  });

  // =========================================================================
  // FAIL-CLOSED — and its POSITIVE CONTROL. Every absence assertion below sits
  // beside a proof that this builder CAN produce a presence on the same call
  // shape (trap 13: an absence assertion with no positive control is vacuous).
  // =========================================================================
  describe('it declines rather than opening the wrong surface', () => {
    it('emits nothing when the blocker is a missing goal threshold', () => {
      // There is no goal section among the five contract ids, so there is
      // literally nowhere honest to send the user.
      const block = buildGateRemedySectionDirective('goal_threshold_missing');

      expect(block).toBeNull();
      expect(suppressed('remedy_surface_unmapped')).toHaveLength(1);
      expect(emitted()).toHaveLength(0);
    });

    it('emits nothing when the blocker is an unconnected option', () => {
      const block = buildGateRemedySectionDirective('option_needs_mapping');

      expect(block).toBeNull();
      expect(suppressed('remedy_surface_unmapped')).toHaveLength(1);
    });

    it('POSITIVE CONTROL — the same builder does produce a directive for a mapped kind', () => {
      // Proves the two absences above are a decision, not a builder that never
      // returns anything.
      expect(buildGateRemedySectionDirective('too_few_options')).not.toBeNull();
      expect(emitted()).toHaveLength(1);
    });

    it('records a suppression rather than failing silently', () => {
      buildGateRemedySectionDirective('goal_threshold_missing');

      // A drop nobody can count is indistinguishable from a drop that never
      // happened.
      const events = sink.filter((e) => e.event === 'v5.ui_directive.suppressed');
      expect(events).toHaveLength(1);
      expect(events[0].data.reason).toBe('remedy_surface_unmapped');
      expect(events[0].data.fact_type).toBe('advice_gate_readiness');
    });
  });

  // =========================================================================
  // THE MAPPING'S OWN COMPLETENESS (trap 12d — deriving a guard from a list
  // proves the copies AGREE and can never prove the LIST IS RIGHT. The check
  // that notices a SHORT list cannot itself be derived from that list, so the
  // key space is derived from the PRODUCER instead.)
  // =========================================================================
  describe('the mapping cannot silently go short', () => {
    it('covers every open-item kind the readiness producer can actually emit', () => {
      // DERIVED FROM THE PRODUCER, not hand-listed here: drive
      // `summariseReadiness` over fixtures that between them trip EVERY branch
      // it has, and require the mapping to have an opinion about each kind that
      // comes back. A fifth kind added to readiness-summary.ts fails THIS test
      // even if nobody remembers this file exists.
      //
      // Drive every ACTIVE canonical recovery family. The two legacy raw-field
      // reconstructions remain in the closed type for historical snapshots but
      // are intentionally not producer outputs.
      const kinds = new Set([
        ...summariseReadiness(READY_MAPPING).open_items.map((i) => i.kind),
        ...summariseReadiness(READY_ENCODING).open_items.map((i) => i.kind),
        ...summariseReadiness(READY_BLOCKED).open_items.map((i) => i.kind),
      ]);

      // Positive control with an EXACT count, not a floor: if a future edit
      // stopped one branch firing, a `>=` would absorb it silently and this
      // completeness check would quietly weaken (trap 13e — check the
      // magnitude, not just the sign).
      expect(kinds).toEqual(new Set([
        'option_needs_mapping',
        'option_needs_encoding',
        'model_needs_review',
      ]));

      for (const kind of kinds) {
        expect(REMEDY_SECTION_BY_OPEN_ITEM_KIND).toHaveProperty(kind);
      }

      // The additional keys are the two compatibility members plus the
      // canonical missing-goal remedy, which has no speculative UI gesture.
      expect(Object.keys(REMEDY_SECTION_BY_OPEN_ITEM_KIND).sort()).toEqual(
        [
          ...kinds,
          'too_few_options',
          'goal_threshold_missing',
          'goal_node_missing',
        ].sort(),
      );
    });

    it('maps every kind to a contract-legal section id or to an explicit null', () => {
      for (const [kind, section] of Object.entries(REMEDY_SECTION_BY_OPEN_ITEM_KIND)) {
        if (section === null) {
          expect(KNOWN_UNMAPPED.has(kind as ReadinessOpenItem['kind'])).toBe(true);
        } else {
          // A section id outside the contract enum would fail schema validation
          // at emit time and the gesture would vanish silently.
          expect(CONTRACT_SECTION_IDS).toContain(section);
        }
      }
    });

    it('pins the known-unmapped set EXACTLY — it may not grow or shrink unnoticed', () => {
      // Trap 22f's honest-gap rule: a gap recorded in the suite is honest; a gap
      // invisible to it is how a silent regression ships. Mapping
      // `option_needs_mapping` later is a good change — and it must come
      // through this assertion, not past it.
      const unmapped = Object.entries(REMEDY_SECTION_BY_OPEN_ITEM_KIND)
        .filter(([, section]) => section === null)
        .map(([kind]) => kind)
        .sort();

      expect(unmapped).toEqual([
        'goal_node_missing',
        'goal_threshold_missing',
        'model_needs_review',
        'option_needs_mapping',
      ]);
    });
  });

  // =========================================================================
  // N=1 — one gesture per turn.
  // =========================================================================
  it('produces exactly one directive per call', () => {
    const block = buildGateRemedySectionDirective('too_few_options');

    expect(block).not.toBeNull();
    expect(emitted()).toHaveLength(1);
  });

  // =========================================================================
  // INTEGRATION — the half that decides whether this is a capability or just a
  // function. A builder nothing feeds is the estate's most-repeated failure, so
  // these tests drive the REAL gate rather than hand-constructing its output.
  // =========================================================================
  describe('the advice gate actually feeds it', () => {
    const askBlocked = (analysisReady: ReadinessPayload) =>
      tryPostAnalysisAdviceGate({
        message: "What's blocking the analysis?",
        analysis: { status: 'success', leading_option: null, top_drivers: [] },
        analysisReady,
        freshness: 'fresh',
      } as unknown as Parameters<typeof tryPostAnalysisAdviceGate>[0]);

    it('answers the readiness question and names the top blocker for the gesture', () => {
      const out = askBlocked(READY_MAPPING);

      // Pin the precondition IN-TEST (trap 13b): if the gate stopped matching
      // this message, every assertion below would be about a state the product
      // never reaches, and an `if (matched)` guard would go vacuously green.
      expect(out.matched).toBe(true);
      const matched = out as Extract<typeof out, { matched: true }>;
      expect(matched.advice_class).toBe('readiness');

      // The answer still carries its prose — the gesture is ADDITIVE, never a
      // replacement for telling the user what is wrong.
      expect(matched.assistant_text.length).toBeGreaterThan(0);

      // Bound by IDENTITY to the producer's own top item, not to a literal a
      // future reordering could silently diverge from.
      expect(matched.remedy_open_item_kind).toBe(
        summariseReadiness(READY_MAPPING).open_items[0].kind,
      );
    });

    it('tracks the payload rather than reporting a constant', () => {
      // A field hardcoded to one kind would satisfy the test above. Two
      // payloads whose TOP blockers differ is what proves it is derived.
      const a = askBlocked(READY_MAPPING) as Extract<
        ReturnType<typeof askBlocked>,
        { matched: true }
      >;
      const b = askBlocked(READY_ENCODING) as Extract<
        ReturnType<typeof askBlocked>,
        { matched: true }
      >;

      expect(a.matched).toBe(true);
      expect(b.matched).toBe(true);
      expect(a.remedy_open_item_kind).toBe('option_needs_mapping');
      expect(b.remedy_open_item_kind).toBe('option_needs_encoding');
      expect(a.remedy_open_item_kind).not.toBe(b.remedy_open_item_kind);
    });

    it('END TO END — a blocked-model question ships an answer AND the section to fix it', () => {
      // This is the acceptance test for the whole row: gate → kind → directive
      // → composed response → egress, with nothing hand-fed in the middle.
      const out = askBlocked(READY_ENCODING);
      expect(out.matched).toBe(true);
      const matched = out as Extract<typeof out, { matched: true }>;

      const directive = buildGateRemedySectionDirective(
        matched.remedy_open_item_kind!,
      );
      expect(directive).not.toBeNull();

      const response = composeDirectAnswerResponse({
        assistant_text: matched.assistant_text,
        stage: 'analyse',
        answerKind: 'substantive',
        blocks: [directive as UiDirectiveBlock],
      } as unknown as Parameters<typeof composeDirectAnswerResponse>[0]);

      const egressed = sanitiseOlumiResponseForEgress(response, {
        graph: null,
        requestId: 'req-gate-remedy',
        exitPath: 'test',
        userMessage: null,
        mayNameLeadingOption: true,
      });

      const directives = egressed.blocks.filter(
        (b): b is UiDirectiveBlock => b.type === 'ui_directive',
      );
      expect(directives).toHaveLength(1);
      expect(directives[0].verb).toBe('open_section');
      expect(directives[0].ui_target).toEqual({
        kind: 'model_section',
        id: 'options',
      });
      expect(directives[0].source).toBe('gate');
      // The user still gets told what is wrong, in words.
      expect(egressed.assistant_text.length).toBeGreaterThan(0);
    });
  });
});
