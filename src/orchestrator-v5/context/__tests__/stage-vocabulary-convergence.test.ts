/**
 * ⭐ ONE CANONICAL STAGE VOCABULARY, MAPPED AT NAMED EDGES — and a guard that
 * REDs when a fourth one is minted or a second edge appears.
 *
 * ── THE STATE THIS TEST EXISTS TO END ────────────────────────────────────────
 * Three stage vocabularies coexisted in this estate:
 *
 *   wire   (canonical)  frame | analyse | decide | review      @talchain/schemas `Stage`
 *   CEE V4 / DSK        frame | ideate | evaluate | decide | optimise
 *   DGAI `ScenarioStage` frame | ideate | evaluate | decide | optimise
 *
 * and the CEE/DSK one was DECLARED TWICE, character-for-character, in two files
 * with no link between them (`src/orchestrator/types.ts` and `src/dsk/types.ts`).
 * That is the same-named-twins defect applied to a vocabulary, where it is
 * worse than usual: two unions can drift by one member and every consumer still
 * compiles, because each file is internally consistent with its own copy.
 *
 * ── THE RULING THIS ENFORCES ─────────────────────────────────────────────────
 * Name ONE canonical owner and map at the edges; remove the competitor rather
 * than translating between three forever; and DO NOT MINT A FOURTH.
 *
 *   CANONICAL   `Stage` / `StageType` from `@talchain/schemas` — the wire enum,
 *               which declares itself canonical and tells consumers to derive
 *               from it rather than re-declare it.
 *   EDGE        `DecisionStage` survives as the DSK BUNDLE's vocabulary, with
 *               ONE declaration (`src/dsk/types.ts`) and ONE translation point
 *               (`mapStageToDecisionStage`, edit-graph-dispatch.ts).
 *
 * ── ⚠ WHAT THIS TEST CANNOT DO, STATED SO NOBODY OVER-READS IT ───────────────
 * It is a DERIVED guard, and a derived guard proves AGREEMENT, never
 * COMPLETENESS (CLAUDE.md trap 12d). It reads the source tree and asserts where
 * the distinguishing literals appear; it cannot tell you the vocabulary is
 * RIGHT. The allowlists below are therefore deliberately SMALL and reviewed —
 * a new occurrence anywhere else REDs, which is the only property being
 * claimed. Each allowlist is proven non-vacuous by a positive control that
 * shows the sweep can SEE a violation.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';
import { Stage } from '@talchain/schemas/boundary';

import { DECISION_STAGES } from '../../../dsk/types.js';
import type { DecisionStage } from '../../../dsk/types.js';
import { POST_ANALYSIS_STAGES, deriveAuthoritativeStage } from '../derive-stage.js';

const SRC_ROOT = new URL('../../../', import.meta.url).pathname;

/** Every `.ts` file under `src/`, excluding tests and fixtures. */
function productionSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules' || entry === 'generated') continue;
        walk(full);
        continue;
      }
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || entry.endsWith('.d.ts')) continue;
      out.push(full);
    }
  };
  walk(SRC_ROOT);
  return out;
}

/**
 * Files permitted to DECLARE the five-member DSK/V4 vocabulary, i.e. to spell
 * two or more of its distinguishing members as string literals in one union or
 * array. Exactly one entry: the owner.
 */
const DECLARATION_OWNERS = ['dsk/types.ts'] as const;

/**
 * Files permitted to TRANSLATE between the canonical wire vocabulary and the
 * DSK/V4 one. Exactly one entry: the named edge.
 */
const TRANSLATION_EDGES = ['orchestrator-v5/handlers/edit-graph-dispatch.ts'] as const;

/** The literals that can only belong to the five-member vocabulary. */
const DISTINGUISHING = ['ideate', 'evaluate', 'optimise'] as const;

/**
 * ⭐ COMMENTS ARE STRIPPED BEFORE SCANNING, AND THE FIRST RUN OF THIS TEST IS
 * WHY. It flagged `coaching/post-analysis-wrapper.ts` and
 * `coaching/typed-intent-directive.ts` as fourth vocabularies. Neither declares
 * one: both carry DOCBLOCKS that name the competing vocabularies in prose,
 * which is exactly the behaviour this convergence wants MORE of. A guard that
 * punishes a file for explaining the problem teaches authors to stop
 * explaining, so it scans CODE only.
 *
 * The stripper is deliberately crude (block and line comments, no template or
 * regex-literal awareness). Crude in the SAFE direction: it can only remove
 * text, so it can never invent a violation, and the positive control below
 * proves it still sees a real one.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Distinct distinguishing members a file spells as a quoted literal IN CODE.
 * Used by the TRANSLATION test, where any mention counts — a translator is a
 * file that talks about both vocabularies at all.
 */
function distinguishingMembers(source: string): string[] {
  const code = stripComments(source);
  return DISTINGUISHING.filter(m =>
    new RegExp(`["'\`]${m}["'\`]`).test(code),
  );
}

