#!/usr/bin/env node
/**
 * Config-manifest writer (conversation-harness v0).
 *
 * Snapshots, per run, the configuration surface a failure later needs to be
 * localized against:
 *   - served prompt identity from GET <cee>/admin/prompts/status — TRUST
 *     sent_hash ONLY (prompt_version lied as "v40" pre-#374; the hash is the
 *     on-wire truth). version/source are recorded as advisory context.
 *   - deploy SHAs: CEE /healthz (`build`), PLoT /health, ISL /health
 *     (`build_full`). Health PATHS differ per service — a naive /healthz sweep
 *     silently fails on PLoT.
 *   - relevant env-flag states from a flags env file (e.g. the arm's
 *     staging-parity.env). Only whitelisted-prefix, non-secret-shaped keys are
 *     embedded; *_KEY/*_TOKEN/*_SECRET/*_PASSWORD and long-opaque values are
 *     always dropped.
 *
 * CLI: node config-manifest.mjs --cee <base> [--plot <base>] [--isl <base>]
 *        [--flags-env <file>] [--out manifest.json]
 * Admin key: CEE_ADMIN_KEY env, else common names from STAGING_ENV_FILE.
 * Module: buildConfigManifest(opts)
 */
import { writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnvFile } from './l0-snapshot.mjs';

const DEFAULT_PLOT = 'https://plot-lite-service-staging.onrender.com';
const DEFAULT_ISL = 'https://isl-staging.onrender.com';
const FLAG_PREFIXES = /^(CEE_|ENABLE_|PROMPTS_|ORCHESTRATOR_|V5_|DSK_|GROUNDING_|ISL_|ROUTE_|SSE_|DRAFT_|RESEARCH_|CRITIQUE_|BIL_|MOE_|LOG_LEVEL|NODE_ENV)/;
const SECRET_KEY = /(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS?)$/i;
const SECRET_VALUE = /^[A-Za-z0-9+/_-]{40,}$/; // long opaque blob — never embed

async function getJson(url, headers = {}) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    const body = await res.text();
    if (!res.ok) return { __error: `${res.status} ${body.slice(0, 200)}` };
    try {
      return JSON.parse(body);
    } catch {
      return { __error: `non-JSON body: ${body.slice(0, 120)}` };
    }
  } catch (err) {
    return { __error: String(err).slice(0, 200) };
  }
}

function findAdminKey() {
  if (process.env.CEE_ADMIN_KEY) return process.env.CEE_ADMIN_KEY;
  const envFile = process.env.STAGING_ENV_FILE
    ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../.env.staging.local');
  if (!existsSync(envFile)) return null;
  const env = parseEnvFile(envFile);
  for (const name of ['ADMIN_API_KEY', 'CEE_ADMIN_KEY', 'ADMIN_KEY', 'X_ADMIN_KEY']) {
    if (env[name]) return env[name];
  }
  return null;
}

export async function buildConfigManifest({ ceeBase, plotBase, islBase, flagsEnvFile } = {}) {
  if (!ceeBase) throw new Error('buildConfigManifest: ceeBase required');
  const cee = ceeBase.replace(/\/$/, '');

  const [ceeHealth, plotHealth, islHealth] = await Promise.all([
    getJson(`${cee}/healthz`),
    getJson(`${(plotBase ?? DEFAULT_PLOT).replace(/\/$/, '')}/health`),
    getJson(`${(islBase ?? DEFAULT_ISL).replace(/\/$/, '')}/health`),
  ]);

  // Served prompt identity — sent_hash is the only trustworthy field.
  let prompts;
  const adminKey = findAdminKey();
  if (!adminKey) {
    prompts = { __error: 'no admin key available (set CEE_ADMIN_KEY or STAGING_ENV_FILE)' };
  } else {
    const status = await getJson(`${cee}/admin/prompts/status`, { 'X-Admin-Key': adminKey });
    if (status.__error) {
      prompts = status;
    } else {
      // Response shape (src/routes/admin.prompts.status.ts): { keys: PromptKeyStatus[] }
      // with rows { key, source, version, content_hash, content_chars, error?,
      // pms_task?, sent_hash? (routing row only) }.
      prompts = {};
      const rows = Array.isArray(status.keys) ? status.keys : Array.isArray(status) ? status : [];
      if (rows.length === 0) prompts.__error = `unrecognized status shape: ${JSON.stringify(status).slice(0, 120)}`;
      for (const row of rows) {
        if (!row || typeof row !== 'object' || !row.key) continue;
        prompts[row.key] = {
          sent_hash: row.sent_hash ?? null, // authoritative (routing row)
          content_hash: row.content_hash ?? null, // advisory
          version: row.version ?? null, // advisory — known to lie pre-#374
          source: row.source ?? null,
          pms_task: row.pms_task ?? null,
          error: row.error ?? null,
        };
      }
    }
  }

  let flags = null;
  if (flagsEnvFile && existsSync(flagsEnvFile)) {
    flags = {};
    for (const [k, v] of Object.entries(parseEnvFile(flagsEnvFile))) {
      if (!FLAG_PREFIXES.test(k) || SECRET_KEY.test(k) || SECRET_VALUE.test(v)) continue;
      flags[k] = v;
    }
  }

  return {
    captured_at: new Date().toISOString(),
    cee: { base: cee, health: ceeHealth, deploy_sha: ceeHealth?.build ?? null, prompts },
    plot: { base: plotBase ?? DEFAULT_PLOT, health: plotHealth },
    isl: { base: islBase ?? DEFAULT_ISL, health: islHealth, deploy_sha: islHealth?.build_full ?? null },
    flags,
    flags_source: flagsEnvFile ?? null,
  };
}

// CLI wrapper
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.cee) {
    console.error('usage: node config-manifest.mjs --cee <base> [--plot <base>] [--isl <base>] [--flags-env <file>] [--out <file>]');
    process.exit(1);
  }
  const manifest = await buildConfigManifest({
    ceeBase: args.cee,
    plotBase: args.plot,
    islBase: args.isl,
    flagsEnvFile: args['flags-env'],
  });
  const json = JSON.stringify(manifest, null, 2);
  if (args.out) writeFileSync(args.out, json);
  else console.log(json);
}
