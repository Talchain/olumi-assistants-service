/**
 * PROMOTION GATE — the GATED-SET SHRINK GUARD (adversarial review of #769, A3).
 *
 * WHY THIS EXISTS
 * ---------------
 * The gate's discovery is derived, which protects the ADD direction: a new pack
 * marker automatically brings its task under the gate. The review proved the
 * REMOVE direction was completely silent, in both of its forms:
 *
 *   1. SHRINK — delete a task's `promotion-pack.ts` marker (or its row in
 *      `Prompts/canonical/manifest.json`) and a GATED_PASS becomes UNGATED (or
 *      vanishes from the table entirely) with `pnpm eval:promotion-gate`
 *      exiting 0. Reproduced verbatim before this guard existed.
 *   2. WIDEN — hand-add an entry to `promotion-gate-baseline.json` and a real
 *      BLOCK (exit 1) becomes a tolerated GRANDFATHERED row (exit 0). The
 *      grandfather ratchet is shrink-only by intent, but nothing checked that
 *      the entry SET had not grown.
 *
 * Both are "the gate quietly stops gating", which reads as green — the exact
 * defect class the gate was built against, one level up.
 *
 * HOW IT IS DERIVED (trap 12 / 12b — never a hand-pinned list)
 * -----------------------------------------------------------
 * The reference is GIT: the merge-base of HEAD and the PR's base branch. Both
 * sides of the comparison are computed the same way from real artifacts —
 * the HEAD side by the gate's OWN loaders (`discoverPacks` / `loadManifestPrompts`
 * / `loadGrandfatherBaseline`), the base side by reading the same files out of
 * the git object store at the merge-base. Nothing here is a snapshot a human
 * must remember to update: move the branch and the reference moves with it.
 *
 * The one hand-maintained artifact is the ACKNOWLEDGMENT ledger, and it is
 * deliberately shaped so drift cannot pass through it: it does not describe the
 * gated set, it records DELIBERATE, reasoned removals/widenings. A removal
 * nobody wrote down is a hard error; an acknowledgment that no longer matches a
 * real change is reported as a stale note (loud, non-fatal — a red that fires on
 * every unrelated PR until someone cleans up is a red people learn to ignore,
 * trap 7).
 *
 * FAIL-OPEN, EXACTLY ONCE, LOUDLY, AND ONLY FOR ONE CAUSE: if a base commit
 * RESOLVED and the promotion gate does not exist there (its first landing — this
 * PR), there is nothing to compare against; the guard says so and passes. Every
 * subsequent run has a real reference.
 *
 * ⚠ CORRECTED — this sentence was FALSE as first shipped, and the bug was
 * exactly the one it claimed to have avoided. "No base ref could be resolved"
 * (a shallow checkout: `actions/checkout` defaults to depth 1) was collapsed
 * into the same fail-open, so the guard printed "first landing" and exited 0
 * over a real gated-set shrink. It now FAILS CLOSED on unreadable history —
 * see {@link requireBaseRef}, which carries the reproduction.
 *
 * THREAT MODEL: as with the gate itself (see `types.ts`), this is a DRIFT
 * guard, not an anti-forgery device. A maintainer who writes a false
 * acknowledgment defeats it — but only by committing a visible, attributable,
 * reviewable statement that they are removing a prompt from the gate. That is
 * the whole ask: make it impossible to do SILENTLY.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repo root, from this module's location. */
export const REPO_ROOT = join(HERE, '..', '..', '..', '..');

/** Path (repo-relative, git-style) of the grandfather baseline. */
export const BASELINE_REPO_PATH = 'tools/orchestrator-eval/promotion-gate-baseline.json';
/** Path (repo-relative, git-style) of the acknowledgment ledger. */
export const ACKNOWLEDGMENTS_REPO_PATH = 'tools/orchestrator-eval/promotion-gate-acknowledgments.json';
/** Path (repo-relative, git-style) of the prompt manifest. */
export const MANIFEST_REPO_PATH = 'Prompts/canonical/manifest.json';
/** Where pack markers live, and the marker filename discovery keys on. */
export const PACK_MARKER_SUFFIX = '/promotion-pack.ts';

export const DEFAULT_ACKNOWLEDGMENTS_PATH = join(
  HERE,
  '..',
  '..',
  'promotion-gate-acknowledgments.json',
);

// ============================================================================
// Snapshot: what the gate's SET looked like at one commit (or in the worktree)
// ============================================================================