/**
 * ⭐ A DECLARATION IS A SHAPE, NOT A COUNT — and the second run of this test is
 * why. The first version flagged `orchestrator/deterministic/coaching-context-builder.ts`
 * for spelling `'ideate'` and `'evaluate'`. That file declares nothing: it is a
 * rule engine with four separate `ctx.stage === '…'` comparisons, which is the
 * ordinary, correct way to CONSUME a vocabulary. A guard that cannot tell a
 * consumer from a declaration would force every branching rule into an
 * allowlist, and an allowlist that large stops meaning anything.
 *
 * So this binds to the SHAPE a declaration actually has: two or more of the
 * distinguishing literals ADJACENT IN ONE LIST — separated by `|` (a union) or
 * `,` (an array or Set literal), whitespace and newlines only. Separate
 * comparison statements have code between them and do not match.
 *
 * This is CLAUDE.md trap 19 applied to a source sweep: bind by the construct's
 * identity, never by a value predicate another construct could satisfy.
 */
function declaresVocabularyList(source: string): boolean {
  const code = stripComments(source);
  const member = `["'\`](?:${DISTINGUISHING.join('|')})["'\`]`;
  const anyMember = `["'\`](?:frame|ideate|evaluate|decide|optimise)["'\`]`;
  // <distinguishing member> <sep> [<any member> <sep>]* <distinguishing member>
  return new RegExp(`${member}\\s*[|,]\\s*(?:${anyMember}\\s*[|,]\\s*)*${member}`).test(code);
}

