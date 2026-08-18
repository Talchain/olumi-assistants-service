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
  ANALYSIS_ELECTION_DEMOTION_TEXT_WITH_RUN_OFFER,
  ANALYSIS_ELECTION_RUN_CHIP,
  GATED_ANALYSIS_HANDLER_ID,
  withAnalysisElectionOffer,
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
      runAnalysisOfferable: true,
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

  it('the demotion’s OWN offered chip is admissible (the P8 acceptance path)', () => {
    // The demoted turn OFFERS a run. Its acceptance path is the chip: one click
    // sends `ANALYSIS_ELECTION_RUN_CHIP.message` back through the product. If
    // the gate then demoted that message, the product would be offering
    // something it refuses — preamble P8's exact defect. The message is READ
    // FROM THE SHIPPED CHIP, so re-wording the chip without checking cannot
    // pass.
    const outcome = evaluateAnalysisElection({
      electedHandlerId: GATED_ANALYSIS_HANDLER_ID,
      message: ANALYSIS_ELECTION_RUN_CHIP.message,
      runAnalysisOfferable: true,
    });
    expect(outcome.kind).toBe('admitted');
  });

  it('the offer is CARRIED BY the demotion, not left to a downstream chip rule', () => {
    // Bound by IDENTITY: the id and the handler, never a label another chip
    // could carry. This is what makes "one click" a property of the demotion
    // rather than of whatever the chip generator happens to do this turn.
    const outcome = evaluateAnalysisElection({
      electedHandlerId: GATED_ANALYSIS_HANDLER_ID,
      message: 'Use your best guess for the rest and draft the model now.',
      runAnalysisOfferable: true,
    });
    expect(outcome.kind).toBe('demoted');
    const chips = outcome.kind === 'demoted' ? outcome.suggested_actions : [];
    expect(chips).toEqual([ANALYSIS_ELECTION_RUN_CHIP]);
    expect(ANALYSIS_ELECTION_RUN_CHIP.action_type).toBe(GATED_ANALYSIS_HANDLER_ID);
    // The copy that names the offer is the one that ships with it.
    const text = outcome.kind === 'demoted' ? outcome.assistant_text : '';
    expect(text).toBe(ANALYSIS_ELECTION_DEMOTION_TEXT_WITH_RUN_OFFER);
    expect(text).toMatch(/\brun the analysis\b/i);
  });

  it('OPPOSITE DIRECTION — when no run can be honoured, neither the chip nor the sentence appears', () => {
    // ⭐ THE HALF THAT STOPS THE FIX BECOMING THE DEFECT IT REMOVES. A product
    // that always printed "or run the analysis" would be stating a capability
    // it does not provide on every model that cannot be analysed.
    const outcome = evaluateAnalysisElection({
      electedHandlerId: GATED_ANALYSIS_HANDLER_ID,
      message: 'Use your best guess for the rest and draft the model now.',
      runAnalysisOfferable: false,
    });
    expect(outcome.kind).toBe('demoted');
    expect(outcome.kind === 'demoted' && outcome.suggested_actions).toEqual([]);
    const text = outcome.kind === 'demoted' ? outcome.assistant_text : '';
    expect(text).toBe(ANALYSIS_ELECTION_DEMOTION_TEXT);
    expect(text).not.toMatch(/\brun the analysis\b/i);
    // …and it is still an answer, not a silence.
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it('the two variants differ ONLY by the offer (so the invitation is never lost)', () => {
    // Pins the composition: the offer sentence is ADDED to the invitation, it
    // does not replace it. A future edit that rewrote one variant alone would
    // RED here rather than silently diverging the two.
    expect(ANALYSIS_ELECTION_DEMOTION_TEXT_WITH_RUN_OFFER.startsWith(
      ANALYSIS_ELECTION_DEMOTION_TEXT,
    )).toBe(true);
    expect(ANALYSIS_ELECTION_DEMOTION_TEXT_WITH_RUN_OFFER).not.toBe(
      ANALYSIS_ELECTION_DEMOTION_TEXT,
    );
  });

  it('the copy leads with the user’s next step, not with what the system declined', () => {
    // ⭐ LEDGER L-43 (robotic / defensive register). The shipped defect opened
    // with a negation about the system and followed it with a self-
    // justification. Both variants are checked, because the register defect can
    // reappear in either.
    for (const text of [
      ANALYSIS_ELECTION_DEMOTION_TEXT,
      ANALYSIS_ELECTION_DEMOTION_TEXT_WITH_RUN_OFFER,
    ]) {
      // No opening negation about the system's own action.
      expect(text).not.toMatch(/^\s*(?:I have not|I did not|I didn’t|I haven’t|I cannot|I can’t)\b/i);
      // No explanation of the router's reading — that is the self-justification
      // half of the defect, and it is never the user's problem.
      expect(text).not.toMatch(/\bI (?:did not|didn’t) read\b/i);
      expect(text).not.toMatch(/\bbecause\b/i);
      // No apology.
      expect(text).not.toMatch(/\b(?:sorry|apolog)/i);
      // British English, sentence case, no em dashes (the served prompt's own
      // STYLE section).
      expect(text).not.toContain('—');
    }
  });
});

