/**
 * ⭐⭐ THE USER'S STATED OBJECTION REACHES THE MODEL — and every assertion here
 * binds by IDENTITY (the exact statement, the exact finding id), never by "some
 * text is present", which a neighbouring objection would satisfy on its own.
 *
 * WHAT THIS CLOSES. `finding_dissent` (schemas 0.55.0) had a complete producer
 * chain and ZERO readers: the UI composes it, `system-events/dispatch.ts`
 * persists the statement verbatim, and nothing ever read it back. The user's
 * reason for rejecting a finding — the most valuable thing this product
 * collects — was written to a fact row and stopped there.
 *
 * ⚠⚠ THE TWO HARMS THIS FIELD SITS BETWEEN ARE OPPOSITE, so most cases below
 * come in twins (trap 22b: a corpus that tests one direction is a guard
 * watching one door):
 *   · DROPPING an objection the user made  → the seam is dark again
 *   · INVENTING or CARRYING one they did not make → the model engages with
 *     words the user has retracted, or attributes an objection to the wrong
 *     finding
 */
import { describe, it, expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  projectStatedObjections,
  STATED_OBJECTIONS_CAP,
  type StatedObjection,
} from '../stated-objections.js';
import { StatedObjectionSchema } from '../context-pack-schema.js';
import { isDecisionContentField } from '../../../utils/logger-config.js';
import { STATED_OBJECTIONS_INSTRUCTION } from '../../routing/route-with-tool-use.js';
import { MUTATION_DISPATCH_SKIP } from '../recent-changes.js';


const SALARY_REASON =
  'Our local salary band is fixed by a pay framework we renegotiate only in April, so that input cannot move this year.';
const SUPPLIER_REASON =
  'The supplier contract is fixed until 2028, so treating switching cost as a free variable overstates what we can actually change.';
const SUPERSEDED_REASON =
  'I think the salary number is probably a bit high but I am not certain enough to say why yet.';

function dissent(
  findingId: string,
  statement: string,
  analysisId = 'sha256:run-b',
  noop = false,
): HandlerFact {
  return {
    fact_type: 'finding_dissent',
    fact_version: 1,
    noop,
    result: {
      finding_id: findingId,
      analysis_id: analysisId,
      statement,
      provenance: 'user_set',
    },
  } as unknown as HandlerFact;
}

/** A NON-dissent fact — the contrast control for "only dissents are read". */
function runAnalysis(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      enrichment: { analysis_status: 'completed', results: [] },
      computed_at: '2026-09-18T00:00:00Z',
      graph_hash_at_run: 'hash-b',
    },
  } as unknown as HandlerFact;
}

const statements = (out: readonly StatedObjection[]): readonly string[] =>
  out.map((o) => o.statement);

