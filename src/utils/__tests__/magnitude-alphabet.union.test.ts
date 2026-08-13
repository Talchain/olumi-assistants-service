/**
 * ROADMAP 2.330 — THE UNION ASSERTION: the canonical alphabet must be a
 * SUPERSET of every sibling magnitude vocabulary in `src/`.
 *
 * WHAT THIS FILE IS FOR, and why the existing drift guard could not do its job.
 *
 * `magnitude-alphabet.test.ts` proves that every folded CONSUMER indexes the
 * canonical map — derived per key, so a frozen copy REDs the moment the map
 * grows. That guard answers "are these copies consistent?" It cannot answer
 * "is this list RIGHT?", and CLAUDE.md trap 12d states why: a guard derived
 * from a list is structurally blind to a key the list never had. Measured at
 * `9a0541b4`, deleting a key from `MAGNITUDE_MULTIPLIERS` leaves the per-key
 * drift guard GREEN.
 *
 * That blindness cost a live 1,000× under-read TWICE in a fortnight:
 *
 *   - `thousand` was missing, so `"$5 thousand"` extracted as 5 (ROADMAP 2.322);
 *   - `grand` was missing, so `"Budget of £250 grand for the rebuild."`
 *     extracted as **250 at confidence 0.90** on the goal-card path, while
 *     `orchestrator-v5/context/cqe/rules.ts` read the same two words as 250,000
 *     and `cqe/word-numbers.ts` listed `grand` among its magnitude words.
 *     Two modules in this repo already knew. The canonical list did not.
 *
 * THE FIX FOR THE CLASS, not the key: `grand` was not missing because someone
 * forgot it — it was missing because nothing in the estate compared the
 * canonical list against the lists its own siblings carry. This file is that
 * comparison, and it is the derivable half of trap 12d's pair. The other half —
 * a hand-written corpus, which is the ONLY thing that can notice a key NO
 * sibling spells either — is `magnitude-alphabet.corpus.test.ts`. Neither
 * supersedes the other; ship both.
 *
 * ⚠ THE SIBLING LIST BELOW IS ITSELF A HAND-MAINTAINED MIRROR — so it does not
 * get to be trusted. `PART D` scans `src/` from disk and REDs when any file
 * outside the reviewed manifest declares a magnitude word, which is what makes
 * a NEW sibling arriving loud instead of silent.
 *
 * ⚠⚠ AND PART D'S MANIFEST HAS ALREADY BEEN WRONG — TWICE, IN THE FIRST CUT OF
 * THIS FILE, CAUGHT BY ADVERSARIAL REVIEW RATHER THAN BY ANYTHING HERE.
 * `compromise-backstop.ts` was recorded as treating `grand` as "a UNIT token
 * for span extension, not a multiplier" while its code does
 * `value = value * 1000`; `value-unit-resolution.ts` was recorded as carrying
 * "no multiplier" on the strength of its `['grand','currency']` unit-KIND row,
 * three lines from a seven-key `SUFFIX_FACTOR` map that multiplies. Both were
 * therefore EXCUSED from the comparison by a sentence about them.
 *
 * That is CLAUDE.md trap 7b — a false one-line label on a known site, which
 * teaches every later reader to stop looking — occurring INSIDE the trap-12d
 * guard written to abolish exactly this. The escape hatch is the hazard: a
 * manifest that can say "not a magnitude list" is a manifest that can be wrong
 * about it, and being wrong there is silent by construction.
 *
 * THE RULE THAT FOLLOWS, and the reason both are now in SIBLING_VALUE_LOOKUPS
 * rather than merely re-described: prefer COMPARING a site to CLASSIFYING it.
 * A comparison that runs is worth more than a sentence that is true today —
 * and if a site is genuinely not comparable, the manifest entry must quote the
 * code, not summarise it.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAGNITUDE_MULTIPLIERS,
  isKnownMagnitude,
  resolveMagnitude,
} from "../magnitude-alphabet.js";
import { MULTIPLIERS as NUMERIC_PARSER_MULTIPLIERS } from "../../cee/extraction/numeric-parser.js";
import { MULTIPLIER_MAP as SHAPE_CHECK_MULTIPLIERS } from "../../cee/decision-review/shape-check.js";
import {
  COLLOQUIAL_MAGNITUDE_MULTIPLIERS,
  CURRENCY_COLLOQUIAL_SOURCE,
  NUMERIC_SUFFIX_SOURCE,
} from "../../orchestrator-v5/context/cqe/rules.js";
import { MAGNITUDE_ALT as WORD_NUMBER_MAGNITUDE_ALT } from "../../orchestrator-v5/context/cqe/word-numbers.js";
import { ANCHORING_MAGNITUDE_ALT } from "../../cee/validation/pre-decision-checks.js";
import { BACKSTOP_MAGNITUDE_MULTIPLIERS } from "../../orchestrator-v5/context/cqe/compromise-backstop.js";
import { SUFFIX_FACTOR as VALUE_UNIT_SUFFIX_FACTOR } from "../../orchestrator-v5/routing/value-unit-resolution.js";

const SRC_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Budget for Part D's disk scan of `src/`.
 *
 * ~2 s idle for ~1,400 files, but the parallel workers routinely saturate the
 * box and it has been measured past vitest's 5,000 ms default. This is sized
 * to be unreachable by load and still catch a genuine hang.
 */
