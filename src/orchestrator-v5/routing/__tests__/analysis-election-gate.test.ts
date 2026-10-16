/**
 * The analysis-election gate — unit guards.
 *
 * ⭐ EVERY CORPUS IN THIS FILE COMES FROM OUTSIDE THE AUTHOR'S HEAD, because
 * CLAUDE.md trap 22 says a corpus drawn from the author's head cannot see the
 * class the author did not imagine, and preamble P7 says a predicate over a
 * producer's field must be derived from the PRODUCER, never from an observed
 * distribution. The three corpora are:
 *
 *   1. MUST-DEMOTE — parsed out of the served routing prompt's own
 *      `DO NOT ROUTE TO run_analysis:` list. The prompt author wrote these
 *      sentences as the canonical misroutes; nothing here was invented by this
 *      lane.
 *   2. MUST-ADMIT — scanned out of `src/` — every `run_analysis` chip message
 *      the product itself emits. This is preamble P8's obligation made
 *      executable: the product must be able to accept the sentence it printed.
 *   3. KNOWN-DROPPED — pinned EXACTLY, so the honest gap REDs if it grows OR
 *      shrinks (trap 22f's rule for shipping a known gap). ⚠ READ THE SCOPE
 *      WITH IT: each `toEqual` is exact over ITS OWN `CANDIDATES` array and
 *      silent about every message that array does not spell. They are SAMPLED
 *      FLOORS on an open class, never censuses of it — do not grow one to
 *      "match what drops" (trap 12's tracking mirror); add a row only when a
 *      real captured turn hits it.
 *
 * The fixture is hash-bound to the wire, so corpus 1 cannot decay into a
 * tautology when the prompt is re-pinned (trap 12b): the binding assertion
 * REDs and forces re-derivation.
 */

import { createHash } from 'node:crypto';
import { readFileSync,readdirSync,statSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { describe,expect,it } from 'vitest';


import {
carriesExplicitAnalysisRefusal,
looksLikeExplicitAnalysisRequest,
looksLikeImperativeRerun,
} from '../analytical-intent.js';

const REPO_ROOT = resolve(__dirname, '../../../..');
const SERVED_PROMPT_PATH = resolve(
  REPO_ROOT,
  'src/orchestrator-v5/context/__tests__/fixtures/served-orchestrator-prompt.txt',
);
const MANIFEST_PATH = resolve(REPO_ROOT, 'Prompts/canonical/manifest.json');
const SRC_ROOT = resolve(REPO_ROOT, 'src');

const servedPrompt = readFileSync(SERVED_PROMPT_PATH, 'utf8');

// ---------------------------------------------------------------------------
// 0. The producer binding — the rule this gate enforces is the prompt's own
// ---------------------------------------------------------------------------

describe('producer binding (P7) — the gate enforces the SERVED prompt sentence', () => {
  it('the fixture IS the served routing prompt (sha256 matches the canonical manifest)', () => {
    const fixtureSha = createHash('sha256').update(servedPrompt, 'utf8').digest('hex');
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
      pms_prompts: ReadonlyArray<{ key: string; sha256: string; cee_content_hash_16: string }>;
    };
    const routing = manifest.pms_prompts.find((p) => p.key === 'routing');
    expect(routing, 'manifest has no `routing` entry').toBeDefined();
    // Bound BOTH ways: the full digest and the 16-char form CEE serves as the
    // prompt identity on the wire (`routing=<version>#<hash>`).
    expect(fixtureSha).toBe(routing!.sha256);
    expect(fixtureSha.slice(0, 16)).toBe(routing!.cee_content_hash_16);
  });

  it('the served prompt still states the admission rule this gate implements', () => {
    // If this REDs, the producer changed its instruction and the gate's
    // predicate must be RE-DERIVED, not patched.
    expect(servedPrompt).toContain(
      'run_analysis: only for explicit requests to run, rerun, simulate or analyse.',
    );
  });
});

