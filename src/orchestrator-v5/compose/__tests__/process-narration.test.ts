/**
 * The process-narration egress guard — the chain-of-thought leak.
 *
 * ⭐⭐ EVERY FIXTURE IN THIS FILE IS A VERBATIM STRING FROM A REAL USER SESSION,
 * not a string invented here. `artefacts/manual-test-2026-09-03/
 * olumi-debug-f2e2df1b-20260903.json` in `Talchain/olumi-programme-docs`, UI
 * build `86786efb`, scenario `7826c742-2939-4584-917c-f1286a663ae4`. That is
 * deliberate and it is the point: a corpus drawn from the author's head cannot
 * see the class the author did not imagine (CLAUDE.md trap 22), and this whole
 * defect is a class nobody imagined — the leaked strings pass BOTH shipped
 * guards clean.
 *
 * The negative controls are drawn from the SAME nineteen-turn capture: five
 * assistant replies that were correct and must survive the guard untouched.
 * A control set written here would only prove the guard agrees with its
 * author.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  applyProcessNarrationGuard,
  findProcessNarrationHit,
  INTERNAL_IDENTIFIER_PATTERNS,
  PROCESS_NARRATION_FALLBACK_TEXT,
  PROCESS_NARRATION_PATTERNS,
  ROUTE_TAXONOMY_PATTERNS,
  ROUTING_SELF_TALK_PATTERNS,
  RULE_CITATION_PATTERNS,
  SELF_HONESTY_POLICY_PATTERNS,
  SENTENCE_SPLIT,
  THIRD_PERSON_READER_PATTERNS,
} from '../process-narration.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../forbidden-user-facing-phrases.js';
import { isPlanningText } from '../../routing/strip-planning-preamble.js';

// ── THE TWO LEAKS, VERBATIM ────────────────────────────────────────────────
/** Turn 18 of the capture. routing prompt v121 (hash bec840a648800928). */
const LEAK_DELIBERATION =
  `The user's asking about specific structural values ("50%" strengths on ` +
  `outcomes and risks). Let me check what's actually in the model. There's no ` +
  `field carrying edge strengths or coefficient magnitudes as raw percentages ` +
  `visible in graph.edges , those show qualitative relationship phrases ` +
  `(moderate positive link, etc.), not "50%". This looks like they may be ` +
  `looking at something in the UI (like a display default) that isn't ` +
  `reflected in the ContextPack's relationship labels. I shouldn't invent an ` +
  `explanation for a number I can't ground.`;

/** Turn 15 of the capture. `edit_graph_default@v11 (staging)`. */
const LEAK_ROUTING_VERDICT =
  `This is a question about existing analysis results, not a model edit ` +
  `request. Per the conversation, updating Sales Headcount Investment from ` +
  `£80 to £100,000 widened Continue With Founder-Led Sales's lead by about 1 ` +
  `percentage point (now winning in 63% of runs), because the higher ` +
  `investment value increases the modelled Runway Depletion Risk more ` +
  `strongly, which weighs against the goal. That link is still flagged as ` +
  `fragile, so treat the shift as directional rather than settled. No model ` +
  `changes are needed to answer this.`;

/** The 29 Aug witnessed monologue — the class the SHIPPED stripper already saw. */
const PRIOR_WITNESSED_MONOLOGUE =
  `The user wants two things: change a factor value, and then see what it ` +
  `does to the comparison. Per rule 9 (one action per turn), I'll handle the ` +
  `value change first.`;

