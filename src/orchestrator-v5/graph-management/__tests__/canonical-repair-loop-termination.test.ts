/**
 * ⭐⭐ THE CANONICAL REPAIR LOOP — TERMINATION, STRICT PROGRESS, AND AN
 * AFFORDANCE THAT CARRIES IDENTITY.
 *
 * THE DEFECT, witnessed on deployed UI `aa916511` / CEE `7abed98` (19 Aug 2026,
 * fresh guest, brief `04-conflicting-constraints`): the repair loop never lies
 * but does not reliably COMPLETE. A chip was offered for a pair that was
 * already set (`4abad64d.interventions = {"7aec7ab9": 0.8}` had landed);
 * clicking it made zero progress — *"was already set to 0.8 in the previous
 * turn"* — and the turn that followed rendered no chips at all, asking *"Which
 * factor would you like to configure next?"* with no affordance.
 *
 * RE-DERIVED AT PRISTINE `7abed98e` on the live-journey wire capture used
 * below. At EVERY step of the six-step repair loop the product's own recovery
 * chip was:
 *
 *   {"id":"chip_prompt_configure_option",
 *    "label":"Configure open a second bakery location in Leeds…",
 *    "message":"Help me configure open a second bakery location in Leeds…."}
 *
 * — an ellipsis-truncated option label, NO factor, and
 * `resolveOptionEffectWrite` returning `not_effect_framed_intent`. The chip
 * named an entity in no graph and could not route back into the lane that
 * offered it. A chip that names one option leaves the model to choose WHICH of
 * that option's factors was meant; on staging it chose one already resolved.
 *
 * ⭐ WHAT IS PINNED HERE, and why each is a PROPERTY rather than a hope:
 *
 *   1. TERMINATION + STRICT PROGRESS — the loop is driven over the FULL
 *      deterministic write chain (`resolveOptionEffectWrite` →
 *      `buildOptionEffectRawOperation` → `parseEditGraphResponse` →
 *      `applyPatchOperations` → `encodeOptionInterventionsForEdit`), the same
 *      hops `option-effect-write-apply-chain.test.ts` pins one at a time. The
 *      unresolved set must strictly decrease at every step, the loop must
 *      terminate, and the FINAL step must flip
 *      `assessCanonicalAnalysisReadiness(...).safeToAnalyse` to `true` with no
 *      separate user action.
 *   2. IDENTITY — the chip offered at each step must be exactly the chip
 *      `deriveAskedEffectPair` mints for that step's pair. Bound by identity
 *      (`optionId`/`factorId` off the canonical blocker), never by reply text
 *      or by a label predicate another entity could satisfy (trap 19).
 *   3. NEVER AN ALREADY-RESOLVED PAIR — with a DISCRIMINATING PAIR: writing a
 *      value for the offered pair must remove it from the offer while a named
 *      contrast pair stays offered. One direction alone proves nothing.
 *   4. NEVER A PAIR WITH NO EDGE — same shape: deleting the option→factor edge
 *      must remove that pair from the offer while the contrast pair stays.
 *
 * ⚠ THE FIXTURE IS A WIRE CAPTURE, NOT A SELF-AUTHORED SHAPE (trap 16-inverse).
 * `tests/unit/ci/fixtures/live-journey-draftfirst-turn1-2ceb65f.json` is a
 * recorded live-journey turn-1 response (`graph_hash f986ac90c77eafbd`), also
 * read by `tests/unit/ci/staging-journey-smoke.test.ts`. Its `draft_graph` is
 * used unmodified and is a genuine MULTI-BLOCKER model: six `MISSING_OPTION_VALUE`
 * blockers across four options and two factors, and — the reason this capture
 * and not the brief-04 ones — NOTHING ELSE, so clearing the six is what makes
 * it analysable and the terminal flip is observable rather than masked by
 * structural blockers. Historic record: append, never edit (trap 14b). The two
 * derived variants below (a value written; an edge deleted) are DISCLOSED
 * mutations built in-test, never written back to the fixture.
 *
 * ⚠ WHAT THIS DOES NOT CLAIM. A click on the repair chip does not itself write
 * a value: the value is the user's judgement and this estate refuses to invent
 * one (`configure-option-clarify.ts`). What the chip guarantees is that the
 * slot the user is being asked about is a real, still-unresolved slot named by
 * identity — and the loop test proves that answering it strictly reduces the
 * unresolved set and terminates in an analysable model.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import {
  assessCanonicalAnalysisReadiness,
  buildCanonicalAnalysisReadyFromGraph,
} from '../../../orchestrator/tools/analysis-ready-helper.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { parseEditGraphResponse } from '../../../orchestrator/tools/edit-graph.js';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import { buildReadinessRecoveryChip } from '../../coaching/readiness-recovery.js';
import { buildRepairPairChipMessage } from '../../configure-option-chip-text.js';
import { detectConfigureOptionIntent } from '../../routing/configure-option-intent.js';
import { shouldInterceptBeforeEditLane } from '../../routing/configure-option-clarify.js';
import {
  buildOptionEffectRawOperation,
  readCommittedOptionEffect,
  resolveOptionEffectWrite,
} from '../../routing/option-effect-write.js';
import {
  buildRepairBindingInstruction,
  deriveAskedEffectPair,
  deriveMissingEffectPairs,
  type MissingEffectPair,
} from '../../routing/repair-value-binding.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import type { PatchOperation } from '../../../orchestrator/types.js';

const FIXTURE_PATH = new URL(
  '../../../../tests/unit/ci/fixtures/live-journey-draftfirst-turn1-2ceb65f.json',
  import.meta.url,
);

interface JourneyFixture {
  readonly graph_hash: string;
  readonly draft_graph: {
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  };
}

const CAPTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as JourneyFixture;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const startGraph = (): JourneyFixture['draft_graph'] => clone(CAPTURE.draft_graph);

/** The user's own number. Any 0-1 effect value; the loop is indifferent to it. */
const USER_VALUE = '0.6';

