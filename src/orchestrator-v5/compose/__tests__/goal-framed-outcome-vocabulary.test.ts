/**
 * THE DETERMINISTIC PROSE DOES NOT DESIGNATE A WINNER.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE RULING (Paul, 2026-09-07)
 *
 *   "There's never a winner… we should never really be saying 'winner' anyway."
 *
 * What the user is entitled to read is three things, and a contest is none of
 * them: what the most likely outcome is on the data so far, how confident we
 * can be in it, and which option is most likely to achieve THEIR GOAL.
 *
 *   "This is not simply providing causal analysis results. This is meant to be
 *    enhancing their critical and creative thinking. Terminology like 'winner'
 *    is wrong."
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A CEE-SIDE GUARD EXISTS AT ALL — the UI half cannot reach this.
 *
 * The sibling UI change (DecisionGuideAI #1280) fixed the UI's own string
 * literals and pinned them with `noWinnerVocabulary.spec.ts`. It cannot see
 * these sentences: they are composed HERE and delivered inside the turn
 * payload, so they arrive on the Reasoning tab as data. Measured live on
 * deployed staging on 2026-09-07, DOM-scoped to the panel, both scanner
 * controls passing:
 *
 *   "Segment came out ahead in 99% of runs of this model. 3 options are
 *    effectively eliminated (each has less than a 1% chance of winning)."
 *
 * Both halves of that sentence are built in `analysis-result-headline.ts`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SCOPE, STATED — this file covers the HARDCODED DETERMINISTIC TEMPLATES ONLY.
 *
 * It is deliberately NOT a fix for the root. The Communication Glossary's
 * banned-term table maps `winner → "leads", "comes out ahead"`, the served
 * prompt says "default to 'leading option'", and `terminology-rewrite.ts`
 * actively converts `the winner → the leading option`. THE VOCABULARY IS
 * COMPLIANCE, NOT DRIFT — so the model keeps producing it legitimately, and
 * fixing the root is a separate job blocked on the canonical Glossary. This
 * file removes the sentences that are on screen TODAY; it does not and cannot
 * stop new ones being generated.
 *
 * Consequently BARE "leads" IS NOT BANNED HERE. It is the Glossary's sanctioned
 * replacement for "winner", #1280's own banned-vocabulary regex deliberately
 * spares it (it bans `leading option` and `leads on`, not `leads`), and it has
 * a wide live estate in CEE — `currently leads` alone spans the headline floor,
 * `explanation-fallback.ts`, the what-if flip prose and the coaching signals.
 * Rewriting it from this seat would contradict the served prompt rather than
 * comply with a ruling. It is reported as the residual for the Glossary job.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ THE PART THAT IS A SAFETY PROPERTY, NOT A COPY PREFERENCE.
 *
 * `LEADER_CLAIM_PATTERNS` in `compose/leading-option-egress-guard.ts` is NOT
 * only the observe-only alarm. Its string-level reading `textNamesLeadingOption`
 * is consumed by REAL ENFORCEMENT: `context/withheld-leader-projection.ts:550`
 * and `context/withheld-history-redaction.ts:274` both REDACT on it, and
 * `compose.ts`'s per-field `evidence_gap` projection gates on it.
 *
 * So a rewrite that moves the copy OUT of that vocabulary does not merely blind
 * an alarm — it silently switches off redaction. A withheld turn would then be
 * free to carry "X scored highest against your goal in 72% of runs" into
 * history and into the projection, which is precisely the leak the withheld
 * machinery exists to prevent. The copy change and the vocabulary addition are
 * ONE change; splitting them across two PRs would ship the hole in between.
 *
 * That is what {@link textNamesLeadingOption} is asserted on below, and it is
 * the assertion to keep if any other is ever relaxed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { textNamesLeadingOption } from '../leading-option-egress-guard.js';
import { unitStatesRunnerUpGap } from '../runner-up-gap-statistic.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../..');

/**
 * The deterministic prose emitters this guard covers, by path relative to
 * `src/`. Every one of them was measured (2026-09-07, `grep -a` at
 * 9de184f1, contrast control clean) to emit at least one contest phrase.
 *
 * ⚠ `compose/leading-option-egress-guard.ts` is deliberately ABSENT. It holds
 * the banned phrases as REGEX PATTERNS on purpose — that is the scanner, and
 * scanning the scanner would ban the vocabulary it exists to detect.
 *
 * ⚠ `src/prompts/**` and `src/cee/decision-review/decompose-prompts.ts` are
 * deliberately ABSENT. They are the ROOT (see SCOPE above) and are out of this
 * lane's scope by instruction.
 */
