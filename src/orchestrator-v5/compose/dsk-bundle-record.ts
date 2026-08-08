/**
 * The VERIFIED DSK bundle read — ONE derivation, shared by every wire-provenance
 * resolver.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * `dsk-protocol-record.ts` (ROADMAP 2.490 slice 2) established the doctrine for
 * putting a DSK attribution on the wire: read `data/dsk/v1.json` directly,
 * verify the bundle's own canonical hash, and yield NOTHING rather than an
 * unverified badge. ROADMAP 2.964 needs the CLAIM arm of exactly the same
 * doctrine, and a second copy of "resolve this path, parse it, hash-check it"
 * is the hand-maintained mirror this estate keeps paying for (trap 12): the two
 * copies would drift on the path, on the shape check, or — the one that
 * matters — on whether the hash is verified at all, and the drift would read as
 * green from either side.
 *
 * So the read lives here once and both record modules consume it. This module
 * decides only ONE question: *is there a bundle on disk that passes its own
 * integrity check?* Everything about which objects are eligible for a badge
 * (family, deprecation, title, strength) belongs to the record modules, because
 * those are different questions with different answers per arm.
 *
 * ── WHY IT IS NOT `orchestrator/dsk-loader.ts` ──────────────────────────────
 * Unchanged from the protocol module's reasoning, restated here because this is
 * now the file that makes the choice: that loader is gated on
 * `DSK_ENABLED` / `ENABLE_DSK_V0` and documents itself as "When OFF: all
 * exports are no-ops". Sourcing a user-visible badge from it would make a
 * capability disappear whenever a coaching flag moved — a dark launch by the
 * back door. The BUNDLE is committed data that ships in the image; the
 * *injection of DSK guidance into prompts* is the flag-gated feature, and *what
 * DSK-T-002 is called* is not. This reader is therefore unconditional and adds
 * no flag of its own, and it deliberately does not populate the loader's
 * singleton — doing so would switch `queryDsk` back on as a side effect of
 * rendering a badge.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { verifyDSKHash } from '../../dsk/hash.js';
import type { DSKBundle } from '../../dsk/types.js';
import { log } from '../../utils/telemetry.js';

/**
 * Memoised bundle. `null` = a read was attempted and the bundle is unusable
 * (absent, unparseable, structurally wrong, or failing its own hash); we do not
 * retry on every turn.
 */
let _bundle: DSKBundle | null = null;
let _attempted = false;

/**
 * The committed DSK bundle, or `null` when it cannot be trusted.
 *
 * A badge's entire claim is "this text is the published record's". CEE #830
 * (ROADMAP 2.491) is what happens when that claim is made without the check: an
 * id was validated as EXISTING while the text under it was the model's own
 * prose. Here the check is the bundle's own canonical hash, reusing
 * `verifyDSKHash` rather than re-deriving it. A bundle that fails its own
 * integrity check yields NO provenance at all — fail-closed, always: a missing
 * badge is a lost affordance, a wrong badge is a lie about science.
 */
export function loadVerifiedDskBundle(): DSKBundle | null {
  if (_attempted) return _bundle;
  _attempted = true;

  const filePath = path.resolve(process.cwd(), 'data/dsk/v1.json');
  let bundle: DSKBundle;
  try {
    bundle = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DSKBundle;
  } catch (err) {
    log.warn(
      { resolved_path: filePath, error: (err as Error).message },
      'DSK bundle unavailable — wire provenance will be withheld',
    );
    return null;
  }

  if (!Array.isArray(bundle?.objects) || typeof bundle?.dsk_version_hash !== 'string') {
    log.warn({ resolved_path: filePath }, 'DSK bundle shape invalid — no wire provenance');
    return null;
  }

  if (!verifyDSKHash(bundle)) {
    log.error(
      { resolved_path: filePath, declared: bundle.dsk_version_hash },
      'DSK bundle hash mismatch — refusing to attribute anything to it',
    );
    return null;
  }

  _bundle = bundle;
  return _bundle;
}

/** Test-only: drop the memo so a spec can exercise the read path repeatedly. */
export function _resetDskBundleCache(): void {
  _bundle = null;
  _attempted = false;
}
