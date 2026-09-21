/**
 * `resolveDskClaimProvenance` — the CLAIM record read that fills schemas
 * 0.39.0's `dsk_claim_provenance` (ROADMAP 2.964).
 *
 * The claim sibling of `dsk-protocol-provenance-wire.test.ts`, and it asks the
 * same two questions that file asks of the protocol arm:
 *
 *   1. does the LOCAL interface agree with the CONTRACT? The module declares
 *      `DskClaimProvenance` structurally rather than importing the Zod type, so
 *      nothing but a test binds the two. Every emitted triple is parsed here
 *      against the real `CoachingBlockSchema`, which is `.strict()` — an
 *      undeclared or malformed member would not degrade the badge, it would
 *      take the whole coaching card off the wire.
 *   2. does it REFUSE what it should refuse? "The id exists" is the question
 *      CEE #830 answered yes to while the real question went unasked. Each
 *      refusal below is a separate reachable input, and each is exercised
 *      against the REAL bundle read — a stub would prove only that a mock
 *      returns what it was told.
 *
 * The bundle-tampering arms deliberately drive the resolver through a chdir to
 * a temp tree rather than mocking `fs`, so the hash verification in
 * `dsk-bundle-record.ts` is the thing actually under test.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CoachingBlockSchema } from '@talchain/schemas/boundary';

import {
  resolveDskClaimProvenance,
  _resetDskClaimRecordCache,
} from '../dsk-claim-record.js';
import { resolveDskProtocolProvenance } from '../dsk-protocol-record.js';
import { computeDSKHash } from '../../../dsk/hash.js';

interface BundleObject {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly evidence_strength: string;
  readonly deprecated?: boolean;
  readonly linked_claim_id?: string;
}
interface Bundle {
  readonly dsk_version_hash: string;
  objects: BundleObject[];
}

const BUNDLE_PATH = path.resolve(process.cwd(), 'data/dsk/v1.json');
const bundle = JSON.parse(fs.readFileSync(BUNDLE_PATH, 'utf-8')) as Bundle;

const techniqueClaims = bundle.objects.filter(
  (o) => o.type === 'claim' && o.id.startsWith('DSK-T-'),
);
const biasClaims = bundle.objects.filter(
  (o) => o.type === 'claim' && o.id.startsWith('DSK-B-'),
);

afterEach(() => {
  _resetDskClaimRecordCache();
});

/**
 * Re-stamp an edited bundle with the product's OWN canonical hash, so the tree
 * under test passes `verifyDSKHash` and the resolver's refusal can only be the
 * rule being exercised. Uses `computeDSKHash` rather than a second
 * implementation — the hash is derived, never mirrored.
 */
function rehashed(edited: Bundle): string {
  const withHash = { ...edited, dsk_version_hash: computeDSKHash(edited as never) };
  return JSON.stringify(withHash);
}

