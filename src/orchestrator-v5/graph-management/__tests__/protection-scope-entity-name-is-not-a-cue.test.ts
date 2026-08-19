/**
 * ⭐⭐ THE PRODUCT ADVISED A SENTENCE AND THEN REFUSED IT — the F-3 guard's
 * predicate DOMAIN, not its invariant.
 *
 * WITNESS (golden journey 20260819T221620Z, deployed CEE `cbc3ea3`): the
 * drafter produced an option labelled "keep what we have"; the product then
 * advised `Set the keep what we have option's effect on {factor} to {value}` —
 * a sentence CEE composes itself (`buildConfigureOptionAdvisedFormat`, which
 * also rides as a clickable chip whose `message` replays as user text). The
 * turn came back HELD with `blocker_code: USER_PROTECTED_ENTITY`.
 *
 * ROOT CAUSE: `PROTECTION_CUE` is tested against the RAW clause, and the clause
 * contains the entity's OWN LABEL. `keep` is a cue AND the first word of the
 * option's name, so the option MANUFACTURED ITS OWN PROTECTION. The user wrote
 * no cue. The co-mentioned FACTOR was protected too (bare commas are not clause
 * boundaries), so the whole op was demoted — and the hold then asserted
 * *"You asked for 'keep what we have' … to stay as it is"* about a sentence
 * that says SET.
 *
 * THE RULE UNDER TEST — a DOMAIN correction to the one canonical predicate
 * (`clauseIsProtective`, single call site), not a second rule beside it:
 *
 *   ⭐ A NAME IS NOT AN INSTRUCTION. A protection cue must be authored by the
 *     USER. A name sitting in a REFERRING position — `"<name> option"`,
 *     `"effect on <name>"`, the two slots the advised sentence uses — is the
 *     product's own wording and protects nothing. The same words anywhere else
 *     are the user's, and still protect.
 *
 * ⚠⚠ WHY POSITION AND NOT THE OP'S TARGET SET. That alternative was built,
 * measured and REJECTED: `envelopeTargetNodeIds` returns BOTH the option and
 * the factor for the canonical option-configure write, so co-targeting deleted
 * the user's protection wherever they had written that phrase — 27 of 27
 * protections lost across the corpus in §4, while a direct write to the same
 * factor stayed held. §4 and §5 are the executable memory of that.
 */
import { describe, it, expect } from 'vitest';

import {
  demoteProtectedEntityTargets,
  extractProtectedEntities,
  envelopeTargetNodeIds,
} from '../protection-scope.js';
import { USER_PROTECTED_ENTITY } from '../reason-codes.js';
import type { CandidateMutationEnvelope, RefereeVerdict } from '../types.js';
// Bind to the REAL producer and the REAL canonical list — never a paraphrase of
// either (CLAUDE.md trap 12: a hand-copied corpus drifts silently green).
import { buildConfigureOptionAdvisedFormat } from '../../configure-option-chip-text.js';
import { STATUS_QUO_LABEL_PATTERNS } from '../../../cee/structure/status-quo-patterns.js';

const OPTION_ID = 'opt_status_quo';
const CHURN_ID = 'fac_churn';
const CHURN_LABEL = 'Customer churn';
const COST_ID = 'fac_cost';
const COST_LABEL = 'CRM Platform Cost';

function graphWith(optionLabel: string) {
  return {
    nodes: [
      { id: OPTION_ID, label: optionLabel },
      { id: CHURN_ID, label: CHURN_LABEL },
      { id: COST_ID, label: COST_LABEL },
    ],
  };
}

/** The canonical option-configure write: TWO targets (option + factor). */
function configureOptionEffect(optionId: string, factorId: string): CandidateMutationEnvelope {
  return {
    envelope_version: 1,
    candidate_id: '00000000-0000-0000-0000-0000000000aa',
    kind: 'update_node_field',
    base_graph_hash: 'h',
    payload: { node_id: optionId, field: `data/interventions/${factorId}`, from: 0.2, to: 0.4 },
    provenance: { source: 'edit_graph_llm', evidence_pointer: 'p' },
    identity: { scenario_id: 's', turn_id: 't' },
  } as CandidateMutationEnvelope;
}

/** A DIRECT single-target write. */
function directWrite(nodeId: string): CandidateMutationEnvelope {
  return {
    envelope_version: 1,
    candidate_id: '00000000-0000-0000-0000-0000000000bb',
    kind: 'update_node_field',
    base_graph_hash: 'h',
    payload: { node_id: nodeId, field: 'data/value', from: 0.2, to: 0.4 },
    provenance: { source: 'edit_graph_llm', evidence_pointer: 'p' },
    identity: { scenario_id: 's', turn_id: 't' },
  } as CandidateMutationEnvelope;
}