const COVERED_EMITTERS: readonly string[] = [
  'orchestrator-v5/coaching/analysis-result-headline.ts',
  'orchestrator-v5/routing/run-comparison-gate.ts',
  'orchestrator-v5/coaching/objective-contradiction.ts',
  'orchestrator-v5/signals/coaching-signals.ts',
];

/**
 * Contest phrases that must not appear in a STRING OR TEMPLATE LITERAL in the
 * covered emitters. Taken from #1280's `BANNED` regex so the two halves of the
 * product share one vocabulary rather than drifting apart, minus bare `leads`
 * (see SCOPE) and plus `chance of winning`, which is CEE-only copy.
 */
const BANNED_IN_PROSE: ReadonlyArray<{ readonly label: string; readonly re: RegExp }> = [
  { label: 'came out ahead', re: /\b(?:came|comes?|coming)\s+out\s+ahead\b/i },
  { label: 'chance of winning', re: /\bchance\s+of\s+winning\b/i },
  { label: 'the leading option has changed', re: /\bleading\s+option\s+has\s+changed\b/i },
  { label: 'leads on', re: /\bleads\s+on\b/i },
  { label: 'now leads', re: /\bnow\s+leads\b/i },
  { label: 'winner', re: /\bwinners?\b/i },
  { label: 'best option', re: /\bbest\s+option\b/i },
  { label: 'top option', re: /\btop\s+option\b/i },
  { label: 'beats', re: /\bbeats\b/i },
];

/**
 * ⚠⚠ WHY BARE "leading option" IS **NOT** ON THAT LIST, THOUGH #1280 BANS IT.
 *
 * The first draft of this file banned it, and that was wrong — measured, not
 * argued. `compose/terminology-rewrite.ts:69-78` does not merely tolerate the
 * phrase, it MANUFACTURES it at egress:
 *
 *     /\brecommendation\b/gi  → 'leading option'
 *     /\bthe\s+winner\b/gi    → 'the leading option'
 *
 * So the phrase is re-introduced downstream of any emitter that stops saying
 * it, and `terminology-rewrite.ts` is out of this lane's scope by instruction
 * (it is the root, blocked on Paul's canonical Glossary). A ban here would be
 * a rule the product actively defeats one layer later — the estate's
 * hand-maintained-mirror defect with the mirror facing a rewriter.
 *
 * It is also live in at least ten other CEE emitters not covered by this file
 * (`explanation-fallback.ts:424,532`, `lens-selector.ts` lens bodies,
 * `flip-threshold-card-row.ts:178-179`, `chip-generator.ts:927`, the
 * `assist.v1` route family, …), and — the tell that the term is genuinely
 * contested rather than simply wrong — `coaching/copy-quality-gate.ts:129`
 * already BANS it on the COACHING path while the turn path manufactures it.
 * Two surfaces, opposite rules, today.
 *
 * What IS banned above is the specific retired SENTENCE
 * ("The leading option has changed"), which is what the ruling reached and what
 * was on screen. Settling the term itself is the Glossary job, not this one.
 */

/**
 * Strips `//` line comments and block comments so a phrase DOCUMENTED in a
 * JSDoc (this codebase documents its own retired copy heavily, and must keep
 * doing so) is not read as a phrase EMITTED.
 *
 * ⚠ This is the instrument, so it carries its own controls in the first test
 * below — a stripper that silently ate everything would make every subsequent
 * assertion pass by testing nothing (CLAUDE.md trap 13).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * ⚠⚠ PROSE IS NOT CODE, AND THIS SEPARATION IS THE WHOLE POINT OF THE FILE.
 *
 * The first draft scanned the comment-stripped SOURCE and reported
 * `analysis-result-headline.ts` as emitting "winner" 47 times. Every hit was an
 * INTERNAL IDENTIFIER — `resolveWinner`, `winnerProb`, `winnerLabel`,
 * `ResolvedWinner`, `winner.runnerUpProb`. None of them is a sentence and none
 * of them reaches a user.
 *
 * Renaming those would be a WIRE CHANGE, not a copy change: `leading_option_id`,
 * `alternative_winner_label`, `win_probability` and `recommended_option_id` are
 * contract fields with consumers in three services, and `winner`/`winnerProb`
 * are the local reads of them. The ruling is about what the user READS. A guard
 * that cannot tell a sentence from a field name would either force a contract
 * change or be switched off — and a guard that gets switched off protects
 * nothing.
 *
 * So the scan is over STRING AND TEMPLATE LITERALS ONLY. Inside a template,
 * `${…}` substitutions are removed too: `${delta.current_leading_label}` is an
 * identifier that happens to sit inside quotes, and the words around it are the
 * prose. This function is the instrument, so it is controlled below.
 */
