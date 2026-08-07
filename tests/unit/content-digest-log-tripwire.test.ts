import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tokenise } from "../../scripts/ci/strip-source-comments.mjs";

/**
 * TRIPWIRE: content-bearing log calls must route through contentDigest().
 *
 * Central-log redaction (logger-config.ts REDACT_PATHS) is an alias list — a field is
 * only censored if its exact name is enumerated there. That list is a hand-maintained
 * mirror: it drifts, and the drift always reads as green. So instead of trusting the
 * alias list to catch every content field, we forbid raw model output / user text from
 * ever reaching a log call under a content-convention field name unless it is first
 * passed through contentDigest() (which emits only a hash + length).
 *
 * This test is DERIVED, not hand-listed: it scans every log.* call site and flags any
 * property whose KEY follows the content-preview naming convention (*_preview, *_sample,
 * raw_llm_*, raw_text, raw_output, raw_preview, user_message*) whose value is NOT a
 * contentDigest(...) call. A NEW field following the convention is caught automatically —
 * no allowlist to update.
 *
 * The only permitted un-routed sites live in EXPECTED_UNROUTED, and the assertion is
 * EXACT set equality in BOTH directions, so the set FAILS LOUD on drift:
 *   - a new un-digested content field anywhere  → violations superset → FAIL
 *   - an EXPECTED_UNROUTED entry that gets fixed → violations subset  → FAIL (stale entry)
 */

const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));

// Content-field naming convention (a regex FAMILY, not a list of exact field names).
const CONTENT_KEY_RE =
  /(_preview$|_sample$|^raw_llm_(text|output|json)$|^raw_text$|^raw_output$|^raw_preview$|(^|_)user_message(_preview)?$)/;
// Boolean-predicate keys (has_/is_/…) are flags, not free text — excluded by convention.
const BOOL_PREFIX_RE = /^(has|is|should|can|did|was|are|were|will|no)_/;

/**
 * Content log fields NOT yet routed through contentDigest, each with a documented reason.
 * Keyed by `<src-relative-posix-path>::<field>`. Asserted for EXACT equality (both ways).
 */
const EXPECTED_UNROUTED = new Set<string>([
  // Owned by other lanes in this merge window — the call-site swap is owed at the
  // merge-window (tracked in the PR body). Do NOT edit those files from this lane.
  "adapters/llm/anthropic.ts::system_prompt_preview",
  "adapters/llm/anthropic.ts::raw_output_sample",
  "orchestrator/tools/edit-graph.ts::raw_preview",
  // Structural graph metadata: the logged value is `{ id, category }` node fields behind
  // the CEE_DEBUG_CATEGORY_TRACE flag — node ids + category enums, not free-text model or
  // user content. Digesting would defeat the category-propagation trace's entire purpose.
  // RE-VERIFY if the logged shape ever changes to include labels/body/prose.
  "cee/transforms/schema-v3.ts::v1_input_sample",
  "cee/transforms/schema-v3.ts::v1_category_sample",
  "cee/transforms/schema-v3.ts::v3_category_sample",
]);

