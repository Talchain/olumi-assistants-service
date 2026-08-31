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
  valueSourceAuthorship,
} from '../../../../src/cee/transforms/provenance-display.js';
import { USER_EDIT_SOURCE } from '../../../../src/orchestrator/canonicalise-value-ops.js';
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
