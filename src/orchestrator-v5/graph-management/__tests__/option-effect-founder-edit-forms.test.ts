/**
 * ⭐⭐ THE FOUNDER'S DRIVE PATH — "one meaningful edit → rerun".
 *
 * On deployed CEE `a18e194` this step offered a Confirm button and nothing
 * moved. Driving the deployed bytes found TWO INDEPENDENT ROOT CAUSES on one
 * sentence, and this file keeps them apart deliberately: each arm below fails
 * for its own reason at pristine, and NEITHER fix repairs the other arm.
 *
 *   ARM (a) "revise <Option A>'s effect on <Factor> to 30%, keep <Option B> at 40%"
 *     1. VALUE FORM — `readOptionEffectValue` rejected `%` outright, so the
 *        turn died as `no_single_unit_scale_value` before anything else ran.
 *     2. PROTECTION CLAUSE SCOPE — with the value supplied by hand, the
 *        referee returned `governing: 'held'`, `blocker:
 *        USER_PROTECTED_ENTITY`. `keep`, an instruction about **B**, captured
 *        **A** — the entity the user had just asked to change — because bare
 *        commas are not clause boundaries.
 *     3. OPTION AMBIGUITY — with both of those repaired, naming two options
 *        made the resolver ASK rather than write.
 *
 *   ARM (b) "set <Option A>'s effect on <Factor> to .3"
 *        A LEADING DIGIT was required, so `.3` matched nothing while `0.3`
 *        resolved cleanly. Nothing to do with protection, and unaffected by
 *        the percent fix.
 *
 * ⭐ ACCEPTANCE IS A SERVER-SIDE GRAPH READ-BACK, NEVER THE RECEIPT. A confirm
 * that stops erroring while the graph is unchanged is a worse lie than the
 * refusal, so every "it landed" assertion below reads the value back out of
 * the APPLIED graph through `mergeInterventionSources` and
 * `readCommittedOptionEffect`, and asserts the KEPT option is byte-identical.
 *
 * The graph is the wire-witnessed `j4-wrong-entity-write` fixture — real
 * labels, real ids, real edges — not a self-authored shape (trap 16: a fixture
 * you wrote yourself is not evidence about the wire).
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import { parseEditGraphResponse } from '../../../orchestrator/tools/edit-graph.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import { mergeInterventionSources } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { evaluateEditGraphMutations } from '../../handlers/edit-graph-referee-gate.js';
import { extractProtectedEntities } from '../protection-scope.js';
import {
  OPTION_EFFECT_UNATTRIBUTED_VALUE_RESIDUAL,
  buildOptionEffectRawOperation,
  readCommittedOptionEffect,
  readOptionEffectValue,
  readOptionEffectValueReading,
  resolveOptionEffectWrite,
} from '../../routing/option-effect-write.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import type { PatchOperation } from '../../../orchestrator/types.js';

const WITNESS = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/witness-2026-08-17/j4-wrong-entity-write.json', import.meta.url),
    'utf8',
  ),
) as { draft_graph: { nodes: Array<Record<string, unknown>>; edges: unknown[] } };

const graph = () => JSON.parse(JSON.stringify(WITNESS.draft_graph)) as Record<string, unknown>;

/** Bound BY IDENTITY — ids, not values another node could satisfy (trap 19). */
const CHANGE_ID = '27af3c89';
const CHANGE_LABEL = 'Electrify one-third of fleet (EV capex route)';
const KEEP_ID = '862169d7';
const KEEP_LABEL = 'Subcontract inner-city runs to green courier';
const FACTOR_ID = '90246f0d';
const FACTOR_LABEL = 'Annual clean-air charge burden';

const ARM_A = `revise ${CHANGE_LABEL}'s effect on ${FACTOR_LABEL} to 30%, keep ${KEEP_LABEL} at 40%`;
const ARM_B = `set ${CHANGE_LABEL}'s effect on ${FACTOR_LABEL} to .3`;
const ARM_C = `do not touch ${FACTOR_LABEL}`;