interface Hit {
  relPath: string;
  key: string;
  digested: boolean;
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (
      entry.endsWith(".ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".spec.ts") &&
      !entry.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Extract every content-convention field passed to a log.* call in one source file. */
function scanFile(rawSrc: string, relPath: string): Hit[] {
  const hits: Hit[] = [];
  // LITERAL-AWARE SCAN. Both walkers below balance brackets by counting raw
  // characters, so a stray ')' / ',' / '{' / '}' hiding inside a string,
  // template, or regex literal — e.g. log.info("oops ) done", { raw_output: x })
  // — would truncate the walk BEFORE the content-bearing fields and let a raw
  // log call slip past the tripwire (the exact guard-that-cannot-see class this
  // file fights). So we scan the STRUCTURAL view produced by the repo's ratified
  // literal-aware tokeniser (scripts/ci/strip-source-comments.mjs, parity-pinned
  // by tests/unit/ci/strip-source-comments.test.ts — NOT a third hand-rolled
  // tokeniser): comments and string/template/regex-literal CONTENTS are blanked
  // to spaces (their stray brackets vanish), while code — the `log.*(` call, the
  // `key:` structure, and the `contentDigest(` routing — stays intact.
  const src = tokenise(rawSrc).structural;
  const logCallRe = /\blog\.(info|warn|error|debug|trace|fatal)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = logCallRe.exec(src)) !== null) {
    // Walk balanced parens to the end of the log call.
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    const body = src.slice(start, i - 1);

    const keyRe = /([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
    let km: RegExpExecArray | null;
    while ((km = keyRe.exec(body)) !== null) {
      const key = km[1];
      if (!CONTENT_KEY_RE.test(key) || BOOL_PREFIX_RE.test(key)) continue;

      // Extract the value expression: from after `key:` up to the next top-level comma.
      let vi = km.index + km[0].length;
      let vd = 0;
      const vs = vi;
      while (vi < body.length) {
        const c = body[vi];
        if (c === "(" || c === "{" || c === "[") vd++;
        else if (c === ")" || c === "}" || c === "]") vd--;
        else if (c === "," && vd === 0) break;
        if (vd < 0) break;
        vi++;
      }
      const valExpr = body.slice(vs, vi).trim();
      const digested = /^contentDigest\s*\(/.test(valExpr);
      hits.push({ relPath, key, digested });
    }
  }
  return hits;
}

function collectHits(): Hit[] {
  const files = listTsFiles(SRC_DIR);
  const hits: Hit[] = [];
  for (const f of files) {
    const relPath = relative(SRC_DIR, f).split(sep).join("/");
    hits.push(...scanFile(readFileSync(f, "utf8"), relPath));
  }
  return hits;
}

describe("content-digest log tripwire", () => {
  const hits = collectHits();

  it("positive control: the scanner can actually SEE content log fields and digest routing", () => {
    // If this fails, the scanner is broken and every absence assertion below is vacuous.
    expect(hits.length).toBeGreaterThan(5);
    expect(hits.some((h) => h.digested)).toBe(true);
    expect(hits.some((h) => !h.digested)).toBe(true);
    // A known routed site must read as digested, and a known owned site as un-routed —
    // proving both branches of the digest detector discriminate.
    expect(
      hits.find((h) => h.relPath === "adapters/llm/openai.ts" && h.key === "raw_output_sample")
        ?.digested,
    ).toBe(true);
    expect(
      hits.find(
        (h) => h.relPath === "adapters/llm/anthropic.ts" && h.key === "raw_output_sample",
      )?.digested,
    ).toBe(false);
  });

  it("every content-bearing log field is digested, except the documented owed/structural set", () => {
    const violations = new Set(
      hits.filter((h) => !h.digested).map((h) => `${h.relPath}::${h.key}`),
    );

    const undigestedAndUnexpected = [...violations].filter((v) => !EXPECTED_UNROUTED.has(v));
    const staleExpectations = [...EXPECTED_UNROUTED].filter((v) => !violations.has(v));

    // Direction 1: no NEW raw-content log field slipped in without contentDigest().
    expect(
      undigestedAndUnexpected,
      `Un-digested content log fields found. Route them through contentDigest() ` +
        `(src/utils/redaction.ts), or if owed to another lane, add to EXPECTED_UNROUTED with a reason:\n  ` +
        undigestedAndUnexpected.join("\n  "),
    ).toEqual([]);

    // Direction 2: no EXPECTED_UNROUTED entry has silently gone stale (been fixed/removed).
    expect(
      staleExpectations,
      `EXPECTED_UNROUTED entries no longer match a real un-digested site — remove them:\n  ` +
        staleExpectations.join("\n  "),
    ).toEqual([]);
  });
});

describe("content-digest log tripwire — literal-aware scanning", () => {
  // These synthetic-source cases pin the reviewer's exact bypass: a scanner that
  // balances brackets on RAW characters is STRING-LITERAL-BLIND — a ')' inside a
  // string/template/regex literal earlier in a log call truncates the paren-walk
  // before the content-bearing fields, so a raw-content log call sails past the
  // tripwire. Each case is a combined positive+absence control: it first proves
  // the scanner can SEE the field at all (presence), then asserts its digest
  // verdict — so a blind scanner (field unseen → `undefined`) fails LOUD, never
  // passes vacuously. Mutation-check: revert scanFile to scan the raw source and
  // the `.toBeDefined()` presence assertions go RED.

  it("a ')' inside an earlier string literal must NOT hide a later raw-content field", () => {
    const src = `
      log.info("model refused with a ) closing paren in the message", {
        turn_id,
        raw_output: someRawModelText,
      });
    `;
    const hit = scanFile(src, "synthetic.ts").find((h) => h.key === "raw_output");
    expect(hit, "scanner must SEE the field past the )-bearing string").toBeDefined();
    expect(hit?.digested).toBe(false);
  });

  it("a digested field after a ')'-bearing string still reads as DIGESTED (detector discriminates)", () => {
    const src = `log.warn("aborted ) here", { raw_output_sample: contentDigest(x) });`;
    const hit = scanFile(src, "synthetic.ts").find((h) => h.key === "raw_output_sample");
    expect(hit, "scanner must SEE the digested field past the )-bearing string").toBeDefined();
    expect(hit?.digested).toBe(true);
  });

  it("a ')' inside a template literal must NOT hide a later raw-content field", () => {
    const src = "log.error(`prompt with ) in a ${expr} template`, { raw_text: rawUserText });";
    const hit = scanFile(src, "synthetic.ts").find((h) => h.key === "raw_text");
    expect(hit, "scanner must SEE the field past the )-bearing template").toBeDefined();
    expect(hit?.digested).toBe(false);
  });

  it("a content field that only APPEARS inside a string literal is not a real log field", () => {
    // The value's brackets are literal text, not code — the field name here lives
    // entirely inside a string, so it must not be mistaken for a real log key.
    const src = `log.info("raw_output: not a real field, just prose )");`;
    const hits = scanFile(src, "synthetic.ts");
    expect(hits.find((h) => h.key === "raw_output")).toBeUndefined();
  });
});