/** Run `fn` with cwd pointed at a temp tree holding `bundleJson` (or nothing). */
function withBundleOnDisk(bundleJson: string | null, fn: (tmp: string) => void): void {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dskclaim4c8e17-'));
  const cwd = process.cwd();
  try {
    if (bundleJson !== null) {
      fs.mkdirSync(path.join(tmp, 'data', 'dsk'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'data', 'dsk', 'v1.json'), bundleJson, 'utf-8');
    }
    process.chdir(tmp);
    _resetDskClaimRecordCache();
    fn(tmp);
  } finally {
    process.chdir(cwd);
    _resetDskClaimRecordCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe('resolveDskClaimProvenance — resolves from the bundle bytes', () => {
  it('every live technique claim resolves to its own bundle record', () => {
    expect(techniqueClaims.length).toBeGreaterThan(0);
    for (const c of techniqueClaims) {
      if (c.deprecated === true) continue;
      const p = resolveDskClaimProvenance(c.id);
      expect(p, `${c.id} must resolve`).not.toBeNull();
      expect(p!.claim_id).toBe(c.id);
      expect(p!.claim_title).toBe(c.title);
      expect(p!.evidence_strength).toBe(c.evidence_strength);
    }
  });

  it('every live bias claim resolves too — the id grammar admits both arms', () => {
    // The contract's `claim_id` regex is `^DSK-(B|T)-\d{3}$`. Refusing the bias
    // arm for the CALIBRATION surface is the CALLER's rule (the wrong table for
    // that field); it is not this resolver's, and encoding it here would put
    // the same rule in two places for ROADMAP 2.965 to trip over.
    expect(biasClaims.length).toBeGreaterThan(0);
    for (const c of biasClaims) {
      if (c.deprecated === true) continue;
      expect(resolveDskClaimProvenance(c.id)!.claim_title).toBe(c.title);
    }
  });

  it('carries the LINKED protocol id, derived from the protocol objects', () => {
    for (const c of techniqueClaims) {
      const expected = bundle.objects.find(
        (o) => o.type === 'protocol' && o.linked_claim_id === c.id && o.deprecated !== true,
      )?.id;
      expect(resolveDskClaimProvenance(c.id)!.protocol_id).toBe(expected);
    }
  });
});

describe('resolveDskClaimProvenance — refusals', () => {
  it('refuses an id that names no object in the bundle', () => {
    expect(resolveDskClaimProvenance('DSK-T-999')).toBeNull();
    expect(resolveDskClaimProvenance('DSK-B-999')).toBeNull();
  });

  it('refuses a PROTOCOL id even though it exists in the bundle', () => {
    // The exact #830 shape: the id resolves, and it is not the thing being
    // cited. Positive control in the same test — the protocol arm DOES resolve
    // it, so the null below is a refusal and not an unreadable bundle.
    const protocolId = bundle.objects.find((o) => o.type === 'protocol')!.id;
    expect(resolveDskProtocolProvenance(protocolId)).not.toBeNull();
    expect(resolveDskClaimProvenance(protocolId)).toBeNull();
  });

  it('refuses a TRIGGER id', () => {
    const triggerId = bundle.objects.find((o) => o.type === 'trigger')?.id;
    expect(triggerId).toBeDefined();
    expect(resolveDskClaimProvenance(triggerId!)).toBeNull();
  });

  it('refuses ids outside the contract grammar', () => {
    for (const bad of ['', 'DSK-T-01', 'DSK-T-0001', 'dsk-t-002', 'DSK-X-002', 'DSK-T-002 ']) {
      expect(resolveDskClaimProvenance(bad), `${JSON.stringify(bad)} must refuse`).toBeNull();
    }
  });

  it('refuses a DEPRECATED claim — the wire must not cite withdrawn science', () => {
    // ⚠ Editing the bundle also breaks its hash, and a hash failure refuses
    // EVERYTHING — so a naive edit would make this test pass for a reason that
    // has nothing to do with deprecation (a guard agreeing with itself). The
    // edited bundle is therefore RE-HASHED with the product's own
    // `computeDSKHash`, and a sibling claim is asserted to still resolve in the
    // same invocation. That control is what makes the null below a refusal.
    const target = techniqueClaims[0];
    const sibling = techniqueClaims[1];
    expect(sibling.id).not.toBe(target.id);
    withBundleOnDisk(
      rehashed({
        ...bundle,
        objects: bundle.objects.map((o) =>
          o.id === target.id ? { ...o, deprecated: true } : o,
        ),
      }),
      () => {
        expect(
          resolveDskClaimProvenance(sibling.id),
          'control: the bundle verified and other claims resolve',
        ).not.toBeNull();
        expect(resolveDskClaimProvenance(target.id)).toBeNull();
      },
    );
  });

  /**
   * ⚠ THE NEXT THREE ARMS EXIST BECAUSE THEIR MUTANTS SURVIVED, and the reason
   * they survived is worth stating: the id grammar and the index's type filter
   * DEFEND EACH OTHER on today's bundle. Deleting either one alone reds
   * nothing, because the other still refuses — `DSK-P-002` fails the grammar
   * before the lookup, and a protocol object is absent from the index anyway.
   * Two guards that agree are not two guards; they are one guard with a spare,
   * and the spare goes unnoticed the moment the bundle's id-letter convention
   * (B=bias, T=technique, P=protocol …) stops holding — which nothing enforces.
   * Each arm below isolates ONE branch by constructing the state only that
   * branch can refuse, re-hashed so the bundle still verifies.
   */
  it('refuses a claim-shaped id whose object is NOT a claim', () => {
    // Isolates the index's type filter: the id passes the grammar, so only the
    // filter can refuse. The letter convention is a convention, not a schema.
    const trigger = bundle.objects.find((o) => o.type === 'trigger')!;
    withBundleOnDisk(
      rehashed({
        ...bundle,
        objects: bundle.objects.map((o) =>
          o.id === trigger.id ? { ...o, id: 'DSK-T-907' } : o,
        ),
      }),
      () => {
        expect(resolveDskClaimProvenance(techniqueClaims[0].id)).not.toBeNull();
        expect(resolveDskClaimProvenance('DSK-T-907')).toBeNull();
      },
    );
  });

  it('refuses a CLAIM whose id is outside the contract grammar', () => {
    // Isolates the grammar gate: the object IS a claim and IS in the index, so
    // only the regex can refuse it. This is not pedantry — `claim_id` is
    // regex-validated in the strict contract, so emitting `DSK-F-001` would
    // fail the parse at the block gate and take the whole coaching card off the
    // wire. Withholding the badge keeps the card.
    const target = techniqueClaims[0];
    withBundleOnDisk(
      rehashed({
        ...bundle,
        objects: bundle.objects.map((o) =>
          o.id === target.id ? { ...o, id: 'DSK-F-001' } : o,
        ),
      }),
      () => {
        expect(resolveDskClaimProvenance(techniqueClaims[1].id)).not.toBeNull();
        expect(resolveDskClaimProvenance('DSK-F-001')).toBeNull();
      },
    );
  });

  it('refuses a bundle that PARSES but is not a bundle, and does not throw', () => {
    // Isolates the shape check. Without it the hash verifier is handed an
    // arbitrary object and the failure mode is a THROW on a live turn, not a
    // withheld badge — the difference between losing an attribution and losing
    // the response.
    withBundleOnDisk('{"hello":"world"}', () => {
      expect(() => resolveDskClaimProvenance(techniqueClaims[0].id)).not.toThrow();
      expect(resolveDskClaimProvenance(techniqueClaims[0].id)).toBeNull();
    });
  });

  it('refuses a claim whose title is empty — the triple has no honest text', () => {
    const target = techniqueClaims[0];
    withBundleOnDisk(
      rehashed({
        ...bundle,
        objects: bundle.objects.map((o) => (o.id === target.id ? { ...o, title: '' } : o)),
      }),
      () => {
        expect(resolveDskClaimProvenance(techniqueClaims[1].id)).not.toBeNull();
        expect(resolveDskClaimProvenance(target.id)).toBeNull();
      },
    );
  });

  it('refuses a strength outside the contract enum — WITHHOLDS the badge', () => {
    // The card must survive the badge's failure. `evidence_strength` is a
    // REQUIRED member of the atomic triple and `DskEvidenceStrength` admits
    // exactly four values, so emitting `very strong` would fail the `.strict()`
    // parse at the block gate and take the whole coaching card off the wire.
    // Refusing here costs the badge and keeps the card.
    const target = techniqueClaims[0];
    withBundleOnDisk(
      rehashed({
        ...bundle,
        objects: bundle.objects.map((o) =>
          o.id === target.id ? { ...o, evidence_strength: 'very strong' } : o,
        ),
      }),
      () => {
        expect(resolveDskClaimProvenance(techniqueClaims[1].id)).not.toBeNull();
        expect(resolveDskClaimProvenance(target.id)).toBeNull();
      },
    );
  });
});

describe('the OPTIONAL protocol id costs the protocol id, never the badge', () => {
  it('omits protocol_id when the linking protocol is deprecated', () => {
    const target = techniqueClaims[0];
    const protocolId = bundle.objects.find(
      (o) => o.type === 'protocol' && o.linked_claim_id === target.id,
    )!.id;
    withBundleOnDisk(
      rehashed({
        ...bundle,
        objects: bundle.objects.map((o) =>
          o.id === protocolId ? { ...o, deprecated: true } : o,
        ),
      }),
      () => {
        const p = resolveDskClaimProvenance(target.id);
        expect(p).not.toBeNull();
        expect(p!.claim_title).toBe(target.title);
        expect(p!.protocol_id).toBeUndefined();
        expect('protocol_id' in p!).toBe(false);
      },
    );
  });

  it('omits protocol_id when the linking protocol id is outside the grammar', () => {
    const target = techniqueClaims[0];
    const protocolId = bundle.objects.find(
      (o) => o.type === 'protocol' && o.linked_claim_id === target.id,
    )!.id;
    withBundleOnDisk(
      rehashed({
        ...bundle,
        objects: bundle.objects.map((o) =>
          o.id === protocolId ? { ...o, id: 'DSK-P-BOGUS' } : o,
        ),
      }),
      () => {
        const p = resolveDskClaimProvenance(target.id);
        expect(p).not.toBeNull();
        expect(p!.protocol_id).toBeUndefined();
      },
    );
  });

  it('refuses everything when the bundle fails its own hash', () => {
    const target = techniqueClaims[0];
    const tampered = {
      ...bundle,
      objects: bundle.objects.map((o) =>
        o.id === target.id ? { ...o, title: 'Totally Legitimate Science' } : o,
      ),
    };
    withBundleOnDisk(JSON.stringify(tampered), (tmp) => {
      // Positive control IN THE SAME INVOCATION: prove the tampering landed, so
      // a null result cannot be an artefact of an unread file.
      const onDisk = JSON.parse(
        fs.readFileSync(path.join(tmp, 'data', 'dsk', 'v1.json'), 'utf-8'),
      ) as Bundle;
      expect(onDisk.objects.find((o) => o.id === target.id)?.title).toBe(
        'Totally Legitimate Science',
      );
      expect(resolveDskClaimProvenance(target.id)).toBeNull();
    });
    // …and the real bundle still resolves afterwards, so the test cleaned up.
    expect(resolveDskClaimProvenance(target.id)).not.toBeNull();
  });

  it('refuses when the bundle is MISSING, and does not throw', () => {
    withBundleOnDisk(null, (tmp) => {
      expect(fs.existsSync(path.join(tmp, 'data', 'dsk', 'v1.json'))).toBe(false);
      expect(resolveDskClaimProvenance(techniqueClaims[0].id)).toBeNull();
    });
  });

  it('refuses when the bundle is unparseable, and does not throw', () => {
    withBundleOnDisk('{ not json', () => {
      expect(resolveDskClaimProvenance(techniqueClaims[0].id)).toBeNull();
    });
  });
});

describe('the local interface agrees with the pinned contract', () => {
  it('every resolvable claim yields a triple the strict schema accepts', () => {
    // A minimally-valid coaching block, so the only thing under test is the
    // provenance member. If `DskClaimProvenanceSchema` gains a required field
    // or tightens a rule at a future pin, this REDs at the pin bump rather than
    // silently dropping every calibration card on staging.
    const base = {
      block_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      signal_id: 'sig-dsk-claim-contract',
      created_at: '2026-08-08T01:00:00.000Z',
      source_handler: 'decision_review_enricher',
      graph_hash_at_generation: 'gh_a1b2c3d4e5f60964',
      freshness: 'fresh',
      type: 'coaching',
      coaching_kind: 'calibration_prompt',
      title: 'Calibration prompt',
      body: 'How often has a plan like this one landed on time before?',
      source: 'decision_review',
      target_refs: [],
      priority_rank: 201,
    };
    const claims = [...techniqueClaims, ...biasClaims].filter((c) => c.deprecated !== true);
    expect(claims.length).toBeGreaterThan(0);
    for (const c of claims) {
      const prov = resolveDskClaimProvenance(c.id);
      expect(prov).not.toBeNull();
      const parsed = CoachingBlockSchema.safeParse({ ...base, dsk_claim_provenance: prov });
      expect(parsed.success, `${c.id}: ${JSON.stringify(parsed.error?.issues?.[0])}`).toBe(true);
    }
  });

  it('the base block WITHOUT provenance parses too — the control for the above', () => {
    // Without this, a schema change that broke `base` itself would make every
    // assertion above fail for a reason unrelated to provenance, or (worse) a
    // permissive schema would make them pass for one.
    const base = {
      block_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      signal_id: 'sig-dsk-claim-contract',
      created_at: '2026-08-08T01:00:00.000Z',
      source_handler: 'decision_review_enricher',
      graph_hash_at_generation: 'gh_a1b2c3d4e5f60964',
      freshness: 'fresh',
      type: 'coaching',
      coaching_kind: 'calibration_prompt',
      title: 'Calibration prompt',
      body: 'How often has a plan like this one landed on time before?',
      source: 'decision_review',
      target_refs: [],
      priority_rank: 201,
    };
    expect(CoachingBlockSchema.safeParse(base).success).toBe(true);
    expect(
      CoachingBlockSchema.safeParse({ ...base, dsk_claim_provenance: { claim_id: 'DSK-T-002' } })
        .success,
    ).toBe(false);
  });
});
