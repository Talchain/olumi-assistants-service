/**
 * ⭐⭐ A BARE NUMBER BINDS TO THE SLOT THE PRODUCT ASKED ABOUT — AND ONLY WHEN
 * THAT IS THE QUESTION ACTUALLY ON SCREEN.
 *
 * THE WITNESSED DEFECT, deployed CEE `a7ee21e`, fresh guest, bound by identity.
 * The product offered its repair chip; the user clicked it and typed the plainest
 * possible answer — **`0.6`** — and got `exit_path: turn_executor`,
 * `GAINED_PAIR []`, blockers **8 → 8**, hash unchanged, and the reply *"I need to
 * know what this value is for."* Not vacuous: `asv1Null: false`, eight blockers
 * enumerated.
 *
 * The chip could not have carried the identity. At the vendored
 * `@talchain/schemas` 0.48.0 bytes `ActionSchema` is `"strict"` over
 * `{id, label, message, action_type?, detail?}`; `target_refs` exists in that
 * package but on BLOCK schemas, not on chips. Identity rides the chip's PROSE
 * because that is the only place the wire allows.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ THE FIXTURES IN THIS FILE ARE PRODUCER-DERIVED, AND THE PREVIOUS VERSION
 * WAS NOT — WHICH IS EXACTLY WHY IT MISSED A WRONG-ENTITY WRITE.
 *
 * Every payload here used to be a hand-authored `{ blockers: [...] } as never`
 * with **no `status` field at all** (contrast: 8 `blockers` hits, 0 `status`
 * hits). The real producer ALWAYS emits a status, and the defect below lives
 * precisely in the disagreement between `status` and `blockers` — so a corpus
 * that omits the field **could not represent the failing case, let alone catch
 * it**. A fixture you wrote yourself is not evidence about the wire.
 *
 * These now run through `buildCanonicalAnalysisReadyFromGraph`, the real
 * producer. Where a shape genuinely needs hand assembly (reordering the blocker
 * list), the status is taken FROM the producer rather than invented, so the
 * hand-built payload cannot drift from what the wire emits.
 *
 * This is the same lesson as the surviving mutant one level down: a corpus that
 * cannot make two authorities disagree cannot certify the choice between them.
 */

import { describe, expect, it } from 'vitest';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { buildReadinessNextStep, buildReadinessRecoveryChip } from '../../coaching/readiness-recovery.js';
import { readMissingValueAnswer } from '../missing-value-answer.js';
import {
  deriveAskedEffectPair,
  deriveOnScreenEffectAsk,
  matchBareRepairValue,
  resolveRepairValueBinding,
} from '../repair-value-binding.js';

function edge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 0.6, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive' as const,
  };
}

