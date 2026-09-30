/**
 * ⭐ THE ASSISTANT MUST NOT DESCRIBE A NUMBER THE USER TYPED AS ITS OWN ESTIMATE.
 *
 * `compactGraph` builds the graph the LLM reads. It projected authorship from
 * `observed_state.extractionType` ALONE — a field whose four members
 * (`explicit | inferred | range | observed`) describe HOW THE EXTRACTION
 * PIPELINE READ THE BRIEF and which has no member meaning "the user typed
 * this". No user-edit writer updates it, and none can.
 *
 * So after a user corrected a factor's value, the compactor handed the model
 * `source: 'assumption' / provenance: 'ai_inferred'` for a number the user had
 * personally stated — and the model, reading its own context, described that
 * number back to the user as its estimate.
 *
 * The authoritative authorship field is `observed_state.source`, which
 * `build-turn-context.ts:463-472` names as such, whose twelve-member vocabulary
 * the shared contract owns (`OBSERVED_STATE_SOURCE_LITERALS`), and which the
 * shared contract explicitly instructs consumers to derive from. Every user-edit
 * writer in the estate stamps it (`canonicalise-value-ops.ts` `USER_EDIT_SOURCE`,
 * `set-factor-value.ts`).
 *
 * ── WHAT THIS SPEC BINDS TO, AND WHY IT IS NOT A VALUE PREDICATE ────────────
 * CLAUDE.md trap 19: an assertion that finds its subject by a value another
 * node could satisfy proves nothing about the named object. The fixture below
 * therefore carries TWO factors with the SAME `value: 0.85` — `fac_user_typed`
 * (stamped `user_override`) and `fac_ai_guess` (no stamp at all). A predicate
 * over the value cannot tell them apart; every assertion here resolves its node
 * BY ID. The discriminating mutant pair in the PR body is built on exactly this
 * pair: loosening the projection for ALL nodes REDs this spec, loosening it for
 * `fac_ai_guess` alone leaves it GREEN.
 */

import { describe, it, expect } from 'vitest';
import { OBSERVED_STATE_SOURCE_LITERALS } from '@talchain/schemas';
import { compactGraph } from '../../../../src/orchestrator/context/graph-compact.js';
import {
  FORGEABLE_USER_AUTHORSHIP_LITERALS,
  UNVERIFIED_USER_AUTHORSHIP_LITERALS,
  valueSourceAuthorship,
} from '../../../../src/cee/transforms/provenance-display.js';
import {
  USER_EDIT_SOURCE,
  stampUserEditProvenance,
} from '../../../../src/orchestrator/canonicalise-value-ops.js';
import type { PatchOperation } from '../../../../src/orchestrator/types.js';
import type { GraphV3T } from '../../../../src/schemas/cee-v3.js';

type ObservedState = Record<string, unknown>;

function factor(id: string, observed_state: ObservedState): Record<string, unknown> {
  return { id, kind: 'factor', label: id, observed_state };
}

/**
 * Zod-inferred `GraphV3T` does not overlap with partial literals, so the
 * fixture is cast through `unknown` — the convention the sibling
 * `graph-compact-provenance.test.ts` already uses.
 */
function graphOf(nodes: readonly Record<string, unknown>[]): GraphV3T {
  return { nodes, edges: [] } as unknown as GraphV3T;
}

function nodeById(graph: GraphV3T, id: string) {
  const compacted = compactGraph(graph);
  const found = compacted.nodes.find((n) => n.id === id);
  expect(found, `fixture node ${id} is missing from the compacted graph`).toBeDefined();
  return found!;
}

