/**
 * `buildDraftCalibrationBlocks` — the card, and the P8 pairing that governs its
 * copy.
 *
 * ⭐⭐ THE LOAD-BEARING SUITE HERE IS THE FIRST BLOCK: **never ask what you
 * cannot accept.** `routing/__tests__/ask-copy-acceptance-pairing.test.ts`
 * makes that a gate rather than a slogan, after recovery copy shipped an
 * exemplar every deterministic reader refused. So these tests drive the REAL
 * router over the REAL bytes the card ships — the exemplar is extracted FROM
 * the emitted body, not spelled a second time here, so the copy and the guard
 * cannot drift apart (CLAUDE.md trap 12).
 *
 * The pairing includes a NEGATIVE CONTROL, because a positive that fires proves
 * only that the probe can see something. The natural way to ask this question
 * ("ICP Clarity is about 40%") does NOT route, and that measured fact is what
 * forced the card to show a command shape instead. If the gate ever stopped
 * discriminating, the negative control REDs and the positive would be worthless
 * without anyone noticing.
 *
 * The graph fixtures are the same two committed captures the derivation suite
 * uses; see its header for why they are captures rather than authored objects.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CoachingBlockSchema } from '@talchain/schemas/boundary';
import { describe, expect, it } from 'vitest';

import { deriveMissingRootAssumptions } from '../../../cee/graph-readiness/missing-root-assumptions.js';
import { shouldSuppressEditDispatchForValueUpdate } from '../../../orchestrator/routing/value-update-gate.js';
import { gateCoachingCardBody } from '../../coaching/copy-quality-gate.js';
import {
  buildCalibrationBody,
  buildDraftCalibrationBlocks,
  calibrationAnswerExemplar,
  DRAFT_CALIBRATION_SIGNAL_PREFIX,
} from '../draft-calibration-blocks.js';

const CREATED_AT = '2026-09-04T00:00:00.000Z';

function loadFixture(name: string): Record<string, unknown> {
  const path = fileURLToPath(
    new URL(`../../../cee/graph-readiness/__tests__/fixtures/${name}.graph.json`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

const FOUNDER = loadFixture('founder-2026-09-03');
const B2 = loadFixture('draft-b2-2026-09-03');

const GOAL = { id: 'g', kind: 'goal', label: 'Goal' };

function graph(nodes: unknown[], edges: unknown[]) {
  return { nodes: [GOAL, ...nodes], edges };
}

/** The exemplar the SHIPPED body actually contains, recovered from the bytes. */
function exemplarFromBody(body: string): string {
  const match = /"([^"]+)"/.exec(body);
  expect(match, `no quoted exemplar in the shipped body: ${body}`).not.toBeNull();
  return match![1]!;
}

describe('⭐⭐ P8 — never ask what you cannot accept', () => {
  it.each([
    ['the founder capture', FOUNDER],
    ['the B2 draft capture', B2],
  ])('%s: the exemplar the card SHIPS routes to the value-update path', (_name, fixture) => {
    const blocks = buildDraftCalibrationBlocks({ graph: fixture, createdAt: CREATED_AT });
    expect(blocks, 'the capture emits no card, so this pairing tests nothing').toHaveLength(1);

    const exemplar = exemplarFromBody(blocks[0]!.body);
    expect(
      shouldSuppressEditDispatchForValueUpdate(exemplar),
      `the card offers "${exemplar}" and the router does not take it`,
    ).toBe(true);
  });

  it('⛔ NEGATIVE CONTROL — the natural phrasing does NOT route, which is why the copy shows a command', () => {
    const { ranked } = deriveMissingRootAssumptions(FOUNDER);
    const label = ranked[0]!.factor_label;
    // The measurement that changed this card's copy, kept as a live control:
    // a bare statement of the level goes nowhere.
    expect(shouldSuppressEditDispatchForValueUpdate(`${label} is about 40%`)).toBe(false);
    // ...and the command form does. Both halves in one test, so a gate that
    // stopped discriminating cannot leave the positive looking healthy.
    expect(shouldSuppressEditDispatchForValueUpdate(calibrationAnswerExemplar(label))).toBe(true);
  });

  it('the exemplar carries the factor label EXACTLY — a truncated label would resolve nothing', () => {
    const { ranked } = deriveMissingRootAssumptions(FOUNDER);
    const label = ranked[0]!.factor_label;
    const body = buildDraftCalibrationBlocks({ graph: FOUNDER, createdAt: CREATED_AT })[0]!.body;
    expect(exemplarFromBody(body)).toBe(calibrationAnswerExemplar(label));
    expect(exemplarFromBody(body)).toContain(label);
  });

  it('⛔ NO ACTION CHIP — there is no honest prompt to send, and a label without one renders inert', () => {
    const block = buildDraftCalibrationBlocks({ graph: FOUNDER, createdAt: CREATED_AT })[0]!;
    expect(block).not.toHaveProperty('action_label');
    expect(block).not.toHaveProperty('action_prompt');
    expect(block).not.toHaveProperty('action_intent');
  });

  it('⛔ never asks for the internal 0-1 scale (the founder ruling of 30 Aug 2026)', () => {
    for (const fixture of [FOUNDER, B2]) {
      const body = buildDraftCalibrationBlocks({ graph: fixture, createdAt: CREATED_AT })[0]!.body;
      expect(body).toContain('0% to 100%');
      expect(body).not.toMatch(/\b0\.\d/);
    }
  });
});

