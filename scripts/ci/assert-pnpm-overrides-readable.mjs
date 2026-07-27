#!/usr/bin/env node
/**
 * Assert that pnpm's dependency `overrides` live where the pnpm that actually
 * INSTALLS can read them.
 *
 * WHY THIS EXISTS — the failure mode reads as GREEN.
 * pnpm <10 reads overrides from `package.json` (`pnpm.overrides`).
 * pnpm >=10 reads them from `pnpm-workspace.yaml` (top-level `overrides:`) and
 * IGNORES the `package.json` field, emitting only a [WARN]. So the day an
 * install job is bumped to pnpm 11 while the overrides still sit in
 * package.json, every override — including the security floors pinned here —
 * stops applying, with no error and no failing step. The lockfile would be
 * regenerated without them and nothing would go red.
 *
 * This script makes that transition go RED instead. It DERIVES both halves —
 * where the overrides live, and which pnpm each installing job runs — from the
 * actual files. Nothing here is a hand-maintained list of jobs or versions, so
 * it cannot drift out of sync with the workflows the way a checklist would.
 *
 * It fails when:
 *   1. Overrides are in BOTH locations (a mirror; the two copies will drift).
 *   2. Overrides are in NEITHER location (they have been lost outright).
 *   3. Any job that runs `pnpm install` uses a pnpm major that cannot read the
 *      location the overrides are actually in — in EITHER direction.
 *   4. Any job that runs `pnpm install` does not pin its pnpm version, so its
 *      major cannot be proven at all.
 *
 * Run: node scripts/ci/assert-pnpm-overrides-readable.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

const WORKFLOW_DIR = '.github/workflows';

/** pnpm majors >= this read overrides from pnpm-workspace.yaml, not package.json. */
const WORKSPACE_SETTINGS_MAJOR = 10;

const PKG_LOCATION = 'package.json (pnpm.overrides)';
const WS_LOCATION = 'pnpm-workspace.yaml (overrides:)';

const errors = [];

// ---------------------------------------------------------------------------
// 1. Derive WHERE the overrides live.
// ---------------------------------------------------------------------------
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const workspace = parse(readFileSync('pnpm-workspace.yaml', 'utf8')) ?? {};

const pkgOverrides = pkg?.pnpm?.overrides ?? null;
const wsOverrides = workspace?.overrides ?? null;
const pkgCount = pkgOverrides ? Object.keys(pkgOverrides).length : 0;
const wsCount = wsOverrides ? Object.keys(wsOverrides).length : 0;

let location = null;
if (pkgCount > 0 && wsCount > 0) {
  errors.push(
    `Overrides are declared in BOTH locations (${pkgCount} in package.json, ${wsCount} in ` +
      `pnpm-workspace.yaml). Keep exactly one. Two copies are a hand-maintained mirror: they ` +
      `will drift, and the drift is silent because whichever copy the running pnpm ignores ` +
      `produces no error.`,
  );
} else if (pkgCount === 0 && wsCount === 0) {
  errors.push(
    'No pnpm overrides found in EITHER package.json or pnpm-workspace.yaml. This repo pins ' +
      'security floors through overrides; if they were intentionally retired, delete this ' +
      'check in the same commit. Otherwise they have been lost.',
  );
} else {
  location = pkgCount > 0 ? 'package.json' : 'pnpm-workspace.yaml';
}

// ---------------------------------------------------------------------------
// 2. Derive WHICH pnpm each installing job runs, straight from the workflows.
// ---------------------------------------------------------------------------
/** @returns {{file: string, job: string, major: number|null, raw: string|null}[]} */
function findInstallingJobs() {
  const found = [];
  const files = readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

  for (const file of files) {
    let doc;
    try {
      doc = parse(readFileSync(join(WORKFLOW_DIR, file), 'utf8'));
    } catch (err) {
      errors.push(`Could not parse ${WORKFLOW_DIR}/${file}: ${err.message}`);
      continue;
    }
    for (const [jobId, job] of Object.entries(doc?.jobs ?? {})) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];

      // A step that actually installs. `pnpm install` / `pnpm i`, ignoring
      // commented-out lines so a workflow that documents "no install on
      // purpose" is not miscounted as installing.
      const installs = steps.some((s) => {
        if (typeof s?.run !== 'string') return false;
        return s.run
          .split('\n')
          .filter((line) => !line.trim().startsWith('#'))
          .some((line) => /(^|\s)pnpm\s+(install|i)(\s|$)/.test(line));
      });
      if (!installs) continue;

      const setup = steps.find(
        (s) => typeof s?.uses === 'string' && s.uses.startsWith('pnpm/action-setup'),
      );
      const raw = setup?.with?.version ?? null;
      const major = raw === null ? null : Number.parseInt(String(raw).replace(/^\D*/, ''), 10);
      found.push({ file, job: jobId, major: Number.isNaN(major) ? null : major, raw });
    }
  }
  return found;
}

const installingJobs = findInstallingJobs();

if (installingJobs.length === 0) {
  errors.push(
    `No job running \`pnpm install\` was found under ${WORKFLOW_DIR}. This check proves the ` +
      'overrides are readable by the installing pnpm; with nothing installing it would pass ' +
      'vacuously, so it fails instead. If installs genuinely moved elsewhere, update this script.',
  );
}

// ---------------------------------------------------------------------------
// 3. Cross-check: can each installing pnpm read the location in use?
// ---------------------------------------------------------------------------
if (location !== null) {
  for (const { file, job, major, raw } of installingJobs) {
    if (major === null) {
      errors.push(
        `${file} job "${job}" runs \`pnpm install\` without pinning a pnpm version ` +
          `(no \`pnpm/action-setup\` \`with.version\`${raw === null ? '' : `, got "${raw}"`}). ` +
          'Its pnpm major cannot be proven, so neither can the overrides being applied. Pin it.',
      );
      continue;
    }
    const readsWorkspace = major >= WORKSPACE_SETTINGS_MAJOR;
    if (location === 'package.json' && readsWorkspace) {
      errors.push(
        `${file} job "${job}" installs with pnpm ${major}, but the ${pkgCount} overrides live in ` +
          `${PKG_LOCATION}. pnpm >=${WORKSPACE_SETTINGS_MAJOR} does NOT read that field — it ` +
          'would log a [WARN] and install with NO overrides at all, silently dropping every ' +
          `security floor. Move them to ${WS_LOCATION} in the same change that bumps this job.`,
      );
    } else if (location === 'pnpm-workspace.yaml' && !readsWorkspace) {
      errors.push(
        `${file} job "${job}" installs with pnpm ${major}, but the ${wsCount} overrides live in ` +
          `${WS_LOCATION}. pnpm <${WORKSPACE_SETTINGS_MAJOR} does NOT read that key — a ` +
          '`--frozen-lockfile` install fails with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH. Bump this ' +
          `job to pnpm >=${WORKSPACE_SETTINGS_MAJOR}, or move the overrides back to ${PKG_LOCATION}.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Report.
// ---------------------------------------------------------------------------
if (errors.length > 0) {
  for (const e of errors) console.error(`::error::${e}`);
  console.error(`\npnpm-overrides location check FAILED (${errors.length} problem(s)).`);
  process.exit(1);
}

const majors = [...new Set(installingJobs.map((j) => j.major))].sort((a, b) => a - b);
const count = location === 'package.json' ? pkgCount : wsCount;
console.log(
  `OK: ${count} overrides in ${location === 'package.json' ? PKG_LOCATION : WS_LOCATION}; ` +
    `all ${installingJobs.length} installing job(s) run pnpm ${majors.join('/')} and read that location.`,
);
