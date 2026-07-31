/**
 * PROMOTION-GATE SHRINK GUARD — CLI entrypoint (the CI check).
 *
 *   pnpm eval:promotion-gate:shrink-guard
 *
 * Runs alongside `eval:promotion-gate` in the required "Lint, TypeCheck, Unit
 * Tests" job. The gate answers "may this promotion land?"; this answers the
 * question the gate structurally cannot: "is the gate still gating what it
 * gated yesterday?" — see `shrink-guard.ts` for the two silent escapes it
 * closes.
 *
 * It is a SEPARATE step on purpose. The gate is hermetic over committed files;
 * this one reads git history, so keeping them apart keeps the gate's
 * hermeticity claim honest and makes the failure attributable to the right
 * cause. CI needs `fetch-depth: 0` for the merge-base to exist.
 */

import { discoverPacks } from './packs.js';
import { loadManifestPrompts } from './manifest.js';
import { loadGrandfatherBaseline } from './baseline.js';
import {
  baselineKey,
  checkGatedSetShrink,
  loadAcknowledgments,
  readGateSetSnapshotAtRef,
  renderShrinkGuardResult,
  type GateSetSnapshot,
} from './shrink-guard.js';
import { resolveBaseRef } from './shrink-guard.js';

/** The HEAD side is read through the gate's OWN loaders — the authoritative
 * answer to "what is gated right now", not a second implementation of it. */
async function headSnapshot(): Promise<GateSetSnapshot> {
  const manifestKeys = new Set(loadManifestPrompts().map((e) => e.task));
  const packTasks = (await discoverPacks()).map((p) => p.task);
  return {
    present: true,
    gatedTasks: packTasks.filter((t) => manifestKeys.has(t)).sort(),
    baselineEntries: loadGrandfatherBaseline().map((e) => baselineKey(e.task, e.promotedHash)).sort(),
  };
}

async function main(): Promise<number> {
  const baseRef = resolveBaseRef();
  const base: GateSetSnapshot = baseRef
    ? readGateSetSnapshotAtRef(baseRef)
    : { present: false, gatedTasks: [], baselineEntries: [] };
  const head = await headSnapshot();
  const result = checkGatedSetShrink(base, head, loadAcknowledgments());

  process.stdout.write(renderShrinkGuardResult(baseRef, result));
  process.stdout.write(
    `\nbase gated set: [${base.gatedTasks.join(', ')}] · head gated set: [${head.gatedTasks.join(', ')}]\n` +
      `base grandfather entries: [${base.baselineEntries.join(', ')}] · head: [${head.baselineEntries.join(', ')}]\n`,
  );

  if (!result.ok) {
    process.stderr.write(
      '\npromotion-gate shrink-guard: BLOCKED. Something dropped out of the gate, or the grandfather ' +
        'baseline grew, without an explicit acknowledgment in this diff.\n',
    );
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(
      `promotion-gate shrink-guard: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(1);
  },
);