const SCAN_TIMEOUT_MS = 60_000;

/* ===========================================================================
 * THE SIBLINGS, and what kind of statement each one makes.
 *
 * A VALUE LOOKUP answers "how many thousands is this?" and therefore pins both
 * the KEY and the MULTIPLIER. A VOCABULARY answers only "is this token a
 * magnitude word?" — `word-numbers` uses one for compound detection and never
 * multiplies by it — so it pins the KEY alone. Both kinds are compared; only
 * the first kind can disagree about a value.
 * ======================================================================== */

interface SiblingValueLookup {
  readonly module: string;
  readonly symbol: string;
  /** `[key, multiplier]` pairs — plain objects and Maps normalise to the same shape. */
  readonly entries: ReadonlyArray<readonly [string, number]>;
}

const SIBLING_VALUE_LOOKUPS: readonly SiblingValueLookup[] = [
  {
    module: "src/cee/extraction/numeric-parser.ts",
    symbol: "MULTIPLIERS",
    entries: Object.entries(NUMERIC_PARSER_MULTIPLIERS),
  },
  {
    module: "src/cee/decision-review/shape-check.ts",
    symbol: "MULTIPLIER_MAP",
    entries: Object.entries(SHAPE_CHECK_MULTIPLIERS),
  },
  {
    module: "src/orchestrator-v5/context/cqe/rules.ts",
    symbol: "COLLOQUIAL_MAGNITUDE_MULTIPLIERS",
    entries: Object.entries(COLLOQUIAL_MAGNITUDE_MULTIPLIERS),
  },
  // ⚠ THE TWO BELOW WERE ADDED IN REVIEW, and both were sitting in the
  // REVIEWED manifest under a FALSE description that told this guard they
  // carried no multiplier. Both do. See the amendment note in Part D.
  {
    module: "src/orchestrator-v5/context/cqe/compromise-backstop.ts",
    symbol: "BACKSTOP_MAGNITUDE_MULTIPLIERS",
    entries: Object.entries(BACKSTOP_MAGNITUDE_MULTIPLIERS),
  },
  {
    module: "src/orchestrator-v5/routing/value-unit-resolution.ts",
    symbol: "SUFFIX_FACTOR",
    entries: [...VALUE_UNIT_SUFFIX_FACTOR],
  },
];

interface SiblingVocabulary {
  readonly module: string;
  readonly symbol: string;
  readonly source: string;
}

const SIBLING_VOCABULARIES: readonly SiblingVocabulary[] = [
  {
    module: "src/orchestrator-v5/context/cqe/rules.ts",
    symbol: "NUMERIC_SUFFIX_SOURCE",
    source: NUMERIC_SUFFIX_SOURCE,
  },
  {
    module: "src/orchestrator-v5/context/cqe/word-numbers.ts",
    symbol: "MAGNITUDE_ALT",
    source: WORD_NUMBER_MAGNITUDE_ALT,
  },
  {
    module: "src/cee/validation/pre-decision-checks.ts",
    symbol: "ANCHORING_MAGNITUDE_ALT",
    source: ANCHORING_MAGNITUDE_ALT,
  },
];

/**
 * Keys a sibling spells that the canonical alphabet DELIBERATELY does not carry.
 *
 * ⚠ AN EXCLUSION IS A CLAIM, AND IT IS TESTED IN BOTH DIRECTIONS (Part C): a
 * key listed here must be genuinely ABSENT from the canonical map (so the entry
 * cannot rot into a lie once the key is added) and genuinely PRESENT in some
 * sibling (so an entry for a key nobody spells any more cannot linger). An
 * exclusion nobody can no-op is the only kind worth having.
 */