export interface GateSetSnapshot {
  /**
   * False ⇒ the promotion gate did not exist here at all (no pack markers AND
   * no baseline file). The ONLY fail-open case.
   */
  readonly present: boolean;
  /**
   * The set of tasks that are actually GATED: a task is gated when it has BOTH
   * a pack marker AND a manifest row. Deleting either one removes it from the
   * gate, which is why the guard compares the intersection rather than the pack
   * list alone — the review named both deletions.
   */
  readonly gatedTasks: readonly string[];
  /** Grandfather entries, keyed `task@promotedHash` (the hash matters: a moved
   * hash is a different tolerance, not the same one). */
  readonly baselineEntries: readonly string[];
}

export type AcknowledgmentKind = 'gated_set_removal' | 'baseline_addition';

export interface Acknowledgment {
  readonly kind: AcknowledgmentKind;
  readonly task: string;
  /** Required for `baseline_addition` — the exact hash being tolerated. */
  readonly promotedHash?: string;
  readonly reason: string;
  readonly acknowledgedAt: string;
}

export interface ShrinkGuardResult {
  readonly ok: boolean;
  /** Fatal: an unacknowledged shrink or widen. */
  readonly errors: readonly string[];
  /** Non-fatal, but printed: first-landing, tightening, stale acknowledgments. */
  readonly notes: readonly string[];
}

/** `task@hash` key for a baseline entry. */
export function baselineKey(task: string, promotedHash: string): string {
  return `${task}@${promotedHash}`;
}

// ============================================================================
// The pure core — this is what the tests drive
// ============================================================================

/**
 * Compare the gate's SET at the merge-base against the SET at HEAD.
 *
 * FATAL:
 *   - a task that was gated at the merge-base and is not gated at HEAD, with no
 *     matching `gated_set_removal` acknowledgment;
 *   - a grandfather entry present at HEAD and absent at the merge-base, with no
 *     matching `baseline_addition` acknowledgment (task AND hash).
 *
 * NOT fatal (the ratchet tightening, reported so it is visible):
 *   - newly gated tasks; removed baseline entries.
 */
export function checkGatedSetShrink(
  base: GateSetSnapshot,
  head: GateSetSnapshot,
  acks: readonly Acknowledgment[],
): ShrinkGuardResult {
  const errors: string[] = [];
  const notes: string[] = [];

  if (!base.present) {
    notes.push(
      'FAIL-OPEN (once, deliberately): the promotion gate does not exist at the merge-base — no pack ' +
        'markers and no grandfather baseline. This is its first landing, so there is no prior set to ' +
        'shrink. Every later run compares against a real reference.',
    );
    return { ok: true, errors, notes };
  }

  const headGated = new Set(head.gatedTasks);
  const baseGated = new Set(base.gatedTasks);
  const headEntries = new Set(head.baselineEntries);
  const baseEntries = new Set(base.baselineEntries);

  const usedAcks = new Set<Acknowledgment>();

  // --- direction 1: the gated set may not SHRINK unacknowledged ------------
  const removed = [...baseGated].filter((t) => !headGated.has(t)).sort();
  for (const task of removed) {
    const ack = acks.find((a) => a.kind === 'gated_set_removal' && a.task === task);
    if (ack) {
      usedAcks.add(ack);
      notes.push(`ACKNOWLEDGED removal from the gated set: "${task}" — ${ack.reason} (${ack.acknowledgedAt})`);
      continue;
    }
    errors.push(
      `GATED-SET SHRINK: "${task}" was gated at the merge-base and is NOT gated at HEAD. Either its ` +
        `promotion-pack marker or its ${MANIFEST_REPO_PATH} row was removed, which silently drops the ` +
        'prompt out of the gate. If this is deliberate, record it in ' +
        `${ACKNOWLEDGMENTS_REPO_PATH} as ` +
        `{"kind":"gated_set_removal","task":"${task}","reason":"…","acknowledgedAt":"…"}.`,
    );
  }

  // --- direction 2: the grandfather baseline may not WIDEN unacknowledged --
  const added = [...headEntries].filter((k) => !baseEntries.has(k)).sort();
  for (const key of added) {
    const atIdx = key.lastIndexOf('@');
    const task = key.slice(0, atIdx);
    const hash = key.slice(atIdx + 1);
    const ack = acks.find(
      (a) => a.kind === 'baseline_addition' && a.task === task && a.promotedHash === hash,
    );
    if (ack) {
      usedAcks.add(ack);
      notes.push(`ACKNOWLEDGED grandfather addition: ${key} — ${ack.reason} (${ack.acknowledgedAt})`);
      continue;
    }
    errors.push(
      `GRANDFATHER WIDEN: baseline entry ${key} is present at HEAD and absent at the merge-base. ` +
        'Adding an entry converts a real BLOCK into a tolerated row — the gate stops gating that prompt. ' +
        'If this promotion is deliberately shipping un-evalled, record it in ' +
        `${ACKNOWLEDGMENTS_REPO_PATH} as ` +
        `{"kind":"baseline_addition","task":"${task}","promotedHash":"${hash}","reason":"…","acknowledgedAt":"…"}.`,
    );
  }

  // --- tightening + stale acknowledgments: visible, never fatal ------------
  for (const task of [...headGated].filter((t) => !baseGated.has(t)).sort()) {
    notes.push(`TIGHTENED: "${task}" is newly gated (a pack marker + manifest row now exist).`);
  }
  for (const key of [...baseEntries].filter((k) => !headEntries.has(k)).sort()) {
    notes.push(`TIGHTENED: grandfather entry ${key} removed — the ratchet shrank.`);
  }
  for (const ack of acks) {
    if (usedAcks.has(ack)) continue;
    notes.push(
      `STALE ACKNOWLEDGMENT (no matching change in this diff): ${ack.kind} for "${ack.task}"` +
        `${ack.promotedHash ? `@${ack.promotedHash}` : ''}. Remove it once it has landed — a ledger of ` +
        'expired acknowledgments pre-authorises future removals.',
    );
  }

  return { ok: errors.length === 0, errors, notes };
}