describe('the founder capture — the card this lane exists to ship', () => {
  it('emits exactly one card, about ICP Clarity, bound by identity', () => {
    const blocks = buildDraftCalibrationBlocks({ graph: FOUNDER, createdAt: CREATED_AT });
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;

    expect(block.coaching_kind).toBe('calibration_prompt');
    expect(block.source).toBe('draft_graph');
    expect(block.source_handler).toBe('draft_graph');
    expect(block.signal_id).toBe(`${DRAFT_CALIBRATION_SIGNAL_PREFIX}16ec3d64`);
    // Bound by IDENTITY, never by a value predicate another node could satisfy.
    expect(block.target_refs).toEqual([
      { id: '16ec3d64', label: 'ICP Clarity', kind: 'factor' },
    ]);
    expect(block.title).toBe('Give ICP Clarity a level');
  });

  it('says all four things it has to say: the gap, its size, the ask, and that analysis still runs', () => {
    const body = buildDraftCalibrationBlocks({ graph: FOUNDER, createdAt: CREATED_AT })[0]!.body;
    // The size of the gap is the DERIVED count, not a literal — pinned against
    // the derivation so the two cannot disagree about the same model.
    const { ranked } = deriveMissingRootAssumptions(FOUNDER);
    expect(ranked).toHaveLength(3);
    expect(body).toContain('leaning on 3 assumptions');
    expect(body).toContain('placeholders');
    expect(body).toContain('ICP Clarity matters most');
    expect(body).toContain('I can still compare your options');
  });

  it('the card is visible: rank 1, and it carries the producer-owned guidance signals', () => {
    const block = buildDraftCalibrationBlocks({ graph: FOUNDER, createdAt: CREATED_AT })[0]!;
    // A card ranked 7th or later collapses behind "Show N more" and renders
    // NULL — the sibling emitters' measured lesson.
    expect(block.priority_rank).toBe(1);
    // Derived from the kind by `guidanceSignalsForCoachingKind`, never typed
    // here: this asserts the derivation ran, not a chosen value.
    expect(block.signal_code).toBe('CALIBRATION_PROMPT');
    expect(block.category).toBeDefined();
  });

  it('passes the real copy gate and the real block schema on the exact bytes it ships', () => {
    const block = buildDraftCalibrationBlocks({ graph: FOUNDER, createdAt: CREATED_AT })[0]!;
    expect(gateCoachingCardBody(block.title).accept).toBe(true);
    expect(gateCoachingCardBody(block.body).accept).toBe(true);
    expect(block.body.length).toBeLessThanOrEqual(300);
    expect(CoachingBlockSchema.safeParse(block).success).toBe(true);
  });
});

describe('the B2 capture — the singular branch', () => {
  it('does not claim one gap "matters most", because there is nothing to compare it to', () => {
    const { ranked } = deriveMissingRootAssumptions(B2);
    expect(ranked).toHaveLength(1);

    const body = buildDraftCalibrationBlocks({ graph: B2, createdAt: CREATED_AT })[0]!.body;
    expect(body).toContain('leaning on one assumption');
    expect(body).toContain('a placeholder.');
    expect(body).not.toContain('matters most');
  });
});

describe('one at a time, and only the leader', () => {
  it('never emits more than one card however many gaps there are', () => {
    // The founder capture has three. One card.
    expect(deriveMissingRootAssumptions(FOUNDER).ranked).toHaveLength(3);
    expect(buildDraftCalibrationBlocks({ graph: FOUNDER, createdAt: CREATED_AT })).toHaveLength(1);
  });
});

