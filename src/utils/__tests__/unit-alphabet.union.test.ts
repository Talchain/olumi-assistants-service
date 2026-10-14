/**
 * ⭐ PR-U1 G4 row 9 — A NEW PERIOD OR %/pp LIST CANNOT ARRIVE QUIETLY (Science U-GRAMMAR G0, #87 5999605004).
 *
 * `utils/unit-alphabet.ts` is the ONE unit vocabulary. This file scans `src/` from disk (the
 * `magnitude-alphabet.union.test.ts` pattern) for any file that QUOTES four or more distinct spellings the leaf owns,
 * in code with comments stripped. Every such file must be in `KNOWN` below, and a known file's quoted set is PINNED:
 * a known copy that gains a spelling REDs too, because a copy that grows is the drift this guard exists for.
 *
 * It is a REVIEW TRIPWIRE, not a correctness proof: it cannot tell a period list from four type tags, and a list of
 * three or fewer quoted spellings escapes it. What it guarantees is that a fifth period table forces a human to look.
 * The known copies were measured at CEE staging b02a3cc1 + PR-U1; folding them onto the leaf is G3.4's follow-up work.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { allUnitSpellings } from "../unit-alphabet.js";

const SRC_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const THRESHOLD = 4;
const SCAN_TIMEOUT_MS = 60_000;

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SPELLINGS = [...new Set(allUnitSpellings())].sort((a, b) => b.length - a.length);
const QUOTED = new RegExp(`['"\`](${SPELLINGS.map(escape).join("|")})['"\`]`, "gi");
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");

/** The distinct leaf spellings a source text QUOTES in code. */
function quotedUnitSpellings(source: string): string[] {
  return [...new Set([...stripComments(source).matchAll(QUOTED)].map((m) => m[1]!.toLowerCase()))].sort();
}

const FOLD = "KNOWN COPY (Science U-GRAMMAR G0/G3.4): its period/%/pp spellings are to be derived from the leaf — follow-up row";
const UNCLASSIFIED = "KNOWN at b02a3cc1, not yet classified by U-GRAMMAR: pinned so it cannot grow; classify or fold under a follow-up row";

/** Every file over the threshold, its pinned quoted set, and why it is allowed. */
const KNOWN: Readonly<Record<string, { readonly quoted: readonly string[]; readonly why: string }>> = {
  "utils/unit-alphabet.ts": { quoted: [], why: "THE leaf: every spelling lives here (its set is the leaf itself, not pinned)" },
  "orchestrator-v5/agent-lane/identity-proposal.ts": {
    quoted: ["arr", "month", "mrr", "percent", "percentage", "year"],
    why: "GOAL-REACH #2826 (Science §(e) add. 6): a NOT-A-COUNT stoplist for an outcome label's words and a time-POINT strip, not a unit reader; units are read by same-unit.ts (DL 58e392 ruling)",
  },
  "orchestrator-v5/routing/stated-event-risk.ts": {
    quoted: ["%", "percent", "week", "year"],
    why: "event_risk.v1 slice 2a: '%' / 'percent' are parseNumericValue's input normaliser and its unit tag; 'week' / 'year' tag the horizon noun its bounded regex captured (months?|years?|weeks?) for the months conversion. A 3-noun duration reader, not a period table",
  },
  "orchestrator-v5/agent-lane/same-unit.ts": {
    quoted: ["%", "month", "percent", "year"],
    why: "C1's month/year view is DERIVED from the leaf; these quotes are its Period type tags ('month' | 'year') and kind tags ('%', 'percent')",
  },
  "cee/provenance/stated-amounts.ts": {
    quoted: ["annual", "annually", "annum", "arr", "mo", "month", "monthly", "months", "mrr", "pa", "pcm", "percent", "year", "years", "yr"],
    why: `${FOLD} (CURRENCY_UNIT_QUALIFIERS period words)`,
  },
  "orchestrator-v5/tools/handlers/d1-shared/evaluate-factor-value-proposal.ts": {
    quoted: ["%", "day", "fortnight", "hour", "minute", "month", "quarter", "second", "week", "year"],
    why: `${FOLD} (RATE_DENOMINATOR_SPELLINGS)`,
  },
  "orchestrator-v5/routing/deterministic-value-update.ts": {
    quoted: ["%", "day", "fortnight", "hour", "minute", "month", "percentage", "quarter", "second", "week", "year"],
    why: `${FOLD} (RATE_PERIODS)`,
  },
  "orchestrator-v5/agent-lane/admit-constraint.ts": {
    quoted: ["%", "day", "month", "percent", "quarter", "week", "year"],
    why: `${FOLD} (PERIOD_NAME / PERIOD_TAIL)`,
  },
  "cee/draft/records/unit-scale-class.ts": {
    quoted: ["%", "pct", "per cent", "percent", "percentage", "pp", "pps", "ppt"],
    why: "NOT unit identity (Science G0, trap 21): the frame family, prefix-matched; never used to decide two units are equal",
  },
  "orchestrator-v5/agent-lane/unplaced-goal-level.ts": {
    quoted: ["annual", "annually", "annum", "month", "monthly", "months", "percent", "year", "yearly", "years"],
    why: "NOT unit identity (Science G0, trap 21): label stopwords; its period equality reads `periodIn` from same-unit",
  },
  "orchestrator-v5/compose/format-factor-value.ts": {
    quoted: ["%", "day", "days", "hour", "hours", "month", "months", "pct", "percent", "percentage", "quarter", "quarters", "week", "weeks", "year", "years"],
    why: UNCLASSIFIED,
  },
  "cee/factor-extraction/index.ts": {
    quoted: ["%", "annual", "day", "days", "month", "months", "quarter", "quarters", "week", "weeks", "year", "years", "yr", "yrs"],
    why: UNCLASSIFIED,
  },
  "orchestrator-v5/agent-lane/stated-by-user.ts": {
    quoted: ["%", "annual", "annually", "daily", "day", "month", "monthly", "percent", "quarter", "quarterly", "week", "weekly", "year", "yearly"],
    why: UNCLASSIFIED,
  },
  "cee/factor-extraction/merge.ts": {
    quoted: ["%", "day", "days", "month", "months", "percent", "percentage", "quarter", "quarters", "week", "weeks", "year", "years"],
    why: UNCLASSIFIED,
  },
  "cee/extraction/numeric-parser.ts": {
    quoted: ["day", "days", "hour", "hours", "month", "months", "percent", "week", "weeks", "year", "years"],
    why: UNCLASSIFIED,
  },
  "orchestrator-v5/routing/value-unit-resolution.ts": {
    quoted: ["%", "day", "hour", "minute", "month", "percent", "percentage", "pp", "quarter", "week", "year"],
    why: UNCLASSIFIED,
  },
  "orchestrator-v5/system-events/link-effect-unit-reading.ts": {
    quoted: ["%", "day", "month", "percent", "quarter", "week", "year"],
    why: UNCLASSIFIED,
  },
  "cee/compound-goal/extractor.ts": { quoted: ["%", "arr", "months", "mrr", "percent"], why: UNCLASSIFIED },
  "cee/validation/preflight.ts": { quoted: ["day", "hour", "month", "week", "year"], why: UNCLASSIFIED },
  "cee/draft/records/projector.ts": { quoted: ["%", "percent", "quarter", "year"], why: UNCLASSIFIED },
  "orchestrator-v5/agent-lane/option-name-truth.ts": { quoted: ["day", "month", "week", "year"], why: UNCLASSIFIED },
  "orchestrator-v5/context/cqe/rules.ts": { quoted: ["%", "percentage", "pp", "quarter"], why: UNCLASSIFIED },
  "orchestrator-v5/goal-target/deadline-date.ts": {
    quoted: ["day", "days", "month", "months", "week", "weeks", "year"],
    why: "S-E GOALS deadline CALENDAR (#2742), not a rate-period table: its count-unit type tags ('months' | 'weeks' | 'days') and the Intl date-part names ('year' | 'month' | 'day')",
  },
};

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

