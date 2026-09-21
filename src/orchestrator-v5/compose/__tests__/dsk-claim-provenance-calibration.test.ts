/**
 * ROADMAP 2.964 — the DSK CLAIM badge on a `calibration_prompt` coaching card.
 *
 * ── WHAT THIS CLOSES ────────────────────────────────────────────────────────
 * Olumi grounds its coaching in a Decision Science Knowledge bundle, and CEE
 * already hard-refuses a fabricated citation at the enrichment egress
 * (`dsk-grounding-policy.ts`). The user was never told. Schemas 0.39.0 declares
 * the atomic strict `dsk_claim_provenance` triple and the UI hops that carry it
 * are merged; the PRODUCER was the missing link. The
 * `decision_quality_prompts[]` loop in `phase3-blocks.ts` already had the whole
 * triple plus the grounding verdict in its loop variable and read only
 * `question` + `principle`, dropping the provenance on the floor.
 *
 * ── THE ORACLE IS THE PRODUCER'S OWN SEMANTICS, NOT THIS FILE'S READING ─────
 * (trap 13c — a mutant kit measures whether a test can DETECT a change, never
 * whether the expectation is RIGHT.) Every expectation below is derived from
 * something that already exists at the bytes:
 *
 *   - WHICH VERDICTS EARN A BADGE. `dsk-grounding-policy.ts` defines exactly
 *     three: `attested` (the model cited, and the citation resolves to the
 *     claim that is DISPLAYED), `resolved` (id omitted, principle is byte-
 *     identical to a bundle claim title, provenance taken FROM THE BUNDLE), and
 *     `general` — which its own comment calls "genuinely unattested … surfaces
 *     must mark this positively as general guidance". So `attested`/`resolved`
 *     earn the badge and `general` must not, and neither must an ABSENT verdict:
 *     the policy's header states a consumer "must treat ABSENCE as 'no verdict
 *     was made' — never as `general`", and the symmetric reading is that absence
 *     is equally never `attested`.
 *   - WHICH CLAIM FAMILY. `science-claims.ts` builds the prompt's two tables
 *     and labels them "BIAS CLAIMS — use for bias_findings" and "TECHNIQUE
 *     CLAIMS — use for decision_quality_prompts". A `DSK-B-*` citation on a
 *     calibration prompt therefore cannot have come from the table the model
 *     was shown for this field.
 *   - WHAT THE BADGE SAYS. `data/dsk/v1.json`, read here directly, so the
 *     expected title/strength/protocol are the bundle's bytes and not literals
 *     typed into a test (the exact defect CEE #830 shipped: prose under the
 *     bundle's authority that no record backed). A separate assertion PINS the
 *     concrete tuple, so a bundle edit is loud rather than silently agreed with.
 *
 * ── DELIBERATELY OUT OF SCOPE ───────────────────────────────────────────────
 * `buildBiasCards` (`phase3-blocks.ts`) is NOT given a badge here, and the last
 * test in this file holds that line. Bias-finding ids are unvalidated on the
 * live V5 path — a fabricated `DSK-B-*` can reach the wire inside the
 * enrichment passthrough today — so attaching there would ship the exact trust
 * hole this chain exists to close. Gated on ROADMAP 2.965.
 *
 * The other three coaching mint sites (`assumption_check`, `orientation`,
 * `strengthen`) have NO DSK lineage in their inputs at all. Badge absence there
 * is the differentiator working, not a gap — also held below.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { CoachingBlockSchema } from '@talchain/schemas/boundary';

/**
 * ⚠ `importOriginal`-SPREAD, NOT a replacement factory (trap 12): a bare
 * `vi.mock` factory REPLACES the module, and `config/index.js` has ~20 named
 * exports that `phase3-blocks.ts` and `dsk-loader.ts` both pull from.
 *
 * The flag is needed because `dsk-grounding-policy.ts` — the REAL producer of
 * `dsk_grounding`, used here as the oracle — reads the bundle through the
 * flag-gated `dsk-loader`. Note the asymmetry, which is deliberate and is
 * itself a finding of this lane: the BADGE resolver (`dsk-claim-record.ts`)
 * reads the committed bundle unconditionally, so the attribution cannot go dark
 * because a coaching flag moved. Only the fixture needs the flag.
 */