describe('compactGraph — the user typed this number, and the model must be told so', () => {
  /**
   * THE PAIR. Same value, different authorship. Nothing but the id
   * distinguishes them to a value predicate.
   */
  const PAIR = graphOf([
    factor('fac_user_typed', {
      value: 0.85,
      // What every user-edit writer stamps. `extractionType` is deliberately
      // left at the producer's `inferred`, because that is the REAL persisted
      // state after an edit: no writer updates it, and none can.
      source: 'user_override',
      extractionType: 'inferred',
    }),
    factor('fac_ai_guess', {
      value: 0.85,
      extractionType: 'inferred',
    }),
  ]);

  it('⭐ a value stamped user_override reaches the model as the USER\'S, not as an assumption', () => {
    const edited = nodeById(PAIR, 'fac_user_typed');
    expect(edited.provenance).toBe('user_set');
    expect(edited.source).toBe('user');
  });

  it('⭐ the AI\'s own estimate at the SAME value is unchanged — the projection binds to the stamp, not the number', () => {
    const guess = nodeById(PAIR, 'fac_ai_guess');
    expect(guess.provenance).toBe('ai_inferred');
    expect(guess.source).toBe('assumption');
  });

  it('the pair is genuinely indistinguishable by value (this spec would be vacuous otherwise)', () => {
    const edited = nodeById(PAIR, 'fac_user_typed');
    const guess = nodeById(PAIR, 'fac_ai_guess');
    expect(edited.value).toBe(guess.value);
    expect(edited.provenance).not.toBe(guess.provenance);
  });

  /**
   * The two must stay apart. "We read this in your brief" and "you typed this"
   * are different statements to make to someone, and collapsing them is how a
   * product tells a user it extracted a number they actually corrected by hand.
   * The two sibling authorities over this vocabulary BOTH collapse them
   * (`user_stated` for obligation, `explicit` for sampling width), which is why
   * this question needed its own table rather than a reuse of theirs.
   */
  it('a brief-extracted value is NOT relabelled as user-typed — from_brief and user_set stay apart', () => {
    const g = graphOf([
      factor('fac_from_brief', { value: 0.4, source: 'brief_extraction', extractionType: 'explicit' }),
    ]);
    const n = nodeById(g, 'fac_from_brief');
    expect(n.provenance).toBe('from_brief');
    expect(n.source).toBe('user');

    const edited = nodeById(PAIR, 'fac_user_typed');
    expect(edited.provenance).not.toBe(n.provenance);
  });

  /**
   * ⚠⚠ THE STAMP THAT MUST *NOT* WIN, AND THE REASON IS MEASURED.
   *
   * `schema-v3.ts:361-362` synthesises `source` from `extractionType` for every
   * drafted factor (`extractionType === 'inferred' ? 'cee_inference' :
   * 'brief_extraction'`), so for these two literals `source` is a LOSSY COPY of
   * the field beside it — and a copy that goes stale, because the ROADMAP 2.972
   * withdrawal rewrites `extractionType` when a node has not earned its brief
   * claim and leaves `observed_state.source` standing.
   *
   * A reader that let `source` win here would resurrect a withdrawn brief claim
   * through the one field the withdrawal does not reach — reopening the defect
   * measured on deployed build `41156fc` (`{value: 0, source:
   * 'brief_extraction', extractionType: 'observed'}`, the product claiming it
   * had observed a burnout of zero in the user's brief).
   *
   * So these two DEFER, and `extractionType` — the finer instrument, and the
   * one the withdrawal keeps honest — still governs.
   */
  describe('a stamp synthesised FROM extractionType defers to it, and does not override it', () => {
    it('cee_inference defers — extractionType still decides', () => {
      const g = graphOf([
        factor('fac_cee', { value: 0.4, source: 'cee_inference', extractionType: 'explicit' }),
      ]);
      const n = nodeById(g, 'fac_cee');
      expect(n.provenance).toBe('from_brief');
      expect(n.source).toBe('user');
    });

    it('⭐ brief_extraction defers, so a 2.972-withdrawn claim STAYS withdrawn', () => {
      // Exactly the post-withdrawal shape: `extractionType` rewritten to
      // 'inferred', `source` left carrying the stale 'brief_extraction'.
      const g = graphOf([
        factor('fac_withdrawn', {
          value: 0,
          source: 'brief_extraction',
          extractionType: 'inferred',
        }),
      ]);
      const n = nodeById(g, 'fac_withdrawn');
      expect(n.provenance).toBe('ai_inferred');
      expect(n.source).toBe('assumption');
    });

    it('a repair-authored value is NOT a brief claim — cee_repair has no extractionType twin, so it governs', () => {
      const g = graphOf([
        factor('fac_repaired', { value: 0.4, source: 'cee_repair', extractionType: 'explicit' }),
      ]);
      const n = nodeById(g, 'fac_repaired');
      expect(n.provenance).toBe('ai_inferred');
      expect(n.source).toBe('assumption');
    });
  });

  /**
   * The fallback must be byte-unchanged. `source` is optional on the wire and
   * most producer-drafted nodes carry only `extractionType`; if this regressed,
   * the fix would have traded one silent mislabel for another.
   */
  describe('no source stamp — extractionType still governs, exactly as before', () => {
    const CASES: ReadonlyArray<readonly [string, string, string]> = [
      ['explicit', 'user', 'from_brief'],
      ['observed', 'system', 'from_brief'],
      ['inferred', 'assumption', 'ai_inferred'],
      ['range', 'system', 'ai_inferred'],
    ];
    for (const [extractionType, expectedSource, expectedProvenance] of CASES) {
      it(`${extractionType} → ${expectedSource} / ${expectedProvenance}`, () => {
        const g = graphOf([factor(`fac_${extractionType}`, { value: 0.5, extractionType })]);
        const n = nodeById(g, `fac_${extractionType}`);
        expect(n.source).toBe(expectedSource);
        expect(n.provenance).toBe(expectedProvenance);
      });
    }
  });

  /**
   * CLAUDE.md trap 12: an unrecognised stamp must not be guessed into a class.
   * The shared contract states it at the field — *"a consumer MUST NOT read
   * absence as any particular class; classify unknown/absent as neutral, never
   * guess"* — so an unknown `source` falls through to `extractionType` rather
   * than inventing an authorship claim in either direction.
   */
  it('an unrecognised source stamp falls through to extractionType and invents nothing', () => {
    const g = graphOf([
      factor('fac_mystery', { value: 0.5, source: 'from_the_future', extractionType: 'explicit' }),
    ]);
    const n = nodeById(g, 'fac_mystery');
    expect(n.provenance).toBe('from_brief');
    expect(n.source).toBe('user');
  });

  it('a non-string source stamp is ignored rather than coerced', () => {
    const g = graphOf([
      factor('fac_bad_type', { value: 0.5, source: 42, extractionType: 'inferred' }),
    ]);
    const n = nodeById(g, 'fac_bad_type');
    expect(n.provenance).toBe('ai_inferred');
  });

  /**
   * DERIVED, NOT MIRRORED (CLAUDE.md trap 12d). The corpus above is a
   * hand-written list and can only ever see the literals someone thought to
   * write down. This iterates the CONTRACT's own list, so the re-vendor that
   * mints a thirteenth literal is observed here rather than falling silently
   * into a default.
   *
   * It asserts the WEAK property deliberately — every declared literal yields a
   * member of the display vocabulary — because the strong per-literal claim is
   * the exhaustive `Record<KnownObservedStateSourceLiteral, …>` in
   * `provenance-display.ts`, which is enforced by TYPE and cannot be satisfied
   * by a default arm.
   */
  it('every literal the shared contract declares projects into the display vocabulary', () => {
    const VOCABULARY = new Set(['from_brief', 'ai_inferred', 'user_set']);
    expect(
      OBSERVED_STATE_SOURCE_LITERALS.length,
      'the contract literal list is empty — this assertion would be vacuous',
    ).toBeGreaterThan(0);

    for (const literal of OBSERVED_STATE_SOURCE_LITERALS) {
      const g = graphOf([factor('fac_probe', { value: 0.5, source: literal })]);
      const n = nodeById(g, 'fac_probe');
      expect(VOCABULARY.has(n.provenance as string), `${literal} → ${n.provenance}`).toBe(true);
    }
  });

  /**
   * ⚠ THE ONE THE CONTRACT VOCABULARY CANNOT SAY IN THREE WORDS.
   *
   * `panel_elicited` is a named colleague's answer, verified server-side by
   * `collab/apply-verification.ts` before the stamp is written. The display
   * vocabulary has three members and none of them means "a colleague, not
   * you", so this projection is LOSSY — `elicited_from` is the carrier that
   * keeps the identity, and the compactor does not emit it.
   *
   * What is asserted here is the only part that is unambiguous, and it is the
   * part this PR exists for: the most strongly attested human-supplied number
   * in the system must not be handed to the model as the model's own guess.
   */
  it('a server-verified panel answer is not handed to the model as the model\'s own estimate', () => {
    const g = graphOf([
      factor('fac_panel', {
        value: 0.72,
        source: 'panel_elicited',
        extractionType: 'inferred',
      }),
    ]);
    const n = nodeById(g, 'fac_panel');
    expect(n.provenance).not.toBe('ai_inferred');
    expect(n.source).not.toBe('assumption');
  });
});

