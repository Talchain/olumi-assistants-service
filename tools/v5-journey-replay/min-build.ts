/**
 * Minimum-build gate for the v5 journey replay harness.
 *
 * The new coaching / provenance / recovery / output-safety assertions all
 * depend on commit `a555cf7` (`feat(cee): expose coaching + per-node/edge
 * provenance on /assist/v1/draft-graph`) being live on the deploy. Earlier
 * builds will simply not produce coaching or provenance fields, so the
 * assertions would either spuriously warn forever or hard-fail on every run.
 *
 * Implementation: shell out to `git merge-base --is-ancestor <minSha> <healthzBuild>`
 * locally. If the local repo has fetched the staging commit, this is exact
 * and accurate. If git fails (no repo, unknown commit, exec error), fall
 * back to exact-equality and warn that ancestry could not be verified.
 *
 * Localhost runs skip the gate entirely (local builds use arbitrary SHAs and
 * the developer is iterating). The gate is overridable via the existing
 * `OLUMI_REPLAY_ALLOW_STALE_DEPLOY=true` env var so operators can intentionally
 * exercise an older deploy.
 */

import { execSync } from 'node:child_process';

import { isLocalHost } from './localhost.js';

export const DEFAULT_MIN_BUILD_SHA = 'a555cf7';

export interface MinBuildVerdict {
  readonly halt: boolean;
  readonly reason?: string;
  readonly note?: string;
}

function isStaleDeployOverrideEnabled(): boolean {
  const raw = (process.env.OLUMI_REPLAY_ALLOW_STALE_DEPLOY ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/**
 * Decide whether the deploy at `healthzBuild` is at-or-after `minSha`.
 *
 * Localhost bypass and override env var match the existing deploy gate
 * conventions in `index.ts`.
 *
 * `execSyncImpl` is injectable for unit testing. Production callers should
 * leave it undefined so the real `node:child_process` execSync is used.
 */
export function evaluateMinBuildGate(
  baseUrl: string,
  healthzBuild: string | undefined,
  minSha: string = DEFAULT_MIN_BUILD_SHA,
  execSyncImpl: typeof execSync = execSync,
  expectedBuild?: string,
): MinBuildVerdict {
  // Local runs skip the gate.
  try {
    if (isLocalHost(baseUrl)) {
      return { halt: false, note: 'localhost — min-build gate skipped' };
    }
  } catch {
    // Invalid URL — let the upstream deploy gate / fetch error handle it.
    return { halt: false };
  }

  if (healthzBuild === undefined || healthzBuild.length === 0) {
    if (isStaleDeployOverrideEnabled()) {
      return { halt: false, note: 'no healthz build but override active' };
    }
    return {
      halt: true,
      reason:
        '/healthz returned no build field — cannot verify min-build ancestry. ' +
        'Set OLUMI_REPLAY_ALLOW_STALE_DEPLOY=true to override.',
    };
  }

  // Exact match short-circuit: the deploy is exactly the minimum.
  if (healthzBuild === minSha || healthzBuild.startsWith(minSha) || minSha.startsWith(healthzBuild)) {
    return { halt: false, note: `build ${healthzBuild} matches min-build ${minSha} exactly` };
  }

  // Try local git ancestry. `git merge-base --is-ancestor A B` exits 0 when
  // A is an ancestor of (or equal to) B, exit 1 otherwise. Other exit codes
  // indicate execution failure (no repo, unfetched commit, etc.).
  try {
    execSyncImpl(`git merge-base --is-ancestor ${minSha} ${healthzBuild}`, {
      stdio: 'ignore',
    });
    // exit 0 → minSha IS an ancestor of healthzBuild → deploy is at or after.
    return {
      halt: false,
      note: `git ancestry confirmed: ${minSha} is an ancestor of ${healthzBuild}`,
    };
  } catch (err) {
    // Distinguish "explicit not-an-ancestor" (exit 1) from "git failed to
    // run at all" (ENOENT, no repo, unknown commit, etc.). execSync throws
    // on any non-zero status; the thrown error has `status` set when the
    // process ran but exited non-zero.
    const status = (err as { status?: number } | null)?.status;
    if (status === 1) {
      // Definitive negative: deploy is older than minSha.
      if (isStaleDeployOverrideEnabled()) {
        return {
          halt: false,
          note: `git ancestry rejected (${minSha} not in ${healthzBuild}) but override active`,
        };
      }
      return {
        halt: true,
        reason:
          `min-build gate failed: deploy build ${healthzBuild} is older than required minimum ${minSha}. ` +
          'Coaching / provenance / recovery assertions would produce spurious results. ' +
          'Set OLUMI_REPLAY_ALLOW_STALE_DEPLOY=true to override.',
      };
    }

    // Indeterminate: git could not run, or didn't have the commit fetched.
    // Tightened policy: refuse to pass permissively. Proceed only when
    //   (a) operator opted in via OLUMI_REPLAY_ALLOW_STALE_DEPLOY=true, OR
    //   (b) `--expected-build` matches healthzBuild exactly — i.e. the
    //       operator just pushed and is verifying that exact deploy, so
    //       they've consciously confirmed the SHA pin.
    // Otherwise halt and tell the operator how to recover.
    if (isStaleDeployOverrideEnabled()) {
      return {
        halt: false,
        note: `git ancestry indeterminate (${(err as Error).message ?? 'unknown'}) — override active`,
      };
    }
    if (expectedBuild !== undefined && expectedBuild === healthzBuild) {
      return {
        halt: false,
        note:
          `git ancestry indeterminate but --expected-build matches /healthz exactly ` +
          `(${healthzBuild}). Trusting operator-supplied SHA pin.`,
      };
    }
    return {
      halt: true,
      reason:
        `min-build gate: git ancestry could not be verified for ${minSha}…${healthzBuild} ` +
        '(local repo may be shallow or the staging commit not fetched). Refusing to ' +
        'proceed without explicit operator confirmation. Either run `git fetch origin` so ' +
        'ancestry can be checked, pass `--expected-build <healthz_sha>`, or set ' +
        'OLUMI_REPLAY_ALLOW_STALE_DEPLOY=true.',
    };
  }
}