describe('stage vocabulary — one canonical owner, named edges, no fourth', () => {
  it('the canonical vocabulary is the wire enum, and it has exactly four members', () => {
    // Bound by IDENTITY to the shared contract, never to a literal list retyped
    // here — a retyped list is the mirror this whole test exists to abolish.
    expect(Stage.options).toEqual(['frame', 'analyse', 'decide', 'review']);
  });

  it('the DSK/V4 vocabulary has exactly ONE declaration in CEE', () => {
    const offenders: string[] = [];
    for (const file of productionSources()) {
      const rel = relative(SRC_ROOT, file);
      if (DECLARATION_OWNERS.some(o => rel === o)) continue;
      if (TRANSLATION_EDGES.some(e => rel === e)) continue;
      const source = readFileSync(file, 'utf8');
      if (declaresVocabularyList(source)) {
        offenders.push(`${rel} — spells ${distinguishingMembers(source).join(', ')} in one list`);
      }
    }
    expect(
      offenders,
      'a file outside the single owner and the single edge spells two or more of ' +
        'ideate/evaluate/optimise — that is a fourth vocabulary being minted',
    ).toEqual([]);
  });

  it('POSITIVE CONTROL — the sweep can SEE a violation, and DISCRIMINATES a consumer from a declaration', () => {
    // Trap 13: an absence assertion is vacuous until it has been shown it can
    // detect a presence. Trap 20's corollary: at least one probe whose expected
    // answer DIFFERS, because a blind instrument can fake agreement but cannot
    // fake a discrimination it is not making. Both are here.

    // A newly-minted fourth vocabulary — MUST be caught, in both spellings.
    expect(
      declaresVocabularyList(`type Stage2 = 'frame' | 'ideate' | 'evaluate' | 'decide';`),
      'a union re-declaring the vocabulary must be caught',
    ).toBe(true);
    expect(
      declaresVocabularyList(`const S = ['frame', 'ideate', 'evaluate', 'decide', 'optimise'];`),
      'an array re-declaring the vocabulary must be caught',
    ).toBe(true);
    // Across newlines, as a real declaration is usually formatted.
    expect(declaresVocabularyList("type S =\n  | 'ideate'\n  | 'evaluate';")).toBe(true);

    // CONTRAST CONTROLS — a CONSUMER is deliberately NOT flagged. This is the
    // discrimination the test above exists to prove is being made; without it
    // the guard would be indistinguishable from one that fires on any file
    // mentioning two members.
    expect(
      declaresVocabularyList(
        `if (ctx.stage === 'ideate') return 'challenge';\nif (ctx.stage === 'evaluate') return 'compare';`,
      ),
      'separate comparisons are consumption, not declaration',
    ).toBe(false);
    expect(declaresVocabularyList(`const stage: StageType = 'analyse';`)).toBe(false);

    // And the comment-stripper is proven load-bearing rather than assumed: a
    // docblock naming the vocabulary must NOT be read as declaring it.
    expect(
      declaresVocabularyList(`/** V4's DecisionStage ('frame' | 'ideate' | 'evaluate'). */\nconst x = 1;`),
      'a docblock explaining the vocabulary must not be punished as declaring it',
    ).toBe(false);
  });

  it('the ONE declaration and its runtime list agree, member for member', () => {
    // `DECISION_STAGES` is what `dsk/linter.ts` validates the published bundle
    // against, so this is the pairing that has teeth. Typed to `DecisionStage`,
    // so a member absent from the type is a COMPILE error, not a test failure.
    const expected: readonly DecisionStage[] = ['frame', 'ideate', 'evaluate', 'decide', 'optimise'];
    expect(DECISION_STAGES).toEqual(expected);
  });

  it('translation between the two vocabularies happens at exactly ONE named edge', () => {
    const translators: string[] = [];
    for (const file of productionSources()) {
      const source = readFileSync(file, 'utf8');
      // A translator is a file that spells BOTH a canonical-only member
      // (`analyse` or `review` as a stage) AND two or more DSK-only members.
      const speaksCanonical = /["'`]analyse["'`]/.test(stripComments(source));
      if (speaksCanonical && distinguishingMembers(source).length >= 2) {
        translators.push(relative(SRC_ROOT, file));
      }
    }
    expect(
      translators.sort(),
      'more than one file translates between the wire vocabulary and the DSK one — ' +
        'that is two authorities on one mapping, which is how they drift',
    ).toEqual([...TRANSLATION_EDGES].sort());
  });
});

describe('the stage authority owns what its own promotion MEANS', () => {
  it('a FRAMING turn can never be classified post-analysis (the too-wide direction)', () => {
    // ⚠ THE FIRST VERSION OF THIS TEST ASSERTED SOMETHING FALSE, AND THE
    // CORRECTION IS THE POINT. It claimed no member of `POST_ANALYSIS_STAGES`
    // is reachable without a fresh analysis. `decide` IS — a client can request
    // `decide` on a graphless scenario and the derivation passes it through
    // untouched (the stale-correction twin is bounded to scenarios that HAVE a
    // graph, deliberately). The invariant was written against the failure mode
    // in hand rather than against the spec (CLAUDE.md trap 13d), and the guard
    // that actually excludes that turn is the wrapper's SECOND conjunct —
    // freshness — not the stage family at all.
    //
    // The property that IS true, and IS this set's job: a turn the user is
    // framing must never be admitted, because on such a turn a stale analysis
    // would put a rerun chip in front of someone who is still writing the
    // question. Derived by running the derivation from `frame`, never restated.
    const reachableFromAFramingTurn = new Set<string>();
    for (const freshness of ['none', 'unknown', 'stale', 'fresh'] as const) {
      for (const optionCount of [null, 0, 1, 2, 5]) {
        for (const hasGraph of [true, false]) {
          reachableFromAFramingTurn.add(
            deriveAuthoritativeStage({ requestedStage: 'frame', freshness, optionCount, hasGraph }),
          );
        }
      }
    }
    // Sanity: the sweep must actually reach something, or the assertion below
    // is vacuous (trap 13 — an absence claim needs to prove it can see).
    expect(reachableFromAFramingTurn.has('frame')).toBe(true);
    expect(
      [...reachableFromAFramingTurn].filter(s => POST_ANALYSIS_STAGES.has(s as never) && s !== 'decide'),
      'a `frame` request resolves to a stage declared post-analysis — a framing turn ' +
        'would be offered post-analysis coaching',
    ).toEqual([]);
    // `decide` is the ONE admitted promotion from a framing request, and only
    // under `fresh` — pinned explicitly so it cannot widen silently.
    expect(
      deriveAuthoritativeStage({ requestedStage: 'frame', freshness: 'fresh', optionCount: 2, hasGraph: true }),
    ).toBe('decide');
    expect(
      deriveAuthoritativeStage({ requestedStage: 'frame', freshness: 'stale', optionCount: 2, hasGraph: true }),
    ).toBe('frame');
  });

  it('every stage the derivation PROMOTES to is declared post-analysis (the direction that loses affordances)', () => {
    // The opposite-direction twin. The test above stops the set being too WIDE;
    // this one stops it being too NARROW — which is the direction that shipped:
    // `decide` became reachable, nothing said it was post-analysis, and the
    // review-card chips silently stopped appearing.
    const promotions = new Set<string>();
    for (const requestedStage of Stage.options) {
      for (const optionCount of [2, 3, 7]) {
        const derived = deriveAuthoritativeStage({
          requestedStage,
          freshness: 'fresh',
          optionCount,
          hasGraph: true,
        });
        if (derived !== requestedStage) promotions.add(derived);
      }
    }
    expect(promotions.size, 'sanity: the derivation must actually promote something').toBeGreaterThan(0);
    for (const stage of promotions) {
      expect(
        POST_ANALYSIS_STAGES.has(stage as never),
        `the derivation promotes a fresh-analysis turn to \`${stage}\`, but ` +
          '`POST_ANALYSIS_STAGES` does not contain it — every consumer asking ' +
          '"has an analysis run?" will silently answer no and withdraw its affordance',
      ).toBe(true);
    }
  });
});