/**
 * ⚠⚠ THE KNOWN GAP, PINNED IN THE SUITE RATHER THAN LEFT IN PROSE.
 *
 * Every test above sits on the SAFE side of one predicate: they all assert that
 * a user-authored value is not called the model's own. None of them can observe
 * the opposite error — the product telling a user *"you gave me this figure"*
 * about a value they never supplied — because the stamp this projection trusts
 * is not a single-meaning receipt.
 *
 * `stampUserEditProvenance` (`orchestrator/canonicalise-value-ops.ts`) writes
 * `USER_EDIT_SOURCE` onto EVERY value-writing `update_node` op reaching either
 * edit seam, overriding an explicit LLM-claimed producer source. And
 * `orchestrator-v5/routing/mutation-consent.ts` records that `edit_graph` is
 * *"genuinely UNCOVERED by withheld-consent enforcement"*, with `update_node`
 * ops applying *"regardless of what the user's message asked for"* (ROADMAP
 * 2.628a). `cee/context-integrity/not-modelled-manifest.ts` states the
 * consequence outright: one literal serves both (a) a genuine user edit and
 * (b) a MODEL-AUTHORED op.
 *
 * The gap is ACCEPTED — making `user_override` defer would reopen the defect
 * this whole file exists to close, for the common case, in exchange for a rarer
 * one. What is NOT acceptable is that it be invisible. So it is pinned as a
 * set, and this block asserts that set EXACTLY: it REDs if a literal is added
 * to it AND if one is removed, which is the estate's honest-gap rule.
 */
