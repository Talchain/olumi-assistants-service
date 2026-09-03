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

describe('fail-closed', () => {
  it('no unquantified root that reaches the goal means no card', () => {
    const quantified = graph(
      [{ id: 'f', kind: 'factor', label: 'F', observed_state: { value: 0.4 } }],
      [{ from: 'f', to: 'g', strength_mean: 0.5 }],
    );
    expect(deriveMissingRootAssumptions(quantified).ranked).toEqual([]);
    expect(buildDraftCalibrationBlocks({ graph: quantified, createdAt: CREATED_AT })).toEqual([]);
  });

  it('⛔ THE BODY GATE EARNS ITS PLACE — an offence the TITLE truncation hides', () => {
    // ⭐ THIS IS THE DIVERGENCE THAT MAKES TWO GATES TWO GATES. The title is
    // truncated to 80 before it is gated, so a banned word at the end of a long
    // label is cut out of the title and survives in the body, which is never
    // truncated. Without this case the body gate is indistinguishable from its
    // neighbour and could be deleted with a green suite — a mutant proved
    // exactly that before this test existed.
    const label = 'How much confidence the leadership team places in our quarterly sales graphs';
    const g = graph(
      [{ id: 'f', kind: 'factor', label }],
      [{ from: 'f', to: 'g', strength_mean: 0.5 }],
    );

    // PRECONDITIONS, all three, or the assertion below proves nothing.
    expect(deriveMissingRootAssumptions(g).ranked.map((r) => r.factor_id)).toEqual(['f']);
    const title = `Give ${label} a level`.slice(0, 80).replace(/\s+\S*$/, '');
    expect(gateCoachingCardBody(title).accept, 'the title must PASS, or the body gate is not isolated').toBe(true);
    const body = buildCalibrationBody({ factor_id: 'f', factor_label: label, materiality: 1 }, 1);
    expect(body.length, 'the body must be UNDER the cap, or length is doing the work').toBeLessThanOrEqual(300);
    expect(gateCoachingCardBody(body).accept).toBe(false);

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
    const body = buildCalibrationBody({ factor_id: 'f', factor_label: longLabel, materiality: 1 }, 1);
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