/** The candidate set, through the canonical authority. One composition, named. */
function unresolvedPairs(graph: unknown): readonly MissingEffectPair[] {
  return deriveMissingEffectPairs(buildCanonicalAnalysisReadyFromGraph(graph));
}

function pairKey(pair: { readonly optionId: string; readonly factorId: string }): string {
  return `${pair.optionId}::${pair.factorId}`;
}

function recoveryChip(graph: unknown) {
  const readiness = buildCanonicalAnalysisReadyFromGraph(graph);
  return buildReadinessRecoveryChip(
    readiness as never,
    (graph as { nodes: { id?: string; kind?: string; label?: string }[] }).nodes,
  );
}

function optionLabels(graph: unknown): readonly string[] {
  return (graph as { nodes: { kind?: string; label?: unknown }[] }).nodes
    .filter((node) => node.kind === 'option' && typeof node.label === 'string')
    .map((node) => node.label as string);
}

function hasOptionFactorEdge(graph: unknown, optionId: string, factorId: string): boolean {
  const g = graph as { edges: { from?: unknown; to?: unknown }[] };
  return g.edges.some((edge) => edge.from === optionId && edge.to === factorId);
}

/**
 * Apply the user's answer for ONE pair through the shipped deterministic chain.
 * Every hop is production code; nothing here composes an operation by hand.
 */
function applyUserAnswer(graph: unknown, pair: MissingEffectPair, valueText: string): unknown {
  const message = buildRepairBindingInstruction(pair, valueText);
  const resolution = resolveOptionEffectWrite({ message, graph });
  if (!resolution.matched || resolution.kind !== 'write') {
    throw new Error(`expected a write for ${pairKey(pair)}, got ${JSON.stringify(resolution)}`);
  }
  // Bound BY IDENTITY: the write must land on the pair we were asked about.
  expect({ optionId: resolution.optionId, factorId: resolution.factorId }).toEqual({
    optionId: pair.optionId,
    factorId: pair.factorId,
  });
  const base = GraphV3.parse(graph) as GraphV3T;
  const operations = parseEditGraphResponse(
    JSON.stringify({
      operations: [buildOptionEffectRawOperation(resolution)],
      removed_edges: [],
      warnings: [],
      coaching: null,
    }),
  ).operations as PatchOperation[];
  const applied = applyPatchOperations(base, operations);
  return encodeOptionInterventionsForEdit(applied, new Set([resolution.optionId])).graph;
}

describe('canonical repair loop — the model under repair', () => {
  it('POSITIVE CONTROL — the capture is a real multi-blocker model whose ONLY blockers are missing effect values', () => {
    const graph = startGraph();
    const assessment = assessCanonicalAnalysisReadiness(graph);
    expect(assessment.safeToAnalyse).toBe(false);
    expect(assessment.blockingIssues.length).toBeGreaterThan(1);
    // Nothing structural, nothing numeric: clearing the value blockers is what
    // makes this model analysable, so the terminal flip below is observable.
    expect([...new Set(assessment.blockingIssues.map((issue) => issue.code))]).toEqual([
      'MISSING_OPTION_VALUE',
    ]);
    expect(unresolvedPairs(graph)).toHaveLength(6);
  });
});