describe('the forged-stamp gap is pinned, not merely described', () => {
  const pinned = [...FORGEABLE_USER_AUTHORSHIP_LITERALS].sort();

  /**
   * `toEqual` on the whole set, not `toContain`. A containment check would stay
   * green as class (b) grew, which is precisely the blindness being fixed.
   */
  it('⭐ the gap set is EXACTLY the literals whose user_set verdict rests on a forgeable stamp', () => {
    expect(pinned).toEqual(['user_override']);
  });

  /**
   * ⭐ THE DERIVED ANCHOR — this is what makes the pin fail loud instead of
   * ageing quietly (CLAUDE.md trap 12: a hand-maintained list drifts, and the
   * drift always reads as green).
   *
   * `not-modelled-manifest.ts` names as a RE-SURFACE TRIGGER: *"`stampUser
   * EditProvenance` gains a distinct stamp for model-authored ops"*. That
   * trigger is a sentence someone has to remember to act on. Reading the
   * stamper's own exported constant makes it mechanical: the day the owning
   * lane splits the stamp, `USER_EDIT_SOURCE` stops matching this set and this
   * test REDs, pointing the next session at the gap that just changed shape.
   */
  it('⭐ the stamper\'s own literal is in the set — so a distinct model-authored stamp REDs here', () => {
    expect(
      FORGEABLE_USER_AUTHORSHIP_LITERALS.has(USER_EDIT_SOURCE),
      `stampUserEditProvenance now writes "${USER_EDIT_SOURCE}", which this gap set does not ` +
        `name. If the stamp was SPLIT so model-authored ops are distinguishable, the gap has ` +
        `changed shape: re-read the RE-SURFACE TRIGGER block in ` +
        `cee/context-integrity/not-modelled-manifest.ts, which names two readers, not one.`,
    ).toBe(true);
  });

  /**
   * CONTRAST CONTROL 1 (CLAUDE.md trap 13e). The set must name literals that
   * actually GOVERN — a gap set naming an inert literal records nothing, and
   * would pass every assertion above.
   */
  it('contrast control: every pinned literal really does project to user_set', () => {
    expect(pinned.length).toBeGreaterThan(0);
    for (const literal of pinned) {
      expect(
        valueSourceAuthorship(literal)?.provenance,
        `${literal} is pinned as a forgeable authorship claim but does not make one`,
      ).toBe('user_set');
    }
  });

  /**
   * CONTRAST CONTROL 2. The set must be a STRICT subset of the literals that
   * project to `user_set`. A set that named all of them would be
   * unfalsifiable-by-breadth — it would "cover" the gap by asserting everything
   * is suspect, which is the same as asserting nothing.
   *
   * It also pins the substantive claim: `panel_elicited` is server-VERIFIED
   * against the collab store before it is stamped, so it is deliberately OUT.
   */
  it('contrast control: the gap is a strict subset — some user_set literals are NOT forgeable this way', () => {
    const governing = OBSERVED_STATE_SOURCE_LITERALS.filter(
      (l) => valueSourceAuthorship(l)?.provenance === 'user_set',
    );
    expect(governing.length, 'no literal projects to user_set — the comparison is vacuous').toBeGreaterThan(0);

    const notForgeable = governing.filter((l) => !FORGEABLE_USER_AUTHORSHIP_LITERALS.has(l));
    expect(notForgeable.length).toBeGreaterThan(0);
    expect(notForgeable).toContain('panel_elicited');
  });
});

