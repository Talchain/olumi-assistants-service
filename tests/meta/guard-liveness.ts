/**
 * Guard-liveness derivation (shared by the spec and its positive controls).
 *
 * WHY THIS EXISTS. A guard that runs nowhere is indistinguishable from a guard
 * that finds nothing — both are silent. This repo has 95 script artefacts and
 * exactly ONE required status check (`Lint, TypeCheck, Unit Tests`, derived
 * below, never hand-named). Everything else is advisory or developer-local, so
 * a "gate" can be added, cited in a comment as enforcement, and never block a
 * single merge.
 *
 * DERIVE BOTH SIDES — a hardcoded list of guards or workflows would drift
 * exactly like the thing it polices:
 *   · ARTEFACTS  from `git ls-files scripts/**` (fails loud if it reads zero).
 *   · INVOKERS   from package.json scripts + every .github/workflows/*.yml
 *                `run:` block + the hook installer.
 *   · REQUIRED   is the job that runs `pnpm test:required` — i.e. the job this
 *                very spec executes inside. Self-locating, so moving the gate
 *                moves the guard with it. Zero or many such jobs → hard error.
 *
 * TWO EDGE RULES, both learned by measurement while building this:
 *
 *   1. COMMAND POSITION, NOT MENTION. A bare text search for `scripts/x.sh`
 *      treats a MENTION as an INVOCATION. Measured: an error-message string in
 *      check-schemas-resolution.mjs — `'(or scripts/bootstrap-worktree.sh)'` —
 *      chained to install-hooks.sh and pulled all nine pre-push validate-*
 *      guards into "required-reachable", reporting ZERO hook-only orphans. One
 *      string in one error message hid nine orphaned guards behind a green.
 *
 *   2. TYPE-AWARE COMMENT STRIPPING. Applying JS block-comment stripping to a
 *      shell file DELETES REAL CODE: check-forbidden-boundary-patterns.sh:21
 *      contains the glob `**\/__tests__/**`, which holds both `/*` and `*\/`, so
 *      a `/\*...\*\/` strip swallowed 56 lines including the line that invokes
 *      the comment stripper. That manufactured a FALSE ORPHAN.
 *
 * Both defects fail in opposite directions (1 hides an orphan, 2 invents one),
 * which is why the controls below prove BOTH, on fixtures, before any claim
 * about this repo is believed.
 *
 * BOUNDARY, NOT AN EDGE: the hook installer is where CI reachability STOPS.
 * `bootstrap-worktree.sh` legitimately runs `bash scripts/install-hooks.sh`,
 * but installing a pre-push hook is not executing its guards in CI. Traversing
 * through it would relabel every developer-local guard as required.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type Kind = "sh" | "js";
export type Category = "REQUIRED" | "HOOK" | "NONREQUIRED_WORKFLOW";

/** A repo-root-anchored `scripts/...` path. The lookbehind is load-bearing: */
/* without it, `tools/graph-evaluator/scripts/x.ts` is captured as `scripts/x.ts`
   and reported as a missing artefact. Measured — it produced two false
   MISSING-ENFORCER findings before the anchor was added. */
export const SCRIPT_PATH_SRC = String.raw`(?<![A-Za-z0-9_./-])(?:\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/)?((?:\./)?scripts/[A-Za-z0-9_./-]+\.(?:sh|mjs|cjs|js|ts))`;

export function kindOf(path: string): Kind {
  return /\.sh$/.test(path) ? "sh" : "js";
}

/** See rule 2 in the header. Shell files get `#` only; never `/* *\/`. */
export function stripComments(text: string, kind: Kind): string {
  if (kind === "sh") {
    return text
      .split("\n")
      .map((l) => l.replace(/(^|\s)#.*$/, "$1"))
      .join("\n");
  }
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

/**
 * Invocation edges only (rule 1): an interpreter, a `./` execution, or an
 * assignment of the path to a variable (the `STRIPPER="scripts/..."` shape,
 * which check-forbidden-boundary-patterns.sh genuinely uses).
 */
const EDGE_RES: RegExp[] = [
  new RegExp(
    String.raw`\b(?:bash|sh|zsh|node|tsx|ts-node|exec|npx\s+tsx|npx)\s+(?:-[^\s]+\s+)*"?` +
      SCRIPT_PATH_SRC,
    "g",
  ),
  new RegExp(String.raw`(?:^|[;&|(]\s*)\.?/?` + SCRIPT_PATH_SRC + String.raw`\s`, "gm"),
  new RegExp(String.raw`=\s*"?` + SCRIPT_PATH_SRC + `"?`, "g"),
];

export function invocationEdges(raw: string, kind: Kind): Set<string> {
  const text = stripComments(raw, kind);
  const out = new Set<string>();
  for (const re of EDGE_RES) {
    for (const m of text.matchAll(re)) out.add(m[1].replace(/^\.\//, ""));
  }
  return out;
}

export function pnpmEdges(raw: string, kind: Kind): Set<string> {
  const text = stripComments(raw, kind);
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(?:pnpm|npm run|yarn)\s+(?:run\s+)?([a-zA-Z][a-zA-Z0-9:_-]*)/g)) {
    out.add(m[1]);
  }
  return out;
}

export interface Job {
  workflow: string;
  name: string;
  runs: string[];
}

/** Every `run:` body in a workflow fragment, block scalars included. */
export function runBlocks(text: string): string[] {
  const out: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)-?\s*run:\s*(\|[-+]?|>[-+]?)?\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    if (m[2]) {
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === "") {
          body.push("");
          continue;
        }
        if ((lines[j].match(/^(\s*)/) as RegExpMatchArray)[1].length <= indent) break;
        body.push(lines[j]);
      }
      out.push(body.join("\n"));
    } else if (m[3]) {
      out.push(m[3]);
    }
  }
  return out;
}