// ── THE NEGATIVE CONTROLS, ALSO VERBATIM FROM THE SAME CAPTURE ─────────────
const GOOD_ANSWERS: ReadonlyArray<readonly [string, string]> = [
  [
    'analysis headline (turn 3)',
    `Staying founder-led comes out ahead, leading in 62% of simulations ` +
      `against 38% for hiring a dedicated sales team, but this lead should not ` +
      `be treated as settled.`,
  ],
  [
    'two-paragraph edit receipt (turn 13)',
    `Updated Sales Headcount Investment from £80 to £100,000. The scale for ` +
      `this factor now allows values up to £130,000. This makes the last ` +
      `analysis stale. Re-run analysis to see how this affects the results.` +
      `\n\nThis change affects the model. The current analysis may not reflect ` +
      `it. Run the analysis to see updated results.`,
  ],
  [
    'honest mutation denial (turn 11)',
    `I have not changed the model yet. Tell me what you want to change, and I ` +
      `will help apply it.`,
  ],
  [
    'units-glitch answer (turn 10)',
    `The £80 figure is a units glitch, not a real number: your brief mentions ` +
      `£80-120k for the first hire, but the model stored the raw figure as £80 ` +
      `rather than £80,000, and it's flagged as extracted from the brief ` +
      `needing confirmation.`,
  ],
  [
    'cap refusal (turn 12)',
    `Value £100,000 exceeds the factor's cap of £100. I haven't changed ` +
      `anything. You can extend the scale to allow it, or give a value within ` +
      `the current range.`,
  ],
  [
    'the answer the model gave one turn later, when asked again (turn 19)',
    `I'm saying the first: I don't have visibility of any strength ` +
      `percentages on your factors and risks.`,
  ],
];

// ── THE MARKER CORPUS — ONE STRING PER PATTERN, PROVEN COMPLETE ───────────
/**
 * ⭐ WHY THIS EXISTS AND WHY IT IS NOT A HAND-MAINTAINED MIRROR.
 *
 * Two properties below need a string that MATCHES a given pattern, and a
 * regex cannot be run backwards to produce one. So the strings are written
 * here — and the `marker corpus` block asserts, DERIVED FROM
 * `PROCESS_NARRATION_PATTERNS` ITSELF, that every pattern in the exported set
 * is matched by at least one member. A pattern added without a corpus string
 * REDs that assertion; it cannot land silently. That is the completeness check
 * a derived guard can never perform on itself (CLAUDE.md trap 12d: derivation
 * proves agreement, a corpus is what notices the list is short).
 *
 * ⚠ These are hand-written, unlike every other fixture in this file, and that
 * is a deliberate and disclosed exception: they exist to reach each pattern,
 * not to prove the predicate's breadth is right. The evidence about breadth is
 * the capture above and the false-positive sweep in the PR — never this list.
 */
const MARKER_CORPUS: ReadonlyArray<readonly [string, string]> = [
  // RULE_CITATION_PATTERNS
  ['rule citation · per rule N', 'Per rule 9, I will handle the value change first.'],
  ['rule citation · rule N says', 'Rule 9 says one action per turn, so I will pick one.'],
  ['rule citation · rule N (gloss)', 'I am following rule 9 (the one about turns) here.'],
  // THIRD_PERSON_READER_PATTERNS
  ['third-person reader · verb', 'The user wants two things from this turn.'],
  ['third-person reader · contraction', "The user's asking about strengths."],
  // ROUTING_SELF_TALK_PATTERNS
  ['routing self-talk · one action per turn', 'I am limited to one action per turn.'],
  ['routing self-talk · can only route one', 'I can only route one request at a time.'],
  // SELF_HONESTY_POLICY_PATTERNS
  ['self-honesty policy', "I shouldn't invent an explanation for that."],
  // INTERNAL_IDENTIFIER_PATTERNS
  ['internal identifier · CamelCase type', "Nothing in the ContextPack's labels carries that."],
  ['internal identifier · dotted path', 'Nothing in graph.edges carries that.'],
  // ROUTE_TAXONOMY_PATTERNS
  ['route taxonomy · not an edit request', 'This is a question, not a model edit request.'],
  ['route taxonomy · no model changes needed', 'No model changes are needed to answer this.'],
];

/**
 * The stripper's SOURCE. Read rather than imported because the property being
 * pinned is that this module's binding is IMPORTED there — a structural fact a
 * behavioural test cannot distinguish from a verbatim local copy.
 */
const STRIPPER_SOURCE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../routing/strip-planning-preamble.ts'),
  'utf8',
);

