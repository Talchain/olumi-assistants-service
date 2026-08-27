/**
 * RUN-OVER-RUN CONSEQUENCE — THE WIRE, AT THE RENDERED PROMPT BYTES.
 *
 * `run_delta` is System C's consequence: what changed between two runs and what
 * it means, derived from real prior analytical state. The producer merged
 * (#1160) and was threaded (#1166) — but it ran ONLY inside
 * `finaliseV5Response` (`response-finaliser.ts` → `attachRunDelta`), which is
 * response assembly, i.e. AFTER the model call BY CONSTRUCTION. Measured before
 * this change through the real chain: a genuine two-run `priorFacts` array
 * yielded a 2,740-char prompt containing ZERO `run_delta`. The model was told a
 * rerun had happened and never what changed.
 *
 * WHAT THIS SUITE PINS, AND WHY IT IS ROUTE-LEVEL
 * ----------------------------------------------
 * It drives the REAL `assembleContextPack` → `buildUserMessage` chain and reads
 * the SERIALISED PACK the model receives, not the assembler's return value. A
 * pack field that never reaches `buildUserMessage`'s output is dark, and only
 * the rendered bytes can tell the two apart.
 *
 * ⭐ BOUND BY IDENTITY, NEVER BY A VALUE ANOTHER SLICE COULD SATISFY (trap 19).
 * Every assertion below reads `serialised.run_delta` — the slice's OWN subtree,
 * extracted from the pack — and never `toContain` over the whole prompt string.
 * This is not a stylistic preference: the sibling `factor_values` slice was
 * caught by exactly that shortcut, its assertion matching a factor label the
 * `graph` slice ALSO carried, so two of its four wire tests passed with the
 * wiring deleted. Option ids here (`opt-a`) would likewise appear in the
 * `analysis` block, so a whole-prompt substring match would prove nothing.
 *
 * ⭐ THE ABSENCE ARM IS THE POINT OF THE SUITE, NOT ITS FOOTNOTE. The producer
 * REFUSES on every pair it cannot honestly classify, and its header states the
 * doctrine: "THE OMIT PATH IS THE DEFAULT AND IT IS NOT A DEGRADED STATE… a
 * fabricated comparison is worse than an absent one." A test that only checks
 * the PRESENT case cannot see the property that matters — absence staying
 * absent — so REFUSED_PAIR below is written as the discriminating twin of
 * PRESENT_PAIR, over the SAME assertions.
 */