// ---------------------------------------------------------------------------
// 1. MUST-DEMOTE — the served prompt's own DO-NOT-ROUTE corpus
// ---------------------------------------------------------------------------

/** Parse the quoted sentences out of the prompt's `DO NOT ROUTE` block. */
function parseDoNotRouteCorpus(prompt: string): readonly string[] {
  const start = prompt.indexOf('DO NOT ROUTE TO run_analysis:');
  if (start < 0) return [];
  const rest = prompt.slice(start);
  const end = rest.indexOf('\n\n');
  const block = end < 0 ? rest : rest.slice(0, end);
  return block
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .flatMap((l) => [...l.matchAll(/"([^"]+)"/g)].map((m) => m[1]!));
}

const DO_NOT_ROUTE_CORPUS = parseDoNotRouteCorpus(servedPrompt);

describe('MUST-DEMOTE — the served prompt’s own DO-NOT-ROUTE corpus', () => {
  it('the corpus parsed non-vacuously (positive control — trap 13)', () => {
    // Without this, a parser that silently returned [] would make every
    // it.each below pass by iterating nothing.
    expect(DO_NOT_ROUTE_CORPUS.length).toBeGreaterThanOrEqual(5);
    expect(DO_NOT_ROUTE_CORPUS).toContain('Why is the leading option winning?');
  });


});

// ---------------------------------------------------------------------------
// 2. MUST-ADMIT — every run_analysis chip message the product emits
// ---------------------------------------------------------------------------

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'generated') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTsFiles(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/**
 * Every `message:` literal the product pairs with `action_type:
 * 'run_analysis'`, DERIVED from source rather than hand-listed (CLAUDE.md
 * rule 12). A new run-analysis chip therefore joins this corpus the moment it
 * is written, and if its copy is a shape the gate would demote, THIS test —
 * not a user — finds out.
 */
function deriveEmittedRunAnalysisChipMessages(): readonly string[] {
  const found = new Set<string>();
  for (const file of walkTsFiles(SRC_ROOT)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/action_type:\s*'run_analysis'/g)) {
      const back = src.slice(Math.max(0, m.index - 900), m.index);
      const messages = [...back.matchAll(/message:\s*'((?:[^'\\]|\\.)*)'/g)];
      const last = messages[messages.length - 1];
      if (last) found.add(last[1]!.replace(/\\'/g, "'"));
    }
  }
  return [...found].sort();
}

const EMITTED_CHIP_MESSAGES = deriveEmittedRunAnalysisChipMessages();

/**
 * Chip messages the scanner above structurally cannot see, because they are
 * built rather than written as a literal beside an `action_type`. Each is
 * named with the construction that produces it, so this stays a derivation
 * note and not a wish-list.
 */


describe('MUST-ADMIT (P8) — the product can accept the sentences it prints', () => {
  it('the source scan found the emitted chip messages (positive control — trap 13)', () => {
    // A scanner that silently matched nothing would make the it.each below
    // vacuous. The floor is the count measured at 293da078; it may grow.
    expect(EMITTED_CHIP_MESSAGES.length).toBe(5); // C1 deleted the conventional emitters; pin the remaining source set exactly.
    expect(EMITTED_CHIP_MESSAGES).toContain('Run analysis.');
    expect(EMITTED_CHIP_MESSAGES).toContain('Re-run the analysis.');
  });




});

// ---------------------------------------------------------------------------
// 3. The four discriminating twins, at predicate level
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// 3b. THE BARE IMPERATIVE — the founder's "Rerun."
// ---------------------------------------------------------------------------

