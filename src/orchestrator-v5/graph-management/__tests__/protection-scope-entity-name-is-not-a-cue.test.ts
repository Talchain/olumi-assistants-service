/**
 * ⭐⭐ THE PRODUCT ADVISED A SENTENCE AND THEN REFUSED IT — the F-3 guard's
 * predicate DOMAIN, not its invariant.
 *
 * WITNESS (golden journey 20260819T221620Z, deployed CEE `cbc3ea3`): the
 * drafter produced an option labelled "keep what we have"; the product then
 * advised the user to say `Set the keep what we have option's effect on
 * {factor} to {value}` — a sentence CEE composes itself
 * (`buildConfigureOptionAdvisedFormat`, orchestrator-v5/configure-option-chip-text.ts,
 * which also rides as a clickable chip whose `message` replays as user text).
 * The turn came back HELD with `blocker_code: USER_PROTECTED_ENTITY`.
 *
 * ROOT CAUSE — the predicate's BREADTH, exactly the class CLAUDE.md warns of:
 * `PROTECTION_CUE` is tested against the RAW clause, and the clause contains
 * the entity's OWN LABEL. `keep` is a protection cue AND the first word of the
 * option's name, so the option MANUFACTURED ITS OWN PROTECTION. The user wrote
 * no protection cue at all. Worse, the co-mentioned FACTOR was protected too
 * (bare commas are not clause boundaries), so the whole op was demoted.
 *
 * The harm is not only a wasted confirm tap. The hold's copy asserts
 * *"You asked for 'keep what we have' … to stay as it is"* on a sentence that
 * says SET — the product telling the user what they said, which is precisely
 * what `buildGmAmbiguousHeldAssistantText` exists to prevent one door along.
 *
 * THE RULE UNDER TEST — one sentence, and it is a DOMAIN correction to the one
 * canonical predicate (`clauseIsProtective`, single call site), not a second
 * rule beside it:
 *
 *   ⭐ A NAME IS NOT AN INSTRUCTION. A protection cue must be authored by the
 *     USER. A cue contributed by the NAME of an entity the op is ADDRESSED TO
 *     protects nothing — you cannot ask me to leave a thing alone by calling
 *     it what it is called.
 *
 * ⚠ SCOPED TO THE OP'S OWN TARGETS, DELIBERATELY — this is the fail-closed
 * half, and the reason this is not a weakening (CLAUDE.md trap 22b: two
 * opposite harms need two parameters, not a widened window). Only the names of
 * the entities THIS op would change are masked. A cue carried by some OTHER
 * entity's name still protects, so
 * `"Update Customer churn to 0.4, keep current CRM Platform Cost"` — with a
 * status-quo option actually labelled "keep current" — still HOLDS a write to
 * CRM Platform Cost. Pinned below as FAIL-CLOSED.
 *
 * ⚠ NOT COVERED, on purpose: the `EXCEPTION_TAIL` scan is untouched, so an
 * entity whose LABEL contains an exception seam ("all except Germany") can
 * still self-protect through that path. No such label has been observed and
 * closing it would need clause offsets; recorded here rather than left silent.
 */
import { describe, it, expect } from 'vitest';

import { demoteProtectedEntityTargets, extractProtectedEntities } from '../protection-scope.js';
import { USER_PROTECTED_ENTITY } from '../reason-codes.js';
import type { CandidateMutationEnvelope, RefereeVerdict } from '../types.js';
// Bind to the REAL producer and the REAL canonical list — never a paraphrase
// of either (CLAUDE.md trap 12: a hand-copied corpus drifts silently green).
import { buildConfigureOptionAdvisedFormat } from '../../configure-option-chip-text.js';
import { STATUS_QUO_LABEL_PATTERNS } from '../../../cee/structure/status-quo-patterns.js';

const FACTOR_ID = 'fac_churn';
const FACTOR_LABEL = 'Customer churn';
const OPTION_ID = 'opt_status_quo';

function graphWith(optionLabel: string, extra: ReadonlyArray<{ id: string; label: string }> = []) {
  return {
    nodes: [
      { id: OPTION_ID, label: optionLabel },
      { id: FACTOR_ID, label: FACTOR_LABEL },
      ...extra,
    ],
  };
}

