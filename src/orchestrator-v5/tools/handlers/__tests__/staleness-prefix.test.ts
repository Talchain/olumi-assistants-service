/**
 * Unit tests for `applyStalenessPrefix` (V5 explain-stabilisation Task 2).
 *
 * The helper replaces the old validator-rule-6 ordering check: instead of
 * the validator inspecting Sonnet's prose for a caveat-before-numeric
 * order, the handler prepends a fixed caveat phrase whenever the analysis
 * projection carries a `staleness_reason`. Idempotency keeps the prefix
 * from doubling when text already opens with a recognised caveat.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyStalenessPrefix,
  STALENESS_PREFIX,
  UNCONFIRMED_PREFIX,
} from '../staleness-prefix.js';
import {
  buildAnalysisStaleTemplate,
  buildAnalysisUnconfirmedTemplate,
  caveatForPreconditionVerdict,
} from '../no-op-helpers.js';

const SAMPLE_TEXT =
  'Hire Senior Engineer leads at 0.62 probability, 35 percentage points ahead of the runner-up.';

describe('applyStalenessPrefix', () => {
  it('returns text unchanged with prefixed=false when stalenessReason is null', () => {
    const out = applyStalenessPrefix(SAMPLE_TEXT, null);
    expect(out.text).toBe(SAMPLE_TEXT);
    expect(out.prefixed).toBe(false);
  });

  it('returns text unchanged with prefixed=false when stalenessReason is undefined', () => {
    const out = applyStalenessPrefix(SAMPLE_TEXT, undefined);
    expect(out.text).toBe(SAMPLE_TEXT);
    expect(out.prefixed).toBe(false);
  });

  it('prepends the caveat with prefixed=true when stalenessReason is set', () => {
    const out = applyStalenessPrefix(SAMPLE_TEXT, 'stale');
    expect(out.text.startsWith(STALENESS_PREFIX)).toBe(true);
    expect(out.text.endsWith(SAMPLE_TEXT)).toBe(true);
    expect(out.prefixed).toBe(true);
  });

  it('idempotent: text opening with STALENESS_PREFIX is not re-prepended', () => {
    const already = `${STALENESS_PREFIX} ${SAMPLE_TEXT}`;
    const out = applyStalenessPrefix(already, 'stale');
    expect(out.text).toBe(already);
    expect(out.prefixed).toBe(false);
  });

  it('idempotent: text opening with "Treat the figures below as directional…" is not re-prepended', () => {
    // Back-compat: prose produced by the legacy deterministic fallback
    // opens with this clause. Keeping it suppresses double-prefixing
    // during the transition window. The fixture body avoids forbidden
    // phrases (FORBIDDEN_USER_FACING_PHRASES) so the finaliser-level
    // egress guard would not rewrite it.
    const already =
      'Treat the figures below as directional rather than definitive. ' +
      SAMPLE_TEXT;
    const out = applyStalenessPrefix(already, 'stale');
    expect(out.text).toBe(already);
    expect(out.prefixed).toBe(false);
  });

  // V5 stale-aware explain recovery: the legacy "loaded from a prior
  // run" idempotency check was removed because the brief now forbids
  // that exact phrase in user-facing prose. Re-prefixing with the new
  // STALENESS_PREFIX in front of legacy text leaves a forbidden phrase
  // downstream, which the finaliser-level egress guard then rewrites.
  // The prefix-helper itself no longer needs to recognise the legacy
  // opener as "already-prefixed".

  it('NOT idempotent on lenient "may not reflect…" prose (avoids false-positive suppression)', () => {
    // Tightening guard: the approved-openings list deliberately requires
    // the canonical STALENESS_PREFIX opener — a bare "These results may
    // not reflect <something else>" must still trigger prepending so a
    // non-staleness disclaimer cannot suppress the canonical caveat.
    const lenient =
      'These results may not reflect every nuance of the decision. ' + SAMPLE_TEXT;
    const out = applyStalenessPrefix(lenient, 'stale');
    expect(out.text.startsWith(STALENESS_PREFIX)).toBe(true);
    expect(out.prefixed).toBe(true);
  });

  it('NOT idempotent when a number appears BEFORE the caveat (Sonnet figures-first)', () => {
    // The text does NOT open with a caveat — it opens with a figure,
    // followed later by a caveat. The trust contract requires the user
    // reads the caveat first; we always prepend in this case.
    const figuresFirst =
      'Hire Senior Engineer leads at 0.62 probability. From a prior run, with unknown freshness.';
    const out = applyStalenessPrefix(figuresFirst, 'stale');
    expect(out.text.startsWith(STALENESS_PREFIX)).toBe(true);
    expect(out.text).toContain(figuresFirst);
    expect(out.prefixed).toBe(true);
  });

  it('NOT idempotent for currency-formatted figures (£300k) before any caveat', () => {
    // Pinning the brittle-numeric-pattern concern: any figure format —
    // currency, comma-separated integers, bare integers — that opens the
    // prose triggers prepending. The check is "starts with caveat", not
    // "no figure before caveat", which makes the helper robust to
    // arbitrary number formats.
    const currencyFirst =
      'Increasing the budget to £300k would shift the leading option, especially as this analysis is from a prior run.';
    const out = applyStalenessPrefix(currencyFirst, 'stale');
    expect(out.text.startsWith(STALENESS_PREFIX)).toBe(true);
    expect(out.prefixed).toBe(true);
  });

  it('NOT idempotent for caveat buried in middle paragraph regardless of numeric format', () => {
    // Even with no obvious numeric pattern, an opening that does not
    // match the approved-openings list triggers prepending. The buried
    // caveat is not enough to satisfy the trust contract.
    const buried =
      'Looking at the structure, three pathways shape the goal. The strongest pathway has notable influence. As a final note, this analysis is from a prior run with unknown freshness.';
    const out = applyStalenessPrefix(buried, 'stale');
    expect(out.text.startsWith(STALENESS_PREFIX)).toBe(true);
    expect(out.prefixed).toBe(true);
  });

  it('STALENESS_PREFIX is a single sentence, not empty, and ends with a full stop', () => {
    expect(STALENESS_PREFIX.length).toBeGreaterThan(40);
    expect(STALENESS_PREFIX.endsWith('.')).toBe(true);
  });

  it('STALENESS_PREFIX matches the V5 stale-aware explain recovery brief wording verbatim', () => {
    // The brief mandates the exact opening sentence on stale-explain
    // turns. Pinning the wording here so future copy-polish cannot
    // drift the runtime out of brief compliance without flipping this
    // test. Drift here MUST be coordinated with the replay harness's
    // assertion for the same phrase.
    expect(STALENESS_PREFIX).toBe(
      'These results may be out of date because the model has changed since the last analysis.',
    );
  });
});

/**
 * S8 — RE-CONNECT THE CAVEAT CHANNEL'S INPUT (approved half (b)).
 *
 * ⚠⚠ RUNG: CODE EXISTS. NOT "REVIVED" — TYPE-CONNECTED, NOT WIRED. This block
 * was headed "REVIVE THE CAVEAT CHANNEL", which generalises a true statement
 * about the VERDICT into a false one about the PATH. Re-derived at `d7499dc9`
 * over non-comment `src/` excluding tests: `applyStalenessPrefix` STILL HAS ZERO
 * CALLERS, and so does `caveatForPreconditionVerdict`. The only importers of
 * `staleness-prefix.ts` are this test, the contract test, and `no-op-helpers.ts`
 * — which imports the two CONSTANTS and the type, not the function. Nothing yet
 * carries a caveat onto an executed answer; a follow-up does the wiring.
 *
 * Two defects are closed here, both derived at `5f2e3fd0`:
 *
 *  1. `applyStalenessPrefix` took `stalenessReason`, a field REMOVED from the
 *     projection ("the only consumer was applyStalenessPrefix" —
 *     `context/projection-summaries.ts:62`). It therefore had ZERO live callers
 *     in `src/`, so the estate had no working mechanism to caveat an executed
 *     explanation. Its parameter now names the LIVE precondition verdict — the
 *     INPUT is real; the CALL is still absent.
 *
 *  2. `STALENESS_PREFIX`'s own docstring claims it is the "Single source of
 *     truth ... Used by: buildAnalysisStaleTemplate" — but `no-op-helpers.ts`
 *     RE-TYPED the sentence rather than importing it. One user-facing sentence,
 *     two hand-maintained copies, and a docstring asserting otherwise
 *     (CLAUDE.md trap 12 + trap 14). The templates now compose from the
 *     constants, and SINGLE_COPY at the foot of this file REDs if a copy
 *     reappears — DRIFTED OR CHARACTER-IDENTICAL.
 *
 *     ⚠ That last clause is load-bearing and was wrong here before: this said
 *     "the guards below fail loud if a copy reappears" while the only guard was
 *     a RUNTIME value comparison, which a character-identical re-type passes.
 *     Replacing a false "single source of truth" label with a false "REDs if a
 *     copy reappears" label — in the file fixing the first — is trap 14
 *     reproduced inside the fix for trap 14.
 *
 * ⚠ THIS CHANGE MUST NOT MOVE A SINGLE USER-VISIBLE BYTE. It is an authority
 * refactor, not a copy change: the byte-preservation test below is the one that
 * matters most, and `compose/__tests__/forbidden-user-facing-phrases.test.ts`
 * pins the same two strings independently.
 *
 * ⚠⚠ AND THE SAFETY ARGUMENT HAS AN EXPIRY DATE. "No user-visible bytes move"
 * is currently underwritten by the fact that the changed function is
 * UNREACHABLE. Correct today; it STOPS BEING A SAFETY ARGUMENT the moment the
 * follow-up wires it, at which point the KNOWN GAP pinned below (a
 * model-authored caveat is not recognised, so the prefix doubles) becomes
 * user-visible and must be re-priced rather than inherited.
 */
