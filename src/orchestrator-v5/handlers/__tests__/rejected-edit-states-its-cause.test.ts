/**
 * ⭐⭐⭐ A REJECTED EDIT NOW SAYS WHY, AND LEAVES A ROUTE.
 *
 * Witnessed on staging, 16 Sep 2026. After three turns in which Olumi agreed
 * twice that a morale risk belonged in the model:
 *
 *   USER:  "Update the model to reflect all of this, then."
 *   OLUMI: "I couldn't take that change forward, so the model is unchanged..."
 *   USER:  "What's one update based on this discussion that you recommend we
 *           make now?"
 *   OLUMI: (BYTE-IDENTICAL SAME SENTENCE)
 *
 * One sentence answered an EDIT request and an ADVICE request identically,
 * with no cause and no onward action. The user's conversation was lost.
 *
 * ⛔ THE CAUSE WAS NEVER MISSING. `publicReason.blocker_code` is computed on the
 * same object, one line from the sentence, and was emitted to the wire's
 * machine block, to telemetry and to the log — everywhere except to the person.
 *
 * ⚠ INSTRUMENT NOTE: `edit-graph-referee-gate.ts` carries a deliberate NUL
 * sentinel, so `file(1)` calls it `data` and PLAIN GREP IS BLIND TO IT
 * (CLAUDE.md trap 17). Verified while writing this: `grep -c` failed on a
 * string `rg -a -c` found twice. Any sweep of that file must use `rg -a`, and
 * a reviewer must fetch it rather than read `gh pr diff`, which renders it
 * binary.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  GM_REJECTED_ASSISTANT_TEXT,
  GM_REJECTED_COPY_BY_BLOCKER_CODE,
  evaluateEditGraphMutations,
  selectRejectedAssistantText,
} from '../edit-graph-referee-gate.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import * as telemetry from '../../../utils/telemetry.js';

// ── the real gate, driven end to end ──────────────────────────────────────

/**
 * ⭐⭐ THE FIRST VERSION OF THIS SPEC CALLED `evaluateEditGraphMutations` ZERO
 * TIMES. Every assertion ran against the copy map and the selector in
 * isolation, so the WIRING — that these codes are the ones the referee puts on
 * a `rejected` verdict, and that the selector sees them — was pinned by
 * nothing. Its R1b "precondition" test hardcoded three code NAMES as "real
 * codes the referee emits"; one of them, `READINESS_DOWNGRADE`, resolves only
 * to `verdict: 'held'` and could never reach this arm. A precondition asserted
 * from the author's head is the thing the precondition was meant to prevent.
 *
 * Everything below R2 drives the REAL function against a real graph.
 */