const DELIBERATE_EXCLUSIONS: Readonly<Record<string, string>> = {
  hundred:
    "`word-numbers` lists `hundred` as a compound-detection WORD, never as a " +
    "multiplier — it exists there so 'one hundred and forty' is left intact for " +
    "the backstop rather than folded to a lead digit. Admitting it to the " +
    "canonical alphabet would not fix a reading, it would BREAK one: measured " +
    "at 9a0541b4, 'Our target is £5 hundred thousand.' extracts 5 today, and " +
    "with `hundred: 1e2` in the alphabet the longest-first alternation matches " +
    "`hundred` and commits 500 — still 1,000x short of 500,000, but now at " +
    "explicit confidence and no longer obviously incomplete. Multi-word " +
    "magnitude compounds ('hundred thousand', 'hundred million') need a parser, " +
    "not an alphabet entry; ROADMAP 2.330 scopes the alphabet only.",
};

/**
 * Pull the literal tokens out of a regex-source alternation.
 *
 * ⚠ IT REFUSES A SOURCE IT NO LONGER UNDERSTANDS rather than returning what it
 * managed to parse. A parser that silently yields a SHORTER token list than the
 * code it is reading would make this whole file assert less every time a
 * sibling's grammar grew a construct — the same assume-good shrink that trap 12
 * is about, relocated into the guard.
 */
function alternationTokens(source: string, label: string): string[] {
  const body = source
    .replace(/\(\?![^)]*\)/g, "") // negative lookaheads carry no tokens
    .replace(/\(\?:/g, "")
    .replace(/[()]/g, "")
    .trim();
  const tokens = body
    .split("|")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  expect(tokens.length, `${label}: parsed ZERO tokens from ${JSON.stringify(source)}`).toBeGreaterThan(0);
  for (const token of tokens) {
    expect(
      token,
      `${label}: token ${JSON.stringify(token)} is not a plain word. The parser in ` +
        `this guard no longer understands ${JSON.stringify(source)}, so it is reading a ` +
        `SHORTER vocabulary than the code does. Fix the parser — do not weaken this assertion.`,
    ).toMatch(/^[a-z]+$/);
  }
  return tokens;
}

/* ===========================================================================
 * PART A — THE UNION ASSERTION (the RED-first signature for `grand`).
 * ======================================================================== */

describe("ROADMAP 2.330 — the canonical alphabet is a SUPERSET of every sibling", () => {
  for (const sibling of SIBLING_VALUE_LOOKUPS) {
    it(`${sibling.module} :: ${sibling.symbol} — every key is canonical`, () => {
      for (const [key] of sibling.entries) {
        if (key.toLowerCase() in DELIBERATE_EXCLUSIONS) continue;
        expect(
          isKnownMagnitude(key),
          `${sibling.module} resolves ${JSON.stringify(key)} as a magnitude, but the canonical ` +
            `alphabet in src/utils/magnitude-alphabet.ts does not carry it. Every consumer of ` +
            `the canonical alphabet therefore reads ${JSON.stringify(key)} as x1. Add it to ` +
            `MAGNITUDE_MULTIPLIERS, or add it to DELIBERATE_EXCLUSIONS with a measured reason.`,
        ).toBe(true);
      }
    });

    it(`${sibling.module} :: ${sibling.symbol} — every multiplier AGREES`, () => {
      for (const [key, multiplier] of sibling.entries) {
        if (key.toLowerCase() in DELIBERATE_EXCLUSIONS) continue;
        if (!isKnownMagnitude(key)) continue; // key presence is Part A's first `it`
        expect(
          resolveMagnitude(key),
          `${sibling.module} multiplies ${JSON.stringify(key)} by ${multiplier}, the canonical ` +
            `alphabet by ${resolveMagnitude(key)}. Two modules reading the same word to ` +
            `different numbers is the defect this alphabet exists to abolish.`,
        ).toBe(multiplier);
      }
    });
  }

  for (const sibling of SIBLING_VOCABULARIES) {
    it(`${sibling.module} :: ${sibling.symbol} — every token is canonical`, () => {
      for (const token of alternationTokens(sibling.source, `${sibling.module}::${sibling.symbol}`)) {
        if (token in DELIBERATE_EXCLUSIONS) continue;
        expect(
          isKnownMagnitude(token),
          `${sibling.module} treats ${JSON.stringify(token)} as a magnitude word, but the ` +
            `canonical alphabet does not carry it — so every consumer of the canonical ` +
            `alphabet reads ${JSON.stringify(token)} as x1. Add it to MAGNITUDE_MULTIPLIERS, ` +
            `or add it to DELIBERATE_EXCLUSIONS with a measured reason.`,
        ).toBe(true);
      }
    });
  }
});