describe('S8 — the caveat channel is driven by a LIVE verdict, with ONE authority for the wording', () => {
  it('UNCONFIRMED_PREFIX is the non-asserting lead clause and is distinct from STALENESS_PREFIX', () => {
    expect(UNCONFIRMED_PREFIX).toBe(
      "The last analysis may be out of date because I can't confirm it still matches the current model.",
    );
    expect(UNCONFIRMED_PREFIX).not.toBe(STALENESS_PREFIX);
  });

  it('UNCONFIRMED_PREFIX does NOT assert the model changed, while STALENESS_PREFIX does (authority parity)', () => {
    // The whole reason these are two constants: `unknown` freshness may not
    // claim which state is current (t4-spine-policy §1). The second assertion
    // is the CONTRAST CONTROL — without it, a probe that simply never matches
    // would pass this test while proving nothing.
    expect(/\bhas changed\b/i.test(UNCONFIRMED_PREFIX)).toBe(false);
    expect(/\bhas changed\b/i.test(STALENESS_PREFIX)).toBe(true);
  });

  it("applyStalenessPrefix('unconfirmed') prepends UNCONFIRMED_PREFIX, NOT the stale sentence", () => {
    // RED at pristine: the old signature took an opaque reason string, so any
    // truthy value prepended STALENESS_PREFIX. This is the discriminating case.
    const out = applyStalenessPrefix(SAMPLE_TEXT, 'unconfirmed');
    expect(out.text.startsWith(UNCONFIRMED_PREFIX)).toBe(true);
    expect(out.text.startsWith(STALENESS_PREFIX)).toBe(false);
    expect(out.text.endsWith(SAMPLE_TEXT)).toBe(true);
    expect(out.prefixed).toBe(true);
  });

  it('idempotent per caveat: text already opening with UNCONFIRMED_PREFIX is not re-prepended', () => {
    const already = `${UNCONFIRMED_PREFIX} ${SAMPLE_TEXT}`;
    const out = applyStalenessPrefix(already, 'unconfirmed');
    expect(out.text).toBe(already);
    expect(out.prefixed).toBe(false);
  });

  it('a STALE caveat is still prepended to text opening with the weaker UNCONFIRMED opener', () => {
    // The two openers are different CLAIMS, not two spellings of one. "I can't
    // confirm" must never suppress the stronger, evidenced "the model has
    // changed" — suppressing it would trade a redundant sentence for a false
    // one, which is the wrong direction for a trust caveat.
    const weakerFirst = `${UNCONFIRMED_PREFIX} ${SAMPLE_TEXT}`;
    const out = applyStalenessPrefix(weakerFirst, 'stale');
    expect(out.text.startsWith(STALENESS_PREFIX)).toBe(true);
    expect(out.prefixed).toBe(true);
  });

  it('no caveat verdict ⇒ text untouched (the channel never invents a freshness claim)', () => {
    for (const noCaveat of [null, undefined] as const) {
      const out = applyStalenessPrefix(SAMPLE_TEXT, noCaveat);
      expect(out.text).toBe(SAMPLE_TEXT);
      expect(out.prefixed).toBe(false);
    }
  });

  it('caveatForPreconditionVerdict maps ONLY the two currency verdicts', () => {
    expect(caveatForPreconditionVerdict('stale')).toBe('stale');
    expect(caveatForPreconditionVerdict('unconfirmed')).toBe('unconfirmed');
    // CONTRAST CONTROLS — verdicts that make no currency claim must yield no
    // caveat. `missing`/`degraded` mean there is nothing to caveat; `execute`
    // means the analysis is current.
    expect(caveatForPreconditionVerdict('execute')).toBeNull();
    expect(caveatForPreconditionVerdict('missing')).toBeNull();
    expect(caveatForPreconditionVerdict('degraded')).toBeNull();
  });

  it('BYTES: both templates OPEN with the canonical constants', () => {
    // ⚠ WHAT THIS DOES AND DOES NOT PROVE. It is a RUNTIME string comparison,
    // so it pins the assembled bytes: a template that stops opening with the
    // canonical sentence REDs here, whether it was recomposed, reworded or
    // re-inlined WITH A DRIFT.
    //
    // It CANNOT prove "composed, not re-typed". That is a SYNTACTIC property of
    // the source, and no comparison of runtime VALUES can distinguish a
    // composed template from a character-identical re-typed one — both produce
    // the same string. This test named itself DERIVED and claimed exactly that;
    // measured with a discriminating pair, a re-inline with a one-character
    // drift RED-ed it while a CHARACTER-IDENTICAL re-inline passed the whole
    // suite (CLAUDE.md trap 14 — a false label about a guard is what teaches
    // the next lane to stop looking).
    //
    // The syntactic claim is enforced instead by SINGLE_COPY below, which
    // counts occurrences in the SOURCE.
    expect(buildAnalysisStaleTemplate().startsWith(STALENESS_PREFIX)).toBe(true);
    expect(buildAnalysisUnconfirmedTemplate().startsWith(UNCONFIRMED_PREFIX)).toBe(true);
  });

  /**
   * ⚠⚠ KNOWN GAP, PINNED RATHER THAN PAPERED OVER (CLAUDE.md trap 22f).
   *
   * The idempotence guard recognises CANONICAL openers only. It does NOT
   * recognise a caveat the MODEL wrote in its own words — so prefixing such a
   * reply yields the caveat TWICE.
   *
   * ⭐ THE CORPUS IS FROM OUTSIDE THIS LANE'S HEAD. Both strings below are
   * VERBATIM model output captured on the deployed quartet (UI `cf61337c` ·
   * CEE `5f2e3fd` · PLoT `3a3bee5` · ISL `28fe0c9`) on a
   * `complete_stale / graph_changed` state, read from disk by the drive lane.
   * They are EVIDENCE, not fixtures: append to this list, never edit it
   * (trap 14b).
   *
   * ⭐⭐ AND THE FIX IS NOT A WIDER REGEX. "Did this arbitrary prose already
   * caveat?" is an unbounded natural-language predicate, and this estate has
   * already burned four consecutive rounds on one of those — each round fixing
   * one direction and opening the inverse under a fully green suite. A pattern
   * broad enough to catch these two would start suppressing the caveat on prose
   * that merely mentions the model, which is the failure this module exists to
   * prevent (a MISSING caveat is a trust defect; a DOUBLED one is only clumsy).
   * The exit is structural — attach the caveat as a block/marker rather than as
   * prose, so it cannot collide with the model's wording at all. That is a
   * design input for the accompany-don't-replace change, NOT a licence to widen
   * `APPROVED_OPENINGS`.
   *
   * This test pins the CURRENT behaviour exactly, so it REDs if the set grows
   * OR shrinks — i.e. if anyone widens the patterns without deciding to.
   */
  const MODEL_AUTHORED_CAVEATS_NOT_RECOGNISED: readonly string[] = [
    'That 89% result predates recent changes to your model, so treat it as a starting point rather than a current answer.',
    'That 89% result is from before your recent changes to cash runway, so re-run the analysis first to see if it still holds.',
  ];

  it('KNOWN GAP: a model-authored caveat is NOT recognised, so the prefix doubles', () => {
    expect(MODEL_AUTHORED_CAVEATS_NOT_RECOGNISED.length).toBeGreaterThan(0);
    for (const modelCaveat of MODEL_AUTHORED_CAVEATS_NOT_RECOGNISED) {
      const out = applyStalenessPrefix(`${modelCaveat} ${SAMPLE_TEXT}`, 'stale');
      // The gap, stated as an assertion rather than as a comment.
      expect(out.prefixed).toBe(true);
      expect(out.text.startsWith(STALENESS_PREFIX)).toBe(true);
      expect(out.text).toContain(modelCaveat);
    }
  });

  it('CONTRAST CONTROL: the canonical opener IS recognised, so the gap is about wording, not a dead guard', () => {
    // Without this, the test above would pass identically if idempotence were
    // broken outright — an instrument that cannot discriminate is not evidence.
    const out = applyStalenessPrefix(`${STALENESS_PREFIX} ${SAMPLE_TEXT}`, 'stale');
    expect(out.prefixed).toBe(false);
  });

  it('BYTE-PRESERVATION: the shipped user-facing templates are unchanged by this refactor', () => {
    expect(buildAnalysisStaleTemplate()).toBe(
      'These results may be out of date because the model has changed since the last analysis. ' +
        'Would you like to re-run analysis to see how your changes affect the results?',
    );
    expect(buildAnalysisUnconfirmedTemplate()).toBe(
      "The last analysis may be out of date because I can't confirm it still matches the current model. " +
        'Re-run analysis to see the current result.',
    );
  });
});