function wouldApply(): RefereeVerdict {
  return {
    verdict: 'would_apply',
    kind: 'update_node_field',
    candidate_id: '00000000-0000-0000-0000-0000000000aa',
    mutation_class: 'tunable',
    base_hash_match: true,
  };
}

const demote = (message: string, env: CandidateMutationEnvelope, graph: unknown) =>
  demoteProtectedEntityTargets([wouldApply()], [env], message, graph);

// ---------------------------------------------------------------------------
// 1. THE WITNESS
// ---------------------------------------------------------------------------

describe("the product's own advised sentence is not a protection instruction", () => {
  const WITNESS_LABEL = 'keep what we have';
  const advised = buildConfigureOptionAdvisedFormat(WITNESS_LABEL, CHURN_LABEL, '0.4');

  it('the advised sentence is the shape the witness carried', () => {
    expect(advised).toBe("Set the keep what we have option's effect on Customer churn to 0.4");
  });

  it('⭐ protects NOTHING — the only cue sits in the option\'s own name', () => {
    // Bind by IDENTITY (node ids), never by a count another node could satisfy.
    expect(extractProtectedEntities(advised, graphWith(WITNESS_LABEL)).map((e) => e.nodeId)).toEqual(
      [],
    );
  });

  it('⭐ the option-effect write is NOT demoted (the SENDABLE defect)', () => {
    const result = demote(advised, configureOptionEffect(OPTION_ID, CHURN_ID), graphWith(WITNESS_LABEL));
    expect(result.demotedIndices).toEqual([]);
    expect(result.verdicts[0]!.verdict).toBe('would_apply');
    expect(result.verdicts[0]!.blocker?.code).toBeUndefined();
    expect(result.demotedEntityLabels).toEqual([]);
  });

  it('⭐ the CO-MENTIONED FACTOR is freed too — it rode the same clause', () => {
    expect(
      extractProtectedEntities(advised, graphWith(WITNESS_LABEL)).map((e) => e.nodeId),
    ).not.toContain(CHURN_ID);
  });

  it('⭐ POSITIVE CONTROL — the SAME label, out of referring position, still protects', () => {
    // Proves the masking is POSITION-scoped and the cue alphabet is intact. If
    // this ever goes green-by-silence the gate has been gutted, not corrected.
    const found = extractProtectedEntities(
      `Update ${CHURN_LABEL}. Please ${WITNESS_LABEL} exactly as it is.`,
      graphWith(WITNESS_LABEL),
    );
    expect(found.map((e) => e.nodeId)).toContain(OPTION_ID);
  });
});

// ---------------------------------------------------------------------------
// 2. REACHABILITY — derived from the estate's OWN canonical status-quo list
// ---------------------------------------------------------------------------

describe('every canonical status-quo option label survives the advised sentence', () => {
  it('the canonical list is non-empty (guards a vacuous loop)', () => {
    expect(STATUS_QUO_LABEL_PATTERNS.length).toBeGreaterThanOrEqual(18);
  });

  for (const label of STATUS_QUO_LABEL_PATTERNS) {
    it(`"${label}" — the advised sentence applies`, () => {
      const result = demote(
        buildConfigureOptionAdvisedFormat(label, CHURN_LABEL, '0.4'),
        configureOptionEffect(OPTION_ID, CHURN_ID),
        graphWith(label),
      );
      expect(result.demotedIndices).toEqual([]);
      expect(result.verdicts[0]!.verdict).toBe('would_apply');
    });
  }
});

// ---------------------------------------------------------------------------
// 3. OPPOSITE DIRECTION — the guard must still fire for its real purpose
// ---------------------------------------------------------------------------

describe('OPPOSITE DIRECTION — a USER-authored cue still protects the same entity', () => {
  const WITNESS_LABEL = 'keep what we have';
  const stillProtected: ReadonlyArray<readonly [string, string]> = [
    ['outright', 'Do not touch keep what we have.'],
    ['imperative-leave', 'Leave keep what we have alone.'],
    ['negated-modal', "The configuration of keep what we have shouldn't change."],
    ['A6 shape', 'Configure nothing on keep what we have; just set Customer churn to 0.52.'],
    ['post-dash', 'Set Customer churn to 0.4 - do not touch keep what we have'],
    ['but-not seam', 'Change what you need but not keep what we have'],
    ['except seam', 'Change everything except keep what we have'],
  ];

  for (const [name, message] of stillProtected) {
    it(`${name}: still demotes the write to "${WITNESS_LABEL}"`, () => {
      const result = demote(message, configureOptionEffect(OPTION_ID, CHURN_ID), graphWith(WITNESS_LABEL));
      expect(result.demotedIndices).toEqual([0]);
      expect(result.verdicts[0]!.verdict).toBe('held');
      expect(result.verdicts[0]!.blocker?.code).toBe(USER_PROTECTED_ENTITY);
      expect(result.demotedEntityLabels).toContain(WITNESS_LABEL);
    });
  }

  it('A5 (the live-wire phrasing F-3 was built for) still demotes', () => {
    const graph = {
      nodes: [
        { id: 'opt_crm', label: 'Cloud-Native CRM' },
        { id: COST_ID, label: COST_LABEL },
      ],
    };
    const result = demote(
      'Set CRM Platform Cost to 0.5 - the configuration of Cloud-Native CRM shouldn’t change.',
      configureOptionEffect('opt_crm', COST_ID),
      graph,
    );
    expect(result.demotedIndices).toEqual([0]);
    expect(result.verdicts[0]!.blocker?.code).toBe(USER_PROTECTED_ENTITY);
    expect(result.demotedEntityLabels).toContain('Cloud-Native CRM');
  });
});

