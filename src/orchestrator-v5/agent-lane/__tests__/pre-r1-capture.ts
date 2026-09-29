/**
 * ⭐ A DRAFT CAPTURED FROM A PRE-R1 DRAFTER, REPLAYED THROUGH THE CURRENT STRICT CONTRACT (R1 S4-core, 0.61.0).
 *
 * The served captures under `./fixtures/` are the drafter's own output, recorded before the candidate schema required a
 * goal `frame` and before a limit's `frame` became `level | change_abs | change_rel`. Their bytes are evidence and are
 * NEVER edited. To replay one through today's strict schema, this supplies exactly what admission itself does with such
 * a draft, and nothing else:
 *   · a goal with no `frame` → `frame: 'level'` (admission: an absent frame is a level, the candidate's own doc);
 *   · a limit framed `delta` (the pre-R1 prompt's "a CHANGE from today") → `change_abs` (`writtenLimitFrame`);
 *   · a draft with no `change_created` → `[]` (admission: absent marks nothing).
 * Every other key, and every value, is the capture's own. A copy is returned; the parsed capture is not mutated.
 */
export function asCurrentDraft<T>(capture: T): T {
  const walk = (v: unknown, inConstraints: boolean): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, inConstraints));
    if (v === null || typeof v !== 'object') return v;
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) out[k] = walk(x, k === 'constraints');
    if ('metric' in o && 'target_stated' in o && !('frame' in o)) out['frame'] = 'level';
    // A draft from before the change-created marker declared none (admission: absent marks nothing).
    if ('goal' in o && 'factors' in o && !('change_created' in o)) out['change_created'] = [];
    if (inConstraints && 'metric' in o && o['frame'] === 'delta') out['frame'] = 'change_abs';
    return out;
  };
  return walk(capture, false) as T;
}
