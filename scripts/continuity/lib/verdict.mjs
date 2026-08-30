/**
 * Verdicts, discrimination, and the rules that make a worthless PASS impossible.
 *
 * THE DESIGN CLAIM
 * ----------------
 * This estate's recurring instrument defect is not a missing assertion. It is
 * an assertion that CANNOT FAIL: a control that agrees with its arm because
 * both returned nothing; a discriminator whose fixture silently stopped
 * reproducing the target; a suite whose green comes from tests that never ran.
 *
 * The response here is structural rather than cultural. A case does not get to
 * "declare" that it has a control. The runner refuses to score any case whose
 * shape does not include one, and `scoreCase()` computes DISCRIMINATION as a
 * precondition of the verdict rather than as one assertion among many. A case
 * that stops discriminating cannot return PASS or FAIL — it returns
 * COULD_NOT_MEASURE, which is a failure of the run, never a pass.
 *
 * Three outcomes, deliberately not two:
 *   PASS               — the property held, and the instrument proved it could have failed.
 *   FAIL               — the property did not hold, and the instrument proved it could have passed.
 *   COULD_NOT_MEASURE  — the instrument is not entitled to an opinion.
 *
 * Collapsing the third into either of the others is how an estate learns to
 * trust a number it never measured.
 */

export const PASS = 'PASS';
export const FAIL = 'FAIL';
export const CNM = 'COULD_NOT_MEASURE';

/** Exit codes: 0 all-pass · 1 a real failure · 2 the instrument could not measure. */
export const EXIT = { OK: 0, FAILED: 1, COULD_NOT_MEASURE: 2 };

/**
 * Assert a value is non-empty before any downstream comparison believes it.
 *
 * Two extractions that both produced nothing agree perfectly. `diff` exits 0,
 * every assertion holds, and the result is worthless (CLAUDE.md: the zsh
 * history-modifier incident, where both sides extracted empty files and the
 * comparison cheerfully agreed). Every comparison in this harness routes
 * through a non-empty gate first.
 */
export function requireNonEmpty(label, value, { minLength = 1 } = {}) {
  if (value === null || value === undefined) {
    return { ok: false, reason: `${label}: absent (null/undefined)` };
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.length < minLength) {
      return { ok: false, reason: `${label}: empty or shorter than ${minLength} chars (len=${t.length})` };
    }
    return { ok: true };
  }
  if (Array.isArray(value)) {
    if (value.length < minLength) return { ok: false, reason: `${label}: array shorter than ${minLength}` };
    return { ok: true };
  }
  if (typeof value === 'object' && Object.keys(value).length === 0) {
    return { ok: false, reason: `${label}: object has no keys` };
  }
  return { ok: true };
}

/**
 * The arms must DISCRIMINATE.
 *
 * `expect(arm).not.toEqual(control)` passes when both are empty, which is the
 * exact defect this replaces. So discrimination here is a conjunction:
 *   (a) both arms are independently non-empty, AND
 *   (b) they are not byte-identical.
 *
 * The 30 Aug batch voided two cases for returning byte-identical answers under
 * opposite antecedents. That must be an automatic, unmissable outcome of the
 * harness rather than something a reader notices — so it is computed here, for
 * every case, regardless of what the case's own assertions say.
 */
export function assertArmsDiscriminate(armText, controlText) {
  const a = requireNonEmpty('arm response', armText, { minLength: 2 });
  if (!a.ok) return { ok: false, reason: `cannot discriminate — ${a.reason}` };
  const c = requireNonEmpty('control response', controlText, { minLength: 2 });
  if (!c.ok) return { ok: false, reason: `cannot discriminate — ${c.reason}` };

  const an = String(armText).trim();
  const cn = String(controlText).trim();
  if (an === cn) {
    return {
      ok: false,
      reason:
        'arm and control returned BYTE-IDENTICAL text — the probe is not discriminating. ' +
        'Suspect the probe, not the world.',
    };
  }
  return { ok: true, reason: `arm/control differ (arm ${an.length}B, control ${cn.length}B)` };
}