// ============================================================================
// Deriving a snapshot from git
// ============================================================================

function git(args: readonly string[], cwd: string = REPO_ROOT): string {
  // stderr is swallowed on purpose: `git show <ref>:<path>` for a path that did
  // not exist at that ref is a NORMAL, expected outcome here (it is how the
  // guard detects "the gate did not exist yet"), and its fatal: line would read
  // as a failure in test output. The exit code is what we branch on.
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function gitOrNull(args: readonly string[], cwd: string = REPO_ROOT): string | null {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

/**
 * Pull the pack's task out of a `promotion-pack.ts` marker's SOURCE. Used only
 * for the historical (merge-base) side, where the module cannot be imported.
 *
 * THROWS when it cannot find one: a marker the extractor silently skipped would
 * shrink the recorded base set, which manufactures a false "nothing was
 * removed". A test pins the extractor against the LIVE `discoverPacks()` result
 * (the positive control — trap 13: an extractor that can see nothing would make
 * every comparison vacuous).
 */
export function extractPackTaskFromMarkerSource(source: string, where: string): string {
  const m = /\btask\s*:\s*['"`]([^'"`]+)['"`]/.exec(source);
  if (!m) {
    throw new Error(
      `promotion-gate shrink-guard: cannot read the pack task out of ${where}. The marker's shape ` +
        'changed; the guard refuses to treat an unreadable marker as an absent pack (that would hide a removal).',
    );
  }
  return m[1];
}

function manifestKeysFromJson(text: string, where: string): string[] {
  const parsed = JSON.parse(text) as { pms_prompts?: unknown };
  const list = Array.isArray(parsed.pms_prompts) ? parsed.pms_prompts : null;
  if (!list) {
    throw new Error(`promotion-gate shrink-guard: ${where} has no "pms_prompts" array.`);
  }
  return list
    .map((p) => (p as { key?: unknown }).key)
    .filter((k): k is string => typeof k === 'string');
}

function baselineKeysFromJson(text: string, where: string): string[] {
  const parsed = JSON.parse(text) as { entries?: unknown };
  const list = Array.isArray(parsed.entries) ? parsed.entries : null;
  if (!list) {
    throw new Error(`promotion-gate shrink-guard: ${where} has no "entries" array.`);
  }
  return list.map((raw) => {
    const e = raw as { task?: unknown; promotedHash?: unknown };
    if (typeof e.task !== 'string' || typeof e.promotedHash !== 'string') {
      throw new Error(`promotion-gate shrink-guard: ${where} has a malformed entry: ${JSON.stringify(raw)}`);
    }
    return baselineKey(e.task, e.promotedHash);
  });
}

/**
 * The one message both no-history paths raise. Hoisted because the guard has
 * TWO ways to meet a checkout it cannot read — the tree at a resolved ref is
 * missing, or no base ref resolves at all — and the second one shipped
 * FAIL-OPEN by mistake (see {@link requireBaseRef}).
 */
export function noHistoryError(detail: string): Error {
  return new Error(
    `promotion-gate shrink-guard: ${detail} The guard needs real git history: in CI the job must ` +
      'check out with `fetch-depth: 0`, because a shallow checkout has no merge-base. It FAILS ' +
      'CLOSED here rather than reporting "first landing" — a guard that no-ops on a shallow clone ' +
      'is the silent escape it exists to prevent.',
  );
}

/** Read the gate's SET as it stood at an arbitrary git ref. */
export function readGateSetSnapshotAtRef(ref: string, cwd: string = REPO_ROOT): GateSetSnapshot {
  const tree = gitOrNull(['ls-tree', '-r', '--name-only', ref], cwd);
  if (tree === null) {
    throw noHistoryError(`cannot list the tree at ${ref}.`);
  }
  const markerPaths = tree
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.endsWith(PACK_MARKER_SUFFIX));

  const baselineText = gitOrNull(['show', `${ref}:${BASELINE_REPO_PATH}`], cwd);

  if (markerPaths.length === 0 && baselineText === null) {
    return { present: false, gatedTasks: [], baselineEntries: [] };
  }

  const packTasks = new Set(
    markerPaths.map((p) => {
      const src = gitOrNull(['show', `${ref}:${p}`], cwd);
      if (src === null) {
        throw new Error(`promotion-gate shrink-guard: cannot read ${p} at ${ref}.`);
      }
      return extractPackTaskFromMarkerSource(src, `${ref}:${p}`);
    }),
  );

  const manifestText = gitOrNull(['show', `${ref}:${MANIFEST_REPO_PATH}`], cwd);
  // A manifest we cannot read while packs DO exist would compute an empty gated
  // set at this ref — and an empty base set hides every shrink from it. Loud,
  // not silent. (With zero packs the manifest cannot change the answer, so it is
  // not required.)
  if (manifestText === null && packTasks.size > 0) {
    throw new Error(
      `promotion-gate shrink-guard: ${packTasks.size} pack marker(s) exist at ${ref} but ` +
        `${MANIFEST_REPO_PATH} cannot be read there. Refusing to derive an EMPTY gated set from a ` +
        'ref whose manifest is missing — an empty base set silently tolerates every removal.',
    );
  }
  const manifestKeys = new Set(
    manifestText === null ? [] : manifestKeysFromJson(manifestText, `${ref}:${MANIFEST_REPO_PATH}`),
  );

  return {
    present: true,
    gatedTasks: [...packTasks].filter((t) => manifestKeys.has(t)).sort(),
    baselineEntries:
      baselineText === null ? [] : baselineKeysFromJson(baselineText, `${ref}:${BASELINE_REPO_PATH}`).sort(),
  };
}