describe('projectStatedObjections', () => {
  /**
   * ⚠ PRECONDITION PINNED IN-TEST. Every case below is about what the projector
   * does with a `finding_dissent` fact; if the fixture's fact_type were ever
   * mistyped, each case would assert an empty projection and pass for the wrong
   * reason. Prove the fixture is the thing under test before testing it.
   */
  it('PRECONDITION — the fixture really is a finding_dissent fact, and the projector really sees it', () => {
    const fact = dissent('strengthen:robustness', SALARY_REASON);
    expect((fact as { fact_type: string }).fact_type).toBe('finding_dissent');
    expect(projectStatedObjections([fact])).toHaveLength(1);
  });

  it('carries the statement VERBATIM, with the address it was made against', () => {
    const out = projectStatedObjections([dissent('strengthen:robustness', SALARY_REASON)]);
    expect(out).toEqual([
      {
        finding_id: 'strengthen:robustness',
        analysis_id: 'sha256:run-b',
        statement: SALARY_REASON,
      },
    ]);
    // IDENTITY, not a substring: the words are the record, so a trim, a
    // collapse or a truncation must fail here.
    expect(out[0]!.statement).toBe(SALARY_REASON);
  });

  /**
   * ⭐⭐ THE SUPERSESSION PAIR. A user who rewrites their objection emits a
   * SECOND fact against the SAME finding. Newest-first input ⇒ the first
   * occurrence is live.
   *
   * Both halves are asserted, because either alone is satisfiable by a wrong
   * implementation: "the newest is present" passes for an implementation that
   * keeps BOTH, and "only one entry" passes for one that keeps the OLDEST.
   */
  it('SUPERSESSION — the newest objection on a finding replaces the older one, and the older is GONE', () => {
    const out = projectStatedObjections([
      dissent('strengthen:robustness', SALARY_REASON),
      dissent('strengthen:robustness', SUPERSEDED_REASON),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.statement).toBe(SALARY_REASON);
    expect(statements(out)).not.toContain(SUPERSEDED_REASON);
  });

  /**
   * ⭐ THE OPPOSITE-DIRECTION TWIN of the case above. Collapsing by finding id
   * must NOT collapse two objections to DIFFERENT findings — disagreeing with
   * two things is two objections, and an implementation that de-duplicated on
   * "a dissent exists" would pass the supersession case and fail here.
   */
  it('TWIN — two objections to DIFFERENT findings are both kept', () => {
    const out = projectStatedObjections([
      dissent('strengthen:robustness', SALARY_REASON),
      dissent('strengthen:broaden', SUPPLIER_REASON),
    ]);
    expect(out).toHaveLength(2);
    expect(statements(out)).toEqual([SALARY_REASON, SUPPLIER_REASON]);
  });

  it('CAP — at most STATED_OBJECTIONS_CAP objections reach the model, NEWEST first', () => {
    const facts = Array.from({ length: STATED_OBJECTIONS_CAP + 2 }, (_, i) =>
      dissent(`finding-${i}`, `Objection number ${i} about a factor we cannot actually move.`),
    );
    const out = projectStatedObjections(facts);
    expect(out).toHaveLength(STATED_OBJECTIONS_CAP);
    // IDENTITY: the kept ones are the NEWEST, i.e. the head of the input.
    expect(out.map((o) => o.finding_id)).toEqual(
      Array.from({ length: STATED_OBJECTIONS_CAP }, (_, i) => `finding-${i}`),
    );
    // And the dropped one is genuinely absent, not merely beyond an index.
    expect(out.map((o) => o.finding_id)).not.toContain(`finding-${STATED_OBJECTIONS_CAP + 1}`);
  });

  /**
   * CONTRAST CONTROL in the same run: a non-dissent fact must read zero while
   * the dissent beside it reads one. Target-0-and-contrast-0 would mean the
   * projector is simply blind.
   */
  it('reads ONLY finding_dissent facts (contrast: a run_analysis fact contributes nothing)', () => {
    expect(projectStatedObjections([runAnalysis()])).toEqual([]);
    const mixed = projectStatedObjections([runAnalysis(), dissent('f1', SALARY_REASON)]);
    expect(mixed).toHaveLength(1);
    expect(mixed[0]!.finding_id).toBe('f1');
  });

  it('a noop receipt is not a standing objection (contrast: the same fact non-noop IS)', () => {
    expect(projectStatedObjections([dissent('f1', SALARY_REASON, 'sha256:run-b', true)])).toEqual([]);
    expect(
      projectStatedObjections([dissent('f1', SALARY_REASON, 'sha256:run-b', false)]),
    ).toHaveLength(1);
  });

  it('drops a row whose address or statement is blank (contrast: the well-formed row is kept)', () => {
    expect(projectStatedObjections([dissent('', SALARY_REASON)])).toEqual([]);
    expect(projectStatedObjections([dissent('f1', SALARY_REASON, '')])).toEqual([]);
    expect(projectStatedObjections([dissent('f1', '   ')])).toEqual([]);
    expect(projectStatedObjections([dissent('f1', SALARY_REASON)])).toHaveLength(1);
  });

  it('no facts threaded ⇒ empty projection (absence is never an invented objection)', () => {
    expect(projectStatedObjections(undefined)).toEqual([]);
    expect(projectStatedObjections([])).toEqual([]);
  });

  it('the projection validates against the schema the ContextPack actually uses', () => {
    const out = projectStatedObjections([dissent('strengthen:robustness', SALARY_REASON)]);
    expect(out).toHaveLength(1);
    expect(StatedObjectionSchema.safeParse(out[0]).success).toBe(true);
  });
});

describe('the seam this field sits in', () => {
  /**
   * ⭐⭐ THE KEY NAME IS A SAFETY PROPERTY, DERIVED RATHER THAN REMEMBERED.
   * `utils/logger-config.ts` redacts the field NAME `statement` at depths 0-2,
   * which is exactly where `stated_objections.<i>.statement` serialises. A
   * rename would silently leave that boundary behind, so the binding is
   * asserted against the redaction authority itself, not against a comment.
   */
  it('the statement key is one the log-redaction boundary already covers', () => {
    const out = projectStatedObjections([dissent('f1', SALARY_REASON)]);
    const keys = Object.keys(out[0]!);
    expect(keys).toContain('statement');
    expect(isDecisionContentField('statement')).toBe(true);
    // CONTRAST CONTROL — the probe discriminates: the address half carries no
    // user bytes and is deliberately NOT in the redaction class.
    expect(isDecisionContentField('finding_id')).toBe(false);
  });

  /**
   * ⚠ NAMED APART, NOT RECONCILED (trap 21). `recent_changes` answers "what
   * changed in the MODEL?" and `finding_dissent` correctly remains SKIP there.
   * This field answers a DIFFERENT question. If a later lane "fixes the
   * inconsistency" by promoting the dissent to a mutation receipt, this REDs
   * and says why — that promotion would let `deriveInterveningChange` say
   * "since you changed X" about something that changed nothing.
   */
  it('finding_dissent stays a recent-changes SKIP — this field is a second question, not a correction', () => {
    expect(MUTATION_DISPATCH_SKIP.has('finding_dissent')).toBe(true);
  });

  /**
   * The instruction is the half that makes the field govern anything. The
   * sanction gate proves it is EMITTED; this pins what it SAYS, because the
   * two failure modes are opposite and a field with a vague licence is worse
   * than no field.
   */
  it('the instruction names the field and forbids BOTH capitulation and re-assertion', () => {
    expect(STATED_OBJECTIONS_INSTRUCTION).toContain('stated_objections');
    // Harm 1 — agreeing on the strength of an assertion.
    expect(STATED_OBJECTIONS_INSTRUCTION).toMatch(/Do NOT quietly drop, soften or reverse a finding/);
    // Harm 2 — carrying on as though nothing was said.
    expect(STATED_OBJECTIONS_INSTRUCTION).toMatch(/Do NOT repeat the objected-to finding/);
    // The state claim: an objection mutates nothing.
    expect(STATED_OBJECTIONS_INSTRUCTION).toMatch(/An objection changes NOTHING in the model/);
    // The reasoning-enhancement move, and the reason this field exists at all.
    expect(STATED_OBJECTIONS_INSTRUCTION).toMatch(/make the disagreement testable/);
    // Absence is never "uncontested".
    expect(STATED_OBJECTIONS_INSTRUCTION).toMatch(/Never infer that a finding is uncontested/);
  });
});