/**
 * Collapse N replays into one verdict.
 *
 * The routing non-determinism reported independently by two cases in the
 * 30 Aug batch means a single call is not evidence. Replays that DISAGREE are
 * a finding in their own right, never noise to be averaged away or silently
 * majority-voted: a case that answers correctly two times in three is not a
 * case that passes, it is a case whose behaviour is not yet understood.
 */
export function collapseReplays(verdicts) {
  const distribution = {};
  for (const v of verdicts) distribution[v] = (distribution[v] || 0) + 1;
  const distinct = Object.keys(distribution);

  if (verdicts.length === 0) {
    return { verdict: CNM, distribution, split: false, reason: 'no replays executed' };
  }
  if (distinct.length === 1) {
    return { verdict: distinct[0], distribution, split: false, reason: `${verdicts.length}/${verdicts.length} agreed` };
  }
  return {
    verdict: CNM,
    distribution,
    split: true,
    reason:
      `SPLIT READING across ${verdicts.length} replays (${JSON.stringify(distribution)}) — ` +
      'reported as a finding, not averaged. A split is evidence about determinism.',
  };
}

/**
 * Score one case. Discrimination and precondition are gates, not assertions.
 *
 * Order matters and is deliberate:
 *   1. precondition — did the fixture actually reproduce the state under test?
 *      A control that passes because the fixture stopped producing a blocker
 *      is a guard agreeing with itself.
 *   2. discrimination — can this probe tell the two worlds apart at all?
 *   3. only then — the case's own assertions.
 * A failure at 1 or 2 is COULD_NOT_MEASURE. Only a failure at 3 is a FAIL.
 */
export function scoreCase({ preconditionChecks, discrimination, armChecks, controlChecks }) {
  const failedPre = (preconditionChecks || []).filter((c) => !c.ok);
  if (failedPre.length > 0) {
    return {
      verdict: CNM,
      stage: 'precondition',
      reason: `precondition not reproduced: ${failedPre.map((c) => c.detail || c.name).join('; ')}`,
    };
  }
  if (!discrimination || !discrimination.ok) {
    return {
      verdict: CNM,
      stage: 'discrimination',
      reason: discrimination ? discrimination.reason : 'no discrimination computed',
    };
  }
  const failedArm = (armChecks || []).filter((c) => !c.ok);
  const failedCtl = (controlChecks || []).filter((c) => !c.ok);
  if (failedArm.length > 0 || failedCtl.length > 0) {
    return {
      verdict: FAIL,
      stage: failedArm.length ? 'arm' : 'control',
      reason: [...failedArm, ...failedCtl].map((c) => `${c.name}: ${c.detail}`).join(' | '),
    };
  }
  return { verdict: PASS, stage: 'complete', reason: discrimination.reason };
}

/** Build a named check result. Every check states what it looked for. */
export function check(name, ok, detail) {
  return { name, ok: Boolean(ok), detail: String(detail ?? '') };
}

/**
 * Case shape validation — refuse to run a case that cannot be falsified.
 *
 * This is the requirement "a case that can pass without discriminating is
 * worthless" enforced by construction. A future contributor cannot add a
 * control-less case by forgetting; the runner will not accept it.
 */
export function validateCaseShape(c) {
  const problems = [];
  const need = ['id', 'stateClass', 'seam', 'setup', 'precondition', 'arm', 'control', 'assertArm', 'assertControl'];
  for (const k of need) if (!(k in c)) problems.push(`missing required key: ${k}`);
  for (const k of ['setup', 'precondition', 'arm', 'control', 'assertArm', 'assertControl']) {
    if (k in c && typeof c[k] !== 'function') problems.push(`${k} must be a function`);
  }
  if (c.stateClass && !['fresh', 'seeded', 'replayed'].includes(c.stateClass)) {
    problems.push(`stateClass must be fresh|seeded|replayed (got ${c.stateClass})`);
  }
  return { ok: problems.length === 0, problems };
}