/**
 * ⛔⛔ R1 — THE COMPOSED WRONG WRITE. The user states 0.9 about the option they
 * asked to KEEP, and states NO value for the option they asked to change.
 *
 * Measured against the persisted graph across three tips:
 *   pristine  → `kind: 'ask'`                    (which one did you mean?)
 *   the first cut of this branch → A's effect on the factor reads back 0.9
 *   here      → `kind: 'ask'` again, and NOTHING is written to either option.
 */
const R1 = `keep ${KEEP_LABEL} to 0.9. revise ${CHANGE_LABEL}'s effect on ${FACTOR_LABEL}`;

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

function refereeFor(message: string, operations: PatchOperation[]) {
  return evaluateEditGraphMutations({
    mode: 'live',
    operations,
    currentGraph: graph(),
    currentGraphHash: 'hash-a',
    baseGraphHash: 'hash-a',
    freshness: 'fresh',
    scenarioId: 'scn-founder',
    turnId: 'turn-founder',
    requestId: 'req-founder',
    userMessage: message,
  } as Parameters<typeof evaluateEditGraphMutations>[0]);
}

/**
 * Drive the sentence all the way to a PERSISTED graph and read the value back
 * out of it. Returns the read-back, never the resolution's own value.
 */
function driveToGraphReadBack(message: string): {
  readonly effectOnChanged: number | null;
  /** `readCommittedOptionEffect` returns `number | undefined` — widened to
   *  match the producer rather than coerced, so an absent value stays visibly
   *  absent and fails the assertion loudly. */
  readonly viaCommittedReader: number | undefined;
  readonly keptOptionUntouched: boolean;
  readonly governing: string;
} {
  const resolution = resolveOptionEffectWrite({ message, graph: graph() });
  if (!resolution.matched || resolution.kind !== 'write') {
    throw new Error(`expected a write, got ${JSON.stringify(resolution)}`);
  }
  const ops = canonicalise(resolution);
  const decision = refereeFor(message, ops);
  if (decision.blockApply) {
    throw new Error(`referee blocked: ${decision.governing} / ${String(decision.publicReason?.blocker_code)}`);
  }
  const applied = applyPatchOperations(GraphV3.parse(graph()) as GraphV3T, ops);
  const { graph: encoded } = encodeOptionInterventionsForEdit(applied, new Set([resolution.optionId]));
  const nodes = (encoded as { nodes: Array<Record<string, unknown>> }).nodes;
  const changedNode = nodes.find((n) => n.id === CHANGE_ID)!;
  const keptAfter = nodes.find((n) => n.id === KEEP_ID);
  const keptBefore = (graph().nodes as Array<Record<string, unknown>>).find((n) => n.id === KEEP_ID);
  return {
    effectOnChanged: mergeInterventionSources(changedNode)?.[FACTOR_ID] ?? null,
    viaCommittedReader: readCommittedOptionEffect(encoded, CHANGE_ID, FACTOR_ID),
    keptOptionUntouched: JSON.stringify(keptAfter) === JSON.stringify(keptBefore),
    governing: decision.governing,
  };
}

describe('ARM (a) — "revise A to 30%, keep B at 40%" — root cause 1 of 2: the VALUE FORM', () => {
  it('RED-FIRST — a percent is read on the model scale, and the control proves the form was the only difference', () => {
    // The discriminating pair: identical sentences, differing ONLY in the
    // value form. At pristine the first was null and the second was 0.3.
    expect(readOptionEffectValue(ARM_A.toLowerCase())).toBe(0.3);
    expect(
      readOptionEffectValue(
        `set the x option's effect on y to 0.3`.toLowerCase(),
      ),
    ).toBe(0.3);
  });

  it('the conversion divisor is pinned, not merely "a number came back"', () => {
    // A `/10` divisor would put 1% at 0.1 — in range, and indistinguishable
    // from correct unless the value itself is asserted.
    expect(readOptionEffectValue("set the x option's effect on y to 1%")).toBe(0.01);
    expect(readOptionEffectValue("set the x option's effect on y to 30%")).toBe(0.3);
  });

  it('a CURRENCY is still refused — the percent fix did not widen to units with no defined conversion', () => {
    expect(readOptionEffectValue("set the x option's effect on y to £1")).toBeNull();
    expect(readOptionEffectValue("set the x option's effect on y to £25000")).toBeNull();
  });
});

