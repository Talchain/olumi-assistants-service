/**
 * ROADMAP 2.490 slice 2 — the DSK exercise card's provenance reaches the WIRE.
 *
 * WHAT THIS IS FOR. Slice 1 (#820) shipped two protocol exercises and attested
 * their DSK ids in TELEMETRY, because `ExerciseBlockSchema` was `.strict()`
 * with no dsk field. The user therefore saw a bare instruction paragraph with
 * no indication it was a published decision-science protocol. Schemas 0.37.0
 * adds the atomic `dsk_provenance` triple; this spec pins that CEE fills it
 * FROM THE BUNDLE BYTES and never from a hand-typed constant.
 *
 * ⚠ THE DEFECT THIS SPEC EXISTS TO MAKE IMPOSSIBLE IS CEE #830's, AT A NEW
 * SITE. #830: the attestation checked that a DSK claim id EXISTED but not that
 * the text displayed under it RESOLVED TO that id, so the badge printed the
 * model's own prose under the bundle's authority. The identical shape is
 * available here: emit `protocol_id: 'DSK-P-003'` beside a title someone typed
 * into this repo. Every expectation below is therefore derived from
 * `data/dsk/v1.json` AT TEST TIME — the test reads the bundle and asserts the
 * emitted triple equals the record — rather than from a literal I chose. A
 * literal would only prove CEE agrees with me.
 *
 * TRAP 19 (bind by identity, never by a predicate another object satisfies):
 * every assertion names its protocol id explicitly and looks the expectation
 * up by that id. The discriminating mutant pair for this is
 * `consider_opposite` (DSK-P-003) vs `devils_advocacy` (DSK-P-005) vs
 * `pre_mortem` (attributed to NOTHING, deliberately — its lens rules predate
 * the bundle and claiming DSK-P-001 would be a trap-14 false label).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ExerciseBlockSchema } from '@talchain/schemas/boundary';

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import type { DSKBundle, DSKProtocol } from '../../../dsk/types.js';
import { LENS_DSK_PROVENANCE, selectLens } from '../lens-selector.js';
import {
  resolveDskProtocolProvenance,
  _resetDskProtocolRecordCache,
} from '../dsk-protocol-record.js';
import {
  buildLensCompanionBlocks,
  type BlockBuildCtx,
  type GraphNodeLookup,
} from '../phase3-blocks.js';

const GRAPH_HASH = 'gh_a1b2c3d4e5f60001';
const CTX: BlockBuildCtx = {
  created_at: '2026-08-05T00:00:00.000Z',
  graph_hash_at_generation: GRAPH_HASH,
};
const LOOKUP: GraphNodeLookup = new Map([
  ['opt_a', { id: 'opt_a', label: 'Option A', kind: 'option' as const }],
  ['fac_dom', { id: 'fac_dom', label: 'Market demand', kind: 'factor' as const }],
]);

/** Fires consider_opposite: decisive attested-stable leader, all else silent. */
function considerOppositeFact(): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-test',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      enrichment: {
        confidence_tier: 'strong',
        factor_sensitivity: [
          { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
          { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
          { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
        ],
        option_comparison: [{ win_probability: 0.75 }, { win_probability: 0.25 }],
        robustness: { level: 'high' },
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

/** Fires devils_advocacy under sensitivity displacement (see selector spec). */
function devilsAdvocacyFact(): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-test',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      enrichment: {
        confidence_tier: 'strong',
        factor_sensitivity: [
          { factor_id: 'fac_dom', influence_score: 0.8, influence_rank: 1, confidence: 0.9 },
          { factor_id: 'fac_b', influence_score: 0.2, influence_rank: 2, confidence: 0.9 },
        ],
        option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

// ---------------------------------------------------------------------------
// The bundle, read here as the ORACLE. Deliberately a direct read of the same
// committed file the implementation resolves — if these two ever disagree the
// spec is measuring the wrong artefact, so the hash is asserted first.
// ---------------------------------------------------------------------------
const BUNDLE_PATH = path.resolve(process.cwd(), 'data/dsk/v1.json');
const bundle = JSON.parse(fs.readFileSync(BUNDLE_PATH, 'utf-8')) as DSKBundle;
const protocolsById = new Map<string, DSKProtocol>(
  bundle.objects
    .filter((o): o is DSKProtocol => o.type === 'protocol')
    .map((p) => [p.id, p]),
);

describe('DSK protocol provenance reaches the wire (2.490 slice 2)', () => {
  it('PRECONDITION — the oracle bundle is the real one and carries all six protocols', () => {
    // Trap 13b third face: pin the fixture's own precondition. If this file
    // ever stops being the canonical bundle, every expectation below would
    // silently start agreeing with nothing.
    expect(bundle.dsk_version_hash).toBe(
      'ca0f63fb0a7d942ccd7b5be67ffde5ad61edef92f8181269d8f966d690d9c896',
    );
    expect([...protocolsById.keys()].sort()).toEqual([
      'DSK-P-001',
      'DSK-P-002',
      'DSK-P-003',
      'DSK-P-004',
      'DSK-P-005',
      'DSK-P-006',
    ]);
  });

  it('resolves DSK-P-003 to the BUNDLE record, byte-for-byte (consider_opposite)', () => {
    const record = protocolsById.get('DSK-P-003');
    expect(record).toBeDefined();
    expect(resolveDskProtocolProvenance('DSK-P-003')).toEqual({
      protocol_id: 'DSK-P-003',
      protocol_title: record!.title,
      evidence_strength: record!.evidence_strength,
    });
  });

  it('resolves DSK-P-005 to the BUNDLE record, byte-for-byte (devils_advocacy)', () => {
    const record = protocolsById.get('DSK-P-005');
    expect(record).toBeDefined();
    expect(resolveDskProtocolProvenance('DSK-P-005')).toEqual({
      protocol_id: 'DSK-P-005',
      protocol_title: record!.title,
      evidence_strength: record!.evidence_strength,
    });
  });

  it('the resolved title is NOT a constant in this repo — it equals the bundle and differs per protocol', () => {
    // The two protocols must resolve to DIFFERENT titles. A hand-typed
    // constant, or a resolver that ignored its argument, would pass every
    // single-id assertion above and fail exactly here.
    const a = resolveDskProtocolProvenance('DSK-P-003');
    const b = resolveDskProtocolProvenance('DSK-P-005');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.protocol_title).not.toBe(b!.protocol_title);
    expect(a!.protocol_title).toBe(protocolsById.get('DSK-P-003')!.title);
    expect(b!.protocol_title).toBe(protocolsById.get('DSK-P-005')!.title);
  });

  it('FAILS CLOSED on an id the bundle does not carry — never a fabricated title', () => {
    expect(resolveDskProtocolProvenance('DSK-P-999')).toBeNull();
    expect(resolveDskProtocolProvenance('')).toBeNull();
  });

  it('FAILS CLOSED on a non-protocol id, even though the bundle DOES carry that object', () => {
    // DSK-T-003 is a real bundle object (the technique claim DSK-P-003 links
    // to) — so "the id exists" is TRUE and must still not authorise a protocol
    // badge. This is #830's exact question asked of the protocol channel.
    const claimExists = bundle.objects.some((o) => o.id === 'DSK-T-003');
    expect(claimExists, 'precondition: DSK-T-003 must exist in the bundle').toBe(true);
    expect(resolveDskProtocolProvenance('DSK-T-003')).toBeNull();
    expect(resolveDskProtocolProvenance('DSK-TR-003')).toBeNull();
  });

  it('every id in LENS_DSK_PROVENANCE resolves — the hand-written map cannot drift silently', () => {
    const entries = Object.entries(LENS_DSK_PROVENANCE);
    // Non-vacuity: the map must actually carry entries, or this iterates nothing.
    expect(entries.length).toBeGreaterThanOrEqual(2);
    for (const [lens, prov] of entries) {
      const resolved = resolveDskProtocolProvenance(prov!.protocolId);
      expect(resolved, `lens '${lens}' names unresolvable protocol ${prov!.protocolId}`).not.toBeNull();
      expect(resolved!.protocol_id).toBe(prov!.protocolId);
    }
  });

  it('THE EMITTED BLOCK carries the provenance, and it is DSK-P-003 for consider_opposite', () => {
    const fact = considerOppositeFact();
    const selection = selectLens(fact, { previousAnalysisLens: null });
    // Pin the precondition IN-TEST (trap 13b, third face): if this fixture ever
    // stops producing the consider_opposite lens, every assertion below would
    // hold vacuously on an empty block list while proving nothing.
    expect(selection?.lens, 'fixture no longer produces consider_opposite').toBe(
      'consider_opposite',
    );

    const blocks = buildLensCompanionBlocks(fact, CTX, selection!, [], LOOKUP);
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.exercise_kind).toBe('consider_opposite');

    const record = protocolsById.get('DSK-P-003')!;
    expect(block.dsk_provenance).toEqual({
      protocol_id: 'DSK-P-003',
      protocol_title: record.title,
      evidence_strength: record.evidence_strength,
    });
  });

  it('THE EMITTED BLOCK carries DSK-P-005 for devils_advocacy — a DIFFERENT record, not a shared constant', () => {
    const fact = devilsAdvocacyFact();
    const selection = selectLens(fact, { previousAnalysisLens: 'sensitivity_flip_risk' });
    expect(selection?.lens, 'fixture no longer produces devils_advocacy').toBe('devils_advocacy');

    const blocks = buildLensCompanionBlocks(fact, CTX, selection!, [], LOOKUP);
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.exercise_kind).toBe('devils_advocacy');

    const record = protocolsById.get('DSK-P-005')!;
    expect(block.dsk_provenance).toEqual({
      protocol_id: 'DSK-P-005',
      protocol_title: record.title,
      evidence_strength: record.evidence_strength,
    });
    // …and it is genuinely a different record from the other lens's.
    expect(record.title).not.toBe(protocolsById.get('DSK-P-003')!.title);
  });

  it('pre_mortem claims NO provenance — its lens rules predate the bundle (trap 14: never a false label)', () => {
    // This is the GREEN half of the trap-19 discriminating pair. `pre_mortem`
    // has a bundle protocol (DSK-P-001) and an `exercise_kind` of the same
    // name, so the tempting "finish the set" edit is to attribute it. CEE's
    // lens rules 2a/2b/2c are NOT a derivation of DSK-TR-001's conditions, so
    // the attribution would be a claim the code cannot support.
    expect(protocolsById.has('DSK-P-001'), 'precondition: the tempting record exists').toBe(true);
    expect(LENS_DSK_PROVENANCE.pre_mortem).toBeUndefined();
  });

  it('a bundle that FAILS ITS OWN HASH yields no provenance at all — the badge is withheld, not guessed', () => {
    // The badge's claim is "this text is the published record's". A bundle that
    // cannot prove its own integrity cannot support that claim. Exercised on
    // the REAL read path (a temp cwd with a tampered bundle), not by stubbing
    // the resolver — a stub would prove only that a mock returns what I told it.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dskproto7f3a91-hash-'));
    fs.mkdirSync(path.join(tmp, 'data', 'dsk'), { recursive: true });
    const tampered = {
      ...bundle,
      objects: bundle.objects.map((o) =>
        o.id === 'DSK-P-003' ? { ...o, title: 'Totally Legitimate Science' } : o,
      ),
    };
    fs.writeFileSync(
      path.join(tmp, 'data', 'dsk', 'v1.json'),
      JSON.stringify(tampered),
      'utf-8',
    );

    const cwd = process.cwd();
    try {
      process.chdir(tmp);
      _resetDskProtocolRecordCache();
      // Positive control IN THE SAME INVOCATION: prove the tampering actually
      // landed, so a null result cannot be an artefact of an unread file.
      const onDisk = JSON.parse(
        fs.readFileSync(path.join(tmp, 'data', 'dsk', 'v1.json'), 'utf-8'),
      ) as DSKBundle;
      expect(
        onDisk.objects.find((o) => o.id === 'DSK-P-003')?.title,
      ).toBe('Totally Legitimate Science');

      expect(resolveDskProtocolProvenance('DSK-P-003')).toBeNull();
    } finally {
      process.chdir(cwd);
      _resetDskProtocolRecordCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }

    // …and the real bundle still resolves afterwards, so the test cleaned up.
    expect(resolveDskProtocolProvenance('DSK-P-003')).not.toBeNull();
  });

  it('a MISSING bundle yields no provenance and does not throw', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dskproto7f3a91-missing-'));
    const cwd = process.cwd();
    try {
      process.chdir(tmp);
      _resetDskProtocolRecordCache();
      expect(fs.existsSync(path.join(tmp, 'data', 'dsk', 'v1.json'))).toBe(false);
      expect(resolveDskProtocolProvenance('DSK-P-003')).toBeNull();
    } finally {
      process.chdir(cwd);
      _resetDskProtocolRecordCache();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('the emitted triple is accepted by the 0.37.0 contract on a real block shape', () => {
    const prov = resolveDskProtocolProvenance('DSK-P-003');
    const parsed = ExerciseBlockSchema.safeParse({
      block_id: '77777777-7777-4777-8777-777777777777',
      signal_id: 'exercise:consider_opposite:gh',
      created_at: '2026-08-05T09:00:00.000Z',
      source_handler: 'decision_review_enricher',
      freshness: 'fresh',
      type: 'exercise',
      exercise_kind: 'consider_opposite',
      counter_case: 'Take the opposite view for a moment.',
      target_refs: [],
      dsk_provenance: prov,
    });
    expect(parsed.success).toBe(true);
  });
});