describe('the marker corpus — complete over the exported set, by derivation', () => {
  it('every pattern in PROCESS_NARRATION_PATTERNS is matched by at least one member', () => {
    // ⭐ THE ANTI-MIRROR ASSERTION THAT ACTUALLY BITES. Iterates the SET, not
    // the corpus, so adding a thirteenth pattern with no exemplar REDs here
    // and every property below stays honest about its own coverage.
    const uncovered = PROCESS_NARRATION_PATTERNS.filter(
      (pattern) => !MARKER_CORPUS.some(([, text]) => pattern.test(text)),
    ).map((pattern) => pattern.source);
    expect(uncovered).toEqual([]);
  });

  it('all SIX classes are represented — none silently absent', () => {
    // The previous spec's table covered five of six: ROUTING_SELF_TALK_PATTERNS
    // had no exemplar in either new file, while a comment claimed "every class
    // is reachable … one exemplar per class". Derived from the groups now, so
    // a seventh class cannot be omitted the same way.
    const CLASSES: ReadonlyArray<readonly [string, readonly RegExp[]]> = [
      ['RULE_CITATION_PATTERNS', RULE_CITATION_PATTERNS],
      ['THIRD_PERSON_READER_PATTERNS', THIRD_PERSON_READER_PATTERNS],
      ['ROUTING_SELF_TALK_PATTERNS', ROUTING_SELF_TALK_PATTERNS],
      ['SELF_HONESTY_POLICY_PATTERNS', SELF_HONESTY_POLICY_PATTERNS],
      ['INTERNAL_IDENTIFIER_PATTERNS', INTERNAL_IDENTIFIER_PATTERNS],
      ['ROUTE_TAXONOMY_PATTERNS', ROUTE_TAXONOMY_PATTERNS],
    ];
    // The union of the six named groups IS the exported set — so the six
    // above are all of them, not five of six plus an unnamed remainder.
    expect(CLASSES.flatMap(([, group]) => [...group])).toEqual([
      ...PROCESS_NARRATION_PATTERNS,
    ]);
    for (const [name, group] of CLASSES) {
      expect(
        MARKER_CORPUS.some(([, text]) => group.some((p) => p.test(text))),
        `${name} has no corpus exemplar`,
      ).toBe(true);
    }
  });
});

describe('process-narration — the two witnessed leaks', () => {
  it('the deliberation monologue is condemned WHOLE and replaced with an answer', () => {
    const r = applyProcessNarrationGuard(LEAK_DELIBERATION);

    expect(r.rewritten).toBe(true);
    expect(r.remedy).toBe('block_replaced');
    // The measure that condemns it: a strict majority of narration sentences.
    expect(r.sentencesTotal).toBe(5);
    expect(r.sentencesRemoved).toBe(4);
    expect(r.sentencesRemoved * 2).toBeGreaterThan(r.sentencesTotal);

    expect(r.text).toBe(PROCESS_NARRATION_FALLBACK_TEXT);
    // Not silence, and not a monologue.
    expect(r.text.length).toBeGreaterThan(0);
    // None of the four internal tells survives into what the user reads.
    for (const tell of ["The user's", 'graph.edges', 'ContextPack', "I shouldn't invent"]) {
      expect(r.text).not.toContain(tell);
    }
  });

  it('the routing verdict is excised SENTENCE-WISE and the real answer survives', () => {
    const r = applyProcessNarrationGuard(LEAK_ROUTING_VERDICT);

    expect(r.rewritten).toBe(true);
    expect(r.remedy).toBe('sentences_removed');
    expect(r.sentencesTotal).toBe(4);
    expect(r.sentencesRemoved).toBe(2);
    // NOT a majority — which is exactly why this block keeps its answer.
    expect(r.sentencesRemoved * 2).not.toBeGreaterThan(r.sentencesTotal);

    // The routing narration is gone …
    expect(r.text).not.toContain('not a model edit request');
    expect(r.text).not.toContain('No model changes are needed');
    // … and the two answer sentences are kept, whole.
    expect(r.text).toContain('updating Sales Headcount Investment from £80 to £100,000');
    expect(r.text).toContain('still flagged as fragile');
    expect(r.text).not.toBe(PROCESS_NARRATION_FALLBACK_TEXT);
  });

  it('⭐ the excised narration is ROUTED to the disclosure channel, never destroyed', () => {
    const monologue = applyProcessNarrationGuard(LEAK_DELIBERATION);
    // A condemned block goes to disclosure in full — all of it was deliberation.
    expect(monologue.narration).toBe(LEAK_DELIBERATION);

    const verdict = applyProcessNarrationGuard(LEAK_ROUTING_VERDICT);
    // A sentence-wise excision hands over exactly the sentences it removed …
    expect(verdict.narration).toContain('not a model edit request');
    expect(verdict.narration).toContain('No model changes are needed to answer this');
    // … and nothing that stayed in the answer.
    expect(verdict.narration).not.toContain('still flagged as fragile');
  });

  it('BOTH leaks passed the SHIPPED guards clean — the gap this module closes', () => {
    // This is the refutable claim the whole change rests on, so it is pinned
    // here rather than asserted in a header.
    //
    // ⚠ THE `context pack` LIMB IS PINNED TO A FROZEN HISTORIC REGEX, NOT TO
    // THE LIVE ONE. This change widened that entry, so calling the live
    // `findForbiddenPhraseHit` would now report a hit and the historic fact
    // would silently stop being testable — a control pinned to "whatever is
    // current" decays into a tautology the first time current moves
    // (CLAUDE.md trap 12b). The literal below is the entry EXACTLY as it read
    // at `f4c8f501`; it is a record of what shipped and is never updated.
    const SHIPPED_AT_f4c8f501 = /\bcontext[\s_]packs?\b/i;
    expect(SHIPPED_AT_f4c8f501.test(LEAK_DELIBERATION)).toBe(false);
    // CONTRAST, same run: that historic pattern was not blind — it saw the
    // separator-bearing spelling perfectly well. The miss was one character.
    expect(SHIPPED_AT_f4c8f501.test('I built the context pack for this turn.')).toBe(true);
    // And the widening bites: the CamelCase spelling from the capture is now
    // caught by the live entry too (defence in depth behind this module).
    expect(findForbiddenPhraseHit("… reflected in the ContextPack's labels.")).not.toBeNull();

    // The routing-verdict leak carries no forbidden phrase at all, then or now.
    expect(findForbiddenPhraseHit(LEAK_ROUTING_VERDICT)).toBeNull();

    // The new guard sees both leaks.
    expect(findProcessNarrationHit(LEAK_DELIBERATION)).toBe("The user's asking");
    expect(findProcessNarrationHit(LEAK_ROUTING_VERDICT)).toBe('not a model edit request');
  });
});