/**
 * ⭐⭐ THE SUPERLATIVE IS A CLAIM, AND ON A TIE THE DERIVATION CANNOT MAKE IT.
 *
 * `ranked[0]` on an exact materiality tie is whichever `factor_id` sorts first
 * — a STRING SORT. "X matters most" turns that into a statement about the
 * model, and it is false about the two factors it silently demotes.
 *
 * ⚠ AND THE TIE IS NOT EXOTIC; IT IS THE ENRICHER'S DEFAULT OUTPUT SHAPE, so
 * these fixtures are built to the enricher's measured shape rather than to a
 * shape that makes the point conveniently. `factor-extraction/enricher.ts`
 * gives every factor it adds ONE outgoing edge at `strength_mean: 0.5,
 * defaulted: true`, pointed at `findConnectionTarget`'s `candidates[0].id` for
 * the first present kind (decision > option > goal > outcome) — i.e. the SAME
 * target for essentially every enrichment-added factor. Those nodes are roots
 * (outgoing edge only) and carry no value when the brief gave no number, so
 * every pair of them ties EXACTLY, by construction rather than by coincidence.
 * The ids below are `generateFactorId`'s own `factor_<label slug>_<index>`
 * output for the labels they carry.
 *
 * Every case here pins its own precondition: the materialities are asserted
 * BYTE-EQUAL first, so a body without the superlative cannot pass because the
 * derivation saw a separation that was never there (trap 13b, third face).
 */
describe('⭐⭐ an exact materiality tie — the card may ask, but may not rank', () => {
  /** Enrichment-shaped roots: one defaulted 0.5 edge each, same target. */
  function enrichedTie(labels: readonly string[], strengths?: readonly number[]) {
    return graph(
      labels.map((label, i) => ({
        id: `factor_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 20)}_${i}`,
        kind: 'factor',
        label,
      })),
      labels.map((label, i) => ({
        from: `factor_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 20)}_${i}`,
        to: 'g',
        strength_mean: strengths?.[i] ?? 0.5,
        defaulted: true,
      })),
    );
  }

  it('a 3-WAY EXACT TIE does not assert a superlative it cannot support', () => {
    const g = enrichedTie(['Market Timing', 'Spend', 'Value']);

    // PRECONDITION — all three are ranked and their materialities are BYTE
    // EQUAL. Without this the assertion below could pass on a derivation that
    // returned one factor, or none.
    const { ranked } = deriveMissingRootAssumptions(g);
    expect(ranked.map((r) => r.factor_id)).toEqual([
      'factor_market_timing_0',
      'factor_spend_1',
      'factor_value_2',
    ]);
    expect(ranked[1]!.materiality).toBe(ranked[0]!.materiality);
    expect(ranked[2]!.materiality).toBe(ranked[0]!.materiality);

    const blocks = buildDraftCalibrationBlocks({ graph: g, createdAt: CREATED_AT });
    // ⭐ THE CARD STILL SHIPS. Silence here would dark-ship the whole feature
    // on the enricher's default output; the defect is the RANKING CLAIM, not
    // the ask, so only the claim is removed.
    expect(blocks).toHaveLength(1);
    const body = blocks[0]!.body;

    expect(body).not.toContain('matters most');
    // ...and it still says the three true things: how many, which one it is
    // asking about, and that analysis is unaffected.
    expect(body).toContain('leaning on 3 assumptions');
    expect(body).toContain('Give Market Timing a level');
    expect(body).toContain('"set Market Timing to 40%"');
    expect(body).toContain('I can still compare your options');
  });

  it('a PARTIAL tie at the TOP is still a shared lead, and is treated as one', () => {
    // Two leaders and a genuine also-ran. `ranked[0]` is a coin flip between
    // the first two; the third's presence must not buy back the superlative.
    const g = enrichedTie(['Market Timing', 'Spend', 'Value'], [0.5, 0.5, 0.1]);

    const { ranked } = deriveMissingRootAssumptions(g);
    expect(ranked.map((r) => r.factor_id)).toEqual([
      'factor_market_timing_0',
      'factor_spend_1',
      'factor_value_2',
    ]);
    expect(ranked[1]!.materiality).toBe(ranked[0]!.materiality);
    expect(ranked[2]!.materiality).toBeLessThan(ranked[0]!.materiality);

    const body = buildDraftCalibrationBlocks({ graph: g, createdAt: CREATED_AT })[0]!.body;
    expect(body).not.toContain('matters most');
    expect(body).toContain('leaning on 3 assumptions');
    expect(body).toContain('Give Market Timing a level');
  });

  it('⭐ THE OPPOSITE-DIRECTION TWIN — a genuine separation KEEPS the superlative', () => {
    // Without this, "drop the superlative" could be satisfied by dropping it
    // always, which would silently delete the card's most useful sentence on
    // every model that CAN rank — including the founder capture this lane
    // exists to serve. Both directions, measured (trap 22b).
    const g = enrichedTie(['Market Timing', 'Spend'], [0.9, 0.1]);
    const { ranked } = deriveMissingRootAssumptions(g);
    expect(ranked[1]!.materiality).toBeLessThan(ranked[0]!.materiality);

    const body = buildDraftCalibrationBlocks({ graph: g, createdAt: CREATED_AT })[0]!.body;
    expect(body).toContain('Market Timing matters most');
  });

  it('⭐ AND ON THE FOUNDER CAPTURE — the real model still ranks, and still says so', () => {
    const { ranked } = deriveMissingRootAssumptions(FOUNDER);
    // Precondition: this capture is genuinely separated (~2x), so it is the
    // right control for "the fix did not silence the flagship case".
    expect(ranked[0]!.materiality).toBeGreaterThan(ranked[1]!.materiality);
    const body = buildDraftCalibrationBlocks({ graph: FOUNDER, createdAt: CREATED_AT })[0]!.body;
    expect(body).toContain('ICP Clarity matters most');
  });

  it('the tie body stays inside the card budget, so the fix costs no coverage', () => {
    // The tie body REPLACES "<label> matters most. Give it a level," with
    // "Give <label> a level," — 17 characters shorter for every label. Pinned
    // so a later copy change cannot quietly reintroduce a budget cliff that
    // only fires on ties.
    const tie = enrichedTie(['Market Timing', 'Spend', 'Value']);
    const sep = enrichedTie(['Market Timing', 'Spend', 'Value'], [0.9, 0.5, 0.1]);
    const tieBody = buildDraftCalibrationBlocks({ graph: tie, createdAt: CREATED_AT })[0]!.body;
    const sepBody = buildDraftCalibrationBlocks({ graph: sep, createdAt: CREATED_AT })[0]!.body;
    expect(sepBody).toContain('matters most');
    expect(tieBody.length).toBe(sepBody.length - 17);
    expect(gateCoachingCardBody(tieBody).accept).toBe(true);
  });
});

