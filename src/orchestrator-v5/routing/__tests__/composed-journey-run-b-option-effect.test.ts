/**
 * ⭐⭐⭐ ROADMAP 2.1266 / A3 — THE COMPOSED JOURNEY'S OWN FAILURE, PINNED AT THE
 * VERBATIM CAPTURED TURNS.
 *
 * ⚠⚠ THE FACT THAT MAKES THIS FILE DIFFERENT FROM #1034's AND #1035's SUITES:
 * the run it pins happened on **deployed CEE `4a513781`, with #1034 and #1035
 * ALREADY MERGED AND LIVE**, and the defect reproduced unchanged
 * (`olumi-docs/feedback-2026-08-16/COMPOSED-JOURNEY-WITNESS-2026-08-18-B.md`,
 * LINKS 4 and 5). Every message below is quoted from that witness — none is a
 * sentence composed by this author (trap 16-inverse: a fixture you wrote
 * yourself is not evidence about the wire).
 *
 * THE ACCEPTANCE, in the founder's words: *"if Olumi asks for X, a natural
 * answer must modify X and nothing else."* Concretely, and asserted by
 * IDENTITY rather than by any reply text (trap 19):
 *   · `interventions` gains the named `(option_id, factor_id)` pair;
 *   · the factor's `observed_state` is BYTE-IDENTICAL;
 *   · that pair's blocker disappears;
 *   · every other blocker is byte-identical, in order.
 *
 * WHY THE TWO PREVIOUS FIXES DID NOT COVER THIS PATH — measured at pristine
 * `877affe2` before a line was written, and pinned by `PRISTINE SIGNATURES`
 * below so no later reader has to take it on trust:
 *   · `readMissingValueAnswer(R1)` → `null`, because a COMMA was not a clause
 *     break. Route-v2's answered-ask pre-route is gated on that reading, so
 *     rule 3c was UNREACHABLE however correct it was.
 *   · `impliesOptionInterventionEdit(R1)` → `false` (no "option" word, no full
 *     option label — the drafter minted an 85-character label the product
 *     renders truncated — and every distinctive token in the message is
 *     claimed by a factor label, so the subtraction leaves no cue).
 *   · so `tryDeterministicValueUpdate(R1)` → `{matched: true, dispatch:
 *     'clarify'}` — the FACTOR-BASELINE pre-route claimed the turn, and
 *     nothing on that path consults the outstanding ask.
 *
 * ONE PUNCTUATION MARK DECIDED WHICH ENTITY GOT WRITTEN.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import {
  buildCanonicalAnalysisReadyFromGraph,
  computeStructuralReadiness,
  mergeInterventionSources,
} from '../../../orchestrator/tools/analysis-ready-helper.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { parseEditGraphResponse } from '../../../orchestrator/tools/edit-graph.js';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import type { PatchOperation } from '../../../orchestrator/types.js';
import { extractQuantities } from '../../context/cqe/extract-quantities.js';
import { buildGraphLookup, type GraphLookupWithOptions } from '../graph-lookup-adapter.js';
import {
  collectOptionGuardLabels,
  impliesOptionInterventionEdit,
} from '../option-intervention-guard.js';
import { tryDeterministicValueUpdate } from '../deterministic-value-update.js';
import {
  MISSING_VALUE_ANSWER_KNOWN_DROPPED,
  readMissingValueAnswer,
} from '../missing-value-answer.js';
import {
  deriveAskedEffectPair,
  deriveMissingEffectPairs,
  matchBareRepairValue,
} from '../repair-value-binding.js';
import {
  ANSWERED_ASK_KNOWN_DROPPED,
  buildOptionEffectRawOperation,
  readCommittedOptionEffect,
  resolveOptionEffectWrite,
} from '../option-effect-write.js';
import {
  OUTSTANDING_ASK_CLARIFY_KNOWN_DROPPED,
  buildOutstandingAskChipMessage,
  buildOutstandingAskClarifyText,
  resolveOutstandingAskClarifyRedirect,
} from '../outstanding-ask-clarify.js';
import { detectConfigureOptionIntent, projectOptionLabels } from '../configure-option-intent.js';

interface RunBFixture {
  readonly ids: {
    readonly asked_option_id: string;
    readonly asked_option_label: string;
    readonly asked_factor_id: string;
    readonly asked_factor_label: string;
    readonly sibling_option_id: string;
    readonly sibling_option_label: string;
    readonly sibling_factor_id: string;
    readonly sibling_factor_label: string;
    readonly status_quo_option_id: string;
    readonly goal_node_id: string;
  };
  readonly wire: {
    readonly on_screen_ask: string;
    readonly r1_user_message: string;
    readonly r1_chip_message: string;
    readonly r2_user_message: string;
    readonly r3_user_message: string;
  };
  readonly draft_graph: {
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  };
}

const WITNESS = JSON.parse(
  readFileSync(
    new URL(
      '../../__tests__/fixtures/witness-2026-08-18/composed-journey-run-b.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as RunBFixture;

const OPTION_ID = WITNESS.ids.asked_option_id;
const OPTION_LABEL = WITNESS.ids.asked_option_label;
const FACTOR_ID = WITNESS.ids.asked_factor_id;
const FACTOR_LABEL = WITNESS.ids.asked_factor_label;
const SIBLING_FACTOR_ID = WITNESS.ids.sibling_factor_id;

/** ⭐ THE TURN THE WITNESS RECORDS. Verbatim. Never composed here. */
const R1 = WITNESS.wire.r1_user_message;
const R2 = WITNESS.wire.r2_user_message;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const graph = () => clone(WITNESS.draft_graph);