/* ===========================================================================
 * PART B — THE COLLOQUIAL ALTERNATION IS FULLY RULED ON.
 *
 * `CURRENCY_COLLOQUIAL` admits `grand|quid`; only `grand` carries a magnitude.
 * That asymmetry is data now, not an inline ternary — and a THIRD colloquial
 * token arriving without a ruling would otherwise multiply by 1 in silence.
 * ======================================================================== */

describe("ROADMAP 2.330 — every colloquial currency token has a magnitude ruling", () => {
  /** Colloquial tokens that carry NO magnitude — "five quid" is 5, not 5,000. */
  const COLLOQUIAL_WITHOUT_MAGNITUDE: readonly string[] = ["quid"];

  it("COLLOQUIAL_MAGNITUDE_TOKENS_ARE_KNOWN — no token is silently x1", () => {
    const tokens = alternationTokens(
      CURRENCY_COLLOQUIAL_SOURCE,
      "src/orchestrator-v5/context/cqe/rules.ts::CURRENCY_COLLOQUIAL",
    );
    for (const token of tokens) {
      const ruled =
        token in COLLOQUIAL_MAGNITUDE_MULTIPLIERS || COLLOQUIAL_WITHOUT_MAGNITUDE.includes(token);
      expect(
        ruled,
        `CURRENCY_COLLOQUIAL admits ${JSON.stringify(token)}, but nothing states whether it ` +
          `carries a magnitude. Rule P8 multiplies an unruled token by 1 — correct for "quid", ` +
          `a 1,000x under-read for anything meaning "thousand". Add it to ` +
          `COLLOQUIAL_MAGNITUDE_MULTIPLIERS or to COLLOQUIAL_WITHOUT_MAGNITUDE.`,
      ).toBe(true);
    }
  });

  it("`grand` resolves to x1000 on BOTH paths — CQE and the canonical alphabet", () => {
    expect(COLLOQUIAL_MAGNITUDE_MULTIPLIERS.grand).toBe(1_000);
    expect(resolveMagnitude("grand")).toBe(1_000);
  });

  it("the no-magnitude list is not a dumping ground — each entry is genuinely x1", () => {
    for (const token of COLLOQUIAL_WITHOUT_MAGNITUDE) {
      expect(
        token in COLLOQUIAL_MAGNITUDE_MULTIPLIERS,
        `${JSON.stringify(token)} is listed as carrying no magnitude yet appears in ` +
          `COLLOQUIAL_MAGNITUDE_MULTIPLIERS. One of the two statements is wrong.`,
      ).toBe(false);
    }
  });
});

/* ===========================================================================
 * PART C — THE EXCLUSION LIST CANNOT ROT.
 * ======================================================================== */

describe("ROADMAP 2.330 — every deliberate exclusion is still true in both directions", () => {
  it("an excluded key is genuinely ABSENT from the canonical alphabet", () => {
    for (const [key, reason] of Object.entries(DELIBERATE_EXCLUSIONS)) {
      expect(
        isKnownMagnitude(key),
        `${JSON.stringify(key)} is listed as a DELIBERATE EXCLUSION, with the reason:\n  ${reason}\n` +
          `But the canonical alphabet now carries it. Either the exclusion is stale and must be ` +
          `deleted, or the key was added without reading the reason it was excluded.`,
      ).toBe(false);
    }
  });

  it("an excluded key is genuinely SPELLED by some sibling", () => {
    const spelledBySiblings = new Set<string>();
    for (const sibling of SIBLING_VALUE_LOOKUPS) {
      for (const [key] of sibling.entries) spelledBySiblings.add(key.toLowerCase());
    }
    for (const sibling of SIBLING_VOCABULARIES) {
      for (const token of alternationTokens(sibling.source, `${sibling.module}::${sibling.symbol}`)) {
        spelledBySiblings.add(token);
      }
    }
    for (const key of Object.keys(DELIBERATE_EXCLUSIONS)) {
      expect(
        spelledBySiblings.has(key),
        `${JSON.stringify(key)} is excluded from the canonical alphabet, but no sibling spells ` +
          `it any more — the exclusion is defending against nothing and should be deleted, so ` +
          `the list stays a record of live decisions rather than of historical ones.`,
      ).toBe(true);
    }
  });

  it("every exclusion carries a non-trivial reason", () => {
    for (const [key, reason] of Object.entries(DELIBERATE_EXCLUSIONS)) {
      expect(reason.length, `exclusion ${JSON.stringify(key)} has no real justification`).toBeGreaterThan(80);
    }
  });
});