export function parseJobs(workflow: string, text: string): Job[] {
  const lines = text.split("\n");
  const jobsIdx = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsIdx < 0) return [];
  const acc: { key: string; name: string | null; lines: string[] }[] = [];
  let cur: { key: string; name: string | null; lines: string[] } | null = null;
  for (let i = jobsIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (m) {
      if (cur) acc.push(cur);
      cur = { key: m[1], name: null, lines: [] };
      continue;
    }
    if (!cur) continue;
    const nm = lines[i].match(/^ {4}name:\s*(.+?)\s*$/);
    if (nm && cur.name === null) cur.name = nm[1].replace(/^["']|["']$/g, "");
    cur.lines.push(lines[i]);
  }
  if (cur) acc.push(cur);
  return acc.map((j) => ({
    workflow,
    name: j.name ?? j.key,
    runs: runBlocks(j.lines.join("\n")),
  }));
}

export interface Repo {
  root: string;
  scripts: string[];
  pkgScripts: Record<string, string>;
  jobs: Job[];
  hookInstallers: string[];
}

export function readRepo(root: string): Repo {
  const tracked = execSync("git ls-files -z", { cwd: root, maxBuffer: 1 << 28 })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  if (tracked.length === 0) throw new Error("BLINDED: `git ls-files` returned zero tracked files");

  const scripts = tracked.filter(
    (p) => p.startsWith("scripts/") && /\.(sh|mjs|cjs|js|ts)$/.test(p) && !p.endsWith(".d.mts"),
  );
  if (scripts.length === 0) throw new Error("BLINDED: zero script artefacts under scripts/");

  const wfDir = join(root, ".github", "workflows");
  const jobs: Job[] = [];
  for (const f of readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f))) {
    jobs.push(...parseJobs(f, readFileSync(join(wfDir, f), "utf8")));
  }
  if (jobs.length === 0) throw new Error("BLINDED: zero workflow jobs parsed");

  return {
    root,
    scripts,
    pkgScripts: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {},
    jobs,
    hookInstallers: scripts.filter((p) => /install-hooks/.test(p)),
  };
}

/**
 * The required gate locates ITSELF: the job whose `run:` steps invoke the
 * command that runs this spec. Never a hand-written job name (trap 12).
 */
export function requiredGateJob(repo: Repo): Job {
  const hosts = repo.jobs.filter((j) => j.runs.some((r) => /\bpnpm\s+test:required\b/.test(r)));
  if (hosts.length !== 1) {
    throw new Error(
      `BLINDED: expected exactly one job running \`pnpm test:required\`, found ${hosts.length}` +
        ` (${hosts.map((h) => `${h.workflow}::${h.name}`).join(", ")})`,
    );
  }
  return hosts[0];
}

type Seed = { t: string; k: Kind };

export function closure(repo: Repo, seeds: Seed[], boundary: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>();
  const pnpmSeen = new Set<string>();
  const queue: Seed[] = [...seeds];
  while (queue.length) {
    const { t, k } = queue.pop() as Seed;
    for (const p of invocationEdges(t, k)) {
      if (seen.has(p)) continue;
      seen.add(p);
      if (boundary.has(p)) continue; // category boundary — see header
      try {
        queue.push({ t: readFileSync(join(repo.root, p), "utf8"), k: kindOf(p) });
      } catch {
        /* referenced-but-absent: reported by the enforcement-claim check */
      }
    }
    for (const n of pnpmEdges(t, k)) {
      if (pnpmSeen.has(n) || !repo.pkgScripts[n]) continue;
      pnpmSeen.add(n);
      queue.push({ t: repo.pkgScripts[n], k: "sh" });
      for (const hook of [`pre${n}`, `post${n}`]) {
        if (repo.pkgScripts[hook]) queue.push({ t: repo.pkgScripts[hook], k: "sh" });
      }
    }
  }
  return seen;
}