/**
 * ⚠⚠ THE KNOWN-UNPINNED SET — the OTHER half of the authority surface, and the
 * half the first two commits left implicit.
 *
 * ── THE FINDING THIS ANSWERS ──────────────────────────────────────────────
 * SEVEN literals project to `user_set`; only ONE was pinned as forgeable. The
 * remaining six were justified in prose as *"written by surfaces that are not
 * this stamper"* — which reads as a safety property and is not one: it is a
 * claim about writers in OTHER repos that CEE cannot verify. An independent
 * review measured the writer census and reached the same conclusion from the
 * arithmetic alone.
 *
 * ── AND A CORRECTION TO THE COUNT, RE-DERIVED HERE ────────────────────────
 * The review's census named FOUR literals with zero CEE writers. Re-measured at
 * this tip it is FIVE: `user` also has no `observed_state.source` writer in this
 * repo. Its single apparent hit — `graph-compact.ts:714`, `n.source = 'user'` —
 * writes the COMPACT node source (`user | assumption | system`), a different
 * field in a different vocabulary. Contrast controls in the same sweep were
 * non-zero (`brief_extraction` 25, `user_specified` 10), so the probe
 * discriminates.
 *
 * ── WHY A SECOND SET AND NOT A WIDER FIRST ONE ────────────────────────────
 * "Forgeable" is an EVIDENCED claim about `stampUserEditProvenance`. Asserting
 * it of a literal nothing here writes would be a fabricated finding, and a gap
 * set naming every `user_set` literal would be unfalsifiable-by-breadth. Two
 * questions, two sets (CLAUDE.md trap 21): *"is this stamp forgeable?"* and
 * *"has anyone here checked?"*
 */