describe('canonical repair loop — ACCEPTANCE 1: strict progress and termination', () => {
  it('the unresolved set strictly decreases on every step, the loop terminates, and the final step flips the model to analysable', () => {
    let graph: unknown = startGraph();
    const sizes: number[] = [];
    const offered: string[] = [];
    const HARD_CAP = 25;

    let steps = 0;
    for (; steps < HARD_CAP; steps += 1) {
      const pairs = unresolvedPairs(graph);
      sizes.push(pairs.length);
      if (pairs.length === 0) break;

      const asked = deriveAskedEffectPair(buildCanonicalAnalysisReadyFromGraph(graph));
      expect(asked).not.toBeNull();
      const pair = asked!;
      // The slot the product offers is IN the unresolved set, by identity.
      expect(pairs.map(pairKey)).toContain(pairKey(pair));
      offered.push(pairKey(pair));

      graph = applyUserAnswer(graph, pair, USER_VALUE);

      // STRICTLY smaller — never equal, never larger.
      expect(unresolvedPairs(graph).length).toBeLessThan(pairs.length);
    }

    // TERMINATION — reached zero well inside the cap, not by exhausting it.
    expect(steps).toBeLessThan(HARD_CAP);
    expect(sizes).toEqual([6, 5, 4, 3, 2, 1, 0]);
    // Every step answered a DIFFERENT slot; a loop that re-offered one would
    // still shrink if some other write cleared two at once.
    expect(new Set(offered).size).toBe(offered.length);

    // THE FINAL CLEARING FLIPS THE MODEL TO ANALYSABLE, with no separate action.
    const final = assessCanonicalAnalysisReadiness(graph);
    expect(final.blockingIssues).toEqual([]);
    expect(final.analysisReady?.status).toBe('ready');
    expect(final.safeToAnalyse).toBe(true);
    // And it was NOT analysable one step earlier — the flip is the last write's
    // doing, not a state the model was already in (trap 13: prove the presence).
    expect(assessCanonicalAnalysisReadiness(startGraph()).safeToAnalyse).toBe(false);
  });
});

describe('canonical repair loop — ACCEPTANCE 2: the affordance carries identity', () => {
  it('at every step the offered chip is the identity chip for that step`s pair, and it routes back to that option', () => {
    let graph: unknown = startGraph();
    for (let step = 0; step < 6; step += 1) {
      const readiness = buildCanonicalAnalysisReadyFromGraph(graph);
      const pair = deriveAskedEffectPair(readiness);
      expect(pair).not.toBeNull();
      const chip = recoveryChip(graph);
      expect(chip).not.toBeNull();

      // IDENTITY: the chip is exactly the one this pair mints. `optionLabel` /
      // `factorLabel` are read off the canonical blocker keyed by
      // `optionId`/`factorId`, so this binds to the entity, not to a string a
      // neighbouring entity could also produce.
      expect(chip!.id).toBe('chip_prompt_repair_effect_value');
      expect(chip!.message).toBe(
        buildRepairPairChipMessage(pair!.optionLabel, pair!.factorLabel),
      );
      // The message names BOTH entities in full — no ellipsis, no truncation.
      expect(chip!.message).toContain(pair!.optionLabel);
      expect(chip!.message).toContain(pair!.factorLabel);
      expect(chip!.message).not.toContain('…');

      // …and it routes back into the lane that offered it. Derived by running
      // the shipped predicates over the emitted message (trap 12), never by
      // restating the routing rules here.
      expect(detectConfigureOptionIntent(chip!.message, optionLabels(graph)).matched).toBe(true);
      const intercept = shouldInterceptBeforeEditLane({
        message: chip!.message,
        detection: detectConfigureOptionIntent(chip!.message, optionLabels(graph)),
        graph,
      });
      expect(intercept.matched).toBe(true);
      expect(intercept.matched && intercept.optionId).toBe(pair!.optionId);

      graph = applyUserAnswer(graph, pair!, USER_VALUE);
    }
  });
});