/**
 * ⭐ PROVENANCE: a REAL user turn, not an invented one. Founder journey on
 * deployed staging (CEE `1af54f6c`), 2026-09-05T16:53Z, turn 6 of eleven. The
 * user typed exactly `Rerun.` and was answered with
 * {@link ANALYSIS_ELECTION_DEMOTION_TEXT} — a sentence that tells them to say
 * "run the analysis" instead. No analysis ran: `computed_at` was
 * byte-identical across turns 3 through 11.
 *
 * WHY THE PREDICATE MISSED IT. `ANALYSIS_REQUEST_VERB_SOURCE` (`(?:re-?)?run`)
 * requires an OBJECT, because `run` is an everyday transitive verb and `rerun`
 * has a nominal homograph. A message that is NOTHING BUT the verb has no
 * object to give it, so it fell to the bare-noun reading and was demoted.
 *
 * ⚠⚠ AND THE OBJECT REQUIREMENT DOES NOT ACTUALLY BUY THE EXCLUSION IT IS
 * DEFENDED FOR — MEASURED AT THIS TIP, NOT ASSUMED. The homograph sentence the
 * sibling predicate's ⚠ note names as the reason for the object rule,
 * "Rerun analysis showed a different leader.", ALREADY reads TRUE here: the
 * determiner is OPTIONAL in `ANALYSIS_REQUEST_OBJECT_SOURCE`, so `rerun` +
 * `analysis` matches and the gate ADMITS it today. Pinned below, because it is
 * the whole argument for why this change is strictly safe: an anchored pattern
 * that matches ONLY a message consisting of the bare verb cannot admit any
 * noun phrase, and therefore cannot make an already-admitted homograph worse.
 *
 * SCOPE, stated so it is not over-read. This admits an ELECTION the LLM router
 * already made; it does NOT widen {@link looksLikeImperativeRerun}, the
 * LLM-free DISPATCH predicate, whose false positive destroys a computed result
 * and which must stay narrow (trap 21 — two questions under one name). That
 * separation is asserted, not asserted-about.
 */
