/**
 * ⭐⭐ THE ROUTER MUST NEVER SUBSTITUTE ITS OWN TASK FOR THE USER'S — the fourth twin.
 *
 * Live journey witness 18 Aug 2026, deployed CEE `585f8dce`, turn 2 VERBATIM:
 *
 *   user: "Why did you add a hybrid phased option? I never mentioned one —
 *          where did that come from?"
 *   Olumi: "I don't have a record of recent edits in this conversation. If you'd
 *          like to make a change, tell me what to update and I'll do it directly."
 *          (`_diagnostic_trace.llm_calls: []` — no model was called at all)
 *
 * The witness identified the producer by EXECUTION with contrast controls: the
 * message matches `did you (change|update|apply|add)` in `STATE_QUERY_PATTERNS`,
 * so the guard claimed a provenance challenge and answered an edit-history
 * question instead. Its own header says "keep the gate narrow".
 *
 * ⚠ THE TWO HALVES ARE BOTH REQUIRED. Without the readback twins below, a
 * blanket disable of the guard passes this file (trap 22b).
 */
import { describe, expect, it } from 'vitest';

import type { ContextPack } from '../../context/context-pack-assembler.js';
import type { RecentMutation } from '../../context/recent-changes.js';
import { tryStructureOriginAnswer } from '../../../cee/context-integrity/structure-origin-answer.js';
import { isStateQueryQuestionShape, tryStateQueryGuard } from '../state-query-guard.js';

const WITNESS_TURN_2 =
  'Why did you add a hybrid phased option? I never mentioned one — where did that come from?';

/**
 * ⚠⚠ THE PERSISTED V3 SHAPE, AND THAT IS THE POINT OF ROUND 3.
 *
 * Rounds 1 and 2 passed this guard a RECORDS-DICT graph
 * (`provenance: { provenance_class, basis, unbased }`). Persistence never
 * produces that shape: `transformNodeToV3` (`cee/transforms/schema-v3.ts:222`)
 * rebuilds each node field-by-field without ever naming `provenance`, and every
 * later assignment to `v3Node.provenance` is a STRING. The guard reads
 * `input.briefAudit.graph` = `context.persistedGraph` = the `scenarios.graph`
 * column, so a dict-shaped fixture here tested a seam the product does not have
 * — and the arm was DARK end to end while these tests were green.
 *
 * Fields derived from the producer, not invented: string `provenance` at
 * `schema-v3.ts:1136`, `source_quote` lifted at `:1145`.
 */
const WITNESS_GRAPH = {
  nodes: [
    {
      id: '939d4630',
      kind: 'option',
      label: 'Hybrid Phased Approach (Pilot Self-Serve, Maintain Enterprise)',
      provenance: 'ai_inferred',
    },
    {
      id: '4abad64d',
      kind: 'option',
      label: 'double down on enterprise sales (higher margins but longer cycles and more headcount)',
      provenance: 'from_brief',
      source_quote:
        'double down on enterprise sales (higher margins but longer cycles and more headcount)',
    },
  ],
  edges: [],
};

const ADD_CONSTRAINT_50K: RecentMutation = {
  action: 'constraint_added',
  summary: 'Added constraint: Total cost must be at most £50,000.',
  target_label: 'Total cost',
};

function ctx(recent: readonly RecentMutation[]): Pick<ContextPack, 'recent_changes'> {
  return { recent_changes: recent };
}