/**
 * Resolve the commit to compare against.
 *
 *   - Pull request (CI): the merge-base of HEAD and `origin/$GITHUB_BASE_REF`.
 *   - Push / local: the merge-base with `origin/staging`; if that IS HEAD (we
 *     are on the base branch), fall back to `HEAD^` so a direct push is still
 *     compared against the previous tip rather than against itself.
 *
 * Returns null when HEAD has no usable ancestor at all: a root commit, or — the
 * case that matters — a SHALLOW checkout, where the grafted HEAD has no parent
 * git can name. `actions/checkout`'s DEFAULT is depth 1, so this is one deleted
 * YAML line away at all times.
 *
 * ⚠ null is NOT "no reference, carry on". Callers must go through
 * {@link requireBaseRef}: a null here means the guard cannot see history, which
 * is indistinguishable from a genuine first landing at the SNAPSHOT level and
 * must therefore be resolved HERE, where the two causes are still separable.
 */
export function resolveBaseRef(cwd: string = REPO_ROOT, env: NodeJS.ProcessEnv = process.env): string | null {
  const head = gitOrNull(['rev-parse', 'HEAD'], cwd)?.trim();
  if (!head) {
    throw new Error(
      'promotion-gate shrink-guard: `git rev-parse HEAD` failed — the guard needs real git history ' +
        '(CI: `fetch-depth: 0`). It refuses to pass on a repo it cannot read (that would be the ' +
        'silent-escape it exists to prevent).',
    );
  }
  const candidates: string[] = [];
  if (env.GITHUB_BASE_REF) candidates.push(`origin/${env.GITHUB_BASE_REF}`, env.GITHUB_BASE_REF);
  candidates.push('origin/staging', 'staging');

  for (const c of candidates) {
    if (gitOrNull(['rev-parse', '--verify', `${c}^{commit}`], cwd) === null) continue;
    const mb = gitOrNull(['merge-base', 'HEAD', c], cwd)?.trim();
    if (!mb) continue;
    if (mb !== head) return mb;
    // HEAD is (an ancestor of / equal to) the base tip: compare with its parent.
    const parent = gitOrNull(['rev-parse', '--verify', 'HEAD^{commit}^'], cwd)?.trim();
    return parent ?? null;
  }
  const parent = gitOrNull(['rev-parse', '--verify', 'HEAD^{commit}^'], cwd)?.trim();
  return parent ?? null;
}