describe('process-narration — the answers that must survive', () => {
  it.each(GOOD_ANSWERS)('leaves %s byte-identical', (_name, text) => {
    const r = applyProcessNarrationGuard(text);
    expect(r.rewritten).toBe(false);
    expect(r.remedy).toBe('none');
    expect(r.text).toBe(text);
    expect(r.narration).toBe('');
  });

  it('preserves paragraph structure when it does excise', () => {
    const twoParagraphs =
      `The user wants a summary. Founder-led sales leads in 62% of runs.` +
      `\n\nThe margin is not settled.`;
    const r = applyProcessNarrationGuard(twoParagraphs);
    expect(r.remedy).toBe('sentences_removed');
    expect(r.text).toBe('Founder-led sales leads in 62% of runs.\n\nThe margin is not settled.');
  });

  it('never returns empty for non-empty input, on EVERY marker in the set', () => {
    // ⚠ THIS TEST REPLACED A VACUOUS ONE, AND THE VACUITY IS WORTH RECORDING.
    // The previous version interpolated `pattern.source.slice(0, 0)` — which
    // is ALWAYS the empty string — so its loop fed one constant twelve times
    // and it was a single case wearing a per-marker sweep's name. The sweep is
    // now over MARKER_CORPUS, which `the marker corpus` block below proves
    // reaches every pattern in the exported set.
    for (const [name, exemplar] of MARKER_CORPUS) {
      const r = applyProcessNarrationGuard(exemplar);
      expect(r.text.trim().length, `${name} produced empty output`).toBeGreaterThan(0);
    }
    expect(applyProcessNarrationGuard(LEAK_DELIBERATION).text.trim().length).toBeGreaterThan(0);
  });

  it('is idempotent — a second pass changes nothing', () => {
    for (const input of [LEAK_DELIBERATION, LEAK_ROUTING_VERDICT, PRIOR_WITNESSED_MONOLOGUE]) {
      const once = applyProcessNarrationGuard(input);
      const twice = applyProcessNarrationGuard(once.text);
      expect(twice.rewritten).toBe(false);
      expect(twice.text).toBe(once.text);
    }
  });
});