import { describe, it, expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { assembleContextPack } from '../context-pack-assembler.js';
import {
  buildUserMessage,
  RUN_DELTA_INSTRUCTION,
} from '../../routing/route-with-tool-use.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { buildRunDelta } from '../../coaching/build-run-delta.js';
import { observeSerialisedPack } from './observe-serialised-pack.js';

const MESSAGE = 'should I be worried about that?';

/**
 * A persisted `run_analysis` fact carrying the four PRODUCER ECHOES the
 * producer requires (`seed_used`, `graph_hash_at_run`, `_meta.builds`,
 * `n_samples`) plus the run's own leader-claim verdict. Shaped from the
 * measured probe that established the pre-change absence.
 */
function fact(
  options: readonly { id: string; win: number }[],
  seed: string,
  hash: string,
  at: string,
  mayName = true,
): HandlerFact {
  return {
    fact_type: 'run_analysis',
    noop: false,
    result: {
      enrichment: {
        analysis_status: 'completed',
        results: options.map((o) => ({
          option_id: o.id,
          option_label: o.id === 'opt-a' ? 'Offshore partner' : 'Hire locally',
          win_probability: o.win,
        })),
        meta: { seed_used: seed, n_samples: 10_000 },
        _meta: { builds: { plot: 'p1', isl: 'i1' } },
      },
      computed_at: at,
      graph_hash_at_run: hash,
      constraint_verdict: {
        may_name_leading_option: mayName,
        constraint_verdict_state: 'evaluated_feasible' as const,
      },
    },
  } as unknown as HandlerFact;
}

/** A genuine pair: the leader flips opt-a → opt-b across an edit (hashes differ). */
const PRESENT_PAIR: readonly HandlerFact[] = [
  fact([{ id: 'opt-a', win: 0.45 }, { id: 'opt-b', win: 0.55 }], '222', 'hash-b', '2026-06-07T00:00:00.000Z'),
  fact([{ id: 'opt-a', win: 0.62 }, { id: 'opt-b', win: 0.38 }], '111', 'hash-a', '2026-06-06T00:00:00.000Z'),
];

/**
 * A pair the producer REFUSES: exactly ONE successful run in the window, so
 * `selectTwoNewestRunAnalysisFacts` returns null → `insufficient_runs`.
 *
 * Deliberately the SAME fact object as the present pair's newest member, so the
 * two arms differ in ONE property — whether a comparable pair exists — and not
 * in option ids, labels, seeds or any other content. A refusal arm that also
 * changed the labels could pass by carrying no recognisable content at all.
 */
const REFUSED_PAIR: readonly HandlerFact[] = [PRESENT_PAIR[0]!];

function render(priorFacts: readonly HandlerFact[]): {
  prompt: string;
  serialised: Record<string, unknown>;
} {
  const pack = assembleContextPack({
    payload: makeMessagePayload({ scenario_id: 'scen-run-delta-wire', message: MESSAGE }),
    priorTurns: [],
    priorFacts,
    priorFactsReadOk: true,
    graphContext: { status: 'canonical' },
    mayNameLeadingOption: true,
  });
  const prompt = buildUserMessage(pack, MESSAGE);
  return { prompt, serialised: observeSerialisedPack(prompt) };
}

describe('run_delta reaches the rendered routing prompt', () => {
  /**
   * PRECONDITION PINNED IN-TEST (trap 13b). Every assertion below is about
   * whether a DERIVABLE consequence reaches the model. If the producer refused
   * this pair for an unrelated reason — a fixture drift in the echoes, say —
   * the absence assertions would pass by testing nothing and the presence
   * assertions would fail for the wrong reason. Prove the pair is derivable
   * FIRST, and prove the refused pair is genuinely refused.
   */
  it('PRECONDITION — the producer accepts the present pair and refuses the other', () => {
    const ok = buildRunDelta({ priorFacts: PRESENT_PAIR, mayNameLeadingOption: true });
    expect(ok.kind, 'the present pair must be derivable or this suite is vacuous').toBe('ok');
    if (ok.kind !== 'ok') throw new Error('unreachable');
    expect(ok.delta.leader.changed, 'the pair must carry a REAL consequence').toBe(true);

    const refused = buildRunDelta({ priorFacts: REFUSED_PAIR, mayNameLeadingOption: true });
    expect(refused.kind, 'the refused pair must be REFUSED or the absence arm is vacuous').toBe('none');
    if (refused.kind !== 'none') throw new Error('unreachable');
    expect(refused.reason).toBe('insufficient_runs');
  });

  it('PRESENT — the producer-computed delta reaches the model, bound by identity', () => {
    const { serialised } = render(PRESENT_PAIR);

    // IDENTITY: the slice's own subtree, never a substring of the whole prompt.
    const delta = serialised.run_delta as Record<string, unknown> | undefined;
    expect(delta, '`run_delta` is absent from the serialised pack the model receives').toBeDefined();

    // The consequence itself: leader change, named by ID (never by label).
    const leader = delta!.leader as Record<string, unknown>;
    expect(leader.changed).toBe(true);
    expect(leader.prior_leading_option_id).toBe('opt-a');
    expect(leader.current_leading_option_id).toBe('opt-b');

    // Per-option movement WITH its noise verdict — the half that makes the
    // number sayable. A movement with no verdict is exactly the fabrication
    // the producer exists to prevent.
    const wins = delta!.win_probabilities as ReadonlyArray<Record<string, unknown>>;
    const a = wins.find((w) => w.option_id === 'opt-a');
    expect(a, 'the option under test must be present by ID').toBeDefined();
    expect(a!.prior).toBe(0.62);
    expect(a!.current).toBe(0.45);
    expect(
      ['signal', 'within_noise', 'not_noise_qualified'],
      'every movement must carry a noise verdict',
    ).toContain(a!.noise_verdict);

    // Attribution + provenance ride along so the claim is auditable.
    expect(delta!.attribution_case).toBeDefined();
    expect(delta!.pair_provenance).toBeDefined();
  });

  /**
   * ⛔ THE FROZEN SLOT MUST NOT BE PROJECTED. `flip_thresholds` is emitted
   * frozen-EMPTY by the producer (`RUN_DELTA_FLIP_THRESHOLDS_NOT_COMPUTED`)
   * because the flip-threshold join is DEFERRED and never looked. Its own
   * header: "an empty array is NOT a neutral placeholder: read naively it
   * asserts THERE ARE NO FLIP THRESHOLDS, which is a claim" — and an LLM is
   * precisely a naive reader. Serialising `[]` would hand the model a
   * computed-looking answer to a question nothing asked.
   */
  it('FROZEN SLOT — flip_thresholds is stripped, not passed through as an empty claim', () => {
    const { serialised } = render(PRESENT_PAIR);
    const delta = serialised.run_delta as Record<string, unknown>;
    expect(Object.keys(delta)).not.toContain('flip_thresholds');
    // CONTRAST CONTROL of plausible magnitude: the sibling keys ARE there, so
    // the assertion above is not passing on an empty/missing subtree.
    expect(Object.keys(delta).length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(delta)).toContain('win_probabilities');
  });

  /**
   * ⭐ THE DISCRIMINATING TWIN. On a pair the producer refuses, the prompt must
   * say NOTHING about what changed. Absence staying absent is the property;
   * a suite that only checked the present case could not see it.
   */
  it('REFUSED — a pair the producer refuses puts NO comparison in front of the model', () => {
    const { serialised } = render(REFUSED_PAIR);

    expect(serialised.run_delta, 'a REFUSAL must project no key at all').toBeUndefined();
    expect(Object.keys(serialised)).not.toContain('run_delta');

    // No consequence content anywhere on the pack under another name.
    const asText = JSON.stringify(serialised);
    expect(asText).not.toContain('attribution_case');
    expect(asText).not.toContain('noise_verdict');
    expect(asText).not.toContain('prior_leading_option_id');

    // CONTRAST CONTROL, same run, plausible magnitude: the instrument can see
    // the pack, and the pack demonstrably CONSUMED this fact array — so the
    // zeros above cannot be the assembler simply never receiving the facts.
    expect(Object.keys(serialised).length).toBeGreaterThan(5);
    expect(Object.keys(serialised)).toContain('recent_changes');
  });

  /**
   * ⛔⛔ THE ABSENCE GUARD ITSELF. The licence text must reach the model on the
   * turn where `run_delta` is ABSENT — that is the turn the guard governs, and
   * absence is the producer's DEFAULT path, not an edge case. An instruction
   * gated on the field's PRESENCE would render this rule only on the turns that
   * do not need it: a conditionally-emitted absence clause is dead text.
   *
   * MUTANT: gate the emission on `contextPack.run_delta !== undefined` and this
   * test REDs while every other test in this file stays green — which is the
   * discrimination, since the present arm cannot see this property at all.
   */
  it('ABSENCE GUARD — the model is told not to infer a consequence when the field is absent', () => {
    const { prompt, serialised } = render(REFUSED_PAIR);

    // PRECONDITION: this really is the absent arm.
    expect(serialised.run_delta).toBeUndefined();

    // The guard is RENDERED on precisely that turn.
    expect(
      prompt.includes(RUN_DELTA_INSTRUCTION),
      'the run_delta licence is NOT rendered on a refused turn — the absence rule is dead text',
    ).toBe(true);

    // And it genuinely FORBIDS inference rather than merely mentioning absence.
    expect(RUN_DELTA_INSTRUCTION).toContain('IF NO `run_delta` BLOCK APPEARS ABOVE, YOU DO NOT KNOW WHAT CHANGED');
    expect(RUN_DELTA_INSTRUCTION).toContain('NEVER means nothing changed');
    // The flip-threshold silence is the SECOND absence and fails the same way.
    expect(RUN_DELTA_INSTRUCTION).toContain('THAT SILENCE IS NOT A FINDING');
  });

  it('ABSENCE GUARD — the same licence is rendered on the present turn too', () => {
    const { prompt, serialised } = render(PRESENT_PAIR);
    expect(serialised.run_delta).toBeDefined();
    expect(prompt.includes(RUN_DELTA_INSTRUCTION)).toBe(true);
    // Rendered EXACTLY once — a duplicated licence block would be a second
    // emission site, which is how two chokepoints for one permission start.
    expect(prompt.split(RUN_DELTA_INSTRUCTION)).toHaveLength(2);
  });

  /**
   * The leader half of the wire, pinned separately. `mayNameLeadingOption` is
   * FAIL-CLOSED in the assembler, so dropping the turn-executor's thread does
   * not remove the delta — it silently strips the leader ids, which is the
   * quieter failure and needs its own red.
   */
  it('LEADER PERMISSION — an unentitled turn keeps the delta but names no leader', () => {
    const pack = assembleContextPack({
      payload: makeMessagePayload({ scenario_id: 'scen-run-delta-wire', message: MESSAGE }),
      priorTurns: [],
      priorFacts: PRESENT_PAIR,
      priorFactsReadOk: true,
      graphContext: { status: 'canonical' },
      mayNameLeadingOption: false,
    });
    const delta = observeSerialisedPack(buildUserMessage(pack, MESSAGE)).run_delta as
      | Record<string, unknown>
      | undefined;

    expect(delta, 'withholding the leader must not delete the whole consequence').toBeDefined();
    const leader = delta!.leader as Record<string, unknown>;
    expect(leader.prior_leading_option_id).toBeUndefined();
    expect(leader.current_leading_option_id).toBeUndefined();
    // Indeterminate folds to false — a false "your leader changed" rewrites the
    // user's decision; a false "nothing changed" merely withholds.
    expect(leader.changed).toBe(false);
    // CONTRAST CONTROL: the movement numbers are NOT leader claims and survive.
    expect((delta!.win_probabilities as unknown[]).length).toBeGreaterThan(0);
  });

  /**
   * The fail-closed default, pinned. A caller that does not thread the
   * permission must get NO leader ids — never a promoted claim.
   */
  it('FAIL-CLOSED — an unthreaded permission names no leader', () => {
    const pack = assembleContextPack({
      payload: makeMessagePayload({ scenario_id: 'scen-run-delta-wire', message: MESSAGE }),
      priorTurns: [],
      priorFacts: PRESENT_PAIR,
      priorFactsReadOk: true,
      graphContext: { status: 'canonical' },
      // mayNameLeadingOption deliberately NOT passed.
    });
    const delta = observeSerialisedPack(buildUserMessage(pack, MESSAGE)).run_delta as
      | Record<string, unknown>
      | undefined;
    expect(delta).toBeDefined();
    const leader = delta!.leader as Record<string, unknown>;
    expect(leader.prior_leading_option_id).toBeUndefined();
    expect(leader.current_leading_option_id).toBeUndefined();
  });

  /**
   * ⭐ RUN_DELTA_IS_STRUCTURAL_NOT_PROSE — measured, not assumed.
   *
   * `prompt-pack-sanction.gate.test.ts` only fires on PROSE-BEARING fields
   * (`proseLeaves`: string leaves of >= 4 words). This field carries option
   * ids, enums and numbers and NO free text, so it scores zero and THE GATE
   * skips it. That is recorded in the gate's registration comment, and a claim
   * about our own verification is still a claim — so it is MEASURED here rather
   * than asserted there.
   *
   * It is a SAFETY property, not a gap: there is no sentence in this block for
   * a model to lift, so it cannot quote a consequence — it must join ids
   * against the `analysis` section, under the instruction's rules, to say
   * anything at all. If a future field adds free text to `run_delta`, this test
   * REDs and THE GATE becomes load-bearing for it: re-check the sanctioning
   * then, and do NOT delete this test to make it quiet.
   */
  it('RUN_DELTA_IS_STRUCTURAL_NOT_PROSE — the block carries ids and numbers, never quotable text', () => {
    const proseLeaves = (v: unknown): string[] => {
      const out: string[] = [];
      const walk = (x: unknown): void => {
        if (typeof x === 'string') {
          if (x.trim().split(/\s+/).length >= 4) out.push(x.trim());
          return;
        }
        if (Array.isArray(x)) return x.forEach(walk);
        if (x && typeof x === 'object') Object.values(x as object).forEach(walk);
      };
      walk(v);
      return out;
    };

    const { serialised } = render(PRESENT_PAIR);
    const delta = serialised.run_delta as Record<string, unknown>;
    expect(delta, 'precondition: the field must be present to be measured').toBeDefined();

    expect(
      proseLeaves(delta),
      'run_delta has gained free text. THE GATE now covers this field and its ' +
        'sanctioning must be re-checked — do not delete this test.',
    ).toEqual([]);

    // ⭐ CONTRAST CONTROL WITH A DIFFERENT EXPECTED ANSWER, same walker, same
    // invocation (trap 20: a blind instrument can fake agreement, but it cannot
    // fake a discrimination it is not making). The instruction block IS prose,
    // so a walker returning zero for BOTH would be reporting on itself rather
    // than on the data.
    //
    // ⚠ THE MAGNITUDE IS 1, NOT 12, AND THAT IS THE CORRECT ANSWER — this
    // control was first written expecting `> 5` and RED-ed at `1`, which is how
    // it earned its place. `RUN_DELTA_INSTRUCTION` is `[...].join('\n')`, i.e.
    // ONE string by the time anything walks it, so a leaf-counting walker sees
    // a single (very long) leaf. Asserting a plausible-looking bigger number
    // here would have been a control tuned to a guess about its own subject.
    const instructionLeaves = proseLeaves(RUN_DELTA_INSTRUCTION);
    expect(instructionLeaves).toHaveLength(1);
    expect(instructionLeaves[0]!.split(/\s+/).length).toBeGreaterThan(100);
  });
});