describe('canonical repair loop — ACCEPTANCE 3: never an already-resolved pair', () => {
  it('no chip is minted for a pair that already has a committed value, at any step of the loop', () => {
    let graph: unknown = startGraph();
    let slotsChecked = 0;
    for (let step = 0; step < 6; step += 1) {
      const pair = deriveAskedEffectPair(buildCanonicalAnalysisReadyFromGraph(graph));
      expect(pair).not.toBeNull();
      // Read by the acknowledgement's own reader — one reader, one answer.
      expect(readCommittedOptionEffect(graph, pair!.optionId, pair!.factorId)).toBeUndefined();
      // …and every OTHER pair still on offer is unresolved too.
      for (const candidate of unresolvedPairs(graph)) {
        expect(readCommittedOptionEffect(graph, candidate.optionId, candidate.factorId))
          .toBeUndefined();
      }

      // ⭐ THE CLICK-LEVEL FORM, and the one that bites. The two assertions
      // above are about the CANDIDATE SET; this one is about what a click on
      // the offered chip actually acts on. Witnessed on staging, the product
      // offered a chip and the turn behind it named a slot already set — so the
      // question is not "is the candidate set clean" but "does the affordance
      // resolve to a clean slot ON THE OPTION THE PRODUCT ASKED ABOUT".
      const chip = recoveryChip(graph);
      expect(chip).not.toBeNull();
      const labels = optionLabels(graph);
      const resolved = shouldInterceptBeforeEditLane({
        message: chip!.message,
        detection: detectConfigureOptionIntent(chip!.message, labels),
        graph,
      });
      expect(resolved.matched).toBe(true);
      expect(resolved.matched && resolved.optionId).toBe(pair!.optionId);
      const offered = unresolvedPairs(graph);
      for (const factorLabel of resolved.matched ? resolved.factorLabels : []) {
        const slot = offered.find(
          (p) => p.optionId === pair!.optionId && p.factorLabel === factorLabel,
        );
        // Named, still-unset, and belonging to the asked option — not a slot
        // borrowed from a neighbouring option (the wrong-entity class).
        expect(slot).toBeDefined();
        expect(readCommittedOptionEffect(graph, slot!.optionId, slot!.factorId)).toBeUndefined();
        slotsChecked += 1;
      }

      graph = applyUserAnswer(graph, pair!, USER_VALUE);
    }
    // Vacuity guard: the loop above asserts nothing if no slot was ever offered.
    expect(slotsChecked).toBeGreaterThanOrEqual(6);
    expect(unresolvedPairs(graph)).toHaveLength(0);
  });

  it('DISCRIMINATING PAIR — writing a value removes THAT pair from the offer while a named contrast pair stays offered', () => {
    const graph = startGraph();
    const before = unresolvedPairs(graph);
    const resolved = before[0]!;
    const contrast = before.find((p) => pairKey(p) !== pairKey(resolved))!;
    expect(contrast).toBeDefined();

    const after = applyUserAnswer(graph, resolved, USER_VALUE);
    const offered = unresolvedPairs(after).map(pairKey);

    // The pair that now has a value is GONE …
    expect(offered).not.toContain(pairKey(resolved));
    // … and the contrast pair, untouched, is STILL offered. Without this half a
    // filter that dropped everything would pass the assertion above.
    expect(offered).toContain(pairKey(contrast));
    expect(deriveAskedEffectPair(buildCanonicalAnalysisReadyFromGraph(after)))
      .not.toBeNull();
  });
});

describe('canonical repair loop — ACCEPTANCE 4: never a pair with no edge', () => {
  it('every pair offered across the whole loop has a real option→factor edge', () => {
    let graph: unknown = startGraph();
    let seen = 0;
    for (let step = 0; step < 6; step += 1) {
      for (const candidate of unresolvedPairs(graph)) {
        expect(hasOptionFactorEdge(graph, candidate.optionId, candidate.factorId)).toBe(true);
        seen += 1;
      }
      const pair = deriveAskedEffectPair(buildCanonicalAnalysisReadyFromGraph(graph));
      graph = applyUserAnswer(graph, pair!, USER_VALUE);
    }
    // The assertion above is vacuous if nothing was ever offered.
    expect(seen).toBe(6 + 5 + 4 + 3 + 2 + 1);
  });

  it('DISCRIMINATING PAIR — deleting the option→factor edge removes THAT pair from the offer while a named contrast pair stays offered', () => {
    const graph = startGraph();
    const before = unresolvedPairs(graph);
    const dropped = before[0]!;
    const contrast = before.find(
      (p) => p.optionId !== dropped.optionId && p.factorId !== dropped.factorId,
    )!;
    expect(contrast).toBeDefined();

    // DISCLOSED IN-TEST MUTATION of a copy — the fixture on disk is untouched.
    const withoutEdge = startGraph();
    withoutEdge.edges = withoutEdge.edges.filter(
      (edge) => !(edge.from === dropped.optionId && edge.to === dropped.factorId),
    );
    expect(hasOptionFactorEdge(withoutEdge, dropped.optionId, dropped.factorId)).toBe(false);

    const offered = unresolvedPairs(withoutEdge).map(pairKey);
    expect(offered).not.toContain(pairKey(dropped));
    expect(offered).toContain(pairKey(contrast));
  });
});