// ---------------------------------------------------------------------------
// 2b. The merge: the offer reaches the turn's chips without eating them
// ---------------------------------------------------------------------------

describe('withAnalysisElectionOffer — how the offer joins the turn’s chips', () => {
  const other = (id: string) => ({ id, label: id, message: `${id}.` });

  it('is an identity pass-through when there is no offer (every non-demoted turn)', () => {
    const base = [other('chip_prompt_a'), other('chip_prompt_b')];
    // Same REFERENCE, not merely equal: a turn the gate did not touch must be
    // byte-identical to before this change.
    expect(withAnalysisElectionOffer([], base, 3)).toBe(base);
  });

  it('prepends the offer and keeps the turn’s other chips', () => {
    const base = [other('chip_prompt_a')];
    expect(withAnalysisElectionOffer([ANALYSIS_ELECTION_RUN_CHIP], base, 3)).toEqual([
      ANALYSIS_ELECTION_RUN_CHIP,
      base[0],
    ]);
  });

  it('does not ship the same chip twice when the generator already produced it', () => {
    // The generator emits a byte-identical Run chip on several states; a
    // missing dedupe would put it on screen twice.
    const base = [{ ...ANALYSIS_ELECTION_RUN_CHIP }, other('chip_prompt_a')];
    expect(withAnalysisElectionOffer([ANALYSIS_ELECTION_RUN_CHIP], base, 3)).toEqual([
      ANALYSIS_ELECTION_RUN_CHIP,
      other('chip_prompt_a'),
    ]);
  });

  it('respects the caller’s chip budget, and the offer survives the cap', () => {
    const base = [other('chip_prompt_a'), other('chip_prompt_b'), other('chip_prompt_c')];
    const merged = withAnalysisElectionOffer([ANALYSIS_ELECTION_RUN_CHIP], base, 3);
    expect(merged).toHaveLength(3);
    // Bound by identity: the affordance the copy names is the one that must not
    // be the chip squeezed out.
    expect(merged[0]).toEqual(ANALYSIS_ELECTION_RUN_CHIP);
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
      runAnalysisOfferable: true,
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
        runAnalysisOfferable: true,
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
        runAnalysisOfferable: true,
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
        runAnalysisOfferable: true,
      }).kind,
    ).toBe('demoted');
  });

  it('TWIN D — a demoted election still carries an answer (no silent substitution)', () => {
    const outcome = evaluateAnalysisElection({
      electedHandlerId: GATED_ANALYSIS_HANDLER_ID,
      message: 'Use your best guess for the rest and draft the model now.',
      runAnalysisOfferable: true,
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
      expect(
        evaluateAnalysisElection({
          electedHandlerId: handlerId,
          message,
          runAnalysisOfferable: true,
        }).kind,
      ).toBe(
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
          (m) =>
            evaluateAnalysisElection({
              electedHandlerId: h,
              message: m,
              runAnalysisOfferable: true,
            }).kind,
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
   * Each costs the user one click on the chip the demotion now emits — or,
   * where the model could not be analysed anyway, costs nothing that was
   * available. None causes a wrong action. (⚠ Before the offer was bound to the
   * demotion, "one click on the offered chip" was a claim about a chip the
   * demoted turn did not emit; see THE OFFER in `analysis-election-gate.ts`.) The set is asserted with `toEqual`, so it REDs if it GROWS (a
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