/**
 * Resolve the base ref, or FAIL CLOSED.
 *
 * ⚠ THIS FUNCTION EXISTS BECAUSE ITS ABSENCE WAS A REAL DEFECT, not as belt and
 * braces. The first cut of the CLI collapsed `resolveBaseRef() === null` into
 * `{present: false}`, which is the snapshot shape for "the gate did not exist at
 * the merge-base" — so a depth-1 checkout (the `actions/checkout` DEFAULT)
 * printed the reassuring FAIL-OPEN "first landing" note and exited 0 **with a
 * real gated-set shrink in the tree**. Reproduced end-to-end: a commit that
 * dropped `decision_review` out of the gated set PASSED. Deleting one line from
 * ci.yml disabled the entire guard, silently — the exact failure mode the guard
 * was built to make impossible.
 *
 * The fail-open is now reserved for its ONE intended case: a base ref that
 * RESOLVED and genuinely carries no gate. "I cannot see history" and "there was
 * nothing there" are different answers and must never share a code path.
 *
 * This is also what makes `fetch-depth: 0` self-enforcing rather than a comment
 * somebody has to honour: drop it and the required CI job goes RED here.
 */
export function requireBaseRef(cwd: string = REPO_ROOT, env: NodeJS.ProcessEnv = process.env): string {
  const ref = resolveBaseRef(cwd, env);
  if (ref === null) {
    throw noHistoryError(
      'no base commit could be resolved — neither a merge-base with the base branch nor a parent of HEAD.',
    );
  }
  return ref;
}

// ============================================================================
// The acknowledgment ledger
// ============================================================================

const ACK_KINDS: readonly AcknowledgmentKind[] = ['gated_set_removal', 'baseline_addition'];

/** Load the ledger. Absent file ⇒ no acknowledgments (so every removal is fatal
 * — the safe direction). Malformed ⇒ throw, never silently empty. */
export function loadAcknowledgments(path: string = DEFAULT_ACKNOWLEDGMENTS_PATH): Acknowledgment[] {
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new Error(
      `promotion-gate shrink-guard: ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const root = parsed as { acknowledgments?: unknown } | null;
  const list = root && Array.isArray(root.acknowledgments) ? root.acknowledgments : null;
  if (!list) {
    throw new Error(`promotion-gate shrink-guard: ${path} has no "acknowledgments" array.`);
  }
  return list.map((raw, i) => {
    const a = raw as Record<string, unknown>;
    if (
      a === null ||
      typeof a !== 'object' ||
      typeof a.kind !== 'string' ||
      !(ACK_KINDS as readonly string[]).includes(a.kind) ||
      typeof a.task !== 'string' ||
      typeof a.reason !== 'string' ||
      typeof a.acknowledgedAt !== 'string' ||
      (a.kind === 'baseline_addition' && typeof a.promotedHash !== 'string')
    ) {
      throw new Error(
        `promotion-gate shrink-guard: ${path} acknowledgments[${i}] is malformed (need ` +
          `{kind:${ACK_KINDS.join('|')}, task, reason, acknowledgedAt} — plus promotedHash for a baseline_addition): ` +
          JSON.stringify(raw),
      );
    }
    return {
      kind: a.kind as AcknowledgmentKind,
      task: a.task,
      promotedHash: typeof a.promotedHash === 'string' ? a.promotedHash : undefined,
      reason: a.reason,
      acknowledgedAt: a.acknowledgedAt,
    };
  });
}

// ============================================================================
// Rendering
// ============================================================================

export function renderShrinkGuardResult(base: string | null, result: ShrinkGuardResult): string {
  const lines: string[] = [];
  lines.push('# Promotion-gate SHRINK GUARD');
  lines.push('');
  lines.push(`Reference (merge-base): ${base ?? '(none — no ancestor)'}`);
  lines.push(result.ok ? '**PASS** — the gated set did not shrink and the grandfather baseline did not widen.' : '**FAIL** — the gate quietly stopped gating something (see below).');
  if (result.notes.length > 0) {
    lines.push('');
    for (const n of result.notes) lines.push(`- note: ${n}`);
  }
  if (result.errors.length > 0) {
    lines.push('');
    lines.push('## Unacknowledged shrink / widen (fatal)');
    for (const e of result.errors) lines.push(`- ${e}`);
  }
  return lines.join('\n') + '\n';
}