vi.mock('../../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/index.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      features: { ...actual.config.features, dskEnabled: true, dskV0: false },
    },
  };
});

import {
  buildCoachingBlocks,
  buildReviewCardBlocks,
  type BlockBuildCtx,
} from '../phase3-blocks.js';
import { applyDskGroundingPolicy } from '../../../cee/decision-review/dsk-grounding-policy.js';
import { loadDskBundle, _resetDskBundle } from '../../../orchestrator/dsk-loader.js';
import { log } from '../../../utils/telemetry.js';

beforeAll(() => {
  _resetDskBundle();
  loadDskBundle();
});

const GRAPH_HASH = 'gh_a1b2c3d4e5f60964';

const CTX: BlockBuildCtx = {
  created_at: '2026-08-08T01:00:00.000Z',
  graph_hash_at_generation: GRAPH_HASH,
};

// ---------------------------------------------------------------------------
// The bundle bytes — the oracle for everything the badge displays.
// ---------------------------------------------------------------------------

interface BundleObject {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly evidence_strength: string;
  readonly deprecated?: boolean;
  readonly linked_claim_id?: string;
}

const bundle = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'data/dsk/v1.json'), 'utf-8'),
) as { objects: BundleObject[] };

function claimById(id: string): BundleObject {
  const hit = bundle.objects.find((o) => o.id === id && o.type === 'claim');
  if (hit === undefined) throw new Error(`bundle has no claim ${id}`);
  return hit;
}

function protocolForClaim(claimId: string): string | undefined {
  return bundle.objects.find((o) => o.type === 'protocol' && o.linked_claim_id === claimId)?.id;
}

/** The triple the bundle says a given claim id must display. */
function expectedProvenance(claimId: string): Record<string, unknown> {
  const c = claimById(claimId);
  const protocolId = protocolForClaim(claimId);
  return {
    claim_id: c.id,
    claim_title: c.title,
    evidence_strength: c.evidence_strength,
    ...(protocolId !== undefined ? { protocol_id: protocolId } : {}),
  };
}

/** A technique claim with a linked protocol — the shape live traffic cites. */
const T2 = 'DSK-T-002';

function makeFact(decisionReview: Record<string, unknown>): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-dsk-2964',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis on your current scenario.',
      enrichment: { decision_review: decisionReview },
      computed_at: '2026-08-08T00:59:00.000Z',
      graph_hash_at_run: GRAPH_HASH,
    },
  } as unknown as RunAnalysisHandlerFact;
}

function calibrationBlocks(prompts: readonly unknown[]) {
  return buildCoachingBlocks(
    makeFact({ decision_quality_prompts: prompts }),
    new Map(),
    CTX,
  ).filter((b) => b.coaching_kind === 'calibration_prompt');
}

/**
 * Grade entries through the REAL policy — the producer of `dsk_grounding` — so
 * the fixture cannot silently encode this file's model of what a graded entry
 * looks like instead of what the producer actually emits (trap 16-inverse: a
 * fixture you wrote yourself is not evidence about the wire).
 */
function graded(entries: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const out = applyDskGroundingPolicy(entries, { dskEnabled: true });
  // Pin the precondition IN-TEST: if the policy ever stops grading (bundle
  // unreadable, feature resolution changed), every assertion below would pass
  // or fail for a reason that has nothing to do with the attach.
  expect(out.stats.skipped).toBe(false);
  return out.prompts;
}