let cache: { files: number; over: Map<string, string[]> } | null = null;
function scan(): { files: number; over: Map<string, string[]> } {
  if (cache !== null) return cache;
  const files = walk(SRC_ROOT);
  const over = new Map<string, string[]>();
  for (const file of files) {
    // readFileSync + regex, never grep: plain grep is blind to NUL-bearing source files (CLAUDE.md trap 17).
    const quoted = quotedUnitSpellings(readFileSync(file, "utf8"));
    if (quoted.length >= THRESHOLD) over.set(relative(SRC_ROOT, file), quoted);
  }
  cache = { files: files.length, over };
  return cache;
}

describe("PR-U1 G4 row 9: a new period or %/pp list in src/ forces a review", () => {
  it("CATCH TWIN: the detector fires on a four-spelling list and not on three", () => {
    expect(quotedUnitSpellings(`const P = ['daily', 'weekly', "monthly", 'yearly'];`).length).toBeGreaterThanOrEqual(THRESHOLD);
    expect(quotedUnitSpellings(`const P = ['daily', 'weekly', 'monthly'];`).length).toBeLessThan(THRESHOLD);
    expect(quotedUnitSpellings(`// ['daily', 'weekly', 'monthly', 'yearly'] in a comment`)).toEqual([]);
  });

  it("every src/ file quoting four or more leaf spellings is known, with its reason", { timeout: SCAN_TIMEOUT_MS }, () => {
    const { files, over } = scan();
    expect(files, "the src/ walk found no TypeScript files: the scan is not running").toBeGreaterThan(100);
    const unknown = [...over.entries()].filter(([f]) => !(f in KNOWN)).map(([f, q]) => `${f}: ${q.join(",")}`);
    expect(unknown, "a NEW period/%/pp list: derive it from utils/unit-alphabet.ts, or add it to KNOWN with a reason").toEqual([]);
  });

  it("no known copy has grown a spelling (the leaf itself excepted)", { timeout: SCAN_TIMEOUT_MS }, () => {
    const { over } = scan();
    const grown: string[] = [];
    for (const [file, { quoted }] of Object.entries(KNOWN)) {
      if (file === "utils/unit-alphabet.ts") continue;
      const now = over.get(file) ?? [];
      const extra = now.filter((s) => !quoted.includes(s));
      if (extra.length > 0) grown.push(`${file}: +${extra.join(",")}`);
    }
    expect(grown).toEqual([]);
  });

  it("KNOWN has no stale entries: each is still over the threshold", { timeout: SCAN_TIMEOUT_MS }, () => {
    const { over } = scan();
    expect(Object.keys(KNOWN).filter((f) => !over.has(f))).toEqual([]);
    for (const { why } of Object.values(KNOWN)) expect(why.length).toBeGreaterThan(40);
  });
});