const blockerKeys = (g: unknown): string[] => {
  const readiness = buildCanonicalAnalysisReadyFromGraph(g) as { blockers?: unknown };
  const list = Array.isArray(readiness?.blockers) ? readiness.blockers : [];
  return list.map((b) => JSON.stringify(b));
};

/** The pre-route's own lookup, built by the production adapter. */
function lookupOrThrow(): GraphLookupWithOptions {
  const built = buildGraphLookup({
    nodes: graph().nodes,
    edges: graph().edges,
  } as unknown as Parameters<typeof buildGraphLookup>[0]);
  if (built.kind !== 'ok') throw new Error(`graph lookup ${built.kind}`);
  return built.lookup;
}

function resolveOrThrow(message: string, g: unknown) {
  const resolution = resolveOptionEffectWrite({ message, graph: g });
  if (!resolution.matched || resolution.kind !== 'write') {
    throw new Error(`expected a write, got ${JSON.stringify(resolution)}`);
  }
  return resolution;
}

function canonicalise(resolved: Parameters<typeof buildOptionEffectRawOperation>[0]) {
  return parseEditGraphResponse(
    JSON.stringify({
      operations: [buildOptionEffectRawOperation(resolved)],
      removed_edges: [],
      warnings: [],
      coaching: null,
    }),
  ).operations as PatchOperation[];
}