describe('ROADMAP 2.964 — calibration_prompt carries dsk_claim_provenance', () => {
  it('an ATTESTED prompt carries the bundle triple for the claim it cites', () => {
    const entries = graded([
      {
        question: 'How often has a plan like this one landed on time before?',
        principle: claimById(T2).title,
        dsk_claim_id: T2,
        evidence_strength: claimById(T2).evidence_strength,
        dsk_protocol_id: protocolForClaim(T2),
      },
    ]);
    expect(entries[0].dsk_grounding).toBe('attested');

    const blocks = calibrationBlocks(entries);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].dsk_claim_provenance).toEqual(expectedProvenance(T2));
  });

  it('a RESOLVED prompt (id omitted, principle IS a bundle title) carries it too', () => {
    const entries = graded([
      {
        question: 'What does the outside view say about a plan of this shape?',
        // No id at all — the policy resolves it from the title.
        principle: claimById(T2).title,
      },
    ]);
    expect(entries[0].dsk_grounding).toBe('resolved');

    const blocks = calibrationBlocks(entries);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].dsk_claim_provenance).toEqual(expectedProvenance(T2));
  });

  it('a GENERAL prompt carries NO provenance — absence is the differentiator', () => {
    const entries = graded([
      {
        question: 'What would change your mind about delivery timing?',
        // A paraphrase, deliberately NOT a bundle title: the policy refuses to
        // attest science on the model's behalf, and so must the badge.
        principle: 'Think about the opposite',
      },
    ]);
    expect(entries[0].dsk_grounding).toBe('general');

    const blocks = calibrationBlocks(entries);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].dsk_claim_provenance).toBeUndefined();
  });

  it('a FABRICATED id is stripped by the policy and yields NO badge', () => {
    const entries = graded([
      {
        question: 'How confident are you in the delivery window you assumed?',
        principle: 'Some invented principle',
        dsk_claim_id: 'DSK-T-999',
      },
    ]);
    expect(entries[0].dsk_grounding).toBe('general');
    expect(entries[0].dsk_claim_id).toBeUndefined();

    const blocks = calibrationBlocks(entries);
    expect(blocks[0].dsk_claim_provenance).toBeUndefined();
  });

  it('NO VERDICT (a decision_review that never met the policy) yields NO badge', () => {
    // The realistic case, not a hypothetical: `decision_review` rides the
    // untyped enrichment passthrough and is persisted per graph hash, so a
    // cached payload minted before the grounding policy existed reaches this
    // producer carrying a plausible id and no verdict. Fail-closed.
    const blocks = calibrationBlocks([
      {
        question: 'How often has a plan like this one landed on time before?',
        principle: claimById(T2).title,
        dsk_claim_id: T2,
      },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].dsk_claim_provenance).toBeUndefined();
  });

  it('a GENERAL verdict refuses even when a RESOLVABLE id survives beside it', () => {
    // ⚠ FOUND BY A SURVIVING MUTANT, and the finding is the reason this test
    // exists. Widening the grounded set to include `general` REDDED NOTHING:
    // the policy DELETES `dsk_claim_id` on its way to a `general` verdict, so
    // every general fixture was being refused by the ID gate and the VERDICT
    // gate's discrimination was never observed. The suite agreed with itself.
    //
    // The state below is reachable without the policy: `decision_review` rides
    // the untyped enrichment passthrough and is persisted, so a replayed
    // payload — or a policy that one day stops stripping — hands this producer
    // an id beside a verdict that positively denies attestation. Badging it
    // would print "grounded in decision science" on a card the producer of that
    // verdict has already declared unattested.
    const blocks = calibrationBlocks([
      {
        question: 'How often has a plan like this one landed on time before?',
        principle: claimById(T2).title,
        dsk_claim_id: T2,
        dsk_grounding: 'general',
      },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].dsk_claim_provenance).toBeUndefined();
  });

  it('an UNKNOWN verdict string refuses too — the set is a whitelist', () => {
    // Fail-closed on a verdict this producer does not understand, rather than
    // fail-open on anything that is not literally `general`.
    for (const verdict of ['unverified', 'ATTESTED', 'attested ', 'partial', '']) {
      const blocks = calibrationBlocks([
        {
          question: 'How often has a plan like this one landed on time before?',
          principle: claimById(T2).title,
          dsk_claim_id: T2,
          dsk_grounding: verdict,
        },
      ]);
      expect(blocks).toHaveLength(1);
      expect(
        blocks[0].dsk_claim_provenance,
        `verdict ${JSON.stringify(verdict)} must not badge`,
      ).toBeUndefined();
    }
  });

  it('a BIAS claim id on a calibration prompt yields NO badge (wrong table)', () => {
    // `science-claims.ts` offers DSK-B-* for `bias_findings` only. A verdict of
    // `attested` beside a bias id is a state the policy cannot produce for this
    // field — which is exactly why this producer must not honour it either.
    const biasId = bundle.objects.find(
      (o) => o.type === 'claim' && o.id.startsWith('DSK-B-'),
    )!.id;
    const blocks = calibrationBlocks([
      {
        question: 'Where might the first number you heard still be anchoring you?',
        principle: claimById(biasId).title,
        dsk_claim_id: biasId,
        dsk_grounding: 'attested',
      },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].dsk_claim_provenance).toBeUndefined();
  });
});

