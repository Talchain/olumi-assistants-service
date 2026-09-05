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
 *      shrinks (trap 22f's rule for shipping a known gap).
 *
 * The fixture is hash-bound to the wire, so corpus 1 cannot decay into a
 * tautology when the prompt is re-pinned (trap 12b): the binding assertion
 * REDs and forces re-derivation.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  evaluateAnalysisElection,
  ANALYSIS_ELECTION_DEMOTION_TEXT,
  GATED_ANALYSIS_HANDLER_ID,
} from '../analysis-election-gate.js';
import {
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

  it.each(DO_NOT_ROUTE_CORPUS)('demotes %j', (message) => {
    const outcome = evaluateAnalysisElection({
      electedHandlerId: GATED_ANALYSIS_HANDLER_ID,
      message,
    });
    expect(outcome.kind).toBe('demoted');
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
const CONSTRUCTED_CHIP_MESSAGES: readonly string[] = [
  // chip-generator.ts `promptChip('floor_rerun_analysis', …)` — a PROMPT chip,
  // so it carries no `action_type` and re-enters routing as ordinary text.
  // That makes it the single most important entry here.
  'Please re-run the analysis.',
  // handlers/auto-run-after-draft.ts `AUTO_RUN_TURN_MESSAGE`. It normally
  // arrives as a chip_click and never reaches this gate, but if the sanctioned
  // auto-run's own sentence were inadmissible that would be a contradiction
  // worth REDing on.
  'Run a provisional analysis of the drafted model.',
];

describe('MUST-ADMIT (P8) — the product can accept the sentences it prints', () => {
  it('the source scan found the emitted chip messages (positive control — trap 13)', () => {
    // A scanner that silently matched nothing would make the it.each below
    // vacuous. The floor is the count measured at 293da078; it may grow.
    expect(EMITTED_CHIP_MESSAGES.length).toBeGreaterThanOrEqual(6);
    expect(EMITTED_CHIP_MESSAGES).toContain('Run analysis.');
    expect(EMITTED_CHIP_MESSAGES).toContain('Re-run the analysis.');
  });

  it.each([...EMITTED_CHIP_MESSAGES, ...CONSTRUCTED_CHIP_MESSAGES])(
    'admits the product-emitted chip message %j',
    (message) => {
      const outcome = evaluateAnalysisElection({
        electedHandlerId: GATED_ANALYSIS_HANDLER_ID,
        message,
      });
      expect(outcome.kind).toBe('admitted');
    },
  );

  it('the demotion copy’s OWN offer is admissible (the P8 acceptance path)', () => {
    // The demoted turn tells the user to say "run the analysis". If the gate
    // then demoted that, the product would be asking for something it refuses
    // — preamble P8's exact defect. The offered phrase is EXTRACTED from the
    // shipped copy, so editing the copy without checking cannot pass.
    const quoted = /"([^"]+)"/.exec(ANALYSIS_ELECTION_DEMOTION_TEXT);
    expect(quoted, 'demotion copy no longer contains a quoted offer').not.toBeNull();
    const outcome = evaluateAnalysisElection({
      electedHandlerId: GATED_ANALYSIS_HANDLER_ID,
      message: quoted![1]!,
    });
    expect(outcome.kind).toBe('admitted');
  });
});

// ---------------------------------------------------------------------------
// 3. The four discriminating twins, at predicate level
// ---------------------------------------------------------------------------

describe('the four discriminating twins (predicate level)', () => {
  it('TWIN A — the measured P0 message is DEMOTED', () => {
    const outcome = evaluateAnalysisElection({
      electedHandlerId: GATED_ANALYSIS_HANDLER_ID,
      message: 'Use your best guess for the rest and draft the model now.',
    });
    expect(outcome.kind).toBe('demoted');
    expect(outcome.kind === 'demoted' && outcome.reason).toBe('no_explicit_analysis_request');
  });

  it.each([
    // ⚠ ONE CASE PER (VERB × OBJECT-PRESENCE) CELL. Two mutants that deleted a
    // verb from one of the two pattern sources SURVIVED an earlier green suite
    // because the sources overlapped and every case here happened to carry an
    // object. The object-LESS rows are what make the object-less pattern
    // observable, and the `re-` rows are what make its inflection observable.
    'Run the analysis.',        // run   + object   (the ambiguous verb)
    'Run analysis.',            // run   + bare noun object
    'Re-run the analysis.',     // rerun + object
    'Rerun the numbers.',       // rerun + object, other noun
    'Analyse this decision.',   // analyse  + object
    'Analyse.',                 // analyse  + NO object
    'Simulate the model.',      // simulate + object
    'Simulate.',                // simulate + NO object
    'Re-analyse.',              // re-analyse + NO object
  ])('TWIN B (opposite direction) — explicit intent %j is ADMITTED', (message) => {
    expect(
      evaluateAnalysisElection({
        electedHandlerId: GATED_ANALYSIS_HANDLER_ID,
        message,
      }).kind,
    ).toBe('admitted');
  });

  it.each([
    'Add an option for delaying six months.',
    'Set the capex to 250000.',
    'Can you split that factor in two?',
    'Fill in the missing values for me.',
    'Thanks, that looks right.',
    'Draft the model now.',
  ])('TWIN C — ordinary clarification / repair / edit / chat %j is DEMOTED', (message) => {
    expect(
      evaluateAnalysisElection({
        electedHandlerId: GATED_ANALYSIS_HANDLER_ID,
        message,
      }).kind,
    ).toBe('demoted');
  });

  it.each([
    // Refusal outranks everything (the shared negation veto).
    "Don't run the analysis yet.",
    'No need to re-run the analysis.',
    'Do not run the analysis on this version.',
    // A question ABOUT analysing is not a request to analyse (the shared
    // interrogative veto). The served prompt's word is "explicit requests".
    'Should I run the analysis?',
    'Do we need to re-run the analysis?',
    'Is the analysis still valid?',
    'Is it worth running the analysis now?',
  ])('TWIN C (veto arm) — refusals and questions %j are DEMOTED', (message) => {
    expect(
      evaluateAnalysisElection({
        electedHandlerId: GATED_ANALYSIS_HANDLER_ID,
        message,
      }).kind,
    ).toBe('demoted');
  });

  it('TWIN D — a demoted election still carries an answer (no silent substitution)', () => {
    const outcome = evaluateAnalysisElection({
      electedHandlerId: GATED_ANALYSIS_HANDLER_ID,
      message: 'Use your best guess for the rest and draft the model now.',
    });
    expect(outcome.kind).toBe('demoted');
    const text = outcome.kind === 'demoted' ? outcome.assistant_text : '';
    expect(text.trim().length).toBeGreaterThan(0);
    // It must never claim the analysis ran, is running, or is about to.
    expect(text).not.toMatch(/\b(?:running|I will run|analysis is complete|results are)\b/i);
    // It must invite the model work the user actually asked about.
    expect(text).toMatch(/\bmodel\b/i);
  });
});

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
  it('the founder\'s exact turn-6 message is ADMITTED', () => {
    // Bound by IDENTITY: this exact string, this exact outcome. Not a value
    // predicate another message could satisfy (CLAUDE.md trap 19).
    const outcome = evaluateAnalysisElection({
      electedHandlerId: GATED_ANALYSIS_HANDLER_ID,
      message: 'Rerun.',
    });
    expect(outcome.kind).toBe('admitted');
    expect(outcome.kind === 'admitted' && outcome.reason).toBe('explicit_analysis_request');
  });

  it.each([
    'Rerun.',
    'Re-run.',
    'rerun',
    'RERUN.',
    'Rerun!',
    '  Rerun.  ',
    're-run.',
    'Rerun .',
  ])('MUST-FIRE — a message that is nothing but the verb, %j, is ADMITTED', (message) => {
    expect(
      evaluateAnalysisElection({ electedHandlerId: GATED_ANALYSIS_HANDLER_ID, message }).kind,
    ).toBe('admitted');
  });

  it.each([
    // Every must-fire row above has its OPPOSITE-DIRECTION TWIN here, in the
    // same order (trap 22b: a corpus that tests one direction is a guard
    // watching one door).
    ['Rerun.', 'Rerun?'],            // instruction vs question
    ['Re-run.', 'Re-runs.'],         // verb vs plural noun
    ['rerun', 'reruns'],             // verb vs plural noun, no punctuation
    ['RERUN.', 'RERUN COSTS.'],      // verb vs noun-modifier, case-insensitive
    ['Rerun!', 'Rerun what?'],       // instruction vs question with an object
    ['  Rerun.  ', '  The rerun.  '],// verb vs determiner + noun
    ['re-run.', 're-run cost.'],     // verb vs compound noun
    ['Rerun .', 'Rerun later.'],     // verb vs verb + adjunct (not bare)
  ])('TWIN — %j is admitted but its neighbour %j is still DEMOTED', (_fire, decline) => {
    expect(
      evaluateAnalysisElection({ electedHandlerId: GATED_ANALYSIS_HANDLER_ID, message: decline })
        .kind,
    ).toBe('demoted');
  });

  it.each([
    // The four nominal readings this repo RECORDS as having once wrongly
    // EXECUTED a re-run (see `IMPERATIVE_RERUN_PATTERNS`' ⚠ note). They are
    // questions about a PAST run and must never be read as instructions.
    'What changed in the re-run?',
    'Show me the re-run results.',
    'How long did the rerun take?',
    'Was the rerun better?',
    // Refusals — the shared negation veto must still outrank the new pattern.
    "Don't rerun.",
    'Do not rerun.',
    'Never rerun.',
    // Interrogatives — the shared interrogative veto must still fire.
    'Should I rerun?',
    'Do we rerun?',
  ])('UNCHANGED — %j stays DEMOTED (the shared safety envelope still governs)', (message) => {
    expect(
      evaluateAnalysisElection({ electedHandlerId: GATED_ANALYSIS_HANDLER_ID, message }).kind,
    ).toBe('demoted');
  });

  it('the homograph the object rule is defended for was ALREADY admitted — this change cannot worsen it', () => {
    // Pinned so the load-bearing argument for this change cannot silently
    // become false. If this ever flips to `demoted`, the justification above
    // is stale and TWIN E must be re-argued, not merely re-run.
    expect(
      evaluateAnalysisElection({
        electedHandlerId: GATED_ANALYSIS_HANDLER_ID,
        message: 'Rerun analysis showed a different leader.',
      }).kind,
    ).toBe('admitted');
  });

  /**
   * ⭐ THE HONEST GAP, PINNED EXACTLY (trap 22f's rule for shipping a known
   * one). The shipped pattern is anchored at `^`, so a bare `rerun` that
   * follows a licensed left context is DROPPED. These are genuine requests and
   * each costs the user one click on the offered chip.
   *
   * ⚠ THIS SET IS ALSO THE ONLY THING THAT MAKES THE `^` ANCHOR OBSERVABLE.
   * Measured: with the `^` removed, "Fine, rerun." and "OK. Rerun." flip to
   * admitted and this assertion REDs. Every other message in every corpus in
   * this file declines by some other route, so without these rows the `^`
   * could be deleted with the whole suite green — it survived exactly that
   * mutant before they were added.
   *
   * ⚠⚠ AND THE REASON WE ARE NOT SIMPLY DROPPING THE `^`. It was RUN, not
   * argued about: removing it closes both rows below and REDs nothing in this
   * file. That makes it a plausible follow-up, NOT a free win — it widens the
   * predicate from "the message IS the verb" to "the message ENDS in the verb
   * at a licensed left context", which is a different and much larger input
   * space that this file's corpora barely sample. A second widening needs its
   * own corpus from outside the author's head, in BOTH directions (trap 22b).
   * Adding another clause here instead is the second round trap 22f bans.
   */
  const KNOWN_DROPPED_BARE: readonly string[] = [
    'Fine, rerun.',
    'OK. Rerun.',
    'Please rerun.',
    'Rerun and explain.',
    'Rerun, please.',
    'Rerun...',
  ];

  it('the bare-imperative dropped set is EXACTLY the pinned list', () => {
    const CANDIDATES = [
      // Must be admitted — the bare verb itself.
      'Rerun.',
      'Re-run.',
      'rerun',
      // The honest gap.
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
});

// ---------------------------------------------------------------------------
// 4. The gate is inert on every other handler, and is MONOTONE
// ---------------------------------------------------------------------------

describe('scope', () => {
  it.each([
    'edit_graph',
    'set_factor_value',
    'add_constraint',
    'explain_results',
    'what_would_flip',
    'explain_from_structure',
    'adjust_edge_strength',
  ])('is inert on %s, whatever the message says', (handlerId) => {
    // Bound by IDENTITY (the handler id), never by a value predicate another
    // handler could satisfy.
    for (const message of ['Run the analysis.', 'Draft the model now.', '']) {
      expect(evaluateAnalysisElection({ electedHandlerId: handlerId, message }).kind).toBe(
        'not_analysis_election',
      );
    }
  });

  it('never turns a non-analysis election INTO one (the monotonicity claim)', () => {
    // The gate's only reachable non-inert outcomes are `admitted` (unchanged
    // behaviour) and `demoted` (handler suppressed). There is no arm that
    // produces an analysis, which is what makes a false positive strictly
    // no worse than today's staging behaviour.
    const kinds = new Set(
      ['run_analysis', 'edit_graph'].flatMap((h) =>
        ['Run the analysis.', 'Draft the model now.'].map(
          (m) => evaluateAnalysisElection({ electedHandlerId: h, message: m }).kind,
        ),
      ),
    );
    expect([...kinds].sort()).toEqual(['admitted', 'demoted', 'not_analysis_election']);
  });
});

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