// ───────────────────────────────────────────────────────────────────────────
describe('RUN-B — the pre-state the witness pinned, reproduced from the fixture', () => {
  it('the product IS asking about the witnessed pair, and it is the HEAD blocker', () => {
    // Without this every claim below could pass on a graph that was never
    // blocked (trap 13: an absence probe needs a presence first). The head is
    // load-bearing: `readiness-recovery.ts:194` composes the on-screen question
    // from `blockers[0]` and nothing else (P7).
    const readiness = buildCanonicalAnalysisReadyFromGraph(graph());
    const asked = deriveAskedEffectPair(readiness);
    expect(asked).not.toBeNull();
    expect([asked!.optionId, asked!.factorId]).toEqual([OPTION_ID, FACTOR_ID]);
    expect(deriveMissingEffectPairs(readiness).map((p) => [p.optionId, p.factorId])).toEqual([
      [OPTION_ID, FACTOR_ID],
      [WITNESS.ids.sibling_option_id, SIBLING_FACTOR_ID],
    ]);
  });

  it('the on-screen ask names the pair the head blocker names', () => {
    // The witness quoted the sentence off the screen; this asserts the fixture
    // identities are the ones that sentence is about, so the turns below are
    // answers to THIS question and not to one this suite invented.
    expect(WITNESS.wire.on_screen_ask).toContain(FACTOR_LABEL);
    expect(OPTION_LABEL.startsWith('double down on enterprise sales (higher')).toBe(true);
    expect(WITNESS.wire.on_screen_ask).toContain('double down on enterprise sales (higher');
  });

  it('no option carries any intervention, and the asked factor sits at 0.5', () => {
    for (const node of graph().nodes.filter((n) => n.kind === 'option')) {
      expect(mergeInterventionSources(node) ?? {}).toEqual({});
    }
    const factor = graph().nodes.find((n) => n.id === FACTOR_ID)!;
    expect((factor.observed_state as { value: number }).value).toBe(0.5);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('RUN-B — PRISTINE SIGNATURES: why #1034 and #1035 do not cover this path', () => {
  it('the option is NOT nameable — the guard that routes to the option lane cannot fire', () => {
    // ⚠ THE RECONSTRUCTION'S BIAS IS ONE-DIRECTIONAL AND THIS CLAIM USES ONLY
    // THE SAFE DIRECTION (see the fixture's `__provenance__`). The fixture
    // omits nodes whose labels the witness did not capture, so it makes FEWER
    // subtractions than the real graph and the guard fires MORE here. FALSE
    // here therefore implies FALSE on the wire.
    const labels = collectOptionGuardLabels(lookupOrThrow());
    expect(impliesOptionInterventionEdit(R1, labels.optionLabels, labels.nonOptionLabels)).toBe(
      false,
    );
  });

  it('⭐ the FACTOR-BASELINE pre-route claims the turn, and resolves the ASKED factor', () => {
    // This is the witnessed R1 reply and chip, at their source: one dice
    // candidate, which `buildClarifyAssistantText` renders as
    // "I wasn't sure which factor you meant. Did you mean <label>?" and
    // `buildClarifyChipMessage` renders as "Set <label> to 0.8." — the factor
    // BASELINE, in answer to a question about an option's EFFECT.
    const factorIds = new Set(
      graph().nodes.filter((n) => n.kind === 'factor').map((n) => n.id as string),
    );
    const dispatch = tryDeterministicValueUpdate(
      R1,
      extractQuantities(R1),
      lookupOrThrow(),
      [],
      factorIds,
      false,
    );
    expect(dispatch.matched).toBe(true);
    expect(dispatch.matched && dispatch.dispatch).toBe('clarify');
    expect(
      dispatch.matched && dispatch.dispatch === 'clarify'
        ? dispatch.candidates.map((c) => c.id)
        : null,
    ).toEqual([FACTOR_ID]);
  });

  it('the shipped intent classifier declines R1 — rule 3c\'s conjunct (a) is satisfied', () => {
    // Pinned so no later reader can mistake this lane's change for a widening
    // of the trigger gate: the classifier's verdict on R1 is unchanged.
    const parsed = GraphV3.parse(graph()) as GraphV3T;
    expect(detectConfigureOptionIntent(R1, projectOptionLabels(parsed.nodes)).matched).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('⭐⭐⭐ RUN-B ACCEPTANCE — a natural answer modifies X and nothing else', () => {
  it('R1 binds to the ASKED PAIR by identity, not by any value predicate', () => {
    // RED at pristine `877affe2`:
    //   Error: expected a write, got {"matched":false,"reason":"not_effect_framed_intent"}
    const resolved = resolveOrThrow(R1, graph());
    expect(resolved.optionId).toBe(OPTION_ID);
    expect(resolved.factorId).toBe(FACTOR_ID);
    expect(resolved.value).toBe(0.8);
  });

  it('⭐ THE FOUR ACCEPTANCE CLAUSES, through the REAL apply chain, by identity', () => {
    const base = GraphV3.parse(graph()) as GraphV3T;
    const beforeBlockers = blockerKeys(graph());
    const beforeFactor = clone(graph().nodes.find((n) => n.id === FACTOR_ID)!.observed_state);
    const beforeSibling = clone(
      graph().nodes.find((n) => n.id === SIBLING_FACTOR_ID)!.observed_state,
    );

    const resolved = resolveOrThrow(R1, graph());
    const applied = applyPatchOperations(base, canonicalise(resolved));
    const { graph: encoded, unresolvedOptionIds } = encodeOptionInterventionsForEdit(
      applied,
      new Set([OPTION_ID]),
    );
    expect(unresolvedOptionIds).toEqual([]);

    const nodes = (encoded as { nodes: Array<Record<string, unknown>> }).nodes;

    // (1) `interventions` gains the NAMED pair — and only that option carries
    //     one. A count alone would pass for a write to any of the three.
    expect(readCommittedOptionEffect(encoded, OPTION_ID, FACTOR_ID)).toBeCloseTo(0.8);
    const optionsCarrying = nodes
      .filter((n) => n.kind === 'option')
      .filter((n) => Object.keys(mergeInterventionSources(n) ?? {}).length > 0)
      .map((n) => n.id);
    expect(optionsCarrying).toEqual([OPTION_ID]);

    // (2) THE FACTOR'S OWN VALUE IS BYTE-IDENTICAL — the witnessed defect's
    //     exact signature was `0.5 → 0.8` here. Compared as whole objects, not
    //     just `.value`, so a confidence or provenance rewrite also REDs.
    expect(nodes.find((n) => n.id === FACTOR_ID)!.observed_state).toEqual(beforeFactor);
    expect(nodes.find((n) => n.id === SIBLING_FACTOR_ID)!.observed_state).toEqual(beforeSibling);

    // (3)+(4) THAT pair's blocker disappears and every other survivor is
    //     byte-identical, IN ORDER. The witnessed failure "cleared" the blocker
    //     by re-issuing it with its fabricated constant moved 0.5 → 0.8; that
    //     outcome cannot pass this line.
    const afterBlockers = blockerKeys(encoded);
    const targetGone = beforeBlockers.filter(
      (b) => !(b.includes(OPTION_ID) && b.includes(FACTOR_ID)),
    );
    expect(afterBlockers).toEqual(targetGone);
    expect(afterBlockers.length).toBe(beforeBlockers.length - 1);

    // The option flips to ready; no other option's status moves.
    const before = computeStructuralReadiness(GraphV3.parse(graph()));
    const after = computeStructuralReadiness(GraphV3.parse(encoded));
    expect(after?.options.find((o) => o.option_id === OPTION_ID)?.status).toBe('ready');
    const others = (r: ReturnType<typeof computeStructuralReadiness>) =>
      Object.fromEntries(
        (r?.options ?? [])
          .filter((o) => o.option_id !== OPTION_ID)
          .map((o) => [o.option_id, o.status]),
      );
    expect(others(after)).toEqual(others(before));
  });

  it('DISCRIMINATING PAIR — the binding is to the ASKED pair, not to whatever is first', () => {
    // Neither mutant alone proves binding (trap 19). Renaming the ASKED factor
    // must WITHDRAW the claim only if the reader were reading the sentence —
    // it is not: the pair comes from the head blocker. So the discrimination
    // that matters here is the HEAD: reorder the blocker list and the write
    // must follow the head, never the sentence.
    const swapped = graph();
    // Remove the asked option's edge so the sibling pair becomes the head.
    swapped.edges = swapped.edges.filter(
      (e) => !(e.from === OPTION_ID && e.to === FACTOR_ID),
    );
    const askedAfter = deriveAskedEffectPair(buildCanonicalAnalysisReadyFromGraph(swapped));
    expect(askedAfter).not.toBeNull();
    expect(askedAfter!.factorId).toBe(SIBLING_FACTOR_ID);
    // R1's prose still says "sales headcount"; the resolver must NOT bind it to
    // a pair the product is not asking about. The sibling factor is not named
    // in the message, so conjunct (d) is silent — and the write follows the
    // head, which is the producer's own answer to "what did I ask?".
    const resolution = resolveOptionEffectWrite({ message: R1, graph: swapped });
    expect(resolution.matched && resolution.kind === 'write' && resolution.factorId).toBe(
      SIBLING_FACTOR_ID,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('RUN-B — OPPOSITE-DIRECTION TWINS for the comma clause break', () => {
  it('the whole-message binder keeps its ENTIRELY-bare contract — one shape, one owner', () => {
    // ⚠ NARROWED, NOT OPTIONAL-CHAINED, AND THE TYPECHECK RATCHET IS WHY.
    // The first draft asserted `readMissingValueAnswer(R1)?.leadingContext`
    // `.not.toBe('')`, which `tsc --noEmit` rejected because `leadingContext`
    // lives only on the numeric arm of the union. It was ALSO VACUOUS: on a
    // `null` reading the expression is `undefined`, and `undefined !== ''`
    // passes — the exact defect this suite exists to catch, one level up. Bound
    // to the whole object instead, so the shape is pinned rather than probed.
    // (`tsc -p tsconfig.build.json` EXCLUDES tests and was green; only
    // `scripts/ci/typecheck-ratchet.sh` could see it.)
    expect(readMissingValueAnswer(R1)).toEqual({
      kind: 'numeric',
      elliptical: false,
      percentApplied: false,
      valueText: '0.8',
      modelUnitText: '0.8',
      referent: 'it',
      leadingContext: 'that would push sales headcount up a lot',
    });
    // Trap 21: two owners for one shape is the defect this estate keeps paying
    // for. The context-bearing form must NOT reach the sole-missing-pair binder.
    expect(matchBareRepairValue(R1)).toBeNull();
    expect(matchBareRepairValue('Set it to 0.8.')).not.toBeNull();
  });

  it('⭐ the pinned comma member STILL DECLINES — at conjunct (a), not at the punctuation', () => {
    // The rule that excluded commas named a real harm and guarded it in the
    // wrong place. Its own canonical example is refused by the shipped
    // classifier, which predates it. The pinned reason is asserted to have been
    // REWRITTEN, so a silent revert to the punctuation rationale REDs.
    const member = ANSWERED_ASK_KNOWN_DROPPED.find(
      (m) => m.message === 'For the hybrid option, set it to 0.8.',
    );
    expect(member, 'the comma member must stay pinned').toBeDefined();
    expect(member!.why).toContain('conjunct (a)');
    expect(member!.why).not.toContain('Only a sentence-level break');
    expect(resolveOptionEffectWrite({ message: member!.message, graph: graph() }).matched).toBe(
      false,
    );
  });

  it('a comma-led answer naming ANY other entity in full withdraws the claim', () => {
    for (const [message, reason] of [
      [
        `${WITNESS.ids.sibling_factor_label} is the bigger worry, set it to 0.2.`,
        'answer_points_elsewhere',
      ],
      // Every NON-OPTION node is checked, not just sibling factors.
      ['Cut Burn Rate by 30% is the point, set it to 0.8.', 'answer_points_elsewhere'],
    ] as const) {
      const r = resolveOptionEffectWrite({ message, graph: graph() });
      expect(r.matched, message).toBe(false);
      expect(!r.matched && r.reason, message).toBe(reason);
    }
  });

  it('a comma-led answer naming a DIFFERENT option, or the baseline, withdraws the claim', () => {
    for (const message of [
      `${WITNESS.ids.sibling_option_label} matters more, set it to 0.2.`,
      `The team disagrees, set the ${FACTOR_LABEL} baseline to 0.8.`,
      // No unit conversion: this writer only ever writes a model-unit value.
      'That would push it up a lot, set it to 80%.',
      // A named target inside the answering clause keeps its existing owner.
      'It would push it up a lot, set it to 0.8 for the Status Quo: Hold current strategy option.',
    ]) {
      expect(resolveOptionEffectWrite({ message, graph: graph() }).matched, message).toBe(false);
    }
  });

  it('⭐ M2 — a comma with NO FOLLOWING SPACE is not a break (pinned, was a survivor)', () => {
    // Settled by execution after the mutant `\s+` → `\s*` survived the whole
    // battery (trap 13c). Measured: the missing space is the ONLY thing it
    // discriminates, and it discriminates identically at pristine on the `.`
    // form — so this is a PRE-EXISTING gap on a conjunct this lane never
    // touched, now pinned so it cannot drift silently in either direction.
    const noSpace = R1.replace(', set it to', ',set it to');
    expect(noSpace).not.toBe(R1);
    expect(readMissingValueAnswer(noSpace)).toBeNull();
    expect(resolveOptionEffectWrite({ message: noSpace, graph: graph() }).matched).toBe(false);
    // …and the shape is recorded in the pinned set, so the suite REDs if the
    // reader silently widens to claim it.
    expect(
      MISSING_VALUE_ANSWER_KNOWN_DROPPED.some((m) => /,set it to/.test(m)),
      'the space-less break must stay pinned as data',
    ).toBe(true);
    for (const dropped of MISSING_VALUE_ANSWER_KNOWN_DROPPED) {
      expect(matchBareRepairValue(dropped), dropped).toBeNull();
    }
  });

  it('the SENTENCE-break form #1035 shipped still binds — strictly additive', () => {
    const sentenceForm =
      'Doubling down on enterprise sales would push sales headcount up a lot - set it to 0.8.';
    const r = resolveOptionEffectWrite({ message: sentenceForm, graph: graph() });
    expect(r.matched && r.kind === 'write' && r.factorId).toBe(FACTOR_ID);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('⭐⭐ RUN-B — the disambiguation chip must propose the OPTION EFFECT (sub-fixes 2+3)', () => {
  const readiness = () => buildCanonicalAnalysisReadyFromGraph(graph());
  const askedCandidate = [{ id: FACTOR_ID, label: FACTOR_LABEL }];
  const setQuantity = { value: 0.8, unit: null, operator: 'set' };

  it('the witnessed chip wrote the FACTOR BASELINE — pinned so the flip is visible', () => {
    // Historic record, quoted from the witness (trap 14b: append, never edit).
    expect(WITNESS.wire.r1_chip_message).toBe('Set Enterprise sales headcount and spend to 0.8.');
    expect(WITNESS.wire.r1_chip_message).not.toContain("option's effect");
  });

  it('⭐ the redirect fires on the asked factor and names the pair from the HEAD BLOCKER', () => {
    const redirect = resolveOutstandingAskClarifyRedirect({
      message: R1,
      candidates: askedCandidate,
      readiness: readiness(),
      quantity: setQuantity,
    });
    expect(redirect).not.toBeNull();
    expect([redirect!.pair.optionId, redirect!.pair.factorId]).toEqual([OPTION_ID, FACTOR_ID]);
    expect(redirect!.modelUnitValueText).toBe('0.8');
  });

  it('⭐ the chip it produces ROUTES BACK — derived by running the shipped resolver on it', () => {
    // Not asserted against a hand-written string: the emitted message is fed to
    // the writer, and the writer must bind it to the same pair. A chip that
    // cannot route is the dead end this seam exists to remove.
    const redirect = resolveOutstandingAskClarifyRedirect({
      message: R1,
      candidates: askedCandidate,
      readiness: readiness(),
      quantity: setQuantity,
    })!;
    const chip = buildOutstandingAskChipMessage(redirect.pair, redirect.modelUnitValueText!);
    const r = resolveOptionEffectWrite({ message: chip, graph: graph() });
    expect(r.matched && r.kind === 'write' && [r.optionId, r.factorId, r.value]).toEqual([
      OPTION_ID,
      FACTOR_ID,
      0.8,
    ]);
    // …and it is the OPTION EFFECT, not the factor baseline the witness got.
    expect(chip).toContain("option's effect on");
    expect(chip).not.toBe(WITNESS.wire.r1_chip_message);
  });

  it('⭐ P8 — the copy no longer asks a yes/no it cannot accept, and carries the value', () => {
    // The witnessed sequence: "Did you mean <factor>?" → the user answered
    // "Yes, that one — under the enterprise sales option." → "I couldn't use
    // that as the value." and the 0.8 was gone. Both halves are pinned: the
    // question is not a yes/no, and the user's own number survives the turn.
    const redirect = resolveOutstandingAskClarifyRedirect({
      message: R1,
      candidates: askedCandidate,
      readiness: readiness(),
      quantity: setQuantity,
    })!;
    const text = buildOutstandingAskClarifyText(redirect);
    expect(text).not.toContain("wasn't sure which factor");
    expect(text).not.toContain('Did you mean');
    expect(text).toContain(OPTION_LABEL);
    expect(text).toContain(FACTOR_LABEL);
    expect(text).toContain('0.8');
    expect(text).toContain('I have not changed the model.');
    // R2 is the answer the product could not accept. It is recorded here as the
    // reason the question changed shape — this suite does not claim a bare
    // free-text "Yes" now resumes (see the report's stated residual).
    expect(R2.toLowerCase().startsWith('yes')).toBe(true);
  });

  it('NO NUMBER IS PUT IN THE USER\'S MOUTH when their figure is not model-unit', () => {
    // CQE hands `80%` back as `{value: 0.8, unit: 'percentage'}`. Replaying
    // that as "…to 0.8" would silently perform the unit conversion the writer
    // explicitly refuses to perform (P5). The redirect still fires — the wrong
    // QUESTION is still not asked — but it asks for a 0-1 number.
    for (const quantity of [
      { value: 0.8, unit: 'percentage', operator: 'set' },
      { value: 25000, unit: 'GBP', operator: 'set' },
      { value: 0.1, unit: null, operator: 'increment' },
      { value: 40, unit: null, operator: 'set' },
      { value: null, unit: null, operator: 'set' },
    ]) {
      const redirect = resolveOutstandingAskClarifyRedirect({
        message: R1,
        candidates: askedCandidate,
        readiness: readiness(),
        quantity,
      });
      expect(redirect, JSON.stringify(quantity)).not.toBeNull();
      expect(redirect!.modelUnitValueText, JSON.stringify(quantity)).toBeNull();
      expect(buildOutstandingAskClarifyText(redirect!)).toContain('Effect values run from 0 to 1');
    }
  });

  it('⭐ A HEDGE IS NOT A FIGURE — and its NON-HEDGED TWIN still binds exactly', () => {
    // ⚠⚠ THIS CLOSED A P5 PROVENANCE LIE FOUND BY ADVERSARIAL REVIEW, and the
    // mechanism is CLAUDE.md trap 12: `OutstandingAskQuantity` is a
    // HAND-DECLARED MIRROR of `QuantityExtractionResult`, and it had OMITTED
    // `approximate`. So `readModelUnitEffectValue` could not see the hedge and
    // "Set sales headcount to about 0.8." reached the chip as "Apply 0.8" —
    // an approximation recorded as an exact user-stated figure.
    //
    // ⭐ REACHABLE IN ONE TURN, AND THE PIN NEXT DOOR IS WHY. A hedge is
    // deliberately refused by `readMissingValueAnswer`
    // (`MISSING_VALUE_ANSWER_KNOWN_DROPPED`: *"Set it to about 0.12." — a
    // HEDGE… would record an approximation as an exact user-stated figure*),
    // which is exactly what drops the turn through to THIS clarify.
    //
    // ⚠ THE QUANTITIES ARE DERIVED FROM CQE, NEVER HAND-AUTHORED (trap
    // 16-inverse: a fixture you wrote yourself is not evidence about the
    // producer). The two messages differ by ONE hedge word, so `approximate`
    // is the only field that may differ — asserted, not assumed.
    const HEDGED = 'Set sales headcount to about 0.8.';
    const EXACT = 'Set sales headcount to 0.8.';
    const quantityOf = (message: string) => {
      const [q] = extractQuantities(message);
      if (q === undefined) throw new Error(`CQE extracted nothing from ${message}`);
      return q;
    };
    const hedged = quantityOf(HEDGED);
    const exact = quantityOf(EXACT);

    // PRECONDITION, PINNED IN-TEST (trap 13b): the producer's own verdict is
    // what discriminates, and the two readings agree on everything else.
    expect(hedged.approximate).toBe(true);
    expect(exact.approximate).toBe(false);
    expect([hedged.value, hedged.unit, hedged.operator]).toEqual([0.8, null, 'set']);
    expect([exact.value, exact.unit, exact.operator]).toEqual([0.8, null, 'set']);
    // …and the hedged turn really does fall through to this clarify, on the
    // asked factor alone — the redirect's own conjunct (b).
    expect(readMissingValueAnswer(HEDGED)).toBeNull();
    // ⚠⚠ THE STATED REASON FOR THAT NULL CHANGED, AND THE OLD ONE IS CORRECTED
    // RATHER THAN DELETED. This used to assert that a hedge was pinned as a
    // refusal in `MISSING_VALUE_ANSWER_KNOWN_DROPPED` — and it WAS the reason at
    // the time. It is not any more: ROADMAP P0a binds "Set it to about 0.12.",
    // because a hedge qualifies the user's CONFIDENCE and this sentence's figure
    // is still theirs. THIS message nonetheless still reads null, for a reason
    // that has not moved and must not: it NAMES A FACTOR ("sales headcount"),
    // which is outside the closed bare-referent set, so the edit lane owns the
    // referent. Asserted directly instead of via a pinned list, so the guard
    // cannot be satisfied by an unrelated member of that list.
    expect(readMissingValueAnswer('Set it to about 0.8.')?.kind).toBe('numeric');
    expect(readMissingValueAnswer('Set sales headcount to 0.8.')).toBeNull();
    const factorIds = new Set(
      graph().nodes.filter((n) => n.kind === 'factor').map((n) => n.id as string),
    );
    const dispatch = tryDeterministicValueUpdate(
      HEDGED,
      extractQuantities(HEDGED),
      lookupOrThrow(),
      [],
      factorIds,
      false,
    );
    expect(dispatch.matched && dispatch.dispatch).toBe('clarify');
    expect(
      dispatch.matched && dispatch.dispatch === 'clarify'
        ? dispatch.candidates.map((c) => c.id)
        : null,
    ).toEqual([FACTOR_ID]);

    // DIRECTION 1 — the hedge puts NO number in the user's mouth. The redirect
    // still fires: the wrong QUESTION is still not asked.
    const hedgedRedirect = resolveOutstandingAskClarifyRedirect({
      message: HEDGED,
      candidates: askedCandidate,
      readiness: readiness(),
      quantity: hedged,
    });
    expect(hedgedRedirect).not.toBeNull();
    expect(hedgedRedirect!.modelUnitValueText).toBeNull();
    const hedgedText = buildOutstandingAskClarifyText(hedgedRedirect!);
    expect(hedgedText).toContain('Effect values run from 0 to 1');
    expect(hedgedText).not.toContain('0.8');

    // DIRECTION 2 — THE INVERSE-FAILURE CHECK. The non-hedged twin must bind
    // EXACTLY as before; a fix that closes a lie by dropping the honest case
    // has traded one silent failure for another (trap 22b).
    const exactRedirect = resolveOutstandingAskClarifyRedirect({
      message: EXACT,
      candidates: askedCandidate,
      readiness: readiness(),
      quantity: exact,
    });
    expect(exactRedirect).not.toBeNull();
    expect(exactRedirect!.modelUnitValueText).toBe('0.8');
    expect(buildOutstandingAskClarifyText(exactRedirect!)).toContain('apply 0.8 to that pair');
    // …and the witnessed R1 reading, which carries no hedge, is untouched.
    expect(
      resolveOutstandingAskClarifyRedirect({
        message: R1,
        candidates: askedCandidate,
        readiness: readiness(),
        quantity: quantityOf(R1),
      })!.modelUnitValueText,
    ).toBe('0.8');
  });

  it('⭐ OPPOSITE-DIRECTION TWINS — every conjunct withdraws the redirect', () => {
    // (c) the baseline suppressor, imported from the writer rather than
    //     re-spelled, so the two cannot disagree about one sentence.
    expect(
      resolveOutstandingAskClarifyRedirect({
        message: `Change the ${FACTOR_LABEL} baseline, set it to 0.8.`,
        candidates: askedCandidate,
        readiness: readiness(),
        quantity: setQuantity,
      }),
    ).toBeNull();

    // (b) two candidates is a genuine factor ambiguity — picking the asked one
    //     is the wrong-entity class on the factor axis (#1034's mutant M8).
    expect(
      resolveOutstandingAskClarifyRedirect({
        message: R1,
        candidates: [
          { id: FACTOR_ID, label: FACTOR_LABEL },
          { id: SIBLING_FACTOR_ID, label: WITNESS.ids.sibling_factor_label },
        ],
        readiness: readiness(),
        quantity: setQuantity,
      }),
    ).toBeNull();

    // (b) the sole candidate is a factor the product is NOT asking about.
    expect(
      resolveOutstandingAskClarifyRedirect({
        message: R1,
        candidates: [{ id: SIBLING_FACTOR_ID, label: WITNESS.ids.sibling_factor_label }],
        readiness: readiness(),
        quantity: setQuantity,
      }),
    ).toBeNull();

    // (a) the product is not asking for an effect value at all.
    expect(
      resolveOutstandingAskClarifyRedirect({
        message: R1,
        candidates: askedCandidate,
        readiness: { blockers: [] },
        quantity: setQuantity,
      }),
    ).toBeNull();
  });

  it('⭐ M14 — the LABELS come from the PRODUCT\'S QUESTION, not from the clarify candidate', () => {
    // ⚠ THIS TEST EXISTS BECAUSE A MUTANT SURVIVED, and a survivor is a claim in
    // either direction that must be settled by execution, never asserted
    // (trap 13c). The mutant rebuilt the returned pair as
    //   { ...asked, factorId: candidates[0].id, factorLabel: candidates[0].label }
    // and the whole battery stayed GREEN — because conjunct (b) already forces
    // the two IDS equal, and in this fixture the two LABELS are the same string
    // too. Nothing in the corpus distinguished the two SOURCES.
    //
    // They are not the same source. The candidate's label comes from the
    // pre-route's graph lookup; the pair's label comes from the blocker, which
    // is the element `readiness-recovery.ts:194,242` composed the sentence ON
    // SCREEN from (P7). The copy and the chip must name what the QUESTION
    // named. A caller handing a differently-spelled label must not be able to
    // change what the user reads.
    const redirect = resolveOutstandingAskClarifyRedirect({
      message: R1,
      candidates: [{ id: FACTOR_ID, label: 'A DIFFERENT SPELLING OF THE SAME FACTOR' }],
      readiness: readiness(),
      quantity: setQuantity,
    });
    expect(redirect).not.toBeNull();
    expect(redirect!.pair.factorLabel).toBe(FACTOR_LABEL);
    expect(redirect!.pair.optionLabel).toBe(OPTION_LABEL);
    expect(buildOutstandingAskClarifyText(redirect!)).not.toContain('A DIFFERENT SPELLING');
    expect(buildOutstandingAskChipMessage(redirect!.pair, '0.8')).not.toContain(
      'A DIFFERENT SPELLING',
    );
    // …and the chip STILL routes, which is the point of using the blocker's
    // label: the writer resolves labels against the same persisted graph.
    const chip = buildOutstandingAskChipMessage(redirect!.pair, '0.8');
    const r = resolveOptionEffectWrite({ message: chip, graph: graph() });
    expect(r.matched && r.kind === 'write' && r.factorId).toBe(FACTOR_ID);
  });

  it('the known-dropped set is pinned as data, and every member has a reason', () => {
    expect(OUTSTANDING_ASK_CLARIFY_KNOWN_DROPPED).toHaveLength(3);
    for (const m of OUTSTANDING_ASK_CLARIFY_KNOWN_DROPPED) {
      expect(m.shape.length).toBeGreaterThan(20);
      expect(m.why.length).toBeGreaterThan(20);
    }
  });
});