describe('the badge is RE-RESOLVED from the bundle, never copied from the entry', () => {
  it("overrides the entry's title, strength and protocol with the bundle's", () => {
    // The CEE #830 shape, arriving with a verdict already stamped — reachable
    // through the untyped enrichment passthrough without the policy running.
    // Every displayed byte must come from `data/dsk/v1.json`.
    const blocks = calibrationBlocks([
      {
        question: 'How often has a plan like this one landed on time before?',
        principle: 'Outside view',
        dsk_claim_id: T2,
        evidence_strength: 'weak',
        dsk_protocol_id: 'DSK-P-BOGUS',
        dsk_grounding: 'attested',
      },
    ]);

    expect(blocks).toHaveLength(1);
    const p = blocks[0].dsk_claim_provenance;
    expect(p).toEqual(expectedProvenance(T2));
    // Stated the other way round, because equality alone would still pass if
    // the bundle happened to agree with the fabrication.
    expect(p!.claim_title).not.toBe('Outside view');
    expect(p!.evidence_strength).not.toBe('weak');
    expect(p!.protocol_id).not.toBe('DSK-P-BOGUS');
  });

  it('pins the exact tuple the bundle publishes today, so a bundle edit is loud', () => {
    // Derived assertions above prove CONSISTENCY with the bundle; they cannot
    // notice the bundle itself changing under us (trap 12d). This one can.
    expect(expectedProvenance(T2)).toEqual({
      claim_id: 'DSK-T-002',
      claim_title: 'Outside view and reference class forecasting',
      evidence_strength: 'strong',
      protocol_id: 'DSK-P-002',
    });
  });
});

