import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STORE_MODEL_CONFIG_LIVE_CALL_SITES,
  STORE_MODEL_CONFIG_NON_TASK_READERS,
} from "../model-routing.js";

/* ===========================================================================
 * WHY THIS GUARD EXISTS
 *
 * Precedence rank 2 (`store_model_config`) is NOT global. The router never
 * consults the prompt store; it only sees a `modelOverride` argument, so a
 * prompt-store modelConfig pin takes effect ONLY where the CALL SITE reads the
 * pin and passes it on. On every other task the pin is INERT.
 *
 * That fact was documented as though rank 2 applied everywhere, and the
 * documentation drifted from the code in both directions (CLAUDE.md trap 12 —
 * the hand-maintained mirror). Measured live on 2026-08-08: the 'orchestrator'
 * task carried a staging pin while staging served the CEE_MODEL_ORCHESTRATOR
 * value (rank 3), because `resolveRoutingAdapter()` passes no modelOverride.
 *
 * So the documented list is NOT trusted. `src/` is scanned from disk for files
 * that read an environment key off a prompt's modelConfig, each is classified
 * live-task-path vs harness by whether it names a task with a literal
 * `getSystemPromptMeta('<task>')` call, and the derived sets must equal the
 * declared ones EXACTLY. A new undocumented reader REDs; a documented reader
 * that stopped reading REDs.
 *
 * ANTI-VACUITY: a derivation that silently stops scanning returns an empty set,
 * which is indistinguishable from "no drift" — CLAUDE.md trap 20's uniformity
 * tell. Part A therefore proves the instrument is running BEFORE Part B trusts
 * a single one of its numbers.
 * ======================================================================== */

const SRC_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Budget for the disk scan of `src/`.
 *
 * Sized off the sibling derivation guard (magnitude-alphabet.union.test.ts),
 * which RED-ed on 2 of 5 runs under vitest's 5,000 ms default when the parallel
 * workers saturated the box. A guard that fails at random is trap 7's broken
 * alarm; this is unreachable by load and still catches a genuine hang.
 */
const SCAN_TIMEOUT_MS = 60_000;

/**
 * A read of the environment key off a prompt's modelConfig — i.e. the thing
 * that makes rank 2 apply at all. Both spellings in the tree today are
 * `<meta>.modelConfig[env]`.
 */