describe('the replacement answer', () => {
  it('survives every guard that runs AFTER this one at the finaliser', () => {
    // The ordering argument in turn-executor.ts depends on this. If the
    // fallback carried a forbidden phrase or a success claim, running this
    // guard first would silently hand the later guards a response to erase.
    expect(findForbiddenPhraseHit(PROCESS_NARRATION_FALLBACK_TEXT)).toBeNull();
    expect(findSuccessClaimHit(PROCESS_NARRATION_FALLBACK_TEXT)).toBeNull();
    expect(findProcessNarrationHit(PROCESS_NARRATION_FALLBACK_TEXT)).toBeNull();
  });

  it('is one honest sentence and one question, and names no option', () => {
    // Paul's standard for this turn: say it in one sentence, then ask the
    // clarifying question. Not silence, not a monologue, and not a shrug.
    const sentences = PROCESS_NARRATION_FALLBACK_TEXT.split(SENTENCE_SPLIT);
    expect(sentences).toHaveLength(2);
    expect(PROCESS_NARRATION_FALLBACK_TEXT).toMatch(/can't ground/i);
    expect(PROCESS_NARRATION_FALLBACK_TEXT).toMatch(/tell me which/i);
    // Names no option from the capture — a leading-option claim here would be
    // a fabrication on a turn that just admitted it has no grounding.
    expect(PROCESS_NARRATION_FALLBACK_TEXT).not.toMatch(/founder-led|sales team/i);
  });
});

describe('ONE marker set, TWO remedies — the anti-mirror assertion', () => {
  it('the planning stripper IMPORTS this module\'s set — asserted at its source', () => {
    // ⚠ THIS REPLACED AN ASSERTION THAT COULD NOT FAIL. The previous version
    // was `for (const p of PROCESS_NARRATION_PATTERNS) expect(
    // PROCESS_NARRATION_PATTERNS).toContain(p)`, which is true of any array
    // unconditionally and never referenced the stripper at all. It carried
    // this test's name while pinning nothing.
    //
    // The property is STRUCTURAL — one module importing another's binding —
    // and a behavioural test cannot see it: a verbatim local copy of the array
    // behaves identically and is exactly the mirror this is meant to forbid.
    // So it is pinned the way the estate pins wiring: at the source, the same
    // mechanism as `blocked-slot-claim-guard-callsite-pin.test.ts`.
    expect(STRIPPER_SOURCE).toContain(
      "from '../compose/process-narration.js'",
    );
    expect(STRIPPER_SOURCE).toContain('PROCESS_NARRATION_PATTERNS');
    expect(STRIPPER_SOURCE).toContain('return PROCESS_NARRATION_PATTERNS.some((p) => p.test(text));');
    // And it declares no second set of its own — the drift this forbids.
    expect(STRIPPER_SOURCE).not.toMatch(/^(?:export )?const \w*PATTERNS\w*(?::[^=]*)?\s*=\s*\[/m);
  });

  it('EVERY pattern in the exported set is reachable through isPlanningText', () => {
    // The behavioural half, and it is derived: the corpus below is proven
    // complete over `PROCESS_NARRATION_PATTERNS` by the `marker corpus` block,
    // so a thirteenth pattern cannot land covering the egress path while
    // silently missing the orientation path — the corpus check REDs first.
    for (const [name, exemplar] of MARKER_CORPUS) {
      expect(isPlanningText(exemplar), `${name} is invisible to isPlanningText`).toBe(true);
      expect(findProcessNarrationHit(exemplar), `${name} is invisible to the guard`).not.toBeNull();
    }
  });

  it('the remedies stay DIFFERENT — the stripper may empty, the guard may not', () => {
    // Trap 21: two authorities under similar names answering different
    // questions. The fix is to name them apart, never to align them. This
    // asserts they have NOT been aligned.
    expect(isPlanningText(PRIOR_WITNESSED_MONOLOGUE)).toBe(true);
    expect(applyProcessNarrationGuard(PRIOR_WITNESSED_MONOLOGUE).text.length).toBeGreaterThan(0);
  });

  it('a factor legitimately containing "the user" is untouched', () => {
    // The narrowing the shipped stripper documented, preserved through the
    // move: the marker is bound to a mental/communicative verb.
    for (const label of [
      'The user base grew 12% last quarter.',
      'Time to value for the user journey is the binding constraint.',
    ]) {
      expect(findProcessNarrationHit(label)).toBeNull();
      expect(applyProcessNarrationGuard(label).rewritten).toBe(false);
    }
  });
});