describe('identity binding — THE claim id on THE card whose content it grounds', () => {
  it('badges only the grounded prompt when a general prompt sits beside it', () => {
    const GROUNDED_Q = 'How often has a plan like this one landed on time before?';
    const GENERAL_Q = 'What would change your mind about delivery timing?';
    const entries = graded([
      { question: GROUNDED_Q, principle: claimById(T2).title, dsk_claim_id: T2 },
      { question: GENERAL_Q, principle: 'Think about the opposite' },
    ]);
    expect(entries.map((e) => e.dsk_grounding)).toEqual(['attested', 'general']);

    const blocks = calibrationBlocks(entries);
    expect(blocks).toHaveLength(2);

    // Bind by the card's own identity — its deterministic signal_id, taken from
    // a run of the grounded entry ALONE — not by "the block that has a badge",
    // which any block could satisfy.
    const groundedAlone = calibrationBlocks(
      graded([{ question: GROUNDED_Q, principle: claimById(T2).title, dsk_claim_id: T2 }]),
    );
    const groundedSignalId = groundedAlone[0].signal_id;

    const carrier = blocks.filter((b) => b.dsk_claim_provenance !== undefined);
    expect(carrier).toHaveLength(1);
    expect(carrier[0].signal_id).toBe(groundedSignalId);
    // …and the badge sits on the card that displays the grounded question.
    expect(carrier[0].body).toBe(GROUNDED_Q);
    expect(carrier[0].dsk_claim_provenance).toEqual(expectedProvenance(T2));

    const other = blocks.find((b) => b.signal_id !== groundedSignalId)!;
    expect(other.body).toBe(GENERAL_Q);
    expect(other.dsk_claim_provenance).toBeUndefined();
  });

  it('each card carries the triple for ITS OWN claim, not the first one seen', () => {
    const techniques = bundle.objects
      .filter((o) => o.type === 'claim' && o.id.startsWith('DSK-T-') && o.deprecated !== true)
      .slice(0, 3);
    expect(techniques.length).toBe(3);

    const entries = graded(
      techniques.map((c, i) => ({
        question: `Question number ${['one', 'two', 'three'][i]} about this plan?`,
        principle: c.title,
        dsk_claim_id: c.id,
      })),
    );
    const blocks = calibrationBlocks(entries);
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.dsk_claim_provenance)).toEqual(
      techniques.map((c) => expectedProvenance(c.id)),
    );
  });
});

describe('the wire shape — the emitted block parses at the pinned contract', () => {
  it('POSITIVE: a badged block re-parses under strict CoachingBlockSchema', () => {
    // `CoachingBlockSchema` is `.strict()` and `DskClaimProvenanceSchema` is a
    // strict object, so an undeclared or malformed member does not degrade the
    // badge — it fails the parse and the whole coaching card VANISHES. This is
    // the gate that says the emitted value is contract-legal.
    const entries = graded([
      {
        question: 'How often has a plan like this one landed on time before?',
        principle: claimById(T2).title,
        dsk_claim_id: T2,
      },
    ]);
    const blocks = calibrationBlocks(entries);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].dsk_claim_provenance).toBeDefined();

    const parsed = CoachingBlockSchema.safeParse(blocks[0]);
    expect(parsed.success).toBe(true);
  });

  it('NEGATIVE CONTROL: each malformed triple is REJECTED by the same schema', () => {
    const entries = graded([
      {
        question: 'How often has a plan like this one landed on time before?',
        principle: claimById(T2).title,
        dsk_claim_id: T2,
      },
    ]);
    const good = calibrationBlocks(entries)[0];
    // Proves the positive above is not passing because the schema is permissive.
    const malformed: readonly [string, Record<string, unknown>][] = [
      ['id outside the claim grammar', { ...expectedProvenance(T2), claim_id: 'DSK-P-002' }],
      ['empty title', { ...expectedProvenance(T2), claim_title: '' }],
      ['strength outside the enum', { ...expectedProvenance(T2), evidence_strength: 'solid' }],
      ['protocol id outside the grammar', { ...expectedProvenance(T2), protocol_id: 'DSK-P-BOGUS' }],
      ['missing strength', { claim_id: T2, claim_title: claimById(T2).title }],
      ['undeclared member', { ...expectedProvenance(T2), source: 'model' }],
    ];
    for (const [label, prov] of malformed) {
      const result = CoachingBlockSchema.safeParse({ ...good, dsk_claim_provenance: prov });
      expect(result.success, `${label} must be rejected`).toBe(false);
    }
  });
});