function extractLiterals(source: string): string {
  const withoutComments = stripComments(source);
  const literals: string[] = [];
  const patterns = [
    /'(?:[^'\\\n]|\\.)*'/g,
    /"(?:[^"\\\n]|\\.)*"/g,
    /`(?:[^`\\]|\\.)*`/g,
  ];
  for (const re of patterns) {
    for (const match of withoutComments.matchAll(re)) {
      // Drop `${…}` substitutions — those are identifiers, not prose.
      literals.push(match[0].replace(/\$\{[^}]*\}/g, ' '));
    }
  }
  return literals.join('\n');
}

function readEmitter(relative: string): string {
  return readFileSync(resolve(SRC, relative), 'utf8');
}

describe('goal-framed outcome vocabulary — the instrument', () => {
  it('stripComments removes line and block comments but keeps string literals', () => {
    expect(stripComments('// the winner was named')).not.toMatch(/winner/);
    expect(stripComments('/* a winner here */')).not.toMatch(/winner/);
    expect(stripComments("const a = 'winner'")).toMatch(/winner/);
    expect(stripComments('const a = `came out ahead`')).toMatch(/came out ahead/);
  });

  it('the banned-phrase list matches the retired copy and spares the new copy', () => {
    const hits = (s: string) => BANNED_IN_PROSE.filter(({ re }) => re.test(s)).map((b) => b.label);

    // POSITIVE CONTROL — the exact sentences measured on deployed staging on
    // 2026-09-07. ⚠ THESE ARE THE RETIRED COPY ON PURPOSE. A bulk rename over
    // this repo rewrote them to the replacement wording while this file was
    // being written, which left the control asserting that the NEW sentence
    // contains the OLD phrase — unsatisfiable, and it was the failing test that
    // said so, not review. A control written in the vocabulary it is meant to
    // detect is not a control (CLAUDE.md trap 14b: a corpus that pins what the
    // product once said is evidence, not a fixture to keep current).
    expect(hits('Segment came out ahead in 99% of runs of this model.')).toContain('came out ahead');
    expect(hits('3 options are effectively eliminated (each has less than a 1% chance of winning).'))
      .toContain('chance of winning');
    expect(hits('The leading option has changed.')).toContain('the leading option has changed');
    expect(hits('Segment leads on the latest result.')).toContain('leads on');
    expect(hits('Segment led before, and Enterprise now leads.')).toContain('now leads');

    // ⚠ CONTRAST CONTROL for the exclusion documented above: bare "leading
    // option" must NOT be a hit, or this file has quietly taken on the
    // Glossary job it declines in its own header.
    expect(hits('Take a moment to explore the leading option and the factors shaping it.')).toEqual([]);

    // NEGATIVE CONTROL — the replacement copy must be clean, or this whole
    // file would be unsatisfiable and the "fix" would be to weaken it.
    expect(hits('Segment scored highest against your goal in 99% of runs of this model.')).toEqual([]);
    expect(hits('3 options are effectively eliminated (each scored highest in less than 1% of runs).'))
      .toEqual([]);
    expect(hits('Segment still scores highest on the latest result.')).toEqual([]);

    // BARE "leads" IS DELIBERATELY SPARED — see SCOPE. If this ever starts
    // failing, someone has widened the list past the Glossary's sanction
    // without the Glossary having moved.
    expect(hits('Segment currently leads.')).toEqual([]);
  });

  it('extractLiterals separates PROSE from WIRE FIELDS and INTERNAL IDENTIFIERS', () => {
    // The identifiers this lane must NOT rename — invisible to the scan.
    expect(extractLiterals('const winner = resolveWinner(enrichment, leading_option_id);')).toBe('');
    expect(extractLiterals('const p = winner.winnerProb;')).toBe('');
    expect(extractLiterals('interface X { alternative_winner_label: string }')).toBe('');
    expect(extractLiterals('const r = fact.recommended_option_id;')).toBe('');

    // Prose in every literal form — visible to the scan.
    expect(extractLiterals("const s = 'came out ahead';")).toContain('came out ahead');
    expect(extractLiterals('const s = "came out ahead";')).toContain('came out ahead');
    expect(extractLiterals('const s = `came out ahead`;')).toContain('came out ahead');

    // A template's `${…}` substitution is an identifier; the words around it
    // are the prose. Both halves of this assertion matter.
    const tpl = 'parts.push(`${delta.current_leading_label} came out ahead before.`);';
    expect(extractLiterals(tpl)).toContain('came out ahead');
    expect(extractLiterals(tpl)).not.toContain('current_leading_label');
  });

  it('every covered emitter exists and is non-empty', () => {
    // Guards the whole file against silently scanning nothing after a rename.
    for (const relative of COVERED_EMITTERS) {
      const source = readEmitter(relative);
      expect(source.length, `${relative} read empty`).toBeGreaterThan(1000);
    }
  });
});

describe('goal-framed outcome vocabulary — the deterministic emitters', () => {
  for (const relative of COVERED_EMITTERS) {
    it(`${relative} emits no contest vocabulary in a string or template literal`, () => {
      const literals = extractLiterals(readEmitter(relative));
      // The scan must have something to look at — a rename or a parse change
      // that silently emptied this would make every assertion below vacuous.
      expect(literals.length, `${relative} yielded no literals to scan`).toBeGreaterThan(200);
      const found = BANNED_IN_PROSE
        .filter(({ re }) => re.test(literals))
        .map(({ label, re }) => {
          const line = literals.split('\n').find((l) => re.test(l))?.trim() ?? '';
          return `${label}  ←  ${line.slice(0, 160)}`;
        });
      expect(found, `contest vocabulary emitted by ${relative}`).toEqual([]);
    });
  }
});

describe('goal-framed outcome vocabulary — the replacement stays visible to the leader-claim vocabulary', () => {
  /**
   * ⚠⚠ THIS IS THE SAFETY ASSERTION. See the header. `textNamesLeadingOption`
   * drives REDACTION in `withheld-leader-projection.ts` and
   * `withheld-history-redaction.ts`. Copy that names a leading option and is
   * INVISIBLE here does not get redacted on a withheld turn.
   */
  const REPLACEMENT_SENTENCES: readonly string[] = [
    'Segment scored highest against your goal in 99% of runs of this model.',
    'The option most likely to serve your goal has changed. Segment scored highest before, and Enterprise scores highest now.',
    'Enterprise scored highest on the latest result.',
    'Segment scored highest in the earlier run.',
    'Segment scored highest against your goal most often, but Enterprise is more likely to reach your stated target (40% against 55%).',
  ];

  for (const sentence of REPLACEMENT_SENTENCES) {
    it(`is seen by textNamesLeadingOption: "${sentence.slice(0, 56)}…"`, () => {
      expect(
        textNamesLeadingOption(sentence),
        'this sentence names a leading option but the SHARED vocabulary cannot see it — '
          + 'withheld-turn redaction would silently pass it through',
      ).toBe(true);
    });
  }

  /**
   * ⚠ THE OPPOSITE-DIRECTION TWIN (CLAUDE.md trap 22b — one predicate, two
   * harms, and a corpus that tests one direction is a guard watching one door).
   *
   * Adding `scor(e|es|ed|ing)\s+highest` to `GAP_BINDER_SRC` in
   * `runner-up-gap-statistic.ts` closes a GAP: without it "scored highest by 17
   * percentage points" — the retired category error wearing the new
   * vocabulary — is invisible to the redaction that exists to catch it.
   *
   * But the same alternative could open a LIE in the other direction: if it
   * caused the RATIFIED-CORRECT sentence to be redacted, the product would
   * silently lose the leader's own probability, which is the whole statistic
   * the ruling asked us to keep. The bare-`%` exclusion in `QTY_SRC` is what
   * separates the two, and it is asserted here in BOTH directions rather than
   * assumed from the docstring.
   */
  it('the new copy SURVIVES gap redaction, and its gap form does NOT', () => {
    // MUST SURVIVE — the leader's own share, no `percentage points` unit.
    expect(unitStatesRunnerUpGap('Segment scored highest against your goal in 99% of runs of this model.'))
      .toBe(false);
    expect(unitStatesRunnerUpGap('Segment scored highest in 42% of runs.')).toBe(false);

    // MUST BE CAUGHT — the retired gap statistic in the new vocabulary.
    expect(
      unitStatesRunnerUpGap('Segment scored highest by 17 percentage points.'),
      'the gap statistic is invisible to the redaction registry in the new vocabulary',
    ).toBe(true);

    // The retired vocabulary's gap form was already caught; it must stay caught,
    // so the addition is shown to be an EXTENSION and not a replacement.
    expect(unitStatesRunnerUpGap('Segment leads by 17 percentage points.')).toBe(true);
  });

  it('the vocabulary still discriminates — neutral prose is NOT a leader claim', () => {
    // Without this the assertion above could pass on a vocabulary that had been
    // widened into matching everything (a guard agreeing with itself).
    expect(textNamesLeadingOption('The analysis ran 5,000 simulations.')).toBe(false);
    expect(textNamesLeadingOption('Two different questions have two different answers here.')).toBe(false);
  });
});