describe('the unverified authority surface is pinned as an explicit set', () => {
  const governing = OBSERVED_STATE_SOURCE_LITERALS.filter(
    (l) => valueSourceAuthorship(l)?.provenance === 'user_set',
  );

  /**
   * `toEqual` on the whole set. It REDs if a literal is ADDED and if one is
   * REMOVED — the estate's honest-gap rule. A `toContain` would stay green as
   * the unverified surface grew, which is the blindness being closed.
   */
  it('⭐ the KNOWN-UNPINNED set is EXACTLY the user_set literals no CEE writer stamps', () => {
    expect([...UNVERIFIED_USER_AUTHORSHIP_LITERALS].sort()).toEqual([
      'user',
      'user_assumption',
      'user_calibration',
      'user_confirmed',
      'user_edited',
    ]);
  });

  /**
   * ⭐ THE PARTITION — this is what makes the two sets fail loud instead of
   * ageing quietly. Every literal that projects to `user_set` must be accounted
   * for by exactly one of three verdicts. A thirteenth contract literal landing
   * on `user_set`, or a table row changing verdict, REDs here and forces the
   * decision to be made rather than defaulted.
   */
  it('⭐ every user_set literal is accounted for — forgeable, unverified, or receipted', () => {
    expect(governing.length, 'no literal projects to user_set — the partition is vacuous').toBeGreaterThan(0);

    // `panel_elicited` is the one literal with an in-repo VERIFIED writer:
    // `system-events/factor-value-edit.ts:346` stamps it only behind
    // `verifyAppliedFrom` against the collab store.
    const RECEIPTED = new Set<string>(['panel_elicited']);

    const unaccounted = governing.filter(
      (l) =>
        !FORGEABLE_USER_AUTHORSHIP_LITERALS.has(l) &&
        !UNVERIFIED_USER_AUTHORSHIP_LITERALS.has(l) &&
        !RECEIPTED.has(l),
    );
    expect(
      unaccounted,
      `these literals tell the model a value was supplied by a person, and no set in ` +
        `cee/transforms/provenance-display.ts records what we know about them. Pin each one ` +
        `as FORGEABLE (a stamper here writes it and the stamp is not single-meaning), as ` +
        `UNVERIFIED (nothing here writes it), or as receipted (a verified writer here).`,
    ).toEqual([]);
  });

  /**
   * DISJOINTNESS. The two sets answer different questions; a literal in both
   * would mean one of the two answers is wrong, and both assertions above would
   * still pass.
   */
  it('the two gap sets are disjoint — a literal cannot be both evidenced and unevidenced', () => {
    const both = [...UNVERIFIED_USER_AUTHORSHIP_LITERALS].filter((l) =>
      FORGEABLE_USER_AUTHORSHIP_LITERALS.has(l),
    );
    expect(both).toEqual([]);
  });

  /**
   * CONTRAST CONTROL (CLAUDE.md trap 13e). The set must name literals that
   * actually GOVERN. A set naming inert literals would satisfy every assertion
   * above while recording nothing.
   */
  it('contrast control: every unpinned literal really does project to user_set', () => {
    expect(UNVERIFIED_USER_AUTHORSHIP_LITERALS.size).toBeGreaterThan(0);
    for (const literal of UNVERIFIED_USER_AUTHORSHIP_LITERALS) {
      expect(
        valueSourceAuthorship(literal)?.provenance,
        `${literal} is recorded as an unverified authorship claim but makes none`,
      ).toBe('user_set');
    }
  });

  /**
   * CONTRAST CONTROL 2. The set must be a STRICT subset — if it named every
   * governing literal it would be recording "we know nothing", which is both
   * false (we do know about `user_override` and `panel_elicited`) and
   * unfalsifiable.
   */
  it('contrast control: the unverified set is a strict subset of the user_set literals', () => {
    expect(UNVERIFIED_USER_AUTHORSHIP_LITERALS.size).toBeLessThan(governing.length);
  });
});

/**
 * ⭐⭐⭐ THE GAP GUARD, BOUND TO THE ACTUAL WRITER — NOT TO A CONSTANT.
 *
 * ── WHAT WAS WRONG WITH THE BLOCK ABOVE, MEASURED BY AN INDEPENDENT REVIEW ──
 * The forged-gap block asserts `FORGEABLE_USER_AUTHORSHIP_LITERALS.has(
 * USER_EDIT_SOURCE)`. That is a CONSTANT-TO-SET comparison: it imports the
 * stamper's exported literal and never executes the stamper. An adversarial
 * review injected a one-line fault into `stampUserEditProvenance` —
 *
 *     - source: USER_EDIT_SOURCE,
 *     + source: observed.source === 'cee_inference' ? 'user_confirmed' : USER_EDIT_SOURCE,
 *
 * — leaving `USER_EDIT_SOURCE` and the declared gap set untouched. The writer
 * then EMITTED a literal outside the declared gap for model-labelled values,
 * the real classifier still called those `user_set`, and **all four gap tests
 * above stayed green**, as did the partition, disjointness and vacuity guards
 * added after them. A guard that tests a mock of the thing it guards is a guard
 * agreeing with itself.
 *
 * ── WHAT THIS BLOCK DOES INSTEAD ──────────────────────────────────────────
 * It drives `stampUserEditProvenance` itself and composes the whole chain the
 * product runs:
 *
 *     actual emitted `observed_state.source`
 *       → valueSourceAuthorship()          (the real classifier)
 *       → declared forgeable-gap membership
 *
 * with the two counterparts the prior verdict required, so the alarm is
 * DISCRIMINATING rather than merely sensitive (CLAUDE.md trap 19): under the
 * injected fault the model-labelled case REDs while the genuine-user and
 * label-only cases stay GREEN, and they fail on DIFFERENT assertions.
 *
 * ── ⚠ WHAT IT IS NOT ──────────────────────────────────────────────────────
 * It does NOT make `user_override` defer, does not split the stamp, and does
 * not touch the consent seam. The gap stays ACCEPTED and explicit; this makes
 * the ACCEPTANCE observable at the writer rather than at a copy of its name.
 * Nor is a model's `source` label evidence of consent — `cee_inference` here is
 * the LLM's own claim about a value write, which is exactly the input
 * `stampUserEditProvenance` documents itself as OVERRIDING.
 *
 * ⚠ NO STAMP LITERAL IS SPELLED IN THIS BLOCK. Every expectation is derived
 * from the writer's emitted output and from the exported sets (trap 12), so the
 * day the stamp is split this block moves with it instead of asserting a string
 * nothing writes.
 */
