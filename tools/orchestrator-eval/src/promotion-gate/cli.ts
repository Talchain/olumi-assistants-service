/**
 * PROMOTION GATE — CLI entrypoint (the CI check).
 *
 *   pnpm eval:promotion-gate
 *
 * Loads the git source-of-truth (manifest + discovered packs + committed
 * promotion reports + the grandfather baseline), computes the gate, applies the
 * ratchet, prints the table, and EXITS NON-ZERO on any un-grandfathered block or
 * baseline drift — so CI cannot ignore it. Wired into the required
 * "Lint, TypeCheck, Unit Tests" job (`.github/workflows/ci.yml`).
 *
 * Everything it needs is committed; it makes ZERO network / LLM calls.
 */

import { loadManifestPrompts } from './manifest.js';
import { discoverPacks } from './packs.js';
import { loadPromotionReports } from './reports.js';
import { loadGrandfatherBaseline } from './baseline.js';
import { computePromotionGate, DEFAULT_MAX_REPORT_AGE_DAYS, DEFAULT_MAX_FUTURE_SKEW_DAYS } from './gate.js';
import { applyGrandfather } from './grandfather.js';
import { renderGateResult } from './render.js';

async function main(): Promise<number> {
  const manifest = loadManifestPrompts();
  const packs = await discoverPacks();
  const reports = loadPromotionReports();
  const baseline = loadGrandfatherBaseline();

  const gate = computePromotionGate(manifest, packs, reports, {
    now: new Date(),
    maxReportAgeDays: DEFAULT_MAX_REPORT_AGE_DAYS,
    maxFutureSkewDays: DEFAULT_MAX_FUTURE_SKEW_DAYS,
  });
  const result = applyGrandfather(gate, baseline);

  process.stdout.write(renderGateResult(result));

  if (!result.ok) {
    process.stderr.write(
      '\npromotion-gate: BLOCKED. A prompt with an eval pack was promoted without a committed, ' +
        'in-date, hash-matched, PASSING eval report. Commit the report (or, for a deliberate ' +
        'pre-gate promotion, add a grandfather baseline entry ON PURPOSE).\n',
    );
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`promotion-gate: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
