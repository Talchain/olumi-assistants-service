#!/usr/bin/env tsx
/**
 * LIVE TIER of the prompt -> consumer conformance gate.
 *
 *   pnpm verify:served-conformance
 *   Env: CEE_BASE_URL (default staging), ADMIN_API_KEY.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE CI GATE. The CI gate judges the EXPORTED
 * SERVED BYTES in `Prompts/canonical/`, identity-pinned by sha256 against the
 * manifest. That pin is a mirror, and THE PROMPT IS RE-PINNABLE IN PMS WITH NO
 * DEPLOY -- so CI alone would happily certify conformance against bytes we have
 * stopped serving. This reads what CEE is ACTUALLY serving and runs the SAME
 * pure checker over it.
 *
 * It is the same relationship `verify-served-prompt.mjs` has with the sanction
 * gate, and it deliberately reuses that script's two hard-won behaviours:
 *
 *   1. SAMPLE REPEATEDLY. Observed live during the v119->v120 re-pin:
 *      consecutive reads returned 119, 120, 119, 120. CEE staging runs multiple
 *      instances with a ~5-minute loader TTL, so for that window the service
 *      genuinely serves TWO DIFFERENT PROMPTS depending on which instance takes
 *      the turn. A single sample cannot tell that apart from settled drift.
 *      A SPLIT READING IS ITS OWN FINDING, reported as such, never as noise.
 *
 *   2. FAIL LOUD, NEVER SKIP. Unreachable, non-200, malformed body, missing
 *      key, missing credential -- every one exits non-zero. A gate that quietly
 *      passes when it cannot see is the defect class this exercise exists to
 *      kill.
 *
 * ⚠ SCOPE, and it is narrower than the CI gate's: this covers the routes in
 * MAPPED_ROUTES. `validate_graph` is live at its shipped default and has NO
 * canonical export, so its served bytes cannot be conformance-checked from this
 * repo at all -- it is reported as UNCHECKABLE rather than counted as clean.
 */

import { MAPPED_ROUTES, UNMAPPED_ROUTES } from '../tests/prompt-contract/conformance/routes.js';
import { checkRoute } from '../tests/prompt-contract/conformance/checker.js';
import { activeWaivers } from '../tests/prompt-contract/conformance/waivers.js';
import { createHash } from 'node:crypto';

const PRODUCTION_HOSTS = ['cee-production.onrender.com'];
const SAMPLES = 3;

interface StatusRow {
  key: string;
  version: number;
  sent_hash?: string;
  content_hash?: string;
  content?: string;
  content_chars?: number;
}