describe('fail-closed', () => {
  it('no unquantified root that reaches the goal means no card', () => {
    const quantified = graph(
      [{ id: 'f', kind: 'factor', label: 'F', observed_state: { value: 0.4 } }],
      [{ from: 'f', to: 'g', strength_mean: 0.5 }],
    );
    expect(deriveMissingRootAssumptions(quantified).ranked).toEqual([]);
    expect(buildDraftCalibrationBlocks({ graph: quantified, createdAt: CREATED_AT })).toEqual([]);
  });

  it('⭐ THE TITLE TRUNCATES AND THE BODY DOES NOT — the asymmetry P8 requires', () => {
    // A long label the title cannot hold whole. The card still ships: the
    // title is trimmed (it carries no command), and the body keeps the label
    // INTACT inside the exemplar, because a shortened exemplar resolves
    // nothing. Without the truncation the 90-character title would fail the
    // contract and the card would vanish, so this pins the truncation too.
    const label = 'Organisational confidence regarding enterprise procurement predictability';
    const g = graph(
      [{ id: 'f', kind: 'factor', label }],
      [{ from: 'f', to: 'g', strength_mean: 0.5 }],
    );
    expect(`Give ${label} a level`.length, 'the raw title must overshoot, or truncation is untested')
      .toBeGreaterThan(80);

    const blocks = buildDraftCalibrationBlocks({ graph: g, createdAt: CREATED_AT });
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.title.length).toBeLessThanOrEqual(80);
    expect(block.title).not.toContain('a level'); // the tail was trimmed
    // ...and the body still carries the whole label, exactly.
    expect(block.body).toContain(calibrationAnswerExemplar(label));
    expect(shouldSuppressEditDispatchForValueUpdate(exemplarFromBody(block.body))).toBe(true);
  });

  it('⛔ THE TITLE GATE EARNS ITS PLACE — a single-token label degrades it to "Give"', () => {
    // `truncateAtWordBoundary` cuts at a space, and the only space before the
    // budget is the one after "Give". So a label that is one long token leaves
    // a four-character title: furniture, not a heading. The BODY is fine here,
    // so only the title gate can refuse this card.
    const label = 'confidenceoftheleadershipteaminourquarterlyselfservetrialconversionrateoverall';
    const g = graph(
      [{ id: 'f', kind: 'factor', label }],
      [{ from: 'f', to: 'g', strength_mean: 0.5 }],
    );
    // PRECONDITIONS — the ranking returns it and the BODY is acceptable, so the
    // refusal below is the title gate's and nothing else's.
    expect(deriveMissingRootAssumptions(g).ranked.map((r) => r.factor_id)).toEqual(['f']);
    const body = buildCalibrationBody([{ factor_id: 'f', factor_label: label, materiality: 1 }]);
    expect(gateCoachingCardBody(body).accept, 'the body must PASS, or the title gate is not isolated').toBe(true);

    expect(buildDraftCalibrationBlocks({ graph: g, createdAt: CREATED_AT })).toEqual([]);
  });

  it('⭐⭐ P8 AT EMIT TIME — a label the router cannot resolve yields SILENCE', () => {
    // The router's object window is six tokens, so a seven-word label makes
    // `set <label> to 40%` unroutable. Everything else about this card is fine
    // — which is exactly why the emitter has to ask the router itself rather
    // than trust a copy review.
    const label = 'Enterprise procurement cycle predictability across regulated territories';
    const g = graph(
      [{ id: 'f', kind: 'factor', label }],
      [{ from: 'f', to: 'g', strength_mean: 0.5 }],
    );

    // PRECONDITIONS — every OTHER gate passes, so the refusal is gate 3's.
    expect(deriveMissingRootAssumptions(g).ranked.map((r) => r.factor_id)).toEqual(['f']);
    const body = buildCalibrationBody([{ factor_id: 'f', factor_label: label, materiality: 1 }]);
    expect(body.length).toBeLessThanOrEqual(300);
    expect(gateCoachingCardBody(body).accept).toBe(true);
    // ...and the router genuinely refuses it.
    expect(shouldSuppressEditDispatchForValueUpdate(calibrationAnswerExemplar(label))).toBe(false);

    expect(buildDraftCalibrationBlocks({ graph: g, createdAt: CREATED_AT })).toEqual([]);
  });

  it('⛔ a label too long to quote whole yields SILENCE, not a truncated ask', () => {
    const longLabel =
      'which we believe is partly driven by product quality and partly by how much '
      + 'attention each trial gets from the founder';
    const g = graph(
      [{ id: 'f', kind: 'factor', label: longLabel }],
      [{ from: 'f', to: 'g', strength_mean: 0.5 }],
    );
    // PRECONDITIONS — the ranking DOES return it, and the body genuinely
    // overshoots, so the empty result below is the length refusal and not the
    // derivation seeing nothing. The refusing authority is the copy gate's
    // `too_long`; this module keeps no length constant of its own.
    expect(deriveMissingRootAssumptions(g).ranked.map((r) => r.factor_id)).toEqual(['f']);
    const body = buildCalibrationBody([{ factor_id: 'f', factor_label: longLabel, materiality: 1 }]);
    expect(body.length).toBeGreaterThan(300);
    expect(buildDraftCalibrationBlocks({ graph: g, createdAt: CREATED_AT })).toEqual([]);
  });

  it('⛔ a label that would leak a slug-shaped id drops the card rather than shipping it', () => {
    const g = graph(
      [{ id: 'f', kind: 'factor', label: 'fac_icp_clarity' }],
      [{ from: 'f', to: 'g', strength_mean: 0.5 }],
    );
    expect(deriveMissingRootAssumptions(g).ranked.map((r) => r.factor_id)).toEqual(['f']);
    expect(buildDraftCalibrationBlocks({ graph: g, createdAt: CREATED_AT })).toEqual([]);
  });

  it('a factor with an empty label yields no card', () => {
    const g = graph(
      [{ id: 'f', kind: 'factor', label: '   ' }],
      [{ from: 'f', to: 'g', strength_mean: 0.5 }],
    );
    expect(buildDraftCalibrationBlocks({ graph: g, createdAt: CREATED_AT })).toEqual([]);
  });

  it.each([
    ['null', null],
    ['a string', 'graph'],
    ['an empty object', {}],
  ])('%s yields no card rather than throwing', (_name, input) => {
    expect(buildDraftCalibrationBlocks({ graph: input, createdAt: CREATED_AT })).toEqual([]);
  });
});