describe('TWIN E — the bare imperative re-run (founder journey, 2026-09-05)', () => {










  /**
   * ⭐ THE HONEST GAP — A SAMPLED FLOOR, NOT THE SET (trap 22f's rule for
   * shipping a known one). The shipped pattern is anchored at `^`, so a bare
   * `rerun` that follows a licensed left context is DROPPED. These are genuine
   * requests and each costs the user one click on the offered chip.
   *
   * ⚠ WHAT THE `toEqual` BELOW ACTUALLY PINS, stated so it is not over-read.
   * It is exact over ONE THING: the nine-message `CANDIDATES` array in the test
   * beneath it. It is a FLOOR on an OPEN class, never an inventory of that
   * class — a message this file does not spell cannot make it RED, however
   * plainly it belongs. Do NOT grow the list to "match what drops": enumerating
   * an open class is the tracking mirror this estate's doctrine bans (trap 12),
   * and it would trade a true small claim for a false large one. Add a row only
   * when a REAL captured turn hits it, and name the capture.
   *
   * ⚠ FURTHER MEMBERS OF THE SAME CLASS — MEASURED AT THIS TIP, DELIBERATELY
   * NEITHER PINNED NOR FIXED. `"Run."` and `"Run!"` are the same defect one
   * word shorter, and the nearest neighbours of the founder's own turn; also
   * declining are `"Rerun please."`, `"Yes, rerun."`, `"Just rerun."`,
   * `"Rerun now."`, `"Rerun again."`, `"Rerun!!"` and `"re run"`. All nine
   * decline identically at the base commit and at this head, so none is a
   * regression from this change — they are recorded so this file cannot read as
   * closing more of the class than it does. Adding a clause for any of them is
   * the second round trap 22f bans.
   *
   * ⚠ THE ROWS BELOW ARE ALSO THE ONLY THING THAT MAKES THE `^` ANCHOR
   * OBSERVABLE. Measured: with the `^` removed, "Fine, rerun." and "OK. Rerun."
   * flip to admitted and this assertion REDs. Every other message in every
   * corpus in this file declines by some other route, so without these rows the
   * `^` could be deleted with the whole suite green — it survived exactly that
   * mutant before they were added (re-measured: run the `^`-dropped source
   * against the pre-pin spec at `e68fb825` and it reads 81 passed, 0 failed).
   *
   * ⚠⚠ AND THE REASON WE ARE NOT SIMPLY DROPPING THE `^`. It was RUN, not
   * argued about — and the run says the opposite of "free": with the `^`
   * removed this file goes `1 failed | 83 passed (84)`, and the failure is the
   * `toEqual` immediately below (it read `1 failed | 81 passed (82)` before the
   * two `m`-flag rows below were added; the failing assertion is the same one). So dropping it is a plausible follow-up that
   * must bring its own evidence, NOT a free win — it widens the predicate from
   * "the message IS the verb" to "the message ENDS in the verb at a licensed
   * left context", which is a different and much larger input space that this
   * file's corpora barely sample. A second widening needs its own corpus from
   * outside the author's head, in BOTH directions (trap 22b). Adding another
   * clause here instead is the second round trap 22f bans.
   */
  const KNOWN_DROPPED_BARE: readonly string[] = [
    'Fine, rerun.',
    'OK. Rerun.',
    'Please rerun.',
    'Rerun and explain.',
    'Rerun, please.',
    'Rerun...',
  ];

  it('over these nine candidates, the bare-imperative dropped set is EXACTLY the pinned floor', () => {
    // ⚠ THE SCOPE IS THIS ARRAY AND NOTHING WIDER. `toEqual` makes the claim
    // exact over `CANDIDATES`, so it REDs if one of these nine changes side in
    // either direction — and it is SILENT about every message not listed here.
    // That is deliberate (see the sampled-floor note above), not an oversight.
    const CANDIDATES = [
      // Must be admitted — the bare verb itself.
      'Rerun.',
      'Re-run.',
      'rerun',
      // The honest gap, sampled — not the whole class.
      ...KNOWN_DROPPED_BARE,
    ];
    // Positive control (trap 13): the corpus is non-empty and mixed, so this
    // assertion can fail in both directions.
    expect(CANDIDATES.length).toBe(9);
    const dropped = CANDIDATES.filter((m) => !looksLikeExplicitAnalysisRequest(m)).sort();
    expect(dropped).toEqual([...KNOWN_DROPPED_BARE].sort());
  });

  it('does NOT widen the LLM-free dispatch predicate (trap 21 — the separation holds)', () => {
    const bareImperatives = [
      'Rerun.',
      'Re-run.',
      'rerun',
      'RERUN.',
      'Rerun!',
      '  Rerun.  ',
      're-run.',
      'Rerun .',
    ];
    // Positive control: the corpus is non-empty and the assertion is reachable.
    expect(bareImperatives.length).toBe(8);
    for (const message of bareImperatives) {
      // `looksLikeImperativeRerun` may DISPATCH with no LLM call, and a false
      // positive there destroys the user's computed result. It must stay
      // exactly as narrow as it was.
      expect(
        looksLikeImperativeRerun(message),
        `${message} must NOT become an LLM-free dispatch`,
      ).toBe(false);
      // …while the admission predicate now admits it.
      expect(
        looksLikeExplicitAnalysisRequest(message),
        `${message} must be admitted by the gate's predicate`,
      ).toBe(true);
    }
  });

  /**
   * ⭐ THE ABSENT `m` FLAG IS A PROTECTION, SO IT IS PINNED HERE.
   *
   * The pattern's block comment credits `^`, `$` AND the absence of the `m`
   * flag with keeping the match confined to a message that IS the bare verb.
   * The first two were observable (mutants M5/M6, and the `toEqual` floor
   * above). The third was NOT: adding `m` left the whole suite green, so a
   * successor could have added it — or written the pattern fresh with it —
   * and nothing would have gone red. This test is that missing guard.
   *
   * WHAT `m` WOULD DO, MEASURED at this head rather than argued: it turns `^`
   * and `$` into LINE anchors, so the property degrades from "the message IS
   * the verb" to "SOME LINE of the message is the verb" — and a message may
   * then carry arbitrary other content, including the nominal readings the
   * anchors exist to exclude. Both rows below read `demoted` at this head and
   * `admitted` with `/…/im`.
   *
   * The single-line control in the same test is what stops this passing
   * vacuously (trap 13): it fails if the predicate stops admitting anything,
   * so a green here is evidence about the ANCHORS, not about the predicate
   * being inert.
   */

});