const GRAPH = {
  nodes: [
    { id: 'g-profit', kind: 'goal', label: 'Profit' },
    { id: 'd-choice', kind: 'decision', label: 'Which plan' },
    { id: 'f-spend', kind: 'factor', label: 'Marketing spend', observed_state: { value: 0.4 } },
    { id: 'f-reach', kind: 'factor', label: 'Audience reach', observed_state: { value: 0.5 } },
    { id: 'o-a', kind: 'option', label: 'Plan A', interventions: { 'f-spend': { value: 0.6 } } },
    { id: 'o-b', kind: 'option', label: 'Plan B', interventions: { 'f-reach': { value: 0.3 } } },
  ],
  edges: [
    { from: 'd-choice', to: 'o-a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'd-choice', to: 'o-b', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'o-a', to: 'f-spend', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'o-b', to: 'f-reach', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'f-spend', to: 'g-profit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'f-reach', to: 'g-profit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
  ],
};

const GRAPH_HASH = computeAnalysisAffectingGraphHash(GRAPH as never);
if (GRAPH_HASH === null) throw new Error('fixture must hash');

function gate(operations: readonly unknown[]) {
  return evaluateEditGraphMutations({
    mode: 'live',
    operations: operations as never,
    currentGraph: GRAPH,
    currentGraphHash: GRAPH_HASH!,
    baseGraphHash: GRAPH_HASH!,
    freshness: 'none',
    scenarioId: 'scn-rejected-cause',
    turnId: 'turn-rejected-cause',
    requestId: 'req-rejected-cause',
  });
}

function blockerCodeOf(d: ReturnType<typeof gate>): string | null {
  const code = (d.publicReason as { blocker_code?: unknown } | null)?.blocker_code;
  return typeof code === 'string' ? code : null;
}

const ALL_COPY = [
  GM_REJECTED_ASSISTANT_TEXT,
  ...Object.values(GM_REJECTED_COPY_BY_BLOCKER_CODE),
];

// ── R1/R2 — the cause reaches the person, and absence is not invented ───────

describe('R1 — a known cause is stated, an unknown one falls back truthfully', () => {
  it('R1a a mapped blocker code gets its OWN sentence, not the generic one', () => {
    for (const code of Object.keys(GM_REJECTED_COPY_BY_BLOCKER_CODE)) {
      const text = selectRejectedAssistantText(code, 1);
      expect(text, `${code} must be distinguishable`).not.toBe(GM_REJECTED_ASSISTANT_TEXT);
      expect(text).toBe(GM_REJECTED_COPY_BY_BLOCKER_CODE[code]);
    }
  });

  it('R1c an UNMAPPED code falls back to the generic sentence, which is still true', () => {
    for (const unknown of ['SOME_FUTURE_CODE', '', null, undefined, 42, {}]) {
      expect(selectRejectedAssistantText(unknown, 1)).toBe(GM_REJECTED_ASSISTANT_TEXT);
    }
  });

  it('R1e ⛔ THE GENERIC SENTENCE MAKES NO CAUSAL CLAIM — it is read by codes that refute one', () => {
    // It is the sentence for EVERY unmapped code, so it may assert only what
    // is true of all of them. `BATCH_CAP_EXCEEDED` refuses on the batch's
    // LENGTH before any envelope is parsed (referee.ts:558-561) and
    // `UNKNOWN_KIND` never parsed the envelope at all — so "I put a change
    // together" and "it did not fit the model" are both false there.
    const t = GM_REJECTED_ASSISTANT_TEXT.toLowerCase();
    expect(t, 'must not claim a change was assembled').not.toMatch(/put a change together|built a change|prepared a change/);
    expect(t, 'must not claim a model-fit assessment ran').not.toMatch(/did not fit|does not fit|doesn't fit/);
    expect(t, 'but must still say nothing changed').toContain('unchanged');
  });

  it('R1d every sentence still states that nothing changed', () => {
    // The one thing the old copy got right, and the thing a user most needs.
    for (const text of ALL_COPY) {
      expect(text.toLowerCase(), text.slice(0, 40)).toContain('unchanged');
    }
  });
});

// ── R2 — driven through the REAL gate: wiring, and the cascade ─────────────

describe('R2 — the real gate, not the map in isolation', () => {
  let emitSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
  });
  afterEach(() => {
    emitSpy.mockRestore();
  });

  it('R2a PRECONDITION, DERIVED: every mapped code is one the referee really puts on `rejected`', () => {
    // Replaces a hardcoded list of three code names, one of which
    // (`READINESS_DOWNGRADE`) resolves only to `held` and could never fire
    // here. Each case below is a REAL operation through the REAL gate; the
    // codes are read off the decision, never asserted from memory.
    const emitted = new Map<string, string>();
    for (const [name, ops] of [
      ['rename a node that is not there', [{ op: 'update_node', path: 'no-such-node', value: { label: 'X' } }]],
      ['add a node at an id already taken', [{ op: 'add_node', path: 'f-spend', value: { id: 'f-spend', kind: 'factor', label: 'Team morale' } }]],
    ] as ReadonlyArray<readonly [string, readonly unknown[]]>) {
      const d = gate(ops);
      expect(d.governing, name).toBe('rejected');
      const code = blockerCodeOf(d);
      expect(code, `${name} must carry a blocker code`).not.toBeNull();
      emitted.set(code!, name);
      // the WIRING: the decision's own text is the map's entry for its own code
      expect(d.assistantText, name).toBe(GM_REJECTED_COPY_BY_BLOCKER_CODE[code!]);
    }
    // Both directions: every mapped key was witnessed, and every witnessed
    // code is mapped. A map entry no operation can produce would fail here.
    expect([...emitted.keys()].sort()).toEqual(
      Object.keys(GM_REJECTED_COPY_BY_BLOCKER_CODE).sort(),
    );
  });

  it('R2b an unmapped code reaches the person as the generic sentence, at the real gate', () => {
    for (const [name, ops] of [
      ['an op kind that never parsed (UNKNOWN_KIND)', [{ op: 'exotic_future_op', path: 'x' }]],
      [
        'a batch refused on its length (BATCH_CAP_EXCEEDED)',
        Array.from({ length: 9 }, (_, i) => ({
          op: 'add_node',
          path: `n${i}`,
          value: { id: `n${i}`, kind: 'factor', label: `N${i}` },
        })),
      ],
    ] as ReadonlyArray<readonly [string, readonly unknown[]]>) {
      const d = gate(ops);
      expect(d.governing, name).toBe('rejected');
      expect(d.assistantText, name).toBe(GM_REJECTED_ASSISTANT_TEXT);
    }
  });

  it('R2c ⛔ ORDER-SWAPPED SIBLINGS MUST NOT PRODUCE A CONFIDENT CAUSE — the cascade', () => {
    // The same two operations, in both orders. `advanceBatchGraph`
    // (referee.ts:504-508) does not advance the working view past a held or
    // rejected envelope, so in the reverse order the edge is judged against a
    // graph its own sibling was never allowed to reach. Nothing was wrong with
    // the node reference.
    const addNode = { op: 'add_node', path: 'n-x', value: { id: 'n-x', kind: 'factor', label: 'New factor' } };
    const addEdge = { op: 'add_edge', path: 'e', value: { from: 'n-x', to: 'g-profit' } };

    const forward = gate([addNode, addEdge]);
    expect(forward.governing, 'forward order is held, and claims nothing').toBe('held');

    const reverse = gate([addEdge, addNode]);
    expect(reverse.governing).toBe('rejected');
    expect(blockerCodeOf(reverse), 'the cascade really does surface as ENTITY_NOT_FOUND').toBe(
      'ENTITY_NOT_FOUND',
    );

    // ⚠ THE PRECONDITION THAT MAKES THIS TEST DISCRIMINATE, PINNED IN-TEST:
    // the commissioned remedy was `verdictCounts.rejected === 1`. If this
    // batch ever stops satisfying it, the test would pass for the wrong
    // reason — so assert that it DOES satisfy it and is caught anyway.
    expect(
      reverse.verdictCounts.rejected,
      'a rejected-count predicate would let this through, which is why it is not the predicate',
    ).toBe(1);

    expect(
      reverse.assistantText,
      'must not name a cause a sibling created',
    ).toBe(GM_REJECTED_ASSISTANT_TEXT);
    expect(reverse.assistantText ?? '').not.toMatch(/not in the model/i);
    expect(reverse.assistantText ?? '').not.toMatch(/something that is there/i);
  });

  it('R2d the same cascade on the OTHER mapped code — a clash with a sibling, not with the model', () => {
    // `[add_node D, add_node D]`: the second collides only because
    // `advanceBatchGraph` put the first into the working view, and the first
    // is merely HELD — nothing has been applied. "clashes with something
    // already in the model" would be false.
    const dup = { op: 'add_node', path: 'n-dup', value: { id: 'n-dup', kind: 'factor', label: 'Duplicate' } };
    const d = gate([dup, dup]);
    expect(d.governing).toBe('rejected');
    expect(blockerCodeOf(d)).toBe('ENTITY_ID_COLLISION');
    expect(d.verdictCounts.rejected, 'again passes the rejected-count predicate').toBe(1);
    expect(d.assistantText).toBe(GM_REJECTED_ASSISTANT_TEXT);
    expect(d.assistantText ?? '').not.toMatch(/already in the model/i);
  });

  it('R2e ⭐ THE OTHER HALF OF THE PAIR: a SINGLE-envelope batch keeps its specific cause', () => {
    // Without this, R2c/R2d would also pass if the fix had simply deleted the
    // map. The gap must be exactly the cascade, not the whole capability.
    const d = gate([{ op: 'update_node', path: 'no-such-node', value: { label: 'X' } }]);
    expect(d.governing).toBe('rejected');
    expect(d.verdictCounts.rejected).toBe(1);
    expect(d.assistantText).toBe(GM_REJECTED_COPY_BY_BLOCKER_CODE.ENTITY_NOT_FOUND);
    expect(d.assistantText).not.toBe(GM_REJECTED_ASSISTANT_TEXT);
  });
});