/* ===========================================================================
 * SINGLE_COPY — THE GENUINELY DERIVED GUARD.
 *
 * WHY IT EXISTS. The sibling `BYTES` test above once called itself DERIVED and
 * claimed it "fails loud if a copy reappears". That was FALSE AS STATED, and it
 * was false structurally rather than by a slip: its assertion is
 * `buildAnalysisStaleTemplate().startsWith(STALENESS_PREFIX)` — a comparison of
 * RUNTIME VALUES — while "composed vs re-typed" is a property of the SOURCE
 * TEXT. A character-identical re-typed copy produces a byte-identical string,
 * so no runtime value check can ever tell the two apart. Measured with a
 * discriminating pair: a re-inline carrying a one-character drift RED-ed both
 * that test and BYTE-PRESERVATION, while a re-inline typed CHARACTER FOR
 * CHARACTER — precisely the state this file's own history records the codebase
 * being in — passed the entire suite green.
 *
 * The estate had therefore replaced a false "single source of truth" label with
 * a false "REDs if a copy reappears" label, in the same file (CLAUDE.md trap 14
 * reproduced inside the fix for trap 14). This guard makes the claim TRUE
 * instead of softening it: it counts occurrences of the sentence in the SOURCE
 * BYTES of `src/`, excluding tests, and REDs on a second one — drifted or
 * identical.
 *
 * DERIVED, NOT MIRRORED (trap 12): the needle is the exported constant itself,
 * not a re-typed literal, so rewording the constant moves the guard with it.
 *
 * ANTI-VACUITY (trap 13 / trap 20): a scan that silently stopped would report
 * ZERO occurrences and RED, so blindness cannot masquerade as "no copies" in
 * the failing direction. The dangerous direction is a scan scoped so narrowly
 * that it still sees the definition and nothing else — it would read exactly 1
 * and pass while blind to a copy elsewhere. PART A closes that: it proves the
 * walk spans the codebase and that the counter can COUNT ABOVE ONE, with a
 * CONTRAST CONTROL, before PART B trusts a single number.
 * ======================================================================== */