describe('ARM (a) — root cause 2 of 2: PROTECTION CLAUSE SCOPE', () => {
  it('RED-FIRST — `keep` about B no longer captures A, the entity the user asked to CHANGE', () => {
    const protectedIds = extractProtectedEntities(ARM_A, graph()).map((e) => e.nodeId);
    // Bound by identity: B is protected, A and the factor are not.
    expect(protectedIds).toContain(KEEP_ID);
    expect(protectedIds).not.toContain(CHANGE_ID);
    expect(protectedIds).not.toContain(FACTOR_ID);
  });

  it('and the referee therefore PROCEEDS on the write the user asked for', () => {
    const resolution = resolveOptionEffectWrite({ message: ARM_A, graph: graph() });
    if (!resolution.matched || resolution.kind !== 'write') throw new Error('expected a write');
    const decision = refereeFor(ARM_A, canonicalise(resolution));
    expect(decision.governing).toBe('proceed');
    expect(decision.blockApply).toBe(false);
  });

  it('⛔ PROTECTION IS NOT WEAKENED — an explicit write AT a protected entity is still HELD', () => {
    // The opposite-direction twin. Without it, the assertions above would pass
    // just as happily if protection had been switched off (trap 22b).
    const message = `set ${CHANGE_LABEL}'s effect on ${FACTOR_LABEL} to 0.3, do not touch ${FACTOR_LABEL}`;
    const resolution = resolveOptionEffectWrite({ message, graph: graph() });
    if (!resolution.matched || resolution.kind !== 'write') throw new Error('expected a write');
    const decision = refereeFor(message, canonicalise(resolution));
    expect(decision.governing).toBe('held');
    expect(decision.blockApply).toBe(true);
    expect(decision.publicReason?.blocker_code).toBe('USER_PROTECTED_ENTITY');
  });

  it('⛔ and a LIST protection still protects every member — commas did not become clause breaks', () => {
    const message = `do not touch ${FACTOR_LABEL}, ${KEEP_LABEL}, or ${CHANGE_LABEL}`;
    const protectedIds = extractProtectedEntities(message, graph()).map((e) => e.nodeId);
    expect(protectedIds).toContain(FACTOR_ID);
    expect(protectedIds).toContain(KEEP_ID);
    expect(protectedIds).toContain(CHANGE_ID);
  });

  it('⛔ an incidental past-tense mention does NOT exempt an entity from a protection cue', () => {
    // "we set it to 3 last week" carries a change verb and a value, but does
    // not LEAD with an imperative — the conjunct that keeps this safe.
    const message = `do not change anything, we set ${FACTOR_LABEL} to 0.3 last week`;
    expect(extractProtectedEntities(message, graph()).map((e) => e.nodeId)).toContain(FACTOR_ID);
  });
});

describe('ARM (a) — ACCEPTANCE at the persisted graph', () => {
  it('⭐ the changed option MOVES and the kept option is untouched — read back from the graph, not the receipt', () => {
    const readBack = driveToGraphReadBack(ARM_A);
    expect(readBack.governing).toBe('proceed');
    expect(readBack.effectOnChanged).toBeCloseTo(0.3);
    expect(readBack.viaCommittedReader).toBeCloseTo(0.3);
    expect(readBack.keptOptionUntouched).toBe(true);
  });

  it('the write binds to the option the user asked to change, BY ID', () => {
    expect(resolveOptionEffectWrite({ message: ARM_A, graph: graph() })).toMatchObject({
      matched: true,
      kind: 'write',
      optionId: CHANGE_ID,
      factorId: FACTOR_ID,
      value: 0.3,
    });
  });
});