export interface Liveness {
  required: Set<string>;
  hook: Set<string>;
  nonRequired: Set<string>;
  /** Invoked as a gate somewhere, but NOT reachable from the required check. */
  orphans: { path: string; via: Category[] }[];
}

export function deriveLiveness(repo: Repo): Liveness {
  const boundary = new Set(repo.hookInstallers);
  const gate = requiredGateJob(repo);

  const required = closure(
    repo,
    gate.runs.map((t) => ({ t, k: "sh" as Kind })),
    boundary,
  );

  const nonRequiredSeeds: Seed[] = [];
  for (const j of repo.jobs) {
    if (j.workflow === gate.workflow && j.name === gate.name) continue;
    for (const r of j.runs) nonRequiredSeeds.push({ t: r, k: "sh" });
  }
  const nonRequired = closure(repo, nonRequiredSeeds, boundary);

  // An installer's whole purpose is to wire a script into a hook, so every
  // script path it names counts as installed-and-invoked. Narrower
  // command-position matching misses `chmod +x "$REPO_ROOT/scripts/x.sh"` and
  // heredoc-written `exec`, and reported ZERO hook guards — a false green.
  const hook = new Set<string>();
  const installerSeeds: Seed[] = [];
  for (const inst of repo.hookInstallers) {
    const text = stripComments(readFileSync(join(repo.root, inst), "utf8"), kindOf(inst));
    for (const m of text.matchAll(new RegExp(SCRIPT_PATH_SRC, "g"))) {
      const p = m[1].replace(/^\.\//, "");
      if (p === inst) continue;
      hook.add(p);
      if (existsSync(join(repo.root, p))) {
        installerSeeds.push({ t: readFileSync(join(repo.root, p), "utf8"), k: kindOf(p) });
      }
    }
  }
  for (const p of closure(repo, installerSeeds, new Set())) hook.add(p);
  for (const p of repo.hookInstallers) hook.add(p);

  const orphans = repo.scripts
    .filter((p) => !required.has(p) && (hook.has(p) || nonRequired.has(p)))
    .map((path) => ({
      path,
      via: [
        ...(hook.has(path) ? (["HOOK"] as Category[]) : []),
        ...(nonRequired.has(path) ? (["NONREQUIRED_WORKFLOW"] as Category[]) : []),
      ],
    }));

  return { required, hook, nonRequired, orphans };
}

/* ------------------------------------------------------------------------- */
/* Enforcement claims                                                         */
/* ------------------------------------------------------------------------- */

export interface FalseClaim {
  file: string;
  line: number;
  script: string;
  reason: "MISSING_ENFORCER" | "CLAIMS_CI_BUT_NOT_REQUIRED";
}

const CLAIM_WORD = /\b(?:enforc\w*|assert\w*|guard\w*|gate\w*|check\w*|verif\w*|block\w*|invariant)\b/i;
const CI_WORD = /\b(?:in CI|CI gate|required (?:check|gate)|blocks merge|merge gate)\b/i;

/**
 * A comment that names a concrete `scripts/...` artefact AS an enforcer is a
 * checkable claim, and it is false in two ways: the artefact does not exist, or
 * it exists, the comment says CI, and it is not in the required path.
 */
export function findFalseEnforcementClaims(
  root: string,
  files: string[],
  requiredReachable: ReadonlySet<string>,
): FalseClaim[] {
  const out: FalseClaim[] = [];
  const pathRe = new RegExp(SCRIPT_PATH_SRC, "g");
  for (const f of files) {
    const lines = readFileSync(join(root, f), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*(\/\/|\*|\/\*)/.test(lines[i])) continue; // comment lines only
      const context = lines.slice(Math.max(0, i - 2), i + 3).join(" ");
      if (!CLAIM_WORD.test(context)) continue;
      pathRe.lastIndex = 0;
      for (const m of lines[i].matchAll(pathRe)) {
        const script = m[1].replace(/^\.\//, "");
        if (!existsSync(join(root, script))) {
          out.push({ file: f, line: i + 1, script, reason: "MISSING_ENFORCER" });
        } else if (!requiredReachable.has(script) && CI_WORD.test(context)) {
          out.push({ file: f, line: i + 1, script, reason: "CLAIMS_CI_BUT_NOT_REQUIRED" });
        }
      }
    }
  }
  return out;
}