function die(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function readStatus(base: string, adminKey: string): Promise<StatusRow[]> {
  let res: Response;
  try {
    res = await fetch(`${base}/admin/prompts/status`, {
      headers: { 'X-Admin-Key': adminKey },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    die(`could not reach ${base}/admin/prompts/status: ${(e as Error).message}. Not skipping.`);
  }
  if (!res.ok) die(`${base}/admin/prompts/status returned HTTP ${res.status}`);
  const body = (await res.json()) as { keys?: StatusRow[] };
  if (!Array.isArray(body.keys)) die('status body carries no `keys` array');
  return body.keys;
}

/**
 * A SCHEDULER THAT STOPPED LOOKS EXACTLY LIKE ONE THAT FOUND NOTHING.
 *
 * MEASURED at this tip, with a contrast control: `served-prompt-drift.yml`
 * returns 404 on `main` and sha 1ec6be7a on `staging`, while
 * `cee-diagnostics.yml` resolves on `main` in the same run -- so the probe
 * discriminates. The repo's default branch is `main`, and GitHub fires
 * `schedule:` ONLY from the default branch. Its run history is 5
 * workflow_dispatch + 3 push and ZERO schedule events, across its whole life.
 *
 * The workflow's own header claims "It now lives on `main` too". It does not.
 * The commit titled "make the served-prompt-drift cron able to fire" landed on
 * `staging` -- precisely the branch from which it cannot.
 *
 * This matters more than any single conformance verdict: a PMS re-pin needs no
 * deploy, so the cron is the ONLY mechanism that could notice one, and it has
 * never run unattended. Reported, never silently tolerated.
 */
async function reportSchedulerReachability(): Promise<void> {
  const repo = 'Talchain/olumi-assistants-service';
  const wf = '.github/workflows/served-prompt-drift.yml';
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    console.warn(
      'SCHEDULER REACHABILITY: NOT MEASURED (no GITHUB_TOKEN). Not asserting it is fine — ' +
        'as of the last derivation the drift cron could not fire at all.',
    );
    return;
  }
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  try {
    const meta = await fetch(`https://api.github.com/repos/${repo}`, { headers: h });
    const branch = ((await meta.json()) as { default_branch?: string }).default_branch;
    const onDefault = await fetch(
      `https://api.github.com/repos/${repo}/contents/${wf}?ref=${branch}`,
      { headers: h },
    );
    if (onDefault.ok) {
      console.log(`OK: served-prompt-drift.yml is present on the default branch (${branch}) — its cron can fire`);
    } else {
      console.error(
        `SCHEDULER UNREACHABLE: ${wf} is HTTP ${onDefault.status} on the default branch ` +
          `(${branch}). GitHub fires \`schedule:\` only from the default branch, so this cron ` +
          `CANNOT run unattended — and a PMS re-pin needs no deploy, so nothing else would ` +
          `notice one. Land the workflow on ${branch}.`,
      );
    }
  } catch (e) {
    console.warn(`SCHEDULER REACHABILITY: could not measure — ${(e as Error).message}`);
  }
}

async function main(): Promise<void> {
  const base = process.env.CEE_BASE_URL ?? 'https://cee-staging.onrender.com';
  if (PRODUCTION_HOSTS.some((h) => base.includes(h))) {
    die(`refusing to run against production (${base}) — staging is the product`);
  }
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) die('ADMIN_API_KEY is not set — cannot read the served prompts. Not skipping.');

  const rounds: StatusRow[][] = [];
  for (let i = 0; i < SAMPLES; i++) rounds.push(await readStatus(base, adminKey));

  let failed = false;
  for (const route of MAPPED_ROUTES) {
    const seen = rounds.map((rows) => {
      const r = rows.find((x) => x.key === route.route);
      return r ? `v${r.version}/${r.sent_hash ?? r.content_hash}` : 'MISSING';
    });
    const distinct = [...new Set(seen)];
    if (distinct.length > 1) {
      failed = true;
      console.error(
        `SPLIT: ${route.route} is NOT CONSISTENT ACROSS INSTANCES — ${distinct.join(', ')}\n` +
          `  Different instances are serving different prompts for this route. Usually a PMS\n` +
          `  re-pin still propagating (loader TTL ~5 min). Re-run to confirm it settles; if it\n` +
          `  persists, the pin did not reach every instance. NOT judging conformance on a mixture.`,
      );
      continue;
    }
    if (distinct[0] === 'MISSING') {
      failed = true;
      console.error(`FAIL: no '${route.route}' row in /admin/prompts/status — the key moved or PMS is degraded`);
      continue;
    }

    const row = rounds[0]!.find((x) => x.key === route.route)!;
    const text = row.content;
    if (typeof text !== 'string' || text.length === 0) {
      // The status surface does not always carry bytes. Say so; do not infer
      // conformance from a version pointer, which is not evidence of content.
      console.warn(
        `UNCHECKABLE: ${route.route} v${row.version} — status carries no prompt CONTENT, only a ` +
          `hash. A version pointer is not evidence of what is served; conformance not judged.`,
      );
      continue;
    }

    const servedSha = createHash('sha256').update(text, 'utf8').digest('hex');
    const found = checkRoute({
      route: route.route,
      promptText: text,
      grammar: route.grammar(),
      additionalText: route.additionalText?.(),
    });
    const waived = new Set(activeWaivers(route.route, servedSha).map((w) => w.id));
    const open = found.filter((v) => !waived.has(v.id));

    if (open.length === 0) {
      console.log(`OK: ${route.route} v${row.version} — served bytes conform (${found.length} waived)`);
    } else {
      failed = true;
      console.error(
        `DIVERGENCE: ${route.route} v${row.version} sha=${servedSha.slice(0, 16)}\n` +
          `  Grammar: ${route.attachSite}\n` +
          open.map((v) => `  [${v.kind}] ${v.detail} (@${v.offset})`).join('\n') +
          `\n  NOTE: if these are waived in waivers.ts, the waivers are keyed to DIFFERENT bytes —\n` +
          `  i.e. the prompt was re-pinned in PMS without a deploy and every waiver has expired.`,
      );
    }
  }

  for (const u of UNMAPPED_ROUTES) {
    console.log(`UNCHECKED (declared): ${u.route} — ${u.reason.split('.')[0]}`);
  }

  await reportSchedulerReachability();
  process.exit(failed ? 1 : 0);
}

await main();