/**
 * ⛔ R3 (the onward chip) IS DELIBERATELY ABSENT FROM THIS SPEC.
 *
 * The chip shipped here first and turned `structural-edit-batch-atomicity
 * .test.ts:182` red — an assertion that a rejected batch carries no chips,
 * written under the name "no chip to confirm". I established that the harm
 * that guard prevents is a confirmable PENDING (resumption is gated on
 * `pendingActions`, not chips) and that this arm leaves pendings null, so the
 * assertion is a proxy rather than the invariant.
 *
 * That is an argument for narrowing another lane's safety assertion, and it is
 * not one to act on unreviewed as the author of the change it blocks. The
 * cause ships; the route is a separate reviewed change. Tests for the chip
 * belong with it, not here asserting behaviour that no longer exists.
 */

// ── R5 — authorship: true on an advice turn as well as an edit turn ────────

describe('R5 — no sentence blames the user for a request they may not have made', () => {
  it('R5a ⭐ nothing attributes the attempted change to the user', () => {
    // This arm CANNOT tell an edit turn from an advice turn: the evaluation
    // input carries no intent field. So every sentence must be true when the
    // user asked for nothing at all. "The node YOU asked to rename does not
    // exist" is a false statement about a request that was never made.
    const FORBIDDEN = [
      /\byou asked\b/i,
      /\byour request\b/i,
      /\byou requested\b/i,
      /\byou wanted\b/i,
      /\bthe change you\b/i,
      /\byou tried\b/i,
    ];
    for (const text of ALL_COPY) {
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(text), `"${text.slice(0, 50)}" attributes to the user`).toBe(false);
      }
    }
  });

  it('R5b every sentence offers to talk it through, so an advice turn is answered', () => {
    for (const text of ALL_COPY) {
      expect(text.toLowerCase(), text.slice(0, 40)).toMatch(/suggest|talk through|tell me/);
    }
  });
});

// ── R6 — the lane's inherited copy constraints ─────────────────────────────

describe('R6 — copy obeys the constraints this lane already carries', () => {
  it('R6a no em dashes', () => {
    for (const text of ALL_COPY) expect(text).not.toContain('—');
  });

  it('R6b no backticks, ids, or internal vocabulary leaking from diagnostics', () => {
    // `blocker_readable` carries exactly this ("top-level `options`", "failed
    // schema validation"), which is why it is NOT passed through verbatim.
    for (const text of ALL_COPY) {
      expect(text).not.toContain('`');
      expect(text).not.toMatch(/\b(schema|validation|node id|edge id|candidate|hash)\b/i);
    }
  });

  it('R6c no success claim — nothing here may read as though a change landed', () => {
    for (const text of ALL_COPY) {
      expect(text).not.toMatch(/\b(applied|updated|saved|added it|has been)\b/i);
    }
  });
});