// ---------------------------------------------------------------------------
// 4. ⭐⭐ FAIL-CLOSED — the direction an op-scoped mask silently destroyed
// ---------------------------------------------------------------------------

/**
 * These 27 cases are the executable memory of a rejected fix. Scoping the mask
 * to the op's TARGET SET looked equivalent and passed every test in §1–§3, but
 * `envelopeTargetNodeIds` yields BOTH the option and the factor for the
 * canonical option-configure write, so co-targeting deleted the user's own
 * protection about a THIRD entity. All 27 went HELD → APPLY. Position-scoping
 * restores them. The module's stated bias is that a false negative (a silent
 * wrong write) is the worse harm, so this section is deliberately as heavy as
 * the over-protection sections.
 */
describe('FAIL-CLOSED — a user cue is never deleted by an op that co-targets its option', () => {
  // The cue-bearing subset of the canonical list. Hand-written on purpose
  // (CLAUDE.md trap 12d: only a hand corpus notices a derived list is short),
  // with a derived containment guard so it cannot drift off the canonical list.
  const CUE_BEARING_STATUS_QUO_LABELS = [
    'do nothing',
    'no change',
    'keep current',
    'as-is',
    'as is',
    'leave things as they are',
    'stay the same',
    'keep things as they are',
    'continue as is',
  ] as const;

  const protectionTemplates: ReadonlyArray<readonly [string, (l: string) => string]> = [
    ['trailing clause', (l) => `Set ${CHURN_LABEL} to 0.4, and ${l} to ${COST_LABEL}.`],
    ['leading please', (l) => `Please ${l} for ${COST_LABEL} while you update ${CHURN_LABEL}.`],
    ['second sentence', (l) => `Update ${CHURN_LABEL}. ${l} on ${COST_LABEL}.`],
  ];

  it('DERIVED GUARD — every pinned label is still on the canonical list', () => {
    for (const label of CUE_BEARING_STATUS_QUO_LABELS) {
      expect(STATUS_QUO_LABEL_PATTERNS).toContain(label);
    }
  });

  for (const label of CUE_BEARING_STATUS_QUO_LABELS) {
    for (const [shape, build] of protectionTemplates) {
      it(`"${label}" / ${shape}: the protection of ${COST_LABEL} SURVIVES`, () => {
        const message = build(label);
        const env = configureOptionEffect(OPTION_ID, CHURN_ID);

        // ⭐ PRECONDITION PINNED IN-TEST — without this the case could pass
        // while exercising a shape that is not the weaponisable one at all.
        const targets = envelopeTargetNodeIds(env);
        expect(targets).toContain(OPTION_ID); // the cue-bearing option is CO-TARGETED
        expect(targets).toContain(CHURN_ID); // …alongside the factor, via interventions
        expect(graphWith(label).nodes.find((n) => n.id === OPTION_ID)!.label).toBe(label);
        expect(message.toLowerCase()).toContain(label.toLowerCase());

        const result = demote(message, env, graphWith(label));
        expect(result.demotedIndices).toEqual([0]);
        expect(result.verdicts[0]!.blocker?.code).toBe(USER_PROTECTED_ENTITY);
      });
    }
  }

  it('DISCRIMINATING CONTROL — remove the cue and the same op applies', () => {
    // Proves the 27 above are held BY THE CUE, not by anything incidental to
    // the fixture (the rot-mutant the previous fail-closed test could not see).
    const result = demote(
      `Set ${CHURN_LABEL} to 0.4, and update ${COST_LABEL}.`,
      configureOptionEffect(OPTION_ID, CHURN_ID),
      graphWith('do nothing'),
    );
    expect(result.demotedIndices).toEqual([]);
    expect(result.verdicts[0]!.verdict).toBe('would_apply');
  });

  it('a DIRECT write to the protected factor is still held', () => {
    const result = demote(
      `Set ${CHURN_LABEL} to 0.4, and do nothing to ${COST_LABEL}.`,
      directWrite(COST_ID),
      graphWith('do nothing'),
    );
    expect(result.demotedIndices).toEqual([0]);
    expect(result.demotedEntityLabels).toContain(COST_LABEL);
  });
});