/* ===========================================================================
 * PART D — A NEW SIBLING CANNOT ARRIVE QUIETLY.
 *
 * Parts A–C compare the canonical list against the siblings THIS FILE KNOWS
 * ABOUT, and that manifest is hand-maintained — precisely the mirror CLAUDE.md
 * trap 12 says will drift silently. So the manifest is not trusted: `src/` is
 * scanned from disk for files that spell a magnitude word in a declaration
 * position, and any file outside the reviewed manifest REDs.
 *
 * This is a REVIEW TRIPWIRE, not a correctness proof. It cannot tell a genuine
 * fourth magnitude list from a comment mentioning "million" — it only
 * guarantees that adding either one forces a human to look and classify.
 * ======================================================================== */

describe("ROADMAP 2.330 — a new magnitude list in src/ forces a review", () => {
  /**
   * Files reviewed at `9a0541b4` and classified. Each is either a sibling
   * compared above, the canonical alphabet itself, or a site that spells a
   * magnitude word for a reason that is not a magnitude lookup.
   */
  const REVIEWED: Readonly<Record<string, string>> = {
    // ROADMAP 2.1051 — INCIDENTAL. The direction gate holds no magnitude list
    // of its own: it IMPORTS `AMT` and `parseValue` from the extractor
    // precisely so it cannot drift from them. Its only magnitude words sit in
    // a comment explaining why the sentence terminator must require trailing
    // whitespace — `£1.5 million` and `1,500,000` must never be split
    // (ROADMAP 2.714).
    'cee/compound-goal/direction-gate.ts':
      'incidental — comment only; the file imports AMT/parseValue and spells no alphabet',
    // ⭐ #928 ROUND 4 — RECOGNITION-ONLY, and the honest classification is NOT
    // "incidental". The clarify-v2 rubric's `quantities` battery DOES spell a
    // magnitude vocabulary (`hundreds?|thousands?|millions?|billions?`). It is
    // admitted here on the same ground as `propose-handoff.ts` below: it is a
    // RECOGNITION lexicon — it answers "did the brief state a magnitude at
    // all?" and **never multiplies, never resolves a value**, so it cannot
    // produce a wrong number. Its gap costs one tap-able clarifying question.
    //
    // ⚠⚠ AND HOW IT ARRIVED HERE IS A FINDING ABOUT THIS GUARD, recorded
    // rather than quietly exploited. This file did NOT trip the scan before
    // round 4 — measured at pristine HEAD: `false`. The battery's words are
    // spelled PLURAL (`millions?`), and `MAGNITUDE_WORD` requires `\bmillion\b`,
    // which a trailing `s` defeats. So a real magnitude vocabulary sat
    // invisible to this guard indefinitely, and what finally exposed it was a
    // PROSE COMMENT quoting "£1.5 million" — i.e. the guard fired for a reason
    // unrelated to the lexicon it exists to find.
    //
    // That is trap 12d's second face exactly: a derived guard proves the copies
    // AGREE, and can never prove the LIST IS COMPLETE. Widening `MAGNITUDE_WORD`
    // to admit plurals is NOT done here — it would rescan the whole tree and is
    // another lane's change, not a "while we're here" edit. Rowed for that lane.
    'orchestrator-v5/clarify-v2/rubric.ts':
      'recognition-only vocabulary (plural-spelled, so historically invisible to this scan) — ' +
      'detects THAT a magnitude was stated; never multiplies and never resolves a value',
    // R1 REMEDIATION (roots 1 and 4) — BOTH INCIDENTAL, and the claim is stated
    // narrowly on purpose, because the two entries below this one were once
    // FALSE here and had to be caught in review. Verified at the bytes rather
    // than asserted: each file contains EXACTLY ONE magnitude word, in a COMMENT,
    // quoting the audit fixture "Revenue is 10 million pounds" — the fabricated
    // figure whose `from_brief` badge these fixes withdraw. Neither file holds a
    // magnitude list, and neither PARSES a magnitude: `brief-binding.ts`
    // delegates every numeric question to `isAmountStatedInBrief`
    // (`provenance/stated-amounts.ts`) precisely so it cannot become a fifth
    // hand-written alphabet, and the projector reads no magnitude words at all.
    "cee/provenance/brief-binding.ts":
      "incidental — one comment occurrence; delegates all magnitude matching to isAmountStatedInBrief and spells no alphabet",
    "cee/draft/records/projector.ts":
      "incidental — one comment occurrence quoting the audit fixture; the file spells no alphabet and parses no magnitude words",
    "utils/magnitude-alphabet.ts": "the canonical alphabet itself",
    "cee/extraction/numeric-parser.ts": "sibling value lookup — compared in Part A",
    "cee/decision-review/shape-check.ts": "sibling value lookup — compared in Part A",
    "orchestrator-v5/context/cqe/rules.ts": "sibling value lookup + vocabulary — compared in Parts A/B",
    "orchestrator-v5/context/cqe/word-numbers.ts": "sibling vocabulary — compared in Part A",
    // ⚠⚠ THESE TWO ENTRIES WERE FALSE IN THE FIRST CUT, AND WERE CAUGHT IN
    // ADVERSARIAL REVIEW, NOT BY THIS GUARD. Both files are value-bearing
    // magnitude siblings; both were described here as carrying no multiplier,
    // which is exactly the "pre-blessed false label" of CLAUDE.md trap 7b —
    // a registry entry that teaches the checker to stop looking, landing
    // inside the trap-12d guard built to stop that class. Both are now in
    // SIBLING_VALUE_LOOKUPS and compared per key and per value forever.
    "orchestrator-v5/context/cqe/compromise-backstop.ts":
      "sibling VALUE lookup (`BACKSTOP_MAGNITUDE_MULTIPLIERS`) — compared in Part A. " +
      "It DOES multiply: `if (isGrand) value = value * 1000`. The previous entry here claimed " +
      "`grand` was only a span-extension unit token; that was false at the bytes.",
    "orchestrator-v5/routing/value-unit-resolution.ts":
      "sibling VALUE lookup (`SUFFIX_FACTOR`, 7 keys: k/thousand/m/million/b/bn/billion) — " +
      "compared in Part A. The previous entry here said 'carries no multiplier', which was true " +
      "of `grand` alone and false of the file — the `['grand','currency']` unit-KIND row sits " +
      "beside a real multiplier map that this guard could not see.",
    "cee/factor-extraction/display-value.ts": "formats from MAGNITUDE_DISPLAY_LADDER; comment mentions 'thousand'",
    // ROADMAP 2.973. ⚠ CLASSIFIED (b) — INCIDENTAL MENTION ONLY, and it earned
    // that classification the hard way: the first cut of that file DID
    // hand-write a fifth multiplier map, and THIS GUARD caught it in CI. The
    // map is deleted; the file now imports `resolveMagnitude` and
    // `magnitudeSuffixPattern` from the canonical alphabet, so its money
    // extractor and its unit-scale parser both read this list and cannot drift
    // from it. What remains is prose: a comment naming `grand`, `mn` and `t` as
    // keys that "come free" from the import. Verified at the bytes — `grep -n
    // "MAGNITUDE\["` over that file returns nothing.
    "cee/context-integrity/not-modelled-manifest.ts":
      "no lookup — imports resolveMagnitude/magnitudeSuffixPattern from the canonical " +
      "alphabet; the magnitude words appear only in a comment explaining that import",
    "cee/validation/pre-decision-checks.ts": "sibling vocabulary (recognition-only) — compared in Part A",

    // --- Comment-only mentions. Each of these imports the canonical alphabet
    // --- or spells no magnitude list at all; the hits are prose describing the
    // --- historical defect, which is exactly the prose we want people writing.
    // `cee/transforms/stated-value-honour.ts` sat here until 8 Aug 2026. The
    // module (ROADMAP 2.714, INV-HONOUR) was REMOVED with its capability after
    // post-merge review measured it writing brief-derived numbers — some 10^6x
    // wrong, some the user had explicitly negated — stamped as the user's own
    // values. Worth recording where this guard is concerned: its magnitude
    // derivation was correct and its `£2 grand` refusal genuinely worked. The
    // rule still fabricated, because a decimal point truncated the binding
    // window BEFORE the magnitude guard could inspect it. A guard can be right
    // and still never see the input it was written for.
    "orchestrator/context/intake-option-reconciliation.ts":
      "comment only (ROADMAP 2.579) — the doc for `cutAtSentenceEnd` quotes trap 22's own " +
      "example, '£1.5 million', to say why a `[.!?]` split is unsafe. The module holds NO " +
      "magnitude list and does no numeric parsing at all: it lowercases text to identity " +
      "tokens and compares token sets. The only numeral it touches is the decimal-point " +
      "check that keeps '2.5 tonne' inside one candidate.",
    "cee/compound-goal/extractor.ts": "comments only; derives its patterns from the canonical alphabet",
    "cee/factor-extraction/index.ts": "comments only; derives its patterns from the canonical alphabet",
    "context/resolver.ts": "comments only; derives its patterns from the canonical alphabet",
    "utils/reduction-framing.ts": "comments only; derives its patterns from the canonical alphabet",
    "cee/unified-pipeline/stages/repair/graph-enforcement.ts":
      "comment only — 'one in a million' describing a float epsilon",
    "orchestrator-v5/context/cqe/pre-normalise.ts": "comment only — describes thousand-SEPARATOR stripping",
    "orchestrator-v5/routing/add-option-transaction.ts": "comment only — 'one hundred and forty' as a parse example",
    "orchestrator-v5/routing/deterministic-value-update.ts":
      "comment only — ROADMAP 2.389a's edge-phrasing gate documents its numeric lookahead with the " +
      "example \"to £6 million\". The file spells NO magnitude list: its currency and suffix grammars " +
      "are both imported from the canonical CQE sources (CURRENCY_SYMBOL_SOURCE / NUMERIC_SUFFIX_SOURCE " +
      "in context/cqe/rules.ts), which is precisely the derivation this guard exists to protect.",
    "utils/telemetry.ts": "comments only — LLM pricing quoted as '$N per million tokens'",

    // --- The compound-cardinal parser (L67). Its SCALE words are DERIVED from
    // --- the canonical alphabet by import (word-shaped keys, ≥1000), so they
    // --- cannot drift from it — the derivation is asserted in
    // --- cardinal-words.test.ts. Its `hundred` is the compounder the
    // --- DELIBERATE_EXCLUSIONS entry for `hundred` points at ("multi-word
    // --- magnitude compounds need a parser, not an alphabet entry"): ×100
    // --- WITHIN a spelled phrase, never a suffix multiplier on digits, so it
    // --- belongs to the parser and stays out of the alphabet. The small
    // --- cardinals (one…ninety) are a cardinal lexicon like propose-handoff's,
    // --- value-bearing only inside spelled phrases.
    "utils/cardinal-words.ts":
      "compound-cardinal parser — scale words DERIVED from MAGNITUDE_MULTIPLIERS (asserted in " +
      "its spec); `hundred` is the phrase compounder the alphabet's own exclusion note calls for, " +
      "never a digit-suffix multiplier; magnitude words appear otherwise only in prose.",

    // --- A real vocabulary, deliberately NOT folded into the union (2.331).
    "orchestrator/tools/propose-handoff.ts":
      "WORD_NUMBER_TOKEN is an English CARDINAL lexicon (eleven…ninety, hundred, thousand, million) " +
      "used to detect whether the user stated a value at all — recognition-only, it never multiplies. " +
      "Folding it into the union would demand an exclusion for every cardinal from `eleven` to " +
      "`ninety`, burying the magnitude signal this guard exists to show. Its gap (`grand`, `billion`, " +
      "`trillion` unrecognised) costs a readiness prompt, never a wrong number — rowed under 2.331.",
  };

  /** Declaration-position magnitude words: `million:`, `'grand'`, `|billion`, … */
  const MAGNITUDE_WORD = /\b(thousand|million|billion|trillion|grand|hundred)\b/;

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "generated" || entry.name === "node_modules") continue;
        walk(full, out);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        out.push(full);
      }
    }
    return out;
  }

  /**
   * The disk scan, done ONCE and shared by both tests below.
   *
   * ⚠ IT ALSO CARRIES AN EXPLICIT TIMEOUT, and that is a fix for a REAL
   * FLAKE, not defensive padding. As first written this scan ran inside each
   * test under vitest's default 5,000 ms budget; reading ~1,400 files takes
   * ~2 s idle but exceeds 5 s when the parallel workers are saturated, so the
   * guard RED-ed on 2 of 5 consecutive runs with `Test timed out in 5000ms` —
   * nothing to do with what it asserts. A guard that fails at random is worse
   * than no guard: it is CLAUDE.md trap 7's broken alarm, and the next lane to
   * meet it would rightly have disabled it. Caching the pass and stating a
   * real budget keeps the assertion identical and the alarm trustworthy.
   */
  let scanCache: { files: string[]; unreviewed: string[] } | null = null;
  function scanSrc(): { files: string[]; unreviewed: string[] } {
    if (scanCache !== null) return scanCache;
    const files = walk(SRC_ROOT);
    const unreviewed: string[] = [];
    for (const file of files) {
      const rel = relative(SRC_ROOT, file);
      if (rel in REVIEWED) continue;
      // NOTE: `readFileSync` + regex, deliberately NOT `grep`. CLAUDE.md trap 17:
      // plain grep is silently blind to NUL-bearing source files, and this repo
      // has at least one (`edit-graph-referee-gate.ts`).
      if (MAGNITUDE_WORD.test(readFileSync(file, "utf8"))) unreviewed.push(rel);
    }
    scanCache = { files, unreviewed };
    return scanCache;
  }

  it("every src/ file spelling a magnitude word has been reviewed and classified", () => {
    const { files, unreviewed } = scanSrc();
    expect(files.length, "the src/ walk found no TypeScript files — the scan is not running").toBeGreaterThan(100);

    expect(
      unreviewed,
      `These src/ files spell a magnitude word but are not in this guard's REVIEWED manifest:\n` +
        unreviewed.map((f) => `  - ${f}`).join("\n") +
        `\n\nEach one is either (a) a NEW magnitude lookup, which must be added to ` +
        `SIBLING_VALUE_LOOKUPS or SIBLING_VOCABULARIES so the union assertion covers it, or ` +
        `(b) an incidental mention, which must be added to REVIEWED with the reason. ` +
        `Do not delete this assertion: it is the only thing standing between this estate and a ` +
        `fifth hand-written magnitude list.`,
    ).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it("the REVIEWED manifest has no stale entries", () => {
    const files = new Set(scanSrc().files.map((file) => relative(SRC_ROOT, file)));
    for (const rel of Object.keys(REVIEWED)) {
      expect(files.has(rel), `REVIEWED lists ${rel}, which no longer exists in src/`).toBe(true);
    }
  }, SCAN_TIMEOUT_MS);
});