describe('the witnessed defect — a provenance challenge is not an edit-history question', () => {
  it('RED-A turn 2 VERBATIM no longer receives the no_recent_changes deflection', () => {
    const outcome = tryStateQueryGuard({
      message: WITNESS_TURN_2,
      contextPack: ctx([]),
      briefAudit: { briefText: 'We are a Series A healthtech startup...', graph: WITNESS_GRAPH },
    });
    // The precise harm: dispatch === 'no_recent_changes'.
    if (outcome.matched) {
      expect(outcome.dispatch).not.toBe('no_recent_changes');
    }
  });

  it('RED-B turn 2 VERBATIM is answered from provenance, naming the element by identity', () => {
    const outcome = tryStateQueryGuard({
      message: WITNESS_TURN_2,
      contextPack: ctx([]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH },
    });
    expect(outcome.matched).toBe(true);
    if (!outcome.matched) return;
    expect(outcome.dispatch).toBe('structure_origin');
    expect(outcome.assistant_text).toContain(
      'Hybrid Phased Approach (Pilot Self-Serve, Maintain Enterprise)',
    );
    expect(outcome.assistant_text.toLowerCase()).toContain('my suggestion');
  });

  it('RED-C the deflection text is never produced for an origin question, even when unanswerable', () => {
    // Unresolvable element: the guard must DECLINE (-> the reasoning layer),
    // never fall through to the canned edit-history copy.
    const outcome = tryStateQueryGuard({
      message: 'Why did you add a marketing budget line? Where did that come from?',
      contextPack: ctx([]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH },
    });
    expect(outcome.matched).toBe(false);
  });

  it('RED-D an origin question is never granted a mutation warrant (a question must not change what it asks about)', () => {
    expect(isStateQueryQuestionShape(WITNESS_TURN_2)).toBe(true);
  });
});

// ⭐⭐ OPPOSITE-DIRECTION TWINS — what the guard legitimately protects.
describe('TWIN: the readback class the guard exists for is unchanged', () => {
  it('TWIN-1 "Did you add the cost constraint?" still gets the recent-change readback', () => {
    const outcome = tryStateQueryGuard({
      message: 'Did you add the cost constraint?',
      contextPack: ctx([ADD_CONSTRAINT_50K]),
    });
    expect(outcome.matched).toBe(true);
    if (!outcome.matched) return;
    expect(outcome.dispatch).toBe('with_recent_change');
    expect(outcome.assistant_text).toContain('£50,000');
  });

  it('TWIN-2 with no recorded edits the readback class STILL gets the honest no_recent_changes copy', () => {
    const outcome = tryStateQueryGuard({ message: 'Did you add it?', contextPack: ctx([]) });
    expect(outcome.matched).toBe(true);
    if (!outcome.matched) return;
    expect(outcome.dispatch).toBe('no_recent_changes');
  });

  it('TWIN-3 "What changed?" is untouched', () => {
    const outcome = tryStateQueryGuard({
      message: 'What changed?',
      contextPack: ctx([ADD_CONSTRAINT_50K]),
    });
    expect(outcome.matched).toBe(true);
    if (!outcome.matched) return;
    expect(outcome.dispatch).toBe('with_recent_change');
  });

  it('TWIN-4 a fresh edit imperative is still not claimed', () => {
    const outcome = tryStateQueryGuard({
      message: 'add a constraint about cost being below 50000',
      contextPack: ctx([]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH },
    });
    expect(outcome.matched).toBe(false);
  });

  it('TWIN-5 a compound origin+edit turn falls through to normal routing', () => {
    const outcome = tryStateQueryGuard({
      message: 'Why did you add a hybrid phased option? Add another option for partnerships.',
      contextPack: ctx([]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH },
    });
    expect(outcome.matched).toBe(false);
  });

  it('TWIN-6 the deferral is SUBJECT-BOUND: a recorded change to the SAME element still defers', () => {
    // trap 22f: where direction cannot be determined, do not guess. The
    // readback arm quotes a REAL persisted mutation; that is grounded.
    //
    // ⚠⚠ THIS TEST PINS ITS OWN PRECONDITION, AND THE FIRST VERSION DID NOT —
    // it asked about "the cost constraint", which resolves to NO element in this
    // fixture, so the origin arm declined for the wrong reason and the
    // assertion sat behind an `if (outcome.matched)` that never fired. It
    // passed VACUOUSLY, and the deferral-removal mutant (M7) SURVIVED it.
    // Caught by the mutant, not by inspection (trap 13b: a guard whose
    // discrimination depends on a fixture nothing pins).
    //
    // ⚠ MESSAGE CHANGED IN ROUND 2. 'why did you CHANGE x' is no longer an
    // origin question at all — the narrowed frame requires a creation/inclusion
    // predicate — so it would have made this test vacuous a second time.
    //
    // ⚠⚠ FIXTURE CHANGED IN ROUND 4, AND THE REASON IS THE WHOLE FINDING OF THAT
    // ROUND. The recorded mutation here was `ADD_CONSTRAINT_50K` — target
    // "Total cost" — while the question asks about the HYBRID OPTION. Those
    // subjects are DISJOINT, so what this test actually pinned was the guard
    // answering a provenance challenge with a receipt about something else
    // entirely. That is not the ambiguity trap 22f is about; it is the very
    // defect the origin arm exists to remove, and it went live: composed journey
    // witness 18 Aug 2026 on `4a513781`, LINK 6 —
    //   "Why did you add a status quo option? …"
    //   -> "Updated Enterprise sales headcount and spend"  (`llm_calls: 0`)
    // The deferral is therefore SUBJECT-BOUND now, and this test pins the case it
    // was always meant to pin: the recorded change is about the element asked
    // about, so the two readings really are indistinguishable and we do not guess.
    const message = 'Why did you add the Hybrid Phased Approach?';
    expect(tryStructureOriginAnswer(message, WITNESS_GRAPH)).not.toBeNull();

    const changeToTheSameElement: RecentMutation = {
      action: 'graph_edited',
      summary: 'Updated Hybrid Phased Approach (Pilot Self-Serve, Maintain Enterprise)',
      target_label: 'Hybrid Phased Approach (Pilot Self-Serve, Maintain Enterprise)',
    };
    const outcome = tryStateQueryGuard({
      message,
      contextPack: ctx([changeToTheSameElement]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH },
    });
    expect(outcome.matched).toBe(true);
    if (!outcome.matched) return;
    expect(outcome.dispatch).toBe('with_recent_change');
  });

  it('TWIN-6b …and a recorded change to a DIFFERENT element does NOT defer', () => {
    // ⭐ THE OPPOSITE-DIRECTION TWIN (trap 22b). Without it, "always defer" passes
    // TWIN-6 and the live defect ships again. Same message, same graph, same
    // pinned precondition — only the recorded change's SUBJECT differs, so the
    // deferral is the only thing that can produce a different outcome.
    const message = 'Why did you add the Hybrid Phased Approach?';
    expect(tryStructureOriginAnswer(message, WITNESS_GRAPH)).not.toBeNull();

    const outcome = tryStateQueryGuard({
      message,
      contextPack: ctx([ADD_CONSTRAINT_50K]), // target_label: 'Total cost'
      briefAudit: { briefText: null, graph: WITNESS_GRAPH },
    });
    // ⚠ ASSERTED POSITIVELY. The first version wrapped both assertions in
    // `if (outcome.matched)`, so it made NO claim at all on the decline path —
    // the same vacuity shape TWIN-6 itself was twice repaired for. The measured
    // outcome is a decline to the reasoning layer; assert exactly that.
    expect(outcome.matched).toBe(false);
  });
});

