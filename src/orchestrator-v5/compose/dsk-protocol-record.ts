/**
 * The canonical DSK PROTOCOL RECORD, resolved for wire provenance.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT `dsk-loader.getProtocolById` ─────────
 * ROADMAP 2.490 slice 1 (#820) shipped two protocol exercises and attested
 * their DSK ids in TELEMETRY only, because `ExerciseBlockSchema` was `.strict()`
 * with no dsk field. Schemas 0.37.0 adds the atomic `dsk_provenance` triple, so
 * the attribution can now reach the user. This module is what fills it.
 *
 * It deliberately does NOT go through `orchestrator/dsk-loader.ts`, and the
 * reason is a capability rule rather than a style preference. That loader is
 * gated on `DSK_ENABLED` / `ENABLE_DSK_V0` and documents itself as "When OFF:
 * all exports are no-ops". Sourcing the badge from it would make a user-visible
 * capability disappear whenever a coaching flag moved — a dark launch by the
 * back door, and precisely the class this programme refuses. The BUNDLE is not
 * a feature: `data/dsk/v1.json` is committed data that ships in the image (the
 * loader resolves the same path at runtime on staging today). The *injection of
 * DSK guidance into prompts* is the flag-gated feature; *what DSK-P-003 is
 * called* is not. So this reader is unconditional, and adds no flag of its own.
 *
 * Equally deliberately it does NOT mutate the loader's singleton — populating
 * that when the flags are OFF would silently switch `queryDsk` back on and
 * change coaching behaviour as a side effect of rendering a badge.
 *
 * ── WHY IT VERIFIES THE HASH ────────────────────────────────────────────────
 * The badge's entire claim is "this text is the published record's". CEE #830
 * (ROADMAP 2.491) is what happens when that claim is made without the check:
 * an id was validated as EXISTING while the text under it was the model's own
 * prose. Here the check is the bundle's own canonical hash, reusing
 * `verifyDSKHash` rather than re-deriving it (trap 12 — one derivation, not a
 * mirror). A bundle that fails its own integrity check yields NO provenance at
 * all: the exercise card still renders on its instruction copy, simply without
 * an attribution. Fail-closed, always — a missing badge is a lost affordance, a
 * wrong badge is a lie about science.
 *
 * ── WHY IT REFUSES NON-PROTOCOL IDS ─────────────────────────────────────────
 * `resolveDskProtocolProvenance('DSK-T-003')` returns null even though that id
 * IS in the bundle. "The id exists" is the exact question #830 answered yes to
 * while the real question went unasked. The real question is "does this id name
 * the PROTOCOL this card performs", and a technique claim or a trigger is not
 * one. Deprecated protocols are refused for the same reason: the wire must not
 * cite science the bundle has withdrawn.
 */

import type { DSKProtocol } from '../../dsk/types.js';
import { loadVerifiedDskBundle, _resetDskBundleCache } from './dsk-bundle-record.js';

/**
 * The wire shape, structurally identical to schemas'
 * `DskProtocolProvenanceSchema`. Declared here (rather than imported) only so
 * this module has no boundary-schema import in its hot path; the emitted value
 * is parsed against the real contract by `validateProseAndSchemaOrDrop` at the
 * block gate, and `dsk-protocol-provenance-wire.test.ts` asserts the two agree.
 */
export interface DskProtocolProvenance {
  readonly protocol_id: string;
  readonly protocol_title: string;
  readonly evidence_strength: 'strong' | 'medium' | 'weak' | 'mixed';
}

/** `DSKObjectBase.id` narrowed to the protocol arm. */
const PROTOCOL_ID_RE = /^DSK-P-\d{3}$/;

/**
 * Memoised protocol index. `null` = read attempted and failed (or the bundle
 * failed its integrity check); we do not retry on every turn.
 */
let _protocols: ReadonlyMap<string, DSKProtocol> | null = null;
let _attempted = false;

function loadProtocolIndex(): ReadonlyMap<string, DSKProtocol> | null {
  if (_attempted) return _protocols;
  _attempted = true;

  // The path resolution, shape check and hash verification live in
  // `dsk-bundle-record.ts` — one derivation shared with the CLAIM arm, so the
  // two badge families can never disagree about whether the bundle was
  // verified (trap 12). What stays here is the question only this arm can
  // answer: which objects are eligible to be cited as a PROTOCOL.
  const bundle = loadVerifiedDskBundle();
  if (bundle === null) return null;

  const index = new Map<string, DSKProtocol>();
  for (const obj of bundle.objects) {
    if (obj.type !== 'protocol') continue;
    if (obj.deprecated) continue;
    index.set(obj.id, obj as DSKProtocol);
  }
  _protocols = index;
  return _protocols;
}

/**
 * Resolve a DSK protocol id to the wire provenance triple.
 *
 * Returns `null` — never a partial or fabricated triple — when the id is not a
 * protocol id, names no live protocol, or the bundle could not be verified.
 */
export function resolveDskProtocolProvenance(
  protocolId: string,
): DskProtocolProvenance | null {
  if (!PROTOCOL_ID_RE.test(protocolId)) return null;
  const record = loadProtocolIndex()?.get(protocolId);
  if (record === undefined) return null;
  if (typeof record.title !== 'string' || record.title.length === 0) return null;
  const strength = record.evidence_strength;
  if (
    strength !== 'strong' &&
    strength !== 'medium' &&
    strength !== 'weak' &&
    strength !== 'mixed'
  ) {
    return null;
  }
  return {
    protocol_id: record.id,
    protocol_title: record.title,
    evidence_strength: strength,
  };
}

/**
 * Test-only: drop the memo so a spec can exercise the read path repeatedly.
 * Resets the SHARED bundle memo too — otherwise a spec that chdirs to a
 * tampered/missing bundle would clear this index and then be handed the
 * previously-cached bundle, and the test would pass while measuring nothing.
 */
export function _resetDskProtocolRecordCache(): void {
  _protocols = null;
  _attempted = false;
  _resetDskBundleCache();
}