const NODES = [
  { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
  { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
  { id: 'fac_marketing', kind: 'factor', label: 'Marketing spend' },
  { id: 'fac_price', kind: 'factor', label: 'Unit price' },
  {
    id: 'opt_launch',
    kind: 'option',
    label: 'Launch now',
    data: { interventions: { fac_marketing: 0.7, fac_price: 0.4 } },
  },
  // ⚠ TWO outstanding slots, deliberately: this option is edge-linked to both
  // factors and carries NO value for either. One blocker would make the
  // ambiguity twins unrepresentable — the verb-bearing arm only ASKS when more
  // than one pair is outstanding, so a single-blocker fixture would let that
  // case pass without ever exercising the branch it names.
  { id: 'opt_status_quo', kind: 'option', label: 'Status quo' },
];

const EDGES = [
  edge('dec_launch', 'opt_launch'),
  edge('dec_launch', 'opt_status_quo'),
  edge('opt_launch', 'fac_marketing'),
  edge('opt_launch', 'fac_price'),
  edge('opt_status_quo', 'fac_marketing'),
  edge('opt_status_quo', 'fac_price'),
  edge('fac_marketing', 'goal_revenue'),
  edge('fac_price', 'goal_revenue'),
];

/** Well-formed: the product IS asking for the missing effect value. */
const ASKING_GRAPH = { nodes: NODES, edges: EDGES };

/**
 * ⚠ THE CO-OCCURRING SHAPE — a structural fault AND a missing effect value, and
 * it is NOT a contrived corner. The real captured 18 Aug composed-journey
 * witness graph (`__tests__/fixtures/witness-2026-08-18/composed-journey-run-b.json`)
 * is itself `status: 'blocked'` / `ORPHAN_NODE`. Genuine drafted graphs are
 * structurally messy; this is the normal case on a real governed-brief draw.
 */
const BLOCKED_GRAPH = {
  nodes: [...NODES, { id: 'fac_orphan', kind: 'factor', label: 'Orphan thing' }],
  edges: EDGES,
};

const readinessFor = (graph: unknown) => buildCanonicalAnalysisReadyFromGraph(graph as never);

const ASKING = readinessFor(ASKING_GRAPH);
const BLOCKED = readinessFor(BLOCKED_GRAPH);

/** The producer's own status for an asking payload — never a literal we chose. */
const ASKING_STATUS = (ASKING as { status?: unknown }).status;

const askingBlockers = () => [...((ASKING as { blockers?: readonly unknown[] }).blockers ?? [])];
/** The pair the PRODUCER puts at the head — the question on screen. Derived. */
const ASKED_HEAD = askingBlockers()[0] as Record<string, unknown>;

describe('the fixtures are what they claim to be (producer-derived preconditions)', () => {
  it('the ASKING graph really does render an effect-value question', () => {
    expect(ASKING_STATUS).toBe('needs_user_input');
    expect(buildReadinessRecoveryChip(ASKING as never)?.id).toBe('chip_prompt_repair_effect_value');
    expect(buildReadinessNextStep(ASKING as never)).toContain('missing effect value');
  });

  it('⭐ the BLOCKED graph renders a DIFFERENT question — while keeping the blocker', () => {
    // Both halves are load-bearing. If the status stopped being `blocked`, or the
    // missing-value blocker stopped surviving at the head, the F1 case below
    // would pass vacuously against a payload that cannot express the defect.
    expect((BLOCKED as { status?: unknown }).status).toBe('blocked');
    expect(buildReadinessRecoveryChip(BLOCKED as never)?.id).toBe('chip_prompt_resolve_model_issue');
    expect(buildReadinessNextStep(BLOCKED as never)).toContain('resolve the model issue');
    // ⚠ The blocker SURVIVES the status overwrite — this is the whole mechanism.
    const head = (BLOCKED as { blockers?: readonly unknown[] }).blockers?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(head?.blocker_type).toBe('missing_value');
    expect(head?.option_id).toBe('opt_status_quo');
    // Same head the ASKING payload carries — the ONLY difference is the status.
    expect(head?.factor_id).toBe(ASKED_HEAD.factor_id);
  });
});

describe('the bare-number answer binds to the asked pair', () => {
  it('RED-FIRST: a bare "0.6" binds — with MORE THAN ONE pair still outstanding', () => {
    const resolved = resolveRepairValueBinding({ message: '0.6', readiness: ASKING });

    expect(resolved.matched).toBe(true);
    if (!resolved.matched || resolved.kind !== 'bind') {
      throw new Error(`expected a bind, got ${JSON.stringify(resolved)}`);
    }
    // Bound by IDENTITY to the PRODUCER's head blocker — not to an id this
    // suite chose, and not to a label another pair could satisfy (trap 19).
    expect(resolved.pair.optionId).toBe(ASKED_HEAD.option_id);
    expect(resolved.pair.factorId).toBe(ASKED_HEAD.factor_id);
    expect(resolved.valueText).toBe('0.6');
    expect(resolved.instruction).toBe(
      `Set the ${ASKED_HEAD.option_label} option's effect on ${ASKED_HEAD.factor_label} to 0.6.`,
    );
  });

  it('⭐⭐ F1 — a BLOCKED payload does NOT bind, though its head blocker is perfect', () => {
    // ⚠⚠ THE PERMANENT PIN FOR THE WRONG-ENTITY WRITE.
    //
    // `assessCanonicalAnalysisReadiness` overwrites the status but carries the
    // blockers through untouched, and `hardBlocked` fires on any structural
    // issue. So this payload says `blocked` while a full-identity `missing_value`
    // blocker sits at `blockers[0]`. Before the fix the resolver bound it:
    //
    //   the screen says "resolve the model issue" · the user types "0.6" ·
    //   the product writes 0.6 onto Status quo x Unit price
    //
    // — an entity they never named, answering a question nobody asked, with a
    // WRITE, silently. On a real draw nobody would notice.
    const resolved = resolveRepairValueBinding({ message: '0.6', readiness: BLOCKED });

    expect(resolved).toEqual({ matched: false, reason: 'no_outstanding_ask' });
  });

  it('⭐ the two readers disagree BY DESIGN on that payload, and are named apart', () => {
    // The DISCRIMINATING pair for the fix's placement. `deriveAskedEffectPair`
    // must STILL return the pair — its consumers (`option-effect-write.ts`'s
    // rule 3c, which WRITES, and `outstanding-ask-clarify.ts`) resolve their
    // antecedent from the user's own prose and must not be silenced by a messy
    // graph. Only the ON-SCREEN reader withholds.
    //
    // ⚠ Gating the OWNER instead reddened 16 tests across the RUN-B journey
    // acceptance and the full apply chain, because the real witness graph is
    // itself `blocked` — a far larger regression than the one it closed.
    expect(deriveAskedEffectPair(BLOCKED)).not.toBeNull();
    expect(deriveOnScreenEffectAsk(BLOCKED)).toBeNull();
    // And on an asking payload the two agree exactly.
    expect(deriveOnScreenEffectAsk(ASKING)).toEqual(deriveAskedEffectPair(ASKING));
  });

  it('⭐ THE DISCRIMINATING TWIN — it follows the HEAD blocker, not a fixed pair', () => {
    // Reordering needs hand assembly, so the status is taken FROM THE PRODUCER
    // rather than invented — the fixture cannot drift from the wire.
    const blockers = askingBlockers();
    expect(blockers.length).toBeGreaterThan(1);
    const reordered = { status: ASKING_STATUS, blockers: [blockers[1], blockers[0]] } as never;

    const resolved = resolveRepairValueBinding({ message: '0.6', readiness: reordered });
    expect(resolved.matched).toBe(true);
    if (!resolved.matched || resolved.kind !== 'bind') {
      throw new Error(`expected a bind, got ${JSON.stringify(resolved)}`);
    }
    const expectedHead = blockers[1] as Record<string, unknown>;
    expect(resolved.pair.optionId).toBe(expectedHead.option_id);
    expect(resolved.pair.factorId).toBe(expectedHead.factor_id);
    // ⚠ and it is genuinely a DIFFERENT pair from the unreordered case.
    expect(resolved.pair.factorId).not.toBe(ASKED_HEAD.factor_id);
  });

  it('declines when the product is asking NO effect-value question', () => {
    const notAsking = {
      status: ASKING_STATUS,
      blockers: [{ blocker_type: 'missing_connection', option_id: 'o', factor_id: 'f' }],
    } as never;

    expect(resolveRepairValueBinding({ message: '0.6', readiness: notAsking })).toEqual({
      matched: false,
      reason: 'no_outstanding_ask',
    });
  });

  it('⭐⭐ declines when the HEAD is not an effect-value ask even though OTHER pairs are missing', () => {
    // ⚠ THIS CASE EXISTS BECAUSE A MUTANT SURVIVED, settled by execution rather
    // than argued (trap 13c). Replacing the `asked === null` refusal with a
    // fall-back to "any missing pair" left the whole battery GREEN — every
    // fixture had a missing-value blocker AT THE HEAD, so the two candidate
    // authorities could not disagree.
    const headIsNotAnAsk = {
      status: ASKING_STATUS,
      blockers: [
        { blocker_type: 'missing_connection', option_id: 'opt-x', factor_id: 'fac-y' },
        ...askingBlockers(),
      ],
    } as never;

    expect(resolveRepairValueBinding({ message: '0.6', readiness: headIsNotAnAsk })).toEqual({
      matched: false,
      reason: 'no_outstanding_ask',
    });
  });

  it('declines a figure outside the model 0-1 scale — and NEVER converts it', () => {
    // ⭐ P5. `80` is a user-scale number; the writer does not silently rescale.
    for (const message of ['80', '12', '5000']) {
      expect(resolveRepairValueBinding({ message, readiness: ASKING })).toEqual({
        matched: false,
        reason: 'bare_value_not_model_unit',
      });
    }
    for (const message of ['0', '0.5', '.25', '1.0']) {
      expect(resolveRepairValueBinding({ message, readiness: ASKING }).matched).toBe(true);
    }
  });

  it('⭐⭐ a bare "1" is REFUSED — it is an ordinal in disguise', () => {
    // The sibling ask arm offers up to three numbered pair chips and persists NO
    // pending, so the next turn carries no live record that an offer is
    // outstanding. Measured before this refusal: a bare "1" bound as an effect
    // value of 1.0 while the user meant "the first one" — two readings, two
    // different entities written, nothing on the wire to tell them apart.
    //
    // ⚠ Newly reachable BECAUSE of this lane: bare numbers did not bind at all
    // before it. The cost is stated rather than hidden — exactly 1.0 must be
    // written as "1.0" or "Set it to 1", both of which still bind.
    expect(resolveRepairValueBinding({ message: '1', readiness: ASKING })).toEqual({
      matched: false,
      reason: 'bare_value_not_model_unit',
    });
    expect(resolveRepairValueBinding({ message: '1.0', readiness: ASKING }).matched).toBe(true);
    // `0` is not an ordinal and stays bindable.
    expect(resolveRepairValueBinding({ message: '0', readiness: ASKING }).matched).toBe(true);
  });

  it('the VERB-BEARING arm is untouched — it still ASKS when the referent is ambiguous', () => {
    // ⭐⭐ THE OPPOSITE-DIRECTION TWIN. "Set it to 0.6." carries a referent, so
    // with two pairs outstanding the estate's answer is still to make the
    // ambiguity the product (trap 22f) rather than to bind the head.
    const resolved = resolveRepairValueBinding({ message: 'Set it to 0.6.', readiness: ASKING });

    expect(resolved.matched).toBe(true);
    if (!resolved.matched || resolved.kind !== 'ask') {
      throw new Error(`expected an ask, got ${JSON.stringify(resolved)}`);
    }
    expect(resolved.pairs.length).toBeGreaterThan(1);
  });

  it('the two arms are distinguishable AT THE READING, not only at the resolver', () => {
    const bare = readMissingValueAnswer('0.6');
    const verbed = readMissingValueAnswer('Set it to 0.6.');
    expect(bare).not.toBeNull();
    expect(verbed).not.toBeNull();
    expect(bare!.kind === 'numeric' && bare!.elliptical).toBe(true);
    expect(verbed!.kind === 'numeric' && verbed!.elliptical).toBe(false);
    expect(matchBareRepairValue('0.6')).toBeNull();
    expect(matchBareRepairValue('Set it to 0.6.')).not.toBeNull();
  });

  it('never throws, and claims nothing on hostile or empty input', () => {
    for (const message of ['', '   ', '.', '-', '0.6.0', 'zero point six']) {
      expect(() => resolveRepairValueBinding({ message, readiness: ASKING })).not.toThrow();
      if (resolveRepairValueBinding({ message, readiness: ASKING }).matched) {
        throw new Error(`claimed ${JSON.stringify(message)}`);
      }
    }
  });
});