// ---------------------------------------------------------------------------
// 4. The gate is inert on every other handler, and is MONOTONE
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// 5. The honest gap, pinned EXACTLY (trap 22f)
// ---------------------------------------------------------------------------

describe('KNOWN-DROPPED — pinned exactly so the gap cannot drift unobserved', () => {
  /**
   * These are genuine analysis requests the gate DEMOTES, because it reuses
   * `analytical-intent.ts`'s verb-position allowlist unchanged rather than
   * forking a second hand-maintained mirror of English (CLAUDE.md trap 12).
   * Each costs the user one click on the offered chip; none causes a wrong
   * action. The set is asserted with `toEqual`, so it REDs if it GROWS (a
   * regression) or SHRINKS (someone widened the allowlist and must re-read
   * the ⚠ notes in analytical-intent.ts, which explain why the sibling
   * predicate cannot afford that).
   */
  const KNOWN_DROPPED: readonly string[] = [
    // (a) UNLICENSED LEFT CONTEXT — inherited from the shared verb-position
    // allowlist, which this predicate reuses rather than forking.
    'Actually run the analysis.',
    'I want you to analyse this.',
    'Just run the analysis.',
    'Next run the analysis.',
    'So run the analysis.',
    'You should run the analysis.',
    // (b) A SHARED VETO FIRES ON A TOKEN ELSEWHERE IN THE MESSAGE. The verb
    // here sits in a perfectly licensed position; what drops these is the
    // negation / interrogative veto matching earlier text. The vetoes are
    // deliberately over-reaching (see their ⚠ notes in analytical-intent.ts)
    // and that over-reach lands in the SAFE direction for this gate — one
    // extra click, never a wrong action.
    //
    // ⚠ THESE SIX ENTRIES ARE ALSO THE ONLY THING THAT MAKES THE TWO VETOES
    // OBSERVABLE. Measured: with the negation veto deleted the first three
    // flip to admitted; with the interrogative veto deleted the last two do.
    // Every other message in every corpus here declines by POSITION instead,
    // so without these rows both vetoes could be deleted with the whole suite
    // green (they survived exactly that mutant before these were added).
    'Do not bother. Run the analysis.',
    'Never mind, run the analysis.',
    'Stop. Run the analysis.',
    'Do we need this? Run the analysis.',
    'Is this still valid? Run the analysis.',
  ];

  const CANDIDATES: readonly string[] = [
    // Licensed left contexts — must stay admitted.
    'Run the analysis.',
    'Please run the analysis.',
    'OK, run the analysis.',
    'Go ahead and analyse it.',
    'Now run the analysis.',
    "Let's run the analysis.",
    'Could you run the analysis?',
    'First, run the analysis.',
    'Instead, analyse the model.',
    // Unlicensed left contexts — the honest gap.
    ...KNOWN_DROPPED,
  ];

  it('the dropped set is EXACTLY the pinned list', () => {
    const dropped = CANDIDATES.filter((m) => !looksLikeExplicitAnalysisRequest(m)).sort();
    expect(dropped).toEqual([...KNOWN_DROPPED].sort());
  });
});

// ---------------------------------------------------------------------------
// 6. The two predicates answer DIFFERENT questions (trap 21)
// ---------------------------------------------------------------------------