describe('ARM (b) — "set A\'s effect on F to .3" — a SEPARATE root cause: the leading digit', () => {
  it('RED-FIRST — a leading-decimal value is read, and its `0.3` twin proves the digit was the only difference', () => {
    expect(readOptionEffectValue("set the x option's effect on y to .3")).toBe(0.3);
    expect(readOptionEffectValue("set the x option's effect on y to 0.3")).toBe(0.3);
    expect(readOptionEffectValue("set the x option's effect on y to .05")).toBe(0.05);
  });

  it('⭐ ACCEPTANCE — it lands in the persisted graph', () => {
    const readBack = driveToGraphReadBack(ARM_B);
    expect(readBack.effectOnChanged).toBeCloseTo(0.3);
    expect(readBack.viaCommittedReader).toBeCloseTo(0.3);
  });

  it('this arm is INDEPENDENT of protection — the sentence protects nothing', () => {
    // Proves the two root causes are genuinely separate: no fix to protection
    // could have delivered this arm.
    expect(extractProtectedEntities(ARM_B, graph())).toEqual([]);
  });
});

describe('COST — the clause split must not be paid per segment', () => {
  it('⛔ a comma-dense hostile message stays bounded', () => {
    // Masking is O(graph names x regex). Running it per comma-segment instead
    // of once per clause measured 2,349 ms here against 70 ms for the same
    // message with no commas — a 33x regression on exactly the hostile shape
    // MESSAGE_SCAN_CAP exists to bound, invisible to every other test in this
    // file. After hoisting: 276 ms. The bound below sits ~7x above the
    // measured cost and ~3x below the regression, so it catches the class
    // without flaking on a slower runner.
    const wideGraph = {
      nodes: Array.from({ length: 60 }, (_, i) => ({
        id: `node-id-${i}`,
        label: `Some reasonably long factor label number ${i}`,
      })),
      edges: [],
    };
    const message = ('do not touch ' +
      Array.from({ length: 1200 }, (_, i) => `thing ${i}`).join(', ')).slice(0, 10_000);

    const startedAt = Date.now();
    extractProtectedEntities(message, wideGraph);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});

describe('ARM (c) — the protection that must STILL be refused', () => {
  it('⭐ "do not touch <factor>" is not an effect-write, and the factor is protected', () => {
    expect(resolveOptionEffectWrite({ message: ARM_C, graph: graph() })).toEqual({
      matched: false,
      reason: 'not_effect_framed_intent',
    });
    expect(extractProtectedEntities(ARM_C, graph()).map((e) => e.nodeId)).toEqual([FACTOR_ID]);
  });

  it('⭐ ONE PREDICATE, TWO HARMS: the compound sentence and the bare protection reach OPPOSITE verdicts', () => {
    // The discrimination the whole change turns on. If this ever collapses to
    // one answer, the predicate has stopped discriminating (trap 20).
    const compound = extractProtectedEntities(ARM_A, graph()).map((e) => e.nodeId);
    const bare = extractProtectedEntities(ARM_C, graph()).map((e) => e.nodeId);
    expect(compound).not.toContain(CHANGE_ID);
    expect(bare).toContain(FACTOR_ID);
    expect(compound).not.toEqual(bare);
  });
});

describe('⛔⛔ R1 — A VALUE STATED INSIDE A `keep` CLAUSE IS NOT THE CHANGE\'S VALUE', () => {
  /**
   * ⭐ TWO INDIVIDUALLY-SAFE RULES COMPOSED INTO A WRONG WRITE, and neither
   * was wrong on its own. The value reader skipped its preservation filter
   * whenever there was only ONE assignment; the protected-option filter then
   * removed the kept option from candidacy and handed that unattributed 0.9
   * to the only option left. The safety note defending the second rule —
   * "it can never turn a decline into a write" — was TRUE, and stated about
   * the wrong outcome class: what it turned was a clarifying QUESTION into a
   * wrong write, which is strictly worse. The product stopped asking what the
   * user meant and persisted an intent they never expressed.
   *
   * ⛔ THE RULING THIS PINS: Olumi is a reasoning-enhancement system, not a
   * decision engine. When attribution is undetermined, ASK. A wrong write is
   * categorically worse than an unnecessary question, so this must never be
   * repaired by tuning a threshold to guess more often.
   */
  it('⭐ RED-FIRST — it ASKS which option was meant; it does not guess', () => {
    expect(resolveOptionEffectWrite({ message: R1, graph: graph() })).toMatchObject({
      matched: true,
      kind: 'ask',
      ambiguity: 'option',
      optionSource: 'named_in_message',
    });
  });

  it('⭐ ACCEPTANCE at the PERSISTED graph — nothing is written to EITHER option, bound BY ID', () => {
    // The receipt is not the evidence (trap: a confirm that stops erroring
    // while the graph moved is the worse lie). `driveToGraphReadBack` throws
    // unless the resolution is a write, so reaching a read-back at all would
    // itself be the defect. The baseline is asserted so an "absent" reading
    // cannot pass by the fixture simply never having had a value.
    expect(() => driveToGraphReadBack(R1)).toThrow(/expected a write/);

    const before = (graph().nodes as Array<Record<string, unknown>>);
    expect(mergeInterventionSources(before.find((n) => n.id === CHANGE_ID)!)?.[FACTOR_ID]).toBeUndefined();
    expect(mergeInterventionSources(before.find((n) => n.id === KEEP_ID)!)?.[FACTOR_ID]).toBeUndefined();
  });

  it('⭐ the 0.9 is READ, and read as the KEPT option\'s — the value form is not what stopped it', () => {
    // The discriminating control. If the sentence had simply failed to parse,
    // every assertion above would pass for a reason that has nothing to do
    // with attribution, and the fix could be silently reverted (trap 13).
    expect(readOptionEffectValue(R1.toLowerCase())).toBe(0.9);
    expect(readOptionEffectValueReading(R1.toLowerCase())).toEqual({
      kind: 'unattributed',
      value: 0.9,
    });
  });

  it('⭐⭐ ONE FILTER, BOTH DIRECTIONS, IN ONE RUN — an ATTRIBUTED value still disambiguates', () => {
    // The opposite-direction twin, and the reason this fix is not just
    // "switch the protected-option filter off". ARM (a) differs from R1 in
    // exactly one respect — the change clause carries its OWN value — and it
    // must still resolve to a write on the option the user asked to change.
    expect(readOptionEffectValueReading(ARM_A.toLowerCase())).toEqual({
      kind: 'attributed',
      value: 0.3,
    });
    expect(resolveOptionEffectWrite({ message: ARM_A, graph: graph() })).toMatchObject({
      matched: true,
      kind: 'write',
      optionId: CHANGE_ID,
      value: 0.3,
    });

    // ... while R1 asks. If these two ever collapse to one answer the
    // predicate has stopped discriminating (trap 20).
    const armA = resolveOptionEffectWrite({ message: ARM_A, graph: graph() });
    const r1 = resolveOptionEffectWrite({ message: R1, graph: graph() });
    expect(armA.matched && armA.kind).toBe('write');
    expect(r1.matched && r1.kind).toBe('ask');
  });

  it('⛔ the ask still names BOTH options by identity — the kept one is offered, not silently dropped', () => {
    // The user may well have meant "and also set B" — that is the question.
    // Dropping B from the candidates would be the same guess in a quieter
    // costume.
    const r1 = resolveOptionEffectWrite({ message: R1, graph: graph() });
    if (!r1.matched || r1.kind !== 'ask') throw new Error('expected an ask');
    expect(r1.candidates.map((c) => c.optionId).sort()).toEqual([CHANGE_ID, KEEP_ID].sort());
    expect(r1.value).toBe(0.9);
  });

  it('⛔ `readOptionEffectValue` is UNCHANGED by the new reading — an unattributed value is still a value', () => {
    // The refactor must not shrink the public reader other callers depend on
    // — `outstanding-effect-ask-misroute.ts` is a live one. Both readings
    // return a number; only `absent` is null.
    //
    // ⚠ DELIBERATELY SPELLED IN PLAIN DECIMALS. Asserting ARM (a) and ARM (b)
    // here would make ONE test depend on BOTH the percent grammar and the
    // leading-decimal grammar, which collapses the two arms' kill-sets into
    // each other and destroys the proof that they are separate root causes.
    // A test's dependencies are part of the evidence, not an implementation
    // detail.
    expect(readOptionEffectValue(R1.toLowerCase())).toBe(0.9);
    expect(readOptionEffectValue("set the x option's effect on y to 0.3")).toBe(0.3);
    expect(readOptionEffectValue(ARM_C.toLowerCase())).toBeNull();
    expect(readOptionEffectValueReading(ARM_C.toLowerCase())).toEqual({ kind: 'absent' });
    expect(readOptionEffectValueReading("set the x option's effect on y to 0.3")).toEqual({
      kind: 'attributed',
      value: 0.3,
    });
  });
});

describe('⛔ THE RECORDED RESIDUAL — pinned so it can neither grow nor shrink unnoticed', () => {
  /**
   * This is a DEFECT, asserted as it currently behaves. Pinning it is the
   * honest way to ship a known gap (CLAUDE.md trap 22f): a gap recorded in the
   * suite stays visible, while a gap the suite cannot see is how the same
   * class comes back a round later under a green run.
   *
   * ⚠ IT IS PRE-EXISTING. Measured identical at pristine `179874a2`, at the
   * first cut of this branch, and here — so this fix neither causes it nor
   * claims it. If someone closes it, THIS TEST GOES RED and the exported
   * residual record must be retired in the same change.
   */
  const RESIDUAL = `keep last year's number to 0.9. revise ${CHANGE_LABEL}'s effect on ${FACTOR_LABEL}`;

  it('the guard is bound to the MULTI-OPTION path, and the single-option path still writes an unattributed value', () => {
    // The value is unattributed by the same reader that makes R1 ask...
    expect(readOptionEffectValueReading(RESIDUAL.toLowerCase())).toEqual({
      kind: 'unattributed',
      value: 0.9,
    });
    // ...and the preservation clause names nothing the graph knows, so only
    // ONE option matches and the disambiguation this fix guards is never
    // reached. Read back from the persisted graph, bound by node id.
    const readBack = driveToGraphReadBack(RESIDUAL);
    expect(readBack.governing).toBe('proceed');
    expect(readBack.effectOnChanged).toBeCloseTo(0.9);
  });

  it('the residual is RECORDED in the module, not just in a comment', () => {
    expect(OPTION_EFFECT_UNATTRIBUTED_VALUE_RESIDUAL.status).toContain('PRE-EXISTING');
    expect(OPTION_EFFECT_UNATTRIBUTED_VALUE_RESIDUAL.behaviour).toContain('unattributed');
  });

  it('⛔ and the MULTI-option path it does NOT cover is genuinely covered — the pair discriminates', () => {
    // Same unattributed 0.9, same fixture, differing ONLY in whether a second
    // option is named. If these two ever return the same kind, either the
    // guard has stopped firing or the residual has silently closed.
    const residual = resolveOptionEffectWrite({ message: RESIDUAL, graph: graph() });
    const guarded = resolveOptionEffectWrite({ message: R1, graph: graph() });
    expect(residual.matched && residual.kind).toBe('write');
    expect(guarded.matched && guarded.kind).toBe('ask');
  });
});