describe('the forged-stamp gap, asserted at the REAL WRITER’s emitted output', () => {
  const TARGET = 'fac_target';
  const UNRELATED = 'fac_other';

  /** The one leaf that makes an `update_node` a VALUE write. */
  function valueWrite(path: string, value: number, source?: string): PatchOperation {
    return {
      op: 'update_node',
      path,
      value: {
        observed_state: { value, ...(source === undefined ? {} : { source }) },
      },
    } as PatchOperation;
  }

  /** Read the stamp the writer actually emitted for `path`, by IDENTITY. */
  function emittedSourceFor(ops: readonly PatchOperation[], path: string): unknown {
    const out = stampUserEditProvenance(ops);
    const op = out.find((o) => o.path === path);
    expect(op, `no operation for ${path} came back from the writer`).toBeDefined();
    const observed = (op!.value as Record<string, unknown>).observed_state as
      | Record<string, unknown>
      | undefined;
    expect(observed, `${path} came back with no observed_state`).toBeDefined();
    return observed!.source;
  }

  /**
   * ⭐ (1) THE MODEL-LABELLED ARM — the case the whole gap is about.
   *
   * The op carries the model's own `cee_inference` label, which the writer
   * documents itself as OVERRIDING. Whatever it emits instead must still be
   * inside the declared gap, or this repo is telling the model a value was
   * user-supplied on a stamp it has NOT recorded as forgeable.
   *
   * The two assertions are deliberately separate and they fail differently:
   * classification is what makes the claim, membership is what records the gap.
   */
  it('⭐ a MODEL-LABELLED value write emits a stamp that is BOTH classified user_set AND inside the declared gap', () => {
    const emitted = emittedSourceFor([valueWrite(TARGET, 0.85, 'cee_inference')], TARGET);

    expect(typeof emitted, 'the writer emitted no string stamp at all').toBe('string');

    expect(
      valueSourceAuthorship(emitted)?.provenance,
      `the writer emitted "${String(emitted)}" for a MODEL-LABELLED value write. This block ` +
        `exists because that stamp makes a user-authorship claim; if it no longer does, the ` +
        `gap has changed shape — re-read the RE-SURFACE TRIGGER block in ` +
        `cee/context-integrity/not-modelled-manifest.ts.`,
    ).toBe('user_set');

    // The load-bearing membership claim, over the EMITTED value.
    const forgeable: ReadonlySet<string> = FORGEABLE_USER_AUTHORSHIP_LITERALS;
    expect(
      forgeable.has(String(emitted)),
      `stampUserEditProvenance EMITTED "${String(emitted)}" for a model-authored value write, ` +
        `and that literal is NOT in FORGEABLE_USER_AUTHORSHIP_LITERALS. Either the stamp was ` +
        `split (good — pin the new literal, or move it out of the gap if it now discriminates) ` +
        `or a user-authorship claim is being made on evidence this repo has not recorded as ` +
        `forgeable. Do not silence this by widening the set.`,
    ).toBe(true);
  });

  /**
   * ⭐ (2) COUNTERPART — the GENUINE user edit. It must keep the legitimate
   * stamp and its exact number.
   *
   * This is what stops the gap being "closed" by making the writer defer: the
   * common case is a person typing a number, and `provenance-display.ts`
   * records why deferring here would reopen the original defect.
   */
  it('⭐ counterpart: a GENUINE unlabelled user value keeps the legitimate stamp and its exact number', () => {
    const ops = [valueWrite(TARGET, 0.72)];
    const emitted = emittedSourceFor(ops, TARGET);

    // Derived, not restated: the legitimate-user stamp IS the exported constant.
    expect(emitted).toBe(USER_EDIT_SOURCE);
    expect(valueSourceAuthorship(emitted)?.provenance).toBe('user_set');

    const [stamped] = stampUserEditProvenance(ops);
    const observed = (stamped!.value as Record<string, unknown>).observed_state as Record<
      string,
      unknown
    >;
    expect(stamped!.path, 'bound by identity, never by the value').toBe(TARGET);
    expect(observed.value, 'the writer altered the number it was stamping').toBe(0.72);
  });

  /**
   * ⭐ (3) COUNTERPART — an UNRELATED, label-only operation. It must come back
   * untouched and unstamped, BY REFERENCE.
   *
   * Without this the first two tests are consistent with a writer that stamps
   * indiscriminately, which would make the gap far wider than the set records.
   */
  it('⭐ counterpart: an unrelated label-only update is returned BY REFERENCE, unstamped', () => {
    const labelOnly = {
      op: 'update_node',
      path: UNRELATED,
      value: { label: 'Renamed, no value written' },
    } as PatchOperation;

    const out = stampUserEditProvenance([labelOnly]);
    expect(out[0], 'a label-only edit was rewritten by the value stamper').toBe(labelOnly);
    expect((out[0]!.value as Record<string, unknown>).observed_state).toBeUndefined();
  });

  /**
   * ⭐ (4) THE GAP ITSELF, STATED AS AN EXECUTABLE CLAIM — and the precondition
   * every assertion above rests on, pinned in-test (CLAUDE.md trap 13b: a guard
   * whose discriminating power depends on something nothing pins decays
   * silently into a tautology).
   *
   * The model-labelled and genuine-user value writes must emit the SAME stamp.
   * That equality IS the accepted gap: the writer cannot tell them apart, which
   * is why the display licence may make no positive authorship claim. The
   * label-only arm must be stamped by neither — that is the writer's
   * precondition, asserted rather than assumed.
   *
   * If the stamp is ever SPLIT this test REDs first and says so plainly, which
   * is the re-surface trigger firing mechanically rather than by memory.
   */
  it('⭐ the gap, executably: the model-labelled and genuine arms emit the SAME stamp, and a label-only edit emits none', () => {
    const modelLabelled = emittedSourceFor([valueWrite(TARGET, 0.85, 'cee_inference')], TARGET);
    const genuine = emittedSourceFor([valueWrite(TARGET, 0.72)], TARGET);
    const labelOnly = stampUserEditProvenance([
      { op: 'update_node', path: UNRELATED, value: { label: 'Renamed' } } as PatchOperation,
    ])[0];

    // ⚠ THE GAP, IN ONE LINE. Not a tidiness check: if these two ever differ,
    // the stamp has been split and the accepted gap has changed shape.
    expect(
      modelLabelled,
      `the writer now emits "${String(modelLabelled)}" for a MODEL-AUTHORED value write and ` +
        `"${String(genuine)}" for a genuine user edit. If that is a deliberate stamp SPLIT, the ` +
        `known gap is closing: update FORGEABLE_USER_AUTHORSHIP_LITERALS, and revisit the ` +
        `DISPLAY_GRAPH_INSTRUCTION licence, which is currently narrowed to a pure prohibition ` +
        `BECAUSE these two are indistinguishable.`,
    ).toBe(genuine);
    expect((labelOnly!.value as Record<string, unknown>).observed_state).toBeUndefined();

    // ...and the classifier really does DISCRIMINATE, so the `user_set` reads
    // above are findings and not a probe that answers `user_set` to everything.
    // DERIVED from the contract vocabulary rather than naming a literal (trap
    // 12), and non-zero or the reads above prove nothing (trap 13e).
    const notUserSet = OBSERVED_STATE_SOURCE_LITERALS.filter((l) => {
      const projected = valueSourceAuthorship(l)?.provenance;
      return projected !== undefined && projected !== 'user_set';
    });
    expect(
      notUserSet.length,
      'valueSourceAuthorship answers user_set (or nothing) to every literal in the vocabulary — ' +
        'the membership reads above are not discriminating anything',
    ).toBeGreaterThan(0);

    // ⚠ AND A CORRECTION WORTH KEEPING, because this control was written wrong
    // first and the suite caught it (trap 13c — an expectation taken from the
    // reviewer's own reading rather than from the producer). The model's own
    // `cee_inference` label does NOT classify as `ai_inferred` here: it returns
    // UNDEFINED, because for that literal `observed_state.source` is a lossy
    // copy of `extractionType` and this module refuses to decide authorship
    // from it at all. Absence, not a verdict — which is exactly why the writer
    // overriding that label is not evidence of anything either way.
    expect(valueSourceAuthorship('cee_inference')).toBeUndefined();
  });
});