const READS_STORE_MODEL_CONFIG = /\.modelConfig\s*\[/;

/**
 * A literal task name. This is what separates a LIVE TASK PATH from the admin
 * harness: the harness runs an operator-chosen prompt record and names no task.
 */
const NAMES_A_TASK = /getSystemPromptMeta\(\s*['"][a-z0-9_]+['"]/;

interface Scan {
  /** Every non-test .ts file under src/, repo-relative with posix separators. */
  readonly files: readonly string[];
  /** Files whose contents were successfully read (must equal `files`). */
  readonly read: readonly string[];
  /** Files that read a store modelConfig pin AND name a task. */
  readonly live: readonly string[];
  /** Files that read a store modelConfig pin but name no task. */
  readonly nonTask: readonly string[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules" || entry.name === "generated") {
        continue;
      }
      walk(full, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Repo-relative, posix-separated, so the declaration reads the same on any OS. */
function repoRelative(absolute: string): string {
  return `src/${relative(SRC_ROOT, absolute).split(sep).join("/")}`;
}

let scanCache: Scan | null = null;

function scanSrc(): Scan {
  if (scanCache !== null) return scanCache;

  const absolute = walk(SRC_ROOT);
  const files: string[] = [];
  const read: string[] = [];
  const live: string[] = [];
  const nonTask: string[] = [];

  for (const file of absolute) {
    const rel = repoRelative(file);
    files.push(rel);

    // NOTE: `readFileSync` + regex, deliberately NOT `grep`. CLAUDE.md trap 17:
    // plain grep is silently blind to NUL-bearing source files, and this repo
    // carries them (edit-graph-referee-gate.ts holds a deliberate '\0'
    // sentinel). A grep-based derivation would report a clean sweep it never
    // performed. Node reads the bytes regardless.
    const text = readFileSync(file, "utf8");
    read.push(rel);

    if (!READS_STORE_MODEL_CONFIG.test(text)) continue;
    if (NAMES_A_TASK.test(text)) live.push(rel);
    else nonTask.push(rel);
  }

  scanCache = {
    files,
    read,
    live: live.sort(),
    nonTask: nonTask.sort(),
  };
  return scanCache;
}

const sorted = (values: readonly string[]): string[] => [...values].sort();

/* ===========================================================================
 * PART A — THE INSTRUMENT IS RUNNING.
 *
 * Every assertion below Part A is a set comparison, and a set comparison
 * against a derivation that scanned nothing PASSES. These four run first and
 * fail loud so that can never read as "no drift".
 * ======================================================================== */

describe("store_model_config call-site derivation — the instrument is not blind", () => {
  it("DERIVATION_WALKED_SRC — the walk found a plausible number of TypeScript files", () => {
    const { files } = scanSrc();
    expect(
      files.length,
      `The src/ walk found ${files.length} .ts files. That is not a codebase — SRC_ROOT ` +
        `(${SRC_ROOT}) is almost certainly wrong, and every set comparison in this file is ` +
        `therefore comparing against an empty scan.`,
    ).toBeGreaterThan(200);
  }, SCAN_TIMEOUT_MS);

  it("DERIVATION_READ_EVERY_FILE_IT_LISTED — no file was silently skipped", () => {
    const { files, read } = scanSrc();
    expect(
      read.length,
      `The walk listed ${files.length} files but only ${read.length} were read. A silent skip ` +
        `shrinks the search space without shrinking the apparent result.`,
    ).toBe(files.length);
  }, SCAN_TIMEOUT_MS);

  it("DERIVATION_IS_NOT_VACUOUS — at least one store modelConfig reader exists", () => {
    const { live, nonTask } = scanSrc();
    expect(
      live.length + nonTask.length,
      `The derivation found ZERO files reading a prompt-store modelConfig pin. Either the read ` +
        `pattern (${READS_STORE_MODEL_CONFIG}) no longer matches how the code spells this — in ` +
        `which case fix the pattern, do NOT empty the declared lists — or rank 2 has been removed ` +
        `from the product entirely, in which case the precedence block in model-routing.ts must ` +
        `say so. A broken regex must never read as "no drift".`,
    ).toBeGreaterThan(0);
  }, SCAN_TIMEOUT_MS);

  it("DERIVATION_SEES_THE_KNOWN_MEMBER — parse.ts is found by identity", () => {
    const { live } = scanSrc();
    // Bound to the file by IDENTITY, not by "some file matched" — a value
    // predicate another file could satisfy would let a renamed API pass while
    // the scan quietly found something else (CLAUDE.md trap 19).
    expect(
      live,
      `The draft_graph call site (src/cee/unified-pipeline/stages/parse.ts) is the one member ` +
        `of this manifest known independently of this scan: it is where the 2026-08-08 live ` +
        `measurement showed a store pin genuinely winning. If it is missing, the derivation is ` +
        `broken or the API was renamed — the answer is never to delete this assertion.`,
    ).toContain("src/cee/unified-pipeline/stages/parse.ts");
  }, SCAN_TIMEOUT_MS);
});

/* ===========================================================================
 * PART B — THE DOCUMENTATION MATCHES THE CODE, BOTH WAYS.
 * ======================================================================== */

describe("store_model_config call-site derivation — declaration equals source", () => {
  it("LIVE_CALL_SITES_MATCH_THE_DECLARATION — no new or stale live reader", () => {
    const { live } = scanSrc();
    expect(
      live,
      `The set of LIVE TASK PATHS that consume a prompt-store modelConfig pin has changed.\n\n` +
        `  derived from src/: ${JSON.stringify(live, null, 2)}\n` +
        `  declared:          ${JSON.stringify(sorted(STORE_MODEL_CONFIG_LIVE_CALL_SITES), null, 2)}\n\n` +
        `This is a PRECEDENCE CHANGE, not a formatting nit: rank 2 now applies to a different ` +
        `set of tasks than the precedence block in src/config/model-routing.ts documents, and a ` +
        `pin on a task outside the derived set is INERT. Update ` +
        `STORE_MODEL_CONFIG_LIVE_CALL_SITES and re-read the rank 2 paragraph before merging.`,
    ).toEqual(sorted(STORE_MODEL_CONFIG_LIVE_CALL_SITES));
  }, SCAN_TIMEOUT_MS);

  it("NON_TASK_READERS_MATCH_THE_DECLARATION — the harness set is exact", () => {
    const { nonTask } = scanSrc();
    expect(
      nonTask,
      `The set of NON-TASK readers of a prompt modelConfig has changed.\n\n` +
        `  derived from src/: ${JSON.stringify(nonTask, null, 2)}\n` +
        `  declared:          ${JSON.stringify(sorted(STORE_MODEL_CONFIG_NON_TASK_READERS), null, 2)}\n\n` +
        `A file lands here when it reads a pin but names no task via getSystemPromptMeta('<task>'). ` +
        `If a LIVE task path has drifted into this bucket it means it stopped naming its task — ` +
        `check it is still routing what you think it routes.`,
    ).toEqual(sorted(STORE_MODEL_CONFIG_NON_TASK_READERS));
  }, SCAN_TIMEOUT_MS);
});

/* ===========================================================================
 * PART C — THE CLAIMS THE COMMENTS MAKE ARE PINNED TO THE CODE.
 *
 * Part B guards the LIST. These guard the two SENTENCES the list exists to
 * keep honest — otherwise the comments could drift straight back.
 * ======================================================================== */

describe("store_model_config — the documented claims are bound to the source", () => {
  it("ORCHESTRATOR_SITE_PASSES_NO_MODEL_OVERRIDE — rank 2 is unreachable there", () => {
    const routing = readFileSync(
      join(SRC_ROOT, "orchestrator-v5", "routing", "route-with-tool-use.ts"),
      "utf8",
    );

    /*
     * SCOPE THE SEARCH TO THE FUNCTION BODY, NOT THE FILE.
     *
     * The docblock ABOVE resolveRoutingAdapter quotes the call it documents,
     * verbatim. A whole-file regex is therefore satisfied by the PROSE: the
     * code could start passing an override, the docblock example would still
     * match, and this assertion would pass while the paragraph it defends
     * became false. That is not hypothetical — the mutation kit for this guard
     * caught exactly it (mutant M7), because the first occurrence of the call
     * in this file is the comment, not the code.
     *
     * Slicing from the `function` keyword drops every preceding comment, so
     * what follows is a statement about the CODE.
     */
    const DECL = "function resolveRoutingAdapter";
    const declAt = routing.indexOf(DECL);
    expect(
      declAt,
      `route-with-tool-use.ts no longer declares resolveRoutingAdapter. Everything below is a ` +
        `claim about that function's body; with the function gone the claim has no subject.`,
    ).toBeGreaterThan(-1);
    const body = routing.slice(declAt);

    // Precondition, pinned in-test: the call must exist in the BODY, or the
    // assertion below would pass by finding nothing (CLAUDE.md trap 13b).
    expect(
      /getAdapterWithResolution\(\s*['"]orchestrator['"]/.test(body),
      `resolveRoutingAdapter's body no longer resolves the 'orchestrator' task via ` +
        `getAdapterWithResolution. Its docblock describes that call and is now describing code ` +
        `that is not there.`,
    ).toBe(true);

    // The claim: no modelOverride argument, so ranks 1 and 2 cannot apply.
    expect(
      /getAdapterWithResolution\(\s*['"]orchestrator['"]\s*\)/.test(body),
      `resolveRoutingAdapter() now passes an argument after 'orchestrator'. That makes ranks 1 ` +
        `and 2 REACHABLE at the V5 ORIENT site, which falsifies its docblock ("STRUCTURALLY ` +
        `UNREACHABLE ... a prompt-store modelConfig pin on the 'orchestrator' task is INERT") and ` +
        `means 'orchestrator' may now belong in STORE_MODEL_CONFIG_LIVE_CALL_SITES. Fix the ` +
        `documentation in the same change; do not relax this regex.`,
    ).toBe(true);
  });

  it("PRECEDENCE_BLOCK_POINTS_AT_THE_DECLARATION — one declaration, not two prose copies", () => {
    const modelRouting = readFileSync(join(SRC_ROOT, "config", "model-routing.ts"), "utf8");

    const DECLARATION = "export const STORE_MODEL_CONFIG_LIVE_CALL_SITES";
    const declarationAt = modelRouting.indexOf(DECLARATION);

    // Precondition, pinned in-test. Without this the search below would run
    // over the whole file and match the DECLARATION ITSELF — a guard agreeing
    // with itself (CLAUDE.md trap 13b), passing whether or not any comment
    // points anywhere. Only the prose ABOVE the declaration is evidence.
    expect(
      declarationAt,
      `model-routing.ts no longer declares STORE_MODEL_CONFIG_LIVE_CALL_SITES. The precedence ` +
        `block's rank 2 paragraph depends on it existing.`,
    ).toBeGreaterThan(-1);

    const prose = modelRouting.slice(0, declarationAt);
    expect(
      prose.includes("STORE_MODEL_CONFIG_LIVE_CALL_SITES"),
      `The precedence block ABOVE the declaration in model-routing.ts no longer names ` +
        `STORE_MODEL_CONFIG_LIVE_CALL_SITES. The whole point of that constant is that the rank 2 ` +
        `paragraph POINTS at it instead of re-listing the call sites in prose — two prose copies ` +
        `is exactly the drift this guard was written to end.`,
    ).toBe(true);
  });

  it("DECLARED_SETS_ARE_DISJOINT — a file is a task path or a harness, never both", () => {
    const overlap = STORE_MODEL_CONFIG_LIVE_CALL_SITES.filter((p) =>
      STORE_MODEL_CONFIG_NON_TASK_READERS.includes(p),
    );
    expect(
      overlap,
      `These paths are declared as BOTH live task paths and non-task readers: ${overlap.join(", ")}. ` +
        `The two lists mean opposite things about whether a pin on that path is honoured.`,
    ).toEqual([]);
  });
});