const SRC_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * Budget for the disk scan, sized off the sibling derivation guard
 * (`config/__tests__/store-model-config-call-sites.test.ts`), which RED-ed at
 * random under vitest's 5,000 ms default when parallel workers saturated the
 * box. A guard that fails at random is trap 7's broken alarm.
 */
const SCAN_TIMEOUT_MS = 60_000;

/**
 * A symbol known to appear in SEVERAL non-test files across MORE THAN ONE
 * directory. It is the contrast control: absence proves the instrument, not
 * the codebase (trap 13e — a target reading zero is only evidence when a
 * contrast reads non-zero IN THE SAME RUN).
 */
const CONTRAST_NEEDLE = 'buildAnalysisStaleTemplate';

interface SourceScan {
  /** Every non-test .ts file under src/, repo-relative, posix separators. */
  readonly files: readonly string[];
  /** Files actually read (must equal `files` — a silent skip shrinks the search). */
  readonly read: readonly string[];
  /** Total occurrences of each needle, and the files carrying them. */
  count(needle: string): number;
  filesContaining(needle: string): readonly string[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === '__tests__' ||
        entry.name === 'node_modules' ||
        entry.name === 'generated'
      ) {
        continue;
      }
      walk(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

let scanCache: SourceScan | null = null;

function scanSrc(): SourceScan {
  if (scanCache !== null) return scanCache;

  const absolute = walk(SRC_ROOT);
  const files: string[] = [];
  const read: string[] = [];
  const texts: string[] = [];

  for (const file of absolute) {
    files.push(`src/${relative(SRC_ROOT, file).split(sep).join('/')}`);
    // NOTE: `readFileSync`, deliberately NOT `grep`. CLAUDE.md trap 17: plain
    // grep is silently blind to NUL-bearing source files and this repo carries
    // them (`edit-graph-referee-gate.ts` holds a deliberate '\0' sentinel), so
    // a grep-based derivation would report a clean sweep it never performed.
    texts.push(readFileSync(file, 'utf8'));
    read.push(`src/${relative(SRC_ROOT, file).split(sep).join('/')}`);
  }

  scanCache = {
    files,
    read,
    count: (needle) =>
      texts.reduce((total, text) => total + (text.split(needle).length - 1), 0),
    filesContaining: (needle) =>
      files.filter((_, index) => texts[index]!.includes(needle)).sort(),
  };
  return scanCache;
}

describe('SINGLE_COPY — the canonical sentences occur exactly once in src/', () => {
  /* ---------------- PART A — the instrument is not blind ---------------- */

  it(
    'DERIVATION_WALKED_SRC — the walk found a plausible number of TypeScript files',
    () => {
      const { files } = scanSrc();
      expect(
        files.length,
        `The src/ walk found ${files.length} .ts files. That is not a codebase — SRC_ROOT ` +
          `(${SRC_ROOT}) is almost certainly wrong, and every count below is therefore ` +
          `taken over a near-empty scan that would read "exactly one" for the wrong reason.`,
      ).toBeGreaterThan(200);
    },
    SCAN_TIMEOUT_MS,
  );

  it(
    'DERIVATION_READ_EVERY_FILE_IT_LISTED — no file was silently skipped',
    () => {
      const { files, read } = scanSrc();
      expect(
        read.length,
        `The walk listed ${files.length} files but read ${read.length}. A silent skip shrinks ` +
          `the search space without shrinking the apparent result.`,
      ).toBe(files.length);
    },
    SCAN_TIMEOUT_MS,
  );

  it(
    'CONTRAST_CONTROL — the counter can count ABOVE ONE, across several directories',
    () => {
      const scan = scanSrc();
      const occurrences = scan.count(CONTRAST_NEEDLE);
      const carriers = scan.filesContaining(CONTRAST_NEEDLE);

      // This is the assertion that makes "exactly 1" mean something. A scan
      // scoped to one file, or a counter that saturates at 1, would still
      // report 1 for the target and pass Part B while blind to a copy
      // elsewhere. Requiring a KNOWN-MULTIPLE needle to read multiple, in more
      // than one directory, is a discrimination a blind instrument cannot fake.
      expect(
        occurrences,
        `The contrast needle '${CONTRAST_NEEDLE}' was found ${occurrences} time(s). It is ` +
          `referenced many times in src/; a low count means the scan or the counter is ` +
          `broken, so the target's count proves nothing.`,
      ).toBeGreaterThan(3);

      const directories = new Set(
        carriers.map((path) => path.split('/').slice(0, -1).join('/')),
      );
      expect(
        directories.size,
        `The contrast needle was found in ${directories.size} directory/ies ` +
          `(${[...directories].join(', ')}). The scan must span more than one directory or ` +
          `it cannot see a copy re-inlined outside this folder.`,
      ).toBeGreaterThan(1);
    },
    SCAN_TIMEOUT_MS,
  );

  /* ---------------- PART B — the claim itself ---------------- */

  it(
    'the STALENESS_PREFIX sentence occurs EXACTLY ONCE in src/ (non-test)',
    () => {
      const scan = scanSrc();
      const carriers = scan.filesContaining(STALENESS_PREFIX);
      expect(
        scan.count(STALENESS_PREFIX),
        `Expected exactly one occurrence (the definition in staleness-prefix.ts). Found ` +
          `${scan.count(STALENESS_PREFIX)}, in: ${carriers.join(', ') || '(nowhere)'}. ` +
          `A second occurrence means the sentence has been RE-INLINED — compose it from ` +
          `STALENESS_PREFIX instead. This REDs on a character-identical copy, which is the ` +
          `case the runtime BYTES test structurally cannot see.`,
      ).toBe(1);
      expect(carriers).toEqual(['src/orchestrator-v5/tools/handlers/staleness-prefix.ts']);
    },
    SCAN_TIMEOUT_MS,
  );

  it(
    'the UNCONFIRMED_PREFIX sentence occurs EXACTLY ONCE in src/ (non-test)',
    () => {
      const scan = scanSrc();
      const carriers = scan.filesContaining(UNCONFIRMED_PREFIX);
      expect(
        scan.count(UNCONFIRMED_PREFIX),
        `Expected exactly one occurrence (the definition in staleness-prefix.ts). Found ` +
          `${scan.count(UNCONFIRMED_PREFIX)}, in: ${carriers.join(', ') || '(nowhere)'}.`,
      ).toBe(1);
      expect(carriers).toEqual(['src/orchestrator-v5/tools/handlers/staleness-prefix.ts']);
    },
    SCAN_TIMEOUT_MS,
  );
});