describe('the attach SURVIVES validateProseAndSchemaOrDrop', () => {
  // The failure mode this rules out is silent: a malformed or undeclared member
  // does not degrade the badge, it fails the `.strict()` parse and the card is
  // DROPPED before egress — the user loses coaching and sees nothing. Presence
  // of the block already implies survival (the gate returns null on a drop);
  // this watches the gate's own telemetry so a drop elsewhere in the same
  // build cannot hide behind a block that happened to survive.
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function dropEvents(): Record<string, unknown>[] {
    return (warnSpy.mock.calls as unknown as ReadonlyArray<readonly unknown[]>)
      .map((c) => (c[0] !== null && typeof c[0] === 'object' ? (c[0] as Record<string, unknown>) : undefined))
      .filter((p): p is Record<string, unknown> => p?.event === 'v5.phase3.block_dropped');
  }

  it('emits NO v5.phase3.block_dropped for a badged calibration card', () => {
    const entries = graded([
      {
        question: 'How often has a plan like this one landed on time before?',
        principle: claimById(T2).title,
        dsk_claim_id: T2,
      },
    ]);
    const blocks = calibrationBlocks(entries);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].dsk_claim_provenance).toBeDefined();
    expect(dropEvents()).toEqual([]);
  });

  it('POSITIVE CONTROL: the same spy DOES see a drop when one happens', () => {
    // Without this, the empty array above would be indistinguishable from a
    // spy that cannot observe drops at all (trap 13 — an absence assertion must
    // first prove it can see a presence). A raw decimal in the question trips
    // the prose guard, which has no rewrite and therefore drops the block.
    const blocks = calibrationBlocks([
      { question: 'Is the delivery probability really 0.73 as assumed?', principle: 'x' },
    ]);
    expect(blocks).toHaveLength(0);
    const events = dropEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].block_kind).toBe('calibration_prompt');
  });
});

describe('regression — what must NOT change', () => {
  it('the badge does not disturb the rest of the calibration card', () => {
    const q = 'How often has a plan like this one landed on time before?';
    const entries = graded([{ question: q, principle: claimById(T2).title, dsk_claim_id: T2 }]);
    const badged = calibrationBlocks(entries)[0];
    const plain = calibrationBlocks([{ question: q, principle: claimById(T2).title }])[0];

    // Same card in every respect except the badge: id, ranking, copy, pill.
    const { dsk_claim_provenance: _drop, ...rest } = badged as Record<string, unknown>;
    expect(rest).toEqual(plain);
  });

  it('assumption_check, orientation and strengthen carry no badge (no DSK lineage)', () => {
    const blocks = buildCoachingBlocks(
      makeFact({
        key_assumptions: ['Edge strengths assume current market conditions persist.'],
        decision_quality_prompts: graded([
          { question: 'What would change your mind about delivery timing?', principle: 'Nope' },
        ]),
      }),
      new Map(),
      CTX,
    );
    const nonCalibration = blocks.filter((b) => b.coaching_kind !== 'calibration_prompt');
    expect(nonCalibration.length).toBeGreaterThan(0);
    for (const b of nonCalibration) {
      expect(b.dsk_claim_provenance).toBeUndefined();
    }
  });

  it('bias cards carry NO claim provenance — the 2.965 gate holds', () => {
    // Bias-finding ids are unvalidated on the live V5 path: a fabricated
    // DSK-B-* reaches this producer inside the enrichment passthrough. Badging
    // it would ship the trust hole this chain exists to close. If this test
    // ever needs changing, 2.965 (id validation for bias findings) must land
    // first — that is the whole content of the gate.
    const biasId = bundle.objects.find(
      (o) => o.type === 'claim' && o.id.startsWith('DSK-B-'),
    )!.id;
    const blocks = buildReviewCardBlocks(
      makeFact({
        bias_findings: [
          {
            type: 'Anchoring',
            description: 'The first delivery estimate has framed every later one.',
            dsk_claim_id: biasId,
            evidence_strength: 'strong',
          },
        ],
      }),
      new Map(),
      CTX,
    );
    // Positive control: the bias card itself must exist, or the assertion below
    // would hold vacuously over an empty list.
    const biasCards = blocks.filter((b) => b.card_kind === 'bias');
    expect(biasCards.length).toBeGreaterThan(0);
    for (const b of biasCards) {
      expect(b.dsk_claim_provenance).toBeUndefined();
    }
  });
});