// ---------------------------------------------------------------------------
// 5. THE FIX IS BOUND TO THE SENTENCE, NOT TO THE OP SHAPE
// ---------------------------------------------------------------------------

describe('the advised sentence is disarmed whatever op the LLM emits from it', () => {
  const WITNESS_LABEL = 'keep what we have';
  const advised = buildConfigureOptionAdvisedFormat(WITNESS_LABEL, CHURN_LABEL, '0.4');

  it('⭐ a DIRECT factor write from the advised sentence also applies', () => {
    // An op-scoped mask left the option's label unmasked here and the original
    // defect reproduced verbatim. Position-scoping does not depend on the op.
    const result = demote(advised, directWrite(CHURN_ID), graphWith(WITNESS_LABEL));
    expect(result.demotedIndices).toEqual([]);
    expect(result.verdicts[0]!.verdict).toBe('would_apply');
  });

  it('a direct write to the OPTION from the advised sentence also applies', () => {
    const result = demote(advised, directWrite(OPTION_ID), graphWith(WITNESS_LABEL));
    expect(result.demotedIndices).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. THE EXCEPTION-TAIL PATH IS CLOSED TOO
// ---------------------------------------------------------------------------

describe('a label carrying an exception seam cannot self-protect either', () => {
  const SEAM_LABEL = 'Roll out except Germany';

  it('⭐ the advised sentence applies even when the label contains "except"', () => {
    const result = demote(
      buildConfigureOptionAdvisedFormat(SEAM_LABEL, CHURN_LABEL, '0.4'),
      configureOptionEffect(OPTION_ID, CHURN_ID),
      graphWith(SEAM_LABEL),
    );
    expect(result.demotedIndices).toEqual([]);
    expect(result.verdicts[0]!.verdict).toBe('would_apply');
  });

  it('POSITIVE CONTROL — a genuine "except <entity>" tail still protects', () => {
    const found = extractProtectedEntities(
      `Update everything except ${COST_LABEL}`,
      graphWith('do nothing'),
    );
    expect(found.map((e) => e.nodeId)).toContain(COST_ID);
  });
});

// ---------------------------------------------------------------------------
// 7. THE FACTOR SLOT IS THE SAME DOOR — and nothing else in this file opens it
// ---------------------------------------------------------------------------

/**
 * The witness arrived through the OPTION slot, so every case above is satisfied
 * by masking `"<name> option"` alone: deleting the `"effect on <name>"` arm left
 * all 66 GREEN. That surviving mutant was a gap in this corpus, not an
 * equivalent mutation — the advised sentence puts a name in BOTH slots, and a
 * FACTOR whose own label carries a cue self-protects identically. `skip`,
 * `ignore`, `retain`, `preserve` and `never` are all in `PROTECTION_CUE` and all
 * ordinary metric names.
 */
describe('a FACTOR whose own label carries a cue does not self-protect either', () => {
  const OPTION_LABEL = 'expand to Germany'; // deliberately cue-free
  const CUE_BEARING_FACTOR_LABELS = [
    'Skip rate',
    'Ignore rate',
    'Retain rate',
    'Preserve ratio',
    'Never-events count',
  ] as const;

  const factorGraph = (factorLabel: string) => ({
    nodes: [
      { id: OPTION_ID, label: OPTION_LABEL },
      { id: CHURN_ID, label: factorLabel },
    ],
  });

  for (const factorLabel of CUE_BEARING_FACTOR_LABELS) {
    it(`"${factorLabel}" — the advised sentence applies`, () => {
      // PRECONDITION PINNED IN-TEST: the label really is cue-bearing, so a
      // green here is the masking's doing and not a label that never had a cue.
      expect(
        extractProtectedEntities(
          `Update things. Please ${factorLabel} as it stands.`,
          factorGraph(factorLabel),
        ).map((e) => e.nodeId),
      ).toContain(CHURN_ID);

      const result = demote(
        buildConfigureOptionAdvisedFormat(OPTION_LABEL, factorLabel, '0.4'),
        configureOptionEffect(OPTION_ID, CHURN_ID),
        factorGraph(factorLabel),
      );
      expect(result.demotedIndices).toEqual([]);
      expect(result.verdicts[0]!.verdict).toBe('would_apply');
    });
  }

  it('FAIL-CLOSED — the same factor named protectively elsewhere still holds', () => {
    const result = demote(
      'Update the model. Do not touch Skip rate.',
      configureOptionEffect(OPTION_ID, CHURN_ID),
      factorGraph('Skip rate'),
    );
    expect(result.demotedIndices).toEqual([0]);
    expect(result.demotedEntityLabels).toContain('Skip rate');
  });
});