/** The live option-configure write shape (field carries the factor id). */
function configureOptionEffect(optionId: string, factorId: string): CandidateMutationEnvelope {
  return {
    envelope_version: 1,
    candidate_id: '00000000-0000-0000-0000-0000000000aa',
    kind: 'update_node_field',
    base_graph_hash: 'h',
    payload: {
      node_id: optionId,
      field: `data/interventions/${factorId}`,
      from: 0.2,
      to: 0.4,
    },
    provenance: { source: 'edit_graph_llm', evidence_pointer: 'p' },
    identity: { scenario_id: 's', turn_id: 't' },
  } as CandidateMutationEnvelope;
}

function updateNode(nodeId: string): CandidateMutationEnvelope {
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

// ---------------------------------------------------------------------------
// 1. THE WITNESS
// ---------------------------------------------------------------------------

describe("the product's own advised sentence is not a protection instruction", () => {
  const WITNESS_LABEL = 'keep what we have';
  // Composed by the SAME builder the product uses, so this test fails if the
  // advised phrasing ever changes underneath it.
  const advised = buildConfigureOptionAdvisedFormat(WITNESS_LABEL, FACTOR_LABEL, '0.4');

  it('the advised sentence is the shape the witness carried', () => {
    expect(advised).toBe("Set the keep what we have option's effect on Customer churn to 0.4");
  });

  // The op the advised sentence asks for names BOTH entities: the option
  // directly and the factor through the interventions key.
  const ADVISED_OP_REFERENTS = [OPTION_ID, WITNESS_LABEL, FACTOR_ID, FACTOR_LABEL];

  it('⭐ protects NOTHING once the op\'s own target names are masked', () => {
    const found = extractProtectedEntities(advised, graphWith(WITNESS_LABEL), ADVISED_OP_REFERENTS);
    // Bind by IDENTITY (node ids), never by a count another node could satisfy.
    expect(found.map((e) => e.nodeId)).toEqual([]);
  });

  it('POSITIVE CONTROL — the masking is what does the work, not a dead predicate', () => {
    // Same message, NO referent names: the raw scan is deliberately unchanged,
    // so this still reports both entities. If this ever returns [] the cue
    // regex has been weakened instead of its DOMAIN corrected, and the test
    // above would then be passing for the wrong reason.
    const raw = extractProtectedEntities(advised, graphWith(WITNESS_LABEL));
    expect(raw.map((e) => e.nodeId)).toEqual([OPTION_ID, FACTOR_ID]);
  });

  it('⭐ the option-effect write is NOT demoted (the SENDABLE defect)', () => {
    const verdict = wouldApply();
    const result = demoteProtectedEntityTargets(
      [verdict],
      [configureOptionEffect(OPTION_ID, FACTOR_ID)],
      advised,
      graphWith(WITNESS_LABEL),
    );
    expect(result.demotedIndices).toEqual([]);
    expect(result.verdicts[0]!.verdict).toBe('would_apply');
    expect(result.verdicts[0]!.blocker?.code).toBeUndefined();
    expect(result.demotedEntityLabels).toEqual([]);
  });

  it('⭐ the CO-MENTIONED FACTOR is freed too — it rode the same clause', () => {
    // The factor was collateral: bare commas are not clause boundaries, so the
    // option's self-made cue protected everything named beside it.
    const found = extractProtectedEntities(advised, graphWith(WITNESS_LABEL), ADVISED_OP_REFERENTS);
    expect(found.map((e) => e.nodeId)).not.toContain(FACTOR_ID);
  });
});

// ---------------------------------------------------------------------------
// 2. REACHABILITY — derived from the estate's OWN canonical status-quo list
// ---------------------------------------------------------------------------

describe('every canonical status-quo option label survives the advised sentence', () => {
  // Derived, not mirrored: this list is `matchesStatusQuoLabel`'s source of
  // truth and the same one `detectMissingCounterfactual` coaches users toward.
  it('the canonical list is non-empty (guards a vacuous loop)', () => {
    expect(STATUS_QUO_LABEL_PATTERNS.length).toBeGreaterThanOrEqual(18);
  });

  for (const label of STATUS_QUO_LABEL_PATTERNS) {
    it(`"${label}" — the advised sentence applies`, () => {
      const result = demoteProtectedEntityTargets(
        [wouldApply()],
        [configureOptionEffect(OPTION_ID, FACTOR_ID)],
        buildConfigureOptionAdvisedFormat(label, FACTOR_LABEL, '0.4'),
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

  // Each of these names the SAME cue-bearing option the witness frees, so a
  // fix that simply stopped protecting status-quo options turns these RED.
  const stillProtected: ReadonlyArray<readonly [string, string]> = [
    ['outright', 'Do not touch keep what we have.'],
    ['imperative-leave', 'Leave keep what we have alone.'],
    ['negated-modal', "The configuration of keep what we have shouldn't change."],
    ['A6 shape', 'Configure nothing on keep what we have; just set Customer churn to 0.52.'],
    ['post-dash', 'Set Customer churn to 0.4 - do not touch keep what we have'],
    ['but-not seam', 'Change what you need but not keep what we have'],
  ];

  for (const [name, message] of stillProtected) {
    it(`${name}: still demotes the write to "${WITNESS_LABEL}"`, () => {
      const result = demoteProtectedEntityTargets(
        [wouldApply()],
        [configureOptionEffect(OPTION_ID, FACTOR_ID)],
        message,
        graphWith(WITNESS_LABEL),
      );
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
        { id: 'fac_cost', label: 'CRM Platform Cost' },
      ],
    };
    const result = demoteProtectedEntityTargets(
      [wouldApply()],
      [configureOptionEffect('opt_crm', 'fac_cost')],
      'Set CRM Platform Cost to 0.5 - the configuration of Cloud-Native CRM shouldn’t change.',
      graph,
    );
    expect(result.demotedIndices).toEqual([0]);
    expect(result.verdicts[0]!.blocker?.code).toBe(USER_PROTECTED_ENTITY);
    expect(result.demotedEntityLabels).toContain('Cloud-Native CRM');
  });
});

// ---------------------------------------------------------------------------
// 4. FAIL-CLOSED — a cue carried by ANOTHER entity's name still protects
// ---------------------------------------------------------------------------

describe('FAIL-CLOSED — masking is scoped to the op\'s OWN targets', () => {
  // The graph really does contain a status-quo option labelled "keep current",
  // and the user's protective phrase collides with it word for word. The op
  // under judgement targets CRM Platform Cost, NOT that option — so the cue is
  // not this op's own name and the protection stands.
  const graph = {
    nodes: [
      { id: 'opt_keep_current', label: 'keep current' },
      { id: 'fac_cost', label: 'CRM Platform Cost' },
      { id: FACTOR_ID, label: FACTOR_LABEL },
    ],
  };
  // ⚠ Two SENTENCES on purpose. Bare commas are deliberately NOT clause
  // boundaries in this module (so "leave A, B and C alone" stays one protective
  // clause), which means a comma-joined variant protects everything named
  // beside the cue. That is pre-existing, documented and unchanged here; the
  // per-op discrimination this module guarantees is across CLAUSES.
  const message = 'Update Customer churn to 0.4. Keep current CRM Platform Cost.';

  it('⭐ a write to the protected factor is STILL held', () => {
    const result = demoteProtectedEntityTargets(
      [wouldApply()],
      [updateNode('fac_cost')],
      message,
      graph,
    );
    expect(result.demotedIndices).toEqual([0]);
    expect(result.verdicts[0]!.blocker?.code).toBe(USER_PROTECTED_ENTITY);
    expect(result.demotedEntityLabels).toContain('CRM Platform Cost');
  });

  it('the authorised write in the same message still applies (per-op discrimination)', () => {
    const result = demoteProtectedEntityTargets(
      [wouldApply()],
      [updateNode(FACTOR_ID)],
      message,
      graph,
    );
    expect(result.demotedIndices).toEqual([]);
    expect(result.verdicts[0]!.verdict).toBe('would_apply');
  });
});