// ⭐ DERIVED COVERAGE GUARD (trap 12 / the brief's "no hand-maintained-and-silent
// list"): every origin-frame pattern must be exercised by the corpus above, and
// the origin and readback classes must be DISJOINT over it. A pattern added
// without a case fails LOUD here rather than shipping unobserved.
describe('the origin frame is exercised and disjoint (fail-loud, not hand-maintained)', () => {
  it('RED-E every ORIGIN_FRAME_PATTERNS entry is exercised by at least one corpus message', async () => {
    const mod = await import('../../../cee/context-integrity/structure-origin-answer.js');
    const patterns = (mod as unknown as { ORIGIN_FRAME_PATTERNS: readonly RegExp[] })
      .ORIGIN_FRAME_PATTERNS;
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);
    const corpus = [
      WITNESS_TURN_2,
      'Why is there a hybrid phased option in my model?',
      'What is the hybrid phased option based on?',
      'Where did the hybrid phased option come from?',
      'On what basis did you add the hybrid phased option?',
      'What made you add a hybrid phased option?',
      'How did the hybrid phased option end up in my model?',
    ];
    const unexercised = patterns.filter((p) => !corpus.some((m) => p.test(m)));
    expect(unexercised.map(String)).toEqual([]);
  });
});

// ============================================================================
// ⭐⭐ THE SHAPE THE GUARD MUST NOT BE CERTIFIED BY
// ============================================================================
describe('a pre-boundary fixture can never certify this arm again', () => {
  it('RED-F a records-dict graph produces NO structure_origin dispatch, and no deflection either', () => {
    const preBoundary = {
      nodes: [
        {
          id: '939d4630',
          kind: 'option',
          label: 'Hybrid Phased Approach (Pilot Self-Serve, Maintain Enterprise)',
          provenance: { provenance_class: 'ai_inferred', basis: ['4abad64d'], unbased: false },
        },
      ],
      edges: [],
    };
    const outcome = tryStateQueryGuard({
      message: WITNESS_TURN_2,
      contextPack: ctx([]),
      briefAudit: { briefText: null, graph: preBoundary },
    });
    // Declines to the reasoning layer. Critically it must ALSO not fall back to
    // the edit-history deflection, which is the harm this arm exists to remove.
    expect(outcome.matched).toBe(false);

    // ⭐ POSITIVE CONTROL in the same run: the identical turn on the PERSISTED
    // shape IS claimed. Without it, RED-F would also pass on a dead guard.
    const live = tryStateQueryGuard({
      message: WITNESS_TURN_2,
      contextPack: ctx([]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH },
    });
    expect(live.matched).toBe(true);
    if (!live.matched) return;
    expect(live.dispatch).toBe('structure_origin');
  });

  /**
   * ⭐ P1 — ONE SEAM BEYOND THE GUARD.
   *
   * The module's own seam is `tryStructureOriginAnswer`, and RED-11 covers a
   * null/empty graph there. The seam PAST it is the guard, which is what the
   * turn-executor calls and whose outcome becomes the user's reply
   * (`turn-executor.ts:7078`, `composeAnswer({answerKind:'functional'})`). A
   * throw here would take the whole turn, not just the origin answer.
   *
   * `context.persistedGraph` is typed `unknown` and comes straight from a JSONB
   * column, so every one of these shapes is reachable on a degraded read. Each
   * must DECLINE — never throw, and never fall back to the edit-history
   * deflection, which is the harm the arm exists to remove.
   */
  it('RED-I a malformed persisted graph declines through the REAL guard without throwing', () => {
    const malformed: readonly unknown[] = [
      null,
      undefined,
      'not a graph',
      42,
      [],
      {},
      { nodes: 'not an array' },
      { nodes: [null, 7, 'x'] },
      { nodes: [{ id: 939, kind: 'option', label: 'Hybrid Phased Approach' }] },
      { nodes: [{ id: 'a', kind: 'option', label: '' }] },
      { nodes: [{ id: 'a', kind: 'option', label: 'Hybrid Phased Approach', provenance: ['ai_inferred'] }] },
      { nodes: [{ id: 'a', kind: 'option', label: 'Hybrid Phased Approach', provenance: 'ai_inferred', source_quote: 99 }] },
    ];
    for (const graph of malformed) {
      const outcome = tryStateQueryGuard({
        message: WITNESS_TURN_2,
        contextPack: ctx([]),
        briefAudit: { briefText: null, graph },
      });
      // Declines to the reasoning layer.
      expect(outcome.matched, `graph ${JSON.stringify(graph)} was claimed`).toBe(false);
    }

    // ⭐ POSITIVE CONTROL in the same run — a WELL-FORMED graph is still claimed,
    // so the loop above is not passing because the guard is simply dead.
    const live = tryStateQueryGuard({
      message: WITNESS_TURN_2,
      contextPack: ctx([]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH },
    });
    expect(live.matched).toBe(true);
  });

  it('RED-G an ANALYSIS question is not claimed by the guard at all', () => {
    const outcome = tryStateQueryGuard({
      message: 'Why is the hybrid option scoring highest in the analysis?',
      contextPack: ctx([]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH },
    });
    // Neither answered from provenance NOR deflected — it belongs to the
    // reasoning layer.
    expect(outcome.matched).toBe(false);
  });

  it('RED-H the from_brief element is quoted back through the guard, not just through the module', () => {
    const outcome = tryStateQueryGuard({
      message: 'Where did double down on enterprise sales come from?',
      contextPack: ctx([]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH },
    });
    expect(outcome.matched).toBe(true);
    if (!outcome.matched) return;
    expect(outcome.dispatch).toBe('structure_origin');
    expect(outcome.assistant_text.toLowerCase()).toContain('your brief');
    expect(outcome.assistant_text).toContain('You wrote:');
  });
});
