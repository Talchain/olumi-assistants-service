/**
 * The canonical DSK CLAIM RECORD, resolved for wire provenance.
 *
 * The CLAIM sibling of `dsk-protocol-record.ts`: same doctrine, different arm
 * of the bundle id grammar. Schemas 0.39.0 adds the atomic strict
 * `dsk_claim_provenance` triple to `CoachingBlockSchema` /
 * `ReviewCardBlockSchema` (ROADMAP 2.964); this module is what fills it.
 *
 * ── WHY THE TRIPLE IS RE-RESOLVED AND NOT COPIED ────────────────────────────
 * The producer of a `decision_quality_prompts[]` entry is an LLM, and the entry
 * already carries `principle`, `evidence_strength` and `dsk_protocol_id` that
 * the model wrote. `dsk-grounding-policy.ts` rebinds those to the bundle at the
 * enrichment egress — and that is exactly why this module must not lean on it.
 * The enrichment is an UNTYPED passthrough (`z.record`): a replayed or cached
 * `decision_review`, or a future edit on either side of that seam, can hand
 * this producer an entry whose companion fields say one thing and whose id says
 * another. CEE #830 is the measured consequence of trusting the entry:
 * `{dsk_claim_id:'DSK-T-002', dsk_protocol_id:'DSK-P-BOGUS',
 *   evidence_strength:'weak'}` rendered as grounded, citing a protocol that
 * exists nowhere and a strength the bundle rates `strong`.
 *
 * So the ONLY thing read from the entry is the claim id. Every byte the user
 * sees under the bundle's authority — the title, the strength, the protocol —
 * comes from `data/dsk/v1.json`. A title written into this file (or copied from
 * an entry) could drift from the science it names and nothing would notice.
 *
 * ── WHY IT REFUSES ──────────────────────────────────────────────────────────
 * Fail-closed in every direction, because a missing badge is a lost affordance
 * and a wrong badge is a lie about science. `null` — never a partial or
 * fabricated triple — when:
 *   - the id is not a CLAIM id in the 0.39.0 grammar (`DSK-(B|T)-\d{3}`). A
 *     protocol id resolves in the bundle and is still refused: "the id exists"
 *     is the question #830 answered yes to while the real question went unasked.
 *   - the id names no object, or names one that is not a `claim`;
 *   - the claim is DEPRECATED — the wire must not cite science the bundle has
 *     withdrawn;
 *   - the title is absent/empty, or the strength is not one of the four the
 *     contract admits. Both are REQUIRED members of the atomic triple, and an
 *     out-of-enum strength would fail the `.strict()` parse at the block gate
 *     and take the whole coaching card down with it. Withholding the badge
 *     keeps the card.
 *   - the bundle fails its own canonical hash, or cannot be read at all (see
 *     `dsk-bundle-record.ts`).
 *
 * `protocol_id` is OPTIONAL in the contract and is emitted only when a live,
 * non-deprecated protocol links to this claim AND its id matches the contract's
 * protocol grammar. A protocol that fails either test costs the protocol id
 * alone, not the badge: the triple without it is still true.
 */

import type { DSKClaim, DSKProtocol } from '../../dsk/types.js';
import { loadVerifiedDskBundle, _resetDskBundleCache } from './dsk-bundle-record.js';

/**
 * The wire shape, structurally identical to schemas'
 * `DskClaimProvenanceSchema`. Declared here (rather than imported) only so this
 * module has no boundary-schema import in its hot path; the emitted value is
 * parsed against the real contract by `validateProseAndSchemaOrDrop` at the
 * block gate, and `dsk-claim-provenance-wire.test.ts` asserts the two agree.
 */
export interface DskClaimProvenance {
  readonly claim_id: string;
  readonly claim_title: string;
  readonly evidence_strength: 'strong' | 'medium' | 'weak' | 'mixed';
  readonly protocol_id?: string;
}

/** `DskClaimProvenanceSchema.claim_id` — the claim arms of the id grammar. */
const CLAIM_ID_RE = /^DSK-(B|T)-\d{3}$/;

/** `DskClaimProvenanceSchema.protocol_id`. */
const PROTOCOL_ID_RE = /^DSK-P-\d{3}$/;

interface ClaimRecord {
  readonly claim: DSKClaim;
  readonly protocolId?: string;
}

/**
 * Memoised claim index. `null` = read attempted and the bundle is unusable; we
 * do not retry on every turn.
 */
let _claims: ReadonlyMap<string, ClaimRecord> | null = null;
let _attempted = false;

function loadClaimIndex(): ReadonlyMap<string, ClaimRecord> | null {
  if (_attempted) return _claims;
  _attempted = true;

  const bundle = loadVerifiedDskBundle();
  if (bundle === null) return null;

  // claim id → the id of the LIVE protocol that links to it. Derived from the
  // protocol objects' own `linked_claim_id`, never from a map written here.
  const claimToProtocol = new Map<string, string>();
  for (const obj of bundle.objects) {
    if (obj.type !== 'protocol') continue;
    if (obj.deprecated) continue;
    const p = obj as DSKProtocol;
    if (typeof p.linked_claim_id !== 'string' || p.linked_claim_id.length === 0) continue;
    if (!PROTOCOL_ID_RE.test(p.id)) continue;
    claimToProtocol.set(p.linked_claim_id, p.id);
  }

  const index = new Map<string, ClaimRecord>();
  for (const obj of bundle.objects) {
    if (obj.type !== 'claim') continue;
    if (obj.deprecated) continue;
    const protocolId = claimToProtocol.get(obj.id);
    index.set(
      obj.id,
      protocolId !== undefined
        ? { claim: obj as DSKClaim, protocolId }
        : { claim: obj as DSKClaim },
    );
  }
  _claims = index;
  return _claims;
}

/**
 * Resolve a DSK claim id to the wire provenance triple, entirely from the
 * bundle bytes.
 */
export function resolveDskClaimProvenance(claimId: string): DskClaimProvenance | null {
  if (!CLAIM_ID_RE.test(claimId)) return null;
  const record = loadClaimIndex()?.get(claimId);
  if (record === undefined) return null;

  const title = record.claim.title;
  if (typeof title !== 'string' || title.length === 0) return null;

  const strength = record.claim.evidence_strength;
  if (
    strength !== 'strong' &&
    strength !== 'medium' &&
    strength !== 'weak' &&
    strength !== 'mixed'
  ) {
    return null;
  }

  return {
    claim_id: record.claim.id,
    claim_title: title,
    evidence_strength: strength,
    ...(record.protocolId !== undefined ? { protocol_id: record.protocolId } : {}),
  };
}

/**
 * Test-only: drop the memo so a spec can exercise the read path repeatedly.
 * Resets the SHARED bundle memo too — see `_resetDskProtocolRecordCache`.
 */
export function _resetDskClaimRecordCache(): void {
  _claims = null;
  _attempted = false;
  _resetDskBundleCache();
}