/* ===========================================================================
 * PART E — THE GUARD ITSELF IS NOT VACUOUS.
 * ======================================================================== */

describe("ROADMAP 2.330 — this guard can actually see a short list", () => {
  it("the union it checks is non-empty and spans every sibling", () => {
    const union = new Set<string>();
    for (const sibling of SIBLING_VALUE_LOOKUPS) {
      expect(
        sibling.entries.length,
        `${sibling.module}::${sibling.symbol} contributed NO keys`,
      ).toBeGreaterThan(0);
      for (const [key] of sibling.entries) union.add(key.toLowerCase());
    }
    for (const sibling of SIBLING_VOCABULARIES) {
      const tokens = alternationTokens(sibling.source, `${sibling.module}::${sibling.symbol}`);
      expect(tokens.length, `${sibling.module}::${sibling.symbol} contributed NO tokens`).toBeGreaterThan(0);
      for (const token of tokens) union.add(token);
    }
    // Every canonical key that a sibling also spells, plus `hundred`, which no
    // canonical key covers. A union that shrank below this stopped checking.
    expect(union.size).toBeGreaterThanOrEqual(8);
    expect(union.has("grand")).toBe(true);
    expect(union.has("hundred")).toBe(true);
  });

  it("`isKnownMagnitude` is the predicate under test, and it discriminates", () => {
    expect(isKnownMagnitude("million")).toBe(true);
    expect(isKnownMagnitude("gazillion")).toBe(false);
    expect(Object.keys(MAGNITUDE_MULTIPLIERS).length).toBeGreaterThan(0);
  });
});