describe('relationship to looksLikeImperativeRerun', () => {
  it('is a strict SUPERSET: it admits first-run requests the re-run predicate cannot', () => {
    const firstRunOnly = [
      'Run analysis.',
      'Run the analysis.',
      'Analyse this decision.',
      'Simulate the model.',
    ];
    for (const m of firstRunOnly) {
      // The discrimination is the point: if this ever collapses to equality,
      // someone has merged two predicates with opposite safe directions.
      expect(looksLikeImperativeRerun(m), `${m} must NOT be a re-run instruction`).toBe(false);
      expect(looksLikeExplicitAnalysisRequest(m), `${m} must be an explicit request`).toBe(true);
    }
  });

  it('admits everything the re-run predicate admits', () => {
    const rerunCorpus = [
      'Run the analysis again.',
      'Re-run the analysis.',
      'Rerun the analysis.',
      'Please re-run the analysis.',
      'Run it again.',
      'Analyse it again.',
    ];
    for (const m of rerunCorpus) {
      expect(looksLikeImperativeRerun(m), `${m} must be a re-run instruction`).toBe(true);
      expect(looksLikeExplicitAnalysisRequest(m), `${m} must also be admitted`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. THE DEMOTION PAYOFF — ordinary English gets a QUESTION, a refusal does not
// ---------------------------------------------------------------------------

/**
 * ⭐ THE ONE TEST THAT PROVES THE BLOCKER IS GONE, and it is a RED/GREEN PAIR
 * over the SAME outcome shape, not a single assertion.
 *
 * THE BLOCKER: ordinary English does not run the analysis. The admission
 * predicate is a four-verb regex, so a user who writes "ok lets see the
 * numbers" was answered with a sentence teaching them our vocabulary and no
 * way to proceed except retyping. Measured at the serving tip 07da2c0b:
 * 13/13 ordinary phrasings demoted, 5/5 literal commands admitted — the
 * predicate discriminates, the PAYOFF was wrong.
 *
 * ⚠ WHAT THIS PINS, AND WHAT IT DOES NOT. It pins the payoff SPLIT, bound by
 * IDENTITY: each message is asserted by its exact string against its exact
 * `offer` field (trap 19 — never a value predicate another message could
 * satisfy). It does NOT pin the admission rule, which this change leaves
 * byte-identical, and it is NOT a census of ordinary English — the arrays
 * below are sampled floors on an open class, exactly as the KNOWN-DROPPED
 * corpora above are.
 *
 * The GREEN arm alone would pass on a build that offered a run to EVERYONE,
 * including a user who just said "don't". The RED arm is what makes the
 * assertion about the split rather than about the offer, and it is the arm a
 * naive "make demotion offer" fix breaks.
 */
describe('the demotion payoff — ask on a phrasing miss, never on a refusal', () => {
  /**
   * PROVENANCE: the ordinary-English corpus measured against the serving-tip
   * predicate on 15 Sep 2026. Every member demotes; none contains a negator.
   */


  /**
   * PROVENANCE: the negation-veto corpus already recorded verbatim on
   * `RERUN_NEGATION_VETO_PATTERNS` as the sentences that, before that veto
   * existed, each dispatched a real `run_analysis`. These are the messages an
   * offer would be arguing with.
   */








  it('the refusal split is driven by the SHARED negation veto, not a second list', () => {
    // Trap 12 — the two readers must not be able to disagree about what a
    // refusal is. Positive control (a refusal) and contrast control (an
    // ordinary request) in the same run, so a dead predicate cannot pass this.
    expect(carriesExplicitAnalysisRefusal("Don't run the analysis.")).toBe(true);
    expect(carriesExplicitAnalysisRefusal('ok lets see the numbers')).toBe(false);
    // And the admission predicate agrees with it: a refusal is never admitted.
    expect(looksLikeExplicitAnalysisRequest("Don't run the analysis.")).toBe(false);
  });
});
